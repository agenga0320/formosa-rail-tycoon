const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function game() {
  const ctx = vm.createContext({ innerWidth: 1280, document: { addEventListener() {} } });
  for (const file of ['data.js', 'game.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), ctx);
  vm.runInContext(`buildGraph(); log = () => {}; S = {players:[{pos:G.stationNode.taipei,cash:10000,cards:[],skip:false}],goal:G.stationNode.kaohsiung,year:1,curse:{holder:null},log:[]};`, ctx);
  return code => vm.runInContext(code, ctx);
}
test('all airport pairs have symmetric fares and exclude departure', () => {
  const run = game();
  assert.equal(run(`AIRPORTS.every(sid => { S.players[0].pos=G.stationNode[sid]; const opts=flightOptions(0);return opts.length>0 && opts.every(f=>{ const start=G.stationNode[sid];S.players[0].pos=f.node;const back=flightOptions(0).find(g=>g.node===start); return back.fare===f.fare && f.fare%100===0 && f.fare>=1500; }); })`), true);
});
test('booking validates station, destination, funds and stopped turns', () => {
  const run = game();
  for (const setup of ['S.players[0].pos=G.stationNode.miaoli', 'S.players[0].cash=0', 'S.players[0].skip=true']) {
    run('S.players[0]={pos:G.stationNode.taipei,cash:10000,skip:false};' + setup);
    const before = run('S.players[0].cash');
    assert.equal(run('bookFlight(0,G.stationNode.kaohsiung)'), null);
    assert.equal(run('S.players[0].cash'), before);
  }
  run('S.players[0]={pos:G.stationNode.taipei,cash:10000,skip:false}');
  for (const dest of ['G.stationNode.taipei','G.stationNode.miaoli','-1','"21"','null']) assert.equal(run(`bookFlight(0,${dest})`),null);
  assert.equal(run('S.players[0].cash'),10000);
  run('const f=flightOptions(0)[0];S.players[0].cash=f.fare;globalThis.booked=bookFlight(0,f.node)');
  assert.equal(run('booked.type'),'flight'); assert.equal(run('S.players[0].cash'),0);
});
test('a flight replaces dice and still runs arrival, goal, station and curse handling', async () => {
  const run = game();
  run(`globalThis.events=[]; render=()=>{}; focusNode=()=>{}; banner=async()=>{}; floatAll=()=>{}; note=async()=>{}; ask=async()=>({type:'flight',node:G.stationNode.kaohsiung,fare:0}); rollDice=async()=>{throw Error('Must not roll');}; reachGoal=async()=>events.push('goal'); stationVisit=async()=>events.push('station'); curseTurn=async()=>events.push('curse');`);
  await run('playTurn(0)');
  assert.equal(run('S.players[0].pos===G.stationNode.kaohsiung'),true);
  assert.ok(run('S.players[0].cash<10000'));
  assert.equal(run('events.join(",")'),'goal,station,curse');
});
