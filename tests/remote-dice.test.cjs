// 遙控骰子：指定步數、商店限購一張、離島不能用、電腦會用
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
function game() {
  const ctx = vm.createContext({ innerWidth: 1280, document: { addEventListener() {} }, setTimeout: cb => cb() });
  for (const f of ['data.js', 'game.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', f), 'utf8'), ctx);
  const run = s => vm.runInContext(s, ctx);
  run(`buildGraph();log=()=>{};render=()=>{};message=async()=>{};note=async()=>{};floatAll=()=>{};setStatus=()=>{};diceResultLocal=async()=>{};
    S={players:[{name:'甲',pos:G.stationNode.taipei,cash:10000,cards:['remote'],cpu:false},{name:'乙',pos:G.stationNode.keelung,cash:10000,cards:[],cpu:false}],
       owner:{},goal:G.stationNode.kaohsiung,year:1,month:1,turn:0,curse:{holder:null},log:[]};`);
  return run;
}

test('remote dice moves exactly the chosen number of steps and is used up', async () => {
  const run = game();
  const act = await run('applyCard(0,0,4)');
  assert.deepEqual({ ...act }, { type: 'roll', dice: 1, fixed: 4 });
  assert.equal(run('S.players[0].cards.length'), 0);
  assert.equal(await run('rollDice(act_dice=1, 4)'), 4);
});

test('invalid step counts and islands do not consume the card', async () => {
  for (const target of ['0', '7', 'null', '2.5', '"3"']) {
    const run = game();
    assert.equal(await run(`applyCard(0,0,${target})`), null);
    assert.equal(run('S.players[0].cards.length'), 1);
  }
  const run = game();
  run(`S.players[0].pos=G.nodes.find(n=>n.island).id`);
  assert.equal(await run('applyCard(0,0,3)'), null);
  assert.equal(run('S.players[0].cards.length'), 1);
});

test('the network menu passes the chosen steps through to the move', async () => {
  const run = game();
  run(`ask=async()=>({type:'card',idx:0,target:5})`);
  const act = await run('humanPreRoll(0)');
  assert.equal(act.fixed, 5);
});

test('shop: cannot buy a second remote dice, but can buy one when not holding any', async () => {
  const shop = game()('STATIONS.find(s=>s.shop).id');
  let run = game();
  run(`globalThis.actions=[{card:'remote'},{done:true}];ask=async()=>actions.shift();`);
  await run(`humanStation(0,G.stationById.${shop})`);
  assert.equal(run('S.players[0].cards.filter(k=>k==="remote").length'), 1);
  assert.equal(run('S.players[0].cash'), 10000);
  run = game();
  run(`S.players[0].cards=[];globalThis.actions=[{card:'remote'},{card:'remote'},{done:true}];ask=async()=>actions.shift();`);
  await run(`humanStation(0,G.stationById.${shop})`);
  assert.equal(run('S.players[0].cards.filter(k=>k==="remote").length'), 1, 'the second purchase in the same visit is refused');
  assert.equal(run('S.players[0].cash'), 7000);
});

test('yellow squares can give a remote dice even if one is already held', () => {
  const run = game();
  assert.ok(run('DRAW_WEIGHTS.remote') > 0);
  run('Math.random=()=>0.9999');
  assert.equal(run('drawCard()'), 'remote');
});

test('CPU uses the remote dice to drive straight to a goal within 6 steps', async () => {
  const run = game();
  run(`S.players[0].cpu=true;S.goal=G.nodes.findIndex((n,k)=>distFrom(S.players[0].pos)[k]===4);`);
  const act = await run('cpuPreRoll(0)');
  assert.equal(act.fixed, 4);
});
