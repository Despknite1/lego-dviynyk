const { chromium } = require('playwright');const fs=require('fs');
(async()=>{const spec=JSON.parse(fs.readFileSync(process.argv[2]||'/tmp/girl_spec.json'));const tag=process.argv[3]||'v12';const q=process.argv[4]||'';
// rebuild textures via server lib
const mf=require('./lib/minifig.js');spec.textures=mf.textures(spec);
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:1300,height:800},deviceScaleFactor:1.5});p.on('pageerror',e=>console.log('pe',e.message));p.on('console',m=>{if(m.type()==='error')console.log('ce',m.text())});
await p.addInitScript(s=>{window.MINIFIG_SPEC=s},spec);await p.goto('http://localhost:8787/viewer3d.html'+q);await p.waitForFunction(()=>window.READY,null,{timeout:90000});
for(const v of (process.env.VIEWS||'front,three,back,side').split(',')){const bt=await p.$(`[data-v="${v}"]`);if(bt){await bt.click();await p.waitForTimeout(900);}await p.screenshot({path:`test-out/${tag}_${v}.png`,clip:{x:0,y:0,width:1000,height:800}});}
for(const v of (process.env.CVIEWS||'three,front,back').split(',')){await p.$(`[data-v="${v}"]`).then(x=>x.click());await p.waitForTimeout(900);await p.mouse.move(512,230);for(let i=0;i<4;i++){await p.mouse.wheel(0,-250);await p.waitForTimeout(120);}await p.waitForTimeout(1000);await p.screenshot({path:`test-out/${tag}_closeup_${v}.png`,clip:{x:300,y:40,width:430,height:380}});}
await b.close()})()
