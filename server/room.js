/* ===== 伺服器端房間邏輯（接在 game.js 後面，可以直接使用 game.js 裡的所有東西） =====
 * 伺服器就是「房主」：執行整個遊戲，所有真人玩家都是透過網路連進來的加入者。
 * 這裡宣告的函式會取代 game.js 裡同名、只跟畫面有關的函式。 */

/* ---- 沒有畫面：顯示相關的函式都不做事，只保留需要的等待時間，讓大家的動畫對得上 ---- */
function sfx() {}
function bgmStart() {}
function bgmSetMood() {}
function renderTop() {}
function renderPlayers() {}
function renderMapDyn() {}
function renderTokens() {}
function renderLog() {}
function focusNode() {}
function focusXY() {}
function setZoom() {}
function applyZoom() {}
function setStatusLocal() {}
function bannerLocal() {}
function floatLocal() {}
function toast() {}
function diceSpinLocal() {}
async function diceResultLocal() { await sleep(1600); }
async function rouletteLocal() { await sleep(5400); }
function messageLocal(title, body, autoMs) { return sleep(autoMs || 0); }
function modal(html, buttons = [{ value: true }], opts = {}) { return sleep(opts.auto || 0).then(() => buttons[0].value); }
// 伺服器上沒有「本機玩家」：萬一問到，就照斷線代打的方式回答
function localAsk(kind, data) { return Promise.resolve(askFallback(kind, data)); }

/* ---- 存檔改存到房間的 Durable Object ---- */
function save() { host.save(JSON.stringify(S)); }
function loadSave() { return null; }
function clearSave() { host.clearSave(); }

/* ================= 房間 ================= */
buildGraph(); // 瀏覽器版由 init() 呼叫；伺服器沒有 init，這裡自己建好地圖
NET.mode = 'host';
const MAX_HUMANS = 4, AWAY_MS = 20000;
const R = { all: new Map(), lobby: [], admin: null, years: 3, fill: 0, running: false };
let savedGame = null;
try { savedGame = host.saved ? JSON.parse(host.saved) : null; } catch (e) { savedGame = null; }

function lobbyInfo() {
  return { t: 'lobby', code: host.code, list: R.lobby.map(l => ({ name: l.name, peer: l.peer })), admin: R.admin, years: R.years, fill: R.fill };
}
function sendLobby() { netSend(lobbyInfo()); }

function uniqueName(name) {
  const taken = new Set((S ? S.players : R.lobby).map(x => x.name));
  if (!taken.has(name)) return name;
  for (let k = 2; k < 10; k++) { const n = name.slice(0, 5) + k; if (!taken.has(n)) return n; }
  return name;
}

function markOffline(peerId) {
  S.players.forEach((p, i) => {
    if (p.peer !== peerId) return;
    p.peer = null; p.cpu = true; p.offline = true; p.awayPeer = peerId;
    log(`📴 ${p.name} 離線了，改由電腦代打（回來後會自動接手）`, 'bad');
    toastAll(`📴 ${p.name} 離線了，改由電腦代打`, 'bad');
    for (const [id, pd] of NET.pending) {
      if (pd.i === i) { NET.pending.delete(id); sendTo(peerId, { t: 'cancel', id }); pd.res(askFallback(pd.kind, pd.data)); }
    }
  });
  if (!S.over) render();
  host.idleCheck();
}

function restoreOnline(conn) {
  if (!S) return;
  if (!NET.conns.has(conn.peer)) NET.conns.set(conn.peer, conn);
  S.players.forEach(p => {
    if (!(p.offline && p.awayPeer === conn.peer)) return;
    p.cpu = false; p.offline = false; p.peer = conn.peer; delete p.awayPeer;
    log(`🔌 ${p.name} 回來了`, 'good');
    toastAll(`🔌 ${p.name} 回來了，換回自己操作`, 'good');
  });
  render();
}

function runLoop() {
  if (R.running) return;
  R.running = true;
  gameLoop().then(() => { R.running = false; if (S && S.over) host.over(); }, e => host.error(e));
}

/* 伺服器重新啟動（例如更新版本）後，從存檔的回合開頭接著玩；真人先算離線，連回來的人報上名字就接回 */
function resumeSaved() {
  S = savedGame;
  savedGame = null;
  S.players.forEach(p => {
    if (p.cpu && !p.offline) return; // 原本就是電腦
    p.peer = null; p.cpu = true; p.offline = true; p.awayPeer = null;
  });
  log('💾 伺服器重新連線，從這一回合的開頭繼續', 'month');
}

