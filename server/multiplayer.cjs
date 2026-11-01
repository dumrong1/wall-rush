const crypto=require('node:crypto');
const {WebSocketServer,WebSocket}=require('ws');
const {ARENA_WIDTH,ARENA_LENGTH,WATER_SPEED,terrainAt}=require('../src/terrain.js');
const {WALK_SPEED,PLAYER_RADIUS,terrainBodyBlocked,moveActorOnTerrain}=require('../src/movement.js');
const {MAX_WALLS,BUILD_TIME,CARRIER_BUILD_TIME,DIG_TIME,BUILD_MOVE_MULT,
  wallKey,facingEdge,wallDistanceToActor,wallBlocksTeam,collidesWithWall,nearWall,wallPlacementIssue}=require('../src/wall-rules.js');
const {SHOVE_COOLDOWN,SHOVE_PROTECTION_TIME,SHOVE_RANGE,SHOVE_ACTIVE_TIME,SHOVE_CLASH_FORCE,SHOVE_FORCE,
  shovePathClear,shoveCanHit,pushShoveActor}=require('../src/shove-rules.js');
const {FLAG_CARRIER_SPEED_MULT,createFlag,dropCarriedFlag,advanceFlagTimers,flagTouch,checkFlagBank,flagWinner}=require('../src/flag-rules.js');
const {POWER_RESPAWN_MIN,POWER_RESPAWN_MAX,powerSpots,spawnPowerRecord,collectPower,activatePower}=require('../src/power-rules.js');

const CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_IDLE_MS=10*60*1000;
const MAX_ROOMS=200,MAX_CONNECTIONS=500,MAX_MESSAGES_PER_SECOND=80;
const TICK_MS=1000/30;
const FIELD={width:ARENA_WIDTH,length:ARENA_LENGTH,radius:PLAYER_RADIUS,speed:WALK_SPEED,waterSpeed:WATER_SPEED};
function code(){let value='';for(let i=0;i<6;i++)value+=CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];return value;}
function token(){return crypto.randomBytes(20).toString('hex');}
function send(ws,message){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(message));}
function publicPlayer(player){return player?{connected:!!player.ws,ready:player.ready,x:player.x,z:player.z,fx:player.fx,fz:player.fz,terrain:terrainAt(player.x,player.z).kind,carryingFlag:player.carryingFlag,
  power:player.power,dash:player.dash,
  build:player.build,buildDuration:player.buildDuration,buildTarget:player.buildTarget,dig:player.dig,digTarget:player.digTarget,
  shoveCooldown:player.shoveCooldown,shoveProtection:player.shoveProtection,shoveActive:player.shoveActive,
  captureProgress:player.captureProgress}:null;}
function publicWall(wall){return {id:wall.id,team:wall.team,x:wall.x,z:wall.z,o:wall.o,open:wall.open};}
function publicFlag(flag){return {team:flag.team,status:flag.status,x:flag.x,z:flag.z,
  carrier:flag.carrier?.team||null,bankedAt:flag.bankedAt,tossFrom:flag.tossFrom,tossRemaining:flag.tossRemaining,
  dropInteractDelay:flag.dropInteractDelay,dropLockTimer:flag.dropLockTimer,dropLockActor:flag.dropLockActor?.team||null};}
function publicPower(power){return {id:power.id,type:power.type,x:power.x,z:power.z};}
function publicRoom(room){return {type:'lobby',code:room.code,phase:room.phase,rules:room.rules,buildMove:room.buildMove,players:{red:publicPlayer(room.players.red),blue:publicPlayer(room.players.blue)}};}

