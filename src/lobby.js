import {createTutorial} from './tutorial.js';
const tutorial=createTutorial();
const $=selector=>document.querySelector(selector);
const start=$('#start-screen'),roomPanel=$('#room-panel'),demoPanel=$('#demo-panel'),debugPanel=$('#debug-panel');
const connection=$('#connection'),errorMessage=$('#error-message'),readyButton=$('#ready-button');
const roomCode=$('#room-code'),redStatus=$('#red-status'),blueStatus=$('#blue-status'),phaseText=$('#room-phase');
const codeInput=$('#join-code'),copyButton=$('#copy-code'),debugToggle=$('#debug-toggle');
const canvas=$('#demo-canvas'),ctx=canvas.getContext('2d');
let socket=null,code=null,team=null,playerToken=null,lobby=null,snapshot=null,seq=0,ready=false,retry=null;
let enteringArena=false;
let roomRules='gates',roomBuildMove=true;
const keys=new Set();
const params=new URLSearchParams(location.search);
const requestedCode=params.get('room')?.replace(/\s+/g,'').toUpperCase();
let debugMode=params.get('debug')==='1';
if(requestedCode)codeInput.value=requestedCode;
function status(message){connection.textContent=message;}
function showError(message){errorMessage.textContent=message;errorMessage.hidden=!message;codeInput.classList.toggle('invalid',!!message&&!start.hidden);codeInput.setAttribute('aria-invalid',String(!!message&&!start.hidden));}
function send(message){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));}
function updateDebug(){
  debugPanel.hidden=!debugMode;debugToggle.setAttribute('aria-expanded',String(debugMode));
  debugToggle.textContent=debugMode?'Hide developer view':'Developer view';
  demoPanel.hidden=!debugMode||lobby?.phase!=='playing';
  if(debugMode&&snapshot)draw();
}
function friendlyError(reason){
  return ({room_not_found:'Room not found. Check the code or ask for a new one.',room_full:'This room is full. Only two players can join.',role_taken:'This player slot is already in use.',already_in_room:'Leave this room before joining another.',invalid_ready:'Ready is unavailable right now.'})[reason]||'Could not join the room. Please try again.';
}
function enterArena(){
  if(enteringArena||!code)return;
  tutorial.close(false);
  enteringArena=true;
  location.assign('./index.html?arena=wetlands-v3&rules='+roomRules+'&buildmove='+(roomBuildMove?'1':'0')+'&online=1&room='+encodeURIComponent(code));
}
function updateLobby(){
  if(!lobby)return;
  const players=lobby.players;
  for(const side of ['red','blue']){
    const player=players[side],slot=$('#'+side+'-slot'),label=side==='red'?redStatus:blueStatus;
    label.textContent=!player?'Waiting…':player.connected?(player.ready?'Ready!':'Connected'):'Disconnected';
    slot.classList.toggle('ready',!!player?.ready);
  }
  ready=!!players[team]?.ready;readyButton.innerHTML=ready?'READY! <span aria-hidden="true">✓</span>':'I\'M READY <span aria-hidden="true">✓</span>';
  readyButton.classList.toggle('is-ready',ready);
  readyButton.hidden=lobby.phase==='playing'||lobby.phase==='finished';
  phaseText.textContent=lobby.phase==='playing'?'Match in progress':
    lobby.phase==='interrupted'?'Player disconnected · waiting to rejoin':
    lobby.phase==='finished'?'Match finished':
    !players.blue?'Waiting for Blue player…':
    players.red?.ready&&players.blue?.ready?'Starting match…':'Both players press Ready!';
  updateDebug();
}
function onMessage(message){
  if(message.type==='hello'){status('Connected');return;}
  if(message.type==='error'){showError(friendlyError(message.reason));return;}
  if(message.type==='joined'){
    code=message.code;team=message.team;playerToken=message.token;
    roomRules=message.rules==='normal'?'normal':'gates';roomBuildMove=!!message.buildMove;
    sessionStorage.setItem('wall-rush-room-'+code,playerToken);
    const url=new URL(location.href);url.searchParams.set('room',code);history.replaceState(null,'',url);
    roomCode.textContent=code;$('#your-role').textContent='YOU ARE '+team.toUpperCase();
    start.hidden=true;roomPanel.hidden=false;showError('');
    if(message.phase==='playing')enterArena();
    else tutorial.ensure({team});
    return;
  }
  if(message.type==='lobby'&&message.code===code){lobby=message;updateLobby();return;}
  if(message.type==='matchStart'&&message.code===code){roomRules=message.rules==='normal'?'normal':'gates';roomBuildMove=!!message.buildMove;enterArena();return;}
  if(message.type==='snapshot'&&message.code===code){snapshot=message;draw();return;}
  if(message.type==='disconnected'){status(message.team.toUpperCase()+' disconnected');return;}
  if(message.type==='matchComplete'&&message.code===code){phaseText.textContent='Match finished';demoPanel.hidden=true;}
}
function connect(){
  clearTimeout(retry);
  status('Connecting to room server…');
  socket=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws');
  socket.addEventListener('open',()=>{
    status('Connected to room server');
    if(code||requestedCode){const id=code||requestedCode;send({type:'join',code:id,token:playerToken||sessionStorage.getItem('wall-rush-room-'+id)||undefined});}
  });
  socket.addEventListener('message',event=>{try{onMessage(JSON.parse(event.data));}catch{showError('Invalid server response');}});
  socket.addEventListener('close',()=>{status('Disconnected');snapshot=null;if(code)retry=setTimeout(connect,1200);else showError('Cannot connect to the room server. Please try again.');});
  socket.addEventListener('error',()=>status('Room server unavailable'));
}
$('#create-room').addEventListener('click',()=>{if(socket?.readyState!==WebSocket.OPEN){showError('Cannot connect to the room server. Please try again.');return;}showError('');const rules=params.get('rules')==='normal'?'normal':'gates';send({type:'create',rules,buildMove:rules==='gates'&&params.get('buildmove')!=='0'});});
codeInput.addEventListener('input',()=>{const normalized=codeInput.value.replace(/\s+/g,'').toUpperCase();if(codeInput.value!==normalized)codeInput.value=normalized;showError('');});
$('#join-form').addEventListener('submit',event=>{
  event.preventDefault();
  const id=codeInput.value.replace(/\s+/g,'').toUpperCase();codeInput.value=id;
  if(!/^[A-HJ-NP-Z2-9]{6}$/.test(id)){showError('Enter a valid six-character room code.');return;}
  if(socket?.readyState!==WebSocket.OPEN){showError('Cannot connect to the room server. Please try again.');return;}
  showError('');
  send({type:'join',code:id,token:sessionStorage.getItem('wall-rush-room-'+id)||undefined});
});
readyButton.addEventListener('click',async()=>{
  const currentCode=code;
  await tutorial.ensure({team});
  if(code===currentCode&&!enteringArena)send({type:'ready',ready:!ready});
});
$('#tutorial-help').addEventListener('click',()=>{
  // Withdraw an already-ready player before reopening blocking pre-match help.
  if(ready)send({type:'ready',ready:false});
  tutorial.show({team:team||'red'});
});
debugToggle.hidden=!debugMode;
copyButton.addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(code);copyButton.textContent='COPIED!';setTimeout(()=>copyButton.textContent='COPY CODE',1600);}
  catch{showError('Copy unavailable. Select the code above to share it.');}
});
debugToggle.addEventListener('click',()=>{
  debugMode=!debugMode;keys.clear();sendInput();
  const url=new URL(location.href);if(debugMode)url.searchParams.set('debug','1');else url.searchParams.delete('debug');history.replaceState(null,'',url);
  updateDebug();
});
function draw(){
  if(!snapshot)return;
  const width=canvas.width,height=canvas.height,pad=18;
  ctx.fillStyle='#91c87c';ctx.fillRect(0,0,width,height);
  ctx.strokeStyle='#ffffff55';ctx.lineWidth=1;
  for(let x=0;x<=7;x++){const px=pad+x*(width-2*pad)/7;ctx.beginPath();ctx.moveTo(px,pad);ctx.lineTo(px,height-pad);ctx.stroke();}
  for(let z=0;z<=17;z++){const py=pad+z*(height-2*pad)/17;ctx.beginPath();ctx.moveTo(pad,py);ctx.lineTo(width-pad,py);ctx.stroke();}
  for(const [side,color] of [['blue','#2363df'],['red','#db2a46']]){
    const player=snapshot.players[side];if(!player)continue;
    const x=pad+player.x*(width-2*pad)/7,z=pad+player.z*(height-2*pad)/17;
    ctx.fillStyle=color;ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,z,13,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.fillStyle='#fff';ctx.font='bold 13px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(side==='red'?'R':'B',x,z);
  }
  $('#position-readout').textContent='Server tick '+snapshot.tick+' · Red ('+snapshot.players.red.x.toFixed(2)+', '+snapshot.players.red.z.toFixed(2)+') · Blue ('+snapshot.players.blue.x.toFixed(2)+', '+snapshot.players.blue.z.toFixed(2)+')';
}
function sendInput(){
  if(lobby?.phase!=='playing'||!team)return;
  send({type:'input',seq:++seq,forward:Number(keys.has('KeyW'))-Number(keys.has('KeyS')),strafe:Number(keys.has('KeyD'))-Number(keys.has('KeyA'))});
}
window.addEventListener('keydown',event=>{if(!debugMode||!['KeyW','KeyA','KeyS','KeyD'].includes(event.code)||event.target instanceof HTMLInputElement)return;event.preventDefault();keys.add(event.code);sendInput();});
window.addEventListener('keyup',event=>{if(keys.delete(event.code))sendInput();});
window.addEventListener('blur',()=>{keys.clear();sendInput();});
setInterval(sendInput,100);
updateDebug();
connect();
