'use strict';
/* 寶島鐵道大亨 — 遊戲引擎與介面 */

const VW = 880, VH = 1560;
const px = lon => (lon - 119.85) * 400;
const py = lat => (25.4 - lat) * 437;
const COLORS = ['#e53935', '#1e6fd9', '#2e9d4a', '#f08c00'];
const OFFS = [[-9, -9], [9, -9], [-9, 9], [9, 9]];
const SAVE_KEY = 'formosa-rail-tycoon-save-v1';
const ZOOM_KEY = 'formosa-rail-tycoon-zoom';
const TYPE_NAME = { food: '美食', agri: '農產', tour: '觀光', ind: '產業' };
const SQ_NAME = { blue: '藍色格', red: '紅色格', yellow: '卡片格', station: '車站' };
const CPU_NAMES = ['阿財', '金水', '美玉'];

const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const r10 = x => Math.round(x / 10) * 10;

function fmt(m) {
  const neg = m < 0;
  m = Math.abs(Math.round(m));
  const yi = Math.floor(m / 10000), w = m % 10000;
  let s;
  if (!yi && !w) s = '0元';
  else if (yi) s = yi + '億' + (w ? w + '萬' : '');
  else s = w + '萬';
  return (neg ? '-' : '') + s;
}

/* ================= 地圖圖形 ================= */
const G = { nodes: [], adj: [], edges: [], stationNode: {}, stationById: {}, near: [] };

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function buildGraph() {
  STATIONS.forEach(s => {
    const id = G.nodes.length;
    G.nodes.push({ id, type: 'station', sid: s.id, x: px(s.lon), y: py(s.lat) });
    G.adj.push([]);
    G.stationNode[s.id] = id;
    G.stationById[s.id] = s;
  });
  const rng = mulberry32(20261122);
  const link = (u, v, bus) => { G.adj[u].push(v); G.adj[v].push(u); G.edges.push([u, v, !!bus]); };
  LINES.forEach(([a, b, opt]) => {
    const A = G.nodes[G.stationNode[a]], B = G.nodes[G.stationNode[b]];
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    const n = Math.max(0, Math.round(len / 34) - 1);
    let prev = A.id;
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1), r = rng();
      const type = r < 0.5 ? 'blue' : r < 0.78 ? 'red' : 'yellow';
      const id = G.nodes.length;
      G.nodes.push({ id, type, x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t });
      G.adj.push([]);
      link(prev, id, opt && opt.bus);
      prev = id;
    }
    link(prev, B.id, opt && opt.bus);
  });
  // 每一格最近的車站（顯示用）
  G.near = G.nodes.map(n => n.type === 'station' ? n.sid : null);
  const q = G.nodes.filter(n => n.type === 'station').map(n => n.id);
  while (q.length) {
    const u = q.shift();
    for (const v of G.adj[u]) if (!G.near[v]) { G.near[v] = G.near[u]; q.push(v); }
  }
}

const distCache = new Map();
function distFrom(src) {
  if (distCache.has(src)) return distCache.get(src);
  const d = new Array(G.nodes.length).fill(Infinity);
  d[src] = 0;
  const q = [src];
  while (q.length) {
    const u = q.shift();
    for (const v of G.adj[u]) if (d[v] === Infinity) { d[v] = d[u] + 1; q.push(v); }
  }
  distCache.set(src, d);
  return d;
}
const dist = (a, b) => distFrom(a)[b];

/* 擲出 steps 步後可停的位置：不能立刻折返（死路除外），經過目的地就停下 */
function reachable(start, steps) {
  let frontier = [{ node: start, prev: -1, path: [start] }];
  const res = new Map();
  for (let k = 1; k <= steps; k++) {
    const next = new Map();
    for (const st of frontier) {
      let opts = G.adj[st.node].filter(n => n !== st.prev);
      if (!opts.length) opts = G.adj[st.node];
      for (const n of opts) {
        const key = n + ',' + st.node;
        if (next.has(key)) continue;
        const path = [...st.path, n];
        if (n === S.goal) { if (!res.has(n)) res.set(n, path); continue; }
        next.set(key, { node: n, prev: st.node, path });
      }
    }
    frontier = [...next.values()];
  }
  for (const st of frontier) if (!res.has(st.node)) res.set(st.node, st.path);
  if (!res.size) res.set(start, [start]);
  return res;
}

function placeName(node) {
  const n = G.nodes[node];
  if (n.type === 'station') return G.stationById[n.sid].name + '站';
  return `${G.stationById[G.near[node]].name}附近的${SQ_NAME[n.type]}`;
}

/* ================= 遊戲狀態 ================= */
let S = null;
let zoom = 1.8;
let actResolve = null;

/* ---- 連線狀態（net.js 負責建立連線） ----
 * mode: local 同機輪流 / host 房主（執行遊戲） / client 加入者（只顯示與回答） */
const NET = { mode: 'local', peer: null, myId: null, conns: new Map(), hostConn: null, pending: new Map(), askSeq: 0, lastTurn: -1, lobby: [], answering: false, ended: false };
function netSend(msg) {
  if (NET.mode !== 'host') return;
  for (const c of NET.conns.values()) if (c.open) { try { c.send(msg); } catch (e) { /* ignore */ } }
}
function sendTo(peerId, msg) {
  const c = NET.conns.get(peerId);
  if (c && c.open) { try { c.send(msg); } catch (e) { /* ignore */ } }
}
const stateForNet = () => Object.assign({}, S, { log: S.log.slice(0, 30) });
const cleanName = s => String(s || '').replace(/[<>&"'`\\]/g, '').trim().slice(0, 6);
function isMine(i) {
  const p = S.players[i];
  if (NET.mode === 'client') return p.peer === NET.myId;
  if (NET.mode === 'host') return !p.peer && !p.cpu;
  return false;
}

const yf = () => 1 + (S.year - 1) * 0.25;
const spd = () => (S.speed === 'fast' ? 0.4 : 1);
const anyHuman = () => S.players.some(p => !p.cpu);
const stationOf = node => (G.nodes[node].sid ? G.stationById[G.nodes[node].sid] : null);

function monoOwner(sid) {
  const s = G.stationById[sid];
  const o = S.owner[sid + ':0'];
  if (o == null) return null;
  for (let k = 1; k < s.props.length; k++) if (S.owner[sid + ':' + k] !== o) return null;
  return o;
}
const ownedKeys = i => Object.keys(S.owner).filter(k => S.owner[k] === i);
function propOf(key) { const [sid, k] = key.split(':'); return G.stationById[sid].props[+k]; }
const assets = i => S.players[i].cash + ownedKeys(i).reduce((t, k) => t + propOf(k)[1], 0);

function incomeOf(i) {
  let t = 0;
  STATIONS.forEach(s => {
    const mono = monoOwner(s.id) === i;
    s.props.forEach((pr, k) => { if (S.owner[s.id + ':' + k] === i) t += pr[1] * pr[2] / 100 * (mono ? 2 : 1); });
  });
  return Math.round(t);
}

function newGame(cfg) {
  const start = G.stationNode.taipei;
  S = {
    ver: 1, year: 1, month: 4, maxYears: cfg.years, speed: cfg.speed, turn: 0, over: false,
    players: cfg.players.map((p, i) => ({
      name: p.name, cpu: p.cpu, peer: p.peer || null, color: COLORS[p.slot], cash: 10000, pos: start, cards: ['express', 'express'], skip: false,
    })),
    owner: {}, goal: null, goalBonusBase: 0,
    curse: { holder: null, level: 1, turns: 0 },
    log: [],
  };
  pickGoal(start, 20);
  log(`📅 第1年 4月，遊戲開始！大家從台北站出發`, 'month');
}

function pickGoal(fromNode, minDist) {
  const all = STATIONS.map(s => G.stationNode[s.id]).filter(n => n !== S.goal && n !== fromNode);
  const far = all.filter(n => dist(fromNode, n) >= minDist);
  const node = pick(far.length ? far : all);
  S.goalBonusBase = 2500 + dist(fromNode, node) * 120;
  S.goal = node;
  log(`🚩 新目的地：${placeName(node)}`, 'goal');
}

function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }
function loadSave() { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); return s && s.ver === 1 && !s.over ? s : null; } catch (e) { return null; } }
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }

