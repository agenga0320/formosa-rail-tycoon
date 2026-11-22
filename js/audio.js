'use strict';
/* 寶島鐵道大亨 — 背景音樂與音效
 * 全部用 Web Audio API 即時合成：旋律為原創，不需要任何音檔。
 * 瀏覽器規定要使用者點過畫面後才能出聲，所以第一次點擊時才建立 AudioContext。
 */
const SND = { ctx: null, master: null, bgm: null, sfx: null, bgmOn: true, sfxOn: true, muted: false };
const BGM_VOL = 0.2;
const SND_KEY = 'formosa-rail-tycoon-sound';
try {
  const s = JSON.parse(localStorage.getItem(SND_KEY));
  if (s) { SND.bgmOn = s.bgmOn !== false; SND.sfxOn = s.sfxOn !== false; SND.muted = !!s.muted; }
} catch (e) { /* ignore */ }

function soundSave() {
  try { localStorage.setItem(SND_KEY, JSON.stringify({ bgmOn: SND.bgmOn, sfxOn: SND.sfxOn, muted: SND.muted })); } catch (e) { /* ignore */ }
}

function audioInit() {
  try {
    if (!SND.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const c = new AC();
      SND.ctx = c;
      SND.master = c.createGain();
      SND.master.connect(c.destination);
      SND.bgm = c.createGain();
      SND.bgm.gain.value = BGM_VOL;
      SND.bgm.connect(SND.master);
      SND.sfx = c.createGain();
      SND.sfx.gain.value = 0.55;
      SND.sfx.connect(SND.master);
      applyVolume();
    }
    if (SND.ctx.state === 'suspended') SND.ctx.resume();
  } catch (e) { /* ignore */ }
}

function applyVolume() {
  if (SND.ctx) SND.master.gain.setTargetAtTime(SND.muted ? 0 : 1, SND.ctx.currentTime, 0.02);
}

