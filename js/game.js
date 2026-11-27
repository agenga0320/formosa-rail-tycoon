'use strict';
/* 寶島鐵道大亨 — 遊戲引擎與介面
 * 介面流程：全螢幕地圖 + 鏡頭跟隨 → 回合橫幅 → 指令視窗 → 擲骰（點擊停止）
 * → 用箭頭一步一步前進（顯示剩餘步數）→ 到站事件 → 訊息視窗
 */

const VW = 1160, VH = 1560;
const px = lon => (lon - 119.85) * 400 + 240;
const py = lat => (25.4 - lat) * 437;
const COLORS = ['#e53935', '#1e6fd9', '#2e9d4a', '#f08c00'];
const OFFS = [[-9, -9], [9, -9], [-9, 9], [9, 9]];
const SAVE_KEY = 'formosa-rail-tycoon-save-v1';
const ZOOM_KEY = 'formosa-rail-tycoon-zoom2';
const TYPE_NAME = { food: '美食', agri: '農產', tour: '觀光', ind: '產業' };
const SQ_NAME = { blue: '藍色格', red: '紅色格', yellow: '卡片格', station: '車站' };
const CPU_NAMES = ['阿財', '金水', '美玉'];
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
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

/* 台灣小圖示：用地圖輪廓資料畫出來（沒有台灣的 emoji） */
function twIcon(h = 18) {
  const xs = COAST.map(c => px(c[0])), ys = COAST.map(c => py(c[1]));
  const x0 = Math.min(...xs) - 20, y0 = Math.min(...ys) - 20;
  const w = Math.max(...xs) - x0 + 20, hh = Math.max(...ys) - y0 + 20;
  const pts = COAST.map(c => px(c[0]).toFixed(0) + ',' + py(c[1]).toFixed(0)).join(' ');
  return `<svg class="twIcon" viewBox="${x0.toFixed(0)} ${y0.toFixed(0)} ${w.toFixed(0)} ${hh.toFixed(0)}" height="${h}" width="${(h * w / hh).toFixed(1)}" aria-hidden="true"><polygon points="${pts}" fill="#4caf50" stroke="#fff" stroke-width="40" stroke-linejoin="round"/></svg>`;
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
  STATIONS.filter(s => !s.island).forEach(s => {
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
  // Append new nodes after the original 117 nodes so existing saves keep their positions.
  for (const island of ISLANDS) {
    const stops = STATIONS.filter(s => s.island === island.id);
    for (const stop of stops) {
      const id = G.nodes.length;
      G.nodes.push({ id, type: 'station', sid: stop.id, island: island.id, x: stop.mapX, y: stop.mapY });
      G.adj.push([]); G.stationNode[stop.id] = id; G.stationById[stop.id] = stop;
    }
  }
  layoutCoastLine();
  G.near = G.nodes.map(n => n.type === 'station' ? n.sid : null);
  const q = G.nodes.filter(n => n.type === 'station').map(n => n.id);
  while (q.length) {
    const u = q.shift();
    for (const v of G.adj[u]) if (!G.near[v]) { G.near[v] = G.near[u]; q.push(v); }
  }
}

// Display-only routing: keep node IDs, tile types and travel distances compatible with saves.
function layoutCoastLine() {
  const dajia = G.nodes[G.stationNode.dajia];
  dajia.x -= 48;
  for (const [from, to] of [['changhua', 'dajia'], ['dajia', 'zhunan']]) {
    const start = G.stationNode[from], end = G.stationNode[to];
    // These two coastal segments contain only degree-two intermediate tiles.
    // Follow each candidate until its next station to identify the coastal segment.
    let route;
    for (const first of G.adj[start]) {
      const candidate = [start, first];
      let prev = start, cur = first;
      while (G.nodes[cur].type !== 'station') {
        const next = G.adj[cur].find(id => id !== prev);
        prev = cur; cur = next; candidate.push(cur);
      }
      if (cur === end) { route = candidate; break; }
    }
    const a = G.nodes[start], b = G.nodes[end];
    route.forEach((id, i) => {
      if (!i || i === route.length - 1) return;
      const t = i / (route.length - 1);
      G.nodes[id].x = a.x + (b.x - a.x) * t - 42 * Math.sin(Math.PI * t);
      G.nodes[id].y = a.y + (b.y - a.y) * t;
    });
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
// Walking/rail reachability stays separate: tickets are never dice edges.
const travelCache = new Map();
function travelDistances(src) {
  if (travelCache.has(src)) return travelCache.get(src);
  const d = G.nodes.map(() => Infinity), visited = new Set(); d[src] = 0;
  while (visited.size < G.nodes.length) {
    let u = -1;
    for (let i = 0; i < d.length; i++) if (!visited.has(i) && (u < 0 || d[i] < d[u])) u = i;
    if (u < 0 || !Number.isFinite(d[u])) break;
    visited.add(u);
    const edges = G.adj[u].map(v => [v,1]);
    for (const [a,b] of [...ISLAND_FLIGHTS,...ISLAND_BOATS]) {
      const x=G.stationNode[a], y=G.stationNode[b];
      if (u===x) edges.push([y,8]); else if (u===y) edges.push([x,8]);
    }
    for (const [v,cost] of edges) d[v] = Math.min(d[v],d[u]+cost);
  }
  travelCache.set(src,d); return d;
}
const dist = (a,b) => Number.isFinite(distFrom(a)[b]) ? distFrom(a)[b] : travelDistances(a)[b];
function distanceLabel(a,b) {
  return Number.isFinite(distFrom(a)[b]) ? `${distFrom(a)[b]} 格` : `需轉乘・估算 ${dist(a,b)} 格`;
}

/* 往前可走的方向：不能立刻折返（死路除外） */
function forwardOpts(cur, prev) {
  const o = G.adj[cur].filter(n => n !== prev);
  return o.length ? o : G.adj[cur];
}

/* 擲出 steps 步後可停的位置（經過目的地就停下） */
function reachable(start, steps) {
  let frontier = [{ node: start, prev: -1, path: [start] }];
  const res = new Map();
  for (let k = 1; k <= steps; k++) {
    const next = new Map();
    for (const st of frontier) {
      for (const n of forwardOpts(st.node, st.prev)) {
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

function validPath(path, start, total) {
  if (!Array.isArray(path) || path.length < 2 || path[0] !== start) return false;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1], b = path[k];
    if (!G.adj[a] || !G.adj[a].includes(b)) return false;
    if (k >= 2 && b === path[k - 2] && G.adj[a].length > 1) return false;
    if (k < path.length - 1 && b === S.goal) return false;
  }
  const steps = path.length - 1, last = path[path.length - 1];
  return steps === total || (last === S.goal && steps <= total);
}

function placeName(node) {
  const n = G.nodes[node];
  if (n.type === 'station') return G.stationById[n.sid].name + '站';
  return `${G.stationById[G.near[node]].name}附近的${SQ_NAME[n.type]}`;
}

/* ================= 遊戲狀態 ================= */
let S = null;
let zoom = innerWidth < 820 ? 2.6 : 2.0;
let prevZoom = null;
let actResolve = null;
let stepClick = null;

/* ---- 連線狀態（net.js 負責建立連線） ----
 * mode: local 同機輪流 / host 房主（執行遊戲） / client 加入者（只顯示與回答） */
const NET = { mode: 'local', ws: null, myId: null, conns: new Map(), vconns: new Map(), hostConn: null, pending: new Map(), askSeq: 0, lastTurn: -1, lobby: [], answering: false, ended: false };
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
  // 出發順序隨機；每人從不同的本島車站出發（離島不能擲骰，不當起點）
  const starts = shuffle(STATIONS.filter(s => !s.island).map(s => G.stationNode[s.id]));
  S = {
    ver: 1, year: 1, month: 1, maxYears: cfg.years, speed: cfg.speed, turn: 0, over: false, introDone: false,
    players: shuffle(cfg.players).map((p, k) => ({
      name: p.name, cpu: p.cpu, peer: p.peer || null, color: COLORS[p.slot], cash: 10000, pos: starts[k], cards: ['express', 'express'], skip: false,
    })),
    owner: {}, goal: null, goalBonusBase: 0,
    curse: { holder: null, level: 1, turns: 0 },
    log: [],
  };
  pickGoal(S.players.map(p => p.pos), 20);
  log(`📅 第1年 1月，遊戲開始！出發順序：${S.players.map(p => `${p.name}（${placeName(p.pos)}）`).join(' → ')}`, 'month');
}

/* fromNode 可以是一個或多個起點；目的地要離每個起點都夠遠，獎金以最近的起點計 */
function pickGoal(fromNode, minDist) {
  const froms = [].concat(fromNode);
  const all = STATIONS.map(s => G.stationNode[s.id]).filter(n => n !== S.goal && !froms.includes(n));
  const far = all.filter(n => froms.every(f => dist(f, n) >= minDist));
  const node = pick(far.length ? far : all);
  S.goalBonusBase = 2500 + Math.min(...froms.map(f => dist(f, node))) * 120;
  S.goal = node;
  log(`🚩 新目的地：${placeName(node)}`, 'goal');
}

function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }
function loadSave() { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); return s && s.ver === 1 && !s.over ? s : null; } catch (e) { return null; } }
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }

/* ================= 地圖繪製 ================= */
function buildMapSVG() {
  const svg = $('#map');
  svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`);
  let h = `<defs><pattern id="wave" width="40" height="20" patternUnits="userSpaceOnUse"><path d="M0 10 Q10 4 20 10 T40 10" fill="none" stroke="#b9dcef" stroke-width="2"/></pattern></defs>`;
  h += `<rect x="0" y="0" width="${VW}" height="${VH}" class="sea"/><rect x="0" y="0" width="${VW}" height="${VH}" fill="url(#wave)" opacity=".6"/>`;
  const pts = COAST.map(([lo, la]) => px(lo).toFixed(1) + ',' + py(la).toFixed(1)).join(' ');
  h += `<polygon class="landShadow" points="${pts}" transform="translate(6 8)"/><polygon class="land" points="${pts}"/>`;
  h += `<text x="60" y="1480" class="seaText">台灣海峽</text><text x="${VW - 70}" y="900" class="seaText" text-anchor="end">太平洋</text>`;
  for (const island of ISLANDS) {
    h += `<g class="islandInset"><rect x="${island.x-88}" y="${island.y-65}" width="176" height="140" rx="20"/>
      <path class="land" d="M ${island.x-20},${island.y-47} Q ${island.x+78},${island.y-40} ${island.x+65},${island.y+18} Q ${island.x+22},${island.y+55} ${island.x-62},${island.y+32} Q ${island.x-76},${island.y-22} ${island.x-20},${island.y-47} Z"/>
      <text x="${island.x}" y="${island.y+64}" text-anchor="middle">離島單站・須購票進出</text></g>`;
  }
  G.edges.forEach(([u, v, bus]) => {
    const a = G.nodes[u], b = G.nodes[v];
    h += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="railBed${bus ? ' bus' : ''}"/>`;
  });
  G.edges.forEach(([u, v, bus]) => {
    const a = G.nodes[u], b = G.nodes[v];
    h += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="rail${bus ? ' bus' : ''}"/>`;
  });
  G.nodes.forEach(n => {
    if (n.type === 'station') return;
    h += `<g class="sq ${n.type}" data-node="${n.id}"><rect x="${n.x - 10}" y="${n.y - 10}" width="20" height="20" rx="5"/>`;
    if (n.type === 'yellow') h += `<text x="${n.x}" y="${n.y + 4.5}">?</text>`;
    else if (n.type === 'blue') h += `<text x="${n.x}" y="${n.y + 4.5}">+</text>`;
    else h += `<text x="${n.x}" y="${n.y + 4.5}">−</text>`;
    h += '</g>';
  });
  STATIONS.forEach(s => {
    const n = G.nodes[G.stationNode[s.id]];
    let lx = n.x, ly = n.y + 6, anchor = 'middle';
    if (s.lab === 't') ly = n.y - 21;
    else if (s.lab === 'b') ly = n.y + 42;
    else if (s.lab === 'l') { lx = n.x - 20; anchor = 'end'; }
    else { lx = n.x + 20; anchor = 'start'; }
    h += `<g class="st${s.shop ? ' shop' : ''}" data-node="${n.id}">
      <rect x="${n.x - 14}" y="${n.y - 14}" width="28" height="28" rx="6"/>
      <text x="${lx}" y="${ly}" text-anchor="${anchor}">${s.name}${AIRPORTS.includes(s.id) ? `<tspan class="trIco" data-tr="flight" data-sid="${s.id}"> ✈</tspan>` : ''}${PORTS.includes(s.id) ? `<tspan class="trIco" data-tr="boat" data-sid="${s.id}"> ⚓</tspan>` : ''}</text></g>`;
  });
  h += '<g id="lyOwn"></g><g id="lyGoal"></g><g id="lyHL"></g><g id="lyTok"></g><g id="lyFx"></g>';
  svg.innerHTML = h;
}

function renderMapDyn() {
  let h = '';
  STATIONS.forEach(s => {
    const n = G.nodes[G.stationNode[s.id]];
    const k = s.props.length, mono = monoOwner(s.id);
    if (mono != null) h += `<rect x="${n.x - 9}" y="${n.y - 9}" width="18" height="18" rx="3" fill="${S.players[mono].color}"/><text x="${n.x}" y="${n.y + 5}" class="monoStar">★</text>`;
    s.props.forEach((pr, i) => {
      const o = S.owner[s.id + ':' + i];
      const x = n.x + (i - (k - 1) / 2) * 8;
      h += `<circle cx="${x}" cy="${n.y + 21}" r="3.4" fill="${o == null ? '#c9d1d6' : S.players[o].color}" stroke="#fff" stroke-width="1"/>`;
    });
  });
  $('#lyOwn').innerHTML = h;
  const g = G.nodes[S.goal];
  $('#lyGoal').innerHTML = `<circle cx="${g.x}" cy="${g.y}" r="26" class="goalRing"/><text x="${g.x + 4}" y="${g.y - 18}" class="goalFlag">🚩</text>`;
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
      h += `<g class="tok${i === S.turn ? ' cur' : ''}"><circle cx="${x}" cy="${y + 2}" r="12" fill="rgba(0,0,0,.25)"/><circle cx="${x}" cy="${y}" r="12" fill="${p.color}"/><text x="${x}" y="${y + 4.5}">🚃</text></g>`;
      if (S.curse.holder === i) h += `<text x="${x + 7}" y="${y - 12}" class="curseIco">${S.curse.level > 1 ? '⛈️' : '🌧️'}</text>`;
    });
  }
  $('#lyTok').innerHTML = h;
}

/* 地圖上的浮動文字（例如 +500萬） */
function floatLocal(node, text, color) {
  const n = G.nodes[node];
  if (!n) return;
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  t.setAttribute('x', n.x);
  t.setAttribute('y', n.y - 18);
  t.setAttribute('class', 'floatTxt');
  t.setAttribute('fill', color || '#fff');
  t.textContent = text;
  $('#lyFx').appendChild(t);
  sfx(text[0] === '+' ? 'coin' : text[0] === '-' ? 'loss' : text.includes('🏠') ? 'buy' : text.includes('🃏') ? 'card' : text.includes('✨') ? 'warp' : 'msg');
  setTimeout(() => t.remove(), 1700);
}
function floatAll(node, text, color) { floatLocal(node, text, color); netSend({ t: 'float', node, text, color }); }

/* ================= HUD ================= */
function renderTop() {
  $('#month').textContent = S.month + '月';
  $('#yearInfo').textContent = `第${S.year}年／共${S.maxYears}年`;
  $('#goalInfo').innerHTML = `<span class="gl">🚩 目的地</span><b>${G.stationById[G.nodes[S.goal].sid].name}</b><small>獎金 ${fmt(r10(S.goalBonusBase * yf()))}</small>`;
  bgmSetMood(S.curse.holder === S.turn && !S.over ? 'curse' : 'normal');
}

function renderPlayers() {
  $('#players').innerHTML = S.players.map((p, i) => `
    <div class="pcard${i === S.turn ? ' cur' : ''}" data-p="${i}" style="--pc:${p.color}">
      <div class="pTop"><span class="chip">${i + 1}</span><b class="pName">${p.name}</b>${isMine(i) ? '<small class="you">你</small>' : ''}<span class="pIcons">${S.curse.holder === i ? (S.curse.level > 1 ? '⛈️' : '🌧️') : ''}${p.skip ? '⛔' : ''}${p.boatRest ? '<span title="搭船後下回合暫停">🚢⏸</span>' : ''}${p.offline ? '📴' : p.cpu ? '🤖' : p.peer && !isMine(i) ? '🌐' : ''}</span></div>
      <div class="pMoney ${p.cash < 0 ? 'neg' : ''}">${fmt(p.cash)}</div>
      <div class="pSub">資產 ${fmt(assets(i))}・🃏${p.cards.length}・距 ${distanceLabel(p.pos, S.goal)}</div>
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

/* ---- 鏡頭 ----
 * 地圖四周留有一半螢幕寬高的空白（#mapPad），所以任何地點（包含最南、最北）
 * 都能捲到畫面中央，不會被上方 HUD 或下方視窗擋住。 */

/* 畫面上沒被 HUD／視窗擋住的區域（只計算橫跨大半個畫面的面板） */
function visibleRect() {
  const w = $('#mapWrap');
  const W = w.clientWidth, H = w.clientHeight;
  let top = $('#hudTop').getBoundingClientRect().bottom, bottom = H;
  const pl = $('#players').getBoundingClientRect();
  if (pl.width > W * 0.6) top = Math.max(top, pl.bottom);
  for (const id of ['#cmd', '#msg']) {
    const el = $(id);
    if (el.classList.contains('hidden')) continue;
    const r = el.getBoundingClientRect();
    if (r.width > W * 0.5) bottom = Math.min(bottom, r.top);
  }
  if (bottom - top < 140) { top = 0; bottom = H; }
  return { top: top + 6, bottom: bottom - 6, left: 0, right: W };
}

function applyZoom() {
  const w = $('#mapWrap');
  const W = w.clientWidth, H = w.clientHeight;
  const vr = visibleRect();
  const fitW = Math.min(W * 0.96, (vr.bottom - vr.top) * 0.96 * VW / VH);
  const MW = Math.max(100, fitW * zoom);
  const svg = $('#map');
  svg.style.width = MW + 'px';
  svg.style.height = (MW * VH / VW) + 'px';
  $('#mapPad').style.padding = `${Math.round(H / 2)}px ${Math.round(W / 2)}px`;
}

/* 地圖在捲動內容中的位置（SVG 元素沒有 offsetLeft，所以用外圍留白計算） */
function mapOffset() {
  const pad = $('#mapPad');
  return { x: parseFloat(pad.style.paddingLeft) || 0, y: parseFloat(pad.style.paddingTop) || 0 };
}

/* 把地圖座標 (x, y) 移到可見區域的中央 */
function focusXY(x, y, smooth) {
  const w = $('#mapWrap'), svg = $('#map');
  const sc = parseFloat(svg.style.width) / VW;
  const vr = visibleRect();
  const off = mapOffset();
  w.scrollTo({
    left: off.x + x * sc - (vr.left + vr.right) / 2,
    top: off.y + y * sc - (vr.top + vr.bottom) / 2,
    behavior: smooth ? 'smooth' : 'auto',
  });
}
function focusNode(node, smooth) {
  const n = G.nodes[node];
  if (n) focusXY(n.x, n.y, smooth);
}
const ISLAND_CENTER = [VW * 0.5, VH * 0.5];

/* 以畫面上的某一點為中心縮放（滑鼠滾輪、雙指縮放用） */
function zoomAt(z, cx, cy) {
  const w = $('#mapWrap'), svg = $('#map');
  const sc = parseFloat(svg.style.width) / VW;
  const o1 = mapOffset();
  const mx = (w.scrollLeft + cx - o1.x) / sc, my = (w.scrollTop + cy - o1.y) / sc;
  zoom = Math.min(5, Math.max(1, z));
  applyZoom();
  const sc2 = parseFloat(svg.style.width) / VW;
  const o2 = mapOffset();
  w.scrollLeft = o2.x + mx * sc2 - cx;
  w.scrollTop = o2.y + my * sc2 - cy;
  $('#btnOverview').classList.toggle('on', zoom <= 1.05);
  try { localStorage.setItem(ZOOM_KEY, String(zoom)); } catch (e) { /* ignore */ }
}

function setZoom(z, node) {
  zoom = Math.min(5, Math.max(1, z));
  try { localStorage.setItem(ZOOM_KEY, String(zoom)); } catch (e) { /* ignore */ }
  applyZoom();
  $('#btnOverview').classList.toggle('on', zoom <= 1.05);
  if (S) focusNode(node != null ? node : S.players[S.turn].pos);
}
function toggleOverview() {
  if (!S) return;
  if (zoom > 1.05) { prevZoom = zoom; zoom = 1; applyZoom(); focusXY(ISLAND_CENTER[0], ISLAND_CENTER[1]); }
  else { zoom = prevZoom || (innerWidth < 820 ? 2.6 : 2.0); applyZoom(); focusNode(S.players[S.turn].pos); }
  $('#btnOverview').classList.toggle('on', zoom <= 1.05);
}

/* 滑鼠拖曳平移、滾輪縮放、手機雙指縮放 */
let dragMoved = false;
function setupMapGestures() {
  const w = $('#mapWrap');
  let drag = null;
  w.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, sl: w.scrollLeft, st: w.scrollTop };
    dragMoved = false;
  });
  window.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!dragMoved && Math.abs(dx) + Math.abs(dy) > 6) { dragMoved = true; w.classList.add('dragging'); }
    if (dragMoved) { w.scrollLeft = drag.sl - dx; w.scrollTop = drag.st - dy; }
  });
  window.addEventListener('pointerup', () => { drag = null; w.classList.remove('dragging'); });
  w.addEventListener('wheel', e => {
    e.preventDefault();
    zoomAt(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY);
  }, { passive: false });
  let pinch = null;
  const tdist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  w.addEventListener('touchstart', e => {
    if (e.touches.length === 2) pinch = { d: tdist(e.touches), z: zoom };
  }, { passive: true });
  w.addEventListener('touchmove', e => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2, cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    zoomAt(pinch.z * tdist(e.touches) / pinch.d, cx, cy);
  }, { passive: false });
  w.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; });
}

