'use strict';
/* 寶島鐵道大亨 — 線上對戰（房間代碼 + PeerJS / WebRTC）
 * 房主的瀏覽器執行整個遊戲；加入者只負責顯示畫面、回答自己的操作。
 */
const ROOM_PREFIX = 'formosa-rail-tycoon-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_HUMANS = 4;

const genCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const netError = msg => { $('#netErr').textContent = msg || ''; };
const myName = () => cleanName($('#myName').value) || '玩家';

function switchTab(mode) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  $('#localPane').classList.toggle('hidden', mode !== 'local');
  $('#onlinePane').classList.toggle('hidden', mode !== 'online');
}

function lockNetForm(locked) {
  $('#btnHost').disabled = locked;
  $('#btnJoin').disabled = locked;
  $('#myName').disabled = locked;
  $('#joinCode').disabled = locked;
  document.querySelectorAll('.tab').forEach(b => { b.disabled = locked; });
}

/* ================= 房主 ================= */
function hostRoom() {
  if (typeof Peer === 'undefined') { netError('連線元件載入失敗，請確認網路後重新整理頁面'); return; }
  netError('');
  lockNetForm(true);
  $('#lobby').innerHTML = '<p class="hint">建立房間中…</p>';
  const name = myName();
  const tryOpen = attempt => {
    const code = genCode();
    const peer = new Peer(ROOM_PREFIX + code, { debug: 1 });
    peer.on('open', () => {
      NET.peer = peer;
      NET.mode = 'host';
      NET.code = code;
      NET.lobby = [{ peer: null, name }];
      $('#netForm').classList.add('hidden');
      renderHostLobby();
    });
    peer.on('connection', setupHostConn);
    if (!NET.hbTimer) NET.hbTimer = setInterval(hostHeartbeat, HEARTBEAT_MS);
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
    peer.on('error', err => {
      if (err.type === 'unavailable-id' && attempt < 5) { peer.destroy(); tryOpen(attempt + 1); return; }
      if (NET.mode === 'host' && S) { toast('⚠️ 連線伺服器不穩：' + err.type, 'bad'); return; }
      if (NET.mode !== 'host') { netError('建立房間失敗（' + err.type + '），請稍後再試'); lockNetForm(false); $('#lobby').innerHTML = ''; }
    });
  };
  tryOpen(0);
}

function setupHostConn(conn) {
  conn._lastSeen = Date.now();
  conn.on('data', msg => {
    conn._lastSeen = Date.now();
    if (conn._away) { conn._away = false; restoreOnline(conn); }
    hostHandle(conn, msg);
  });
  conn.on('close', () => hostConnClosed(conn));
  conn.on('error', () => hostConnClosed(conn));
}

/* 心跳：WebRTC 斷線常常不會觸發 close，所以每 3 秒 ping 一次。
 * 20 秒沒回應就先由電腦代打；之後又收到訊息就自動交還。 */
