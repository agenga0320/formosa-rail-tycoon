/* 把 js/data.js + js/game.js 包成伺服器可用的模組 .build/engine.mjs
 * createEngine(host) 每呼叫一次就產生一份獨立的遊戲（一個房間一份），
 * 所以同一台伺服器上的多個房間不會共用 S、NET 這些變數。
 * wrangler deploy / wrangler dev 會自動先執行這支程式（見 wrangler.jsonc 的 build）。 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = f => readFileSync(new URL(f, root), 'utf8');
const part = f => `\n/* ======== ${f} ======== */\n${read(f)}\n`;

const out = `// 自動產生，請勿手動修改：由 tools/build-engine.mjs 從 js/ 與 server/ 組合而成
export function createEngine(host) {
'use strict';
${part('server/prelude.js')}${part('js/data.js')}${part('js/game.js')}${part('server/room.js')}
return API;
}
`;
mkdirSync(new URL('.build/', root), { recursive: true });
writeFileSync(new URL('.build/engine.mjs', root), out);
console.log('built .build/engine.mjs');
