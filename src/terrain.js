// One shared surface map for movement, construction, navigation and rendering.
const requestedArena = typeof location==='undefined' ? 'wetlands-v3' : new URLSearchParams(location.search).get('arena');
export const ARENA_ID = ['baseline','wetlands-v2','wetlands-v3'].includes(requestedArena) ? requestedArena : 'wetlands';
export const WATER_SPEED = ARENA_ID==='wetlands-v3'?0.275:0.55;
// Reflection symmetry in both axes preserves access to the same-side flag poles.
// W: water, B: dry bridge, D: dry ground. Broad pools replace the straight stream.
export const WETLAND_ROWS=[
 'DDDDD','DDDDD','DDDDD','DDWDD','DWWWD','DBBBD','DDWDD',
 'DDWDD','DBBBD','DWWWD','DDWDD','DDDDD','DDDDD','DDDDD'
];
// Two equal north/south dry bridges cross a traversable shallow-water belt.
// Both banks and both team ends are mirror images; outer lanes enter water.
export const WETLAND_V2_ROWS=[
 'DDDDD','DDDDD','DDDDD','DDDDD',
 'WBWBW','WBWBW','WBWBW','WBWBW','WBWBW','WBWBW',
 'DDDDD','DDDDD','DDDDD','DDDDD'
];
// Rotationally balanced branches. R and L are low, impassable rocks and logs.
// D/B are dry grass/wood; W remains traversable at the shared water speed.
export const WETLAND_V3_ROWS=[
 'DDDDDDD','DDDDDDD','DWWDWWD','DWWDWWD',
 'WBWBWBW','WBBDBBW','LBDWWBW','RWWBDWW',
 'WWDWDWW',
 'WWDBWWR','WBWWDBL','WBBDBBW','WBWBWBW',
 'DWWDWWD','DWWDWWD','DDDDDDD','DDDDDDD'
];
export const ARENA_WIDTH=ARENA_ID==='wetlands-v3'?7:5;
export const ARENA_LENGTH=ARENA_ID==='wetlands-v3'?17:14;
export function terrainCell(x,z) {
  if(x<0||z<0||x>=ARENA_WIDTH||z>=ARENA_LENGTH)return null;
  if(ARENA_ID==='baseline')return 'D';
  const rows=ARENA_ID==='wetlands-v3'?WETLAND_V3_ROWS:ARENA_ID==='wetlands-v2'?WETLAND_V2_ROWS:WETLAND_ROWS;
  return rows[z][x];
}
export function terrainAt(x,z) {
  const cx=Math.max(0,Math.min(ARENA_WIDTH-1,Math.floor(x))),cz=Math.max(0,Math.min(ARENA_LENGTH-1,Math.floor(z)));
  const cell=terrainCell(cx,cz);
  const bridge=cell==='B',water=cell==='W';
  const obstacle=cell==='R'||cell==='L';
  return {kind:obstacle?(cell==='R'?'rock':'log'):water?'water':bridge?'bridge':'grass',speed:water?WATER_SPEED:1,buildable:!obstacle,walkable:!obstacle};
}
export function terrainEdgeAllowed(t) {
  return t.o==='h'?Number.isInteger(t.x)&&Number.isInteger(t.z)&&t.x>=0&&t.x<ARENA_WIDTH&&t.z>=0&&t.z<=ARENA_LENGTH:
    t.o==='v'&&Number.isInteger(t.x)&&Number.isInteger(t.z)&&t.x>=0&&t.x<=ARENA_WIDTH&&t.z>=0&&t.z<ARENA_LENGTH;
}
export function terrainEdgeIntersectsObstacle(t) {
  if(ARENA_ID!=='wetlands-v3')return false;
  const adjacent=t.o==='h'?[[t.x,t.z-1],[t.x,t.z]]:[[t.x-1,t.z],[t.x,t.z]];
  return adjacent.some(([x,z])=>{const cell=terrainCell(x,z);return cell==='R'||cell==='L';});
}
export function terrainStepCost(a,b) {
  return Math.hypot(a.x-b.x,a.z-b.z)*(1/terrainAt(a.x+.5,a.z+.5).speed+1/terrainAt(b.x+.5,b.z+.5).speed)/2;
}
