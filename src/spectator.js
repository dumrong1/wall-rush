import { createLearner } from './learning.js';
// Small local self-play harness. All actions and outcomes use main.js gameplay rules.
export function createSpectator(game) {
 const {state}=game;
 const learningEnabled=new URLSearchParams(location.search).get('learning')!=='off';
 let learningStorage=null;try{learningStorage=localStorage;}catch{}
 const learner=createLearner(game.arena+(game.rulesMode==='gates'?':team-gates':''),learningStorage);let methods,learningBefore;
 const params=new URLSearchParams(location.search);
 const baseSeed=(Number(params.get('seed')??12345)>>>0);
 const timeout=Math.max(10,Math.min(300,Number(params.get('timeout'))||60));
 const storageKey='wall-rush-self-play-reports-v1';
 const reports=[],pendingSaves=[];let previousBanked={};
 let seed=baseSeed,rng=seed,paused=false,speed=1,accumulator=0,stepIndex=0,remaining=0,finished=false;
 let metrics,anchors,watches=[],sampleTimer=0;
 const panel=document.createElement('aside');
 panel.id='spectator-panel';
 panel.style.cssText='position:absolute;left:12px;top:94px;z-index:20;width:360px;max-width:90vw;padding:12px;background:#111c30ed;border:1px solid #ffffff44;border-radius:12px;color:white;font:12px/1.5 system-ui';
 panel.innerHTML=`<b>BOT vs BOT · follows Red${game.rules.buildMove?' · MOVE-BUILD 40%':''}</b> <a href="./index.html?arena=${game.arena}&rules=${game.rulesMode==='gates'?'gates':'normal'}${game.rules.buildMove?'&buildmove=1':''}${params.get('pickups')==='contested'?'&pickups=contested':''}" style="color:#9ddcff">Human vs Bot</a>
 <div style="display:flex;flex-wrap:wrap;gap:5px;margin:8px 0"><button id="sp-pause">Pause</button><button id="sp-resume">Resume</button><button id="sp-restart">Restart match</button><button id="sp-speed">2× speed</button><button id="sp-five">Run 5 matches</button><button id="sp-download">Download JSON</button><button id="sp-learn-reset">Reset learning</button></div>
 <pre id="spectator-debug" style="white-space:pre-wrap;margin:0"></pre><div id="spectator-save" role="status"></div>`;
 document.getElementById('app').append(panel);
 document.querySelector('.controls').hidden=true;
 const debug=panel.querySelector('#spectator-debug'),saveStatus=panel.querySelector('#spectator-save');
 const counters=()=>({wallsBuilt:0,wallsDestroyed:0,wallsExpired:0,carrierWalls:0,defenderWalls:0,successfulFlagBanks:0,successfulShoves:0,detourEstimates:0,escapeObservations:0,stuckEpisodes:0});
 function actor(team){return team==='red'?state.player:state.bot;}
 function opponent(team){return actor(team==='red'?'blue':'red');}
 function random(){rng=(rng+0x6D2B79F5)>>>0;let n=rng;n=Math.imul(n^(n>>>15),n|1);n^=n+Math.imul(n^(n>>>7),n|61);return((n^(n>>>14))>>>0)/4294967296;}
 function flagStates(){return Object.fromEntries(Object.entries(state.flags).map(([team,f])=>[team,{status:f.status,carrier:f.carrier?.team??null,bankedAt:f.bankedAt??null}]));}
 function start(nextSeed){
  seed=nextSeed>>>0;rng=seed;accumulator=0;stepIndex=0;finished=false;sampleTimer=0;watches=[];
  game.resetGame();previousBanked={red:false,blue:false};
  learningBefore=learner.snapshot();
  methods=Object.fromEntries(['red','blue'].map(team=>[team,learningEnabled?learner.select(team,seed):'direct']));
  for(const team of ['red','blue']){actor(team).aiMethod=methods[team];actor(team).aiFlankReached=false;}
  metrics={red:counters(),blue:counters(),walls:[],escapeWindows:[]};
  anchors={red:{x:state.player.x,z:state.player.z,time:0,stuck:false},blue:{x:state.bot.x,z:state.bot.z,time:0,stuck:false}};
  document.getElementById('centerSmall').textContent='Equal AI rules · seeded powers · '+timeout+'s timeout';
  update();
 }
 function store(report){
  try {const history=JSON.parse(localStorage.getItem(storageKey)||'[]');history.push(report);localStorage.setItem(storageKey,JSON.stringify(history.slice(-100)));} catch {}
  const job=fetch('/api/match-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)})
   .then(async response=>{if(!response.ok)throw new Error('Local server does not support report saving');const result=await response.json();report.savedFile=result.file;saveStatus.textContent='Saved '+result.file;})
   .catch(()=>{saveStatus.textContent='Report kept in browser storage. Use Download JSON, or launch node serve.cjs for automatic files.';});
  pendingSaves.push(job);
 }
 function finish(){
  if(finished)return;finished=true;
  // Keep the compact spectator panel readable on narrow screens instead of
  // placing the larger center-card summary behind it.
  document.getElementById('centerCard').classList.remove('show');
  const winner=state.winner==='RED WINS!'?'red':state.winner==='BLUE WINS!'?'blue':null;
  const report={schema:1,version:'wall-rush-adaptive-rounds-v1',arena:game.arena,pickupMode:game.pickupMode||'standard',seed,timeoutSeconds:timeout,fixedStepSeconds:1/60,
   rulesMode:game.rulesMode||'normal',gateMetrics:JSON.parse(JSON.stringify(state.gateMetrics)),
   wallStrategy:Object.fromEntries(['red','blue'].map(team=>[team,{...state.wallStats[team],wallAssociatedEscapesObservational:metrics[team].escapeObservations}])),
   tacticalGateMetrics:JSON.parse(JSON.stringify(state.tacticalGateMetrics)),
   firstActor:seed%2?'blue':'red',durationSeconds:Number(state.elapsed.toFixed(4)),winner,
   learning:{enabled:learningEnabled,methods,before:learningBefore,algorithm:'UCB1 between completed rounds; win=1, loss=0, timeout=0.25'},
   outcome:winner?'win':'timeout-stalemate',stalemate:!winner,rules:game.rules,flags:flagStates(),
   teams:{red:{...metrics.red,activeWalls:state.wallOrder.red.length},blue:{...metrics.blue,activeWalls:state.wallOrder.blue.length}},wallEvents:metrics.walls,escapeWindows:metrics.escapeWindows,pendingEscapeWindows:watches,
   wallsPerMinute:Object.fromEntries(['red','blue'].map(t=>[t,metrics[t].wallsBuilt/Math.max(.001,state.elapsed)*60])),
   metricNotes:{detours:'Estimated sustained base/carrier travel seconds on cardinal terrain graph to frozen actual objective. Excludes powers, subcell positions and moving target prediction.',
    escapes:'Carrier builder had a detour estimate and increased pursuit gap by 1 unit or banked within 4 seconds; observational association, not proven causation.',
    carrierBanksAfterGateCrossing:'A successful bank after at least one friendly gate crossing in the same uninterrupted carrying episode; resets on drop or new pickup.',
    stuck:'Less than 0.08 units net movement for >=1s while objective is >0.3 units away, excluding build/dig/banking.',
    stalemate:'No winner before timeout; does not prove a permanent deadlock.'}};
  if(learningEnabled)learner.record(methods,winner);
  report.learning.after=learner.snapshot();
  reports.push(report);store(report);
  remaining=Math.max(0,remaining-1);
 }
 function routeCost(a,extra=null){const o=game.chooseBotObjective(a,opponent(a.team));return game.pathTravelTime(a,o.goalTest||game.targetGoal(o.x,o.z),extra);}
 function beforeWall(team,t){const enemy=opponent(team);return {before:routeCost(enemy),after:routeCost(enemy,game.wallKey(t.x,t.z,t.o))};}
 function wallBuilt(team,t,route){
  metrics[team].wallsBuilt++;metrics[team][actor(team).carryingFlag?'carrierWalls':'defenderWalls']++;
  const detour=Number.isFinite(route.before)&&(!Number.isFinite(route.after)||route.after>route.before);
  if(detour)metrics[team].detourEstimates++;
  metrics.walls.push({time:Number(state.elapsed.toFixed(3)),team,...t,builderCarrying:actor(team).carryingFlag, beforeSeconds:Number.isFinite(route.before)?route.before:null,
   afterSeconds:Number.isFinite(route.after)?route.after:null,estimatedDelaySeconds:route.after-route.before,detourEstimate:detour});
  const a=actor(team),b=opponent(team);
  if(a.carryingFlag&&detour)watches.push({team,flag:a.carryingFlag,time:state.elapsed,gap:Math.hypot(a.x-b.x,a.z-b.z)});
 }
 function wallRemoved(w,detail){if(detail.reason==='wall-limit')metrics[w.team].wallsExpired++;else metrics[detail.actor||w.team].wallsDestroyed++;}
 function sample(dt){
  for(const f of Object.values(state.flags)){const banked=f.status==='banked';if(banked&&!previousBanked[f.team])metrics[f.bankedAt].successfulFlagBanks++;previousBanked[f.team]=banked;}
  sampleTimer+=dt;if(sampleTimer<.1)return;sampleTimer=0;
  for(const team of ['red','blue']){
   const a=actor(team),last=anchors[team],o=game.chooseBotObjective(a,opponent(team));
   const active=a.build<=0&&!a.digTarget&&a.captureProgress<=0&&Math.hypot(o.x-a.x,o.z-a.z)>.3;
   if(!active||Math.hypot(a.x-last.x,a.z-last.z)>.08){Object.assign(last,{x:a.x,z:a.z,time:state.elapsed,stuck:false});}
   else if(state.elapsed-last.time>=1&&!last.stuck){last.stuck=true;metrics[team].stuckEpisodes++;}
  }
  watches=watches.filter(w=>{
   if(state.elapsed-w.time<4)return true;
   const a=actor(w.team),b=opponent(w.team),f=state.flags[w.flag];
   const helped=(a.carryingFlag===w.flag&&Math.hypot(a.x-b.x,a.z-b.z)>=w.gap+1)||(f.status==='banked'&&f.bankedAt===w.team);
   if(helped)metrics[w.team].escapeObservations++;
   metrics.escapeWindows.push({...w,observedEscape:helped});return false;
  });
 }
 function update(){
  const f=flagStates();
  debug.textContent=`${game.rulesMode==='gates'?'TEAM GATES · '+Object.values(state.gateMetrics.crossings).reduce((a,b)=>a+b,0)+' friendly crossings\n':''}${paused?'PAUSED':finished?'FINISHED':'RUNNING'} · ${speed}× · ${state.elapsed.toFixed(1)} / ${timeout}s\nSeed ${seed} · learned rounds ${learner.snapshot().round}${learningEnabled?'':' (learning off)'} · reports ${reports.length}${remaining?' · batch remaining '+remaining:''}\nRed flag: ${f.red.status}${f.red.carrier?' by '+f.red.carrier:''}\nBlue flag: ${f.blue.status}${f.blue.carrier?' by '+f.blue.carrier:''}\n`+
   ['red','blue'].map(t=>{const m=metrics[t];return`${t.toUpperCase()} · ${methods[t]} · ${actor(t).aiMode}\nActive ${state.wallOrder[t].length}/${game.rules.maxWalls} · built ${m.wallsBuilt} · destroyed ${m.wallsDestroyed} · shoves ${m.successfulShoves}\nDetours~ ${m.detourEstimates} · escapes~ ${m.escapeObservations} · stuck ${m.stuckEpisodes}`;}).join('\n')+
   `\nTimeout stalemates: ${reports.filter(r=>r.stalemate).length}/${reports.length}`+
   (finished?'\n\nWALL STRATEGY · escapes are observational\n'+['red','blue'].map(t=>{const s=state.wallStats[t];return`${t.toUpperCase()} ${s.normalWallsBuilt} walls / ${s.teamGatesBuilt} gates · crosses ${s.friendlyGateCrossings} (${s.carrierGateCrossings} carrier) · banks after gate ${s.carrierBanksAfterGateCrossing} · enemy broken ${s.enemyWallsDestroyed} · escapes~ ${metrics[t].escapeObservations}`;}).join('\n'):'');
 }
 function tick(dt){
  api.visualDt=0;if(paused){update();return;}
  if(state.winner&&!finished)finish();
  if(finished){if(remaining>0)start((seed+1)>>>0);else{update();return;}}
  accumulator+=dt*speed;
  while(accumulator+1e-9>=1/60&&!finished){
   accumulator-=1/60;api.visualDt+=1/60;
   if(state.countdown>0){state.countdown=Math.max(0,state.countdown-1/60);document.getElementById('centerBig').textContent=String(Math.max(1,Math.ceil(state.countdown)));
    if(state.countdown<=1e-8){state.countdown=0;state.running=true;document.getElementById('centerCard').classList.remove('show');}}
   else if(state.running){game.stepGame(1/60);stepIndex++;sample(1/60);
    if(!state.winner&&state.elapsed+1e-8>=timeout)game.endGame('TIMEOUT · STALEMATE');
    if(state.winner)finish();}
  }
  update();
 }
 function download(){
  const blob=new Blob([JSON.stringify({reports},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`wall-rush-matches-${baseSeed}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 const api={random,tick,beforeWall,wallBuilt,wallRemoved,shoveHit:team=>metrics[team].successfulShoves++,
  get wallMetrics(){return metrics;},
  get blueFirst(){return(stepIndex+seed)%2===1;},get reports(){return reports;},pendingSaves,
  get learning(){return {enabled:learningEnabled,methods,before:learningBefore,current:learner.snapshot()};},
  resetLearning(){learner.reset();remaining=0;paused=false;start(seed);},
  get paused(){return paused;},get finished(){return finished;},get speed(){return speed;},get seed(){return seed;},timeout,
  pause(){paused=true;update();},resume(){paused=false;update();},
  restart(){remaining=0;paused=false;start(seed);},
  startBatch(){remaining=5;paused=false;start(baseSeed);},
  setSpeed(value){speed=value===2?2:1;panel.querySelector('#sp-speed').textContent=speed===2?'1× speed':'2× speed';update();},visualDt:0};
 panel.querySelector('#sp-pause').onclick=api.pause;panel.querySelector('#sp-resume').onclick=api.resume;
 panel.querySelector('#sp-restart').onclick=api.restart;panel.querySelector('#sp-five').onclick=api.startBatch;
 panel.querySelector('#sp-speed').onclick=()=>api.setSpeed(speed===1?2:1);panel.querySelector('#sp-download').onclick=download;panel.querySelector('#sp-learn-reset').onclick=api.resetLearning;
 start(baseSeed);return api;
}
