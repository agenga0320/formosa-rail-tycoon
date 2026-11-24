const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const cp = require('node:child_process');
const path = require('node:path');
const root = path.join(__dirname,'..');
function context(data,code) {
  const ctx=vm.createContext({innerWidth:1280,document:{addEventListener(){}},setTimeout:cb=>cb()});
  vm.runInContext(data+code+';buildGraph();',ctx);return ctx;
}
function game() {
  const ctx=context(fs.readFileSync(path.join(root,'js/data.js'),'utf8'),fs.readFileSync(path.join(root,'js/game.js'),'utf8'));
  const run=s=>vm.runInContext(s,ctx);
  run(`log=()=>{};S={players:[{pos:G.stationNode.taipei,cash:10000,cards:[],skip:false}],goal:G.stationNode.liuqiu,year:1,curse:{holder:null},log:[]};`);
  return run;
}
test('original node IDs and tile types remain compatible with saved games',()=>{
 const baseline=context(cp.execFileSync('git',['show','HEAD:js/data.js'],{cwd:root,encoding:'utf8'}),cp.execFileSync('git',['show','HEAD:js/game.js'],{cwd:root,encoding:'utf8'}));
 const old=JSON.parse(vm.runInContext('JSON.stringify(G.nodes.map(n=>({id:n.id,type:n.type,sid:n.sid})))',baseline));
 const run=game();const current=JSON.parse(run('JSON.stringify(G.nodes.slice(0,117).map(n=>({id:n.id,type:n.type,sid:n.sid})))'));
 assert.deepEqual(current,old);
});
test('six islands each have exactly one station and no dice movement',()=>{
 const run=game();
 assert.equal(run('ISLANDS.length'),6);
 assert.equal(run('G.nodes.length'),123);
 assert.equal(run(`ISLANDS.every(s=>{const hub=G.stationNode[s.id];return G.adj[hub].length===0 && G.nodes.filter(n=>n.island===s.id).length===1 && !Number.isFinite(distFrom(hub)[G.stationNode.taipei]) && [...reachable(hub,6).keys()].every(id=>G.nodes[id].island===s.id);})`),true);
 assert.equal(run(`G.nodes.every(a=>G.nodes.every(b=>Number.isFinite(dist(a.id,b.id))))`),true);
 assert.equal(run('validPath([G.stationNode.pingtung,G.stationNode.liuqiu],G.stationNode.pingtung,1)'),false);
});
test('island tickets are limited to verified gateways and allow returns',()=>{
 const run=game();
 run('S.players[0].pos=G.stationNode.liuqiu');
 assert.equal(run('flightOptions(0).length'),0);
 assert.equal(run('boatOptions(0).map(f=>G.nodes[f.node].sid).join()'),'pingtung');
 assert.equal(run('bookFlight(0,G.stationNode.taipei)'),null);
 run('S.players[0].pos=G.stationNode.kinmen');
 assert.equal(run('boatOptions(0).length'),0);
 run('S.players[0].pos=G.stationNode.greenisland');
 assert.equal(run('flightOptions(0).map(f=>G.nodes[f.node].sid).join()'),'taitung');
 assert.equal(run('boatOptions(0).map(f=>G.nodes[f.node].sid).join()'),'taitung');
 assert.equal(run('bookBoat(0,G.stationNode.liuqiu)'),null);
 run('S.players[0].pos=G.stationNode.pingtung');
 assert.equal(run('bookBoat(0,G.stationNode.liuqiu).type'),'boat');
});
test('island goals, AI and fares remain finite and CPU can leave an island',async()=>{
 const run=game();
 run(`setStatus=()=>{};render=()=>{};S.players[0].pos=G.stationNode.greenisland;S.goal=G.stationNode.taitung;`);
 const act=await run('cpuPreRoll(0)');
 assert.equal(act.node,run('G.stationNode.taitung'));
 assert.ok(['flight','boat'].includes(act.type));
 assert.equal(run(`ISLANDS.every(s=>{S.players[0].pos=G.stationNode[s.id];return [...flightOptions(0),...boatOptions(0)].every(f=>Number.isFinite(f.fare)&&Number.isFinite(f.remaining));})`),true);
 run('pickGoal(G.stationNode.liuqiu,20)');
 assert.equal(run('Number.isFinite(S.goalBonusBase)'),true);
});

test('island stay earns once, pauses earn nothing, and invalid roll requests cannot move',async()=>{
 const run=game();
 run(`globalThis.events=[];render=()=>{};focusNode=()=>{};banner=async()=>{};floatAll=()=>{};note=async()=>{};stationVisit=async()=>events.push('shop');curseTurn=async()=>{};ask=async()=>({type:'roll'});rollDice=async()=>{throw Error('No island dice');};S.players[0].pos=G.stationNode.liuqiu;S.goal=G.stationNode.taipei;S.players[0].cash=0;`);
 await run('playTurn(0)');
 assert.equal(run('S.players[0].cash'),500);
 assert.equal(run('S.players[0].pos===G.stationNode.liuqiu'),true);
 assert.equal(run('events.length'),1);
 run('S.players[0].boatRest=true'); await run('playTurn(0)');
 assert.equal(run('S.players[0].cash'),500);
 assert.equal(run('events.length'),1);
 await run('playTurn(0)');
 assert.equal(run('S.players[0].cash'),1000);
 run(`S.players[0].cards=['express'];`);
 assert.equal(await run('applyCard(0,0,null)'),null);
 assert.equal(run('S.players[0].cards.length'),1);
 run('setStatus=()=>{};S.players[0].cash=0');
 assert.equal((await run('cpuPreRoll(0)')).type,'stay');
});

test('navigation cards for single-station islands land at a valid mainland gateway',async()=>{
 const run=game();run('render=()=>{};message=async()=>{};');
 for (const sid of ['penghu','kinmen','matsu','greenisland','lanyu','liuqiu']) {
   run(`S.goal=G.stationNode['${sid}'];S.players[0].cards=['near'];`);
   const action=await run('applyCard(0,0,null)');
   assert.equal(action.type,'warp');
   assert.ok(Number.isInteger(action.node));
   assert.equal(run(`Boolean(G.nodes[${action.node}].island)`),false);
   assert.equal(run(`[...ISLAND_FLIGHTS,...ISLAND_BOATS].some(([a,b])=>(G.stationNode[a]===${action.node} && b==='${sid}') || (G.stationNode[b]===${action.node} && a==='${sid}'))`),true);
 }
});
