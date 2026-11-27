const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function game(){
 const ctx=vm.createContext({innerWidth:1280,document:{addEventListener(){}},setTimeout:cb=>cb()});
 for(const f of ['data.js','game.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',f),'utf8'),ctx);
 const run=s=>vm.runInContext(s,ctx);run('buildGraph();log=()=>{};');return run;
}
test('every player starts on a different mainland station, order is a permutation, goal is far from all starts',()=>{
 const run=game();const orders=new Set();
 for(let t=0;t<40;t++){
  run(`newGame({years:1,speed:'fast',players:[{name:'A',slot:0},{name:'B',slot:1},{name:'C',slot:2},{name:'D',slot:3}]})`);
  const r=JSON.parse(run(`JSON.stringify({names:S.players.map(p=>p.name),pos:S.players.map(p=>p.pos),island:S.players.map(p=>!!G.nodes[p.pos].island),station:S.players.map(p=>G.nodes[p.pos].type),goalDist:S.players.map(p=>dist(p.pos,S.goal))})`));
  assert.deepEqual([...r.names].sort(),['A','B','C','D']);
  assert.equal(new Set(r.pos).size,4);
  assert.ok(r.island.every(x=>!x)&&r.station.every(x=>x==='station'));
  assert.ok(r.goalDist.every(d=>d>0));
  orders.add(r.names.join(''));
 }
 assert.ok(orders.size>1,'turn order should vary between games');
});
