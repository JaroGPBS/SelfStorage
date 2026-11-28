// Single module capture. Camera stays off until a mode is chosen.
// OCR runs on the phone in a WebAssembly worker; no picture is sent to the API.
const QR_SRC='https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
const OCR_SRC='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const loads=new Map();
const el=id=>document.getElementById(id);
let generation=0,queue=Promise.resolve(),qr=null,stream=null,worker=null,ocrMode=null,busy=false;
let orientationMode='auto',sensorAngle=0,ocrAngle=0,orientationWatching=false;
const orientationLabels={auto:'Auto',right:'Prawo',left:'Lewo',upright:'Pion'};
function effectiveOcrAngle(mode,angle,landscape){
 if(mode==='right')return 90;
 if(mode==='left')return -90;
 if(mode==='upright'||landscape)return 0;
 return angle;
}
function applyOcrOrientation(){
 if(!orientationWatching)return;
 const landscape=window.matchMedia('(orientation: landscape)').matches;
 ocrAngle=effectiveOcrAngle(orientationMode,sensorAngle,landscape);
 el('belModuleOcrFrame').classList.toggle('ocr-turned',ocrAngle!==0);
 el('belModuleRotate').textContent='Obrót: '+orientationLabels[orientationMode];
 el('belModuleRotate').setAttribute('aria-label','Obrót ramki OCR: '+orientationLabels[orientationMode]+'. Naciśnij, aby zmienić.');
}
function onOcrTilt(event){
 if(orientationMode!=='auto'||!Number.isFinite(event.gamma))return;
 const gamma=event.gamma;
 // Hysteresis prevents the guide from flickering near the switching angle.
 if(gamma>55)sensorAngle=90;
 else if(gamma< -55)sensorAngle=-90;
 else if(Math.abs(gamma)<30)sensorAngle=0;
 applyOcrOrientation();
}
function startOcrOrientation(){
 orientationMode='auto';sensorAngle=0;ocrAngle=0;orientationWatching=true;
 window.addEventListener('deviceorientation',onOcrTilt);
 window.addEventListener('resize',applyOcrOrientation);
 el('belModuleRotate').classList.remove('hidden');
 applyOcrOrientation();
}
function stopOcrOrientation(){
 orientationWatching=false;orientationMode='auto';sensorAngle=0;ocrAngle=0;
 window.removeEventListener('deviceorientation',onOcrTilt);
 window.removeEventListener('resize',applyOcrOrientation);
 el('belModuleOcrFrame').classList.remove('ocr-turned');
 el('belModuleRotate').classList.add('hidden');
}
export function rotateModuleOcr(){
 if(!orientationWatching)return;
 const modes=['auto','right','left','upright'];
 orientationMode=modes[(modes.indexOf(orientationMode)+1)%modes.length];
 applyOcrOrientation();
}
export function requestModuleTiltPermission(){
 const sensor=window.DeviceOrientationEvent;
 if(typeof sensor?.requestPermission==='function'){
  try{void sensor.requestPermission().catch(()=>{});}catch{}
 }
}
function loadScript(src,globalName){
 if(window[globalName])return Promise.resolve(window[globalName]);
 if(loads.has(src))return loads.get(src);
 const p=new Promise((resolve,reject)=>{
  const existing=document.querySelector('script[src="'+src+'"]');
  const script=existing||document.createElement('script');
  let timer;
  const cleanup=()=>{clearTimeout(timer);script.removeEventListener('load',ok);script.removeEventListener('error',fail);};
  const ok=()=>{cleanup();window[globalName]?resolve(window[globalName]):reject(Error('Biblioteka skanera nie jest dostępna.'));};
  const fail=()=>{cleanup();if(!existing)script.remove();reject(Error('Nie udało się pobrać biblioteki skanera. Sprawdź internet.'));};
  script.addEventListener('load',ok);script.addEventListener('error',fail);timer=setTimeout(fail,25000);
  if(!existing){script.src=src;script.async=true;document.head.append(script);}
 }).catch(e=>{loads.delete(src);throw e;});
 loads.set(src,p);return p;
}
function stopTracks(){
 if(stream)for(const track of stream.getTracks())track.stop();
 stream=null;
 const video=el('belModuleVideo');if(video){video.pause();video.srcObject=null;}
}
async function stopQr(){
 const current=qr;qr=null;
 if(current){try{if(current.isScanning)await current.stop();}catch(e){console.warn('QR stop',e);}try{current.clear();}catch{}}
}
function endWorker(){const w=worker;worker=null;if(w)void w.terminate().catch(()=>{});}
function hideCamera(){stopOcrOrientation();el('belModuleQrReader').classList.add('hidden');el('belModuleOcrFrame').classList.add('hidden');el('belModuleCapture').classList.add('hidden');el('belModuleScanDialog').classList.remove('ocr-active');}
function enqueue(fn){queue=queue.catch(()=>{}).then(fn);return queue;}
export function stopModuleCapture(){
 generation++;ocrMode=null;busy=false;stopTracks();endWorker();hideCamera();
 return enqueue(stopQr);
}
export function startModuleCapture(mode,onResult,onStatus){
 const token=++generation;ocrMode=null;busy=false;stopTracks();endWorker();hideCamera();
 const alive=()=>token===generation&&el('belModuleScanDialog').open;
 return enqueue(async()=>{
  await stopQr();if(!alive())return;
  try{
   if(mode==='QR'){
    onStatus('Uruchamianie aparatu…');
    const QR=await loadScript(QR_SRC,'Html5Qrcode');if(!alive())return;
    el('belModuleQrReader').classList.remove('hidden');
    const formats=window.Html5QrcodeSupportedFormats;
    const instance=new QR('belModuleQrReader',formats?{formatsToSupport:[formats.QR_CODE],verbose:false}:{verbose:false});qr=instance;
    let locked=false;
    await instance.start({facingMode:'environment'},{fps:12,qrbox:(w,h)=>{const edge=Math.floor(Math.min(w,h)*.75);return {width:edge,height:edge};}},decoded=>{
     if(!alive()||locked||!String(decoded||'').trim())return;
     locked=true;
     // Queue the stop after start finishes, so start/stop cannot race.
     void stopModuleCapture().then(()=>{if(el('belModuleScanDialog').open&&generation===token+1)onResult(String(decoded));});
    },()=>{});
    if(!alive()){await stopQr();return;}
    onStatus('Skieruj aparat na kod QR numeru seryjnego.');
   }else{
    if(!navigator.mediaDevices?.getUserMedia)throw Error('Aparat jest niedostępny w tej przeglądarce.');
    onStatus('Uruchamianie aparatu…');
    const camera=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});
    if(!alive()){camera.getTracks().forEach(t=>t.stop());return;}
    stream=camera;const video=el('belModuleVideo');video.srcObject=camera;
    el('belModuleOcrFrame').classList.remove('hidden');el('belModuleScanDialog').classList.add('ocr-active');await video.play();
    if(!alive()){stopTracks();return;}
    ocrMode={token,onResult,onStatus};el('belModuleCapture').classList.remove('hidden');startOcrOrientation();
    el('belModuleScanDialog').scrollTop=0;
    onStatus('Ustaw numer w ramce. Obróć telefon lub użyj przycisku Obrót.');
   }
  }catch(e){if(alive()){stopTracks();await stopQr();hideCamera();onStatus(e?.message||'Nie udało się uruchomić aparatu.');}}
 });
}
// Preserve the OCR text for review; do not silently substitute O/0 or guess the type.
export function extractModuleSerial(value){
 const normalized=String(value||'').replace(/[–—]/g,'-').toUpperCase().trim();
 const lines=normalized.split(/[\r\n]+/).map(x=>x.trim()).filter(Boolean);
 const result=[];
 for(const line of lines){
  const cleaned=line.replace(/^(?:SERIAL\s*(?:NUMBER|NO\.?)|S\/N|SN)\s*[:#]?\s*/i,'').replace(/\s+/g,'');
  if(/^(?:\d{2,4}\/)?[A-Z0-9][A-Z0-9._/-]*$/.test(cleaned)&&/\d{4,}/.test(cleaned)&&cleaned.length<=100)result.push(cleaned);
 }
 return [...new Set(result)].length===1?result[0]:'';
}
// The camera preview uses object-fit:cover. Convert the visible guide back
// to the actual sensor coordinates, including the center crop.
function moduleOcrCrop(w,h,view,guide){
 const scale=Math.max(view.width/w,view.height/h);
 const offsetX=(view.width-w*scale)/2,offsetY=(view.height-h*scale)/2;
 const left=Math.max(0,Math.floor((guide.left-view.left-offsetX)/scale));
 const top=Math.max(0,Math.floor((guide.top-view.top-offsetY)/scale));
 const right=Math.min(w,Math.ceil((guide.right-view.left-offsetX)/scale));
 const bottom=Math.min(h,Math.ceil((guide.bottom-view.top-offsetY)/scale));
 return {sx:left,sy:top,sw:right-left,sh:bottom-top};
}
export async function captureModuleOcr(){
 const context=ocrMode,video=el('belModuleVideo');
 if(!context||context.token!==generation||busy||!video.videoWidth||!video.videoHeight)return;
 busy=true;el('belModuleCapture').disabled=true;
 const {token,onResult,onStatus}=context,alive=()=>token===generation&&el('belModuleScanDialog').open;
 let localWorker=null;
 try{
  const w=video.videoWidth,h=video.videoHeight;
  const view=video.getBoundingClientRect(),guide=el('belModuleOcrFrame').querySelector('span').getBoundingClientRect();
  const {sx,sy,sw,sh}=moduleOcrCrop(w,h,view,guide);
  if(sw<=0||sh<=0)throw Error('Nieprawidłowa ramka OCR.');
  const angle=ocrAngle,turned=angle!==0;
  const canvas=document.createElement('canvas'),scale=Math.min(2,1800/Math.max(sw,sh));
  const dw=Math.max(1,Math.round(sw*scale)),dh=Math.max(1,Math.round(sh*scale));
  canvas.width=turned?dh:dw;canvas.height=turned?dw:dh;
  const ctx=canvas.getContext('2d');ctx.filter='grayscale(1) contrast(1.25)';
  ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(angle*Math.PI/180);
  ctx.drawImage(video,sx,sy,sw,sh,-dw/2,-dh/2,dw,dh);
  stopTracks();ocrMode=null;hideCamera();onStatus('Odczytywanie numeru seryjnego…');
  const T=await loadScript(OCR_SRC,'Tesseract');if(!alive())return;
  localWorker=await T.createWorker('eng',1,{workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',logger:m=>{if(alive()&&m.status==='recognizing text')onStatus('Odczytywanie… '+Math.round((m.progress||0)*100)+'%');}});
  if(!alive())return;
  worker=localWorker;
  await localWorker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/.-_ '});
  const result=await localWorker.recognize(canvas);if(!alive())return;
  const serial=extractModuleSerial(result.data?.text);
  if(serial)onResult(serial);
  else onStatus('Nie rozpoznano jednoznacznego numeru. Spróbuj ponownie albo wpisz ręcznie.');
 }catch(e){if(alive())onStatus('OCR niedostępny lub odczyt nieudany. Spróbuj ponownie albo wpisz numer ręcznie.');console.warn('Module OCR',e);}
 finally{if(worker===localWorker)worker=null;if(localWorker)try{await localWorker.terminate();}catch{}if(alive()){busy=false;el('belModuleCapture').disabled=false;}}
}