/* ================= 繪圖 ================= */
function buildMapSVG() {
  const svg = $('#map');
  svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`);
  let h = `<rect x="0" y="0" width="${VW}" height="${VH}" class="sea"/>`;
  h += `<polygon class="land" points="${COAST.map(([lo, la]) => px(lo).toFixed(1) + ',' + py(la).toFixed(1)).join(' ')}"/>`;
  h += `<text x="60" y="1480" class="seaText">台灣海峽</text><text x="${VW - 70}" y="900" class="seaText" text-anchor="end">太平洋</text>`;
  G.edges.forEach(([u, v, bus]) => {
    const a = G.nodes[u], b = G.nodes[v];
    h += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="rail${bus ? ' bus' : ''}"/>`;
  });
  G.nodes.forEach(n => {
    if (n.type !== 'station') h += `<circle cx="${n.x}" cy="${n.y}" r="8.5" class="sq ${n.type}" data-node="${n.id}"/>`;
  });
  STATIONS.forEach(s => {
    const n = G.nodes[G.stationNode[s.id]];
    let lx = n.x, ly = n.y + 6, anchor = 'middle';
    if (s.lab === 't') ly = n.y - 19;
    else if (s.lab === 'b') ly = n.y + 40;
    else if (s.lab === 'l') { lx = n.x - 18; anchor = 'end'; }
    else { lx = n.x + 18; anchor = 'start'; }
    h += `<g class="st${s.shop ? ' shop' : ''}" data-node="${n.id}">
      <rect x="${n.x - 12}" y="${n.y - 12}" width="24" height="24" rx="5"/>
      <text x="${lx}" y="${ly}" text-anchor="${anchor}">${s.name}</text></g>`;
  });
  h += '<g id="lyOwn"></g><g id="lyGoal"></g><g id="lyHL"></g><g id="lyTok"></g>';
  svg.innerHTML = h;
}

function renderMapDyn() {
  let h = '';
  STATIONS.forEach(s => {
    const n = G.nodes[G.stationNode[s.id]];
    const k = s.props.length, mono = monoOwner(s.id);
    if (mono != null) h += `<rect x="${n.x - 8}" y="${n.y - 8}" width="16" height="16" rx="3" fill="${S.players[mono].color}"/>`;
    s.props.forEach((pr, i) => {
      const o = S.owner[s.id + ':' + i];
      const x = n.x + (i - (k - 1) / 2) * 8;
      h += `<circle cx="${x}" cy="${n.y + 19}" r="3.4" fill="${o == null ? '#c9d1d6' : S.players[o].color}" stroke="#fff" stroke-width="1"/>`;
    });
  });
  $('#lyOwn').innerHTML = h;
  const g = G.nodes[S.goal];
  $('#lyGoal').innerHTML = `<circle cx="${g.x}" cy="${g.y}" r="24" class="goalRing"/><text x="${g.x + 4}" y="${g.y - 16}" class="goalFlag">🚩</text>`;
  renderTokens();
}

function renderTokens() {
  const byNode = {};
  S.players.forEach((p, i) => (byNode[p.pos] = byNode[p.pos] || []).push(i));
  let h = '';
  for (const node of Object.keys(byNode)) {
    const arr = byNode[node], n = G.nodes[node];
    arr.forEach((i, k) => {
      const off = arr.length > 1 ? OFFS[k] : [0, 0];
      const p = S.players[i], x = n.x + off[0], y = n.y + off[1];
      h += `<g class="tok${i === S.turn ? ' cur' : ''}"><circle cx="${x}" cy="${y}" r="11" fill="${p.color}"/><text x="${x}" y="${y + 4.5}">${i + 1}</text></g>`;
      if (S.curse.holder === i) h += `<text x="${x + 6}" y="${y - 11}" class="curseIco">${S.curse.level > 1 ? '⛈️' : '🌧️'}</text>`;
    });
  }
  $('#lyTok').innerHTML = h;
}

function renderTop() {
  $('#date').textContent = `第${S.year}年 ${S.month}月`;
  $('#remain').textContent = `／共${S.maxYears}年`;
  $('#goalInfo').innerHTML = `🚩 目的地 <b>${placeName(S.goal)}</b> <span class="bonus">獎金約 ${fmt(r10(S.goalBonusBase * yf()))}</span>`;
}

function renderPlayers() {
  $('#players').innerHTML = S.players.map((p, i) => `
    <div class="pl${i === S.turn ? ' cur' : ''}" data-p="${i}">
      <span class="chip" style="background:${p.color}">${i + 1}</span>
      <div class="pinfo">
        <div class="pname">${p.name}${isMine(i) ? ' <small class="you">你</small>' : ''}${p.peer && !isMine(i) ? ' <small class="cpu">🌐</small>' : ''}${p.offline ? ' <small class="skip">離線・電腦代打</small>' : p.cpu ? ' <small class="cpu">電腦</small>' : ''}${S.curse.holder === i ? (S.curse.level > 1 ? ' ⛈️' : ' 🌧️') : ''}${p.skip ? ' <small class="skip">停駛</small>' : ''}</div>
        <div class="pstat">現金 <b class="${p.cash < 0 ? 'neg' : ''}">${fmt(p.cash)}</b> · 總資產 ${fmt(assets(i))}</div>
        <div class="pstat">🃏 ${p.cards.length} 張 · 距目的地 ${dist(p.pos, S.goal)} 格</div>
      </div>
    </div>`).join('');
}

