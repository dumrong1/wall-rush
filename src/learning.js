// Small outcome learner, not neural-network training. Each team has the same
// strategies and UCB exploration rule; movement/combat abilities are untouched.
export const METHODS=['direct','flank-left','flank-right','intercept'];
export function createLearner(arena,storage=null){
 const key='wall-rush-learning-v1-'+arena;
 const fresh=()=>Object.fromEntries(['red','blue'].map(team=>[team,Object.fromEntries(METHODS.map(m=>[m,{rounds:0,reward:0,wins:0}]))]));
 let stats=fresh(),round=0;
 try{
  const saved=JSON.parse(storage?.getItem(key)||'null');
  if(saved?.version===1&&Number.isSafeInteger(saved.round)&&saved.round>=0){
   for(const team of ['red','blue'])for(const m of METHODS){
    const s=saved.stats?.[team]?.[m];
    if(!s||!Number.isSafeInteger(s.rounds)||s.rounds<0||!Number.isFinite(s.reward)||s.reward<0||s.reward>s.rounds||!Number.isSafeInteger(s.wins)||s.wins<0||s.wins>s.rounds)throw new Error('Invalid learning data');
   }
   stats=JSON.parse(JSON.stringify(saved.stats));round=saved.round;
  }
 }catch{stats=fresh();round=0;}
 function snapshot(){return JSON.parse(JSON.stringify({version:1,arena,round,stats}));}
 function save(){try{storage?.setItem(key,JSON.stringify(snapshot()));}catch{}}
 function select(team,seed){
  const row=stats[team],total=METHODS.reduce((n,m)=>n+row[m].rounds,0);
  // Seed/round-dependent tie order is separate from gameplay RNG.
  const offset=((seed>>>0)+round+(team==='blue'?2:0))%METHODS.length;
  const order=METHODS.map((_,i)=>METHODS[(i+offset)%METHODS.length]);
  const untried=order.find(m=>row[m].rounds===0);if(untried)return untried;
  const score=m=>row[m].reward/row[m].rounds+Math.sqrt(2*Math.log(total+1)/row[m].rounds);
  return order.reduce((best,m)=>score(m)>score(best)+1e-10?m:best,order[0]);
 }
 function record(methods,winner){
  for(const team of ['red','blue']){
   const s=stats[team][methods[team]];if(!s)throw new Error('Unknown method');
   s.rounds++;s.reward+=winner===team?1:winner===null?.25:0;s.wins+=winner===team?1:0;
  }
  round++;save();
 }
 return {select,record,snapshot,reset(){stats=fresh();round=0;save();}};
}
