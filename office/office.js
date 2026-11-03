// GPBS Storage - independent office UI. Demo warehouses never write to D1.
(()=>{'use strict';
const $=id=>document.getElementById(id);
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DEMOS=[{id:'demo1',name:'Testowy 1',team:'Ekipa A',reg:'SK 1234A',date:'28.10.2026'},{id:'demo2',name:'Testowy 2',team:'Ekipa B',reg:'ST 5678B',date:'30.10.2026'},{id:'demo3',name:'Testowy 3',team:'Ekipa C',reg:'DW 9012C',date:'25.10.2026'}];
const state={user:null,warehouses:[],warehouse:'',view:'stocks',search:'',sortReverse:false,partsCache:new Map(),docs:[],docsTotal:0,docsMatched:0,inventories:[],detailCache:new Map(),expanded:null,positive:false,negative:false,requestId:0,lastSync:null,rememberWarning:''};
function isDemo(id=state.warehouse){return DEMOS.some(w=>w.id===id);}
function realWarehouse(id){return state.warehouses.find(w=>w.id===id);}
function demoQuantity(index,demoIndex){return ((index*17+demoIndex*11)%11===0)?0:((index*13+demoIndex*7)%29);}
function dateText(raw){if(!raw)return '—';const dt=new Date(String(raw).replace(' ','T').replace(/Z?$/,'Z'));return isNaN(dt.getTime())?String(raw).slice(0,10):new Intl.DateTimeFormat('pl-PL',{timeZone:'Europe/Warsaw',day:'2-digit',month:'2-digit',year:'numeric'}).format(dt);}
function isoWeek(raw){
  const date=new Date(String(raw||'').replace(' ','T').replace(/Z?$/,'Z'));
  if(isNaN(date.getTime()))return '—';
  const values=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(p=>[p.type,p.value]));
  const y=Number(values.year),m=Number(values.month),d=Number(values.day);
  const utc=new Date(Date.UTC(y,m-1,d));utc.setUTCDate(utc.getUTCDate()+4-(utc.getUTCDay()||7));
  const yearStart=new Date(Date.UTC(utc.getUTCFullYear(),0,1));
  return Math.ceil((((utc-yearStart)/86400000)+1)/7);
}
async function api(view,params={}){
  const url=new URL('/api/office',location.origin);url.searchParams.set('view',view);
  for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||!payload.ok){const ex=new Error(payload.error||'Nie udało się pobrać danych.');ex.status=response.status;throw ex;}
  return payload;
}
function errorBanner(message){$('errorBanner').textContent=message||'';$('errorBanner').classList.toggle('hidden',!message);}
function showLogin(message=''){
  $('app').classList.add('hidden');$('loginScreen').classList.remove('hidden');
  $('loginError').textContent=message;$('loginError').classList.toggle('hidden',!message);
  $('pin').value='';if(!message)$('pin').focus();
}
function setLoggedIn(payload){
  if(!payload?.user||!Array.isArray(payload.warehouses))throw Error('Nieprawidłowe dane konta.');
  state.user=payload.user;state.warehouses=payload.warehouses;
  if(!state.warehouses.some(w=>w.id===state.warehouse))state.warehouse=state.warehouses.find(w=>w.id==='PL-TYCHY')?.id||state.warehouses[0]?.id||'';
  $('username').textContent=state.user.nickname||'Pracownik';
  $('userRole').textContent=({ADMIN:'Administrator',KIEROWNIK:'Kierownik',KOORDYNATOR:'Koordynator',MAGAZYNIER:'Magazynier'})[state.user.role]||state.user.role;
  $('loginScreen').classList.add('hidden');$('app').classList.remove('hidden');
  renderMenu();selectView('stocks',state.warehouse);
}
function renderMenu(){
  $('warehouseMenu').innerHTML=state.warehouses.map(w=>'<button type="button" class="subnav-btn" data-warehouse="'+escapeHtml(w.id)+'">'+escapeHtml(w.name)+'</button>').join('')+
    DEMOS.map(w=>'<button type="button" class="subnav-btn" data-warehouse="'+w.id+'">'+w.name+' <small>TEST</small></button>').join('')+
    '<button type="button" class="subnav-btn" data-view="aggregate">Zestawienie zbiorcze</button>';
  document.querySelectorAll('[data-view],[data-warehouse]').forEach(el=>{
    el.classList.toggle('active',el.dataset.view===state.view||(state.view==='stocks'&&el.dataset.warehouse===state.warehouse));
  });
}
function setHead(title,kicker,desc){
  $('pageTitle').textContent=title;$('pageKicker').textContent=kicker;$('pageDesc').textContent=desc;
  $('crumb').textContent=title;
  $('newPart').classList.toggle('hidden',state.view!=='stocks');
  $('sort').classList.toggle('hidden',!['stocks','aggregate','vehicles'].includes(state.view));
  $('search').placeholder=state.view==='stocks'||state.view==='aggregate'||state.view==='vehicles'?'Szukaj po SAP lub nazwie części':state.view==='inventories'?'Szukaj inwentaryzacji...':'Szukaj: SAP, nazwa, dostawca, pracownik...';
  $('search').value=state.search;$('sort').textContent=state.sortReverse?'Nazwa Z–A':'Nazwa A–Z';
  const name=realWarehouse(state.warehouse)?.name||DEMOS.find(x=>x.id===state.warehouse)?.name||'Magazyn';
  $('testBanner').classList.toggle('hidden',!(isDemo()||state.view==='aggregate'||state.view==='vehicles'));
  $('testBanner').textContent=state.view==='aggregate'?'Zestawienie zawiera magazyny oznaczone TEST. Ich ilości są wyłącznie przykładowe i nie są zapisane w D1.':state.view==='vehicles'?'Widok prezentacyjny. Ekipy, pojazdy i ilości są przykładowe; rzeczywiste stany samochodowe podłączymy później.':'Magazyn prezentacyjny — ilości są przykładowe i nie są zapisane w D1.';
  const stockView=state.view==='stocks';
  $('app').classList.toggle('view-stocks',stockView);
  $('warehouseCrumb').classList.toggle('hidden',!stockView);
  $('warehouseCrumb').textContent=name.replace(/^magazyn\s+/i,'').toLocaleUpperCase('pl');
  $('tableCaption').classList.toggle('hidden',!stockView);
  if(stockView){$('pageKicker').textContent=name.toUpperCase();$('pageDesc').textContent='Aktualne stany części w magazynie.';}
}
function selectView(view,warehouse){
  state.view=view;state.search='';state.expanded=null;state.positive=false;state.negative=false;
  if(warehouse)state.warehouse=warehouse;
  $('sidebar').classList.remove('open');renderMenu();
  const titles={stocks:'Stany magazynowe',aggregate:'Zestawienie zbiorcze',pz:'Przyjęcia',wz:'Wydania',inventories:'Inwentaryzacje',vehicles:'Stany samochodowe'};
  const descriptions={aggregate:'Porównanie stanów części pomiędzy magazynami.',pz:'Historia przyjęć i dostaw magazynowych.',wz:'Historia wydań magazynowych.',inventories:'Historia inwentaryzacji i bilanse.',vehicles:'Ewidencja części na samochodach serwisowych.'};
  setHead(titles[view]||'Stany magazynowe','GPBS STORAGE / POLSKA',descriptions[view]||'');
  render();
}
function setLoading(){errorBanner('');$('tableArea').innerHTML='<div class="loading">Wczytywanie danych...</div>';$('tableFooter').textContent='';$('searchNote').classList.add('hidden');}
function markSynced(){state.lastSync=new Date();$('syncTime').textContent='Aktualizacja: '+new Intl.DateTimeFormat('pl-PL',{hour:'2-digit',minute:'2-digit'}).format(state.lastSync);}
async function loadStocks(warehouseId){
  if(!state.partsCache.has(warehouseId)){
    const payload=await api('stocks',{warehouse:warehouseId});state.partsCache.set(warehouseId,payload.parts);
  }
  return state.partsCache.get(warehouseId);
}
async function realParts(){return loadStocks(state.warehouses.find(w=>w.id==='PL-TYCHY')?.id||state.warehouses[0]?.id);}
function sortedFiltered(rows){
  const q=state.search.toLocaleLowerCase('pl').trim();
  const result=rows.filter(p=>!q||[p.sap_number,p.name].some(s=>String(s||'').toLocaleLowerCase('pl').includes(q)));
  return result.sort((a,b)=>(state.sortReverse?-1:1)*String(a.name||'').localeCompare(String(b.name||''),'pl',{sensitivity:'base'}));
}
function quantity(value){return value===null||value===undefined?'<span class="stock-unknown">—</span>':Number(value)===0?'<span class="stock-zero">0</span>':escapeHtml(value);}
function wrapTable(headers,rows){
  const cols=headers.map(h=>'<th'+(h.numeric?' class="num"':'')+'>'+escapeHtml(h.label)+'</th>').join('');
  return '<table class="table"><thead><tr>'+cols+'</tr></thead><tbody>'+rows+'</tbody></table>';
}
function noteSearch(count,total,noun){
  $('searchNote').classList.toggle('hidden',!state.search.trim());
  $('searchNote').textContent=state.search.trim()?'Znaleziono w '+count+' '+noun+' z '+total+'.':'';
}
// Presentation-only figures; deterministic across search/sort and never stored in D1.
function previewMinimum(part){
  let hash=0;
  for(const ch of String(part.id||part.name||''))hash=(Math.imul(hash,31)+ch.charCodeAt(0))|0;
  return [5,10,15,20,25,30,35,40][(hash>>>0)%8];
}
function drawStocks(parts,warehouseId){
  const filtered=sortedFiltered(parts);const demoIndex=DEMOS.findIndex(w=>w.id===warehouseId);
  const rows=filtered.map(p=>{
    const originalIndex=parts.indexOf(p);
    const amount=demoIndex<0?p.quantity:demoQuantity(originalIndex,demoIndex+1);
    const min=previewMinimum(p);
    const reorder=amount===null||amount===undefined?'—':Math.max(0,min-Number(amount));
    return '<tr data-part-row="'+escapeHtml(p.id)+'" tabindex="0" aria-label="Szczegóły części: '+escapeHtml(p.name)+'">'+
      '<td>'+escapeHtml(p.sap_number||'—')+'</td><td><button class="row-link" data-part="'+escapeHtml(p.id)+'">'+escapeHtml(p.name)+'</button></td>'+
      '<td class="num">'+quantity(amount)+'</td>'+
      '<td class="num stock-demo-order">'+(reorder==='—'?'—':reorder>0?'<strong>'+escapeHtml(reorder)+'</strong>':escapeHtml(reorder))+'</td>'+
      '<td class="num stock-demo-min">'+escapeHtml(min)+'</td></tr>';
  }).join('');
  $('tableArea').innerHTML=wrapTable([
    {label:'Indeks SAP'},{label:'Nazwa części'},{label:'Stan',numeric:true},
    {label:'Zamówić',numeric:true},{label:'Stan min.',numeric:true}
  ],rows)||'';
  $('tableFooter').textContent=filtered.length+' części';
  noteSearch(filtered.length,parts.length,'częściach');
}
function drawAggregate(realSets){
  const base=realSets[0]?.parts||[];const filtered=sortedFiltered(base);
  const headers=[{label:'Indeks SAP'},{label:'Nazwa części'},...realSets.map(p=>({label:p.name})),...DEMOS.map(p=>({label:p.name+' TEST'}))];
  const rows=filtered.map(p=>'<tr><td>'+escapeHtml(p.sap_number||'—')+'</td><td>'+escapeHtml(p.name)+'</td>'+
    realSets.map(s=>{const a=s.parts.find(x=>x.id===p.id);return '<td class="num">'+quantity(a?.quantity)+'</td>';}).join('')+
    DEMOS.map((d,i)=>'<td class="num">'+quantity(demoQuantity(base.indexOf(p),i+1))+'</td>').join('')+'</tr>').join('');
  $('tableArea').innerHTML=wrapTable(headers,rows);$('tableFooter').textContent=filtered.length+' części';noteSearch(filtered.length,base.length,'częściach');
}
function cellButton(label,id,expanded){return '<button class="detail-btn" data-expand="'+escapeHtml(id)+'">'+(expanded?'Ukryj':'Pokaż '+label)+' <span aria-hidden="true">'+(expanded?'⌃':'⌄')+'</span></button>';}
async function drawDocs(){
  const direction=state.view==='pz'?'PZ':'WZ';const docs=state.docs;
  const visible=docs;
  const rows=visible.map(d=>{
    const over=Number(d.shortage||0)>0;const expanded=state.expanded===d.id;
    return '<tr'+(over?' class="warning-row"':'')+'><td>'+dateText(d.date)+'</td><td>'+isoWeek(d.date)+'</td><td>'+escapeHtml(d.counterparty)+'</td><td>'+escapeHtml(d.worker)+'</td><td>'+cellButton('części',d.id,expanded)+'</td></tr>'+
      (expanded?'<tr><td colspan="5" class="expanded-cell"><div class="expanded">'+drawDocLines(state.detailCache.get(direction+':'+d.id),direction)+'</div></td></tr>':'');
  }).join('');
  $('tableArea').innerHTML=wrapTable([{label:'Data'},{label:'Tydz.'},{label:direction==='PZ'?'Dostawca / Ekipa':'Odbiorca'},{label:direction==='PZ'?'Przyjmował':'Wydawał'},{label:''}],rows)||'<div class="empty">Brak dokumentów.</div>';
  $('tableFooter').textContent=visible.length+' dokumentów'+(state.docsMatched>visible.length?' · pokazano pierwsze '+visible.length:'');
  $('searchNote').classList.toggle('hidden',!state.search.trim());
  $('searchNote').textContent=state.search.trim()?'Znaleziono w '+state.docsMatched+' '+(direction==='PZ'?'dostawach':'wydaniach')+' z '+state.docsTotal+'.':'';
}
function drawDocLines(parts,direction){
  if(!parts)return '<div class="loading">Wczytywanie pozycji...</div>';
  const rows=parts.map(p=>'<tr><td>'+escapeHtml(p.sap_number||'—')+'</td><td>'+escapeHtml(p.name)+'</td><td class="num">'+quantity(p.quantity)+'</td></tr>').join('');
  return '<h3>'+ (direction==='PZ'?'Zawartość dostawy':'Wydane części')+'</h3>'+wrapTable([{label:'Indeks SAP'},{label:'Nazwa części'},{label:'Ilość',numeric:true}],rows);
}
function drawInventories(){
  const inventories=state.inventories;const q=state.search.toLocaleLowerCase('pl').trim();
  const visible=inventories.filter(x=>!q||[x.date,x.worker].some(s=>String(s||'').toLocaleLowerCase('pl').includes(q)));
  const rows=visible.map(inv=>'<tr><td>'+dateText(inv.date)+'</td><td>'+isoWeek(inv.date)+'</td><td>'+escapeHtml(inv.worker)+'</td><td class="num">'+escapeHtml(inv.positions)+'</td><td>'+cellButton('bilans',inv.id,state.expanded===inv.id)+'</td></tr>'+
    (state.expanded===inv.id?'<tr><td colspan="5"><div class="expanded">'+drawInventoryLines(state.detailCache.get('inv:'+inv.id))+'</div></td></tr>':'')).join('');
  $('tableArea').innerHTML=wrapTable([{label:'Data'},{label:'Tydz.'},{label:'Liczył'},{label:'Pozycji',numeric:true},{label:''}],rows)||'<div class="empty">Brak inwentaryzacji.</div>';
  $('tableFooter').textContent=visible.length+' inwentaryzacji';noteSearch(visible.length,inventories.length,'inwentaryzacjach');
}
function drawInventoryLines(lines){
  if(!lines)return '<div class="loading">Wczytywanie bilansu...</div>';
  const filtered=lines.filter(p=>{const delta=p.quantity_before===null?null:p.quantity_after-p.quantity_before;
    return (!state.positive&&!state.negative)||(state.positive&&delta!==null&&delta>0)||(state.negative&&delta!==null&&delta<0);});
  const rows=filtered.map(p=>{const diff=p.quantity_before===null?null:Number(p.quantity_after)-Number(p.quantity_before);
    const display=diff===null?'—':diff>0?'+'+diff:String(diff);
    return '<tr><td>'+escapeHtml(p.sap_number||'—')+'</td><td>'+escapeHtml(p.name)+'</td><td class="num">'+quantity(p.quantity_before)+'</td><td class="num">'+quantity(p.quantity_after)+'</td><td class="num '+(diff>0?'diff-plus':diff<0?'diff-minus':'')+'">'+display+'</td></tr>';}).join('');
  return '<h3>Bilans inwentaryzacji</h3><div class="section-controls">Pokaż różnice: <label><input type="checkbox" data-diff="positive" '+(state.positive?'checked':'')+'> Dodatnie (+)</label><label><input type="checkbox" data-diff="negative" '+(state.negative?'checked':'')+'> Ujemne (−)</label></div>'+
    wrapTable([{label:'Indeks SAP'},{label:'Nazwa części'},{label:'Przed',numeric:true},{label:'Po',numeric:true},{label:'Różnica',numeric:true}],rows)+
    '<p class="placeholder-note" style="margin-top:12px">Pozycji: '+filtered.length+' z '+lines.length+'. Nieustalony wcześniejszy stan oznaczono „—”.</p>';
}
function drawVehicles(parts){
  const filtered=sortedFiltered(parts);
  const headers=[{label:'Indeks SAP'},{label:'Nazwa części'},...DEMOS.map(d=>({label:d.team+' · '+d.reg}))];
  let html='<table class="table"><thead><tr><th>Indeks SAP</th><th>Nazwa części</th>'+DEMOS.map(d=>'<th class="car-head"><strong>'+escapeHtml(d.team)+'</strong><small>'+escapeHtml(d.reg)+'</small><i>Inwent.: '+escapeHtml(d.date)+'</i></th>').join('')+'</tr></thead><tbody>';
  for(const p of filtered)html+='<tr><td>'+escapeHtml(p.sap_number||'—')+'</td><td>'+escapeHtml(p.name)+'</td>'+DEMOS.map((d,i)=>'<td class="num">'+demoQuantity(parts.indexOf(p),i+1)%7+'</td>').join('')+'</tr>';
  $('tableArea').innerHTML=html+'</tbody></table>';$('tableFooter').textContent=filtered.length+' części · 3 pojazdy (przykładowe)';noteSearch(filtered.length,parts.length,'częściach');
}
async function render(){
  const ticket=++state.requestId;setLoading();
  const params={warehouse:state.warehouse};
  try{
    if(state.view==='stocks'){
      const parts=isDemo()?await realParts():await loadStocks(state.warehouse);
      if(ticket!==state.requestId)return;drawStocks(parts,state.warehouse);
    }else if(state.view==='aggregate'){
      const realSets=await Promise.all(state.warehouses.map(async w=>({name:w.name,parts:await loadStocks(w.id)})));
      if(ticket!==state.requestId)return;drawAggregate(realSets);
    }else if(state.view==='vehicles'){
      const parts=await realParts();if(ticket!==state.requestId)return;drawVehicles(parts);
    }else if(isDemo()){
      $('tableArea').innerHTML='<div class="empty">Historia magazynów prezentacyjnych nie jest zapisana w D1.</div>';
    }else if(state.view==='pz'||state.view==='wz'){
      const direction=state.view==='pz'?'PZ':'WZ';
      const payload=await api('documents',{...params,direction,term:state.search});
      if(ticket!==state.requestId)return;
      state.docs=payload.documents;state.docsTotal=payload.total;state.docsMatched=payload.matched;
      drawDocs();
    }else if(state.view==='inventories'){
      state.inventories=(await api('inventories',params)).inventories;
      if(ticket!==state.requestId)return;drawInventories();
    }
    markSynced();
    if(state.rememberWarning){errorBanner(state.rememberWarning);state.rememberWarning='';}
  }catch(ex){
    if(ticket!==state.requestId)return;
    errorBanner(ex.message||'Nie można pobrać danych.');$('tableArea').innerHTML='<div class="empty">Nie udało się wczytać danych.</div>';
    if(ex.status===401)showLogin('Sesja wygasła. Zaloguj się ponownie.');
  }
}
function filterCurrent(){
  if(state.view==='stocks'){const parts=state.partsCache.get(state.warehouse)||state.partsCache.get(state.warehouses[0]?.id)||[];drawStocks(parts,state.warehouse);}
  else if(state.view==='aggregate'||state.view==='vehicles'){render();}
  else if(state.view==='pz'||state.view==='wz')drawDocs();
  else if(state.view==='inventories')drawInventories();
}
async function expandRow(id){
  if(state.expanded===id){state.expanded=null;filterCurrent();return;}
  state.expanded=id;filterCurrent();
  let key,view,params;
  if(state.view==='inventories'){key='inv:'+id;view='inventory';params={warehouse:state.warehouse,id};}
  else{const direction=state.view==='pz'?'PZ':'WZ';key=direction+':'+id;view='document';params={warehouse:state.warehouse,direction,id};}
  if(!state.detailCache.has(key)){
    try{const payload=await api(view,params);state.detailCache.set(key,payload.lines);}
    catch(ex){errorBanner(ex.message);}
  }
  if(state.expanded===id)filterCurrent();
}
async function openPart(id){
  const modal=$('modal'),body=$('modalBody');modal.classList.remove('hidden');
  body.innerHTML='<h2 id="modalTitle">Szczegóły części</h2><div class="loading">Wczytywanie...</div>';
  const demo=isDemo();
  try{
    // In the demo, show real catalog information without treating the mock quantity as stock.
    const warehouse=demo?(state.warehouses.find(w=>w.id==='PL-TYCHY')?.id||state.warehouses[0].id):state.warehouse;
    const payload=await api('part',{warehouse,part:id});
    if(modal.classList.contains('hidden'))return;
    const p=payload.part;
    const amount=demo?demoQuantity((await realParts()).findIndex(x=>x.id===id),DEMOS.findIndex(x=>x.id===state.warehouse)+1):p.quantity;
    body.innerHTML='<div class="kicker">KARTA CZĘŚCI</div><h2 id="modalTitle">'+escapeHtml(p.name)+'</h2><p class="muted">Indeks SAP: '+escapeHtml(p.sap_number||'—')+'</p>'+
    '<div class="detail-hero"><div class="photo-spot"><span style="font-size:30px">▧</span><span>Zdjęcie części</span></div><div><span class="muted">Aktualny stan</span><strong>'+quantity(amount)+' szt.</strong><p class="muted">Identyfikator: '+escapeHtml(p.part_number||'—')+'</p></div></div>'+
    '<div class="detail-info"><div><small>Ostatnia dostawa</small><strong>'+(demo?'—':dateText(payload.delivery?.date))+'</strong><p class="muted">'+(!demo&&payload.delivery?'Przyjęto '+escapeHtml(payload.delivery.quantity)+' szt.':'Brak danych')+'</p></div><div><small>Ostatnia inwentaryzacja</small><strong>'+(demo?'—':dateText(payload.inventory?.date))+'</strong></div></div>'+
    '<div class="modal-actions"><button type="button" class="btn outline" disabled title="Podgląd etykiety w kolejnym etapie">Wydruk etykiety · w przygotowaniu</button></div>';
  }catch(ex){body.innerHTML='<h2 id="modalTitle">Szczegóły części</h2><p class="error">'+escapeHtml(ex.message)+'</p>';}
}
function closeModal(){$('modal').classList.add('hidden');$('modalBody').innerHTML='';}
document.addEventListener('click',e=>{
  const w=e.target.closest('[data-warehouse]');if(w){selectView('stocks',w.dataset.warehouse);return;}
  const v=e.target.closest('[data-view]');if(v){selectView(v.dataset.view);return;}
  const part=e.target.closest('[data-part]');if(part){openPart(part.dataset.part);return;}
  const partRow=e.target.closest('tr[data-part-row]');if(partRow){openPart(partRow.dataset.partRow);return;}
  const exp=e.target.closest('[data-expand]');if(exp){expandRow(exp.dataset.expand);return;}
  if(e.target.closest('[data-close]'))closeModal();
});
$('tableArea').addEventListener('change',e=>{
  if(e.target.dataset.diff){if(e.target.dataset.diff==='positive')state.positive=e.target.checked;else state.negative=e.target.checked;drawInventories();}
});
$('modalClose').addEventListener('click',closeModal);
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){closeModal();return;}
  const row=e.target.closest('tr[data-part-row]');
  if(row&&e.target===row&&(e.key==='Enter'||e.key===' ')){
    e.preventDefault();openPart(row.dataset.partRow);
  }
});
let searchTimer=null;
$('search').addEventListener('input',e=>{
  state.search=e.target.value;
  if(state.view==='pz'||state.view==='wz'){
    clearTimeout(searchTimer);searchTimer=setTimeout(()=>render(),280);
  }else filterCurrent();
});
$('sort').addEventListener('click',()=>{state.sortReverse=!state.sortReverse;$('sort').textContent=state.sortReverse?'Nazwa Z–A':'Nazwa A–Z';filterCurrent();});
$('refresh').addEventListener('click',()=>{state.partsCache.clear();state.detailCache.clear();render();});
$('warehouseToggle').addEventListener('click',()=>{const expanded=$('warehouseToggle').getAttribute('aria-expanded')==='true';$('warehouseToggle').setAttribute('aria-expanded',String(!expanded));$('warehouseMenu').classList.toggle('collapsed',expanded);});
$('mobileMenu').addEventListener('click',()=>$('sidebar').classList.toggle('open'));
$('logout').addEventListener('click',async()=>{
  try{
    // Clear long-term office cookie first; failure must not silently report logout.
    const remembered=await fetch('/api/office',{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'forget'})});
    if(!remembered.ok)throw Error('Nie udało się wylogować. Spróbuj ponownie.');
    const worker=await fetch('/api/pl/auth',{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})});
    if(!worker.ok)throw Error('Nie udało się wylogować. Spróbuj ponownie.');
    state.user=null;state.partsCache.clear();state.detailCache.clear();state.rememberWarning='';
    $('rememberMe').checked=false;showLogin();
  }catch(ex){errorBanner(ex.message||'Nie udało się wylogować.');}
});
$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();$('loginError').classList.add('hidden');const btn=$('loginButton');btn.disabled=true;
  try{
    const response=await fetch('/api/pl/auth',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',pin:$('pin').value})});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||!payload.ok)throw Error(payload.error||'Nieprawidłowy PIN.');
    if(!['ADMIN','KIEROWNIK','KOORDYNATOR','MAGAZYNIER'].includes(payload.user?.role))throw Error('Brak dostępu do panelu biurowego.');
    const rememberWanted=$('rememberMe').checked;
    const rememberResponse=await fetch('/api/office',{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:rememberWanted?'remember':'forget'})
    });
    if(!rememberResponse.ok){
      if(rememberWanted){
        state.rememberWarning='Nie udało się włączyć zapamiętywania na 30 dni. Zalogowano standardowo.';
      }else{
        // Avoid leaving an old persistent cookie from a different office user.
        throw Error('Nie udało się wyczyścić poprzedniego zapamiętanego logowania. Spróbuj ponownie.');
      }
    }else state.rememberWarning='';
    setLoggedIn(await api('warehouses'));
  }catch(ex){showLogin(ex.message||'Nie można się zalogować.');}finally{btn.disabled=false;}
});
(async()=>{try{setLoggedIn(await api('warehouses'));}catch{showLogin();}})();
setInterval(()=>{if(state.user&&document.visibilityState==='visible'){state.partsCache.clear();render();}},15*60*1000);
})();
