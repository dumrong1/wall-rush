const assert=require('node:assert/strict');
const http=require('node:http');
const {WebSocket}=require('ws');
const {createMultiplayerServer}=require('../server/multiplayer.cjs');
const {flagHomePosition,capturePolePosition,FLAG_TOSS_MIN_RADIUS,FLAG_TOSS_MAX_RADIUS,
  FLAG_CARRIER_SPEED_MULT}=require('../src/flag-rules.js');
const {CARRIER_BUILD_TIME}=require('../src/wall-rules.js');

const pause=()=>new Promise(resolve=>setTimeout(resolve,15));
function peer(url){
  const ws=new WebSocket(url),messages=[];
  ws.on('message',raw=>messages.push(JSON.parse(raw.toString())));
  return {ws,messages,seq:0,open:new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)}),
    send(value){ws.send(JSON.stringify(value));},
    input(forward=0,strafe=0,shove=false,build=false){this.send({type:'input',seq:++this.seq,forward,strafe,shove,build,dig:false});},
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
  const at=(actor,position)=>{actor.x=position.x;actor.z=position.z;};
  try{
    const red=await connect();red.send({type:'create',rules:'gates'});
    const joined=await red.get(m=>m.type==='joined'),code=joined.code;
    const blue=await connect();blue.send({type:'join',code});const blueJoined=await blue.get(m=>m.type==='joined');
    red.send({type:'ready',ready:true});blue.send({type:'ready',ready:true});await red.get(m=>m.type==='matchStart');
    const room=multi.rooms.get(code),r=room.players.red,b=room.players.blue;
    assert.equal(room.flags.red.status,'home');assert.equal(room.flags.blue.status,'home');

    // Both can steal in the same authoritative tick, independently.
    at(r,flagHomePosition('blue'));at(b,flagHomePosition('red'));tick(1);await pause();
    assert.equal(r.carryingFlag,'blue');assert.equal(b.carryingFlag,'red');
    assert.equal(room.flags.red.carrier,b);assert.equal(room.flags.blue.carrier,r);
    assert(red.messages.some(m=>m.type==='flagPickedUp'&&m.by==='red'));
    assert(blue.messages.some(m=>m.type==='flagPickedUp'&&m.by==='blue'));
    tick(1);
    const flagsSnapshot=await red.get(m=>m.type==='snapshot'&&m.flags?.red.status==='carried'&&m.flags?.blue.status==='carried');
    assert.equal(flagsSnapshot.flags.red.carrier,'blue');assert.equal(flagsSnapshot.flags.blue.carrier,'red');
    assert.equal(FLAG_CARRIER_SPEED_MULT,.9);assert.equal(CARRIER_BUILD_TIME,.26);
    at(r,{x:3.5,z:8.5});at(b,{x:3.5,z:8.5});
    red.input(1);blue.input(1);await pause();tick(1);
    assert(r.z>8.5&&b.z<8.5,'W points toward home for both carriers after a released input sequence');
    red.input();blue.input();await pause();tick(1);

    // Banking is allowed while the home flag is held by the opponent, but cannot win.
    at(r,capturePolePosition('red'));at(b,{x:5.5,z:8.5});tick(31);await pause();
    assert.equal(room.flags.blue.status,'banked');assert.equal(room.flags.blue.bankedAt,'red');
    assert.equal(room.flags.red.status,'carried');assert.equal(room.phase,'playing');
    assert.equal(red.messages.filter(m=>m.type==='flagBanked'&&m.by==='red').length,1);
    const replay=await connect();replay.send({type:'join',code,token:joined.token});
    await replay.get(m=>m.type==='joined');
    const recovered=await replay.get(m=>m.type==='snapshot'&&m.flags?.blue.status==='banked');
    assert.equal(recovered.flags.red.carrier,'blue','reconnect carries authoritative owner');
    assert.equal(recovered.flags.blue.bankedAt,'red','reconnect preserves banked flag');

    // The other carrier is shoved; scatter remains in the solo radius and the
    // just-shoved carrier cannot immediately pick it up again.
    r.x=3.5;r.z=8.5;r.fx=0;r.fz=-1;
    b.x=3.5;b.z=7.8;b.fx=0;b.fz=1;
    replay.input(0,0,true);await pause();tick(1);await pause();
    const dropped=room.flags.red;
    assert.equal(dropped.status,'dropped');assert.equal(b.carryingFlag,null);
    const radius=Math.hypot(dropped.x-dropped.tossFrom.x,dropped.z-dropped.tossFrom.z);
    assert(radius>=FLAG_TOSS_MIN_RADIUS-.001&&radius<=FLAG_TOSS_MAX_RADIUS+.001);
    assert(dropped.dropInteractDelay>.35&&dropped.dropLockTimer>.85);
    assert(blue.messages.some(m=>m.type==='flagDropped'&&m.team==='red'));
    at(b,{x:dropped.x,z:dropped.z});at(r,{x:5.5,z:14.5});tick(12);
    assert.equal(dropped.status,'dropped','pickup grace blocks immediate re-steal');
    tick(16);assert.equal(dropped.status,'carried','former carrier may re-steal after lockout');
    assert.equal(b.carryingFlag,'red');

    // A second valid shove drops the flag; its owner recovers it and wins.
    replay.input();await pause();tick(76);
    r.x=3.5;r.z=8.5;r.fx=0;r.fz=-1;
    b.x=3.5;b.z=7.8;b.fx=0;b.fz=1;
    replay.input(0,0,true);await pause();tick(1);await pause();
    assert.equal(dropped.status,'dropped');
    at(b,{x:5.5,z:5.5});at(r,{x:dropped.x,z:dropped.z});tick(15);await pause();
    assert.equal(dropped.status,'home');assert.equal(room.phase,'finished');assert.equal(room.winner,'red');
    assert.equal((await blue.get(m=>m.type==='matchComplete')).winner,'red');
    assert.equal((await replay.get(m=>m.type==='snapshot'&&m.phase==='finished')).flags.red.status,'home');
    assert.equal(red.messages.filter(m=>m.type==='matchComplete').length,0,'replaced socket receives no stale match event');

    // Another room keeps its own untouched flag state and denies forged scores.
    const another=await connect();another.send({type:'create'});
    const otherCode=(await another.get(m=>m.type==='joined')).code;
    const otherRoom=multi.rooms.get(otherCode);
    assert.equal(otherRoom.flags.red.status,'home');assert.equal(otherRoom.flags.blue.status,'home');
    another.send({type:'flagBanked',team:'red',winner:'red'});
    assert.equal((await another.get(m=>m.type==='error'&&m.reason==='unsupported_message')).reason,'unsupported_message');
    assert.equal(otherRoom.winner,null);
    const otherBlue=await connect();otherBlue.send({type:'join',code:otherCode});await otherBlue.get(m=>m.type==='joined');
    another.send({type:'ready',ready:true});otherBlue.send({type:'ready',ready:true});await another.get(m=>m.type==='matchStart');
    const or=otherRoom.players.red,ob=otherRoom.players.blue;
    at(or,flagHomePosition('blue'));at(ob,flagHomePosition('red'));tick(1);
    assert.equal(or.carryingFlag,'blue');assert.equal(ob.carryingFlag,'red');
    at(ob,capturePolePosition('blue'));at(or,{x:5.5,z:8.5});tick(31);
    assert.equal(otherRoom.flags.red.status,'banked');assert.equal(otherRoom.phase,'playing');
    ob.x=3.5;ob.z=8.5;ob.fx=0;ob.fz=-1;
    or.x=3.5;or.z=7.8;or.fx=0;or.fz=1;
    otherBlue.input(0,0,true);await pause();tick(1);
    assert.equal(otherRoom.flags.blue.status,'dropped');
    at(or,{x:5.5,z:5.5});at(ob,{x:otherRoom.flags.blue.x,z:otherRoom.flags.blue.z});tick(15);await pause();
    assert.equal(otherRoom.winner,'blue','mirrored Blue win uses the same home-plus-bank rule');
    assert.equal((await another.get(m=>m.type==='matchComplete')).winner,'blue');
    console.log('PASS multiplayer flags: simultaneous steals, authoritative carriers, bank while own flag missing, no premature win, scatter/grace/re-pick, shove drop, home return/victory, reconnect and isolation');
  }finally{
    for(const p of peers)p.ws.terminate();multi.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1});