/* ---- 合成基本元件 ---- */
const NOTE_IDX = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
function nf(n) {
  const m = /^([A-G]#?)(\d)$/.exec(n);
  return 440 * Math.pow(2, ((+m[2] + 1) * 12 + NOTE_IDX[m[1]] - 69) / 12);
}

function tone(dest, freq, t, dur, o = {}) {
  const c = SND.ctx, osc = c.createOscillator(), g = c.createGain();
  osc.type = o.type || 'square';
  osc.frequency.setValueAtTime(freq, t);
  if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
  const v = o.vol == null ? 0.3 : o.vol;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + (o.attack || 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g); g.connect(dest);
  osc.start(t); osc.stop(t + dur + 0.03);
}

let noiseBuf = null;
function noise(dest, t, dur, o = {}) {
  const c = SND.ctx;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.6), c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = noiseBuf;
  f.type = o.ftype || 'highpass';
  f.frequency.setValueAtTime(o.freq || 1000, t);
  if (o.sweep) f.frequency.exponentialRampToValueAtTime(o.sweep, t + dur);
  g.gain.setValueAtTime(o.vol == null ? 0.2 : o.vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(dest);
  src.start(t); src.stop(t + dur + 0.03);
}

/* ---- 音效 ---- */
const arp = (d, t, notes, gap, len, o) => notes.forEach((n, k) => tone(d, nf(n), t + k * gap, len, o));
const SFX = {
  click: (t, d) => tone(d, 1250, t, 0.045, { vol: 0.12 }),
  tick: (t, d) => noise(d, t, 0.03, { vol: 0.1, freq: 3500 }),
  dice: (t, d) => { noise(d, t, 0.14, { vol: 0.35, ftype: 'lowpass', freq: 900 }); tone(d, 170, t, 0.18, { type: 'triangle', vol: 0.45, slide: 80 }); },
  step: (t, d) => { tone(d, nf('C5'), t, 0.06, { type: 'triangle', vol: 0.22 }); tone(d, nf('G5'), t + 0.05, 0.08, { type: 'triangle', vol: 0.18 }); },
  coin: (t, d) => { tone(d, nf('B5'), t, 0.08, { vol: 0.16 }); tone(d, nf('E6'), t + 0.07, 0.28, { vol: 0.16 }); },
  loss: (t, d) => { tone(d, nf('A4'), t, 0.18, { type: 'sawtooth', vol: 0.13 }); tone(d, nf('D#4'), t + 0.16, 0.35, { type: 'sawtooth', vol: 0.13, slide: nf('A3') }); },
  card: (t, d) => arp(d, t, ['C6', 'E6', 'G6', 'C7'], 0.06, 0.14, { type: 'triangle', vol: 0.2 }),
  buy: (t, d) => { tone(d, nf('G5'), t, 0.07, { vol: 0.14 }); tone(d, nf('D6'), t + 0.07, 0.07, { vol: 0.14 }); tone(d, nf('G6'), t + 0.14, 0.25, { vol: 0.14 }); noise(d, t + 0.14, 0.12, { vol: 0.08, freq: 7000 }); },
  warp: (t, d) => { tone(d, 300, t, 0.45, { type: 'sine', vol: 0.25, slide: 1900 }); noise(d, t, 0.45, { vol: 0.08, ftype: 'bandpass', freq: 800, sweep: 6000 }); },
  turn: (t, d) => { noise(d, t, 0.3, { vol: 0.12, ftype: 'bandpass', freq: 500, sweep: 3500 }); tone(d, nf('E5'), t + 0.05, 0.09, { vol: 0.13 }); tone(d, nf('A5'), t + 0.13, 0.18, { vol: 0.13 }); },
  month: (t, d) => arp(d, t, ['G5', 'C6', 'E6'], 0.11, 0.35, { type: 'triangle', vol: 0.2 }),
  fanfare: (t, d) => {
    [['C5', 0, 0.12], ['E5', 0.12, 0.12], ['G5', 0.24, 0.12], ['C6', 0.36, 0.45], ['A5', 0.84, 0.12], ['B5', 0.96, 0.12], ['C6', 1.08, 0.8]].forEach(([n, o, l]) => {
      tone(d, nf(n), t + o, l, { vol: 0.17 });
      tone(d, nf(n) / 2, t + o, l, { type: 'triangle', vol: 0.2 });
    });
  },
  jingle: (t, d) => arp(d, t, ['C5', 'E5', 'G5', 'E5', 'G5', 'C6'], 0.1, 0.2, { type: 'triangle', vol: 0.22 }),
  news: (t, d) => [0, 0.14, 0.28].forEach(o => tone(d, nf('A5'), t + o, 0.1, { vol: 0.14 })),
  curse: (t, d) => { tone(d, nf('E4'), t, 0.45, { type: 'sawtooth', vol: 0.11, slide: nf('A#3') }); tone(d, nf('A#3'), t + 0.4, 0.7, { type: 'sawtooth', vol: 0.11, slide: nf('E3') }); },
  rtick: (t, d) => tone(d, 1900, t, 0.025, { vol: 0.07 }),
  ding: (t, d) => { tone(d, nf('E6'), t, 0.6, { type: 'sine', vol: 0.3 }); tone(d, nf('B6'), t, 0.6, { type: 'sine', vol: 0.13 }); },
  msg: (t, d) => tone(d, nf('A5'), t, 0.06, { type: 'triangle', vol: 0.14 }),
};
const DUCK = { fanfare: 1.8, jingle: 1.0, curse: 1.3 };

function sfx(name) {
  if (!SND.ctx || !SND.sfxOn || SND.muted) return;
  const f = SFX[name];
  if (!f) return;
  try {
    const t = SND.ctx.currentTime + 0.01;
    f(t, SND.sfx);
    if (DUCK[name] && SND.bgmOn) {
      SND.bgm.gain.cancelScheduledValues(t);
      SND.bgm.gain.setTargetAtTime(0.04, t, 0.05);
      SND.bgm.gain.setTargetAtTime(BGM_VOL, t + DUCK[name], 0.3);
    }
  } catch (e) { /* ignore */ }
}

/* ---- 背景音樂：原創 16 小節輕快旅行曲（C 大調，140 BPM） ----
 * 每小節 8 個八分音符；「.」= 延長上一個音，「x」= 休止 */
const MELODY = [
  'E5 . G5 . C6 . G5 .', 'A5 . G5 E5 D5 . C5 .', 'D5 . E5 . G5 . E5 .', 'D5 . . . x . . .',
  'E5 . G5 . C6 . G5 .', 'A5 . C6 . D6 . C6 A5', 'G5 . E5 . D5 . E5 D5', 'C5 . . . x . . .',
  'F5 . A5 . C6 . A5 .', 'G5 . E5 . C5 . E5 .', 'F5 . A5 . G5 . F5 E5', 'D5 . . . G4 . . .',
  'E5 . G5 . C6 . B5 .', 'A5 . F5 . D6 . C6 .', 'B5 . G5 . A5 . B5 .', 'C6 . . . x . . .',
];
const CHORDS = ['C', 'Am', 'F', 'G', 'C', 'F', 'G', 'C', 'F', 'C', 'F', 'G', 'C', 'F', 'G', 'C'];
const CHORD_NOTES = { C: ['C3', 'E4', 'G4'], Am: ['A2', 'C4', 'E4'], F: ['F2', 'A3', 'C4'], G: ['G2', 'B3', 'D4'] };

const MEL_EVENTS = (() => {
  const toks = MELODY.join(' ').split(/\s+/);
  const ev = [];
  toks.forEach((tk, i) => {
    if (tk === '.') { if (ev.length && ev[ev.length - 1].open) ev[ev.length - 1].len++; return; }
    if (ev.length) ev[ev.length - 1].open = false;
    if (tk === 'x') return;
    ev.push({ step: i, note: tk, len: 1, open: true });
  });
  const byStep = {};
  ev.forEach(e => { byStep[e.step] = e; });
  return byStep;
})();
const TOTAL_STEPS = MELODY.length * 8;

const BGM = { timer: null, step: 0, next: 0, mood: 'normal' };
/* 被衰尾道人纏上時改成小調、稍慢的版本 */
const toMinor = n => n.replace(/^E(\d)$/, 'D#$1').replace(/^A(\d)$/, 'G#$1');

function bgmPlayStep(step, t, dur8) {
  const d = SND.bgm, curse = BGM.mood === 'curse';
  const fix = n => (curse ? toMinor(n) : n);
  const bar = Math.floor(step / 8), pos = step % 8;
  const [root, c1, c2] = CHORD_NOTES[CHORDS[bar]];
  const m = MEL_EVENTS[step];
  if (m) tone(d, nf(fix(m.note)), t, dur8 * m.len * 0.92, { type: curse ? 'triangle' : 'square', vol: curse ? 0.22 : 0.1, attack: 0.01 });
  if (pos % 2 === 0) {
    const r = nf(fix(root));
    const f = [r, r * 1.5, r * 2, r * 1.5][pos / 2];
    tone(d, f, t, dur8 * 1.6, { type: 'triangle', vol: 0.32 });
  } else {
    tone(d, nf(fix(c1)), t, dur8 * 0.5, { type: 'square', vol: 0.035 });
    tone(d, nf(fix(c2)), t, dur8 * 0.5, { type: 'square', vol: 0.035 });
  }
  if (pos === 0 || pos === 4) tone(d, 150, t, 0.13, { type: 'sine', vol: 0.5, slide: 45 });
  if (pos === 2 || pos === 6) noise(d, t, 0.1, { vol: 0.12, ftype: 'bandpass', freq: 1800 });
  if (pos % 2 === 1) noise(d, t, 0.03, { vol: 0.05, freq: 8000 });
}

function bgmSchedule() {
  if (!SND.ctx) return;
  const dur8 = 60 / (BGM.mood === 'curse' ? 118 : 140) / 2;
  while (BGM.next < SND.ctx.currentTime + 0.2) {
    try { bgmPlayStep(BGM.step, BGM.next, dur8); } catch (e) { /* ignore */ }
    BGM.next += dur8;
    BGM.step = (BGM.step + 1) % TOTAL_STEPS;
  }
}

function bgmStart() {
  audioInit();
  BGM.wanted = true;
  if (!SND.ctx || !SND.bgmOn || BGM.timer || document.hidden) return;
  BGM.next = SND.ctx.currentTime + 0.1;
  BGM.timer = setInterval(bgmSchedule, 40);
}
function bgmStop() { clearInterval(BGM.timer); BGM.timer = null; }
function bgmSetMood(mood) { BGM.mood = mood; }

/* 切到背景時暫停音樂，回來再繼續 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) bgmStop();
  else if (BGM.wanted && SND.bgmOn) bgmStart();
});

/* 第一次點擊畫面時啟用音訊；之後所有按鈕都有點擊聲 */
document.addEventListener('pointerdown', audioInit, { capture: true });
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('button')) sfx('click'); }, true);

function soundIcon() { return SND.muted ? '🔇' : '🔊'; }
function toggleMute() {
  audioInit();
  SND.muted = !SND.muted;
  applyVolume();
  soundSave();
  if (!SND.muted && BGM.wanted && SND.bgmOn) bgmStart();
  return SND.muted;
}
function toggleBgm() {
  SND.bgmOn = !SND.bgmOn;
  soundSave();
  if (SND.bgmOn) { BGM.wanted = true; bgmStart(); } else bgmStop();
}
function toggleSfx() { SND.sfxOn = !SND.sfxOn; soundSave(); }
