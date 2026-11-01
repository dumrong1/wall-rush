import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// Visual-only: no gameplay callbacks, collision changes, or gameplay RNG.
export function createGateSystem(world,onDoorChange=()=>{}) {
  const OPEN_DISTANCE=1.15; // The 0.25s doors finish opening before even a dashing teammate arrives.
  const CLOSE_DISTANCE=1.45;
  const CLEAR_DELAY=.22;
  const HALF_LENGTH=.49;
  const live=new Set();
  const barrierGeometry=new THREE.PlaneGeometry(.78,.68);
  let asset;
  const ready=new GLTFLoader().loadAsync('./assets/gates/WallRush_WoodenGate_Anim_05.glb').then(a=>{
    for(const name of ['Build','Break','FriendlyPass','Open','Close'])
      if(!a.animations.some(c=>c.name===name))throw new Error('Gate missing '+name);
    asset=a;return a;
  });
  function create(team,transform) {
    if(!asset)throw new Error('Gate asset is not ready');
    const root=new THREE.Group();root.name='TeamGate-'+team;
    root.position.copy(transform.pos);root.rotation.y=transform.rot;
    const model=asset.scene.clone(true);root.add(model);world.add(root);
    const materials=new Map(),rest=[],closedDoors=[];
    const colors=team==='red'?{TeamPrimary:'#dd1d35',TeamGrain:'#810d1d',TeamRipple:'#ff5167'}:{TeamPrimary:'#245be8',TeamGrain:'#123887',TeamRipple:'#5e9aff'};
    model.traverse(o=>{
      rest.push({o,p:o.position.clone(),q:o.quaternion.clone(),s:o.scale.clone()});
      if(/^Door_[LR]_Plank_/.test(o.name))closedDoors.push({o,p:o.position.clone(),q:o.quaternion.clone(),s:o.scale.clone()});
      if(!o.isMesh)return;
      const clone=m=>{if(!materials.has(m)){const n=m.clone();if(new URLSearchParams(location.search).get('arena')==='wetlands-v3'&&/^Wood(Frame|Planks)/.test(n.name))n.color.setHex(n.name.startsWith('WoodFrame')?0x94643f:0xad784f);if(colors[n.name]){n.color.set(colors[n.name]);if(n.name==='TeamRipple')n.emissive.set(colors[n.name]);}materials.set(m,n);}return materials.get(m);};
      o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material);
      o.castShadow=true;o.receiveShadow=true;
    });
    const barrier=new THREE.Mesh(barrierGeometry,new THREE.MeshBasicMaterial({color:colors.TeamRipple,transparent:true,opacity:.40,side:THREE.DoubleSide,depthWrite:false}));
    barrier.name='FriendlyGateEnemyBarrier';barrier.visible=false;root.add(barrier);
    const mixer=new THREE.AnimationMixer(model),actions={};
    for(const clip of asset.animations){const a=mixer.clipAction(clip);a.setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;actions[clip.name]=a;}
    let dead=false,disposed=false,door='closed',clearTime=0,deathTime=0;
    const play=name=>{const a=actions[name];a.reset().play();return a;};
    const restoreClosed=()=>{for(const r of closedDoors){r.o.position.copy(r.p);r.o.quaternion.copy(r.q);r.o.scale.copy(r.s);}};
    const finished=({action})=>{
      if(action===actions.Open)door='open';
      if(action===actions.Close){action.stop();door='closed';restoreClosed();}
      if(action===actions.FriendlyPass)action.stop();
    };
    mixer.addEventListener('finished',finished);
    function setOpen(open){
      if(dead)return;
      if(open&&(door==='closed'||door==='closing')){
        const t=door==='closing'?actions.Open.getClip().duration-actions.Close.time:0;
        actions.Close.stop();play('Open').time=Math.max(0,t);door='opening';mixer.update(0);
        onDoorChange('gateOpen',team);
      }else if(!open&&(door==='open'||door==='opening')){
        const t=door==='opening'?actions.Close.getClip().duration-actions.Open.time:0;
        actions.Open.stop();play('Close').time=Math.max(0,t);door='closing';mixer.update(0);
        onDoorChange('gateClose',team);
      }
    }
    function dispose(){if(disposed)return;disposed=true;mixer.removeEventListener('finished',finished);mixer.stopAllAction();mixer.uncacheRoot(model);world.remove(root);for(const m of materials.values())m.dispose();barrier.material.dispose();live.delete(api);}
    const api={root,model,actions,barrier,team,
      get door(){return door;},get dead(){return dead;},get disposed(){return disposed;},
      built(){door='closed';clearTime=0;restoreClosed();play('Build');},
      crossed(){if(!dead){clearTime=0;setOpen(true);play('FriendlyPass');}},
      destroy(reason){if(dead||disposed)return;if(reason==='wall-limit'){dispose();return;}dead=true;barrier.visible=false;mixer.stopAllAction();for(const r of rest){r.o.position.copy(r.p);r.o.quaternion.copy(r.q);r.o.scale.copy(r.s);}play('Break');deathTime=0;},
      update(dt,actors,desiredOpen=null){
        if(disposed||dt<=0)return;
        if(!dead){
          if(typeof desiredOpen==='boolean')setOpen(desiredOpen);
          else {
            root.updateMatrixWorld(true);
            let approaching=false,cleared=true;
            for(const a of actors){
              if(a.team!==team)continue;
              const p=root.worldToLocal(new THREE.Vector3(a.x,0,a.z));
              const distance=Math.hypot(Math.max(0,Math.abs(p.x)-HALF_LENGTH),p.z);
              if(distance<=OPEN_DISTANCE)approaching=true;
              if(distance<=CLOSE_DISTANCE)cleared=false;
            }
            clearTime=cleared?clearTime+dt:0;
            setOpen(approaching||(!cleared||clearTime<CLEAR_DELAY)&&door!=='closed');
          }
          barrier.visible=door!=='closed';
        }
        mixer.update(dt);
        if(!dead){if(door==='closed')restoreClosed();barrier.visible=door!=='closed';return;}
        deathTime+=dt;const fadeStart=actions.Break.getClip().duration+.15;
        if(deathTime>=fadeStart){
          const alpha=Math.max(0,1-(deathTime-fadeStart)/.6);
          for(const m of materials.values()){if(!m.transparent){m.transparent=true;m.needsUpdate=true;}m.depthWrite=false;m.opacity=alpha;}
          model.traverse(o=>{if(o.isMesh)o.castShadow=false;});
          if(alpha===0)dispose();
        }
      },dispose};
    root.userData.gateVisual=api;live.add(api);return root;
  }
  return {ready,create,update(dt,actors,openById=null){for(const g of live)g.update(dt,actors,openById?.get(g.root.userData.wallId)??null);},clear(){for(const g of [...live])g.dispose();},get instances(){return [...live];}};
}
