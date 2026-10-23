const { chromium } = require('playwright');const fs=require('fs');
(async()=>{const L=JSON.parse(fs.readFileSync('last_gen.json'));const tag=process.argv[2]||'v17';
const res={detect:{subjects:[{label:'дівчина-покоївка',box_2d:[40,150,980,850]}]},describe:{description:L.description},search:{results:[],close_enough:false,queries:[],candidates_checked:0,message_uk:'(мок для скріншоту)'},generate:L.result};
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
for(const [w,h,t] of [[1300,900,'desk'],[420,900,'mob']]){const p=await b.newPage({viewport:{width:w,height:h}});p.on('pageerror',e=>console.log('pe',e.message));
await p.route('**/api/*',r=>{const ep=r.request().url().split('/api/')[1];r.fulfill({json:{job:ep}})});
await p.route('**/job/*',r=>{const ep=r.request().url().split('/job/')[1];r.fulfill({json:{status:'done',result:res[ep]}})});
await p.goto('http://localhost:8787/');await p.screenshot({path:`test-out/${tag}_ui_landing_${t}.png`,timeout:120000});
await p.setInputFiles('input[type=file]','in_maid.jpg');
await p.waitForSelector('#v3',{timeout:60000});await p.waitForTimeout(2000);
const fr=p.frame({url:/viewer3d/});await fr.waitForFunction(()=>window.READY,null,{timeout:120000});await p.waitForTimeout(1500);
await p.screenshot({path:`test-out/${tag}_ui_full_${t}.png`,fullPage:true,timeout:180000});
await p.evaluate(()=>document.getElementById('v3wrap').scrollIntoView({block:'center'}));await p.waitForTimeout(800);await p.screenshot({path:`test-out/${tag}_ui_viewer_${t}.png`,timeout:180000});await p.close()}
await b.close()})()
