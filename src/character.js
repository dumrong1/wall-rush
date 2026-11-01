import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export const CHARACTER_HEIGHT = 0.96;
export const BLEND_SECONDS = 0.16;
export const BUILD_IMPACT_FRACTION = 0.8;
// Final downward strike of the approved two-second clip.
export const WALL_SMASH_IMPACT_SECONDS = 1.8;
// Both hands reach their forward plateau at 0.30 s in the approved 0.60 s Shove.
export const SHOVE_IMPACT_SECONDS = 0.30;
const CLIP_NAMES = ['Idle', 'Run', 'WallSlam', 'Shove', 'ShoveHit', 'WallSmash'];

export async function loadChampion() {
  const asset = await new GLTFLoader().loadAsync('./assets/characters/RedChampion_Anim_05.glb');
  for (const name of CLIP_NAMES) {
    if (!asset.animations.some(clip => clip.name === name)) throw new Error(`Character is missing ${name}.`);
  }
  return asset;
}

export function createChampion(asset, team) {
  const root = new THREE.Group();
  root.name = `${team}-character`;
  const model = SkeletonUtils.clone(asset.scene);
  const materials = new Map();
  model.traverse(object => {
    if (!object.isMesh) return;
    // Geometry and vertex colors remain intact. Each team owns its material copies.
    const copyMaterial = original => {
      if (!materials.has(original)) {
        const copy = original.clone();
        if (team === 'blue' && original.name === 'Champion / vermilion cloth') {
          copy.color.setRGB(0.018, 0.16, 0.53); // linear RGB, matching the red cloth's luminance range
        }
        materials.set(original, copy);
      }
      return materials.get(original);
    };
    object.material = Array.isArray(object.material) ? object.material.map(copyMaterial) : copyMaterial(object.material);
    object.castShadow = true;
    object.receiveShadow = false;
    // Animated limbs can extend beyond the exported bind-pose bounds.
    object.frustumCulled = false;
  });

  const mixer = new THREE.AnimationMixer(model);
  // Retain all six source clips. Building uses the authored WallSlam, without editing it.
  const clips = new Map(asset.animations.map(clip => [clip.name, clip]));
  const actions = Object.fromEntries(['Idle', 'Run', 'WallSlam', 'Shove', 'ShoveHit', 'WallSmash'].map(name => [name, mixer.clipAction(clips.get(name))]));
  actions.Idle.play();
  mixer.update(0);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model, true);
  const scale = CHARACTER_HEIGHT / (bounds.max.y - bounds.min.y);
  // Exported front is +Z; the game's existing visual forward is -Z.
  const alignment = new THREE.Group();
  alignment.rotation.y = Math.PI;
  alignment.scale.setScalar(scale);
  alignment.position.y = -bounds.min.y * scale;
  alignment.add(model);
  root.add(alignment);

  let active = 'Idle';
  let lastX = null, lastZ = null;
  let buildAnimation=null;
  let combatAnimation=null;
  let wallSmashAnimation=null;
  const buildImpact=clips.get('WallSlam').duration*BUILD_IMPACT_FRACTION;
  function startBuildAnimation(duration) {
    cancelWallSmashAnimation();
    combatAnimation=null;
    const action=actions.WallSlam;
    for (const other of Object.values(actions)) if (other!==action) other.stopFading().fadeOut(.025);
    action.stopFading().reset().setEffectiveWeight(1).setEffectiveTimeScale(buildImpact/duration)
      .setLoop(THREE.LoopOnce,1).fadeIn(.025).play();
    action.clampWhenFinished=true;
    action.paused=true; // The gameplay countdown samples wind-up at exactly the same time.
    buildAnimation={duration,completed:false,holdImpact:false};
    active='WallSlam';
    mixer.update(0);
  }
  function syncBuildAnimation(remaining) {
    if (!buildAnimation || buildAnimation.completed) return;
    actions.WallSlam.time=THREE.MathUtils.clamp(1-remaining/buildAnimation.duration,0,1)*buildImpact;
    mixer.update(0);
  }
  function finishBuildAnimation(success) {
    if (!buildAnimation) return;
    if (!success) {cancelBuildAnimation();return;}
    syncBuildAnimation(0);
    buildAnimation.completed=true;
    buildAnimation.holdImpact=true;
  }
  function cancelBuildAnimation() {
    buildAnimation=null;
    actions.WallSlam.paused=true;
  }
  function startCombatAnimation(name) {
    if (name!=='Shove' && name!=='ShoveHit') return;
    // Visual priority only: gameplay already decided whether the action/hit is valid.
    cancelBuildAnimation();
    cancelWallSmashAnimation();
    const action=actions[name];
    for(const other of Object.values(actions))if(other!==action)other.stopFading().fadeOut(.025);
    action.stopFading().reset().setEffectiveWeight(1).setEffectiveTimeScale(1)
      .setLoop(THREE.LoopOnce,1).fadeIn(.025).play();
    action.clampWhenFinished=true;
    combatAnimation={name,holdImpact:false};
    active=name;
    mixer.update(0);
  }
  function confirmShoveImpact() {
    if(combatAnimation?.name!=='Shove')return;
    const action=actions.Shove;
    action.time=Math.max(action.time,SHOVE_IMPACT_SECONDS);
    action.paused=true;
    combatAnimation.holdImpact=true;
    mixer.update(0);
  }
  function cancelWallSmashAnimation() {
    wallSmashAnimation=null;
    actions.WallSmash.paused=true;
  }
  function startWallSmashAnimation(key,duration) {
    cancelBuildAnimation();
    combatAnimation=null;
    const action=actions.WallSmash;
    for(const other of Object.values(actions))if(other!==action)other.stopFading().fadeOut(.025);
    action.stopFading().reset().setEffectiveWeight(1).setEffectiveTimeScale(WALL_SMASH_IMPACT_SECONDS/duration)
      .setLoop(THREE.LoopOnce,1).fadeIn(.025).play();
    action.clampWhenFinished=true;
    action.paused=true; // Gameplay progress samples wind-up; only removal authorizes impact.
    wallSmashAnimation={key,duration,completed:false,holdImpact:false};
    active='WallSmash';
    mixer.update(0);
  }
  function syncWallSmashAnimation(key,elapsed,duration) {
    if(!key){
      if(wallSmashAnimation&&!wallSmashAnimation.completed)cancelWallSmashAnimation();
      return;
    }
    if(!wallSmashAnimation||wallSmashAnimation.key!==key||wallSmashAnimation.completed)startWallSmashAnimation(key,duration);
    // A rejected/interrupted completion must never display the finishing impact.
    const progress=THREE.MathUtils.clamp(elapsed/duration,0,1-1e-6);
    actions.WallSmash.time=progress*WALL_SMASH_IMPACT_SECONDS;
    mixer.update(0);
  }
  function finishWallSmashAnimation(key,duration) {
    if(!wallSmashAnimation||wallSmashAnimation.key!==key)startWallSmashAnimation(key,duration);
    actions.WallSmash.time=WALL_SMASH_IMPACT_SECONDS;
    wallSmashAnimation.completed=true;
    wallSmashAnimation.holdImpact=true;
    mixer.update(0);
  }
  function reset(actor) {
    buildAnimation=null;
    combatAnimation=null;
    wallSmashAnimation=null;
    lastX = actor.x; lastZ = actor.z;
    mixer.stopAllAction();
    actions.Idle.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    active = 'Idle';
    mixer.update(0);
  }
  function update(actor, dt, locomotionAllowed) {
    const distance = lastX === null ? 0 : Math.hypot(actor.x-lastX, actor.z-lastZ);
    lastX = actor.x; lastZ = actor.z;
    const speed = dt > 0 ? distance / dt : 0;
    const moving = locomotionAllowed && actor.build <= 0 && actor.dig <= 0 && speed > 0.025;
    let mixerAdvanced=false;
    if(wallSmashAnimation){
      const action=actions.WallSmash;
      if(wallSmashAnimation.completed&&!wallSmashAnimation.holdImpact)action.paused=false;
      mixer.update(dt);
      mixerAdvanced=true;
      wallSmashAnimation.holdImpact=false;
      if(!wallSmashAnimation.completed||action.time<action.getClip().duration-1e-8)return;
      wallSmashAnimation=null;
    }
    if(combatAnimation){
      const action=actions[combatAnimation.name];
      if(!combatAnimation.holdImpact)action.paused=false;
      mixer.update(dt);
      mixerAdvanced=true;
      combatAnimation.holdImpact=false;
      if(action.time<action.getClip().duration-1e-8)return;
      combatAnimation=null;
    }
    if (buildAnimation) {
      const action=actions.WallSlam;
      if (buildAnimation.completed && !buildAnimation.holdImpact) action.paused=false;
      mixer.update(dt);
      mixerAdvanced=true;
      if (buildAnimation.holdImpact) buildAnimation.holdImpact=false;
      if (!buildAnimation.completed || action.time<action.getClip().duration-1e-8) return;
      buildAnimation=null;
    }
    const next = moving ? 'Run' : 'Idle';
    if (next !== active) {
      const previous = actions[active];
      const action = actions[next];
      // Clearing both fades also handles quick start/stop input during a blend.
      previous.stopFading().fadeOut(BLEND_SECONDS);
      action.stopFading().reset().setEffectiveWeight(1).setEffectiveTimeScale(1).fadeIn(BLEND_SECONDS).play();
      active = next;
    }
    actions.Run.setEffectiveTimeScale(THREE.MathUtils.clamp(speed / 1.50, 0.5, 1.72));
    // Completion already advanced the mixer above; never double-step the blend.
    if(!mixerAdvanced)mixer.update(dt);
  }
  return { root, model, alignment, mixer, actions, clips, materials, scale, reset, update,
    startBuildAnimation, syncBuildAnimation, finishBuildAnimation, cancelBuildAnimation,
    startCombatAnimation, confirmShoveImpact,
    syncWallSmashAnimation, finishWallSmashAnimation,
    get active() { return active; } };
}