function renderLog() {
  $('#log').innerHTML = S.log.map(l => `<div class="lg ${l.c || ''}">${l.m}</div>`).join('');
}

function render() {
  renderTop(); renderPlayers(); renderMapDyn(); renderLog();
  netSend({ t: 'state', S: stateForNet() });
}

function log(m, c) {
  S.log.unshift({ m, c });
  if (S.log.length > 80) S.log.length = 80;
  if ($('#log')) renderLog();
}

/* ---- 縮放 ---- */
function applyZoom() {
  const w = $('#mapWrap');
  const fitW = Math.min(w.clientWidth, w.clientHeight * VW / VH);
  const W = Math.max(100, fitW * zoom);
  const svg = $('#map');
  svg.style.width = W + 'px';
  svg.style.height = (W * VH / VW) + 'px';
}
function focusNode(node, smooth) {
  const w = $('#mapWrap'), svg = $('#map');
  const sc = parseFloat(svg.style.width) / VW;
  const n = G.nodes[node];
  const offX = Math.max(0, (w.clientWidth - parseFloat(svg.style.width)) / 2);
  w.scrollTo({ left: n.x * sc + offX - w.clientWidth / 2, top: n.y * sc - w.clientHeight / 2, behavior: smooth ? 'smooth' : 'auto' });
}
function setZoom(z, node) {
  zoom = Math.min(5, Math.max(1, z));
  try { localStorage.setItem(ZOOM_KEY, String(zoom)); } catch (e) { /* ignore */ }
  applyZoom();
  if (S) focusNode(node != null ? node : S.players[S.turn].pos);
}

/* ================= UI 元件 ================= */
function setStatusLocal(html) { actResolve = null; $('#actions').innerHTML = `<div class="prompt">${html}</div>`; }
function setStatus(html) { setStatusLocal(html); netSend({ t: 'status', html }); }

function setActions(html, buttons) {
  return new Promise(res => {
    actResolve = v => { actResolve = null; $('#lyHL').innerHTML = ''; res(v); };
    let h = `<div class="prompt">${html}</div><div class="btns">`;
    buttons.forEach((b, k) => { h += `<button class="btn ${b.cls || ''}" data-k="${k}" ${b.disabled ? 'disabled' : ''}>${b.label}</button>`; });
    $('#actions').innerHTML = h + '</div>';
    $('#actions').querySelectorAll('button').forEach(el => {
      el.onclick = () => actResolve && actResolve(buttons[+el.dataset.k].value);
    });
  });
}

let modalSeq = 0;
function modal(html, buttons = [{ label: '確定', value: true, cls: 'primary' }], opts = {}) {
  return new Promise(res => {
    const m = $('#modal'), box = m.querySelector('.box');
    let h = html + '<div class="btns">';
    buttons.forEach((b, k) => { h += `<button class="btn ${b.cls || ''}" data-k="${k}" ${b.disabled ? 'disabled' : ''}>${b.label}</button>`; });
    box.innerHTML = h + '</div>';
    m.classList.remove('hidden');
    const seq = ++modalSeq;
    let timer = null;
    // 只關掉自己這個視窗：若已被新的視窗取代，就不要把新的關掉
    const close = v => { clearTimeout(timer); if (seq === modalSeq) m.classList.add('hidden'); res(v); };
    box.querySelectorAll('.btns:last-child > button').forEach(el => { el.onclick = () => close(buttons[+el.dataset.k].value); });
    if (opts.auto) timer = setTimeout(() => close(buttons[0].value), opts.auto);
  });
}

/* 所有裝置一起顯示的視窗。線上模式一律自動關閉，避免卡住別人 */
function showAll(html, autoMs) {
  netSend({ t: 'show', html, auto: autoMs || 3000 });
  return modal(html, [{ label: '確定', value: true, cls: 'primary' }], autoMs ? { auto: autoMs } : {});
}

function announce(title, body, auto) {
  const a = auto || !anyHuman() || NET.mode === 'host';
  return showAll(`<h3>${title}</h3><div class="body">${body}</div>`, a ? 1800 * spd() + (NET.mode === 'host' ? 900 : 400) : 0);
}

function toastAll(msg, kind) { toast(msg, kind); netSend({ t: 'toast', msg, kind }); }

function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.innerHTML = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), 2200);
  setTimeout(() => el.remove(), 2600);
}

async function note(i, msg, kind) {
  log(msg, kind);
  toastAll(msg, kind);
  renderPlayers();
  netSend({ t: 'state', S: stateForNet() });
  await sleep(S.players[i].cpu ? 750 * spd() : 700);
}

function diceHTML(vals) { return `<div class="dice">${vals.map(v => `<span class="die">${v}</span>`).join('')}</div>`; }

/* ================= 回合流程 ================= */
async function gameLoop() {
  render();
  setZoom(zoom);
  while (!S.over) {
    save();
    await playTurn(S.turn);
    if (S.over) return;
    S.turn++;
    if (S.turn >= S.players.length) {
      S.turn = 0;
      await endMonth();
    }
  }
}

async function playTurn(i) {
  const p = S.players[i];
  render();
  focusNode(p.pos, true);
  log(`▶ ${p.name} 的回合`, 'turn');
  if (p.skip) {
    p.skip = false;
    setStatus(`<b style="color:${p.color}">${p.name}</b> 停駛中…`);
    await note(i, `${p.name} 停駛中，這回合無法前進`, 'bad');
    await sleep(500);
    return;
  }
  const act = p.cpu ? await cpuPreRoll(i) : await humanPreRoll(i);
  render();
  if (act.type === 'warp') {
    p.pos = act.node;
    render();
    focusNode(p.pos, true);
    await note(i, `✨ ${p.name} 瞬間移動到了 ${placeName(act.node)}`, 'good');
  } else {
    const total = await rollDice(act.dice, p.cpu);
    const ends = reachable(p.pos, total);
    const target = p.cpu ? cpuChooseEnd(i, ends) : await humanChooseEnd(i, ends);
    await moveAlong(i, ends.get(target));
  }
  await landOn(i);
  if (S.over) return;
  await curseTurn(i);
  render();
}

async function rollDice(n, cpu) {
  let vals = [];
  for (let f = 0; f < 10; f++) {
    vals = Array.from({ length: n }, () => rint(1, 6));
    setStatus(diceHTML(vals));
    await sleep(55);
  }
  const sum = vals.reduce((a, b) => a + b, 0);
  setStatus(diceHTML(vals) + `<div class="sum">前進 <b>${sum}</b> 步</div>`);
  log(`🎲 ${S.players[S.turn].name} 擲出 ${vals.join('+')}${n > 1 ? ' = ' + sum : ''}`);
  await sleep(cpu ? 550 * spd() : 600);
  return sum;
}

