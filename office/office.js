// GPBS Storage - independent office UI. Demo warehouses never write to D1.
(()=>{'use strict';
const $=id=>document.getElementById(id);
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Self-contained presentation-only module registry; no connection to D1.
const MODULE_GROUPS=[
  {id:'outdoor',name:'OUTDOOR',types:['FM','LQ','RQ','XS','ODL','ODR']},
  {id:'indoor',name:'INDOOR',types:['CU','DUO','HICU','HIDUO','CU RJ','HICU RJ','HIDUO RJ']},
  {id:'bq',name:'BQ',types:['CU','DUO','CU OUT','DUO OUT']},
  {id:'newgen',name:'NEW GEN',types:['CU IN','DUO L','DUO R']}
];
const MODULE_CATEGORIES=[{id:'all',name:'SUMA'},...MODULE_GROUPS.map(g=>({id:g.id,name:g.name}))];
// Office presentation only. These locations are NOT created in D1 and no fake stock is loaded.
const FR_LAYOUT_WAREHOUSES=[
  {key:'belleville',name:'Belleville'},
  {key:'toulouse',name:'Tuluza BOX',matchName:'Tuluza'},
  {key:'paris',name:'Paryż BOX',matchName:'Paryż'},
  {key:'bovis-paris',name:'Bovis Paryż'},
  {key:'bovis-lille',name:'Bovis Lille'},
  {key:'bovis-nantes',name:'Bovis Nantes'},
  {key:'bovis-nancy',name:'Bovis Nancy'},
  {key:'bovis-marseille',name:'Bovis Marsylia'},
  {key:'bovis-toulouse',name:'Bovis Tuluza'}
];
const FR_LAYOUT_MODULES=[
  {key:'machines',name:'Maszyny OK / NOK',icon:'▤'},
  {key:'scanning',name:'Skanowanie S/N',icon:'⌗'},
  {key:'service',name:'Serwisy',icon:'⚙'},
  {key:'deliveries',name:'Dostawy',icon:'↓'},
  {key:'crews',name:'Zaopatrzenie ekip',icon:'▦'}
];
const OFFICE_OPERATION_PREVIEWS={
  pz:'Przyjęcia',wz:'Wydania',nok:'Części niekompletne',
  inventories:'Inwentaryzacje',vehicles:'Stany samochodowe',
  labels:'Drukowanie etykiet',aggregate:'Zestawienie zbiorcze'
};
const OFFICE_MARKET_OPERATIONS=[
  {view:'pz',label:'Przyjęcia',icon:'↓'},
  {view:'wz',label:'Wydania',icon:'↑'},
  {view:'nok',label:'Części niekompletne',icon:'!'},
  {view:'inventories',label:'Inwentaryzacje',icon:'☷'},
  {view:'vehicles',label:'Stany samochodowe',icon:'▤'},
  {view:'labels',label:'Drukowanie etykiet',icon:'▦'}
];
const normalizeWarehouseName=value=>String(value||'').normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pl')
  .replace(/ł/g,'l').replace(/[^a-z0-9]/g,'');

const state={user:null,warehouses:[],warehouse:'',preview:null,aggregateMarket:'FR',warehouseMenus:{PL:true,FR:false},view:'stocks',stockTab:'parts',moduleCategory:'all',labelPart:null,search:'',sortReverse:false,partsCache:new Map(),docs:[],docsTotal:0,docsMatched:0,nokParts:[],inventories:[],detailCache:new Map(),expanded:null,focusDocument:null,positive:false,negative:false,requestId:0,lastSync:null,rememberWarning:''};
function realWarehouse(id){return state.warehouses.find(w=>w.id===id);}
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
// Office adds parts to the same central PL catalogue as the mobile warehouse.
// New-part photos go directly to private R2 with server-side type and quota checks.
let newPartBusy=false;
let newPartPreviewUrl=null;
function newPartError(text=''){
  $('officeNewPartError').textContent=text;
  $('officeNewPartError').hidden=!text;
}
function clearNewPartPreview(){
  if(newPartPreviewUrl)URL.revokeObjectURL(newPartPreviewUrl);
  newPartPreviewUrl=null;
  $('officeNewPartPreview').removeAttribute('src');
  $('officeNewPartPreview').hidden=true;
}
function openOfficeNewPart(){
  if(state.view!=='stocks'||state.stockTab!=='parts'||
     !realWarehouse(state.warehouse)||newPartBusy)return;
  $('officeNewPartForm').reset();
  newPartError('');
  clearNewPartPreview();
  $('officeNewPartWarehouse').textContent='Magazyn: '+realWarehouse(state.warehouse).name;
  $('officeNewPartDialog').showModal();
  $('officeNewPartName').focus();
}
function closeOfficeNewPart(){
  if(newPartBusy)return;
  $('officeNewPartDialog').close();
}
// A browser file picker is only a hint: inspect actual bytes before any upload.
// Camera images and files from disk follow the same rules.
async function validatePartPhotoFile(file){
  if(!file)return;
  if(file.size<16||file.size>20*1024*1024)
    throw Error('Zdjęcie musi mieć od 16 B do 20 MB.');
  const filename=String(file.name||'');
const ext=filename.includes('.')?filename.split('.').pop().toLowerCase():'';
  const extensions={jpg:'jpeg',jpeg:'jpeg',jpe:'jpeg',png:'png',bmp:'bmp',
    webp:'webp',heic:'heic',heif:'heic',avif:'avif'};
  const mimeTypes={'image/jpeg':'jpeg','image/pjpeg':'jpeg','image/png':'png',
    'image/bmp':'bmp','image/x-ms-bmp':'bmp','image/webp':'webp',
    'image/heic':'heic','image/heif':'heic','image/avif':'avif'};
  const expected=extensions[ext]||'';
  const declared=mimeTypes[String(file.type||'').toLowerCase()]||'';
  if(!expected&&ext)throw Error('Dozwolone są tylko zdjęcia: JPG, PNG, BMP, WEBP, HEIC lub AVIF.');
  if(file.type&&!declared)throw Error('To nie jest obsługiwany format zdjęcia. Wybierz JPG, PNG, BMP lub WEBP.');
  const bytes=new Uint8Array(await file.slice(0,40).arrayBuffer());
  const is=(offset,arr)=>arr.every((v,i)=>bytes[offset+i]===v);
  const word=(start,end)=>String.fromCharCode(...bytes.slice(start,end));
  let actual='';
  if(is(0,[255,216,255]))actual='jpeg';
  else if(is(0,[137,80,78,71,13,10,26,10]))actual='png';
  else if(word(0,4)==='RIFF'&&word(8,12)==='WEBP')actual='webp';
  else if(word(0,2)==='BM')actual='bmp';
  else if(word(4,8)==='ftyp'){
    const brand=word(8,12);
    if(['heic','heix','hevc','hevx','heif','heis','hevm','mif1'].includes(brand))
      actual='heic';
    else if(['avif','avis'].includes(brand))actual='avif';
  }
  if(!actual||expected&&expected!==actual||declared&&declared!==actual)
    throw Error('Plik nie jest poprawnym zdjęciem. Filmy, ZIP i inne dokumenty są zablokowane.');
}

async function saveOfficeNewPart(event){
  event.preventDefault();
  if(newPartBusy||state.view!=='stocks'||state.stockTab!=='parts'||
     !realWarehouse(state.warehouse))return;
  const warehouseId=state.warehouse;
  const name=$('officeNewPartName').value.trim().replace(/\s+/g,' ');
  const sap=$('officeNewPartSap').value.trim().toUpperCase();
  if(name.length<2){newPartError('Wpisz nazwę części.');return;}
  newPartBusy=true;
  $('officeNewPartSave').disabled=true;
  $('officeNewPartCancel').disabled=true;
  newPartError('');
  try{
    const file=$('officeNewPartPhoto').files?.[0]||null;
    if(file)await validatePartPhotoFile(file);
    if(state.warehouse!==warehouseId)
      throw Error('Wybrano inny magazyn. Otwórz formularz ponownie.');
    const form=new FormData();
    form.set('warehouseId',warehouseId);
    form.set('name',name);
    form.set('sap',sap);
    if(file)form.set('photo',file,file.name);
    const response=await fetch('/api/pl/new-part',{
      method:'POST',
      credentials:'same-origin',
      cache:'no-store',
      body:form
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok||!result.ok)throw Error(result.error||'Nie udało się zapisać nowej części.');
    $('officeNewPartDialog').close();
    state.partsCache.clear();
    state.detailCache.clear();
    await render();
    $('officeNewPartNotice').textContent='Dodano „'+name+'” do katalogu. Część oczekuje na weryfikację.';
    $('officeNewPartNotice').classList.remove('hidden');
  }catch(ex){
    newPartError(ex.message||'Nie udało się dodać części.');
  }finally{
    newPartBusy=false;
    $('officeNewPartSave').disabled=false;
    $('officeNewPartCancel').disabled=false;
  }
}
function errorBanner(message){$('errorBanner').textContent=message||'';$('errorBanner').classList.toggle('hidden',!message);}
function showLogin(message=''){
  $('app').classList.add('hidden');$('loginScreen').classList.remove('hidden');
  $('loginError').textContent=message;$('loginError').classList.toggle('hidden',!message);
  $('pin').value='';if(!message)$('pin').focus();
}
function greetingName(user){
  // Private profile given name takes precedence over the account's short code.
  // With no given name keep the public symbol or label (e.g. JJ, MT, Ekipa A).
  const first=String(user?.firstName||'').trim().replace(/\s+/g,' ');
  if(first)return first.split(' ')[0];
  const raw=String(user?.nickname||'').trim().replace(/\s+/g,' ');
  if(!raw)return '';
  if(/^(ekipa|zespół|team|grupa)\s+/i.test(raw))return raw;
  return raw.split(' ')[0];
}
function setLoggedIn(payload){
  if(!payload?.user||!Array.isArray(payload.warehouses))throw Error('Nieprawidłowe dane konta.');
  state.user=payload.user;state.warehouses=payload.warehouses;state.preview=null;
  if(!state.warehouses.some(w=>w.id===state.warehouse))state.warehouse=state.warehouses.find(w=>w.id==='PL-TYCHY')?.id||state.warehouses[0]?.id||'';
  const name=greetingName(state.user);
  $('username').textContent=name?name+'!':'!';
  $('userRole').textContent=({ADMIN:'Administrator',KIEROWNIK:'Kierownik',KOORDYNATOR:'Koordynator',MAGAZYNIER:'Magazynier'})[state.user.role]||state.user.role;
  $('loginScreen').classList.add('hidden');$('app').classList.remove('hidden');
  renderMenu();selectView('stocks',state.warehouse);
}
function renderMenu(){
  // Real warehouses obey D1 grants. Other FR entries are layout-only placeholders
  // visible to Admin, not permission grants and NEVER queried through the API.
  const pl=state.warehouses.filter(w=>w.country_code==='PL');
  const fr=state.warehouses.filter(w=>w.country_code==='FR');
  const canPreviewFrance=state.user?.role==='ADMIN'&&
    String(state.user?.nickname||'').trim().toUpperCase()==='JJ';
  const renderReal=w=>'<button type="button" class="subnav-btn" data-warehouse="'+escapeHtml(w.id)+'">'+
    escapeHtml(w.name)+'</button>';
  const aggregateButton=()=>'<button type="button" class="subnav-btn office-aggregate-link" '+
    'data-aggregate-market="FR"><span class="office-aggregate-symbol" aria-hidden="true">▦</span>'+
    'Zestawienie zbiorcze</button>';
  const marketOperations=country=>'<div class="office-market-operations">'+
    '<div class="office-market-operations-label">OPERACJE</div>'+
    OFFICE_MARKET_OPERATIONS.filter(op=>{
      const key={pz:'pz',wz:'wz',nok:'stocks',inventories:'inventory',
        vehicles:'stocks',labels:'labels'}[op.view];
      return state.user?.features?.[key]!==false;
    }).map(op=>
      '<button type="button" class="subnav-btn office-operation-link" '+
      'data-market-view="'+country+'" data-view="'+escapeHtml(op.view)+'">'+
      '<span class="office-operation-icon" aria-hidden="true">'+escapeHtml(op.icon)+'</span>'+
      escapeHtml(op.label)+'</button>'
    ).join('')+'</div>';
  const frenchModules=()=>'<div class="office-market-modules">'+
    '<div class="office-market-operations-label">MODUŁY FR</div>'+
    FR_LAYOUT_MODULES.map(item=>
      '<button type="button" class="subnav-btn office-operation-link" '+
      'data-fr-module="'+escapeHtml(item.key)+'">'+
      '<span class="office-operation-icon" aria-hidden="true">'+escapeHtml(item.icon)+'</span>'+
      escapeHtml(item.name)+'</button>'
    ).join('')+'</div>';
  const group=(country,items,showAggregate=false,showOperations=true)=>{
    const expanded=Boolean(state.warehouseMenus[country]);
    return '<div class="office-market-group">'+
      '<button type="button" class="office-market-toggle" data-market-toggle="'+country+'" '+
      'aria-expanded="'+String(expanded)+'" aria-controls="officeMarket'+country+'">'+
      '<span class="office-market-flag office-market-flag-'+country.toLowerCase()+'" aria-hidden="true"></span>'+
      '<span class="office-market-name">'+(country==='PL'?'POLSKA':'FRANCJA')+'</span>'+
      '<svg class="office-market-chevron" width="18" height="18" viewBox="0 0 24 24" '+
      'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '+
      'stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>'+
      '<div id="officeMarket'+country+'" class="office-market-list'+(expanded?'':' hidden')+'">'+
      items+(showAggregate?aggregateButton():'')+
      (showOperations?marketOperations(country):'')+
      (country==='FR'?frenchModules():'')+'</div></div>';
  };
  // Do not reveal the Poland section to FR-only users. The server already
  // filtered state.warehouses by live per-user market settings.
  const plSection=pl.length?group('PL',pl.map(renderReal).join(''),false,true):'';

  let frItems=[];
  if(canPreviewFrance){
    const used=new Set();
    for(const location of FR_LAYOUT_WAREHOUSES){
      const real=fr.find(w=>[location.name,location.matchName].some(name=>name&&normalizeWarehouseName(w.name)===normalizeWarehouseName(name)));
      if(real){
        used.add(real.id);
        frItems.push('<button type="button" class="subnav-btn" data-warehouse="'+escapeHtml(real.id)+'">'+escapeHtml(location.name)+'</button>');
      }else{
        frItems.push('<button type="button" class="subnav-btn office-preview-link" '+
          'data-preview-warehouse="'+escapeHtml(location.key)+'" title="Układ — bez danych">'+
          escapeHtml(location.name)+'</button>');
      }
    }
    frItems.push(...fr.filter(w=>!used.has(w.id)).map(renderReal));
  }else{
    frItems=fr.map(renderReal);
  }
  const hasFrance=canPreviewFrance||frItems.length>0;
  $('warehouseMenu').innerHTML=plSection+
    (hasFrance?group('FR',frItems.join(''),true):'');
  for(const el of document.querySelectorAll('#sidebar [data-warehouse],#sidebar [data-preview-warehouse],#sidebar [data-fr-module],#sidebar [data-view],#sidebar [data-aggregate-market]')){
    const isReal=state.view==='stocks'&&!state.preview&&el.dataset.warehouse===state.warehouse;
    const isPreview=Boolean(state.preview)&&(
      el.dataset.previewWarehouse===state.preview?.key&&state.preview?.type==='warehouse'||
      el.dataset.frModule===state.preview?.key&&state.preview?.type==='module');
    const isAggregate=state.view==='aggregate'&&el.dataset.aggregateMarket==='FR';
    const isMarketView=el.dataset.marketView==='PL'
      ?state.view===el.dataset.view&&state.view!=='preview'&&
        realWarehouse(state.warehouse)?.country_code==='PL'
      :el.dataset.marketView==='FR'
        ?state.view==='preview'&&state.preview?.type==='operation'&&
          state.preview?.key===el.dataset.view
        :false;
    const isView=!el.dataset.marketView&&state.view!=='preview'&&el.dataset.view===state.view;
    el.classList.toggle('active',Boolean(isReal||isPreview||isAggregate||isMarketView||isView));
  }
}
function showOfficePreview(type,key,label){
  if(type==='warehouse'){
    // Unconnected French warehouses use exactly the same stock layout as Tychy.
    // No D1 request or invented stock quantities are made for a layout-only entry.
    ++state.requestId;
    state.view='stocks';state.preview={type,key,label};
    state.stockTab='parts';state.moduleCategory='all';state.search='';state.focusDocument=null;
    $('sidebar').classList.remove('open');
    $('officePreview').classList.add('hidden');
    $('pageActions').classList.remove('hidden');
    setHead('Stany magazynowe','', '');
    $('warehouseCrumb').textContent=label.replace(/^magazyn\s+/i,'').toLocaleUpperCase('pl');
    $('newPart').classList.add('hidden');
    $('refresh').classList.add('hidden');
    $('syncTime').textContent='';
    renderMenu();
    render();
    return;
  }
  $('refresh').classList.remove('hidden');
  // Abort stale data paints if an earlier real warehouse request was in flight.
  ++state.requestId;
  state.view='preview';
  state.preview={type,key,label};
  state.stockTab='parts';state.search='';state.focusDocument=null;
  $('sidebar').classList.remove('open');
  renderMenu();
  setHead(label,'GPBS STORAGE / FRANCJA','Układ przygotowany do podłączenia danych.');
  $('pageKicker').textContent='FRANCJA / UKŁAD OFFICE';
  $('officePreviewTitle').textContent=label;
  $('officePreviewDescription').textContent=type==='warehouse'
    ?'Przyszły podgląd stanów i operacji magazynu '+label+'.'
    :'Miejsce na funkcję „'+label+'” w systemie francuskim.';
  $('officePreview').classList.remove('hidden');
  $('officeTableCard').classList.add('hidden');
  $('pageActions').classList.add('hidden');
  $('warehouseCrumb').classList.add('hidden');
  errorBanner('');
}
function setHead(title,kicker,desc){
  $('pageTitle').textContent=title;$('pageKicker').textContent=kicker;$('pageDesc').textContent=desc;
  $('crumb').textContent=title;
  $('newPart').classList.toggle('hidden',state.view!=='stocks'||Boolean(state.preview)||realWarehouse(state.warehouse)?.country_code==='FR');
  $('stockTabs').classList.toggle('hidden',state.view!=='stocks');
  $('officeLabelsView').classList.toggle('hidden',state.view!=='labels');
  $('officeTableCard').classList.toggle('hidden',state.view==='labels');
  syncStockTabUI();
  $('sort').classList.toggle('hidden',!['stocks','aggregate','vehicles'].includes(state.view));
  $('search').placeholder=state.view==='stocks'||state.view==='aggregate'||state.view==='vehicles'||state.view==='nok'?'Szukaj po SAP lub nazwie części':state.view==='inventories'?'Szukaj inwentaryzacji...':'Szukaj: SAP, nazwa, dostawca, pracownik...';
  $('search').value=state.search;$('sort').textContent=state.sortReverse?'Nazwa Z–A':'Nazwa A–Z';
  const name=realWarehouse(state.warehouse)?.name||'Magazyn';
  const stockView=state.view==='stocks';
  const documentsView=state.view==='pz'||state.view==='wz';
  const vehicleView=state.view==='vehicles';
  const aggregateView=state.view==='aggregate';
  const compactView=documentsView||vehicleView||aggregateView||state.view==='nok';
  $('app').classList.toggle('view-stocks',stockView);
  $('app').classList.toggle('view-receipts',compactView);
  $('app').classList.toggle('view-vehicles',vehicleView);
  $('app').classList.toggle('view-aggregate',aggregateView);
  $('app').classList.toggle('view-labels',state.view==='labels');
  $('receiptToolbarInfo').classList.toggle('hidden',!compactView);
  $('receiptToolbarActions').classList.toggle('hidden',!compactView);
  $('vehicleTopScroll').classList.toggle('hidden',!vehicleView);
  if(compactView){
    $('receiptToolbarInfo').querySelector('strong').textContent=aggregateView?'Zestawienie zbiorcze':vehicleView?'Stany samochodowe':state.view==='nok'?'Części niekompletne':state.view==='pz'?'Przyjęcia':'Wydania';
    $('receiptToolbarInfo').querySelector('span').textContent=aggregateView
      ?'Porównanie stanów części pomiędzy magazynami.'
      :vehicleView?'Ewidencja części na samochodach serwisowych.'
      :state.view==='nok'?'Oddzielna ewidencja NOK — nie powiększa stanu pełnowartościowego.'
      :state.view==='pz'?'Historia przyjęć i dostaw magazynowych.':'Historia wydań magazynowych.';
  }
  // Reuse the existing synchronization control in the compact toolbar.
  if(compactView){
    $('receiptToolbarActions').append($('syncTime'),$('refresh'));
  }else if(state.view==='labels'){
    $('labelToolbarActions').append($('syncTime'),$('refresh'));
  }else{
    $('pageActions').insertBefore($('syncTime'),$('newPart'));
    $('pageActions').insertBefore($('refresh'),$('newPart'));
  }
  $('warehouseCrumb').classList.toggle('hidden',!stockView);
  $('warehouseCrumb').textContent=name.replace(/^magazyn\s+/i,'').toLocaleUpperCase('pl');
  $('tableCaption').classList.toggle('hidden',!stockView);
  if(stockView){$('pageKicker').textContent=name.toUpperCase();$('pageDesc').textContent='Aktualne stany części w magazynie.';}
  $('refresh').classList.toggle('hidden',Boolean(state.preview?.type==='warehouse'));
  if(state.preview?.type==='warehouse')$('newPart').classList.add('hidden');
}
function syncStockTabUI(){
  const modules=state.view==='stocks'&&state.stockTab==='modules';
  $('app').classList.toggle('view-modules',modules);
  $('moduleCategories').classList.toggle('hidden',!modules);
  for(const [id,active] of [['partsTab',!modules],['modulesTab',modules]]){
    $(id).classList.toggle('active',active);
    $(id).setAttribute('aria-selected',String(active));
  }
  $('newPart').textContent=modules?'+ Dodaj moduł':'+ Dodaj część';
  const canAdd=state.view==='stocks'&&!modules&&!!realWarehouse(state.warehouse);
  $('newPart').disabled=!canAdd;
  $('newPart').title=canAdd?'Dodaj nową część do centralnego katalogu':
    modules?'Dodawanie modułów nie jest jeszcze dostępne':'Brak aktywnego magazynu';
  $('tableCaption').querySelector('strong').textContent=modules?'Stany magazynowe modułów':'Aktualne stany części w magazynie';
  $('search').placeholder=modules?'Wyszukaj po numerze seryjnym':'Szukaj po SAP lub nazwie części';
  $('sort').textContent=state.sortReverse?'Nazwa Z–A':'Nazwa A–Z';
  document.querySelectorAll('[data-module-category]').forEach(btn=>{
    const selected=btn.dataset.moduleCategory===state.moduleCategory;
    btn.classList.toggle('active',selected);
    btn.setAttribute('aria-pressed',String(selected));
  });
}
function setStockTab(tab){
  if(!['parts','modules'].includes(tab)||state.view!=='stocks'||state.stockTab===tab)return;
  state.stockTab=tab;state.moduleCategory='all';state.search='';state.expanded=null;
  $('search').value='';
  syncStockTabUI();render();
}
function setModuleCategory(category){
  if(state.view!=='stocks'||state.stockTab!=='modules')return;
  if(!MODULE_CATEGORIES.some(c=>c.id===category)||state.moduleCategory===category)return;
  state.moduleCategory=category;
  state.search='';
  $('search').value='';
  syncStockTabUI();
  drawModules();
}
function selectView(view,warehouse,focusDocument=null){
  const targetWarehouse=warehouse||state.warehouse;
  const french=warehouse?realWarehouse(warehouse)?.country_code==='FR':
    Boolean(state.preview)||realWarehouse(targetWarehouse)?.country_code==='FR';
  if(french&&view!=='stocks'&&view!=='aggregate'){
    return showOfficePreview('operation',view,OFFICE_OPERATION_PREVIEWS[view]||view);
  }
  if(warehouse||view==='aggregate'||state.preview?.type==='warehouse')state.preview=null;
  $('officePreview').classList.add('hidden');
  $('pageActions').classList.remove('hidden');
  state.view=view;state.stockTab='parts';state.moduleCategory='all';state.search='';state.expanded=focusDocument;state.focusDocument=focusDocument;state.positive=false;state.negative=false;
  if(warehouse)state.warehouse=warehouse;
  $('sidebar').classList.remove('open');renderMenu();
  const titles={stocks:'Stany magazynowe',aggregate:'Zestawienie zbiorcze',pz:'Przyjęcia',wz:'Wydania',nok:'Części niekompletne',inventories:'Inwentaryzacje',vehicles:'Stany samochodowe',labels:'Drukowanie etykiet'};
  const descriptions={nok:'Oddzielne stany części niekompletnych (NOK).',aggregate:'Porównanie stanów części pomiędzy magazynami.',pz:'Historia przyjęć i dostaw magazynowych.',wz:'Historia wydań magazynowych.',inventories:'Historia inwentaryzacji i bilanse.',vehicles:'Ewidencja części na samochodach serwisowych.',labels:'Wybierz części i wydrukuj dwie etykiety na kartce A4.'};
  const market=view==='aggregate'?'FR':realWarehouse(state.warehouse)?.country_code;
  const marketName=market==='FR'?'FRANCJA':'POLSKA';
  const title=view==='aggregate'?'Zestawienie zbiorcze — '+(market==='FR'?'FR':'PL'):(titles[view]||'Stany magazynowe');
  setHead(title,'GPBS STORAGE / '+marketName,descriptions[view]||'');
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
function sortedFiltered(rows){
  const q=state.search.toLocaleLowerCase('pl').trim();
  const result=rows.filter(p=>!q||[p.sap_number,p.name].some(s=>String(s||'').toLocaleLowerCase('pl').includes(q)));
  return result.sort((a,b)=>(state.sortReverse?-1:1)*String(a.name||'').localeCompare(String(b.name||''),'pl',{sensitivity:'base'}));
}
function quantity(value){return value===null||value===undefined?'<span class="stock-unknown">—</span>':Number(value)===0?'<span class="stock-zero">0</span>':escapeHtml(value);}
function wrapTable(headers,rows,extraClass=''){
  const cols=headers.map(h=>'<th'+(h.numeric?' class="num"':'')+'>'+escapeHtml(h.label)+'</th>').join('');
  return '<table class="table'+(extraClass?' '+escapeHtml(extraClass):'')+'"><thead><tr>'+cols+'</tr></thead><tbody>'+rows+'</tbody></table>';
}
function noteSearch(count,total,noun){
  $('searchNote').classList.toggle('hidden',!state.search.trim());
  $('searchNote').textContent=state.search.trim()?'Znaleziono w '+count+' '+noun+' z '+total+'.':'';
}
function drawStocks(parts,warehouseId){
  const filtered=sortedFiltered(parts);
  const rows=filtered.map(p=>{
    const amount=p.quantity;
    return '<tr data-part-row="'+escapeHtml(p.id)+'" tabindex="0" aria-label="Szczegóły części: '+escapeHtml(p.name)+'">'+
      '<td>'+escapeHtml(p.sap_number||'—')+'</td><td><button class="row-link" data-part="'+escapeHtml(p.id)+'">'+escapeHtml(p.name)+'</button></td>'+
      '<td class="num">'+quantity(amount)+'</td>'+
      '<td class="num stock-demo-order">—</td>'+
      '<td class="num stock-demo-min">—</td></tr>';
  }).join('');
  $('tableArea').innerHTML=wrapTable([
    {label:'Indeks SAP'},{label:'Nazwa części'},{label:'Stan',numeric:true},
    {label:'Zamówić',numeric:true},{label:'Stan min.',numeric:true}
  ],rows,'part-stock-table')||'';
  $('tableFooter').textContent=filtered.length+' części';
  noteSearch(filtered.length,parts.length,'częściach');
}
function drawModules(){
  $('tableArea').innerHTML='<div class="empty">Brak danych modułów. Ewidencja modułów nie jest jeszcze podłączona do D1.</div>';
  $('tableFooter').textContent='0 modułów w ewidencji';
  noteSearch(0,0,'modułach');
}
function drawAggregate(realSets){
  // Stock rows are D1 reads for *authorized* warehouses only.
  // Union across all stores, rather than depending on first warehouse's catalog.
  const positions=new Map();
  const quantities=realSets.map(store=>{
    const map=new Map();
    for(const part of store.parts||[]){
      if(part?.id&&!positions.has(part.id))positions.set(part.id,part);
      if(part?.id)map.set(part.id,part.quantity);
    }
    return map;
  });
  const filtered=sortedFiltered([...positions.values()]);
  const headers=[
    {label:'Indeks SAP'},{label:'Nazwa części'},
    ...realSets.map(store=>({label:store.name,numeric:true})),
    {label:'SUMA',numeric:true}
  ];
  const rows=filtered.map(part=>{
    let total=0,complete=true;
    const values=quantities.map(stock=>{
      const value=stock.get(part.id);
      if(value===null||value===undefined||!Number.isFinite(Number(value))){
        complete=false;
      }else{
        total+=Number(value);
      }
      return '<td class="num">'+quantity(value)+'</td>';
    }).join('');
    const displayed=complete?escapeHtml(total):'<span title="Brak stanu w co najmniej jednym magazynie">—</span>';
    return '<tr><td>'+escapeHtml(part.sap_number||'—')+'</td>'+
      '<td>'+escapeHtml(part.name)+'</td>'+values+
      '<td class="num aggregate-total">'+displayed+'</td></tr>';
  }).join('');
  const tableRows=rows||'<tr><td colspan="'+headers.length+'" class="office-aggregate-empty">'+
    'Nie ma jeszcze aktualnych danych części dla tych magazynów.</td></tr>';
  $('tableArea').innerHTML=wrapTable(headers,tableRows,'aggregate-table');
  $('tableFooter').textContent=filtered.length+' pozycji · '+realSets.length+
    (realSets.length===1?' magazyn':realSets.length>=2&&realSets.length<=4?' magazyny':' magazynów')+
    ' · źródła D1: '+realSets.filter(store=>!store.preview).length+
    ' · „—” oznacza brak ustalonego stanu, nie zero';
  noteSearch(filtered.length,positions.size,'częściach');
}
// PZ/WZ: show the team or supplier first and the registration below it.
 // Older sessions kept both in the single counterparty field ("HH | REJ: SK 12345");
 // newer sessions can have the registration in a separate D1 column.
function partyParts(value,registrationPlate=''){
  const raw=String(value??'').trim();
  const match=raw.match(/^([\s\S]*?)\s*(?:\|\s*|\r?\n\s*)REJ\s*:\s*([\s\S]+)$/i);
  return {
    name:(match?match[1]:raw).trim(),
    plate:String(registrationPlate||match?.[2]||'').trim()
  };
}
function partyHtml(value,registrationPlate=''){
  const {name,plate}=partyParts(value,registrationPlate);
  return '<span class="doc-party-lines"><span class="doc-party-name">'+
    escapeHtml(name||'—')+'</span>'+
    (plate?'<span class="doc-party-plate">'+escapeHtml(plate)+'</span>':'')+
    '</span>';
}
function cellButton(label,id,expanded){
  return '<button type="button" class="detail-btn" data-expand="'+escapeHtml(id)+'">'+
    (expanded?'Ukryj':'Pokaż '+label)+' <span aria-hidden="true">'+(expanded?'⌃':'⌄')+'</span></button>';
}
function drawNokStock(){
  const data=sortedFiltered(state.nokParts||[]);
  const rows=data.map(p=>'<tr>'+
    '<td>'+escapeHtml(p.sap_number||'—')+'</td>'+
    '<td><span class="office-nok-name">'+escapeHtml(p.name)+' <strong>NOK</strong></span></td>'+
    '<td>'+escapeHtml(p.part_number||'—')+'</td>'+
    '<td class="num">'+quantity(p.quantity)+'</td></tr>').join('');
  $('tableArea').innerHTML=wrapTable([
    {label:'Indeks SAP'},{label:'Nazwa części'},{label:'Indeks magazynowy'},
    {label:'Stan NOK',numeric:true}
  ],rows)||'<div class="empty">Brak części niekompletnych w tym magazynie.</div>';
  $('tableFooter').textContent=data.length+' pozycji NOK';
  noteSearch(data.length,(state.nokParts||[]).length,'częściach');
}

function drawDocs(){
  const direction=state.view==='pz'?'PZ':'WZ';
  const opposite=direction==='PZ'?'WZ':'PZ';
  const docs=state.docs;
  const rows=docs.map(d=>{
    const over=Number(d.shortage||0)>0;
    const expanded=state.expanded===d.id;
    const related=Number(d.has_related||0)>0;
    const note=String(d.comment||'').trim();
    const commentIndicator=note?'<span class="doc-comment-indicator" title="Dokument zawiera komentarz">✎ Komentarz</span>':'';
    const actions='<div class="doc-row-actions">'+cellButton('części',d.id,expanded)+commentIndicator+
      '<button type="button" class="doc-print-btn" data-doc-print="'+escapeHtml(d.id)+'" data-doc-direction="'+direction+'">Wydrukuj '+direction+'</button>'+
      '</div>';
    let expandedHtml='';
    if(expanded){
      const details=drawDocLines(state.detailCache.get(direction+':'+d.id),direction);
      const link=related?'<div class="doc-related-link"><span>W tej samej wizycie wykonano również '+
        (direction==='PZ'?'wydanie.':'przyjęcie.')+'</span>'+
        '<button type="button" data-related-direction="'+opposite+'" data-related-session="'+escapeHtml(d.id)+'">Zobacz '+opposite+' →</button></div>':'';
      const commentHtml=note?'<div class="doc-comment-box"><strong>Komentarz '+direction+
        '</strong><p>'+escapeHtml(note)+'</p></div>':'';
      expandedHtml='<tr class="receipt-expansion-row"><td colspan="5" class="receipt-expanded-cell">'+
        '<div class="receipt-lines-anchor"><div class="receipt-lines-card">'+details+commentHtml+link+'</div></div></td></tr>';
    }
    return '<tr data-doc-id="'+escapeHtml(d.id)+'"'+(over?' class="warning-row"':'')+'>'+
      '<td>'+dateText(d.date)+'</td><td>'+isoWeek(d.date)+'</td>'+
      '<td>'+partyHtml(d.counterparty,d.registration_plate)+'</td><td>'+escapeHtml(d.worker)+'</td>'+
      '<td class="doc-actions-cell">'+actions+'</td></tr>'+expandedHtml;
  }).join('');
  $('tableArea').innerHTML=wrapTable([
    {label:'Data'},{label:'Tydz.'},
    {label:direction==='PZ'?'Dostawca / Ekipa':'Odbiorca'},
    {label:direction==='PZ'?'Przyjmował':'Wydawał'},
    {label:''}
  ],rows)||'<div class="empty">Brak dokumentów.</div>';
  $('tableFooter').textContent=docs.length+' dokumentów'+
    (state.docsMatched>docs.length?' · pokazano pierwsze '+docs.length:'');
  $('searchNote').classList.toggle('hidden',!state.search.trim());
  $('searchNote').textContent=state.search.trim()?
    'Znaleziono w '+state.docsMatched+' '+(direction==='PZ'?'dostawach':'wydaniach')+' z '+state.docsTotal+'.':'';
}
function drawDocLines(parts,direction){
  if(!parts)return '<div class="loading">Wczytywanie pozycji...</div>';
  const rows=parts.map(p=>'<tr><td>'+escapeHtml(p.sap_number||'—')+'</td><td>'+
    (p.nok?'<span class="office-nok-name">'+escapeHtml(p.name)+' <strong>NOK</strong></span>':escapeHtml(p.name))+
    '</td><td class="num">'+quantity(p.quantity)+'</td></tr>').join('');
  return '<h3>'+ (direction==='PZ'?'Zawartość dostawy':'Wydane części')+'</h3>'+wrapTable([{label:'Indeks SAP'},{label:'Nazwa części'},{label:'Ilość',numeric:true}],rows);
}
function printField(label,value,registrationPlate=null){
  const content=registrationPlate===null?escapeHtml(value||'—'):partyHtml(value,registrationPlate);
  return '<div class="doc-print-field"><span>'+escapeHtml(label)+'</span><strong>'+content+'</strong></div>';
}
async function openDocumentPrint(id,direction){
  if(direction!=='PZ'&&direction!=='WZ')return;
  if(state.view!==(direction==='PZ'?'pz':'wz'))return;
  const documentRow=state.docs.find(d=>String(d.id)===String(id));
  if(!documentRow){
    errorBanner('Nie znaleziono dokumentu do wydruku.');
    return;
  }
  const warehouseAtClick=state.warehouse;
  let lines=state.detailCache.get(direction+':'+id);
  if(!Array.isArray(lines)){
    try{
      const response=await api('document',{warehouse:warehouseAtClick,direction,id});
      if(state.view!==(direction==='PZ'?'pz':'wz')||state.warehouse!==warehouseAtClick)return;
      lines=response.lines;
      if(!Array.isArray(lines))throw Error('Nieprawidłowe dane dokumentu.');
      state.detailCache.set(direction+':'+id,lines);
    }catch(ex){
      errorBanner(ex.message||'Nie udało się przygotować dokumentu do wydruku.');
      return;
    }
  }
  const warehouse=realWarehouse(state.warehouse)?.name||'Magazyn';
  const isReceipt=direction==='PZ';
  const title=isReceipt?'POTWIERDZENIE PRZYJĘCIA':'POTWIERDZENIE WYDANIA';
  const items=lines.map((p,i)=>
    '<tr><td class="doc-print-number">'+(i+1)+'</td><td>'+escapeHtml(p.sap_number||'—')+'</td>'+
    '<td>'+escapeHtml(p.name||'—')+(p.nok?' (NOK)':'')+'</td><td class="doc-print-qty">'+escapeHtml(p.quantity)+'</td></tr>').join('');
  const total=lines.reduce((sum,p)=>sum+(Number(p.quantity)||0),0);
  const warn=direction==='WZ'&&lines.some(p=>Number(p.shortage_quantity||0)>0);
  const leftName=isReceipt?'Przekazujący / dostawca':'Wydający / pracownik magazynu';
  const rightName=isReceipt?'Przyjmujący / pracownik magazynu':'Odbierający / ekipa';
  const leftPerson=isReceipt?documentRow.counterparty:documentRow.worker;
  const rightPerson=isReceipt?documentRow.worker:documentRow.counterparty;
  const signature=(label,person,registrationPlate=null)=>'<div class="doc-print-signature">'+
    '<div class="doc-print-sign-line"></div>'+
    '<strong>'+escapeHtml(label)+'</strong>'+
    '<span>'+(registrationPlate===null?escapeHtml(person||'—'):partyHtml(person,registrationPlate))+'</span></div>';
  $('docPrintTitle').textContent='Podgląd '+direction;
  $('docPrintSheet').innerHTML=
    '<div class="doc-print-letterhead">'+
      '<div class="doc-print-brand"><strong>GPBS</strong><span>STORAGE</span></div>'+
      '<span class="doc-print-region">POLSKA · DOKUMENT MAGAZYNOWY</span>'+
    '</div>'+
    '<div class="doc-print-title-row"><div><span class="doc-print-kicker">DOKUMENT '+direction+'</span>'+
      '<h2>'+title+'</h2></div><strong class="doc-print-type">'+direction+'</strong></div>'+
    '<div class="doc-print-fields">'+
      printField('Magazyn',warehouse)+
      printField('Data operacji',dateText(documentRow.date))+
      printField('Tydzień',isoWeek(documentRow.date))+
      printField(isReceipt?'Dostawca / ekipa':'Odbiorca',documentRow.counterparty,documentRow.registration_plate||'')+
      printField(isReceipt?'Przyjmował':'Wydawał',documentRow.worker)+
    '</div>'+
    '<div class="doc-print-section-title">Lista części</div>'+
    '<table class="doc-print-parts"><thead><tr><th>Lp.</th><th>Indeks SAP</th><th>Nazwa części</th><th>Ilość</th></tr></thead>'+
      '<tbody>'+items+'</tbody></table>'+
    '<div class="doc-print-totals"><span>Pozycji: <strong>'+lines.length+'</strong></span>'+
      '<span>Łącznie sztuk: <strong>'+total+'</strong></span></div>'+
    (warn?'<p class="doc-print-warning">Uwaga: wydanie obejmuje pozycje przekraczające stan ewidencyjny.</p>':'')+
    '<div class="doc-print-bottom"><div class="doc-print-notes"><strong>Uwagi:</strong><div></div><div></div></div>'+
    '<div class="doc-print-signatures">'+
      signature(leftName,leftPerson,isReceipt?(documentRow.registration_plate||''):null)+
      signature(rightName,rightPerson,!isReceipt?(documentRow.registration_plate||''):null)+'</div></div>';
  $('docPrintModal').classList.remove('hidden');
  $('docPrintClose').focus();
}
function clearOfficePrintStyle(){
  document.body.classList.remove('printing-office-document');
  document.getElementById('officeDocumentPageStyle')?.remove();
}
function closeDocumentPrint(){
  clearOfficePrintStyle();
  $('docPrintModal').classList.add('hidden');
  $('docPrintSheet').innerHTML='';
  $('tableArea').querySelector('[data-doc-print]')?.focus();
}
function printOfficeDocument(){
  if($('docPrintModal').classList.contains('hidden'))return;
  clearOfficePrintStyle();
  const pageStyle=document.createElement('style');
  pageStyle.id='officeDocumentPageStyle';
  pageStyle.textContent='@page{size:A4 portrait;margin:0}';
  document.head.appendChild(pageStyle);
  document.body.classList.add('printing-office-document');
  window.print();
}
function drawInventories(){
  const inventories=state.inventories;const q=state.search.toLocaleLowerCase('pl').trim();
  const visible=inventories.filter(x=>!q||[x.date,x.worker].some(s=>String(s||'').toLocaleLowerCase('pl').includes(q)));
  const rows=visible.map(inv=>'<tr><td>'+dateText(inv.date)+'</td><td>'+isoWeek(inv.date)+'</td><td>'+escapeHtml(inv.worker)+'</td><td class="num">'+escapeHtml(inv.positions)+'</td><td>'+cellButton('bilans',inv.id,state.expanded===inv.id)+'</td></tr>'+
    (state.expanded===inv.id?'<tr class="inventory-summary-row"><td colspan="5" class="inventory-summary-cell">'+
      '<div class="inventory-summary-anchor"><div class="expanded inventory-summary-card">'+
      drawInventoryLines(state.detailCache.get('inv:'+inv.id))+
      '</div></div></td></tr>':'')).join('');
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
function syncVehicleTopScroll(){
  if(state.view!=='vehicles')return;
  const content=$('tableArea').querySelector('.vehicle-stock-table');
  if(!content)return;
  // The top scrollbar starts at the first crew, not at the frozen SAP/name
  // columns. Match its scroll range to the inner table's horizontal range.
  const narrow=window.matchMedia('(max-width:690px)').matches;
  const width=narrow?content.scrollWidth:Math.max(0,content.scrollWidth-450);
  $('vehicleScrollWidth').style.width=width+'px';
  $('vehicleTopScroll').scrollLeft=$('tableArea').scrollLeft;
}
function drawVehicles(){
  $('tableArea').innerHTML='<div class="empty">Brak danych pojazdów. Prawdziwe stany samochodowe będą widoczne po pierwszej inwentaryzacji ekip w D1. Dane testowe nie są przenoszone.</div>';
  $('tableFooter').textContent='0 pojazdów w ewidencji';
  noteSearch(0,0,'pojazdach');
}
async function render(){
  if(state.view==='preview')return;
  if(state.preview?.type==='warehouse'&&state.view==='stocks'){
    errorBanner('');
    if(state.stockTab==='modules')drawModules();
    else{
      drawStocks([],null);
      $('tableArea').insertAdjacentHTML('beforeend',
        '<p class="office-stock-empty-note">Brak podłączonych danych dla tego magazynu.</p>');
    }
    return;
  }
  const ticket=++state.requestId;
  if(state.view==='labels'){
    errorBanner('');
    try{await window.GPBSOfficeLabels.render(state.warehouses,state.warehouse);}
    catch(error){errorBanner(error.message||'Nie udało się otworzyć drukowania etykiet.');}
    return;
  }
  setLoading();
  const params={warehouse:state.warehouse};
  try{
    if(state.view==='stocks'){
      if(state.stockTab==='modules'){
        if(ticket!==state.requestId)return;
        drawModules();
      }else{
      const parts=await loadStocks(state.warehouse);
      if(ticket!==state.requestId)return;drawStocks(parts,state.warehouse);
      }
    }else if(state.view==='aggregate'){
      const scoped=state.warehouses.filter(w=>w.country_code==='FR');
      // The FR comparison always lists all planned locations.
      // Only stores actually granted to the signed-in user are queried.
      const named=FR_LAYOUT_WAREHOUSES.map(location=>{
        const matched=scoped.find(w=>[location.name,location.matchName].some(
          name=>name&&normalizeWarehouseName(name)===normalizeWarehouseName(w.name)));
        return {id:matched?.id||null,name:location.name,source:matched||null};
      });
      const used=new Set(named.filter(x=>x.id).map(x=>x.id));
      const columns=[
        ...named,
        ...scoped.filter(w=>!used.has(w.id)).map(w=>({id:w.id,name:w.name,source:w}))
      ];
      const loaded=await Promise.all(columns.map(async col=>({
        id:col.id,name:col.name,parts:col.source?await loadStocks(col.id):[],
        preview:!col.source
      })));
      if(ticket!==state.requestId)return;
      drawAggregate(loaded);
    }else if(state.view==='vehicles'){
      if(ticket!==state.requestId)return;drawVehicles();
    }else if(state.view==='nok'){
      const payload=await api('nokStock',params);
      if(ticket!==state.requestId)return;
      state.nokParts=payload.parts||[];
      drawNokStock();
    }else if(state.view==='pz'||state.view==='wz'){
      const direction=state.view==='pz'?'PZ':'WZ';
      const focus=state.focusDocument;
      const payload=await api('documents',{...params,direction,term:state.search,...(focus?{focus}:{})});
      if(ticket!==state.requestId)return;
      state.docs=payload.documents;state.docsTotal=payload.total;state.docsMatched=payload.matched;
      drawDocs();
      if(focus){
        if(state.docs.some(d=>d.id===focus)){
          state.expanded=focus;
          const key=direction+':'+focus;
          if(!state.detailCache.has(key)){
            try{
              const details=await api('document',{...params,direction,id:focus});
              if(ticket!==state.requestId)return;
              state.detailCache.set(key,details.lines);
            }catch(ex){
              if(ticket!==state.requestId)return;
              errorBanner(ex.message||'Nie można pobrać powiązanego dokumentu.');
            }
          }
          drawDocs();
          const row=Array.from($('tableArea').querySelectorAll('tr[data-doc-id]'))
            .find(el=>el.dataset.docId===focus);
          row?.scrollIntoView({block:'center',behavior:'smooth'});
        }else errorBanner('Nie znaleziono powiązanego dokumentu.');
        if(state.focusDocument===focus)state.focusDocument=null;
      }
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
  if(state.preview?.type==='warehouse'&&state.view==='stocks'){render();return;}
  if(state.view==='stocks'){
    if(state.stockTab==='modules')drawModules();
    else{
      const parts=state.partsCache.get(state.warehouse)||state.partsCache.get(state.warehouses[0]?.id)||[];
      drawStocks(parts,state.warehouse);
    }
  }
  else if(state.view==='aggregate'||state.view==='vehicles'){render();}
  else if(state.view==='pz'||state.view==='wz')drawDocs();
  else if(state.view==='nok')drawNokStock();
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
  try{
    const warehouse=state.warehouse;
    const payload=await api('part',{warehouse,part:id});
    if(modal.classList.contains('hidden'))return;
    const p=payload.part;
    state.labelPart=p;
    const amount=p.quantity;
    const uploadedPhoto=Boolean(Number(p.has_photo));
    const photoSrc='/api/office?view=partPhoto&warehouse='+encodeURIComponent(warehouse)+
      '&part='+encodeURIComponent(p.id);
    const photo=uploadedPhoto
      ? '<button type="button" class="part-photo-zoom" data-photo-open="1" aria-label="Powiększ zdjęcie części '+escapeHtml(p.name)+'">'+
        '<img src="'+escapeHtml(photoSrc)+'" alt="'+escapeHtml(p.name)+' — zdjęcie części" loading="lazy">'+
        '<span class="photo-zoom-label" aria-hidden="true">⤢ Powiększ zdjęcie</span></button>'
      : '<div class="part-photo-empty" aria-label="Brak zdjęcia części"><span aria-hidden="true">▧</span><small>Zdjęcie części</small></div>';
    const deliveryQuantity=payload.delivery?'Przyjęto '+escapeHtml(payload.delivery.quantity)+' szt.':'Brak danych';
    body.innerHTML=
      '<div class="kicker">KARTA CZĘŚCI</div>'+
      '<h2 id="modalTitle">'+escapeHtml(p.name)+'</h2>'+
      '<p class="muted part-sap-line">Indeks SAP: '+escapeHtml(p.sap_number||'—')+'</p>'+
      '<div class="part-detail-layout">'+
        '<div class="part-photo-section">'+photo+'</div>'+
        '<div class="part-detail-data">'+
          '<div class="part-stock-block"><small>AKTUALNY STAN</small><strong>'+quantity(amount)+' <span>szt.</span></strong></div>'+
          '<div class="part-meta-item"><small>Identyfikator magazynowy</small><strong>'+escapeHtml(p.part_number||'—')+'</strong></div>'+
          '<div class="part-meta-item"><small>Ostatnia dostawa</small><strong>'+dateText(payload.delivery?.date)+'</strong><p>'+deliveryQuantity+'</p></div>'+
          '<div class="part-meta-item"><small>Ostatnia inwentaryzacja</small><strong>'+dateText(payload.inventory?.date)+'</strong></div>'+
        '</div>'+
      '</div>'+
      '<div class="modal-actions">'+
        '<button type="button" class="btn dark" data-label-add-current="1">Drukuj etykietę</button>'+
      '</div>';
    // A saved photo can exist in the catalogue even if the browser cannot decode it.
    // Show a readable error instead of a broken or invisible image.
    const partImage=body.querySelector('.part-photo-zoom img');
    if(partImage)partImage.addEventListener('error',()=>{
      const target=partImage.closest('.part-photo-zoom');
      if(!target||!target.isConnected)return;
      const placeholder=document.createElement('div');
      placeholder.className='part-photo-empty';
      const message=document.createElement('small');
      message.textContent='Nie można wyświetlić zdjęcia. Administrator może wgrać je ponownie jako JPG lub PNG.';
      placeholder.append(message);
      target.replaceWith(placeholder);
    },{once:true});
  }catch(ex){
    body.innerHTML='<h2 id="modalTitle">Szczegóły części</h2><p class="error">'+escapeHtml(ex.message)+'</p>';
  }
}
function openPhotoViewer(){
  const viewer=$('photoViewer');
  const image=$('modalBody').querySelector('[data-photo-open] img');
  if(!image)return;
  $('photoViewerImage').src=image.src;
  viewer.classList.remove('hidden');
  $('photoViewerClose').focus();
}
function closePhotoViewer(){
  $('photoViewer').classList.add('hidden');
  $('photoViewerImage').removeAttribute('src');
  $('modalBody').querySelector('[data-photo-open]')?.focus();
}
function closeModal(){
  if(!$('photoViewer').classList.contains('hidden'))closePhotoViewer();
  $('modal').classList.add('hidden');
  $('modal').querySelector('.modal-card').classList.remove('part-detail-card');
  $('modalBody').innerHTML='';
}
document.addEventListener('click',e=>{
  if(e.target.closest('[data-doc-print-close]')){closeDocumentPrint();return;}
  const docPrint=e.target.closest('[data-doc-print]');
  if(docPrint){openDocumentPrint(docPrint.dataset.docPrint,docPrint.dataset.docDirection);return;}
  const related=e.target.closest('[data-related-session]');
  if(related){
    const direction=related.dataset.relatedDirection;
    const session=related.dataset.relatedSession;
    if((direction==='PZ'||direction==='WZ')&&/^PL-SES-[a-f0-9-]{36}$/.test(session)){
      selectView(direction==='PZ'?'pz':'wz',state.warehouse,session);
    }
    return;
  }
  const tab=e.target.closest('[data-stock-tab]');if(tab){setStockTab(tab.dataset.stockTab);return;}
  if(e.target.closest('[data-label-add-current]')){
    const part=state.labelPart;
    if(!part)return;
    closeModal();
    window.GPBSOfficeLabels?.enqueue(part,state.warehouse);
    selectView('labels',state.warehouse);
    return;
  }
  const moduleCategory=e.target.closest('[data-module-category]');if(moduleCategory){setModuleCategory(moduleCategory.dataset.moduleCategory);return;}
  if(e.target.closest('[data-photo-close]')){closePhotoViewer();return;}
  if(e.target.closest('[data-photo-open]')){openPhotoViewer();return;}
  const w=e.target.closest('[data-warehouse]');if(w){selectView('stocks',w.dataset.warehouse);return;}
  const toggle=e.target.closest('[data-market-toggle]');
  if(toggle){
    const market=toggle.dataset.marketToggle;
    if(market==='PL'||market==='FR'){
      state.warehouseMenus[market]=!state.warehouseMenus[market];
      toggle.setAttribute('aria-expanded',String(state.warehouseMenus[market]));
      $('officeMarket'+market)?.classList.toggle('hidden',!state.warehouseMenus[market]);
    }
    return;
  }
  const aggregate=e.target.closest('[data-aggregate-market]');
  if(aggregate&&aggregate.dataset.aggregateMarket==='FR'){
    state.aggregateMarket='FR';
    state.warehouseMenus.FR=true;
    selectView('aggregate');
    return;
  }
  const preview=e.target.closest('[data-preview-warehouse]');
  if(preview){
    const item=FR_LAYOUT_WAREHOUSES.find(x=>x.key===preview.dataset.previewWarehouse);
    if(item)showOfficePreview('warehouse',item.key,item.name);
    return;
  }
  const module=e.target.closest('[data-fr-module]');
  if(module){
    const item=FR_LAYOUT_MODULES.find(x=>x.key===module.dataset.frModule);
    if(item)showOfficePreview('module',item.key,item.name);
    return;
  }
  const operation=e.target.closest('[data-market-view][data-view]');
  if(operation){
    const market=operation.dataset.marketView;
    const view=operation.dataset.view;
    if(!OFFICE_MARKET_OPERATIONS.some(op=>op.view===view))return;
    if(market==='FR'){
      state.warehouseMenus.FR=true;
      showOfficePreview('operation',view,OFFICE_OPERATION_PREVIEWS[view]);
      return;
    }
    if(market==='PL'){
      const preferred=realWarehouse(state.warehouse)?.country_code==='PL'
        ?state.warehouse
        :state.warehouses.find(w=>w.country_code==='PL'&&w.id==='PL-TYCHY')?.id||
         state.warehouses.find(w=>w.country_code==='PL')?.id;
      if(!preferred){errorBanner('Nie masz przypisanego magazynu PL.');return;}
      state.warehouseMenus.PL=true;
      selectView(view,preferred);
      return;
    }
  }
  const v=e.target.closest('[data-view]');if(v){selectView(v.dataset.view);return;}
  const part=e.target.closest('[data-part]');if(part){openPart(part.dataset.part);return;}
  const partRow=e.target.closest('tr[data-part-row]');if(partRow){openPart(partRow.dataset.partRow);return;}
  const exp=e.target.closest('[data-expand]');if(exp){expandRow(exp.dataset.expand);return;}
  if(e.target.closest('[data-close]'))closeModal();
});
$('vehicleTopScroll').addEventListener('scroll',()=>{
  if(state.view==='vehicles'&&$('tableArea').scrollLeft!==$('vehicleTopScroll').scrollLeft)
    $('tableArea').scrollLeft=$('vehicleTopScroll').scrollLeft;
});
$('tableArea').addEventListener('scroll',()=>{
  if(state.view==='vehicles'&&$('vehicleTopScroll').scrollLeft!==$('tableArea').scrollLeft)
    $('vehicleTopScroll').scrollLeft=$('tableArea').scrollLeft;
});
window.addEventListener('resize',syncVehicleTopScroll);
$('tableArea').addEventListener('change',e=>{
  if(e.target.dataset.diff){if(e.target.dataset.diff==='positive')state.positive=e.target.checked;else state.negative=e.target.checked;drawInventories();}
});
$('newPart').addEventListener('click',openOfficeNewPart);
$('officeNewPartForm').addEventListener('submit',saveOfficeNewPart);
$('officeNewPartCancel').addEventListener('click',closeOfficeNewPart);
$('officeNewPartDialog').addEventListener('cancel',event=>{
  if(newPartBusy)event.preventDefault();
});
$('officeNewPartDialog').addEventListener('close',()=>{
  clearNewPartPreview();
  $('officeNewPartForm').reset();
  newPartError('');
});
$('officeNewPartPhoto').addEventListener('change',async()=>{
  clearNewPartPreview();
  const file=$('officeNewPartPhoto').files?.[0];
  if(!file)return;
  try{
    await validatePartPhotoFile(file);
    if($('officeNewPartPhoto').files?.[0]!==file)return;
    newPartPreviewUrl=URL.createObjectURL(file);
    $('officeNewPartPreview').src=newPartPreviewUrl;
    $('officeNewPartPreview').hidden=false;
    newPartError('');
  }catch(error){
    if($('officeNewPartPhoto').files?.[0]!==file)return;
    $('officeNewPartPhoto').value='';
    newPartError(error.message||'Nieprawidłowy plik zdjęcia.');
  }
});
$('modalClose').addEventListener('click',closeModal);
$('docPrintButton').addEventListener('click',printOfficeDocument);
window.addEventListener('afterprint',clearOfficePrintStyle);
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    if(!$('docPrintModal').classList.contains('hidden'))closeDocumentPrint();
    else if(!$('photoViewer').classList.contains('hidden'))closePhotoViewer();
    else closeModal();
    return;
  }
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
$('refresh').addEventListener('click',()=>{
  if(state.view==='labels'){window.GPBSOfficeLabels?.refresh();return;}
  state.partsCache.clear();state.detailCache.clear();render();
});
// Warehouse lists remain permanently visible; no expanding menu.
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
// Office PWA install is separate from the warehouse/mobile application.
let officeInstallPrompt=null;
function officeStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
}
function updateOfficeInstallUI(){
  $('officeInstall').classList.toggle('hidden',officeStandalone());
}
function showOfficeInstallHelp(message){
  $('installOfficeHelp').textContent=message;
  $('installOfficeHelp').classList.remove('hidden');
}
window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();
  officeInstallPrompt=event;
  updateOfficeInstallUI();
});
window.addEventListener('appinstalled',()=>{
  officeInstallPrompt=null;
  $('officeInstall').classList.add('hidden');
  $('installOfficeHelp').classList.add('hidden');
});
$('installOffice').addEventListener('click',async()=>{
  if(officeStandalone()){
    updateOfficeInstallUI();
    return;
  }
  if(officeInstallPrompt){
    const prompt=officeInstallPrompt;
    officeInstallPrompt=null;
    try{
      await prompt.prompt();
      const choice=await prompt.userChoice;
      if(choice?.outcome==='accepted'){
        $('installOfficeHelp').classList.add('hidden');
        return;
      }
      showOfficeInstallHelp('Instalacja została anulowana. Możesz spróbować ponownie z menu przeglądarki.');
    }catch{
      showOfficeInstallHelp('Przeglądarka nie uruchomiła instalacji. Spróbuj z jej menu aplikacji.');
    }
    return;
  }
  const ua=navigator.userAgent;
  if(/Edg\//.test(ua)){
    showOfficeInstallHelp('W Microsoft Edge otwórz menu ⋯ → Więcej narzędzi → Aplikacje → Zainstaluj tę witrynę jako aplikację. Jeśli opcji nie ma, może być zablokowana przez firmę.');
  }else if(/Firefox\//.test(ua)){
    showOfficeInstallHelp('W Firefoksie na Windowsie kliknij ikonę aplikacji przy pasku adresu, aby przypiąć stronę jako aplikację. Utworzy się też skrót w menu Start.');
  }else if(/Chrome\//.test(ua)||/Chromium\//.test(ua)){
    showOfficeInstallHelp('W Chrome otwórz menu ⋮ i wybierz „Zainstaluj stronę jako aplikację” (nazwa opcji może się różnić).');
  }else{
    showOfficeInstallHelp('W menu przeglądarki wybierz instalację strony jako aplikacji lub dodanie skrótu. Opcja zależy od przeglądarki.');
  }
});
updateOfficeInstallUI();
(async()=>{try{setLoggedIn(await api('warehouses'));}catch{showLogin();}})();
setInterval(()=>{if(state.user&&document.visibilityState==='visible'){state.partsCache.clear();render();}},15*60*1000);
})();
