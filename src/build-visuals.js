// Rendering-only helpers, injected with Three.js so tests need no browser/GPU.
export function createGridOverlay(THREE,grid,terrainAt){
  const positions=[];
  for(const t of grid.lines()){
    const {a,b}=grid.edge(t);
    const adjacent=t.o==='h'?[[t.x+.5,t.z-.5],[t.x+.5,t.z+.5]]:[[t.x-.5,t.z+.5],[t.x+.5,t.z+.5]];
    const bridge=adjacent.some(([x,z])=>x>=0&&z>=0&&x<grid.width&&z<grid.length&&terrainAt(x,z).kind==='bridge');
    const y=bridge?.071:.044;
    positions.push(grid.toWorldX(a.x),y,grid.toWorldZ(a.z),grid.toWorldX(b.x),y,grid.toWorldZ(b.z));
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  const material=new THREE.LineBasicMaterial({color:0x355349,transparent:true,opacity:.38,depthWrite:false});
  const mesh=new THREE.LineSegments(geometry,material);mesh.name='logical-ground-grid';mesh.renderOrder=1;
  mesh.userData.visualOnly=true;return mesh;
}

export function createGhostGeometry(THREE){
  const geometry=new THREE.BoxGeometry(.98,.8,.13,6,8,1),p=geometry.getAttribute('position'),colors=[];
  for(let i=0;i<p.count;i++){
    // Subtle wood bands in vertex colors: no texture, extra draw calls or shadows.
    const grain=.82+.12*Math.sin(p.getY(i)*Math.PI*20)+.035*Math.sin(p.getX(i)*37);
    colors.push(grain,grain*.92,grain*.76);
  }
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));return geometry;
}

export function setGhostState(mesh,t,reason){
  mesh.material.color.set(reason?0xda7775:0x7ec991);
  mesh.userData.logicalEdge={x:t.x,z:t.z,o:t.o};
  mesh.userData.valid=!reason;mesh.userData.invalidReason=reason||null;mesh.userData.visualOnly=true;
}

export function createPlacementPreview({state,spectatorMode,targetEdge,validate,createMesh,transform,actor=()=>state.player}){
  let mesh=null,completedKey=null;
  const key=t=>t?`${t.o}:${t.x}:${t.z}`:null;
  function hide(){if(mesh)mesh.visible=false;}
  function reset(){hide();completedKey=null;}
  function built(t){hide();completedKey=key(t);}
  function update(){
    const a=actor();
    if(spectatorMode||!state.running||state.winner||!a||a.isBot){reset();return;}
    if(a.build>0&&a.buildTarget){
      if(a.buildPreview){hide();setGhostState(a.buildPreview,a.buildTarget,validate(a,a.buildTarget));return;}
      if(!mesh){mesh=createMesh(a.buildTarget);mesh.name='human-wall-placement-ghost';}
      const pose=transform(a.buildTarget);mesh.position.copy(pose.pos);mesh.rotation.y=pose.rot;
      setGhostState(mesh,a.buildTarget,validate(a,a.buildTarget));mesh.visible=true;return;
    }
    const t=targetEdge(a,true);
    if(!t){hide();completedKey=null;return;}
    if(key(t)===completedKey){hide();return;}
    completedKey=null;
    if(!mesh){mesh=createMesh(t);mesh.name='human-wall-placement-ghost';}
    const tr=transform(t);mesh.position.copy(tr.pos);mesh.rotation.y=tr.rot;
    setGhostState(mesh,t,a.dig>0?'breaking a wall':validate(a,t));mesh.visible=true;
  }
  return {update,reset,built,get mesh(){return mesh;}};
}