const HEARTBEAT_MS = 3000, AWAY_MS = 20000;
function hostHeartbeat() {
  if (NET.mode !== 'host') return;
  const now = Date.now();
  for (const conn of [...NET.conns.values()]) {
    try { if (conn.open) conn.send({ t: 'ping' }); } catch (e) { /* ignore */ }
    if (!conn._away && now - conn._lastSeen > AWAY_MS) {
      conn._away = true;
      if (S) markOffline(conn.peer);
      else { NET.conns.delete(conn.peer); NET.lobby = NET.lobby.filter(l => l.peer !== conn.peer); renderHostLobby(); try { conn.close(); } catch (e) { /* ignore */ } }
    }
  }
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

function uniqueName(name) {
  const taken = new Set((S ? S.players : NET.lobby).map(x => x.name));
  if (!taken.has(name)) return name;
  for (let k = 2; k < 10; k++) { const n = name.slice(0, 5) + k; if (!taken.has(n)) return n; }
  return name;
}

function hostHandle(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'hello') {
    const name = cleanName(msg.name) || '玩家';
    if (S) {
      // 遊戲進行中：同名的離線玩家可以重新連線
      const i = S.players.findIndex(p => p.offline && p.name === name);
      if (i < 0 || S.over) { conn.send({ t: 'reject', reason: '遊戲已經開始了，無法加入' }); setTimeout(() => conn.close(), 800); return; }
      const p = S.players[i];
      if (p.awayPeer) NET.conns.delete(p.awayPeer);
      p.cpu = false; p.offline = false; p.peer = conn.peer; delete p.awayPeer;
      NET.conns.set(conn.peer, conn);
      conn.send({ t: 'start' });
      log(`🔌 ${p.name} 重新連線了`, 'good');
      toastAll(`🔌 ${p.name} 重新連線了`, 'good');
      render();
      return;
    }
    if (NET.lobby.length >= MAX_HUMANS) { conn.send({ t: 'reject', reason: '房間已滿（最多 4 人）' }); setTimeout(() => conn.close(), 800); return; }
    NET.conns.set(conn.peer, conn);
    NET.lobby.push({ peer: conn.peer, name: uniqueName(name) });
    renderHostLobby();
    return;
  }
  if (msg.t === 'answer') {
    const pd = NET.pending.get(msg.id);
    if (!pd || !S || S.players[pd.i].peer !== conn.peer) return;
    NET.pending.delete(msg.id);
    pd.res(msg.value);
  }
}

function hostConnClosed(conn) {
  if (NET.conns.get(conn.peer) !== conn) return;
  NET.conns.delete(conn.peer);
  if (!S) {
    NET.lobby = NET.lobby.filter(l => l.peer !== conn.peer);
    renderHostLobby();
    return;
  }
  markOffline(conn.peer);
}

function lobbyListHTML(list, meIdx) {
  return `<div class="lobbyList">${list.map((l, k) => `
    <div class="prow"><span class="chip" style="background:${COLORS[k]}">${k + 1}</span>
      <span>${l.name}${k === 0 ? ' <small class="hint">房主</small>' : ''}${k === meIdx ? ' <small class="you">你</small>' : ''}</span></div>`).join('')}</div>`;
}

function renderHostLobby() {
  const years = $('#lYears') ? $('#lYears').value : '3';
  const fill = $('#lFill') ? $('#lFill').value : '0';
  const link = location.origin + location.pathname + '?room=' + NET.code;
  $('#lobby').innerHTML = `
    <div class="room">
      <div class="hint">房間代碼</div>
      <div class="code">${NET.code}</div>
      <div class="share"><input type="text" readonly id="shareLink" value="${link}"><button class="btn sm" id="btnCopy" type="button">複製連結</button></div>
      <p class="hint">把代碼或連結傳給朋友，他們打開後輸入名字就能加入。開始前請保持這個頁面開著。</p>
    </div>
    <h4>玩家（${NET.lobby.length}/${MAX_HUMANS}）</h4>
    ${lobbyListHTML(NET.lobby, 0)}
    <div class="opts">
      <label>遊戲年數
        <select id="lYears">${[1, 3, 5, 10, 20].map(y => `<option value="${y}" ${String(y) === years ? 'selected' : ''}>${y} 年${y === 1 ? '（試玩）' : ''}</option>`).join('')}</select>
      </label>
      <label>電腦玩家
        <select id="lFill">${[['0', '不加'], ['3', '補到 3 人'], ['4', '補到 4 人']].map(([v, t]) => `<option value="${v}" ${v === fill ? 'selected' : ''}>${t}</option>`).join('')}</select>
      </label>
    </div>
    <div class="btns"><button class="btn primary" id="btnLStart" type="button">開始遊戲</button></div>
    <p class="hint" id="startHint"></p>`;
  const check = () => {
    const total = Math.max(NET.lobby.length, +$('#lFill').value);
    $('#btnLStart').disabled = total < 2;
    $('#startHint').textContent = total < 2 ? '至少需要 2 位玩家：等朋友加入，或加入電腦玩家' : '';
  };
  $('#lFill').onchange = check;
  check();
  $('#btnCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(link); toast('已複製邀請連結', 'good'); }
    catch (e) { $('#shareLink').select(); toast('請長按連結手動複製'); }
  };
  $('#btnLStart').onclick = hostStart;
  netSend({ t: 'lobby', code: NET.code, list: NET.lobby.map(l => ({ name: l.name, peer: l.peer })) });
}

