// Logical coordinates remain in unit cells. All rendering crosses this mapping.
export function createGridMapping(width,length) {
  const cellSize=1;
  const toWorldX=x=>(x-width/2)*cellSize,toWorldZ=z=>(z-length/2)*cellSize;
  function edge(t){
    const horizontal=t.o==='h';
    const a={x:t.x,z:t.z},b={x:t.x+(horizontal?1:0),z:t.z+(horizontal?0:1)};
    return {a,b,center:{x:toWorldX((a.x+b.x)/2),z:toWorldZ((a.z+b.z)/2)},rotation:horizontal?0:Math.PI/2};
  }
  function isInteriorEdge(t){
    if(!t||!Number.isInteger(t.x)||!Number.isInteger(t.z))return false;
    return t.o==='h'?t.x>=0&&t.x<width&&t.z>0&&t.z<length:
      t.o==='v'&&t.x>0&&t.x<width&&t.z>=0&&t.z<length;
  }
  function isGridEdge(t){
    if(!t||!Number.isInteger(t.x)||!Number.isInteger(t.z))return false;
    return t.o==='h'?t.x>=0&&t.x<width&&t.z>=0&&t.z<=length:
      t.o==='v'&&t.x>=0&&t.x<=width&&t.z>=0&&t.z<length;
  }
  function lines(){
    const result=[];
    for(let x=0;x<=width;x++)for(let z=0;z<length;z++)result.push({x,z,o:'v'});
    for(let z=0;z<=length;z++)for(let x=0;x<width;x++)result.push({x,z,o:'h'});
    return result;
  }
  return Object.freeze({width,length,cellSize,toWorldX,toWorldZ,edge,isInteriorEdge,isGridEdge,lines});
}
