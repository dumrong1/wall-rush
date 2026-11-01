import * as THREE from 'three';
import { createGridMapping } from './grid.js';
import { createGateSystem } from './gate-visuals.js';
import { createWallEffects } from './wall-effects.js';
import { createWaterEffects } from './water-effects.js';
import { createBuildFeedback } from './build-feedback.js';
import { createGameAudio } from './game-audio.js';
import { createFestivalScenery } from './festival-scenery.js';
import { createGridOverlay, createGhostGeometry, createPlacementPreview } from './build-visuals.js';
import { loadChampion, createChampion } from './character.js';
import { createSpectator } from './spectator.js';
import { ARENA_ID, ARENA_WIDTH, ARENA_LENGTH, WATER_SPEED, terrainAt, terrainCell, terrainEdgeAllowed, terrainEdgeIntersectsObstacle, terrainStepCost } from './terrain.js';
import { WALK_SPEED, PLAYER_RADIUS as SHARED_PLAYER_RADIUS, terrainBodyBlocked, moveActorOnTerrain } from './movement.js';
import { MAX_WALLS, WALL_HALF_THICKNESS, BUILD_TIME, CARRIER_BUILD_TIME, DIG_TIME, BUILD_MOVE_MULT,
  wallKey as sharedWallKey, facingEdge as sharedFacingEdge, pointSegDist as sharedPointSegDist,
  wallDistanceToActor as sharedWallDistance, wallBlocksTeam as sharedWallBlocksTeam,
  collidesWithWall as sharedWallCollision, nearWall as sharedNearWall,
  wallPlacementIssue as sharedPlacementIssue } from './wall-rules.js';
import {SHOVE_COOLDOWN,SHOVE_PROTECTION_TIME,SHOVE_RANGE,SHOVE_ACTIVE_TIME,SHOVE_CLASH_FORCE,SHOVE_FORCE,
  shovePathClear as sharedShovePathClear,shoveCanHit as sharedShoveCanHit,pushShoveActor} from './shove-rules.js';
import {FLAG_POLE_OFFSET,CAPTURE_RADIUS,FLAG_PICKUP_RADIUS,FLAG_CARRIER_SPEED_MULT,FLAG_DROP_INTERACT_DELAY,
  FLAG_TOSS_TIME,FLAG_TOSS_MIN_RADIUS,FLAG_TOSS_MAX_RADIUS,FLAG_REPICK_LOCK,CAPTURE_CHANNEL_TIME,
  flagHomePosition as sharedFlagHomePosition,capturePolePosition as sharedCapturePolePosition,
  flagTossLanding as sharedFlagTossLanding,canTouchFlag as sharedCanTouchFlag,
  returnFlagHome as sharedReturnFlagHome,pickUpFlag as sharedPickUpFlag,
  dropCarriedFlag as sharedDropCarriedFlag,bankCarriedFlag as sharedBankCarriedFlag,
  advanceFlagTimers,flagWinner} from './flag-rules.js';
import {DASH_TIME,POWER_RESPAWN_MIN,POWER_RESPAWN_MAX,MAX_POWERUPS,powerSpots,
  spawnPowerRecord,collectPower,activatePower,safeJumpLanding as sharedSafeJumpLanding} from './power-rules.js';

const onlineParams=new URLSearchParams(location.search);
const onlineMode=onlineParams.get('online')==='1';
const onlineRoom=onlineParams.get('room')?.toUpperCase()||'';
const online={team:null,socket:null,seq:0,samples:{red:[],blue:[]},latestTick:0,leaving:false,
  walls:[],powerups:[],lastEventId:0,players:null,flags:null,finished:false,noticeUntil:0,effects:[],jumpAge:{red:1,blue:1},
  reconnectStarted:0,reconnectTimer:null,inputTimer:null,reconnecting:false};
if(onlineMode)document.body.classList.add('online-mode');
const spectatorMode=new URLSearchParams(location.search).get('spectator')==='1';
let spectator=null;
function gameRandom(){return spectator?spectator.random():Math.random();}

const GRID_W = ARENA_WIDTH;
const TEAM_GATES = new URLSearchParams(location.search).get('rules')==='gates';
const CONTESTED_POWERS = ARENA_ID==='wetlands-v3' && TEAM_GATES && new URLSearchParams(location.search).get('pickups')==='contested';
const MOVE_BUILD = TEAM_GATES && new URLSearchParams(location.search).get('buildmove')==='1';
const GRID_L = ARENA_LENGTH;
const PLAYER_RADIUS = SHARED_PLAYER_RADIUS;
const HUMAN_SPEED = WALK_SPEED;
const BOT_SPEED = HUMAN_SPEED;
const CAMERA_TURN_TIME = 0.4;
const GOAL_WIDTH = 2.0;
const GOAL_DEPTH = 0.85;
const POWER_SPOTS=powerSpots(CONTESTED_POWERS);

const arenaGrid=createGridMapping(GRID_W,GRID_L);

const $ = (s) => document.querySelector(s);
if($('#water-speed-label'))$('#water-speed-label').textContent=`${Math.round(WATER_SPEED*1000)/10}%`;
const mount = $('#game');
const playerHud = $('#playerHud');
const botHud = $('#botHud');
const timeHud = $('#timeHud');
const actionLabel = $('#actionLabel');
const actionMeter = $('#actionMeter');
const captureMeter = $('#captureMeter');
const captureText = $('#captureText');
const centerCard = $('#centerCard');
const centerBig = $('#centerBig');
const centerSmall = $('#centerSmall');
const restart = $('#restart');
const muteButton = $('#mute-button');
const volumeSlider = $('#volume-slider');
const volumeValue = $('#volume-value');
const audio=createGameAudio();
function updateMuteButton(){if(!muteButton)return;muteButton.textContent=audio.muted?'Sound: Off':'Sound: On';muteButton.setAttribute('aria-pressed',String(audio.muted));}
function updateVolumeControl(){if(volumeSlider)volumeSlider.value=String(Math.round(audio.volume*100));if(volumeValue)volumeValue.textContent=Math.round(audio.volume*100)+'%';}
updateMuteButton();
updateVolumeControl();
muteButton?.addEventListener('click',()=>{audio.unlock();audio.setMuted(!audio.muted);updateMuteButton();});
volumeSlider?.addEventListener('input',()=>{audio.unlock();audio.setVolume(Number(volumeSlider.value)/100);updateVolumeControl();});
window.addEventListener('pointerdown',()=>audio.unlock(),{once:true});

const scene = new THREE.Scene();
scene.background = new THREE.Color(ARENA_ID==='wetlands-v3'?0xa4d8f4:0x8fc6ef);
scene.fog = null;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
mount.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(53, 1, 0.08, 70);
const clock = new THREE.Clock();

scene.add(new THREE.HemisphereLight(0xe9f4ff, 0x84936b, ARENA_ID==='wetlands-v3'?1.45:2.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.45);
if(ARENA_ID==='wetlands-v3'){sun.color.setHex(0xfff1d9);sun.intensity=2.6;}
sun.position.set(-6, 11, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
if(ARENA_ID==='wetlands-v3')sun.shadow.radius=2;
sun.shadow.camera.left = -10;
sun.shadow.camera.right = 10;
sun.shadow.camera.top = 12;
sun.shadow.camera.bottom = -8;
scene.add(sun);

const world = new THREE.Group();
const wallEffects=createWallEffects(THREE,world);
const waterEffects=createWaterEffects(THREE,world,terrainAt,wx,wz);
const gateSystem=TEAM_GATES?createGateSystem(world,event=>audio.play(event)):null;
const buildFeedback={red:createBuildFeedback(world,wallTransform,camera),blue:createBuildFeedback(world,wallTransform,camera)};
scene.add(world);

const mats = {
  tileA: new THREE.MeshStandardMaterial({ color: 0xd9c39d, roughness: 0.92 }),
  tileB: new THREE.MeshStandardMaterial({ color: 0xcbb48e, roughness: 0.92 }),
  base: new THREE.MeshStandardMaterial({ color: 0x8cae78, roughness: 1 }),
  red: new THREE.MeshStandardMaterial({ color: 0xff5864, roughness: 0.62 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x419dff, roughness: 0.62 }),
  redWall: new THREE.MeshStandardMaterial({ color: 0xff6e78, roughness: 0.58 }),
  blueWall: new THREE.MeshStandardMaterial({ color: 0x61acff, roughness: 0.58 }),
  border: new THREE.MeshStandardMaterial({ color: 0x6d765f, roughness: 0.86 }),
  white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 }),
  eye: new THREE.MeshStandardMaterial({ color: 0x172033, roughness: 0.7 }),
};

function wx(x) { return arenaGrid.toWorldX(x); }
function wz(z) { return arenaGrid.toWorldZ(z); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function wallKey(x, z, o) { return sharedWallKey({x,z,o}); }

const festivalMaterials={
  grass:new THREE.MeshStandardMaterial({color:0x8cc75b,roughness:.95}),
  water:new THREE.MeshStandardMaterial({color:0x20c9ce,roughness:.3,metalness:.08}),
  bridge:new THREE.MeshStandardMaterial({color:0xc58a4c,roughness:.85})
};
if(ARENA_ID==='wetlands-v3'){
  festivalMaterials.grass.color.setHex(0x91c957);
  festivalMaterials.water.color.setHex(0x32bccd);festivalMaterials.water.roughness=.58;festivalMaterials.water.metalness=0;
  festivalMaterials.bridge.color.setHex(0xc08b4f);
  mats.base.color.setHex(0x91af78);mats.border.color.setHex(0x9c9b88);
}
const softGrass=festivalMaterials.grass.clone();softGrass.color.setHex(0x9ace64);
function makeFestival(){
  const wood=festivalMaterials.bridge,cream=new THREE.MeshStandardMaterial({color:0xffe9ab,roughness:.9});
  const colors=[0xff5b7f,0xffd15a,0x7a61dc,0x24d3c0].map(color=>new THREE.MeshStandardMaterial({color,side:THREE.DoubleSide}));
  // Walkways are level with turf: cosmetic planks do not change feet/collision height.
  if(ARENA_ID==='wetlands-v3'){
    const plankGeo=new THREE.BoxGeometry(.78,.025,.115);
    const dryEdge=new THREE.MeshStandardMaterial({color:0xf5d978,roughness:.85});
    for(let z=0;z<GRID_L;z++)for(let x=0;x<GRID_W;x++){
      const kind=terrainAt(x+.5,z+.5).kind;
      if(kind==='bridge')for(const offset of [.16,.42,.68,.91]){
        const plank=new THREE.Mesh(plankGeo,wood);
        plank.position.set(wx(x+.5),.055,wz(z+offset));world.add(plank);
      }
      if(kind==='grass'&&z>=3&&z<=13&&(x===1||x===2||x===4||x===5)){
        const dash=new THREE.Mesh(new THREE.BoxGeometry(.18,.009,.08),dryEdge);
        dash.position.set(wx(x+.5),.049,wz(z+.5));world.add(dash);
      }
    }
  }else if(ARENA_ID==='wetlands-v2'){
    const plankGeo=new THREE.BoxGeometry(.82,.025,.11);
    const bridgeEdge=new THREE.MeshStandardMaterial({color:0xffd474,roughness:.85});
    const bridgeEnd=new THREE.BoxGeometry(.72,.012,.065);
    for(let z=0;z<GRID_L;z++)for(let x=0;x<GRID_W;x++)if(terrainAt(x+.5,z+.5).kind==='bridge')
      for(const offset of [.13,.37,.61,.85]){
        const plank=new THREE.Mesh(plankGeo,wood);
        plank.position.set(wx(x+.5),.055,wz(z+offset));world.add(plank);
      }
    // Low painted edges outline only the two genuinely dry crossings.
    for(const x of [1,2,3,4]){
      const stripe=new THREE.Mesh(new THREE.BoxGeometry(.035,.012,5.94),bridgeEdge);
      stripe.position.set(wx(x),.069,wz(7));world.add(stripe);
    }
    for(const x of [1.5,3.5])for(const z of [4.16,9.84]){
      const threshold=new THREE.Mesh(bridgeEnd,bridgeEdge);
      threshold.position.set(wx(x),.071,wz(z));world.add(threshold);
    }
  }else for(const z of [5.5,8.5])for(let x=1.1;x<4;x+=.18){
    const plank=new THREE.Mesh(new THREE.BoxGeometry(.15,.025,.88),wood);
    plank.position.set(wx(x),.055,wz(z));world.add(plank);
  }
  for(const side of [-1,1]){
    for(let i=0;i<(ARENA_ID==='wetlands-v3'?8:7);i++){
      const z=1+i*2,x=side*(GRID_W/2+.65);
      const bank=new THREE.Mesh(new THREE.BoxGeometry(.55,.12+(i%2)*.08,1.5),festivalMaterials.grass);
      bank.position.set(x,-.015,wz(z));world.add(bank);
      if(ARENA_ID!=='wetlands-v3'){
      const post=new THREE.Mesh(new THREE.CylinderGeometry(.025,.035,1.2,6),wood);
      post.position.set(x,.55,wz(z));world.add(post);
      const banner=new THREE.Mesh(new THREE.PlaneGeometry(.45,.36),colors[(i+(side>0?1:0))%4]);
      banner.position.set(x,.96,wz(z));banner.rotation.y=side*Math.PI/2;world.add(banner);
      }
    }
    if(ARENA_ID!=='wetlands-v3')for(const z of [.6,GRID_L-.6]){
      const block=new THREE.Mesh(new THREE.BoxGeometry(.65,.7,.65),cream);
      block.position.set(side*(GRID_W/2+.8),.25,wz(z));world.add(block);
    }
    if(CONTESTED_POWERS){
      const padGeo=new THREE.TorusGeometry(.33,.035,6,16);
      const padMat=new THREE.MeshBasicMaterial({color:0xffe27e,depthWrite:false});
      for(const spot of POWER_SPOTS){
        const pad=new THREE.Mesh(padGeo,padMat);
        pad.rotation.x=Math.PI/2;
        pad.position.set(wx(spot.x),.09,wz(spot.z));
        world.add(pad);
      }
    }
  }
  // Sparse light stripes make shallow water readable without transparency or shaders.
  const rippleMat=new THREE.MeshBasicMaterial({color:0x9ff1e7});
  for(let z=0;z<GRID_L;z++)for(let x=0;x<GRID_W;x++)if(terrainAt(x+.5,z+.5).kind==='water'){
    const ripple=new THREE.Mesh(new THREE.BoxGeometry(.48,.006,.018),rippleMat);
    ripple.position.set(wx(x+.5),.044,wz(z+.45));world.add(ripple);
    if(ARENA_ID==='wetlands-v2')for(const [dx,dz] of [[-.16,.20],[.15,.73]]){
      const glint=new THREE.Mesh(new THREE.BoxGeometry(.20,.006,.012),rippleMat);
      glint.position.set(wx(x+.5+dx),.046,wz(z+dz));world.add(glint);
    }
  }
}

let humanPlacementPreview=null;
const flagMeshes = { red: null, blue: null };
const bankedFlagMarkers = { red: null, blue: null };
function newWallStats() {
  const team = () => ({ normalWallsBuilt: 0, teamGatesBuilt: 0, friendlyGateCrossings: 0,
    carrierGateCrossings: 0, carrierBanksAfterGateCrossing: 0, enemyWallsDestroyed: 0 });
  return { red: team(), blue: team() };
}
const objectiveOccluders = [];
const objectiveRaycaster = new THREE.Raycaster();
const objectiveRayDirection = new THREE.Vector3();
const objectiveTarget = new THREE.Vector3();

function registerObjectiveOccluder(root, meshes) {
  // Only the raised pieces fade. Each mesh owns its material, so the other
  // objective and the permanent ground marker retain their own opacity.
  for (const mesh of meshes) {
    mesh.material = mesh.material.clone();
    mesh.material.transparent = true;
    mesh.material.opacity = 1;
  }
  objectiveOccluders.push({ root, meshes, opacity: 1, hold: 0 });
}

function localActor(){return onlineMode&&online.team==='blue'?state.bot:state.player;}
function updateObjectiveOcclusion(dt) {
  const p = localActor();
  if (!p) return;
  const px = wx(p.x), pz = wz(p.z);
  const samples = [
    [-0.14, 0.28], [0, 0.28], [0.14, 0.28],
    [-0.14, 0.67], [0, 0.67], [0.14, 0.67], [0, 1.02]
  ];
  for (const entry of objectiveOccluders) {
    let obstructing = false;
    if (entry.root.visible) {
      for (const [dx, y] of samples) {
        objectiveTarget.set(px + dx, y, pz);
        objectiveRayDirection.subVectors(objectiveTarget, camera.position);
        const distance = objectiveRayDirection.length();
        objectiveRaycaster.set(camera.position, objectiveRayDirection.multiplyScalar(1 / distance));
        objectiveRaycaster.far = Math.max(0, distance - 0.12);
        if (objectiveRaycaster.intersectObjects(entry.meshes, false).length) {
          obstructing = true;
          break;
        }
      }
    }
    if (obstructing) entry.hold = 0.13;
    else entry.hold = Math.max(0, entry.hold - dt);
    const target = entry.hold > 0 ? 0.18 : 1;
    entry.opacity += (target - entry.opacity) * (1 - Math.exp(-dt * 11));
    if (Math.abs(entry.opacity - target) < 0.002) entry.opacity = target;
    for (const mesh of entry.meshes) {
      mesh.material.opacity = entry.opacity;
      mesh.material.depthWrite = entry.opacity > 0.98;
    }
  }
}

function makeArena() {
  const base = new THREE.Mesh(new THREE.BoxGeometry(GRID_W + 2.4, 0.5, GRID_L + 2.4), mats.base);
  base.position.y = -0.31;
  base.receiveShadow = true;
  world.add(base);

  if (ARENA_ID!=='baseline') makeFestival();
  const tileGeo = new THREE.BoxGeometry(arenaGrid.cellSize, 0.08, arenaGrid.cellSize);
  for (let z = 0; z < GRID_L; z++) {
    for (let x = 0; x < GRID_W; x++) {
      const surface=terrainAt(x+.5,z+.5);
      const tile = new THREE.Mesh(tileGeo, ARENA_ID!=='baseline'?(festivalMaterials[surface.kind]||festivalMaterials.grass):(x + z) % 2 ? mats.tileA : mats.tileB);
      if(ARENA_ID==='wetlands-v3'&&surface.kind==='grass'&&(x*7+z*3)%5===0)tile.material=softGrass;
      tile.position.set(wx(x + 0.5), 0, wz(z + 0.5));
      tile.receiveShadow = true;
      world.add(tile);
    }
  }

  if(ARENA_ID==='wetlands-v3'){
    const rockMat=new THREE.MeshStandardMaterial({color:0x9a91a0,roughness:1,flatShading:true});
    const logMat=new THREE.MeshStandardMaterial({color:0x865639,roughness:.92});
    const ringMat=new THREE.MeshStandardMaterial({color:0xd7aa68,roughness:.9});
    for(let z=0;z<GRID_L;z++)for(let x=0;x<GRID_W;x++){
      const cell=terrainCell(x,z);
      if(cell==='R'){
        const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(.42,0),rockMat);
        rock.position.set(wx(x+.5),.19,wz(z+.5));rock.scale.set(1.08,.48,1.08);
        rock.castShadow=rock.receiveShadow=true;world.add(rock);
      }else if(cell==='L'){
        const log=new THREE.Mesh(new THREE.CylinderGeometry(.22,.24,.78,7),logMat);
        log.rotation.z=Math.PI/2;log.position.set(wx(x+.5),.20,wz(z+.5));
        log.castShadow=log.receiveShadow=true;world.add(log);
        for(const side of [-.38,.38]){
          const end=new THREE.Mesh(new THREE.CylinderGeometry(.223,.223,.012,7),ringMat);
          end.rotation.z=Math.PI/2;end.position.set(wx(x+.5)+side,.20,wz(z+.5));world.add(end);
        }
      }
    }
  }

  world.add(createGridOverlay(THREE,arenaGrid,terrainAt));

  const railGeoH = new THREE.BoxGeometry(GRID_W + 0.35, 0.32, 0.18);
  const railGeoV = new THREE.BoxGeometry(0.18, 0.32, GRID_L + 0.35);
  for (const z of [-0.16, GRID_L + 0.16]) {
    const m = new THREE.Mesh(railGeoH, mats.border);
    m.position.set(0, 0.12, wz(z));
    m.castShadow = m.receiveShadow = true;
    world.add(m);
  }
  for (const x of [-0.16, GRID_W + 0.16]) {
    const m = new THREE.Mesh(railGeoV, mats.border);
    m.position.set(wx(x), 0.12, 0);
    m.castShadow = m.receiveShadow = true;
    world.add(m);
  }

  const goalGeo = new THREE.BoxGeometry(GOAL_WIDTH, 0.045, GOAL_DEPTH);
  const blueGoalMat = new THREE.MeshStandardMaterial({ color: 0x7dbfff, transparent: true, opacity: 0.78, emissive: 0x153f77, emissiveIntensity: 0.35 });
  const redGoalMat = new THREE.MeshStandardMaterial({ color: 0xff8d96, transparent: true, opacity: 0.78, emissive: 0x721c28, emissiveIntensity: 0.28 });
  const blueGoal = new THREE.Mesh(goalGeo, blueGoalMat);
  blueGoal.position.set(0, 0.07, wz(GOAL_DEPTH / 2));
  world.add(blueGoal);
  const redGoal = new THREE.Mesh(goalGeo, redGoalMat);
  redGoal.position.set(0, 0.07, wz(GRID_L - GOAL_DEPTH / 2));
  world.add(redGoal);

  makeBasePoles('blue', 0.38, 0x419dff);
  makeBasePoles('red', GRID_L - 0.38, 0xff5864);
  flagMeshes.blue = makeFlag(-FLAG_POLE_OFFSET, 0.38, 0x245be8, 'blue');
  flagMeshes.red = makeFlag(-FLAG_POLE_OFFSET, GRID_L - 0.38, 0xdd1d35, 'red');
  bankedFlagMarkers.blue=makeBankedFlagMarker('blue');
  bankedFlagMarkers.red=makeBankedFlagMarker('red');

  if(ARENA_ID==='wetlands-v3'){
    createFestivalScenery(THREE,scene,world,{width:GRID_W,length:GRID_L,terrainCell,wx,wz,renderer});
  }else{
    // Keep the previous arenas' distant scenery unchanged.
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xb59a72, roughness: 1 });
    for (let i = 0; i < 18; i++) {
      const r = 0.35 + Math.random() * 0.8;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rockMat);
      const side = i % 2 ? 1 : -1;
      rock.position.set(side * (GRID_W / 2 + 2.2 + Math.random() * 3.5),
        -0.15 + r * 0.45,-(GRID_L + 7) / 2 + Math.random() * (GRID_L + 7));
      rock.scale.y = 0.7 + Math.random() * 0.8;
      rock.castShadow = rock.receiveShadow = true;
      scene.add(rock);
    }
  }
}