/* ================= 介面元件 ================= */
/* 狀態列（畫面下方的小訊息） */
function setStatusLocal(html) {
  actResolve = null;
  stepClick = null;
  $('#cmd').classList.add('hidden');
  $('#cmd').innerHTML = '';
  $('#status').innerHTML = html || '';
  $('#status').classList.toggle('hidden', !html);
}
function setStatus(html) { setStatusLocal(html); netSend({ t: 'status', html }); }

/* 指令視窗：一個標題 + 一列指令，回傳被選的值 */
function setActions(title, buttons, extraCls) {
  return new Promise(res => {
    actResolve = v => { actResolve = null; $('#cmd').classList.add('hidden'); $('#lyHL').innerHTML = ''; res(v); };
    $('#status').classList.add('hidden');
    let h = `<div class="cmdTitle">${title}</div><div class="cmdList">`;
    buttons.forEach((b, k) => { h += `<button class="cmdBtn ${b.cls || ''}" data-k="${k}" type="button" ${b.disabled ? 'disabled' : ''}>${b.label}</button>`; });
    const cmd = $('#cmd');
    cmd.className = 'win ' + (extraCls || '');
    cmd.innerHTML = h + '</div>';
    cmd.querySelectorAll('.cmdBtn').forEach(el => {
      el.onclick = () => actResolve && actResolve(buttons[+el.dataset.k].value);
    });
  });
}

