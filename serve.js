const http=require('http'),fs=require('fs'),path=require('path');
http.createServer((q,r)=>{
 if(q.method==='POST'){let b=[];q.on('data',d=>b.push(d));q.on('end',()=>{const s=Buffer.concat(b).toString();const n=(q.url.split('name=')[1]||'shot').replace(/[^a-z0-9_]/gi,'');fs.mkdirSync(path.join(__dirname,'shots'),{recursive:true});fs.writeFileSync(path.join(__dirname,'shots',n+'.jpg'),Buffer.from(s.split(',')[1],'base64'));r.writeHead(200);r.end('ok');});return;}
 let p=path.join(__dirname,decodeURIComponent(q.url.split('?')[0]));if(fs.existsSync(p)&&fs.statSync(p).isDirectory())p=path.join(p,'index.html');
 fs.readFile(p,(e,d)=>{if(e){r.writeHead(404);r.end('nf');return;}r.writeHead(200,{'Content-Type':p.endsWith('.html')?'text/html; charset=utf-8':'text/javascript','Cache-Control':'no-store'});r.end(d);});}).listen(8765);