async function moveAlong(i, path) {
  const p = S.players[i];
  let transferred = false;
  const step = p.cpu ? 120 * spd() : 150;
  for (let k = 1; k < path.length; k++) {
    p.pos = path[k];
    renderTokens();
    netSend({ t: 'pos', pos: S.players.map(q => q.pos), curse: S.curse, mover: i });
    if (zoom > 1.05) focusNode(p.pos);
    if (S.curse.holder === i && !transferred) {
      const j = S.players.findIndex((q, jj) => jj !== i && q.pos === p.pos);
      if (j >= 0) {
        transferred = true;
        S.curse.holder = j;
        S.curse.turns = 0;
        render();
        log(`💨 ${p.name} 擦身而過，把衰尾道人甩給了 ${S.players[j].name}！`, 'good');
        toastAll(`💨 ${p.name} 把衰尾道人甩給了 ${S.players[j].name}！`, 'good');
        await sleep(900);
      }
    }
    await sleep(step);
  }
}

async function landOn(i) {
  const p = S.players[i], n = G.nodes[p.pos];
  if (p.pos === S.goal) await reachGoal(i);
  if (n.type === 'blue') {
    const g = r10(rint(300, 1500) * yf());
    p.cash += g;
    await note(i, `🔵 ${p.name} 停在藍色格，獲得 ${fmt(g)}`, 'good');
  } else if (n.type === 'red') {
    const l = r10(rint(200, 1200) * yf());
    p.cash -= l;
    await note(i, `🔴 ${p.name} 停在紅色格，損失 ${fmt(l)}`, 'bad');
  } else if (n.type === 'yellow') {
    const k = drawCard();
    if (p.cards.length >= 8) await note(i, `🟡 ${p.name} 抽到「${CARDS[k].name}」，但手牌已滿只好丟掉`);
    else { p.cards.push(k); await note(i, `🟡 ${p.name} 抽到了「${CARDS[k].name}」`, 'good'); }
  } else if (n.type === 'station') {
    await stationVisit(i);
  }
}

function drawCard() {
  const total = Object.values(DRAW_WEIGHTS).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [k, w] of Object.entries(DRAW_WEIGHTS)) { r -= w; if (r < 0) return k; }
  return 'express';
}

async function reachGoal(i) {
  const p = S.players[i];
  const bonus = r10(S.goalBonusBase * yf());
  p.cash += bonus;
  log(`🎉 ${p.name} 第一個抵達${placeName(S.goal)}，獲得獎金 ${fmt(bonus)}`, 'goal');
  render();
  await announce('🎉 抵達目的地！', `<b style="color:${p.color}">${p.name}</b> 第一個抵達 <b>${placeName(S.goal)}</b>！<br>獲得獎金 <b class="big">${fmt(bonus)}</b>`, p.cpu);
  const c = S.curse;
  if (c.holder === null || c.holder === i) {
    let far = -1, fd = -1;
    S.players.forEach((q, j) => {
      if (j === i) return;
      const d = dist(q.pos, S.goal) + Math.random() * 0.5;
      if (d > fd) { fd = d; far = j; }
    });
    if (far >= 0) {
      if (c.holder === null) c.level = 1;
      c.holder = far;
      c.turns = 0;
      render();
      log(`🌧️ 衰尾道人纏上了離目的地最遠的 ${S.players[far].name}`, 'bad');
      await announce('🌧️ 衰尾道人出現了', `離目的地最遠的 <b style="color:${S.players[far].color}">${S.players[far].name}</b> 被衰尾道人纏上了……<br><small>移動時碰到（經過或停在同一格）其他玩家，就能把它甩給對方！</small>`, p.cpu);
    }
  }
  pickGoal(S.goal, 14);
  render();
  await announce('🚩 新的目的地', `下一個目的地是 <b>${placeName(S.goal)}</b>！`, p.cpu);
}

async function curseTurn(i) {
  const c = S.curse;
  if (c.holder !== i) return;
  c.turns++;
  const p = S.players[i], y = yf();
  if (c.level === 1 && c.turns >= 5 && Math.random() < 0.3) {
    c.level = 2;
    render();
    log(`⛈️ 衰尾道人變身成大衰尾！`, 'bad');
    await announce('⛈️ 衰尾道人變身了！', `跟著 <b>${p.name}</b> 太久，衰尾道人變成了<b class="big">「大衰尾」</b>！<br>災情會變得更嚴重……`, p.cpu);
    return;
  }
  let msg;
  const keys = ownedKeys(i);
  const r = Math.random();
  if (c.level === 1) {
    if (r < 0.45) {
      const l = r10(rint(200, 900) * y);
      p.cash -= l;
      msg = pick([`衰尾道人拿你的錢去買刮刮樂，全部槓龜，花掉 ${fmt(l)}`,
        `衰尾道人在夜市狂吃，帳單 ${fmt(l)} 算你的`,
        `衰尾道人買了一台用不到的按摩椅，花掉 ${fmt(l)}`]);
    } else if (r < 0.65 && p.cards.length) {
      const k = rint(0, p.cards.length - 1);
      const lost = p.cards.splice(k, 1)[0];
      msg = `衰尾道人把你的「${CARDS[lost].name}」丟進水溝了`;
    } else if (r < 0.8 && keys.length) {
      const key = pick(keys), pr = propOf(key);
      delete S.owner[key];
      const back = Math.round(pr[1] / 2);
      p.cash += back;
      msg = `衰尾道人把你的「${pr[0]}」半價賣掉了（只拿回 ${fmt(back)}）`;
    } else {
      msg = pick(['衰尾道人在你旁邊唉聲嘆氣，這回合什麼都沒做', '衰尾道人睡著了，暫時沒事']);
    }
  } else {
    if (r < 0.45) {
      const l = r10(rint(3000, 12000) * y);
      p.cash -= l;
      msg = `大衰尾開了一家注定倒閉的公司，賠掉 <b>${fmt(l)}</b>！`;
    } else if (r < 0.75 && keys.length) {
      const sid = pick(keys).split(':')[0];
      keys.filter(k => k.startsWith(sid + ':')).forEach(k => delete S.owner[k]);
      msg = `大衰尾把你在 <b>${G.stationById[sid].name}站</b> 的物件全部送給路人了！`;
    } else if (r < 0.9 && p.cards.length) {
      p.cards = [];
      msg = '大衰尾把你的卡片全部燒掉了！';
    } else {
      msg = '大衰尾打了個大哈欠，這回合放你一馬';
    }
  }
  log(`${c.level > 1 ? '⛈️' : '🌧️'} ${p.name}：${msg.replace(/<[^>]+>/g, '')}`, 'bad');
  render();
  await announce(c.level > 1 ? '⛈️ 大衰尾作祟' : '🌧️ 衰尾道人作祟', msg, p.cpu);
}

