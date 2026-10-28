// GPBS Storage — office/admin web panel. Never stores PINs or passwords.
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const state = {view:'summary', records:[], warehouses:[], currentPartsWarehouse:'PL-TYCHY', loggedIn:false, expandedUserId:null, pinReady:false, generatedPinText:'', showArchives:false};
  const defs = {
    summary:['Pulpit','Przegląd operacji i magazynów.'],
    warehouses:['Magazyny','Aktualne stany magazynów w Polsce.'],
    parts:['Katalog części','Pełny katalog i stany części w wybranym magazynie.'],
    movements:['Ruchy PZ / WZ','Historia przyjęć i wydań z zapisem ilości przed i po.'],
    users:['Użytkownicy','Role, przypisania magazynów i dostęp do systemu.'],
    security:['Bezpieczeństwo','Zabezpieczenie sesji administratora.']
  };

  async function api(view) {
    const url='/api/panel?view='+encodeURIComponent(view)+
      (view==='parts'?'&warehouse='+encodeURIComponent(state.currentPartsWarehouse):'')+
      (view==='users'&&state.showArchives?'&archived=1':'');
    const res=await fetch(url,{cache:'no-store',credentials:'same-origin'});
    let json=null;
    try{json=await res.json();}catch{}
    if(res.status===401){logoutLocally();throw new Error('Sesja wygasła. Zaloguj się ponownie.');}
    if(!res.ok||!json?.ok)throw new Error(json?.error||'Serwer nie odpowiedział.');
    return json.data;
  }

  async function post(body) {
    const res=await fetch('/api/panel',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials:'same-origin',
      cache:'no-store',
      body:JSON.stringify(body)
    });
    let json=null;
    try{json=await res.json();}catch{}
    if(res.status===401&&body.action!=='login')logoutLocally();
    if(!res.ok||!json?.ok)throw new Error(json?.error||'Operacja nie powiodła się.');
    return json;
  }

  function logoutLocally() {
    state.loggedIn=false;
    $('app').classList.add('hidden');
    $('loginWrap').classList.remove('hidden');
    $('panelPin').value='';
    $('panelPassword').value='';
  }

  function setError(message) {
    $('loginError').textContent=message;
    $('loginError').classList.toggle('hidden',!message);
  }

  function message(text='',kind='info') {
    const target=$('message');
    target.textContent=text;
    target.className=text?'message '+kind:'message hidden';
  }

  // Replaces browser-native confirms, whose text size cannot be styled.
  // Every dialog resolves to false on Escape or cancellation.
  function confirmAction({title,description,confirmLabel='Potwierdź',danger=false}) {
    const dialog=$('confirmDialog');
    if(dialog.open)return Promise.resolve(false);
    const approve=$('approveConfirmation');
    const cancel=$('cancelConfirmation');
    $('confirmTitle').textContent=title;
    $('confirmDescription').textContent=description;
    approve.textContent=confirmLabel;
    approve.className='btn '+(danger?'archive-danger':'primary');

    return new Promise(resolve=>{
      const finish=accepted=>{
        dialog.removeEventListener('cancel',onEscape);
        dialog.removeEventListener('close',onClose);
        approve.removeEventListener('click',onApprove);
        cancel.removeEventListener('click',onDismiss);
        if(dialog.open)dialog.close();
        resolve(accepted);
      };
      const onApprove=()=>finish(true);
      const onDismiss=()=>finish(false);
      const onEscape=event=>{event.preventDefault();finish(false);};
      const onClose=()=>finish(false);
      dialog.addEventListener('cancel',onEscape);
      dialog.addEventListener('close',onClose);
      approve.addEventListener('click',onApprove);
      cancel.addEventListener('click',onDismiss);
      dialog.showModal();
      cancel.focus();
    });
  }

  function busy(button,yes) {
    if(button)button.disabled=Boolean(yes);
  }

  function td(text,kind='') {
    const cell=document.createElement('td');
    cell.textContent=String(text??'—');
    if(kind)cell.className=kind;
    return cell;
  }

  function pill(text,type='') {
    const element=document.createElement('span');
    element.className='pill '+type;
    element.textContent=text;
    return element;
  }

  function formatNum(value) {
    return Number(value||0).toLocaleString('pl-PL');
  }

  function formatTimestampPL(value) {
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))
      return value||'—';
    const date=new Date(value.replace(' ','T')+'Z');
    if(Number.isNaN(date.valueOf()))return value;
    return new Intl.DateTimeFormat('pl-PL',{
      timeZone:'Europe/Warsaw',day:'2-digit',month:'2-digit',year:'numeric',
      hour:'2-digit',minute:'2-digit'
    }).format(date);
  }

  function buildTable(columns,rows) {
    const table=document.createElement('table');
    const head=table.createTHead().insertRow();
    for(const title of columns){const cell=document.createElement('th');cell.textContent=title;head.append(cell);}
    const body=table.createTBody();
    for(const cols of rows) {
      const tr=body.insertRow();
      for(const col of cols) {
        if(col && col.nodeType){const cell=tr.insertCell();cell.append(col);}
        else tr.append(td(col));
      }
    }
    return table;
  }

  function warehouseRows(items) {
    return items.map(row=>[
      row.name,
      row.id,
      row.active?pill('Aktywny','green'):pill('Testowy / nieaktywny','red'),
      Number(row.positions)===0?'Nieustalony':formatNum(row.positions),
      Number(row.positions)===0?'Nieustalony':formatNum(row.units)+' szt.'
    ]);
  }

  function displayWarehouses(items,target) {
    const element=$(target);
    element.replaceChildren(
      buildTable(['MAGAZYN','ID','STATUS','POZYCJE','ŁĄCZNY STAN'],warehouseRows(items))
    );
  }

  function renderSummary(summary,warehouses) {
    const stats=[
      ['Aktywne magazyny',summary.warehouses,'POLSKA'],
      ['Części w katalogu',summary.parts,'KATALOG CENTRALNY'],
      ['Zapisane operacje',summary.operations,'HISTORIA PZ / WZ'],
      ['Aktywni użytkownicy',summary.users,'BAZA D1']
    ];
    $('statGrid').replaceChildren(...stats.map(([label,number,hint])=>{
      const card=document.createElement('article');card.className='stat-card';
      const a=document.createElement('div');a.className='stat-label';a.textContent=label;
      const b=document.createElement('div');b.className='stat-value';b.textContent=formatNum(number);
      const c=document.createElement('div');c.className='stat-caption';c.textContent=hint;
      card.append(a,b,c);return card;
    }));
    displayWarehouses(warehouses,'dashboardWarehouses');
  }

  function colsFor(view,items) {
    if(view==='warehouses')return [ ['MAGAZYN','ID','STATUS','POZYCJE','ŁĄCZNY STAN'],warehouseRows(items) ];
    if(view==='parts')return [
      ['NAZWA CZĘŚCI','INDEKS GPBS / MAG.','SAP','ILOŚĆ'],
      items.map(p=>[p.name,p.part_number||'—',p.sap_number||'—',
        p.quantity===null||p.quantity===undefined?'Nieustalony':formatNum(p.quantity)+' szt.'])
    ];
    if(view==='movements')return [
      ['DATA (PL)','SESJA / DOKUMENT','TYP','MAGAZYN','EKIPA / DOSTAWCA / ODBIORCA',
        'CZĘŚĆ','ZMIANA','PRZED','PO','PRACOWNIK'],
      items.map(m=>[
        formatTimestampPL(m.created_at),m.session_id||m.id,
        m.operation_type==='PZ'?pill('PZ','green'):pill('WZ','red'),
        m.warehouse_id,m.recipient_name||'—',
        (m.part_name||m.part_number||'—')+(m.part_number?' · '+m.part_number:''),
        Number(m.quantity_delta)>0?'+'+m.quantity_delta:m.quantity_delta,
        m.quantity_before,m.quantity_after,m.operator_name||m.operator_id||'—'
      ])
    ];
    return [[],[]];
  }

  // Keep exactly the original six columns. Click the row to reveal
  // one extra line containing ONLY optional contact details.
  function renderUsersTable(users) {
    const table=document.createElement('table');
    table.className='users-table';
    const header=table.createTHead().insertRow();
    for(const title of ['UŻYTKOWNIK','ROLA','MAGAZYNY','PIN','STATUS','']) {
      const th=document.createElement('th');th.textContent=title;header.append(th);
    }
    const tbody=table.createTBody();

    for(const user of users) {
      const row=tbody.insertRow();row.className='user-main-row';
      const detail=tbody.insertRow();detail.className='user-details-row';
      const open=state.expandedUserId===user.id;
      detail.hidden=!open;

      const name=td('');
      const button=document.createElement('button');
      button.type='button';
      button.className='user-expand-button';
      button.setAttribute('aria-expanded',String(open));
      button.setAttribute('aria-label',(open?'Zwiń':'Rozwiń')+' dane użytkownika '+user.name);
      button.textContent=user.name;
      const arrow=document.createElement('span');arrow.className='user-expand-arrow';
      arrow.textContent=open?'▴':'▾';arrow.setAttribute('aria-hidden','true');
      button.append(arrow);name.append(button);
      row.append(name);

      const role=td('');role.append(pill(user.role_code,'blue'));row.append(role);
      row.append(td(user.warehouses||'—'));
      const pin=td('');pin.className='pin-cell';
      pin.append(user.has_pin?pill('Nadany','green'):pill('Brak PIN-u','red'));
      if(user.active&&!state.showArchives) {
        const pinAction=document.createElement('button');
        pinAction.className='btn mini pin-action';
        pinAction.type='button';pinAction.textContent=user.has_pin?'Reset PIN':'Generuj';
        pinAction.title=state.pinReady?(user.has_pin?'Wygeneruj nowy PIN':'Nadaj nowy PIN'):'Najpierw skonfiguruj generator w Bezpieczeństwo';
        pinAction.addEventListener('click',event=>{
          event.stopPropagation();
          generateUserPin(user,Boolean(user.has_pin));
        });
        pin.append(pinAction);
      }
      row.append(pin);
      const status=td('');status.append(state.showArchives?pill('Archiwum','red'):(user.active?pill('Aktywny','green'):pill('Nieaktywny','red')));row.append(status);
      const actions=td('');
      const edit=document.createElement('button');edit.type='button';
      edit.className='btn mini user-edit-button';edit.textContent=state.showArchives?'Przywróć':'Edytuj';
      edit.addEventListener('click',event=>{event.stopPropagation();
        if(state.showArchives)restoreUser(user);
        else openUserDialog(user);
      });
      actions.append(edit);row.append(actions);

      const cell=detail.insertCell();cell.colSpan=6;
      const box=document.createElement('div');box.className='user-details-inner';
      const fields=[
        ['Imię',user.first_name||'—'],
        ['Nazwisko',user.last_name||'—'],
        ['Numer telefonu',user.phone||'—']
      ];
      for(const [title,value] of fields) {
        const field=document.createElement('div');field.className='user-detail-field';
        const label=document.createElement('span');label.className='user-detail-label';
        label.textContent=title;
        const data=document.createElement('span');data.className='user-detail-value';
        if(title==='Numer telefonu' && user.phone) {
          const phone=document.createElement('a');
          phone.href='tel:'+user.phone.replace(/[^0-9+]/g,'');
          phone.textContent=user.phone;
          data.append(phone);
        }else data.textContent=value;
        field.append(label,data);box.append(field);
      }
      cell.append(box);

      function toggle() {
        state.expandedUserId=state.expandedUserId===user.id?null:user.id;
        renderList();
      }
      button.addEventListener('click',event=>{event.stopPropagation();toggle();});
      row.addEventListener('click',event=>{
        if(event.target.closest('.user-edit-button'))return;
        if(event.target.closest('.user-expand-button'))return;
        toggle();
      });
    }
    return table;
  }

  // Newly created warehouse parts stay visible in red until the admin
  // has verified the name, index and optional SAP.
  function renderPartsTable(items) {
    const table=document.createElement('table');
    table.className='parts-review-table';
    const header=table.createTHead().insertRow();
    for(const label of ['NAZWA CZĘŚCI','INDEKS GPBS / MAG.','SAP','ILOŚĆ','WERYFIKACJA','']) {
      const cell=document.createElement('th');
      cell.textContent=label;
      header.append(cell);
    }
    const body=table.createTBody();
    for(const part of items) {
      const row=body.insertRow();
      const pending=part.verification_status==='PENDING';
      if(pending)row.classList.add('part-pending-verification');
      row.append(td(part.name||'—'));
      row.append(td(part.part_number||'—'));
      row.append(td(part.sap_number||'—'));
      row.append(td(part.quantity===null||part.quantity===undefined
        ?'Nieustalony':formatNum(part.quantity)+' szt.'));
      const status=td('');
      status.textContent=pending?'DO WERYFIKACJI':'—';
      status.className=pending?'part-review-status':'';
      row.append(status);
      const action=td('');
      const edit=document.createElement('button');
      edit.type='button';
      edit.className='btn mini';
      edit.textContent=pending?'Sprawdź / edytuj':'Edytuj';
      edit.addEventListener('click',()=>openPartEditor(part));
      action.append(edit);
      row.append(action);
    }
    return table;
  }

  function openPartEditor(part) {
    $('partEditId').value=part.id;
    $('partEditName').value=part.name||'';
    $('partEditNumber').value=part.part_number||'';
    $('partEditSap').value=part.sap_number||'';
    $('partEditVerify').checked=false;
    $('partEditStatus').textContent=part.verification_status==='PENDING'
      ?'Nowa część. Sprawdź nazwę, indeks i SAP przed oznaczeniem jako zweryfikowana.'
      :'Możesz skorygować dane tej części.';
    $('partEditVerify').parentElement.hidden=part.verification_status!=='PENDING';
    $('partEditError').classList.add('hidden');
    $('partEditError').textContent='';
    $('partEditDialog').showModal();
  }

  async function savePartEditor(event) {
    event.preventDefault();
    const button=$('partEditSave');
    button.disabled=true;
    $('partEditError').classList.add('hidden');
    try {
      const result=await post({
        action:'updatePart',
        partId:$('partEditId').value,
        name:$('partEditName').value.trim(),
        number:$('partEditNumber').value.trim(),
        sap:$('partEditSap').value.trim(),
        verify:$('partEditVerify').checked
      });
      $('partEditDialog').close();
      message(result.message||'Zapisano dane części.','success');
      const response=await api('parts');
      state.records=response.parts||[];
      if(state.view==='parts')renderList();
    }catch(error) {
      $('partEditError').textContent=error.message;
      $('partEditError').classList.remove('hidden');
    }finally{button.disabled=false;}
  }

  function renderList() {
    const q=$('tableSearch').value.toLocaleLowerCase('pl').trim();
    const matching=state.records.filter(row=>
      !q||Object.values(row).some(val=>String(val??'').toLocaleLowerCase('pl').includes(q))
    );
    const [columns,rows]=colsFor(state.view,matching);
    $('tableResults').replaceChildren();
    if(!matching.length) {
      const empty=document.createElement('div');empty.className='empty';
      empty.textContent=state.records.length?'Nie znaleziono pasujących pozycji.':'Brak danych do wyświetlenia.';
      $('tableResults').append(empty);
    }else $('tableResults').append(state.view==='users'?renderUsersTable(matching)
      :state.view==='parts'?renderPartsTable(matching):buildTable(columns,rows));
    $('tableFooter').textContent='Wyświetlono '+matching.length+' z '+state.records.length+' pozycji';
  }

  async function loadWarehouses() {
    state.warehouses=await api('warehouses');
    const select=$('warehouseFilter');
    select.replaceChildren();
    for(const w of state.warehouses) {
      const option=document.createElement('option');
      option.value=w.id;option.textContent=w.name+(w.active?'':' (TEST)');
      select.append(option);
    }
    if(!state.warehouses.some(w=>w.id===state.currentPartsWarehouse))
      state.currentPartsWarehouse=state.warehouses.find(w=>w.active)?.id||state.warehouses[0]?.id||'PL-TYCHY';
    select.value=state.currentPartsWarehouse;
  }

  function showView(view) {
    if(!defs[view])return;
    state.view=view;
    $('pageTitle').textContent=defs[view][0];
    $('pageSubtitle').textContent=defs[view][1];
    $('breadcrumbCurrent').textContent=defs[view][0];
    document.title=defs[view][0]+' — GPBS Storage';
    document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
    $('dashboardView').classList.toggle('hidden',view!=='summary');
    $('tableView').classList.toggle('hidden',view==='summary'||view==='security');
    $('securityView').classList.toggle('hidden',view!=='security');
    $('addUserBtn').classList.toggle('hidden',view!=='users'||state.showArchives);
    $('showArchivedUsers').classList.toggle('hidden',view!=='users');
    $('showArchivedUsers').textContent=state.showArchives?'Wróć do użytkowników':'Pokaż archiwum';
    $('generateMissingPins').classList.toggle('hidden',view!=='users'||state.showArchives);
    $('pinRoleFilter').classList.toggle('hidden',view!=='users'||state.showArchives);
    $('warehouseFilter').classList.toggle('hidden',view!=='parts');
    $('tableSearch').value='';
    $('tableTitle').textContent=defs[view][0];
    $('tableDescription').textContent=defs[view][1];
    message();
  }

  async function navigate(view) {
    showView(view);
    closeSide();
    try {
      if(view==='security') return;
      if(view==='summary') {
        const [a,b]=await Promise.all([api('summary'),api('warehouses')]);
        state.warehouses=b;
        if(state.view===view)renderSummary(a,b);
      } else {
        if(view==='parts')await loadWarehouses();
        if(view==='users') {
          const [users,setup]=await Promise.all([api('users'),api('pinStatus')]);
          state.records=users;
          state.pinReady=Boolean(setup.available);
          $('generateMissingPins').textContent=state.pinReady?'Generuj brakujące PIN-y':'Skonfiguruj generator PIN-ów';
        } else {
          const response=await api(view);
          state.records=view==='parts'?response.parts:response;
        }
        if(state.view===view)renderList();
      }
    } catch(error){message(error.message,'error');}
  }

  function closeSide() {
    $('sidebar').classList.remove('open');
    $('sideOverlay').classList.add('hidden');
  }

  function randomSessionKey() {
    // 48 random bytes -> 64-character base64 secret. Never sent to server.
    const bytes=new Uint8Array(48);
    crypto.getRandomValues(bytes);
    let str='';
    for(const byte of bytes)str+=String.fromCharCode(byte);
    return btoa(str);
  }

  function generateSessionKey() {
    $('sessionSecretOutput').value=randomSessionKey();
    $('copySessionSecret').disabled=false;
    message('Wygenerowano nowy, prywatny klucz. Skopiuj go i wklej do Cloudflare.', 'info');
  }

  async function copySessionKey() {
    const field=$('sessionSecretOutput');
    if(!field.value)return;
    try {
      await navigator.clipboard.writeText(field.value);
      message('Skopiowano klucz. Wklej go do Cloudflare jako PANEL_SESSION_SECRET.', 'info');
    }catch {
      field.type='text';field.focus();field.select();
      message('Zaznaczony klucz skopiuj skrótem Ctrl+C i wklej do Cloudflare.', 'info');
    }
  }

  async function openUserDialog(existing=null) {
    try {
      const [roles,warehouses]=await Promise.all([
        api('roles'),api('warehouseOptions')
      ]);
      const form=$('createUserForm');form.reset();
      $('editUserId').value=existing?.id||'';
      $('userDialogTitle').textContent=existing?'Edytuj użytkownika':'Nowy użytkownik';
      $('userName').value=existing?.name||'';
      $('userFirstName').value=existing?.first_name||'';
      $('userLastName').value=existing?.last_name||'';
      $('userPhone').value=existing?.phone||'';
      $('userStatusRow').hidden=!existing;
      $('userStatus').value=existing?(existing.active?'1':'0'):'1';
      $('archiveUserBtn').hidden=!existing;

      const roleInput=$('userRole');roleInput.replaceChildren();
      for(const role of roles) {
        const option=document.createElement('option');
        option.value=role.code;option.textContent=role.name;
        roleInput.append(option);
      }
      if(existing)roleInput.value=existing.role_code;

      const assigned=new Set((existing?.warehouses||'').split(',').map(x=>x.trim()).filter(Boolean));
      const field=$('userWarehouses');field.replaceChildren();
      const legend=document.createElement('legend');
      legend.textContent='Dostęp do magazynów';field.append(legend);
      for(const warehouse of warehouses.filter(w=>w.active||assigned.has(w.id))) {
        const row=document.createElement('div');row.className='checkbox-row';
        const checkbox=document.createElement('input');
        checkbox.type='checkbox';checkbox.value=warehouse.id;
        checkbox.id='grant-'+warehouse.id;
        checkbox.checked=assigned.has(warehouse.id);
        const label=document.createElement('label');label.htmlFor=checkbox.id;
        label.textContent=warehouse.name+' ('+warehouse.country_code+')'+(warehouse.active?'':' — nieaktywny');
        row.append(checkbox,label);field.append(row);
      }
      $('userDialog').showModal();
    }catch(error){message(error.message,'error');}
  }

  async function saveUser(event) {
    event.preventDefault();
    const button=$('saveUser');busy(button,true);
    try{
      const warehouses=[...$('userWarehouses').querySelectorAll('input:checked')].map(x=>x.value);
      const userId=$('editUserId').value;
      const body={
        action:userId?'updateStaff':'createStaff',
        nickname:$('userName').value.trim(),
        firstName:$('userFirstName').value.trim(),
        lastName:$('userLastName').value.trim(),
        phone:$('userPhone').value.trim(),
        role:$('userRole').value,
        warehouses,
        ...(userId?{userId,active:Number($('userStatus').value)}:{})
      };
      await post(body);
      $('userDialog').close();
      state.records=await api('users');
      if(state.view==='users')renderList();
      message(userId?'Zapisano zmiany użytkownika.':'Dodano użytkownika bez PIN-u.','info');
    }catch(error){message(error.message,'error');}
    finally{busy(button,false);}
  }

  async function archiveCurrentUser() {
    const id=$('editUserId').value;
    const nickname=$('userName').value;
    if(!id)return;
    if(!await confirmAction({
      title:'Usunąć użytkownika '+nickname+' z listy?',
      description:'Konto zostanie przeniesione do archiwum, zdezaktywowane i utraci PIN. Jego ID i historia operacji pozostaną zapisane.',
      confirmLabel:'Usuń z listy',danger:true
    }))return;
    const button=$('archiveUserBtn');busy(button,true);
    try {
      await post({action:'archiveUser',userId:id});
      $('userDialog').close();
      state.expandedUserId=null;
      state.records=await api('users');
      if(state.view==='users')renderList();
      message('Użytkownik '+nickname+' jest w archiwum. Zachowano ID i historię.','info');
    } catch(error) {message(error.message,'error');}
    finally{busy(button,false);}
  }

  async function restoreUser(user) {
    if(!await confirmAction({
      title:'Przywrócić '+user.name+' z archiwum?',
      description:'Konto pozostanie nieaktywne i będzie wymagać nadania nowego PIN-u.',
      confirmLabel:'Przywróć'
    }))return;
    try {
      await post({action:'restoreUser',userId:user.id});
      state.expandedUserId=null;
      state.records=await api('users');
      if(state.view==='users')renderList();
      message('Przywrócono '+user.name+' jako nieaktywnego. Edytuj status, gdy ma wrócić do pracy.','info');
    }catch(error){message(error.message,'error');}
  }

  function showGeneratedPins(entries) {
    const dialog=$('generatedPinsDialog');
    const target=$('generatedPinsResults');target.replaceChildren();
    const lines=[];
    for(const item of entries) {
      const label=String(item.name||item.userId||'Użytkownik');
      const pin=String(item.pin||'');
      if(!/^\d{4}$/.test(pin))continue;
      const row=document.createElement('div');row.className='pin-result-item';
      const who=document.createElement('strong');who.textContent=label;
      const value=document.createElement('code');value.textContent=pin;
      row.append(who,value);target.append(row);
      lines.push(label+': '+pin);
    }
    state.generatedPinText=lines.join('\n');
    $('copyGeneratedPins').disabled=lines.length===0;
    dialog.showModal();
  }

  function dismissGeneratedPins() {
    $('generatedPinsDialog').close();
    $('generatedPinsResults').replaceChildren();
    state.generatedPinText='';
    $('copyGeneratedPins').disabled=true;
  }

  async function copyGeneratedPins() {
    if(!state.generatedPinText)return;
    try {
      await navigator.clipboard.writeText(state.generatedPinText);
      message('Skopiowano wygenerowane PIN-y. Przechowuj je bezpiecznie.','info');
    } catch {
      message('Kopiowanie się nie powiodło. Zapisz PIN-y przed zamknięciem okna.','error');
    }
  }

  async function generateUserPin(user,reset=false) {
    if(!state.pinReady) {
      message('Najpierw skonfiguruj PIN_PEPPER w zakładce Bezpieczeństwo.','error');
      return;
    }
    if(reset&&!await confirmAction({
      title:'Resetować PIN użytkownika '+user.name+'?',
      description:'Stary PIN przestanie działać. Nowy PIN wyświetli się tylko raz.',
      confirmLabel:'Resetuj PIN',danger:true
    }))return;
    try {
      const result=await post({action:reset?'pinReset':'pinGenerate',userId:user.id});
      const pins=result.pins||[result];
      showGeneratedPins(pins); // immediately show one-time secrets before any other request
      try {
        state.records=await api('users');
        if(state.view==='users')renderList();
      } catch {
        message('PIN zapisany. Nie udało się odświeżyć listy; skopiuj PIN teraz.','error');
      }
    } catch(error) { message(error.message,'error'); }
  }

  async function generateMissingPins() {
    if(!state.pinReady) {
      navigate('security');
      message('Wygeneruj klucz PIN_PEPPER i zapisz go w Cloudflare jako Secret.','info');
      return;
    }
    const role=$('pinRoleFilter').value;
    const missing=state.records.filter(user=>user.active&&!user.has_pin&&(!role||user.role_code===role));
    if(!missing.length) {
      message('W wybranej grupie nie ma aktywnych użytkowników bez PIN-u.','info');
      return;
    }
    const limited=Math.min(missing.length,100);
    if(!await confirmAction({
      title:'Wygenerować PIN-y dla '+limited+' użytkowników?',
      description:'Nowe PIN-y dostaną tylko osoby, które ich jeszcze nie mają. Istniejące PIN-y pozostaną bez zmian.',
      confirmLabel:'Generuj PIN-y'
    }))return;
    const button=$('generateMissingPins');busy(button,true);
    try {
      const result=await post({action:'pinGenerateMissing',role});
      if(result.generated) showGeneratedPins(result.pins||[]);
      else message('Nie wygenerowano nowych PIN-ów. Dane mogły się już zmienić.','info');
      try {
        state.records=await api('users');
        if(state.view==='users')renderList();
      } catch {
        message('PIN-y zapisano, ale lista nie została odświeżona. Skopiuj PIN-y teraz.','error');
      }
    } catch(error){message(error.message,'error');}
    finally{busy(button,false);}
  }

  function generatePepper() {
    $('pinPepperOutput').value=randomSessionKey();
    $('copyPinPepper').disabled=false;
    message('Skopiuj nowy klucz i zapisz w Cloudflare jako PIN_PEPPER (Secret).','info');
  }

  async function copyPepper() {
    const value=$('pinPepperOutput').value;
    if(!value)return;
    try {
      await navigator.clipboard.writeText(value);
      message('Skopiowano klucz PIN_PEPPER. Wklej go do Cloudflare.','info');
    } catch {
      const field=$('pinPepperOutput');field.type='text';field.select();
      message('Skopiuj zaznaczony klucz Ctrl+C.','info');
    }
  }

  async function performLogin(event) {
    event.preventDefault();
    const button=$('loginButton');
    busy(button,true);
    setError('');
    try{
      const payload={
        action:'login',
        password:$('panelPassword').value,
        pin:$('panelPin').value.trim()
      };
      await post(payload);
      $('panelPassword').value='';
      $('panelPin').value='';
      state.loggedIn=true;
      $('loginWrap').classList.add('hidden');
      $('app').classList.remove('hidden');
      await navigate('summary');
    }catch(error){setError(error.message);}
    finally{busy(button,false);}
  }

  async function performLogout() {
    try{await post({action:'logout'});}catch{}
    logoutLocally();
  }

  async function init() {
    $('loginForm').addEventListener('submit',performLogin);
    $('logoutBtn').addEventListener('click',performLogout);
    $('mainNav').addEventListener('click',event=>{
      const item=event.target.closest('[data-view]');if(item)navigate(item.dataset.view);
    });
    $('tableSearch').addEventListener('input',renderList);
    $('warehouseFilter').addEventListener('change',event=>{
      state.currentPartsWarehouse=event.target.value;navigate('parts');
    });
    $('sidebarToggle').addEventListener('click',()=>{
      $('sidebar').classList.toggle('open');
      $('sideOverlay').classList.toggle('hidden',!$('sidebar').classList.contains('open'));
    });
    $('sideOverlay').addEventListener('click',closeSide);
    $('addUserBtn').addEventListener('click',()=>openUserDialog());
    $('showArchivedUsers').addEventListener('click',async()=>{
      state.showArchives=!state.showArchives;
      state.expandedUserId=null;
      await navigate('users');
    });
    $('archiveUserBtn').addEventListener('click',archiveCurrentUser);
    $('generateMissingPins').addEventListener('click',generateMissingPins);
    $('generatePinPepper').addEventListener('click',generatePepper);
    $('copyPinPepper').addEventListener('click',copyPepper);
    $('copyGeneratedPins').addEventListener('click',copyGeneratedPins);
    $('closeGeneratedPins').addEventListener('click',dismissGeneratedPins);
    $('doneGeneratedPins').addEventListener('click',dismissGeneratedPins);
    $('generatedPinsDialog').addEventListener('close',()=>{
      state.generatedPinText='';
      $('generatedPinsResults').replaceChildren();
    });
    $('generateSessionSecret').addEventListener('click',generateSessionKey);
    $('copySessionSecret').addEventListener('click',copySessionKey);
    $('userDialog').addEventListener('close',()=>{
      $('editUserId').value='';
    });
    $('closeUserDialog').addEventListener('click',()=>$('userDialog').close());
    $('cancelUser').addEventListener('click',()=>$('userDialog').close());
    $('createUserForm').addEventListener('submit',saveUser);
    $('partEditForm').addEventListener('submit',savePartEditor);
    $('partEditCancel').addEventListener('click',()=>$('partEditDialog').close());
    try {
      await api('summary');
    } catch(error) {
      if(!/Zaloguj się|Sesja wygasła/.test(error.message))
        setError(error.message);
      return;
    }
    state.loggedIn=true;
    $('loginWrap').classList.add('hidden');
    $('app').classList.remove('hidden');
    await navigate('summary');
  }
  document.addEventListener('DOMContentLoaded',init);
})();
