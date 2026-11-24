const test=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function game(){
 const ctx=vm.createContext({innerWidth:1280,document:{addEventListener(){}},setTimeout:cb=>cb()});
 for(const f of ['data.js','game.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',f),'utf8'),ctx);
 const run=s=>vm.runInContext(s,ctx);
 run(`buildGraph();log=()=>{};render=()=>{};message=async()=>{};note=async()=>{};floatAll=()=>{};banner=async()=>{};announce=async()=>{};S={players:[{name:'甲',pos:G.stationNode.taipei,cash:10000,cards:['acquire'],cpu:false},{name:'乙',pos:G.stationNode.taipei,cash:2000,cards:[],cpu:false}],owner:{},goal:G.stationNode.kaohsiung,year:1,month:7,curse:{holder:null},log:[]};`);return run;
}
test('human selects the exact asset; liquidation stops immediately after debt is covered',async()=>{
 const run=game();run(`S.players[0].cash=-1000;S.owner={'taipei:0':0,'taipei:1':0};globalThis.asks=0;ask=async(i,kind)=>{if(kind!=='debt')throw Error('Wrong prompt');asks++;return 'taipei:1'};`);
 await run('settleDebt(0)');
 assert.equal(run('S.owner["taipei:0"]'),0);assert.equal(run('S.owner["taipei:1"]'),undefined);
 assert.equal(run('S.players[0].cash'),500);assert.equal(run('asks'),1);
});
test('multiple choices, bankruptcy and no second payout for an already-sold property',async()=>{
 const run=game();run(`S.players[0].cash=-4000;S.owner={'taipei:0':0,'taipei:1':0};globalThis.answers=['taipei:0','taipei:1'];ask=async()=>answers.shift();`);
 await run('settleDebt(0)');assert.equal(run('Object.keys(S.owner).length'),0);assert.equal(run('S.players[0].cash'),-1500);
 await run('settleDebt(0)');assert.equal(run('S.players[0].cash'),-1500);
});
test('CPU/offline fallback and invalid choices never sell another player property',async()=>{
 for(const mode of ['cpu','offline','invalid']){
  const run=game();run(`S.players[0].cash=-200;S.owner={'taipei:0':0,'taipei:1':1};ask=async()=> 'taipei:1';`);
  if(mode!=='invalid')run(`S.players[0].${mode}=true;ask=async()=>{throw Error('Should not ask')};`);
  await run('settleDebt(0)');assert.equal(run('S.owner["taipei:1"]'),1);assert.equal(run('S.players[0].cash'),800);
 }
});
test('selling breaks monopoly and reopened property can be purchased normally',async()=>{
 const run=game();run(`S.owner=Object.fromEntries(STATIONS.find(s=>s.id==='keelung').props.map((_,k)=>['keelung:'+k,0]));S.players[0].cash=-100;ask=async()=> 'keelung:0';`);
 assert.equal(run('monoOwner("keelung")'),0);await run('settleDebt(0)');assert.equal(run('monoOwner("keelung")'),null);
 run(`globalThis.actions=[{buy:0},{done:true}];ask=async()=>actions.shift();`);await run('humanStation(1,G.stationById.keelung)');
 assert.equal(run('S.owner["keelung:0"]'),1);assert.equal(run('S.players[1].cash'),1200);
});
test('red tiles, curse losses and monthly repair costs invoke debt selection',async()=>{
 const run=game();run(`S.owner={'taipei:0':0};S.players[0].cash=0;S.players[0].pos=G.nodes.find(n=>n.type==='red').id;Math.random=()=>0;ask=async()=> 'taipei:0';`);
 await run('landOn(0)');assert.equal(run('S.owner["taipei:0"]'),undefined);assert.equal(run('S.players[0].cash'),800);
 run(`S.owner={'taipei:0':0};S.players[0].cash=0;S.curse={holder:0,level:1,turns:0};Math.random=()=>0;`);
 await run('curseTurn(0)');assert.equal(run('S.owner["taipei:0"]'),undefined);assert.equal(run('S.players[0].cash'),800);
 run(`S.owner={'hualien:4':0,'hualien:0':1};S.players[0].cash=0;ask=async()=> 'hualien:4';`);
 await run('monthEvent()');assert.equal(run('S.owner["hualien:4"]'),undefined);assert.equal(run('S.players[0].cash'),12000);
});
test('acquisition pays double to the seller, transfers ownership and consumes exactly one card',async()=>{
 const run=game();run(`S.owner={'taipei:0':1};`);
 await run('applyCard(0,0,"taipei:0")');assert.equal(run('S.players[0].cash'),6000);assert.equal(run('S.players[1].cash'),6000);assert.equal(run('S.owner["taipei:0"]'),0);assert.equal(run('S.players[0].cards.length'),0);
 await run('applyCard(0,0,"taipei:0")');assert.equal(run('S.players[1].cash'),6000);
});
test('unaffordable, unowned, own, remote-station and malformed acquisitions do not consume cash/cards',async()=>{
 for(const setup of ["S.players[0].cash=3999;S.owner={'taipei:0':1}","S.owner={}","S.owner={'taipei:0':0}","S.owner={'taipei:0':1};S.players[0].pos=G.stationNode.keelung"]){
  const run=game();run(setup);const cash=run('S.players[0].cash');await run('applyCard(0,0,"taipei:0")');assert.equal(run('S.players[0].cash'),cash);assert.equal(run('S.players[0].cards.length'),1);
 }
 const run=game();run(`S.owner={'taipei:0':1}`);await run('applyCard(0,0,{key:"taipei:0",price:0})');assert.equal(run('S.players[0].cards.length'),1);
});
test('network menu carries property key without converting it to a number',async()=>{
 const run=game();run(`S.owner={'taipei:0':1};globalThis.actions=[{type:'card',idx:0,target:'taipei:0',price:0},{type:'roll'}];ask=async()=>actions.shift();`);
 const result=await run('humanPreRoll(0)');assert.equal(result.type,'roll');assert.equal(run('S.owner["taipei:0"]'),0);assert.equal(run('S.players[0].cash'),6000);
});
