/* 寶島鐵道大亨 — Cloudflare 連線伺服器
 * 每個房間代碼對應一個 Durable Object，負責在房主和加入者之間轉送訊息。
 * 遊戲本身仍由房主的瀏覽器執行，伺服器只當中繼站。
 *
 * 房主 → 伺服器：{to: 玩家id | '*', msg} 或 {to: 玩家id, close: true}
 * 伺服器 → 房主：{sys:'welcome', token, clients} / {sys:'open'|'close', id} / {sys:'data', id, msg}
 * 加入者 ↔ 伺服器：一般遊戲訊息原封不動轉送；連上時先收到 {sys:'welcome', id}
 */
import { DurableObject } from 'cloudflare:workers';

const ROOM_RE = /^\/room\/([A-Z0-9]{4})$/;
const HOST_GRACE_MS = 10 * 60 * 1000; // 房主斷線後保留房間 10 分鐘，讓房主能接回
const MAX_CLIENTS = 8;

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

export class Room extends DurableObject {
  sockets(tag, except) {
    return this.ctx.getWebSockets(tag).filter(w => w !== except && w.readyState === WebSocket.OPEN);
  }

  host(except) { return this.sockets('host', except)[0]; }

  clientIds(except) {
    return this.sockets('c', except).map(w => (w.deserializeAttachment() || {}).id).filter(Boolean);
  }

  refuse(reason) {
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    server.send(JSON.stringify({ sys: 'error', reason }));
    server.close(4004, reason);
    return new Response(null, { status: 101, webSocket: client });
  }

  async fetch(req) {
    const url = new URL(req.url);
    const role = url.searchParams.get('role');
    const saved = await this.ctx.storage.get('token');

    if (role === 'host') {
      const token = url.searchParams.get('token');
      // 新房間：代碼不能正在使用；接回：要拿得出當初的通行碼
      if (token ? token !== saved : saved) return this.refuse('taken');
      const newToken = saved || randId(24);
      for (const old of this.sockets('host')) { try { old.close(4000, 'replaced'); } catch (e) { /* ignore */ } }
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server, ['host']);
      server.serializeAttachment({ host: true });
      await this.ctx.storage.put('token', newToken);
      await this.ctx.storage.deleteAlarm();
      server.send(JSON.stringify({ sys: 'welcome', token: newToken, clients: this.clientIds() }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (!saved || !this.host()) return this.refuse('noroom');
    if (this.sockets('c').length >= MAX_CLIENTS) return this.refuse('full');
    const id = randId(8);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, ['c', 'c:' + id]);
    server.serializeAttachment({ id });
    server.send(JSON.stringify({ sys: 'welcome', id }));
    this.host().send(JSON.stringify({ sys: 'open', id }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string') return;
    const att = ws.deserializeAttachment() || {};
    if (att.host) {
      let env;
      try { env = JSON.parse(data); } catch (e) { return; }
      if (!env || typeof env !== 'object') return;
      const targets = env.to === '*' ? this.sockets('c') : this.sockets('c:' + env.to);
      if (env.close) { for (const w of targets) { try { w.close(4002, 'kicked'); } catch (e) { /* ignore */ } } return; }
      const out = JSON.stringify(env.msg);
      for (const w of targets) { try { w.send(out); } catch (e) { /* ignore */ } }
      return;
    }
    // 加入者 → 房主：確認是合法 JSON 後包上寄件者 id
    try { JSON.parse(data); } catch (e) { return; }
    const host = this.host();
    if (host) { try { host.send(`{"sys":"data","id":"${att.id}","msg":${data}}`); } catch (e) { /* ignore */ } }
  }

  async webSocketClose(ws, code, reason) {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, reason); } catch (e) { /* already closed */ }
    await this.gone(ws);
  }

  async webSocketError(ws) {
    await this.gone(ws);
  }

  async gone(ws) {
    const att = ws.deserializeAttachment() || {};
    if (att.host) {
      if (!this.host(ws)) await this.ctx.storage.setAlarm(Date.now() + HOST_GRACE_MS);
      return;
    }
    if (!att.id) return;
    const host = this.host();
    if (host) { try { host.send(JSON.stringify({ sys: 'close', id: att.id })); } catch (e) { /* ignore */ } }
  }

  async alarm() {
    if (this.host()) return;
    for (const w of this.ctx.getWebSockets()) { try { w.close(4001, 'room closed'); } catch (e) { /* ignore */ } }
    await this.ctx.storage.deleteAll();
  }
}