function makeBasePoles(team, zCell, color) {
  const g = new THREE.Group();
  const teamMat = new THREE.MeshStandardMaterial({ color, roughness: 0.48 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xffd45d, roughness: 0.42, metalness: 0.08 });
  const creamMat = new THREE.MeshStandardMaterial({ color: 0xfff2cb, roughness: 0.7 });

  const makePole = (x, capture) => {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.10, 12), capture?goldMat:teamMat);
    base.position.set(x, 0.05, 0);
    base.receiveShadow = base.castShadow = true;
    g.add(base);

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.057, 0.98, 10), teamMat);
    pole.position.set(x, 0.54, 0);
    pole.castShadow = true;
    g.add(pole);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(capture?0.14:0.105, 0.035, 8, 20), capture?goldMat:creamMat);
    ring.position.set(x, 0.96, 0);
    ring.rotation.x = Math.PI / 2;
    ring.castShadow = true;
    g.add(ring);
    const topper=new THREE.Mesh(capture?new THREE.OctahedronGeometry(0.13,0):new THREE.SphereGeometry(0.095,10,8),capture?goldMat:teamMat);
    topper.position.set(x,1.09,0);topper.castShadow=true;g.add(topper);
    const raised=[pole,ring,topper];
    if(capture){
      const badge=new THREE.Mesh(new THREE.BoxGeometry(0.31,0.10,0.10),creamMat);
      badge.position.set(x,0.82,0);badge.castShadow=true;g.add(badge);
      raised.push(badge);
    }
    registerObjectiveOccluder(g,raised);
  };

  // Left pole = own flag. Right gold pole = capture pole.
  makePole(-FLAG_POLE_OFFSET, false);
  makePole( FLAG_POLE_OFFSET, true);

  const ownPad = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.035, 20), teamMat);
  ownPad.position.set(-FLAG_POLE_OFFSET, 0.025, 0);
  ownPad.receiveShadow = true;
  g.add(ownPad);

  const scorePad = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.035, 20), goldMat);
  scorePad.position.set(FLAG_POLE_OFFSET, 0.026, 0);
  scorePad.receiveShadow = true;
  g.add(scorePad);
  // The capture point keeps its team identity even when raised pieces fade.
  const captureTeamDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.012, 20), teamMat);
  captureTeamDisc.position.set(FLAG_POLE_OFFSET, 0.052, 0);
  captureTeamDisc.receiveShadow = true;
  g.add(captureTeamDisc);

  g.position.set(0, 0, wz(zCell));
  g.name=`${team}-objective-poles`;
  world.add(g);
  return g;
}

function makeFlag(xWorld, zCell, color, team) {
  const g = new THREE.Group();
  const flagMat = new THREE.MeshStandardMaterial({
    color,
    side: THREE.DoubleSide,
    roughness: 0.62
  });
  // Two distinct, broad silhouettes stay legible from the low camera: red is
  // fork-tailed, blue has a single pointed pennant tip.
  const shape=new THREE.Shape();shape.moveTo(-0.12,-0.18);shape.lineTo(0.40,-0.18);
  if(team==='red'){shape.lineTo(0.29,0);shape.lineTo(0.40,0.18);}
  else shape.lineTo(0.60,0);
  shape.lineTo(-0.12,0.18);shape.closePath();
  const cloth = new THREE.Mesh(new THREE.ShapeGeometry(shape), flagMat);
  cloth.scale.setScalar(0.70);
  cloth.castShadow = true;
  g.add(cloth);
  const stripeMat=new THREE.MeshBasicMaterial({color:0xffefbd,side:THREE.DoubleSide});
  for(const side of [-1,1]){
    const stripe=new THREE.Mesh(new THREE.PlaneGeometry(0.055,0.31),stripeMat);
    stripe.scale.setScalar(0.70);
    stripe.position.set(-0.025,0,side*0.006);g.add(stripe);
  }
  g.name=`${team}-flag-visual`;
  g.position.set(xWorld, 0.86, wz(zCell));
  world.add(g);
  registerObjectiveOccluder(g,g.children);
  return g;
}

function makeBankedFlagMarker(team){
  const g=new THREE.Group(),gold=new THREE.MeshBasicMaterial({color:0xffdf66,side:THREE.DoubleSide});
  const hoop=new THREE.Mesh(new THREE.TorusGeometry(0.18,0.018,6,24),gold);
  g.add(hoop);
  const crest=new THREE.Mesh(new THREE.OctahedronGeometry(0.055,0),gold);
  crest.position.y=0.17;g.add(crest);
  const cap=capturePolePosition(team);
  g.position.set(wx(cap.x)+0.29,1.06,wz(cap.z));
  g.name=`${team}-banked-flag-marker`;g.visible=false;
  world.add(g);
  registerObjectiveOccluder(g,g.children);
  return g;
}


makeArena();


function makeCarrierMarker(color) {
  const g=new THREE.Group();
  const mat=new THREE.MeshBasicMaterial({
    color,
    transparent:true,
    opacity:0.95,
    depthTest:false,
    depthWrite:false
  });
  const diamond=new THREE.Mesh(new THREE.OctahedronGeometry(0.13,0),mat);
  diamond.position.y=1.37;
  diamond.renderOrder=50;
  g.add(diamond);
  const pennantMat=new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,depthTest:false,depthWrite:false});
  const pennantShape=new THREE.Shape();pennantShape.moveTo(0,0);pennantShape.lineTo(.25,0);pennantShape.lineTo(.20,.12);pennantShape.lineTo(0,.12);pennantShape.closePath();
  const pennant=new THREE.Mesh(new THREE.ShapeGeometry(pennantShape),pennantMat);
  pennant.scale.setScalar(0.78);
  pennant.position.set(.08,1.20,0);pennant.renderOrder=50;g.add(pennant);
  g.visible=false;
  world.add(g);
  return g;
}

function makeDroppedFlagMarker(color) {
  const mat=new THREE.MeshBasicMaterial({
    color,
    transparent:true,
    opacity:0.78,
    depthTest:true,
    depthWrite:false
  });
  const ring=new THREE.Mesh(new THREE.TorusGeometry(0.30,0.035,8,28),mat);
  ring.rotation.x=Math.PI/2;
  ring.position.y=0.045;
  ring.visible=false;
  world.add(ring);
  return ring;
}

// Stable visual anchors; movement, collision and camera continue to use actor state.
const playerMesh = new THREE.Group();
const botMesh = new THREE.Group();
let playerCharacter, botCharacter;
let charactersReady = false;
world.add(playerMesh, botMesh);

const playerCarrierMarker=makeCarrierMarker(0x419dff);
const botCarrierMarker=makeCarrierMarker(0xff5864);
playerCarrierMarker.name='blue-carried-flag-marker';
botCarrierMarker.name='red-carried-flag-marker';
const redDroppedMarker=makeDroppedFlagMarker(0xff5864);
const blueDroppedMarker=makeDroppedFlagMarker(0x419dff);

const state = {
  running: false,
  winner: null,
  countdown: 3.0,
  elapsed: 0,
  walls: new Map(),
  wallOrder: { red: [], blue: [] },
  powerups: [],
  nextPower: 1.1,
  particles: [],
  gateMetrics: null,
  wallStats: newWallStats(),
  tacticalGateMetrics: null,
  player: null,
  bot: null,
  flags: {
    red: { team:'red', status:'home', x:GRID_W/2-FLAG_POLE_OFFSET, z:GRID_L-0.38, carrier:null, dropInteractDelay:0, dropLockTimer:0, dropLockActor:null, bankedAt:null },
    blue:{ team:'blue',status:'home', x:GRID_W/2-FLAG_POLE_OFFSET, z:0.38, carrier:null, dropInteractDelay:0, dropLockTimer:0, dropLockActor:null, bankedAt:null }
  },
  combatMessage: '',
  combatMessageTimer: 0,
};

function newActor(team, x, z, fx, fz, isBot = false) {
  return {
    team, x, z, fx, fz, isBot,
    power: null,
    dash: 0,
    build: 0,
    buildDuration: BUILD_TIME,
    buildTarget: null,
    buildPreview: null,
    buildLatch: false,
    dig: 0,
    digTarget: null,
    shoveCooldown: 0,
    shoveProtection: 0,
    shoveActive: 0,
    carryingFlag: null,
    crossedGateThisCarry: false,
    captureProgress: 0,
    aiPath: [],
    aiPathTimer: 0,
    aiBuildCooldown: 0.55,
    aiDecisionCooldown: 0,
    aiLastX: x,
    aiLastZ: z,
    aiStuckTimer: 0,
    aiPostActionTimer: 0,
    aiMode: 'STEALING FLAG',
  };
}

