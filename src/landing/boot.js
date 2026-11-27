export function bootLanding(){
{
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ic=n=>`<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const val=v=>typeof v==='function'?v():v;
const clone=o=>JSON.parse(JSON.stringify(o));
const store={get(k,d){try{const v=localStorage.getItem('mendcraft:'+k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem('mendcraft:'+k,JSON.stringify(v))}catch(e){}}};
const T0=Date.now(),ago=m=>T0-m*60000;
const clock=t=>new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
const and=a=>a.length<2?a.join(''):a.slice(0,-1).join(', ')+' and '+a[a.length-1];
const plural=(n,w,ws)=>`${n} ${n===1?w:(ws||w+'s')}`;
const ease=p=>p<.5?2*p*p:1-((-2*p+2)**2)/2;
const tween=(ms,f,done)=>{const t0=performance.now();const fr=t=>{const p=Math.min(1,(t-t0)/Math.max(1,ms));f(ease(p));if(p<1)requestAnimationFrame(fr);else if(done)done()};requestAnimationFrame(fr)};
const RM=()=>P.reduce||matchMedia('(prefers-reduced-motion: reduce)').matches;

/* preferences */
const P0={dwell:800,tap:56,smooth:50,ui:'en',speak:'auto',capKn:true,capEn:true,cap:22,units:'m',reduce:false,local:false,gest:{pinch:'click',hold:'grab',palm:'listen',mid:'undo',fist:'cancel',tilt:'scroll'}};
const saved=store.get('prefs',{});
const P=Object.assign({},P0,saved);P.gest=Object.assign({},P0.gest,saved.gest||{});
const saveP=()=>store.set('prefs',P);
const fmt=m=>{if(P.units==='m')return `${m.toFixed(1)} m`;const ti=Math.round(m*39.3701);return `${Math.floor(ti/12)}′ ${ti%12}″`};
const toU=m=>P.units==='m'?m:m*3.28084, fromU=v=>P.units==='m'?v:v/3.28084;
const areaN=a=>P.units==='m'?a.toFixed(1):String(Math.round(a*10.7639));
const areaU=()=>P.units==='m'?'m²':'ft²';

/* sample data */
const G0={rooms:[
 {id:'living',name:'Living room',x:0,y:0,w:5,h:4.2},{id:'kitchen',name:'Kitchen',x:5,y:0,w:3,h:2.8},{id:'dining',name:'Dining',x:5,y:2.8,w:3,h:1.4},
 {id:'bedroom',name:'Bedroom',x:0,y:4.2,w:4,h:3.2},{id:'bath',name:'Bath',x:4,y:4.2,w:2,h:2},{id:'store',name:'Store',x:4,y:6.2,w:2,h:1.2},{id:'balcony',name:'Balcony',x:6,y:4.2,w:2,h:3.2}],
 doors:[{room:'living',side:'w',at:1.4,w:1},{room:'kitchen',side:'w',at:1.2,w:.9},{room:'bedroom',side:'n',at:2.6,w:.9},{room:'bath',side:'n',at:.5,w:.8},{room:'balcony',side:'w',at:1.2,w:.9},{room:'store',side:'w',at:.2,w:.8}],
 windows:[{room:'living',side:'n',at:1.4,w:1.8},{room:'kitchen',side:'n',at:.9,w:1.2},{room:'bedroom',side:'w',at:1,w:1.4},{room:'bedroom',side:'s',at:1.2,w:1.4},{room:'balcony',side:'e',at:.6,w:2}]};
const TRACKS=[{t:'Rain on the window',a:'Focus playlist'},{t:'Slow river',a:'Focus playlist'},{t:'Morning raga on flute',a:'Focus playlist'}];
const DEV={laptop:{name:'Studio laptop',sub:'Chrome on desktop, editing the ground floor plan',model:'Gemini Nano ready'},ipad:{name:'Studio iPad',sub:'Chrome on iPad, editing the ground floor plan',model:'No on-device model'},phone:{name:'Pixel phone',sub:'Chrome on Android, working as a remote',model:'No on-device model'}};
const JOB={
 en:{where:'device',eng:'nano',why:'English command → on device',need:'English command'},
 summary:{where:'device',eng:'nano',why:'Private summary → on device',need:'Summary'},
 local:{where:'device',eng:'local',why:'No AI needed'},
 kn:{where:'cloud',eng:'cloud',why:'Kannada detected → cloud',need:'Non-English speech',kind:'voice'},
 render:{where:'cloud',eng:'cloud',why:'Big render → cloud',need:'Room render',kind:'job'},
 sketch:{where:'cloud',eng:'cloud',why:'Photo cleanup → cloud',need:'Sketch photo',kind:'image'},
 gen:{where:'cloud',eng:'cloud',why:'Whole screen from a description → cloud',need:'Screen draft',kind:'job'},
 shape:{where:'cloud',eng:'cloud',why:'Shape suggestions → cloud',need:'Shape suggestions',kind:'job'},
 a11y:{where:'cloud',eng:'cloud',why:'Accessibility check → cloud',need:'Accessibility check',kind:'job'},
 note:{where:'cloud',eng:'cloud',why:'Long writing → cloud',need:'Cover note',kind:'text'}};

const S={screen:'landing',online:true,device:'laptop',mode:'plan',tool:'select',hands:true,listening:true,
 G:clone(G0),sel:'bedroom',ui:{sel:'cta',btnH:56},part:{grip:38,len:90},hist:[],fut:[],edits:9,over:[],lf:'all',
 lamp:{on:true,level:70},music:{playing:true,i:0,pos:38},queue:[],playing:null,pstep:0,teach:{mode:'idle',steps:[]},
 last:{eng:'cloud',why:'Kannada detected → cloud'},stay:{en:23,sum:6},
 feed:[
  {t:ago(6),eng:'cloud',what:'Added a window to the bedroom',why:'Kannada detected → cloud',call:'plan.addWindow("bedroom")'},
  {t:ago(7),eng:'hand',what:'Selected the bedroom',why:'Hand points stay on this device'},
  {t:ago(11),eng:'nano',what:'Zoomed to fit the plan',why:'English command → on device',call:'view.zoomToFit()'},
  {t:ago(18),eng:'cloud',what:'Rendered a preview of the living room',why:'Big render → cloud',call:'render.preview("living")'},
  {t:ago(24),eng:'nano',what:'Summarised this morning’s changes',why:'Private summary → on device',call:'notes.summarise("morning")'},
  {t:ago(31),eng:'nano',what:'Tuned the hand cursor to your movement',why:'Hand-adaptive input → on device',call:'input.tune(0.8, 0.5)'},
  {t:ago(34),eng:'cloud',what:'Turned a sketch photo into walls',why:'Photo cleanup → cloud',call:'plan.importSketch(photo)'},
  {t:ago(41),eng:'cloud',what:'Sent from the queue: moved the kitchen wall',why:'Back online, so the queue sent it',call:'plan.moveWall("kitchen", +0.3)'}],
 ledger:[
  {t:ago(6),kind:'voice',title:'Kannada command, as text',detail:'Text only. No audio.',heard:'ಮಲಗುವ ಕೋಣೆಗೆ ಒಂದು ಕಿಟಕಿ ಸೇರಿಸು',why:'Kannada detected → cloud',secs:3.4,kb:54},
  {t:ago(18),kind:'job',title:'Room preview render',detail:'Room outlines, sizes and finishes for the living room. No photos, no camera video.',why:'Big render → cloud',kb:212},
  {t:ago(34),kind:'image',title:'Sketch photo',detail:'One photo of a paper sketch.',why:'Photo cleanup → cloud',kb:380},
  {t:ago(41),kind:'voice',title:'Kannada command, as text',detail:'Text only. No audio.',heard:'ಅಡುಗೆಮನೆಯ ಗೋಡೆ ಸರಿಸು',why:'Kannada detected → cloud',secs:2.1,kb:34,fromQ:true},
  {t:ago(52),kind:'voice',title:'Kannada command, as text',detail:'Text only. No audio.',heard:'ವಾಸದ ಕೋಣೆಯನ್ನು ಅಳತೆ ಮಾಡು',why:'Kannada detected → cloud',secs:2.8,kb:45}],
 recipes:[
  {id:'morning',name:'Morning setup',say:'Good morning, Mendcraft',kn:'ಶುಭೋದಯ',gesture:'Or an open palm, held for 1 second',used:14,steps:[{t:'Open the last project'},{t:'Set the lamp to 70%',fx:'lamp70'},{t:'Play the Focus playlist',fx:'play'},{t:'Read out yesterday’s changes'}]},
  {id:'bath',name:'Add my standard bathroom',say:'Add my bathroom',kn:'ನನ್ನ ಬಚ್ಚಲುಮನೆ ಸೇರಿಸು',gesture:'Or pinch twice',used:6,steps:[{t:'Draw a 2.4 × 1.8 m room beside the plan',fx:'bath'},{t:'Add a 0.8 m door on the longest wall'},{t:'Add a 0.6 m window'},{t:'Name it “Bath 2”'}]},
  {id:'send',name:'Send to the contractor',say:'Send this to the contractor',kn:'ಇದನ್ನು ಗುತ್ತಿಗೆದಾರರಿಗೆ ಕಳುಹಿಸು',gesture:'No gesture set',used:3,steps:[{t:'Export a PDF with all measurements'},{t:'Write a short cover note',cloud:'note'},{t:'Open a new email in the browser'}]},
  {id:'wind',name:'Wind down',say:'That’s enough for today',kn:'ಇವತ್ತಿಗೆ ಸಾಕು',gesture:'Or a soft fist, held for 1 second',used:21,steps:[{t:'Save the project'},{t:'Dim the lamp to 20%',fx:'lamp20'},{t:'Pause the music',fx:'pause'},{t:'Turn off hand tracking'}]}]};

/* helpers */
const room=id=>S.G.rooms.find(r=>r.id===id)||S.G.rooms[0];
const snap=()=>JSON.stringify({G:S.G,ui:S.ui,part:S.part,sel:S.sel});
const restore=s=>{const o=JSON.parse(s);S.G=o.G;S.ui=o.ui;S.part=o.part;S.sel=o.sel};
const edit=()=>{S.hist.push(snap());if(S.hist.length>60)S.hist.shift();S.fut=[];S.edits++};
const SIG={nano:['dev','Gemini Nano · on device'],cloud:['cloud','Gemini · cloud'],queue:['queue','Queued for Gemini · cloud'],local:['local','On device · no AI'],hand:['local','On device · hand tracker']};
const sigC=e=>(SIG[e]||SIG.local)[0];
const sigT=e=>(SIG[e]||SIG.local)[1];
const sigHTML=e=>`<span class="sig ${sigC(e)}">${sigT(e)}</span>`;
let toastT=0;
function toast(m){const t=$('#toast');t.hidden=true;t.textContent=m;void t.offsetWidth;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,3800)}
function announce(m){const r=$('#sr');r.textContent='';setTimeout(()=>r.textContent=m,60)}
const KEEP=['gx','in','step','qa','lf','copy','lamp','music','replay','act','tool','dev','teach','qnet','emode'];
function keep(el,fn){const a=document.activeElement;let sel=null;if(a&&el.contains(a)&&a.dataset){for(const k of KEEP)if(a.dataset[k]!==undefined){sel=`[data-${k}="${a.dataset[k]}"]`;break}}fn();if(sel){const n=el.querySelector(sel);if(n)n.focus()}}

/* router */
const cloudOK=()=>S.online&&!P.local;
const devWord=()=>S.device==='ipad'?'iPad':'this phone';
function decide(type){
 const j=JOB[type];let where=j.where,why=j.why,eng=j.eng;
 if(eng==='nano'&&S.device!=='laptop'){where='cloud';eng='cloud';why=`No Gemini Nano on ${devWord()} → cloud`}
 if(where==='cloud'&&!cloudOK())return{where:'queue',eng:'queue',why:`${j.need||'Request'} → queue (${!S.online?'offline':'cloud paused'})`};
 return{where,why,eng};
}
function addFeed(eng,what,why,call){S.feed.unshift({t:Date.now(),eng,what,why,call:call||''});if(S.feed.length>40)S.feed.pop()}
function addLedger(r,d,fromQ){
 const kind=r.kind||JOB[r.type].kind||(r.lang?'voice':'text');let title=r.ltitle||r.label,detail=r.ldetail||'',kb=r.kb||({job:212,image:360,text:2}[kind]||2),secs=0;
 if(kind==='voice'){secs=r.secs||1.4;title=`${r.lang==='kn'?'Kannada':'English'} command, as text`;detail='Text only. No audio.';kb=1}
 const e={t:Date.now(),kind,title,detail,heard:r.lang==='kn'?r.said:null,why:d.why,secs,kb,fromQ:!!fromQ,fresh:true};S.ledger.unshift(e);
 setTimeout(()=>{e.fresh=false},2400);
}
function run(r,o={}){
 const d=o.forced||decide(r.type);
 S.last={eng:d.eng,why:d.why};const call=val(r.call)||'';
 if(d.where==='queue'){S.queue.push(Object.assign({},r,{qt:Date.now(),qwhy:d.why}));addFeed('queue',`Waiting: ${r.label}`,d.why,call);toast(`Queued: ${r.label}. It will send itself when you’re back online.`);render();return d}
 if(d.where==='cloud')addLedger(r,d,o.fromQueue);else if(r.type==='en')S.stay.en++;else if(r.type==='summary')S.stay.sum++;
 const done=r.act?r.act():null;
 addFeed(d.eng,(o.fromQueue?'Sent from the queue: ':'')+(done||r.label),d.why,call);
 render();return d;
}
let flushing=false;
function flush(){
 if(flushing||!S.queue.length)return;flushing=true;
 const step=()=>{if(!cloudOK()||!S.queue.length){flushing=false;render();return}
  const r=S.queue.shift();run(r,{forced:decide(r.type),fromQueue:true});toast(`Sent from the queue: ${r.label}`);setTimeout(step,RM()?500:1300)};
 setTimeout(step,600);
}
function summary(){
 const L=S.ledger;if(!L.length)return 'Nothing has left this device today. Everything ran here.';
 const v=L.filter(e=>e.kind==='voice'),im=L.filter(e=>e.kind==='image'),jb=L.filter(e=>e.kind==='job'),tx=L.filter(e=>e.kind==='text');const parts=[];
 if(v.length)parts.push(`${plural(v.length,'spoken command')} as text (no audio)`);
 if(im.length)parts.push(plural(im.length,'sketch photo'));if(jb.length)parts.push(plural(jb.length,'big job'));if(tx.length)parts.push(plural(tx.length,'text request'));
 return `Today, ${plural(L.length,'thing')} left this device: ${and(parts)}. Your camera video and hand movements never left.`;
}

/* actions */
function growKitchen(){edit();const k=room('kitchen');k.w=+Math.min(6,k.w+.5).toFixed(1);S.sel='kitchen';if(S.screen==='editor'&&S.mode!=='plan')toast('Changed the kitchen in the floor plan.');return `Made the kitchen wider, now ${fmt(k.w)}`}
function addOpening(id,list,w){const r=room(id);const used=[...S.G.doors,...S.G.windows].filter(o=>o.room===id).map(o=>o.side);const side=['s','n','e','w'].find(s=>!used.includes(s))||'s';const len=side==='n'||side==='s'?r.w:r.h;const ww=Math.min(w,len-.4);edit();S.G[list].push({room:id,side,at:+((len-ww)/2).toFixed(2),w:ww});S.sel=id;return r}
const addDoor=id=>`Added a door to the ${addOpening(id,'doors',.9).name.toLowerCase()}`;
const addWindow=id=>`Added a window to the ${addOpening(id,'windows',1.2).name.toLowerCase()}`;
function setLamp(v){S.lamp.on=v>0;S.lamp.level=Math.max(0,Math.min(100,v));return v>0?`Set the desk lamp to ${S.lamp.level}%`:'Turned off the desk lamp'}
function toggleMusic(){S.music.playing=!S.music.playing;return S.music.playing?'Played the music':'Paused the music'}
function undo(){if(!S.hist.length){toast('Nothing to undo yet.');return 'Nothing to undo'}S.fut.push(snap());restore(S.hist.pop());toast('Undone.');render();return 'Undid the last change'}
function redo(){if(!S.fut.length){toast('Nothing to redo.');return 'Nothing to redo'}S.hist.push(snap());restore(S.fut.pop());toast('Redone.');render();return 'Redid the change'}
function changesSummary(){const k=room('kitchen'),tot=S.G.rooms.reduce((a,r)=>a+r.w*r.h,0);return `Today: ${S.edits} edits. The kitchen is ${fmt(k.w)} by ${fmt(k.h)}, the plan has ${S.G.doors.length} doors and ${S.G.windows.length} windows, and the floor is ${areaN(tot)} ${areaU()}.`}
function addBath(){edit();const x1=Math.max(...S.G.rooms.map(r=>r.x+r.w));const n=S.G.rooms.filter(r=>/^Bath \d/.test(r.name)).length+2;const id='bath'+n;S.G.rooms.push({id,name:'Bath '+n,x:x1,y:4.2,w:2.4,h:1.8});S.G.doors.push({room:id,side:'w',at:.5,w:.8});S.G.windows.push({room:id,side:'e',at:.6,w:.6});S.sel=id}
const FX={lamp70:()=>setLamp(70),lamp20:()=>setLamp(20),lamp50:()=>setLamp(50),play:()=>{S.music.playing=true},pause:()=>{S.music.playing=false},bath:addBath};
const MORE={
 render:{type:'render',label:'Room preview render',ltitle:'Room preview render',ldetail:'Room outlines, sizes and finishes. No photos, no camera video.',kb:212,call:'render.preview("living")',act:()=>{toast('A photoreal preview of the living room is ready beside the plan.');return 'Rendered a preview of the living room'}},
 sketch:{type:'sketch',label:'Sketch photo',ltitle:'Sketch photo',ldetail:'One photo of a paper sketch.',kb:360,call:'plan.importSketch(photo)',act:()=>{toast('Sketch read: 4 walls and 1 door, on a new layer ready to place.');return 'Turned a sketch photo into walls'}},
 summary:{type:'summary',label:'Summary of today’s changes',call:'notes.summarise("today")',act:()=>{toast(changesSummary());return 'Summarised today’s changes'}},
 gen:{type:'gen',label:'Screen description',ltitle:'Screen description',ldetail:'“A sign-up screen for a physiotherapy clinic”, as text.',kb:1,call:'screen.draft("sign-up")',act:()=>{toast('A draft sign-up screen is ready beside this one.');return 'Drafted a sign-up screen'}},
 shape:{type:'shape',label:'Part outline',ltitle:'Part outline',ldetail:'The key turner’s outline and sizes.',kb:6,call:'part.suggestShapes()',act:()=>{toast('Three stronger shapes are ready to compare.');return 'Suggested stronger shapes'}},
 check:{type:'a11y',label:'Accessibility check',ltitle:'Screen for an accessibility check',ldetail:'The booking screen’s layout, text and colours, as structure. No photos.',kb:4,call:'a11y.review("booking")',act:()=>{toast('Accessibility check: all text passes AA, every target is at least 44 px, and the phone field needs a visible label.');return 'Checked the screen for accessibility'}},
 print:{type:'local',label:'Printability check',act:()=>{toast('Prints without supports. The thinnest wall is 2.4 mm.');return 'Checked printability'}},
 pdf:{type:'local',label:'PDF export',act:()=>{toast('PDF ready. In this prototype, files aren’t downloaded.');return 'Exported a PDF with measurements'}},
 html:{type:'local',label:'HTML export',act:()=>{toast('HTML ready. In this prototype, files aren’t downloaded.');return 'Exported HTML'}},
 stl:{type:'local',label:'STL export',act:()=>{toast('STL ready. In this prototype, files aren’t downloaded.');return 'Exported an STL file'}}};
const ACTIONS={plan:[['render','cube','Render a photoreal room preview'],['sketch','wand','Turn a sketch photo into walls'],['summary','summary','Summarise today’s changes'],['pdf','export','Export a PDF with measurements'],['grid','grid','Show or hide the grid'],['layers','layers','Layers']],
 ui:[['gen','wand','Generate a screen from a description'],['check','contrast','Check this screen for accessibility'],['html','export','Export HTML'],['grid','grid','Show or hide the grid']],
 part:[['shape','cube','Suggest a stronger shape'],['print','check','Check printability'],['stl','export','Export for 3D printing (STL)'],['grid','grid','Show or hide the grid']]};
function doAct(id){closeMenus();if(id==='grid'){$('#canvas').classList.toggle('nogrid');toast('Grid toggled.');return}if(id==='layers'){toast('Layers: walls, doors and windows, labels, sketch import.');return}if(MORE[id])run(Object.assign({},MORE[id]))}

/* speech */
const PH=[
 {id:'k',lang:'en',said:'Make the kitchen a bit bigger',tr:'ಅಡುಗೆಮನೆಯನ್ನು ಸ್ವಲ್ಪ ದೊಡ್ಡದು ಮಾಡು',type:'en',call:'plan.resizeRoom("kitchen", +0.5)',act:()=>()=>growKitchen()},
 {id:'d',lang:'kn',said:'ಇಲ್ಲಿ ಒಂದು ಬಾಗಿಲು ಸೇರಿಸು',tr:'Add a door here',type:'kn',secs:2.4,call:()=>`plan.addDoor("${S.sel}")`,act:()=>{const id=S.sel;return()=>addDoor(id)}},
 {id:'l',lang:'kn',said:'ದೀಪದ ಬೆಳಕು ಕಡಿಮೆ ಮಾಡು',tr:'Dim the lamp',type:'kn',secs:2.1,call:'lamp.setBrightness(30)',act:()=>()=>setLamp(30)},
 {id:'m',lang:'en',said:()=>S.music.playing?'Pause the music':'Play the music',tr:()=>S.music.playing?'ಹಾಡನ್ನು ನಿಲ್ಲಿಸು':'ಹಾಡನ್ನು ಮುಂದುವರಿಸು',type:'en',call:()=>S.music.playing?'music.pause()':'music.play()',act:()=>()=>toggleMusic()},
 {id:'r',lang:'en',said:'Render a preview of the living room',tr:'ವಾಸದ ಕೋಣೆಯ ಚಿತ್ರ ತಯಾರಿಸು',type:'render',call:'render.preview("living")',act:()=>MORE.render.act},
 {id:'s',lang:'kn',said:'ಇಂದಿನ ಬದಲಾವಣೆಗಳ ಸಾರಾಂಶ ಕೊಡು',tr:'Summarise today’s changes',type:'kn',secs:2.6,call:'notes.summarise("today")',act:()=>()=>{toast(changesSummary());return 'Summarised today’s changes'}},
 {id:'u',lang:'en',said:'Undo',tr:'ರದ್ದುಮಾಡು',type:'en',call:'edit.undo()',act:()=>()=>undo()}];
let sayT=0;
function say(p){
 closeMenus();clearTimeout(sayT);if(!S.listening)setListening(true);
 const said=val(p.said),tr=val(p.tr),kn=p.lang==='kn';
 const own=kn?$('#txKn'):$('#txEn'),oth=kn?$('#txEn'):$('#txKn');
 const words=said.split(' ');let i=0;const act=p.act(),call=val(p.call);
 own.classList.remove('wait');oth.classList.add('wait');oth.textContent='…';own.textContent='';
 const finish=()=>{
  const req={type:p.type,lang:p.lang,said,secs:p.secs,call,label:kn?'Kannada command, as text':said,
   act:()=>{const d=act();if(own.textContent===said){oth.textContent=tr;oth.classList.remove('wait')}else if(kn)toast(`Translated: ${tr}`);return d}};
  if(p.type==='render')Object.assign(req,{label:'Room preview render',ltitle:MORE.render.ltitle,ldetail:MORE.render.ldetail,kb:212});
  const d=run(req);
  if(d.where==='queue'){if(kn){oth.textContent='Waiting for a connection to translate. English and gestures still work.'}else{oth.textContent=tr;oth.classList.remove('wait')}}
  announce(`Heard${kn?' in Kannada':''}: ${kn?tr:said}. ${sigT(d.eng)}, ${d.why}.${call?' Gemini picked '+call+'.':''}`);
 };
 const step=()=>{i++;own.textContent=words.slice(0,i).join(' ');sayT=setTimeout(i<words.length?step:finish,RM()?80:240)};
 step();
}
function setListening(v){S.listening=v;$('#mic').setAttribute('aria-pressed',String(v));
 if(!v){$('#txKn').textContent='ಕೇಳುತ್ತಿಲ್ಲ';$('#txEn').textContent='Not listening. Pinch the microphone or show an open palm to start.';$('#txKn').classList.add('wait');$('#txEn').classList.add('wait')}
 else if($('#txEn').textContent.startsWith('Not listening')){$('#txKn').textContent='ಕೇಳುತ್ತಿದ್ದೇನೆ…';$('#txEn').textContent='Listening…'}
 renderTV()}

/* drawing: plan, screen and part */
const bounds=rs=>{let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;rs.forEach(r=>{x0=Math.min(x0,r.x);y0=Math.min(y0,r.y);x1=Math.max(x1,r.x+r.w);y1=Math.max(y1,r.y+r.h)});return{x0,y0,x1,y1}};
function drawPlan(svg,G,o={}){
 const W=svg.clientWidth,H=svg.clientHeight;if(!W||!H)return null;
 const b=bounds(G.rooms),pad=o.pad??56,pl=o.padL??pad,pb=o.padB??pad,bw=b.x1-b.x0,bh=b.y1-b.y0;
 const k=Math.max(8,Math.min((W-pl-pad)/bw,(H-pad-pb)/bh));
 const ox=pl+(W-pl-pad-bw*k)/2-b.x0*k,oy=pad+(H-pad-pb-bh*k)/2-b.y0*k;
 const X=x=>+(ox+x*k).toFixed(1),Y=y=>+(oy+y*k).toFixed(1);
 const R=id=>G.rooms.find(r=>r.id===id),wall=Math.max(2.5,Math.min(5,k*.08));
 const seg=(r,side,at,w)=>side==='n'?[X(r.x+at),Y(r.y),X(r.x+at+w),Y(r.y)]:side==='s'?[X(r.x+at),Y(r.y+r.h),X(r.x+at+w),Y(r.y+r.h)]:side==='w'?[X(r.x),Y(r.y+at),X(r.x),Y(r.y+at+w)]:[X(r.x+r.w),Y(r.y+at),X(r.x+r.w),Y(r.y+at+w)];
 let s='';
 G.rooms.forEach(r=>{const sel=o.sel===r.id;s+=`<g class="rm" data-room="${r.id}"${o.live?` tabindex="0" role="button" aria-pressed="${sel}" aria-label="${esc(r.name)}, ${fmt(r.w)} by ${fmt(r.h)}"`:''}><rect x="${X(r.x)}" y="${Y(r.y)}" width="${(r.w*k).toFixed(1)}" height="${(r.h*k).toFixed(1)}" fill="${sel?'var(--acc-soft)':'var(--panel)'}" stroke="var(--ink)" stroke-width="${wall}"/></g>`});
 G.windows.forEach(wd=>{const r=R(wd.room);if(!r)return;const[x1,y1,x2,y2]=seg(r,wd.side,wd.at,wd.w),h=wd.side==='n'||wd.side==='s';
  s+=`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--panel)" stroke-width="${wall+5}"/>`;
  [-3.5,0,3.5].forEach(f=>{s+=`<line x1="${x1+(h?0:f)}" y1="${y1+(h?f:0)}" x2="${x2+(h?0:f)}" y2="${y2+(h?f:0)}" stroke="var(--ink)" stroke-width="1.2"/>`})});
 G.doors.forEach(dr=>{const r=R(dr.room);if(!r)return;const[x1,y1,x2,y2]=seg(r,dr.side,dr.at,dr.w),L=+(dr.w*k).toFixed(1);let lf,arc;
  if(dr.side==='n'){lf=[x1,y1+L];arc=`M${x2} ${y2}A${L} ${L} 0 0 1 ${x1} ${y1+L}`}
  else if(dr.side==='s'){lf=[x1,y1-L];arc=`M${x2} ${y2}A${L} ${L} 0 0 0 ${x1} ${y1-L}`}
  else if(dr.side==='w'){lf=[x1+L,y1];arc=`M${x2} ${y2}A${L} ${L} 0 0 0 ${x1+L} ${y1}`}
  else{lf=[x1-L,y1];arc=`M${x2} ${y2}A${L} ${L} 0 0 1 ${x1-L} ${y1}`}
  s+=`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--panel)" stroke-width="${wall+2}"/><path d="${arc}" fill="none" stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="3 3"/><line x1="${x1}" y1="${y1}" x2="${lf[0]}" y2="${lf[1]}" stroke="var(--ink)" stroke-width="2"/>`});
 G.rooms.forEach(r=>{const w=r.w*k,h=r.h*k,cx=X(r.x+r.w/2),cy=Y(r.y+r.h/2);let fs=o.small?14:15;if(r.name.length*fs*.56>w-12)fs=13;if(r.name.length*fs*.56>w-8||h<30)return;const dims=w>96&&h>62;
  s+=`<text class="lb" x="${cx}" y="${dims?cy-3:cy+5}" text-anchor="middle" font-size="${fs}" font-weight="500" fill="var(--ink)">${esc(r.name)}</text>`;
  if(dims)s+=`<text class="lb" x="${cx}" y="${cy+16}" text-anchor="middle" font-size="13" fill="var(--ink-3)" style="font-family:var(--f-m)">${fmt(r.w)} × ${fmt(r.h)}</text>`});
 const sr=o.sel&&R(o.sel);
 if(sr){const x0=X(sr.x),y0=Y(sr.y),x1=X(sr.x+sr.w),y1=Y(sr.y+sr.h),dy=y0-22;
  s+=`<rect x="${x0-7}" y="${y0-7}" width="${x1-x0+14}" height="${y1-y0+14}" rx="4" fill="none" stroke="var(--acc-mark)" stroke-width="1.5" stroke-dasharray="6 4" pointer-events="none"/>`;
  [[x0,y0],[x1,y0],[x0,y1],[x1,y1]].forEach(([a,c])=>{s+=`<rect x="${a-5}" y="${c-5}" width="10" height="10" rx="2" fill="var(--panel)" stroke="var(--acc-mark)" stroke-width="2" pointer-events="none"/>`});
  if(dy>14)s+=`<g pointer-events="none" stroke="var(--acc-mark)" stroke-width="1"><line x1="${x0}" y1="${dy}" x2="${x1}" y2="${dy}"/><line x1="${x0}" y1="${dy-5}" x2="${x0}" y2="${dy+5}"/><line x1="${x1}" y1="${dy-5}" x2="${x1}" y2="${dy+5}"/></g><text class="lb" x="${(x0+x1)/2}" y="${dy-7}" text-anchor="middle" font-size="13" fill="var(--acc)" style="font-family:var(--f-m)">${fmt(sr.w)}</text>`;
 }
 svg.innerHTML=s;return{X,Y,k};
}
function drawUI(svg,o={}){
 const W=svg.clientWidth,H=svg.clientHeight;if(!W||!H)return;
 const Hs=H-(o.padB||0),fw=Math.min(W-40,460),fh=Math.min(Hs-32,640),x=(W-fw)/2,y=(Hs-fh)/2,p=24,bh=o.btnH||56;
 let s=`<rect x="${x}" y="${y}" width="${fw}" height="${fh}" rx="14" fill="var(--panel)" stroke="var(--ink)" stroke-width="1.5"/><line x1="${x}" y1="${y+56}" x2="${x+fw}" y2="${y+56}" stroke="var(--line)"/><circle cx="${x+p+8}" cy="${y+28}" r="8" fill="none" stroke="var(--ink)" stroke-width="1.5"/><circle cx="${x+p+8}" cy="${y+28}" r="2.6" fill="var(--ink)"/><text x="${x+p+26}" y="${y+33}" font-size="16" font-weight="500" fill="var(--ink)">Sunrise Physio</text>`;
 if(fw>380)s+=`<text x="${x+fw-p-56}" y="${y+33}" text-anchor="end" font-size="14" fill="var(--ink-3)">Visits</text><text x="${x+fw-p}" y="${y+33}" text-anchor="end" font-size="14" fill="var(--ink-3)">Help</text>`;
 const el=(id,label,bx,by,bw,bhh,inner)=>{const sel=o.sel===id;s+=`<g data-el="${id}"${o.live?` tabindex="0" role="button" aria-pressed="${sel}" aria-label="${label}"`:''}><rect x="${bx-6}" y="${by-6}" width="${bw+12}" height="${bhh+12}" rx="8" fill="transparent"/>${inner}${sel?`<rect x="${bx-6}" y="${by-6}" width="${bw+12}" height="${bhh+12}" rx="8" fill="none" stroke="var(--acc-mark)" stroke-width="1.5" stroke-dasharray="6 4"/>`:''}</g>`};
 let cy=y+56+p;const bottom=y+fh-p-bh-12;
 el('title','Page title',x+p,cy,fw-2*p,36,`<text x="${x+p}" y="${cy+30}" font-size="34" fill="var(--ink)" style="font-family:var(--f-d)">Book a visit</text>`);cy+=46;
 if(fh>470){s+=`<text x="${x+p}" y="${cy+14}" font-size="15" fill="var(--ink-3)">Takes about two minutes. No typing needed.</text>`;cy+=32}
 [['name','Name field','Your name','Lakshmi',false],['phone','Phone field','Phone','Your phone number',true],['time','Preferred time field','Preferred time','Tuesday morning',false]].forEach(([id,lab,l,v,ph])=>{if(cy+80>bottom)return;
  el(id,lab,x+p,cy,fw-2*p,74,`<text x="${x+p}" y="${cy+14}" font-size="14" font-weight="500" fill="var(--ink-2)">${l}</text><rect x="${x+p}" y="${cy+22}" width="${fw-2*p}" height="52" rx="10" fill="var(--bg)" stroke="var(--line-2)"/><text x="${x+p+16}" y="${cy+54}" font-size="16" fill="${ph?'var(--ink-3)':'var(--ink)'}">${v}</text>`);cy+=92});
 const by=Math.min(cy+6,y+fh-p-bh);
 el('cta','Book button',x+p,by,fw-2*p,bh,`<rect x="${x+p}" y="${by}" width="${fw-2*p}" height="${bh}" rx="10" fill="var(--ink)"/><text x="${x+fw/2}" y="${by+bh/2+6}" text-anchor="middle" font-size="17" font-weight="500" fill="var(--bg)">Book my visit</text>`);
 if(o.sel==='cta'&&by-30>y+56)s+=`<text x="${x+fw-p}" y="${by-14}" text-anchor="end" font-size="13" fill="var(--acc)" style="font-family:var(--f-m)">${bh} px tall</text>`;
 svg.innerHTML=s;
}
function drawPart(svg,o={}){
 const W=svg.clientWidth,H=svg.clientHeight;if(!W||!H)return;
 const Hs=H-(o.padB||0),g=o.grip||38,L=o.len||90,k=Math.max(1,Math.min((W-150)/L,(Hs-170)/g,6)),w=L*k,h=g*k,x=(W-w)/2+14,y=(Hs-h)/2-12,hl=w*.62,nh=Math.min(h*.4,15*k),sl=(w-hl);
 let s=`<g data-el="grip"${o.live?' tabindex="0" role="button" aria-label="Grip"':''}><ellipse cx="${x+w/2}" cy="${y+h+18}" rx="${w*.46}" ry="6" fill="var(--line)"/><rect x="${x+hl-4}" y="${y+(h-nh)/2}" width="${sl+4}" height="${nh}" rx="4" fill="var(--panel)" stroke="var(--ink)" stroke-width="1.5"/><rect x="${x+hl+sl*.3}" y="${y+h/2-1.6*k}" width="${sl*.62}" height="${3.2*k}" rx="2" fill="var(--ink)"/><rect x="${x}" y="${y}" width="${hl}" height="${h}" rx="${h/2}" fill="var(--bg-2)" stroke="var(--ink)" stroke-width="1.5"/><rect x="${x+8}" y="${y+8}" width="${hl-16}" height="${h-16}" rx="${h/2-8}" fill="none" stroke="var(--line-2)" stroke-width="1"/>`;
 [.38,.56,.74].forEach(f=>{s+=`<circle cx="${x+hl*f}" cy="${y+h/2}" r="${h*.17}" fill="none" stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="3 3"/>`});
 s+=`<circle cx="${x+h*.42}" cy="${y+h/2}" r="${h*.12}" fill="var(--panel)" stroke="var(--ink)" stroke-width="1.5"/>`;
 if(o.sel==='grip')s+=`<rect x="${x-8}" y="${y-8}" width="${hl+16}" height="${h+16}" rx="${h/2+8}" fill="none" stroke="var(--acc-mark)" stroke-width="1.5" stroke-dasharray="6 4"/>`;
 s+='</g>';
 const dy=y+h+46,dx=x-36;
 s+=`<g stroke="var(--acc-mark)" stroke-width="1"><line x1="${x}" y1="${dy}" x2="${x+w}" y2="${dy}"/><line x1="${x}" y1="${dy-5}" x2="${x}" y2="${dy+5}"/><line x1="${x+w}" y1="${dy-5}" x2="${x+w}" y2="${dy+5}"/><line x1="${dx}" y1="${y}" x2="${dx}" y2="${y+h}"/><line x1="${dx-5}" y1="${y}" x2="${dx+5}" y2="${y}"/><line x1="${dx-5}" y1="${y+h}" x2="${dx+5}" y2="${y+h}"/></g><text x="${x+w/2}" y="${dy+22}" text-anchor="middle" font-size="13" fill="var(--acc)" style="font-family:var(--f-m)">${L} mm long</text><text x="${dx-12}" y="${y+h/2+5}" text-anchor="end" font-size="13" fill="var(--acc)" style="font-family:var(--f-m)">${g} mm</text>`;
 svg.innerHTML=s;
}
function drawEditor(){
 const svg=$('#plan'),pb=$('#hint').offsetHeight+40;
 if(S.mode==='plan'){drawPlan(svg,S.G,{sel:S.sel,live:true,pad:44,padB:pb});svg.setAttribute('aria-label',`Floor plan with ${S.G.rooms.length} rooms. ${room(S.sel).name} selected. Tab moves between rooms.`)}
 else if(S.mode==='ui'){drawUI(svg,{sel:S.ui.sel,btnH:S.ui.btnH,live:true,padB:pb-16});svg.setAttribute('aria-label','Clinic booking screen. Tab moves between elements.')}
 else{drawPart(svg,{grip:S.part.grip,len:S.part.len,sel:'grip',live:true,padB:pb-16});svg.setAttribute('aria-label',`Key turner, ${S.part.len} mm long with a ${S.part.grip} mm grip.`)}
}

