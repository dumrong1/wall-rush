// Headless shove rules shared by solo play and authoritative room matches.
import {ARENA_WIDTH,ARENA_LENGTH} from './terrain.js';
import {PLAYER_RADIUS} from './movement.js';

export const SHOVE_COOLDOWN=2.5;
export const SHOVE_PROTECTION_TIME=1.2;
export const SHOVE_RANGE=.96;
export const SHOVE_ACTIVE_TIME=.18;
export const SHOVE_CLASH_FORCE=.34;
export const SHOVE_FORCE=.62;

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function shovePathClear(attacker,target,blocked){
  const distance=Math.hypot(target.x-attacker.x,target.z-attacker.z);
  const steps=Math.ceil(distance/.06);
  for(let i=1;i<steps;i++){
    const t=i/steps;
    if(blocked(attacker.x+(target.x-attacker.x)*t,attacker.z+(target.z-attacker.z)*t))return false;
  }
  return true;
}
export function shoveCanHit(attacker,target,blocked){
  if(!attacker||!target||attacker.shoveActive<=0||target.shoveProtection>0)return false;
  const dx=target.x-attacker.x,dz=target.z-attacker.z,d=Math.hypot(dx,dz);
  if(d>SHOVE_RANGE||!shovePathClear(attacker,target,blocked))return false;
  return d<.0001||(dx*attacker.fx+dz*attacker.fz)/d>-.22;
}
export function moveShoveActor(actor,other,dx,dz,distance,blocked){
  const steps=Math.ceil(distance/.035);
  for(let i=0;i<steps;i++){
    let best=null,score=0;
    const step=distance/steps;
    for(const angle of [0,Math.PI/4,-Math.PI/4,Math.PI/2,-Math.PI/2]){
      const vx=dx*Math.cos(angle)-dz*Math.sin(angle),vz=dx*Math.sin(angle)+dz*Math.cos(angle);
      const x=clamp(actor.x+vx*step,PLAYER_RADIUS,ARENA_WIDTH-PLAYER_RADIUS);
      const z=clamp(actor.z+vz*step,PLAYER_RADIUS,ARENA_LENGTH-PLAYER_RADIUS);
      if(blocked(x,z,actor.team))continue;
      const gain=Math.hypot(x-other.x,z-other.z)-Math.hypot(actor.x-other.x,actor.z-other.z);
      const value=gain+.001*((x-actor.x)*dx+(z-actor.z)*dz);
      if(gain>.000001&&value>score){best={x,z};score=value;}
    }
    if(!best)break;
    actor.x=best.x;actor.z=best.z;
  }
}
export function pushShoveActor(attacker,target,force,blocked,interrupt,direction=null){
  interrupt(target);
  let dx=direction?.x??target.x-attacker.x,dz=direction?.z??target.z-attacker.z;
  let d=Math.hypot(dx,dz);
  if(d<.0001){dx=attacker.fx;dz=attacker.fz;d=Math.hypot(dx,dz)||1;}
  dx/=d;dz/=d;
  moveShoveActor(target,attacker,dx,dz,force,blocked);
  const gap=Math.hypot(target.x-attacker.x,target.z-attacker.z);
  if(gap<.8){
    interrupt(attacker);
    const ax=gap>.0001?(attacker.x-target.x)/gap:-dx;
    const az=gap>.0001?(attacker.z-target.z)/gap:-dz;
    moveShoveActor(attacker,target,ax,az,.8-gap,blocked);
  }
}