function resetGame() {
  audio.resetSteps?.();
  buildFeedback.red.clear();buildFeedback.blue.clear();
  humanPlacementPreview?.reset();
  wallEffects?.clear();
  waterEffects?.reset();
  if(typeof gateSystem!=='undefined')gateSystem?.clear();
  cleanupBuildPreview(state.player);
  cleanupBuildPreview(state.bot);
  for (const w of state.walls.values()) {if(w.mesh.userData?.gateVisual){w.mesh.userData.gateVisual.dispose();continue;}world.remove(w.mesh);w.mesh.geometry.dispose();if(TEAM_GATES&&w.mesh.material!==mats.redWall&&w.mesh.material!==mats.blueWall)w.mesh.material.dispose();}
  state.walls.clear();
  state.wallOrder.red.length = 0;
  state.wallOrder.blue.length = 0;
  for (const p of state.powerups) disposePowerMesh(p.mesh);
  state.powerups.length = 0;

  state.player = newActor('red', GRID_W / 2, GRID_L - 0.58, 0, -1, spectatorMode);
  state.bot = newActor('blue', GRID_W / 2, 0.58, 0, 1, true);
  state.flags.red = { team:'red', status:'home', x:GRID_W/2-FLAG_POLE_OFFSET, z:GRID_L-0.38, carrier:null, dropInteractDelay:0, dropLockTimer:0, dropLockActor:null, bankedAt:null };
  state.flags.blue = { team:'blue', status:'home', x:GRID_W/2-FLAG_POLE_OFFSET, z:0.38, carrier:null, dropInteractDelay:0, dropLockTimer:0, dropLockActor:null, bankedAt:null };
  state.combatMessage = '';
  state.combatMessageTimer = 0;
  state.running = false;
  state.winner = null;
  state.countdown = 3.0;
  state.elapsed = 0;
  state.nextPower = 1.15;
  state.particles.length = 0;
  state.tacticalGateMetrics=TEAM_GATES?{considered:{red:0,blue:0},chosen:{red:0,blue:0},rejected:{},decisions:[]}:null;
  state.gateMetrics={crossings:{red:0,blue:0},carrierCrossings:{red:0,blue:0},blockedMoves:{red:0,blue:0},blockedMotionSeconds:{red:0,blue:0},crossingEvents:[]};
  state.wallStats=newWallStats();
  playerCharacter?.reset(state.player);
  botCharacter?.reset(state.bot);
  camera.userData.yaw = 0;
  camera.userData.inputYaw = null;
  camera.userData.heading = 0; // 0: enemy base; 1: home while carrying an enemy flag.
  camera.userData.turnFrom = 0;
  camera.userData.turnElapsed = CAMERA_TURN_TIME;
  camera.userData.follow = null;
  camera.userData.look = null;
  centerCard.classList.add('show');
  centerBig.textContent = '3';
  centerSmall.textContent = 'No auto-return timer. Shove a carrier → the flag stays on the ground. Touch your own dropped flag to return it; touch the enemy flag to steal it.';
  updateMeshes();
}
restart.addEventListener('click', () => spectator?spectator.restart():resetGame());

function updateMeshes() {
  const pLunge=state.player.shoveActive>0?0.10:0;
  const bLunge=state.bot.shoveActive>0?0.10:0;

  playerMesh.position.set(
    wx(state.player.x+state.player.fx*pLunge),
    0.04,
    wz(state.player.z+state.player.fz*pLunge)
  );
  botMesh.position.set(
    wx(state.bot.x+state.bot.fx*bLunge),
    0.04,
    wz(state.bot.z+state.bot.fz*bLunge)
  );

  playerMesh.rotation.y = facingRotation(state.player.fx, state.player.fz);
  botMesh.rotation.y = facingRotation(state.bot.fx, state.bot.fz);

  playerCarrierMarker.visible=!!state.player.carryingFlag;
  botCarrierMarker.visible=!!state.bot.carryingFlag;

  if (playerCarrierMarker.visible) {
    playerCarrierMarker.position.set(wx(state.player.x),0,wz(state.player.z));
  }
  if (botCarrierMarker.visible) {
    botCarrierMarker.position.set(wx(state.bot.x),0,wz(state.bot.z));
  }

  updateFlagMeshes();
}

function facingRotation(dx, dz) {
  if (!dx && !dz) return 0;
  return Math.atan2(-dx, -dz);
}

function otherTeam(team) {
  return team === 'red' ? 'blue' : 'red';
}

function flagHomePosition(team) {
  return sharedFlagHomePosition(team);
}

function capturePolePosition(team) {
  return sharedCapturePolePosition(team);
}

function flagPosition(flag) {
  if (flag.status==='carried' && flag.carrier) return {x:flag.carrier.x,z:flag.carrier.z};
  return {x:flag.x,z:flag.z};
}

function returnFlagHome(team) {
  const f=state.flags[team];
  if (!f) return;
  if (f.carrier)f.carrier.crossedGateThisCarry=false;
  sharedReturnFlagHome(state.flags,team);
  audio.play('flagReturn');
}

function pickUpFlag(actor,team) {
  if(!sharedPickUpFlag(state.flags,actor,team))return false;
  actor.dash=0;

  if (actor.isBot) {
    actor.aiPath.length=0;
    actor.aiPathTimer=0;
  }

  audio.play('flagPickup');
  return true;
}

function flagTossLanding(actor) {
  return sharedFlagTossLanding(actor,gameRandom,(x,z)=>collidesWithWall(x,z));
}

function canTouchFlag(actor,p) {
  return sharedCanTouchFlag(actor,p,(x,z)=>collidesWithWall(x,z));
}
function dropCarriedFlag(actor) {
  if(!sharedDropCarriedFlag(state.flags,actor,gameRandom,(x,z)=>collidesWithWall(x,z)))return false;

  if (actor.isBot) {
    actor.aiPath.length=0;
    actor.aiPathTimer=0;
  }

  setCombatMessage(actor.isBot ? 'BOT DROPPED THE FLAG!' : 'YOU DROPPED THE FLAG!',0.85);
  audio.play('flagDrop');
  return true;
}

function bankCarriedFlag(actor) {
  if (!actor?.carryingFlag) return false;

  if (actor.crossedGateThisCarry) state.wallStats[actor.team].carrierBanksAfterGateCrossing++;
  sharedBankCarriedFlag(state.flags,actor);
  actor.dash=0;

  if (actor.isBot) {
    actor.aiPath.length=0;
    actor.aiPathTimer=0;
  }

  setCombatMessage(
    actor.team==='red'
      ? 'BLUE FLAG SECURED · RECOVER RED TO WIN'
      : 'RED FLAG SECURED BY BOT',
    1.15
  );
  audio.play('flagCapture');
  return true;
}

function updateFlagMeshes() {
  for(const team of ['red','blue']){
    const enemy=state.flags[team==='red'?'blue':'red'];
    bankedFlagMarkers[team].visible=enemy.status==='banked'&&enemy.bankedAt===team;
  }
  for (const team of ['red','blue']) {
    const f=state.flags[team];
    const mesh=flagMeshes[team];
    if (!mesh || !f) continue;

    if (f.status==='carried' && f.carrier) {
      // Hide the large flag while carried so it never blocks the player/camera.
      mesh.visible=false;
    } else if (f.status==='dropped') {
      mesh.visible=true;
      const t=1-(f.tossRemaining||0)/FLAG_TOSS_TIME,from=f.tossFrom||f;
      mesh.position.set(wx(from.x+(f.x-from.x)*t),0.055+Math.sin(Math.PI*t)*1.1,wz(from.z+(f.z-from.z)*t));
      mesh.scale.setScalar(0.72);
      mesh.rotation.set(-Math.PI/2,0,0);
    } else if (f.status==='banked' && f.bankedAt) {
      // Secured enemy flag visibly hangs at the team's GOLD capture pole.
      const cap=capturePolePosition(f.bankedAt);
      mesh.visible=true;
      mesh.position.set(wx(cap.x)+0.10,0.86,wz(cap.z));
      mesh.scale.setScalar(0.88);
      mesh.rotation.set(0,0,0);
    } else {
      const h=flagHomePosition(team);
      mesh.visible=true;
      mesh.position.set(wx(h.x)+0.10,0.86,wz(h.z));
      mesh.scale.setScalar(0.88);
      mesh.rotation.set(0,0,0);
    }
  }

  redDroppedMarker.visible=state.flags.red.status==='dropped';
  blueDroppedMarker.visible=state.flags.blue.status==='dropped';

  if (redDroppedMarker.visible) {
    redDroppedMarker.position.x=wx(state.flags.red.x);
    redDroppedMarker.position.z=wz(state.flags.red.z);
  }
  if (blueDroppedMarker.visible) {
    blueDroppedMarker.position.x=wx(state.flags.blue.x);
    blueDroppedMarker.position.z=wz(state.flags.blue.z);
  }
}

function resolveFlagTouches(actor) {
  const own=state.flags[actor.team];

  if (own.status==='dropped' && own.dropInteractDelay<=0) {
    const p=flagPosition(own);
    if (canTouchFlag(actor,p)) {
      returnFlagHome(actor.team);
      setCombatMessage(`${actor.team.toUpperCase()} FLAG RETURNED HOME`,0.75);
    }
  }

  // If your flag has already been secured on the opponent's GOLD pole,
  // you can raid that base, touch your flag, and return it home.
  if (own.status==='banked') {
    const p=flagPosition(own);
    if (canTouchFlag(actor,p)) {
      returnFlagHome(actor.team);
      setCombatMessage(`${actor.team.toUpperCase()} FLAG RECLAIMED!`,0.85);
    }
  }

  const enemyTeam=otherTeam(actor.team);
  const enemy=state.flags[enemyTeam];

  // Only HOME or DROPPED enemy flags can be picked up.
  // A BANKED enemy flag is already secured on your own capture pole.
  const enemyStealable=enemy.status==='home' || enemy.status==='dropped';

  if (!actor.carryingFlag && enemyStealable && enemy.dropInteractDelay<=0) {
    const lockedOut=
      enemy.status==='dropped' &&
      enemy.dropLockActor===actor &&
      enemy.dropLockTimer>0;

    if (!lockedOut) {
      const p=flagPosition(enemy);
      if (canTouchFlag(actor,p)) {
        pickUpFlag(actor,enemyTeam);
      }
    }
  }
}

function checkFlagBank(actor,dt) {
  const carryingEnemy=actor.carryingFlag===otherTeam(actor.team);
  const cap=capturePolePosition(actor.team);
  const atCapturePole=Math.hypot(actor.x-cap.x,actor.z-cap.z)<=CAPTURE_RADIUS;

  if (!carryingEnemy || !atCapturePole) {
    actor.captureProgress=0;
    return false;
  }

  actor.captureProgress=Math.min(CAPTURE_CHANNEL_TIME,actor.captureProgress+dt);

  if (actor.captureProgress>=CAPTURE_CHANNEL_TIME) {
    return bankCarriedFlag(actor);
  }
  return false;
}

function checkBankedVictory(actor) {
  if (flagWinner(state.flags)===actor.team) {
    endGame(actor.team==='red'?'YOU WIN!':'BOT WINS!');
    return true;
  }

  return false;
}

function updateFlagRules(dt) {
  advanceFlagTimers(state.flags,dt);

  resolveFlagTouches(state.player);
  resolveFlagTouches(state.bot);

  if (!state.winner) checkFlagBank(state.player,dt);
  if (!state.winner) checkFlagBank(state.bot,dt);

  if (!state.winner) checkBankedVictory(state.player);
  if (!state.winner) checkBankedVictory(state.bot);
}

function hasWall(x, z, o, extra = null) {
  const k = wallKey(x, z, o);
  return state.walls.has(k) || extra === k;
}

function edgeTouchesGoal(x, z, o) {
  const pts = o === 'h'
    ? [{x:x+.2,z:z-.03},{x:x+.8,z:z-.03},{x:x+.2,z:z+.03},{x:x+.8,z:z+.03}]
    : [{x:x-.03,z:z+.2},{x:x-.03,z:z+.8},{x:x+.03,z:z+.2},{x:x+.03,z:z+.8}];
  return pts.some(p => {
    const top = Math.abs(p.x - GRID_W/2) <= GOAL_WIDTH/2 && p.z <= GOAL_DEPTH;
    const bottom = Math.abs(p.x - GRID_W/2) <= GOAL_WIDTH/2 && p.z >= GRID_L - GOAL_DEPTH;
    return top || bottom;
  });
}

function wouldCloseTile(t) {
  const cells = t.o === 'h' ? [{x:t.x,z:t.z},{x:t.x,z:t.z-1}] : [{x:t.x,z:t.z},{x:t.x-1,z:t.z}];
  const extra = wallKey(t.x, t.z, t.o);
  for (const c of cells) {
    if (c.x < 0 || c.z < 0 || c.x >= GRID_W || c.z >= GRID_L) continue;
    const top = c.z === 0 || hasWall(c.x, c.z, 'h', extra);
    const bottom = c.z === GRID_L - 1 || hasWall(c.x, c.z + 1, 'h', extra);
    const left = c.x === 0 || hasWall(c.x, c.z, 'v', extra);
    const right = c.x === GRID_W - 1 || hasWall(c.x + 1, c.z, 'v', extra);
    if (top && bottom && left && right) return true;
  }
  return false;
}

function wallTransform(t) {
  const edge=arenaGrid.edge(t);
  return {pos:new THREE.Vector3(edge.center.x,.40,edge.center.z),rot:edge.rotation};
}

function createWallMesh(t, team, ghost = false) {
  if(TEAM_GATES&&!ghost&&typeof gateSystem!=='undefined'&&gateSystem)return gateSystem.create(team,wallTransform(t));
  const mat = ghost
    ? new THREE.MeshStandardMaterial({ color: 0x7ec991, transparent: true, opacity: 0.32, roughness: 0.95, vertexColors:true, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1 })
    : (TEAM_GATES?(team==='red'?mats.redWall:mats.blueWall).clone():(team === 'red' ? mats.redWall : mats.blueWall));
  if(TEAM_GATES&&!ghost)mat.transparent=true;
  const mesh = new THREE.Mesh(ghost?createGhostGeometry(THREE):new THREE.BoxGeometry(0.98, 0.80, 0.13), mat);
  const tr = wallTransform(t);
  mesh.position.copy(tr.pos);
  mesh.rotation.y = tr.rot;
  mesh.castShadow = !ghost;
  mesh.receiveShadow = !ghost;
  if(ghost){mesh.renderOrder=2;mesh.userData.visualOnly=true;}
  world.add(mesh);
  return mesh;
}

function addWall(team, t) {
  const k = wallKey(t.x, t.z, t.o);
  if (wallPlacementIssue(team==='red'?state.player:state.bot,t)) return false;
  const route=spectator?.beforeWall(team,t);
  const mesh = createWallMesh(t, team, false);
  state.walls.set(k, { ...t, team, mesh });
  state.wallStats[team][TEAM_GATES?'teamGatesBuilt':'normalWallsBuilt']++;
  state.wallOrder[team].push(k);
  if (state.wallOrder[team].length > MAX_WALLS) {
    const old = state.wallOrder[team].shift();
    removeWall(old,{reason:'wall-limit'});
  }
  spectator?.wallBuilt(team,t,route);
  if(mesh.userData?.gateVisual)mesh.userData.gateVisual.built();
  else wallEffects?.built(mesh,team);
  audio.play('buildSuccess');
  return true;
}

function removeWall(k,detail={reason:'destroyed'}) {
  const w = state.walls.get(k);
  if (!w) return;
  if((detail.reason==='dig'||detail.reason==='smash')&&detail.actor&&detail.actor!==w.team)
    state.wallStats[detail.actor].enemyWallsDestroyed++;
  spectator?.wallRemoved(w,detail);
  if(w.mesh.userData?.gateVisual)w.mesh.userData.gateVisual.destroy(detail.reason);
  else {world.remove(w.mesh);
  w.mesh.geometry.dispose();
  if (w.mesh.material !== mats.redWall && w.mesh.material !== mats.blueWall) w.mesh.material.dispose();}
  state.walls.delete(k);
  if(!w.mesh.userData?.gateVisual)wallEffects?.removed(w.mesh,w.team,detail.reason);
  if(detail.reason==='dig')(detail.actor==='blue'?botCharacter:playerCharacter)?.finishWallSmashAnimation(k,DIG_TIME);
  const arr = state.wallOrder[w.team];
  const i = arr.indexOf(k);
  if (i >= 0) arr.splice(i, 1);
  if(detail.reason==='dig'||detail.reason==='smash')audio.play('wallBreak');
}

function facingEdge(a, includeBoundary=true) {
  return sharedFacingEdge(a,includeBoundary);
}

function pointSegDist(px,pz,x1,z1,x2,z2) {
  return sharedPointSegDist(px,pz,x1,z1,x2,z2);
}

function wallBlocksTeam(w,team=null) {
  return sharedWallBlocksTeam(w,team,TEAM_GATES);
}

function gateCrossings(a,x,z) {
  if(!TEAM_GATES)return;
  for(const w of state.walls.values()){
    if(w.team!==a.team)continue;
    const before=w.o==='h'?a.z-w.z:a.x-w.x,after=w.o==='h'?z-w.z:x-w.x;
    const cross=(before<0&&after>=0)||(before>0&&after<=0);
    if(!cross)continue;
    const t=before/(before-after),along=w.o==='h'?a.x+(x-a.x)*t:a.z+(z-a.z)*t;
    const start=w.o==='h'?w.x:w.z;if(along<start||along>start+1)continue;
    const m=state.gateMetrics;m.crossings[a.team]++;if(a.carryingFlag)m.carrierCrossings[a.team]++;
    const stats=state.wallStats[a.team];stats.friendlyGateCrossings++;
    if(a.carryingFlag){stats.carrierGateCrossings++;(a.team==='red'?state.player:state.bot).crossedGateThisCarry=true;}
    m.crossingEvents.push({time:state.elapsed,team:a.team,carrier:!!a.carryingFlag,edge:wallKey(w.x,w.z,w.o)});
    if(m.crossingEvents.length>200)m.crossingEvents.shift();
    w.openSeconds=.30;
    w.mesh.userData?.gateVisual?.crossed();
  }
}

