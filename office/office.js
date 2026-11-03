// GPBS Storage - independent office UI. Demo warehouses never write to D1.
(()=>{'use strict';
const $=id=>document.getElementById(id);
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DEMO_MEDUZA_PHOTO='/office/images/antena-meduza-demo.jpg';
const DEMO_MODULES=[
  {id:'MOD-DEMO-001',name:'Moduł sterowania FM',sap_number:null,part_number:'MOD-001',quantity:18},
  {id:'MOD-DEMO-002',name:'Moduł zasilania',sap_number:null,part_number:'MOD-002',quantity:12},
  {id:'MOD-DEMO-003',name:'Moduł komunikacyjny',sap_number:null,part_number:'MOD-003',quantity:24},
  {id:'MOD-DEMO-004',name:'Moduł LED',sap_number:null,part_number:'MOD-004',quantity:7},
  {id:'MOD-DEMO-005',name:'Moduł HICU',sap_number:null,part_number:'MOD-005',quantity:15},
  {id:'MOD-DEMO-006',name:'Moduł czujników',sap_number:null,part_number:'MOD-006',quantity:9}
];
const DEMO_QR_ROWS=[
  '000000000000000000000000000000000',
  '000000000000000000000000000000000',
  '000000000000000000000000000000000',
  '000000000000000000000000000000000',
  '000011111110110010011011111110000',
  '000010000010001111101010000010000',
  '000010111010110000111010111010000',
  '000010111010010010100010111010000',
  '000010111010011011110010111010000',
  '000010000010101010010010000010000',
  '000011111110101010101011111110000',
  '000000000000011010111000000000000',
  '000010100011001001100001001010000',
  '000011001000101001100100001000000',
  '000001000011110100010000101100000',
  '000010101100011101000010000010000',
  '000010010010111111011001100000000',
  '000001001100101010001001101010000',
  '000011001011001011101111010000000',
  '000000101100110110111101100010000',
  '000011000110001001101111111000000',
  '000000000000110001111000100110000',
  '000011111110111100011010111110000',
  '000010000010010001001000100100000',
  '000010111010011111011111111010000',
  '000010111010010010010000000000000',
  '000010111010100011111011111110000',
  '000010000010000110100110000010000',
  '000011111110100001100101100110000',
  '000000000000000000000000000000000',
  '000000000000000000000000000000000',
  '000000000000000000000000000000000',
  '000000000000000000000000000000000'
];
const DEMOS=[{id:'demo1',name:'Testowy 1',team:'Ekipa A',reg:'SK 1234A',date:'28.10.2026'},{id:'demo2',name:'Testowy 2',team:'Ekipa B',reg:'ST 5678B',date:'30.10.2026'},{id:'demo3',name:'Testowy 3',team:'Ekipa C',reg:'DW 9012C',date:'25.10.2026'}];
const state={user:null,warehouses:[],warehouse:'',view:'stocks',stockTab:'parts',labelPart:null,search:'',sortReverse:false,partsCache:new Map(),docs:[],docsTotal:0,docsMatched:0,inventories:[],detailCache:new Map(),expanded:null,positive:false,negative:false,requestId:0,lastSync:null,rememberWarning:''};
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
  $('stockTabs').classList.toggle('hidden',state.view!=='stocks');
  syncStockTabUI();
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
function syncStockTabUI(){
  const modules=state.stockTab==='modules';
  for(const [id,active] of [['partsTab',!modules],['modulesTab',modules]]){
    $(id).classList.toggle('active',active);
    $(id).setAttribute('aria-selected',String(active));
  }
  $('newPart').textContent=modules?'+ Dodaj moduł':'+ Dodaj część';
  $('tableCaption').querySelector('strong').textContent=modules?'Aktualne stany modułów w magazynie':'Aktualne stany części w magazynie';
  $('search').placeholder=modules?'Szukaj modułu po nazwie lub indeksie':'Szukaj po SAP lub nazwie części';
}
function setStockTab(tab){
  if(!['parts','modules'].includes(tab)||state.view!=='stocks'||state.stockTab===tab)return;
  state.stockTab=tab;state.search='';state.expanded=null;
  $('search').value='';
  syncStockTabUI();render();
}
function selectView(view,warehouse){
  state.view=view;state.stockTab='parts';state.search='';state.expanded=null;state.positive=false;state.negative=false;
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
function drawModules(){
  const filtered=sortedFiltered(DEMO_MODULES);
  const rows=filtered.map(p=>{
    const min=previewMinimum(p);
    const reorder=Math.max(0,min-Number(p.quantity));
    return '<tr data-module-row="'+escapeHtml(p.id)+'" tabindex="0" aria-label="Szczegóły modułu: '+escapeHtml(p.name)+'">'+
      '<td>'+escapeHtml(p.sap_number||'—')+'</td><td><button type="button" class="row-link" data-module="'+escapeHtml(p.id)+'">'+escapeHtml(p.name)+'</button></td>'+
      '<td class="num">'+quantity(p.quantity)+'</td><td class="num stock-demo-order">'+quantity(reorder)+'</td>'+
      '<td class="num stock-demo-min">'+escapeHtml(min)+'</td></tr>';
  }).join('');
  $('tableArea').innerHTML=wrapTable([
    {label:'Indeks SAP'},{label:'Nazwa modułu'},{label:'Stan',numeric:true},
    {label:'Zamówić',numeric:true},{label:'Stan min.',numeric:true}
  ],rows);
  $('tableFooter').textContent=filtered.length+' modułów';
  noteSearch(filtered.length,DEMO_MODULES.length,'modułach');
}
function openDemoModule(id){
  const p=DEMO_MODULES.find(x=>x.id===id);
  if(!p)return;
  $('modal').classList.remove('hidden');
  $('modal').querySelector('.modal-card').classList.add('part-detail-card');
  $('modalBody').innerHTML=
    '<div class="kicker">KARTA MODUŁU</div>'+
    '<h2 id="modalTitle">'+escapeHtml(p.name)+'</h2>'+
    '<p class="muted part-sap-line">Indeks SAP: —</p>'+
    '<div class="part-detail-layout">'+
      '<div class="part-photo-section"><div class="part-photo-empty" aria-label="Brak zdjęcia modułu"><span aria-hidden="true">▧</span><small>Zdjęcie modułu</small></div></div>'+
      '<div class="part-detail-data">'+
        '<div class="part-stock-block"><small>AKTUALNY STAN</small><strong>'+quantity(p.quantity)+' <span>szt.</span></strong></div>'+
        '<div class="part-meta-item"><small>Identyfikator magazynowy</small><strong>'+escapeHtml(p.part_number)+'</strong></div>'+
        '<div class="part-meta-item"><small>Ostatnia dostawa</small><strong>—</strong></div>'+
        '<div class="part-meta-item"><small>Ostatnia inwentaryzacja</small><strong>—</strong></div>'+
      '</div>'+
    '</div>';
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
      if(state.stockTab==='modules'){
        if(ticket!==state.requestId)return;
        drawModules();
      }else{
      const parts=isDemo()?await realParts():await loadStocks(state.warehouse);
      if(ticket!==state.requestId)return;drawStocks(parts,state.warehouse);
      }
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
  if(state.view==='stocks'){
    if(state.stockTab==='modules')drawModules();
    else{
      const parts=state.partsCache.get(state.warehouse)||state.partsCache.get(state.warehouses[0]?.id)||[];
      drawStocks(parts,state.warehouse);
    }
  }
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
  const modal=$('modal'),body=$('modalBody');
  modal.classList.remove('hidden');
  modal.querySelector('.modal-card').classList.add('part-detail-card');
  body.innerHTML='<h2 id="modalTitle">Szczegóły części</h2><div class="loading">Wczytywanie...</div>';
  const demo=isDemo();
  try{
    const warehouse=demo?(state.warehouses.find(w=>w.id==='PL-TYCHY')?.id||state.warehouses[0].id):state.warehouse;
    const payload=await api('part',{warehouse,part:id});
    if(modal.classList.contains('hidden'))return;
    const p=payload.part;
    state.labelPart=p;
    const amount=demo?demoQuantity((await realParts()).findIndex(x=>x.id===id),DEMOS.findIndex(x=>x.id===state.warehouse)+1):p.quantity;
    // Temporary illustrative photo, matched by exact part name; no write to D1.
    const hasDemoPhoto=String(p.name||'').trim().toLocaleLowerCase('pl')==='antena meduza';
    const photo=hasDemoPhoto
      ? '<button type="button" class="part-photo-zoom" data-photo-open="1" aria-label="Powiększ zdjęcie części '+escapeHtml(p.name)+'">'+
        '<img src="'+DEMO_MEDUZA_PHOTO+'" alt="'+escapeHtml(p.name)+' — zdjęcie części" loading="lazy">'+
        '<span class="photo-zoom-label" aria-hidden="true">⤢ Powiększ zdjęcie</span></button>'
      : '<div class="part-photo-empty" aria-label="Brak zdjęcia części"><span aria-hidden="true">▧</span><small>Zdjęcie części</small></div>';
    const deliveryQuantity=!demo&&payload.delivery?'Przyjęto '+escapeHtml(payload.delivery.quantity)+' szt.':'Brak danych';
    body.innerHTML=
      '<div class="kicker">KARTA CZĘŚCI</div>'+
      '<h2 id="modalTitle">'+escapeHtml(p.name)+'</h2>'+
      '<p class="muted part-sap-line">Indeks SAP: '+escapeHtml(p.sap_number||'—')+'</p>'+
      '<div class="part-detail-layout">'+
        '<div class="part-photo-section">'+photo+'</div>'+
        '<div class="part-detail-data">'+
          '<div class="part-stock-block"><small>AKTUALNY STAN</small><strong>'+quantity(amount)+' <span>szt.</span></strong></div>'+
          '<div class="part-meta-item"><small>Identyfikator magazynowy</small><strong>'+escapeHtml(p.part_number||'—')+'</strong></div>'+
          '<div class="part-meta-item"><small>Ostatnia dostawa</small><strong>'+(demo?'—':dateText(payload.delivery?.date))+'</strong><p>'+deliveryQuantity+'</p></div>'+
          '<div class="part-meta-item"><small>Ostatnia inwentaryzacja</small><strong>'+(demo?'—':dateText(payload.inventory?.date))+'</strong></div>'+
        '</div>'+
      '</div>'+
      '<div class="modal-actions">'+
        (hasDemoPhoto&&p.part_number==='MG-FR-0013'
          ? '<button type="button" class="btn dark" data-label-open="1">Wydruk etykiety</button>'
          : '<button type="button" class="btn outline" disabled>Wydruk etykiety · w przygotowaniu</button>')+
      '</div>';
  }catch(ex){
    body.innerHTML='<h2 id="modalTitle">Szczegóły części</h2><p class="error">'+escapeHtml(ex.message)+'</p>';
  }
}
function demoQrSvg(){
  const rects=[];
  for(let y=0;y<DEMO_QR_ROWS.length;y++)
    for(let x=0;x<DEMO_QR_ROWS[y].length;x++)
      if(DEMO_QR_ROWS[y][x]==='1')rects.push('M'+x+' '+y+'h1v1h-1z');
  return '<svg class="label-qr" viewBox="0 0 33 33" xmlns="http://www.w3.org/2000/svg" aria-label="Kod QR MG-FR-0013">'+
    '<rect width="33" height="33" fill="#fff"/><path fill="#000" d="'+rects.join('')+'"/></svg>';
}
function openLabelPreview(){
  const p=state.labelPart;
  if(!p||p.part_number!=='MG-FR-0013'||String(p.name||'').trim().toLocaleLowerCase('pl')!=='antena meduza')return;
  $('labelPrintArea').innerHTML='<div class="printable-label">'+
    '<div class="label-qr-zone">'+demoQrSvg()+'</div>'+
    '<div class="label-text-zone">'+
      '<strong class="label-part-name">'+escapeHtml(p.name)+'</strong>'+
      '<div class="label-data"><small>INDEKS SAP</small><span>'+escapeHtml(p.sap_number||'—')+'</span></div>'+
      '<div class="label-data"><small>ID MAGAZYNOWE</small><span>'+escapeHtml(p.part_number)+'</span></div>'+
    '</div>'+
    '<div class="label-photo-zone"><img src="'+DEMO_MEDUZA_PHOTO+'" alt="Antena meduza"></div>'+
  '</div>';
  $('labelModal').classList.remove('hidden');
  $('labelPrintButton').focus();
}
function closeLabelPreview(){
  $('labelModal').classList.add('hidden');
  $('labelPrintArea').innerHTML='';
  $('modalBody').querySelector('[data-label-open]')?.focus();
}
function openPhotoViewer(){
  const viewer=$('photoViewer');
  $('photoViewerImage').src=DEMO_MEDUZA_PHOTO;
  viewer.classList.remove('hidden');
  $('photoViewerClose').focus();
}
function closePhotoViewer(){
  $('photoViewer').classList.add('hidden');
  $('photoViewerImage').removeAttribute('src');
  $('modalBody').querySelector('[data-photo-open]')?.focus();
}
function closeModal(){
  if(!$('labelModal').classList.contains('hidden'))closeLabelPreview();
  if(!$('photoViewer').classList.contains('hidden'))closePhotoViewer();
  $('modal').classList.add('hidden');
  $('modal').querySelector('.modal-card').classList.remove('part-detail-card');
  $('modalBody').innerHTML='';
}
document.addEventListener('click',e=>{
  const tab=e.target.closest('[data-stock-tab]');if(tab){setStockTab(tab.dataset.stockTab);return;}
  if(e.target.closest('[data-label-close]')){closeLabelPreview();return;}
  if(e.target.closest('[data-label-open]')){openLabelPreview();return;}
  const moduleButton=e.target.closest('[data-module]');if(moduleButton){openDemoModule(moduleButton.dataset.module);return;}
  const moduleRow=e.target.closest('[data-module-row]');if(moduleRow){openDemoModule(moduleRow.dataset.moduleRow);return;}
  if(e.target.closest('[data-photo-close]')){closePhotoViewer();return;}
  if(e.target.closest('[data-photo-open]')){openPhotoViewer();return;}
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
$('labelPrintButton').addEventListener('click',()=>window.print());
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    if(!$('labelModal').classList.contains('hidden'))closeLabelPreview();
    else if(!$('photoViewer').classList.contains('hidden'))closePhotoViewer();
    else closeModal();
    return;
  }
  const row=e.target.closest('tr[data-part-row],tr[data-module-row]');
  if(row&&e.target===row&&(e.key==='Enter'||e.key===' ')){
    e.preventDefault();
    if(row.dataset.moduleRow)openDemoModule(row.dataset.moduleRow);
    else openPart(row.dataset.partRow);
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
