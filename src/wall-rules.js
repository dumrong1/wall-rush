// Shared, headless wall rules. Both the solo game and the room server use these
// checks; meshes and animation never decide whether an edge is solid.
import {ARENA_WIDTH,ARENA_LENGTH,terrainEdgeAllowed,terrainEdgeIntersectsObstacle} from './terrain.js';
import {PLAYER_RADIUS} from './movement.js';

export const MAX_WALLS=12;
export const WALL_HALF_THICKNESS=.065;
export const BUILD_TIME=.17;
export const CARRIER_BUILD_TIME=.26;
export const DIG_TIME=2.7;
export const BUILD_MOVE_MULT=.40;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export const wallKey=t=>`${t.o}:${t.x}:${t.z}`;
export function facingEdge(actor,includeBoundary=true){
  const ax=actor.x+actor.fx*.48,az=actor.z+actor.fz*.48;
  if(Math.abs(actor.fx)>Math.abs(actor.fz)){
    const x=Math.round(ax)||0,z=Math.floor(clamp(az,0,ARENA_LENGTH-1e-6));
    return !includeBoundary&&(x<=0||x>=ARENA_WIDTH)?null:{x,z,o:'v'};
  }
  const x=Math.floor(clamp(ax,0,ARENA_WIDTH-1e-6)),z=Math.round(az)||0;
  return !includeBoundary&&(z<=0||z>=ARENA_LENGTH)?null:{x,z,o:'h'};
}
export function pointSegDist(px,pz,x1,z1,x2,z2){
  const vx=x2-x1,vz=z2-z1,c2=vx*vx+vz*vz;
  const t=c2?clamp((vx*(px-x1)+vz*(pz-z1))/c2,0,1):0;
  return Math.hypot(px-(x1+t*vx),pz-(z1+t*vz));
}
export function wallDistanceToActor(edge,actor){
  if(!actor)return Infinity;
  return pointSegDist(actor.x,actor.z,edge.x,edge.z,edge.x+(edge.o==='h'?1:0),edge.z+(edge.o==='v'?1:0));
}
export function wallBlocksTeam(wall,team,gates){return !!wall&&(!gates||!team||wall.team!==team);}
export function collidesWithWall(x,z,team,walls,gates){
  for(const wall of walls.values()){
    if(!wallBlocksTeam(wall,team,gates))continue;
    if(pointSegDist(x,z,wall.x,wall.z,wall.x+(wall.o==='h'?1:0),wall.z+(wall.o==='v'?1:0))<PLAYER_RADIUS+WALL_HALF_THICKNESS)return true;
  }
  return false;
}
export function nearWall(actor,edge,range=.68){return !!edge&&wallDistanceToActor(edge,actor)<=range;}
export function wallPlacementIssue(actor,edge,opponent,walls,{disabled=false}={}){
  if(!edge||!terrainEdgeAllowed(edge))return 'out of bounds';
  if(terrainEdgeIntersectsObstacle(edge))return 'permanent obstacle';
  if(disabled)return 'building disabled';
  if(walls.has(wallKey(edge)))return 'existing wall';
  if(wallDistanceToActor(edge,opponent)<PLAYER_RADIUS+WALL_HALF_THICKNESS)return 'opponent occupies edge';
  return null;
}
