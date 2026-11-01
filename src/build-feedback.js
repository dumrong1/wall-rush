import * as THREE from 'three';

// Visual only. The gameplay timer and locked edge are supplied by main.js.
export function createBuildFeedback(world,transform,camera){
  const root=new THREE.Group();root.name='build-feedback';root.userData.visualOnly=true;world.add(root);
  const baseGeometry=new THREE.BoxGeometry(.45,.060,.025);
  const fillGeometry=new THREE.BoxGeometry(1,.065,.03);
  const burstGeometry=new THREE.IcosahedronGeometry(.045,0);
  const baseMaterial=new THREE.MeshBasicMaterial({color:0x49382e,depthTest:false});
  const redMaterial=new THREE.MeshBasicMaterial({color:0xff6676,depthTest:false});
  const blueMaterial=new THREE.MeshBasicMaterial({color:0x63adff,depthTest:false});
  const warnMaterial=new THREE.MeshBasicMaterial({color:0xff805c,depthTest:false});
  const base=new THREE.Mesh(baseGeometry,baseMaterial),fill=new THREE.Mesh(fillGeometry,redMaterial);
  base.renderOrder=5;fill.renderOrder=6;root.add(base,fill);
  const edgeGeometry=new THREE.BoxGeometry(.96,.015,.055);
  const edgeMarker=new THREE.Mesh(edgeGeometry,new THREE.MeshBasicMaterial({color:0xff6676,transparent:true,opacity:.72,depthWrite:false,depthTest:false}));
  edgeMarker.name='locked-build-edge';edgeMarker.userData.visualOnly=true;edgeMarker.renderOrder=4;edgeMarker.visible=false;world.add(edgeMarker);
  const invalid=new THREE.Mesh(new THREE.OctahedronGeometry(.075),warnMaterial);
  invalid.name='invalid-build-edge';invalid.userData.visualOnly=true;invalid.renderOrder=7;invalid.visible=false;world.add(invalid);
  const effects=[];
  function progress(actor){
    const edge=actor.buildTarget;
    if(!edge||actor.build<=0)return hide();
    const pose=transform(edge);root.visible=true;root.position.set(pose.pos.x,1.18,pose.pos.z);
    edgeMarker.position.set(pose.pos.x,.09,pose.pos.z);edgeMarker.rotation.y=pose.rot;edgeMarker.material.color.set(actor.team==='red'?0xff6676:0x63adff);edgeMarker.visible=true;
    const fraction=THREE.MathUtils.clamp(1-actor.build/Math.max(.001,actor.buildDuration),0,1);
    fill.material=actor.team==='red'?redMaterial:blueMaterial;
    fill.scale.x=Math.max(.001,.43*fraction);fill.position.x=-.215+.215*fraction;
    root.userData.logicalEdge={...edge};root.userData.progress=fraction;
  }
  function hide(){root.visible=false;root.userData.logicalEdge=null;edgeMarker.visible=false;}
  function setInvalid(edge){
    invalid.visible=!!edge;
    if(edge){const pose=transform(edge);invalid.position.set(pose.pos.x,.20,pose.pos.z);invalid.rotation.y=pose.rot;invalid.userData.logicalEdge={...edge};}
  }
  function flash(edge,team,kind){
    if(!edge)return;
    const pose=transform(edge),color=kind==='cancel'?0xffd89e:team==='red'?0xff8b76:0x86d7ff;
    for(let i=0;i<(kind==='cancel'?2:4);i++){
      const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity:kind==='cancel'?.48:.72,depthWrite:false});
      const mesh=new THREE.Mesh(burstGeometry,material);mesh.userData.visualOnly=true;
      mesh.position.set(pose.pos.x+(i-1.5)*.12,.13,pose.pos.z+(i%2?.06:-.06));
      world.add(mesh);effects.push({mesh,age:0,life:kind==='cancel'?.18:.24,velocity:new THREE.Vector3((i-1.5)*.35,.35,i%2?.22:-.22)});
    }
  }
  function update(dt){
    if(root.visible)root.quaternion.copy(camera.quaternion);
    for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.age+=dt;e.mesh.position.addScaledVector(e.velocity,dt);e.mesh.material.opacity=Math.max(0,1-e.age/e.life)*.7;if(e.age>=e.life){world.remove(e.mesh);e.mesh.material.dispose();effects.splice(i,1);}}
  }
  function clear(){hide();setInvalid(null);for(const e of effects){world.remove(e.mesh);e.mesh.material.dispose();}effects.length=0;}
  function dispose(){clear();world.remove(root);world.remove(edgeMarker);edgeMarker.geometry.dispose();edgeMarker.material.dispose();world.remove(invalid);invalid.geometry.dispose();baseGeometry.dispose();fillGeometry.dispose();burstGeometry.dispose();baseMaterial.dispose();redMaterial.dispose();blueMaterial.dispose();warnMaterial.dispose();}
  return {progress,hide,setInvalid,flash,update,clear,dispose,root,edgeMarker,invalid,get effectCount(){return effects.length;}};
}
