import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import fs from 'node:fs';
const OFFSET = [-2.3, -173.24, -53.7];
const GROUND = /Terrain|Aerial_Grass|Ground_Dirt|Dirt_Road|Cobblestone|Sloped_Rock/i;
const ROAD = /Dirt_Road|Cobblestone/i;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder': await draco3d.createDecoderModule()});
const doc = await io.read('src/assets/models/forest.opt.glb');
const CELL = 4; const terrain = new Map();
const xf=(m,x,y,z)=>[m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],m[2]*x+m[6]*y+m[10]*z+m[14]];
for (const node of doc.getRoot().listNodes()) { const mesh=node.getMesh(); const nm=`${node.getName()} ${mesh?.getName()}`; if(!mesh||!GROUND.test(nm)) continue; const road=ROAD.test(nm); const m=node.getWorldMatrix();
 for (const prim of mesh.listPrimitives()) { const pos=prim.getAttribute('POSITION'); const idx=prim.getIndices(); const n=idx?idx.getCount():pos.getCount(); const p=[0,0,0];
  for (let i=0;i<n;i+=3){ const tri=[]; for(let k=0;k<3;k++){pos.getElement(idx?idx.getScalar(i+k):i+k,p); const w=xf(m,p[0],p[1],p[2]); tri.push([w[0]+OFFSET[0],w[1]+OFFSET[1],w[2]+OFFSET[2]]);} tri.road=road;
   const xs=tri.map(v=>v[0]), zs=tri.map(v=>v[2]);
   for(let a=Math.floor(Math.min(...xs)/CELL);a<=Math.floor(Math.max(...xs)/CELL);a++) for(let b=Math.floor(Math.min(...zs)/CELL);b<=Math.floor(Math.max(...zs)/CELL);b++){const key=`${a},${b}`; let bk=terrain.get(key); if(!bk) terrain.set(key,bk=[]); bk.push(tri);} } } }
function surf(x,z){ const bk=terrain.get(`${Math.floor(x/CELL)},${Math.floor(z/CELL)}`); if(!bk) return null; let best=null, road=false;
 for(const t of bk){const [a,b,c]=t; const d=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]); if(Math.abs(d)<1e-9) continue; const l1=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/d; const l2=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/d; const l3=1-l1-l2; if(l1<-1e-6||l2<-1e-6||l3<-1e-6) continue; const y=l1*a[1]+l2*b[1]+l3*c[1]; if(best===null||y>best){best=y;road=t.road;}}
 return best===null?null:{y:best,road}; }
const trunks=[...fs.readFileSync('src/renderer/scene/environment/ForestColliders.tsx','utf8').matchAll(/\{ pos: \[([-\d.]+), ([-\d.]+), ([-\d.]+)\], args: \[([-\d.]+), ([-\d.]+), ([-\d.]+)\] \}/g)].map(m=>({x:+m[1],y:+m[2],z:+m[3],hx:+m[4],hy:+m[5],hz:+m[6]}));
const TG=new Map(); for(const t of trunks){const k=`${Math.floor(t.x/8)},${Math.floor(t.z/8)}`; if(!TG.has(k)) TG.set(k,[]); TG.get(k).push(t);}
function near(x,z,r){const out=[]; for(let a=Math.floor((x-r)/8);a<=Math.floor((x+r)/8);a++) for(let b=Math.floor((z-r)/8);b<=Math.floor((z+r)/8);b++) for(const t of TG.get(`${a},${b}`)||[]) out.push(t); return out;}
function clear(x,y,z){let best=Infinity; for(const t of near(x,z,12)){const dx=Math.max(0,Math.abs(x-t.x)-t.hx),dy=Math.max(0,Math.abs(y-t.y)-t.hy),dz=Math.max(0,Math.abs(z-t.z)-t.hz); best=Math.min(best,Math.hypot(dx,dy,dz));} return best;}
// road distance field (coarse)
const roadPts=[]; for(let x=-128;x<=128;x+=2) for(let z=-148;z<=64;z+=2){const s=surf(x,z); if(s&&s.road) roadPts.push([x,z]);}
const RG=new Map(); for(const p of roadPts){const k=`${Math.floor(p[0]/10)},${Math.floor(p[1]/10)}`; if(!RG.has(k)) RG.set(k,[]); RG.get(k).push(p);}
function roadDist(x,z){let best=99; for(let a=Math.floor((x-20)/10);a<=Math.floor((x+20)/10);a++) for(let b=Math.floor((z-20)/10);b<=Math.floor((z+20)/10);b++) for(const p of RG.get(`${a},${b}`)||[]) best=Math.min(best,Math.hypot(p[0]-x,p[1]-z)); return best;}
function density(x,z){return near(x,z,8).filter(t=>Math.hypot(t.x-x,t.z-z)<8).length;}
function droneSpot(x,z,g){ // hover point within 3-8 m horizontal, 3-6 m up, clearance >= 1.5
 for(const r of [4,6,8]) for(let k=0;k<12;k++){const a=k*Math.PI/6; const hx=x+Math.cos(a)*r, hz=z+Math.sin(a)*r; for(const h of [3,4.5,6]){ const range=Math.hypot(r,h); if(range<4.5||range>8.5) continue; if(clear(hx,g+h,hz)>=1.5) return true;}} return false;}