function createMultiplayerServer(httpServer,{tickMs=TICK_MS,autoTick=true,random=Math.random}={}){
  const rooms=new Map();
  const wss=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
  function broadcast(room,message){const body=JSON.stringify(message);for(const player of Object.values(room.players))if(player?.ws?.readyState===WebSocket.OPEN)player.ws.send(body);}
  function lobby(room){broadcast(room,publicRoom(room));}
  function snapshot(room){broadcast(room,{type:'snapshot',code:room.code,phase:room.phase,tick:room.tick,serverTime:Date.now(),rules:room.rules,buildMove:room.buildMove,
    players:{red:publicPlayer(room.players.red),blue:publicPlayer(room.players.blue)},walls:[...room.walls.values()].map(publicWall),
    flags:{red:publicFlag(room.flags.red),blue:publicFlag(room.flags.blue)},powerups:room.powerups.map(publicPower),winner:room.winner});}
  function newPlayer(team,ws){return {team,ws,token:token(),ready:false,x:FIELD.width/2,z:team==='red'?FIELD.length-.58:.58,fx:0,fz:team==='red'?-1:1,
    input:{forward:0,strafe:0,build:false,dig:false,shove:false},lastInputAt:0,lastSeq:-1,disconnectTimer:null,
    build:0,buildDuration:BUILD_TIME,buildTarget:null,buildLatch:false,dig:0,digTarget:null,
    shoveCooldown:0,shoveProtection:0,shoveActive:0,shoveRequested:false,movedX:0,movedZ:0,
    carryingFlag:null,captureProgress:0,moveReference:null,power:null,dash:0,powerRequested:false};}
  function joinMessage(room,player){send(player.ws,{type:'joined',code:room.code,team:player.team,token:player.token,phase:room.phase,rules:room.rules,buildMove:room.buildMove});lobby(room);if(['playing','interrupted','finished'].includes(room.phase))snapshot(room);}
  function event(room,type,detail){broadcast(room,{type,code:room.code,eventId:++room.eventId,...detail});}
  function cancelBuild(room,player,reason='released'){
    if(player.build<=0)return;
    const edge=player.buildTarget;player.build=0;player.buildTarget=null;
    event(room,'buildCanceled',{team:player.team,edge,reason});
  }
  function cancelDig(room,player,reason='released'){
    if(player.dig<=0)return;
    const edge=player.digTarget;player.dig=0;player.digTarget=null;
    event(room,'digCanceled',{team:player.team,edge,reason});
  }
  function blockedForShove(room,x,z,team=null){
    return terrainBodyBlocked(x,z)||collidesWithWall(x,z,team,room.walls,room.rules==='gates');
  }
  function startShove(room,attacker,target){
    if(!attacker.ws||!target.ws||attacker.shoveCooldown>0||attacker.shoveActive>0||target.shoveProtection>0||attacker.build>0||attacker.dig>0)return;
    const dx=target.x-attacker.x,dz=target.z-attacker.z,d=Math.hypot(dx,dz);
    if(d<=SHOVE_RANGE&&!shovePathClear(attacker,target,(x,z)=>blockedForShove(room,x,z)))return;
    if(d<=1.2&&d>.0001){attacker.fx=dx/d;attacker.fz=dz/d;}
    attacker.shoveCooldown=SHOVE_COOLDOWN;attacker.shoveActive=SHOVE_ACTIVE_TIME;
    event(room,'shoveStarted',{team:attacker.team});
  }
  function resolveShoves(room,dt){
    const red=room.players.red,blue=room.players.blue;
    const blocked=(x,z)=>blockedForShove(room,x,z);
    const collision=(x,z,team)=>blockedForShove(room,x,z,team);
    const interrupt=actor=>{cancelBuild(room,actor,'shove');cancelDig(room,actor,'shove');};
    for(const actor of [red,blue])actor.shoveProtection=Math.max(0,actor.shoveProtection-dt);
    if(!red.ws||!blue.ws){red.shoveActive=blue.shoveActive=0;return;}
    const redHit=shoveCanHit(red,blue,blocked),blueHit=shoveCanHit(blue,red,blocked);
    if(redHit&&blueHit){
      const dx=blue.x-red.x,dz=blue.z-red.z,d=Math.hypot(dx,dz);
      const axis=d>.0001?{x:dx/d,z:dz/d}:{x:red.fx,z:red.fz};
      pushShoveActor(red,blue,SHOVE_CLASH_FORCE,collision,interrupt,axis);
      pushShoveActor(blue,red,SHOVE_CLASH_FORCE,collision,interrupt,{x:-axis.x,z:-axis.z});
      red.shoveProtection=blue.shoveProtection=SHOVE_PROTECTION_TIME;
      red.shoveActive=blue.shoveActive=0;
      event(room,'shoveClash',{red:{x:red.x,z:red.z},blue:{x:blue.x,z:blue.z}});
    }else if(redHit||blueHit){
      const attacker=redHit?red:blue,victim=redHit?blue:red;
      pushShoveActor(attacker,victim,SHOVE_FORCE,collision,interrupt);
      victim.shoveProtection=SHOVE_PROTECTION_TIME;attacker.shoveActive=0;
      event(room,'shoveHit',{attacker:attacker.team,victim:victim.team,
        red:{x:red.x,z:red.z},blue:{x:blue.x,z:blue.z}});
      if(victim.carryingFlag){
        const dropped=dropCarriedFlag(room.flags,victim,random,blocked);
        event(room,'flagDropped',{team:dropped.flag.team,by:victim.team,flag:publicFlag(dropped.flag)});
      }
    }
    red.shoveActive=Math.max(0,red.shoveActive-dt);
    blue.shoveActive=Math.max(0,blue.shoveActive-dt);
  }
  function advanceFlags(room,actors,dt){
    advanceFlagTimers(room.flags,dt);
    const blocked=(x,z)=>blockedForShove(room,x,z);
    for(const actor of actors){
      if(!actor?.ws)continue;
      const result=flagTouch(room.flags,actor,blocked);
      if(result)event(room,result.type,{team:result.team,by:result.by,flag:publicFlag(room.flags[result.team])});
    }
    for(const actor of actors){
      if(!actor?.ws)continue;
      const result=checkFlagBank(room.flags,actor,dt);
      if(result)event(room,result.type,{team:result.team,by:result.by,flag:publicFlag(room.flags[result.team])});
    }
    const winner=flagWinner(room.flags);
    if(winner)completeMatch(room.code,winner);
  }
  function advancePowers(room,actors,dt){
    room.nextPower-=dt;
    if(room.nextPower<=0){
      const record=spawnPowerRecord(room.powerups,powerSpots(),random);
      if(record){record.id=++room.nextPowerId;room.powerups.push(record);event(room,'powerSpawned',{power:publicPower(record)});}
      room.nextPower=POWER_RESPAWN_MIN+random()*(POWER_RESPAWN_MAX-POWER_RESPAWN_MIN);
    }
    // The alternating actor order also resolves same-tick pickup ties.
    for(const actor of actors){
      if(!actor?.ws)continue;
      const pickup=collectPower(actor,room.powerups);
      if(pickup)event(room,'powerCollected',{team:actor.team,power:publicPower(pickup)});
    }
  }
  function useServerPower(room,player){
    const blocked=(x,z,team)=>terrainBodyBlocked(x,z)||collidesWithWall(x,z,team,room.walls,room.rules==='gates');
    const result=activatePower(player,{walls:room.walls,blocked,
      removeWall:key=>removeWall(room,key,'smash',player.team)});
    if(!result)return;
    event(room,'powerActivated',{team:player.team,power:result.type,duration:result.duration||0,
      landing:result.landing||null});
  }
  function crossingApproach(wall,player){
    if(!player?.ws)return false;
    const normal=wall.o==='h'?player.z-wall.z:player.x-wall.x;
    const motion=wall.o==='h'?player.movedZ:player.movedX;
    const along=wall.o==='h'?player.x-wall.x:player.z-wall.z;
    // Motion toward the edge, with the projected crossing inside the segment.
    return Math.abs(normal)<.82&&Math.abs(normal)>.025&&normal*motion<-.00012&&
      Math.abs(motion)>.0008&&along>=-.12&&along<=1.12;
  }
  function inDoorway(wall,player){
    if(!player?.ws)return false;
    const normal=wall.o==='h'?player.z-wall.z:player.x-wall.x;
    const along=wall.o==='h'?player.x-wall.x:player.z-wall.z;
    return Math.abs(normal)<=PLAYER_RADIUS+.12&&along>=-PLAYER_RADIUS&&along<=1+PLAYER_RADIUS;
  }
  function placementIssue(room,player,edge){
    const opponent=room.players[player.team==='red'?'blue':'red'];
    return wallPlacementIssue(player,edge,opponent,room.walls);
  }
  function removeWall(room,key,reason='dig',actor=null){
    const wall=room.walls.get(key);if(!wall)return false;
    room.walls.delete(key);
    const order=room.wallOrder[wall.team],index=order.indexOf(key);if(index>=0)order.splice(index,1);
    event(room,'wallRemoved',{wall:publicWall(wall),reason,actor});
    return true;
  }
  function completeBuild(room,player){
    const edge=player.buildTarget;player.build=0;player.buildTarget=null;
    const issue=placementIssue(room,player,edge);
    if(issue){event(room,'buildCanceled',{team:player.team,edge,reason:issue});return;}
    const wall={...edge,team:player.team,id:++room.nextWallId,open:false,clearTime:0,createdTick:room.tick};
    const key=wallKey(edge);room.walls.set(key,wall);room.wallOrder[player.team].push(key);
    if(room.wallOrder[player.team].length>MAX_WALLS)removeWall(room,room.wallOrder[player.team][0],'wall-limit');
    event(room,'wallBuilt',{wall:publicWall(wall)});
  }
  function begin(room){
    if(room.phase==='finished'||room.phase==='playing')return;
    const {red,blue}=room.players;
    if(!red?.ws||!blue?.ws||!red.ready||!blue.ready)return;
    const resume=room.resumePending;
    room.phase='playing';if(!resume){room.tick=0;room.winner=null;room.flags={red:createFlag('red'),blue:createFlag('blue')};room.powerups=[];room.nextPower=1.15;room.nextPowerId=0;}
    room.resumePending=false;
    for(const player of [red,blue]){
      if(!resume){player.x=FIELD.width/2;player.z=player.team==='red'?FIELD.length-.58:.58;player.fx=0;player.fz=player.team==='red'?-1:1;player.carryingFlag=null;player.captureProgress=0;player.power=null;player.dash=0;}
      player.input={forward:0,strafe:0,build:false,dig:false,shove:false,power:false};player.lastInputAt=0;player.lastSeq=-1;
      player.build=0;player.buildTarget=null;player.buildLatch=false;player.dig=0;player.digTarget=null;
      if(!resume){player.shoveCooldown=0;player.shoveProtection=0;}
      player.shoveActive=0;player.shoveRequested=false;player.powerRequested=false;player.moveReference=null;
    }
    broadcast(room,{type:'matchStart',code:room.code,mode:'wetlands-v3-walls',arena:'wetlands-v3',rules:room.rules,buildMove:room.buildMove,resume,tickRate:1000/tickMs});
    lobby(room);snapshot(room);
  }
  function error(ws,reason){send(ws,{type:'error',reason});}
  function leave(ws){
    const room=ws.room,player=ws.player;
    if(!room||!player||player.ws!==ws)return;
    player.ws=null;player.input={forward:0,strafe:0,build:false,dig:false,shove:false,power:false};player.shoveActive=0;player.shoveRequested=false;player.powerRequested=false;player.moveReference=null;room.updatedAt=Date.now();
    // The lobby-to-3D navigation replaces a socket. Give its reconnect token a
    // short handoff window before treating it as a real disconnection.
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer=setTimeout(()=>{
      if(player.ws)return;
      player.ready=false;
      if(room.phase==='playing'){
        room.phase='interrupted';room.resumePending=true;
        for(const teammate of Object.values(room.players))if(teammate){teammate.ready=false;teammate.input={forward:0,strafe:0,build:false,dig:false};cancelBuild(room,teammate,'disconnect');cancelDig(room,teammate,'disconnect');}
      }
      broadcast(room,{type:'disconnected',team:player.team,phase:room.phase});
      lobby(room);
    },3000);
    ws.room=null;ws.player=null;
  }
  function onMessage(ws,raw){
    let message;try{message=JSON.parse(raw.toString());}catch{error(ws,'invalid_json');return;}
    if(!message||typeof message!=='object'||Array.isArray(message)){error(ws,'invalid_message');return;}
    if(message.type==='create'){
      if(ws.room){error(ws,'already_in_room');return;}
      if(rooms.size>=MAX_ROOMS){error(ws,'server_full');return;}
      let id;do{id=code();}while(rooms.has(id));
      const rules=message.rules==='normal'?'normal':'gates';
      const buildMove=rules==='gates'&&message.buildMove!==false;
      const room={code:id,phase:'waiting',rules,buildMove,players:{red:null,blue:null},tick:0,updatedAt:Date.now(),
        walls:new Map(),wallOrder:{red:[],blue:[]},nextWallId:0,eventId:0,resumePending:false,
        flags:{red:createFlag('red'),blue:createFlag('blue')},powerups:[],nextPower:1.15,nextPowerId:0,winner:null};
      const player=newPlayer('red',ws);room.players.red=player;rooms.set(id,room);
      ws.room=room;ws.player=player;joinMessage(room,player);return;
    }
    if(message.type==='join'){
      if(ws.room){error(ws,'already_in_room');return;}
      const id=typeof message.code==='string'?message.code.trim().toUpperCase():'';
      const room=rooms.get(id);if(!room){error(ws,'room_not_found');return;}
      let player=Object.values(room.players).find(p=>p&&p.token===message.token);
      if(player){
        clearTimeout(player.disconnectTimer);player.disconnectTimer=null;
        if(player.ws&&player.ws!==ws)player.ws.terminate();
        player.ws=ws;player.ready=false;player.input={forward:0,strafe:0,build:false,dig:false,shove:false,power:false};player.lastSeq=-1;player.lastInputAt=0;player.moveReference=null;player.powerRequested=false;
        if(room.phase==='playing')player.ready=true;
      }else if(!room.players.blue || (!room.players.blue.ws&&room.phase==='waiting')){
        player=newPlayer('blue',ws);room.players.blue=player;
      }else {error(ws,'room_full');return;}
      room.updatedAt=Date.now();ws.room=room;ws.player=player;joinMessage(room,player);return;
    }
    const room=ws.room,player=ws.player;
    if(!room||!player){error(ws,'join_first');return;}
    if(player.ws!==ws){error(ws,'stale_connection');return;}
    room.updatedAt=Date.now();
    if(message.type==='ready'){
      if(typeof message.ready!=='boolean'||room.phase==='finished'||room.phase==='playing'){error(ws,'invalid_ready');return;}
      player.ready=message.ready;
      if(room.phase==='interrupted')room.phase='waiting';
      lobby(room);begin(room);return;
    }
    if(message.type==='input'){
      if(room.phase!=='playing')return;
      const {forward,strafe,seq,build=false,dig=false,shove=false,power=false}=message;
      if(!Number.isSafeInteger(seq)||seq<=player.lastSeq||!Number.isFinite(forward)||!Number.isFinite(strafe)||Math.abs(forward)>1||Math.abs(strafe)>1||
        typeof build!=='boolean'||typeof dig!=='boolean'||typeof shove!=='boolean'||typeof power!=='boolean'||'x' in message||'z' in message||'position' in message||'edge' in message||'wall' in message||'duration' in message||'success' in message){error(ws,'invalid_input');return;}
      if(shove&&!player.input.shove)player.shoveRequested=true;
      if(power&&!player.input.power)player.powerRequested=true;
      player.lastSeq=seq;player.input={forward,strafe,build,dig,shove,power};player.lastInputAt=Date.now();return;
    }
    error(ws,'unsupported_message');
  }
  function advance(){
    const now=Date.now();
    for(const room of rooms.values()){
      if(room.phase!=='playing')continue;
      room.tick++;
      // Alternate the first actor so a same-tick edge race has a deterministic
      // server resolution without a permanent Red or Blue advantage.
      const actors=room.tick%2?[room.players.red,room.players.blue]:[room.players.blue,room.players.red];
      for(const player of Object.values(room.players)){
        player.shoveCooldown=Math.max(0,player.shoveCooldown-tickMs/1000);
        player.dash=Math.max(0,player.dash-tickMs/1000);
        player.movedX=0;player.movedZ=0;
      }
      for(const player of actors){
        if(!player?.ws)continue;
        const input=now-player.lastInputAt<300?player.input:{forward:0,strafe:0,build:false,dig:false,shove:false,power:false};
        const magnitude=Math.hypot(input.strafe,input.forward);
        if(magnitude<1e-6)player.moveReference=null;
        else player.moveReference??=(player.team==='red'?1:-1)*(player.carryingFlag?-1:1);
        const side=player.moveReference??(player.team==='red'?1:-1);
        const scale=FIELD.speed*(player.dash>0&&player.build<=0?1.72:1)*(tickMs/1000)/Math.max(1,magnitude);
        const carrierSpeed=player.carryingFlag?FLAG_CARRIER_SPEED_MULT:1;
        const dx=input.strafe*side*scale*carrierSpeed,dz=-input.forward*side*scale*carrierSpeed;
        const directionLength=Math.hypot(dx,dz);
        if(directionLength>1e-6&&player.build<=0&&player.dig<=0){player.fx=dx/directionLength;player.fz=dz/directionLength;}

        if(player.shoveRequested){player.shoveRequested=false;startShove(room,player,room.players[player.team==='red'?'blue':'red']);}

        if(!input.build){cancelBuild(room,player);player.buildLatch=false;}
        else if(!player.buildLatch&&player.build<=0&&player.dig<=0&&player.shoveActive<=0){
          const edge=facingEdge(player);
          if(!placementIssue(room,player,edge)){
            player.buildDuration=player.carryingFlag?CARRIER_BUILD_TIME:BUILD_TIME;
            player.build=player.buildDuration;player.buildTarget=edge;player.buildLatch=true;
            event(room,'buildStarted',{team:player.team,edge,duration:player.buildDuration});
          }
        }

        if(!input.dig||player.build>0||player.shoveActive>0)cancelDig(room,player);
        else {
          const edge=facingEdge(player),key=wallKey(edge);
          if(!room.walls.has(key)||!nearWall(player,edge,.68))cancelDig(room,player,'out-of-range');
          else if(!player.digTarget||wallKey(player.digTarget)!==key){
            cancelDig(room,player,'target-changed');
            player.digTarget=edge;player.dig=0.000001;
            event(room,'digStarted',{team:player.team,edge,duration:DIG_TIME});
          }
        }

        if(directionLength>1e-6&&player.dig<=0){
          const multiplier=player.build>0?(room.buildMove?BUILD_MOVE_MULT:0):1;
          const beforeX=player.x,beforeZ=player.z;
          moveActorOnTerrain(player,dx*multiplier,dz*multiplier,(x,z)=>terrainBodyBlocked(x,z)||collidesWithWall(x,z,player.team,room.walls,room.rules==='gates'));
          player.movedX=player.x-beforeX;player.movedZ=player.z-beforeZ;
          if(room.rules==='gates')for(const wall of room.walls.values()){
            if(wall.team!==player.team)continue;
            const before=wall.o==='h'?beforeZ-wall.z:beforeX-wall.x,after=wall.o==='h'?player.z-wall.z:player.x-wall.x;
            if(!((before<0&&after>=0)||(before>0&&after<=0)))continue;
            const fraction=before/(before-after),along=wall.o==='h'?beforeX+(player.x-beforeX)*fraction:beforeZ+(player.z-beforeZ)*fraction;
            if(along<(wall.o==='h'?wall.x:wall.z)||along>(wall.o==='h'?wall.x:wall.z)+1)continue;
            event(room,'gateCrossed',{team:player.team,wallId:wall.id});
          }
        }
        if(player.build>0){player.build=Math.max(0,player.build-tickMs/1000);if(player.build<=1e-9)completeBuild(room,player);}
        if(player.dig>0){
          const edge=player.digTarget,key=wallKey(edge);
          if(!input.dig||!room.walls.has(key)||!nearWall(player,edge,.68))cancelDig(room,player,'out-of-range');
          else {
            player.dig+=tickMs/1000;
            if(player.dig+1e-9>=DIG_TIME){player.dig=0;player.digTarget=null;removeWall(room,key,'dig',player.team);}
          }
        }
        if(player.powerRequested){player.powerRequested=false;useServerPower(room,player);}
      }
      resolveShoves(room,tickMs/1000);
      advanceFlags(room,actors,tickMs/1000);
      if(room.phase==='playing')advancePowers(room,actors,tickMs/1000);
      if(room.rules==='gates')for(const wall of room.walls.values()){
        const owner=room.players[wall.team];
        if(crossingApproach(wall,owner)){wall.open=true;wall.clearTime=0;}
        else if(wall.open){
          // A player stopped in the doorway keeps the doors safely open.
          wall.clearTime=inDoorway(wall,owner)?0:wall.clearTime+tickMs/1000;
          if(wall.clearTime>=.12){wall.open=false;wall.clearTime=0;}
        }
      }
      if(room.tick%2===0)snapshot(room);
    }
    for(const [id,room] of rooms)if(!Object.values(room.players).some(p=>p?.ws)&&now-room.updatedAt>ROOM_IDLE_MS)rooms.delete(id);
  }
  const timer=autoTick?setInterval(advance,tickMs):null;
  timer?.unref?.();
  const heartbeat=setInterval(()=>{
    for(const client of wss.clients){
      if(!client.isAlive){client.terminate();continue;}
      client.isAlive=false;client.ping();
    }
  },30000);
  heartbeat.unref?.();
  function completeMatch(roomCode,winner){
    const room=rooms.get(roomCode);if(!room||room.phase!=='playing'||!['red','blue'].includes(winner))return false;
    room.phase='finished';room.winner=winner;
    for(const p of Object.values(room.players))p.input={forward:0,strafe:0,build:false,dig:false,shove:false,power:false};
    snapshot(room);broadcast(room,{type:'matchComplete',code:room.code,winner});lobby(room);return true;
  }
  const upgrade=(request,socket,head)=>{
    let pathname;try{pathname=new URL(request.url,'http://localhost').pathname;}catch{socket.destroy();return;}
    if(pathname!=='/ws'||wss.clients.size>=MAX_CONNECTIONS){socket.destroy();return;}
    try {
      const origin=request.headers.origin;
      const production=process.env.NODE_ENV==='production'||!!process.env.RENDER;
      if(production&&!origin){socket.destroy();return;}
      if(origin){
        const parsed=new URL(origin);
        if(parsed.host!==request.headers.host||!['https:','http:'].includes(parsed.protocol)||
          (production&&parsed.protocol!=='https:')){socket.destroy();return;}
      }
    }catch{socket.destroy();return;}
    wss.handleUpgrade(request,socket,head,ws=>wss.emit('connection',ws));
  };
  httpServer.on('upgrade',upgrade);
  wss.on('connection',ws=>{
    ws.isAlive=true;
    ws.on('pong',()=>{ws.isAlive=true;});
    ws.on('message',raw=>{
      const now=Date.now();
      if(!ws.rate||now-ws.rate.start>=1000)ws.rate={start:now,count:0};
      if(++ws.rate.count>MAX_MESSAGES_PER_SECOND){ws.close(1008,'Message rate exceeded');return;}
      onMessage(ws,raw);
    });
    ws.on('close',()=>leave(ws));
    ws.on('error',()=>leave(ws));
    send(ws,{type:'hello',protocol:3,mode:'wetlands-v3-walls'});
  });
  function close(){if(timer)clearInterval(timer);clearInterval(heartbeat);for(const room of rooms.values())for(const player of Object.values(room.players))if(player)clearTimeout(player.disconnectTimer);httpServer.off('upgrade',upgrade);for(const client of wss.clients)client.close(1012,'Server restarting');wss.close();}
  return {rooms,wss,close,completeMatch,advance,FIELD,DEMO:FIELD};
}
module.exports={createMultiplayerServer};