function hostStart() {
  const fill = +$('#lFill').value;
  const players = NET.lobby.map((l, k) => ({ name: l.name, cpu: false, slot: k, peer: l.peer }));
  const cpuNames = CPU_NAMES.filter(n => !players.some(p => p.name === n));
  while (players.length < fill) players.push({ name: cpuNames.shift() || '電腦' + (players.length + 1), cpu: true, slot: players.length });
  if (players.length < 2) return;
  newGame({ players, years: +$('#lYears').value, speed: 'normal' });
  netSend({ t: 'start' });
  $('#setup').classList.add('hidden');
  gameLoop();
}

/* ================= 加入者 ================= */
function joinRoom() {
  if (typeof Peer === 'undefined') { netError('連線元件載入失敗，請確認網路後重新整理頁面'); return; }
  const code = $('#joinCode').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) { netError('請輸入 4 碼房間代碼'); return; }
  netError('');
  lockNetForm(true);
  $('#lobby').innerHTML = '<p class="hint">連線中…</p>';
  const name = myName();
  const peer = new Peer({ debug: 1 });
  NET.peer = peer;
  const fail = msg => { netError(msg); lockNetForm(false); $('#lobby').innerHTML = ''; NET.mode = 'local'; try { peer.destroy(); } catch (e) { /* ignore */ } };
  const timer = setTimeout(() => { if (!NET.joined) fail('連線逾時：找不到房間，或網路無法建立連線'); }, 15000);
  peer.on('open', id => {
    NET.myId = id;
    NET.mode = 'client';
    const conn = peer.connect(ROOM_PREFIX + code, { reliable: true, serialization: 'json' });
    NET.hostConn = conn;
    const lost = () => {
      if (NET.ended || NET.rejected || NET.lostShown) return;
      NET.lostShown = true;
      modal('<h3>📴 與房主的連線中斷了</h3><p>房主可能關閉了遊戲，或網路不穩。重新整理後用同樣的名字加入，就能接回原本的位置。</p>',
        [{ label: '重新整理', value: 1, cls: 'primary' }]).then(() => location.reload());
    };
    conn.on('open', () => {
      NET.joined = true;
      clearTimeout(timer);
      NET.lastSeen = Date.now();
      conn.send({ t: 'hello', name });
      setInterval(() => { if (Date.now() - NET.lastSeen > AWAY_MS + 10000) lost(); }, HEARTBEAT_MS);
    });
    conn.on('data', msg => { NET.lastSeen = Date.now(); clientHandle(msg); });
    conn.on('close', lost);
  });
  peer.on('error', err => {
    if (NET.joined) { toast('⚠️ 連線不穩：' + err.type, 'bad'); return; }
    clearTimeout(timer);
    fail(err.type === 'peer-unavailable' ? '找不到這個房間，請確認代碼是否正確' : '連線失敗（' + err.type + '）');
  });
}