let modalSeq = 0;
/* 目前視窗的「關閉」動作（點框外、右上 ✕、Android 返回鍵共用）；null 表示必須做出選擇 */
let modalDismiss = null;
function addClose(box, fn) {
  modalDismiss = fn;
  box.insertAdjacentHTML('afterbegin', '<button class="xBtn" type="button" aria-label="關閉">✕</button>');
  box.querySelector('.xBtn').onclick = () => modalDismiss && modalDismiss();
}
function dismissModal() {
  if ($('#modal').classList.contains('hidden') || !modalDismiss) return false;
  modalDismiss();
  return true;
}
function modal(html, buttons = [{ label: '確定', value: true, cls: 'primary' }], opts = {}) {
  return new Promise(res => {
    const m = $('#modal'), box = m.querySelector('.box');
    let h = html + '<div class="btns">';
    buttons.forEach((b, k) => { h += `<button class="btn ${b.cls || ''}" data-k="${k}" type="button" ${b.disabled ? 'disabled' : ''}>${b.label}</button>`; });
    box.innerHTML = h + '</div>';
    m.classList.remove('hidden');
    const seq = ++modalSeq;
    let timer = null;
    // 只關掉自己這個視窗：若已被新的視窗取代，就不要把新的關掉
    const close = v => { clearTimeout(timer); if (seq === modalSeq) { m.classList.add('hidden'); modalDismiss = null; } res(v); };
    box.querySelectorAll('.btns:last-child > button').forEach(el => { el.onclick = () => close(buttons[+el.dataset.k].value); });
    // 有「取消／關閉／返回」（value 為 null）或只是單一按鈕的說明視窗，才允許直接關閉，效果等同按該按鈕
    const cancel = buttons.find(b => b.value === null) || (buttons.length === 1 && /^(確定|關閉|了解|返回)$/.test(buttons[0].label) ? buttons[0] : null);
    if (cancel) addClose(box, () => close(cancel.value)); else modalDismiss = null;
    if (opts.auto) timer = setTimeout(() => close(buttons[0].value), opts.auto);
  });
}

/* 所有裝置一起顯示的視窗。線上模式一律自動關閉，避免卡住別人 */
function showAll(html, autoMs) {
  netSend({ t: 'show', html, auto: autoMs || 3000 });
  return modal(html, [{ label: '確定', value: true, cls: 'primary' }], autoMs ? { auto: autoMs } : {});
}

/* 訊息視窗（畫面下方，點一下繼續） */
let msgSeq = 0;
function messageLocal(title, body, autoMs) {
  return new Promise(res => {
    const m = $('#msg');
    m.innerHTML = `${title ? `<div class="msgTitle">${title}</div>` : ''}<div class="msgBody">${body}</div><div class="msgNext">▼</div>`;
    m.classList.remove('hidden', 'mini');
    m.classList.remove('pop'); void m.offsetWidth; m.classList.add('pop');
    sfx(title && /衰尾/.test(title) ? 'curse' : 'msg');
    const seq = ++msgSeq;
    let t = null;
    const close = () => {
      clearTimeout(t);
      if (seq === msgSeq) { m.classList.add('hidden'); m.onclick = null; }
      res(true);
    };
    m.onclick = close;
    if (autoMs) t = setTimeout(close, autoMs);
  });
}
function message(title, body, autoMs) {
  netSend({ t: 'msg', title, body, auto: autoMs || 3000 });
  return messageLocal(title, body, autoMs);
}
function announce(title, body, auto) {
  const a = auto || !anyHuman() || NET.mode === 'host';
  return message(title, body, a ? 1900 * spd() + (NET.mode === 'host' ? 900 : 400) : 0);
}

function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.innerHTML = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), 2200);
  setTimeout(() => el.remove(), 2600);
}
function toastAll(msg, kind) { toast(msg, kind); netSend({ t: 'toast', msg, kind }); }

async function note(i, msg, kind) {
  log(msg, kind);
  setStatus(`<span class="${kind || ''}">${msg}</span>`);
  renderPlayers();
  netSend({ t: 'state', S: stateForNet() });
  await sleep(S.players[i].cpu ? 800 * spd() : 900);
}

/* ---- 回合橫幅 ---- */
function bannerLocal(html, color, snd) {
  const b = $('#banner');
  b.innerHTML = `<div class="bInner">${html}</div>`;
  b.style.setProperty('--bc', color || '#e9b949');
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  sfx(snd || 'turn');
}
async function banner(html, color, ms, snd) {
  bannerLocal(html, color, snd);
  netSend({ t: 'banner', html, color, snd });
  await sleep(ms);
}

/* ---- 骰子 ---- */
const dieHTML = v => `<span class="die${v === 1 ? ' one' : ''}">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(k => `<i class="${PIPS[v].includes(k) ? 'on' : ''}"></i>`).join('')}</span>`;
let diceTimer = null;
function diceSpinLocal(n, text) {
  const o = $('#diceOverlay');
  o.classList.remove('hidden');
  o.classList.add('spin');
  o.querySelector('.diceText').innerHTML = text || '';
  clearInterval(diceTimer);
  const tick = () => { o.querySelector('.diceRow').innerHTML = Array.from({ length: n }, () => dieHTML(rint(1, 6))).join(''); sfx('tick'); };
  tick();
  diceTimer = setInterval(tick, 70);
}
async function diceResultLocal(vals) {
  const o = $('#diceOverlay');
  if (o.classList.contains('hidden')) { diceSpinLocal(vals.length); await sleep(650); } else await sleep(160);
  clearInterval(diceTimer);
  o.onclick = null;
  o.classList.remove('spin');
  o.querySelector('.diceRow').innerHTML = vals.map(dieHTML).join('');
  sfx('dice');
  o.querySelector('.diceText').innerHTML = `前進 <b>${vals.reduce((a, b) => a + b, 0)}</b> 步！`;
  await sleep(950);
  o.classList.add('hidden');
}
function diceWaitTap(n) {
  return new Promise(res => {
    diceSpinLocal(n, '點一下停止！');
    const o = $('#diceOverlay');
    o.onclick = () => { o.onclick = null; o.querySelector('.diceText').innerHTML = ''; res(); };
  });
}

/* ---- 目的地輪盤 ---- */
async function rouletteLocal(finalName) {
  const o = $('#roulette'), nameEl = o.querySelector('.rName');
  o.classList.remove('hidden', 'done');
  const names = STATIONS.map(s => s.name);
  let delay = 45;
  for (let k = 0; k < 22; k++) {
    nameEl.textContent = names[(k * 7 + rint(0, names.length - 1)) % names.length];
    sfx('rtick');
    await sleep(delay);
    delay *= 1.12;
  }
  nameEl.textContent = finalName + '站';
  o.classList.add('done');
  sfx('ding');
  await sleep(1300);
  o.classList.add('hidden');
}
async function roulette(node) {
  const name = G.stationById[G.nodes[node].sid].name;
  netSend({ t: 'roulette', name });
  render();
  await rouletteLocal(name);
  focusNode(node, true);
  await sleep(500);
}