function updateGateVisuals(dt) {
  if(!TEAM_GATES)return;
  if(typeof gateSystem!=='undefined'&&gateSystem){
    const poses=[state.player,state.bot].map(a=>({team:a.team,x:arenaGrid.toWorldX(a.x),z:arenaGrid.toWorldZ(a.z)}));
    const openById=onlineMode?new Map([...state.walls.values()].map(w=>[w.id,!!w.open])):null;
    gateSystem.update(dt,poses,openById);return;
  }
  for(const w of state.walls.values()){
    const owner=w.team==='red'?state.player:state.bot;
    w.openSeconds=Math.max(0,(w.openSeconds||0)-dt);
    const opening=w.openSeconds>0||wallDistanceToActor(w,owner)<.65;
    w.mesh.material.opacity=opening?.25:1;
    w.mesh.userData??={};w.mesh.userData.friendlyGateOpen=opening;
  }
}

function collidesWithWall(x, z, team=null) {
  if(ARENA_ID==='wetlands-v3'&&terrainBodyBlocked(x,z))return true;
  return sharedWallCollision(x,z,team,state.walls,TEAM_GATES);
}

function nearWall(a, t, range = 0.68) {
  return sharedNearWall(a,t,range);
}

function wallDistanceToActor(t, a) {
  return sharedWallDistance(t,a);
}

function wallPlacementOccupied(team,t) {
  const opponent=team==='red'?state.bot:state.player;
  return !!opponent && sharedWallDistance(t,opponent)<PLAYER_RADIUS+WALL_HALF_THICKNESS;
}

function cleanupBuildPreview(a) {
  if (!a?.buildPreview) return;
  world.remove(a.buildPreview);
  a.buildPreview.geometry.dispose();
  a.buildPreview.material.dispose();
  a.buildPreview = null;
}

function cancelBuild(a) {
  if (!a) return;
  if(a.build>0&&a.buildTarget){buildFeedback[a.team].flash(a.buildTarget,a.team,'cancel');audio.play('buildCancel');}
  buildFeedback[a.team].hide();
  a.buildVisual?.cancelBuildAnimation();
  a.buildVisual=null;
  cleanupBuildPreview(a);
  a.build = 0;
  a.buildTarget = null;
}

function resolveActorAgainstWalls(a) {
  if (!a) return;
  const minDist = PLAYER_RADIUS + WALL_HALF_THICKNESS + 0.012;

  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const w of state.walls.values()) {
      if(!wallBlocksTeam(w,a.team))continue;
      let x1=w.x,z1=w.z,x2=w.x,z2=w.z;
      if (w.o === 'h') x2++; else z2++;

      const vx=x2-x1, vz=z2-z1;
      const c2=vx*vx+vz*vz;
      const t=c2 ? clamp(((a.x-x1)*vx+(a.z-z1)*vz)/c2,0,1) : 0;
      const qx=x1+t*vx, qz=z1+t*vz;
      let dx=a.x-qx, dz=a.z-qz;
      let d=Math.hypot(dx,dz);

      if (d < minDist) {
        if (d < 1e-5) {
          if (w.o === 'h') {
            dz = (a.z >= w.z ? 1 : -1);
            dx = 0;
          } else {
            dx = (a.x >= w.x ? 1 : -1);
            dz = 0;
          }
          d = 1;
        }
        const push = minDist - d + 0.004;
        a.x += (dx/d)*push;
        a.z += (dz/d)*push;
        a.x = clamp(a.x, PLAYER_RADIUS, GRID_W - PLAYER_RADIUS);
        a.z = clamp(a.z, PLAYER_RADIUS, GRID_L - PLAYER_RADIUS);
        moved = true;
      }
    }
    if (!moved) break;
  }
}

function safeJumpLanding(a, distance = 1.18) {
  return sharedSafeJumpLanding(a,(x,z,team)=>collidesWithWall(x,z,team),distance);
}

function tryMove(a, dx, dz) {
  if ((a.build > 0 && !MOVE_BUILD) || a.dig > 0) return;
  if (a.build > 0) { dx*=BUILD_MOVE_MULT; dz*=BUILD_MOVE_MULT; }
  const {oldX,oldZ,nx,nz,surfaceSpeed}=moveActorOnTerrain(a,dx,dz,(x,z)=>collidesWithWall(x,z,a.team));
  if(TEAM_GATES){
    gateCrossings({...a,x:oldX,z:oldZ},a.x,oldZ);
    gateCrossings({...a,z:oldZ},a.x,a.z);
    if(Math.abs(a.x-nx)>1e-8||Math.abs(a.z-nz)>1e-8){
      state.gateMetrics.blockedMoves[a.team]++;
      state.gateMetrics.blockedMotionSeconds[a.team]+=Math.hypot(dx,dz)/(HUMAN_SPEED*(a.carryingFlag?FLAG_CARRIER_SPEED_MULT:1)*(a.dash>0&&a.build<=0?1.72:1)*(a.build>0?BUILD_MOVE_MULT:1));
    }
  }
}

function setCombatMessage(text, seconds=0.7) {
  state.combatMessage=text;
  state.combatMessageTimer=seconds;
}

function startShove(attacker,target) {
  if (!attacker || !target || attacker.shoveCooldown>0 || attacker.shoveActive>0) return false;
  if (target.shoveProtection>0) return false;
  if (attacker.build>0 || attacker.dig>0) return false;

  const dx=target.x-attacker.x;
  const dz=target.z-attacker.z;
  const d=Math.hypot(dx,dz);
  if (d<=SHOVE_RANGE && !shovePathClear(attacker,target)) return false;

  // Make the input readable: if the opponent is nearby, face them automatically.
  if (d<=1.20 && d>0.0001) {
    faceDirection(attacker,dx,dz);
  }

  attacker.shoveCooldown=SHOVE_COOLDOWN;
  attacker.shoveActive=SHOVE_ACTIVE_TIME;
  (attacker.team==='blue'?botCharacter:playerCharacter)?.startCombatAnimation('Shove');
  audio.play('shove');
  return true;
}

function shovePathClear(attacker,target) {
  return sharedShovePathClear(attacker,target,(x,z)=>collidesWithWall(x,z));
}

function shoveCanHit(attacker,target) {
  return sharedShoveCanHit(attacker,target,(x,z)=>collidesWithWall(x,z));
}

function pushActor(attacker,target,force,direction=null) {
  pushShoveActor(attacker,target,force,(x,z,team)=>collidesWithWall(x,z,team),actor=>{
    cancelBuild(actor);actor.dig=0;actor.digTarget=null;
    if(actor.isBot){actor.aiPath.length=0;actor.aiPathTimer=0;actor.aiStuckTimer=0;}
  },direction);
}
function resolveShoveCombat(dt) {
  const p=state.player;
  const b=state.bot;
  for (const actor of [p,b]) actor.shoveProtection=Math.max(0,actor.shoveProtection-dt);
  const pHit=shoveCanHit(p,b);
  const bHit=shoveCanHit(b,p);

  // Simultaneous attacks do not depend on frame order.
  if (pHit && bHit) {
    // Snapshot the axis before moving either actor, including exact overlap.
    const dx=b.x-p.x, dz=b.z-p.z, d=Math.hypot(dx,dz);
    const axis=d>.0001?{x:dx/d,z:dz/d}:{x:p.fx,z:p.fz};
    pushActor(p,b,SHOVE_CLASH_FORCE,axis);
    pushActor(b,p,SHOVE_CLASH_FORCE,{x:-axis.x,z:-axis.z});
    p.shoveProtection=SHOVE_PROTECTION_TIME;
    b.shoveProtection=SHOVE_PROTECTION_TIME;
    p.shoveActive=0;
    b.shoveActive=0;
    playerCharacter?.confirmShoveImpact();
    botCharacter?.confirmShoveImpact();
    setCombatMessage('CLASH! · both recoil · no flag drops',0.85);
    audio.play('shoveImpact');
    return;
  }

  if (pHit) {
    pushActor(p,b,SHOVE_FORCE);
    b.shoveProtection=SHOVE_PROTECTION_TIME;
    playerCharacter?.confirmShoveImpact();
    botCharacter?.startCombatAnimation('ShoveHit');
    spectator?.shoveHit(p.team);
    const carrying=!!b.carryingFlag;
    if (carrying) dropCarriedFlag(b);
    audio.play('shoveImpact');
    p.shoveActive=0;
    setCombatMessage(carrying?'HIT! · BOT DROPPED THE FLAG':'SHOVE HIT!',0.75);
  }

  if (bHit) {
    pushActor(b,p,SHOVE_FORCE);
    p.shoveProtection=SHOVE_PROTECTION_TIME;
    botCharacter?.confirmShoveImpact();
    playerCharacter?.startCombatAnimation('ShoveHit');
    spectator?.shoveHit(b.team);
    const carrying=!!p.carryingFlag;
    if (carrying) dropCarriedFlag(p);
    audio.play('shoveImpact');
    b.shoveActive=0;
    setCombatMessage(carrying?'HIT! · YOU DROPPED THE FLAG':'BOT SHOVED YOU!',0.75);
  }

  p.shoveActive=Math.max(0,p.shoveActive-dt);
  b.shoveActive=Math.max(0,b.shoveActive-dt);
}

function wallPlacementIssue(a,t) {
  const opponent=(a?.team||'red')==='red'?state.bot:state.player;
  return sharedPlacementIssue(a,t,opponent,state.walls,{disabled:new URLSearchParams(location.search).get('walls')==='off'});
}

function beginBuild(a, t) {
  if (a.build > 0 || a.dig > 0 || wallPlacementIssue(a,t)) return false;

  a.buildDuration=a.carryingFlag ? CARRIER_BUILD_TIME : BUILD_TIME;
  a.build=a.buildDuration;
  a.buildTarget=t;
  buildFeedback[a.team].progress(a);
  audio.play('buildStart');
  a.buildVisual=a.team==='blue'?botCharacter:playerCharacter;
  a.buildVisual?.startBuildAnimation(a.buildDuration);
  if(!a.isBot){
    a.buildPreview=createWallMesh(t,a.team,true);
    a.buildPreview.scale.y=0.05;
    a.buildPreview.position.y=0.02;
  }
  return true;
}

function updateBuild(a, dt, keepBuilding = true) {
  if (a.build <= 0) return;

  if (!keepBuilding) {
    cancelBuild(a);
    return;
  }

  a.build -= dt;
  if (a.build<1e-9) a.build=0;
  // Only a successful final placement may sample the authored impact pose.
  if(a.build>0)a.buildVisual?.syncBuildAnimation(a.build);
  const p = clamp(1 - a.build / Math.max(0.001,a.buildDuration||BUILD_TIME), 0.05, 1);
  if (a.buildPreview) {
    a.buildPreview.scale.y = p;
    a.buildPreview.position.y = 0.40 * p;
  }
  if(a.build>0)buildFeedback[a.team].progress(a);

  if (a.build <= 0 && a.buildTarget) {
    const target = a.buildTarget;
    cleanupBuildPreview(a);
    a.buildTarget = null;
    a.build = 0;
    const built=addWall(a.team, target); // Re-check occupancy at the final moment.
    buildFeedback[a.team].hide();
    buildFeedback[a.team].flash(target,a.team,built?'success':'cancel');
    if(!built)audio.play('buildCancel');
    if(built&&!a.isBot)humanPlacementPreview?.built(target);
    a.buildVisual?.finishBuildAnimation(built);
    a.buildVisual=null;

    // A completed wall changes navigation. The bot must immediately resume its race
    // using a fresh path instead of standing on an obsolete route.
    if (a.isBot) {
      a.aiPath.length = 0;
      a.aiPathTimer = 0;
      a.aiBuildCooldown = Math.max(a.aiBuildCooldown, 1.65);
    }
  }
}

function advanceBotBuild(bot,dt){
  if(bot.build>0&&MOVE_BUILD){
    // Keep the construction heading locked; tryMove applies terrain, collision,
    // and the same 40% multiplier as human held-F movement.
    const speed=BOT_SPEED*(bot.carryingFlag?FLAG_CARRIER_SPEED_MULT:1);
    tryMove(bot,bot.fx*speed*dt,bot.fz*speed*dt);
  }
  updateBuild(bot,dt,true);
}

function powerMesh(type) {
  const g = new THREE.Group();
  let mesh;
  if (type === 'jump') mesh = new THREE.Mesh(new THREE.TorusGeometry(0.22,0.075,12,24), new THREE.MeshStandardMaterial({color:0x63e68e,emissive:0x144c25,emissiveIntensity:.65,roughness:.35}));
  else if (type === 'dash') mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.24,0), new THREE.MeshStandardMaterial({color:0xffdb4d,emissive:0x5b4700,emissiveIntensity:.8,roughness:.3}));
  else mesh = new THREE.Mesh(new THREE.BoxGeometry(0.34,0.34,0.34), new THREE.MeshStandardMaterial({color:0xff8a45,emissive:0x5d1f00,emissiveIntensity:.6,roughness:.42}));
  mesh.castShadow = true;
  g.add(mesh);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.36,0.015,8,32), new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.58}));
  halo.rotation.x = Math.PI/2;
  g.add(halo);
  return g;
}
function disposePowerMesh(mesh){
  world.remove(mesh);
  mesh.traverse(child=>{if(child.isMesh){child.geometry.dispose();child.material.dispose();}});
}

function spawnPower() {
  const record=spawnPowerRecord(state.powerups,POWER_SPOTS,gameRandom);
  if(!record)return;
  const mesh=powerMesh(record.type);
  mesh.position.set(wx(record.x),0.45,wz(record.z));
  world.add(mesh);
  state.powerups.push({...record,mesh,t:0});
}

function pickupPower(a) {
  const pickup=collectPower(a,state.powerups);
  if(pickup){disposePowerMesh(pickup.mesh);audio.play('powerPickup');}
}

function usePower(a) {
  if(a.power==='dash'&&a.carryingFlag&&!a.isBot)setCombatMessage('DASH LOCKED WHILE CARRYING FLAG',0.65);
  const result=activatePower(a,{walls:state.walls,blocked:(x,z,team)=>collidesWithWall(x,z,team),
    removeWall:key=>{removeWall(key,{actor:a.team,reason:'smash'});return true;}});
  if(!result)return false;
  if(result.type==='jump')resolveActorAgainstWalls(a);
  audio.play('powerActivate');
  return true;
}

humanPlacementPreview=createPlacementPreview({state,spectatorMode,targetEdge:facingEdge,actor:()=>localActor(),
  validate:wallPlacementIssue,createMesh:t=>createWallMesh(t,onlineMode?localActor().team:'red',true),transform:wallTransform});

const keys = new Set();
const justPressed = new Set();
window.addEventListener('keydown', (e) => {
  if(onlineMode){
    if(['KeyW','KeyA','KeyS','KeyD','KeyF','KeyG','KeyH','Space'].includes(e.code)){
      e.preventDefault();if(keys.has(e.code))return;
      keys.add(e.code);audio.unlock();sendOnlineInput();
    }
    return;
  }
  if (spectatorMode) return;
  if (['KeyW','KeyA','KeyS','KeyD','KeyF','KeyG','KeyH','Space'].includes(e.code)) e.preventDefault();
  if (!keys.has(e.code)) justPressed.add(e.code);
  keys.add(e.code);
  audio.unlock();
});
window.addEventListener('keyup', e => {
  keys.delete(e.code);
  if(onlineMode){sendOnlineInput();return;}
  if (!['KeyW','KeyA','KeyS','KeyD'].some(key=>keys.has(key))) camera.userData.inputYaw=null;
});
window.addEventListener('blur', () => {
  keys.clear();justPressed.clear();camera.userData.inputYaw=null;
  if(onlineMode)sendOnlineInput();
});

