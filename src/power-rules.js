// Shared, headless pickup and one-use power rules for solo and room matches.
import {ARENA_ID,ARENA_WIDTH,ARENA_LENGTH} from './terrain.js';
import {PLAYER_RADIUS} from './movement.js';
import {facingEdge,wallKey} from './wall-rules.js';

export const POWER_TYPES=['jump','dash','smash'];
export const DASH_TIME=1.35;
export const POWER_RESPAWN_MIN=3.5;
export const POWER_RESPAWN_MAX=5.5;
export const MAX_POWERUPS=3;
export const POWER_PICKUP_RADIUS=.42;
export function powerSpots(contested=false){
  if(contested&&ARENA_ID==='wetlands-v3')return [
    {x:2.5,z:8.5},{x:4.5,z:8.5},{x:3.5,z:5.5},{x:3.5,z:11.5}];
  if(ARENA_ID==='wetlands-v3')return [
    {x:1.5,z:5.5},{x:3.5,z:5.5},{x:5.5,z:5.5},
    {x:5.5,z:11.5},{x:3.5,z:11.5},{x:1.5,z:11.5}];
  return [{x:1.25,z:5.5},{x:2.50,z:5.5},{x:3.75,z:5.5},
    {x:1.25,z:8.5},{x:2.50,z:8.5},{x:3.75,z:8.5}];
}
export function spawnPowerRecord(powerups,spots,random=Math.random){
  if(powerups.length>=MAX_POWERUPS)return null;
  const free=spots.filter(spot=>!powerups.some(p=>p.x===spot.x&&p.z===spot.z));
  if(!free.length)return null;
  const spot=free[Math.floor(random()*free.length)];
  return {...spot,type:POWER_TYPES[Math.floor(random()*POWER_TYPES.length)]};
}
export function collectPower(actor,powerups){
  if(actor.power)return null;
  const index=powerups.findIndex(p=>Math.hypot(actor.x-p.x,actor.z-p.z)<POWER_PICKUP_RADIUS);
  if(index<0)return null;
  const [pickup]=powerups.splice(index,1);
  actor.power=pickup.type;
  return pickup;
}
export function safeJumpLanding(actor,blocked,distance=1.18){
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  for(let d=distance;d>=.78;d-=.08){
    const x=clamp(actor.x+actor.fx*d,PLAYER_RADIUS,ARENA_WIDTH-PLAYER_RADIUS);
    const z=clamp(actor.z+actor.fz*d,PLAYER_RADIUS,ARENA_LENGTH-PLAYER_RADIUS);
    if(!blocked(x,z,actor.team))return {x,z};
  }
  return null;
}
export function activatePower(actor,{walls,blocked,removeWall}={}){
  if(!actor.power)return null;
  if(actor.power==='dash'){
    if(actor.carryingFlag)return null;
    actor.power=null;actor.dash=DASH_TIME;
    return {type:'dash',duration:DASH_TIME};
  }
  if(actor.power==='jump'){
    const landing=safeJumpLanding(actor,blocked);
    if(!landing)return null;
    actor.x=landing.x;actor.z=landing.z;actor.power=null;
    return {type:'jump',landing};
  }
  if(actor.power==='smash'){
    const edge=facingEdge(actor),key=edge?wallKey(edge):null;
    if(!key||!walls?.has(key))return null;
    if(!removeWall(key))return null;
    actor.power=null;
    return {type:'smash',edge};
  }
  return null;
}
