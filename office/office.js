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
  {key:'toulouse',name:'Box Toulouse',matchName:'Tuluza',
    aliases:['Toulouse','Toulouse Box','Tuluza BOX','Box Tuluza']},
  {key:'paris',name:'Box Paryż',matchName:'Paryż',
    aliases:['Paris','Paris Box','Paryż BOX','Box Paris']},
  {key:'bovis-paris',name:'Bovis Paryż',aliases:['Bovis Paris']},
  {key:'bovis-lille',name:'Bovis Lille'},
  {key:'bovis-nantes',name:'Bovis Nantes'},
  {key:'bovis-nancy',name:'Bovis Nancy'},
  {key:'bovis-marseille',name:'Bovis Marsylia',aliases:['Bovis Marseille']},
  {key:'bovis-toulouse',name:'Bovis Tuluza',aliases:['Bovis Toulouse']}
];
const BELLEVILLE_SERVICE={key:'service',name:'Serwisy',icon:'⚙'};
const FR_EQUIPMENT={key:'crews',name:'Zaopatrzenie ekip',icon:'▦'};
// TEMPORARY POLISH OFFICE PREVIEW ONLY. These two imaginary crews and all
// quantities exist only in client-side JavaScript. Never write them into D1.
// Delete this block and drawPolishVehiclePreview when the layout is approved.
const PL_VEHICLE_TEST_PREVIEW={
  crews:[
    {id:'demo-a',team:'TEST-A',plate:'TEST 001',inventory:'05.11.2026',frequency:'Co 7 dni'},
    {id:'demo-b',team:'TEST-B',plate:'TEST 002',inventory:'07.11.2026',frequency:'Co 7 dni'},
    {id:'demo-tw',team:'TW',plate:'ST 7486W',inventory:'07.11.2026',frequency:'W każdy piątek'}
  ],
  parts:[
    {index:'MG-999-901',name:'Adapter oświetlenia LED',external:'10-51-000596',required:4,
      stock:{'demo-a':{previous:3,current:4},'demo-b':{previous:2,current:2}}},
    {index:'MG-999-902',name:'Antena outdoor',external:'10-21-000623',required:1,
      stock:{'demo-a':{previous:1,current:1},'demo-b':{previous:1,current:0}}},
    {index:'MG-999-903',name:'Daszek LED',external:'11-50-000240',required:1,
      stock:{'demo-a':{previous:0,current:1},'demo-b':{previous:1,current:1}}},
    {index:'MG-999-904',name:'Ekspander standard',external:'10-21-000056',required:2,
      stock:{'demo-a':{previous:3,current:2},'demo-b':{previous:2,current:3}}},
    {index:'MG-999-905',name:'Ceownik dachu długi (Hokejka)',external:'11-50-000077',required:4,
      stock:{'demo-a':{previous:4,current:3},'demo-b':{previous:4,current:4}}},
    // The longest 36-character name from the source fleet list: layout test.
    {index:'MG-999-906',name:'Przewód zasilający kamery prawej 6W8',external:'10-22-000177',required:1,
      stock:{'demo-a':{previous:1,current:1},'demo-b':{previous:0,current:1}}}
  ]
};
// Only the aggregate comparison needs 14 fictional crews.
// Keep the polished "Ekipy" selector at its original three sample crews.
const PL_VEHICLE_SUMMARY_CREWS=[
  ...PL_VEHICLE_TEST_PREVIEW.crews,
  ...Array.from({length:11},(_,i)=>{
    const n=String(i+4).padStart(2,'0');
    return {id:'demo-'+n,team:'TEST-'+n,
      plate:'DEMO '+String(i+4).padStart(3,'0'),
      inventory:String(4+i%7).padStart(2,'0')+'.11.2026',
      frequency:'Co 7 dni'};
  })
];
function vehicleSummaryStock(part,partIndex,crew,crewIndex){
  // Retain familiar demo-team numbers. Additional crews only exist here.
  if(crewIndex<PL_VEHICLE_TEST_PREVIEW.crews.length)
    return vehicleDemoStockFor(part,partIndex,crew.id).current;
  return Math.max(0,part.required+((crewIndex*3+partIndex*2)%7)-3);
}
// The third imaginary crew is for testing the width of "ST 7486W" only.
for(const p of PL_VEHICLE_TEST_PREVIEW.parts){
  p.stock['demo-tw']={...p.stock['demo-b']};
}
// Invented dated snapshots for the temporary Office preview, not actual audits.
// Temporary, wholly invented inventory snapshots for visual approval.
// 'before' records the stock in the vehicle ledger immediately before counting;
// 'counts' records what the crew counted. They are not consecutive snapshots
// of stock movements, and MUST NOT be migrated to D1.
const PL_VEHICLE_TEST_HISTORY={
  'demo-a':[
    {date:'05.11.2026',time:'10:35',by:'TEST-A',before:[3,1,0,3,4,1],counts:[4,1,1,2,3,1]},
    {date:'29.10.2026',time:'16:10',by:'TEST-A',before:[3,1,0,3,4,1],counts:[3,1,0,3,4,1]},
    {date:'22.10.2026',time:'11:20',by:'TEST-A',before:[3,0,0,3,4,1],counts:[3,0,0,3,4,1]},
    {date:'15.10.2026',time:'09:05',by:'TEST-A',before:[4,1,1,2,4,0],counts:[4,1,1,2,4,0]},
    {date:'08.10.2026',time:'14:20',by:'TEST-A',before:[4,1,0,2,3,1],counts:[4,1,0,2,3,1]},
    {date:'01.10.2026',time:'12:10',by:'TEST-A',before:[3,1,0,2,3,0],counts:[4,1,0,2,3,1]},
    {date:'24.09.2026',time:'09:50',by:'TEST-A',before:[3,0,0,2,3,0],counts:[3,1,0,2,3,0]}
  ],
  'demo-b':[
    {date:'07.11.2026',time:'17:15',by:'TEST-B',before:[2,1,1,2,4,0],counts:[2,0,1,3,4,1]},
    {date:'02.11.2026',time:'11:50',by:'TEST-B',before:[2,1,1,2,4,0],counts:[2,1,1,2,4,0]},
    {date:'25.10.2026',time:'16:30',by:'TEST-B',before:[1,1,0,2,4,0],counts:[1,1,0,2,4,0]},
    {date:'18.10.2026',time:'13:40',by:'TEST-B',before:[3,1,0,2,3,0],counts:[3,1,0,2,3,0]},
    {date:'11.10.2026',time:'10:05',by:'TEST-B',before:[3,1,1,2,4,1],counts:[3,1,1,2,4,1]},
    {date:'04.10.2026',time:'15:30',by:'TEST-B',before:[2,1,1,2,4,0],counts:[3,1,1,2,4,1]},
    {date:'27.09.2026',time:'08:55',by:'TEST-B',before:[2,1,0,2,4,0],counts:[2,1,1,2,4,0]}
  ]
};
PL_VEHICLE_TEST_HISTORY['demo-tw']=
  PL_VEHICLE_TEST_HISTORY['demo-b'].map(h=>({...h,by:'TW'}));
// More fake weekly snapshots to exercise the narrow scrolling history UI.
// They exist ONLY in the Polish Office preview, never in the D1 database.
for(const [crewId,history] of Object.entries(PL_VEHICLE_TEST_HISTORY)){
  const oldest=history[history.length-1];
  const [day,month,year]=oldest.date.split('.').map(Number);
  const base=Date.UTC(year,month-1,day);
  for(let n=1;n<=14;n++){
    const date=new Date(base-n*7*86400000);
    const stamp=[String(date.getUTCDate()).padStart(2,'0'),
      String(date.getUTCMonth()+1).padStart(2,'0'),
      String(date.getUTCFullYear())].join('.');
    const counts=oldest.counts.map((v,i)=>Math.max(0,
      v+((n+i+(crewId==='demo-b'?1:0))%4===0?1:0)-
      ((n+i)%5===0?1:0)));
    const before=counts.map((v,i)=>Math.max(0,v+(i===n%counts.length?1:0)));
    history.push({date:stamp,time:(9+n%8)+':20',
      by:crewId==='demo-a'?'TEST-A':'TEST-B',before,counts});
  }
}
// Fleet workflow demonstration. All examples stay inside the Office browser.
// Never send these examples to D1 or mix them with real warehouse sessions.
const PL_VEHICLE_DEMO_MOVEMENTS=[
  {id:'DEMO-R01',kind:'usage',date:'04.11.2026',time:'11:40',crew:'demo-a',
    machine:'FR-0819',actor:'TEST-A',items:[{i:0,qty:2},{i:4,qty:1}]},
  {id:'DEMO-R02',kind:'warehouse_in',date:'01.11.2026',time:'09:10',crew:'demo-a',
    warehouse:'Belleville',actor:'Magazyn Belleville',items:[{i:1,qty:2}]},
  {id:'DEMO-R03',kind:'usage',date:'06.11.2026',time:'10:25',crew:'demo-b',
    machine:'FR-1234',actor:'TEST-B',items:[{i:1,qty:1},{i:3,qty:1}]},
  {id:'DEMO-R04',kind:'warehouse_in',date:'03.11.2026',time:'08:45',crew:'demo-b',
    warehouse:'Box Toulouse',actor:'Ekipa TEST-B',items:[{i:0,qty:2},{i:1,qty:3}]},
  {id:'DEMO-R05',kind:'transfer',date:'05.11.2026',time:'15:30',
    crew:'demo-b',peer:'demo-a',actor:'TEST-B',items:[{i:0,qty:1}],
    status:'pending'},
  {id:'DEMO-R06',kind:'transfer',date:'04.11.2026',time:'13:05',
    crew:'demo-b',peer:'demo-tw',actor:'TEST-B',items:[{i:3,qty:1}],
    status:'approved',approvedBy:'TW',approvalRole:'Ekipa'},
  {id:'DEMO-R07',kind:'usage',date:'06.11.2026',time:'12:20',crew:'demo-tw',
    machine:'FR-0453',actor:'TW',items:[{i:2,qty:1},{i:3,qty:1}]},
  {id:'DEMO-R08',kind:'warehouse_in',date:'05.11.2026',time:'08:40',crew:'demo-tw',
    warehouse:'Box Paris',actor:'Ekipa TW',items:[{i:2,qty:2}]},
  {id:'DEMO-R09',kind:'transfer',date:'02.11.2026',time:'16:55',
    crew:'demo-a',peer:'demo-tw',actor:'TEST-A',items:[{i:2,qty:1}],
    status:'approved',approvedBy:'JK',approvalRole:'Koordynator'}
];
const vehicleDemoApprovals=new Map();
function vehicleDemoTransferApproval(movement){
  return vehicleDemoApprovals.get(movement.id)||null;
}
function vehicleDemoTransferStatus(movement){
  return vehicleDemoTransferApproval(movement)?.status||movement.status||'recorded';
}
function vehicleDemoStockFor(part,partIndex,crewId){
  const base=part.stock[crewId]||{current:0};
  let current=Number(base.current)||0;
  for(const movement of PL_VEHICLE_DEMO_MOVEMENTS){
    // Only approvals made now in the preview affect example balances.
    if(movement.kind!=='transfer'||movement.status!=='pending'||
       vehicleDemoTransferStatus(movement)!=='approved')continue;
    const units=movement.items.find(item=>item.i===partIndex)?.qty||0;
    if(movement.crew===crewId)current-=units;
    if(movement.peer===crewId)current+=units;
  }
  return {...base,current};
}
function vehicleDemoCrewName(id){
  return PL_VEHICLE_TEST_PREVIEW.crews.find(c=>c.id===id)?.team||'—';
}
function vehicleDemoDateKey(date){
  const match=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(date||''));
  return match?match[3]+'-'+match[2]+'-'+match[1]:'';
}
function vehicleDemoMovementsFor(crewId,until,after){
  const to=vehicleDemoDateKey(until),from=vehicleDemoDateKey(after);
  return PL_VEHICLE_DEMO_MOVEMENTS.filter(move=>
    (move.crew===crewId||move.peer===crewId)&&
    vehicleDemoDateKey(move.date)<=to&&
    (!from||vehicleDemoDateKey(move.date)>from))
    .sort((a,b)=>vehicleDemoDateKey(b.date).localeCompare(vehicleDemoDateKey(a.date))||
      String(b.time).localeCompare(String(a.time)));
}
function vehicleDemoMoveLabel(move,crewId){
  if(move.kind==='usage')return 'Zużycie · maszyna '+(move.machine||'—');
  if(move.kind==='warehouse_in')return 'Pobrano z magazynu '+(move.warehouse||'');
  if(move.kind==='warehouse_out')return 'Zwrot do magazynu '+(move.warehouse||'');
  if(move.kind==='transfer')
    return move.crew===crewId
      ?'Przekazanie ekipie '+vehicleDemoCrewName(move.peer)
      :'Odebranie od ekipy '+vehicleDemoCrewName(move.crew);
  return 'Ruch części';
}
function vehicleDemoMoveIcon(move){
  return move.kind==='usage'?'⚒':move.kind==='transfer'?'⇄':move.kind==='warehouse_in'?'↓':'↑';
}
function vehicleDemoStatusText(move){
  const status=vehicleDemoTransferStatus(move);
  if(move.kind!=='transfer')return 'Zapisano';
  const approval=vehicleDemoTransferApproval(move);
  if(status==='pending')return 'Oczekuje na potwierdzenie';
  if(status==='rejected')return 'Odrzucono';
  const by=approval?.by||move.approvedBy;
  const role=approval?.role||move.approvalRole;
  return 'Potwierdzono'+(by?' przez '+(role?role+' · ':'')+by:'');
}
function vehicleDemoStatusClass(move){
  const status=vehicleDemoTransferStatus(move);
  return status==='pending'?' is-pending':status==='rejected'?' is-rejected':' is-complete';
}

