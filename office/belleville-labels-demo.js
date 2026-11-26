/* Belleville labels layout prototype only. No API, no print history or stock writes. */
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
].filter(p=>p.status==='NOK');
const parts=[
{id:'p1',name:'Kotwa do betonu',code:'DEMO-MG-001'},
{id:'p2',name:'Czujnik T2',code:'DEMO-MG-002'},
{id:'p3',name:'Karty SIM Orange',code:'DEMO-MG-003'},
{id:'p4',name:'Separator INDOOR',code:'DEMO-MG-004'},
{id:'p5',name:'Przewód sygnałowy kamery',code:'DEMO-MG-005'}
];
let tab='modules',selected=new Set(['m1','m2','m3']),queue=new Map(),printing=false;
const current=()=>tab==='modules'?deliveries.filter(p=>selected.has(p.id)):parts.flatMap(p=>Array.from({length:queue.get(p.id)||0},()=>p));
const label=(p,mode)=>mode==='modules'?'<article class="bel-lab-card"><div class="bel-lab-card-top"><img src="./gpbs-logo-print.svg?v=1" alt="GPBS"><small>DEMO · Data przyjęcia: <b>'+esc(p.date)+'</b></small></div><div class="bel-lab-module-body"><div class="bel-lab-qr" data-bel-lab-qr="'+esc(p.serial)+'"></div><div class="bel-lab-data"><small>TYP</small><strong>'+esc(p.type)+'</strong><small>S/N</small><b class="bel-lab-serial">'+esc(p.serial)+'</b><small>STATUS</small><strong class="bel-lab-nok">NOK</strong></div></div></article>':'<article class="bel-lab-card"><div class="bel-lab-card-top"><img src="./gpbs-logo-print.svg?v=1" alt="GPBS"><small>DEMO</small></div><div class="bel-lab-part-name">'+esc(p.name)+'</div><div class="bel-lab-module-body"><div class="bel-lab-qr" data-bel-lab-qr="'+esc(p.code)+'"></div><div class="bel-lab-data"><small>INDEKS GPBS</small><b>'+esc(p.code)+'</b></div></div></article>';
function sheets(list,mode){
 let out='';
 for(let i=0;i<list.length;i+=4){out+='<section class="bel-lab-sheet">'+Array.from({length:4},(_,j)=>list[i+j]?label(list[i+j],mode):'<div class="bel-lab-blank"></div>').join('')+'</section>';}
 return out;
}
function qr(root){
 if(typeof QRCode!=='function')return;
 root.querySelectorAll('[data-bel-lab-qr]').forEach(n=>new QRCode(n,{text:n.dataset.belLabQr,width:180,height:180,colorDark:'#000000',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M}));
}
function render(root,search=''){
 const query=String(search).trim().toLocaleLowerCase('pl');
 const data=(tab==='modules'?deliveries:parts).filter(p=>!query||Object.values(p).join(' ').toLocaleLowerCase('pl').includes(query));
 const chosen=current();
 const rows=data.map(p=>tab==='modules'?'<tr><td><input type="checkbox" data-bel-lab-select="'+p.id+'" aria-label="Wybierz '+esc(p.serial)+'" '+(selected.has(p.id)?'checked':'')+'></td><td>'+esc(p.date)+'</td><td><b>'+esc(p.type)+'</b></td><td>'+esc(p.serial)+'</td><td class="bel-lab-nok">NOK</td></tr>':'<tr><td>'+esc(p.name)+'</td><td>'+esc(p.code)+'</td><td>—</td><td><input class="bel-lab-qty" type="number" min="0" max="20" inputmode="numeric" data-bel-lab-qty="'+p.id+'" value="'+(queue.get(p.id)||'')+'" placeholder="—" aria-label="Liczba etykiet: '+esc(p.name)+'"></td></tr>').join('');
 root.innerHTML='<div class="bel-lab-demo"><div class="bel-lab-tabs"><button type="button" class="btn '+(tab==='modules'?'dark':'subtle')+'" data-bel-lab-tab="modules">Dostawy NOK</button><button type="button" class="btn '+(tab==='parts'?'dark':'subtle')+'" data-bel-lab-tab="parts">Etykiety części</button></div><div class="bel-lab-banner">DANE FIKCYJNE · PODGLĄD UKŁADU</div><div class="bel-lab-layout"><div class="bel-lab-list"><div class="bel-lab-actions">'+(tab==='modules'?'<button type="button" class="btn subtle" data-bel-lab-all="1">Zaznacz wszystkie</button><button type="button" class="btn subtle" data-bel-lab-clear="1">Wyczyść wybór</button>':'')+'<strong>'+chosen.length+' etykiet · '+Math.ceil(chosen.length/4)+' kartek A4</strong></div><div class="bel-lab-scroll"><table class="table bel-lab-table"><thead>'+(tab==='modules'?'<tr><th></th><th>Data przyjęcia</th><th>Typ</th><th>Numer seryjny</th><th>Status</th></tr>':'<tr><th>Nazwa części</th><th>Indeks GPBS</th><th>Ostatni wydruk</th><th>Do wydruku</th></tr>')+'</thead><tbody>'+(rows||'<tr><td colspan="'+(tab==='modules'?5:4)+'">Brak wyników.</td></tr>')+'</tbody></table></div><div class="bel-lab-actions"><button type="button" class="btn dark" data-bel-lab-print '+(chosen.length?'':'disabled')+'>Drukuj etykiety</button></div></div><div class="bel-lab-preview"><strong>Podgląd · A4 poziomo · 4 etykiety</strong>'+ (chosen.length?sheets(chosen,tab):'<p>Wybierz etykiety do wydruku.</p>')+'</div></div></div>';
 qr(root);
 root.querySelectorAll('[data-bel-lab-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.belLabTab;render(root,search)});
 root.querySelectorAll('[data-bel-lab-select]').forEach(b=>b.onchange=()=>{b.checked?selected.add(b.dataset.belLabSelect):selected.delete(b.dataset.belLabSelect);render(root,search)});
 root.querySelectorAll('[data-bel-lab-qty]').forEach(b=>{b.onchange=()=>{const n=Math.max(0,Math.min(20,Math.floor(Number(b.value)||0)));n?queue.set(b.dataset.belLabQty,n):queue.delete(b.dataset.belLabQty);render(root,search)};b.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();b.blur()}}});
 const all=root.querySelector('[data-bel-lab-all]'),clear=root.querySelector('[data-bel-lab-clear]');
 if(all)all.onclick=()=>{data.forEach(p=>selected.add(p.id));render(root,search)};
 if(clear)clear.onclick=()=>{selected.clear();render(root,search)};
 root.querySelector('[data-bel-lab-print]').onclick=()=>print();
}
async function print(){
 if(printing||!current().length)return;
 if(typeof QRCode!=='function'){alert('Nie wczytano generatora QR.');return;}
 printing=true;
 const root=document.createElement('div');root.id='belLabPrintRoot';root.innerHTML=sheets(current(),tab);document.body.append(root);qr(root);
 const style=document.createElement('style');style.id='belLabPageStyle';style.textContent='@page{size:A4 landscape;margin:0}';document.head.append(style);
 try{await Promise.all([...root.querySelectorAll('img')].map(img=>img.decode?.().catch(()=>{})));document.body.classList.add('printing-bel-labels');window.print();}
 catch(e){cleanup();alert('Nie udało się przygotować wydruku.');}
}
function cleanup(){if(!printing)return;document.body.classList.remove('printing-bel-labels');document.getElementById('belLabPrintRoot')?.remove();document.getElementById('belLabPageStyle')?.remove();printing=false;}
window.addEventListener('afterprint',cleanup);
window.GPBSBellevilleLabelsDemo={render};
})();