function updateHuman(a, dt) {
  a.shoveCooldown=Math.max(0,a.shoveCooldown-dt);
  if(MOVE_BUILD && !keys.has('KeyF') && a.build>0)cancelBuild(a);

  let localX=0;
  let localForward=0;

  if (keys.has('KeyA')) localX-=1;
  if (keys.has('KeyD')) localX+=1;
  if (keys.has('KeyW')) localForward+=1;
  if (keys.has('KeyS')) localForward-=1;

  if (localX||localForward) {
    const mag=Math.hypot(localX,localForward);
    localX/=mag;
    localForward/=mag;

    // A held input sequence keeps its original arena-axis reference through flips.
    // A new sequence uses the selected heading, never an intermediate turn angle.
    camera.userData.inputYaw ??= (a.carryingFlag?Math.PI:0);
    const yaw=camera.userData.inputYaw;
    const forwardX=-Math.sin(yaw);
    const forwardZ=-Math.cos(yaw);
    const rightX=Math.cos(yaw);
    const rightZ=-Math.sin(yaw);

    let dx=rightX*localX+forwardX*localForward;
    let dz=rightZ*localX+forwardZ*localForward;
    const m=Math.hypot(dx,dz)||1;
    dx/=m;
    dz/=m;

    if (a.build<=0 && a.dig<=0) {
      a.fx=dx;
      a.fz=dz;
    }

    // Lock the edge after the held movement direction sets facing, but before
    // moving, so the first frame already uses construction speed.
    if(MOVE_BUILD && keys.has('KeyF') && !a.buildLatch && a.build<=0 && a.dig<=0){
      if(beginBuild(a,facingEdge(a)))a.buildLatch=true;
    }

    const carrierMult=a.carryingFlag ? FLAG_CARRIER_SPEED_MULT : 1;
    const speed=HUMAN_SPEED*carrierMult*(a.dash>0&&a.build<=0?1.72:1);
    tryMove(a,dx*speed*dt,dz*speed*dt);
  } else {
    camera.userData.inputYaw=null;
  }

  if (a.dash>0) a.dash=Math.max(0,a.dash-dt);

  const buildHeld=keys.has('KeyF');
  if (!buildHeld) {
    if (a.build>0) cancelBuild(a);
    a.buildLatch=false;
  } else if (!a.buildLatch && a.build<=0 && a.dig<=0) {
    if (beginBuild(a,facingEdge(a))) a.buildLatch=true;
  }
  updateBuild(a,dt,buildHeld);

  if (keys.has('KeyG') && a.build<=0) {
    const t=facingEdge(a);
    const k=t?wallKey(t.x,t.z,t.o):null;

    if (t && nearWall(a,t) && state.walls.has(k)) {
      const prev=a.digTarget?wallKey(a.digTarget.x,a.digTarget.z,a.digTarget.o):null;
      if (prev!==k) {
        a.dig=0;
        a.digTarget=t;
      }

      a.dig+=dt;
      if (a.dig+1e-9>=DIG_TIME) {
        removeWall(k,{actor:a.team,reason:'dig'});
        a.dig=0;
        a.digTarget=null;
      }
    } else {
      a.dig=0;
      a.digTarget=null;
    }
  } else if (!keys.has('KeyG')) {
    a.dig=0;
    a.digTarget=null;
  }

  if (justPressed.has('Space')) {
    startShove(a,state.bot);
  }

  if (justPressed.has('KeyH')) usePower(a);

  resolveActorAgainstWalls(a);
  pickupPower(a);
}

function edgeBetween(cx,cz,nx,nz) {
  if (nx===cx+1&&nz===cz) return {x:cx+1,z:cz,o:'v'};
  if (nx===cx-1&&nz===cz) return {x:cx,z:cz,o:'v'};
  if (nx===cx&&nz===cz+1) return {x:cx,z:cz+1,o:'h'};
  if (nx===cx&&nz===cz-1) return {x:cx,z:cz,o:'h'};
  return null;
}

function cellPassable(cx,cz,nx,nz,extraBlocked=null,team=null) {
  if (nx<0||nz<0||nx>=GRID_W||nz>=GRID_L) return false;
  if(!terrainAt(nx+.5,nz+.5).walkable)return false;
  const e=edgeBetween(cx,cz,nx,nz);
  if (!e) return false;
  const k=wallKey(e.x,e.z,e.o);
  return !wallBlocksTeam(state.walls.get(k),team) && k!==extraBlocked;
}

// Only resolves equal-cost routes. Reflecting start/objective in z reverses this
// order; neither team receives a speed, cost, or strategic preference bonus.
function pathForward(start,goalTest) {
  let goalZ=0,count=0;
  for(let z=0;z<GRID_L;z++)for(let x=0;x<GRID_W;x++)if(goalTest(x,z)){goalZ+=z;count++;}
  const dz=count?goalZ/count-start.z:0;
  // Same-row or empty goals use a mirrored fallback (the board has even length).
  return Math.sign(dz)||(start.z<(GRID_L-1)/2?1:-1);
}

function findPath(start,goalTest,extraBlocked=null,team=null) {
  if (ARENA_ID!=='baseline') return findWeightedPath(start,goalTest,extraBlocked,team);
  const forward=pathForward(start,goalTest);
  const q=[start];
  const seen=new Set([`${start.x},${start.z}`]);
  const prev=new Map();
  let goal=null;

  while(q.length) {
    const cur=q.shift();
    if (goalTest(cur.x,cur.z)) {
      goal=cur;
      break;
    }
    const ns=[
      {x:cur.x,z:cur.z+forward},
      {x:cur.x-1,z:cur.z},
      {x:cur.x+1,z:cur.z},
      {x:cur.x,z:cur.z-forward}
    ];
    for (const n of ns) {
      const k=`${n.x},${n.z}`;
      if (seen.has(k) || !cellPassable(cur.x,cur.z,n.x,n.z,extraBlocked,team)) continue;
      seen.add(k);
      prev.set(k,cur);
      q.push(n);
    }
  }

  if (!goal) return [];

  const path=[goal];
  let cur=goal;
  while(!(cur.x===start.x && cur.z===start.z)) {
    const p=prev.get(`${cur.x},${cur.z}`);
    if (!p) break;
    path.push(p);
    cur=p;
  }
  path.reverse();
  return path;
}

// Dijkstra and baseline BFS share the same objective-relative tie-break.
function findWeightedPath(start,goalTest,extraBlocked=null,team=null) {
  const forward=pathForward(start,goalTest);
  const key=c=>c.x+','+c.z,open=[start],cost=new Map([[key(start),0]]),prev=new Map(),done=new Set();
  while(open.length){
    let best=0;for(let i=1;i<open.length;i++)if(cost.get(key(open[i]))<cost.get(key(open[best]))-1e-9)best=i;
    const cur=open.splice(best,1)[0],k=key(cur);if(done.has(k))continue;done.add(k);
    if(goalTest(cur.x,cur.z)){
      const path=[cur];let c=cur;while(prev.has(key(c))){c=prev.get(key(c));path.push(c);}return path.reverse();
    }
    for(const n of [{x:cur.x,z:cur.z+forward},{x:cur.x-1,z:cur.z},{x:cur.x+1,z:cur.z},{x:cur.x,z:cur.z-forward}]){
      if(!cellPassable(cur.x,cur.z,n.x,n.z,extraBlocked,team))continue;
      const nk=key(n),next=cost.get(k)+terrainStepCost(cur,n);
      if(next<(cost.get(nk)??Infinity)-1e-9){cost.set(nk,next);prev.set(nk,cur);open.push(n);}
    }
  }return [];
}

// In V3 Team Gates, a blocked edge is a timed action, not an impossible route.
// Search both detours and breaks in seconds. An available instant counter can
// remove the cost of one gate; it is never treated as reusable along the path.
function findBotTacticalPath(bot,goalTest) {
  const start=actorCell(bot);
  const speed=BOT_SPEED*(bot.carryingFlag?FLAG_CARRIER_SPEED_MULT:1)*(bot.dash>0?1.72:1);
  if(ARENA_ID!=='wetlands-v3'||!TEAM_GATES||![...state.walls.values()].some(w=>wallBlocksTeam(w,bot.team))){
    const path=findPath(start,goalTest,null,bot.team);
    return {path,instantEdge:null,seconds:path.length?
      path.slice(1).reduce((sum,c,i)=>sum+terrainStepCost(path[i],c),0)/speed:Infinity};
  }
  const instant=bot.power==='smash'||bot.power==='jump';
  const forward=pathForward(start,goalTest);
  const key=n=>`${n.x},${n.z},${n.used}`;
  const first={...start,used:!instant},open=[first],cost=new Map([[key(first),0]]),prev=new Map(),done=new Set();
  while(open.length){
    let best=0;
    for(let i=1;i<open.length;i++)if(cost.get(key(open[i]))<cost.get(key(open[best]))-1e-9)best=i;
    const cur=open.splice(best,1)[0],k=key(cur);
    if(done.has(k))continue;
    done.add(k);
    if(goalTest(cur.x,cur.z)){
      const path=[{x:cur.x,z:cur.z}];let instantEdge=null,c=cur;
      while(prev.has(key(c))){
        const step=prev.get(key(c));
        if(step.instantEdge)instantEdge=step.instantEdge;
        c=step.from;path.push({x:c.x,z:c.z});
      }
      return {path:path.reverse(),instantEdge,seconds:cost.get(k)};
    }
    for(const n of [{x:cur.x,z:cur.z+forward},{x:cur.x-1,z:cur.z},{x:cur.x+1,z:cur.z},{x:cur.x,z:cur.z-forward}]){
      if(n.x<0||n.z<0||n.x>=GRID_W||n.z>=GRID_L||!terrainAt(n.x+.5,n.z+.5).walkable)continue;
      const edge=edgeBetween(cur.x,cur.z,n.x,n.z),edgeKey=wallKey(edge.x,edge.z,edge.o);
      const blocked=wallBlocksTeam(state.walls.get(edgeKey),bot.team);
      const useInstant=blocked&&instant&&!cur.used;
      const next={...n,used:cur.used||useInstant};
      const nextCost=cost.get(k)+terrainStepCost(cur,n)/speed+(blocked&&!useInstant?DIG_TIME:0);
      const nk=key(next);
      if(nextCost<(cost.get(nk)??Infinity)-1e-9){
        cost.set(nk,nextCost);prev.set(nk,{from:cur,instantEdge:useInstant?edgeKey:null});open.push(next);
      }
    }
  }
  return {path:[],instantEdge:null,seconds:Infinity};
}

function pathTravelTime(a,goalTest,extraBlocked=null) {
  // Seconds at sustained base/carrier speed; powers and moving targets are excluded.
  return pathLength(actorCell(a),goalTest,extraBlocked,a.team)/(HUMAN_SPEED*(a.carryingFlag?FLAG_CARRIER_SPEED_MULT:1));
}

function arenaRoutesOpen(t) {
  if(ARENA_ID==='baseline'&&!TEAM_GATES)return true;
  // Terrain remains traversable. Prevent multi-cell enclosures/base blockades by walls.
  const extra=wallKey(t.x,t.z,t.o),queue=[{x:0,z:0}],seen=new Set(['0,0']);
  for(let i=0;i<queue.length;i++){
    const c=queue[i];
    for(const n of [{x:c.x+1,z:c.z},{x:c.x-1,z:c.z},{x:c.x,z:c.z+1},{x:c.x,z:c.z-1}]){
      const k=n.x+','+n.z;if(seen.has(k)||!cellPassable(c.x,c.z,n.x,n.z,extra))continue;
      seen.add(k);queue.push(n);
    }
  }
  if(ARENA_ID!=='wetlands-v3')return seen.size===GRID_W*GRID_L;
  let walkable=0;
  for(let z=0;z<GRID_L;z++)for(let x=0;x<GRID_W;x++)if(terrainAt(x+.5,z+.5).walkable)walkable++;
  return seen.size===walkable;
}

function faceDirection(a,dx,dz) {
  if (Math.abs(dx)>Math.abs(dz)) {
    a.fx=Math.sign(dx)||1;
    a.fz=0;
  } else {
    a.fx=0;
    a.fz=Math.sign(dz)||1;
  }
}

function actorCell(a) {
  return {
    x:clamp(Math.floor(a.x),0,GRID_W-1),
    z:clamp(Math.floor(a.z),0,GRID_L-1)
  };
}

function targetGoal(tx,tz) {
  const gx=clamp(Math.floor(tx),0,GRID_W-1);
  const gz=clamp(Math.floor(tz),0,GRID_L-1);
  return (x,z)=>x===gx&&z===gz;
}

function redHomeGoal(x,z) {
  return z===GRID_L-1 && Math.abs((x+.5)-GRID_W/2)<=GOAL_WIDTH/2+.25;
}

function blueHomeGoal(x,z) {
  return z===0 && Math.abs((x+.5)-GRID_W/2)<=GOAL_WIDTH/2+.25;
}

function pathLength(start,goalTest,extraBlocked=null,team=null) {
  const p=findPath(start,goalTest,extraBlocked,team);
  return p.length ? p.slice(1).reduce((sum,c,i)=>sum+terrainStepCost(p[i],c),0) : Infinity;
}

function botTargetBuildable(a,t) {
  return !wallPlacementIssue(a,t);
}

function humanEscapeWallValue(t,human) {
  if (!t) return -Infinity;
  const start=actorCell(human);
  const goal=human.team==='red'?redHomeGoal:blueHomeGoal;
  const before=pathLength(start,goal,null,human.team);
  const after=pathLength(start,goal,wallKey(t.x,t.z,t.o),human.team);
  if (!Number.isFinite(before)) return 0;
  if (!Number.isFinite(after)) return 9;
  return after-before;
}

function chooseCarrierBlockingWall(bot,human) {
  if (human.carryingFlag!==bot.team) return null;

  const oldFx=bot.fx;
  const oldFz=bot.fz;
  const dirs=[
    {fx:0,fz:1},
    {fx:-1,fz:0},
    {fx:1,fz:0},
    {fx:0,fz:-1}
  ];

  let best=null;
  let bestScore=-Infinity;

  for (const d of dirs) {
    bot.fx=d.fx;
    bot.fz=d.fz;
    const t=facingEdge(bot);
    if (!botTargetBuildable(bot,t)) continue;

    const routeCost=humanEscapeWallValue(t,human);
    let mx=t.x,mz=t.z;
    if (t.o==='h') mx+=.5;
    else mz+=.5;
    const nearHuman=Math.hypot(mx-human.x,mz-human.z);
    const score=routeCost*4-nearHuman*.35;

    if (score>bestScore) {
      bestScore=score;
      best={...t,fx:d.fx,fz:d.fz,routeCost};
    }
  }

  bot.fx=oldFx;
  bot.fz=oldFz;
  return best && best.routeCost>=1 ? best : null;
}

function chooseBotObjective(bot,human) {
  const own=state.flags[bot.team];
  const enemy=state.flags[otherTeam(bot.team)];

  // Once RED is stolen, always bring it to the GOLD pole and bank it,
  // even if BLUE is currently missing.
  if (bot.carryingFlag===enemy.team) {
    const cap=capturePolePosition(bot.team);
    return {mode:'SECURING FLAG',x:cap.x,z:cap.z,goalTest:targetGoal(cap.x,cap.z)};
  }

  // Bank a carried flag first; then chase/recover, even when both flags are stolen.
  if (human.carryingFlag===bot.team) {
    return {mode:'HUNTING CARRIER',x:human.x,z:human.z,chase:true};
  }

  // BLUE may be dropped locally OR already banked at RED's base.
  // Either way, touching it recovers it.
  if (own.status==='dropped' || own.status==='banked') {
    const p=flagPosition(own);
    return {
      mode:own.status==='banked'?'RAIDING FOR BLUE':'RECOVERING FLAG',
      x:p.x,
      z:p.z,
      goalTest:targetGoal(p.x,p.z)
    };
  }

  // If RED is already secured at our gold pole and BLUE is home,
  // victory is handled by checkBankedVictory(). Otherwise steal RED.
  if (enemy.status==='banked' && enemy.bankedAt===bot.team) {
    const cap=capturePolePosition(bot.team);
    return {mode:'HOLDING SECURED FLAG',x:cap.x,z:cap.z,goalTest:targetGoal(cap.x,cap.z)};
  }

  const approach=chooseLearnedApproach(bot,human,own,enemy);
  if(approach)return approach;
  const p=flagPosition(enemy);
  return {
    mode:enemy.status==='dropped'?'GRABBING DROPPED FLAG':'STEALING FLAG',
    x:p.x,
    z:p.z,
    goalTest:targetGoal(p.x,p.z)
  };
}