/* toolbar and menus */
const TOOLS={plan:[['select','Select',1],['wall','Wall',3],['room','Room',3],['door','Door',4],['window','Window',5],['ruler','Measure',7],['text','Text',6],['undo','Undo',1],['redo','Redo',2]],
 ui:[['select','Select',1],['frame','Frame',3],['text','Text',3],['button','Button',4],['image','Image',5],['stack','Stack',6],['undo','Undo',1],['redo','Redo',2]],
 part:[['select','Select',1],['sketch','Sketch',3],['extrude','Extrude',3],['fillet','Fillet',5],['hole','Hole',4],['ruler','Measure',6],['undo','Undo',1],['redo','Redo',2]]};
const HINTS={select:{plan:'Hold still on a room to select it, or pinch. Your mouse is standing in for your hand.',ui:'Hold still on an element to select it, or pinch.',part:'Hold still on the part to select it, or pinch.'},
 wall:'Wall: pinch where it starts, then where it ends. Say a length to make it exact.',room:'Room: pinch two opposite corners, or say “add a 3 by 4 metre room”.',door:'Door: pinch a wall to place a 0.9 m door. Say “swing it the other way” to flip it.',window:'Window: pinch a wall to place a 1.2 m window.',ruler:'Measure: pinch two points and the distance is read aloud.',text:'Text: pinch where the label goes, then say the words.',frame:'Frame: pinch two corners.',button:'Button: pinch to place it. It stays at least 44 px tall.',image:'Image: pinch to place an image box.',stack:'Stack: pinch elements one after another to stack them.',sketch:'Sketch: move your hand slowly to draw. Pinch to end the line.',extrude:'Extrude: pinch a shape, then lift your hand to pull it up.',fillet:'Fillet: pinch an edge to round it.',hole:'Hole: pinch where it goes, then say the size.'};
