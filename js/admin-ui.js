import { loadState } from './storage.js';
import './install.js';

function normalizeRoleLabel(value) {
  const role = String(value || '').trim().toUpperCase();
  if (role === 'KIEROWNIK') return 'KOORDYNATOR';
  return role;
}

function ensureVehiclePartsButton() {
  const grid = document.querySelector('#screenVisit .action-grid');
  if (!grid) return null;

  let button = document.getElementById('vehiclePartsBtn');
  if (button) return button;

  button = document.createElement('button');
  button.id = 'vehiclePartsBtn';
  button.className = 'btn btn-secondary vehicle-visit-btn hidden';
  button.type = 'button';

  const kicker = document.createElement('span');
  kicker.className = 'hidden';
  kicker.textContent = 'AUTO';

  const title = document.createElement('span');
  title.textContent = 'Stan auta';

  button.append(kicker, title);

  grid.insertAdjacentElement('afterend', button);

  return button;
}

function normalizeWarehouse(item) {
  if (!item || typeof item !== 'object') return null;

  const nazwa = String(item.nazwa ?? item.Nazwa ?? item.name ?? '').trim();
  const kod = String(
    item.kod ??
    item.kodQr ??
    item.KOD ??
    item.kodMagazynu ??
    item.code ??
    ''
  ).trim().toUpperCase();
  const id = String(item.id ?? item.ID ?? item.idMagazynu ?? '').trim();
  const rawActive = item.aktywny ?? item.Aktywny ?? item.active ?? true;
  const activeText = String(rawActive).trim().toUpperCase();
  const aktywny = rawActive === true || ['TAK', 'TRUE', '1', 'AKTYWNY'].includes(activeText);

  if (!nazwa || !id || !aktywny) return null;
  return { id, nazwa, kod, aktywny: true };
}

function getAdminWarehouses(saved) {
  const liveWarehouses = Array.isArray(saved?.startData?.magazyny)
    ? saved.startData.magazyny.map(normalizeWarehouse).filter(Boolean)
    : [];

  const unique = new Map();

  for (const warehouse of liveWarehouses) {
    unique.set(warehouse.id || warehouse.kod || warehouse.nazwa, warehouse);
  }

  return Array.from(unique.values()).sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl'));
}

function ensureAdminWarehousePicker() {
  const scanArea = document.querySelector('#screenWarehouse .warehouse-scan-area');
  if (!scanArea) return null;

  let picker = document.getElementById('adminWarehousePicker');
  if (picker) return picker;

  picker = document.createElement('div');
  picker.id = 'adminWarehousePicker';
  picker.className = 'admin-warehouse-picker hidden';
  picker.style.width = '100%';
  picker.style.maxWidth = '520px';
  picker.style.margin = '0 auto';

  const title = document.createElement('h2');
  title.className = 'admin-warehouse-title';
  title.textContent = 'Wybierz magazyn';
  title.style.margin = '0 0 20px';
  title.style.fontSize = '26px';
  title.style.lineHeight = '1.15';

  const list = document.createElement('div');
  list.id = 'adminWarehouseList';
  list.className = 'admin-warehouse-list';
  list.style.display = 'grid';
  list.style.gap = '9px';
  list.style.maxHeight = 'min(42dvh, 340px)';
  list.style.overflowY = 'auto';
  list.style.padding = '1px 2px';
  list.style.overscrollBehavior = 'contain';

  picker.append(title, list);
  scanArea.prepend(picker);

  return picker;
}

function startWarehouseFromPicker(code) {
  const input = document.getElementById('warehouseCodeInput');
  const confirmButton = document.getElementById('manualWarehouseBtn');
  if (!input || !confirmButton || !code) return;

  input.value = code;
  confirmButton.click();
}