// One historical comment to demonstrate the compact report indicator.
PL_VEHICLE_TEST_HISTORY['demo-b'][0].note=
  'Przegląd wyposażenia po serwisie. Zweryfikować brakującą antenę.';
PL_VEHICLE_TEST_HISTORY['demo-tw'][0].note=
  'Sprawdzono kompletność wyposażenia samochodu.';
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
const matchesFrenchWarehouse=(warehouse,location)=>{
  const name=normalizeWarehouseName(warehouse?.name).replace(/^magazyn/,'');
  return [location.name,location.matchName,...(location.aliases||[])]
    .filter(Boolean).some(alias=>name===normalizeWarehouseName(alias));
};
const isBovisWarehouse=name=>normalizeWarehouseName(name).replace(/^magazyn/,'').startsWith('bovis');

const state={user:null,warehouses:[],warehouse:'',preview:null,aggregateMarket:'FR',warehouseMenus:{PL:true,FR:false},frExpanded:null,bovisExpanded:false,view:'stocks',stockTab:'parts',moduleCategory:'all',vehicleTab:'detail',vehiclePreviewCrew:'demo-a',labelPart:null,search:'',sortReverse:false,partsCache:new Map(),docs:[],docsTotal:0,docsMatched:0,nokParts:[],inventories:[],detailCache:new Map(),expanded:null,focusDocument:null,positive:false,negative:false,requestId:0,lastSync:null,rememberWarning:''};
function realWarehouse(id){return state.warehouses.find(w=>w.id===id);}
function partCreationTarget(){
  if(state.view!=='stocks'||state.stockTab!=='parts')return null;
  if(state.preview?.type==='warehouse'){
    const location=FR_LAYOUT_WAREHOUSES.slice(0,3).find(x=>x.key===state.preview.key);
    return location?{fr:true,warehouseKey:location.key,warehouseId:'',label:location.name}:null;
  }
  if(state.preview)return null;
  const real=realWarehouse(state.warehouse);
  if(!real)return null;
  if(real.country_code==='PL')
    return {fr:false,warehouseKey:'',warehouseId:real.id,label:real.name};
  if(real.country_code==='FR'){
    const location=FR_LAYOUT_WAREHOUSES.slice(0,3).find(x=>matchesFrenchWarehouse(real,x));
    return location?{fr:true,warehouseKey:location.key,warehouseId:real.id,label:location.name}:null;
  }
  return null;
}
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
  const target=partCreationTarget();
  if(!target||newPartBusy)return;
  $('officeNewPartForm').reset();
  newPartError('');
  clearNewPartPreview();
  $('officeNewPartWarehouse').textContent='Magazyn: '+target.label;
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
  const target=partCreationTarget();
  if(newPartBusy||!target)return;
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
    const now=partCreationTarget();
    if(!now||now.warehouseId!==target.warehouseId||
       now.warehouseKey!==target.warehouseKey)
      throw Error('Wybrano inny magazyn. Otwórz formularz ponownie.');
    const form=new FormData();
    form.set('warehouseId',target.warehouseId);
    if(target.fr)form.set('warehouseKey',target.warehouseKey);
    form.set('name',name);
    form.set('sap',sap);
    if(file)form.set('photo',file,file.name);
    const response=await fetch(target.fr
      ?'/api/office?action=createFrenchCatalogPart':'/api/pl/new-part',{
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
    // A visible new catalogue row is sufficient confirmation.
    if(!target.fr){
      $('officeNewPartNotice').textContent='Dodano „'+name+'” do katalogu. Część oczekuje na weryfikację.';
      $('officeNewPartNotice').classList.remove('hidden');
    }
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
  state.user=payload.user;state.warehouses=payload.warehouses;state.preview=null;state.frExpanded=null;state.bovisExpanded=false;
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
  const equipmentButton=()=>'<button type="button" class="subnav-btn office-operation-link office-equipment-link" '+
    'data-fr-module="'+FR_EQUIPMENT.key+'">'+
    '<span class="office-operation-icon" aria-hidden="true">'+FR_EQUIPMENT.icon+'</span>'+
    FR_EQUIPMENT.name+'</button>';
  const vehicleButton=country=>state.user?.features?.stocks===false?'':(
    '<button type="button" class="subnav-btn office-operation-link office-vehicle-link" '+
    'data-market-vehicles="'+country+'">'+
    '<span class="office-operation-icon" aria-hidden="true">▤</span>'+
    'Stany samochodowe</button>');
  const permittedOperations=country=>OFFICE_MARKET_OPERATIONS.filter(op=>{
    // In Poland, NOK is already a stock tab rather than a sidebar operation.
    if(country==='PL'&&op.view==='nok')return false;
    // Vehicle stock has its own country-level menu in both markets.
    if(op.view==='vehicles')return false;
    const feature={pz:'pz',wz:'wz',nok:'stocks',inventories:'inventory',
      vehicles:'stocks',labels:'labels'}[op.view];
    return state.user?.features?.[feature]!==false;
  });
  const marketOperations=country=>'<div class="office-market-operations">'+
    '<div class="office-market-operations-label">OPERACJE</div>'+
    permittedOperations(country).map(op=>
      '<button type="button" class="subnav-btn office-operation-link" '+
      'data-market-view="'+country+'" data-view="'+escapeHtml(op.view)+'">'+
      '<span class="office-operation-icon" aria-hidden="true">'+escapeHtml(op.icon)+'</span>'+
      escapeHtml(op.label)+'</button>'
    ).join('')+'</div>';
  // French operational menu is scoped to one warehouse, never to the whole country.
  const frenchWarehouse=(label,key,realId='',expandable=true)=>{
    if(!expandable)return realId
      ?'<button type="button" class="subnav-btn" data-warehouse="'+escapeHtml(realId)+'">'+escapeHtml(label)+'</button>'
      :'<button type="button" class="subnav-btn office-preview-link" '+
        'data-preview-warehouse="'+escapeHtml(key)+'">'+escapeHtml(label)+'</button>';
    const open=state.frExpanded===key;
    const stockButton=state.user?.features?.stocks===false?'':(
      '<button type="button" class="subnav-btn office-operation-link office-fr-operation office-fr-stock-link" '+
        'data-fr-stock="'+escapeHtml(key)+'" data-fr-real-id="'+escapeHtml(realId)+'" '+
        'data-fr-warehouse-name="'+escapeHtml(label)+'">'+
        '<span class="office-operation-icon" aria-hidden="true">▤</span>'+
        'Stany magazynowe</button>');
    const children=stockButton+permittedOperations('FR').map(op=>
      '<button type="button" class="subnav-btn office-operation-link office-fr-operation" '+
        'data-fr-operation="'+escapeHtml(key)+'" data-fr-real-id="'+escapeHtml(realId)+'" '+
        'data-fr-warehouse-name="'+escapeHtml(label)+'" data-view="'+escapeHtml(op.view)+'">'+
        '<span class="office-operation-icon" aria-hidden="true">'+escapeHtml(op.icon)+'</span>'+
        escapeHtml(op.label)+'</button>'
    ).join('')+(key==='belleville'
      ?'<button type="button" class="subnav-btn office-operation-link office-fr-operation" '+
        'data-belleville-service="1" data-fr-warehouse-name="'+escapeHtml(label)+'">'+
        '<span class="office-operation-icon" aria-hidden="true">'+BELLEVILLE_SERVICE.icon+'</span>'+
        BELLEVILLE_SERVICE.name+'</button>':'');
    return '<div class="office-fr-warehouse">'+
      '<button type="button" class="subnav-btn office-fr-warehouse-toggle" '+
        'data-fr-warehouse-toggle="'+escapeHtml(key)+'" '+
        'data-fr-real-id="'+escapeHtml(realId)+'" '+
        'data-fr-warehouse-name="'+escapeHtml(label)+'" '+
        'aria-expanded="'+String(open)+'" aria-controls="fr-ops-'+escapeHtml(key)+'">'+
        '<span>'+escapeHtml(label)+'</span>'+
        '<svg class="office-fr-warehouse-chevron" width="16" height="16" viewBox="0 0 24 24" '+
          'fill="none" stroke="currentColor" stroke-width="2.25" '+
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+
          '<path d="m6 9 6 6 6-6"/></svg>'+
      '</button>'+
      '<div id="fr-ops-'+escapeHtml(key)+'" class="office-fr-warehouse-operations'+(open?'':' hidden')+'">'+
        children+'</div></div>';
  };
  const bovisMenu=items=>{
    if(!items.length)return '';
    return '<div class="office-bovis-group">'+
      '<button type="button" class="subnav-btn office-fr-warehouse-toggle office-bovis-toggle" '+
        'data-bovis-toggle="1" aria-expanded="'+String(state.bovisExpanded)+'" '+
        'aria-controls="officeBovisEntries">'+
        '<span>Bovis</span><svg class="office-fr-warehouse-chevron" width="16" height="16" '+
          'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" '+
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+
          '<path d="m6 9 6 6 6-6"/></svg>'+
      '</button>'+
      '<div id="officeBovisEntries" class="office-bovis-entries'+(state.bovisExpanded?'':' hidden')+'">'+
        items.join('')+'</div></div>';
  };
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
      items+
      (showAggregate?aggregateButton()+vehicleButton('FR')+equipmentButton():'')+
      (showOperations?marketOperations(country):'')+
      (country==='PL'?vehicleButton('PL'):'')+'</div></div>';
  };
  // Do not reveal the Poland section to FR-only users. The server already
  // filtered state.warehouses by live per-user market settings.
  const plSection=pl.length?group('PL',pl.map(renderReal).join(''),false,true):'';

  const frItems=[],bovisItems=[];
  const pushFrench=(label,key,realId='')=>{
    if(isBovisWarehouse(label)){
      const city=label.replace(/^Bovis\s+/i,'');
      const item=realId
        ?'<button type="button" class="subnav-btn" data-warehouse="'+escapeHtml(realId)+'">'+escapeHtml(city)+'</button>'
        :'<button type="button" class="subnav-btn office-preview-link" '+
          'data-preview-warehouse="'+escapeHtml(key)+'">'+escapeHtml(city)+'</button>';
      bovisItems.push(item);
    }else frItems.push(frenchWarehouse(label,key,realId,true));
  };
  if(canPreviewFrance){
    const used=new Set();
    for(const location of FR_LAYOUT_WAREHOUSES){
      const real=fr.find(w=>matchesFrenchWarehouse(w,location));
      if(real)used.add(real.id);
      pushFrench(location.name,location.key,real?.id||'');
    }
    for(const warehouse of fr.filter(w=>!used.has(w.id))){
      pushFrench(warehouse.name,'real-'+warehouse.id,warehouse.id);
    }
  }else{
    for(const warehouse of fr){
      const location=FR_LAYOUT_WAREHOUSES.find(item=>matchesFrenchWarehouse(warehouse,item));
      pushFrench(location?.name||warehouse.name,location?.key||'real-'+warehouse.id,
        warehouse.id);
    }
  }
  if(bovisItems.length)frItems.push(bovisMenu(bovisItems));
  const hasFrance=canPreviewFrance||frItems.length>0;
  $('warehouseMenu').innerHTML=plSection+
    (hasFrance?group('FR',frItems.join(''),true,false):'');
  for(const el of document.querySelectorAll('#sidebar [data-warehouse],#sidebar [data-preview-warehouse],#sidebar [data-fr-warehouse-toggle],#sidebar [data-fr-stock],#sidebar [data-fr-operation],#sidebar [data-belleville-service],#sidebar [data-fr-module],#sidebar [data-market-vehicles],#sidebar [data-view],#sidebar [data-aggregate-market]')){
    const isReal=state.view==='stocks'&&!state.preview&&el.dataset.warehouse===state.warehouse;
    const isPreview=Boolean(state.preview)&&(
      el.dataset.previewWarehouse===state.preview?.key&&state.preview?.type==='warehouse'||
      el.dataset.frModule===state.preview?.key&&state.preview?.type==='module');
    const isAggregate=state.view==='aggregate'&&el.dataset.aggregateMarket==='FR';
    const isMarketView=el.dataset.marketView==='PL'
      ?!state.preview&&state.view===el.dataset.view&&state.view!=='preview'&&
        realWarehouse(state.warehouse)?.country_code==='PL'
      :el.dataset.marketView==='FR'
        ?state.view==='preview'&&state.preview?.type==='operation'&&
          state.preview?.key===el.dataset.view
        :false;
    const isView=!el.dataset.marketView&&!el.dataset.frOperation&&
      state.view!=='preview'&&el.dataset.view===state.view;
    const isFrStock=Boolean(el.dataset.frStock)&&state.view==='stocks'&&(
      state.preview?.type==='warehouse'
        ?state.preview.key===el.dataset.frStock
        :!state.preview&&el.dataset.frRealId===state.warehouse);
    const isFrWarehouseExpanded=Boolean(el.dataset.frWarehouseToggle)&&
      state.frExpanded===el.dataset.frWarehouseToggle;
    const isFrOperation=Boolean(el.dataset.frOperation)&&
      state.preview?.type==='operation'&&state.preview.warehouseKey===el.dataset.frOperation&&
      state.preview.key===el.dataset.view;
    const isService=Boolean(el.dataset.bellevilleService)&&
      state.preview?.type==='module'&&state.preview?.key===BELLEVILLE_SERVICE.key&&
      state.preview?.warehouseKey==='belleville';
    const isMarketVehicles=el.dataset.marketVehicles==='FR'
      ?state.preview?.type==='operation'&&state.preview?.key==='vehicles'&&
        !state.preview?.warehouseKey
      :el.dataset.marketVehicles==='PL'
        ?!state.preview&&state.view==='vehicles'&&
          realWarehouse(state.warehouse)?.country_code==='PL':false;
    el.classList.toggle('active',Boolean(isReal||isPreview||isAggregate||isMarketView||isView||isFrStock||isFrOperation||isService||isMarketVehicles));
    if(el.dataset.frWarehouseToggle)el.classList.toggle('is-expanded',isFrWarehouseExpanded);
  }
}
function showOfficePreview(type,key,label,warehouseContext=null){
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
    $('refresh').classList.add('hidden');
    $('syncTime').textContent='';
    renderMenu();
    render();
    return;
  }
  // French operations and modules share the real Office window layout.
  // Until their data sources are connected, render empty content without warehouse API calls.
  ++state.requestId;
  state.view=type==='operation'?key:'preview';
  state.preview={type,key,label,...(warehouseContext||{})};
  if(key==='vehicles')state.vehicleTab='detail';
  state.stockTab='parts';state.moduleCategory='all';state.search='';
  state.focusDocument=null;state.expanded=null;
  $('sidebar').classList.remove('open');
  $('officePreview').classList.add('hidden');
  $('pageActions').classList.remove('hidden');
  setHead(label,'','');
  if(warehouseContext?.warehouseName){
    $('warehouseCrumb').textContent=warehouseContext.warehouseName.toLocaleUpperCase('pl');
    $('warehouseCrumb').classList.remove('hidden');
  }
  $('syncTime').textContent='';
  renderMenu();
  render();
}
function setHead(title,kicker,desc){
  $('pageTitle').textContent=title;$('pageKicker').textContent=kicker;$('pageDesc').textContent=desc;
  $('crumb').textContent=title;
  $('newPart').classList.toggle('hidden',!partCreationTarget());
  $('stockTabs').classList.toggle('hidden',state.view!=='stocks');
  const polishStocks=state.view==='stocks'&&!state.preview&&realWarehouse(state.warehouse)?.country_code==='PL';
  $('modulesTab').dataset.stockTab=polishStocks?'nok':'modules';
  $('modulesTab').textContent=polishStocks?'CZĘŚCI NIEKOMPLETNE':'MODUŁY';
  const frEmpty=state.preview?.type==='operation'||state.preview?.type==='module';
  const workingLabels=state.view==='labels'&&!frEmpty;
  $('officeLabelsView').classList.toggle('hidden',!workingLabels);
  $('officeTableCard').classList.toggle('hidden',workingLabels);
  syncStockTabUI();
  $('sort').classList.toggle('hidden',!['stocks','aggregate'].includes(state.view));
  $('search').closest('.search-wrap').classList.toggle('hidden',state.view==='vehicles');
  $('search').placeholder=state.view==='stocks'||state.view==='aggregate'||state.view==='vehicles'||state.view==='nok'?'Szukaj po SAP lub nazwie części':state.view==='inventories'?'Szukaj inwentaryzacji...':'Szukaj: SAP, nazwa, dostawca, pracownik...';
  $('search').value=state.search;$('sort').textContent=state.sortReverse?'Nazwa Z–A':'Nazwa A–Z';
  const name=realWarehouse(state.warehouse)?.name||'Magazyn';
  const stockView=state.view==='stocks';
  const documentsView=state.view==='pz'||state.view==='wz';
  const vehicleView=state.view==='vehicles';
  const aggregateView=state.view==='aggregate';
  const inventoriesView=state.view==='inventories';
  const compactView=documentsView||vehicleView||aggregateView||inventoriesView||
    state.view==='nok'||frEmpty;
  $('app').classList.toggle('view-stocks',stockView);
  $('app').classList.toggle('view-receipts',compactView);
  $('app').classList.toggle('view-vehicles',vehicleView);
  $('app').classList.toggle('view-aggregate',aggregateView);
  $('app').classList.toggle('view-labels',workingLabels);
  $('app').classList.toggle('view-fr-empty',frEmpty);
  $('vehicleTopContext').classList.toggle('hidden',!vehicleView);
  // Show this warning only where fictional fleet data are rendered.
  const fictionalFleet=vehicleView&&!state.preview&&
    realWarehouse(state.warehouse)?.country_code==='PL';
  $('vehicleDemoBanner').classList.toggle('hidden',!fictionalFleet);
  $('vehicleTopExportHost').classList.toggle('hidden',!vehicleView);
  $('officeTableCard').querySelector('.table-toolbar').classList.toggle('hidden',vehicleView);
  if(vehicleView)$('vehicleTopExportHost').append($('export'));
  else $('tableToolbarTools').append($('export'));
  $('receiptToolbarInfo').classList.toggle('hidden',!compactView||vehicleView);
  $('receiptToolbarActions').classList.toggle('hidden',!compactView);
  // The fleet scroll track is useful only when a real crew-stock table exists.
  // Do not show an empty horizontal strip above the no-data message.
  $('vehicleTopScroll').classList.add('hidden');
  if(compactView){
    $('receiptToolbarInfo').querySelector('strong').textContent=state.preview?.type==='module'
      ?state.preview.label:aggregateView?'Zestawienie zbiorcze':vehicleView?'Stany samochodowe':
      inventoriesView?'Inwentaryzacje':state.view==='labels'?'Drukowanie etykiet':
      state.view==='nok'?'Części niekompletne':state.view==='pz'?'Przyjęcia':'Wydania';
    $('receiptToolbarInfo').querySelector('span').textContent=state.preview?.type==='module'
      ?'':state.view==='labels'?'Lista części i etykiet.'
      :aggregateView?'Porównanie stanów części pomiędzy magazynami.'
      :vehicleView?'Ewidencja części na samochodach serwisowych.'
      :inventoriesView?'Historia inwentaryzacji i bilanse.'
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
  $('warehouseCrumb').classList.toggle('hidden',!stockView&&!Boolean(state.preview?.warehouseName));
  $('warehouseCrumb').textContent=name.replace(/^magazyn\s+/i,'').toLocaleUpperCase('pl');
  $('tableCaption').classList.toggle('hidden',!stockView);
  if(stockView){$('pageKicker').textContent=name.toUpperCase();$('pageDesc').textContent='Aktualne stany części w magazynie.';}
  $('refresh').classList.toggle('hidden',Boolean(state.preview?.type==='warehouse')||state.view==='vehicles');
  // A preview with no D1 fleet source must not show a stale sync timestamp.
  $('syncTime').classList.toggle('hidden',state.view==='vehicles');
  if(state.view==='vehicles')$('syncTime').textContent='';
  $('refresh').disabled=Boolean(frEmpty)||state.view==='vehicles';
  $('refresh').title=frEmpty?'Brak danych do synchronizacji':'Odśwież dane';
  // French catalogue views can add shared parts, without creating stock.
}
function syncStockTabUI(){
  const modules=state.view==='stocks'&&state.stockTab==='modules';
  const nok=state.view==='stocks'&&state.stockTab==='nok';
  const secondary=modules||nok;
  $('app').classList.toggle('view-modules',modules);
  $('moduleCategories').classList.toggle('hidden',!modules);
  for(const [id,active] of [['partsTab',!secondary],['modulesTab',secondary]]){
    $(id).classList.toggle('active',active);
    $(id).setAttribute('aria-selected',String(active));
  }
  $('newPart').textContent=modules?'+ Dodaj moduł':'+ Dodaj część';
  const canAdd=!secondary&&Boolean(partCreationTarget());
  $('newPart').disabled=!canAdd;
  $('newPart').classList.toggle('hidden',!canAdd);
  $('newPart').title=canAdd?'Dodaj nową część do centralnego katalogu':
    modules?'Dodawanie modułów nie jest jeszcze dostępne':'Brak aktywnego magazynu';
  $('tableCaption').querySelector('strong').textContent=modules?'Stany magazynowe modułów':nok?'Części niekompletne (NOK)':'Aktualne stany części w magazynie';
  $('search').placeholder=modules?'Wyszukaj po numerze seryjnym':'Szukaj po SAP lub nazwie części';
  $('sort').textContent=state.sortReverse?'Nazwa Z–A':'Nazwa A–Z';
  document.querySelectorAll('[data-module-category]').forEach(btn=>{
    const selected=btn.dataset.moduleCategory===state.moduleCategory;
    btn.classList.toggle('active',selected);
    btn.setAttribute('aria-pressed',String(selected));
  });
}
function setStockTab(tab){
  const polish=!state.preview&&realWarehouse(state.warehouse)?.country_code==='PL';
  if(!['parts',polish?'nok':'modules'].includes(tab)||state.view!=='stocks'||state.stockTab===tab)return;
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
  state.view=view;state.stockTab='parts';state.moduleCategory='all';state.search='';if(view==='vehicles')state.vehicleTab='detail';state.expanded=focusDocument;state.focusDocument=focusDocument;state.positive=false;state.negative=false;
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
    ' · „—” oznacza nieustalony stan';
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
  const scroller=$('vehicleTopScroll');
  const content=state.view==='vehicles'
    ?$('tableArea').querySelector('.vehicle-stock-table'):null;
  if(!content){
    scroller.classList.add('hidden');
    $('vehicleScrollWidth').style.width='0px';
    // The preview uses its own slider aligned only with older inventories.
    setupVehicleHistoryRail();
    return;
  }
  scroller.classList.remove('hidden');
  // The top scrollbar starts at the first crew, not at the frozen SAP/name
  // columns. Match its scroll range to the inner table's horizontal range.
  const narrow=window.matchMedia('(max-width:690px)').matches;
  const width=narrow?content.scrollWidth:Math.max(0,content.scrollWidth-450);
  $('vehicleScrollWidth').style.width=width+'px';
  $('vehicleTopScroll').scrollLeft=$('tableArea').scrollLeft;
}
function vehicleViewTabs(tab){
  const tabs=[['detail','Ekipy'],['summary','Zestawienie zbiorcze'],['transfers','Transfery']];
  return '<div class="vehicle-tabs-row"><nav class="vehicle-setup-tabs" role="tablist" aria-label="Widoki stanów samochodowych">'+
    tabs.map(([id,label])=>'<button type="button" role="tab" data-vehicle-tab="'+id+'" '+
      'aria-selected="'+String(tab===id)+'" '+
      'class="vehicle-setup-tab'+(tab===id?' active':'')+'">'+label+'</button>'
    ).join('')+'</nav>'+
    (tab==='detail'?'<span class="vehicle-tabs-hint"><span aria-hidden="true">ⓘ</span> Kliknij nagłówek inwentaryzacji, aby otworzyć jej raport</span>':'')+
    '</div>';
}
function fleetTransfersPlaceholder(){
  return '<div class="vehicle-transfer-empty">'+
    '<h3>Transfery między ekipami</h3>'+
    '<p>Po połączeniu magazynów mobilnych z D1 w tym miejscu będą zgłoszenia i potwierdzenia transferów.</p>'+
    '<small>Nie ma jeszcze realnych transferów do pokazania.</small>'+
    '</div>';
}
function vehicleDemoTransfersView(){
  const rights=['ADMIN','KIEROWNIK','KOORDYNATOR'].includes(state.user?.role);
  const roleNames={ADMIN:'Administrator',KIEROWNIK:'Kierownik',KOORDYNATOR:'Koordynator'};
  const label=roleNames[state.user?.role]||'Pracownik';
  const rows=PL_VEHICLE_DEMO_MOVEMENTS.filter(x=>x.kind==='transfer')
    .sort((a,b)=>vehicleDemoDateKey(b.date).localeCompare(vehicleDemoDateKey(a.date)));
  return '<section class="vehicle-demo-transfers">'+
    '<div class="vehicle-demo-transfers-head">'+
      '<div><h3>Transfery pomiędzy ekipami</h3>'+
      '<p>Przekazanie zmienia oba stany dopiero po potwierdzeniu odbiorcy albo decyzji uprawnionej osoby.</p></div>'+
      '<span class="vehicle-demo-label">DANE FIKCYJNE · PODGLĄD</span></div>'+
    '<div class="vehicle-demo-transfers-list">'+rows.map(t=>{
      const status=vehicleDemoTransferStatus(t);
      const itemList=t.items.map(item=>{
        const p=PL_VEHICLE_TEST_PREVIEW.parts[item.i];
        return escapeHtml(p?.name||'Część')+' <b>'+escapeHtml(item.qty)+' szt.</b>';
      }).join(' · ');
      const from=vehicleDemoCrewName(t.crew),to=vehicleDemoCrewName(t.peer);
      return '<article class="vehicle-demo-transfer-card'+vehicleDemoStatusClass(t)+'">'+
        '<div class="vehicle-demo-transfer-main">'+
          '<div class="vehicle-demo-transfer-title">'+
            '<strong>'+escapeHtml(from)+' <span aria-hidden="true">→</span> '+escapeHtml(to)+'</strong>'+
            '<span class="vehicle-demo-transfer-status">'+escapeHtml(vehicleDemoStatusText(t))+'</span>'+
          '</div>'+
          '<p>'+itemList+'</p>'+
          '<small>'+escapeHtml(t.date)+' · '+escapeHtml(t.time)+
            ' · Zgłosił: '+escapeHtml(t.actor)+'</small>'+
        '</div>'+
        (status==='pending'&&rights?
          '<button type="button" class="btn subtle vehicle-demo-approve" '+
          'data-vehicle-demo-approve="'+escapeHtml(t.id)+'" '+
          'title="Tylko podgląd. Nie zapisuje nic w bazie D1.">'+
          'Zatwierdź jako '+escapeHtml(label.toLowerCase())+'</button>':'')+
      '</article>';
    }).join('')+'</div>'+
    '<p class="vehicle-demo-transfers-foot">Przy prawdziwym transferze uprawniona osoba po wyjaśnieniu sytuacji zatwierdziłaby go pod własnym kontem. '+
      'W tym podglądzie przycisk zmienia wyłącznie dane przykładowe w bieżącej sesji, bez zapisu do D1.</p>'+
    '</section>';
}
function vehicleInventoryButton(h,index){
  const history=PL_VEHICLE_TEST_HISTORY[state.vehiclePreviewCrew]||[];
  const movements=vehicleDemoMovementsFor(
    state.vehiclePreviewCrew,h.date,history[index+1]?.date);
  const moveIcon='<svg width="13" height="13" viewBox="0 0 24 24" '+
    'fill="none" stroke="currentColor" stroke-width="2.3" '+
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+
    '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/>'+
    '<path d="m16 13 4 4-4 4"/><path d="M20 17H4"/></svg>';
  const noteIcon='<svg width="13" height="13" viewBox="0 0 24 24" '+
    'fill="none" stroke="currentColor" stroke-width="2.3" '+
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+
    '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6A8.4 8.4 0 0 1 12.5 3h.5a8.5 8.5 0 0 1 8 8v.5Z"/>'+
    '<path d="M8 10h8M8 14h5"/></svg>';
  const markers=(movements.length
    ?'<span title="Ruchy części w tym okresie" class="vehicle-inventory-marker is-movement">'+moveIcon+'</span>':'')+
    (h.note?'<span title="Komentarz do inwentaryzacji" class="vehicle-inventory-marker is-comment">'+noteIcon+'</span>':'');
  return '<button type="button" class="vehicle-inventory-button" '+
    'data-vehicle-inventory-index="'+index+'" '+
    'aria-label="Otwórz raport inwentaryzacji z '+escapeHtml(h.date)+'">'+
    '<span>Inwentaryzacja</span><small>'+escapeHtml(h.date)+'</small>'+
    (markers?'<span class="vehicle-inventory-markers" aria-hidden="true">'+markers+'</span>':'')+
    '</button>';
}
function setupVehicleHistoryRail(){
  const rail=$('tableArea').querySelector('.vehicle-split-history .vehicle-history-scrollbar');
  const wrap=$('tableArea').querySelector('.vehicle-history-table-wrap');
  if(!rail||!wrap)return;
  const available=rail.clientWidth;
  const overflow=Math.max(0,wrap.scrollWidth-wrap.clientWidth);
  if(available<70||overflow<2){
    rail.style.visibility='hidden';
    return;
  }
  rail.style.visibility='visible';
  rail.querySelector('.vehicle-history-scrollbar-track').style.width=
    Math.ceil(available+overflow)+'px';
  if(rail.dataset.linked==='1')return;
  rail.dataset.linked='1';
  rail.addEventListener('scroll',()=>{
    if(wrap.scrollLeft!==rail.scrollLeft)wrap.scrollLeft=rail.scrollLeft;
  },{passive:true});
  wrap.addEventListener('scroll',()=>{
    if(rail.scrollLeft!==wrap.scrollLeft)rail.scrollLeft=wrap.scrollLeft;
  },{passive:true});
}
// The fixed stock columns and scrolling inventories are separate tables.
// Mirror the hovered row across them so one part highlights end to end.
function setupVehiclePairedRowHover(){
  const split=$('tableArea').querySelector('.vehicle-preview-split-table');
  if(!split)return;
  const fixed=[...split.querySelectorAll('.vehicle-split-fixed-table tbody tr')];
  const history=[...split.querySelectorAll('.vehicle-split-history-table tbody tr')];
  let active=-1;
  const clear=()=>{
    if(active<0)return;
    fixed[active]?.classList.remove('vehicle-paired-hover');
    history[active]?.classList.remove('vehicle-paired-hover');
    active=-1;
  };
  split.addEventListener('mouseover',event=>{
    const row=event.target.closest('tbody tr');
    const index=row?.sectionRowIndex;
    if(index===active)return;
    clear();
    if(!Number.isInteger(index)||index<0||
       (fixed[index]!==row&&history[index]!==row))return;
    fixed[index]?.classList.add('vehicle-paired-hover');
    history[index]?.classList.add('vehicle-paired-hover');
    active=index;
  });
  split.addEventListener('mouseleave',clear);
}
function drawPolishVehiclePreview(){
  const {crews,parts}=PL_VEHICLE_TEST_PREVIEW;
  const crew=crews.find(c=>c.id===state.vehiclePreviewCrew)||crews[0];
  const history=PL_VEHICLE_TEST_HISTORY[crew.id]||[];
  const tab=state.vehicleTab;
  const tabs=vehicleViewTabs(tab);
  if(tab==='transfers'){
    $('tableArea').innerHTML='<div class="vehicle-setup vehicle-preview">'+tabs+
      vehicleDemoTransfersView()+'</div>';
    $('tableFooter').textContent='Podgląd transferów — dane przykładowe, bez zapisu D1';
    $('searchNote').classList.add('hidden');$('vehicleTopScroll').classList.add('hidden');
    return;
  }
  const summary=tab==='summary';
  const teamSelector=summary?'':('<div class="vehicle-preview-teams" aria-label="Wybierz samochód">'+
    crews.map(c=>'<button type="button" data-vehicle-crew="'+escapeHtml(c.id)+'" '+
      'class="vehicle-preview-team-btn'+(c.id===crew.id?' active':'')+'" '+
      'aria-pressed="'+String(c.id===crew.id)+'">'+
      '<span class="vehicle-team-caption">Ekipa</span>'+
      '<span class="vehicle-team-name">'+escapeHtml(c.team)+'</span>'+
      '<small>'+escapeHtml(c.plate)+'</small></button>').join('')+
    '</div>');
  const meta=summary?'':('<div class="vehicle-setup-meta">'+
    [['Ekipa',crew.team],['Tablica rejestracyjna',crew.plate],
     ['Inwentaryzacja',crew.frequency],
     ['Ostatnia inwentaryzacja',crew.inventory]].map(([key,value])=>
      '<div><span>'+escapeHtml(key)+'</span>'+
      '<div class="vehicle-preview-meta-value"><strong>'+escapeHtml(value)+'</strong>'+
      '</div></div>').join('')+
    '</div>');
  // Measure actual labels instead of allocating extra room by character count.
  // A one-line name stays visible without wasting horizontal space.
  const measure=document.createElement('canvas').getContext('2d');
  if(measure)measure.font='11px Inter, "Segoe UI", system-ui, sans-serif';
  const maxMeasured=Math.max(0,...parts.map(p=>measure
    ?measure.measureText(p.name).width:Array.from(p.name).length*6.2));
  const nameWidth=Math.max(210,Math.ceil(maxMeasured+22));
  // Indices shrink to the longest real value plus a small safety margin.
  // A longer SAP/GPBS number automatically makes only its column wider.
  const measureCode=(text)=>measure?measure.measureText(text).width:
    Array.from(String(text)).length*6.6;
  const gpbsWidth=Math.max(80,Math.ceil(
    Math.max(...parts.map(p=>measureCode(p.index||'')))+20));
  const sapWidth=Math.max(88,Math.ceil(
    Math.max(...parts.map(p=>measureCode(p.external||'')))+20));
  const minWidth=Math.max(46,Math.ceil(Math.max(measureCode('Stock'),measureCode('min.'))+12));
  const currentWidth=88;
  const inventoryWidth=88,selectedSubWidth=49;
  // Newest audit is permanently split into Suma / Różnica.
  // Opening any historical report must not modify visible table columns.
  const newestWidth=history.length?2*selectedSubWidth:0;
  const fixedWidth=gpbsWidth+sapWidth+minWidth+nameWidth+currentWidth;
  const historyWidth=newestWidth+Math.max(0,history.length-1)*inventoryWidth;
  const layout=' style="--vehicle-name-width:'+nameWidth+'px;'+
    '--vehicle-gpbs-width:'+gpbsWidth+'px;'+
    '--vehicle-sap-width:'+sapWidth+'px;'+
    '--vehicle-min-width:'+minWidth+'px;'+
    '--vehicle-current-width:'+currentWidth+'px;'+
    '--vehicle-inventory-width:'+inventoryWidth+'px;'+
    '--vehicle-fixed-width:'+fixedWidth+'px;'+
    '--vehicle-selected-sub-width:'+selectedSubWidth+'px;'+
    '--vehicle-history-rail-start:'+
      (fixedWidth+newestWidth)+'px;'+
    '--vehicle-table-width:'+(fixedWidth+historyWidth)+'px"';
  let table='';
  if(summary){
    // Compact fixed columns on the left; only the 14 crew columns scroll.
    const teams=PL_VEHICLE_SUMMARY_CREWS;
    const summarySapWidth=Math.max(78,Math.ceil(
      Math.max(...parts.map(p=>measureCode(p.external||'')))+11));
    const summaryMinWidth=46;
    const summaryNameWidth=Math.max(180,Math.ceil(maxMeasured+14));
    const summarySumWidth=52;
    const summaryCrewWidth=81;
    const summaryFixedWidth=summarySapWidth+summaryMinWidth+
      summaryNameWidth+summarySumWidth;
    const cols=width=>'<col style="width:'+width+'px">';
    const fixedCols='<colgroup>'+
      [summarySapWidth,summaryMinWidth,summaryNameWidth,summarySumWidth]
        .map(cols).join('')+'</colgroup>';
    const crewCols='<colgroup>'+teams.map(()=>cols(summaryCrewWidth))
      .join('')+'</colgroup>';
    const headFixed='<thead><tr>'+
      '<th>Indeks<br>SAP</th><th>Stock<br>min.</th>'+
      '<th>Nazwa części</th><th class="vehicle-preview-num">Suma</th>'+
      '</tr></thead>';
    const headCrews='<thead><tr>'+teams.map(team=>
      '<th class="vehicle-preview-column" title="Ekipa '+
        escapeHtml(team.team)+' · '+escapeHtml(team.plate)+
        ' · Ostatnia inwentaryzacja: '+escapeHtml(team.inventory)+'">'+
        '<div class="vehicle-preview-car-header"><strong>'+escapeHtml(team.team)+
        '</strong><small>'+escapeHtml(team.plate)+'</small>'+
        '<span>'+escapeHtml(team.inventory)+'</span></div></th>'
    ).join('')+'</tr></thead>';
    const fixedRows=parts.map((part,index)=>{
      const values=teams.map((team,i)=>vehicleSummaryStock(part,index,team,i));
      const total=values.reduce((a,b)=>a+b,0);
      return '<tr>'+
        '<td title="'+escapeHtml(part.external||'—')+'">'+
          escapeHtml(part.external||'—')+'</td>'+
        '<td class="vehicle-preview-num">'+quantity(part.required)+'</td>'+
        '<td class="vehicle-split-part-name" title="'+escapeHtml(part.name)+'">'+
          escapeHtml(part.name)+'</td>'+
        '<td class="vehicle-preview-num vehicle-preview-sum">'+
          quantity(total)+'</td></tr>';
    }).join('');
    const crewRows=parts.map((part,index)=>'<tr>'+teams.map((team,i)=>{
      const qty=vehicleSummaryStock(part,index,team,i);
      const missing=qty<part.required;
      return '<td class="vehicle-preview-num'+
        (missing?' vehicle-summary-shortage':'')+'" title="'+
        escapeHtml(team.team)+': '+qty+' szt.'+
        (missing?' · brakuje '+(part.required-qty)+' szt.':'')+'">'+
        quantity(qty)+'</td>';
    }).join('')+'</tr>').join('');
    const fixedTable='<table class="table vehicle-split-fixed-table" style="width:'+
      summaryFixedWidth+'px">'+fixedCols+headFixed+
      '<tbody>'+fixedRows+'</tbody></table>';
    const teamTable='<table class="table vehicle-split-history-table" style="width:'+
      (teams.length*summaryCrewWidth)+'px">'+crewCols+headCrews+
      '<tbody>'+crewRows+'</tbody></table>';
    const rail='<div class="vehicle-history-scrollbar" role="region" tabindex="0" '+
      'aria-label="Przewijanie kolumn ekip w zestawieniu zbiorczym">'+
      '<div class="vehicle-history-scrollbar-track"></div></div>';
    table='<div class="vehicle-preview-split-table vehicle-summary-split">'+
      '<div class="vehicle-split-fixed" style="width:'+summaryFixedWidth+'px">'+
        fixedTable+'</div>'+
      '<div class="vehicle-split-history">'+rail+
        '<div class="vehicle-history-table-wrap">'+teamTable+'</div></div>'+
      '</div>';
  }else{
    // Fixed left pane: part indexes, stock and the newest inventory.
    // Only the separate right-hand table with older audits can scroll.
    const newest=history[0]||null;
    const past=history.slice(1);
    const pastWidth=past.length*inventoryWidth;
    const subhead='<div class="vehicle-split-subhead"><span>SUMA</span><span>Różnica</span></div>';
    const col=(width)=>'<col style="width:'+width+'px">';
    const fixedCols='<colgroup>'+
      [gpbsWidth,sapWidth,minWidth,nameWidth,currentWidth,
       ...(newest?[selectedSubWidth,selectedSubWidth]:[])]
      .map(col).join('')+'</colgroup>';
    const fixedHead='<thead><tr>'+
      '<th>Indeks GPBS</th><th>Indeks SAP</th>'+
      '<th>Stock<br>min.</th><th>Nazwa części</th><th>Aktualny<br>stan</th>'+
      (newest?'<th class="vehicle-split-newest-head" colspan="2">'+
        vehicleInventoryButton(newest,0)+subhead+'</th>':'')+'</tr></thead>';
    const fixedBody=parts.map((p,index)=>{
      const stock=vehicleDemoStockFor(p,index,crew.id),shortage=stock.current<p.required;
      let latestCells='';
      if(newest){
        const sum=newest.counts[index];
        const before=newest.before[index];
        const d=sum==null||before==null?null:sum-before;
        const diff=d==null?'—':d>0?'+'+d:String(d);
        const color=d>0?' is-positive':d<0?' is-negative':'';
        latestCells='<td class="vehicle-preview-num">'+quantity(sum)+'</td>'+
          '<td class="vehicle-preview-num vehicle-preview-difference'+color+'">'+
          escapeHtml(diff)+'</td>';
      }
      return '<tr>'+
        '<td>'+escapeHtml(p.index)+'</td>'+
        '<td>'+escapeHtml(p.external||'—')+'</td>'+
        '<td class="vehicle-preview-num">'+quantity(p.required)+'</td>'+
        '<td class="vehicle-split-part-name" title="'+escapeHtml(p.name)+'">'+
          escapeHtml(p.name)+'</td>'+
        '<td class="vehicle-preview-num vehicle-preview-current'+
          (shortage?' vehicle-preview-shortage':'')+'">'+
          '<div class="vehicle-current-compact">'+
            '<strong>'+quantity(stock.current)+'</strong>'+
            (shortage?'<small>Brakuje '+escapeHtml(p.required-stock.current)+'</small>':'')+
          '</div>'+
        '</td>'+latestCells+'</tr>';
    }).join('');
    const fixedTable='<table class="table vehicle-split-fixed-table" style="width:'+
      (fixedWidth+newestWidth)+'px">'+fixedCols+fixedHead+
      '<tbody>'+fixedBody+'</tbody></table>';
    // Older audits stay single-column: detail/differences live in their reports.
    const pastCols='<colgroup>'+past.map(()=>col(inventoryWidth))
      .join('')+'</colgroup>';
    const pastHead='<thead><tr>'+past.map((h,i)=>
      '<th>'+vehicleInventoryButton(h,i+1)+'</th>'
    ).join('')+'</tr></thead>';
    const pastBody=parts.map((p,index)=>'<tr>'+past.map(h=>
      '<td class="vehicle-preview-num">'+quantity(h.counts[index])+'</td>'
    ).join('')+'</tr>').join('');
    const pastTable='<table class="table vehicle-split-history-table" style="width:'+
      Math.max(1,pastWidth)+'px">'+pastCols+pastHead+
      '<tbody>'+pastBody+'</tbody></table>';
    const rail='<div class="vehicle-history-scrollbar" role="region" tabindex="0" '+
      'aria-label="Przewijanie starszych inwentaryzacji">'+
      '<div class="vehicle-history-scrollbar-track"></div></div>';
    table='<div class="vehicle-preview-split-table">'+
      '<div class="vehicle-split-fixed" style="width:'+(fixedWidth+newestWidth)+'px">'+
        fixedTable+'</div>'+
      '<div class="vehicle-split-history">'+rail+
        '<div class="vehicle-history-table-wrap">'+pastTable+'</div></div>'+
      '</div>';
  }
  $('tableArea').innerHTML='<div class="vehicle-setup vehicle-preview"'+layout+'>'+
    tabs+teamSelector+meta+table+'</div>';
  $('tableFooter').textContent=summary
    ?'Dane fikcyjne · '+PL_VEHICLE_SUMMARY_CREWS.length+
      ' ekip · '+parts.length+' przykładowych części'
    :'Podgląd · '+crew.team+' · '+crew.plate+' · '+parts.length+
      ' części · '+history.length+' przykładowych inwentaryzacji';
  $('searchNote').classList.add('hidden');
  $('vehicleTopScroll').classList.add('hidden');
  setupVehiclePairedRowHover();
  requestAnimationFrame(setupVehicleHistoryRail);
}
function openVehicleInventoryReport(report){
  if(!report||!Array.isArray(report.items))return;
  state.vehicleReportContext=report;
  const modal=$('modal'),body=$('modalBody');
  modal.querySelector('.modal-card').classList.remove('part-detail-card');
  modal.querySelector('.modal-card').classList.add('vehicle-history-card');
  const rows=report.items.map((item,index)=>{
    const diff=item.difference;
    const sign=diff===null||diff===undefined?'—':diff>0?'+'+diff:String(diff);
    const color=diff>0?' is-positive':diff<0?' is-negative':'';
    const moves=Array.isArray(item.movements)?item.movements:[];
    const toggle=moves.length?'<button type="button" class="vehicle-report-expand" '+
      'data-vehicle-report-expand="'+index+'" aria-expanded="false" '+
      'title="Pokaż ruchy tej części w okresie inwentaryzacji">'+
      '<span class="vehicle-report-expand-icon" aria-hidden="true">⌄</span> '+
      'Ruchy <strong>'+moves.length+'</strong></button>':'';
    const normal='<tr><td>'+escapeHtml(item.index||'—')+'</td>'+
      '<td>'+escapeHtml(item.sap||'—')+'</td>'+
      '<td class="vehicle-preview-part-name"><div class="vehicle-report-part-line">'+
        '<span class="vehicle-report-part-label" title="'+escapeHtml(item.name||'—')+'">'+
          escapeHtml(item.name||'—')+'</span>'+toggle+'</div></td>'+
      '<td class="vehicle-preview-num">'+quantity(item.before)+'</td>'+
      '<td class="vehicle-preview-num">'+quantity(item.counted)+'</td>'+
      '<td class="vehicle-preview-num vehicle-preview-difference'+color+'">'+
        escapeHtml(sign)+'</td></tr>';
    if(!moves.length)return normal;
    const detail='<tr class="vehicle-report-movement-row hidden" '+
      'data-vehicle-report-detail="'+index+'"><td colspan="6">'+
      '<div class="vehicle-report-movement-list">'+moves.map(move=>
        '<div class="vehicle-report-movement'+escapeHtml(move.statusClass||'')+'">'+
          '<div class="vehicle-report-movement-info">'+
            '<strong>'+escapeHtml(move.date)+' · '+escapeHtml(move.time)+
            ' · '+escapeHtml(move.description)+'</strong>'+
            '<small>'+escapeHtml(move.status||'Zapisano')+
            (move.actor?' · '+escapeHtml(move.actor):'')+'</small>'+
          '</div>'+
          '<span>'+escapeHtml(move.quantity)+' szt.</span>'+
        '</div>').join('')+'</div></td></tr>';
    return normal+detail;
  }).join('');
  const field=(label,value)=>'<div><span>'+escapeHtml(label)+'</span>'+
    '<strong>'+escapeHtml(value||'—')+'</strong></div>';
  const totalDiff=report.items.reduce((totals,item)=>{
    if(item.difference>0)totals.plus++;
    else if(item.difference<0)totals.minus++;
    return totals;
  },{plus:0,minus:0});
  const movesCount=report.items.reduce((n,item)=>n+(item.movements?.length||0),0);
  body.innerHTML=
    '<div class="vehicle-report-heading">'+
      '<div class="vehicle-history-top">'+
        '<span class="vehicle-report-eyebrow">GPBS STORAGE / RAPORT</span>'+
        '<h2 id="modalTitle">Raport inwentaryzacji samochodu</h2>'+
      '</div>'+
      '<div class="vehicle-report-actions" role="group" aria-label="Eksport i drukowanie raportu">'+
        '<button type="button" class="btn dark" data-vehicle-report-excel="1">Eksport do Excela</button>'+
        '<button type="button" class="btn subtle" data-vehicle-report-print="1">Drukuj</button>'+
      '</div>'+
    '</div>'+
    '<div class="vehicle-report-meta">'+
      '<div class="vehicle-report-date-time">'+
        '<div><span>Data</span><strong>'+escapeHtml(report.date||'—')+'</strong></div>'+
        '<div><span>Godzina</span><strong>'+escapeHtml(report.time||'—')+'</strong></div>'+
      '</div>'+
      field('Ekipa',report.team)+field('Tablica rejestracyjna',report.plate)+
      field('Inwentaryzację wykonał',report.by)+
    '</div>'+
    (report.note?'<p class="vehicle-report-general-note"><strong>Komentarz:</strong> '+
      escapeHtml(report.note)+'</p>':'')+
    '<div class="vehicle-report-section-heading">'+
      '<strong>Porównanie stanów części</strong>'+
      '<span>Pozycji: '+report.items.length+
        ' · Nadwyżki: '+totalDiff.plus+' · Niedobory: '+totalDiff.minus+'</span>'+
    '</div>'+
    (movesCount?'<p class="vehicle-report-period">Ruchy części od poprzedniej inwentaryzacji'+
      (report.periodStart?' ('+escapeHtml(report.periodStart)+'–'+escapeHtml(report.date)+')':'')+
      ' — kliknij „ruchy” pod wybraną częścią. Na wydruku pokażą się wszystkie.</p>':'')+
    '<div class="vehicle-history-table-wrap">'+
      '<table class="table vehicle-preview-history-table">'+
        '<thead><tr><th>Indeks GPBS</th><th>Indeks SAP</th><th>Nazwa części</th>'+
        '<th class="vehicle-preview-num">Stan przed</th>'+
        '<th class="vehicle-preview-num">Policzono</th>'+
        '<th class="vehicle-preview-num">Różnica</th></tr></thead>'+
        '<tbody>'+rows+'</tbody></table>'+
    '</div>'+
    (report.preview?'<p class="vehicle-history-note">Dane fikcyjne do oceny wyglądu. '+
      'Nie pochodzą z inwentaryzacji ani z bazy D1.</p>':'')+
    '<p id="vehicleReportActionError" class="vehicle-report-error hidden" role="alert"></p>';
  modal.classList.remove('hidden');
  $('modalClose').focus();
}
function openPolishVehicleInventory(index){
  if(state.view!=='vehicles'||state.preview||
     realWarehouse(state.warehouse)?.country_code!=='PL')return;
  const {crews,parts}=PL_VEHICLE_TEST_PREVIEW;
  const crew=crews.find(c=>c.id===state.vehiclePreviewCrew)||crews[0];
  const h=(PL_VEHICLE_TEST_HISTORY[crew.id]||[])[index];
  if(!h)return;
  const previous=(PL_VEHICLE_TEST_HISTORY[crew.id]||[])[index+1]?.date||'';
  const moves=vehicleDemoMovementsFor(crew.id,h.date,previous);
  const items=parts.map((p,i)=>{
    const before=h.before[i],counted=h.counts[i];
    const partMoves=moves.flatMap(move=>
      move.items.filter(line=>line.i===i).map(line=>({
        id:move.id,kind:move.kind,date:move.date,time:move.time,
        description:vehicleDemoMoveLabel(move,crew.id),status:vehicleDemoStatusText(move),
        statusClass:vehicleDemoStatusClass(move),quantity:line.qty,
        machine:move.machine||'',actor:move.actor||''
      })));
    return {index:p.index,sap:p.external,name:p.name,
      before,counted,movements:partMoves,
      difference:before==null||counted==null?null:counted-before};
  });
  openVehicleInventoryReport({
    date:h.date,time:h.time,team:crew.team,plate:crew.plate,by:h.by,
    items,periodStart:previous,note:h.note||'',preview:true
  });
}
function downloadVehicleInventoryReport(){
  if(!state.vehicleReportContext)return;
  try{
    if(!window.GPBSVehicleReportExport)
      throw Error('Eksport Excel jest chwilowo niedostępny. Odśwież stronę.');
    window.GPBSVehicleReportExport.download(state.vehicleReportContext);
  }catch(error){
    const field=$('vehicleReportActionError');
    if(field){
      field.textContent=error?.message||'Nie udało się przygotować pliku Excel.';
      field.classList.remove('hidden');
    }
  }
}
function clearVehicleInventoryPrintStyle(){
  document.body.classList.remove('vehicle-inventory-print-active');
  document.getElementById('vehicleReportPrintPage')?.remove();
}
function printVehicleInventoryReport(){
  if(!state.vehicleReportContext||$('modal').classList.contains('hidden'))return;
  clearVehicleInventoryPrintStyle();
  const sheet=document.createElement('style');
  sheet.id='vehicleReportPrintPage';
  sheet.textContent='@page { size: A4 portrait; margin: 10mm; }';
  document.head.append(sheet);
  document.body.classList.add('vehicle-inventory-print-active');
  try{window.print();}
  catch(error){
    clearVehicleInventoryPrintStyle();
    const field=$('vehicleReportActionError');
    if(field){
      field.textContent='Nie udało się otworzyć okna drukowania.';
      field.classList.remove('hidden');
    }
  }
}
function drawFrenchVehicleCatalogue(parts){
  // Reference list only. The Office crew balances will be supplied by D1
  // vehicle inventories later; do NOT convert requirements into stock counts.
  const tabs=vehicleViewTabs(state.vehicleTab);
  const rows=parts.map(p=>'<tr>'+
    '<td>'+escapeHtml(p.part_number||'—')+'</td>'+
    '<td>'+escapeHtml(p.source_sap&&p.source_sap!=='-'?p.source_sap:'—')+'</td>'+
    '<td class="vehicle-split-part-name">'+escapeHtml(p.name||'—')+'</td>'+
    '<td class="vehicle-preview-num">'+
      (p.required_quantity==null?'—':escapeHtml(p.required_quantity))+'</td>'+
    '<td>'+escapeHtml(!p.part_found?'Do dopasowania':
      !p.index_assigned?'Brak indeksu MG':'W katalogu')+'</td></tr>').join('');
  const matched=parts.filter(p=>p.part_found).length;
  const info='<div class="vehicle-catalogue-info">'+
    '<strong>Wyposażenie samochodów — katalog części</strong>'+
    '<span>Lista wymaganych części, bez stanów samochodowych. '+
      matched+' z '+parts.length+' pozycji powiązano z katalogiem GPBS.</span>'+
    '</div>';
  const table='<div class="vehicle-setup-table-wrap">'+
    '<table class="table vehicle-setup-table vehicle-catalogue-live">'+
      '<thead><tr><th>Indeks GPBS</th><th>Indeks SAP</th>'+
        '<th>Nazwa części</th><th class="vehicle-preview-num">Wymagane / auto</th>'+
        '<th>Status</th></tr></thead>'+
      '<tbody>'+rows+'</tbody></table></div>';
  $('tableArea').innerHTML='<div class="vehicle-setup vehicle-preview">'+
    tabs+info+table+'</div>';
  $('tableFooter').textContent='Katalog samochodowy: '+parts.length+
    ' pozycji. Zmiany nazw i indeksów są pobierane z głównego katalogu D1.';
  $('searchNote').classList.add('hidden');
  $('vehicleTopScroll').classList.add('hidden');
}
function drawVehicles(){
  // Temporary example remains only in Poland. The French UI stays empty.
  if(!state.preview&&realWarehouse(state.warehouse)?.country_code==='PL'){
    drawPolishVehiclePreview();return;
  }
  const tab=state.vehicleTab;
  const tabs=vehicleViewTabs(tab);
  if(tab==='transfers'){
    $('tableArea').innerHTML='<div class="vehicle-setup">'+tabs+
      fleetTransfersPlaceholder()+'</div>';
    $('tableFooter').textContent='Transfery — funkcja do przygotowania';
    $('searchNote').classList.add('hidden');$('vehicleTopScroll').classList.add('hidden');
    return;
  }
  const summary=tab==='summary';
  const meta=summary?'':(
    '<div class="vehicle-setup-meta">'+
    [['Ekipa','—'],['Tablica rejestracyjna','—'],
     ['Inwentaryzacja','—'],['Ostatnia inwentaryzacja','—']]
      .map(([label,value])=>'<div><span>'+label+'</span>'+
        '<strong>'+value+'</strong></div>').join('')+'</div>');
  const headers=summary?[
    {label:'Indeks GPBS'},{label:'Indeks SAP'},{label:'Stock min.',numeric:true},
    {label:'Nazwa części'},{label:'Suma',numeric:true}
  ]:[
    {label:'Indeks GPBS'},{label:'Indeks SAP'},{label:'Stock min.',numeric:true},
    {label:'Nazwa części'},{label:'Aktualny stan',numeric:true},
    {label:'Ostatnia inwentaryzacja',numeric:true}
  ];
  const message=summary
    ?'Brak samochodów w ewidencji. Po dodaniu ekip pojawią się kolumny z ich stanami oraz suma.'
    :'Brak samochodów w ewidencji. Po pierwszej inwentaryzacji pojawią się tu stany i historia.';
  const empty='<tr><td colspan="'+headers.length+'" class="vehicle-setup-empty">'+
    escapeHtml(message)+'</td></tr>';
  $('tableArea').innerHTML='<div class="vehicle-setup">'+tabs+meta+
    '<div class="vehicle-setup-table-wrap">'+wrapTable(headers,empty,'vehicle-setup-table')+
    '</div></div>';
  $('tableFooter').textContent='Ewidencja samochodowa nie jest jeszcze podłączona do D1';
  $('searchNote').classList.add('hidden');
  $('vehicleTopScroll').classList.add('hidden');
}

function drawFrenchEmptyView(){
  const view=state.view;
  const headers={
    pz:[{label:'Data'},{label:'Tydz.'},{label:'Dostawca / Ekipa'},
      {label:'Przyjmował'},{label:''}],
    wz:[{label:'Data'},{label:'Tydz.'},{label:'Odbiorca'},
      {label:'Wydawał'},{label:''}],
    nok:[{label:'Indeks SAP'},{label:'Nazwa części'},
      {label:'Indeks magazynowy'},{label:'Stan NOK',numeric:true}],
    inventories:[{label:'Data'},{label:'Tydz.'},{label:'Liczył'},
      {label:'Pozycji',numeric:true},{label:''}],
    vehicles:[{label:'Indeks SAP'},{label:'Nazwa części'}],
    labels:[{label:'Nazwa części'},{label:'Indeks GPBS'},
      {label:'Ostatni wydruk'},{label:'Do wydruku'}]
  }[view]||[{label:'Nazwa'},{label:'Stan',numeric:true}];
  const message=view==='vehicles'
    ?'Brak danych. Stany samochodowe będą widoczne po pierwszej inwentaryzacji samochodów.'
    :'Brak danych.';
  errorBanner('');
  $('tableArea').innerHTML=wrapTable(headers,
    '<tr><td colspan="'+headers.length+'" class="office-fr-empty-cell">'+
      escapeHtml(message)+'</td></tr>','office-fr-empty-table');
  $('tableFooter').textContent='';
  $('searchNote').classList.add('hidden');
  $('vehicleTopScroll').classList.add('hidden');
}
async function render(){
  if(state.view==='vehicles'){
    errorBanner('');
    if(state.preview?.type==='operation'&&state.preview.key==='vehicles'&&
       state.vehicleTab==='detail'){
      const ticket=++state.requestId;
      try{
        const response=await api('vehicleCatalog');
        if(ticket!==state.requestId)return;
        drawFrenchVehicleCatalogue(response.parts||[]);
      }catch(ex){
        if(ticket!==state.requestId)return;
        errorBanner(ex.message||'Nie udało się pobrać katalogu samochodowego.');
        drawVehicles();
        if(ex.status===401)showLogin('Sesja wygasła. Zaloguj się ponownie.');
      }
    }else drawVehicles();
    return;
  }
  if(state.preview?.type==='operation'||state.preview?.type==='module'){
    drawFrenchEmptyView();return;
  }
  if(state.view==='preview')return;
  if(state.preview?.type==='warehouse'&&state.view==='stocks'){
    errorBanner('');
    if(state.stockTab==='modules'){
      $('tableArea').innerHTML='<div class="empty">Brak danych.</div>';
      $('tableFooter').textContent='';
      return;
    }
    const ticket=++state.requestId;
    const cacheKey='FR-COMMON-CATALOG';
    try{
      if(!state.partsCache.has(cacheKey)){
        setLoading();
        const response=await api('frCatalog');
        if(ticket!==state.requestId)return;
        state.partsCache.set(cacheKey,response.parts||[]);
      }
      if(ticket!==state.requestId)return;
      drawStocks(state.partsCache.get(cacheKey)||[],null);
      markSynced();
    }catch(ex){
      if(ticket!==state.requestId)return;
      errorBanner(ex.message||'Nie można pobrać katalogu części.');
      $('tableArea').innerHTML='<div class="empty">Brak danych.</div>';
      $('tableFooter').textContent='';
      if(ex.status===401)showLogin('Sesja wygasła. Zaloguj się ponownie.');
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
      }else if(state.stockTab==='nok'){
        const payload=await api('nokStock',params);
        if(ticket!==state.requestId)return;
        state.nokParts=payload.parts||[];
        drawNokStock();
      }else{
      const parts=await loadStocks(state.warehouse);
      if(ticket!==state.requestId)return;drawStocks(parts,state.warehouse);
      }
    }else if(state.view==='aggregate'){
      const scoped=state.warehouses.filter(w=>w.country_code==='FR');
      // The FR comparison always lists all planned locations.
      // Only stores actually granted to the signed-in user are queried.
      const named=FR_LAYOUT_WAREHOUSES.map(location=>{
        const matched=scoped.find(w=>matchesFrenchWarehouse(w,location));
        return {id:matched?.id||null,name:location.name,source:matched||null};
      });
      const used=new Set(named.filter(x=>x.id).map(x=>x.id));
      const columns=[
        ...named,
        ...scoped.filter(w=>!used.has(w.id)).map(w=>({id:w.id,name:w.name,source:w}))
      ];
      // Missing warehouse inventory must not hide shared catalogue entries.
      // The same part list is used for all unconnected locations, with unknown quantities.
      let sharedParts=[];
      if(columns.some(col=>!col.source)&&state.user?.role==='ADMIN'&&
         String(state.user?.nickname||'').trim().toUpperCase()==='JJ'){
        const cacheKey='FR-COMMON-CATALOG';
        if(!state.partsCache.has(cacheKey)){
          const response=await api('frCatalog');
          if(ticket!==state.requestId)return;
          state.partsCache.set(cacheKey,response.parts||[]);
        }
        sharedParts=state.partsCache.get(cacheKey)||[];
      }
      const loaded=await Promise.all(columns.map(async col=>({
        id:col.id,name:col.name,parts:col.source?await loadStocks(col.id):sharedParts,
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
  if(state.view==='vehicles'){drawVehicles();return;}
  if(state.preview?.type==='operation'||state.preview?.type==='module'){
    drawFrenchEmptyView();return;
  }
  if(state.preview?.type==='warehouse'&&state.view==='stocks'){
    if(state.stockTab==='modules')render();
    else drawStocks(state.partsCache.get('FR-COMMON-CATALOG')||[],null);
    return;
  }
  if(state.view==='stocks'){
    if(state.stockTab==='modules')drawModules();
    else if(state.stockTab==='nok')drawNokStock();
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
    const virtualFrench=state.preview?.type==='warehouse';
    const payload=virtualFrench
      ?await api('frCatalog',{part:id})
      :await api('part',{warehouse,part:id});
    if(modal.classList.contains('hidden'))return;
    const p=payload.part;
    state.labelPart=p;
    const amount=p.quantity;
    const uploadedPhoto=Boolean(Number(p.has_photo));
    const photoSrc=virtualFrench
      ?'/api/office?view=frCatalogPhoto&part='+encodeURIComponent(p.id)
      :'/api/office?view=partPhoto&warehouse='+encodeURIComponent(warehouse)+
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
          '<div class="part-stock-block"><small>AKTUALNY STAN</small><strong>'+quantity(amount)+
            (amount===null||amount===undefined?'':' <span>szt.</span>')+'</strong></div>'+
          '<div class="part-meta-item"><small>Identyfikator magazynowy</small><strong>'+escapeHtml(p.part_number||'—')+'</strong></div>'+
          (virtualFrench?'':(
            '<div class="part-meta-item"><small>Ostatnia dostawa</small><strong>'+dateText(payload.delivery?.date)+'</strong><p>'+deliveryQuantity+'</p></div>'+
            '<div class="part-meta-item"><small>Ostatnia inwentaryzacja</small><strong>'+dateText(payload.inventory?.date)+'</strong></div>'
          ))+
        '</div>'+
      '</div>'+
      (virtualFrench?'':'<div class="modal-actions">'+
        '<button type="button" class="btn dark" data-label-add-current="1">Drukuj etykietę</button>'+
      '</div>');
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
  state.vehicleReportContext=null;
  clearVehicleInventoryPrintStyle();
  if(!$('photoViewer').classList.contains('hidden'))closePhotoViewer();
  $('modal').classList.add('hidden');
  $('modal').querySelector('.modal-card').classList.remove('part-detail-card','vehicle-history-card');
  $('modalBody').innerHTML='';
}
document.addEventListener('click',e=>{
  if(e.target.closest('[data-vehicle-report-excel]')){
    downloadVehicleInventoryReport();
    return;
  }
  if(e.target.closest('[data-vehicle-report-print]')){
    printVehicleInventoryReport();
    return;
  }
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
  const demoApproval=e.target.closest('[data-vehicle-demo-approve]');
  if(demoApproval&&state.view==='vehicles'&&!state.preview&&
     realWarehouse(state.warehouse)?.country_code==='PL'){
    const rights=['ADMIN','KIEROWNIK','KOORDYNATOR'];
    if(!rights.includes(state.user?.role))return;
    const movement=PL_VEHICLE_DEMO_MOVEMENTS.find(t=>
      t.id===demoApproval.dataset.vehicleDemoApprove&&t.kind==='transfer'&&
      t.status==='pending');
    if(!movement||vehicleDemoTransferStatus(movement)!=='pending')return;
    if(!window.confirm('To jest wyłącznie symulacja. Zatwierdzić fikcyjny transfer '+
        movement.id+'? Rzeczywiste stany D1 nie ulegną zmianie.'))return;
    const roleNames={ADMIN:'Administrator',KIEROWNIK:'Kierownik',KOORDYNATOR:'Koordynator'};
    vehicleDemoApprovals.set(movement.id,{status:'approved',
      role:roleNames[state.user.role],by:state.user.nickname||state.user.firstName||'Office'});
    drawVehicles();
    return;
  }
  const reportExpand=e.target.closest('[data-vehicle-report-expand]');
  if(reportExpand&&!$('modal').classList.contains('hidden')){
    const detail=$('modalBody').querySelector(
      '[data-vehicle-report-detail="'+reportExpand.dataset.vehicleReportExpand+'"]');
    if(detail){
      const expanded=detail.classList.toggle('hidden')===false;
      reportExpand.setAttribute('aria-expanded',String(expanded));
      reportExpand.querySelector('.vehicle-report-expand-icon').textContent=expanded?'⌃':'⌄';
    }
    return;
  }
  const vehicleTab=e.target.closest('[data-vehicle-tab]');
  if(vehicleTab&&state.view==='vehicles'){
    const next=vehicleTab.dataset.vehicleTab;
    if(next==='detail'||next==='summary'||next==='transfers'){
      state.vehicleTab=next;
      if(state.preview?.type==='operation'&&state.preview.key==='vehicles')
        render();
      else drawVehicles();
    }
    return;
  }
  const inventoryButton=e.target.closest('[data-vehicle-inventory-index]');
  if(inventoryButton&&state.view==='vehicles'){
    const index=Number(inventoryButton.dataset.vehicleInventoryIndex);
    if(Number.isInteger(index)&&index>=0){
      // Opening a report does not shift Suma/Różnica or reset scroll position.
      openPolishVehicleInventory(index);
    }
    return;
  }
  const vehicleCrew=e.target.closest('[data-vehicle-crew]');
  if(vehicleCrew&&state.view==='vehicles'&&!state.preview&&
     realWarehouse(state.warehouse)?.country_code==='PL'){
    const id=vehicleCrew.dataset.vehicleCrew;
    if(PL_VEHICLE_TEST_PREVIEW.crews.some(c=>c.id===id)){
      state.vehiclePreviewCrew=id;state.vehicleSelectedInventory=0;drawVehicles();
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
  const bovisToggle=e.target.closest('[data-bovis-toggle]');
  if(bovisToggle){
    state.bovisExpanded=!state.bovisExpanded;
    state.frExpanded=null;
    renderMenu();
    return;
  }
  const frStock=e.target.closest('[data-fr-stock]');
  if(frStock){
    const key=frStock.dataset.frStock;
    const realId=frStock.dataset.frRealId;
    state.frExpanded=key;state.bovisExpanded=false;state.warehouseMenus.FR=true;
    if(realId&&realWarehouse(realId)?.country_code==='FR'){
      selectView('stocks',realId);
    }else{
      showOfficePreview('warehouse',key,frStock.dataset.frWarehouseName);
    }
    return;
  }
  const frWarehouse=e.target.closest('[data-fr-warehouse-toggle]');
  if(frWarehouse){
    const key=frWarehouse.dataset.frWarehouseToggle;
    if(state.frExpanded===key){
      state.frExpanded=null;
      renderMenu();
    }else{
      state.frExpanded=key;
      state.bovisExpanded=false;
      const realId=frWarehouse.dataset.frRealId;
      if(realId)selectView('stocks',realId);
      else showOfficePreview('warehouse',key,frWarehouse.dataset.frWarehouseName);
    }
    return;
  }
  const w=e.target.closest('[data-warehouse]');
  if(w){
    state.frExpanded=null;
    if(!w.closest('.office-bovis-entries'))state.bovisExpanded=false;
    selectView('stocks',w.dataset.warehouse);return;
  }
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
    state.frExpanded=null;state.bovisExpanded=false;
    state.aggregateMarket='FR';
    state.warehouseMenus.FR=true;
    selectView('aggregate');
    return;
  }
  const marketVehicles=e.target.closest('[data-market-vehicles]');
  if(marketVehicles){
    const market=marketVehicles.dataset.marketVehicles;
    state.frExpanded=null;state.bovisExpanded=false;
    if(market==='FR'){
      state.warehouseMenus.FR=true;
      showOfficePreview('operation','vehicles',OFFICE_OPERATION_PREVIEWS.vehicles);
    }else if(market==='PL'){
      const preferred=realWarehouse(state.warehouse)?.country_code==='PL'
        ?state.warehouse:state.warehouses.find(w=>w.country_code==='PL')?.id;
      if(!preferred){errorBanner('Nie masz przypisanego magazynu PL.');return;}
      state.warehouseMenus.PL=true;
      selectView('vehicles',preferred);
    }
    return;
  }
  const preview=e.target.closest('[data-preview-warehouse]');
  if(preview){
    state.frExpanded=null;
    if(!preview.closest('.office-bovis-entries'))state.bovisExpanded=false;
    const item=FR_LAYOUT_WAREHOUSES.find(x=>x.key===preview.dataset.previewWarehouse);
    if(item)showOfficePreview('warehouse',item.key,item.name);
    return;
  }
  const frOperation=e.target.closest('[data-fr-operation][data-view]');
  if(frOperation){
    const key=frOperation.dataset.frOperation;
    const view=frOperation.dataset.view;
    if(!OFFICE_MARKET_OPERATIONS.some(op=>op.view===view))return;
    state.frExpanded=key;state.bovisExpanded=false;
    const realId=frOperation.dataset.frRealId;
    if(realId&&realWarehouse(realId)?.country_code==='FR')state.warehouse=realId;
    showOfficePreview('operation',view,OFFICE_OPERATION_PREVIEWS[view],{
      warehouseKey:key,warehouseName:frOperation.dataset.frWarehouseName
    });
    return;
  }
  const service=e.target.closest('[data-belleville-service]');
  if(service){
    state.frExpanded='belleville';state.bovisExpanded=false;
    showOfficePreview('module',BELLEVILLE_SERVICE.key,BELLEVILLE_SERVICE.name,{
      warehouseKey:'belleville',warehouseName:service.dataset.frWarehouseName||'Belleville'
    });
    return;
  }
  const module=e.target.closest('[data-fr-module]');
  if(module){
    state.frExpanded=null;state.bovisExpanded=false;
    if(module.dataset.frModule===FR_EQUIPMENT.key)
      showOfficePreview('module',FR_EQUIPMENT.key,FR_EQUIPMENT.name);
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
window.addEventListener('afterprint',clearVehicleInventoryPrintStyle);
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
  if(state.preview?.type==='operation'||state.preview?.type==='module'){
    render();return;
  }
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
