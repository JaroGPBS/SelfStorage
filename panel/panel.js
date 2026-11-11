// GPBS Storage — office/admin web panel. Never stores PINs or passwords.
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const state = {view:'summary', records:[], warehouses:[], currentPartsWarehouse:'PL-TYCHY', loggedIn:false, isSuperAdmin:false, expandedUserId:null, pinReady:false, generatedPinText:'', showArchives:false, boxPartsSource:null,vehiclePartChoice:null};
  const defs = {
    summary:['Pulpit','Przegląd operacji i magazynów.'],
    warehouses:['Magazyny','Aktualne stany magazynów w Polsce.'],
    parts:['Katalog części','Jeden wspólny katalog części dla wszystkich rynków.'],
    boxParts:['Katalog części Boxy','Wyłącznie części dla Box Toulouse i Box Paris. Stany obu magazynów są rozdzielone.'],
    vehicleParts:['Katalog części Samochody','Wyposażenie aut: te same części co w głównym katalogu, z osobną wymaganą ilością na samochód.'],
    newParts:['Nowe części','Nowe części zgłoszone przez magazynierów — do weryfikacji.'],
    indexMigration:['Wymiana indeksów','Wymiana starych etykiet MG-FR na wspólne indeksy MG-000-000.'],
    movements:['Ruchy PZ / WZ','Historia przyjęć i wydań z zapisem ilości przed i po.'],
    users:['Użytkownicy','Role, przypisania magazynów i dostęp do systemu.'],
    security:['Bezpieczeństwo','Zabezpieczenie sesji administratora.'],
    settings:['Ustawienia','Wygląd i preferencje panelu administracyjnego.'],
    superAdmin:['Super Admin','Hasło i wspólny PIN głównego konta właściciela.']
  };

  const FONT_SIZE_KEY='gpbs_admin_font_size';
  const FONT_SIZES=new Set(['11','13','15','17']);

  function storedFontSize() {
    try {
      const value=localStorage.getItem(FONT_SIZE_KEY);
      if(value==='12')return '11'; // Previous option, migrate existing selection.
      if(value==='14')return '15';
      return FONT_SIZES.has(value)?value:'13';
    } catch { return '13'; }
  }

  function applyFontSize(value,save=true) {
    if(!FONT_SIZES.has(value))return;
    document.documentElement.dataset.adminFontSize=value;
    document.querySelectorAll('input[name="adminFontSize"]').forEach(input=>{
      input.checked=input.value===value;
    });
    if(save) {
      try { localStorage.setItem(FONT_SIZE_KEY,value); }
      catch { /* Private browsing / blocked storage: keep selection for this page. */ }
    }
  }

  const THEME_KEY='gpbs_admin_theme';
  const THEMES=new Set(['white','gray','dark']);

  function storedTheme() {
    try {
      const value=localStorage.getItem(THEME_KEY);
      return THEMES.has(value)?value:'dark';
    } catch { return 'dark'; }
  }

  function applyTheme(value,save=true) {
    if(!THEMES.has(value))return;
    document.documentElement.dataset.adminTheme=value;
    document.querySelectorAll('input[name="adminTheme"]').forEach(input=>{
      input.checked=input.value===value;
    });
    if(save) {
      try { localStorage.setItem(THEME_KEY,value); }
      catch { /* Private mode: still apply selected theme in this tab. */ }
    }
  }

  async function api(view) {
    const url='/api/panel?view='+encodeURIComponent(view)+
      (view==='users'&&state.showArchives?'&archived=1':'');
    const res=await fetch(url,{cache:'no-store',credentials:'same-origin'});
    let json=null;
    try{json=await res.json();}catch{}
    if(res.status===401){logoutLocally();throw new Error('Sesja wygasła. Zaloguj się ponownie.');}
    if(!res.ok||!json?.ok)throw new Error(json?.error||'Serwer nie odpowiedział.');
    state.isSuperAdmin=Boolean(json.user?.superAdmin);
    $('superAdminNav').classList.toggle('hidden',!state.isSuperAdmin);
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
    state.isSuperAdmin=false;
    $('superAdminNav').classList.add('hidden');
    $('superPinForm').reset();
    $('superPasswordForm').reset();
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

  function buildTable(columns,rows,highlightRows=[]) {
    const table=document.createElement('table');
    const head=table.createTHead().insertRow();
    for(const title of columns){const cell=document.createElement('th');cell.textContent=title;head.append(cell);}
    const body=table.createTBody();
    for(const [index,cols] of rows.entries()) {
      const tr=body.insertRow();
      if(highlightRows[index])tr.classList.add('movement-overissued');
      for(const col of cols) {
        if(col && col.nodeType){const cell=tr.insertCell();cell.append(col);}
        else tr.append(td(col));
      }
    }
    return table;
  }

  function overissueAmount(m) {
    if(m.operation_type!=='WZ')return 0;
    const stored=Number(m.shortage_quantity||0);
    if(stored>0)return stored;
    if(m.quantity_before===null||m.quantity_before===undefined)return 0;
    const before=Number(m.quantity_before);
    const issued=-Number(m.quantity_delta);
    return Number.isFinite(before)&&Number.isFinite(issued)
      ?Math.max(0,issued-before):0;
  }

  function movementType(m) {
    const wrap=document.createElement('div');
    wrap.className='movement-type';
    wrap.append(pill(m.operation_type==='PZ'?'PZ':'WZ',m.operation_type==='PZ'?'green':'red'));
    if(overissueAmount(m)>0)wrap.append(pill('⚠ PONAD STAN','red'));
    return wrap;
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

  function setNewPartsBadge(count) {
    const n=Number(count||0);
    const badge=$('newPartsBadge');
    badge.textContent=String(n);
    badge.hidden=n===0;
  }

  function formatBytes(bytes) {
    if(bytes==null||!Number.isFinite(Number(bytes))||Number(bytes)<0)return '—';
    const n=Number(bytes);
    if(n===0)return '0 B';
    if(n<1000)return formatNum(n)+' B';
    if(n<1000000)return (n/1000).toLocaleString('pl-PL',{maximumFractionDigits:1})+' kB';
    if(n<1000000000)return (n/1000000).toLocaleString('pl-PL',{maximumFractionDigits:2})+' MB';
    return (n/1000000000).toLocaleString('pl-PL',{maximumFractionDigits:2})+' GB';
  }

  // Quotas are reference Free-tier thresholds, not a verified billing plan.
  // Always show an unavailable reading as a dash; never replace it with zero.
  function renderQuota(valueId,meterId,percentageId,used,limit,bytes=false,suffix='') {
    const valid=used!==null&&used!==undefined&&Number.isFinite(Number(used))&&Number(used)>=0;
    const display=n=>bytes?formatBytes(n):formatNum(n);
    $(valueId).textContent=(valid?display(Number(used)):'—')+' / '+display(limit)+suffix;
    const pct=valid?100*Number(used)/limit:null;
    const bar=$(meterId);
    bar.style.width=valid?(pct>0?Math.max(1,Math.min(100,pct)):0)+'%':'0%';
    bar.classList.toggle('warning',Boolean(valid&&pct>=80));
    $(percentageId).textContent=!valid?'Brak danych do obliczenia procentu':
      pct>0&&pct<0.1?'Poniżej 0,1% progu Free':
      pct.toLocaleString('pl-PL',{maximumFractionDigits:1})+'% progu Free';
  }

  function renderUsage(data) {
    const cloud=data?.cloudflare||{status:'unavailable'};
    const active=cloud.status==='ok';
    const now=active&&cloud.sampledAt?new Date(cloud.sampledAt):null;
    $('usageLastUpdated').textContent=now&&!Number.isNaN(now.getTime())
      ?'Pobrano: '+now.toLocaleString('pl-PL',{dateStyle:'short',timeStyle:'short'})
      :'Statystyki Cloudflare';
    renderQuota('usageD1Size','usageD1SizeMeter','usageD1SizePct',
      active?cloud.d1?.sizeBytes:null,500000000,true);
    // Paid monthly figures are reference included allowances, not a detected account plan.
    renderQuota('usageD1Reads','usageD1MonthReadsMeter','usageD1MonthReadsPct',
      active?cloud.d1?.rowsRead:null,25000000000);
    renderQuota('usageD1Writes','usageD1MonthWritesMeter','usageD1MonthWritesPct',
      active?cloud.d1?.rowsWritten:null,50000000);
    renderQuota('usageR2Size','usageR2SizeMeter','usageR2SizePct',
      active?cloud.r2?.sizeBytes:null,10000000000,true,'-mies.');
    renderQuota('usageD1TodayReads','usageD1ReadsMeter','usageD1ReadsPct',
      active?cloud.d1?.todayRowsRead:null,5000000);
    renderQuota('usageD1TodayWrites','usageD1WritesMeter','usageD1WritesPct',
      active?cloud.d1?.todayRowsWritten:null,100000);
    renderQuota('usageR2ClassA','usageR2AMeter','usageR2APct',
      active?cloud.r2?.classA:null,1000000);
    renderQuota('usageR2ClassB','usageR2BMeter','usageR2BPct',
      active?cloud.r2?.classB:null,10000000);
    for (const id of ['usageD1MonthReadsPct','usageD1MonthWritesPct']) {
      const field=$(id);
      field.textContent=field.textContent.replace('progu Free','miesięcznej puli Paid');
    }
    $('usageR2Objects').textContent=active&&cloud.r2?.objectCount!=null
      ?formatNum(cloud.r2.objectCount):'—';
    $('usageR2Ops').textContent=active&&cloud.r2?.operations!=null?formatNum(cloud.r2.operations):'—';
    const failMessages={
      authorization:'Cloudflare odrzucił dostęp (401/403). Sprawdź token i przypisane konto.',
      request_invalid:'Cloudflare odrzucił zapytanie (HTTP 400). Problem może być w zapytaniu GraphQL.',
      rate_limited:'Cloudflare ograniczył liczbę zapytań (429).',
      http_error:'Cloudflare zwrócił błąd HTTP '+String(cloud.httpStatus||'')+'.',
      graphql_schema:'Błąd GraphQL: niezgodne nazwy pól lub argumentów. Wymagana poprawka kodu.',
      graphql_variables:'Błąd GraphQL: nieprawidłowe typy lub wartości parametrów. Wymagana poprawka kodu.',
      graphql_limit:'Cloudflare odrzucił zapytanie z powodu limitu GraphQL.',
      graphql_error:'Cloudflare zgłosił błąd GraphQL. Wymagana dokładniejsza weryfikacja zapytania.',
      account_unavailable:'Cloudflare nie udostępnił danych wybranego konta. Sprawdź zakres dostępu tokena.',
      timeout:'Przekroczono czas oczekiwania na Cloudflare.',
      network_error:'Nie udało się uzyskać odpowiedzi od Cloudflare.',
      fetch_failed:'Nie udało się nawiązać połączenia z API Cloudflare z poziomu aplikacji. Błąd wysłania zapytania.',
      invalid_response:'API Cloudflare odpowiedziało, ale nie zwróciło poprawnego formatu JSON.',
      processing_error:'Wystąpił błąd przetwarzania odpowiedzi Cloudflare w aplikacji.'
    };
    const status=cloud.status==='not_configured'
      ?(Array.isArray(cloud.missing)&&cloud.missing.length
        ?'Brakujące zmienne Production: '+cloud.missing.join(', ')+'.'
        :'Do podłączenia: token analityczny i identyfikatory Cloudflare.')
      :cloud.status==='invalid_configuration'
        ?'Sprawdź konfigurację identyfikatorów Cloudflare.'
        :cloud.status==='unavailable'
          ?(failMessages[cloud.reason]||'Cloudflare nie zwrócił statystyk. Sprawdź token i dostęp Analytics Read.')
          :'Dane Cloudflare mogą pojawiać się z opóźnieniem.';
    const datasetNames={d1Rows:'odczyt/zapis D1 (miesiąc)',d1Today:'odczyt/zapis D1 (dziś)',
      d1Storage:'rozmiar D1',
      r2Storage:'rozmiar R2',r2Ops:'operacje R2'};
    const issueNote=group=>{
      const issues=cloud.issues?.[group];
      if(!Array.isArray(issues)||!issues.length)return status;
      return issues.map(item=>
        (datasetNames[item.dataset]||'Statystyki')+': '+
        (failMessages[item.reason]||'Błąd Cloudflare GraphQL.')
      ).join(' ');
    };
    $('usageD1Note').textContent=issueNote('d1');
    $('usageR2Note').textContent=issueNote('r2')+
      (active&&Number(cloud.r2?.unclassified)>0
        ?' Nieznane typy operacji R2: '+formatNum(cloud.r2.unclassified)+
          '. Rozbicie na klasy A/B jest niedostępne.':'');
    const photo=data?.photo;
    const bytes=Number(photo?.usedBytes);
    const max=Number(photo?.hardBytes);
    const valid=photo&&Number.isFinite(bytes)&&Number.isFinite(max)&&max>0;
    $('usageR2Guard').textContent=valid?formatBytes(bytes)+' / '+formatBytes(max):'Brak danych';
    const meter=$('usageR2Meter');
    meter.style.width=valid?Math.min(100,Math.max(0,bytes/max*100))+'%':'0%';
    meter.classList.toggle('warning',Boolean(valid&&bytes>=Number(photo.warningBytes)));
  }

  function renderSummary(summary) {
    const stats=[
      {label:'Aktywne magazyny',value:summary.warehouses,rows:[
        ['Polska',summary.warehouseCounts?.pl],['Francja',summary.warehouseCounts?.fr]
      ]},
      {label:'Główny katalog części',value:summary.parts,rows:[
        ['Zdjęcia',summary.photos]
      ]},
      {label:'Zapisane operacje',value:summary.operations,rows:[
        ['PZ',summary.operationCounts?.pz],['WZ',summary.operationCounts?.wz]
      ]},
      {label:'Aktywni użytkownicy',value:summary.users,rows:[
        ['Polska',summary.userCounts?.pl],['Francja',summary.userCounts?.fr]
      ]}
    ];
    $('statGrid').replaceChildren(...stats.map(({label,value,rows})=>{
      const card=document.createElement('article');card.className='stat-card';
      const heading=document.createElement('div');heading.className='stat-label';heading.textContent=label;
      const amount=document.createElement('div');amount.className='stat-value';amount.textContent=formatNum(value);
      card.append(heading,amount);
      if(rows.length){
        const detail=document.createElement('div');detail.className='stat-detail';
        for(const [name,count] of rows){
          const line=document.createElement('div');line.className='stat-detail-row';
          const caption=document.createElement('span');caption.textContent=name;
          const number=document.createElement('strong');
          number.textContent=count==null?'—':formatNum(count);
          line.append(caption,number);detail.append(line);
        }
        card.append(detail);
      }
      return card;
    }));
    const pending=Number(summary.pendingParts||0);
    setNewPartsBadge(pending);
    const review=$('newPartsAlert');
    review.hidden=pending===0;
    const byWarehouse=(summary.pendingWarehouses||[]).map(w=>
      w.name+': '+w.count).join(' · ');
    review.textContent=pending?
      'Nowe części do weryfikacji ('+pending+'): '+byWarehouse+'. Otwórz listę.':'';
    const alert=$('overissueAlert');
    const count=Number(summary.overissuedLines||0);
    alert.hidden=count===0;
    alert.textContent=count>0
      ?'⚠ UWAGA: '+count+' pozycji wydano ponad zapisany stan.'
      :'';
  }

  function colsFor(view,items) {
    if(view==='warehouses')return [ ['MAGAZYN','ID','STATUS','POZYCJE','ŁĄCZNY STAN'],warehouseRows(items) ];
    if(view==='newParts')return [[],[]];
    if(view==='boxParts'){
      const fromD1=state.boxPartsSource?.fromD1||{};
      const columnName=place=>(place==='toulouse'?'TULUZA':'PARYŻ')+
        (fromD1[place]?' (D1)':' (ARKUSZ)');
      return [
        ['NAZWA CZĘŚCI','INDEKS GPBS','INDEKS ŹRÓDŁOWY','INDEKS FR','SAP',
          columnName('toulouse'),columnName('paris')],
        items.map(p=>[
          p.name||'—',p.part_number||'—',p.legacy_index||'—',
          p.source_code||'—',p.sap_number||'—',
          formatNum(p.toulouse)+' szt.',formatNum(p.paris)+' szt.'
        ])
      ];
    }
    if(view==='parts')return [
      ['NAZWA CZĘŚCI','INDEKS GPBS / MAG.','SAP','ILOŚĆ'],
      items.map(p=>[p.name,p.part_number||'—',p.sap_number||'—',
        p.quantity===null||p.quantity===undefined?'Nieustalony':formatNum(p.quantity)+' szt.'])
    ];
    if(view==='movements')return [
      ['DATA (PL)','SESJA / DOKUMENT','TYP','MAGAZYN','EKIPA / DOSTAWCA / ODBIORCA',
        'CZĘŚĆ','ZMIANA','PRZED','PO','PRACOWNIK','UWAGI'],
      items.map(m=>[
        formatTimestampPL(m.created_at),m.session_id||m.id,
        movementType(m),
        m.warehouse_id,m.recipient_name||'—',
        (m.part_name||m.part_number||'—')+(m.part_number?' · '+m.part_number:''),
        Number(m.quantity_delta)>0?'+'+m.quantity_delta:m.quantity_delta,
        m.quantity_before===null||m.quantity_before===undefined?'Nieustalony':m.quantity_before,
        m.quantity_after,m.operator_name||m.operator_id||'—',
        overissueAmount(m)>0
          ?pill(Number(m.before_unknown)===1
            ?'Wydanie przy nieustalonym stanie · '+overissueAmount(m)+' szt. ponad potwierdzone'
            :'Wydano ponad stan o '+overissueAmount(m)+' szt.','red')
          :'—'
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
    for(const title of ['UŻYTKOWNIK','ROLA','PIN','STATUS','PL','FR','']) {
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
      const pin=td('');pin.className='pin-cell';
      pin.append(user.has_pin?pill('Nadany','green'):pill('Brak PIN-u','red'));
      if(user.active&&!state.showArchives&&!user.owner_protected) {
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
      for(const country of ['PL','FR']){
        const access=td('');access.className='market-access-cell';
        const input=document.createElement('input');
        input.type='checkbox';input.className='market-access-check';
        input.checked=Boolean(user[country==='PL'?'market_pl':'market_fr']);
        input.disabled=Boolean(state.showArchives||user.owner_protected||!user.active);
        input.setAttribute('aria-label',user.name+': dostęp do rynku '+country);
        input.title=user.owner_protected?'Główny administrator ma stały dostęp do obu rynków':
          'Zmień dostęp do rynku '+country;
        input.addEventListener('click',event=>event.stopPropagation());
        input.addEventListener('change',async event=>{
          event.stopPropagation();
          const previous=!input.checked;
          const controls=[...row.querySelectorAll('.market-access-check')];
          controls.forEach(control=>{control.disabled=true;});
          try{
            const markets={PL:Boolean(user.market_pl),FR:Boolean(user.market_fr)};
            markets[country]=input.checked;
            const result=await post({action:'setUserMarkets',userId:user.id,markets});
            user.market_pl=Number(result.markets.PL);
            user.market_fr=Number(result.markets.FR);
            message('Zapisano dostęp użytkownika '+user.name+' do rynków.','info');
          }catch(error){
            input.checked=previous;
            message(error.message||'Nie udało się zmienić dostępu.','error');
          }finally{
            controls.forEach(control=>{
              control.disabled=Boolean(state.showArchives||user.owner_protected||!user.active);
            });
          }
        });
        access.append(input);row.append(access);
      }
      const actions=td('');actions.className='user-row-actions';
      const edit=document.createElement('button');edit.type='button';
      edit.className='btn mini user-edit-button';edit.textContent=state.showArchives?'Przywróć':'Edytuj';
      edit.addEventListener('click',event=>{event.stopPropagation();
        if(state.showArchives)restoreUser(user);
        else openUserDialog(user);
      });
      actions.append(edit);
      if(!state.showArchives){
        const rights=document.createElement('button');
        rights.type='button';rights.className='btn mini user-rights-button';
        rights.textContent='Uprawnienia';
        rights.addEventListener('click',event=>{event.stopPropagation();openPermissionsDialog(user);});
        actions.append(rights);
      }
      row.append(actions);

      const cell=detail.insertCell();cell.colSpan=7;
      const box=document.createElement('div');box.className='user-details-inner';
      const fields=[
        ['Imię',user.first_name||'—'],
        ['Nazwisko',user.last_name||'—'],
        ['Numer telefonu',user.phone||'—'],
        ['Przypisane magazyny',user.warehouses||'—']
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
        if(event.target.closest('button,input,label'))return;
        toggle();
      });
    }
    return table;
  }

  // Newly created warehouse parts stay visible in red until the admin
  // has verified the name, index and optional SAP.
  function renderPartsTable(items,newOnly=false) {
    const table=document.createElement('table');
    table.className='parts-review-table';
    const header=table.createTHead().insertRow();
    const titles=newOnly
      ?['MAGAZYN','DODANO / PRACOWNIK','NAZWA CZĘŚCI','INDEKS GPBS','SAP','ZDJĘCIE','WERYFIKACJA','']
      :['NAZWA CZĘŚCI','INDEKS GPBS / MAG.','SAP','ZDJĘCIE','WERYFIKACJA',''];
    for(const label of titles) {
      const cell=document.createElement('th');
      cell.textContent=label;
      header.append(cell);
    }
    const body=table.createTBody();
    for(const part of items) {
      const row=body.insertRow();
      const pending=part.verification_status==='PENDING';
      if(pending)row.classList.add('part-pending-verification');
      if(newOnly) {
        row.append(td(part.warehouse_name||part.warehouse_id||'—'));
        row.append(td(formatTimestampPL(part.added_at)+' · '+(part.added_by||'—')));
      }
      const partName=td(part.name||'—');
      partName.className='part-name-cell';
      row.append(partName);
      row.append(td(part.part_number||'—'));
      row.append(td(part.sap_number||'—'));
      if(newOnly)row.append(td(Number(part.has_photo)?'Jest zdjęcie':'Brak zdjęcia'));
      else {
        const photo=td(Number(part.has_photo)?'✓ Jest zdjęcie':'—');
        photo.title=Number(part.has_photo)?'Część posiada zdjęcie':'Brak zdjęcia';
        row.append(photo);
      }
      const status=td('');
      status.textContent=pending?'DO WERYFIKACJI':'—';
      status.className=pending?'part-review-status':'';
      row.append(status);
      const action=td('');
      action.className='part-row-actions';
      const edit=document.createElement('button');
      edit.type='button';
      edit.className='btn mini';
      edit.textContent=pending?'Sprawdź / edytuj':'Edytuj';
      edit.addEventListener('click',()=>openPartEditor(part));
      const remove=document.createElement('button');
      remove.type='button';
      remove.className='btn mini archive-danger part-delete-btn';
      remove.textContent='Usuń';
      remove.setAttribute('aria-label','Usuń część '+part.name);
      remove.addEventListener('click',()=>removePart(part));
      action.append(edit,remove);
      row.append(action);
    }
    return table;
  }

  function renderVehiclePartsTable(items) {
    const table=document.createElement('table');
    table.className='parts-review-table vehicle-catalogue-table';
    const header=table.createTHead().insertRow();
    for(const title of [
      'NAZWA CZĘŚCI','INDEKS GPBS','STARY MAC','SAP Z ARKUSZA',
      'SAP W KATALOGU','WYMAGANE / AUTO','STATUS',''
    ]){
      const th=document.createElement('th');th.textContent=title;header.append(th);
    }
    const tbody=table.createTBody();
    for(const part of items){
      const tr=tbody.insertRow();
      if(!part.part_found||!part.index_assigned)tr.classList.add('part-pending-verification');
      tr.append(td(part.name||'—','part-name-cell'));
      tr.append(td(part.part_number||'—'));
      tr.append(td(part.source_code||'—'));
      tr.append(td(part.source_sap&&part.source_sap!=='-'?part.source_sap:'—'));
      tr.append(td(part.sap_number||'—'));
      const required=td('');
      required.className='vehicle-requirement-cell';
      const field=document.createElement('input');
      field.type='number';field.min='0';field.max='100000';field.step='1';
      field.inputMode='numeric';
      field.className='vehicle-requirement-input';
      field.setAttribute('aria-label','Wymagana ilość części '+part.name);
      field.value=part.required_quantity===null||part.required_quantity===undefined
        ?'':String(part.required_quantity);
      field.placeholder='—';
      const save=document.createElement('button');
      save.type='button';save.className='btn mini';
      save.textContent='Zapisz';
      save.title='Zapisz wymaganą ilość tej części na jednym samochodzie';
      save.addEventListener('click',async()=>{
        const value=field.value.trim();
        const quantity=value===''?null:Number(value);
        if(quantity!==null&&(!Number.isSafeInteger(quantity)||quantity<0||quantity>100000)){
          message('Podaj całkowitą ilość od 0 do 100000 lub pozostaw pole puste.','error');
          return;
        }
        field.disabled=true;save.disabled=true;
        try{
          const result=await post({action:'setVehicleRequirement',
            sourceRow:part.source_row,requiredQuantity:quantity});
          part.required_quantity=result.required_quantity;
          message('Zapisano ilość wymaganą na samochodzie.','success');
        }catch(error){
          message(error.message||'Nie udało się zapisać ilości.','error');
        }finally{field.disabled=false;save.disabled=false;}
      });
      required.append(field,save);tr.append(required);
      const status=td('');
      status.append(pill(!part.part_found?'DO DOPASOWANIA'
        :!part.index_assigned?'BRAK NOWEGO MG':'POŁĄCZONA',
        part.part_found&&part.index_assigned?'green':'red'));
      tr.append(status);
      const actions=td('');actions.className='part-row-actions';
      if(part.part_found&&part.index_assigned&&part.id){
        const edit=document.createElement('button');
        edit.type='button';edit.className='btn mini';edit.textContent='Edytuj';
        edit.title='Edytuj tę samą część co w katalogu głównym';
        edit.addEventListener('click',()=>openPartEditor(part));
        actions.append(edit);
      }else{
        const match=document.createElement('button');
        match.type='button';match.className='btn mini';match.textContent='Dopasuj';
        match.title='Powiąż z istniejącą częścią w katalogu głównym';
        match.addEventListener('click',()=>openVehiclePartChoice(part));
        actions.append(match);
      }
      const remove=document.createElement('button');
      remove.type='button';remove.className='btn mini archive-danger';
      remove.textContent='Usuń z samochodów';
      remove.title='Usuń tylko z tej kategorii, nie z katalogu głównego';
      remove.addEventListener('click',()=>removeVehicleCategoryPart(part));
      actions.append(remove);
      tr.append(actions);
    }
    return table;
  }

  async function refreshVehicleCatalogue(){
    if(state.view!=='vehicleParts')return;
    const response=await api('vehicleParts');
    state.records=response.parts||[];
    $('tableDescription').textContent='Części dla samochodów: '+response.parts.length+
      ' · Powiązane z katalogiem głównym: '+response.matchedParts+
      ' · Do dopasowania: '+response.unresolved+
      '. Zmiany tej listy nie usuwają części z katalogu głównego.';
    renderList();
  }
  async function openVehiclePartChoice(part=null){
    const dialog=$('vehiclePartSelectDialog');
    const form=$('vehiclePartSelect');
    const err=$('vehiclePartSelectError');
    err.classList.add('hidden');err.textContent='';
    state.vehiclePartChoice=part?.source_row??null;
    $('vehiclePartSelectTitle').textContent=part
      ?'Dopasuj: '+part.name:'Dodaj część do samochodów';
    form.replaceChildren();
    const first=document.createElement('option');
    first.value='';first.textContent='Wybierz część z głównego katalogu';
    form.append(first);
    try{
      const response=await api('parts');
      const linked=new Set((state.records||[]).filter(p=>p.id&&
        p.source_row!==part?.source_row).map(p=>p.id));
      for(const row of response.parts||[]){
        if(linked.has(row.id))continue;
        const option=document.createElement('option');
        option.value=row.id;
        option.textContent=(row.part_number||'—')+' · '+row.name+
          (row.sap_number?' · SAP '+row.sap_number:'');
        form.append(option);
      }
      if(part?.id)form.value=part.id;
      dialog.showModal();
    }catch(error){message('Nie można pobrać głównego katalogu części. '+error.message,'error');}
  }
  async function saveVehiclePartChoice(event){
    event.preventDefault();
    const partId=$('vehiclePartSelect').value;
    if(!partId)return;
    const button=$('vehiclePartSelectSave');
    button.disabled=true;
    try{
      const sourceRow=state.vehiclePartChoice;
      await post(sourceRow===null
        ?{action:'addVehiclePart',partId}
        :{action:'linkVehiclePart',partId,sourceRow});
      $('vehiclePartSelectDialog').close();
      await refreshVehicleCatalogue();
      message('Zapisano przypisanie do katalogu samochodowego.','success');
    }catch(error){
      const target=$('vehiclePartSelectError');
      target.textContent=error.message;target.classList.remove('hidden');
    }finally{button.disabled=false;}
  }
  async function removeVehicleCategoryPart(part){
    const yes=await confirmAction({
      title:'Usunąć tylko z katalogu samochodowego?',
      description:'„'+part.name+'” zniknie z listy wyposażenia aut. '+
        'Pozostanie w głównym katalogu i historiach magazynowych.',
      confirmLabel:'Usuń z samochodów',danger:true
    });
    if(!yes)return;
    try{
      await post({action:'removeVehiclePart',sourceRow:part.source_row});
      await refreshVehicleCatalogue();
      message('Usunięto tylko z listy samochodów.','success');
    }catch(error){message(error.message,'error');}
  }

  async function removePart(part) {
    if(!part?.id)return;
    const accepted=await confirmAction({
      title:'Usunąć część z katalogu?',
      description:'„'+part.name+'” ('+(part.part_number||'bez indeksu')+
        ') zniknie z aktywnych list i drukowania etykiet. Zdjęcie części zostanie trwale usunięte z R2. Historia PZ/WZ pozostanie zachowana. Tej operacji nie można cofnąć z panelu.',
      confirmLabel:'Usuń część',danger:true
    });
    if(!accepted)return;
    const removeButton=$('partEditDelete');
    const currentPart=$('partEditDialog').open&&$('partEditId').value===part.id;
    if(currentPart)removeButton.disabled=true;
    message();
    try {
      const result=await post({action:'deletePart',partId:part.id});
      if(currentPart)$('partEditDialog').close();
      // Remove the confirmed deleted row immediately, even if a later refresh fails.
      if(state.view==='parts'||state.view==='newParts'){
        state.records=state.records.filter(item=>item.id!==part.id);
        renderList();
      }
      message(result.message||'Część usunięto z aktywnego katalogu.','success');
      try {
        const view=state.view;
        const requests=[api('summary')];
        if(view==='parts'||view==='newParts')requests.push(api(view));
        const [summary,response]=await Promise.all(requests);
        setNewPartsBadge(summary.pendingParts);
        if(response&&view===state.view){
          state.records=response.parts||[];
          renderList();
        }
      }catch(refreshError){
        message('Część została usunięta, ale nie udało się odświeżyć danych. Użyj odświeżenia strony.','info');
      }
    }catch(error){
      if(currentPart&&$('partEditDialog').open){
        $('partEditError').textContent=error.message;
        $('partEditError').classList.remove('hidden');
      }else message(error.message,'error');
    }finally{
      if(currentPart)removeButton.disabled=false;
    }
  }

  function openPartEditor(part) {
    $('partEditReplacementPhoto').value='';
    $('partEditPhotoOptimized').checked=true;
    $('partEditId').value=part.id;
    $('partEditName').value=part.name||'';
    $('partEditNumber').value=part.part_number||'';
    $('partEditNumber').readOnly=Boolean(part.old_index);
    $('partEditNumber').title=part.old_index
      ?'Nowy indeks jest nadany na stałe. Wymianę starego numeru prowadź w zakładce Wymiana indeksów.'
      :'';
    $('partEditSap').value=part.sap_number||'';
    $('partEditVerify').checked=false;
    $('partEditDelete').disabled=false;
    $('partEditStatus').textContent=part.verification_status==='PENDING'
      ?'Nowa część. Sprawdź nazwę, indeks i SAP przed oznaczeniem jako zweryfikowana.'
      :'Możesz skorygować dane tej części.';
    $('partEditVerify').parentElement.hidden=part.verification_status!=='PENDING';
    const hasPhoto=Boolean(Number(part.has_photo));
    $('partEditPhotoBox').hidden=!hasPhoto;
    if(hasPhoto) {
      const src='/api/panel?view=partPhoto&part='+encodeURIComponent(part.id);
      $('partEditPhoto').src=src;
      $('partEditPhotoLink').href=src;
    }else{
      $('partEditPhoto').removeAttribute('src');
      $('partEditPhotoLink').removeAttribute('href');
    }
    $('partEditError').classList.add('hidden');
    $('partEditError').textContent='';
    $('partEditDialog').showModal();
  }

  // A selected photo is saved by the same 'Zapisz dane' action as the part details.
  // Checking the private image endpoint prevents an upload success from hiding a read error.
  function validateEditorPhoto(file) {
    if(!file)return;
    if(file.size<100||file.size>20*1024*1024)
      throw Error('Zdjęcie musi mieć maksymalnie 20 MB.');
    const extension=String(file.name||'').split('.').pop().toLowerCase();
    if(!['jpg','jpeg','jpe','png','bmp','webp','avif'].includes(extension))
      throw Error('Wybierz zdjęcie JPG, PNG, BMP, WEBP lub AVIF. Zdjęcia HEIC zapisz najpierw jako JPG.');
  }

  // Resize only when the administrator selected optimized mode.
  // JPEG cannot preserve transparency: paint an opaque white background first.
  async function optimizeEditorPhoto(file) {
    const source=URL.createObjectURL(file);
    const picture=new Image();
    try {
      await new Promise((resolve,reject)=>{
        picture.onload=resolve;
        picture.onerror=()=>reject(Error(
          'Nie można przetworzyć tego zdjęcia w przeglądarce. Spróbuj JPG/PNG albo wybierz tryb Oryginalne.'));
        picture.src=source;
      });
    } finally {
      URL.revokeObjectURL(source);
    }
    const originalWidth=picture.naturalWidth,originalHeight=picture.naturalHeight;
    if(!originalWidth||!originalHeight)
      throw Error('Zdjęcie nie ma poprawnych wymiarów.');
    const ratio=Math.min(1,1600/Math.max(originalWidth,originalHeight));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(originalWidth*ratio));
    canvas.height=Math.max(1,Math.round(originalHeight*ratio));
    const context=canvas.getContext('2d');
    if(!context)throw Error('Przeglądarka nie obsługuje przetwarzania zdjęć.');
    context.fillStyle='#FFFFFF';
    context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(picture,0,0,canvas.width,canvas.height);
    const jpg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.85));
    canvas.width=0;canvas.height=0;
    if(!jpg||jpg.type!=='image/jpeg'||jpg.size<100||jpg.size>20*1024*1024)
      throw Error('Nie udało się przygotować zdjęcia JPG. Spróbuj innego pliku.');
    const base=String(file.name||'zdjecie').replace(/\.[^.]+$/,'').slice(0,110)||'zdjecie';
    return new File([jpg],base+'.jpg',{type:'image/jpeg'});
  }

  async function savePartEditorPhoto(partId,file) {
    const form=new FormData();
    form.set('partId',partId);
    form.set('photo',file,file.name);
    const response=await fetch('/api/panel',{
      method:'POST',credentials:'same-origin',cache:'no-store',body:form
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)
      throw Error(data.error||'Nie udało się zapisać zdjęcia w R2.');

    // Confirm that the saved photograph can actually be read and displayed.
    const photoUrl='/api/panel?view=partPhoto&part='+encodeURIComponent(partId)+'&v='+Date.now();
    const check=await fetch(photoUrl,{credentials:'same-origin',cache:'no-store'});
    if(!check.ok)
      throw Error('Zdjęcie przesłano, ale podgląd nie działa (HTTP '+check.status+').');
    const blob=await check.blob();
    if(!blob.type.startsWith('image/')||!blob.size)
      throw Error('Zdjęcie przesłano, ale serwer nie zwrócił poprawnego obrazu.');
    const previewUrl=URL.createObjectURL(blob);
    try {
      await new Promise((resolve,reject)=>{
        const image=new Image();
        image.onload=resolve;
        image.onerror=()=>reject(Error('Zdjęcie jest w R2, ale przeglądarka nie może go wyświetlić. Użyj JPG lub PNG.'));
        image.src=previewUrl;
      });
    } finally {URL.revokeObjectURL(previewUrl);}
  }

  function openPartCreate(){
    $('partCreateForm').reset();
    $('partCreateOptimized').checked=true;
    $('partCreateError').textContent='';
    $('partCreateError').classList.add('hidden');
    $('partCreateDialog').showModal();
    $('partCreateName').focus();
  }

  async function savePartCreate(event){
    event.preventDefault();
    const save=$('partCreateSave'),cancel=$('partCreateCancel');
    save.disabled=true;cancel.disabled=true;
    $('partCreateError').classList.add('hidden');
    let created=false;
    try{
      const photoFile=$('partCreatePhoto').files?.[0]||null;
      validateEditorPhoto(photoFile);
      const photo=photoFile&&$('partCreateOptimized').checked
        ?await optimizeEditorPhoto(photoFile):photoFile;
      const form=new FormData();
      form.set('name',$('partCreateName').value.trim());
      form.set('sap',$('partCreateSap').value.trim());
      if(photo)form.set('photo',photo,photo.name);
      const response=await fetch('/api/panel?action=createPart',{
        method:'POST',credentials:'same-origin',cache:'no-store',body:form
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok||!result.ok)
        throw Error(result.error||'Nie udało się dodać części.');
      created=true;
      $('partCreateDialog').close();
      if(state.view==='parts'){
        const refreshed=await api('parts');
        state.records=refreshed.parts||[];
        renderList();
      }
    }catch(error){
      if(created){
        message('Część została dodana, ale nie udało się odświeżyć katalogu. Odśwież stronę.','error');
      }else{
        $('partCreateError').textContent=error.message||'Nie udało się dodać części.';
        $('partCreateError').classList.remove('hidden');
      }
    }finally{
      save.disabled=false;cancel.disabled=false;
    }
  }

  async function savePartEditor(event) {
    event.preventDefault();
    const button=$('partEditSave');
    button.disabled=true;
    $('partEditCancel').disabled=true;
    $('partEditDelete').disabled=true;
    $('partEditError').classList.add('hidden');
    try {
      const partId=$('partEditId').value;
      const selectedPhoto=$('partEditReplacementPhoto').files?.[0]||null;
      validateEditorPhoto(selectedPhoto);
      // Process before updating data/verification, so image decoding errors
      // cannot create a partial successful save.
      const file=selectedPhoto&&$('partEditPhotoOptimized').checked
        ?await optimizeEditorPhoto(selectedPhoto):selectedPhoto;
      const result=await post({
        action:'updatePart',
        partId,
        name:$('partEditName').value.trim(),
        number:$('partEditNumber').value.trim(),
        sap:$('partEditSap').value.trim(),
        verify:$('partEditVerify').checked
      });
      if(file) {
        try {await savePartEditorPhoto(partId,file);}
        catch(error) {
          throw Error('Dane części zapisano, ale zdjęcie nie zostało potwierdzone: '+error.message+
            ' Możesz spróbować ponownie bez utraty wpisanych danych.');
        }
      }
      $('partEditReplacementPhoto').value='';
      $('partEditDialog').close();
      message(file?'Zapisano dane i zdjęcie części.':(result.message||'Zapisano dane części.'),'success');
      const current=state.view;
      if(current==='parts'||current==='newParts'||current==='vehicleParts') {
        const response=await api(current);
        state.records=response.parts||[];
        renderList();
        if(current==='newParts')setNewPartsBadge(state.records.length);
      }
      if(result.message?.includes('zatwierdzono')) {
        const summary=await api('summary');
        setNewPartsBadge(summary.pendingParts);
      }
    }catch(error) {
      $('partEditError').textContent=error.message;
      $('partEditError').classList.remove('hidden');
    }finally{button.disabled=false;$('partEditCancel').disabled=false;$('partEditDelete').disabled=false;}
  }

  function renderIndexMigration(){
    const q=$('indexMigrationSearch').value.trim().toLocaleLowerCase('pl');
    const all=state.records||[];
    const shown=all.filter(p=>[p.name,p.old_index,p.new_index,p.sap_number]
      .some(x=>String(x||'').toLocaleLowerCase('pl').includes(q)));
    const area=$('indexMigrationResults');
    area.replaceChildren();
    if(!shown.length){
      const empty=document.createElement('p');
      empty.className='empty';
      empty.textContent=all.length?'Nie znaleziono części.':'Nie znaleziono indeksów do wymiany.';
      area.append(empty);
    }else{
      const table=document.createElement('table');
      table.className='index-migration-table';
      const header=table.createTHead().insertRow();
      for(const name of ['CZĘŚĆ','STARY INDEKS','NOWY INDEKS','TULUZA','PARYŻ','STARY KOD']){
        const th=document.createElement('th');th.textContent=name;header.append(th);
      }
      const body=table.createTBody();
      for(const item of shown){
        const row=body.insertRow();
        if(!item.old_active)row.classList.add('index-retired');
        row.insertCell().textContent=item.name||'—';
        const old=row.insertCell();old.className='mono';old.textContent=item.old_index;
        const current=row.insertCell();current.className='mono index-new-code';current.textContent=item.new_index;
        for(const [field,location] of [
          ['toulouse_done','Toulouse'],['paris_done','Paris']
        ]){
          const cell=row.insertCell();cell.className='index-status-cell';
          const label=document.createElement('label');
          label.className='index-check';
          const input=document.createElement('input');
          input.type='checkbox';
          input.checked=Boolean(Number(item[field]));
          input.disabled=!Number(item.old_active);
          input.setAttribute('aria-label','Wymiana etykiety '+item.new_index+' w '+location);
          const description=document.createElement('span');
          description.textContent=input.checked?'Wymieniona':'Stara';
          label.append(input,description);
          cell.append(label);
          input.addEventListener('change',async()=>{
            input.disabled=true;
            try{
              await post({action:'markIndexMigration',partId:item.id,warehouse:location,done:input.checked});
              item[field]=input.checked?1:0;
              renderIndexMigration();
            }catch(error){
              input.checked=!input.checked;
              input.disabled=false;
              message(error.message,'error');
            }
          });
        }
        const actions=row.insertCell();
        const complete=['toulouse_done','paris_done']
          .every(field=>Number(item[field])===1);
        if(!Number(item.old_active)){
          actions.textContent='Wyłączony';
          actions.className='index-retired-label';
        }else{
          const finish=document.createElement('button');
          finish.className='btn mini';
          finish.type='button';
          finish.textContent='Wyłącz stary';
          finish.disabled=!complete;
          finish.title=complete?'Wyłącz stary kod po wymianie ostatniej etykiety':
            'Najpierw zaznacz wszystkie trzy magazyny';
          actions.append(finish);
          finish.addEventListener('click',async()=>{
            const approve=await confirmAction({
              title:'Wyłączyć stary indeks?',
              description:'Część: '+item.name+'. Stary kod '+item.old_index+
                ' przestanie działać przy skanowaniu. Nowy '+item.new_index+
                ' zostanie jedynym aktywnym indeksem.',
              confirmLabel:'Wyłącz stary indeks',danger:true
            });
            if(!approve)return;
            finish.disabled=true;
            try{
              const result=await post({action:'retireOldIndex',partId:item.id});
              item.old_active=0;
              renderIndexMigration();
              message(result.message,'success');
            }catch(error){
              finish.disabled=false;
              message(error.message,'error');
            }
          });
        }
      }
      area.append(table);
    }
    const replaced=field=>all.filter(p=>Number(p[field])===1).length;
    const retired=all.filter(p=>!Number(p.old_active)).length;
    $('indexMigrationFooter').textContent=
      'Wyświetlono '+shown.length+' z '+all.length+' części · '+
      'Tuluza: '+replaced('toulouse_done')+'/'+all.length+' · '+
      'Paryż: '+replaced('paris_done')+'/'+all.length+' · '+
      'Wyłączone stare indeksy: '+retired;
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
      :state.view==='parts'||state.view==='newParts'
        ?renderPartsTable(matching,state.view==='newParts')
        :state.view==='vehicleParts'?renderVehiclePartsTable(matching)
        :buildTable(columns,rows,
          state.view==='movements'?matching.map(m=>overissueAmount(m)>0):[]));
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
    if(!defs[view]||(view==='superAdmin'&&!state.isSuperAdmin))return;
    state.view=view;
    $('pageHeading').classList.toggle('hidden',view==='summary');
    $('pageTitle').textContent=defs[view][0];
    $('pageSubtitle').textContent=defs[view][1];
    $('adminPageEyebrow').textContent=view==='parts'
      ?'GPBS STORAGE / WSPÓLNY KATALOG'
      :view==='boxParts'?'GPBS STORAGE / KATALOG BOXY'
      :view==='vehicleParts'?'GPBS STORAGE / KATALOG SAMOCHODY':'GPBS STORAGE';
    $('breadcrumbCurrent').textContent=defs[view][0];
    document.title='GPBS Storage - Admin';
    document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
    $('dashboardView').classList.toggle('hidden',view!=='summary');
    $('tableView').classList.toggle('hidden',view==='summary'||view==='security'||view==='indexMigration'||view==='settings'||view==='superAdmin');
    $('indexMigrationView').classList.toggle('hidden',view!=='indexMigration');
    $('securityView').classList.toggle('hidden',view!=='security');
    $('settingsView').classList.toggle('hidden',view!=='settings');
    $('superAdminView').classList.toggle('hidden',view!=='superAdmin');
    $('addUserBtn').classList.toggle('hidden',view!=='users'||state.showArchives);
    $('showArchivedUsers').classList.toggle('hidden',view!=='users');
    $('showArchivedUsers').textContent=state.showArchives?'Wróć do użytkowników':'Pokaż archiwum';
    $('generateMissingPins').classList.toggle('hidden',view!=='users'||state.showArchives);
    $('pinRoleFilter').classList.toggle('hidden',view!=='users'||state.showArchives);
    $('warehouseFilter').classList.add('hidden');
    $('addPartBtn').classList.toggle('hidden',view!=='parts');
    $('vehicleAddPartBtn').classList.toggle('hidden',view!=='vehicleParts');
    $('tableSearch').value='';
    $('tableTitle').textContent=defs[view][0];
    $('tableDescription').textContent=defs[view][1];
    message();
  }

  async function navigate(view) {
    if(view==='superAdmin'&&!state.isSuperAdmin)return;
    showView(view);
    closeSide();
    try {
      if(view==='security'||view==='settings') return;
      if(view==='superAdmin'){
        const details=await api('superAdmin');
        $('superAdminStatus').textContent=details.unifiedPin
          ?'Wspólny PIN D1 jest już aktywny.'
          :'Aktualnie trwa przejście z konta FR na wspólny PIN D1.';
        return;
      }
      if(view==='indexMigration'){
        const result=await api('indexMigration');
        state.records=result.parts||[];
        if(state.view===view)renderIndexMigration();
        return;
      }
      if(view==='summary') {
        const [summary,usage]=await Promise.all([
          api('summary'),api('usage').catch(()=>null)
        ]);
        if(state.view===view){
          renderSummary(summary);
          renderUsage(usage);
        }
      } else {
        if(view==='users') {
          const [users,setup]=await Promise.all([api('users'),api('pinStatus')]);
          state.records=users;
          state.pinReady=Boolean(setup.available);
          $('generateMissingPins').textContent=state.pinReady?'Generuj brakujące PIN-y':'Skonfiguruj generator PIN-ów';
        } else {
          const response=await api(view);
          state.records=(view==='parts'||view==='newParts'||view==='boxParts'||view==='vehicleParts')
            ?response.parts:response;
          if(view==='newParts')setNewPartsBadge(state.records.length);
          if(view==='vehicleParts'&&state.view===view){
            $('tableDescription').textContent=
              'Źródło: Stock FR GPBS → Samochody · '+response.parts.length+
              ' pozycji · '+response.matchedParts+' powiązanych z katalogiem D1 · '+
              response.unresolved+' do dopasowania. Ilości wymagane dotyczą jednego auta.';
          }
          if(view==='boxParts'){
            state.boxPartsSource=response;
            if(state.view===view){
              const d1=response.fromD1||{};
              $('tableDescription').textContent=
                'Tuluza: '+(d1.toulouse?'stan zapisany w D1':'stan z arkusza Google')+
                ' · Paryż: '+(d1.paris?'stan zapisany w D1':'stan z arkusza Google')+
                ' · Źródło: Stock FR GPBS, 11.11.2026 · '+
                response.parts.length+' pozycji.';
            }
          }
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

  const EXTRA_RIGHTS=[
    {key:'stocks',label:'Podgląd stanów magazynowych'},
    {key:'pz',label:'Przyjęcia (PZ)'},
    {key:'wz',label:'Wydania (WZ)'},
    {key:'inventory',label:'Inwentaryzacje'},
    {key:'labels',label:'Drukowanie etykiet'}
  ];
  function openPermissionsDialog(user){
    $('permissionsUserId').value=user.id;
    $('permissionsUserName').textContent=user.name+' · '+user.role_code;
    const frozen=Boolean(user.owner_protected);
    $('permissionsOwnerHint').hidden=!frozen;
    $('saveUserPermissions').disabled=frozen;
    for(const right of EXTRA_RIGHTS){
      const input=$('right-'+right.key);
      input.checked=frozen||user.extra_permissions?.[right.key]!==false;
      input.disabled=frozen;
    }
    $('userPermissionsDialog').showModal();
  }
  async function saveUserPermissions(event){
    event.preventDefault();
    const button=$('saveUserPermissions');
    const id=$('permissionsUserId').value;
    if(!id)return;
    const permissions=Object.fromEntries(EXTRA_RIGHTS.map(right=>[
      right.key,$('right-'+right.key).checked
    ]));
    busy(button,true);
    try{
      const result=await post({action:'setUserPermissions',userId:id,permissions});
      const user=state.records.find(x=>x.id===id);
      if(user)user.extra_permissions=result.permissions;
      $('userPermissionsDialog').close();
      message('Zapisano indywidualne uprawnienia użytkownika.','info');
    }catch(error){message(error.message||'Nie udało się zapisać uprawnień.','error');}
    finally{busy(button,false);}
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
      const protectedAdmin=Boolean(existing?.owner_protected||String(existing?.name||'').trim().toUpperCase()==='JJ');
      $('userStatusRow').hidden=!existing;
      $('userStatus').value=existing?(existing.active?'1':'0'):'1';
      $('userStatus').disabled=protectedAdmin;
      $('archiveUserBtn').hidden=!existing||protectedAdmin;
      $('deleteCrewBtn').hidden=!existing||protectedAdmin||existing.role_code!=='EKIPA';
      $('protectedAdminHint').hidden=!protectedAdmin;

      const roleInput=$('userRole');roleInput.replaceChildren();
      roleInput.disabled=protectedAdmin;
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
        checkbox.disabled=protectedAdmin;
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

  async function deleteUnusedCrew() {
    const id=$('editUserId').value;
    const nickname=$('userName').value;
    if(!id)return;
    if(!await confirmAction({
      title:'Trwale usunąć ekipę '+nickname+'?',
      description:'Usunięcie konta, jego PIN-u i przypisań jest nieodwracalne. Jeśli ekipa ma zapisane operacje, system odmówi usunięcia, aby nie uszkodzić stanów i historii.',
      confirmLabel:'Usuń na stałe',danger:true
    }))return;
    const button=$('deleteCrewBtn');busy(button,true);
    try{
      await post({action:'deleteUnusedCrew',userId:id});
      $('userDialog').close();
      state.expandedUserId=null;
      state.records=await api('users');
      if(state.view==='users')renderList();
      message('Ekipa '+nickname+' została usunięta na stałe.','info');
    }catch(error){message(error.message||'Nie udało się usunąć ekipy.','error');}
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

  // The WhatsApp message is created only in the browser while the one-time PIN
  // is visible. Neither the message nor its PIN is persisted or sent to the API.
  function pinMessage(pin) {
    return [
      'Aplikacja GPBS Storage',
      '',
      'Link do aplikacji:',
      'https://selfstorage-43f.pages.dev/',
      '',
      'PIN: '+pin,
      '',
      'Proszę nie udostępniać PIN-u innym osobom.'
    ].join('\n');
  }

  async function copyPinMessage(pin, label) {
    try {
      await navigator.clipboard.writeText(pinMessage(pin));
      message('Skopiowano wiadomość dla '+label+'. Możesz wkleić ją w WhatsApp.','info');
    } catch {
      message('Nie udało się skopiować wiadomości. Spróbuj ponownie przed zamknięciem okna.','error');
    }
  }

  function showGeneratedPins(entries) {
    const dialog=$('generatedPinsDialog');
    const target=$('generatedPinsResults');target.replaceChildren();
    const valid=entries.map(item=>({
      label:String(item.name||item.userId||'Użytkownik'),
      pin:String(item.pin||'')
    })).filter(item=>/^\d{4}$/.test(item.pin));
    const isBulk=valid.length>1;
    const lines=[];
    for(const {label,pin} of valid) {
      const row=document.createElement('div');row.className='pin-result-item';
      const who=document.createElement('strong');who.textContent=label;
      const value=document.createElement('code');value.textContent=pin;
      row.append(who,value);
      if(isBulk){
        const copy=document.createElement('button');
        copy.type='button';
        copy.className='btn mini pin-copy-message';
        copy.textContent='Kopiuj wiadomość';
        copy.addEventListener('click',()=>copyPinMessage(pin,label));
        row.append(copy);
      }
      target.append(row);
      lines.push(label+': '+pin);
    }
    // With one PIN the main Copy button is a ready-to-send WhatsApp message.
    // For a batch preserve the existing named PIN list and offer per-user copies.
    state.generatedPinText=isBulk?lines.join('\n'):(valid.length?pinMessage(valid[0].pin):'');
    $('copyGeneratedPins').textContent=isBulk?'Kopiuj listę PIN-ów':'Kopiuj wiadomość';
    $('copyGeneratedPins').disabled=valid.length===0;
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
      message($('copyGeneratedPins').textContent==='Kopiuj wiadomość'
        ?'Skopiowano wiadomość. Możesz wkleić ją w WhatsApp.'
        :'Skopiowano listę PIN-ów. Nie udostępniaj całej listy pracownikom.','info');
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

  async function submitSuperAdminCredential(event){
    event.preventDefault();
    if(!state.isSuperAdmin){message('Brak dostępu do tej funkcji.','error');return;}
    const pinMode=event.currentTarget.id==='superPinForm';
    const button=$(pinMode?'superPinSave':'superPasswordSave');
    busy(button,true);
    try{
      const currentPassword=$(pinMode?'superPinPassword':'superPasswordCurrent').value;
      const currentPin=$(pinMode?'superPinCurrent':'superPasswordPin').value.trim();
      const payload={action:'superAdminChange',credentialType:pinMode?'pin':'password',
        currentPassword,currentPin};
      if(pinMode){
        payload.newPin=$('superPinNew').value.trim();
        payload.confirmPin=$('superPinConfirm').value.trim();
        if(payload.newPin!==payload.confirmPin)throw Error('Nowe PIN-y nie są identyczne.');
      }else{
        payload.newPassword=$('superPasswordNew').value;
        payload.confirmPassword=$('superPasswordConfirm').value;
        if(payload.newPassword!==payload.confirmPassword)throw Error('Nowe hasła nie są identyczne.');
      }
      await post(payload);
      logoutLocally();
      $('loginNotice').textContent=pinMode
        ?'PIN zmieniony. Zaloguj się nowym PIN-em i dotychczasowym hasłem.'
        :'Hasło zmienione. Zaloguj się nowym hasłem i dotychczasowym PIN-em.';
      $('loginNotice').classList.remove('hidden');
      setError('');
    }catch(error){
      $('superPinForm').reset();
      $('superPasswordForm').reset();
      message(error.message||'Zmiana nie została zapisana.','error');
    }finally{busy(button,false);}
  }

  async function performLogin(event) {
    event.preventDefault();
    const button=$('loginButton');
    busy(button,true);
    setError('');
    $('loginNotice').classList.add('hidden');
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
    applyFontSize(storedFontSize(),false);
    applyTheme(storedTheme(),false);
    $('themeOptions').addEventListener('change',event=>{
      const input=event.target;
      if(input.matches('input[name="adminTheme"]'))applyTheme(input.value);
    });
    $('fontOptions').addEventListener('change',event=>{
      const input=event.target;
      if(input.matches('input[name="adminFontSize"]'))applyFontSize(input.value);
    });
    $('loginForm').addEventListener('submit',performLogin);
    $('superPinForm').addEventListener('submit',submitSuperAdminCredential);
    $('superPasswordForm').addEventListener('submit',submitSuperAdminCredential);
    $('logoutBtn').addEventListener('click',performLogout);
    $('newPartsAlert').addEventListener('click',()=>navigate('newParts'));
    $('vehicleAddPartBtn').addEventListener('click',()=>openVehiclePartChoice());
    $('vehiclePartSelectCancel').addEventListener('click',()=>$('vehiclePartSelectDialog').close());
    $('vehiclePartSelectDialog').querySelector('form')
      .addEventListener('submit',saveVehiclePartChoice);
    $('mainNav').addEventListener('click',event=>{
      const item=event.target.closest('[data-view]');if(item)navigate(item.dataset.view);
    });
    $('tableSearch').addEventListener('input',renderList);
    $('indexMigrationSearch').addEventListener('input',renderIndexMigration);
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
  $('deleteCrewBtn').addEventListener('click',deleteUnusedCrew);
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
    $('userPermissionsForm').addEventListener('submit',saveUserPermissions);
    $('closeUserPermissions').addEventListener('click',()=>$('userPermissionsDialog').close());
    $('cancelUserPermissions').addEventListener('click',()=>$('userPermissionsDialog').close());
    $('addPartBtn').addEventListener('click',openPartCreate);
    $('partCreateForm').addEventListener('submit',savePartCreate);
    $('partCreateCancel').addEventListener('click',()=>$('partCreateDialog').close());
    $('partEditForm').addEventListener('submit',savePartEditor);
    $('partEditDelete').addEventListener('click',()=>{
      const id=$('partEditId').value;
      const part=state.records.find(item=>item.id===id)||{
        id,name:$('partEditName').value,part_number:$('partEditNumber').value
      };
      removePart(part);
    });
    $('partEditPhoto').addEventListener('error',()=>{
      if(!$('partEditDialog').open)return;
      $('partEditError').textContent='Zdjęcie jest oznaczone w bazie, ale nie można go wyświetlić. Spróbuj zastąpić je plikiem JPG lub PNG i zapisać dane.';
      $('partEditError').classList.remove('hidden');
    });
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