const hintFor=t=>{const h=HINTS[t];return typeof h==='string'?h:h[S.mode]};
function renderTools(){const tb=$('#toolbar');keep(tb,()=>{tb.innerHTML=TOOLS[S.mode].map(([id,l,p])=>`<button class="tool" data-tool="${id}" data-p="${p}"${id==='undo'||id==='redo'?'':` aria-pressed="${S.tool===id}"`}>${ic(id)}${l}</button>`).join('')});fitTools()}
function fitTools(){const tb=$('#toolbar');if(!tb.clientWidth)return;const items=$$('.tool',tb);items.forEach(b=>b.hidden=false);let guard=20;
 while(tb.scrollWidth>tb.clientWidth+1&&guard--){const vis=items.filter(b=>!b.hidden);if(vis.length<2)break;let w=vis[0];vis.forEach(b=>{if(+b.dataset.p>=+w.dataset.p)w=b});w.hidden=true}
 S.over=items.filter(b=>b.hidden).map(b=>b.dataset.tool)}
function renderMore(){const over=S.over.map(id=>TOOLS[S.mode].find(t=>t[0]===id)).filter(Boolean);
 $('#moreMenu').innerHTML=(over.length?`<h4>Tools that didn’t fit</h4>${over.map(([id,l])=>`<button class="mi" role="menuitem" data-tool="${id}">${ic(id)}<span>${l}</span></button>`).join('')}`:'')+`<h4>Actions, and where they run</h4>`+ACTIONS[S.mode].map(([id,n,l])=>`<button class="mi" role="menuitem" data-act="${id}">${ic(n)}<span>${l}</span>${MORE[id]?sigHTML(decide(MORE[id].type).eng):''}</button>`).join('')}
function renderSay(){const L=PH.filter(p=>P.speak==='both'||P.speak==='auto'||p.lang===P.speak);
 $('#sayMenu').innerHTML=`<h4>Pick a phrase to say</h4>`+L.map(p=>`<button class="mi" role="menuitem" data-say="${p.id}">${ic('mic')}<span class="ph"><small>${p.lang==='kn'?'Kannada':'English'}</small><span${p.lang==='kn'?' lang="kn"':''}>${esc(val(p.said))}</span></span>${sigHTML(decide(p.type).eng)}</button>`).join('')}
let openM=null,kbd=false;
function openMenu(btn,menu,fill){closeMenus();fill();menu.hidden=false;btn.setAttribute('aria-expanded','true');openM={btn,menu};if(kbd){const f=menu.querySelector('[role=menuitem]');if(f)f.focus()}}
function closeMenus(back){if(!openM)return;openM.menu.hidden=true;openM.btn.setAttribute('aria-expanded','false');if(back)openM.btn.focus();openM=null}
function setTool(id){if(id==='undo')return undo();if(id==='redo')return redo();S.tool=id;closeMenus();$('#hint').textContent=hintFor(id);renderTools();drawEditor();announce(`${TOOLS[S.mode].find(t=>t[0]===id)[1]} tool. ${hintFor(id)}`)}

/* inspector */
const numF=(k,label,v,unit,less,more)=>`<div><p class="lbl" id="lb-${k}">${label}</p><div class="num" role="group" aria-labelledby="lb-${k}"><button data-step="${k},-1" aria-label="${less}">${ic('minus')}</button><label class="v" for="in-${k}"><span class="vh">${label}, in ${unit==='m'?'metres':unit==='ft'?'feet':unit==='px'?'pixels':'millimetres'}</span><input id="in-${k}" data-in="${k}" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${v}"><span class="u" aria-hidden="true">${unit}</span></label><button data-step="${k},1" aria-label="${more}">${ic('plus')}</button></div></div>`;
const recent=()=>`<div><p class="lbl">Recent requests</p><ol class="mini">${S.feed.slice(0,4).map(f=>`<li>${sigHTML(f.eng)}<span>${esc(f.what)}</span>${f.call?`<span class="call">${esc(f.call)}</span>`:''}<span class="w">${esc(f.why)}</span></li>`).join('')}</ol></div>`;
function renderInsp(){const el=$('#insp');keep(el,()=>{
 if(S.mode==='plan'){const r=room(S.sel),tot=S.G.rooms.reduce((a,x)=>a+x.w*x.h,0),u=P.units==='m'?'m':'ft';
  el.innerHTML=`<div><p class="lbl">Selected room</p><h2>${esc(r.name)}</h2></div><div>${numF('w','Width',toU(r.w).toFixed(1),u,'Narrower','Wider')}<div style="height:16px"></div>${numF('h','Length',toU(r.h).toFixed(1),u,'Shorter','Longer')}</div><div><p class="lbl">Floor area</p><p class="area">${areaN(r.w*r.h)}<small>${areaU()}</small></p><p class="lbl" style="margin-top:8px">Whole floor ${areaN(tot)} ${areaU()}</p></div><div><p class="lbl">Quick actions</p><div class="qa"><button class="btn btn-q" data-qa="door">${ic('door')}Add a door</button><button class="btn btn-q" data-qa="window">${ic('window')}Add a window</button></div></div>${recent()}`}
 else if(S.mode==='ui'){const N={title:'Page title',name:'Name field',phone:'Phone field',time:'Preferred time',cta:'Book button'};
  el.innerHTML=`<div><p class="lbl">Selected element</p><h2>${N[S.ui.sel]}</h2></div>${S.ui.sel==='cta'?`<div>${numF('btn','Button height',S.ui.btnH,'px','Shorter','Taller')}<p class="lbl" style="margin-top:8px">Mendcraft won’t go below 44 px.</p></div>`:'<p class="muted">Pinch the Book button to change its height.</p>'}<div><p class="lbl">Quick actions</p><div class="qa"><button class="btn btn-q" data-qa="check">${ic('contrast')}Check contrast</button><button class="btn btn-q" data-qa="gen">${ic('wand')}Draft a screen</button></div></div>${recent()}`}
 else el.innerHTML=`<div><p class="lbl">Selected part</p><h2>Key turner</h2><p class="muted" style="margin-top:8px">For a front-door key. PLA, 25% infill.</p></div><div>${numF('grip','Grip',S.part.grip,'mm','Thinner grip','Thicker grip')}<div style="height:16px"></div>${numF('len','Length',S.part.len,'mm','Shorter','Longer')}</div><div><p class="lbl">Quick actions</p><div class="qa"><button class="btn btn-q" data-qa="print">${ic('check')}Check printing</button><button class="btn btn-q" data-qa="shape">${ic('cube')}Stronger shape</button></div></div>${recent()}`;
})}
const LIM={w:[1,9,.1],h:[1,9,.1],btn:[44,96,4],grip:[28,60,2],len:[70,130,5]};
function setVal(k,v){const[lo,hi]=LIM[k];if(isNaN(v))return false;edit();
 if(k==='w'||k==='h'){const r=room(S.sel);r[k]=+Math.min(hi,Math.max(lo,v)).toFixed(1);announce(`${r.name} ${k==='w'?'width':'length'} ${fmt(r[k])}`)}
 else if(k==='btn'){if(v<44)toast('44 px is the smallest target Mendcraft allows.');S.ui.btnH=Math.round(Math.min(hi,Math.max(lo,v)))}
 else if(k==='grip')S.part.grip=Math.round(Math.min(hi,Math.max(lo,v)));
 else if(k==='len')S.part.len=Math.round(Math.min(hi,Math.max(lo,v)));
 render();return true}
