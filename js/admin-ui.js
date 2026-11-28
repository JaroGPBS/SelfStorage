import { loadState } from './storage.js';
import './install.js?v=1';
import {startModuleCapture,stopModuleCapture,captureModuleOcr,rotateModuleOcr,requestModuleTiltPermission} from './belleville-module-scan.js?v=4';

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
 return operation==='INVENTORY'?features.inventory!==false:operation==='PZ'?features.pz!==false:operation==='WZ'?features.wz!==false:
  ['VISIT','EKIPY'].includes(operation)?(features.pz!==false||features.wz!==false):false;
}
// One persistent local draft per authenticated warehouse employee.
const BELLEVILLE_LEGACY_SESSION_KEY='gpbs-belleville-transport-session-v1';
const BELLEVILLE_DRAFT_PREFIX='gpbs-belleville-transport-draft-v2:';
const bel=id=>document.getElementById(id);
let bellevilleView='menu',belDirection='PZ',belTab='modules',belPlan=null,belPlanOptions=[],belPlanState='',belPlanToken=0,belPlanLoading=false;
function belDraftKey(teamId){return BELLEVILLE_DRAFT_PREFIX+encodeURIComponent(String(teamId));}

let belMessageResolve=null;
function belMessage(text,confirmation=false){
 const dialog=bel('belMessageDialog');
 if(dialog.open)return Promise.resolve(false);
 bel('belMessageText').textContent=text;
 bel('belMessageNo').classList.toggle('hidden',!confirmation);
 bel('belMessageYes').textContent=confirmation?'Tak':'OK';
 dialog.returnValue='no';
 return new Promise(resolve=>{
  belMessageResolve=resolve;
  dialog.showModal();
  (confirmation?bel('belMessageNo'):bel('belMessageYes')).focus();
 });
}
function belAlert(text){void belMessage(text);}
function belConfirm(text){return belMessage(text,true);}

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
 }catch(error){console.warn('Błąd zapisu wizyty Belleville.',error);belAlert('Nie udało się zapisać wizyty w trwałej pamięci telefonu. Pozycja nie została zapisana.');return false;}
}
function clearBellevilleSession(){
 const teamId=String(loadState()?.team?.id||'');
 if(!teamId||!canBelleville())return false;
 try{
  // Remove only this employee's draft; do not touch other local data.
  const legacy=JSON.parse(sessionStorage.getItem(BELLEVILLE_LEGACY_SESSION_KEY)||'null');
  if(legacy?.teamId===teamId)sessionStorage.removeItem(BELLEVILLE_LEGACY_SESSION_KEY);
  localStorage.removeItem(belDraftKey(teamId));
 }catch(error){console.warn('Błąd zamknięcia wizyty Belleville.',error);belAlert('Nie udało się zakończyć wizyty w pamięci telefonu. Spróbuj ponownie.');return false;}
 belPlanToken++;belPlan=null;belPlanOptions=[];belPlanState='';belPlanLoading=false;return true;
}
function showBellevilleView(view){
 bellevilleView=view;
 bel('belMainTitle').textContent=view==='inventory'?'Inwentaryzacja':'Belleville';
 const sections={menu:'bellevilleMenuView',form:'bellevilleTransportForm',visit:'bellevilleVisitView',operation:'bellevilleOperationView',supplyForm:'belSupplyForm',supply:'belSupplyWork',inventory:'belInventoryMenu',moduleInventory:'belModuleInventoryWork'};
 for(const [name,id] of Object.entries(sections))bel(id).classList.toggle('hidden',name!==view);
 if(view==='menu'){
  bel('belStartVisit').textContent=getBellevilleSession()?'Wznów wizytę':'Rozpocznij wizytę';
  bel('belSupplyStart').textContent=getSupplyDraft()?'Wznów zaopatrzenie ekip':'Zaopatrzenie ekip';
 }else if(view==='visit'){
  const s=getBellevilleSession();if(!s){showBellevilleView('menu');return;}
  bel('belVisitRoute').textContent=s.route;
  for(const button of document.querySelectorAll('[data-bel-enter]')){
   const dir=button.dataset.belEnter;button.classList.toggle('hidden',!canBellevilleOperation(dir));
   button.textContent=(dir==='PZ'?'Przyjęcie':'Wydanie')+(s.operations[dir].done?' ✓':'');
  }
 }else if(view==='supply'){renderSupply();}
 else if(view==='inventory'){bel('belInventoryModules').textContent=getModuleInventory()?.rows.length?'Moduły – wznów':'Moduły';}
 else if(view==='moduleInventory'){renderModuleInventory();}
}
function backBellevilleView(){
 const message=bel('belMessageDialog');if(message?.open){message.close('no');return true;}
 const open=document.querySelector('#screenBelleville dialog[open]');if(open){open.close();return true;}
 if(bellevilleView==='menu')return false;
 showBellevilleView(bellevilleView==='operation'?'visit':bellevilleView==='moduleInventory'?'inventory':'menu');return true;
}
function chooseBellevilleOperation(operation){
 if(!canBellevilleOperation(operation))return;
 bel('bellevilleInfo').classList.add('hidden');
 if(operation==='INVENTORY'){showBellevilleView('inventory');return;}
 if(operation==='EKIPY'){
  if(getSupplyDraft()){openSupplyWork();return;}
  bel('belSupplyForm').reset();showBellevilleView('supplyForm');return;
 }
 if(operation!=='VISIT')return;
 if(getBellevilleSession()){showBellevilleView('visit');return;}
 bel('bellevilleTransportForm').reset();showBellevilleView('form');
}
function startBellevilleSession(event){
 event.preventDefault();if(!canBellevilleOperation('VISIT')||getBellevilleSession())return;
 const value=id=>bel(id).value.trim(),route=value('bellevilleRouteInput').toUpperCase(),plate=value('bellevillePlateInput').toUpperCase();
 if(!route||!plate){belAlert('Wpisz numer trasy i tablicę samochodu.');return;}
 const s={teamId:String(loadState().team.id),route,plate,carrier:value('bellevilleCarrierInput'),driver:value('bellevilleDriverInput'),trailer:value('bellevilleTrailerInput').toUpperCase(),startedAt:new Date().toISOString(),
 operations:{PZ:{modules:[],parts:[],done:false},WZ:{modules:[],parts:[],done:false}}};
 if(saveBellevilleSession(s)){belPlanToken++;belPlan=null;belPlanOptions=[];belPlanState='';belPlanLoading=false;showBellevilleView('visit');}
}
function node(tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;}
function enterBellevilleOperation(direction){
 if(!canBellevilleOperation(direction)||!getBellevilleSession())return;
 belDirection=direction;belTab='modules';
 showBellevilleView('operation');renderBellevilleRows();
 if(direction==='WZ')void loadBellevillePlan();
 if(navigator.onLine&&typeof window.gpbsRefreshModulePrefixes==='function')void window.gpbsRefreshModulePrefixes().then(()=>{if(bel('belModuleScanDialog').open)refreshTransportModuleTypes();}).catch(error=>console.warn('Nie udało się odświeżyć katalogu modułów.',error));
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
  if(modules){
   const edit=node('button',null,'bel-transport-serial');edit.type='button';edit.setAttribute('aria-label','Edytuj moduł '+row.serial);
   fillTransportSerial(edit,row.serial);edit.onclick=()=>openTransportModule(false,row.serial);
   const catalogue=loadState()?.startData?.moduleCatalogTypes||[],type=catalogue.find(t=>t.scannerLabel===row.type);
   line.append(node('span',type?.name||row.type),edit,node('span',row.status,row.status.toLowerCase()));
  }
  else line.append(node('span',row.name),node('span',String(row.qty)),node('span',''));
  const remove=node('button','×');remove.type='button';remove.setAttribute('aria-label','Usuń pozycję');remove.onclick=async()=>{
   if(!await belConfirm('Czy usunąć pozycję?'))return;
   const current=getBellevilleSession();if(!current)return;
   current.operations[belDirection][belTab].splice(i,1);current.operations[belDirection].done=false;
   if(saveBellevilleSession(current))renderBellevilleRows();
  };line.append(remove);rows.append(line);
 }
 renderBellevillePlan();
}
let transportModuleEdit=null;
function transportSerialDisplay(value){
 const serial=moduleInvSerial(value),match=serial.match(/^(.*?)(\d{6,})([A-Z]*)$/);
 if(!match)return {leading:serial,emphasis:'',suffix:''};
 const [,prefix,digits,suffix]=match,head=digits.slice(0,-6),tail=digits.slice(-6);
 return {leading:[prefix,head.replace(/\B(?=(\d{3})+(?!\d))/g,' ')].filter(Boolean).join(' ')+(prefix||head?' ':''),emphasis:tail.slice(0,3)+' '+tail.slice(3),suffix:suffix?' '+suffix:''};
}
function fillTransportSerial(root,value){
 const d=transportSerialDisplay(value);root.replaceChildren(document.createTextNode(d.leading));
 if(d.emphasis)root.append(node('strong',d.emphasis));
 if(d.suffix)root.append(document.createTextNode(d.suffix));
}
function transportModuleOptions(serial,existing=''){
 const matches=moduleInvMatches(serial),catalogue=loadState()?.startData?.moduleCatalogTypes||[];
 const all=[...catalogue.map(t=>({moduleType:t.scannerLabel,typeName:t.name,groupName:t.groupName})),...moduleInvPrefixes(),...(!catalogue.length?MODULE_INV_TYPES.map(t=>({moduleType:t})):[])];
 const rows=matches.length?matches:all;
 const result=[...new Map(rows.filter(p=>p.moduleType).map(p=>[p.moduleType,p])).values()];
 if(existing&&!result.some(p=>p.moduleType===existing))result.push({moduleType:existing});
 return {matches,result};
}
function refreshTransportModuleTypes(preserve=true){
 const input=bel('belModuleSerial'),select=bel('belModuleType'),serial=moduleInvSerial(input.value),previous=preserve?select.value:'';
 fillTransportSerial(bel('belModuleSerialPreview'),serial);
 if(!serial)bel('belModuleSerialPreview').textContent='—';
 const {matches,result}=transportModuleOptions(serial,previous&&transportModuleEdit?.originalSerial===serial?previous:'');
 select.replaceChildren(new Option('Wybierz typ modułu',''));
 for(const p of result)select.append(new Option(p.groupName?p.groupName+' · '+(p.typeName||p.moduleType):p.typeName||p.moduleType,p.moduleType));
 select.value=previous&&result.some(p=>p.moduleType===previous)?previous:matches.length===1?matches[0].moduleType:'';
 bel('belModuleTypeHint').textContent=matches.length>1?'Prefiks pasuje do kilku typów. Wybierz właściwy.':serial&&matches.length===0?'Nie rozpoznano prefiksu. Wybierz typ ręcznie.':'';
}
function openTransportModule(scan=true,existingSerial=null){
 const s=getBellevilleSession();if(!s||bellevilleView!=='operation'||belTab!=='modules'||!canBellevilleOperation(belDirection))return;
 const existing=existingSerial?s.operations[belDirection].modules.find(x=>x.serial===existingSerial):null;
 if(existingSerial&&!existing)return;
 transportModuleEdit={teamId:s.teamId,startedAt:s.startedAt,direction:belDirection,originalSerial:existing?.serial||null};
 bel('belModuleScanTitle').textContent=existing?'Edytuj moduł':scan?'Skanowanie modułu':'Dodaj moduł ręcznie';
 bel('belModuleScanModes').classList.toggle('hidden',!scan);
 bel('belModuleSerial').value=existing?.serial||'';
 bel('belModuleType').replaceChildren(new Option('Wybierz typ modułu',''));
 if(existing)bel('belModuleType').append(new Option(existing.type,existing.type));
 bel('belModuleType').value=existing?.type||'';
 bel('belModuleState').value=existing?.status||'OK';
 bel('belModuleScanStatus').textContent=scan?'Wybierz OCR lub kod QR.':'Wpisz numer seryjny.';
 bel('belModuleCapture').disabled=false;
 for(const b of document.querySelectorAll('[data-bel-module-mode]'))b.setAttribute('aria-pressed','false');
 refreshTransportModuleTypes();
 bel('belModuleScanDialog').showModal();
 if(!scan)bel('belModuleSerial').focus();else bel('belModuleOcrMode').focus();
}
function chooseTransportScanMode(mode){
 if(!transportModuleEdit||!bel('belModuleScanDialog').open)return;
 if(mode==='OCR')requestModuleTiltPermission();
 for(const b of document.querySelectorAll('[data-bel-module-mode]'))b.setAttribute('aria-pressed',String(b.dataset.belModuleMode===mode));
 bel('belModuleCapture').disabled=false;
 void startModuleCapture(mode,value=>{
  if(!bel('belModuleScanDialog').open)return;
  const serial=moduleInvSerial(value);
  if(!moduleInvValidSerial(serial)||!/\d/.test(serial)){bel('belModuleScanStatus').textContent='Nieprawidłowy numer. Wpisz go ręcznie lub zeskanuj ponownie.';return;}
  if(supplyCatalog().some(p=>(p.kody||[]).some(k=>moduleInvSerial(k)===serial))){bel('belModuleScanStatus').textContent='To kod części, nie modułu.';return;}
  bel('belModuleSerial').value=serial;refreshTransportModuleTypes(false);
  bel('belModuleScanStatus').textContent='Sprawdź numer i zatwierdź.';
  for(const b of document.querySelectorAll('[data-bel-module-mode]'))b.setAttribute('aria-pressed','false');
 },status=>{if(bel('belModuleScanDialog').open)bel('belModuleScanStatus').textContent=status;});
}
function submitTransportModule(event){
 event.preventDefault();const s=getBellevilleSession(),edit=transportModuleEdit;
 if(!edit||!s||bellevilleView!=='operation'||belDirection!==edit.direction||s.teamId!==edit.teamId||s.startedAt!==edit.startedAt||!canBellevilleOperation(edit.direction))return;
 const serial=moduleInvSerial(bel('belModuleSerial').value),type=bel('belModuleType').value,status=bel('belModuleState').value;
 if(!moduleInvValidSerial(serial)||!/\d/.test(serial)||!type||!['OK','NOK'].includes(status)){bel('belModuleScanStatus').textContent='Sprawdź numer seryjny, typ i stan.';return;}
 if(supplyCatalog().some(p=>(p.kody||[]).some(k=>moduleInvSerial(k)===serial))){bel('belModuleScanStatus').textContent='To kod części, nie modułu.';return;}
 const op=s.operations[edit.direction],index=edit.originalSerial?op.modules.findIndex(x=>x.serial===edit.originalSerial):-1;
 if(edit.originalSerial&&index<0)return;
 if(op.modules.some((x,i)=>i!==index&&moduleInvSerial(x.serial)===serial)){bel('belModuleScanStatus').textContent='Ten moduł jest już na liście.';return;}
 const row={serial,type,status};if(index>=0)op.modules[index]=row;else op.modules.push(row);
 op.done=false;
 if(saveBellevilleSession(s)){void stopModuleCapture();bel('belModuleScanDialog').close();transportModuleEdit=null;renderBellevilleRows();}
}
function openBellevilleEntry(){
 if(!canBellevilleOperation(belDirection)||!getBellevilleSession())return;
 if(belTab==='modules'){openTransportModule(false);return;}
 bel('belEntryTitle').textContent='Dodaj część ręcznie';
 const fields=bel('belEntryFields');fields.replaceChildren();
 function input(label,id,attrs={}){const l=node('label',label,'field-label');l.htmlFor=id;const el=node('input');el.id=id;el.className='text-input';Object.assign(el,attrs);fields.append(l,el);return el;}
 const name=input('Nazwa lub indeks części','belEntryPart',{required:true,maxLength:140,autocomplete:'off'});
 if(belPlan?.lines?.length){const list=node('datalist');list.id='belPartSuggestions';for(const line of belPlan.lines.filter(x=>x.kind==='PART')){const opt=node('option');opt.value=line.displayName;list.append(opt);}name.setAttribute('list',list.id);fields.append(list);}
 input('Ilość','belEntryQty',{required:true,type:'number',min:'1',max:'100000',step:'1',value:'',inputMode:'numeric'});
 bel('belEntryDialog').showModal();
}
function saveBellevilleEntry(event){
 event.preventDefault();const s=getBellevilleSession();if(!s||!canBellevilleOperation(belDirection)||belTab!=='parts')return;
 const op=s.operations[belDirection],name=bel('belEntryPart').value.trim(),qty=Number(bel('belEntryQty').value);
 if(!name||!Number.isSafeInteger(qty)||qty<1||qty>100000)return;
 const found=op.parts.find(x=>x.name.toUpperCase()===name.toUpperCase());
 if(found)found.qty+=qty;else op.parts.push({name,qty});
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
function chooseBellevillePlan(id){
 const s=getBellevilleSession();if(!s||!canBellevilleOperation('WZ'))return;
 const plan=belPlanOptions.find(p=>p.id===id);
 if(!plan)return;
 if(s.loadingPlanId!==plan.id){
  s.loadingPlanId=plan.id;if(!saveBellevilleSession(s)){renderBellevillePlan();return;}
 }
 belPlan=plan;belPlanState='Tydzień '+plan.week+'/'+plan.year+' · '+s.route;renderBellevillePlan();
}
async function loadBellevillePlan(){
 const s=getBellevilleSession();if(!s||!canBellevilleOperation('WZ'))return;
 const token=++belPlanToken;belPlan=null;belPlanOptions=[];belPlanLoading=true;belPlanState='Pobieranie listy…';renderBellevillePlan();
 try{
  const {year,week}=weekOf(s.startedAt);
  const params=new URLSearchParams({mobile:'1',route:s.route,year:String(year),week:String(week),includeNext:'1'});
  const res=await fetch('/api/fr-loading-plans?'+params,{credentials:'same-origin',cache:'no-store'});
  const data=await res.json();if(token!==belPlanToken)return;
  if(!res.ok||!data.ok)throw Error(data.error||'Nie udało się pobrać listy.');
  const current=getBellevilleSession();if(!current||current.teamId!==s.teamId||current.startedAt!==s.startedAt)return;
  belPlanOptions=Array.isArray(data.plans)?data.plans:[];
  belPlan=belPlanOptions.find(p=>p.id===current.loadingPlanId)||null;
  if(!belPlan&&belPlanOptions.length===1&&!current.loadingPlanId){chooseBellevillePlan(belPlanOptions[0].id);}
  if(belPlan)belPlanState='Tydzień '+belPlan.week+'/'+belPlan.year+' · '+s.route;
  else if(belPlanOptions.length)belPlanState='Wybierz tydzień listy załadunkowej.';
  else belPlanState='Brak listy załadunkowej dla tej trasy w tygodniu wizyty i kolejnym tygodniu.';
 }catch(e){if(token!==belPlanToken)return;belPlanState=e.message||'Nie udało się pobrać listy.';}
 finally{if(token===belPlanToken){belPlanLoading=false;renderBellevillePlan();}}
}
function planModuleKey(value,excelName=''){
 const clean=v=>String(v||'').trim().toUpperCase(),compact=v=>clean(v).replace(/[\s._-]/g,'');
 const catalogue=loadState()?.startData?.moduleCatalogTypes||[],raw=clean(value);
 const groupOf=g=>{const key=compact(g);return ['BQ','BLOQIT'].includes(key)?'BQ':['NG','NEWGEN'].includes(key)?'NEWGEN':'INPOST';};
 if(excelName){
  const family=String(excelName).split('/')[0];
  return groupOf(family)+':'+compact(raw.replace(/^(?:INDOOR|OUTDOOR|BQ|BLOQ\.?IT|NEW GEN)\s+/,''));
 }
 const found=catalogue.find(t=>clean(t.scannerLabel)===raw);
 if(found)return groupOf(found.groupName)+':'+compact(found.name);
 const prefix=raw.match(/^(INDOOR|OUTDOOR|BQ|BLOQ\.?IT|NEW GEN)\s+(.+)$/);
 return prefix?groupOf(prefix[1])+':'+compact(prefix[2]):'INPOST:'+compact(raw);
}
function planProgress(){
 const s=getBellevilleSession(),op=s?.operations.WZ;if(!op||!belPlan)return [];
 const key=v=>String(v||'').trim().replace(/\s+/g,' ').toUpperCase();
 const totals=new Map();
 for(const x of op.modules){const k='MODULE:'+planModuleKey(x.type);totals.set(k,(totals.get(k)||0)+1);}
 for(const x of op.parts){const k='PART:'+key(x.name);totals.set(k,(totals.get(k)||0)+x.qty);}
 return belPlan.lines.map(x=>{const k=x.kind+':'+(x.kind==='MODULE'?planModuleKey(x.displayName,x.excelName):key(x.displayName)),available=totals.get(k)||0,done=Math.min(x.quantity,available);totals.set(k,available-done);return {...x,done,remaining:x.quantity-done};});
}
function renderBellevillePlan(){
 if(!bel('belPlanOpen'))return;
 const lines=planProgress(),remaining=lines.reduce((sum,x)=>sum+x.remaining,0);
 bel('belPlanCount').textContent=belPlan?String(remaining):'';
 bel('belPlanCount').classList.toggle('hidden',!belPlan);
 bel('belPlanStatus').textContent=belPlanState;
 const picker=bel('belPlanPicker'),select=bel('belPlanSelect');
 picker.classList.toggle('hidden',belPlanOptions.length<2&&!(belPlanOptions.length===1&&!belPlan));
 select.replaceChildren(new Option('Wybierz listę',''));
 for(const p of belPlanOptions)select.append(new Option('Tydzień '+p.week+'/'+p.year+' · '+p.routeCode,p.id));
 select.value=belPlan?.id||'';
 bel('belPlanReload').disabled=belPlanLoading;
 const root=bel('belPlanRows');root.replaceChildren();
 if(!belPlan)return;
 const remainingLines=lines.filter(x=>x.remaining>0);
 if(!remainingLines.length){root.append(node('p','Wszystkie pozycje zostały wydane.','bel-plan-complete'));return;}
 const header=node('div',null,'bel-plan-row bel-plan-header');for(const v of ['Pozycja','Do wydania'])header.append(node('span',v));root.append(header);
 for(const x of remainingLines){
  const row=node('div',null,'bel-plan-row');row.append(node('span',x.displayName),node('strong',String(x.remaining),'bel-plan-qty'));root.append(row);
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


const SUPPLY_PREFIX='gpbs-belleville-supply-draft-v1:';
let supplySelection=null;
function supplyKey(){const id=loadState()?.team?.id;return id?SUPPLY_PREFIX+encodeURIComponent(String(id)):null;}
function getSupplyDraft(){
 if(!canBellevilleOperation('EKIPY'))return null;
 try{const key=supplyKey(),d=key?JSON.parse(localStorage.getItem(key)||'null'):null;return d?.owner===String(loadState()?.team?.id)&&Array.isArray(d.lines)&&d.team?d:null;}catch{return null;}
}
function saveSupplyDraft(d){
 const key=supplyKey();if(!key||!canBellevilleOperation('EKIPY')||d.owner!==String(loadState()?.team?.id))return false;
 try{localStorage.setItem(key,JSON.stringify(d));return true;}catch{belAlert('Nie udało się zapisać danych w pamięci telefonu.');return false;}
}
function supplyCatalog(){const items=loadState()?.startData?.czesciBelleville;return Array.isArray(items)?items:[];}
function supplyNorm(x){return String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/gi,'l').toLowerCase().trim();}
function supplyMatches(query){
 const q=supplyNorm(query);if(!q)return [];
 const words=q.split(/\s+/);
 return supplyCatalog().map(p=>{const name=supplyNorm(p.nazwa),codes=[p.indeks,p.sap,...(p.kody||[])].map(supplyNorm);const hay=[name,...codes].join(' ');
 if(words.every(w=>hay.includes(w)))return {p,score:codes.includes(q)?0:name.startsWith(q)?1:2};
 // Match one omitted/substituted letter only in a name word, never in an index.
 if(words.length===1&&q.length>=3&&name.split(/[^a-z0-9]+/).some(w=>{
   const n=w.slice(0,q.length+1);for(const candidate of [n,n.slice(0,q.length),n.slice(0,q.length-1)]){
    if(!candidate||Math.abs(candidate.length-q.length)>1)continue;
    let a=0,b=0,d=0;while(a<q.length&&b<candidate.length){if(q[a]===candidate[b]){a++;b++;continue;}if(++d>1)break;if(q.length>candidate.length)a++;else if(q.length<candidate.length)b++;else{a++;b++;}}
    if(d+(q.length-a)+(candidate.length-b)<=1)return true;
   }return false;
 }))return {p,score:3};
 return null;}).filter(Boolean).sort((a,b)=>a.score-b.score||a.p.nazwa.localeCompare(b.p.nazwa,'pl')).map(x=>x.p).slice(0,30);
}
function startSupply(event){
 event.preventDefault();if(!canBellevilleOperation('EKIPY'))return;
 if(getSupplyDraft()){openSupplyWork();return;}
 const team=bel('belSupplyTeam').value.trim().toUpperCase();if(!team)return;
 const owner=String(loadState()?.team?.id||'');if(!owner)return;
 if(saveSupplyDraft({owner,team,startedAt:new Date().toISOString(),lines:[]}))openSupplyWork();
}
function openSupplyWork(){supplySelection=null;bel('belSupplyQuery').value='';showBellevilleView('supply');}
function renderSupplyMatches(){
 const box=bel('belSupplyMatches'),q=bel('belSupplyQuery').value.trim(),catalog=supplyCatalog();box.replaceChildren();box.classList.toggle('hidden',!q||!catalog.length);
 if(!q||!catalog.length)return;
 const matches=supplyMatches(q);if(!matches.length){box.append(node('p','Brak pasujących części.','bel-empty'));return;}
 for(const p of matches){
  const button=node('button',null,'bel-supply-match');button.type='button';button.append(node('span',p.nazwa),node('small',[p.indeks,p.sap&&p.sap!==p.indeks?'SAP '+p.sap:''].filter(Boolean).join(' · ')));
  button.addEventListener('click',()=>selectSupplyPart(p));box.append(button);
 }
}
function renderSupply(){
 const d=getSupplyDraft();if(!d){showBellevilleView('menu');return;}
 bel('belSupplyCode').textContent=d.team;
 const catalog=supplyCatalog(),status=bel('belSupplyStatus');status.classList.toggle('hidden',!!catalog.length);
 status.textContent=catalog.length?'':'Brak katalogu części. Wróć do menu i odśwież aplikację przy połączeniu z internetem.';
 bel('belSupplyScan').disabled=!catalog.length;
 const root=bel('belSupplyRows');root.replaceChildren();
 if(!d.lines.length)root.append(node('p','Brak zarejestrowanych pozycji','bel-empty'));
 for(const [i,l] of d.lines.entries()){
  const row=node('div',null,'bel-supply-row'),edit=node('button',l.name);edit.type='button';edit.setAttribute('aria-label','Edytuj '+l.name);edit.onclick=()=>selectSupplyPart({id:l.partId,nazwa:l.name,indeks:l.index},i);
  const qty=node('span',(l.direction==='PZ'?'+':'−')+l.qty,l.direction.toLowerCase());
  const remove=node('button','×');remove.type='button';remove.setAttribute('aria-label','Usuń '+l.name);remove.onclick=async()=>{
   if(!await belConfirm('Czy usunąć pozycję?'))return;
   const current=getSupplyDraft();if(!current)return;current.lines.splice(i,1);if(saveSupplyDraft(current))renderSupply();
  };row.append(edit,qty,remove);root.append(row);
 }
 renderSupplyMatches();
}
function selectSupplyPart(part,index=null){
 const d=getSupplyDraft();if(!d||!part?.id)return;
 supplySelection={part,index,owner:d.owner,team:d.team};
 bel('belSupplyPartName').textContent=part.nazwa;
 const qty=bel('belSupplyQty');qty.value=index===null?'':String(d.lines[index]?.qty||'');
 for(const [id,direction] of [['belSupplyPz','PZ'],['belSupplyWz','WZ']])bel(id).classList.toggle('hidden',!canBellevilleOperation(direction));
 bel('belSupplyQtyDialog').showModal();qty.focus();
}
function submitSupplyQty(event){
 event.preventDefault();const d=getSupplyDraft(),selection=supplySelection;
 const dir=event.submitter?.value;if(!d||!selection||selection.owner!==d.owner||selection.team!==d.team||!['PZ','WZ'].includes(dir)||!canBellevilleOperation(dir))return;
 const qty=Number(bel('belSupplyQty').value);
 if(!Number.isSafeInteger(qty)||qty<1||qty>100000)return;
 const p=selection.part,line={partId:p.id,name:p.nazwa,index:p.indeks||'',direction:dir,qty};
 if(selection.index===null)d.lines.push(line);else if(d.lines[selection.index])d.lines[selection.index]=line;else return;
 if(!saveSupplyDraft(d))return;
 bel('belSupplyQtyDialog').close();supplySelection=null;bel('belSupplyQuery').value='';renderSupply();
}
function scanSupply(){
 if(!getSupplyDraft()||!supplyCatalog().length)return;
 window.gpbsOpenSupplyScanner?.(code=>{
  const q=String(code||'').replace(/\u0000/g,'').trim().toUpperCase();
  const matches=supplyCatalog().filter(p=>(p.kody||[]).some(k=>String(k).toUpperCase()===q));
  if(matches.length!==1)return null;
  return ()=>selectSupplyPart(matches[0]);
 });
}
function finishSupply(){
 const d=getSupplyDraft();if(!d)return;
 bel('belSupplySummary').textContent='Ekipa '+d.team+' · Przyjęcie: '+d.lines.filter(x=>x.direction==='PZ').reduce((n,x)=>n+x.qty,0)+' szt. · Wydanie: '+d.lines.filter(x=>x.direction==='WZ').reduce((n,x)=>n+x.qty,0)+' szt.';
 bel('belSupplyFinishDialog').showModal();
}
function confirmSupply(){
 const d=getSupplyDraft(),key=supplyKey();if(!d||!key)return;
 try{localStorage.removeItem(key);}catch{belAlert('Nie udało się zakończyć zaopatrzenia.');return;}
 bel('belSupplyFinishDialog').close();supplySelection=null;showBellevilleView('menu');bel('bellevilleInfo').textContent='Zaopatrzenie testowe zakończone.';bel('bellevilleInfo').classList.remove('hidden');
}


const MODULE_INV_PREFIX='gpbs-belleville-module-inventory-v1:';
const MODULE_INV_TYPES=['FM','LQ','RQ','XS','ODL','ODR','CU','DUO','HICU','HIDUO','HI UNO','CU RJ45','HICU RJ45','BQ CU','BQ DUO','BQ CU OUT','BQ DUO OUT','NEW GEN CU','NEW GEN DUO L','NEW GEN DUO R'];
let invEdit=null;
function moduleInvOwner(){return String(loadState()?.team?.id||'');}
function moduleInvKey(){return MODULE_INV_PREFIX+encodeURIComponent(moduleInvOwner());}
function getModuleInventory(){
 if(!canBellevilleOperation('INVENTORY')||!moduleInvOwner())return null;
 try{const d=JSON.parse(localStorage.getItem(moduleInvKey())||'null');return d?.owner===moduleInvOwner()&&Array.isArray(d.rows)?d:null;}catch{return null;}
}
function saveModuleInventory(d){
 if(!canBellevilleOperation('INVENTORY')||!moduleInvOwner()||d.owner!==moduleInvOwner())return false;
 try{localStorage.setItem(moduleInvKey(),JSON.stringify(d));return true;}catch{belAlert('Nie udało się zapisać inwentaryzacji w pamięci telefonu.');return false;}
}
let moduleInvRefresh=null;
async function openModuleInventory(){
 if(!canBellevilleOperation('INVENTORY'))return;
 if(!getModuleInventory()&&!saveModuleInventory({owner:moduleInvOwner(),startedAt:new Date().toISOString(),status:null,rows:[]}))return;
 showBellevilleView('moduleInventory');
 if(navigator.onLine&&typeof window.gpbsRefreshModulePrefixes==='function'){
  const pending=window.gpbsRefreshModulePrefixes();moduleInvRefresh=pending;
  bel('belInvScan').disabled=true;
  try{await pending;}catch(error){console.warn('Nie udało się odświeżyć prefiksów modułów.',error);}
  finally{if(moduleInvRefresh===pending){moduleInvRefresh=null;if(bellevilleView==='moduleInventory')renderModuleInventory();}}
 }
}
function moduleInvSerial(x){return String(x||'').replace(/[\u0000\s]/g,'').toUpperCase();}
function moduleInvDisplaySerial(value){
 const serial=moduleInvSerial(value);
 const match=serial.match(/^(.*?)(\d+)$/);
 if(!match||match[2].length<6)return {leading:serial,emphasis:''};
 const prefix=match[1],digits=match[2],head=digits.slice(0,-6),tail=digits.slice(-6);
 const grouped=head.replace(/\B(?=(\d{3})+(?!\d))/g,' ');
 return {leading:[prefix,grouped].filter(Boolean).join(' ')+(prefix||head?' ':''),emphasis:tail.slice(0,3)+' '+tail.slice(3)};
}
function moduleInvValidSerial(s){return s.length>0&&s.length<=100&&/^[A-Z0-9][A-Z0-9 ._/-]*$/.test(s)&&!s.includes('://');}
function moduleInvPrefixes(){const d=loadState()?.startData;const p=d?.modulePrefixCandidates??d?.modulePrefixes;return Array.isArray(p)?p:[];}
function moduleInvMatches(serial){
 const afterYear=moduleInvSerial(serial).replace(/^(?:[0-9]{4}|[0-9]{2})\//,'');
 const matches=moduleInvPrefixes().filter(p=>p.prefix&&p.moduleType&&afterYear.startsWith(String(p.prefix).trim().toUpperCase())).map(p=>({...p,prefix:String(p.prefix).trim().toUpperCase(),moduleType:String(p.moduleType).trim().toUpperCase()}));
 const max=Math.max(0,...matches.map(p=>p.prefix.length));
 return [...new Map(matches.filter(p=>p.prefix.length===max).map(p=>[p.typeId||p.moduleType,p])).values()];
}
function moduleInvType(serial){const matches=moduleInvMatches(serial);return matches.length===1?matches[0].moduleType:'';}
function openModuleInvChoices(serial,status,matches){
 const dialog=bel('belInvChoiceDialog'),root=bel('belInvChoices'),d=getModuleInventory();
 if(!d)return;
 const display=moduleInvDisplaySerial(serial);bel('belInvChoiceSerial').textContent=display.leading+display.emphasis;
 root.replaceChildren();
 for(const p of matches){
  const button=node('button',null,'btn gpbs-menu-btn bel-inv-choice');button.type='button';
  button.append(node('strong',p.typeName||p.moduleType));
  if(p.groupName)button.append(node('small',p.groupName));
  button.onclick=()=>{
   const current=getModuleInventory();
   if(bellevilleView!=='moduleInventory'||current?.owner!==d.owner||current?.startedAt!==d.startedAt){dialog.close();return;}
   if(addModuleInvRow(serial,p.moduleType,status))dialog.close();
  };
  root.append(button);
 }
 dialog.showModal();
}
function renderModuleInventory(){
 const d=getModuleInventory();if(!d){showBellevilleView('inventory');return;}
 for(const b of document.querySelectorAll('[data-bel-inv-status]')){
  const status=b.dataset.belInvStatus;
  b.textContent=status+' ('+d.rows.filter(r=>r.status===status).length+')';b.setAttribute('aria-pressed',String(d.status===status));
 }
 const scan=bel('belInvScan');scan.dataset.status=d.status||'';scan.querySelector('span').textContent=d.status?'Skanuj moduł '+d.status:'Skanuj moduł';scan.disabled=!d.status||!!moduleInvRefresh;
 const root=bel('belInvRows');root.replaceChildren();
 const visible=d.rows.filter(r=>r.status===d.status);
 if(!visible.length)root.append(node('p',d.status?'Brak zeskanowanych modułów '+d.status+'.':'Wybierz OK lub NOK.','bel-empty'));
 for(const r of [...visible].reverse()){
  const line=node('div',null,'bel-row'),edit=node('button',null,'bel-inv-edit'),display=moduleInvDisplaySerial(r.serial);
  edit.append(document.createTextNode(display.leading));if(display.emphasis)edit.append(node('strong',display.emphasis,'bel-inv-serial-emphasis'));
  edit.type='button';edit.setAttribute('aria-label','Edytuj moduł '+r.serial);edit.onclick=()=>openModuleInvEntry(r.serial,r);
  const remove=node('button','×');remove.type='button';remove.setAttribute('aria-label','Usuń moduł '+r.serial);remove.onclick=async()=>{
   if(!await belConfirm('Czy usunąć pozycję?'))return;
   const current=getModuleInventory();if(!current)return;current.rows=current.rows.filter(x=>x.serial!==r.serial);if(saveModuleInventory(current))renderModuleInventory();
  };
  line.append(node('span',r.type),edit,node('span',r.status,r.status.toLowerCase()),remove);root.append(line);
 }
}
function selectModuleInvStatus(status){
 const d=getModuleInventory();if(!d||!['OK','NOK'].includes(status))return;d.status=status;if(saveModuleInventory(d))renderModuleInventory();
}
function openModuleInvEntry(serial='',existing=null){
 const d=getModuleInventory();if(!d)return;
 invEdit=existing?.serial||null;
 bel('belInvEntryTitle').textContent=existing?'Edytuj moduł':serial?'Wybierz typ modułu':'Dodaj moduł ręcznie';
 bel('belInvSerial').value=serial;
 const types=bel('belInvType');types.replaceChildren(new Option('Wybierz typ',''));
 const catalogue=loadState()?.startData?.moduleCatalogTypes;
  const options=[...new Set([...(Array.isArray(catalogue)&&catalogue.length?catalogue.map(t=>t.scannerLabel):MODULE_INV_TYPES),...moduleInvPrefixes().map(p=>String(p.moduleType||'').trim().toUpperCase()),existing?.type].filter(Boolean))];
 for(const type of options)types.append(new Option(type,type));
 types.value=existing?.type||moduleInvType(serial)||'';
 bel('belInvState').value=existing?.status||d.status||'';
 bel('belInvEntryDialog').showModal();(serial?types:bel('belInvSerial')).focus();
}
function addModuleInvRow(serial,type,status,edit=null){
 const d=getModuleInventory();if(!d||!moduleInvValidSerial(serial)||!type||!['OK','NOK'].includes(status))return false;
 const duplicate=d.rows.find(r=>moduleInvSerial(r.serial)===serial&&r.serial!==edit);
 if(duplicate){belAlert('Ten moduł jest już na liście '+duplicate.status+'.');return false;}
 const row={serial,type,status};
 if(edit){const i=d.rows.findIndex(r=>r.serial===edit);if(i<0)return false;d.rows[i]=row;}else d.rows.push(row);
 d.status=status;if(!saveModuleInventory(d))return false;renderModuleInventory();return true;
}
function submitModuleInvEntry(event){
 event.preventDefault();
 const serial=moduleInvSerial(bel('belInvSerial').value),type=bel('belInvType').value,status=bel('belInvState').value;
 if(!moduleInvValidSerial(serial)){belAlert('Nieprawidłowy numer seryjny.');return;}
 if(addModuleInvRow(serial,type,status,invEdit)){bel('belInvEntryDialog').close();invEdit=null;}
}
function scanModuleInventory(){
 const d=getModuleInventory();if(!d||!d.status||moduleInvRefresh)return;
 const owner=d.owner,startedAt=d.startedAt,status=d.status;
 if(typeof window.gpbsOpenModuleInventoryScanner!=='function'){belAlert('Skaner jest niedostępny.');return;}
 window.gpbsOpenModuleInventoryScanner(code=>{
  const current=getModuleInventory();if(bellevilleView!=='moduleInventory'||current?.owner!==owner||current?.startedAt!==startedAt)return;
  const serial=moduleInvSerial(code);
  if(!moduleInvValidSerial(serial)){belAlert('Nieprawidłowy kod QR modułu.');return;}
  if(supplyCatalog().some(p=>(p.kody||[]).some(k=>moduleInvSerial(k)===serial))){belAlert('To kod części, nie modułu.');return;}
  const existing=current.rows.find(r=>moduleInvSerial(r.serial)===serial);if(existing){belAlert('Ten moduł jest już na liście '+existing.status+'.');return;}
  const matches=moduleInvMatches(serial);
   if(matches.length===1){addModuleInvRow(serial,matches[0].moduleType,status);return;}
   if(matches.length>1){openModuleInvChoices(serial,status,matches);return;}
  openModuleInvEntry(serial);
  bel('belInvState').value=status;
 });
}
async function finishModuleInventory(){
 const d=getModuleInventory();if(!d)return;
 const ok=d.rows.filter(r=>r.status==='OK').length,nok=d.rows.length-ok;
 if(!await belConfirm('Zakończyć inwentaryzację testową? OK: '+ok+', NOK: '+nok+'. Dane robocze zostaną wyczyszczone. Stany D1 nie zmienią się.'))return;
 const current=getModuleInventory();if(!current||current.startedAt!==d.startedAt||current.owner!==d.owner)return;
 try{localStorage.removeItem(moduleInvKey());}catch{belAlert('Nie udało się zakończyć inwentaryzacji.');return;}
 showBellevilleView('inventory');
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
  document.querySelectorAll('[data-bel-ocr]').forEach(b=>b.addEventListener('click',()=>belAlert('OCR tablic zostanie podłączony później.')));
  bel('belManual').addEventListener('click',openBellevilleEntry);
  bel('belScan').addEventListener('click',()=>{if(belTab==='modules')openTransportModule(true);else belAlert('Skanowanie części zostanie podłączone osobno. Na razie użyj opcji Ręcznie.');});
  document.querySelectorAll('[data-bel-module-mode]').forEach(b=>b.addEventListener('click',()=>chooseTransportScanMode(b.dataset.belModuleMode)));
  bel('belModuleCapture').addEventListener('click',captureModuleOcr);
  bel('belModuleRotate').addEventListener('click',rotateModuleOcr);
  bel('belModuleSerial').addEventListener('input',()=>refreshTransportModuleTypes());
  bel('belModuleScanForm').addEventListener('submit',submitTransportModule);
  bel('belModuleScanDialog').addEventListener('close',()=>{void stopModuleCapture();transportModuleEdit=null;});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&bel('belModuleScanDialog').open){void stopModuleCapture();bel('belModuleScanStatus').textContent='Aparat wyłączony. Wybierz ponownie OCR lub QR.';}});
  window.addEventListener('pagehide',()=>{if(bel('belModuleScanDialog').open)void stopModuleCapture();});
  bel('belEntryForm').addEventListener('submit',saveBellevilleEntry);
  bel('belOperationFinish').addEventListener('click',finishBellevilleOperation);
  bel('belOther').addEventListener('click',continueBellevilleOther);
  bel('belFinalConfirm').addEventListener('click',confirmBellevilleFinish);
  bel('belPlanOpen').addEventListener('click',()=>{renderBellevillePlan();bel('belPlanDialog').showModal();if(!belPlan&&!belPlanOptions.length&&!belPlanLoading)void loadBellevillePlan();});
  bel('belPlanSelect').addEventListener('change',()=>{const id=bel('belPlanSelect').value;if(id)chooseBellevillePlan(id);else renderBellevillePlan();});
  bel('belPlanReload').addEventListener('click',()=>{if(!belPlanLoading)void loadBellevillePlan();});
  bel('belSupplyTeam').addEventListener('input',()=>{bel('belSupplyTeam').value=bel('belSupplyTeam').value.toUpperCase();});
  bel('belSupplyForm').addEventListener('submit',startSupply);
  bel('belSupplyBack').addEventListener('click',backBellevilleView);
  bel('belSupplyQuery').addEventListener('input',renderSupplyMatches);
  bel('belSupplyScan').addEventListener('click',scanSupply);
  bel('belSupplyQty').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}});
  bel('belSupplyQtyForm').addEventListener('submit',submitSupplyQty);
  bel('belSupplyFinish').addEventListener('click',finishSupply);
  bel('belSupplyConfirm').addEventListener('click',confirmSupply);
  bel('belMessageNo').addEventListener('click',()=>bel('belMessageDialog').close('no'));
  bel('belMessageYes').addEventListener('click',()=>bel('belMessageDialog').close('yes'));
  bel('belMessageDialog').addEventListener('cancel',event=>{event.preventDefault();bel('belMessageDialog').close('no');});
  bel('belMessageDialog').addEventListener('close',()=>{const dialog=bel('belMessageDialog'),resolve=belMessageResolve;belMessageResolve=null;resolve?.(dialog.returnValue==='yes');});
  bel('belInventoryModules').addEventListener('click',openModuleInventory);
  bel('belInvBack').addEventListener('click',backBellevilleView);
  document.querySelectorAll('[data-bel-inv-status]').forEach(b=>b.addEventListener('click',()=>selectModuleInvStatus(b.dataset.belInvStatus)));
  bel('belInvManual').addEventListener('click',()=>openModuleInvEntry());
  bel('belInvScan').addEventListener('click',scanModuleInventory);
  bel('belInvEntryForm').addEventListener('submit',submitModuleInvEntry);
  bel('belInvFinish').addEventListener('click',finishModuleInventory);
  bel('belInventoryParts').addEventListener('click',()=>{if(canBellevilleOperation('INVENTORY'))belAlert('Inwentaryzacja części zostanie przygotowana w kolejnym etapie.');});
  window.gpbsBellevilleBack = backBellevilleView;
  updateRoleControls();
  observeVisitScreen();
  observeWarehouseScreen();
});