function canBelleville(saved=loadState()){
 const team=saved?.team;
 return !!team?.id&&normalizeRoleLabel(team.rola)!=='EKIPA'&&
  (normalizeRoleLabel(team.rola)==='ADMIN'&&String(team.nazwa||'').toUpperCase()==='JJ'||
   saved.startData?.magazyny?.some(w=>String(w.nazwa||w.name||'').toLowerCase().includes('belleville')));
}
function canBellevilleOperation(operation,saved=loadState()){
 if(!canBelleville(saved))return false;
 const features=saved.team.features||{};
 return operation==='PZ'?features.pz!==false:operation==='WZ'?features.wz!==false:
  ['VISIT','EKIPY'].includes(operation)?(features.pz!==false||features.wz!==false):false;
}
// One persistent local draft per authenticated warehouse employee.
const BELLEVILLE_LEGACY_SESSION_KEY='gpbs-belleville-transport-session-v1';
const BELLEVILLE_DRAFT_PREFIX='gpbs-belleville-transport-draft-v2:';
const bel=id=>document.getElementById(id);
let bellevilleView='menu',belDirection='PZ',belTab='modules',belPlan=null,belPlanState='',belPlanToken=0;
function belDraftKey(teamId){return BELLEVILLE_DRAFT_PREFIX+encodeURIComponent(String(teamId));}
function getBellevilleSession(){
 const team=loadState()?.team;
 if(!canBelleville()||!team?.id)return null;
 const teamId=String(team.id);
 try{
  const key=belDraftKey(teamId);
  let saved=JSON.parse(localStorage.getItem(key)||'null');
  // Migrate an existing open draft if its old browser session still exists.
  if(!saved){
   const legacy=JSON.parse(sessionStorage.getItem(BELLEVILLE_LEGACY_SESSION_KEY)||'null');
   if(legacy?.teamId===teamId&&legacy.route&&legacy.plate){
    saved=legacy;
    try{
     localStorage.setItem(key,JSON.stringify(saved));
     sessionStorage.removeItem(BELLEVILLE_LEGACY_SESSION_KEY);
    }catch(error){console.warn('Nie udało się przenieść dotychczasowej wizyty do trwałej pamięci.',error);}
   }
  }
  if(saved?.teamId!==teamId||!saved.route||!saved.plate)return null;
  saved.operations??={PZ:{modules:[],parts:[],done:false},WZ:{modules:[],parts:[],done:false}};
  return saved;
 }catch(error){console.warn('Nie udało się odczytać wizyty Belleville.',error);return null;}
}
function saveBellevilleSession(session){
 const teamId=String(loadState()?.team?.id||'');
 if(!teamId||session.teamId!==teamId||!canBelleville())return false;
 try{
  localStorage.setItem(belDraftKey(teamId),JSON.stringify(session));
  return true;
 }catch(error){console.warn('Błąd zapisu wizyty Belleville.',error);alert('Nie udało się zapisać wizyty w trwałej pamięci telefonu. Pozycja nie została zapisana.');return false;}
}
function clearBellevilleSession(){
 const teamId=String(loadState()?.team?.id||'');
 if(!teamId||!canBelleville())return false;
 try{
  // Remove only this employee's draft; do not touch other local data.
  const legacy=JSON.parse(sessionStorage.getItem(BELLEVILLE_LEGACY_SESSION_KEY)||'null');
  if(legacy?.teamId===teamId)sessionStorage.removeItem(BELLEVILLE_LEGACY_SESSION_KEY);
  localStorage.removeItem(belDraftKey(teamId));
 }catch(error){console.warn('Błąd zamknięcia wizyty Belleville.',error);alert('Nie udało się zakończyć wizyty w pamięci telefonu. Spróbuj ponownie.');return false;}
 belPlanToken++;belPlan=null;belPlanState='';return true;
}
function showBellevilleView(view){
 bellevilleView=view;
 const sections={menu:'bellevilleMenuView',form:'bellevilleTransportForm',visit:'bellevilleVisitView',operation:'bellevilleOperationView'};
 for(const [name,id] of Object.entries(sections))bel(id).classList.toggle('hidden',name!==view);
 if(view==='menu'){
  bel('belStartVisit').textContent=getBellevilleSession()?'Wznów wizytę':'Rozpocznij wizytę';
 }else if(view==='visit'){
  const s=getBellevilleSession();if(!s){showBellevilleView('menu');return;}
  bel('belVisitRoute').textContent=s.route;
  for(const button of document.querySelectorAll('[data-bel-enter]')){
   const dir=button.dataset.belEnter;button.classList.toggle('hidden',!canBellevilleOperation(dir));
   button.textContent=(dir==='PZ'?'Przyjęcie':'Wydanie')+(s.operations[dir].done?' ✓':'');
  }
 }
}
function backBellevilleView(){
 const open=document.querySelector('#screenBelleville dialog[open]');if(open){open.close();return true;}
 if(bellevilleView==='menu')return false;
 showBellevilleView(bellevilleView==='operation'?'visit':'menu');return true;
}
function chooseBellevilleOperation(operation){
 if(!canBellevilleOperation(operation))return;
 bel('bellevilleInfo').classList.add('hidden');
 if(operation==='EKIPY'){
  bel('bellevilleInfo').textContent='Zaopatrzenie ekip zostanie dodane w kolejnym etapie.';
  bel('bellevilleInfo').classList.remove('hidden');return;
 }
 if(operation!=='VISIT')return;
 if(getBellevilleSession()){showBellevilleView('visit');return;}
 bel('bellevilleTransportForm').reset();showBellevilleView('form');
}
function startBellevilleSession(event){
 event.preventDefault();if(!canBellevilleOperation('VISIT')||getBellevilleSession())return;
 const value=id=>bel(id).value.trim(),route=value('bellevilleRouteInput').toUpperCase(),plate=value('bellevillePlateInput').toUpperCase();
 if(!route||!plate){alert('Wpisz numer trasy i tablicę samochodu.');return;}
 const s={teamId:String(loadState().team.id),route,plate,carrier:value('bellevilleCarrierInput'),driver:value('bellevilleDriverInput'),trailer:value('bellevilleTrailerInput').toUpperCase(),startedAt:new Date().toISOString(),
 operations:{PZ:{modules:[],parts:[],done:false},WZ:{modules:[],parts:[],done:false}}};
 if(saveBellevilleSession(s)){belPlanToken++;belPlan=null;belPlanState='';showBellevilleView('visit');}
}
function node(tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;}
function enterBellevilleOperation(direction){
 if(!canBellevilleOperation(direction)||!getBellevilleSession())return;
 belDirection=direction;belTab='modules';
 showBellevilleView('operation');renderBellevilleRows();
 if(direction==='WZ')void loadBellevillePlan();
}
function renderBellevilleRows(){
 const s=getBellevilleSession();if(!s)return;
 const op=s.operations[belDirection],receipt=belDirection==='PZ';
 bel('belFinishLabel').textContent=receipt?'Zakończ przyjęcie':'Zakończ wydanie';
 bel('bellevilleOperationRoute').textContent=s.route;
 bel('belPlanOpen').classList.toggle('hidden',receipt);
 for(const button of document.querySelectorAll('[data-bel-tab]')){
  const type=button.dataset.belTab;button.textContent=(type==='modules'?'Moduły':'Części')+' ('+op[type].length+')';
  button.classList.toggle('active',type===belTab);button.setAttribute('aria-pressed',String(type===belTab));
 }
 const modules=belTab==='modules';
 bel('belScan').querySelector('span').textContent=modules?'Skanuj moduł':'Skanuj część';
 const header=bel('belListHead');header.classList.toggle('bel-modules-grid',modules);header.replaceChildren(...(modules?['Typ','Numer seryjny','Stan','']:['Nazwa / indeks części','Ilość','','']).map(v=>node('span',v)));
 const rows=bel('belRows');rows.classList.toggle('bel-modules-grid',modules);rows.replaceChildren();
 if(!op[belTab].length)rows.append(node('p',modules?'Brak modułów. Dodaj ręcznie pozycje testowe.':'Brak części. Dodaj ręcznie pozycje testowe.','bel-empty'));
 for(const [i,row] of op[belTab].entries()){
  const line=node('div',null,'bel-row');
  if(modules)line.append(node('span',row.type),node('span',row.serial),node('span',row.status,row.status.toLowerCase()));
  else line.append(node('span',row.name),node('span',String(row.qty)),node('span',''));
  const remove=node('button','×');remove.type='button';remove.setAttribute('aria-label','Usuń pozycję');remove.onclick=()=>{
   if(!confirm('Usunąć tę pozycję?'))return;
   const current=getBellevilleSession();if(!current)return;
   current.operations[belDirection][belTab].splice(i,1);current.operations[belDirection].done=false;
   if(saveBellevilleSession(current))renderBellevilleRows();
  };line.append(remove);rows.append(line);
 }
 renderBellevillePlan();
}
function openBellevilleEntry(){
 if(!canBellevilleOperation(belDirection)||!getBellevilleSession())return;
 const mod=belTab==='modules';bel('belEntryTitle').textContent=mod?'Dodaj moduł ręcznie':'Dodaj część ręcznie';
 const fields=bel('belEntryFields');fields.replaceChildren();
 function input(label,id,attrs={}){const l=node('label',label,'field-label');l.htmlFor=id;const el=node('input');el.id=id;el.className='text-input';Object.assign(el,attrs);fields.append(l,el);return el;}
 if(mod){
  input('Numer seryjny','belEntrySerial',{required:true,maxLength:100,autocomplete:'off'});
  const type=input('Typ modułu','belEntryType',{required:true,maxLength:40,autocomplete:'off'});
  const types=node('datalist');types.id='belTypeSuggestions';for(const val of ['FM','LQ','RQ','XS','ODL','ODR','CU','DUO','HI UNO','HICU']){const opt=node('option');opt.value=val;types.append(opt);}
  type.setAttribute('list',types.id);fields.append(types);
  const label=node('label','Stan','field-label');label.htmlFor='belEntryState';const select=node('select');select.id='belEntryState';
  for(const val of ['OK','NOK']){const opt=node('option',val);opt.value=val;select.append(opt);}fields.append(label,select);
 }else{
  const name=input('Nazwa lub indeks części','belEntryPart',{required:true,maxLength:140,autocomplete:'off'});
  if(belPlan?.lines?.length){const list=node('datalist');list.id='belPartSuggestions';for(const line of belPlan.lines.filter(x=>x.kind==='PART')){const opt=node('option');opt.value=line.displayName;list.append(opt);}name.setAttribute('list',list.id);fields.append(list);}
  input('Ilość','belEntryQty',{required:true,type:'number',min:'1',max:'100000',step:'1',value:'',inputMode:'numeric'});
 }
 bel('belEntryDialog').showModal();
}
function saveBellevilleEntry(event){
 event.preventDefault();const s=getBellevilleSession();if(!s||!canBellevilleOperation(belDirection))return;
 const op=s.operations[belDirection];
 if(belTab==='modules'){
  const serial=bel('belEntrySerial').value.trim().toUpperCase(),type=bel('belEntryType').value.trim().toUpperCase(),status=bel('belEntryState').value;
  if(!serial||!type)return;
  if(op.modules.some(x=>x.serial===serial)){alert('Ten numer seryjny jest już na liście.');return;}
  op.modules.push({serial,type,status});
 }else{
  const name=bel('belEntryPart').value.trim(),qty=Number(bel('belEntryQty').value);
  if(!name||!Number.isSafeInteger(qty)||qty<1||qty>100000)return;
  const found=op.parts.find(x=>x.name.toUpperCase()===name.toUpperCase());
  if(found)found.qty+=qty;else op.parts.push({name,qty});
 }
 op.done=false;
 if(saveBellevilleSession(s)){bel('belEntryDialog').close();renderBellevilleRows();}
}
function finishBellevilleOperation(){
 const s=getBellevilleSession();if(!s||!canBellevilleOperation(belDirection))return;
 const receipt=belDirection==='PZ',op=s.operations[belDirection],other=receipt?'WZ':'PZ';
 bel('belFinishTitle').textContent=receipt?'Zakończenie przyjęcia':'Zakończenie wydania';
 bel('belFinishSummary').textContent='Moduły: '+op.modules.length+'  •  Pozycje części: '+op.parts.length;
 const offer=canBellevilleOperation(other)&&!s.operations[other].done;
 bel('belFinishQuestion').textContent=offer?(receipt?'Czy będziesz jeszcze wydawać moduły lub części na tę trasę?':'Czy będziesz jeszcze przyjmować moduły lub części z tej trasy?'):'Zakończyć wizytę?';
 bel('belOther').classList.toggle('hidden',!offer);bel('belOther').textContent=receipt?'Przejdź do wydania':'Przejdź do przyjęcia';
 bel('belFinishExplain').textContent=(offer?'Jeżeli nie, zakończ wizytę. ':'')+'W wersji testowej dane nie są wysyłane do Office.';
 bel('belFinishDialog').dataset.from='operation';bel('belFinishDialog').showModal();
}
function finishBellevilleSession(){
 const s=getBellevilleSession();if(!s)return;
 bel('belFinishTitle').textContent='Zakończenie wizyty';
 bel('belFinishSummary').textContent='Przyjęcie: '+s.operations.PZ.modules.length+' mod. / '+s.operations.PZ.parts.length+' poz. • Wydanie: '+s.operations.WZ.modules.length+' mod. / '+s.operations.WZ.parts.length+' poz.';
 bel('belFinishQuestion').textContent='Czy zakończyć tę wizytę?';
 bel('belOther').classList.add('hidden');bel('belFinishExplain').textContent='Dane testowe zostaną wyczyszczone. Nic nie trafi do Office.';
 bel('belFinishDialog').dataset.from='visit';bel('belFinishDialog').showModal();
}
function continueBellevilleOther(){
 const s=getBellevilleSession(),other=belDirection==='PZ'?'WZ':'PZ';if(!s||!canBellevilleOperation(other))return;
 s.operations[belDirection].done=true;if(!saveBellevilleSession(s))return;
 bel('belFinishDialog').close();enterBellevilleOperation(other);
}
function confirmBellevilleFinish(){
 if(!getBellevilleSession())return;
 if(!clearBellevilleSession())return;
 bel('belFinishDialog').close();showBellevilleView('menu');
 bel('bellevilleInfo').textContent='Wizyta testowa zakończona.';
 bel('bellevilleInfo').classList.remove('hidden');
}
function weekOf(date){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(new Date(date));
 const n=type=>Number(parts.find(p=>p.type===type)?.value);
 const d=new Date(Date.UTC(n('year'),n('month')-1,n('day')));d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));
 return {year:d.getUTCFullYear(),week:Math.ceil(((d-new Date(Date.UTC(d.getUTCFullYear(),0,1)))/86400000+1)/7)};
}
async function loadBellevillePlan(){
 const s=getBellevilleSession();if(!s||!canBellevilleOperation('WZ'))return;
 const token=++belPlanToken;belPlan=null;belPlanState='Pobieranie listy…';renderBellevillePlan();
 try{
  const {year,week}=weekOf(s.startedAt);
  const params=new URLSearchParams({mobile:'1',route:s.route,year:String(year),week:String(week)});
  const res=await fetch('/api/fr-loading-plans?'+params,{credentials:'same-origin',cache:'no-store'});
  const data=await res.json();if(token!==belPlanToken)return;
  if(!res.ok||!data.ok)throw Error(data.error||'Nie udało się pobrać listy.');
  belPlan=data.plans?.[0]||null;belPlanState=belPlan?'Tydzień '+week+' · '+s.route:'Brak listy załadunkowej dla tej trasy w bieżącym tygodniu.';
 }catch(e){if(token!==belPlanToken)return;belPlanState=e.message||'Nie udało się pobrać listy.';}
 renderBellevillePlan();
}
function planProgress(){
 const s=getBellevilleSession(),op=s?.operations.WZ;if(!op||!belPlan)return [];
 const key=v=>String(v||'').trim().replace(/\s+/g,' ').toUpperCase();
 const totals=new Map();
 for(const x of op.modules){const k='MODULE:'+key(x.type);totals.set(k,(totals.get(k)||0)+1);}
 for(const x of op.parts){const k='PART:'+key(x.name);totals.set(k,(totals.get(k)||0)+x.qty);}
 return belPlan.lines.map(x=>{const k=x.kind+':'+key(x.displayName),available=totals.get(k)||0,done=Math.min(x.quantity,available);totals.set(k,available-done);return {...x,done,remaining:x.quantity-done};});
}
function renderBellevillePlan(){
 if(!bel('belPlanOpen'))return;
 const lines=planProgress(),total=lines.reduce((sum,x)=>sum+x.quantity,0),done=lines.reduce((sum,x)=>sum+x.done,0);
 bel('belPlanCount').textContent=belPlan?done+'/'+total:'';
 bel('belPlanCount').classList.toggle('hidden',!belPlan);
 bel('belPlanStatus').textContent=belPlan?belPlanState+' • '+done+'/'+total:belPlanState;
 const root=bel('belPlanRows');root.replaceChildren();
 if(!belPlan)return;
 const header=node('div',null,'bel-plan-row');for(const v of ['Pozycja','Plan','Wyd.','Brak'])header.append(node('span',v));root.append(header);
 for(const x of lines.filter(x=>!bel('belRemainingOnly').checked||x.remaining>0)){
  const row=node('div',null,'bel-plan-row');for(const v of [x.displayName,x.quantity,x.done,x.remaining])row.append(node('span',String(v)));root.append(row);
 }
}
function openBellevilleScreen(){
 const saved=loadState();if(!canBelleville(saved))return;
 document.querySelectorAll('#screenBelleville .belleville-option').forEach(button=>button.classList.toggle('hidden',!canBellevilleOperation(button.dataset.bellevilleOperation,saved)));
 document.querySelectorAll('.screen').forEach(screen=>screen.classList.toggle('active',screen.id==='screenBelleville'));
 bel('bellevilleInfo').classList.add('hidden');showBellevilleView('menu');
}
function closeBellevilleScreen(){
 if(backBellevilleView())return;
 document.querySelectorAll('.screen').forEach(screen=>screen.classList.toggle('active',screen.id==='screenWarehouse'));
 updateRoleControls();
}