function stepVal(k,dir){const st=LIM[k][2];const cur=k==='w'||k==='h'?room(S.sel)[k]:k==='btn'?S.ui.btnH:S.part[k];setVal(k,cur+dir*st)}

/* status */
function renderBadge(){const w=S.last.eng;$('#rbSig').className='sig '+sigC(w);$('#rbSig').textContent=sigT(w);$('#rbWhy').textContent=S.last.why;
 $('#routeBadge').setAttribute('aria-label',`Last request: ${sigT(w)}, ${S.last.why}. Open the explanation.`);
 $('#whyLast').textContent=w==='nano'?`Your last request ran on this device, with Gemini Nano in Chrome. ${S.last.why}.`:w==='cloud'?`Your last request went to Gemini in the cloud, through Firebase AI Logic. ${S.last.why}.`:w==='queue'?`Your last request is waiting for Gemini in the cloud. ${S.last.why}.`:`Your last request ran on this device. No AI was needed.`;
 $('#olTx').textContent=`${S.ledger.length} left this device`;$('#openLedger').setAttribute('aria-label',`What left this device: ${plural(S.ledger.length,'item')} today. Open the ledger.`)}
function renderNet(){const b=$('#netBtn'),q=S.queue.length;b.setAttribute('aria-pressed',String(!S.online));$('#netTx').textContent=S.online?(P.local?'Cloud paused':'Online'):'Airplane mode';$('#netIc').setAttribute('href',S.online?'#i-wifi':'#i-plane');
 $('#netQ').hidden=!q;$('#netQ').textContent=q;b.setAttribute('aria-label',`${S.online?'Online':'Airplane mode on'}. ${plural(q,'cloud job')} waiting. Press to ${S.online?'go offline':'reconnect'}.`)}

/* ledger */
const F=[['all','All'],['voice','Voice'],['image','Photos'],['job','Jobs and text']];
const lrow=(e,short)=>`<li class="lrow${e.fresh?' flash':''}"><time datetime="${new Date(e.t).toISOString()}">${clock(e.t)}</time><div><b>${esc(e.title)}</b>${short?'':`<p class="meta">${esc(e.detail)}${e.heard?` Heard: <span lang="kn">“${esc(e.heard)}”</span>`:''}</p>`}<p class="why">${esc(e.why)}${short?'':`. Sent to Gemini in the cloud through Firebase AI Logic${e.fromQ?', from the offline queue':''}.`}</p></div><span class="kb">${e.kb} KB</span></li>`;
function ledgerHTML(){const L=S.ledger.filter(e=>S.lf==='all'||(S.lf==='job'?e.kind==='job'||e.kind==='text':e.kind===S.lf));
 return `<p class="lsum">${esc(summary())}</p><div class="lctl"><div class="seg2" role="group" aria-label="Filter the ledger">${F.map(([k,l])=>`<button data-lf="${k}" aria-pressed="${S.lf===k}">${l}</button>`).join('')}</div><button class="btn btn-q" data-copy="1">${ic('copy')}Copy as text</button></div>${L.length?`<ol class="llist">${L.map(e=>lrow(e)).join('')}</ol>`:`<p class="empty">Nothing in this view. ${S.ledger.length?'Choose “All” to see everything.':'Everything today ran on this device.'}</p>`}`}
function renderLedgers(){[$('#ledgerMain'),$('#ledgerDlg').open?$('#ledgerDrawer'):null].forEach(el=>{if(el)keep(el,()=>{el.innerHTML=ledgerHTML()})});
 $('#stayList').innerHTML=`<div><dt>Camera video</dt><dd>All of it</dd></div><div><dt>Hand points</dt><dd>Every frame</dd></div><div><dt>English commands</dt><dd>${S.stay.en}</dd></div><div><dt>Private summaries</dt><dd>${S.stay.sum}</dd></div><div><dt>Waiting in the queue</dt><dd>${S.queue.length}</dd></div>`;
 $$('[data-local]').forEach(b=>b.setAttribute('aria-checked',String(P.local)));const ms=$('#miniSum');if(ms)ms.textContent=summary()}