/* ================= 負債與收購 ================= */
function debtOptions(i) {
  return ownedKeys(i).map(key => {
    const pr = propOf(key), sid = key.split(':')[0];
    return { key, name: pr[0], station: G.stationById[sid].name, sale: Math.floor(pr[1] / 2), income: pr[1] * pr[2] / 100, monopoly: monoOwner(sid) === i };
  }).sort((a,b) => a.income - b.income || a.sale - b.sale || a.key.localeCompare(b.key));
}
async function settleDebt(i) {
  const p = S.players[i];
  while (p.cash < 0) {
    const options = debtOptions(i);
    if (!options.length) break;
    render(); // Send the current debt and ownership to a remote player before asking.
    const chosen = p.cpu || p.offline ? null : await ask(i, 'debt', { i });
    const sale = options.find(o => o.key === chosen) || options[0];
    // Only the authoritative game changes ownership and computes the sale value.
    if (S.owner[sale.key] !== i) continue;
    delete S.owner[sale.key];
    p.cash += sale.sale;
    log(`🏦 ${p.name} 變賣${sale.station}「${sale.name}」，半價取得 ${fmt(sale.sale)}；${p.cash < 0 ? '仍欠 ' + fmt(-p.cash) : '現金 ' + fmt(p.cash)}。物件重新開放購買`, 'bad');
    render();
  }
}
async function settleAllDebts() {
  for (let i = 0; i < S.players.length; i++) await settleDebt(i);
}
function chooseDebtSale(i) {
  const p = S.players[i];
  return modal(`<h3>🏦 選擇變賣物件</h3><p>目前負債：<b class="neg">${fmt(-p.cash)}</b></p>
    <p class="hint flightIntro">選擇一項物件以原價一半變賣。還清後立即停止；若仍負債，繼續選擇。售出物件重新開放所有人購買。賣完仍不足則保留負債。</p>`,
    debtOptions(i).map(o => ({label:`<span class="flightRow"><span><b>${o.station}・${o.name}</b><small>基礎年收益 ${fmt(o.income)}${o.monopoly ? '・出售將失去獨佔加倍' : ''}</small><small>售後${p.cash + o.sale < 0 ? '仍欠 ' + fmt(-p.cash-o.sale) : '現金 ' + fmt(p.cash+o.sale)}</small></span><b>變賣 ${fmt(o.sale)}</b></span>`,value:o.key})));
}
function acquisitionOptions(i) {
  const s = stationOf(S.players[i].pos);
  if (!s) return [];
  return s.props.map((pr,k) => ({key:s.id+':'+k, name:pr[0], owner:S.owner[s.id+':'+k], price:pr[1]*2, income:pr[1]*pr[2]/100}))
    .filter(o => Number.isInteger(o.owner) && o.owner !== i && S.players[o.owner]);
}
function chooseAcquisition(i) {
  const p = S.players[i], options = acquisitionOptions(i);
  return modal(`<h3>🤝 收購對手物件</h3><p>現金：<b>${fmt(p.cash)}</b></p><p class="hint flightIntro">收購目前車站的一項對手物件，支付原價 2 倍給原持有人，並消耗一張收購卡。收購後仍可擲骰或搭乘交通工具。${options.length ? '' : '本站目前沒有可收購物件。'}</p>`,
    [...options.map(o=>({label:`<span class="flightRow"><span><b>${o.name}</b><small>持有人：${S.players[o.owner].name}${p.cash < o.price ? '・現金不足' : ''}</small></span><b>收購 ${fmt(o.price)}</b></span>`,value:o.key,disabled:p.cash<o.price})),{label:'取消',value:null}]);
}

/* ================= 回合流程 ================= */
async function gameLoop() {
  bgmStart();
  await settleAllDebts();
  render();
  setZoom(zoom);
  if (!S.introDone) {
    S.introDone = true;
    await banner('<small>遊戲開始</small>寶島鐵道大亨', '#e9b949', 1400, 'fanfare');
    // 依出發順序逐一把鏡頭移到每位玩家，介紹他從哪一站出發（先把狀態送給線上玩家，他們才看得到棋子）
    netSend({ t: 'state', S: stateForNet() });
    for (const [k, p] of S.players.entries()) {
      focusNode(p.pos, true);
      netSend({ t: 'focus', node: p.pos });
      await sleep(450);
      floatAll(p.pos, '📍', p.color);
      await message(`🎲 第 ${k + 1} 位出發`, `<b style="color:${p.color}">${p.name}</b> 從 <b>${placeName(p.pos)}</b> 出發！`, 2200);
    }
    await message('🚩 決定目的地', '接下來用輪盤決定第一個目的地。', anyHuman() && NET.mode !== 'host' ? 0 : 1800);
    await roulette(S.goal);
  }
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
  await settleDebt(i);
  render();
  focusNode(p.pos, true);
  log(`▶ ${p.name} 的回合`, 'turn');
  await banner(`<small>第${S.year}年 ${S.month}月</small>${p.name} 的回合`, p.color, p.cpu ? 900 * spd() + 200 : 1100);
  if (p.skip || p.boatRest) {
    const resting = p.boatRest;
    p.skip = false;
    p.boatRest = false;
    render();
    await note(i, resting ? `🚢 ${p.name} 搭船後休息，這回合暫停，下回合恢復行動` : `⛔ ${p.name} 停駛中，這回合無法前進`, 'bad');
    return;
  }
  const act = p.cpu ? await cpuPreRoll(i) : await humanPreRoll(i);
  render();
  if (act.type === 'stay' && G.nodes[p.pos].island) {
    p.cash += ISLAND_STAY_INCOME;
    render();
    floatAll(p.pos, '+' + fmt(ISLAND_STAY_INCOME), '#7fd3ff');
    await note(i, `🏝️ ${p.name} 留島經營，獲得 ${fmt(ISLAND_STAY_INCOME)}`, 'good');
  } else if (act.type === 'warp' || act.type === 'flight' || act.type === 'boat') {
    p.pos = act.node;
    if (act.type === 'boat') p.boatRest = true;
    render();
    focusNode(p.pos, true);
    const transport = act.type === 'flight' ? { icon: '✈️', verb: '搭機' } : act.type === 'boat' ? { icon: '🚢', verb: '搭船' } : null;
    floatAll(p.pos, transport ? transport.icon : '✨', '#fff');
    await note(i, transport ? `${transport.icon} ${p.name} ${transport.verb}抵達 ${placeName(act.node)}（票價 ${fmt(act.fare)}）${act.type === 'boat' ? '，下一回合暫停一次' : ''}` : `✨ ${p.name} 瞬間移動到了 ${placeName(act.node)}`, 'good');
  } else {
    const total = await rollDice(act.dice);
    const ends = reachable(p.pos, total);
    if (p.cpu) {
      await moveAlong(i, ends.get(cpuChooseEnd(i, ends)), true);
    } else {
      const res = await humanChooseEnd(i, ends, total);
      await moveAlong(i, res.path, res.animate);
    }
  }
  await landOn(i);
  if (S.over) return;
  await curseTurn(i);
  render();
}

async function rollDice(n) {
  const vals = Array.from({ length: n }, () => rint(1, 6));
  const sum = vals.reduce((a, b) => a + b, 0);
  setStatus('');
  netSend({ t: 'dice', vals });
  log(`🎲 ${S.players[S.turn].name} 擲出 ${vals.join('+')}${n > 1 ? ' = ' + sum : ''}`);
  await diceResultLocal(vals);
  return sum;
}

async function moveAlong(i, path, animate) {
  const p = S.players[i];
  let transferred = false;
  const step = p.cpu ? 130 * spd() : 160;
  for (let k = 1; k < path.length; k++) {
    if (animate) {
      p.pos = path[k];
      renderTokens();
      sfx('step');
      netSend({ t: 'pos', pos: S.players.map(q => q.pos), curse: S.curse, mover: i });
      if (zoom > 1.05) focusNode(p.pos);
    }
    if (S.curse.holder === i && !transferred) {
      const j = S.players.findIndex((q, jj) => jj !== i && q.pos === path[k]);
      if (j >= 0) {
        transferred = true;
        S.curse.holder = j;
        S.curse.turns = 0;
        p.pos = path[k];
        render();
        log(`💨 ${p.name} 擦身而過，把衰尾道人甩給了 ${S.players[j].name}！`, 'good');
        await message('💨 甩掉衰尾道人！', `${p.name} 擦身而過，把衰尾道人甩給了 <b style="color:${S.players[j].color}">${S.players[j].name}</b>！`, 1600);
      }
    }
    if (animate) await sleep(step);
  }
  p.pos = path[path.length - 1];
  render();
}

async function landOn(i) {
  const p = S.players[i], n = G.nodes[p.pos];
  if (p.pos === S.goal) await reachGoal(i);
  if (n.type === 'blue') {
    const g = r10(rint(300, 1500) * yf());
    p.cash += g;
    floatAll(p.pos, '+' + fmt(g), '#7fd3ff');
    await note(i, `🔵 ${p.name} 停在藍色格，獲得 ${fmt(g)}`, 'good');
  } else if (n.type === 'red') {
    const l = r10(rint(200, 1200) * yf());
    p.cash -= l;
    await settleDebt(i);
    floatAll(p.pos, '-' + fmt(l), '#ff8a80');
    await note(i, `🔴 ${p.name} 停在紅色格，損失 ${fmt(l)}`, 'bad');
  } else if (n.type === 'yellow') {
    const k = drawCard();
    floatAll(p.pos, '🃏', '#ffd54f');
    if (p.cards.length >= 8) await note(i, `🟡 ${p.name} 抽到「${CARDS[k].name}」，但手牌已滿只好丟掉`);
    else {
      p.cards.push(k);
      log(`🟡 ${p.name} 抽到了「${CARDS[k].name}」`, 'good');
      render();
      await message('🟡 卡片格', `${p.name} 抽到了 <b>「${CARDS[k].name}」</b><br><small>${CARDS[k].desc}</small>`, p.cpu || NET.mode === 'host' ? 1700 * spd() + 300 : 0);
    }
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
  floatAll(p.pos, '+' + fmt(bonus), '#ffd54f');
  await banner(`<small>抵達目的地</small>🎉 ${G.stationById[G.nodes[S.goal].sid].name}站`, p.color, 1300, 'fanfare');
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
      focusNode(S.players[far].pos, true);
      log(`🌧️ 衰尾道人纏上了離目的地最遠的 ${S.players[far].name}`, 'bad');
      await announce('🌧️ 衰尾道人出現了', `離目的地最遠的 <b style="color:${S.players[far].color}">${S.players[far].name}</b> 被衰尾道人纏上了……<br><small>移動時碰到（經過或停在同一格）其他玩家，就能把它甩給對方！</small>`, p.cpu);
    }
  }
  pickGoal(S.goal, 14);
  await roulette(S.goal);
  focusNode(p.pos, true);
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
    await banner('<small>糟糕！</small>⛈️ 大衰尾登場', '#6a1b9a', 1300, 'curse');
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
      await settleDebt(i);
      floatAll(p.pos, '-' + fmt(l), '#ff8a80');
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
      await settleDebt(i);
      floatAll(p.pos, '-' + fmt(l), '#ff8a80');
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
  // 每年 1 月開始、12 月底決算
  if (S.month === 12) {
    await settlement();
    S.year++;
    if (S.year > S.maxYears) { await endGame(); return; }
  }
  S.month = S.month === 12 ? 1 : S.month + 1;
  log(`📅 第${S.year}年 ${S.month}月`, 'month');
  render();
  await banner(`<small>第${S.year}年</small>${S.month}月`, '#e9b949', 1000 * (anyHuman() ? 1 : spd()) + 100, 'month');
  await monthEvent();
}