function renderAdminWarehousePicker(saved) {
  const picker = ensureAdminWarehousePicker();
  const list = document.getElementById('adminWarehouseList');
  if (!picker || !list) return;

  const warehouses = getAdminWarehouses(saved);
  list.replaceChildren();

  const bellevilleBtn = document.createElement('button');
  bellevilleBtn.type = 'button';
  bellevilleBtn.className = 'btn gpbs-menu-btn admin-warehouse-btn';
  bellevilleBtn.textContent = 'Belleville';
  bellevilleBtn.addEventListener('click', openBellevilleScreen);
  if(canBelleville(saved))list.appendChild(bellevilleBtn);

  for (const warehouse of warehouses) {
    if (warehouse.nazwa.toUpperCase().includes('BELLEVILLE')) continue;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn gpbs-menu-btn admin-warehouse-btn';
    const owner=String(saved?.team?.nazwa||'').toUpperCase()==='JJ'&&normalizeRoleLabel(saved?.team?.rola)==='ADMIN';
    const isBox=['FR-PARIS','FR-TOULOUSE'].includes(warehouse.id);
    const canReadBox=isBox&&saved?.team?.features?.stocks!==false;
    const hasCode = owner&&Boolean(String(warehouse.kod || '').trim());
    button.textContent = warehouse.nazwa;
    button.disabled = !hasCode&&!canReadBox;

    if (hasCode) {
      button.addEventListener('click', () => startWarehouseFromPicker(warehouse.kod));
    } else if(canReadBox){
      button.addEventListener('click',()=>{document.getElementById('boxStockEntryBtn')?.click();document.querySelector('[data-box-stock-warehouse="'+warehouse.id+'"]')?.click();});
    } else {
      button.title = 'Obsługa mobilna tego magazynu nie jest jeszcze dostępna.';
    }

    list.appendChild(button);
  }

  picker.classList.remove('hidden');
}

