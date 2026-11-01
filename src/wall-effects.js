// Rendering only. No collision objects, gameplay RNG, timers or animation callbacks.
export function createWallEffects(THREE,world,{maxParticles=64}={}){
  const root=new THREE.Group();root.name='wall-effects';root.userData.visualOnly=true;world.add(root);
  const box=new THREE.BoxGeometry(1,1,1),dust=new THREE.IcosahedronGeometry(1,0);
  const pool=[],pops=new Map();let disposed=false,serial=0,seed=0x5a17;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  function restore(mesh,pop){mesh.position.copy(pop.position);mesh.scale.copy(pop.scale);}
  function slot(kind,color,position,scale,velocity,spin,life,opacity){
    if(disposed)return;
    let p=pool.find(p=>!p.active);
    if(!p&&pool.length<maxParticles){
      const material=new THREE.MeshBasicMaterial({transparent:true,depthWrite:false});
      const mesh=new THREE.Mesh(box,material);mesh.castShadow=false;mesh.receiveShadow=false;
      mesh.userData.visualOnly=true;mesh.visible=false;root.add(mesh);
      p={mesh,velocity:new THREE.Vector3(),spin:new THREE.Vector3(),scale:new THREE.Vector3()};pool.push(p);
    }
    if(!p)p=pool.reduce((old,p)=>p.serial<old.serial?p:old);
    if(!p)return;
    const m=p.mesh;m.geometry=kind==='dust'?dust:box;m.name='wall-'+kind;
    m.material.color.set(color);m.material.opacity=opacity;m.visible=true;
    m.position.copy(position);m.scale.copy(scale);m.rotation.set(0,0,0);
    p.kind=kind;p.active=true;p.age=0;p.life=life;p.opacity=opacity;p.serial=serial++;
    p.scale.copy(scale);p.velocity.copy(velocity);p.spin.copy(spin);return p;
  }
  function burst(position,rotation,team,breaking){
    const wood=team==='red'?0xc98a61:0x9aafbc;
    for(let i=0;i<(breaking?5:4);i++){
      const angle=i*Math.PI*2/(breaking?5:4)+random()*.25;
      const r=.06+random()*.10,size=.055+random()*.035;
      slot('dust',0xf0d7a5,new THREE.Vector3(position.x+Math.cos(angle)*r,.055,position.z+Math.sin(angle)*r),
        new THREE.Vector3(size,size*.65,size),new THREE.Vector3(Math.cos(angle)*.30,.16+random()*.12,Math.sin(angle)*.30),
        new THREE.Vector3(0,1,0),.30+random()*.12,.33);
    }
    for(let i=0;i<4;i++){
      const angle=random()*Math.PI*2;
      const p=slot('splinter',wood,new THREE.Vector3(position.x,.07,position.z),new THREE.Vector3(.025,.075,.025),
        new THREE.Vector3(Math.cos(angle)*.48,.65+random()*.35,Math.sin(angle)*.48),
        new THREE.Vector3(4+random()*3,random()*4,3),.32+random()*.10,.85);
      if(p)p.mesh.rotation.y=rotation;
    }
  }
  function built(mesh,team){
    if(disposed)return;
    if(pops.has(mesh))restore(mesh,pops.get(mesh));
    const pop={age:0,position:mesh.position.clone(),scale:mesh.scale.clone()};pops.set(mesh,pop);
    mesh.position.y=pop.position.y-.9;mesh.scale.y=pop.scale.y*.75;
    burst(pop.position,mesh.rotation.y,team,false);
  }
  function removed(mesh,team,reason){
    if(disposed)return;
    const pop=pops.get(mesh);if(pop){restore(mesh,pop);pops.delete(mesh);}
    // Expiring the active-wall limit is housekeeping, not a successful smash.
    if(reason!=='dig'&&reason!=='smash')return;
    const position=mesh.position,rotation=mesh.rotation.y;
    burst(position,rotation,team,true);
    for(let i=0;i<3;i++){
      const localX=(i-1)*.32;
      const offset=new THREE.Vector3(localX,0,0).applyAxisAngle(new THREE.Vector3(0,1,0),rotation);
      const velocity=new THREE.Vector3((i-1)*.28,.40+random()*.20,(i%2?1:-1)*.36).applyAxisAngle(new THREE.Vector3(0,1,0),rotation);
      const p=slot('chunk',team==='red'?0xc98a61:0x9aafbc,new THREE.Vector3(position.x+offset.x,.39,position.z+offset.z),
        new THREE.Vector3(.28,.64,.13),velocity,new THREE.Vector3((i%2?1:-1)*3.5,.6,(i-1)*2),.48,.92);
      if(p)p.mesh.rotation.y=rotation;
    }
  }
  function update(dt){
    if(disposed||dt<=0)return;
    for(const [mesh,pop] of pops){
      pop.age+=dt;const t=Math.min(1,pop.age/.24);
      // Fixed keys give a quick rise, small overshoot, settle and exact original transform.
      const keys=[[0,-.9,.75],[.48,.065,1.06],[.73,-.025,.97],[1,0,1]];
      let a=keys[0],b=keys[1];for(let i=1;i<keys.length;i++)if(t<=keys[i][0]){a=keys[i-1];b=keys[i];break;}
      const f=THREE.MathUtils.smoothstep(t,a[0],b[0]);
      mesh.position.y=pop.position.y+THREE.MathUtils.lerp(a[1],b[1],f);
      mesh.scale.y=pop.scale.y*THREE.MathUtils.lerp(a[2],b[2],f);
      if(t>=1){restore(mesh,pop);pops.delete(mesh);}
    }
    for(const p of pool){
      if(!p.active)continue;
      const previous=p.age;p.age=Math.min(p.life,p.age+dt);const step=p.age-previous,t=p.age/p.life,m=p.mesh;
      const gravity=p.kind==='dust'?-.15:-5.0;
      m.position.addScaledVector(p.velocity,step);m.position.y+=.5*gravity*step*step;p.velocity.y+=gravity*step;
      m.position.y=Math.max(.025,m.position.y);
      m.rotation.x+=p.spin.x*step;m.rotation.y+=p.spin.y*step;m.rotation.z+=p.spin.z*step;
      const size=p.kind==='dust'?1+t*.9:1-Math.max(0,(t-.5)/.5)*.25;
      m.scale.copy(p.scale).multiplyScalar(size);
      m.material.opacity=p.opacity*(1-THREE.MathUtils.smoothstep(t,.25,1));
      if(t>=1){p.active=false;m.visible=false;}
    }
  }
  function clear(){for(const [mesh,pop] of pops)restore(mesh,pop);pops.clear();for(const p of pool){p.active=false;p.mesh.visible=false;}}
  function dispose(){if(disposed)return;clear();for(const p of pool)p.mesh.material.dispose();pool.length=0;root.clear();world.remove(root);box.dispose();dust.dispose();disposed=true;}
  return {built,removed,update,clear,dispose,root,get stats(){return {pops:pops.size,active:pool.filter(p=>p.active).length,pooled:pool.length,maxParticles,disposed};}};
}
