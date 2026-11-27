/* ===== 伺服器端執行 game.js 用的替身（tools/build-engine.mjs 會把它放在 game.js 前面） =====
 * 伺服器沒有畫面：DOM、視窗、存檔都換成空殼，計時器換成房間可以整個停掉的版本。
 * 這些名稱只存在於 createEngine() 裡，每個房間各有一份，不會互相干擾。 */
const NOOP = new Proxy(function () {}, {
  get(t, k) {
    if (k === Symbol.toPrimitive) return () => '';
    if (k === Symbol.iterator) return function* () {};
    if (k === 'then') return undefined; // 不要被當成 Promise
    return NOOP;
  },
  set() { return true; },
  apply() { return NOOP; },
  construct() { return NOOP; },
});
const document = NOOP, window = NOOP, navigator = NOOP;
const location = { href: '', pathname: '/', search: '', origin: '', reload() {} };
const innerWidth = 1280, innerHeight = 800;
const localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const setTimeout = host.setTimeout, clearTimeout = host.clearTimeout;
const setInterval = host.setInterval, clearInterval = host.clearInterval;