function updateWarehouseControls(saved, role) {
  const screenWarehouse = document.getElementById('screenWarehouse');
  const scanArea = document.querySelector('#screenWarehouse .warehouse-scan-area');
  const scanTitle = document.querySelector('#screenWarehouse .warehouse-scan-title');
  const scannerButton = document.getElementById('openWarehouseScannerBtn');
  const manualDetails = document.querySelector('#screenWarehouse .warehouse-manual-details');
  const picker = ensureAdminWarehousePicker();
  if (!screenWarehouse || !scanArea || !scanTitle || !scannerButton || !manualDetails || !picker) return;

  const isAdmin = Boolean(saved?.team?.id)&&role!=='EKIPA';
  const owner=role==='ADMIN'&&String(saved?.team?.nazwa||'').toUpperCase()==='JJ';
  screenWarehouse.classList.toggle('admin-warehouse-mode', isAdmin);
  picker.classList.toggle('hidden', !isAdmin);
  scanTitle.style.display = isAdmin ? 'none' : '';
  manualDetails.style.display = isAdmin ? 'none' : '';
  scanArea.style.marginTop = isAdmin ? '34px' : '';

  scannerButton.textContent = isAdmin ? 'Skanuj kod magazynu' : 'Otwórz skaner';

  if (isAdmin) {
    scannerButton.style.minHeight = '44px';
    scannerButton.style.marginTop = '22px';
    scannerButton.style.background = '#343b44';
    scannerButton.style.border = '1px solid var(--line)';
    scannerButton.style.color = '#dce2e8';
    scannerButton.style.fontSize = '14px';
    renderAdminWarehousePicker(saved);
    scannerButton.classList.toggle('hidden',!owner);
  } else {
    scannerButton.style.minHeight = '';
    scannerButton.style.marginTop = '';
    scannerButton.style.background = '';
    scannerButton.style.border = '';
    scannerButton.style.color = '';
    scannerButton.style.fontSize = '';
  }
}