async function endMonth() {
  if (S.month === 3) {
    await settlement();
    S.year++;
    if (S.year > S.maxYears) { await endGame(); return; }
  }
  S.month = S.month === 12 ? 1 : S.month + 1;
  log(`📅 第${S.year}年 ${S.month}月`, 'month');
  render();
  await monthEvent();
}

async function settlement() {
  const rows = S.players.map((p, i) => { const inc = incomeOf(i); p.cash += inc; return { p, i, inc, a: assets(i) }; });
  rows.sort((a, b) => b.a - a.a);
  log(`💰 第${S.year}年度決算完成`, 'month');
  render();
  const body = `<table class="tbl"><tr><th>名次</th><th>玩家</th><th>本年收益</th><th>總資產</th></tr>${rows.map((r, k) => `
    <tr><td>${k + 1}</td><td style="color:${r.p.color};font-weight:700">${r.p.name}</td><td>+${fmt(r.inc)}</td><td>${fmt(r.a)}</td></tr>`).join('')}</table>
    <p class="hint">物件收益 = 價格 × 收益率；獨佔車站的物件收益加倍。</p>`;
  await showAll(`<h3>💰 第${S.year}年度 決算</h3>${body}`, NET.mode === 'host' ? 5000 : anyHuman() ? 0 : 2500);
}

async function endGame() {
  S.over = true;
  clearSave();
  const rows = S.players.map((p, i) => ({ p, a: assets(i) })).sort((a, b) => b.a - a.a);
  const medal = ['🥇', '🥈', '🥉', '4'];
  render();
  setStatus('遊戲結束');
  const html = `<h3>🏆 遊戲結束</h3><p><b style="color:${rows[0].p.color}">${rows[0].p.name}</b> 成為寶島鐵道大亨！</p>
    <table class="tbl"><tr><th></th><th>玩家</th><th>總資產</th></tr>${rows.map((r, k) => `<tr><td>${medal[k]}</td><td style="color:${r.p.color};font-weight:700">${r.p.name}</td><td>${fmt(r.a)}</td></tr>`).join('')}</table>`;
  NET.ended = true;
  netSend({ t: 'end', html });
  const v = await modal(html, [{ label: '再玩一次', value: 'again', cls: 'primary' }, { label: '看看地圖', value: 'stay' }]);
  if (v === 'again') location.href = location.pathname;
}

const EVENTS = [
  { t: '🍜 夜市美食爆紅', type: 'food', rate: 0.2, txt: '網紅狂推台灣小吃，美食物件的老闆們賺翻了！' },
  { t: '🏖️ 國旅熱潮', type: 'tour', rate: 0.15, txt: '連假大家都出門玩，觀光物件生意興隆！' },
  { t: '🌾 農產大豐收', type: 'agri', rate: 0.25, txt: '風調雨順，農產物件大豐收！' },
  { t: '🏭 出口訂單滿載', type: 'ind', rate: 0.08, txt: '海外訂單大增，產業物件業績亮眼！' },
];

async function monthEvent() {
  if (Math.random() > 0.2) return;
  let title, body;
  const typhoonSeason = S.month >= 7 && S.month <= 10;
  if (typhoonSeason && Math.random() < 0.5) {
    title = '🌀 颱風來襲';
    const lines = [];
    S.players.forEach((p, i) => {
      let loss = 0;
      ownedKeys(i).forEach(k => {
        const s = G.stationById[k.split(':')[0]], pr = propOf(k);
        if (s.lon > 121.0 && (pr[3] === 'agri' || pr[3] === 'tour')) loss += pr[1] * 0.1;
      });
      loss = r10(loss);
      if (loss > 0) { p.cash -= loss; lines.push(`${p.name} 支付修繕費 ${fmt(loss)}`); }
    });
    body = '颱風重創東部，東部的農產與觀光物件需要修繕。<br>' + (lines.join('<br>') || '幸好大家在東部都沒有這類物件！');
  } else if (Math.random() < 0.15) {
    title = '📉 景氣低迷';
    const lines = [];
    S.players.forEach(p => { if (p.cash > 0) { const l = r10(p.cash * 0.05); p.cash -= l; lines.push(`${p.name} 損失 ${fmt(l)}`); } });
    body = '景氣不好，大家手上的現金縮水了 5%。<br>' + lines.join('<br>');
  } else {
    const ev = pick(EVENTS);
    title = ev.t;
    const lines = [];
    S.players.forEach((p, i) => {
      const g = r10(ownedKeys(i).map(propOf).filter(pr => pr[3] === ev.type).reduce((t, pr) => t + pr[1] * ev.rate, 0));
      if (g > 0) { p.cash += g; lines.push(`${p.name} 獲得 ${fmt(g)}`); }
    });
    body = ev.txt + '<br>' + (lines.join('<br>') || `可惜沒有人擁有${TYPE_NAME[ev.type]}物件……`);
  }
  log(`${title}`, 'month');
  render();
  await announce(title, body, false);
}

/* ================= 卡片 ================= */
async function applyCard(i, idx, target) {
  const p = S.players[i], key = p.cards[idx], c = CARDS[key];
  if (key === 'charm' && S.curse.holder !== i) return null;
  if (c.kind === 'stop' && (target == null || target === i || !S.players[target])) return null;
  p.cards.splice(idx, 1);
  log(`🃏 ${p.name} 使用了「${c.name}」`);
  switch (c.kind) {
    case 'move': return { type: 'roll', dice: c.dice };
    case 'warp': {
      const opts = STATIONS.map(s => G.stationNode[s.id]).filter(n => n !== p.pos);
      return { type: 'warp', node: pick(opts) };
    }
    case 'near': {
      const d = distFrom(S.goal);
      const opts = G.nodes.filter(n => d[n.id] >= 1 && d[n.id] <= 3).map(n => n.id);
      return { type: 'warp', node: pick(opts) };
    }
    case 'stop':
      S.players[target].skip = true;
      await note(i, `⛔ ${S.players[target].name} 下回合停駛！`);
      return null;
    case 'charm':
      S.curse = { holder: null, level: 1, turns: 0 };
      render();
      await note(i, `🧧 平安符發威，${p.name} 身上的衰尾道人被趕走了！`, 'good');
      return null;
    case 'red': {
      const g = r10(rint(1000, 5000) * yf());
      p.cash += g;
      await note(i, `🧧 ${p.name} 收到紅包 ${fmt(g)}`, 'good');
      return null;
    }
    case 'tax': {
      let t = -1, m = 0;
      S.players.forEach((q, j) => { if (j !== i && q.cash > m) { m = q.cash; t = j; } });
      if (t < 0) { await note(i, '查稅卡：沒有對手有現金可以查……'); return null; }
      const amt = r10(m * 0.1);
      S.players[t].cash -= amt;
      p.cash += amt;
      await note(i, `🧾 ${p.name} 向 ${S.players[t].name} 查稅，收取 ${fmt(amt)}`, 'good');
      return null;
    }
  }
  return null;
}

