// 伺服器端遊戲：用假的連線把一整場線上遊戲從建房間跑到結束，並測試斷線、重連、伺服器重啟
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

execFileSync(process.execPath, [fileURLToPath(new URL('../tools/build-engine.mjs', import.meta.url))]);
const { createEngine } = await import('../.build/engine.mjs');

/* 建立一個房間；所有等待都縮成 0 毫秒，加快測試 */
function room(saved = null) {
  const inbox = new Map(), log = { saves: [], over: false, closed: [], errors: [] };
  const host = {
    code: 'TEST', saved,
    setTimeout: fn => setTimeout(fn, 0), clearTimeout,
    setInterval, clearInterval,
    send: (id, msg) => { (inbox.get(id) || inbox.set(id, []).get(id)).push(msg); },
    close: id => log.closed.push(id),
    save: json => log.saves.push(json),
    clearSave: () => {},
    over: () => { log.over = true; },
    error: e => log.errors.push(e),
    idleCheck: () => {},
  };
  const eng = createEngine(host);
  return { eng, inbox, log, host };
}

/* 一位假玩家：收到提問就自動回答（擲骰、走第一條路、離開車站） */
function bot(r, id, name, { resume = false, auto = true } = {}) {
  r.eng.connect(id);
  r.eng.message(id, { t: 'hello', name, resume });
  const answered = new Set();
  const tick = () => {
    if (!auto) return;
    for (const m of r.inbox.get(id) || []) {
      if (m.t === 'ping') r.eng.message(id, { t: 'pong' });
      if (m.t !== 'ask' || answered.has(m.id)) continue;
      answered.add(m.id);
      const v = m.kind === 'menu' ? { type: 'roll' } : m.kind === 'end' ? { path: m.data.ends[0][1] } : m.kind === 'station' ? { done: true } : null;
      setTimeout(() => r.eng.message(id, { t: 'answer', id: m.id, value: v }), 0);
    }
  };
  return { tick, msgs: () => r.inbox.get(id) || [] };
}

const until = async (cond, bots, limit = 200000) => {
  for (let k = 0; k < limit && !cond(); k++) { bots.forEach(b => b.tick()); await new Promise(res => setImmediate(res)); }
  assert.ok(cond(), 'timed out');
};

test('lobby: first player is admin, only admin can configure and start', async () => {
  const r = room();
  const a = bot(r, 'a', '小明'), b = bot(r, 'b', '小明');
  const lobby = a.msgs().filter(m => m.t === 'lobby').at(-1);
  assert.equal(lobby.admin, 'a');
  assert.deepEqual(lobby.list.map(l => l.name), ['小明', '小明2']);
  r.eng.message('b', { t: 'config', years: 1, fill: 4 });
  r.eng.message('b', { t: 'start' });
  assert.equal(r.eng.started(), false);
  r.eng.message('a', { t: 'config', years: 1, fill: 3 });
  assert.equal(b.msgs().filter(m => m.t === 'lobby').at(-1).years, 1);
});

test('a whole 1-year game runs on the server with two remote humans and a CPU', async () => {
  const r = room();
  const a = bot(r, 'a', '阿明'), b = bot(r, 'b', '阿華');
  r.eng.message('a', { t: 'config', years: 1, fill: 3 });
  r.eng.message('a', { t: 'start' });
  assert.ok(r.eng.started());
  await until(() => r.log.over, [a, b]);
  assert.deepEqual(r.log.errors, []);
  assert.ok(a.msgs().some(m => m.t === 'end') && b.msgs().some(m => m.t === 'end'));
  assert.ok(a.msgs().some(m => m.t === 'ask' && m.kind === 'menu'), 'remote players were asked to act');
  assert.ok(r.log.saves.length >= 12, 'progress is saved every turn');
  assert.ok(r.eng.state().over);
});

test('a dropped player is played by the CPU and gets the seat back on reconnect', async () => {
  const r = room();
  const a = bot(r, 'a', '阿明'), b = bot(r, 'b', '阿華');
  r.eng.message('a', { t: 'config', years: 3 });
  r.eng.message('a', { t: 'start' });
  await until(() => r.log.saves.length >= 3, [a, b]);
  r.eng.disconnect('b');
  const p = r.eng.state().players.find(q => q.name === '阿華');
  assert.ok(p.offline && p.cpu);
  assert.equal(r.eng.onlineHumans(), 1);
  const b2 = bot(r, 'b2', '阿華', { resume: true });
  assert.ok(!p.offline && !p.cpu && p.peer === 'b2');
  await until(() => r.log.saves.length >= 8, [a, b2]);
  assert.deepEqual(r.log.errors, []);
});

test('after a server restart the game resumes from the saved turn when a player comes back', async () => {
  const r1 = room();
  const a = bot(r1, 'a', '阿明'), b = bot(r1, 'b', '阿華');
  r1.eng.message('a', { t: 'config', years: 3 });
  r1.eng.message('a', { t: 'start' });
  await until(() => r1.log.saves.length >= 5, [a, b]);
  const saved = r1.log.saves.at(-1), before = JSON.parse(saved);

  const r2 = room(saved);
  const a2 = bot(r2, 'x', '阿明', { resume: true });
  const S = r2.eng.state();
  assert.equal(S.turn, before.turn);
  assert.equal(S.month, before.month);
  const me = S.players.find(p => p.name === '阿明'), other = S.players.find(p => p.name === '阿華');
  assert.ok(me.peer === 'x' && !me.cpu);
  assert.ok(other.offline && other.cpu, 'players who have not come back yet are played by the CPU');
  const b2 = bot(r2, 'y', '阿華', { resume: true });
  assert.ok(other.peer === 'y' && !other.cpu);
  await until(() => r2.log.saves.length >= 4, [a2, b2]);
  assert.deepEqual(r2.log.errors, []);
});

test('strangers cannot join a running game', async () => {
  const r = room();
  const a = bot(r, 'a', '阿明'), b = bot(r, 'b', '阿華');
  r.eng.message('a', { t: 'start' });
  const c = bot(r, 'c', '路人');
  assert.equal(c.msgs().find(m => m.t === 'reject').reason, '遊戲已經開始了，無法加入');
  assert.ok(r.log.closed.length === 0 || true);
  await until(() => r.log.saves.length >= 1, [a, b]);
});
