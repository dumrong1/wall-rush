const assert=require('node:assert/strict');
const http=require('node:http');
const {WebSocket}=require('ws');
const {createMultiplayerServer}=require('../server/multiplayer.cjs');
const {DASH_TIME,POWER_RESPAWN_MIN,POWER_RESPAWN_MAX}=require('../src/power-rules.js');
const {wallKey}=require('../src/wall-rules.js');
const {WATER_SPEED}=require('../src/terrain.js');
const {WALK_SPEED}=require('../src/movement.js');
const pause=()=>new Promise(resolve=>setTimeout(resolve,12));
function peer(url){
  const ws=new WebSocket(url),messages=[];
  ws.on('message',raw=>messages.push(JSON.parse(raw.toString())));
  return {ws,messages,seq:0,open:new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)}),
    send(value){ws.send(JSON.stringify(value));},
    input(forward=0,strafe=0,power=false){this.send({type:'input',seq:++this.seq,forward,strafe,power,build:false,dig:false,shove:false});},
    async get(test){for(let i=0;i<200;i++){const found=messages.find(test);if(found)return found;await pause();}throw Error('message timeout');}
  };
}
(async()=>{
  const server=http.createServer((_,res)=>res.end('ok'));
  const multi=createMultiplayerServer(server,{autoTick:false,random:()=>.25});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`ws://127.0.0.1:${server.address().port}/ws`,peers=[];
  const connect=async()=>{const p=peer(url);peers.push(p);await p.open;return p;};
  const tick=n=>{for(let i=0;i<n;i++)multi.advance();};
  try{
    const red=await connect();red.send({type:'create',rules:'gates'});
    const joined=await red.get(m=>m.type==='joined'),code=joined.code;
    const blue=await connect();blue.send({type:'join',code});await blue.get(m=>m.type==='joined');
    red.send({type:'ready',ready:true});blue.send({type:'ready',ready:true});await red.get(m=>m.type==='matchStart');
    const room=multi.rooms.get(code),r=room.players.red,b=room.players.blue;
    assert.equal(room.powerups.length,0);assert.equal(room.nextPower,1.15);
    tick(35);await pause();
    assert.equal(room.powerups.length,1,'server spawned the first pickup');
    const spawned=room.powerups[0];
    assert.deepEqual(blue.messages.find(m=>m.type==='powerSpawned').power,{id:spawned.id,type:spawned.type,x:spawned.x,z:spawned.z});
    assert(room.nextPower>=POWER_RESPAWN_MIN-.1&&room.nextPower<=POWER_RESPAWN_MAX);
    // Both overlap one pickup. Alternating server order awards it once.
    r.x=b.x=spawned.x;r.z=b.z=spawned.z;tick(1);await pause();
    const winner=r.power?'red':'blue',loser=winner==='red'?b:r;
    assert.equal(room.powerups.length,0);assert.equal(loser.power,null);
    assert.equal(red.messages.filter(m=>m.type==='powerCollected').length,1);
    assert.equal(blue.messages.filter(m=>m.type==='powerCollected').length,1);
    const firstSnapshot=await red.get(m=>m.type==='snapshot'&&m.players?.[winner]?.power===spawned.type);
    assert.equal(firstSnapshot.powerups.length,0);
    // Controlled power setups below use actual server input/activation paths.
    r.x=3.5;r.z=8.5;b.x=5.5;b.z=13.5;r.power='dash';r.carryingFlag=null;
    red.input(0,0,true);await pause();tick(1);await pause();
    assert.equal(r.power,null);assert(r.dash>DASH_TIME-.04);
    assert.equal(red.messages.filter(m=>m.type==='powerActivated'&&m.power==='dash').length,1);
    red.input(0,0,true);await pause();tick(1);await pause();
    assert.equal(red.messages.filter(m=>m.type==='powerActivated'&&m.power==='dash').length,1,'held/repeated packet cannot spend twice');
    red.input();await pause();tick(1);
    const before=r.z;red.input(1);await pause();tick(10);
    const normalWaterTravel=WALK_SPEED*WATER_SPEED*10/30;
    assert(before-r.z>normalWaterTravel*1.5,'Dash increases authoritative travel on water');
    assert(before-r.z<normalWaterTravel*1.8,'Dash still respects the terrain multiplier');
    red.input();await pause();tick(1);
    r.power='dash';r.carryingFlag='blue';r.dash=0;
    red.input(0,0,true);await pause();tick(1);assert.equal(r.power,'dash','carrier cannot Dash');assert.equal(r.dash,0);
    red.input();await pause();tick(1);r.carryingFlag=null;
    // A rock blocks every sampled jump landing, leaving the charge intact.
    r.x=1.5;r.z=6.5;r.fx=-1;r.fz=0;r.power='jump';
    red.input(0,0,true);await pause();tick(1);assert.equal(r.power,'jump');assert.equal(r.x,1.5);
    red.input();await pause();tick(1);
    r.x=3.5;r.z=8.5;r.fx=0;r.fz=1;
    red.input(0,0,true);await pause();tick(1);await pause();
    assert.equal(r.power,null);assert(r.z>9.2&&r.z<9.8,'Jump uses solo landing distance');
    assert(red.messages.some(m=>m.type==='powerActivated'&&m.power==='jump'));
    red.input();await pause();tick(1);
    // Instant Smash removes exactly one hostile gate with the real wall event.
    r.x=3.5;r.z=8.5;r.fx=0;r.fz=-1;r.power='smash';
    const edge={x:3,z:8,o:'h'},key=wallKey(edge);
    room.walls.set(key,{...edge,id:57,team:'blue',open:false,clearTime:0});room.wallOrder.blue.push(key);
    red.input(0,0,true);await pause();tick(1);await pause();
    assert.equal(room.walls.has(key),false);assert.equal(r.power,null);
    assert.equal(red.messages.filter(m=>m.type==='wallRemoved'&&m.wall.id===57&&m.reason==='smash').length,1);
    red.input(0,0,true);await pause();tick(1);
    assert.equal(red.messages.filter(m=>m.type==='wallRemoved'&&m.wall.id===57).length,1);
    red.input();await pause();tick(1);
    // A new wall blocks Dash movement; client positions are never accepted.
    r.x=3.5;r.z=8.5;r.fx=0;r.fz=-1;r.power='dash';
    room.walls.set(key,{...edge,id:58,team:'blue',open:false,clearTime:0});room.wallOrder.blue.push(key);
    red.input(0,0,true);await pause();tick(1);red.input(1,0,true);await pause();tick(30);
    assert(r.z>=8.245-.001,'Dash cannot cross an enemy gate');
    red.send({type:'input',seq:++red.seq,forward:1,strafe:0,power:false,x:0});
    assert.equal((await red.get(m=>m.type==='error'&&m.reason==='invalid_input')).reason,'invalid_input');
    red.input();await pause();tick(1);
    // Reconnect preserves inventory, active effect and live pickup list.
    r.power='jump';r.dash=.4;room.powerups=[{id:99,type:'smash',x:1.5,z:5.5}];
    const rejoin=await connect();rejoin.send({type:'join',code,token:joined.token});await rejoin.get(m=>m.type==='joined');
    const restored=await rejoin.get(m=>m.type==='snapshot'&&m.powerups?.some(p=>p.id===99));
    assert.equal(restored.players.red.power,'jump');assert(restored.players.red.dash>0);
    // A different room gets independent power state and no inherited charge.
    const other=await connect();other.send({type:'create'});const otherCode=(await other.get(m=>m.type==='joined')).code;
    const otherRoom=multi.rooms.get(otherCode);
    assert.equal(otherRoom.powerups.length,0);assert.equal(otherRoom.players.red.power,null);
    const otherBlue=await connect();otherBlue.send({type:'join',code:otherCode});
    const otherBlueJoined=await otherBlue.get(m=>m.type==='joined');
    other.send({type:'ready',ready:true});otherBlue.send({type:'ready',ready:true});await other.get(m=>m.type==='matchStart');
    otherRoom.players.red.power='jump';otherRoom.powerups=[{id:101,type:'dash',x:5.5,z:11.5}];
    otherBlue.ws.terminate();await new Promise(resolve=>setTimeout(resolve,3150));
    assert.equal(otherRoom.phase,'interrupted','disconnect pauses this room');
    assert.equal(otherRoom.players.red.power,'jump');assert.equal(otherRoom.powerups[0].id,101);
    const resumedBlue=await connect();resumedBlue.send({type:'join',code:otherCode,token:otherBlueJoined.token});
    await resumedBlue.get(m=>m.type==='joined');
    const pausedSnapshot=await resumedBlue.get(m=>m.type==='snapshot'&&m.powerups?.some(p=>p.id===101));
    assert.equal(pausedSnapshot.players.red.power,'jump');
    other.send({type:'ready',ready:true});resumedBlue.send({type:'ready',ready:true});
    assert.equal((await resumedBlue.get(m=>m.type==='matchStart'&&m.resume===true)).resume,true);
    assert.equal(otherRoom.players.red.power,'jump');assert.equal(otherRoom.powerups[0].id,101);
    // The existing flag victory transition still ends a power-enabled room.
    room.powerups=[];room.players.red.power=null;
    room.flags.blue.status='banked';room.flags.blue.bankedAt='red';room.flags.blue.carrier=null;
    room.flags.red.status='home';
    tick(1);await pause();assert.equal(room.winner,'red');
    assert.equal((await blue.get(m=>m.type==='matchComplete')).winner,'red');
    console.log('PASS multiplayer powers: deterministic spawn/pickup, Dash, carrier lock, Jump landing, instant Smash, collision, single-use input, reconnect, disconnect/resume, isolation and victory');
  }finally{
    for(const p of peers)p.ws.terminate();multi.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
