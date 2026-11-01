const assert=require('node:assert/strict');
const {once}=require('node:events');
const WebSocket=require('ws');
process.env.NODE_ENV='production';
const {server,multiplayer}=require('../serve.cjs');

const waitFor=(ws,type,timeout=2000)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{ws.off('message',message);reject(new Error(`Missing ${type}`));},timeout);
  function message(raw){const value=JSON.parse(raw);if(value.type===type){clearTimeout(timer);ws.off('message',message);resolve(value);}}
  ws.on('message',message);
});
async function connect(url,origin){
  const ws=new WebSocket(url,{origin});await once(ws,'open');return ws;
}
async function main(){
  await new Promise(resolve=>server.listen(0,'0.0.0.0',resolve));
  const port=server.address().port,base=`http://127.0.0.1:${port}`,origin=`https://127.0.0.1:${port}`;
  for(const [file,status] of [['/healthz',200],['/',200],['/index.html',200],['/src/main.js',200],
    ['/assets/characters/RedChampion_Anim_05.glb',200],['/assets/gates/WallRush_WoodenGate_Anim_05.glb',200],
    ['/server/multiplayer.cjs',404],['/serve.cjs',404],['/package.json',404],['/checkpoints/',404],
    ['/reports/',404],['/.node-version',404]]){
    const result=await fetch(base+file);assert.equal(result.status,status,file);
    if(file.endsWith('.glb'))assert.ok((await result.arrayBuffer()).byteLength>1000,file);
  }
  const lobby=await (await fetch(base+'/')).text(),arena=await (await fetch(base+'/index.html')).text();
  assert.match(lobby,/join-code/);assert.match(arena,/src\/main\.js/);
  assert.equal((await fetch(base+'/api/match-report',{method:'POST'})).status,404);
  const rejected=await new Promise(resolve=>{
    const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`,{origin:'https://foreign.example'});
    ws.on('open',()=>resolve(false));ws.on('error',()=>resolve(true));
  });
  assert.equal(rejected,true,'cross-origin websocket rejected');
  const red=await connect(`ws://127.0.0.1:${port}/ws`,origin);
  const joinedRed=waitFor(red,'joined');red.send(JSON.stringify({type:'create'}));
  const room=await joinedRed;assert.match(room.code,/^[A-Z2-9]{6}$/);
  const blue=await connect(`ws://127.0.0.1:${port}/ws`,origin);
  const joinedBlue=waitFor(blue,'joined');blue.send(JSON.stringify({type:'join',code:room.code}));
  assert.equal((await joinedBlue).team,'blue');
  const rateClosed=once(blue,'close');
  for(let i=0;i<81;i++)blue.send(JSON.stringify({type:'input',seq:i,forward:0,strafe:0}));
  const [closeCode]=await rateClosed;assert.equal(closeCode,1008,'excess messages close socket');
  red.close();
  console.log('Production HTTP allowlist, health, GLBs, same-origin WS room join, and message limit passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{
  multiplayer.close();server.close();
});