function chooseLearnedApproach(bot,human,own,enemy) {
  if(enemy.status!=='home'||own.status!=='home')return null;
  const method=bot.aiMethod||'direct',home=flagHomePosition(bot.team);
  if(method==='intercept'&&Math.hypot(human.x-home.x,human.z-home.z)<4.5){
    // Cut the intruder's approach toward our home pole instead of waiting at base.
    const x=(human.x+home.x)*.5,z=(human.z+home.z)*.5;
    return {mode:'INTERCEPTING APPROACH',x,z,goalTest:targetGoal(x,z)};
  }
  if((method==='flank-left'||method==='flank-right')&&!bot.aiFlankReached){
    const redEnd=home.z>GRID_L/2;
    const left=redEnd?.75:GRID_W-.75;
    const x=method==='flank-left'?left:GRID_W-left,z=GRID_L/2;
    if(Math.hypot(bot.x-x,bot.z-z)<.4||(redEnd?bot.z<z-.5:bot.z>z+.5))bot.aiFlankReached=true;
    else return {mode:method==='flank-left'?'FLANKING LEFT':'FLANKING RIGHT',x,z,goalTest:targetGoal(x,z)};
  }
  return null;
}

function dashTimeSavedOnRoute(path,team,carrier) {
  // Dash lasts 1.35 seconds and expires even while breaking a wall, so only
  // travel before the first enemy gate is counted as a reliable benefit.
  let travel=0;
  for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i],edge=edgeBetween(a.x,a.z,b.x,b.z);
    if(wallBlocksTeam(state.walls.get(wallKey(edge.x,edge.z,edge.o)),team))break;
    travel+=terrainStepCost(a,b)/(BOT_SPEED*(carrier?FLAG_CARRIER_SPEED_MULT:1));
  }
  return Math.min(travel,DASH_TIME*1.72)*(1-1/1.72);
}

function chooseContestedPower(bot,objective,dt) {
  if(!CONTESTED_POWERS||bot.power||bot.dash>0||!state.powerups.length){
    bot.aiPowerTarget=null;
    bot.aiPowerSaving=0;
    return null;
  }
  bot.aiPowerEvalTimer=Math.max(0,(bot.aiPowerEvalTimer||0)-dt);
  if(bot.aiPowerEvalTimer<=0){
    bot.aiPowerEvalTimer=.18;
    const goal=objective.goalTest||targetGoal(objective.x,objective.z);
    const direct=findBotTacticalPath(bot,goal).seconds;
    let best=null,bestSaving=1/60;
    for(const pickup of Number.isFinite(direct)?state.powerups:[]){
      if(pickup.type==='dash'&&bot.carryingFlag)continue;
      const to=findBotTacticalPath(bot,targetGoal(pickup.x,pickup.z));
      if(!Number.isFinite(to.seconds))continue;
      const after=findBotTacticalPath({...bot,x:pickup.x,z:pickup.z,power:pickup.type,dash:0},goal);
      if(!Number.isFinite(after.seconds))continue;
      const dashSaving=pickup.type==='dash'&&Math.hypot(pickup.x-objective.x,pickup.z-objective.z)>2.2?
        dashTimeSavedOnRoute(after.path,bot.team,!!bot.carryingFlag):0;
      const saving=direct-(to.seconds+after.seconds-dashSaving);
      if(saving>bestSaving){bestSaving=saving;best=pickup;}
    }
    bot.aiPowerTarget=best;
    bot.aiPowerSaving=best?bestSaving:0;
  }
  const pickup=bot.aiPowerTarget;
  if(!pickup||!state.powerups.includes(pickup))return null;
  return {mode:`CLAIMING ${pickup.type.toUpperCase()}`,x:pickup.x,z:pickup.z,
    goalTest:targetGoal(pickup.x,pickup.z),estimatedSavingSeconds:bot.aiPowerSaving};
}

function tryBotBreakWall(bot,targetX,targetZ) {
  const c=actorCell(bot);
  const dirs=[
    {dx:0,dz:1},
    {dx:-1,dz:0},
    {dx:1,dz:0},
    {dx:0,dz:-1}
  ].filter(d=>{
    const nx=c.x+d.dx,nz=c.z+d.dz;
    return nx>=0&&nz>=0&&nx<GRID_W&&nz<GRID_L;
  });

  dirs.sort((a,b)=>{
    const da=Math.abs(c.x+a.dx-targetX)+Math.abs(c.z+a.dz-targetZ);
    const db=Math.abs(c.x+b.dx-targetX)+Math.abs(c.z+b.dz-targetZ);
    return da-db;
  });

  for (const d of dirs) {
    const e=edgeBetween(c.x,c.z,c.x+d.dx,c.z+d.dz);
    if (!e) continue;
    const k=wallKey(e.x,e.z,e.o);
    if (!wallBlocksTeam(state.walls.get(k),bot.team)) continue;

    faceDirection(bot,d.dx,d.dz);

    if ((bot.power==='smash'||bot.power==='jump') && usePower(bot)) {
      bot.aiPath.length=0;
      bot.aiPathTimer=0;
      return true;
    }

    bot.digTarget=e;
    bot.dig=0;
    bot.aiMode='BREAKING THROUGH';
    return true;
  }
  return false;
}

// A short-horizon estimate, not a rollout of the opponent's future decisions.
// No learning reward or build bonus: construction must improve interception margin.
function evaluateEscapeGate(bot,pursuer,objective) {
  const reject=(reason,detail={})=>({choose:false,reason,...detail});
  if(!TEAM_GATES||bot.carryingFlag!==otherTeam(bot.team))return reject('not-gate-carrier');
  if(bot.dash>0)return reject('run-with-dash');
  const goal=objective.goalTest||targetGoal(objective.x,objective.z);
  const route=findPath(actorCell(bot),goal,null,bot.team);
  if(route.length<2)return reject('at-objective');
  // Same front edge and direction the ordinary route follower would use.
  const dx=route[1].x+.5-bot.x,dz=route[1].z+.5-bot.z;
  const face=Math.abs(dx)>Math.abs(dz)?{fx:Math.sign(dx),fz:0}:{fx:0,fz:Math.sign(dz)};
  const candidate=facingEdge({...bot,...face});
  const issue=wallPlacementIssue(bot,candidate);
  if(issue)return reject('illegal:'+issue,{candidate});
  if(wallBlocksTeam({team:bot.team},bot.team))return reject('not-friendly-passable');
  if([...state.walls.values()].filter(w=>w.team===bot.team).length>=MAX_WALLS)return reject('replacement-value-unknown');
  const gap=Math.hypot(bot.x-pursuer.x,bot.z-pursuer.z);
  const pursuerSpeed=HUMAN_SPEED*(pursuer.carryingFlag?FLAG_CARRIER_SPEED_MULT:1)*(pursuer.dash>0||(!pursuer.carryingFlag&&pursuer.power==='dash')?1.72:1);
  // Open-ground closing is a conservative lower bound, ignoring obstacles.
  const shoveReady=pursuer.shoveActive>0?0:pursuer.shoveCooldown;
  const awayX=gap>1e-6?(bot.x-pursuer.x)/gap:0,awayZ=gap>1e-6?(bot.z-pursuer.z)/gap:0;
  const buildSpeed=MOVE_BUILD?HUMAN_SPEED*FLAG_CARRIER_SPEED_MULT*terrainAt(bot.x,bot.z).speed*BUILD_MOVE_MULT:0;
  const closingSpeed=pursuerSpeed-(face.fx*awayX+face.fz*awayZ)*buildSpeed;
  const earliestHit=Math.max(Math.max(0,gap-SHOVE_RANGE)/Math.max(.01,closingSpeed),shoveReady,bot.shoveProtection);
  if(earliestHit<=CARRIER_BUILD_TIME+1/60)return reject('shove-before-completion',{candidate,gap,earliestHit});
  const carrierRun=pathTravelTime(bot,goal)+Math.max(0,CAPTURE_CHANNEL_TIME-bot.captureProgress);
  const pursuerRun=pathTravelTime(pursuer,goal)/(pursuerSpeed/(HUMAN_SPEED*(pursuer.carryingFlag?FLAG_CARRIER_SPEED_MULT:1)));
  // Evaluate the next visible escape waypoint, rather than assuming a pursuer
  // already committed to a perfect interception at the distant capture pole.
  const pursuitGoal=targetGoal(route[1].x+.5,route[1].z+.5);
  const speedRatio=pursuerSpeed/(HUMAN_SPEED*(pursuer.carryingFlag?FLAG_CARRIER_SPEED_MULT:1));
  const pursuitBefore=pathTravelTime(pursuer,pursuitGoal)/speedRatio;
  const bypass=pathTravelTime(pursuer,pursuitGoal,wallKey(candidate.x,candidate.z,candidate.o))/speedRatio;
  // One gate can always be countered by the existing timed break. Instant Smash
  // or Jump gets the benefit of the doubt; don't spend build time against it.
  const counter=pursuer.power==='smash'||pursuer.power==='jump'?0:DIG_TIME;
  const pursuerDelay=Math.min(Math.max(0,bypass-pursuitBefore),counter);
  // Moving at 40% covers some of the route during the same build interval.
  const buildTimeLost=CARRIER_BUILD_TIME*(MOVE_BUILD?1-BUILD_MOVE_MULT:1);
  const netSeconds=pursuerDelay-buildTimeLost;
  const runMargin=pursuerRun-carrierRun,buildMargin=runMargin+netSeconds;
  const detail={candidate:{...candidate,...face},gap,earliestHit,carrierRun,pursuerRun,pursuitBefore,bypass,counter,pursuerDelay,buildTimeLost,netSeconds,runMargin,buildMargin};
  if(!Number.isFinite(carrierRun)||!Number.isFinite(pursuerRun)||!Number.isFinite(bypass))return reject('unresolved-route',detail);
  if(netSeconds<=1/60)return reject(counter===0?'instant-counter':'no-net-delay',detail);
  if(runMargin>0)return reject('running-already-safe',detail);
  if(buildMargin<=0)return reject('insufficient-escape-margin',detail);
  return {choose:true,reason:'improved-escape-margin',...detail};
}

function considerEscapeGate(bot,pursuer,objective,dt) {
  bot.aiGateEvalTimer=Math.max(0,(bot.aiGateEvalTimer||0)-dt);
  if(bot.aiGateEvalTimer>0||bot.aiBuildCooldown>0||bot.aiPostActionTimer>0)return false;
  bot.aiGateEvalTimer=.12; // Limit path searches to a small fraction of frames.
  const result=evaluateEscapeGate(bot,pursuer,objective),m=state.tacticalGateMetrics;
  m.considered[bot.team]++;
  if(result.choose){
    // beginBuild remains authoritative and locks/revalidates the grid edge.
    Object.assign(bot,{fx:result.candidate.fx,fz:result.candidate.fz});
    if(beginBuild(bot,result.candidate)){
      if(MOVE_BUILD)advanceBotBuild(bot,dt);
      m.chosen[bot.team]++;bot.aiMode='ESCAPING THROUGH GATE';
    }else{result.choose=false;result.reason='start-revalidation';}
  }
  if(!result.choose)m.rejected[result.reason]=(m.rejected[result.reason]||0)+1;
  // Bounded detail buffer; totals/reasons remain complete for long sessions.
  if(m.decisions.length<200)m.decisions.push({time:state.elapsed,team:bot.team,...result});
  return result.choose;
}

function updateBot(bot,human,dt) {
  bot.shoveCooldown=Math.max(0,bot.shoveCooldown-dt);
  bot.aiBuildCooldown=Math.max(0,bot.aiBuildCooldown-dt);
  bot.aiDecisionCooldown=Math.max(0,bot.aiDecisionCooldown-dt);
  bot.aiPostActionTimer=Math.max(0,bot.aiPostActionTimer-dt);
  if (bot.dash>0) bot.dash=Math.max(0,bot.dash-dt);

  const moved=Math.hypot(bot.x-bot.aiLastX,bot.z-bot.aiLastZ);
  if (bot.build<=0 && !bot.digTarget && moved<0.006) bot.aiStuckTimer+=dt;
  else bot.aiStuckTimer=0;
  bot.aiLastX=bot.x;
  bot.aiLastZ=bot.z;

  if (bot.aiStuckTimer>.32) {
    bot.aiPath.length=0;
    bot.aiPathTimer=0;
    bot.aiStuckTimer=0;
  }

  const wasBuilding=bot.build>0;
  advanceBotBuild(bot,dt);
  if (wasBuilding && bot.build<=0) {
    bot.aiPath.length=0;
    bot.aiPathTimer=0;
    bot.aiPostActionTimer=.18;
  }
  if (bot.build>0) {
    bot.aiMode='BLOCKING CARRIER';
    return;
  }

  if (bot.digTarget) {
    const k=wallKey(bot.digTarget.x,bot.digTarget.z,bot.digTarget.o);
    if (state.walls.has(k)) {
      bot.aiMode='BREAKING THROUGH';
      bot.dig+=dt;
      if (bot.dig+1e-9>=DIG_TIME) {
        removeWall(k,{actor:bot.team,reason:'dig'});
        bot.dig=0;
        bot.digTarget=null;
        bot.aiPath.length=0;
        bot.aiPathTimer=0;
      }
      return;
    }
    bot.dig=0;
    bot.digTarget=null;
    bot.aiPath.length=0;
    bot.aiPathTimer=0;
  }

  let objective=chooseBotObjective(bot,human);
  bot.aiMode=objective.mode;

  const dxHuman=human.x-bot.x;
  const dzHuman=human.z-bot.z;
  const dHuman=Math.hypot(dxHuman,dzHuman);

  if (dHuman<=SHOVE_RANGE && bot.shoveCooldown<=0) {
    faceDirection(bot,dxHuman,dzHuman);
    if (human.carryingFlag===bot.team || bot.carryingFlag===otherTeam(bot.team) || dHuman<0.55) {
      if (startShove(bot,human)) {
        bot.aiMode='SHOVING';
        bot.aiPath.length=0;
        bot.aiPathTimer=0;
        return;
      }
    }
  }

  if(TEAM_GATES && bot.carryingFlag===otherTeam(bot.team) && considerEscapeGate(bot,human,objective,dt))return;

  if (
    human.carryingFlag===bot.team &&
    bot.aiPostActionTimer<=0 &&
    bot.aiBuildCooldown<=0 &&
    dHuman<1.95
  ) {
    const wall=chooseCarrierBlockingWall(bot,human);
    if (wall) {
      bot.fx=wall.fx;
      bot.fz=wall.fz;
      if (beginBuild(bot,wall)) {
        if(MOVE_BUILD)advanceBotBuild(bot,dt);
        bot.aiMode='BLOCKING CARRIER';
        bot.aiBuildCooldown=1.25;
        return;
      }
    }
    bot.aiBuildCooldown=.28;
  }

  const pickupObjective=chooseContestedPower(bot,objective,dt);
  if(pickupObjective){objective=pickupObjective;bot.aiMode=objective.mode;}

  const objectiveDistance=Math.hypot(objective.x-bot.x,objective.z-bot.z);
  if (bot.power==='dash' && bot.aiDecisionCooldown<=0 && objectiveDistance>2.2) {
    if (usePower(bot)) bot.aiDecisionCooldown=.7;
  }

  bot.aiPathTimer-=dt;
  const movingTarget=objective.chase;
  if (bot.aiPathTimer<=0 || bot.aiPath.length<2 || movingTarget) {
    const goal=movingTarget?targetGoal(human.x,human.z):(objective.goalTest||targetGoal(objective.x,objective.z));
    const plan=findBotTacticalPath(bot,goal);
    bot.aiPath=plan.path;
    bot.aiInstantEdge=plan.instantEdge;
    bot.aiPathTimer=movingTarget?.035:.065;
  }

  if (!bot.aiPath.length) {
    if (tryBotBreakWall(bot,objective.x,objective.z)) return;
  }

  let tx=objective.x;
  let tz=objective.z;
  if (bot.aiPath.length>=2) {
    tx=bot.aiPath[1].x+.5;
    tz=bot.aiPath[1].z+.5;
  } else if (bot.aiPath.length===1) {
    tx=movingTarget?human.x:objective.x;
    tz=movingTarget?human.z:objective.z;
  }

  let dx=tx-bot.x;
  let dz=tz-bot.z;
  let m=Math.hypot(dx,dz);

  if (m<.03) {
    bot.aiPath.length=0;
    bot.aiPathTimer=0;
    pickupPower(bot);
    return;
  }

  const mx=dx/m;
  const mz=dz/m;
  faceDirection(bot,mx,mz);

  const c=actorCell(bot);
  const nx=clamp(Math.floor(tx),0,GRID_W-1);
  const nz=clamp(Math.floor(tz),0,GRID_L-1);

  if (Math.abs(nx-c.x)+Math.abs(nz-c.z)===1) {
    const e=edgeBetween(c.x,c.z,nx,nz);
    if (e && wallBlocksTeam(state.walls.get(wallKey(e.x,e.z,e.o)),bot.team) && nearWall(bot,e,.75)) {
      faceDirection(bot,nx-c.x,nz-c.z);

      if (bot.aiInstantEdge===wallKey(e.x,e.z,e.o) && usePower(bot)) {
        bot.aiPath.length=0;
        bot.aiPathTimer=0;
        return;
      }
      bot.digTarget=e;
      bot.dig=0;
      bot.aiMode='BREAKING THROUGH';
      return;
    }
  }

  const carrierMult=bot.carryingFlag ? FLAG_CARRIER_SPEED_MULT : 1;
  const speed=BOT_SPEED*carrierMult*(bot.dash>0?1.72:1);
  tryMove(bot,mx*speed*dt,mz*speed*dt);
  resolveActorAgainstWalls(bot);
  pickupPower(bot);
}

