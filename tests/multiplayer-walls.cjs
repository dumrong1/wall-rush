const assert=require('node:assert/strict');
const http=require('node:http');
const {WebSocket}=require('ws');
const {createMultiplayerServer}=require('../server/multiplayer.cjs');
const {MAX_WALLS,BUILD_TIME,DIG_TIME}=require('../src/wall-rules.js');

function peer(url){
  const ws=new WebSocket(url),messages=[],waiters=[];
  ws.on('message',raw=>{const message=JSON.parse(raw.toString());messages.push(message);
    for(const waiter of [...waiters])if(waiter.test(message)){
      clearTimeout(waiter.timer);waiters.splice(waiters.indexOf(waiter),1);waiter.resolve(message);
    }
  });
  return {ws,messages,seq:0,open:new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)}),
    send:message=>ws.send(JSON.stringify(message)),
    wait:(test,ms=5000)=>{const found=messages.find(test);if(found)return Promise.resolve(found);
      return new Promise((resolve,reject)=>{const waiter={test,resolve,timer:setTimeout(()=>reject(Error('Timed out')),ms)};waiters.push(waiter);});},
    input(forward=0,strafe=0,build=false,dig=false){this.send({type:'input',seq:++this.seq,forward,strafe,build,dig});}
  };
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,20));