function chooseTarget(i) {
  const btns = S.players.map((q, j) => ({ label: `${j + 1}. ${q.name}`, value: j })).filter(b => b.value !== i);
  btns.push({ label: '取消', value: null });
  return modal('<h3>⛔ 要讓誰停駛？</h3>', btns);
}

function chooseCard(i) {
  const p = S.players[i];
  const rows = p.cards.map((k, idx) => {
    const c = CARDS[k];
    const dis = k === 'charm' && S.curse.holder !== i;
    return `<div class="cardRow"><div><b>${c.name}</b><br><small>${c.desc}</small></div>
      <button class="btn sm primary" data-use="${idx}" ${dis ? 'disabled title="沒有被衰尾道人纏上"' : ''}>使用</button></div>`;
  }).join('');
  return new Promise(res => {
    modal(`<h3>🃏 ${p.name} 的卡片</h3><div class="cards">${rows}</div>`, [{ label: '關閉', value: null }]).then(res);
    $('#modal .box').querySelectorAll('[data-use]').forEach(el => {
      el.onclick = () => { $('#modal').classList.add('hidden'); res(+el.dataset.use); };
    });
  });
}

/* ================= 玩家操作 ================= */
/* 向玩家 i 詢問一個決定：本機玩家直接顯示介面，遠端玩家透過網路詢問 */
function askFallback(kind, data) {
  if (kind === 'menu') return { type: 'roll' };
  if (kind === 'end') return data.keys[0];
  return { done: true };
}

function ask(i, kind, data) {
  const p = S.players[i];
  if (NET.mode === 'host') {
    if (p.offline) return Promise.resolve(askFallback(kind, data));
    setStatus(`等待 <b style="color:${p.color}">${p.name}</b> 操作…`);
    if (p.peer) {
      const id = ++NET.askSeq;
      return new Promise(res => {
        NET.pending.set(id, { res, i, kind, data });
        sendTo(p.peer, { t: 'ask', id, kind, data });
      });
    }
  }
  return localAsk(kind, data);
}

/* 在這台裝置上顯示操作介面，回傳玩家的一個決定 */
async function localAsk(kind, data) {
  if (kind === 'menu') return localMenu(data.i);
  if (kind === 'end') return localChooseEnd(data.keys);
  if (kind === 'station') return localStation(data.i, G.stationById[data.sid]);
  return null;
}

async function localMenu(i) {
  const p = S.players[i];
  for (;;) {
    const v = await setActions(
      `輪到 <b style="color:${p.color}">${p.name}</b>　距離目的地 <b>${dist(p.pos, S.goal)}</b> 格`,
      [{ label: '🎲 擲骰子', value: 'roll', cls: 'primary' },
        { label: `🃏 卡片（${p.cards.length}）`, value: 'cards', disabled: !p.cards.length },
        { label: '📋 我的物件', value: 'props' }]);
    if (v === 'roll') return { type: 'roll' };
    if (v === 'props') { await showProps(i); continue; }
    if (v === 'cards') {
      const idx = await chooseCard(i);
      if (idx == null) continue;
      let target = null;
      if (CARDS[p.cards[idx]].kind === 'stop') { target = await chooseTarget(i); if (target == null) continue; }
      return { type: 'card', idx, target };
    }
  }
}

function localChooseEnd(keys) {
  $('#lyHL').innerHTML = keys.map(node => { const n = G.nodes[node]; return `<circle cx="${n.x}" cy="${n.y}" r="18" class="hl" data-end="${node}"/>`; }).join('');
  const btns = keys.map(node => ({
    label: `${node === S.goal ? '🚩 ' : ''}${placeName(node)}<small>距目的地 ${dist(node, S.goal)}</small>`,
    value: node, cls: 'end ' + G.nodes[node].type,
  }));
  return setActions('要停在哪裡？點地圖上閃爍的圈圈，或按下方按鈕：', btns);
}

async function humanPreRoll(i) {
  const p = S.players[i];
  for (;;) {
    const a = await ask(i, 'menu', { i });
    if (!a || a.type !== 'card') return { type: 'roll', dice: 1 };
    const idx = +a.idx;
    if (!(idx >= 0 && idx < p.cards.length)) continue;
    const r = await applyCard(i, idx, a.target == null ? null : +a.target);
    render();
    if (r) return r;
  }
}

async function humanChooseEnd(i, ends) {
  const keys = [...ends.keys()];
  if (keys.length === 1) return keys[0];
  keys.sort((a, b) => dist(a, S.goal) - dist(b, S.goal));
  const v = await ask(i, 'end', { keys });
  $('#lyHL').innerHTML = '';
  return ends.has(+v) ? +v : keys[0];
}

async function humanStation(i, s) {
  const p = S.players[i];
  for (;;) {
    const a = await ask(i, 'station', { i, sid: s.id });
    if (!a || a.done) break;
    if (a.buy != null) {
      const k = +a.buy, pr = s.props[k];
      if (!pr || p.cash < pr[1] || S.owner[s.id + ':' + k] != null) continue;
      p.cash -= pr[1];
      S.owner[s.id + ':' + k] = i;
      log(`🏠 ${p.name} 買下 ${s.name}「${pr[0]}」`, 'buy');
      if (monoOwner(s.id) === i) { log(`★ ${p.name} 獨佔${s.name}站！`, 'good'); toastAll(`★ ${p.name} 獨佔${s.name}站！收益加倍`, 'good'); }
    } else if (a.card && SHOP_CARDS.includes(a.card) && s.shop) {
      const c = CARDS[a.card];
      if (p.cash < c.price || p.cards.length >= 8) continue;
      p.cash -= c.price;
      p.cards.push(a.card);
      log(`🃏 ${p.name} 買了「${c.name}」`);
    }
    render();
  }
}

