'use strict';
/* 寶島鐵道大亨 — 線上對戰（瀏覽器端）
 * 遊戲在 Cloudflare 的伺服器上執行（worker/index.js + server/room.js，用的是同一份 game.js）。
 * 每位玩家的瀏覽器都只負責顯示畫面、回答自己的操作；誰離開都不會讓遊戲中斷。
 */
const ROOM_SERVER = 'https://formosa-rail-tycoon.formosa-rail-tycoon.workers.dev';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_HUMANS = 4, HEARTBEAT_MS = 3000, AWAY_MS = 20000;

/* 從 Cloudflare 本身開啟時用同一個網址；從 GitHub Pages、Android App 開啟時連到 ROOM_SERVER */
const onServer = () => location.protocol.startsWith('http') && (location.hostname.endsWith('.workers.dev') || location.port === '8787');
function roomURL(code, params) {
  const base = new URL(onServer() ? location.origin : ROOM_SERVER);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = '/room/' + code;
  for (const [k, v] of Object.entries(params || {})) if (v) base.searchParams.set(k, v);
  return base.href;
}
const wsSend = (ws, obj) => { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ } } };
const backoff = n => Math.min(1000 * 2 ** n, 5000);

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
  $('#btnHome').classList.toggle('hidden', locked); // 已在房間裡就不能回首頁，避免留下幽靈玩家
  document.querySelectorAll('.tab').forEach(b => { b.disabled = locked; });
}

/* ================= 建立／加入房間 ================= */
function hostRoom() { startOnline(genCode(), true); }

function joinRoom() {
  const code = $('#joinCode').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) { netError('請輸入 4 碼房間代碼'); return; }
  startOnline(code, false);
}

function startOnline(code, create) {
  netError('');
  audioInit();
  lockNetForm(true);
  $('#lobby').innerHTML = `<p class="hint">${create ? '建立房間中…' : '連線中…'}</p>`;
  NET.code = code;
  NET.myName = myName();
  NET.createTries = 0;
  NET.hostConn = { send: msg => wsSend(NET.ws, msg) };
  clientConnect({ create });
}

function clientLost(reason) {
  if (NET.ended || NET.rejected || NET.lostShown) return;
  NET.lostShown = true;
  modal(`<h3>📴 與伺服器的連線中斷了</h3><p>${reason || '網路可能不穩。重新整理後用同樣的名字加入，就能接回原本的位置。'}</p>`,
    [{ label: '重新整理', value: 1, cls: 'primary' }]).then(() => location.reload());
}

function clientConnect({ create = false, resume = false } = {}) {
  const ws = new WebSocket(roomURL(NET.code, { create: create ? '1' : '' }));
  let welcomed = false, refused = false;
  const fail = msg => { netError(msg); lockNetForm(false); $('#lobby').innerHTML = ''; NET.mode = 'local'; };
  const timer = setTimeout(() => { if (!welcomed) { try { ws.close(); } catch (e) { /* ignore */ } } }, 15000);
  ws.onmessage = e => {
    let m;
    try { m = JSON.parse(e.data); } catch (err) { return; }
    if (m.sys === 'error') {
      refused = true;
      clearTimeout(timer);
      if (m.reason === 'taken' && create && ++NET.createTries < 6) { NET.code = genCode(); clientConnect({ create: true }); return; }
      if (resume) clientLost('這個房間已經關閉了。');
      else fail(m.reason === 'noroom' ? '找不到這個房間，請確認代碼是否正確' : m.reason === 'full' ? '房間已滿' : '連線失敗，請稍後再試');
      return;
    }
    if (m.sys === 'welcome') {
      welcomed = true;
      clearTimeout(timer);
      NET.ws = ws;
      NET.myId = m.id;
      NET.mode = 'client';
      NET.joined = true;
      NET.retry = 0;
      NET.lastSeen = Date.now();
      if (resume) {
        // 斷線前的提問已經由電腦代答，關掉舊的視窗
        NET.curAsk = null; NET.answering = false;
        $('#modal').classList.add('hidden');
        if ($('#lyHL')) $('#lyHL').innerHTML = '';
        toast('🔌 已重新連線', 'good');
      }
      wsSend(ws, { t: 'hello', name: NET.myName, resume });
      if (!NET.watch) {
        // 太久沒收到伺服器的訊息（連心跳都沒有）就主動重連
        NET.watch = setInterval(() => {
          if (NET.ws && Date.now() - NET.lastSeen > AWAY_MS + 10000) { NET.lastSeen = Date.now(); try { NET.ws.close(); } catch (e) { /* ignore */ } }
        }, HEARTBEAT_MS);
      }
      return;
    }
    if (NET.ws !== ws) return;
    NET.lastSeen = Date.now();
    clientHandle(m);
  };
  ws.onclose = () => {
    clearTimeout(timer);
    if (refused || NET.ended || NET.rejected) return;
    if (!welcomed) {
      if (!NET.joined) { fail('無法連上遊戲伺服器，請確認網路後再試'); return; }
      if ((NET.retry || 0) >= 14) { clientLost(); return; } // 大約試 60 秒
    } else if (NET.ws !== ws) return;
    NET.ws = null;
    const n = NET.retry = (NET.retry || 0) + 1;
    if (n === 1) setStatusLocal('📶 連線中斷，重新連線中…');
    setTimeout(() => clientConnect({ resume: true }), backoff(n - 1));
  };
}