function clientHandle(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'lobby': {
      $('#netForm').classList.add('hidden');
      const me = msg.list.findIndex(l => l.peer === NET.myId);
      $('#lobby').innerHTML = `<div class="room"><div class="hint">房間代碼</div><div class="code">${msg.code}</div></div>
        <h4>玩家（${msg.list.length}/${MAX_HUMANS}）</h4>${lobbyListHTML(msg.list, me)}
        <p class="hint">✅ 已加入房間，等待房主開始遊戲…</p>`;
      break;
    }
    case 'reject':
      NET.rejected = true;
      netError(msg.reason);
      lockNetForm(false);
      $('#lobby').innerHTML = '';
      NET.mode = 'local';
      break;
    case 'start':
      $('#setup').classList.add('hidden');
      break;
    case 'state': {
      const first = !S;
      S = msg.S;
      if (first) { $('#setup').classList.add('hidden'); applyZoom(); setStatusLocal('等待中…'); }
      render();
      if (S.turn !== NET.lastTurn) { NET.lastTurn = S.turn; focusNode(S.players[S.turn].pos, !first); }
      break;
    }
    case 'pos':
      if (!S) break;
      // 自己剛用箭頭走過了，不用再看一次重播
      if (NET.justStepped && S.players[msg.mover] && S.players[msg.mover].peer === NET.myId) break;
      msg.pos.forEach((n, k) => { S.players[k].pos = n; });
      S.curse = msg.curse;
      renderTokens();
      if (zoom > 1.05) focusNode(msg.pos[msg.mover]);
      break;
    case 'banner':
      NET.justStepped = false;
      bannerLocal(msg.html, msg.color);
      if (S) focusNode(S.players[S.turn].pos, true);
      break;
    case 'dice':
      diceResultLocal(msg.vals);
      break;
    case 'roulette':
      rouletteLocal(msg.name);
      break;
    case 'msg':
      messageLocal(msg.title, msg.body, msg.auto);
      break;
    case 'float':
      floatLocal(msg.node, msg.text, msg.color);
      break;
    case 'status':
      if (!NET.answering) setStatusLocal(msg.html);
      break;
    case 'toast':
      toast(msg.msg, msg.kind);
      break;
    case 'show':
      modal(msg.html, [{ label: '確定', value: true, cls: 'primary' }], { auto: msg.auto });
      break;
    case 'ping':
      try { NET.hostConn.send({ t: 'pong' }); } catch (e) { /* ignore */ }
      break;
    case 'ask':
      if (!S) break;
      NET.answering = true;
      NET.curAsk = msg.id;
      if (msg.kind === 'menu') {
        if (navigator.vibrate) { try { navigator.vibrate(120); } catch (e) { /* ignore */ } }
        toast('🔔 輪到你了！', 'good');
      }
      localAsk(msg.kind, msg.data).then(value => {
        if (NET.curAsk !== msg.id) return;
        NET.answering = false;
        NET.curAsk = null;
        try { NET.hostConn.send({ t: 'answer', id: msg.id, value }); } catch (e) { /* ignore */ }
        setStatusLocal('已送出，等待中…');
      });
      break;
    case 'cancel':
      if (NET.curAsk !== msg.id) break;
      NET.curAsk = null;
      NET.answering = false;
      $('#modal').classList.add('hidden');
      $('#lyHL').innerHTML = '';
      setStatusLocal('剛才連線中斷，這一步由電腦代打了');
      break;
    case 'end':
      NET.ended = true;
      modal(msg.html, [{ label: '回到標題', value: 1, cls: 'primary' }, { label: '看看地圖', value: 0 }])
        .then(v => { if (v) location.href = location.pathname; });
      break;
  }
}

/* ================= 初始化 ================= */
function netInit() {
  document.querySelectorAll('.tab').forEach(b => { b.onclick = () => switchTab(b.dataset.mode); });
  $('#btnHost').onclick = hostRoom;
  $('#btnJoin').onclick = joinRoom;
  $('#joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
  try { const n = localStorage.getItem('formosa-rail-tycoon-name'); if (n) $('#myName').value = n; } catch (e) { /* ignore */ }
  $('#myName').addEventListener('change', () => { try { localStorage.setItem('formosa-rail-tycoon-name', myName()); } catch (e) { /* ignore */ } });
  const room = new URLSearchParams(location.search).get('room');
  if (room) {
    switchTab('online');
    $('#joinCode').value = room.toUpperCase().slice(0, 4);
  }
  window.addEventListener('beforeunload', e => {
    if (NET.mode === 'host' && S && !S.over) { e.preventDefault(); e.returnValue = ''; }
  });
}