function nodeOk(x,z){const s=surf(x,z); if(!s||s.road) return null; if(roadDist(x,z)<7) return null; const c=clear(x,s.y+0.5,z); if(c<1.0) return null; const s2=surf(x+1,z), s3=surf(x,z+1); if(!s2||!s3) return null; if(Math.abs(s2.y-s.y)>0.45||Math.abs(s3.y-s.y)>0.45) return null; if(density(x,z)<5) return null; if(!droneSpot(x,z,s.y)) return null; return {y:s.y,dens:density(x,z)};}
function segOk(ax,az,ay,bx,bz){const L=Math.hypot(bx-ax,bz-az); let prev=ay; for(let d=0.5; d<L; d+=0.5){const x=ax+(bx-ax)*d/L, z=az+(bz-az)*d/L; const s=surf(x,z); if(!s||s.road) return false; if(Math.abs(s.y-prev)>0.4) return false; prev=s.y; if(clear(x,s.y+0.5,z)<0.8) return false;} return true;}
const STEP=5; const cand=new Map();
for(let x=-120;x<=120;x+=STEP) for(let z=-140;z<=55;z+=STEP){const r=Math.hypot(x,z); if(r<35||r>100) continue; const n=nodeOk(x,z); if(n) cand.set(`${x},${z}`,{x,z,...n});}
console.log('candidates',cand.size,'roadPts',roadPts.length);
// longest chains via DFS with turn <= 60deg
const dirs=[]; for(let dx=-1;dx<=1;dx++) for(let dz=-1;dz<=1;dz++) if(dx||dz) dirs.push([dx*STEP,dz*STEP]);
let best=[];
function dfs(path,len){ if(path.length>=9){ best.push({path:[...path],len}); return; } let ext=false; const last=path[path.length-1];
 for(const [dx,dz] of dirs){ const k=`${last.x+dx},${last.z+dz}`; const n=cand.get(k); if(!n||path.includes(n)) continue;
  if(path.length>=2){const p=path[path.length-2]; const v1=[last.x-p.x,last.z-p.z], v2=[dx,dz]; const cos=(v1[0]*v2[0]+v1[1]*v2[1])/Math.hypot(...v1)/Math.hypot(...v2); if(cos<0.49) continue;}
  if(!segOk(last.x,last.z,last.y,n.x,n.z)) continue; ext=true; path.push(n); dfs(path,len+Math.hypot(dx,dz)); path.pop(); if(best.length>4000) return; }
 if(!ext && path.length>=6) best.push({path:[...path],len}); }
for(const n of cand.values()){ dfs([n],0); }
best.sort((a,b)=>b.len-a.len || b.path.reduce((s,p)=>s+p.dens,0)-a.path.reduce((s,p)=>s+p.dens,0));
// pick distinct regions
const picked=[]; for(const r of best){ const c=[r.path.reduce((s,p)=>s+p.x,0)/r.path.length, r.path.reduce((s,p)=>s+p.z,0)/r.path.length]; if(picked.every(q=>Math.hypot(q.c[0]-c[0],q.c[1]-c[1])>45)) picked.push({...r,c}); if(picked.length>=6) break; }
for(const p of picked){ console.log(`\ncentre (${p.c.map(v=>v.toFixed(0))}) dist ${Math.hypot(...p.c).toFixed(0)} len ${p.len.toFixed(1)} nodes ${p.path.length}`); for(const n of p.path) console.log(`  { at: [${n.x}, ${n.z}], ground: ${n.y.toFixed(2)} }  dens ${n.dens} road ${roadDist(n.x,n.z).toFixed(0)}m clear ${clear(n.x,n.y+0.5,n.z).toFixed(1)}`); }