function updateRoleControls() {
  const settingsBtn = document.getElementById('settingsBtn');
  const vehiclePartsBtn = ensureVehiclePartsButton();
  const vehicleStatePreBtn = document.getElementById('vehicleStatePreBtn');
  const inventoryBtn = document.getElementById('inventoryBtn');
  const roleLabel = document.getElementById('teamRole');

  const saved = loadState();
  const rawRole = String(saved?.team?.rola || '').trim().toUpperCase();
  const role = normalizeRoleLabel(rawRole);
  const canInventory = Boolean(saved?.team?.id)&&role!=='EKIPA'&&saved?.team?.features?.inventory!==false;

  if (roleLabel && role) {
    roleLabel.textContent = role;
  }

  if (settingsBtn) {
    settingsBtn.classList.toggle('hidden', role !== 'ADMIN');
  }

  if (inventoryBtn) {
    inventoryBtn.classList.toggle('hidden', !canInventory);
    const description = inventoryBtn.querySelector('small');
    if (description) {
      description.textContent = 'Inwentaryzacja magazynu';
    }
  }

  if (vehiclePartsBtn) {
    vehiclePartsBtn.classList.toggle('hidden', role !== 'EKIPA');
  }

  if (vehicleStatePreBtn) {
    vehicleStatePreBtn.classList.toggle('hidden', role !== 'EKIPA');
  }

  updateWarehouseControls(saved, role);
}

