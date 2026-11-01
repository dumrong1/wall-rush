// Small pooled, visual-only foot ripples. Terrain and actor movement stay authoritative.
export function createWaterEffects(THREE,world,terrainAt,toWorldX,toWorldZ){
  const root=new THREE.Group();root.name='water-footsteps';root.userData.visualOnly=true;world.add(root);
  const ringGeometry=new THREE.TorusGeometry(.15,.012,4,20);
  const dropGeometry=new THREE.SphereGeometry(.027,5,4);
  const pool=[],previous=new Map(),MAX_EFFECTS=20,LIFE=.55,STEP_DISTANCE=.18;
  let disposed=false;
  function makeSlot(){
    const material=new THREE.MeshBasicMaterial({color:0xd4fff1,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide});
    const group=new THREE.Group();group.visible=false;group.userData.visualOnly=true;root.add(group);
    const ring=new THREE.Mesh(ringGeometry,material);ring.rotation.x=-Math.PI/2;group.add(ring);
    const drops=[];
    for(let i=0;i<6;i++){const drop=new THREE.Mesh(dropGeometry,material);drop.userData.angle=i*Math.PI/3;group.add(drop);drops.push(drop);}
    const item={group,material,drops,age:LIFE,kind:'step'};pool.push(item);return item;
  }
  function spawn(x,z,kind){
    if(disposed)return;
    let item=pool.find(p=>p.age>=LIFE);
    if(!item){if(pool.length>=MAX_EFFECTS)return;item=makeSlot();}
    item.age=0;item.kind=kind;item.group.visible=true;item.group.position.set(toWorldX(x),.065,toWorldZ(z));
    item.group.scale.setScalar(kind==='step'?.78:1);
    item.material.opacity=kind==='step'?.68:.82;
  }
  function update(dt,actors){
    if(disposed||dt<=0)return;
    for(const actor of actors){
      const water=terrainAt(actor.x,actor.z).kind==='water';
      const last=previous.get(actor.team);
      if(!last){previous.set(actor.team,{x:actor.x,z:actor.z,water,distance:0,elapsed:0});continue;}
      const moved=Math.hypot(actor.x-last.x,actor.z-last.z);
      last.elapsed+=dt;
      if(moved>1.5){last.x=actor.x;last.z=actor.z;last.water=water;last.distance=0;last.elapsed=0;continue;}
      if(water!==last.water){
        spawn(water?actor.x:last.x,water?actor.z:last.z,water?'entry':'exit');
        last.distance=0;last.elapsed=0;
      }else if(water&&moved>.002){
        last.distance+=moved;
        if(last.elapsed>=.24&&(last.distance>=STEP_DISTANCE||last.elapsed>=.44)){spawn(actor.x,actor.z,'step');last.distance=0;last.elapsed=0;}
      }
      last.x=actor.x;last.z=actor.z;last.water=water;
    }
    for(const item of pool){
      if(item.age>=LIFE)continue;
      item.age=Math.min(LIFE,item.age+dt);
      const t=item.age/LIFE,scale=(item.kind==='step'?.78:1)*(1+t*.65);
      item.group.scale.setScalar(scale);
      for(const [i,drop] of item.drops.entries()){
        const a=drop.userData.angle,r=.065+t*.17;
        drop.position.set(Math.cos(a)*r,(item.kind==='step'?.11:.19)*Math.sin(Math.PI*t)*(i%2?.8:1),Math.sin(a)*r);
        drop.scale.setScalar(1-t*.6);
      }
      item.material.opacity=(item.kind==='step'?.68:.82)*(1-t);
      if(item.age>=LIFE)item.group.visible=false;
    }
  }
  function reset(){previous.clear();for(const item of pool){item.age=LIFE;item.group.visible=false;}}
  function dispose(){if(disposed)return;reset();for(const item of pool)item.material.dispose();root.clear();world.remove(root);ringGeometry.dispose();dropGeometry.dispose();disposed=true;}
  return {root,update,reset,dispose,get stats(){return {pooled:pool.length,active:pool.filter(p=>p.age<LIFE).length,max:MAX_EFFECTS};}};
}