function rankBarsHTML(rows, showInc) {
  const max = Math.max(1, ...rows.map(r => r.a));
  return `<div class="rank">${rows.map((r, k) => `
    <div class="rankRow">
      <span class="rk">${['🥇', '🥈', '🥉', '4'][k]}</span>
      <span class="rn" style="color:${r.p.color}">${r.p.name}</span>
      <div class="bar"><i style="width:${Math.max(3, r.a / max * 100)}%;background:${r.p.color}"></i></div>
      <span class="ra">${fmt(r.a)}${showInc ? `<small>收益 +${fmt(r.inc)}</small>` : ''}</span>
    </div>`).join('')}</div>`;
}

async function settlement() {
  await settleAllDebts();
  const rows = S.players.map((p, i) => { const inc = incomeOf(i); p.cash += inc; return { p, i, inc, a: assets(i) }; });
  rows.sort((a, b) => b.a - a.a);
  log(`💰 第${S.year}年度決算完成`, 'month');
  render();
  await banner(`<small>12月</small>💰 年度決算`, '#e9b949', 1200, 'jingle');
  await showAll(`<h3>💰 第${S.year}年度 決算</h3>${rankBarsHTML(rows, true)}
    <p class="hint">物件收益 = 價格 × 收益率；獨佔車站的物件收益加倍。</p>`, NET.mode === 'host' ? 5000 : anyHuman() ? 0 : 2500);
}

async function endGame() {
  await settleAllDebts();
  S.over = true;
  clearSave();
  const rows = S.players.map((p, i) => ({ p, a: assets(i) })).sort((a, b) => b.a - a.a);
  render();
  setStatus('遊戲結束');
  await banner(`<small>遊戲結束</small>🏆 ${rows[0].p.name}`, rows[0].p.color, 1500, 'fanfare');
  const html = `<h3>🏆 遊戲結束</h3><p><b style="color:${rows[0].p.color}">${rows[0].p.name}</b> 成為寶島鐵道大亨！</p>${rankBarsHTML(rows, false)}`;
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
  await settleAllDebts();
  render();
  await banner(`<small>臨時新聞</small>${title}`, '#c62828', 1100, 'news');
  await announce(title, body, false);
}

/* ================= 機場 ================= */
function airportAt(node) {
  const sid = G.nodes[node]?.sid;
  return AIRPORTS.includes(sid) ? sid : null;
}

/* 從某站出發的所有航線與票價（kind: flight / boat） */
function routesFrom(node, kind) {
  const sid = G.nodes[node].sid;
  const flying = kind === 'flight';
  const legacy = flying ? MAINLAND_AIRPORTS : MAINLAND_PORTS;
  const routes = flying ? ISLAND_FLIGHTS : ISLAND_BOATS;
  const choices = legacy.includes(sid) ? legacy.filter(s => s !== sid).map(s => ({node:G.stationNode[s], units:distFrom(node)[G.stationNode[s]], detail:'本島遊戲航線'})) : [];
  for (const [a,b,units,detail] of routes) {
    if (sid===a || sid===b) choices.push({node:G.stationNode[sid===a?b:a],units,detail});
  }
  return choices.map(f => ({...f, fare:Math.ceil(((flying?FLIGHT_BASE_FARE:BOAT_BASE_FARE)+f.units*(flying?FLIGHT_FARE_PER_TILE:BOAT_FARE_PER_TILE))/100)*100}));
}
function transportOptions(i, kind) {
  return routesFrom(S.players[i].pos, kind).map(f => ({...f, remaining:dist(f.node,S.goal)}))
    .sort((a,b)=>a.remaining-b.remaining || a.fare-b.fare);
}
/* 點地圖上的 ✈／⚓：列出該站可抵達的地點與票價（只看，不購票） */
function showRoutes(sid, kind) {
  const flying = kind === 'flight', name = G.stationById[sid].name;
  const rows = routesFrom(G.stationNode[sid], kind).sort((a,b) => a.fare - b.fare).map(f =>
    `<div class="cardRow"><div class="cardTxt"><b>${flying ? '飛往' : '航向'}${G.stationById[G.nodes[f.node].sid].name}</b><small>${f.detail}</small></div><b>${fmt(f.fare)}</b></div>`).join('');
  return modal(`<h3>${flying ? `✈️ ${name}機場` : `🚢 ${name}港口`}</h3>
    <p class="hint flightIntro">${flying ? '在本站開始回合時可搭機，取代該回合擲骰。' : '在本站開始回合時可搭船，取代該回合擲骰；抵達後下一回合暫停一次。'}</p>
    <div class="cards">${rows}</div>`, [{ label: '關閉', value: null }]);
}
function flightOptions(i) { return transportOptions(i,'flight'); }

// The host recomputes the fare and validates the departure, destination and cash.
function bookFlight(i, node) {
  const p = S.players[i];
  if (p.skip || p.boatRest) return null;
  const flight = flightOptions(i).find(f => f.node === node);
  if (!flight || p.cash < flight.fare) return null;
  p.cash -= flight.fare;
  log(`✈️ ${p.name} 購票：${placeName(p.pos)} → ${placeName(node)}，票價 ${fmt(flight.fare)}`);
  return { type: 'flight', node, fare: flight.fare };
}

async function chooseFlight(i) {
  const p = S.players[i];
  if (!airportAt(p.pos)) {
    await modal(`<h3>✈️ 機場</h3><p>請先停在有 ✈ 標記的機場車站，下回合擲骰前即可搭機。</p>
      <div class="cards">${AIRPORTS.map(sid => `<div class="cardRow"><b>${G.stationById[sid].name}機場</b><span>距目前 ${distanceLabel(p.pos, G.stationNode[sid])}</span></div>`).join('')}</div>`, [{ label: '返回', value: null }]);
    return null;
  }
  const options = flightOptions(i);
  return modal(`<h3>✈️ ${G.stationById[airportAt(p.pos)].name}機場</h3>
    <p>現金：<b>${fmt(p.cash)}</b></p><p class="hint flightIntro">搭機取代本回合擲骰，抵達後可購買物件、領取目的地獎勵。票價：基本 ${fmt(FLIGHT_BASE_FARE)}＋每計費格 ${fmt(FLIGHT_FARE_PER_TILE)}，向上取整至百萬。離島採航線計費距離，車站至機場／碼頭接駁已包含。</p>
    `,
    [...options.map(f => ({ label: `<span class="flightRow"><span><b>飛往${G.stationById[G.nodes[f.node].sid].name}</b><small>${f.detail}</small><small>${f.remaining === 0 ? '🚩 直接抵達目的地' : `抵達後：${distanceLabel(f.node,S.goal)}`}${p.cash < f.fare ? ' · 現金不足' : ''}</small></span><b>${fmt(f.fare)}</b></span>`, value: f.node, disabled: p.cash < f.fare })), { label: '取消', value: null }]);
}

/* ================= 港口 ================= */
function portAt(node) {
  const sid = G.nodes[node]?.sid;
  return PORTS.includes(sid) ? sid : null;
}

function boatOptions(i) { return transportOptions(i,'boat'); }

// The host recomputes the fare and validates the departure, destination and cash.
function bookBoat(i, node) {
  const p = S.players[i];
  if (p.skip || p.boatRest) return null;
  const flight = boatOptions(i).find(f => f.node === node);
  if (!flight || p.cash < flight.fare) return null;
  p.cash -= flight.fare;
  log(`🚢 ${p.name} 購票：${placeName(p.pos)} → ${placeName(node)}，票價 ${fmt(flight.fare)}`);
  return { type: 'boat', node, fare: flight.fare };
}

async function chooseBoat(i) {
  const p = S.players[i];
  if (!portAt(p.pos)) {
    await modal(`<h3>🚢 港口</h3><p>請先停在有 ⚓ 標記的港口車站，下回合擲骰前即可搭船；搭船抵達後，還需暫停下一回合。</p>
      <div class="cards">${PORTS.map(sid => `<div class="cardRow"><b>${G.stationById[sid].name}港口</b><span>距目前 ${distanceLabel(p.pos, G.stationNode[sid])}</span></div>`).join('')}</div>`, [{ label: '返回', value: null }]);
    return null;
  }
  const options = boatOptions(i);
  return modal(`<h3>🚢 ${G.stationById[portAt(p.pos)].name}港口</h3>
    <p>現金：<b>${fmt(p.cash)}</b></p><p class="hint flightIntro">搭船取代本回合擲骰，<b>下一回合暫停一次</b>。抵達後可購買物件、領取目的地獎勵。票價：基本 ${fmt(BOAT_BASE_FARE)}＋每計費格 ${fmt(BOAT_FARE_PER_TILE)}，向上取整至百萬。離島採航線計費距離，車站至機場／碼頭接駁已包含。</p>
    `,
    [...options.map(f => ({ label: `<span class="flightRow"><span><b>航向${G.stationById[G.nodes[f.node].sid].name}</b><small>${f.detail}</small><small>${f.remaining === 0 ? '🚩 直接抵達目的地' : `抵達後：${distanceLabel(f.node,S.goal)}`}${p.cash < f.fare ? ' · 現金不足' : ''}</small></span><b>${fmt(f.fare)}</b></span>`, value: f.node, disabled: p.cash < f.fare })), { label: '取消', value: null }]);
}

