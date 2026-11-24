const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function game() {
  const ctx = vm.createContext({ innerWidth: 1280, setTimeout: callback => callback(), document: { addEventListener() {} } });
  for (const file of ['data.js', 'game.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), ctx);
  vm.runInContext(`buildGraph(); log = () => {}; S = {players:[{pos:G.stationNode.keelung,cash:10000,cards:[],skip:false}],goal:G.stationNode.kaohsiung,year:1,curse:{holder:null},log:[]};`, ctx);
  return code => vm.runInContext(code, ctx);
}
test('all port pairs have symmetric fares and exclude departure', () => {
  const run = game();
  assert.equal(run(`PORTS.every(sid => { S.players[0].pos=G.stationNode[sid]; const opts=boatOptions(0);return opts.length>0 && opts.every(f=>{ const start=G.stationNode[sid];S.players[0].pos=f.node;const back=boatOptions(0).find(g=>g.node===start); return back.fare===f.fare && f.fare%100===0 && f.fare>=800; }); })`), true);
});
test('booking validates station, destination, funds and stopped turns', () => {
  const run = game();
  for (const setup of ['S.players[0].pos=G.stationNode.miaoli', 'S.players[0].cash=0', 'S.players[0].skip=true', 'S.players[0].boatRest=true']) {
    run('S.players[0]={pos:G.stationNode.keelung,cash:10000,skip:false};' + setup);
    const before = run('S.players[0].cash');
    assert.equal(run('bookBoat(0,G.stationNode.kaohsiung)'), null);
    assert.equal(run('S.players[0].cash'), before);
  }
  run('S.players[0]={pos:G.stationNode.keelung,cash:10000,skip:false}');
  for (const dest of ['G.stationNode.keelung','G.stationNode.miaoli','-1','"21"','null']) assert.equal(run(`bookBoat(0,${dest})`),null);
  assert.equal(run('S.players[0].cash'),10000);
  run('const f=boatOptions(0)[0];S.players[0].cash=f.fare;globalThis.booked=bookBoat(0,f.node)');
  assert.equal(run('booked.type'),'boat'); assert.equal(run('S.players[0].cash'),0);
});
test('a boat replaces dice and still runs arrival, goal, station and curse handling', async () => {
  const run = game();
  run(`globalThis.events=[]; render=()=>{}; focusNode=()=>{}; banner=async()=>{}; floatAll=()=>{}; note=async()=>{}; ask=async()=>({type:'boat',node:G.stationNode.kaohsiung,fare:0}); rollDice=async()=>{throw Error('Must not roll');}; reachGoal=async()=>events.push('goal'); stationVisit=async()=>events.push('station'); curseTurn=async()=>events.push('curse');`);
  await run('playTurn(0)');
  assert.equal(run('S.players[0].pos===G.stationNode.kaohsiung'),true);
  assert.ok(run('S.players[0].cash<10000'));
  assert.equal(run('events.join(",")'),'goal,station,curse');
  assert.equal(run('S.players[0].boatRest'),true);
  const cash = run('S.players[0].cash');
  run(`ask=async()=>{throw Error('Paused turn must not offer actions');};globalThis.saved=JSON.stringify(S);S=JSON.parse(saved);`);
  await run('playTurn(0)');
  assert.equal(run('S.players[0].boatRest'),false);
  assert.equal(run('S.players[0].cash'),cash);
  assert.equal(run('events.join(",")'),'goal,station,curse');
  run(`humanPreRoll=async()=>{events.push('resumed');return {type:'warp',node:G.stationNode.keelung};}`);
  await run('playTurn(0)');
  assert.equal(run('events.includes("resumed")'),true);
});
test('CPU accounts for the lost boat turn when comparing direct arrivals', async () => {
  const run = game();
  run(`setStatus=()=>{};render=()=>{};S.players[0].pos=G.stationNode.kaohsiung;S.goal=G.stationNode.hualien;`);
  const action = await run('cpuPreRoll(0)');
  assert.equal(action.type, 'flight');
  assert.equal(action.node, run('G.stationNode.hualien'));
});
