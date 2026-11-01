import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Client-only deterministic scenery. No simulation, collision, input or networking changes.
export function createFestivalScenery(THREE,scene,world,{width,length,terrainCell,wx,wz,renderer=null}) {
  const group=new THREE.Group();group.name='Approved_Blender_Festival';scene.add(group);
  const status={seed:0x46525553,loaded:[],errors:[],instances:0,anchors:[],ready:false};group.userData=status;
  let seed=status.seed;const random=()=>((seed=Math.imul(seed,1664525)+1013904223|0)>>>0)/4294967296;
  const files={broadleaf:'WR_Env_Tree_Broadleaf_03',pine:'WR_Env_Tree_Pine_03',upright:'WR_Env_Bush_Upright_03',wide:'WR_Env_Bush_Wide_03',rock1:'WR_Env_Rock_01',rock2:'WR_Env_Rock_02',rock3:'WR_Env_Rock_03',reeds:'WR_Env_Reeds_Cattails_01',flowers:'WR_Env_Flowers_01',lilies:'WR_Env_LilyPads_01',stand:'WallRush_Festival_Stand_v1',tent:'WallRush_Festival_Tent_v1',arch:'WallRush_Festival_EntranceArch_v1',tower:'WallRush_Festival_Watchtower_v1'};
  const meadow=new THREE.Mesh(new THREE.CircleGeometry(350,64),new THREE.MeshStandardMaterial({color:0xa4ce78,roughness:1}));
  meadow.rotation.x=-Math.PI/2;meadow.position.y=-.59;meadow.name='Exterior_meadow';group.add(meadow);
  const loader=new GLTFLoader(),assets={},teamMaterials=new Map(),batches=new Map();
  Object.assign(files,{cottageA:'WallRush_Village_Cottage_A',cottageB:'WallRush_Village_Cottage_B',houseC:'WallRush_Village_House_C'});
  const crowdBodies=[],crowdHeads=[],farTrees=new Map();
  // Cache a softly filtered image of each approved far-tree model once. Nearby
  // geometry stays crisp; these camera-facing instances need only two triangles.
  function prepareFarTree(kind){
    if(!renderer)return; // Geometry-only verification can run without WebGL.
    const model=assets[kind].scene.clone(true),materials=[];
    model.traverse(o=>{if(!o.isMesh)return;const old=o.material;const m=new THREE.MeshBasicMaterial({color:old.color.clone(),side:THREE.DoubleSide});o.material=m;materials.push(m);o.castShadow=false;o.receiveShadow=false;});
    const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
    const w=size.x*1.35,h=size.y*1.35,camera=new THREE.OrthographicCamera(-w/2,w/2,h/2,-h/2,.01,100);
    camera.position.set(center.x,center.y,box.max.z+10);camera.lookAt(center);
    const captureScene=new THREE.Scene();captureScene.add(model);
    const capture=new THREE.WebGLRenderTarget(128,128),soft=new THREE.WebGLRenderTarget(128,128);
    const quadGeo=new THREE.PlaneGeometry(2,2),quadMaterial=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{source:{value:capture.texture}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:`uniform sampler2D source;varying vec2 vUv;void main(){
      vec4 sum=vec4(0.);float alpha=0.;
      for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){
        float weight=(x==0?2.:1.)*(y==0?2.:1.)/16.;vec4 p=texture2D(source,vUv+vec2(float(x),float(y))*2.5/128.);
        sum.rgb+=p.rgb*p.a*weight;alpha+=p.a*weight;
      }gl_FragColor=vec4(sum.rgb/max(alpha,.0001),alpha);
    }`});
    const filterScene=new THREE.Scene();filterScene.add(new THREE.Mesh(quadGeo,quadMaterial));
    const old={target:renderer.getRenderTarget(),color:renderer.getClearColor(new THREE.Color()),alpha:renderer.getClearAlpha(),tone:renderer.toneMapping,auto:renderer.autoClear,shadow:renderer.shadowMap.enabled,viewport:renderer.getViewport(new THREE.Vector4()),scissor:renderer.getScissor(new THREE.Vector4()),scissorTest:renderer.getScissorTest()};
    try{renderer.toneMapping=THREE.NoToneMapping;renderer.autoClear=true;renderer.shadowMap.enabled=false;renderer.setScissorTest(false);renderer.setClearColor(0,0);
      renderer.setRenderTarget(capture);renderer.clear();renderer.render(captureScene,camera);
      renderer.setRenderTarget(soft);renderer.clear();renderer.render(filterScene,camera);
    }finally{renderer.setRenderTarget(old.target);renderer.setClearColor(old.color,old.alpha);renderer.toneMapping=old.tone;renderer.autoClear=old.auto;renderer.shadowMap.enabled=old.shadow;renderer.setViewport(old.viewport);renderer.setScissor(old.scissor);renderer.setScissorTest(old.scissorTest);
      quadGeo.dispose();quadMaterial.dispose();materials.forEach(m=>m.dispose());}
    const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{image:{value:soft.texture},crispImage:{value:capture.texture},haze:{value:new THREE.Color(0xa9bdb5)},distanceHaze:{value:new THREE.Color(0xb6d2d7)}},vertexShader:`attribute float distanceSoftness;varying float vSoftness;varying float vViewDistance;varying vec2 vUv;void main(){vUv=uv;vSoftness=distanceSoftness;
      vec4 center=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);
      vViewDistance=length(center.xyz);
      vec2 s=vec2(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz));
      gl_Position=projectionMatrix*(center+vec4(position.xy*s,0.,0.));
    }`,fragmentShader:`uniform sampler2D image;uniform sampler2D crispImage;uniform vec3 haze;uniform vec3 distanceHaze;varying float vViewDistance;varying float vSoftness;varying vec2 vUv;void main(){gl_FragColor=mix(texture2D(crispImage,vUv),texture2D(image,vUv),vSoftness);gl_FragColor.rgb=mix(gl_FragColor.rgb,haze,.10+.38*vSoftness);float luminance=dot(gl_FragColor.rgb,vec3(.2126,.7152,.0722));gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(luminance),.62*vSoftness);gl_FragColor.a*=mix(.86,.18,vSoftness);if(gl_FragColor.a<.005)discard;
      gl_FragColor.rgb=mix(gl_FragColor.rgb,distanceHaze,.40*smoothstep(32.,85.,vViewDistance));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`});
    farTrees.set(kind,{geometry:new THREE.PlaneGeometry(w,h),material,center,matrices:[],softness:[],targets:[capture,soft]});
  }
  function spectators(transform,team){
    const palette=team==='blue'?[0x427ac2,0x315b97,0xf1db9d]:[0xc95057,0x983c4c,0xf1db9d];
    const skins=[0xe9bb8d,0xa96e4e,0x794d38,0xf2d0a5];
    for(let row=0;row<3;row++)for(let col=0;col<6;col++){
      const id=row*6+col,seat=.375+row*.23,x=-1.05+col*.42,z=.49-row*.55;
      const matrix=(y,scale)=>new THREE.Matrix4().multiplyMatrices(transform,new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion(),new THREE.Vector3(...scale)));
      crowdBodies.push({m:matrix(seat+.16,[.12,.17,.105]),color:palette[(col+row*2)%3]});
      crowdHeads.push({m:matrix(seat+.405,[.105,.112,.10]),color:skins[(col+row*3+(team==='blue'?1:0))%4]});
    }
  }
  // Static nature is instanced per material; structures share geometry and team materials.
  function place(kind,x,y,z,scale=1,yaw=0,team=null,layer='near'){
    if(kind==='broadleaf'||kind==='pine'){
      const depth=Math.abs(z);
      scale*=THREE.MathUtils.lerp(1,.70,THREE.MathUtils.smoothstep(depth,25,48))*THREE.MathUtils.lerp(1,2,THREE.MathUtils.smoothstep(depth,16,20));
      // Correct the last version's proportions: mountain groves half size,
      // festival groves immediately beyond the arch 15% smaller.
      scale*=depth>=25?.5:depth>12.6?.85:1;
    }
    const model=assets[kind].scene;const transform=new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw),new THREE.Vector3(scale,scale,scale));
    // The first background groves begin immediately beyond the arch (|Z|=12.6).
    const treeDistance=Math.abs(z),softness=THREE.MathUtils.smoothstep(treeDistance,12.6,44);
    const distant=treeDistance>12.6&&farTrees.get(kind);
    if(distant){distant.softness.push(softness);const pos=new THREE.Vector3(x+distant.center.x*scale,y+distant.center.y*scale,z);distant.matrices.push(new THREE.Matrix4().compose(pos,new THREE.Quaternion(),new THREE.Vector3(scale,scale,scale)));status.anchors.push({kind,x,y,z,scale});status.instances++;return;}
    model.updateMatrixWorld(true);
    if(!['stand','tent','arch','tower'].includes(kind)){
      model.traverse(o=>{if(!o.isMesh)return;const key=o.uuid+layer;let batch=batches.get(key);if(!batch){const material=layer==='near'?o.material:o.material.clone();if(layer!=='near'&&!['cottageA','cottageB','houseC'].includes(kind))material.color.lerp(new THREE.Color(layer==='far'?0x9eafa5:0x9db798),layer==='far'?.48:.24);if(['cottageA','cottageB','houseC'].includes(kind)){const l=material.color.r*.2126+material.color.g*.7152+material.color.b*.0722;material.color.lerp(new THREE.Color().setRGB(l,l,l),.35);material.transparent=true;material.opacity=.64;material.depthWrite=true;}batch={source:o,material,matrices:[]};batches.set(key,batch);}batch.matrices.push(new THREE.Matrix4().multiplyMatrices(transform,o.matrixWorld));});
    }else{
      const copy=model.clone(true);copy.name=`${kind}_${team||'festival'}`;copy.position.set(x,y,z);copy.rotation.y=yaw;copy.scale.setScalar(scale);
      copy.traverse(o=>{if(!o.isMesh)return;o.castShadow=false;o.receiveShadow=true;
        if(team&&o.material.name.startsWith('TeamPrimary')){const key=o.material.uuid+team;if(!teamMaterials.has(key)){const m=o.material.clone();m.color.setHex(team==='blue'?0x438cd3:0xd95050);teamMaterials.set(key,m);}o.material=teamMaterials.get(key);}
      });group.add(copy);
      if(kind==='stand')spectators(transform,team);
    }status.anchors.push({kind,x,y,z,scale});status.instances++;
  }
  status.promise=Promise.all(Object.entries(files).map(async([key,name])=>{
    const path=`./assets/environment/${name}.glb`;
    try{assets[key]=await loader.loadAsync(path);
      const palette={WoodFrame:0x94643f,WoodPlanks:0xad784f,WoodEndgrain:0x9d704c,CanvasCream:0xffedc5,Village_WarmPlaster:0xf2dfb7,Village_RoofTerracotta:0xb96c43,Village_RoofTerracotta_Sunward:0xc98250,Village_RoofBlueGreen:0x559caf,Village_RoofBlueGreen_Sunward:0x6eafbd,Village_RoofOchre:0xc58d43,Village_RoofOchre_Sunward:0xd8a556};
      const seen=new Set();assets[key].scene.traverse(o=>{if(!o.isMesh)return;for(const m of (Array.isArray(o.material)?o.material:[o.material])){if(seen.has(m))continue;seen.add(m);const color=palette[m.name.split('.')[0]];if(color!==undefined){m.color.setHex(color);m.roughness=.88;}}});
      status.loaded.push(name);}catch(error){status.errors.push(path);throw new Error(`Missing approved environment asset: ${path}`,{cause:error});}
  })).then(()=>{
    prepareFarTree('broadleaf');prepareFarTree('pine');
    // One connected landscape, including distant ridges. No radial peak meshes
    // or overlapping terrain sheets: every decorative elevation shares this surface.
    const hillMeshes=[];
    const smooth=(a,b,x)=>{const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
    const villageLayout=[[9,-20,3],[16,-25,3],[8,-30,3]];
    const mound=(x,z,cx,cz,rx,rz,h)=>h*Math.exp(-2*((x-cx)**2/rx**2+(z-cz)**2/rz**2));
    const ridgeMass=(x,z,cx,cz,rx,rz,h)=>{
      const px=(x-cx)/rx,pz=(z-cz)/rz;
      const r=Math.sqrt(px*px+pz*pz)*(1+.10*Math.sin(x*.29+z*.16)+.055*Math.cos(z*.38));
      return h*(1+.075*Math.sin(x*.23+z*.11)+.05*Math.cos(z*.3-x*.08))*(1-smooth(.04,1.16,r));
    };
    // Far silhouettes are part of the same landscape, with separate muted hues.
    const mountainProfiles=[
      [-43,44,12,11,5.3,0x93b690],[-31,53,13,12,8.4,0x789ab7],
      [-18,46,10,10,5.5,0x83aa91],[-7,59,14,12,10.1,0x8dabc0],
      [7,50,11,11,6.3,0xaaa9bf],[22,56,13,12,8.7,0x7e9dac],
      [36,46,11,10,5.9,0xa4bc91],[46,55,13,12,8.2,0x8ca8bc]
    ];
    const mountainAt=(x,z,p,end)=>ridgeMass(x,z,p[0]*end,p[1]*end,p[2],p[3],p[4]);
    // Authored focal hills rise behind each end; a low saddle keeps the arch legible.
    const valleyHeight=(x,z)=>{
      const dx=Math.max(0,Math.abs(x)-width/2),dz=Math.max(0,Math.abs(z)-length/2),distance=Math.hypot(dx,dz);
      let h=.38*smooth(4,13,distance);
      // A connected settlement shoulder, close enough to read from the real
      // low gameplay cameras. Lobes form a rising bank rather than a backdrop wall.
      h+=mound(x,z,11,-23,10,12,2.4)+mound(x,z,17,-29,8,9,.85)+mound(x,z,8,-30,7,8,1.1);
      for(const side of [-1,1]){
        for(const end of [-1,1])h+=mound(x,z,side*12,end*12,7,9,1.0);
        h+=mound(x,z,side*19,side*12,10,14,1.15);
        // Connected, lobed escarpment: higher village crown, broad rocky skirt.
        h+=ridgeMass(x,z,-side*12,side*31,13,12,1.65);
        h+=mound(x,z,side*16,side*30,12,15,1.05);
        h+=mound(x,z,-side*18,side*36,10,11,.65);
        // Softer distant ridges, offset from the entrance rather than a central peak.
        h+=ridgeMass(x,z,side*25,side*49,24,14,3.3);
        h+=ridgeMass(x,z,-side*23,side*53,22,16,4.1);
        h+=mound(x,z,side*1,side*59,29,18,1.25);
        h+=ridgeMass(x,z,side*46,side*10,14,33,2.5);
      }
      for(const end of [-1,1])for(const p of mountainProfiles)h=Math.max(h,mountainAt(x,z,p,end));
      const detail=.14*Math.sin(x*.24+z*.1)+.10*Math.cos(z*.28-x*.12)+.12*Math.sin(x*.62)*Math.cos(z*.41);
      return -.58+smooth(4,9,distance)*Math.max(0,h+detail)*(1-smooth(62,75,Math.hypot(x,z)));
    };
    const terraceHeight=(x,z)=>{
      let y=valleyHeight(x,z);
      // Nearest pad wins: overlapping blend skirts must not tilt foundations.
      const nearest=villageLayout.reduce((a,b)=>Math.hypot(x-a[0],z-a[1])<Math.hypot(x-b[0],z-b[1])?a:b);
      const [cx,cz]=nearest,d=Math.hypot(x-cx,z-cz),blend=1-smooth(3,4.5,d);
      y=THREE.MathUtils.lerp(y,valleyHeight(cx,cz),blend);
      return y;
    };
    const vp=[],vi=[],vc=[],grid=168,extent=84;
    for(let iz=0;iz<=grid;iz++)for(let ix=0;ix<=grid;ix++){
      const x=-extent+ix*extent*2/grid,z=-extent+iz*extent*2/grid,y=terraceHeight(x,z);vp.push(x,y,z);
      const slope=Math.hypot(terraceHeight(x+.5,z)-terraceHeight(x-.5,z),terraceHeight(x,z+.5)-terraceHeight(x,z-.5));
      const distance=Math.hypot(x/1.15,z),fade=smooth(31,67,distance);
      const c=new THREE.Color(0xa4ce78).lerp(new THREE.Color(0x94b581),smooth(.3,3,y));
      c.lerp(new THREE.Color(0x929b89),smooth(.16,.55,slope)*.84);
      // Broad grassy caps and stone shoulders on the connected bank, never gameplay tiles.
      const shoulder=smooth(.14,.42,slope)*(1-smooth(3.8,5.0,y))*smooth(.3,1.0,y);
      c.lerp(new THREE.Color(0xa5a18b),shoulder*(.55+.18*Math.sin(x*.48+z*.34)));
      c.multiplyScalar(1-.16*smooth(.12,.6,slope)+.035*Math.sin(x*.43+z*.31));
      c.lerp(new THREE.Color(0x8fb5a4),fade*.74);
      let mountainStrength=0,mountainColor=0x8fb5a4;
      for(const end of [-1,1])for(const p of mountainProfiles){const strength=mountainAt(x,z,p,end);if(strength>mountainStrength){mountainStrength=strength;mountainColor=p[5];}}
      c.lerp(new THREE.Color(mountainColor),smooth(.5,4,mountainStrength)*.92);
      for(const [cx,cz,r] of villageLayout)c.lerp(new THREE.Color(0xadb18a),(1-smooth(r*.6,r+1.2,Math.hypot(x-cx,(z-cz)/.75)))*.45);
      c.multiplyScalar(1+.02*Math.sin(x*.3+z*.4));c.lerp(new THREE.Color(0xa4ce78),smooth(66,80,Math.hypot(x,z)));vc.push(c.r,c.g,c.b);
    }
    for(let iz=0;iz<grid;iz++)for(let ix=0;ix<grid;ix++){const a=iz*(grid+1)+ix,b=a+grid+1;vi.push(a,b,a+1,a+1,b,b+1);}
    const valleyGeo=new THREE.BufferGeometry();valleyGeo.setAttribute('position',new THREE.Float32BufferAttribute(vp,3));valleyGeo.setAttribute('color',new THREE.Float32BufferAttribute(vc,3));valleyGeo.setIndex(vi);valleyGeo.computeVertexNormals();
    const valley=new THREE.Mesh(valleyGeo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}));valley.name='Connected_festival_valley';group.add(valley);hillMeshes.push(valley);
    status.landscape={connected:true,radialPeaks:0,grid,extent:84};
    // Exact barycentric sample of the rendered valley triangles, without raycasting
    // its entire mesh for every small path segment.
    const ground=(x,z)=>{
      const gx=(x+extent)*grid/(extent*2),gz=(z+extent)*grid/(extent*2),ix=Math.max(0,Math.min(grid-1,Math.floor(gx))),iz=Math.max(0,Math.min(grid-1,Math.floor(gz))),u=gx-ix,v=gz-iz;
      const y=(dx,dz)=>vp[((iz+dz)*(grid+1)+ix+dx)*3+1];
      const valleyY=u+v<=1?y(0,0)+(y(1,0)-y(0,0))*u+(y(0,1)-y(0,0))*v:y(1,1)+(y(0,1)-y(1,1))*(1-u)+(y(1,0)-y(1,1))*(1-v);
      return valleyY;
    };
    // Three stands per sideline, with gaps for village entrances and planting.
    for(const side of [-1,1]){
      const inward=side<0?Math.PI/2:-Math.PI/2;
      for(const z of [-5.3,0,5.3])place('stand',side*8.6,ground(side*8.6,z),z,.92,inward,z<0?'blue':z>0?'red':side<0?'blue':'red');
      for(const end of [-1,1]){
        const team=end>0?'red':'blue';
        if(!(side===1&&end===-1))place('tent',side*5.8,ground(side*5.8,end*17.5),end*17.5,.90,end>0?Math.PI-.10*side:.10*side,team);
        const tx=side===1&&end===-1?16:side*10.2,tz=side===1&&end===-1?-17:end*22;place('tower',tx,ground(tx,tz),tz,.76,end>0?Math.PI:0,team);
      }
    }
    place('arch',0,ground(0,-length/2-4.1),-length/2-4.1,1,0);
    // Approved houses occupy the existing reserved hillside pads; terrain is unchanged.
    status.villageSites=villageLayout.map(([x,z,radius],i)=>({name:`Cottage_site_${i+1}`,x,y:ground(x,z),z,radius}));
    status.villageHouses=[];
    const houseTypes=['cottageB','cottageA','houseC'];
    for(const [i,site] of status.villageSites.entries()){
      const yaw=[.28,-.42,.15][i],kind=houseTypes[i];
      place(kind,site.x,site.y,site.z,.28,yaw,null,'middle');
      status.villageHouses.push({...site,kind,yaw,scale:.28});
    }
    function ribbon(points,halfWidth,color,name){
      const v=[],f=[],dense=[];
      for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.15);for(let j=0;j<n;j++)dense.push([THREE.MathUtils.lerp(a[0],b[0],j/n),THREE.MathUtils.lerp(a[1],b[1],j/n)]);}dense.push(points.at(-1));points=dense;
      for(let i=0;i<points.length;i++){
        const [x,z]=points[i],prev=points[Math.max(0,i-1)],next=points[Math.min(points.length-1,i+1)],dx=next[0]-prev[0],dz=next[1]-prev[1],len=Math.hypot(dx,dz)||1;
        for(const side of [-1,1]){const px=x+side*dz/len*halfWidth,pz=z-side*dx/len*halfWidth;v.push(px,ground(px,pz)+.06,pz);}
        if(i<points.length-1){const a=i*2;f.push(a,a+2,a+1,a+1,a+2,a+3);}
      }
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(f);g.computeVertexNormals();const mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color,roughness:1,side:THREE.DoubleSide}));mesh.name=name;group.add(mesh);
    }
    for(const side of [-1,1])ribbon(Array.from({length:23},(_,i)=>[side*(7.2+2.4*Math.sin(i*.12)),-20+i*1.8]),.48,0xd4b787,'Raised_festival_path');
    for(const points of [ [[5.8,-17.5],[6,-19],[7,-19.2],[7.4,-18.6],[8.5,-18.3],[11.5,-19],[13,-20.5],[13.5,-22.5],[15.5,-23.5],[13,-25.5],[10,-26.5],[8,-28.4]] ])
      ribbon(points,.24,0xd4b787,'Hillside_village_path');
    // Sparse foundation planting uses approved assets; keep the door/path side clear.
    for(const [i,site] of status.villageSites.entries()){
      for(const [kind,dx,dz,s] of [['wide',-1.4,.5,.40],['rock2',1.25,.45,.46]]){
        const x=site.x+dx,z=site.z+dz;place(kind,x,ground(x,z),z,s,i*.7,null,'middle');
      }
      // Rear planting is handled by the few existing grove groups below.
    }
    // A level exterior spectator promenade connects the stand entrances.

    for(const side of [-1,1]){
      const positions=[],indices=[];
      for(let i=0;i<=16;i++){
        const z=-10+i*1.25,x=side*(6.05+.16*Math.sin(z*.5));
        positions.push(x-.40,-.574,z,x+.40,-.574,z);
        if(i<16){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}
      }
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();
      const path=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0xc5aa7b,roughness:1,side:THREE.DoubleSide}));path.name='Exterior_spectator_walk';group.add(path);
    }
    // Quiet planting accents at the corners, away from grid edges and camera travel.
    for(const side of [-1,1])for(const z of [-7.8,7.8]){
      place('wide',side*5.7,-.58,z,.58,random()*6.28);
      place('upright',side*6.1,-.58,z+.45,.48,random()*6.28);
      place('rock2',side*6.2,-.58,z-.5,.55,random()*6.28);
      place('flowers',side*5.8,-.58,z+.2,.42,random()*6.28);
    }
    // Coherent scene groups: low framing groves beside the tent courts, with
    // smaller foliage following the uphill paths. Clear space around structures.
    const groves=[[-10,-17,5],[19,-20,5],[-10,18,5],[10,18,5],[14,-33,7],[8,-35,7],[16,29,7],[-18,27,6]];
    for(const [cx,cz,count] of groves)for(let i=0;i<count;i++){
      const a=i*2.4+.3,r=.45+Math.sqrt(i)*.53,x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r*.8;
      if(status.anchors.some(p=>['tent','tower','arch'].includes(p.kind)&&Math.hypot(p.x-x,p.z-z)<1.7))continue;
      if(status.villageHouses.some(p=>Math.hypot(p.x-x,p.z-z)<3.6))continue;
      const distant=Math.hypot(cx,cz)>30;
      place(i%3===1?'pine':'broadleaf',x,ground(x,z),z,(distant?.57:.76)+random()*.17,random()*6.28,null,distant?'far':'middle');
    }
    // Forest silhouettes occupy distant foothills rather than the tallest crests.
    for(const end of [-1,1])for(const [cx,cz] of [[-25,42],[-11,45],[9,45],[25,40]])for(let i=0;i<9;i++){
      const a=i*2.4,r=.45+Math.sqrt(i)*.56,x=end*(cx+Math.cos(a)*r),z=end*(cz+Math.sin(a)*r*.7);
      if(ground(x,z)>2.8)continue; // Keep distant trees below the bare mountain crests.
      place('pine',x,ground(x,z),z,.43+random()*.13,random()*6.28,null,'far');
    }
    // Low exterior clusters fill village gaps without adding props to gameplay paths.
    for(let i=0;i<19;i++){
      const side=i%2?-1:1,x=side*(10.8+random()*5.5),z=-22+i*2.4;
      for(let j=0;j<4;j++){
        const px=x+Math.cos(j*2.4)*.55,pz=z+Math.sin(j*2.4)*.55;
        const kind=j===0?'wide':j===1?'upright':j===2?`rock${i%3+1}`:i%4===0?'flowers':'rock2';
        place(kind,px,ground(px,pz),pz,.48+random()*.25,random()*6.28);
      }
    }
    // Bake the static hills into one vertex-colored draw, after grounding placements.
    const hillPositions=[],hillNormals=[],hillColors=[];
    for(const h of hillMeshes){
      const geo=h.geometry.index?h.geometry.toNonIndexed():h.geometry.clone(),p=geo.getAttribute('position'),n=geo.getAttribute('normal'),c=h.material.color;
      for(const value of p.array)hillPositions.push(value);for(const value of n.array)hillNormals.push(value);
      const colors=geo.getAttribute('color');for(let i=0;i<p.count;i++)hillColors.push(colors?colors.getX(i):c.r,colors?colors.getY(i):c.g,colors?colors.getZ(i):c.b);
      group.remove(h);geo.dispose();h.geometry.dispose();h.material.dispose();
    }
    const hillsGeo=new THREE.BufferGeometry();hillsGeo.setAttribute('position',new THREE.Float32BufferAttribute(hillPositions,3));hillsGeo.setAttribute('normal',new THREE.Float32BufferAttribute(hillNormals,3));hillsGeo.setAttribute('color',new THREE.Float32BufferAttribute(hillColors,3));hillsGeo.computeVertexNormals();
    const hillLandscape=new THREE.Mesh(hillsGeo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}));hillLandscape.name='Batched_rolling_landscape';group.add(hillLandscape);
    for(let z=0;z<length;z++)for(let x=0;x<width;x++){
      const cell=terrainCell(x,z),outer=x===0||x===width-1;
      if(cell==='W'&&outer&&random()<.30)place('lilies',wx(x+.5),.047,wz(z+.5),.48,random()*6.28);
      // Reeds stay outside the playable edge, avoiding fake walk-through obstacles.
      if(cell==='W'&&outer)place('reeds',Math.sign(wx(x+.5))*(width/2+1.6),-.58,wz(z+.5),.65,random()*6.28);
    }
    // Ensure all rock variants are represented in exterior clusters.
    for(let i=0;i<3;i++)place(`rock${i+1}`,5.4+i*.45,-.58,9+i*.4,.8,i);
    for(const {source,material,matrices} of batches.values()){const mesh=new THREE.InstancedMesh(source.geometry,material,matrices.length);mesh.name=`Approved_${source.name}`;matrices.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.castShadow=false;mesh.receiveShadow=false;group.add(mesh);}
    for(const [kind,tree] of farTrees){tree.geometry.setAttribute('distanceSoftness',new THREE.InstancedBufferAttribute(new Float32Array(tree.softness),1));const mesh=new THREE.InstancedMesh(tree.geometry,tree.material,tree.matrices.length);mesh.name=`Soft_distant_${kind}`;tree.matrices.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();group.add(mesh);}
    status.softDistantTrees=[...farTrees.values()].reduce((count,t)=>count+t.matrices.length,0);
    // Two simple shapes per seated spectator; no faces, rigging or animations.
    const crowdGeo=new THREE.SphereGeometry(1,7,5);
    for(const [name,items] of [['Seated_spectator_bodies',crowdBodies],['Seated_spectator_heads',crowdHeads]]){
      const mesh=new THREE.InstancedMesh(crowdGeo,new THREE.MeshStandardMaterial({color:0xffffff,roughness:1}),items.length);mesh.name=name;
      items.forEach((item,i)=>{mesh.setMatrixAt(i,item.m);mesh.setColorAt(i,new THREE.Color(item.color));});mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();group.add(mesh);
    }
    status.spectators=crowdHeads.length;
    // Faceted, connected cloud silhouettes: a few broad sky shapes, without particles.
    const outline=[[-4,0],[-4.4,.65],[-3.6,1.2],[-2.6,1.1],[-2.0,2.1],[-.8,2.5],[.25,1.55],[1.5,1.8],[2.4,.8],[3.9,.7],[4.5,0]],verts=[],faces=[];
    for(const depth of [-1,1])for(const [x,y] of outline)verts.push(x,y,depth);
    const n=outline.length;for(let i=1;i<n-1;i++){faces.push(0,i+1,i,n,n+i,n+i+1);}for(let i=0;i<n;i++){const j=(i+1)%n;faces.push(i,j,j+n,i,j+n,i+n);}
    const cloudGeo=new THREE.BufferGeometry();cloudGeo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));cloudGeo.setIndex(faces);cloudGeo.computeVertexNormals();
    const clouds=new THREE.InstancedMesh(cloudGeo,new THREE.MeshBasicMaterial({color:0xf6fbff,side:THREE.DoubleSide,toneMapped:false}),8);clouds.name='Distant_festival_clouds';clouds.castShadow=false;clouds.receiveShadow=false;const cloudDummy=new THREE.Object3D();let cloudIndex=0;
    for(const end of [-1,1])for(const [i,x] of [-29,-11,13,30].entries()){
      cloudDummy.position.set(x,7.8+(i%3)*1.2,end*(40+(i%2)*7));cloudDummy.rotation.y=end<0?0:Math.PI;cloudDummy.scale.setScalar(.64+(i%3)*.18);cloudDummy.updateMatrix();clouds.setMatrixAt(cloudIndex++,cloudDummy.matrix);
    }
    clouds.instanceMatrix.needsUpdate=true;clouds.computeBoundingSphere();group.add(clouds);status.clouds=8;
    // Atmospheric fade belongs only to this decorative group. Preserve opaque
    // depth so distant walls of a house do not show through its front facade.
    const fadedMaterials=new Set();
    group.traverse(o=>{if(!o.isMesh||o.name==='Distant_festival_clouds')return;
      for(const m of (Array.isArray(o.material)?o.material:[o.material])){
        if(fadedMaterials.has(m)||m.isShaderMaterial)continue;fadedMaterials.add(m);
        m.onBeforeCompile=shader=>{
          shader.uniforms.sceneryDistanceHaze={value:new THREE.Color(0xb6d2d7)};
          shader.vertexShader='varying float vSceneryDistance;\n'+shader.vertexShader;
          shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nvSceneryDistance=length(mvPosition.xyz);');
          shader.fragmentShader='uniform vec3 sceneryDistanceHaze;varying float vSceneryDistance;\n'+shader.fragmentShader;
          shader.fragmentShader=shader.fragmentShader.replace('#include <tonemapping_fragment>','gl_FragColor.rgb=mix(gl_FragColor.rgb,sceneryDistanceHaze,.40*smoothstep(32.,85.,vSceneryDistance));\n#include <tonemapping_fragment>');
        };
        m.customProgramCacheKey=()=> 'festival-distance-fade-v2';m.needsUpdate=true;
      }
    });
    status.distanceFade={start:32,end:85,maxBlend:.40};
    status.ready=true;
  }).catch(error=>{console.error(error);status.error=error.message;});
  return status;
}








