// Short procedural cues. Gameplay calls these only for confirmed events; audio never drives game state.
export function createGameAudio() {
  let context=null, master=null, noiseBuffer=null, active=0;
  let muted=false, volume=.65;
  try {
    muted=localStorage.getItem('wall-rush-muted')==='1';
    const stored=localStorage.getItem('wall-rush-volume');
    const saved=Number(stored);
    if(stored!==null&&Number.isFinite(saved)&&saved>=0&&saved<=1)volume=saved;
  } catch {}
  const recent=[], lastPlayed=new Map(), stride={red:0,blue:0}, surface={red:null,blue:null};
  const MAX_VOICES=16;
  const cues={
    footstepDry:[[105,.055,'triangle',.018,62,0],[850,.025,'noise',.012,0,0]],
    footstepWater:[[155,.075,'sine',.016,80,0],[1050,.10,'noise',.017,0,.012]],
    buildStart:[[340,.065,'triangle',.023,440,0]],
    buildSuccess:[[145,.12,'triangle',.037,70,0],[610,.13,'sine',.019,820,.025]],
    buildCancel:[[310,.08,'triangle',.013,170,0]],
    gateOpen:[[510,.13,'sine',.010,720,0]],
    gateClose:[[580,.12,'sine',.010,330,0]],
    wallBreak:[[125,.20,'sawtooth',.036,55,0],[1350,.22,'noise',.022,0,.025]],
    shove:[[220,.09,'square',.021,105,0]],
    shoveImpact:[[95,.13,'triangle',.032,55,0],[950,.07,'noise',.013,0,.015]],
    flagPickup:[[540,.09,'sine',.023,740,0],[800,.15,'triangle',.015,1060,.07]],
    flagDrop:[[350,.10,'triangle',.018,140,0]],
    flagReturn:[[580,.09,'triangle',.018,770,0]],
    flagCapture:[[650,.14,'triangle',.026,830,0],[920,.18,'sine',.021,1120,.10]],
    victory:[[660,.13,'triangle',.027,880,0],[880,.15,'triangle',.025,1175,.13],[1175,.28,'sine',.027,1568,.27]],
    powerPickup:[[710,.08,'sine',.019,980,0],[1040,.12,'triangle',.015,1230,.055]],
    powerActivate:[[480,.11,'triangle',.022,790,0],[960,.11,'sine',.012,580,.035]],
  };
  function setOutput(){if(master&&context)master.gain.setTargetAtTime(muted?0:volume,context.currentTime,.025);}
  function unlock(){
    try {
      if(!context){
        const AudioContextClass=window.AudioContext||window.webkitAudioContext;
        if(!AudioContextClass)return false;
        context=new AudioContextClass();
        master=context.createGain();
        const limiter=context.createDynamicsCompressor();
        limiter.threshold.value=-20;limiter.knee.value=10;limiter.ratio.value=8;
        limiter.attack.value=.003;limiter.release.value=.18;
        master.connect(limiter).connect(context.destination);
        setOutput();
      }
      if(context.state==='suspended')context.resume().catch(()=>{});
      return context.state==='running';
    } catch {return false;}
  }
  function getNoiseBuffer(){
    if(noiseBuffer)return noiseBuffer;
    const length=Math.ceil(context.sampleRate*.4);
    noiseBuffer=context.createBuffer(1,length,context.sampleRate);
    const data=noiseBuffer.getChannelData(0);
    for(let i=0;i<length;i++)data[i]=Math.random()*2-1;
    return noiseBuffer;
  }
  function voice(frequency,duration,type,gainValue,endFrequency=frequency,delay=0){
    if(muted||!context||context.state!=='running'||active>=MAX_VOICES)return;
    const start=context.currentTime+delay, envelope=context.createGain();
    let source, filter=null;
    if(type==='noise'){
      source=context.createBufferSource();source.buffer=getNoiseBuffer();
      filter=context.createBiquadFilter();filter.type='lowpass';filter.frequency.value=frequency;
      source.connect(filter).connect(envelope);
    }else{
      source=context.createOscillator();source.type=type;
      source.frequency.setValueAtTime(frequency,start);
      source.frequency.exponentialRampToValueAtTime(Math.max(1,endFrequency),start+duration);
      source.connect(envelope);
    }
    envelope.gain.setValueAtTime(.0001,start);
    envelope.gain.linearRampToValueAtTime(gainValue,start+Math.min(.012,duration*.25));
    envelope.gain.exponentialRampToValueAtTime(.0001,start+duration);
    envelope.connect(master);active++;
    source.onended=()=>{source.disconnect();filter?.disconnect();envelope.disconnect();active--;};
    source.start(start);source.stop(start+duration+.005);
  }
  function tone(frequency,duration,type='sine',gain=.02,delay=0){voice(frequency,duration,type,Math.min(gain,.035),frequency,delay);}
  function play(name,scope=''){
    const parts=cues[name];if(!parts)return false;
    const now=context?.currentTime??0,key=name+':'+scope;
    // Event cooldowns are a final guard against accidental per-frame callers.
    const gap=name.startsWith('footstep')?.12:name.startsWith('gate')?.14:.045;
    if(context&&now-(lastPlayed.get(key)??-Infinity)<gap)return false;
    lastPlayed.set(key,now);
    recent.push(name);if(recent.length>100)recent.shift();
    for(const part of parts)voice(...part);
    return true;
  }
  function step(team,kind,distance){
    if(!(team in stride)||!Number.isFinite(distance)||distance<=0)return;
    if(distance>.22){stride[team]=0;return;} // Jump/teleport/knockback is not a footstep.
    if(surface[team]!==kind){surface[team]=kind;stride[team]=0;}
    stride[team]+=distance;
    const length=kind==='water'?.31:.43;
    if(stride[team]>=length){stride[team]%=length;play(kind==='water'?'footstepWater':'footstepDry',team);}
  }
  function resetSteps(){for(const team of ['red','blue']){stride[team]=0;surface[team]=null;}}
  function setMuted(value){muted=!!value;setOutput();try{localStorage.setItem('wall-rush-muted',muted?'1':'0');}catch{}return muted;}
  function setVolume(value){volume=Math.max(0,Math.min(1,Number(value)||0));setOutput();try{localStorage.setItem('wall-rush-volume',String(volume));}catch{}return volume;}
  return {unlock,play,step,resetSteps,tone,setMuted,setVolume,
    get muted(){return muted;},get volume(){return volume;},get recentEvents(){return [...recent];},
    get unlocked(){return !!context&&context.state==='running';},get activeVoices(){return active;}};
}