function endGame(text){
  if (spectatorMode) text=text.replace('YOU WIN!','RED WINS!').replace('BOT WINS!','BLUE WINS!');
  state.winner=text;
  state.running=false;
  centerBig.textContent=text;
  const row=team=>{
    const s=state.wallStats[team],observed=spectator?.wallMetrics?.[team]?.escapeObservations;
    return `<div><b>${team.toUpperCase()}</b> · built ${s.normalWallsBuilt} walls / ${s.teamGatesBuilt} gates · crossed ${s.friendlyGateCrossings} (${s.carrierGateCrossings} carrying) · banks after gate ${s.carrierBanksAfterGateCrossing} · enemy walls broken ${s.enemyWallsDestroyed} · wall-associated escapes observed ${observed??'n/a'}</div>`;
  };
  centerSmall.innerHTML=`Secure the enemy flag on your GOLD pole while your own flag is HOME.<div class="match-wall-stats"><b>WALL STRATEGY · spectator-only escape observations do not prove causation</b>${row('red')}${row('blue')}</div>`;
  centerCard.classList.add('show');
  audio.play('victory');
}

function shortestAngleDelta(from,to) {
  let d=(to-from+Math.PI)%(Math.PI*2)-Math.PI;
  if (d<-Math.PI) d+=Math.PI*2;
  return d;
}

function updateCamera(dt){
  // Read-only presentation angle for the requested V3 map screenshot.
  if(ARENA_ID==='wetlands-v3'&&new URLSearchParams(location.search).get('mapshot')==='1'){
    camera.position.set(0,20,0);camera.up.set(0,0,-1);camera.lookAt(0,0,0);
    return;
  }
  const p=localActor();
  const view=camera.userData;
  const heading=onlineMode?(online.team==='blue'?1:0)^(p.carryingFlag?1:0):p.carryingFlag?1:0;
  if(onlineMode&&!view.follow&&online.team==='blue'){
    view.yaw=Math.PI;view.heading=1;view.turnFrom=Math.PI;view.turnElapsed=CAMERA_TURN_TIME;
  }
  if (heading!==view.heading) {
    view.turnFrom=view.yaw;
    view.heading=heading;
    view.turnElapsed=0;
  }
  view.turnElapsed=Math.min(CAMERA_TURN_TIME,view.turnElapsed+dt);
  const progress=view.turnElapsed/CAMERA_TURN_TIME;
  const eased=progress*progress*(3-2*progress);
  const targetYaw=view.heading*Math.PI;
  view.yaw=view.turnFrom+(targetYaw-view.turnFrom)*eased;
  const yaw=view.yaw;
  const camDist=2.55;
  const lookDist=2.30;

  // Smooth translation independently: the 0.4s turn is not filtered a second time.
  const playerPos=new THREE.Vector3(wx(p.x),0,wz(p.z));
  view.follow ??= playerPos.clone();
  const t=1-Math.pow(0.0025,dt);
  view.follow.lerp(playerPos,t);
  camera.position.set(view.follow.x+Math.sin(yaw)*camDist,1.45,view.follow.z+Math.cos(yaw)*camDist);
  view.look ??= new THREE.Vector3();
  view.look.set(view.follow.x-Math.sin(yaw)*lookDist,0.50,view.follow.z-Math.cos(yaw)*lookDist);
  camera.lookAt(view.look);
}

function updateUI(){
  const p=state.player;
  const b=state.bot;

  const pCarry=p.carryingFlag?` · CARRYING ${p.carryingFlag.toUpperCase()} FLAG · SPEED ${Math.round(1000*FLAG_CARRIER_SPEED_MULT*terrainAt(p.x,p.z).speed)/10}%`:'';
  const bCarry=b.carryingFlag?` · CARRYING ${b.carryingFlag.toUpperCase()} FLAG · SPEED ${Math.round(1000*FLAG_CARRIER_SPEED_MULT*terrainAt(b.x,b.z).speed)/10}%`:'';

  playerHud.textContent=`${spectatorMode?'RED · '+p.aiMode:'YOU'} · ${p.power??'no power'} · WALLS ${state.wallOrder.red.length}/${MAX_WALLS}${p.dash>0?' · DASH':''}${pCarry}${terrainAt(p.x,p.z).kind==='water'?` · WATER ${Math.round(WATER_SPEED*1000)/10}%`:''}`;
  botHud.textContent=`${spectatorMode?'BLUE':'BOT'} · ${b.aiMode} · WALLS ${state.wallOrder.blue.length}/${MAX_WALLS}${b.power?` · ${b.power}`:''}${bCarry}${terrainAt(b.x,b.z).kind==='water'?` · WATER ${Math.round(WATER_SPEED*1000)/10}%`:''}`;
  timeHud.textContent=`${Math.floor(state.elapsed/60)}:${String(Math.floor(state.elapsed%60)).padStart(2,'0')}`;

  let action=0;
  let label=terrainAt(p.x,p.z).kind==='water'?'SHALLOW WATER · SPEED '+Math.round(1000*terrainAt(p.x,p.z).speed*(p.carryingFlag?FLAG_CARRIER_SPEED_MULT:1))/10+'%':'Ready';
  if (p.captureProgress>0) {
    action=p.captureProgress/CAPTURE_CHANNEL_TIME;
    label='SECURING FLAG... HOLD THE GOLD POLE';
  } else if (p.shoveActive>0) {
    action=1;
    label='SHOVE!';
  } else if (p.build>0) {
    action=1-p.build/Math.max(0.001,p.buildDuration||BUILD_TIME);
    label=`Building wall — ${p.carryingFlag?'carrier':'quick'} build ${p.buildDuration}s`;
  } else if (p.dig>0) {
    action=p.dig/DIG_TIME;
    label=`Breaking wall — ${DIG_TIME}s`;
  } else if (p.power==='dash' && p.carryingFlag) {
    label='DASH HELD · LOCKED WHILE CARRYING FLAG';
  } else if (p.power) {
    label=`Power ready: ${p.power.toUpperCase()} (H)`;
  }
  actionLabel.textContent=label;
  actionMeter.style.width=`${Math.round(action*100)}%`;

  const shoveReady=1-clamp(p.shoveCooldown/SHOVE_COOLDOWN,0,1);
  captureMeter.style.width=`${Math.round(shoveReady*100)}%`;

  const own=state.flags.red;
  const enemy=state.flags.blue;

  const enemyBankedHere=
    enemy.status==='banked' && enemy.bankedAt==='red';

  const ownText=
    own.status==='home'
      ? 'RED FLAG HOME'
      : (own.status==='dropped'
          ? 'RED FLAG DROPPED — TOUCH TO RETURN'
          : (own.status==='banked'
              ? 'RED FLAG SECURED AT BLUE BASE — RAID IT'
              : 'RED FLAG STOLEN'));

  const enemyText=
    p.carryingFlag==='blue'
      ? 'YOU HAVE BLUE FLAG'
      : (enemyBankedHere
          ? (own.status==='home'
              ? 'BLUE SECURED'
              : 'BLUE SECURED — RECOVER RED TO WIN')
          : (enemy.status==='home'
              ? 'BLUE FLAG HOME'
              : (enemy.status==='dropped'
                  ? 'BLUE FLAG DROPPED — TOUCH TO STEAL'
                  : 'BLUE FLAG STOLEN')));

  const fightText=state.combatMessageTimer>0?` · ${state.combatMessage}`:'';
  captureText.textContent=`SPACE attack: ${p.shoveCooldown<=0?'READY':`${Math.ceil(p.shoveCooldown*10)/10}s`} · ${ownText} · ${enemyText}${fightText}`;
}

function updatePowerVisuals(dt){
  for(const p of state.powerups){
    p.t+=dt;
    p.mesh.rotation.y+=dt*1.6;
    p.mesh.position.y=0.43+Math.sin(p.t*3.4)*0.07;
  }
}

function animateCharacters(dt){
  // Actual collision-resolved movement selects Run, including flag carrying.
  // No visual bob or animation root motion is added to the gameplay position.
  for(const [actor,visual] of [[state.player,playerCharacter],[state.bot,botCharacter]]){
    const key=actor.digTarget?wallKey(actor.digTarget.x,actor.digTarget.z,actor.digTarget.o):null;
    if(onlineMode&&actor.build>0)visual?.syncBuildAnimation(actor.build);
    visual?.syncWallSmashAnimation(key&&state.walls.has(key)?key:null,actor.dig,DIG_TIME);
    visual?.update(actor,dt,state.running);
  }
}

