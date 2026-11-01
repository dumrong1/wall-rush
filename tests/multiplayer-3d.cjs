const assert=require('node:assert/strict');
const http=require('node:http');
const {WebSocket}=require('ws');
const {createMultiplayerServer}=require('../server/multiplayer.cjs');
const {terrainBodyBlocked,WALK_SPEED,PLAYER_RADIUS}=require('../src/movement.js');
const {WATER_SPEED}=require('../src/terrain.js');

function peer(url){
  const ws=new WebSocket(url),messages=[],waiters=[];
  ws.on('message',raw=>{
    const message=JSON.parse(raw.toString());messages.push(message);
    for(const waiter of [...waiters])if(waiter.test(message)){
      clearTimeout(waiter.timeout);waiters.splice(waiters.indexOf(waiter),1);waiter.resolve(message);
    }
  });
  return {
    ws,messages,open:new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)}),
    send:body=>ws.send(JSON.stringify(body)),
    wait:(test,ms=5000)=>{
      const found=messages.find(test);if(found)return Promise.resolve(found);
      return new Promise((resolve,reject)=>{const waiter={test,resolve,timeout:setTimeout(()=>reject(Error('Timed out')),ms)};waiters.push(waiter)});
    }
  };
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,25));
const near=(a,b,epsilon=.002)=>assert(Math.abs(a-b)<epsilon,`${a} differs from ${b}`);

(async()=>{
  const httpServer=http.createServer((_request,response)=>response.end('ok'));
  const multiplayer=createMultiplayerServer(httpServer,{autoTick:false});
  await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
  const url=`ws://127.0.0.1:${httpServer.address().port}/ws`,peers=[];
  try{
    const red=peer(url);peers.push(red);await red.open;red.send({type:'create'});
    const created=await red.wait(m=>m.type==='joined'),code=created.code;
    const blue=peer(url);peers.push(blue);await blue.open;blue.send({type:'join',code});
    await blue.wait(m=>m.type==='joined');
    red.send({type:'ready',ready:true});blue.send({type:'ready',ready:true});
    await red.wait(m=>m.type==='matchStart');
    const room=multiplayer.rooms.get(code);
    assert.equal(room.phase,'playing');
    assert.equal(room.players.red.x,3.5);assert.equal(room.players.blue.x,3.5);

    red.send({type:'input',seq:1,forward:1,strafe:0});await settle();
    for(let i=0;i<10;i++)multiplayer.advance();
    near(room.players.red.z,17-.58-10*WALK_SPEED/30);
    near(room.players.blue.z,.58);
    near(room.players.red.fz,-1);

    room.players.red.x=3.5;room.players.red.z=2.5;
    multiplayer.advance();const dryDistance=2.5-room.players.red.z;
    room.players.red.x=2.5;room.players.red.z=3.5;
    multiplayer.advance();const waterDistance=3.5-room.players.red.z;
    near(waterDistance/dryDistance,WATER_SPEED,.0001);

    room.players.red.x=.5;room.players.red.z=5.55;
    red.send({type:'input',seq:2,forward:-1,strafe:0});await settle();
    for(let i=0;i<35;i++)multiplayer.advance();
    assert(room.players.red.z<6-PLAYER_RADIUS+.01,'log blocks the body');
    assert(!terrainBodyBlocked(room.players.red.x,room.players.red.z));
    room.players.red.x=PLAYER_RADIUS;room.players.red.z=2.5;
    red.send({type:'input',seq:3,forward:0,strafe:-1});await settle();
    for(let i=0;i<10;i++)multiplayer.advance();
    near(room.players.red.x,PLAYER_RADIUS);

    red.send({type:'input',seq:4,forward:1,strafe:0,x:999,z:999});
    assert.equal((await red.wait(m=>m.type==='error'&&m.reason==='invalid_input')).reason,'invalid_input');
    const before=room.players.red.z;
    for(let i=0;i<3;i++)multiplayer.advance();
    near(room.players.red.z,before);

    blue.send({type:'input',seq:1,forward:1,strafe:0});await settle();
    const blueBefore=room.players.blue.z;
    for(let i=0;i<10;i++)multiplayer.advance();
    assert(room.players.blue.z>blueBefore,'Blue moves toward its opposite objective');

    const newRed=peer(url);peers.push(newRed);await newRed.open;
    newRed.send({type:'join',code,token:created.token});
    assert.equal((await newRed.wait(m=>m.type==='joined')).team,'red');
    newRed.send({type:'input',seq:1,forward:1,strafe:0});await settle();
    assert.equal(room.players.red.lastSeq,1,'authenticated page handoff resets input sequence');
    assert.equal(room.phase,'playing','socket handoff does not interrupt the room');

    console.log('PASS shared Wetlands V3 movement: shared dry/water speeds, permanent obstacle and arena collision, opposing team controls, authoritative input and socket handoff');
  }finally{
    for(const item of peers)item.ws.terminate();
    multiplayer.close();
    await new Promise(resolve=>httpServer.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1});