(async()=>{
  const httpServer=http.createServer((_req,res)=>res.end('ok'));
  const multi=createMultiplayerServer(httpServer,{autoTick:false});
  await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
  const url=`ws://127.0.0.1:${httpServer.address().port}/ws`,peers=[];
  const connect=async()=>{const p=peer(url);peers.push(p);await p.open;return p;};
  const ticks=n=>{for(let i=0;i<n;i++)multi.advance();};
  try{
    const red=await connect();red.send({type:'create',rules:'gates',buildMove:true});
    const created=await red.wait(m=>m.type==='joined'),roomCode=created.code;
    const blue=await connect();blue.send({type:'join',code:roomCode});await blue.wait(m=>m.type==='joined');
    red.send({type:'ready',ready:true});blue.send({type:'ready',ready:true});await red.wait(m=>m.type==='matchStart');
    const room=multi.rooms.get(roomCode);
    assert.equal(room.rules,'gates');assert.equal(room.buildMove,true);
    assert.equal(BUILD_TIME,.17);assert.equal(DIG_TIME,2.7);

    room.players.red.x=3.5;room.players.red.z=8.5;room.players.red.fx=0;room.players.red.fz=-1;
    red.input(0,0,true,false);await settle();ticks(6);
    const gate=room.walls.get('h:3:8');assert(gate,'Red built an authoritative gate');
    assert.equal(gate.team,'red');assert.equal((await blue.wait(m=>m.type==='wallBuilt'&&m.wall.id===gate.id)).wall.o,'h');
    red.input();await settle();ticks(1);
    room.players.red.z=8.35;room.players.blue.x=3.5;room.players.blue.z=7.65;room.players.blue.fz=1;
    red.input(1);blue.input(1);await settle();ticks(26);await settle();
    assert(room.players.red.z<8,'Red crossed its own gate');
    assert(room.players.blue.z<8-.18,'Blue was blocked by Red gate');
    assert(red.messages.some(m=>m.type==='gateCrossed'&&m.wallId===gate.id));
    assert(red.messages.some(m=>m.type==='snapshot'&&m.walls?.some(w=>w.id===gate.id&&w.open)),
      'a moving friendly crossing opens the gate');
    red.input();blue.input();await settle();room.players.red.x=5.5;room.players.red.z=15.5;ticks(12);
    assert.equal(gate.open,false,'gate closes after owner clears it');

    room.players.blue.x=3.5;room.players.blue.z=7.65;room.players.blue.fx=0;room.players.blue.fz=1;
    blue.input(0,0,false,true);await settle();ticks(81);await settle();
    assert(!room.walls.has('h:3:8'),'timed WallSmash removed collision');
    assert.equal(red.messages.filter(m=>m.type==='wallRemoved'&&m.wall.id===gate.id).length,1,'one Break event per gate');
    blue.input();await settle();ticks(1);

    // Both builders choose the same edge; exactly one valid server result survives.
    room.players.red.x=2.5;room.players.red.z=9.5;room.players.red.fx=0;room.players.red.fz=-1;
    room.players.blue.x=2.5;room.players.blue.z=8.5;room.players.blue.fx=0;room.players.blue.fz=1;
    red.input(0,0,true);blue.input(0,0,true);await settle();ticks(6);
    assert.equal([...room.walls.values()].filter(w=>w.x===2&&w.z===9&&w.o==='h').length,1,'same-edge race resolves once');
    red.input();blue.input();await settle();ticks(1);

    // A hostile body can enter the locked edge during the build. Final validation wins.
    room.players.red.x=1.5;room.players.red.z=15.5;room.players.red.fx=0;room.players.red.fz=-1;
    room.players.blue.x=5.5;room.players.blue.z=1.5;
    red.input(0,0,true);await settle();ticks(2);
    room.players.blue.x=1.5;room.players.blue.z=15.02;ticks(4);await settle();
    assert(!room.walls.has('h:1:15'),'opponent arrival cancels final placement');
    assert(red.messages.some(m=>m.type==='buildCanceled'&&m.reason==='opponent occupies edge'));
    red.input();await settle();ticks(1);

    room.players.red.x=5.5;room.players.red.z=15.5;room.players.red.fx=0;room.players.red.fz=-1;
    room.players.blue.x=1.5;room.players.blue.z=1.5;
    red.input(1,0,true);await settle();ticks(2);
    assert(Math.abs(room.players.red.z-15.46)<.005,'gate builder moves at 40% of dry speed');
    assert.equal(wallKeyFor(room.players.red.buildTarget),'h:5:15','construction edge stays locked while moving');
    red.input();await settle();ticks(1);
    assert(!room.walls.has('h:5:15'),'early release cancels construction');
    room.players.red.x=2.5;room.players.red.z=14.5;room.players.red.fx=1;room.players.red.fz=0;
    red.input(0,0,true);await settle();ticks(6);
    assert(room.walls.has('v:3:14'),'vertical grid orientation builds');
    red.input();await settle();ticks(1);

    // Room isolation, normal-wall collision and oldest-wall replacement.
    const normalRed=await connect();normalRed.send({type:'create',rules:'normal'});
    const normalCode=(await normalRed.wait(m=>m.type==='joined')).code;
    const normalBlue=await connect();normalBlue.send({type:'join',code:normalCode});await normalBlue.wait(m=>m.type==='joined');
    normalRed.send({type:'ready',ready:true});normalBlue.send({type:'ready',ready:true});await normalRed.wait(m=>m.type==='matchStart');
    const normal=multi.rooms.get(normalCode);
    for(let i=0;i<MAX_WALLS+1;i++){
      normal.players.red.x=i%7+.5;normal.players.red.z=i<7?15.5:14.5;
      normal.players.red.fx=0;normal.players.red.fz=-1;
      normalRed.input(0,0,true);await settle();ticks(6);
      normalRed.input();await settle();ticks(1);
    }
    assert.equal(normal.wallOrder.red.length,MAX_WALLS);
    assert(!normal.walls.has('h:0:15'),'the thirteenth wall replaced the oldest');
    assert.equal(room.walls.size,2,'independent room wall state');
    normal.players.red.x=1.5;normal.players.red.z=14.6;normal.players.red.fx=0;normal.players.red.fz=-1;
    const ownWall=normal.walls.get('h:1:14');assert(ownWall);
    normalRed.input(1);await settle();ticks(15);
    assert(normal.players.red.z>14+.18,'normal wall blocks its owner');

    normalRed.send({type:'input',seq:++normalRed.seq,forward:0,strafe:0,build:true,edge:{x:6,z:1,o:'h'},duration:0,success:true});
    assert.equal((await normalRed.wait(m=>m.type==='error'&&m.reason==='invalid_input')).reason,'invalid_input');
    const rejoined=await connect();rejoined.send({type:'join',code:normalCode,token:(await normalRed.wait(m=>m.type==='joined')).token});
    await rejoined.wait(m=>m.type==='joined');
    const recovered=await rejoined.wait(m=>m.type==='snapshot'&&m.walls?.length===MAX_WALLS);
    assert.equal(recovered.walls.length,MAX_WALLS,'authenticated reconnect receives all active IDs');
    console.log('PASS Phase 2B server walls: build, cancellation, overlap, 12/13 replacement, friendly pass, hostile collision, timed destruction, gate close, same-edge race, room isolation and reconnect');
  }finally{
    for(const p of peers)p.ws.terminate();multi.close();await new Promise(resolve=>httpServer.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1});
function wallKeyFor(edge){return edge&&`${edge.o}:${edge.x}:${edge.z}`;}
