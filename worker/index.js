/* 寶島鐵道大亨 — Cloudflare 遊戲伺服器
 * 每個房間代碼對應一個 Durable Object，裡面執行一份完整的遊戲（.build/engine.mjs，
 * 由 js/game.js 組成）。玩家的瀏覽器只負責顯示畫面、回答自己的操作。
 *
 * 瀏覽器 ↔ 伺服器：連上時先收到 {sys:'welcome', id}，之後都是遊戲訊息（見 js/net.js）。
 * 房間代碼不存在時收到 {sys:'error', reason}：noroom / taken / full。
 */
import { DurableObject } from 'cloudflare:workers';
import { createEngine } from '../.build/engine.mjs';

const ROOM_RE = /^\/room\/([A-Z0-9]{4})$/;
const MAX_SOCKETS = 8;
const IDLE_PAUSE_MS = 60 * 1000;            // 沒有真人連線 1 分鐘就暫停（遊戲進度已存檔）
const KEEP_PAUSED_MS = 24 * 60 * 60 * 1000; // 暫停中的遊戲保留 24 小時
const KEEP_OVER_MS = 10 * 60 * 1000;        // 結束的遊戲保留 10 分鐘

export default {
  async fetch(req, env) {
    const m = new URL(req.url).pathname.match(ROOM_RE);
    if (!m) return env.ASSETS.fetch(req);
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  },
};

const randId = n => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, b => (b % 36).toString(36)).join('');
};

function refuse(reason) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.send(JSON.stringify({ sys: 'error', reason }));
  server.close(4004, reason);
  return new Response(null, { status: 101, webSocket: client });
}

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.socks = new Map();
    this.engine = null;
    ctx.blockConcurrencyWhile(async () => {
      this.meta = (await ctx.storage.get('meta')) || null;
      this.saved = (await ctx.storage.get('save')) || null;
    });
  }

  async fetch(req) {
    const url = new URL(req.url);
    const code = url.pathname.match(ROOM_RE)[1];
    if (url.searchParams.get('create') === '1') {
      if (this.meta) return refuse('taken');
      this.meta = { code, created: Date.now() };
      await this.ctx.storage.put('meta', this.meta);
    } else if (!this.meta || this.meta.over) return refuse('noroom');
    if (this.socks.size >= MAX_SOCKETS) return refuse('full');

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const id = randId(8);
    this.socks.set(id, server);
    const engine = this.ensureEngine();
    server.addEventListener('message', e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (this.engine) this.engine.message(id, msg);
    });
    const closed = () => {
      if (this.socks.get(id) !== server) return;
      this.socks.delete(id);
      if (this.engine) this.engine.disconnect(id);
      this.idleCheck();
    };
    server.addEventListener('close', closed);
    server.addEventListener('error', closed);
    server.send(JSON.stringify({ sys: 'welcome', id }));
    engine.connect(id);
    clearTimeout(this.idleTimer);
    await this.ctx.storage.deleteAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  /* 建立（或重新建立）這個房間的遊戲。dead 之後，舊遊戲的計時器全部不再觸發，等於整個停掉 */
  ensureEngine() {
    if (this.engine) return this.engine;
    let dead = false;
    const timers = new Set();
    const host = {
      code: this.meta.code,
      saved: this.saved,
      setTimeout: (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!dead) fn(); }, ms); timers.add(t); return t; },
      clearTimeout: t => { timers.delete(t); clearTimeout(t); },
      setInterval: (fn, ms) => setInterval(() => { if (!dead) fn(); }, ms),
      clearInterval: t => clearInterval(t),
      send: (id, msg) => {
        if (dead) return;
        const ws = this.socks.get(id);
        if (ws) { try { ws.send(JSON.stringify(msg)); } catch (e) { /* ignore */ } }
      },
      close: id => { const ws = this.socks.get(id); if (ws) { try { ws.close(4002, 'closed'); } catch (e) { /* ignore */ } } },
      save: json => { if (dead) return; this.saved = json; this.ctx.storage.put('save', json); },
      clearSave: () => { this.saved = null; this.ctx.storage.delete('save'); },
      over: async () => {
        this.meta.over = true;
        await this.ctx.storage.put('meta', this.meta);
        await this.ctx.storage.setAlarm(Date.now() + KEEP_OVER_MS);
      },
      error: e => console.error('game loop error', e && e.stack || e),
      idleCheck: () => this.idleCheck(),
    };
    const engine = createEngine(host);
    engine.kill = () => {
      dead = true;
      for (const t of timers) clearTimeout(t);
      clearInterval(engine.hb);
    };
    engine.hb = setInterval(() => engine.heartbeat(), 3000);
    this.engine = engine;
    return engine;
  }

  /* 沒有任何真人連線時，等 1 分鐘後暫停遊戲：進度已存在存檔，有人回來就從那一回合的開頭繼續 */
  idleCheck() {
    if (!this.engine || this.engine.onlineHumans() > 0) { clearTimeout(this.idleTimer); this.idleTimer = null; return; }
    if (this.idleTimer) return;
    this.idleTimer = setTimeout(() => this.pause(), IDLE_PAUSE_MS);
  }

  async pause() {
    this.idleTimer = null;
    if (!this.engine || this.engine.onlineHumans() > 0) return;
    const started = this.engine.started();
    this.engine.kill();
    this.engine = null;
    for (const ws of this.socks.values()) { try { ws.close(4001, 'paused'); } catch (e) { /* ignore */ } }
    this.socks.clear();
    if (!started || this.meta.over) { await this.cleanup(); return; }
    await this.ctx.storage.setAlarm(Date.now() + KEEP_PAUSED_MS);
  }

  async cleanup() {
    await this.ctx.storage.deleteAll();
    this.meta = null;
    this.saved = null;
  }

  async alarm() {
    if (this.socks.size && !(this.meta && this.meta.over)) return;
    if (this.engine) { this.engine.kill(); this.engine = null; }
    for (const ws of this.socks.values()) { try { ws.close(4001, 'room closed'); } catch (e) { /* ignore */ } }
    this.socks.clear();
    await this.cleanup();
  }
}