/* 車站購買視窗：每點一次就回傳一個動作（購買物件／買卡／離開），由引擎處理後再重畫 */
function localStation(i, s) {
  return new Promise(res => {
    const m = $('#modal'), box = m.querySelector('.box'), p = S.players[i];
    const draw = () => {
      modalSeq++;
      let h = `<h3>🚉 ${s.name}站</h3><p class="cashline">你的現金：<b class="${p.cash < 0 ? 'neg' : ''}">${fmt(p.cash)}</b></p>`;
      h += '<table class="tbl props"><tr><th>物件</th><th>價格</th><th>收益率</th><th></th></tr>';
      s.props.forEach((pr, k) => {
        const o = S.owner[s.id + ':' + k];
        h += `<tr><td>${pr[0]} <small class="tag ${pr[3]}">${TYPE_NAME[pr[3]]}</small></td><td>${fmt(pr[1])}</td><td>${pr[2]}%</td><td>${o == null
          ? `<button class="btn sm primary" data-buy="${k}" ${p.cash < pr[1] ? 'disabled' : ''}>購買</button>`
          : `<span class="owner" style="color:${S.players[o].color}">${S.players[o].name}</span>`}</td></tr>`;
      });
      h += '</table>';
      const mono = monoOwner(s.id);
      h += mono != null ? `<p class="hint">★ ${S.players[mono].name} 獨佔此站，收益加倍！</p>` : '<p class="hint">買下同一站的全部物件即可「獨佔」，決算收益加倍。</p>';
      if (s.shop) {
        h += '<h4>🃏 卡片商店</h4><div class="cards">';
        SHOP_CARDS.forEach(k => {
          const c = CARDS[k];
          h += `<div class="cardRow"><div><b>${c.name}</b> <small>${fmt(c.price)}</small><br><small>${c.desc}</small></div>
            <button class="btn sm" data-card="${k}" ${p.cash < c.price || p.cards.length >= 8 ? 'disabled' : ''}>購買</button></div>`;
        });
        h += `</div><p class="hint">手牌 ${p.cards.length}/8</p>`;
      }
      h += '<div class="btns"><button class="btn primary" data-done="1">離開</button></div>';
      box.innerHTML = h;
      const lock = () => box.querySelectorAll('button').forEach(b => { b.disabled = true; });
      box.querySelectorAll('[data-buy]').forEach(el => el.onclick = () => { lock(); res({ buy: +el.dataset.buy }); });
      box.querySelectorAll('[data-card]').forEach(el => el.onclick = () => { lock(); res({ card: el.dataset.card }); });
      box.querySelector('[data-done]').onclick = () => { m.classList.add('hidden'); res({ done: true }); };
    };
    draw();
    m.classList.remove('hidden');
  });
}

async function stationVisit(i) {
  const p = S.players[i], s = stationOf(p.pos);
  if (p.cpu) { await cpuBuy(i, s); if (s.shop) await cpuShop(i); return; }
  const free = s.props.some((_, k) => S.owner[s.id + ':' + k] == null);
  if (!free && !s.shop) { await note(i, `${s.name}站的物件都已經有主人了`); return; }
  await humanStation(i, s);
}

function stationInfo(sid) {
  const s = G.stationById[sid];
  const rows = s.props.map((pr, k) => {
    const o = S.owner[s.id + ':' + k];
    return `<tr><td>${pr[0]} <small class="tag ${pr[3]}">${TYPE_NAME[pr[3]]}</small></td><td>${fmt(pr[1])}</td><td>${pr[2]}%</td><td>${o == null ? '<small>未售出</small>' : `<span class="owner" style="color:${S.players[o].color}">${S.players[o].name}</span>`}</td></tr>`;
  }).join('');
  const d = S.players.map((p, i) => `${i + 1}.${p.name} ${dist(p.pos, G.stationNode[sid])}格`).join('　');
  modal(`<h3>🚉 ${s.name}站${s.shop ? ' <small class="tag shopTag">卡片商店</small>' : ''}</h3>
    <table class="tbl props"><tr><th>物件</th><th>價格</th><th>收益率</th><th>擁有者</th></tr>${rows}</table>
    <p class="hint">距離：${d}</p>`, [{ label: '關閉', value: true }]);
}

function showProps(i) {
  const p = S.players[i];
  const by = {};
  ownedKeys(i).forEach(k => { const sid = k.split(':')[0]; (by[sid] = by[sid] || []).push(propOf(k)); });
  const body = Object.keys(by).length ? Object.entries(by).map(([sid, prs]) => `
    <div class="ownGroup"><b>${G.stationById[sid].name}站</b>${monoOwner(sid) === i ? ' <small class="tag mono">獨佔</small>' : ''}<br>
    <small>${prs.map(pr => `${pr[0]}（${fmt(pr[1])}・${pr[2]}%）`).join('、')}</small></div>`).join('') : '<p>還沒有任何物件。</p>';
  return modal(`<h3>📋 ${p.name} 的物件</h3>${body}<p class="hint">預估年收益：<b>${fmt(incomeOf(i))}</b>　卡片：${p.cards.map(k => CARDS[k].name).join('、') || '無'}</p>`, [{ label: '關閉', value: true }]);
}

/* ================= 電腦 AI ================= */
async function cpuPreRoll(i) {
  const p = S.players[i];
  setStatus(`<b style="color:${p.color}">${p.name}</b>（電腦）思考中…`);
  await sleep(450 * spd());
  const useKey = async (key, target) => { const idx = p.cards.indexOf(key); return idx >= 0 ? applyCard(i, idx, target) : null; };
  if (S.curse.holder === i && p.cards.includes('charm')) await useKey('charm');
  while (p.cards.includes('redpacket')) await useKey('redpacket');
  if (p.cards.includes('tax') && S.players.some((q, j) => j !== i && q.cash > 3000)) await useKey('tax');
  const d = dist(p.pos, S.goal);
  if (p.cards.includes('stop')) {
    let lead = -1, ld = Infinity;
    S.players.forEach((q, j) => { if (j !== i && !q.skip) { const qd = dist(q.pos, S.goal); if (qd < ld) { ld = qd; lead = j; } } });
    if (lead >= 0 && ld < d && ld <= 12) await useKey('stop', lead);
  }
  render();
  if (d > 8 && p.cards.includes('near')) return useKey('near');
  if (d > 40 && p.cards.includes('warp') && Math.random() < 0.5) return useKey('warp');
  if (d > 6) {
    if (d > 14 && p.cards.includes('hsr')) return useKey('hsr');
    if (p.cards.includes('limited')) return useKey('limited');
    if (p.cards.includes('express')) return useKey('express');
  }
  return { type: 'roll', dice: 1 };
}

function cpuChooseEnd(i, ends) {
  const cursed = S.curse.holder === i;
  let best = null, bs = Infinity;
  for (const [node, path] of ends) {
    let s = dist(node, S.goal) * 10;
    if (node === S.goal) s = -10000;
    const t = G.nodes[node].type;
    if (t === 'red') s += 6; else if (t === 'blue') s -= 3; else if (t === 'yellow') s -= 2; else if (t === 'station') s -= 2;
    if (cursed && path.slice(1).some(n => S.players.some((q, j) => j !== i && q.pos === n))) s -= 500;
    s += Math.random();
    if (s < bs) { bs = s; best = node; }
  }
  return best;
}

async function cpuBuy(i, s) {
  const p = S.players[i];
  const reserve = r10(1500 * yf());
  const cand = s.props.map((pr, k) => ({ pr, k })).filter(o => S.owner[s.id + ':' + o.k] == null).sort((a, b) => b.pr[2] - a.pr[2]);
  const bought = [];
  for (const o of cand) {
    if (p.cash - o.pr[1] >= reserve) { p.cash -= o.pr[1]; S.owner[s.id + ':' + o.k] = i; bought.push(o.pr[0]); }
  }
  if (bought.length) {
    render();
    let msg = `🏠 ${p.name} 在${s.name}站買下 ${bought.join('、')}`;
    if (monoOwner(s.id) === i) msg += `，獨佔${s.name}站！`;
    await note(i, msg, 'buy');
  }
}