/* ================= 卡片 ================= */
async function applyCard(i, idx, target) {
  const p = S.players[i], key = p.cards[idx], c = CARDS[key];
  if (!Number.isInteger(idx) || !c) return null;
  const acquisition = c.kind === 'acquire' ? acquisitionOptions(i).find(o => o.key === target) : null;
  if (c.kind === 'acquire' && (!acquisition || p.cash < acquisition.price)) return null;
  if (G.nodes[p.pos].island && c.kind === 'move') return null;
  if (key === 'charm' && S.curse.holder !== i) return null;
  if (c.kind === 'stop' && (target == null || target === i || !S.players[target])) return null;
  p.cards.splice(idx, 1);
  if (acquisition) {
    p.cash -= acquisition.price;
    S.players[acquisition.owner].cash += acquisition.price;
    S.owner[acquisition.key] = i;
  }
  log(`🃏 ${p.name} 使用了「${c.name}」`);
  render();
  await message('🃏 使用卡片', `${p.name} 使用了 <b>「${c.name}」</b>`, 1100 * (p.cpu ? spd() : 1) + 200);
  switch (c.kind) {
    case 'move': return { type: 'roll', dice: c.dice };
    case 'warp': {
      const opts = STATIONS.map(s => G.stationNode[s.id]).filter(n => n !== p.pos);
      return { type: 'warp', node: pick(opts) };
    }
    case 'near': {
      const d = distFrom(S.goal);
      let opts = G.nodes.filter(n => d[n.id] >= 1 && d[n.id] <= 3).map(n => n.id);
      if (!opts.length && G.nodes[S.goal].island) {
        const sid = G.nodes[S.goal].sid;
        opts = [...new Set([...ISLAND_FLIGHTS,...ISLAND_BOATS].filter(([a,b])=>a===sid || b===sid).map(([a,b])=>G.stationNode[a===sid?b:a]))];
      }
      return { type: 'warp', node: pick(opts) };
    }
    case 'acquire':
      await note(i, `🤝 ${p.name} 支付 ${fmt(acquisition.price)} 給 ${S.players[acquisition.owner].name}，收購「${acquisition.name}」`, 'buy');
      return null;
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
      floatAll(p.pos, '+' + fmt(g), '#ffd54f');
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
      floatAll(S.players[t].pos, '-' + fmt(amt), '#ff8a80');
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
    const dis = (k === 'charm' && S.curse.holder !== i) || (G.nodes[p.pos].island && c.kind === 'move') || (c.kind === 'acquire' && !acquisitionOptions(i).some(o=>p.cash>=o.price));
    return `<div class="cardRow"><div class="cardIco">${c.kind === 'move' ? '🚄' : c.kind === 'warp' || c.kind === 'near' ? '✨' : c.kind === 'acquire' ? '🤝' : c.kind === 'stop' ? '⛔' : c.kind === 'charm' ? '🧧' : '💰'}</div>
      <div class="cardTxt"><b>${c.name}</b><small>${c.desc}</small></div>
      <button class="btn sm primary" data-use="${idx}" type="button" ${dis ? 'disabled title="目前無法使用這張卡片"' : ''}>使用</button></div>`;
  }).join('');
  return new Promise(res => {
    modal(`<h3>🃏 ${p.name} 的卡片（${p.cards.length}/8）</h3><div class="cards">${rows}</div>`, [{ label: '關閉', value: null }]).then(res);
    $('#modal .box').querySelectorAll('[data-use]').forEach(el => {
      el.onclick = () => { $('#modal').classList.add('hidden'); res(+el.dataset.use); };
    });
  });
}

/* ================= 玩家操作 ================= */
/* 向玩家 i 詢問一個決定：本機玩家直接顯示介面，遠端玩家透過網路詢問 */
function askFallback(kind) {
  if (kind === 'debt') return null;
  if (kind === 'menu') return { type: 'roll' };
  if (kind === 'end') return null;
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
  if (kind === 'debt') return chooseDebtSale(data.i);
  if (kind === 'menu') return localMenu(data.i);
  if (kind === 'end') return localChooseEnd(data);
  if (kind === 'station') return localStation(data.i, G.stationById[data.sid]);
  return null;
}

/* 指令視窗 */
async function localMenu(i) {
  const p = S.players[i];
  for (;;) {
    const pr = setActions(
      `<span class="dot" style="background:${p.color}"></span>${p.name}<small>距目的地 ${distanceLabel(p.pos, S.goal)}</small>`,
      [{ label: G.nodes[p.pos].island ? `🏝️ 留島經營 ＋${fmt(ISLAND_STAY_INCOME)}` : '🎲 擲骰子', value: G.nodes[p.pos].island ? 'stay' : 'roll', cls: 'primary' },
        { label: airportAt(p.pos) ? '✈️ 搭飛機' : '✈️ 機場資訊', value: 'flight' },
        { label: portAt(p.pos) ? '🚢 搭船' : '⚓ 港口資訊', value: 'boat' },
        { label: `🃏 卡片 <small>${p.cards.length}</small>`, value: 'cards', disabled: !p.cards.length },
        { label: '🏢 物件資料', value: 'props' },
        { label: '🚩 看目的地', value: 'goal' },
        { label: `${twIcon(17)} 全國地圖`, value: 'map' },
        { label: '🏝️ 離島地圖', value: 'islands' },
        { label: '📊 排行榜', value: 'rank' }]);
    if (zoom > 1.05) focusNode(p.pos, true);
    const v = await pr;
    if (v === 'stay') return { type: 'stay' };
    if (v === 'roll') { await diceWaitTap(1); return { type: 'roll' }; }
    if (v === 'flight' || v === 'boat') {
      const node = await (v === 'flight' ? chooseFlight(i) : chooseBoat(i));
      if (node != null) return { type: v, node };
      continue;
    }
    if (v === 'islands') { await viewIslands(); continue; }
    if (v === 'props') { await showProps(i); continue; }
    if (v === 'rank') { await showRanking(); continue; }
    if (v === 'goal') { await viewNode(S.goal, `🚩 目的地：${placeName(S.goal)}`); continue; }
    if (v === 'map') { await viewOverview(); continue; }
    if (v === 'cards') {
      const idx = await chooseCard(i);
      if (idx == null) continue;
      let target = null;
      if (CARDS[p.cards[idx]].kind === 'acquire') { target = await chooseAcquisition(i); if (target == null) continue; }
      if (CARDS[p.cards[idx]].kind === 'stop') { target = await chooseTarget(i); if (target == null) continue; }
      return { type: 'card', idx, target };
    }
  }
}

async function viewNode(node, title) {
  const pr = setActions(title, [{ label: '↩ 返回', value: 1, cls: 'primary' }]);
  focusNode(node, true);
  await pr;
  focusNode(S.players[S.turn].pos, true);
}
async function viewIslands() {
  const sid = await modal(`<h3>🏝️ 離島地圖</h3><p>離島需搭飛機或船抵達，不能用骰子跨海。每島只有一站，不能擲骰移動；可購買交通票離開，或留島經營一回合領取 500 萬。搭船後下一回合暫停一次。</p><p class="hint">台北代表松山機場；嘉義／屏東／墾丁／台東分別包含布袋／東港／後壁湖／富岡接駁。地圖為分區示意，不按真實比例；票價與時間採遊戲規則。離島航線參考現實，本島原有航線仍為遊戲設定。</p>`, ISLANDS.map(island=>({label:`查看${island.name}`,value:island.id})).concat([{label:'返回',value:null}]));
  if (sid) await viewNode(G.stationNode[sid],`🏝️ ${G.stationById[sid].name}・單站・可購票離開或留島經營`);
}
async function viewOverview() {
  const z = zoom;
  const pr = setActions(`${twIcon(18)} 全國地圖`, [{ label: '↩ 返回', value: 1, cls: 'primary' }]);
  zoom = 1; applyZoom();
  focusXY(ISLAND_CENTER[0], ISLAND_CENTER[1]);
  $('#btnOverview').classList.add('on');
  await pr;
  zoom = z; applyZoom();
  $('#btnOverview').classList.toggle('on', zoom <= 1.05);
  focusNode(S.players[S.turn].pos);
}

/* 用箭頭一步一步前進；也可以直接點虛線圈跳到終點。可以退回。 */
function localChooseEnd(data) {
  return new Promise(res => {
    const i = S.turn, p = S.players[i];
    const ends = new Map(data.ends);
    const total = data.total;
    const path = [data.start];
    let finished = false;
    const cmd = $('#cmd');
    $('#status').classList.add('hidden');
    const finish = fp => {
      if (finished) return;
      finished = true;
      stepClick = null;
      $('#lyHL').innerHTML = '';
      cmd.classList.add('hidden');
      NET.justStepped = true;
      res({ path: fp });
    };
    const draw = () => {
      const cur = path[path.length - 1], prev = path.length > 1 ? path[path.length - 2] : -1;
      const left = total - (path.length - 1);
      p.pos = cur;
      renderTokens();
      if (NET.mode === 'host') netSend({ t: 'pos', pos: S.players.map(q => q.pos), curse: S.curse, mover: i });
      if (left <= 0 || (cur === S.goal && path.length > 1)) { setTimeout(() => finish(path.slice()), 250); }
      let h = '';
      for (const [node] of ends) {
        const n = G.nodes[node];
        h += `<circle cx="${n.x}" cy="${n.y}" r="17" class="hl" data-end="${node}"/>`;
      }
      const options = left > 0 && !(cur === S.goal && path.length > 1) ? forwardOpts(cur, prev) : [];
      for (const nb of options) {
        const n = G.nodes[nb], r = n.type === 'station' ? 19 : 14;
        h += `<rect class="stepTarget" data-step="${nb}" x="${n.x - r}" y="${n.y - r}" width="${r * 2}" height="${r * 2}" rx="7"><title>前進到${placeName(nb)}</title></rect>`;
      }
      $('#lyHL').innerHTML = h;
      cmd.className = 'win stepWin';
      cmd.innerHTML = `<div class="cmdTitle"><span class="dot" style="background:${p.color}"></span>剩下 <b class="left">${Math.max(0, left)}</b> 步</div>
        <div class="hint">點方框或下方方向前進；點閃爍圓圈直接停</div>
        <div class="cmdList">${options.map(nb => {
          const n = G.nodes[nb], c = G.nodes[cur];
          const arrow = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'][(Math.round(Math.atan2(n.y - c.y, n.x - c.x) / (Math.PI / 4)) + 8) % 8];
          const symbol = { blue: '+', red: '−', yellow: '?', station: '站' }[n.type];
          return `<button class="cmdBtn directionBtn" data-step="${nb}" type="button">${arrow} <span class="tileLegend ${n.type}">${symbol}</span> ${placeName(nb)}</button>`;
        }).join('')}<button class="cmdBtn" id="btnUndo" type="button" ${path.length <= 1 ? 'disabled' : ''}>↩ 退一步</button></div>`;
      cmd.classList.remove('hidden');
      if (zoom > 1.05 || path.length === 1) focusNode(cur, path.length === 1);
      cmd.querySelectorAll('[data-step]').forEach(button => { button.onclick = () => stepClick && stepClick(button); });
      $('#btnUndo').onclick = () => { if (path.length > 1 && !finished) { path.pop(); draw(); } };
    };
    stepClick = el => {
      if (finished) return;
      if (el.dataset.end != null) {
        const fp = ends.get(+el.dataset.end);
        if (fp) { p.pos = fp[fp.length - 1]; renderTokens(); finish(fp.slice()); }
        return;
      }
      const nb = +el.dataset.step;
      const cur = path[path.length - 1], prev = path.length > 1 ? path[path.length - 2] : -1;
      if (!forwardOpts(cur, prev).includes(nb)) return;
      path.push(nb);
      sfx('step');
      draw();
    };
    draw();
  });
}

