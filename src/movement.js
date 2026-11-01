// Browser and Node use this same terrain movement step. Wall collision is an
// optional caller-supplied obstacle callback because walls belong to a match.
import { ARENA_WIDTH, ARENA_LENGTH, terrainAt } from './terrain.js';

export const WALK_SPEED=1.50;
export const PLAYER_RADIUS=0.18;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export function terrainBodyBlocked(x,z,radius=PLAYER_RADIUS){
  const minX=Math.max(0,Math.floor(x-radius)),maxX=Math.min(ARENA_WIDTH-1,Math.floor(x+radius));
  const minZ=Math.max(0,Math.floor(z-radius)),maxZ=Math.min(ARENA_LENGTH-1,Math.floor(z+radius));
  for(let cz=minZ;cz<=maxZ;cz++)for(let cx=minX;cx<=maxX;cx++){
    if(terrainAt(cx+.5,cz+.5).walkable)continue;
    const nearX=clamp(x,cx,cx+1),nearZ=clamp(z,cz,cz+1);
    if(Math.hypot(x-nearX,z-nearZ)<radius)return true;
  }
  return false;
}

export function moveActorOnTerrain(actor,dx,dz,blocked=terrainBodyBlocked){
  const speed=terrainAt(actor.x,actor.z).speed;
  const nx=clamp(actor.x+dx*speed,PLAYER_RADIUS,ARENA_WIDTH-PLAYER_RADIUS);
  const nz=clamp(actor.z+dz*speed,PLAYER_RADIUS,ARENA_LENGTH-PLAYER_RADIUS);
  const oldX=actor.x,oldZ=actor.z;
  if(!blocked(nx,actor.z))actor.x=nx;
  if(!blocked(actor.x,nz))actor.z=nz;
  return {oldX,oldZ,nx,nz,surfaceSpeed:speed};
}
