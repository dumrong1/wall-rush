const assert=require('node:assert/strict');
const http=require('node:http');
const {WebSocket}=require('ws');
const {createMultiplayerServer}=require('../server/multiplayer.cjs');
const {SHOVE_COOLDOWN,SHOVE_PROTECTION_TIME}=require('../src/shove-rules.js');

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
  const multi=createMultiplayerServer(server,{autoTick:false});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`ws://127.0.0.1:${server.address().port}/ws`,peers=[];
  const connect=async()=>{const p=peer(url);peers.push(p);await p.open;return p;};
  const tick=n=>{for(let i=0;i<n;i++)multi.advance();};
  const input=async(p,forward=0,strafe=0,shove=false,build=false)=>{p.input(forward,strafe,shove,build);await pause();};
  try{
    const red=await connect();red.send({type:'create',rules:'gates'});
    const code=(await red.get(m=>m.type==='joined')).code;
    const blue=await connect();blue.send({type:'join',code});await blue.get(m=>m.type==='joined');
    red.send({type:'ready',ready:true});blue.send({type:'ready',ready:true});await red.get(m=>m.type==='matchStart');
    const room=multi.rooms.get(code),r=room.players.red,b=room.players.blue;
    assert.equal(SHOVE_COOLDOWN,2.5);assert.equal(SHOVE_PROTECTION_TIME,1.2);
    const reset=(rx=3.5,rz=8.5,bx=3.5,bz=7.75)=>{
      Object.assign(r,{x:rx,z:rz,fx:0,fz:-1,shoveCooldown:0,shoveProtection:0,shoveActive:0,shoveRequested:false});
      Object.assign(b,{x:bx,z:bz,fx:0,fz:1,shoveCooldown:0,shoveProtection:0,shoveActive:0,shoveRequested:false});
    };
    const clear=async()=>{await input(red);await input(blue);tick(1);};
    const wall=(id,team,x,z,o)=>{const w={id,team,x,z,o,open:false,clearTime:0,createdTick:room.tick};room.walls.set(`${o}:${x}:${z}`,w);return w;};

    // All orientations and both owners: still, parallel and away stay closed;
    // moving toward opens, doorway occupation holds, clearing closes.
    for(const [team,o,id] of [['red','h',101],['blue','h',102],['red','v',103],['blue','v',104]]){
      room.walls.clear();const gate=wall(id,team,3,8,o);
      const owner=room.players[team],other=room.players[team==='red'?'blue':'red'];
      Object.assign(owner,o==='h'?{x:3.5,z:8.55}:{x:3.55,z:8.5});
      Object.assign(other,{x:5.5,z:15.5});
      const ownPeer=team==='red'?red:blue;
      await clear();tick(3);assert.equal(gate.open,false,`${team} ${o} still closed`);
      // World-space tangent movement differs by team and orientation.
      await input(ownPeer,0,o==='h'?(team==='red'?1:-1):0);
      if(o==='v')await input(ownPeer,team==='red'?-1:1,0);
      tick(2);assert.equal(gate.open,false,`${team} ${o} parallel closed`);
      await clear();
      Object.assign(owner,o==='h'?{x:3.5,z:8.55}:{x:3.55,z:8.5});
      await input(ownPeer,o==='h'?(team==='red'?-1:1):0,o==='v'?(team==='red'?1:-1):0);
      tick(2);assert.equal(gate.open,false,`${team} ${o} away closed`);
      await clear();
      Object.assign(owner,o==='h'?{x:3.5,z:8.55}:{x:3.55,z:8.5});
      // The enemy approaching the same doorway neither opens it nor crosses it.
      Object.assign(other,o==='h'?{x:3.5,z:7.55}:{x:2.55,z:8.5});
      const enemyPeer=team==='red'?blue:red;
      await input(enemyPeer,o==='h'?(team==='red'?-1:1):0,o==='v'?(team==='red'?1:-1):0);
      tick(2);assert.equal(gate.open,false,`${team} ${o} enemy cannot open`);
      await input(enemyPeer);Object.assign(other,{x:5.5,z:15.5});
      await input(ownPeer,o==='h'?(team==='red'?1:-1):0,o==='v'?(team==='red'?-1:1):0);
      tick(1);assert.equal(gate.open,true,`${team} ${o} crossing approach opens`);
      tick(1);await pause();
      assert(red.messages.some(m=>m.type==='snapshot'&&m.walls?.some(w=>w.id===id&&w.open)),
        'Red receives the open gate snapshot');
      assert(blue.messages.some(m=>m.type==='snapshot'&&m.walls?.some(w=>w.id===id&&w.open)),
        'Blue receives the same open gate snapshot');
      await clear();
      Object.assign(owner,o==='h'?{x:3.5,z:8.01}:{x:3.01,z:8.5});
      tick(8);assert.equal(gate.open,true,`${team} ${o} stopped in doorway stays open`);
      Object.assign(owner,o==='h'?{x:3.5,z:7.5}:{x:2.5,z:8.5});
      tick(5);assert.equal(gate.open,false,`${team} ${o} fully clear closes`);
    }
    room.walls.clear();
    reset();const left=wall(111,'red',3,8,'h'),right=wall(112,'red',5,8,'h');
    await clear();await input(red,1);tick(1);
    assert.equal(left.open,true);assert.equal(right.open,false,'gates update independently');
    await clear();room.walls.clear();

    // Shove request is a rising edge. A brief key tap survives until the tick.
    reset();await clear();
    const before=b.z;await input(red,0,0,true);await input(red);tick(1);await pause();
    assert(b.z<before,'Red hit Blue with authoritative recoil');
    assert.equal(b.shoveProtection>1.1,true);
    assert.equal(red.messages.filter(m=>m.type==='shoveHit'&&m.attacker==='red').length,1);
    assert.equal(blue.messages.filter(m=>m.type==='shoveHit'&&m.attacker==='red').length,1);
    await input(red,0,0,true);tick(1);
    assert.equal(red.messages.filter(m=>m.type==='shoveStarted'&&m.team==='red').length,1,'cooldown blocks duplicate packets');
    await clear();

    reset();await input(blue,0,0,true);tick(1);await pause();
    assert(r.z>8.5,'Blue hit Red');await clear();
    reset(3.5,8.5,3.5,6.5);const hitsBefore=red.messages.filter(m=>m.type==='shoveHit').length;
    await input(red,0,0,true);tick(1);await pause();
    assert.equal(red.messages.filter(m=>m.type==='shoveHit').length,hitsBefore,'out-of-range attack misses');
    await clear();

    reset();wall(201,'red',3,8,'h');await input(red,0,0,true);tick(1);
    assert.equal(b.z,7.75,'solid gate blocks shove line of sight');await clear();room.walls.clear();
    reset();await input(red,0,0,true);await input(blue,0,0,true);tick(1);await pause();
    assert(red.messages.some(m=>m.type==='shoveClash'),'simultaneous attacks clash');
    assert(r.z>8.5&&b.z<7.75,'clash separates both');await clear();

    reset();b.shoveProtection=SHOVE_PROTECTION_TIME;
    await input(red,0,0,true);tick(1);assert.equal(b.z,7.75,'protected victim is not hit');await clear();
    reset();wall(202,'red',3,7,'h');
    await input(red,0,0,true);tick(1);
    assert(b.z>=7+0.18,'knockback cannot pass an enemy gate');await clear();room.walls.clear();

    reset();await input(b===room.players.blue?blue:red,0,0,false,true);tick(1);
    // A valid hit cancels an ongoing build, with no completed wall.
    b.build=.12;b.buildTarget={x:3,z:7,o:'h'};
    await input(red,0,0,true);tick(1);await pause();
    assert.equal(b.build,0);assert(!room.walls.has('h:3:7'));
    assert(blue.messages.some(m=>m.type==='buildCanceled'&&m.team==='blue'&&m.reason==='shove'));
    await clear();

    const second=await connect();second.send({type:'create'});
    const secondCode=(await second.get(m=>m.type==='joined')).code;
    assert.notEqual(secondCode,code);assert.equal(multi.rooms.get(secondCode).walls.size,0);
    assert(!second.messages.some(m=>m.type==='shoveHit'),'combat events stay room-scoped');
    reset();const priorHits=blue.messages.filter(m=>m.type==='shoveHit').length;
    red.ws.terminate();await pause();await input(blue,0,0,true);tick(1);await pause();
    assert.equal(room.players.red.ws,null,'disconnected actor loses room authority');
    assert.equal(blue.messages.filter(m=>m.type==='shoveHit').length,priorHits,'combat stops with one peer disconnected');
    console.log('PASS multiplayer gate intent and shove: 4 team/orientation combinations, crossing-only doors, both attackers, cooldown, miss, protection, gate block, clash, knockback, build interruption and room isolation');
  }finally{
    for(const p of peers)p.ws.terminate();multi.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1});