function resize(){
  const r=mount.getBoundingClientRect();
  renderer.setSize(r.width,r.height,false);
  camera.aspect=Math.max(.1,r.width/r.height);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize',resize);
resize();

function onlineNotice(message){
  if(message)online.noticeUntil=performance.now()+750;
  else if(performance.now()<online.noticeUntil)return;
  const element=document.querySelector('#online-message');
  if(element){element.textContent=message;element.hidden=!message;}
}
function updateOnlineWallCounts(){
  const element=document.querySelector('#online-counts');if(!element)return;
  const red=online.walls.filter(w=>w.team==='red').length,blue=online.walls.filter(w=>w.team==='blue').length;
  element.textContent=`RED ${red}/${MAX_WALLS} · BLUE ${blue}/${MAX_WALLS}`;
  element.dataset.wallIds=online.walls.map(w=>w.id).sort((a,b)=>a-b).join(',');
}
function returnToRoom(message){
  if(online.leaving)return;
  online.leaving=true;
  clearTimeout(online.reconnectTimer);
  onlineNotice(message);
  keys.clear();
  setTimeout(()=>location.assign('./?room='+encodeURIComponent(onlineRoom)),900);
}
function sendOnlineInput(){
  if(!onlineMode||!online.team||online.finished||online.socket?.readyState!==WebSocket.OPEN)return;
  online.socket.send(JSON.stringify({type:'input',seq:++online.seq,
    forward:Number(keys.has('KeyW'))-Number(keys.has('KeyS')),
    strafe:Number(keys.has('KeyD'))-Number(keys.has('KeyA')),
    build:keys.has('KeyF'),dig:keys.has('KeyG'),shove:keys.has('Space'),power:keys.has('KeyH')}));
}
function reconcileOnlinePowers(){
  const current=new Set(online.powerups.map(power=>power.id));
  for(let i=state.powerups.length-1;i>=0;i--){
    if(current.has(state.powerups[i].id))continue;
    disposePowerMesh(state.powerups[i].mesh);state.powerups.splice(i,1);
  }
  for(const power of online.powerups){
    if(state.powerups.some(existing=>existing.id===power.id))continue;
    const mesh=powerMesh(power.type);mesh.position.set(wx(power.x),.45,wz(power.z));world.add(mesh);
    state.powerups.push({...power,mesh,t:0});
  }
}
function updateOnlinePowerHud(){
  const power=online.players?.[online.team]?.power;
  const dash=online.players?.[online.team]?.dash||0;
  const label=document.querySelector('#online-power');
  if(label)label.textContent=power?`${power.toUpperCase()} READY · H`:dash>0?'DASH ACTIVE':'NO POWER · H TO USE';
}
function showOnlinePowerEffect(type,position){
  if(!position)return;
  const color=type==='jump'?0x63e68e:type==='dash'?0xffdb4d:0xff8a45;
  const mesh=new THREE.Mesh(new THREE.TorusGeometry(.28,.035,6,20),
    new THREE.MeshBasicMaterial({color,transparent:true,opacity:.8,depthWrite:false}));
  mesh.rotation.x=Math.PI/2;mesh.position.set(wx(position.x),.08,wz(position.z));world.add(mesh);
  online.effects.push({mesh,age:0});
}
function updateOnlinePowerEffects(dt){
  for(let i=online.effects.length-1;i>=0;i--){
    const effect=online.effects[i];effect.age+=dt;
    effect.mesh.scale.setScalar(1+effect.age*2.6);
    effect.mesh.material.opacity=Math.max(0,.8*(1-effect.age/.35));
    if(effect.age>=.35){world.remove(effect.mesh);effect.mesh.geometry.dispose();effect.mesh.material.dispose();online.effects.splice(i,1);}
  }
}
function installOnlineWall(record,animated=false){
  const key=wallKey(record.x,record.z,record.o),previous=state.walls.get(key);
  if(previous?.id===record.id){previous.open=!!record.open;return;}
  if(previous)removeWall(key,{reason:'wall-limit'});
  const mesh=createWallMesh(record,record.team,false);
  mesh.userData.wallId=record.id;
  const wall={...record,open:!!record.open,mesh};
  state.walls.set(key,wall);state.wallOrder[record.team].push(key);
  if(animated){
    if(mesh.userData?.gateVisual)mesh.userData.gateVisual.built();
    else wallEffects?.built(mesh,record.team);
    audio.play('buildSuccess');
  }
}
function reconcileOnlineWalls(){
  if(!charactersReady)return;
  const current=new Set();
  for(const wall of online.walls){current.add(wall.id);installOnlineWall(wall);}
  for(const [key,wall] of [...state.walls])if(!current.has(wall.id))removeWall(key,{reason:'sync'});
}
function receiveOnlineEvent(message){
  if(message.code!==onlineRoom||message.eventId<=online.lastEventId)return;
  online.lastEventId=message.eventId;
  if(!charactersReady)return;
  const actor=message.team==='blue'?state.bot:state.player;
  const visual=message.team==='blue'?botCharacter:playerCharacter;
  if(message.type==='buildStarted'){
    actor.buildDuration=message.duration;actor.build=message.duration;actor.buildTarget=message.edge;
    visual?.startBuildAnimation(message.duration);audio.play('buildStart');return;
  }
  if(message.type==='buildCanceled'){
    actor.build=0;actor.buildTarget=null;visual?.cancelBuildAnimation();
    buildFeedback[message.team].hide();buildFeedback[message.team].flash(message.edge,message.team,'cancel');
    audio.play('buildCancel');return;
  }
  if(message.type==='wallBuilt'){
    const wall=message.wall,builder=wall.team==='blue'?state.bot:state.player;
    online.walls=online.walls.filter(w=>wallKey(w.x,w.z,w.o)!==wallKey(wall.x,wall.z,wall.o));online.walls.push(wall);
    updateOnlineWallCounts();
    builder.build=0;builder.buildTarget=null;
    (wall.team==='blue'?botCharacter:playerCharacter)?.finishBuildAnimation(true);
    buildFeedback[wall.team].hide();buildFeedback[wall.team].flash(wall,wall.team,'success');
    installOnlineWall(wall,true);if(wall.team===online.team)humanPlacementPreview?.built(wall);return;
  }
  if(message.type==='digStarted'){actor.dig=0.000001;actor.digTarget=message.edge;return;}
  if(message.type==='digCanceled'){actor.dig=0;actor.digTarget=null;return;}
  if(message.type==='wallRemoved'){
    const wall=message.wall,key=wallKey(wall.x,wall.z,wall.o);
    online.walls=online.walls.filter(w=>w.id!==wall.id);
    updateOnlineWallCounts();
    if(state.walls.get(key)?.id===wall.id)removeWall(key,{reason:message.reason,actor:message.actor});
    if(message.reason==='dig'&&message.actor){const breaker=message.actor==='blue'?state.bot:state.player;breaker.dig=0;breaker.digTarget=null;}
    return;
  }
  if(message.type==='gateCrossed'){
    for(const wall of state.walls.values())if(wall.id===message.wallId){wall.mesh.userData?.gateVisual?.crossed();break;}
    return;
  }
  if(message.type==='shoveStarted'){
    actor.shoveCooldown=SHOVE_COOLDOWN;actor.shoveActive=SHOVE_ACTIVE_TIME;
    visual?.startCombatAnimation('Shove');audio.play('shove');return;
  }
  if(message.type==='shoveHit'){
    const attacker=message.attacker==='blue'?botCharacter:playerCharacter;
    const victim=message.victim==='blue'?botCharacter:playerCharacter;
    attacker?.confirmShoveImpact();victim?.startCombatAnimation('ShoveHit');
    audio.play('shoveImpact');onlineNotice(message.victim.toUpperCase()+' SHOVED');return;
  }
  if(message.type==='shoveClash'){
    playerCharacter?.confirmShoveImpact();botCharacter?.confirmShoveImpact();
    audio.play('shoveImpact');onlineNotice('CLASH!');return;
  }
  if(message.type==='powerSpawned'){
    online.powerups.push(message.power);reconcileOnlinePowers();return;
  }
  if(message.type==='powerCollected'){
    online.powerups=online.powerups.filter(power=>power.id!==message.power.id);
    reconcileOnlinePowers();audio.play('powerPickup');onlineNotice(message.team.toUpperCase()+' GOT '+message.power.type.toUpperCase());return;
  }
  if(message.type==='powerActivated'){
    audio.play('powerActivate');onlineNotice(message.team.toUpperCase()+' USED '+message.power.toUpperCase());
    if(message.power==='jump'){
      const samples=online.samples[message.team];samples.length=0;
      online.jumpAge[message.team]=0;
      showOnlinePowerEffect('jump',message.landing);
    }
    return;
  }
  if(['flagPickedUp','flagDropped','flagReturned','flagBanked'].includes(message.type)){
    const words={flagPickedUp:`${message.by.toUpperCase()} STOLE ${message.team.toUpperCase()}`,
      flagDropped:`${message.team.toUpperCase()} FLAG DROPPED`,flagReturned:`${message.team.toUpperCase()} FLAG HOME`,
      flagBanked:`${message.by.toUpperCase()} BANKED ${message.team.toUpperCase()}`};
    onlineNotice(words[message.type]);
    audio.play({flagPickedUp:'flagPickup',flagDropped:'flagDrop',flagReturned:'flagReturn',flagBanked:'flagCapture'}[message.type]);
    return;
  }
}
function showOnlineWinner(winner){
  if(online.finished)return;
  online.finished=true;
  keys.clear();
  const panel=document.querySelector('#online-victory');
  if(panel){panel.hidden=false;panel.querySelector('strong').textContent=winner.toUpperCase()+' WINS!';}
  const message=document.querySelector('#online-message');if(message)message.hidden=true;
  audio.play('victory');
}
function syncOnlineFlags(){
  if(!online.flags)return;
  const describe=flag=>flag.status==='carried'?`${flag.team.toUpperCase()}: ${flag.carrier?.toUpperCase()} CARRYING`:
    flag.status==='banked'?`${flag.team.toUpperCase()}: BANKED BY ${flag.bankedAt?.toUpperCase()}`:
    `${flag.team.toUpperCase()}: ${flag.status.toUpperCase()}`;
  for(const team of ['red','blue']){
    const source=online.flags[team];if(!source)continue;
    Object.assign(state.flags[team],source,{carrier:source.carrier?(source.carrier==='red'?state.player:state.bot):null});
  }
  const label=document.querySelector('#online-flags');
  if(label)label.textContent=describe(online.flags.red)+' · '+describe(online.flags.blue);
}
function receiveOnlineSnapshot(message){
  if(message.code!==onlineRoom||!['playing','finished'].includes(message.phase))return;
  online.latestTick=message.tick;
  online.walls=message.walls||[];online.powerups=message.powerups||[];online.players=message.players;online.flags=message.flags||null;
  syncOnlineFlags();
  reconcileOnlinePowers();updateOnlinePowerHud();
  updateOnlineWallCounts();
  const now=performance.now();
  for(const side of ['red','blue']){
    const player=message.players?.[side];
    if(!player)continue;
    const samples=online.samples[side];
    if(samples.length&&Math.hypot(player.x-samples.at(-1).x,player.z-samples.at(-1).z)>1)samples.length=0;
    samples.push({at:now,x:player.x,z:player.z,fx:player.fx,fz:player.fz});
    if(samples.length>8)samples.shift();
  }
  if(message.winner)showOnlineWinner(message.winner);
  if(charactersReady&&!online.finished)onlineNotice('');
}
function renderOnlinePositions(){
  reconcileOnlineWalls();
  reconcileOnlinePowers();
  const at=performance.now()-95;
  for(const [side,actor] of [['red',state.player],['blue',state.bot]]){
    const samples=online.samples[side];
    if(!samples.length)continue;
    let previous=samples[0],next=samples.at(-1);
    for(let i=1;i<samples.length;i++)if(samples[i].at>=at){previous=samples[i-1];next=samples[i];break;}
    if(at>=samples.at(-1).at)previous=next=samples.at(-1);
    const t=previous===next?0:Math.max(0,Math.min(1,(at-previous.at)/(next.at-previous.at)));
    actor.x=previous.x+(next.x-previous.x)*t;
    actor.z=previous.z+(next.z-previous.z)*t;
    actor.fx=next.fx;actor.fz=next.fz;
    const source=online.players?.[side];
    if(source){actor.build=source.build||0;actor.buildDuration=source.buildDuration||BUILD_TIME;
      actor.buildTarget=source.buildTarget||null;actor.dig=source.dig||0;actor.digTarget=source.digTarget||null;}
    if(source){actor.shoveCooldown=source.shoveCooldown||0;actor.shoveProtection=source.shoveProtection||0;actor.shoveActive=source.shoveActive||0;
      actor.carryingFlag=source.carryingFlag||null;actor.captureProgress=source.captureProgress||0;actor.power=source.power||null;actor.dash=source.dash||0;}
  }
  syncOnlineFlags();
  state.elapsed=online.latestTick/30;
}
function connectOnline(){
  if(!onlineMode)return;
  if(!/^[A-HJ-NP-Z2-9]{6}$/.test(onlineRoom)){returnToRoom('Invalid room code');return;}
  const token=sessionStorage.getItem('wall-rush-room-'+onlineRoom);
  if(!token){returnToRoom('Room session missing');return;}
  document.querySelector('#online-room').textContent='ROOM '+onlineRoom;
  document.querySelector('#online-rules').textContent=TEAM_GATES?'TEAM GATES'+(MOVE_BUILD?' · MOVE-BUILD':''):'NORMAL WALLS';
  const socket=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws');
  online.socket=socket;
  socket.addEventListener('open',()=>socket.send(JSON.stringify({type:'join',code:onlineRoom,token})));
  socket.addEventListener('message',event=>{
    let message;try{message=JSON.parse(event.data);}catch{return;}
    if(message.type==='joined'){
      if(!['playing','finished'].includes(message.phase)){returnToRoom('Match paused · returning to room');return;}
      if((message.rules==='gates')!==TEAM_GATES||!!message.buildMove!==MOVE_BUILD){returnToRoom('Room rules changed · returning to room');return;}
      online.reconnecting=false;online.reconnectStarted=0;clearTimeout(online.reconnectTimer);
      online.team=message.team;
      document.querySelector('#online-role').textContent=message.team.toUpperCase()+' PLAYER';
      camera.userData.follow=null;
      camera.userData.look=null;
      camera.userData.yaw=message.team==='blue'?Math.PI:0;
      camera.userData.heading=message.team==='blue'?1:0;
      camera.userData.turnFrom=camera.userData.yaw;
      camera.userData.turnElapsed=CAMERA_TURN_TIME;
      state.running=true;
      return;
    }
    if(message.type==='snapshot'){receiveOnlineSnapshot(message);return;}
    if(message.type==='matchComplete'){if(message.code===onlineRoom)showOnlineWinner(message.winner);return;}
    if(['buildStarted','buildCanceled','wallBuilt','wallRemoved','digStarted','digCanceled','gateCrossed','shoveStarted','shoveHit','shoveClash',
      'powerSpawned','powerCollected','powerActivated',
      'flagPickedUp','flagDropped','flagReturned','flagBanked'].includes(message.type)){receiveOnlineEvent(message);return;}
    if(message.type==='disconnected'||message.type==='lobby'&&message.phase==='interrupted'){
      returnToRoom('Opponent disconnected · returning to room');return;
    }
    if(message.type==='error'){
      console.warn('Wall Rush room protocol:',message.reason);
      if(message.reason==='invalid_input'){onlineNotice('Movement input rejected by server');return;}
      returnToRoom('Room error: '+message.reason+' · returning to lobby');
    }
  });
  socket.addEventListener('close',()=>{
    if(online.socket!==socket||online.leaving||online.finished)return;
    keys.clear();online.reconnecting=true;
    online.reconnectStarted ||= performance.now();
    const waiting=performance.now()-online.reconnectStarted>2600;
    onlineNotice(waiting?'Connection lost · retrying…':'Reconnecting…');
    clearTimeout(online.reconnectTimer);
    online.reconnectTimer=setTimeout(connectOnline,waiting?1200:400);
  });
  online.inputTimer ||= setInterval(sendOnlineInput,100);
}

function stepGame(dt){
  state.elapsed+=dt;
  const before={red:{x:state.player.x,z:state.player.z},blue:{x:state.bot.x,z:state.bot.z}};
  if (spectatorMode) {
    const actors=spectator?.blueFirst?[state.bot,state.player]:[state.player,state.bot];
    for(const actor of actors) updateBot(actor,actor===state.player?state.bot:state.player,dt);
  } else {
    updateHuman(state.player,dt);
    updateBot(state.bot,state.player,dt);
  }
  for(const actor of [state.player,state.bot]){
    const from=before[actor.team];
    audio.step?.(actor.team,terrainAt(actor.x,actor.z).kind,Math.hypot(actor.x-from.x,actor.z-from.z));
  }
  resolveShoveCombat(dt);
  updateFlagRules(dt);
  state.combatMessageTimer=Math.max(0,state.combatMessageTimer-dt);
  state.nextPower-=dt;
  if(state.nextPower<=0){
    spawnPower();
    state.nextPower=POWER_RESPAWN_MIN+gameRandom()*(POWER_RESPAWN_MAX-POWER_RESPAWN_MIN);
  }
}

function tick(){
  requestAnimationFrame(tick);
  const dt=Math.min(0.033,clock.getDelta());

  if(onlineMode){
    if(charactersReady&&online.team)renderOnlinePositions();
  } else if (spectatorMode) {
    spectator?.tick(dt);
  } else if(charactersReady && !state.winner){
    if(state.countdown>0){
      state.countdown-=dt;
      const n=Math.ceil(state.countdown);
      centerBig.textContent=state.countdown>.1?String(Math.max(1,n)):'GO!';
      centerSmall.textContent='Steal the enemy flag, bring it home, and protect your own. SPACE shoves a carrier and drops the flag.';
      centerCard.classList.add('show');
      if(state.countdown<=0){ state.running=true; centerCard.classList.remove('show'); }
    } else if(state.running){
      stepGame(dt);
    }
  }

  const visualDt=spectatorMode&&!onlineMode?(spectator?.visualDt??0):dt;
  updatePowerVisuals(visualDt);
  if(onlineMode)updateOnlinePowerEffects(visualDt);
  updateMeshes();
  if(onlineMode)for(const [team,mesh] of [['red',playerMesh],['blue',botMesh]]){
    online.jumpAge[team]+=visualDt;
    if(online.jumpAge[team]<.28)mesh.position.y+=Math.sin(Math.PI*online.jumpAge[team]/.28)*.22;
  }
  if(onlineMode){
    humanPlacementPreview.update();
    const ghost=humanPlacementPreview.mesh;
    buildFeedback[online.team||'red'].setInvalid(ghost?.visible&&ghost.userData?.invalidReason&&localActor().build<=0?ghost.userData.logicalEdge:null);
    for(const actor of [state.player,state.bot]){if(actor.build>0&&actor.buildTarget)buildFeedback[actor.team].progress(actor);else buildFeedback[actor.team].hide();}
    buildFeedback.red.update(visualDt);buildFeedback.blue.update(visualDt);
  }else{
    humanPlacementPreview.update();
    const ghost=humanPlacementPreview.mesh;
    buildFeedback.red.setInvalid(ghost?.visible&&ghost.userData?.invalidReason&&state.player.build<=0?ghost.userData.logicalEdge:null);
    if(state.player.build<=0)buildFeedback.red.hide();
    if(state.bot.build<=0)buildFeedback.blue.hide();
    buildFeedback.red.update(visualDt);buildFeedback.blue.update(visualDt);
  }
  updateCamera(dt);
  updateObjectiveOcclusion(dt);
  if(!onlineMode)updateUI();
  animateCharacters(visualDt);
  wallEffects?.update(visualDt);
  waterEffects.update(visualDt,[state.player,state.bot]);
  updateGateVisuals(visualDt);
  justPressed.clear();
  renderer.render(scene,camera);
}

resetGame();
connectOnline();
centerBig.textContent='Loading champions';
centerSmall.textContent='Loading Red Champion and its animations…';
restart.disabled=true;
const characterReady = Promise.all([loadChampion(),gateSystem?.ready]).then(([asset])=>{
  playerCharacter=createChampion(asset,'red');
  botCharacter=createChampion(asset,'blue');
  playerMesh.add(playerCharacter.root);
  botMesh.add(botCharacter.root);
  charactersReady=true;
  restart.disabled=false;
  resetGame();
  if(onlineMode){state.running=true;if(online.samples.red.length&&online.samples.blue.length)onlineNotice('');}
  if (spectatorMode) spectator=createSpectator({state,resetGame,stepGame,endGame,
    actorCell,pathLength,pathTravelTime,targetGoal,chooseBotObjective,wallKey,updateMeshes,animateCharacters,
    arena:ARENA_ID,rulesMode:TEAM_GATES?'gates':'normal',pickupMode:CONTESTED_POWERS?'contested':'standard',
    rules:{speed:HUMAN_SPEED,waterSpeed:WATER_SPEED,carrierSpeed:FLAG_CARRIER_SPEED_MULT,build:BUILD_TIME,carrierBuild:CARRIER_BUILD_TIME,buildMove:MOVE_BUILD?BUILD_MOVE_MULT:0,
      destruction:DIG_TIME,shoveCooldown:SHOVE_COOLDOWN,shoveProtection:SHOVE_PROTECTION_TIME,maxWalls:MAX_WALLS}});
}).catch(error=>{
  centerBig.textContent='Character could not load';
  centerSmall.textContent=error.message+' Start the local server and reload.';
  centerCard.classList.add('show');
  console.error(error);
  throw error;
});
tick();

// Explicit module exports support the local regression page; no production cheats/UI.
export { characterReady, state, playerCharacter, botCharacter, playerMesh, botMesh,
  scene, camera, renderer, keys, justPressed, resetGame, updateHuman, updateBot,
  updateMeshes, animateCharacters, updateCamera, updateUI, updateFlagRules, resolveShoveCombat,
  beginBuild, updateBuild, addWall, removeWall, tryMove, usePower, startShove,
  pickUpFlag, dropCarriedFlag, resolveFlagTouches, checkFlagBank, bankCarriedFlag,
  flagHomePosition, capturePolePosition, facingRotation, checkBankedVictory,
  spectator, spectatorMode, stepGame, chooseBotObjective, chooseCarrierBlockingWall,
  flagTossLanding, canTouchFlag, chooseLearnedApproach,
  arenaGrid, humanPlacementPreview, wallPlacementIssue, wallTransform, createWallMesh,
  gateSystem, buildFeedback, audio, TEAM_GATES, MOVE_BUILD, wallBlocksTeam, updateGateVisuals, ARENA_ID, WATER_SPEED, terrainAt, terrainEdgeAllowed, findPath, pathLength, pathTravelTime, actorCell, targetGoal, botTargetBuildable, facingEdge, arenaRoutesOpen };
export { objectiveOccluders, updateObjectiveOcclusion, flagMeshes, bankedFlagMarkers };


