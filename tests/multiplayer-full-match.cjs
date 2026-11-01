const assert=require('node:assert/strict');
const http=require('node:http');
const {WebSocket}=require('ws');
const {createMultiplayerServer}=require('../server/multiplayer.cjs');
const {flagHomePosition,capturePolePosition}=require('../src/flag-rules.js');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function peer(url){
  const ws=new WebSocket(url),messages=[];
  ws.on('message',raw=>messages.push(JSON.parse(raw.toString())));
  return {ws,messages,seq:0,open:new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)}),
    send(message){ws.send(JSON.stringify(message));},
    input({forward=0,strafe=0,build=false,dig=false,shove=false,power=false}={}){
      this.send({type:'input',seq:++this.seq,forward,strafe,build,dig,shove,power});
    },
    async get(test){for(let i=0;i<250;i++){const found=messages.find(test);if(found)return found;await wait(8);}throw Error('message timeout');}
  };
}
(async()=>{
  const server=http.createServer((_,res)=>res.end('ok'));
  const multi=createMultiplayerServer(server,{autoTick:false,random:()=>.25});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`ws://127.0.0.1:${server.address().port}/ws`,clients=[];
  const connect=async()=>{const p=peer(url);clients.push(p);await p.open;return p;};
  const tick=n=>{for(let i=0;i<n;i++)multi.advance();};
  const input=async(p,value)=>{p.input(value);await wait(10);};
  try{
    const red=await connect();red.send({type:'create',rules:'gates'});
    const code=(await red.get(m=>m.type==='joined')).code;
    const blue=await connect();blue.send({type:'join',code});await blue.get(m=>m.type==='joined');
    red.send({type:'ready',ready:true});blue.send({type:'ready',ready:true});
    await red.get(m=>m.type==='matchStart');await blue.get(m=>m.type==='matchStart');
    const room=multi.rooms.get(code),r=room.players.red,b=room.players.blue;
    room.nextPower=999;

    r.x=3.5;r.z=8.5;r.fx=0;r.fz=-1;b.x=5.5;b.z=8.5;
    await input(red,{build:true});tick(6);await wait(10);
    const gate=room.walls.get('h:3:8');assert(gate&&gate.team==='red');
    assert(blue.messages.some(m=>m.type==='wallBuilt'&&m.wall.id===gate.id));
    await input(red);
    r.z=8.35;b.x=3.5;b.z=7.65;b.fx=0;b.fz=1;
    await input(red,{forward:1});await input(blue,{forward:1});tick(26);await wait(10);
    assert(r.z<8&&b.z<7.82);assert(red.messages.some(m=>m.type==='gateCrossed'&&m.wallId===gate.id));
    await input(red);await input(blue);r.x=5.5;r.z=15.5;tick(12);
    assert.equal(gate.open,false);
    b.x=3.5;b.z=7.65;b.fx=0;b.fz=1;
    await input(blue,{dig:true});tick(81);await wait(10);
    assert(!room.walls.has('h:3:8'));
    assert(red.messages.some(m=>m.type==='wallRemoved'&&m.wall.id===gate.id));
    await input(blue);

    b.x=3.5;b.z=8.5;b.fx=0;b.fz=-1;r.x=5.5;r.z=8.5;
    await input(blue,{build:true});tick(6);await wait(10);
    const blueGate=room.walls.get('h:3:8');assert(blueGate&&blueGate.team==='blue');
    await input(blue);b.x=5.5;b.z=8.5;r.x=3.5;r.z=8.5;r.fx=0;r.fz=-1;
    room.powerups=[{id:81,type:'smash',x:r.x,z:r.z}];tick(1);assert.equal(r.power,'smash');
    await input(red,{power:true});tick(1);await wait(10);
    assert(!room.walls.has('h:3:8'));assert.equal(r.power,null);
    assert(blue.messages.some(m=>m.type==='powerActivated'&&m.power==='smash'));
    await input(red);

    for(const [id,type] of [[82,'dash'],[83,'jump']]){
      r.x=3.5;r.z=8.5;r.fx=0;r.fz=1;room.powerups=[{id,type,x:r.x,z:r.z}];tick(1);
      assert.equal(r.power,type);
      await input(red,{power:true});tick(1);await wait(10);
      assert.equal(r.power,null);assert(blue.messages.some(m=>m.type==='powerActivated'&&m.power===type));
      await input(red);
    }
    r.x=3.5;r.z=8.5;r.fx=0;r.fz=-1;b.x=3.5;b.z=7.8;b.fx=0;b.fz=1;
    await input(red,{shove:true});tick(1);await wait(10);
    assert(blue.messages.some(m=>m.type==='shoveHit'&&m.attacker==='red'));
    await input(red);

    Object.assign(r,flagHomePosition('blue'));b.x=5.5;b.z=8.5;tick(1);
    assert.equal(r.carryingFlag,'blue');await blue.get(m=>m.type==='flagPickedUp'&&m.by==='red');
    r.x=3.5;r.z=8.5;r.fx=0;r.fz=-1;b.x=3.5;b.z=7.8;b.fx=0;b.fz=1;
    await input(blue,{shove:true});tick(1);await wait(10);
    assert.equal(room.flags.blue.status,'dropped');
    assert(red.messages.some(m=>m.type==='flagDropped'&&m.team==='blue'));
    await input(blue);b.x=5.5;b.z=5.5;
    tick(30);r.x=room.flags.blue.x;r.z=room.flags.blue.z;tick(1);
    assert.equal(r.carryingFlag,'blue');
    Object.assign(r,capturePolePosition('red'));tick(31);await wait(10);
    assert.equal(room.winner,'red');assert.equal(room.phase,'finished');
    assert.equal((await red.get(m=>m.type==='matchComplete')).winner,'red');
    assert.equal((await blue.get(m=>m.type==='matchComplete')).winner,'red');
    assert.equal(red.messages.filter(m=>m.type==='matchComplete').length,1);
    console.log('PASS integrated room-to-victory server match: gates, friendly crossing, WallSmash, Smash, Dash, Jump, shove, flag drop/repick/bank and identical winner');
  }finally{
    for(const client of clients)client.ws.terminate();multi.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1});
