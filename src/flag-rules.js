// Authoritative flag state transitions shared by solo play and room matches.
import {ARENA_WIDTH,ARENA_LENGTH} from './terrain.js';
import {shovePathClear} from './shove-rules.js';

export const FLAG_POLE_OFFSET=.58;
export const CAPTURE_RADIUS=.58;
export const FLAG_PICKUP_RADIUS=.50;
export const FLAG_CARRIER_SPEED_MULT=.90;
export const FLAG_DROP_INTERACT_DELAY=.22;
export const FLAG_TOSS_TIME=.4;
export const FLAG_TOSS_MIN_RADIUS=1.25;
export const FLAG_TOSS_MAX_RADIUS=2;
export const FLAG_REPICK_LOCK=.90;
export const CAPTURE_CHANNEL_TIME=1;
export const otherTeam=team=>team==='red'?'blue':'red';
export function flagHomePosition(team){
  return {x:ARENA_WIDTH/2-FLAG_POLE_OFFSET,z:team==='red'?ARENA_LENGTH-.38:.38};
}
export function capturePolePosition(team){
  return {x:ARENA_WIDTH/2+FLAG_POLE_OFFSET,z:team==='red'?ARENA_LENGTH-.38:.38};
}
export function createFlag(team){
  return {team,status:'home',...flagHomePosition(team),carrier:null,dropInteractDelay:0,
    dropLockTimer:0,dropLockActor:null,bankedAt:null,tossRemaining:0,tossFrom:null};
}
export function flagPosition(flag){
  return flag.status==='carried'&&flag.carrier?{x:flag.carrier.x,z:flag.carrier.z}:{x:flag.x,z:flag.z};
}
export function flagTossLanding(actor,random,blocked){
  for(let i=0;i<64;i++){
    const angle=random()*Math.PI*2;
    const radius=Math.sqrt(FLAG_TOSS_MIN_RADIUS**2+random()*(FLAG_TOSS_MAX_RADIUS**2-FLAG_TOSS_MIN_RADIUS**2));
    const x=actor.x+Math.cos(angle)*radius,z=actor.z+Math.sin(angle)*radius;
    if(x<.25||x>ARENA_WIDTH-.25||z<.25||z>ARENA_LENGTH-.25||blocked(x,z))continue;
    return {x,z};
  }
  for(let r=FLAG_TOSS_MIN_RADIUS;r<=FLAG_TOSS_MAX_RADIUS+.001;r+=.05)for(let i=0;i<72;i++){
    const angle=i*Math.PI/36,x=actor.x+Math.cos(angle)*r,z=actor.z+Math.sin(angle)*r;
    if(x>=.25&&x<=ARENA_WIDTH-.25&&z>=.25&&z<=ARENA_LENGTH-.25&&!blocked(x,z))return {x,z};
  }
  return {x:actor.x,z:actor.z};
}
export function canTouchFlag(actor,position,blocked){
  return Math.hypot(actor.x-position.x,actor.z-position.z)<=FLAG_PICKUP_RADIUS&&shovePathClear(actor,position,blocked);
}
export function returnFlagHome(flags,team){
  const flag=flags[team];if(!flag)return false;
  if(flag.carrier)flag.carrier.carryingFlag=null;
  Object.assign(flag,{status:'home',...flagHomePosition(team),carrier:null,tossRemaining:0,tossFrom:null,
    dropInteractDelay:0,dropLockTimer:0,dropLockActor:null,bankedAt:null});
  return true;
}
export function pickUpFlag(flags,actor,team){
  const flag=flags[team];
  if(!flag||actor.team===team||actor.carryingFlag||!['home','dropped'].includes(flag.status))return false;
  Object.assign(flag,{status:'carried',carrier:actor,dropInteractDelay:0,dropLockTimer:0,
    dropLockActor:null,bankedAt:null});
  actor.carryingFlag=team;actor.crossedGateThisCarry=false;
  return true;
}
export function dropCarriedFlag(flags,actor,random,blocked){
  if(!actor?.carryingFlag)return null;
  const flag=flags[actor.carryingFlag],landing=flagTossLanding(actor,random,blocked);
  Object.assign(flag,{status:'dropped',tossFrom:{x:actor.x,z:actor.z},tossRemaining:FLAG_TOSS_TIME,
    x:landing.x,z:landing.z,carrier:null,dropInteractDelay:Math.max(FLAG_DROP_INTERACT_DELAY,FLAG_TOSS_TIME),
    dropLockTimer:FLAG_REPICK_LOCK,dropLockActor:actor,bankedAt:null});
  actor.carryingFlag=null;actor.crossedGateThisCarry=false;actor.captureProgress=0;
  return {flag,landing};
}
export function bankCarriedFlag(flags,actor){
  if(!actor?.carryingFlag)return null;
  const flag=flags[actor.carryingFlag],pole=capturePolePosition(actor.team);
  Object.assign(flag,{status:'banked',x:pole.x,z:pole.z,carrier:null,dropInteractDelay:0,
    dropLockTimer:0,dropLockActor:null,bankedAt:actor.team,tossRemaining:0,tossFrom:null});
  actor.carryingFlag=null;actor.crossedGateThisCarry=false;actor.captureProgress=0;
  return flag;
}
export function advanceFlagTimers(flags,dt){
  for(const flag of Object.values(flags)){
    flag.tossRemaining=Math.max(0,(flag.tossRemaining||0)-dt);
    flag.dropInteractDelay=Math.max(0,(flag.dropInteractDelay||0)-dt);
    flag.dropLockTimer=Math.max(0,(flag.dropLockTimer||0)-dt);
    if(flag.dropLockTimer<=0)flag.dropLockActor=null;
  }
}
export function flagTouch(flags,actor,blocked){
  const own=flags[actor.team];
  if(own.status==='dropped'&&own.dropInteractDelay<=0&&canTouchFlag(actor,flagPosition(own),blocked)){
    returnFlagHome(flags,actor.team);return {type:'flagReturned',team:actor.team,by:actor.team};
  }
  if(own.status==='banked'&&canTouchFlag(actor,flagPosition(own),blocked)){
    returnFlagHome(flags,actor.team);return {type:'flagReturned',team:actor.team,by:actor.team};
  }
  const enemyTeam=otherTeam(actor.team),enemy=flags[enemyTeam];
  if(!actor.carryingFlag&&['home','dropped'].includes(enemy.status)&&enemy.dropInteractDelay<=0&&
    !(enemy.status==='dropped'&&enemy.dropLockActor===actor&&enemy.dropLockTimer>0)&&
    canTouchFlag(actor,flagPosition(enemy),blocked)&&pickUpFlag(flags,actor,enemyTeam)){
    return {type:'flagPickedUp',team:enemyTeam,by:actor.team};
  }
  return null;
}
export function checkFlagBank(flags,actor,dt){
  const pole=capturePolePosition(actor.team);
  if(actor.carryingFlag!==otherTeam(actor.team)||Math.hypot(actor.x-pole.x,actor.z-pole.z)>CAPTURE_RADIUS){
    actor.captureProgress=0;return null;
  }
  actor.captureProgress=Math.min(CAPTURE_CHANNEL_TIME,actor.captureProgress+dt);
  if(actor.captureProgress<CAPTURE_CHANNEL_TIME)return null;
  const flag=bankCarriedFlag(flags,actor);
  return flag?{type:'flagBanked',team:flag.team,by:actor.team}:null;
}
export function flagWinner(flags){
  for(const team of ['red','blue']){
    const own=flags[team],enemy=flags[otherTeam(team)];
    if(own.status==='home'&&enemy.status==='banked'&&enemy.bankedAt===team)return team;
  }
  return null;
}
