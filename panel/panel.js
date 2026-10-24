// GPBS Storage — office/admin web panel. Never stores PINs or passwords.
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const state = {view:'summary', records:[], warehouses:[], currentPartsWarehouse:'PL-TYCHY', loggedIn:false};
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
      (view==='parts'?'&warehouse='+encodeURIComponent(state.currentPartsWarehouse):'');
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
      ['DATA (UTC)','TYP','MAGAZYN','CZĘŚĆ','ZMIANA','PRZED','PO','OPERATOR'],
      items.map(m=>[m.created_at,m.operation_type==='PZ'?pill('PZ','green'):pill('WZ','red'),
        m.warehouse_id,m.part_name,m.quantity_delta>0?'+'+m.quantity_delta:m.quantity_delta,
        m.quantity_before,m.quantity_after,m.operator_id||'—'])
    ];
    if(view==='users')return [
      ['UŻYTKOWNIK','ROLA','MAGAZYNY','PIN','STATUS',''],
      items.map(u=>{
        const button=document.createElement('button');
        button.className='btn mini';button.type='button';button.textContent='Edytuj';
        button.addEventListener('click',()=>openUserDialog(u));
        return [u.name,pill(u.role_code,'blue'),u.warehouses||'—',
          u.has_pin?pill('Nadany','green'):pill('Brak PIN-u','red'),
          u.active?pill('Aktywny','green'):pill('Wyłączony','red'),button];
      })
    ];
    return [[],[]];
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
    }else $('tableResults').append(buildTable(columns,rows));
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
    $('addUserBtn').classList.toggle('hidden',view!=='users');
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
        const response=await api(view);
        state.records=view==='parts'?response.parts:response;
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
      const [roles,warehouses]=await Promise.all([api('roles'),api('warehouses')]);
      const form=$('createUserForm');form.reset();
      $('editUserId').value=existing?.id||'';
      $('userDialogTitle').textContent=existing?'Edytuj użytkownika':'Nowy użytkownik';
      $('userName').value=existing?.name||'';
      $('userStatusRow').hidden=!existing;
      $('userActive').checked=existing?Boolean(existing.active):true;

      const roleInput=$('userRole');roleInput.replaceChildren();
      for(const role of roles) {
        const option=document.createElement('option');
        option.value=role.code;option.textContent=role.name;
        roleInput.append(option);
      }
      if(existing)roleInput.value=existing.role_code;

      const assigned=new Set((existing?.warehouses||'').split(',').map(x=>x.trim()).filter(Boolean));
      const field=$('userWarehouses');
      field.replaceChildren();
      const legend=document.createElement('legend');
      legend.textContent='Dostęp do magazynów';field.append(legend);
      for(const warehouse of warehouses.filter(w=>w.active||assigned.has(w.id))) {
        const row=document.createElement('div');row.className='checkbox-row';
        const checkbox=document.createElement('input');
        checkbox.type='checkbox';checkbox.value=warehouse.id;
        checkbox.id='grant-'+warehouse.id;
        checkbox.checked=assigned.has(warehouse.id);
        const label=document.createElement('label');
        label.htmlFor=checkbox.id;
        label.textContent=warehouse.name+(warehouse.active?'':' (nieaktywny)');
        row.append(checkbox,label);field.append(row);
      }
      $('userDialog').showModal();
    } catch(error){message(error.message,'error');}
  }

  async function saveUser(event) {
    event.preventDefault();
    const button=$('saveUser');
    busy(button,true);
    try{
      const warehouses=[...$('userWarehouses').querySelectorAll('input:checked')].map(x=>x.value);
      const userId=$('editUserId').value;
      const body={
        action:userId?'updateUser':'createUser',
        name:$('userName').value.trim(),
        role:$('userRole').value,
        warehouses,
        ...(userId?{userId,active:$('userActive').checked?1:0}:{})
      };
      await post(body);
      $('userDialog').close();
      state.records=await api('users');
      if(state.view==='users')renderList();
      message(userId?'Zapisano zmiany użytkownika.':'Dodano użytkownika bez PIN-u.','info');
    }catch(error){message(error.message,'error');}
    finally{busy(button,false);}
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
    $('generateSessionSecret').addEventListener('click',generateSessionKey);
    $('copySessionSecret').addEventListener('click',copySessionKey);
    $('userDialog').addEventListener('close',()=>{
      $('editUserId').value='';
    });
    $('closeUserDialog').addEventListener('click',()=>$('userDialog').close());
    $('cancelUser').addEventListener('click',()=>$('userDialog').close());
    $('createUserForm').addEventListener('submit',saveUser);
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