/* control room */
function renderTV(){
 const D=DEV[S.device];$('#devName').textContent=D.name;$('#devSub').textContent=D.sub;$('#devModel').textContent=D.model;
 $('#devFacts').innerHTML=`<div><dt>Hands</dt><dd>${S.hands?'Tracking, right hand':'Hand cursor off'}</dd></div><div><dt>Voice</dt><dd>${S.listening?'Any language (auto)':'Not listening'}</dd></div><div><dt>Network</dt><dd>${S.online?(P.local?'Cloud paused':'Online'):'Airplane mode'}</dd></div>`;
 $$('[data-dev]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.dev===S.device)));
 $('#tvFeed').innerHTML=S.feed.slice(0,8).map(f=>`<li><time>${clock(f.t)}</time>${sigHTML(f.eng)}<span class="what">${esc(f.what)}</span>${f.call?`<span class="call">${esc(f.call)}</span>`:''}<span class="why">${esc(f.why)}</span></li>`).join('');
 keep($('#tvLedger'),()=>{$('#tvLedger').innerHTML=`<p class="mid" style="font-size:clamp(24px,2vw,30px)">${esc(summary())}</p><ol class="llist">${S.ledger.slice(0,3).map(e=>lrow(e,true)).join('')}</ol><button class="btn btn-q" data-go="ledger" style="justify-self:start">Open the full ledger</button>`});
 const tq=$('#tvQueue');keep(tq,()=>{tq.innerHTML=S.queue.length?`<p class="big">${S.queue.length}</p><p class="muted">${S.queue.length===1?'job is':'jobs are'} waiting</p><div>${S.queue.map(q=>`<div class="qitem"><div class="row">${sigHTML('queue')}<time>${clock(q.qt)}</time></div><span>${esc(q.label)}</span><span class="why">${esc(q.qwhy)}</span></div>`).join('')}</div><button class="btn btn-p" data-qnet="1" style="justify-self:start">${ic('wifi')}${S.online?'Turn the cloud back on':'Reconnect and send'}</button>`
  :`<p class="big">0</p><p class="muted">Nothing waiting. When you’re offline, cloud jobs wait here and send themselves when you reconnect.</p><button class="btn btn-q" data-qnet="1" style="justify-self:start">${ic('plane')}${S.online?'Try airplane mode':'Reconnect'}</button>`});
 const lb=$('#lampBox');keep(lb,()=>{lb.innerHTML=`<p class="big">${S.lamp.on?S.lamp.level+'%':'Off'}</p><div class="lvl" aria-hidden="true"><i style="width:${S.lamp.on?S.lamp.level:0}%"></i></div><div class="row"><button class="btn btn-q ibtn" data-lamp="-" aria-label="Dimmer">${ic('minus')}</button><button class="btn btn-q ibtn" data-lamp="+" aria-label="Brighter">${ic('plus')}</button><button class="btn btn-q" data-lamp="t">${S.lamp.on?'Turn off':'Turn on'}</button></div>`});
 const mb=$('#musicBox'),tr=TRACKS[S.music.i];keep(mb,()=>{mb.innerHTML=`<div><p class="mid">${tr.t}</p><p class="muted" style="margin-top:6px">${tr.a}, ${S.music.playing?'playing':'paused'}</p></div><div class="lvl" aria-hidden="true"><i style="width:${S.music.pos}%"></i></div><div class="row"><button class="btn btn-q" data-music="p">${ic(S.music.playing?'pause':'play')}${S.music.playing?'Pause':'Play'}</button><button class="btn btn-q ibtn" data-music="n" aria-label="Next song">${ic('next')}</button></div>`});
 const rl=$('#tvRec');keep(rl,()=>{rl.innerHTML=S.recipes.slice(0,4).map(r=>`<li><div><b>${esc(r.name)}</b><span>Say “${esc(r.say)}”</span></div><button class="btn btn-q" data-replay="${r.id}"${S.playing?' aria-disabled="true"':''}>${ic('play')}Replay</button></li>`).join('')});
}

/* recipes */
function seqHTML(steps,cur){const n=steps.length;return `<div class="seqw"><ol class="seq" style="--n:${n}">${steps.map((s,i)=>`<li class="${cur<0?'':i<cur?'done':i===cur?'now':''}"><span class="n"><span>${String(i+1).padStart(2,'0')}</span>${s.cloud?`<span>${sigT(decide(s.cloud).eng)}</span>`:''}</span><span>${esc(s.t)}</span></li>`).join('')}</ol><span class="ph" style="left:${cur<0?0:((cur+.5)/n*100).toFixed(1)}%"${cur<0?' hidden':''}></span></div>`}
function updSeq(root,cur){if(!root)return;const lis=$$('.seq li',root),n=lis.length;lis.forEach((li,i)=>li.className=i<cur?'done':i===cur?'now':'');const ph=$('.ph',root);if(ph){ph.hidden=cur<0||cur>=n;if(cur>=0&&cur<n)ph.style.left=((cur+.5)/n*100).toFixed(1)+'%'}}
function trackHTML(r){const on=S.playing===r.id,cl=r.steps.filter(s=>s.cloud).length;
 return `<article class="track${r.flash?' flash':''}" id="rt-${r.id}" aria-labelledby="rn-${r.id}"><div class="seqhead"><div><h2 id="rn-${r.id}">${esc(r.name)}${r.fresh?'<span class="new">New</span>':''}</h2><div class="trig"><span>Say <b>“${esc(r.say)}”</b></span>${r.kn?`<span lang="kn">“${esc(r.kn)}”</span>`:''}<span>${esc(r.gesture)}</span></div></div><button class="btn ${on?'btn-s':'btn-p'}" data-replay="${r.id}"${S.playing?' aria-disabled="true"':''}>${ic(on?'pause':'play')}${on?'Playing':'Replay'}</button></div>${seqHTML(r.steps,on?S.pstep:-1)}<div class="tmeta"><span>${r.used?`Used ${r.used} times`:'Not used yet'}</span><span>${cl?`${plural(cl,'step')} uses the cloud`:'Runs entirely on this device'}</span></div></article>`}
function renderRecipes(){const el=$('#recList');keep(el,()=>{el.innerHTML=S.recipes.map(trackHTML).join('')})}
function replay(id){if(S.playing)return;const r=S.recipes.find(x=>x.id===id);if(!r)return;S.playing=id;S.pstep=0;renderRecipes();renderTV();announce(`Replaying ${r.name}`);const dt=RM()?450:950;
 const tick=()=>{const s=r.steps[S.pstep];if(s.fx)FX[s.fx]();if(s.cloud)run({type:s.cloud,label:'Cover note request',ltitle:'Cover note request',ldetail:'Project name and room list, as text.',kb:2,call:'notes.coverNote("contractor")',act:()=>'Wrote a cover note for the contractor'});updSeq($('#rt-'+id),S.pstep);renderTV();drawEditor();
  setTimeout(()=>{S.pstep++;if(S.pstep>=r.steps.length){S.playing=null;r.used=(r.used||0)+1;r.fresh=false;addFeed('local',`Recipe “${r.name}” finished`,'Recipes replay saved commands, no AI needed');render();toast(`Done: ${r.name}`)}else tick()},dt)};
 tick()}
const SAMPLE=[['Set the lamp to 50%','lamp50'],['Open the “Clinic reception” screens',null],['Play the Focus playlist','play'],['Zoom to fit the plan',null],['Export a PDF',null]];
function renderTeach(){const t=S.teach,el=$('#teach');keep(el,()=>{
 if(t.mode==='idle')el.innerHTML=`<h2 id="h-teach">Teach a new recipe</h2><p class="muted">Mendcraft watches what you do once and keeps the steps. It saves only the steps, never video or audio.</p><button class="btn btn-p" data-teach="start">${ic('record')}Start teaching</button><p class="lbl">Or say “Watch me”, or <span lang="kn">“ನನ್ನನ್ನು ನೋಡು”</span>.</p>`;
 else if(t.mode==='rec')el.innerHTML=`<h2 id="h-teach">Teaching</h2><p class="recd">Watching your steps</p><p class="muted">Do the steps as you normally would. In this prototype, pick them here.</p><div class="acts">${SAMPLE.map(([l],i)=>`<button class="btn btn-q" data-teach="add${i}">${ic('plus')}${esc(l)}</button>`).join('')}</div><div><p class="lbl">Steps so far</p>${t.steps.length?`<ol class="steps">${t.steps.map(i=>`<li><span>${esc(SAMPLE[i][0])}</span></li>`).join('')}</ol>`:'<p class="empty">No steps yet. Do the first one.</p>'}</div><div class="row"><button class="btn btn-p" data-teach="stop"${t.steps.length?'':' aria-disabled="true"'}>Stop teaching</button><button class="btn btn-s" data-teach="cancel">Cancel</button></div>`;
 else el.innerHTML=`<h2 id="h-teach">Name your recipe</h2><ol class="steps">${t.steps.map(i=>`<li><span>${esc(SAMPLE[i][0])}</span></li>`).join('')}</ol>
 <div class="fld"><label for="tName">Name</label><input class="inp" id="tName" type="text" value="${esc(t.name||'')}"${t.err?' aria-invalid="true" aria-describedby="tErr"':''}>${t.err?`<p class="err" id="tErr">${t.err}</p>`:''}</div>
 <div class="fld"><label for="tSay">Say this to replay it</label><input class="inp" id="tSay" type="text" value="${esc(t.say||'')}" placeholder="For example: Evening work"></div>
 <div class="fld"><label for="tKn">The same in Kannada, optional</label><input class="inp" id="tKn" type="text" lang="kn" value="${esc(t.kn||'')}"></div>
 <div class="fld"><label for="tGest">Gesture, optional</label><span class="sel"><select class="inp" id="tGest">${['No gesture set','Or pinch twice','Or an open palm, held for 1 second','Or a soft fist, held for 1 second','Or a head tilt to the left'].map(g=>`<option${g===t.gest?' selected':''}>${g}</option>`).join('')}</select></span></div>
 <div class="row"><button class="btn btn-p" data-teach="save">${ic('check')}Save recipe</button><button class="btn btn-s" data-teach="back">Back to steps</button></div>`})}
function teach(a){const t=S.teach;
 if(a==='start'){S.teach={mode:'rec',steps:[]};announce('Teaching. Do the steps.')}
 else if(a.startsWith('add')){t.steps.push(+a.slice(3));announce(`Step ${t.steps.length} added`)}
 else if(a==='stop'){if(!t.steps.length)return;t.mode='name'}
 else if(a==='cancel'){S.teach={mode:'idle',steps:[]}}
 else if(a==='back'){t.mode='rec'}
 else if(a==='save'){t.name=$('#tName').value.trim();t.say=$('#tSay').value.trim();t.kn=$('#tKn').value.trim();t.gest=$('#tGest').value;
  if(!t.name){t.err='Give the recipe a name so you can call it.';renderTeach();$('#tName').focus();return}
  const r={id:'u'+Date.now(),name:t.name,say:t.say||t.name,kn:t.kn,gesture:t.gest,used:0,fresh:true,flash:true,steps:t.steps.map(i=>({t:SAMPLE[i][0],fx:SAMPLE[i][1]}))};
  setTimeout(()=>{r.flash=false},2600);S.recipes.unshift(r);S.teach={mode:'idle',steps:[]};renderTeach();addFeed('local',`Learned a new recipe: ${r.name}`,'Recipes are stored on this device');render();toast(`Saved “${r.name}”. Say “${r.say}” to replay it.`);return}
 renderTeach()}

/* settings */
const GEST=[{id:'pinch',n:'Pinch',d:'Thumb meets index finger',i:'pinch'},{id:'hold',n:'Pinch and hold',d:'Keep the pinch for half a second',i:'hold'},{id:'palm',n:'Open palm',d:'Show your flat hand to the camera',i:'hand'},{id:'mid',n:'Thumb to middle finger',d:'An easier pinch for some hands',i:'mid'},{id:'fist',n:'Soft fist',d:'Curl your fingers loosely',i:'fist'},{id:'tilt',n:'Head tilt',d:'Tilt your head left or right, no hands needed',i:'head'}];
const GACT=[['click','Click or select'],['grab','Grab and move'],['listen','Start or stop listening'],['undo','Undo'],['redo','Redo'],['cancel','Cancel or close'],['scroll','Scroll'],['more','Open the More menu'],['none','Do nothing']];
function renderGest(){const cnt={};Object.values(P.gest).forEach(a=>{if(a!=='none')cnt[a]=(cnt[a]||0)+1});
 $('#gestRows').innerHTML=GEST.map(g=>{const a=P.gest[g.id],dup=a!=='none'&&cnt[a]>1?GEST.filter(o=>o.id!==g.id&&P.gest[o.id]===a).map(o=>o.n.toLowerCase()):[];
  return `<div class="srow"><span class="gl">${ic(g.i)}</span><div><b id="gn-${g.id}">${g.n}</b><span>${g.d}</span></div><span class="sel"><select class="inp" id="g-${g.id}" data-gest="${g.id}" aria-labelledby="gn-${g.id}">${GACT.map(([v,l])=>`<option value="${v}"${v===a?' selected':''}>${l}</option>`).join('')}</select></span>${dup.length?`<p class="warn">Also set on ${and(dup)}. Either one will do this.</p>`:''}</div>`}).join('')+(Object.values(P.gest).includes('click')?'':'<p class="err" style="margin-top:16px">No gesture clicks right now. Dwell still clicks for you.</p>')}
const opt=(name,v,cur,b,sub,extra='')=>`<label class="opt"><input type="radio" name="${name}" value="${v}"${String(v)===String(cur)?' checked':''}>${extra}<b>${b}</b>${sub?`<span>${sub}</span>`:''}</label>`;
function renderSettings(){renderGest();
 $('#sizeOpts').innerHTML=[[44,'Standard','44 px, the minimum'],[56,'Large','56 px, recommended'],[72,'Extra large','72 px, for less precise movement']].map(([v,n,d])=>opt('tap',v,P.tap,n,d,`<span class="sq" style="width:${v}px;height:${v}px" aria-hidden="true"></span>`)).join('');
 $('#capOpts').innerHTML=[[20,'Large'],[22,'Larger'],[28,'Largest']].map(([v,n])=>opt('cap',v,P.cap,n,'',`<span aria-hidden="true" style="font-size:${v}px;line-height:1.2">Aa <span lang="kn">ಅಆ</span></span>`)).join('');
 $('#unitOpts').innerHTML=opt('units','m',P.units,'Metres','3.5 m by 2.8 m')+opt('units','ft',P.units,'Feet and inches','11′ 6″ by 9′ 2″');
 $('#dwell').value=P.dwell;$('#smooth').value=P.smooth;syncRange();
 $('#uiLang').value=P.ui;$('#speak').value=P.speak==='both'?'auto':P.speak;$('#capKn').checked=P.capKn;$('#capEn').checked=P.capEn;$('#rmSw').setAttribute('aria-checked',String(P.reduce))}
function syncRange(){const d=$('#dwell'),sm=$('#smooth');d.style.setProperty('--p',((d.value-300)/17)+'%');sm.style.setProperty('--p',sm.value+'%');$('#dwellOut').textContent=(d.value/1000).toFixed(1)+' s';$('#smoothOut').textContent=sm.value+'%'}
function applyPrefs(){const R=document.documentElement;R.style.setProperty('--tap',P.tap+'px');R.style.setProperty('--cap',P.cap+'px');R.classList.toggle('rm',P.reduce);$('#lnKn').hidden=!P.capKn;$('#lnEn').hidden=!P.capEn;requestAnimationFrame(fitTools)}

/* render all */
function render(){renderBadge();renderNet();renderInsp();renderLedgers();renderTV();renderRecipes();drawEditor();if(openM&&openM.menu.id==='moreMenu')renderMore()}

/* screens */
const SCREENS=['landing','editor','ledger','control-room','recipes','preferences'];
const APP_ROUTES={editor:'/canvas.html',ledger:'/canvas.html',recipes:'/canvas.html',preferences:'/canvas.html','control-room':'/canvas.html'};
function show(n,focus){if(APP_ROUTES[n]){location.assign(APP_ROUTES[n]);return}if(!SCREENS.includes(n))n='landing';S.screen=n;$$('.screen').forEach(s=>s.hidden=s.dataset.screen!==n);
 $('#hdr').classList.toggle('night',n==='landing'||n==='control-room');
 $$('.top nav button').forEach(b=>{if(b.dataset.go===n){b.setAttribute('aria-current','page');b.scrollIntoView({block:'nearest',inline:'nearest'})}else b.removeAttribute('aria-current')});closeMenus();
 if(focus){window.scrollTo(0,0);const h=$(`#s-${n} h1`);if(h)h.focus({preventScroll:true})}
 if(n==='editor')requestAnimationFrame(()=>{fitTools();drawEditor()});
 if(n!=='editor'&&n!=='preferences')hideCur();
 if(n==='landing')requestAnimationFrame(()=>{drawFilm();drawMode();gdLines();hKick()});
 render()}
function go(n){if(APP_ROUTES[n]){location.assign(APP_ROUTES[n]);return}if(n==='landing'){try{history.replaceState(null,'',location.pathname+location.search)}catch(e){}show('landing',true);window.scrollTo(0,0);return}if(location.hash.slice(1)===n){show(n,true);return}try{location.hash=n}catch(e){}setTimeout(()=>{if(S.screen!==n)show(n,true)},60)}
addEventListener('hashchange',()=>{const n=location.hash.slice(1);if(APP_ROUTES[n]){location.replace(APP_ROUTES[n]);return}show(n||'landing',true)});

/* device drawings, night stage */
const EDGE='rgb(242 240 234/.22)',LN='rgb(242 240 234/.72)',LN2='rgb(242 240 234/.34)',AC2='#8E9DFF';
const at=(x,y,s,w,h,inner)=>`<g transform="translate(${(x-w*s/2).toFixed(1)} ${(y-h*s/2).toFixed(1)}) scale(${s})">${inner}</g>`;
function dLaptop(x,y,s,st){const g=st.kg||0,sel=st.ksel;
 const R=[[62,30,66,46],[128,30,36+g*12,34],[128,64,36,12],[62,76,52,36],[114,76,24,22],[114,98,24,14],[138,76,26,36]];
 const p=R.map(([a,b,c,d],i)=>`<rect x="${a}" y="${b}" width="${c.toFixed(1)}" height="${d}" fill="${i===1&&sel?'rgb(110 128 255/.3)':'none'}" stroke="${i===1&&sel?AC2:LN}" stroke-width="${i===1&&sel?1.6:1.1}"/>`).join('');
 return at(x,y,s,240,150,`<rect x="18" y="0" width="204" height="132" rx="9" fill="url(#gBody)" stroke="${EDGE}"/><rect x="25" y="7" width="190" height="117" rx="4" fill="url(#gScreen)"/><rect x="33" y="14" width="34" height="4" rx="2" fill="${LN2}"/><rect x="176" y="13" width="30" height="6" rx="3" fill="rgb(110 128 255/.5)"/>${p}<rect x="25" y="112" width="190" height="12" fill="#050505"/><rect x="33" y="116" width="70" height="3" rx="1.5" fill="${LN2}"/><path d="M0 134H240L232 146Q231 148 228 148H12Q9 148 8 146Z" fill="url(#gBody)" stroke="rgb(242 240 234/.16)"/><rect x="102" y="134" width="36" height="4" rx="2" fill="#0B0B0A"/>`)}
function dTablet(x,y,s,st){const on=st.tab||0;
 const plan=`<g opacity="${on.toFixed(2)}"><rect x="24" y="38" width="44" height="34" fill="none" stroke="${LN}"/><rect x="68" y="38" width="36" height="26" fill="rgb(110 128 255/.3)" stroke="${AC2}" stroke-width="1.4"/><rect x="68" y="64" width="36" height="8" fill="none" stroke="${LN}"/><rect x="24" y="72" width="38" height="30" fill="none" stroke="${LN}"/><rect x="62" y="72" width="20" height="18" fill="none" stroke="${LN}"/><rect x="82" y="72" width="22" height="30" fill="none" stroke="${LN}"/></g>`;
 const home=`<g opacity="${(1-on).toFixed(2)}">${[0,1,2,3].map(i=>`<rect x="${22+(i%2)*44}" y="${34+Math.floor(i/2)*44}" width="40" height="40" rx="6" fill="rgb(242 240 234/.08)"/>`).join('')}<rect x="22" y="126" width="84" height="6" rx="3" fill="rgb(242 240 234/.12)"/></g>`;
 return at(x,y,s,128,176,`<rect width="128" height="176" rx="16" fill="url(#gBody)" stroke="${EDGE}"/><rect x="7" y="7" width="114" height="162" rx="10" fill="url(#gScreen)"/><circle cx="64" cy="3.6" r="1.3" fill="#3B3B37"/><rect x="18" y="18" width="40" height="4" rx="2" fill="${LN2}"/>${home}${plan}`)}
function dPhone(x,y,s,st){const r=st.read||0;let wave='';
 for(let i=0;i<13;i++){const h=3+Math.abs(Math.sin(i*1.7+(st.t||0)*6))*10*r;wave+=`<rect x="${14+i*4}" y="${(134-h/2).toFixed(1)}" width="2" height="${h.toFixed(1)}" rx="1" fill="${AC2}"/>`}
 return at(x,y,s,80,164,`<rect width="80" height="164" rx="17" fill="url(#gBody)" stroke="${EDGE}"/><rect x="4" y="4" width="72" height="156" rx="13" fill="url(#gScreen)"/><rect x="30" y="9" width="20" height="6" rx="3" fill="#000"/><rect x="12" y="26" width="30" height="3" rx="1.5" fill="${LN2}"/><rect x="10" y="40" width="44" height="22" rx="8" fill="rgb(242 240 234/.13)"/><rect x="15" y="46" width="30" height="2.4" rx="1.2" fill="${LN2}"/><rect x="15" y="52" width="22" height="2.4" rx="1.2" fill="${LN2}"/><rect x="28" y="70" width="42" height="18" rx="8" fill="rgb(110 128 255/.32)"/><rect x="33" y="76" width="28" height="2.4" rx="1.2" fill="${LN}"/><rect x="10" y="96" width="50" height="22" rx="8" fill="rgb(242 240 234/${(.13+r*.1).toFixed(2)})" stroke="${r>.5?AC2:'none'}"/><rect x="15" y="102" width="36" height="2.4" rx="1.2" fill="${LN2}"/><rect x="15" y="108" width="26" height="2.4" rx="1.2" fill="${LN2}"/><g opacity="${r.toFixed(2)}">${wave}</g><rect x="28" y="152" width="24" height="2.4" rx="1.2" fill="rgb(242 240 234/.4)"/>`)}
function dLamp(x,y,s,st){const L=st.lamp??.8;
 return at(x,y,s,160,240,`<path d="M96 74L148 74L212 236L30 236Z" fill="url(#gCone)" opacity="${(L*.55).toFixed(2)}"/><ellipse cx="122" cy="234" rx="${(60+L*34).toFixed(1)}" ry="7" fill="#FFE9C4" opacity="${(L*.2).toFixed(2)}"/><path d="M40 222C38 150 58 84 112 52" fill="none" stroke="#2E2E2B" stroke-width="6" stroke-linecap="round"/><path d="M41 220C39 150 59 85 112 54" fill="none" stroke="rgb(255 255 255/.14)" stroke-width="1.3"/><ellipse cx="40" cy="226" rx="34" ry="8" fill="url(#gBody)" stroke="${EDGE}"/><path d="M98 40Q122 30 146 42L152 74Q122 80 92 74Z" fill="url(#gBody)" stroke="${EDGE}"/><ellipse cx="122" cy="74" rx="28" ry="4.5" fill="#FFE9C4" opacity="${(.2+L*.8).toFixed(2)}"/>`)}
function dSpeaker(x,y,s,st){const p=st.playing;let eq='';
 for(let i=0;i<5;i++){const h=p?3+Math.abs(Math.sin(i*1.3+(st.t||0)*7))*8:2;eq+=`<rect x="${44+i*6}" y="${(20-h/2).toFixed(1)}" width="3" height="${h.toFixed(1)}" rx="1.5" fill="${p?AC2:LN2}"/>`}
 return at(x,y,s,110,150,`<rect width="110" height="150" rx="28" fill="url(#gBody)" stroke="${EDGE}"/><rect x="10" y="36" width="90" height="104" rx="20" fill="url(#pGrille)"/><rect x="22" y="11" width="66" height="18" rx="9" fill="#0A0A09"/>${eq}${p?`<path d="M31 15l7 5-7 5z" fill="${LN}"/>`:`<rect x="30" y="15" width="2.6" height="10" rx="1" fill="${LN}"/><rect x="35" y="15" width="2.6" height="10" rx="1" fill="${LN}"/>`}`)}
function dBrowser(x,y,s,st,id){const sc=(st.scroll||0)*56;
 return at(x,y,s,240,160,`<defs><clipPath id="bc${id}"><rect x="6" y="30" width="228" height="124" rx="4"/></clipPath></defs><rect width="240" height="160" rx="10" fill="url(#gBody)" stroke="${EDGE}"/><rect x="10" y="7" width="74" height="19" rx="6" fill="#0E0E0D"/><rect x="18" y="14.5" width="44" height="4" rx="2" fill="${LN2}"/><rect x="92" y="10" width="138" height="13" rx="6.5" fill="#0E0E0D"/><rect x="100" y="15" width="70" height="3" rx="1.5" fill="rgb(242 240 234/.25)"/><rect x="6" y="30" width="228" height="124" rx="4" fill="url(#gScreen)"/><g clip-path="url(#bc${id})"><g transform="translate(0 ${(-sc).toFixed(1)})"><rect x="22" y="44" width="120" height="9" rx="2" fill="${LN}"/>${[0,1,2].map(i=>`<rect x="22" y="${62+i*9}" width="${190-i*30}" height="3.4" rx="1.7" fill="${LN2}"/>`).join('')}<rect x="22" y="96" width="196" height="54" rx="6" fill="rgb(110 128 255/.22)"/>${[0,1,2,3].map(i=>`<rect x="22" y="${162+i*9}" width="${196-i*24}" height="3.4" rx="1.7" fill="${LN2}"/>`).join('')}</g></g><rect x="228" y="${(36+(st.scroll||0)*60).toFixed(1)}" width="3" height="44" rx="1.5" fill="rgb(242 240 234/.3)"/>`)}
const LM=[[100,182],[80,165],[63,146],[55,124],[60,104],[90,124],[84,98],[74,84],[64,99],[106,120],[110,88],[113,66],[115,48],[121,125],[129,98],[134,80],[137,64],[134,136],[144,116],[150,102],[154,90]];
const LE=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
function handSVG(cx,cy,s,line,dot,acc,pin){const P2=([a,b])=>[(cx+(a-104)*s).toFixed(1),(cy+(b-115)*s).toFixed(1)];let o='';
 LE.forEach(([a,b])=>{const[p,q]=P2(LM[a]),[r,t]=P2(LM[b]);o+=`<line x1="${p}" y1="${q}" x2="${r}" y2="${t}" stroke="${line}" stroke-width="${(1.8*Math.max(.7,s)).toFixed(2)}" stroke-linecap="round"/>`});
 LM.forEach(pt=>{const[p,q]=P2(pt);o+=`<circle cx="${p}" cy="${q}" r="${(2.8*Math.max(.7,s)).toFixed(2)}" fill="${dot}"/>`});
 const[mx,my]=P2([62,101]);o+=`<circle cx="${mx}" cy="${my}" r="${((10+(pin||0)*5)*s).toFixed(1)}" fill="none" stroke="${acc}" stroke-width="1.8"/>`;return o}
function dYou(st){let w='';for(let i=0;i<21;i++){const k=Math.abs(i-10),h=2+(st.amp||0)*(18-k*1.4)*Math.abs(Math.sin(i*.9+(st.t||0)*9));w+=`<rect x="${540+i*6}" y="${(412-h/2).toFixed(1)}" width="2.4" height="${Math.max(2,h).toFixed(1)}" rx="1.2" fill="${st.amp>.05?AC2:'rgb(242 240 234/.32)'}"/>`}
 return `<circle cx="600" cy="318" r="150" fill="url(#gHub)"/>`+handSVG(600,312,1,'rgb(242 240 234/.85)','#F2F0EA',AC2,st.pinch)+w}
const dCloud=on=>`<g transform="translate(562 22) scale(3.2)"><path d="M7 19h10a4.5 4.5 0 0 0 .7-8.95A6 6 0 0 0 6.3 10.4 4.3 4.3 0 0 0 7 19z" fill="${on?'rgb(110 128 255/.28)':'rgb(242 240 234/.04)'}" stroke="${on?AC2:LN2}" stroke-width=".5"/></g>`;

/* hero constellation */
const HD=[
 {id:'laptop',f:dLaptop,x:168,y:300,s:.92,w:240,h:150,n:'Laptop',st:()=>HS.kg>.5?'Kitchen now 3.5 m':'Mendcraft editor'},
 {id:'tablet',f:dTablet,x:318,y:150,s:.78,w:128,h:176,n:'iPad',st:()=>HS.tab>.5?'Showing the plan':'Second canvas'},
 {id:'phone',f:dPhone,x:888,y:148,s:.86,w:80,h:164,n:'Phone',st:()=>HS.read>.5?'Reading aloud':'Messages'},
 {id:'lamp',f:dLamp,x:1036,y:298,s:.82,w:160,h:240,n:'Desk lamp',st:()=>`${Math.round(HS.lamp*100)}%`},
 {id:'speaker',f:dSpeaker,x:890,y:478,s:.78,w:110,h:150,n:'Speaker',st:()=>HS.playing?'Playing':'Paused'},
 {id:'browser',f:dBrowser,x:334,y:500,s:.8,w:240,h:160,n:'Chrome',st:()=>HS.scroll>.5?'Scrolled down':'A web page'}];
const HSEQ=[
 {d:'lamp',lang:'kn',said:'ದೀಪದ ಬೆಳಕು ಕಡಿಮೆ ಮಾಡು',tr:'Dim the lamp',via:'cloud',why:'Kannada detected → cloud',fx:{lamp:.3},call:'lamp.setBrightness(30)',app:'Mendcraft Home app'},
 {d:'speaker',lang:'en',said:'Pause the music',tr:'ಹಾಡನ್ನು ನಿಲ್ಲಿಸು',via:'dev',why:'English command → on device',fx:{playing:false},call:'music.pause()',app:'Mendcraft Home app'},
 {d:'phone',lang:'en',said:'Read my last message',tr:'ನನ್ನ ಕೊನೆಯ ಸಂದೇಶ ಓದು',via:'dev',why:'English command → on device',fx:{read:1},call:'messages.readLatest()',app:'Mendcraft phone app'},
 {d:'tablet',lang:'kn',said:'ನಕ್ಷೆಯನ್ನು ಐಪ್ಯಾಡಿನಲ್ಲಿ ತೋರಿಸು',tr:'Show the plan on the iPad',via:'cloud',why:'Kannada detected → cloud',fx:{tab:1},call:'display.show("ipad", "plan")',app:'Mendcraft phone app'},
 {d:'browser',lang:'en',said:'Scroll down a bit',tr:'ಸ್ವಲ್ಪ ಕೆಳಗೆ ಸರಿಸು',via:'dev',why:'English command → on device',fx:{scroll:1},call:'page.scroll(0.5)',app:'Mendcraft for Chrome'},
 {d:'laptop',lang:'en',said:'Make the kitchen a bit bigger',tr:'ಅಡುಗೆಮನೆಯನ್ನು ಸ್ವಲ್ಪ ದೊಡ್ಡದು ಮಾಡು',via:'dev',why:'English command → on device',fx:{kg:1,ksel:1},call:'plan.resizeRoom("kitchen", +0.5)',app:'Mendcraft Studio'}];
const HS0={lamp:.8,playing:true,kg:0,ksel:0,read:0,tab:0,scroll:0};
const HS=Object.assign({amp:0,pinch:0,t:0,cloud:0,act:null},HS0);
const hub=d=>{const dx=d.x-600,dy=d.y-318,l=Math.hypot(dx,dy);return[600+dx/l*118,318+dy/l*118]};
const hPath=d=>{const[sx,sy]=hub(d),mx=((sx+d.x)/2).toFixed(1);return `M${sx.toFixed(1)} ${sy.toFixed(1)}C${mx} ${sy.toFixed(1)} ${mx} ${d.y} ${d.x} ${d.y}`};
const cPath=d=>`M${d.x>600?636:564} 52C${d.x} 52 ${d.x} ${((52+d.y)/2).toFixed(1)} ${d.x} ${d.y}`;
function heroBuild(){const svg=$('#heroSvg');
 svg.innerHTML=`<g fill="none" stroke-linecap="round">${HD.map(d=>`<path class="pl" d="${hPath(d)}" stroke="rgb(242 240 234/.16)" stroke-width="1.2"/><path id="po-${d.id}" class="po" d="${hPath(d)}" stroke="${AC2}" stroke-width="1.8"/><path id="pc-${d.id}" class="po" d="${cPath(d)}" stroke="${AC2}" stroke-width="1.8" stroke-dasharray="2 5"/>`).join('')}<path d="M600 200V86" stroke="rgb(242 240 234/.16)" stroke-width="1.2" stroke-dasharray="2 5"/><path id="po-cloud" class="po" d="M600 200V86" stroke="${AC2}" stroke-width="1.8"/><circle cx="600" cy="318" r="118" stroke="rgb(242 240 234/.2)" stroke-dasharray="2 6"/></g><g id="hg-you"></g><g id="hg-cloud"></g>${HD.map(d=>`<g id="hg-${d.id}"></g>`).join('')}<g id="hPulse" style="opacity:0"><circle r="14" fill="${AC2}" opacity=".25"/><circle r="5" fill="#FFFFFF"/></g>`;
 const c=$('#cons');$$('.dl',c).forEach(n=>n.remove());
 const lab=(id,l,t,b,s,extra='')=>`<div class="dl" id="dl-${id}" style="left:${l}%;top:${t}%;${extra}"><b>${b}</b><span>${s}</span></div>`;
 c.insertAdjacentHTML('beforeend',HD.map(d=>lab(d.id,(d.x/12).toFixed(2),((d.y+d.h*d.s/2+10)/6).toFixed(2),d.n,d.st())).join('')+lab('you',50,71.5,'You','Hands and voice')+lab('cloud',50,-6.5,'Gemini · cloud','Via Firebase AI Logic, only when needed')+`<div class="dl tag" style="left:50%;top:26%"><b>Gemini Nano · on device</b></div>`);
}
function hDraw(){$('#hg-you').innerHTML=dYou(HS);$('#hg-cloud').innerHTML=dCloud(HS.cloud);HD.forEach(d=>{$('#hg-'+d.id).innerHTML=d.f(d.x,d.y,d.s,HS,'h');const l=$('#dl-'+d.id);if(l){l.lastChild.textContent=d.st();l.classList.toggle('on',HS.act===d.id)}})}
let hTim=[],hPaused=false,hVis=false,hRun=false,hRaf=0,hLast=0,pulse=null,hI=0;
const hT=(ms,f)=>hTim.push(setTimeout(f,ms));
function hFrame(ts){hRaf=0;if(S.screen!=='landing')return;HS.t=ts/1000;
 if(pulse){const p=Math.min(1,(ts-pulse.t0)/pulse.dur),L=pulse.el.getTotalLength(),pt=pulse.el.getPointAtLength(L*ease(p)),g=$('#hPulse');g.setAttribute('transform',`translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);g.style.opacity=1;if(p>=1){const f=pulse.done;pulse=null;g.style.opacity=0;if(f)f()}}
 if(ts-hLast>33){hLast=ts;hDraw()}
 if((!hPaused&&hVis)||pulse)hRaf=requestAnimationFrame(hFrame);else hDraw()}
function hTween(fx,ms){const from={};Object.keys(fx).forEach(k=>{if(typeof fx[k]==='boolean')HS[k]=fx[k];else from[k]=HS[k]});tween(ms,p=>{Object.keys(from).forEach(k=>{HS[k]=from[k]+(fx[k]-from[k])*p})})}
function hRoute(st){const g=$('#hSig');g.className='sig '+(st.via==='dev'?'dev':'cloud');g.textContent=st.via==='dev'?'Gemini Nano · on device':'Gemini · cloud';$('#hWhy').textContent=st.why}
function hCmd(st){$('#hCall').textContent=st?st.call:'';$('#hApp').textContent=st?`Carried out by the ${st.app}`:''}
function hPulse(el,dur,done){pulse={el,t0:performance.now(),dur,done};if(!hRaf)hRaf=requestAnimationFrame(hFrame)}
function hStep(){if(hPaused||!hVis||S.screen!=='landing'){hRun=false;return}hRun=true;hTim=[];
 const i=hI%HSEQ.length,st=HSEQ[i];hI++;
 if(i===0&&hI>1){hTween(HS0,700);HS.act=null}
 $$('#heroSvg .po').forEach(p=>p.classList.remove('on'));HS.act=null;HS.cloud=0;
 const own=st.lang==='kn'?$('#hKn'):$('#hEn'),oth=st.lang==='kn'?$('#hEn'):$('#hKn'),w=st.said.split(' ');
 own.textContent='';oth.textContent='';HS.amp=1;HS.pinch=0;hCmd(null);$('#hSig').className='sig local';$('#hSig').textContent='Listening';$('#hWhy').textContent='';
 w.forEach((x,j)=>hT(j*190,()=>{own.textContent=w.slice(0,j+1).join(' ')}));
 hT(w.length*190+120,()=>{HS.amp=0});
 hT(1100,()=>{hRoute(st);HS.pinch=1;const d=HD.find(x=>x.id===st.d);
  const arrive=()=>{hTween(st.fx,800);HS.act=st.d;oth.textContent=st.tr;HS.pinch=0;hCmd(st)};
  if(st.via==='dev'){$('#po-'+d.id).classList.add('on');hPulse($('#po-'+d.id),900,arrive)}
  else{$('#po-cloud').classList.add('on');hPulse($('#po-cloud'),560,()=>{HS.cloud=1;$('#pc-'+d.id).classList.add('on');hPulse($('#pc-'+d.id),900,arrive)})}});
 hT(st.via==='dev'?4300:4900,hStep)}
function hKick(){if(!hPaused&&hVis&&S.screen==='landing'&&!hRun)hStep();if(!hRaf)hRaf=requestAnimationFrame(hFrame)}
function hSetPaused(v){hPaused=v;$('#hPause').setAttribute('aria-pressed',String(v));$('#hPauseTx').textContent=v?'Play motion':'Pause motion';$('#hPauseIc').setAttribute('href',v?'#i-play':'#i-pause');
 if(v){hTim.forEach(clearTimeout);hTim=[];hRun=false;pulse=null;$('#hPulse').style.opacity=0;HS.amp=0;hDraw()}else hKick()}
function hCompose(){Object.assign(HS,{lamp:.3,kg:1,ksel:1,act:'lamp',cloud:1});hCmd(HSEQ[0]);$('#po-cloud').classList.add('on');$('#pc-lamp').classList.add('on');hDraw()}

/* device explorer */
const XD=[
 {id:'lamp',n:'Desk lamp',k:'Any smart lamp',d:'Brightness and warmth, by voice or a slow pinch and lift.',f:dLamp,w:160,h:240,say:'ದೀಪದ ಬೆಳಕು ಕಡಿಮೆ ಮಾಡು',alt:'Dim the lamp',lang:'kn',via:'cloud',why:'Kannada detected → cloud',fx:{lamp:.3},call:'lamp.setBrightness(30)',app:'Mendcraft Home app'},
 {id:'music',n:'Music',k:'Speaker or phone',d:'Play, pause, skip and set the volume without reaching for anything.',f:dSpeaker,w:110,h:150,say:'Pause the music',alt:'ಹಾಡನ್ನು ನಿಲ್ಲಿಸು',lang:'en',via:'dev',why:'English command → on device',fx:{playing:false},call:'music.pause()',app:'Mendcraft Home app'},
 {id:'phone',n:'Phone',k:'Android or iPhone',d:'Read and reply to messages, answer calls and scroll, from across the room.',f:dPhone,w:80,h:164,say:'Read my last message',alt:'ನನ್ನ ಕೊನೆಯ ಸಂದೇಶ ಓದು',lang:'en',via:'dev',why:'English command → on device',fx:{read:1},call:'messages.readLatest()',app:'Mendcraft phone app'},
 {id:'ipad',n:'iPad',k:'Second screen',d:'A second canvas beside you, or the control room propped up on the desk.',f:dTablet,w:128,h:176,say:'ನಕ್ಷೆಯನ್ನು ಐಪ್ಯಾಡಿನಲ್ಲಿ ತೋರಿಸು',alt:'Show the plan on the iPad',lang:'kn',via:'cloud',why:'Kannada detected → cloud',fx:{tab:1},call:'display.show("ipad", "plan")',app:'Mendcraft phone app'},
 {id:'web',n:'The browser',k:'Chrome',d:'Scroll pages, press buttons and fill in forms, anywhere on the web.',f:dBrowser,w:240,h:160,say:'Scroll down a bit',alt:'ಸ್ವಲ್ಪ ಕೆಳಗೆ ಸರಿಸು',lang:'en',via:'dev',why:'English command → on device',fx:{scroll:1},call:'page.scroll(0.5)',app:'Mendcraft for Chrome'},
 {id:'design',n:'Design tools',k:'Laptop',d:'Floor plans, app screens and printable parts. One of the things your hands and voice can do.',f:dLaptop,w:240,h:150,say:'Make the kitchen a bit bigger',alt:'ಅಡುಗೆಮನೆಯನ್ನು ಸ್ವಲ್ಪ ದೊಡ್ಡದು ಮಾಡು',lang:'en',via:'dev',why:'English command → on device',fx:{kg:1,ksel:1},call:'plan.resizeRoom("kitchen", +0.5)',app:'Mendcraft Studio'}];
let xi=0,xRaf=0,xPulse=null,xTim=[];const XS=Object.assign({t:0},HS0);
function xGeo(){const d=XD[xi],s=Math.min(390/d.w,330/d.h),cx=372,cy=200;return{d,s,cx,cy,left:cx-d.w*s/2}}
function xDraw(){const g=xGeo(),p=xPulse?xPulse.p:-1;
 $('#xSvg').innerHTML=`<ellipse cx="${g.cx}" cy="${g.cy+g.d.h*g.s/2+18}" rx="${g.d.w*g.s*.42}" ry="10" fill="rgb(0 0 0/.5)"/><path d="M40 ${g.cy}H${(g.left-12).toFixed(1)}" stroke="rgb(242 240 234/.18)" stroke-width="1.2" stroke-dasharray="2 6"/>${handSVG(40,g.cy,.36,'rgb(242 240 234/.7)','#F2F0EA',AC2,0)}${p>=0?`<path d="M40 ${g.cy}H${(40+(g.left-52)*p).toFixed(1)}" stroke="${AC2}" stroke-width="1.8"/><circle cx="${(40+(g.left-52)*p).toFixed(1)}" cy="${g.cy}" r="12" fill="${AC2}" opacity=".25"/><circle cx="${(40+(g.left-52)*p).toFixed(1)}" cy="${g.cy}" r="4.5" fill="#fff"/>`:''}${g.d.f(g.cx,g.cy,g.s,XS,'x')}`}
function xFrame(ts){xRaf=0;XS.t=ts/1000;if(xPulse){xPulse.p=Math.min(1,(ts-xPulse.t0)/700);if(xPulse.p>=1){const f=xPulse.done;xPulse=null;f()}}xDraw();if(xPulse||(!RM()&&S.screen==='landing'&&xVis))xRaf=requestAnimationFrame(xFrame)}
let xVis=false;
function xRun(){xTim.forEach(clearTimeout);xTim=[];Object.assign(XS,HS0);const d=XD[xi];
 if(RM()){Object.assign(XS,d.fx);xDraw();return}
 xTim.push(setTimeout(()=>{xPulse={t0:performance.now(),p:0,done:()=>tween(800,q=>{Object.keys(d.fx).forEach(k=>{if(typeof d.fx[k]==='boolean')XS[k]=d.fx[k];else XS[k]=HS0[k]+(d.fx[k]-HS0[k])*q})})};if(!xRaf)xRaf=requestAnimationFrame(xFrame)},350));if(!xRaf)xRaf=requestAnimationFrame(xFrame)}
function xSelect(i,focus){xi=i;const d=XD[i];$$('#xlist [role=tab]').forEach((b,j)=>{b.setAttribute('aria-selected',String(j===i));b.tabIndex=j===i?0:-1;if(j===i&&focus)b.focus()});
 $('#xpanel').setAttribute('aria-labelledby','xt-'+d.id);const sy=$('#xSay'),k=$('#xKn');sy.textContent=`“${d.say}”`;sy.lang=d.lang==='kn'?'kn':'en';k.textContent=d.alt;k.lang=d.lang==='kn'?'en':'kn';
 $('#xSig').className='sig '+d.via;$('#xSig').textContent=d.via==='dev'?'Gemini Nano · on device':'Gemini · cloud';$('#xWhy').textContent=d.why;$('#xCall').textContent=`Gemini picks ${d.call}. The ${d.app} carries it out.`;xRun()}
function xBuild(){$('#xlist').innerHTML=XD.map((d,i)=>`<button role="tab" id="xt-${d.id}" aria-controls="xpanel" aria-selected="${i===0}" tabindex="${i===0?0:-1}" data-x="${i}"><b>${d.n}</b><span class="k">${d.k}</span><span class="x"><span>${d.d}</span></span></button>`).join('');xSelect(0)}

function handMini(){let jit='M150 60',sm='M150 60';let seed=7;const r=()=>(seed=seed*16807%2147483647)/2147483647-.5;
 for(let x=154;x<=312;x+=4){const base=60+Math.sin((x-150)/22)*14;jit+=`L${x} ${(base+r()*18).toFixed(1)}`;sm+=`L${x} ${base.toFixed(1)}`}
 $('#handMini').innerHTML=handSVG(62,62,.48,'var(--ink)','var(--ink)','var(--acc-mark)',0)+`<path d="${jit}" fill="none" stroke="var(--ink-3)" stroke-width="1" opacity=".7"/><path d="${sm}" fill="none" stroke="var(--acc-mark)" stroke-width="2" stroke-linecap="round"/>`}

/* film placeholder */
const FV={G:clone(G0),sel:'kitchen',tf:null};FV.G.rooms[1].w=3.5;let fT=[];
function drawFilm(){const s=$('#fPlan');if(!s)return;const wide=s.clientWidth>620;FV.tf=drawPlan(s,FV.G,{sel:FV.sel,pad:wide?40:20,padL:wide?Math.min(320,s.clientWidth*.32):20,padB:wide?40:100,small:!wide});if(FV.tf&&!fT.length)fPlace()}
const fAt=k=>FV.tf?[FV.tf.X(k.x+k.w*.72)+'px',FV.tf.Y(k.y+k.h*.78)+'px']:[$('#fCur').style.left,$('#fCur').style.top];
function fPlace(){const c=$('#fCur');[c.style.left,c.style.top]=fAt(FV.G.rooms[1])}
function fSig(w,why){const g=$('#fSig');g.className='sig '+sigC(w);g.textContent=sigT(w);$('#fWhy').textContent=why}
function playFilm(){fT.forEach(clearTimeout);fT=[0];const cur=$('#fCur'),prog=$('#fProg'),kn=$('#fKn'),en=$('#fEn'),tst=$('#fToast');
 FV.G=clone(G0);FV.sel=null;drawFilm();$('#fPlay').hidden=true;tst.classList.remove('on');kn.textContent='';en.textContent='';fSig('hand','Hand points stay here');prog.style.strokeDashoffset=214;
 cur.style.transition='none';cur.style.left='16%';cur.style.top='84%';void cur.offsetWidth;cur.style.transition='';
 const sp=RM()?.35:1,at2=(ms,f)=>fT.push(setTimeout(f,ms*sp)),k=FV.G.rooms[1];
 at2(300,()=>{[cur.style.left,cur.style.top]=fAt(k)});
 at2(1700,()=>tween(800*sp,p=>prog.style.strokeDashoffset=214*(1-p)));
 at2(2600,()=>{$('#fT1').setAttribute('cx',38);$('#fT2').setAttribute('cx',42);setTimeout(()=>{$('#fT1').setAttribute('cx',33);$('#fT2').setAttribute('cx',47)},250);FV.sel='kitchen';drawFilm();prog.style.strokeDashoffset=214});
 const ws='ಅಡುಗೆಮನೆಯನ್ನು ಸ್ವಲ್ಪ ದೊಡ್ಡದು ಮಾಡು'.split(' ');ws.forEach((w,i)=>at2(3100+i*320,()=>{kn.textContent=ws.slice(0,i+1).join(' ')}));
 at2(4500,()=>fSig('cloud','Kannada detected → cloud'));
 at2(5100,()=>{en.textContent='Make the kitchen a bit bigger';tween(700*sp,p=>{k.w=3+.5*p;drawFilm();cur.style.left=fAt(k)[0]})});
 at2(6200,()=>tst.classList.add('on'));
 at2(9600,()=>{$('#fPlay').hidden=false;$('#fPlayTx').textContent='Play it again';tst.classList.remove('on');fT=[]})}

/* modes */
const MODES={plan:['Sample floor plan','Walls snap to 10 cm, doors swing the right way and rooms resize when you say so. Measurements stay exact, in metres or feet.'],ui:['Sample clinic booking screen','Lay out web and app screens by voice, then nudge them with a pinch. Mendcraft won’t let a button shrink below 44 px.'],part:['Sample key turner part','Design small helpers for 3D printing, like a key turner or a jar-lid grip, sized to your own hand.']};
let lmode='plan';
function drawMode(){const s=$('#modeFig');if(lmode==='plan')drawPlan(s,G0,{sel:'kitchen',pad:48});else if(lmode==='ui')drawUI(s,{sel:'cta',btnH:56});else drawPart(s,{grip:38,len:90,sel:'grip'});s.setAttribute('aria-label',MODES[lmode][0]);$('#modeText').textContent=MODES[lmode][1]}
function setLMode(m,f){lmode=m;$$('[data-lmode]').forEach(b=>{const on=b.dataset.lmode===m;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;if(on&&f)b.focus()});$('#mpanel').setAttribute('aria-labelledby','mt-'+m);drawMode()}

/* recipe teaser */
const WIND={name:'Wind down',steps:[{t:'Save the project'},{t:'Dim the lamp to 20%'},{t:'Pause the music'},{t:'Turn off hand tracking'}]};let sdT=[],sdOn=false;
function seqDemo(cur){$('#seqDemo').innerHTML=`<div class="seqhead"><div><h3>Wind down</h3><div class="trig"><span>Say <b>“That’s enough for today”</b></span><span lang="kn">“ಇವತ್ತಿಗೆ ಸಾಕು”</span><span>Or a soft fist, held for 1 second</span></div></div><button class="btn btn-p" id="sdPlay">${ic(sdOn?'pause':'play')}${sdOn?'Playing':'Play'}</button></div>${seqHTML(WIND.steps,cur)}<div class="ruler" aria-hidden="true"><span>0 s</span><span>1 s</span><span>2 s</span><span>3 s</span><span>3.8 s</span></div>`}
function seqPlay(){if(sdOn)return;sdOn=true;seqDemo(0);let i=0;const dt=RM()?400:950;const tick=()=>{i++;if(i>=WIND.steps.length){sdOn=false;seqDemo(-1);const b=$('#sdPlay');if(b)b.focus();return}updSeq($('#seqDemo'),i);sdT.push(setTimeout(tick,dt))};sdT.push(setTimeout(tick,dt))}

/* airplane demo */
const AIR={on:true,jobs:[{l:'Room preview render',s:'queue'},{l:'Kannada command, as text',s:'queue'}]};
function renderAir(){$('#airWid').innerHTML=`<button class="sw" role="switch" aria-checked="${AIR.on}" id="airSw"><span class="trk" aria-hidden="true"></span><span>Airplane mode<small>${AIR.on?'Edits still work. Cloud jobs wait.':'Online. The queue sends itself.'}</small></span></button><div>${AIR.jobs.map(j=>`<div class="qrow"><span>${j.l}</span><span class="sig ${j.s==='queue'?'queue':'cloud'}">${j.s==='queue'?'Waiting for Gemini · cloud':'Sent to Gemini · cloud'}</span></div>`).join('')}</div>`}
function airToggle(){AIR.on=!AIR.on;if(AIR.on)AIR.jobs.forEach(j=>j.s='queue');renderAir();$('#airSw').focus();if(!AIR.on)AIR.jobs.forEach((j,i)=>setTimeout(()=>{if(!AIR.on){j.s='sent';const f=document.activeElement&&document.activeElement.id==='airSw';renderAir();if(f)$('#airSw').focus()}},700+i*700))}

/* QR placeholder */
(()=>{let seed=482715;const rnd=()=>(seed=seed*16807%2147483647)/2147483647;let s='';const fin=(x,y)=>`<rect x="${x}" y="${y}" width="7" height="7" fill="#0B0B0A"/><rect x="${x+1}" y="${y+1}" width="5" height="5" fill="#F2F0EA"/><rect x="${x+2}" y="${y+2}" width="3" height="3" fill="#0B0B0A"/>`;
 for(let y=0;y<25;y++)for(let x=0;x<25;x++){if((x<8&&y<8)||(x>16&&y<8)||(x<8&&y>16))continue;if(rnd()>.5)s+=`<rect x="${x}" y="${y}" width="1" height="1" fill="#0B0B0A"/>`}
 $('#qr').innerHTML=s+fin(0,0)+fin(18,0)+fin(0,18)})();

/* how Gemini powers Mendcraft */
const GX=[
 {id:'kn',lab:'ದೀಪದ ಬೆಳಕು ಕಡಿಮೆ ಮಾಡು',lang:'kn',said:'“ದೀಪದ ಬೆಳಕು ಕಡಿಮೆ ಮಾಡು”',sub:'Spoken in Kannada: “Dim the lamp”',eng:'cloud',cap:'kn',why:'Kannada detected → cloud',call:'lamp.setBrightness(30)',app:'home'},
 {id:'en',lab:'Pause the music',lang:'en',said:'“Pause the music”',sub:'Spoken in English',eng:'nano',cap:'intent',why:'English command → on device',call:'music.pause()',app:'home'},
 {id:'off',lab:'Make the kitchen bigger, offline',lang:'en',said:'“Make the kitchen a bit bigger”',sub:'Spoken in English, in airplane mode',eng:'nano',cap:'offline',why:'Offline edit → on device',call:'plan.resizeRoom("kitchen", +0.5)',app:'studio'},
 {id:'hand',lab:'A shaky pinch',lang:'en',said:'A pinch with a slight tremor',sub:'No words, just a gesture',eng:'nano',cap:'hand',why:'Hand-adaptive input → on device',call:'input.tune(0.9, 0.6)',app:'input'},
 {id:'render',lab:'Render the living room',lang:'en',said:'“Render a preview of the living room”',sub:'Spoken in English',eng:'cloud',cap:'render',why:'Big render → cloud',call:'render.preview("living")',app:'studio'},
 {id:'a11y',lab:'Check this screen',lang:'en',said:'“Check this screen for accessibility”',sub:'Spoken in English, in UI mode',eng:'cloud',cap:'a11y',why:'Accessibility check → cloud',call:'a11y.review("booking")',app:'studio'}];
let gi=0;
function gxBuild(){$('#gx').innerHTML=GX.map((g,i)=>`<button data-gx="${i}" aria-pressed="${i===gi}"${g.lang==='kn'?' lang="kn"':''}>${esc(g.lab)}</button>`).join('');gxSelect(0)}
function gxSelect(i){gi=i;const g=GX[i];$$('#gx button').forEach((b,j)=>b.setAttribute('aria-pressed',String(j===i)));
 const sd=$('#gdSaid');sd.textContent=g.said;sd.lang=g.lang==='kn'?'kn':'en';$('#gdSaidSub').textContent=g.sub;$('#gdWhy').textContent=`${g.eng==='nano'?'Gemini Nano · on device':'Gemini · cloud'}. ${g.why}`;$('#gdCall').textContent=g.call;
 $('#gb-nano').classList.toggle('on',g.eng==='nano');$('#gb-nano').classList.toggle('off',g.eng!=='nano');$('#gb-cloud').classList.toggle('on',g.eng==='cloud');$('#gb-cloud').classList.toggle('off',g.eng!=='cloud');
 $$('#gd [data-cap]').forEach(li=>li.classList.toggle('on',li.dataset.cap===g.cap));$$('#gdApps [data-app]').forEach(li=>li.classList.toggle('on',li.dataset.app===g.app));
 gdLines()}
function gdLines(){const gd=$('#gd'),svg=$('#gdLines');if(!gd||!gd.clientWidth)return;const R0=gd.getBoundingClientRect();
 const B=id=>{const r=$('#gb-'+id).getBoundingClientRect();return{l:r.left-R0.left,t:r.top-R0.top,r:r.right-R0.left,b:r.bottom-R0.top,cx:(r.left+r.right)/2-R0.left,cy:(r.top+r.bottom)/2-R0.top}};
 const act=GX[gi].eng==='cloud'?'cloud':'nano';
 const P=[['you','router',1],['router','nano',act==='nano'],['router','cloud',act==='cloud'],['nano','cmd',act==='nano'],['cloud','cmd',act==='cloud'],['cmd','apps',1]];
 svg.setAttribute('viewBox',`0 0 ${R0.width.toFixed(0)} ${R0.height.toFixed(0)}`);
 let o='';P.forEach(([a,b,on])=>{const A=B(a),C=B(b);let d;
  if(C.l>=A.r-4){const x1=A.r,y1=A.cy,x2=C.l,y2=C.cy,mx=(x1+x2)/2;d=`M${x1.toFixed(1)} ${y1.toFixed(1)}C${mx.toFixed(1)} ${y1.toFixed(1)} ${mx.toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`}
  else{const x1=A.cx,y1=A.b,x2=C.cx,y2=C.t,my=(y1+y2)/2;d=`M${x1.toFixed(1)} ${y1.toFixed(1)}C${x1.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`}
  o+=`<path class="gl-off" d="${d}"/>${on?`<path class="gl-on" d="${d}"/>`:''}`});
 svg.innerHTML=o}

/* pinch cursor with dwell, kept to the working area */
const cur=$('#pinch'),pProg=$('#pProg'),pLab=$('#pLab');
let tx=-500,ty=-500,cx=-500,cy=-500,tgt=null,prog=0,armed=true,fx=0,fy=0,lastT=0,raf=0,mouse=false,out=false,tests=0,hdrB=64;
const zoneOf=el=>!el?null:S.screen==='preferences'?el.closest('#s-preferences'):(el.closest('dialog[open]')||el.closest('#s-editor .ed-tools,#s-editor .ed-top,#s-editor .ed-body,#s-editor .cap'));
function dwellTarget(el){if(!el)return null;if(S.screen==='preferences')return el.closest('#dwellTest');const t=el.closest('button,[data-room],[data-el],[role=menuitem]');if(!t||t.getAttribute('aria-disabled')==='true')return null;return t.closest('#s-editor')||t.closest('dialog[open]')?t:null}
const nameOf=t=>(t.getAttribute('aria-label')||t.textContent||'').replace(/\s+/g,' ').trim().slice(0,34);
function fire(t){$('#pT1').setAttribute('cx',38);$('#pT2').setAttribute('cx',42);setTimeout(()=>{$('#pT1').setAttribute('cx',32);$('#pT2').setAttribute('cx',48)},230);
 if(t.click&&!(t instanceof SVGElement))t.click();else t.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))}
function hideCur(){cur.classList.remove('on');tgt=null;prog=0;pLab.textContent=''}
function loop(ts){raf=0;if(!(S.hands&&mouse&&!out&&(S.screen==='editor'||S.screen==='preferences'))){hideCur();lastT=0;return}
 if(cx<-400){cx=tx;cy=ty}
 const a=1-Math.min(.88,P.smooth/100*.88);cx+=(tx-cx)*a;cy+=(ty-cy)*a;
 const dt=lastT?Math.min(64,ts-lastT):16;lastT=ts;
 const el=document.elementFromPoint(cx,cy),zone=cy>hdrB?zoneOf(el):null;
 if(!zone){hideCur()}else{
  cur.classList.add('on');cur.style.transform=`translate(${cx.toFixed(1)}px,${cy.toFixed(1)}px)`;
  const t=dwellTarget(el);
  if(!armed&&Math.hypot(cx-fx,cy-fy)>16)armed=true;
  if(t!==tgt){tgt=t;prog=0}
  if(tgt&&armed){prog=Math.min(1,prog+dt/P.dwell);if(prog>=1){fire(tgt);prog=0;armed=false;fx=cx;fy=cy}}
  pLab.textContent=tgt&&armed&&prog>.05?nameOf(tgt):'';cur.classList.toggle('flip',cx>innerWidth-260);
  pProg.style.strokeDashoffset=(214*(1-prog)).toFixed(1)}
 if(Math.abs(tx-cx)>.4||Math.abs(ty-cy)>.4||(tgt&&armed))raf=requestAnimationFrame(loop);else lastT=0}
addEventListener('pointermove',e=>{mouse=e.pointerType==='mouse'||e.pointerType==='pen';out=false;tx=e.clientX;ty=e.clientY;if(!raf)raf=requestAnimationFrame(loop)},{passive:true});
document.documentElement.addEventListener('mouseleave',()=>{out=true;if(!raf)raf=requestAnimationFrame(loop)});
addEventListener('scroll',()=>{if(!raf)raf=requestAnimationFrame(loop)},{passive:true});
addEventListener('pointerdown',e=>{kbd=false;armed=false;prog=0;cx=tx=fx=e.clientX;cy=ty=fy=e.clientY},true);
const hostCursor=()=>{const d=$('dialog[open]');(d||document.body).appendChild(cur)};

/* events */
addEventListener('keydown',e=>{kbd=true;
 if(e.key==='Escape'&&openM){closeMenus(true);return}
 if(openM&&(e.key==='ArrowDown'||e.key==='ArrowUp')){const it=$$('[role=menuitem]',openM.menu),i=it.indexOf(document.activeElement);const n=it[(i+(e.key==='ArrowDown'?1:-1)+it.length)%it.length];if(n){n.focus();e.preventDefault()}return}
 const t=e.target;if(!t.matches)return;
 if((e.key==='Enter'||e.key===' ')&&t.matches('[data-room],[data-el]')){e.preventDefault();t.dispatchEvent(new MouseEvent('click',{bubbles:true}))}
 if(t.matches('[data-in]')&&e.key==='Enter'){t.blur();t.focus()}
 const arrows=['ArrowRight','ArrowLeft','ArrowDown','ArrowUp'];
 if(t.matches('[data-lmode]')&&arrows.includes(e.key)){const tabs=$$('[data-lmode]'),i=tabs.indexOf(t),n=tabs[(i+(e.key==='ArrowRight'||e.key==='ArrowDown'?1:-1)+tabs.length)%tabs.length];e.preventDefault();setLMode(n.dataset.lmode,true)}
 if(t.matches('[data-x]')&&arrows.includes(e.key)){const i=+t.dataset.x,n=(i+(e.key==='ArrowRight'||e.key==='ArrowDown'?1:-1)+XD.length)%XD.length;e.preventDefault();xSelect(n,true)}});
document.addEventListener('click',e=>{const t=e.target.closest('button,[data-room],[data-el]');
 if(openM&&!openM.menu.contains(e.target)&&!openM.btn.contains(e.target))closeMenus();
 if(!t)return;const d=t.dataset;
 if(t.getAttribute('aria-disabled')==='true')return;
 if(d.go){go(d.go);return}
 if(d.scroll){const el=document.getElementById(d.scroll);if(el){el.scrollIntoView({behavior:RM()?'auto':'smooth',block:'start'});if(!el.hasAttribute('tabindex'))el.setAttribute('tabindex','-1');el.focus({preventScroll:true})}return}
 if(d.close!==undefined){t.closest('dialog').close();return}
 if(d.room){S.sel=d.room;const r=room(d.room);addFeed('hand',`Selected the ${r.name.toLowerCase()}`,'Hand points stay on this device');render();announce(`${r.name} selected, ${fmt(r.w)} by ${fmt(r.h)}`);return}
 if(d.el){if(S.mode==='ui')S.ui.sel=d.el;render();return}
 if(d.tool){setTool(d.tool);return}
 if(d.act){doAct(d.act);return}
 if(d.say){closeMenus();say(PH.find(x=>x.id===d.say));return}
 if(d.step){const[k,v]=d.step.split(',');stepVal(k,+v);return}
 if(d.qa){if(d.qa==='door'||d.qa==='window'){const m=d.qa==='door'?addDoor(S.sel):addWindow(S.sel);addFeed('local',m,'Pinch on a button, no AI needed');render();announce(m)}else doAct(d.qa);return}
 if(d.emode){S.mode=d.emode;S.tool='select';$$('[data-emode]').forEach(b=>b.setAttribute('aria-pressed',String(b===t)));$('#h-ed').textContent={plan:'Ground floor plan',ui:'Clinic booking screen',part:'Key turner'}[S.mode];$('#docSub').textContent={plan:'Lakshmi’s flat, saved on this device',ui:'Sunrise Physio site, saved on this device',part:'Front-door key, saved on this device'}[S.mode];$('#hint').textContent=hintFor('select');renderTools();render();return}
 if(d.lf){S.lf=d.lf;renderLedgers();return}
 if(d.copy){const txt=summary()+'\n\n'+S.ledger.map(e=>`${clock(e.t)}  ${e.title}, ${e.kb} KB. ${e.detail}${e.heard?' Heard: '+e.heard+'.':''} Why: ${e.why}.`).join('\n');
  try{navigator.clipboard.writeText(txt).then(()=>toast('Copied the ledger as text.'),()=>toast('Copying isn’t allowed here. Select the text to copy it.'))}catch(err){toast('Copying isn’t allowed here. Select the text to copy it.')}return}
 if(d.local!==undefined){P.local=!P.local;saveP();toast(P.local?'Everything stays on this device. Cloud jobs will wait in the queue.':'The cloud is back on. Sending anything that was waiting.');render();if(!P.local)flush();return}
 if(d.dev){S.device=d.dev;addFeed('local',`Handed off to the ${DEV[d.dev].name}`,d.dev==='laptop'?'Gemini Nano is ready here':'No Gemini Nano here, so language goes to Gemini in the cloud');render();toast(`Now on the ${DEV[d.dev].name}.`);return}
 if(d.lamp){let m;if(d.lamp==='t')m=S.lamp.on?(S.lamp.on=false,'Turned off the desk lamp'):setLamp(S.lamp.level||70);else m=setLamp(Math.max(10,Math.min(100,S.lamp.level+(d.lamp==='+'?10:-10))));addFeed('local',m,'Pinch on a control, no AI needed');render();return}
 if(d.music){if(d.music==='p')addFeed('local',toggleMusic(),'Pinch on a control, no AI needed');else{S.music.i=(S.music.i+1)%TRACKS.length;S.music.pos=0;S.music.playing=true;addFeed('local',`Skipped to ${TRACKS[S.music.i].t}`,'Pinch on a control, no AI needed')}render();return}
 if(d.qnet){if(!S.online){S.online=true;toast('Back online. Sending what was waiting.');render();flush()}else if(P.local){P.local=false;saveP();render();flush()}else{S.online=false;toast('Airplane mode on. Edits keep working, and cloud jobs will wait.');render()}return}
 if(d.replay){replay(d.replay);return}
 if(d.teach){teach(d.teach);return}
 if(d.x!==undefined){xSelect(+d.x);return}
 if(d.gx!==undefined){gxSelect(+d.gx);return}
 if(t.id==='sdPlay'){seqPlay();return}
 if(t.id==='airSw'){airToggle();return}
});
document.addEventListener('change',e=>{const t=e.target;
 if(t.dataset.in){const v=parseFloat(String(t.value).replace(',','.'));const k=t.dataset.in;if(!setVal(k,k==='w'||k==='h'?fromU(v):v)){toast('Type a number, like 3.5.');renderInsp()}return}
 if(t.dataset.gest){P.gest[t.dataset.gest]=t.value;saveP();const f=t.id;renderGest();$('#'+f).focus();toast(`${GEST.find(g=>g.id===t.dataset.gest).n} now does: ${GACT.find(a=>a[0]===t.value)[1].toLowerCase()}.`);return}
 if(t.name==='tap'){P.tap=+t.value;saveP();applyPrefs();toast(`Targets are now at least ${P.tap} px.`);return}
 if(t.name==='cap'){P.cap=+t.value;saveP();applyPrefs();return}
 if(t.name==='units'){P.units=t.value;saveP();render();return}
 if(t.id==='uiLang'){P.ui=t.value;saveP();toast('Saved. The interface is polished in English; you can speak any language.');return}
 if(t.id==='speak'){P.speak=t.value;saveP();return}
 if(t.id==='capKn'||t.id==='capEn'){if(!$('#capKn').checked&&!$('#capEn').checked){t.checked=true;toast('Captions need at least one line.');return}P.capKn=$('#capKn').checked;P.capEn=$('#capEn').checked;saveP();applyPrefs()}});
$('#moreBtn').addEventListener('click',e=>{e.stopPropagation();openM&&openM.menu.id==='moreMenu'?closeMenus():openMenu($('#moreBtn'),$('#moreMenu'),renderMore)});
$('#sayBtn').addEventListener('click',e=>{e.stopPropagation();openM&&openM.menu.id==='sayMenu'?closeMenus():openMenu($('#sayBtn'),$('#sayMenu'),renderSay)});
$('#mic').addEventListener('click',()=>{setListening(!S.listening);addFeed('local',S.listening?'Started listening':'Stopped listening','Microphone control, no AI needed');render()});
$('#handsSw').addEventListener('click',()=>{S.hands=!S.hands;$('#handsSw').setAttribute('aria-checked',String(S.hands));$('#handsSt').textContent=S.hands?'On, using your mouse':'Off';if(!raf)raf=requestAnimationFrame(loop);renderTV()});
$('#netBtn').addEventListener('click',()=>{S.online=!S.online;toast(S.online?(S.queue.length?`Back online. Sending ${plural(S.queue.length,'queued job')}.`:'Back online.'):'Airplane mode on. Edits keep working, and cloud jobs will wait.');render();if(S.online)flush()});
$('#routeBadge').addEventListener('click',()=>{renderBadge();$('#whyDlg').showModal();hostCursor()});
$('#openLedger').addEventListener('click',()=>{$('#ledgerDlg').showModal();renderLedgers();hostCursor()});
$('#whyLedger').addEventListener('click',()=>{$('#whyDlg').close();$('#ledgerDlg').showModal();renderLedgers();hostCursor()});
$$('dialog').forEach(dl=>{dl.addEventListener('click',e=>{if(e.target===dl)dl.close()});dl.addEventListener('close',()=>setTimeout(hostCursor,0))});
$('#hPause').addEventListener('click',()=>hSetPaused(!hPaused));
$('#fPlay').addEventListener('click',playFilm);
$('#xRun').addEventListener('click',xRun);
$$('[data-lmode]').forEach(b=>b.addEventListener('click',()=>setLMode(b.dataset.lmode)));
let demoT=[];
$('#tvDemo').addEventListener('click',()=>{const b=$('#tvDemo');const stop=()=>{demoT.forEach(clearTimeout);demoT=[];b.querySelector('span').textContent='Play a sample walk'};
 if(demoT.length){stop();return}b.querySelector('span').textContent='Stop the demo';const p=id=>PH.find(x=>x.id===id);
 demoT=[[0,()=>say(p('l'))],[3400,()=>say(p('m'))],[6400,()=>{S.online=false;toast('Airplane mode on. Cloud jobs will wait.');render()}],[7600,()=>say(p('d'))],[11000,()=>say(p('r'))],[14400,()=>{S.online=true;toast('Back online. Sending what was waiting.');render();flush()}],[19000,stop]].map(([ms,f])=>setTimeout(f,ms))});
$('#dwellTest').addEventListener('click',()=>{tests++;$('#dwellRes').textContent=`Clicked. ${plural(tests,'test click')} so far, with a ${(P.dwell/1000).toFixed(1)} second dwell.`});
$('#dwell').addEventListener('input',e=>{P.dwell=+e.target.value;syncRange();saveP()});
$('#smooth').addEventListener('input',e=>{P.smooth=+e.target.value;syncRange();saveP()});
$('#gReset').addEventListener('click',()=>{P.gest=Object.assign({},P0.gest);saveP();renderGest();toast('Gestures are back to their defaults.')});
$('#rmSw').addEventListener('click',()=>{P.reduce=!P.reduce;saveP();applyPrefs();$('#rmSw').setAttribute('aria-checked',String(P.reduce));if(P.reduce){hSetPaused(true);hCompose()}});
setInterval(()=>{if(S.music.playing){S.music.pos=(S.music.pos+.35)%100;if(S.screen==='control-room'){const m=$('#musicBox .lvl i');if(m)m.style.width=S.music.pos+'%'}}},1000);

/* boot */
const setH=()=>{const h=$('#hdr').offsetHeight;hdrB=h;document.documentElement.style.setProperty('--hdr',h+'px')};
new ResizeObserver(setH).observe($('#hdr'));setH();
new ResizeObserver(()=>{fitTools();drawEditor()}).observe($('#canvas'));
new ResizeObserver(()=>fitTools()).observe($('.ed-tools'));
new ResizeObserver(()=>drawFilm()).observe($('#fPlan'));
new ResizeObserver(()=>drawMode()).observe($('#modeFig'));
new ResizeObserver(()=>gdLines()).observe($('#gd'));
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{gdLines();fitTools()});
const vis=(el,f)=>{if('IntersectionObserver' in window)new IntersectionObserver(es=>es.forEach(e=>f(e.isIntersecting))).observe(el);else f(true)};
vis($('#cons'),v=>{hVis=v;if(v)hKick()});
vis($('#xpanel'),v=>{xVis=v;if(v&&!xRaf)xRaf=requestAnimationFrame(xFrame)});
if('IntersectionObserver' in window){const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{rootMargin:'0px 0px -6% 0px',threshold:.06});$$('.rv').forEach(el=>io.observe(el))}else $$('.rv').forEach(el=>el.classList.add('in'));
applyPrefs();renderSettings();renderTools();renderTeach();heroBuild();xBuild();gxBuild();handMini();renderAir();seqDemo(-1);
if(RM()){hPaused=true;$('#hPause').setAttribute('aria-pressed','true');$('#hPauseTx').textContent='Play motion';$('#hPauseIc').setAttribute('href','#i-play');hCompose()}else hDraw();
if(APP_ROUTES[location.hash.slice(1)]){location.replace(APP_ROUTES[location.hash.slice(1)]);return}show('landing',false);
window.__mc=1;
}
}
