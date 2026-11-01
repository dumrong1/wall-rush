const assert=require('node:assert/strict');
const http=require('node:http');
const {WebSocket}=require('ws');
const {createMultiplayerServer}=require('../server/multiplayer.cjs');

function client(url){
  const ws=new WebSocket(url),messages=[],waiters=[];
  ws.on('message',raw=>{
    const message=JSON.parse(raw.toString());messages.push(message);
    for(const waiter of [...waiters])if(waiter.predicate(message)){
      clearTimeout(waiter.timer);waiters.splice(waiters.indexOf(waiter),1);waiter.resolve(message);
    }
  });
  const opened=new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  const wait=(predicate,ms=5000)=>{
    const found=messages.find(predicate);if(found)return Promise.resolve(found);
    return new Promise((resolve,reject)=>{const waiter={predicate,resolve,timer:setTimeout(()=>reject(Error('Timed out waiting for server message')),ms)};waiters.push(waiter);});
  };
  return {ws,messages,opened,wait,send:message=>ws.send(JSON.stringify(message))};
}
(async()=>{
  const server=http.createServer((_req,res)=>res.end('ok'));
  const multiplayer=createMultiplayerServer(server,{tickMs:1000/30});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address(),url='ws://127.0.0.1:'+address.port+'/ws';
  const clients=[];
  try{
    const red=client(url);clients.push(red);await red.opened;red.send({type:'create'});
    const created=await red.wait(m=>m.type==='joined');const code=created.code;
    assert.match(code,/^[A-HJ-NP-Z2-9]{6}$/);assert.equal(created.team,'red');assert.equal(created.token.length,40);
    const blue=client(url);clients.push(blue);await blue.opened;blue.send({type:'join',code});
    assert.equal((await blue.wait(m=>m.type==='joined')).team,'blue');
    await red.wait(m=>m.type==='lobby'&&m.players.blue?.connected);
    const third=client(url);clients.push(third);await third.opened;third.send({type:'join',code});
    assert.equal((await third.wait(m=>m.type==='error')).reason,'room_full');
    const other=client(url);clients.push(other);await other.opened;other.send({type:'create'});
    const otherRoom=(await other.wait(m=>m.type==='joined')).code;assert.notEqual(otherRoom,code);
    red.send({type:'ready',ready:true});blue.send({type:'ready',ready:true});
    await red.wait(m=>m.type==='matchStart');await blue.wait(m=>m.type==='matchStart');
    const start=await red.wait(m=>m.type==='snapshot'&&m.phase==='playing');
    red.send({type:'input',seq:1,forward:1,strafe:0});
    const moved=await blue.wait(m=>m.type==='snapshot'&&m.players.red.z<start.players.red.z-.06);
    assert.equal(moved.players.blue.z,start.players.blue.z,'only server-directed Red moved');
    red.send({type:'winner',winner:'red',x:999,z:999});
    assert.equal((await red.wait(m=>m.type==='error'&&m.reason==='unsupported_message')).reason,'unsupported_message');
    red.send({type:'input',seq:2,forward:100,strafe:0});
    assert.equal((await red.wait(m=>m.type==='error'&&m.reason==='invalid_input')).reason,'invalid_input');
    assert(multiplayer.rooms.get(code).players.red.z>=multiplayer.DEMO.radius);
    assert(other.messages.every(m=>m.code===undefined||m.code===otherRoom),'second room received another room\'s state');
    blue.ws.close();await red.wait(m=>m.type==='disconnected'&&m.team==='blue');
    assert.equal(multiplayer.rooms.get(code).phase,'interrupted');
    const replacement=client(url);clients.push(replacement);await replacement.opened;
    replacement.send({type:'join',code});assert.equal((await replacement.wait(m=>m.type==='error')).reason,'room_full');
    const resumed=client(url);clients.push(resumed);await resumed.opened;
    resumed.send({type:'join',code,token:(blue.messages.find(m=>m.type==='joined')).token});
    assert.equal((await resumed.wait(m=>m.type==='joined')).team,'blue');
    red.send({type:'ready',ready:true});resumed.send({type:'ready',ready:true});
    await resumed.wait(m=>m.type==='matchStart');
    assert(multiplayer.completeMatch(code,'red'));
    assert.equal((await red.wait(m=>m.type==='matchComplete')).winner,'red');
    assert.equal(multiplayer.rooms.get(code).phase,'finished');
    console.log('PASS unpredictable rooms, Red/Blue roles, Ready/start, authoritative movement, isolation, full-room rejection, disconnect/rejoin and server-only match completion');
  }finally{
    for(const item of clients)item.ws.terminate();
    multiplayer.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