async function cpuShop(i) {
  const p = S.players[i];
  const reserve = r10(1500 * yf());
  const buy = async key => { p.cash -= CARDS[key].price; p.cards.push(key); await note(i, `🃏 ${p.name} 買了「${CARDS[key].name}」`); };
  if (S.curse.holder === i && !p.cards.includes('charm') && p.cash > CARDS.charm.price + reserve) await buy('charm');
  if (p.cards.length < 4) {
    if (p.cash > CARDS.hsr.price + reserve * 4) await buy('hsr');
    else if (p.cash > CARDS.limited.price + reserve * 2) await buy('limited');
    else if (p.cash > CARDS.express.price + reserve) await buy('express');
  }
}

/* ================= 開始畫面 ================= */
const RULES = `
<h3>📖 遊戲規則</h3>
<div class="rules">
<p><b>目標：</b>遊戲年數結束時，<b>總資產（現金＋物件）最多</b>的人獲勝。每年從 4 月開始，3 月底決算。</p>
<p><b>移動：</b>輪到你時擲骰子，沿鐵路前進。不能立刻往回走（死路除外）。路線分歧時，點地圖上閃爍的圈圈選擇要停在哪。</p>
<p><b>🚩 目的地：</b>第一個抵達的人拿到大筆獎金（年份越後面越多），接著會出現新的目的地。路過目的地會自動停下。</p>
<p><b>格子：</b><span class="sw blue"></span>藍色格拿錢　<span class="sw red"></span>紅色格扣錢　<span class="sw yellow"></span>黃色格抽卡　<span class="sw st"></span>車站可購買物件（紫框車站有卡片商店）</p>
<p><b>物件與獨佔：</b>每年決算時，物件帶來「價格 × 收益率」的收入。買下同一站全部物件即可<b>獨佔</b>，收益加倍。</p>
<p><b>🌧️ 衰尾道人：</b>有人抵達目的地時，離目的地最遠的玩家會被衰尾道人纏上，每回合亂花錢、丟卡片、賤賣物件。久了還會變成更恐怖的<b>大衰尾 ⛈️</b>。移動時經過或停在其他玩家所在的格子，就能把它甩給對方！平安符可以直接趕走它。</p>
<p><b>🃏 卡片：</b>莒光號／自強號／高鐵卡可以一次擲多顆骰子；停駛卡讓對手停一回合；瞬移卡、導航卡可以傳送；紅包卡、查稅卡可以賺錢。</p>
<p><b>其他：</b>每個月有機率發生颱風、美食爆紅等事件。遊戲每回合自動存檔。</p>
</div>`;

function showSetup() {
  const saved = loadSave();
  $('#btnContinue').style.display = saved ? '' : 'none';
  if (saved) $('#btnContinue').textContent = `繼續上次（第${saved.year}年${saved.month}月）`;
  const rows = [0, 1, 2, 3].map(k => `
    <div class="prow">
      <span class="chip" style="background:${COLORS[k]}">${k + 1}</span>
      <input type="text" maxlength="6" id="pn${k}" value="${k === 0 ? '玩家' : CPU_NAMES[k - 1]}">
      <select id="pt${k}">
        <option value="human" ${k === 0 ? 'selected' : ''}>玩家</option>
        <option value="cpu" ${k > 0 ? 'selected' : ''}>電腦</option>
        <option value="off">不參加</option>
      </select>
    </div>`).join('');
  $('#pRows').innerHTML = rows;
  $('#setup').classList.remove('hidden');
}

function startFromSetup() {
  const players = [];
  for (let k = 0; k < 4; k++) {
    const t = $('#pt' + k).value;
    if (t === 'off') continue;
    const name = cleanName($('#pn' + k).value) || (t === 'cpu' ? CPU_NAMES[k - 1] || '電腦' : '玩家' + (k + 1));
    players.push({ name, cpu: t === 'cpu', slot: k });
  }
  if (players.length < 2) { $('#setupErr').textContent = '至少需要 2 位參加者'; return; }
  newGame({ players, years: +$('#years').value, speed: $('#speed').value });
  $('#setup').classList.add('hidden');
  gameLoop();
}

function init() {
  buildGraph();
  buildMapSVG();
  try { const z = parseFloat(localStorage.getItem(ZOOM_KEY)); if (z >= 1 && z <= 5) zoom = z; } catch (e) { /* ignore */ }
  window.addEventListener('resize', () => { if (S) applyZoom(); });
  $('#zoomIn').onclick = () => setZoom(zoom * 1.3);
  $('#zoomOut').onclick = () => setZoom(zoom / 1.3);
  $('#zoomFocus').onclick = () => S && focusNode(S.players[S.turn].pos, true);
  $('#goalInfo').onclick = () => { if (!S) return; if (zoom < 1.5) setZoom(2, S.goal); else focusNode(S.goal, true); };
  $('#btnRules').onclick = () => modal(RULES, [{ label: '了解', value: true, cls: 'primary' }]);
  $('#btnRules2').onclick = () => modal(RULES, [{ label: '了解', value: true, cls: 'primary' }]);
  $('#btnMenu').onclick = async () => {
    const v = await modal('<h3>選單</h3><p>遊戲每回合開始時自動存檔，回到標題後可以「繼續上次」。</p>',
      [{ label: '回到標題', value: 'title' }, { label: '取消', value: null, cls: 'primary' }]);
    if (v === 'title') location.reload();
  };
  $('#map').addEventListener('click', e => {
    const hl = e.target.closest('[data-end]');
    if (hl) { if (actResolve) actResolve(+hl.dataset.end); return; }
    const st = e.target.closest('.st');
    if (st && S && $('#modal').classList.contains('hidden')) stationInfo(G.nodes[+st.dataset.node].sid);
  });
  $('#players').addEventListener('click', e => {
    const el = e.target.closest('[data-p]');
    if (el && S && $('#modal').classList.contains('hidden')) { const i = +el.dataset.p; focusNode(S.players[i].pos, true); showProps(i); }
  });
  $('#btnStart').onclick = startFromSetup;
  $('#btnContinue').onclick = () => {
    const s = loadSave();
    if (!s) return;
    S = s;
    // 線上對戰的存檔：遠端玩家改由電腦代打
    S.players.forEach(p => { if (p.peer || p.offline) { p.peer = null; p.offline = false; p.cpu = true; } });
    $('#setup').classList.add('hidden');
    log('💾 讀取存檔，繼續遊戲', 'month');
    gameLoop();
  };
  showSetup();
  if (typeof netInit === 'function') netInit();
}

document.addEventListener('DOMContentLoaded', init);