function observeVisitScreen() {
  const screenVisit = document.getElementById('screenVisit');
  if (!screenVisit) return;

  const observer = new MutationObserver(() => {
    if (screenVisit.classList.contains('active')) {
      updateRoleControls();
    }
  });

  observer.observe(screenVisit, {
    attributes: true,
    attributeFilter: ['class']
  });
}

function observeWarehouseScreen() {
  const screenWarehouse = document.getElementById('screenWarehouse');
  if (!screenWarehouse) return;

  const observer = new MutationObserver(() => {
    if (screenWarehouse.classList.contains('active')) {
      updateRoleControls();
      setTimeout(updateRoleControls, 1200);
    }
  });

  observer.observe(screenWarehouse, {
    attributes: true,
    attributeFilter: ['class']
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('bellevilleBackBtn')?.addEventListener('click', closeBellevilleScreen);
  document.querySelectorAll('#screenBelleville .belleville-option').forEach(button => {
    button.addEventListener('click', () => chooseBellevilleOperation(button.dataset.bellevilleOperation));
  });
  document.querySelectorAll('#bellevilleTransportForm .text-input').forEach(input => {
    input.addEventListener('input', () => {
      if(input.id==='bellevilleDriverInput')return;
      const uppercase = input.value.toUpperCase();
      if (input.value === uppercase) return;
      const start = input.selectionStart;
      const end = input.selectionEnd;
      input.value = uppercase;
      if (start !== null && end !== null) input.setSelectionRange(start, end);
    });
  });
  document.getElementById('bellevilleTransportForm')?.addEventListener('submit', startBellevilleSession);
  document.getElementById('bellevilleCancelFormBtn')?.addEventListener('click', backBellevilleView);
  document.getElementById('bellevilleOperationBackBtn')?.addEventListener('click', backBellevilleView);
  bel('belVisitFinish').addEventListener('click',finishBellevilleSession);
  document.querySelectorAll('[data-bel-enter]').forEach(b=>b.addEventListener('click',()=>enterBellevilleOperation(b.dataset.belEnter)));
  document.querySelectorAll('[data-bel-tab]').forEach(b=>b.addEventListener('click',()=>{belTab=b.dataset.belTab;renderBellevilleRows();}));
  document.querySelectorAll('[data-bel-close]').forEach(b=>b.addEventListener('click',()=>bel(b.dataset.belClose).close()));
  document.querySelectorAll('[data-bel-ocr]').forEach(b=>b.addEventListener('click',()=>alert('OCR tablic zostanie podłączony później.')));
  bel('belManual').addEventListener('click',openBellevilleEntry);
  bel('belScan').addEventListener('click',()=>alert('GPBS Scanner zostanie podłączony później. Na razie użyj opcji Ręcznie.'));
  bel('belEntryForm').addEventListener('submit',saveBellevilleEntry);
  bel('belOperationFinish').addEventListener('click',finishBellevilleOperation);
  bel('belOther').addEventListener('click',continueBellevilleOther);
  bel('belFinalConfirm').addEventListener('click',confirmBellevilleFinish);
  bel('belPlanOpen').addEventListener('click',()=>{renderBellevillePlan();bel('belPlanDialog').showModal();});
  bel('belRemainingOnly').addEventListener('change',renderBellevillePlan);
  window.gpbsBellevilleBack = backBellevilleView;
  updateRoleControls();
  observeVisitScreen();
  observeWarehouseScreen();
});
