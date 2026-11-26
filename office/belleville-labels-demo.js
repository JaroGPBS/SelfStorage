/* Belleville: fictional NOK deliveries and real read-only parts catalogue. No print history or stock writes. */
(()=>{
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const deliveries=[
{id:'m1',date:'26.11.2026',type:'FM',serial:'DEMO/26-FM-001',status:'NOK'},
{id:'m2',date:'26.11.2026',type:'LQ',serial:'DEMO/26-LQ-002',status:'NOK'},
{id:'m3',date:'26.11.2026',type:'RQ',serial:'DEMO/26-RQ-003',status:'NOK'},
{id:'m4',date:'25.11.2026',type:'XS',serial:'DEMO/26-XS-004',status:'NOK'},
{id:'m5',date:'25.11.2026',type:'DUO',serial:'DEMO/26-DUO-005',status:'NOK'},
{id:'m6',date:'25.11.2026',type:'FM',serial:'DEMO/26-FM-006',status:'OK'}
];
// Only this demo catalogue is used until the actual Belleville module ledger
// and receipt workflow exist. No fictional modules are written to D1.
const initialModuleQueue=()=>deliveries.filter(p=>p.status==='NOK').map(p=>p.id);
let parts=[],partScope='',tab='modules',moduleQueue=new Set(initialModuleQueue()),
 selected=new Set(['m1','m2','m3']),queue=new Map(),printing=false,moduleQuery='',moduleMessage='';
function restoreDemoQueue(scope){
 moduleQueue=new Set(initialModuleQueue());selected=new Set(['m1','m2','m3']);moduleQuery='';moduleMessage='';tab='modules';
 try{
  const saved=JSON.parse(localStorage.getItem('gpbs-bel-labels-demo-v1:'+scope)||'null');
  if(Array.isArray(saved)){moduleQueue=new Set(saved.filter(id=>deliveries.some(p=>p.id===id)));selected.clear();}
 }catch{}
}
function saveDemoQueue(){
 try{localStorage.setItem('gpbs-bel-labels-demo-v1:'+partScope,JSON.stringify([...moduleQueue]));}catch{}
}
const pendingModules=()=>deliveries.filter(p=>moduleQueue.has(p.id));
const moduleMatches=()=>moduleQuery.trim()?deliveries.filter(p=>p.serial.toLocaleLowerCase('pl').includes(moduleQuery.trim().toLocaleLowerCase('pl'))):[];
const moduleStatus=p=>'<span class="'+(p.status==='NOK'?'bel-lab-nok':'bel-lab-ok')+'">'+esc(p.status)+'</span>';
function setParts(rows,warehouseId,scope){
 if(partScope!==scope){queue.clear();partScope=scope;restoreDemoQueue(scope);}
 parts=rows.map(p=>({id:String(p.id),name:String(p.name||''),code:String(p.part_number||'').trim(),sap:String(p.sap_number||''),photoUrl:'/api/office?view='+(warehouseId?'partPhoto&warehouse='+encodeURIComponent(warehouseId):'frCatalogPhoto')+'&part='+encodeURIComponent(p.id)}))
  .sort((a,b)=>a.name.localeCompare(b.name,'pl',{sensitivity:'base'}));
 const allowed=new Set(parts.filter(p=>p.code).map(p=>p.id));
 for(const id of queue.keys())if(!allowed.has(id))queue.delete(id);
}
const current=()=>tab==='modules'?pendingModules().filter(p=>selected.has(p.id)):parts.flatMap(p=>Array.from({length:queue.get(p.id)||0},()=>p));
const label=(p,mode)=>mode==='modules'?'<article class="bel-lab-card"><div class="bel-lab-card-top"><img src="./gpbs-logo-print.svg?v=1" alt="GPBS"><small>DEMO · Data przyjęcia: <b>'+esc(p.date)+'</b></small></div><div class="bel-lab-module-body"><div class="bel-lab-qr" data-bel-lab-qr="'+esc(p.serial)+'"></div><div class="bel-lab-data"><small>TYP</small><strong>'+esc(p.type)+'</strong><small>S/N</small><b class="bel-lab-serial">'+esc(p.serial)+'</b><small>STATUS</small><strong class="'+(p.status==='NOK'?'bel-lab-nok':'bel-lab-ok')+'">'+esc(p.status)+'</strong></div></div></article>':'<article class="bel-lab-card bel-lab-part-card"><div class="bel-lab-part-header"><div class="bel-lab-part-name">'+esc(p.name)+'</div><img class="bel-lab-part-logo" src="./gpbs-logo-print.svg?v=1" alt="GPBS"></div><div class="bel-lab-part-body"><div class="bel-lab-part-left"><div class="bel-lab-data"><small>INDEKS GPBS</small><b>'+esc(p.code)+'</b></div><div class="bel-lab-qr" data-bel-lab-qr="'+esc(p.code)+'"></div></div><div class="bel-lab-part-photo">'+(p.photoUrl?'<img src="'+esc(p.photoUrl)+'" alt="'+esc(p.name)+'">':'<span>ZDJĘCIE</span>')+'</div></div></article>';
function sheets(list,mode){
 let out='';
 for(let i=0;i<list.length;i+=4){out+='<section class="bel-lab-sheet">'+Array.from({length:4},(_,j)=>list[i+j]?label(list[i+j],mode):'<div class="bel-lab-blank"></div>').join('')+'</section>';}
 return out;
}
function qr(root){
 if(typeof QRCode!=='function')return;
 root.querySelectorAll('[data-bel-lab-qr]').forEach(n=>new QRCode(n,{text:n.dataset.belLabQr,width:180,height:180,colorDark:'#000000',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M}));
}
function photoFallback(img){
 const parent=img.parentElement;
 if(parent&&parent.classList.contains('bel-lab-part-photo')){
  const placeholder=document.createElement('span');placeholder.textContent='ZDJĘCIE';img.replaceWith(placeholder);
 }
}
function bindPhotos(root){
 root.querySelectorAll('.bel-lab-part-photo img').forEach(img=>{
  img.addEventListener('error',()=>photoFallback(img),{once:true});
  if(img.complete&&!img.naturalWidth)photoFallback(img);
 });
}
function refreshSelection(root){
 const chosen=current();
 root.querySelector('[data-bel-lab-summary]').textContent=chosen.length+' etykiet · '+Math.ceil(chosen.length/4)+' kartek A4';
 root.querySelector('[data-bel-lab-print]').disabled=!chosen.length;
 const preview=root.querySelector('[data-bel-lab-preview]');
 preview.innerHTML=chosen.length?sheets(chosen,tab):'<p>Wybierz etykiety do wydruku.</p>';
 qr(preview);bindPhotos(preview);
}
function searchMarkup(){
 const results=moduleMatches();
 return '<div class="bel-lab-module-search"><form data-bel-lab-find-form><input type="search" data-bel-lab-find value="'+esc(moduleQuery)+'" placeholder="Wpisz numer seryjny OK lub NOK…" aria-label="Numer seryjny modułu"><button type="submit" class="btn subtle">Szukaj</button></form><div data-bel-lab-results>'+resultsMarkup(results)+'</div><div class="bel-lab-module-message" role="status">'+esc(moduleMessage)+'</div></div>';
}
function resultsMarkup(results){
 if(!moduleQuery.trim())return '';
 if(!results.length)return '<p>Nie znaleziono modułu o podanym S/N.</p>';
 return results.map(p=>'<div class="bel-lab-result"><span><b>'+esc(p.serial)+'</b> · '+esc(p.type)+' · '+moduleStatus(p)+' · '+esc(p.date)+'</span><button type="button" class="btn subtle" data-bel-lab-add="'+esc(p.id)+'" '+(moduleQueue.has(p.id)?'disabled':'')+'>'+(moduleQueue.has(p.id)?'Na liście':'+ Dodaj do wydruku')+'</button></div>').join('');
}
function render(root,search=''){
 const query=String(search).trim().toLocaleLowerCase('pl');
 const data=(tab==='modules'?pendingModules():parts).filter(p=>!query||(tab==='modules'?Object.values(p):[p.name,p.code,p.sap]).join(' ').toLocaleLowerCase('pl').includes(query));
 const chosen=current();
 const rows=data.map(p=>tab==='modules'?'<tr><td><input type="checkbox" data-bel-lab-select="'+p.id+'" aria-label="Wybierz '+esc(p.serial)+'" '+(selected.has(p.id)?'checked':'')+'></td><td>'+esc(p.date)+'</td><td><b>'+esc(p.type)+'</b></td><td>'+esc(p.serial)+'</td><td>'+moduleStatus(p)+'</td></tr>':'<tr><td>'+esc(p.name)+'</td><td>'+esc(p.code||'—')+'</td><td>—</td><td>'+(p.code?'<input class="bel-lab-qty" type="number" min="0" max="20" inputmode="numeric" data-bel-lab-qty="'+esc(p.id)+'" value="'+(queue.get(p.id)||'')+'" placeholder="—" aria-label="Liczba etykiet: '+esc(p.name)+'">':'Brak indeksu GPBS')+'</td></tr>').join('');
 root.innerHTML='<div class="bel-lab-demo"><div class="bel-lab-tabs"><button type="button" class="btn '+(tab==='modules'?'dark':'subtle')+'" data-bel-lab-tab="modules">Dostawy NOK</button><button type="button" class="btn '+(tab==='parts'?'dark':'subtle')+'" data-bel-lab-tab="parts">Etykiety części</button></div><div class="bel-lab-banner">'+(tab==='modules'?'DANE FIKCYJNE · PODGLĄD UKŁADU':'KATALOG CZĘŚCI BELLEVILLE · '+parts.length+' pozycji')+'</div><div class="bel-lab-layout"><div class="bel-lab-list">'+(tab==='modules'?searchMarkup()+'<div class="bel-lab-queue-title">Oczekujące na wydruk · '+pendingModules().length+'</div>':'')+'<div class="bel-lab-actions">'+(tab==='modules'?'<button type="button" class="btn subtle" data-bel-lab-all="1">Zaznacz wszystkie</button><button type="button" class="btn subtle" data-bel-lab-clear="1">Odznacz wszystkie</button>':'')+'<strong data-bel-lab-summary>'+chosen.length+' etykiet · '+Math.ceil(chosen.length/4)+' kartek A4</strong></div><div class="bel-lab-scroll"><table class="table bel-lab-table"><thead>'+(tab==='modules'?'<tr><th></th><th>Data przyjęcia</th><th>Typ</th><th>Numer seryjny</th><th>Status</th></tr>':'<tr><th>Nazwa części</th><th>Indeks GPBS</th><th>Ostatni wydruk</th><th>Do wydruku</th></tr>')+'</thead><tbody>'+(rows||'<tr><td colspan="'+(tab==='modules'?5:4)+'">'+(tab==='modules'&&!pendingModules().length?'Brak etykiet oczekujących na wydruk.':'Brak wyników.')+'</td></tr>')+'</tbody></table></div><div class="bel-lab-actions"><button type="button" class="btn dark" data-bel-lab-print '+(chosen.length?'':'disabled')+'>Drukuj etykiety</button>'+(tab==='modules'?'<button type="button" class="btn subtle" data-bel-lab-confirm '+(chosen.length?'':'disabled')+'>Zatwierdź wydruk</button>':'')+'</div></div><div class="bel-lab-preview"><strong>Podgląd · A4 poziomo · 4 etykiety</strong><div data-bel-lab-preview>'+ (chosen.length?sheets(chosen,tab):'<p>Wybierz etykiety do wydruku.</p>')+'</div></div></div></div>';
 qr(root);bindPhotos(root);
 root.querySelectorAll('[data-bel-lab-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.belLabTab;render(root,search)});
 root.querySelectorAll('[data-bel-lab-select]').forEach(b=>b.onchange=()=>{b.checked?selected.add(b.dataset.belLabSelect):selected.delete(b.dataset.belLabSelect);render(root,search)});
 const fields=Array.from(root.querySelectorAll('[data-bel-lab-qty]'));
 fields.forEach((b,index)=>{
  const commit=()=>{
   const n=Math.max(0,Math.min(20,Math.floor(Number(b.value)||0)));
   const old=queue.get(b.dataset.belLabQty)||0;
   b.value=n?String(n):'';
   if(n===old)return;
   n?queue.set(b.dataset.belLabQty,n):queue.delete(b.dataset.belLabQty);
   refreshSelection(root);
  };
  b.onchange=commit;
  b.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();commit();const next=fields[index+1];if(next){next.focus();next.select();}else root.querySelector('[data-bel-lab-print]').focus();}};
 });
 const all=root.querySelector('[data-bel-lab-all]'),clear=root.querySelector('[data-bel-lab-clear]');
 if(all)all.onclick=()=>{data.forEach(p=>selected.add(p.id));render(root,search)};
 if(clear)clear.onclick=()=>{selected.clear();render(root,search)};
 if(tab==='modules'){
  const find=root.querySelector('[data-bel-lab-find]'),form=root.querySelector('[data-bel-lab-find-form]'),results=root.querySelector('[data-bel-lab-results]');
  function updateResults(){moduleQuery=find.value;results.innerHTML=resultsMarkup(moduleMatches());}
  find.addEventListener('input',updateResults);
  form.onsubmit=e=>{e.preventDefault();updateResults();};
  results.onclick=e=>{
   const button=e.target.closest('[data-bel-lab-add]');if(!button||button.disabled)return;
   const p=deliveries.find(p=>p.id===button.dataset.belLabAdd);if(!p)return;
   moduleQueue.add(p.id);selected.add(p.id);saveDemoQueue();
   moduleMessage='Dodano do wydruku: '+p.serial;render(root,search);
  };
  root.querySelector('[data-bel-lab-confirm]').onclick=()=>{
   const ids=current().map(p=>p.id);if(!ids.length)return;
   if(!window.confirm('Potwierdzić wydruk i usunąć '+ids.length+' pozycji z kolejki?'))return;
   ids.forEach(id=>{moduleQueue.delete(id);selected.delete(id);});
   saveDemoQueue();moduleMessage='Zatwierdzono wydruk: '+ids.length+' poz.';render(root,search);
  };
 }
 root.querySelector('[data-bel-lab-print]').onclick=()=>print();
}
async function print(){
 if(printing||!current().length)return;
 if(typeof QRCode!=='function'){alert('Nie wczytano generatora QR.');return;}
 printing=true;
 const root=document.createElement('div');root.id='belLabPrintRoot';root.innerHTML=sheets(current(),tab);document.body.append(root);qr(root);bindPhotos(root);
 const style=document.createElement('style');style.id='belLabPageStyle';style.textContent='@page{size:A4 landscape;margin:0}';document.head.append(style);
 try{await Promise.all([...root.querySelectorAll('img')].map(img=>img.decode?.().catch(()=>photoFallback(img))));document.body.classList.add('printing-bel-labels');window.print();}
 catch(e){cleanup();alert('Nie udało się przygotować wydruku.');}
}
function cleanup(){if(!printing)return;document.body.classList.remove('printing-bel-labels');document.getElementById('belLabPrintRoot')?.remove();document.getElementById('belLabPageStyle')?.remove();printing=false;}
window.addEventListener('afterprint',cleanup);
window.GPBSBellevilleLabelsDemo={render,setParts};
})();
