// Single module capture. Camera stays off until a mode is chosen.
// OCR runs on the phone in a WebAssembly worker; no picture is sent to the API.
const QR_SRC='https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
const OCR_SRC='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const loads=new Map();
const el=id=>document.getElementById(id);
let generation=0,queue=Promise.resolve(),qr=null,stream=null,worker=null,ocrMode=null,busy=false;
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
function hideCamera(){el('belModuleQrReader').classList.add('hidden');el('belModuleOcrFrame').classList.add('hidden');el('belModuleCapture').classList.add('hidden');}
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
    el('belModuleOcrFrame').classList.remove('hidden');await video.play();
    if(!alive()){stopTracks();return;}
    ocrMode={token,onResult,onStatus};el('belModuleCapture').classList.remove('hidden');
    el('belModuleScanDialog').scrollTop=0;
    onStatus('Ustaw sam numer seryjny w ramce i naciśnij Odczytaj.');
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
  const canvas=document.createElement('canvas'),scale=Math.min(2,1800/sw);
  canvas.width=Math.max(1,Math.round(sw*scale));canvas.height=Math.max(1,Math.round(sh*scale));
  const ctx=canvas.getContext('2d');ctx.filter='grayscale(1) contrast(1.25)';ctx.drawImage(video,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
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