/* ================= 等待室 ================= */
function lobbyListHTML(list, meIdx, adminIdx) {
  return `<div class="lobbyList">${list.map((l, k) => `
    <div class="prow"><span class="chip" style="background:${COLORS[k]}">${k + 1}</span>
      <span>${l.name}${k === adminIdx ? ' <small class="hint">房主</small>' : ''}${k === meIdx ? ' <small class="you">你</small>' : ''}</span></div>`).join('')}</div>`;
}

function renderLobby(msg) {
  $('#netForm').classList.add('hidden');
  const me = msg.list.findIndex(l => l.peer === NET.myId);
  if (me >= 0) NET.myName = msg.list[me].name; // 伺服器可能幫同名的人加上編號
  const adminIdx = msg.list.findIndex(l => l.peer === msg.admin);
  const isAdmin = msg.admin === NET.myId;
  const link = (onServer() ? location.origin + '/' : ROOM_SERVER + '/') + '?room=' + msg.code;
  const fillText = { 0: '不加', 3: '補到 3 人', 4: '補到 4 人' };
  const total = Math.max(msg.list.length, msg.fill);
  $('#lobby').innerHTML = `
    <div class="room">
      <div class="hint">房間代碼</div>
      <div class="code">${msg.code}</div>
      <div class="share"><input type="text" readonly id="shareLink" value="${link}"><button class="btn sm" id="btnCopy" type="button">複製連結</button></div>
      <p class="hint">把代碼或連結傳給朋友，他們打開後輸入名字就能加入。遊戲在伺服器上進行，任何人暫時離開都不會中斷。</p>
    </div>
    <h4>玩家（${msg.list.length}/${MAX_HUMANS}）</h4>
    ${lobbyListHTML(msg.list, me, adminIdx)}
    ${isAdmin ? `
    <div class="opts">
      <label>遊戲年數
        <select id="lYears">${[1, 3, 5, 10, 20].map(y => `<option value="${y}" ${y === msg.years ? 'selected' : ''}>${y} 年${y === 1 ? '（試玩）' : ''}</option>`).join('')}</select>
      </label>
      <label>電腦玩家
        <select id="lFill">${[0, 3, 4].map(v => `<option value="${v}" ${v === msg.fill ? 'selected' : ''}>${fillText[v]}</option>`).join('')}</select>
      </label>
    </div>
    <div class="btns"><button class="btn primary" id="btnLStart" type="button" ${total < 2 ? 'disabled' : ''}>開始遊戲</button></div>
    <p class="hint">${total < 2 ? '至少需要 2 位玩家：等朋友加入，或加入電腦玩家' : ''}</p>`
    : `<p class="hint">遊戲年數：${msg.years} 年・電腦玩家：${fillText[msg.fill]}</p>
    <p class="hint">✅ 已加入房間，等待房主開始遊戲…</p>`}`;
  $('#btnCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(link); toast('已複製邀請連結', 'good'); }
    catch (e) { $('#shareLink').select(); toast('請長按連結手動複製'); }
  };
  if (isAdmin) {
    const config = () => wsSend(NET.ws, { t: 'config', years: +$('#lYears').value, fill: +$('#lFill').value });
    $('#lYears').onchange = config;
    $('#lFill').onchange = config;
    $('#btnLStart').onclick = () => { $('#btnLStart').disabled = true; wsSend(NET.ws, { t: 'start' }); };
  }
}

/* ================= 遊戲中：照伺服器的指示顯示畫面、回答操作 ================= */
function clientHandle(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'lobby':
      renderLobby(msg);
      break;
    case 'reject':
      NET.rejected = true;
      netError(msg.reason);
      lockNetForm(false);
      $('#netForm').classList.remove('hidden');
      $('#lobby').innerHTML = '';
      NET.mode = 'local';
      break;
    case 'start':
      $('#setup').classList.add('hidden');
      break;
    case 'state': {
      const first = !S;
      S = msg.S;
      { const meP = S.players.find(p => p.peer === NET.myId); if (meP) NET.myName = meP.name; }
      if (first) { $('#setup').classList.add('hidden'); applyZoom(); setStatusLocal('等待中…'); bgmStart(); }
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
      sfx('step');
      if (zoom > 1.05) focusNode(msg.pos[msg.mover]);
      break;
    case 'banner':
      NET.justStepped = false;
      bannerLocal(msg.html, msg.color, msg.snd);
      if (S) focusNode(S.players[S.turn].pos, true);
      break;
    case 'dice':
      diceResultLocal(msg.vals);
      break;
    case 'focus':
      if (S) focusNode(msg.node, true);
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
      wsSend(NET.ws, { t: 'pong' });
      break;
    case 'ask':
      if (!S || NET.curAsk === msg.id) break;
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
        wsSend(NET.ws, { t: 'answer', id: msg.id, value });
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
    // 從邀請連結進來：跳過首頁，直接到加入房間
    showSetup('online');
    $('#joinCode').value = room.toUpperCase().slice(0, 4);
  }
}