function handleHello(conn, msg) {
  const name = cleanName(msg.name) || '玩家';
  if (!S && savedGame && savedGame.players.some(p => p.offline || !p.cpu ? p.name === name : false)) resumeSaved();
  if (msg.resume) {
    // 自動重連：舊連線可能還沒被判定斷線，先讓它下線再接回
    if (S) {
      const old = S.players.find(p => p.peer && p.peer !== conn.peer && p.name === name);
      if (old) { const oc = NET.conns.get(old.peer); markOffline(old.peer); if (oc) { NET.conns.delete(oc.peer); host.close(oc.peer); } }
    } else {
      const old = R.lobby.find(l => l.peer !== conn.peer && l.name === name);
      if (old) { R.lobby = R.lobby.filter(l => l !== old); NET.conns.delete(old.peer); if (R.admin === old.peer) R.admin = conn.peer; host.close(old.peer); }
    }
  }
  if (S) {
    const i = S.players.findIndex(p => p.offline && p.name === name);
    if (i < 0 || S.over) { conn.send({ t: 'reject', reason: S.over ? '這場遊戲已經結束了' : '遊戲已經開始了，無法加入' }); setTimeout(() => host.close(conn.peer), 800); return; }
    const p = S.players[i];
    if (p.awayPeer) NET.conns.delete(p.awayPeer);
    p.cpu = false; p.offline = false; p.peer = conn.peer; delete p.awayPeer;
    NET.conns.set(conn.peer, conn);
    conn.send({ t: 'start' });
    log(`🔌 ${p.name} 連線了`, 'good');
    toastAll(`🔌 ${p.name} 連線了`, 'good');
    render();
    runLoop();
    return;
  }
  if (R.lobby.length >= MAX_HUMANS) { conn.send({ t: 'reject', reason: '房間已滿（最多 4 人）' }); setTimeout(() => host.close(conn.peer), 800); return; }
  NET.conns.set(conn.peer, conn);
  R.lobby.push({ peer: conn.peer, name: uniqueName(name) });
  if (!R.admin) R.admin = conn.peer;
  sendLobby();
}

function startGame() {
  const players = R.lobby.map((l, k) => ({ name: l.name, cpu: false, slot: k, peer: l.peer }));
  const cpuNames = CPU_NAMES.filter(n => !players.some(p => p.name === n));
  while (players.length < R.fill) players.push({ name: cpuNames.shift() || '電腦' + (players.length + 1), cpu: true, slot: players.length });
  if (players.length < 2) return;
  newGame({ players, years: R.years, speed: 'normal' });
  netSend({ t: 'start' });
  runLoop();
}

function handle(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'hello': handleHello(conn, msg); break;
    case 'config':
      if (S || conn.peer !== R.admin) break;
      if ([1, 3, 5, 10, 20].includes(+msg.years)) R.years = +msg.years;
      if ([0, 3, 4].includes(+msg.fill)) R.fill = +msg.fill;
      sendLobby();
      break;
    case 'start':
      if (S || conn.peer !== R.admin) break;
      startGame();
      break;
    case 'answer': {
      const pd = NET.pending.get(msg.id);
      if (!pd || !S || S.players[pd.i].peer !== conn.peer) break;
      NET.pending.delete(msg.id);
      pd.res(msg.value);
      break;
    }
  }
}

function dropConn(id) {
  const conn = R.all.get(id);
  if (!conn) return;
  R.all.delete(id);
  conn.open = false;
  if (NET.conns.get(id) !== conn) { host.idleCheck(); return; }
  NET.conns.delete(id);
  if (!S) {
    R.lobby = R.lobby.filter(l => l.peer !== id);
    if (R.admin === id) R.admin = R.lobby.length ? R.lobby[0].peer : null;
    sendLobby();
    host.idleCheck();
    return;
  }
  markOffline(id);
}

/* 每 3 秒 ping 一次；20 秒沒回應就先由電腦代打，之後又收到訊息就自動交還 */
function heartbeat() {
  const now = Date.now();
  for (const conn of [...R.all.values()]) {
    conn.send({ t: 'ping' });
    if (!conn._away && now - conn._lastSeen > AWAY_MS) {
      conn._away = true;
      if (S && NET.conns.get(conn.peer) === conn) markOffline(conn.peer);
      else { dropConn(conn.peer); host.close(conn.peer); }
    }
  }
}

const API = {
  connect(id) {
    R.all.set(id, { peer: id, open: true, _lastSeen: Date.now(), send: msg => host.send(id, msg) });
  },
  message(id, msg) {
    const conn = R.all.get(id);
    if (!conn) return;
    conn._lastSeen = Date.now();
    if (conn._away) { conn._away = false; if (S && NET.conns.get(id) === conn) restoreOnline(conn); }
    handle(conn, msg);
  },
  disconnect: dropConn,
  heartbeat,
  /* 線上的真人數：0 表示沒有人在看，房間可以先暫停 */
  onlineHumans: () => (S ? S.players.filter(p => p.peer && !p.offline).length : R.lobby.length),
  started: () => !!S,
  state: () => S,
};
