// Shared presentation only. Never pauses a live server match or changes Ready state.
const STORAGE_KEY='wall-rush-tutorial-v1';
const steps=[
 {title:'MOVE YOUR CHAMPION',text:'Use arrow keys or WASD to move.',hint:'Find your route. Dodge your rival.',scene:'move'},
 {title:'BUILD & BATTLE',text:'Hold F to build. Hold G to break.',hint:'SPACE to shove · H to use a collected power.',scene:'battle'},
 {title:'STEAL THE FLAG!',text:'Steal their flag. Bring it home!',hint:'Bank at your gold pole. Your own flag must be home to win.',scene:'flag'}
];
export function createTutorial(){
 const root=document.createElement('section');root.id='party-tutorial';root.hidden=true;
 root.innerHTML=`<div class="tutorial-card" role="dialog" aria-label="How to play Wall Rush" tabindex="-1">
 <div class="tutorial-top"><span>FORT RUSH FESTIVAL</span><button type="button" class="tutorial-skip">Skip</button></div>
 <p class="tutorial-live" hidden>Gameplay continues — keep moving!</p>
 <div class="tutorial-pages" aria-hidden="true"><i></i><i></i><i></i></div>
 <h2></h2><div class="tutorial-stage" aria-hidden="true">
 <div class="demo-ground"></div><div class="demo-champion"><i class="demo-head"></i><i class="demo-body"></i><i class="demo-boots"></i><b class="demo-carried">⚑</b></div>
 <div class="demo-rival"><i class="demo-head"></i><i class="demo-body"></i><i class="demo-boots"></i></div>
 <div class="demo-gate"><i></i><i></i><i></i><i></i></div>
 <div class="demo-blue-flag">⚑</div><div class="demo-pole">★</div>
 <div class="demo-arrows"><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd><kbd>←</kbd></div>
 <div class="demo-battle-keys"><span><kbd>F</kbd> Build</span><span><kbd>G</kbd> Break</span><span><kbd>SPACE</kbd> Shove</span><span><kbd>H</kbd> Power</span></div>
 </div><p class="tutorial-text"></p><p class="tutorial-hint"></p>
 <div class="tutorial-nav"><button type="button" class="tutorial-back">Back</button><span class="tutorial-count"></span><button type="button" class="tutorial-next">Next ➜</button></div></div>`;
 document.body.append(root);
 const q=s=>root.querySelector(s);let index=0,live=false,resolve=null,priorFocus=null;
 function seen(){try{return localStorage.getItem(STORAGE_KEY)==='done';}catch{return false;}}
 function paint(){const step=steps[index];root.dataset.step=step.scene;q('h2').textContent=step.title;
  q('.tutorial-text').textContent=step.text;q('.tutorial-hint').textContent=step.hint;
  q('.tutorial-count').textContent=`${index+1} / 3`;q('.tutorial-back').disabled=index===0;
  q('.tutorial-next').textContent=index===2?'Let’s play!':'Next ➜';
  root.querySelectorAll('.tutorial-pages i').forEach((p,i)=>p.classList.toggle('active',i===index));
 }
 function close(remember=true){if(root.hidden)return;root.hidden=true;document.body.classList.remove('tutorial-blocking');
  if(remember)try{localStorage.setItem(STORAGE_KEY,'done');}catch{}
  const complete=resolve;resolve=null;priorFocus?.focus?.({preventScroll:true});complete?.();
  window.dispatchEvent(new Event('wall-rush-tutorial-closed'));
 }
 function show({nonblocking=false,team='red'}={}){
  if(!root.hidden)return new Promise(done=>{const previous=resolve;resolve=()=>{previous?.();done();};});
  live=nonblocking;index=0;root.dataset.team=team;root.classList.toggle('nonblocking',live);
  q('.tutorial-card').setAttribute('aria-modal',String(!live));q('.tutorial-live').hidden=!live;
  q('.tutorial-skip').textContent=live?'Close':'Skip';priorFocus=document.activeElement;root.hidden=false;
  document.body.classList.toggle('tutorial-blocking',!live);paint();
  window.dispatchEvent(new Event('wall-rush-tutorial-opened'));q('.tutorial-next').focus({preventScroll:true});
  return new Promise(done=>resolve=done);
 }
 root.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();return;}
  if(!live&&event.key==='Tab'){const controls=[...root.querySelectorAll('button:not(:disabled)')];
   if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls.at(-1).focus();}
   else if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0].focus();}}
 });
 q('.tutorial-skip').onclick=()=>close();q('.tutorial-next').onclick=()=>{if(index===2)close();else{index++;paint();}};
 q('.tutorial-back').onclick=()=>{index=Math.max(0,index-1);paint();};
 return {show,ensure:options=>seen()?Promise.resolve():show(options),close,
  get blocking(){return !root.hidden&&!live;},get visible(){return !root.hidden;}};
}