async function humanPreRoll(i) {
  const p = S.players[i];
  for (;;) {
    const a = await ask(i, 'menu', { i });
    if (a && (a.type === 'flight' || a.type === 'boat')) {
      const flight = a.type === 'flight' ? bookFlight(i, a.node) : bookBoat(i, a.node);
      if (flight) return flight;
      continue;
    }
    if (!a || a.type !== 'card') return G.nodes[p.pos].island ? { type: 'stay' } : { type: 'roll', dice: 1 };
    const idx = +a.idx;
    if (!(idx >= 0 && idx < p.cards.length)) continue;
    const r = await applyCard(i, idx, a.target == null ? null : CARDS[p.cards[idx]].kind === 'acquire' ? a.target : +a.target);
    render();
    if (r) return r;
  }
}

/* 回傳 {path, animate}：本機玩家已經自己走過了，不必再播動畫 */
async function humanChooseEnd(i, ends, total) {
  const p = S.players[i];
  const start = p.pos;
  const keys = [...ends.keys()].sort((a, b) => dist(a, S.goal) - dist(b, S.goal));
  if (keys.length === 1) return { path: ends.get(keys[0]), animate: true };
  const v = await ask(i, 'end', { start, total, ends: [...ends.entries()] });
  $('#lyHL').innerHTML = '';
  const remote = !!p.peer || p.offline;
  if (v && validPath(v.path, start, total)) return { path: v.path, animate: remote };
  p.pos = start;
  return { path: ends.get(keys[0]), animate: true };
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
      floatAll(p.pos, '🏠 ' + pr[0], '#fff');
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

/* 車站物件視窗：每點一次就回傳一個動作（購買物件／買卡／離開），由引擎處理後再重畫 */
function localStation(i, s) {
  return new Promise(res => {
    const m = $('#modal'), box = m.querySelector('.box'), p = S.players[i];
    const draw = () => {
      modalSeq++;
      const mono = monoOwner(s.id);
      let h = `<h3 class="stTitle">🚉 ${s.name}站${s.shop ? ' <small class="tag shopTag">卡片商店</small>' : ''}</h3>
        <p class="cashline">${p.name} 的現金：<b class="${p.cash < 0 ? 'neg' : ''}">${fmt(p.cash)}</b></p><div class="propList">`;
      s.props.forEach((pr, k) => {
        const o = S.owner[s.id + ':' + k];
        h += `<div class="propRow${o != null ? ' sold' : ''}">
          <span class="tag ${pr[3]}">${TYPE_NAME[pr[3]]}</span>
          <span class="pn">${pr[0]}</span>
          <span class="pp">${fmt(pr[1])}</span>
          <span class="pr">${pr[2]}%</span>
          <span class="pa">${o == null
    ? `<button class="btn sm primary" data-buy="${k}" type="button" ${p.cash < pr[1] ? 'disabled' : ''}>買</button>`
    : `<span class="owner" style="color:${S.players[o].color}">${S.players[o].name}</span>`}</span></div>`;
      });
      h += '</div>';
      h += mono != null ? `<p class="hint">★ ${S.players[mono].name} 獨佔此站，收益加倍！</p>` : '<p class="hint">買下同一站的全部物件即可「獨佔」，決算收益加倍。</p>';
      if (s.shop) {
        h += '<h4>🃏 卡片商店</h4><div class="cards">';
        SHOP_CARDS.forEach(k => {
          const c = CARDS[k];
          h += `<div class="cardRow"><div class="cardTxt"><b>${c.name}</b> <small>${fmt(c.price)}</small><small>${c.desc}</small></div>
            <button class="btn sm" data-card="${k}" type="button" ${p.cash < c.price || p.cards.length >= 8 ? 'disabled' : ''}>買</button></div>`;
        });
        h += `</div><p class="hint">手牌 ${p.cards.length}/8</p>`;
      }
      h += '<div class="btns"><button class="btn primary" data-done="1" type="button">離開車站</button></div>';
      box.innerHTML = h;
      const lock = () => { modalDismiss = null; box.querySelectorAll('button').forEach(b => { b.disabled = true; }); };
      const leave = () => { m.classList.add('hidden'); modalDismiss = null; res({ done: true }); };
      box.querySelectorAll('[data-buy]').forEach(el => el.onclick = () => { lock(); res({ buy: +el.dataset.buy }); });
      box.querySelectorAll('[data-card]').forEach(el => el.onclick = () => { lock(); res({ card: el.dataset.card }); });
      box.querySelector('[data-done]').onclick = leave;
      addClose(box, leave);
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
    return `<div class="propRow${o != null ? ' sold' : ''}"><span class="tag ${pr[3]}">${TYPE_NAME[pr[3]]}</span><span class="pn">${pr[0]}</span><span class="pp">${fmt(pr[1])}</span><span class="pr">${pr[2]}%</span>
      <span class="pa">${o == null ? '<small>未售出</small>' : `<span class="owner" style="color:${S.players[o].color}">${S.players[o].name}</span>`}</span></div>`;
  }).join('');
  const d = S.players.map((p, i) => `<span style="color:${p.color}">${i + 1}.${p.name}</span> ${dist(p.pos, G.stationNode[sid])}格`).join('　');
  modal(`<h3 class="stTitle">🚉 ${s.name}站${s.shop ? ' <small class="tag shopTag">卡片商店</small>' : ''}</h3>
    <div class="propList">${rows}</div><p class="hint">距離：${d}</p>`, [{ label: '關閉', value: true }]);
}

function showProps(i) {
  const p = S.players[i];
  const by = {};
  ownedKeys(i).forEach(k => { const sid = k.split(':')[0]; (by[sid] = by[sid] || []).push(propOf(k)); });
  const body = Object.keys(by).length ? Object.entries(by).map(([sid, prs]) => `
    <div class="ownGroup"><b>${G.stationById[sid].name}站</b>${monoOwner(sid) === i ? ' <small class="tag mono">獨佔</small>' : ''}<br>
    <small>${prs.map(pr => `${pr[0]}（${fmt(pr[1])}・${pr[2]}%）`).join('、')}</small></div>`).join('') : '<p>還沒有任何物件。</p>';
  return modal(`<h3>🏢 ${p.name} 的物件</h3>
    <div class="statGrid"><div><small>現金</small><b>${fmt(p.cash)}</b></div><div><small>總資產</small><b>${fmt(assets(i))}</b></div><div><small>預估年收益</small><b>${fmt(incomeOf(i))}</b></div></div>
    ${body}<p class="hint">卡片：${p.cards.map(k => CARDS[k].name).join('、') || '無'}</p>`, [{ label: '關閉', value: true }]);
}

function showRanking() {
  const rows = S.players.map((p, i) => ({ p, a: assets(i), inc: incomeOf(i) })).sort((a, b) => b.a - a.a);
  return modal(`<h3>📊 總資產排行</h3>${rankBarsHTML(rows, true)}<p class="hint">收益為目前物件的預估年收益</p>`, [{ label: '關閉', value: true }]);
}

/* ================= 電腦 AI ================= */
async function cpuPreRoll(i) {
  const p = S.players[i];
  setStatus(`🤖 <b style="color:${p.color}">${p.name}</b> 思考中…`);
  await sleep(500 * spd());
  const useKey = async (key, target) => { const idx = p.cards.indexOf(key); return idx >= 0 ? applyCard(i, idx, target) : null; };
  if (S.curse.holder === i && p.cards.includes('charm')) await useKey('charm');
  while (p.cards.includes('redpacket')) await useKey('redpacket');
  if (p.cards.includes('tax') && S.players.some((q, j) => j !== i && q.cash > 3000)) await useKey('tax');
  if (p.cards.includes('acquire')) {
    const option = acquisitionOptions(i).filter(o=>p.cash-o.price>=1500*yf()).sort((a,b)=>b.income/b.price-a.income/a.price)[0];
    if (option) await useKey('acquire',option.key);
  }
  const d = dist(p.pos, S.goal);
  if (p.cards.includes('stop')) {
    let lead = -1, ld = Infinity;
    S.players.forEach((q, j) => { if (j !== i && !q.skip && !q.boatRest) { const qd = dist(q.pos, S.goal); if (qd < ld) { ld = qd; lead = j; } } });
    if (lead >= 0 && ld < d && ld <= 12) await useKey('stop', lead);
  }
  render();
  if (d > 8 && p.cards.includes('near')) return useKey('near');
  const transport = [...flightOptions(i).map(f => ({ ...f, type: 'flight' })), ...boatOptions(i).map(f => ({ ...f, type: 'boat' }))]
    .map(f => ({ ...f, effectiveDistance: f.remaining + (f.type === 'boat' ? 4 : 0) }))
    .filter(f => { const crossing = !Number.isFinite(distFrom(p.pos)[S.goal]); return d - f.effectiveDistance >= (crossing ? 1 : 12) && p.cash - f.fare >= (crossing ? 0 : 1500 * yf()); })
    .sort((a, b) => a.effectiveDistance - b.effectiveDistance || a.fare - b.fare)[0];
  if (transport) return transport.type === 'flight' ? bookFlight(i, transport.node) : bookBoat(i, transport.node);
  if (G.nodes[p.pos].island) {
    if (p.cards.includes('warp')) return useKey('warp');
    return { type: 'stay' };
  }
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
    floatAll(p.pos, '🏠×' + bought.length, '#fff');
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
  if (p.cards.length < 8 && !p.cards.includes('acquire') && p.cash > CARDS.acquire.price + reserve * 3 && Object.values(S.owner).some(owner=>owner!==i)) await buy('acquire');
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
<p><b>目標：</b>遊戲年數結束時，<b>總資產（現金＋物件）最多</b>的人獲勝。每年從 1 月開始，12 月底決算。</p>
<p><b>回合：</b>輪到你時，從指令視窗選「擲骰子」，點一下讓骰子停下。接著點地圖上的 <b>方框或操作面板的方向</b> 一步一步前進（可以退回），或直接點 <b>閃爍的圈</b> 停在那一格。</p>
<p><b>✈️ 機場：</b>台北、桃園、台中、高雄、花蓮、台東可搭機。在機場車站開始回合時，選「搭飛機」並支付票價，取代該回合擲骰。抵達後照常購物與領取目的地獎勵；飛行不觸發沿途格子，也不會甩掉衰尾道人。票價為基本 1500 萬＋鐵路每格 80 萬，向上取整至百萬。</p>
<p><b>⚓ 港口：</b>基隆、蘇澳、花蓮、台中、高雄可搭船。必須停在港口車站，下回合擲骰前選「搭船」並購票，取代本回合擲骰；路過港口不能搭船。搭船後下一回合暫停一次，再下回合恢復行動。抵達後照常購物與領取目的地獎勵，不觸發沿途格子，也不會甩掉衰尾道人。船票為基本 800 萬＋鐵路每格 40 萬，向上取整至百萬。</p>
<p><b>🏝️ 離島：</b>澎湖、金門、馬祖、綠島、蘭嶼、小琉球各只有一個站點與物件，島內不能移動。可選「留島經營」花一回合領取 500 萬，存夠交通費再離開；搭船後暫停的回合不發經營收入。只能沿指定航空／船運路線進出（卡片效果除外）；小琉球沒有機場，金門本版僅提供航空。港口、機場接駁合併於對應車站。跨海距離顯示為轉乘估算，不是骰子可走的格數。</p>
<p><b>🚩 目的地：</b>用輪盤決定。第一個抵達的人拿到大筆獎金（年份越後面越多），接著轉出新的目的地。路過目的地會自動停下。</p>
<p><b>格子：</b><span class="sw blue"></span>藍色格拿錢　<span class="sw red"></span>紅色格扣錢　<span class="sw yellow"></span>黃色格抽卡　<span class="sw st"></span>車站可購買物件（紫框車站有卡片商店）</p>
<p><b>物件與獨佔：</b>每年決算時，物件帶來「價格 × 收益率」的收入。買下同一站全部物件即可<b>獨佔</b>，收益加倍。</p>
<p><b>🏦 負債變賣：</b>現金變負時，玩家逐項選擇物件，以原價一半變賣，直到還清或無物件可賣。售出物件重新開放購買，獨佔收益也重新計算；賣完仍不足則保留負債。電腦或斷線代打優先出售基礎年收益較低的物件。</p>
<p><b>🤝 收購卡：</b>擲骰前，在目前車站選一項對手物件，付原價 2 倍給原持有人並取得所有權。不足現金、無有效目標或取消不消耗卡片。可由卡片格抽得或在商店以 2000 萬購買。</p>
<p><b>🌧️ 衰尾道人：</b>有人抵達目的地時，離目的地最遠的玩家會被衰尾道人纏上，每回合亂花錢、丟卡片、賤賣物件。久了還會變成更恐怖的<b>大衰尾 ⛈️</b>。移動時經過或停在其他玩家所在的格子，就能把它甩給對方！平安符可以直接趕走它。</p>
<p><b>🃏 卡片：</b>莒光號／自強號／高鐵卡可以一次擲多顆骰子；停駛卡讓對手停一回合；瞬移卡、導航卡可以傳送；紅包卡、查稅卡可以賺錢。</p>
<p><b>其他：</b>每個月有機率發生颱風、美食爆紅等事件。遊戲每回合自動存檔。左側的 ${twIcon(15)} 按鈕可以切換全國地圖。</p>
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
  window.addEventListener('resize', () => { if (S) { applyZoom(); focusNode(S.players[S.turn].pos); } });
  setupMapGestures();
  $('#zoomIn').onclick = () => setZoom(zoom * 1.25);
  $('#zoomOut').onclick = () => setZoom(zoom / 1.25);
  $('#zoomFocus').onclick = () => S && focusNode(S.players[S.turn].pos, true);
  $('#btnOverview').innerHTML = twIcon(26);
  $('#btnOverview').onclick = toggleOverview;
  $('#goalInfo').onclick = () => { if (S) { if (zoom < 1.5) setZoom(2, S.goal); else focusNode(S.goal, true); } };
  $('#btnRules2').onclick = () => modal(RULES, [{ label: '了解', value: true, cls: 'primary' }]);
  $('#btnLog').onclick = () => $('#logDrawer').classList.toggle('hidden');
  $('#btnSound').textContent = soundIcon();
  $('#btnSound').onclick = () => { toggleMute(); $('#btnSound').textContent = soundIcon(); };
  $('#btnLogClose').onclick = () => $('#logDrawer').classList.add('hidden');
  $('#btnMenu').onclick = async () => {
    const v = await modal(`<h3>☰ 選單</h3><p class="hint">${NET.mode === 'host' ? '你是房主：離開會讓所有人的遊戲中斷。' : NET.mode === 'client' ? '離開後，用同樣的名字重新加入就能接回位置。' : '遊戲每回合開始時自動存檔，回到標題後可以「繼續上次」。'}</p>`,
      [{ label: `🎵 音樂：${SND.bgmOn ? '開' : '關'}`, value: 'bgm' }, { label: `🔔 音效：${SND.sfxOn ? '開' : '關'}`, value: 'sfx' },
        { label: '📖 遊戲規則', value: 'rules' }, { label: '🏠 回到標題', value: 'title' }, { label: '取消', value: null, cls: 'primary' }]);
    if (v === 'bgm') { toggleBgm(); toast(`🎵 背景音樂已${SND.bgmOn ? '開啟' : '關閉'}`); }
    if (v === 'sfx') { toggleSfx(); toast(`🔔 音效已${SND.sfxOn ? '開啟' : '關閉'}`); }
    if (v === 'rules') modal(RULES, [{ label: '了解', value: true, cls: 'primary' }]);
    if (v === 'title') location.reload();
  };
  $('#map').addEventListener('click', e => {
    if (dragMoved) { dragMoved = false; return; }
    const stepEl = e.target.closest('[data-step],[data-end]');
    if (stepEl) {
      if (stepClick) stepClick(stepEl);
      else if (stepEl.dataset.end != null && actResolve) actResolve(+stepEl.dataset.end);
      return;
    }
    // App 版螢幕小：點地圖時把下方視窗縮成小標籤，方便看地圖
    if (window.AndroidApp) ['#cmd', '#msg'].forEach(s => { if (!$(s).classList.contains('hidden')) $(s).classList.add('mini'); });
    const tr = e.target.closest('[data-tr]');
    if (tr && $('#modal').classList.contains('hidden')) { showRoutes(tr.dataset.sid, tr.dataset.tr); return; }
    const st = e.target.closest('.st');
    if (st && S && $('#modal').classList.contains('hidden')) stationInfo(G.nodes[+st.dataset.node].sid);
  });
  $('#players').addEventListener('click', e => {
    const el = e.target.closest('[data-p]');
    if (el && S && $('#modal').classList.contains('hidden')) { const i = +el.dataset.p; focusNode(S.players[i].pos, true); showProps(i); }
  });
  $('#modal').addEventListener('click', e => { if (e.target === e.currentTarget) dismissModal(); });
  // 縮小中的下方視窗：這一下只負責展開，不會按到按鈕或跳過訊息
  ['#cmd', '#msg'].forEach(s => $(s).addEventListener('click', e => {
    if (!e.currentTarget.classList.contains('mini')) return;
    e.currentTarget.classList.remove('mini');
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true));
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
  // Android 版發現新版時會帶 ?update=版本 重新載入，必須更新才能遊玩
  const upd = new URLSearchParams(location.search).get('update');
  if (upd && window.AndroidApp && /^\d+\.\d+\.\d+$/.test(upd)) { showAppUpdate(upd); return; }
  showSetup();
  if (typeof netInit === 'function') netInit();
}

/* ================= App 更新（僅 Android 版） ================= */
/* 畫面由 Android 端呼叫 appUpdate.* 推進：progress → ready → (permission) → 安裝 */
function showAppUpdate(ver) {
  const box = $('#modal .box');
  const view = (body, buttons) => {
    box.innerHTML = `<h3>🚂 發現新版本</h3><p>目前版本 v${AndroidApp.version()}　→　新版本 <b>v${ver}</b></p>${body}<div class="btns">${
      buttons.map(b => `<button class="btn ${b.cls || ''}" type="button" data-a="${b.a}">${b.label}</button>`).join('')}</div>`;
    box.querySelectorAll('[data-a]').forEach(el => { el.onclick = () => act[el.dataset.a](); });
  };
  const act = { download: () => { AndroidApp.download(ver); appUpdate.progress(0); }, install: () => AndroidApp.install(), allow: () => AndroidApp.allowInstall(), quit: () => AndroidApp.quit() };
  const quit = { label: '離開', a: 'quit' };
  window.appUpdate = {
    start: () => view('<p>為了讓大家連線對戰時使用相同的遊戲版本，需要先更新才能繼續遊玩。</p>', [quit, { label: '⬇️ 下載更新', a: 'download', cls: 'primary' }]),
    progress: pct => view(`<div class="upBar"><i style="width:${Math.max(pct, 0)}%"></i></div><p class="hint">下載中…${pct >= 0 ? ' ' + pct + '%' : ''}</p>`, [quit]),
    ready: () => view('<div class="upBar"><i style="width:100%"></i></div><p>下載完成！請在接下來的畫面按「安裝」。</p>', [quit, { label: '📦 安裝', a: 'install', cls: 'primary' }]),
    permission: () => view('<p>第一次更新需要允許本 App 安裝更新檔。<br>請在設定中開啟「允許這個來源」，返回後會自動繼續安裝。</p>', [quit, { label: '⚙️ 前往設定', a: 'allow', cls: 'primary' }]),
    failed: () => view('<p class="err">下載或安裝失敗，請確認網路後重試。</p>', [quit, { label: '🔄 重試', a: 'download', cls: 'primary' }]),
  };
  modalDismiss = null; // 必須更新，不能關閉
  appUpdate.start();
  $('#modal').classList.remove('hidden');
}

/* Android 返回鍵／手勢：先關掉可關閉的視窗；沒有可關的就要連按兩次才離開，避免誤觸中斷遊戲。回傳 false 才讓 App 離開 */
let lastBack = 0;
function appBack() {
  if (dismissModal()) return true;
  if (Date.now() - lastBack < 2000) return false;
  lastBack = Date.now();
  toast(NET.mode === 'host' ? '再按一次返回鍵離開（你是房主，離開會中斷所有人的遊戲）' : '再按一次返回鍵離開遊戲');
  return true;
}

document.addEventListener('DOMContentLoaded', init);
