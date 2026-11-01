const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {createMultiplayerServer}=require('./server/multiplayer.cjs');
const root=__dirname,production=process.env.NODE_ENV==='production'||!!process.env.RENDER;
const port=Number(process.env.PORT||(production?10000:8018)),host=production?'0.0.0.0':(process.env.HOST||'127.0.0.1');
if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid PORT');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.glb':'model/gltf-binary','.json':'application/json','.png':'image/png'};
const publicFile=pathname=>{
  if(pathname==='/')return 'lobby.html';
  if(pathname==='/index.html')return 'index.html';
  if(pathname==='/lobby.html')return 'lobby.html';
  if(/^\/(src|vendor|assets)\/(?!.*(?:^|\/)\.)[A-Za-z0-9_./-]+$/.test(pathname)&&
    /\.(?:js|css|glb|svg|png)$/.test(pathname)&&!pathname.split('/').includes('..'))return pathname.slice(1);
  return null;
};
const server=http.createServer((req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  if((req.method==='GET'||req.method==='HEAD')&&req.url==='/healthz'){
    res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}).end(req.method==='HEAD'?'':'ok');return;
  }
  if(req.method==='POST'&&req.url==='/api/match-report'){
    if(production){res.writeHead(404).end('Not found');return;}
    if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`){res.writeHead(403).end();return;}
    let chunks=[],size=0;
    req.on('data',chunk=>{size+=chunk.length;if(size>1048576){req.destroy();return;}chunks.push(chunk);});
    req.on('end',()=>{
      try{
        const report=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(report.schema!==1||!Number.isInteger(report.seed)||!report.teams||!Number.isFinite(report.durationSeconds))throw new Error('Invalid match report');
        const name=`match-${Date.now()}-${report.seed}-${Math.random().toString(36).slice(2,7)}.json`;
        const directory=path.join(root,'reports');fs.mkdirSync(directory,{recursive:true});
        fs.writeFileSync(path.join(directory,name),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
        res.writeHead(201,{'Content-Type':'application/json'}).end(JSON.stringify({file:'reports/'+name}));
      }catch{res.writeHead(400).end('Invalid report');}
    });return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
  let file;
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const relative=publicFile(pathname);
    if(!relative){res.writeHead(404).end('Not found');return;}
    file=path.resolve(root,relative);
  }
  catch {res.writeHead(400).end();return;}
  if(!file.startsWith(root+path.sep)){res.writeHead(404).end();return;}
  fs.readFile(file,(error,body)=>{
    if(error){res.writeHead(404).end('Not found');return;}
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(req.method==='HEAD'?'':body);
  });
});
const multiplayer=createMultiplayerServer(server);
if(require.main===module){
  server.listen(port,host,()=>console.log(`Wall Rush lobby: http://${host}:${server.address().port}/`));
  let stopping=false;
  const stop=()=>{
    if(stopping)return;stopping=true;
    multiplayer.close();server.close(()=>process.exit(0));
    setTimeout(()=>process.exit(1),5000).unref();
  };
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
module.exports={server,multiplayer};
