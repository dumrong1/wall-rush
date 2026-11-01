const assert=require('node:assert/strict');
const http=require('node:http');
const {WebSocket}=require('ws');
const {createMultiplayerServer}=require('../server/multiplayer.cjs');
const {pickUpFlag,capturePolePosition}=require('../src/flag-rules.js');

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function peer(url){
  const ws=new WebSocket(url),messages=[];
  ws.on('message',raw=>messages.push(JSON.parse(raw.toString())));
  return {ws,messages,seq:0,open:new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)}),
    send(value){ws.send(JSON.stringify(value));},
    input(forward=0,strafe=0){this.send({type:'input',seq:++this.seq,forward,strafe});},
    async get(test){for(let i=0;i<300;i++){const found=messages.find(test);if(found)return found;await wait(8);}throw Error('message timeout');}
  };
}
(async()=>{
  const server=http.createServer((_,res)=>res.end('ok'));
  const multi=createMultiplayerServer(server,{autoTick:false});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`ws://127.0.0.1:${server.address().port}/ws`,peers=[];
  const connect=async()=>{const p=peer(url);peers.push(p);await p.open;return p;};
  const tick=n=>{for(let i=0;i<n;i++)multi.advance();};
  try{
    const red=await connect();red.send({type:'create'});const joined=await red.get(m=>m.type==='joined');
    const blue=await connect();blue.send({type:'join',code:joined.code});await blue.get(m=>m.type==='joined');
    red.send({type:'ready',ready:true});blue.send({type:'ready',ready:true});await red.get(m=>m.type==='matchStart');
    const room=multi.rooms.get(joined.code),r=room.players.red,b=room.players.blue;

    // Inject 50/100/200 ms client-to-server delay. Server positions are checked
    // before and after delivery, then compared in both authoritative snapshots.
    for(const latency of [50,100,200]){
      red.input();blue.input();await wait(10);tick(1);
      const before=r.z,sequence=++red.seq;
      const delayed=setTimeout(()=>red.send({type:'input',seq:sequence,forward:1,strafe:0}),latency);
      tick(1);assert.equal(r.z,before,`${latency} ms: no movement before delayed input arrives`);
      await wait(latency+15);tick(4);clearTimeout(delayed);await wait(10);
      assert(r.z<before-.01,`${latency} ms: movement applies after delivery`);
      const serverTick=room.tick;
      const redView=await red.get(m=>m.type==='snapshot'&&m.tick===serverTick);
      const blueView=await blue.get(m=>m.type==='snapshot'&&m.tick===serverTick);
      assert.deepEqual(redView.players,blueView.players,`${latency} ms: both clients receive the same state`);
      red.send({type:'input',seq:sequence,forward:1,strafe:0});
      assert.equal((await red.get(m=>m.type==='error'&&m.reason==='invalid_input')).reason,'invalid_input');
      red.messages.length=0;
    }
    red.input(1);blue.input(1);await wait(10);const rz=r.z,bz=b.z;tick(4);
    assert(r.z<rz&&b.z>bz,'simultaneous opposite-team inputs move independently');
    red.input();blue.input();await wait(340);const stopped=r.z;tick(3);
    assert.equal(r.z,stopped,'stale input stops movement');

    // A disconnected carrier at the capture pole must not finish banking while absent.
    r.x=3.5;r.z=8.5;b.x=5.5;b.z=8.5;
    assert(pickUpFlag(room.flags,r,'blue'));
    Object.assign(r,capturePolePosition('red'));tick(10);
    const progress=r.captureProgress;assert(progress>0&&progress<1);
    red.ws.close();await new Promise(resolve=>red.ws.once('close',resolve));await wait(10);
    tick(40);assert.equal(r.captureProgress,progress);
    assert.equal(room.flags.blue.status,'carried');assert.equal(room.phase,'playing');
    const reconnect=await connect();reconnect.send({type:'join',code:joined.code,token:joined.token});
    assert.equal((await reconnect.get(m=>m.type==='joined')).team,'red');
    assert.equal((await reconnect.get(m=>m.type==='snapshot')).flags.blue.carrier,'red');
    tick(21);await wait(10);
    assert.equal(room.winner,'red');
    assert.equal((await blue.get(m=>m.type==='matchComplete')).winner,'red');
    assert.equal((await reconnect.get(m=>m.type==='matchComplete')).winner,'red');
    assert.equal(multi.completeMatch(joined.code,'red'),false,'win cannot repeat');

    // Disconnected abandoned rooms expire and old codes cannot be reused.
    const abandoned=await connect();abandoned.send({type:'create'});
    const code=(await abandoned.get(m=>m.type==='joined')).code;
    abandoned.ws.close();await new Promise(resolve=>abandoned.ws.once('close',resolve));await wait(10);
    multi.rooms.get(code).updatedAt=Date.now()-11*60*1000;tick(1);
    assert.equal(multi.rooms.has(code),false);
    const expired=await connect();expired.send({type:'join',code});
    assert.equal((await expired.get(m=>m.type==='error')).reason,'room_not_found');
    console.log('PASS delayed inputs 50/100/200 ms, shared snapshots, duplicate/stale input, simultaneous controls, absent-carrier pause, reconnect, victory, abandoned-code expiry');
  }finally{
    for(const p of peers)p.ws.terminate();multi.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1});
