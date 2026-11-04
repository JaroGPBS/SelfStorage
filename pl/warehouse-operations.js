// GPBS Storage PL — one simple in-memory/tab-session PZ+WZ draft.
// Uses logged-in worker session; no PIN ever sent or stored here.
(() => {
  'use strict';
  const el=id=>document.getElementById(id);
  const camera=()=>window.GPBSInventoryCamera;
  const state={warehouse:null,userId:'',direction:'PZ',stage:'details',pz:new Map(),wz:new Map(),
    ready:false,part:null,pending:null,busy:false,searchSeq:0,scanSeq:0,
    scanning:false,stopPromise:null,searchPage:0,hasMore:false};
  const MAX_QUANTITY=100000;
  const upperName=value=>String(value||'').trim().replace(/\s+/g,' ').toLocaleUpperCase('pl-PL');
  const upperPlate=value=>String(value||'').trim().replace(/\s+/g,' ').toUpperCase();
  const validPlate=value=>/^[A-Z0-9][A-Z0-9 -]{1,19}$/.test(value) && /[A-Z0-9]$/.test(value);


  function key(){
    return 'gpbs_pl_session_draft_v1_'+state.userId+'_'+state.warehouse?.id;
  }
  function lines(which){
    return [...(which==='PZ'?state.pz:state.wz).values()];
  }
  function saveDraft(){
    if(!state.warehouse||!state.userId)return;
    try{
      sessionStorage.setItem(key(),JSON.stringify({
        counterparty:upperName(el('operationCounterparty').value),
        registrationPlate:upperPlate(el('operationPlate').value),
        stage:state.stage,
        pz:lines('PZ'),wz:lines('WZ'),pending:state.pending
      }));
    }catch{}
  }
  function restoreDraft(){
    state.pz.clear();state.wz.clear();state.pending=null;state.stage='details';
    el('operationCounterparty').value='';
    el('operationPlate').value='';
    try{
      const data=JSON.parse(sessionStorage.getItem(key())||'null');
      if(!data)return;
      el('operationCounterparty').value=upperName(data.counterparty).slice(0,90);
      el('operationPlate').value=upperPlate(data.registrationPlate).slice(0,20);
      if(['menu','PZ','WZ'].includes(data.stage)&&
        el('operationCounterparty').value.length>=2&&validPlate(el('operationPlate').value))
        state.stage=data.stage;
      for(const side of ['pz','wz']){
        const target=side==='pz'?state.pz:state.wz;
        if(!Array.isArray(data[side]))continue;
        for(const row of data[side].slice(0,80)){
          if(typeof row?.id==='string'&&row.id.length<=100&&
             Number.isSafeInteger(row.quantity)&&row.quantity>0&&row.quantity<=MAX_QUANTITY){
            target.set(row.id,{id:row.id,name:String(row.name||row.id).slice(0,120),
              number:String(row.number||row.id).slice(0,100),quantity:row.quantity});
          }
        }
      }
      if(data.pending&&/^PL-SES-[a-f0-9-]{36}$/.test(data.pending.id||'')&&
        data.pending.warehouseId===state.warehouse.id&&
        Array.isArray(data.pending.pz)&&Array.isArray(data.pending.wz))
        state.pending=data.pending;
      if(state.pending)state.stage='menu';
    }catch{}
  }
  async function api(path,options={}){
    const response=await fetch(path,{cache:'no-store',credentials:'same-origin',...options});
    let data=null;
    try{data=await response.json();}catch{}
    if(!response.ok||!data?.ok){
      const error=new Error(data?.error||'Błąd połączenia z serwerem.');
      error.status=response.status;
      throw error;
    }
    return data;
  }
  function status(text='',error=false){
    for(const id of ['operationStatus','operationTaskStatus']){
      const node=el(id);
      node.textContent=text;
      node.hidden=!text;
      node.classList.toggle('error',error);
    }
  }
  function quantityError(message=''){
    const node=el('operationQuantityError');
    node.textContent=message;
    node.hidden=!message;
  }
  function closeQuantity(){
    if(el('operationQuantityDialog').open)el('operationQuantityDialog').close();
    state.part=null;
    el('operationQuantity').value='';
    quantityError();
    el('operationQuantityForm').hidden=true;
  }
  function disableDuringPending(){
    const lock=!!state.pending||state.busy;
    for(const id of ['operationCounterparty','operationPlate','operationVisitContinue',
      'operationEditVisit','operationBackToMenu','operationSearchQuery','operationSearchButton',
      'operationStartScan','operationAddButton','operationQuantity',
      'operationTabPZ','operationTabWZ','operationClearSearch']){
      el(id).disabled=lock;
    }
    // Pending commits cannot be discarded, but the user should be told why.
    el('operationCancelSession').disabled=state.busy;
    // A click must always produce clear feedback, even when no parts were added.
    el('operationSave').disabled=state.busy||!state.ready;
    el('operationSave').textContent=state.pending?'Ponów zapis tej samej wizyty':'Zakończ wizytę';
  }

  function makeLine(row,side){
    const item=document.createElement('div');
    item.className='operation-line';
    const description=document.createElement('div');
    description.className='operation-line-description';
    const title=document.createElement('strong');
    title.textContent=row.name;
    const subtitle=document.createElement('small');
    subtitle.textContent=row.number+' · '+row.quantity+' szt.';
    description.append(title,subtitle);
    const button=document.createElement('button');
    button.type='button';
    button.className='operation-remove';
    button.textContent='Usuń';
    button.disabled=!!state.pending||state.busy;
    button.addEventListener('click',()=>{
      if(state.pending||state.busy)return;
      (side==='PZ'?state.pz:state.wz).delete(row.id);
      saveDraft();render();
    });
    item.append(description,button);
    return item;
  }

  function render(){
    for(const side of ['PZ','WZ']){
      const list=el('operation'+side+'List');
      list.replaceChildren();
      const entries=lines(side);
      const count=entries.length;
      el('operation'+side+'Count').textContent=count+' '+
        (count===1?'pozycja':(count%10>=2&&count%10<=4&&!(count%100>=12&&count%100<=14)
          ?'pozycje':'pozycji'));
      list.hidden=state.stage!==side;
      if(!entries.length){
        const empty=document.createElement('p');
        empty.className='operation-empty';
        empty.textContent=side==='PZ'?'Brak przyjętych części.':'Brak wydanych części.';
        list.append(empty);
      }else{
        for(const line of entries)list.append(makeLine(line,side));
      }
    }
    for(const side of ['PZ','WZ']){
      const tab=el('operationTab'+side);
      const active=state.stage===side;
      tab.setAttribute('aria-pressed',String(active));
      tab.classList.toggle('selected',active);
    }
    el('operationSearchCaption').textContent=state.direction==='PZ'
      ?'Dodaj część przyjmowaną do magazynu.'
      :'Dodaj część wydawaną z magazynu.';
    el('operationQuantityForm').hidden=!state.part;
    const details=state.stage==='details'&&!state.pending;
    const taskOpen=state.ready&&['PZ','WZ'].includes(state.stage);
    el('operationVisitForm').hidden=!details;
    el('operationWorkspace').hidden=details;
    el('operationDirectionPanel').hidden=!taskOpen;
    el('operationTaskTitle').textContent=state.stage==='WZ'?'WYDANIE (WZ)':'PRZYJĘCIE (PZ)';
    el('operationDirectionPanel').classList.toggle('task-wz',state.stage==='WZ');
    document.body.classList.toggle('operation-task-open',taskOpen);
    el('operationVisitCounterparty').textContent=upperName(el('operationCounterparty').value)||'—';
    el('operationVisitPlate').textContent=upperPlate(el('operationPlate').value)||'—';
    el('operationVisitorLine').hidden=details||!state.ready;
    el('operationEditVisit').hidden=!!state.pending;
    el('backFromOperationButton').textContent='← Cofnij';
    disableDuringPending();
  }

  function beginVisit(event){
    event.preventDefault();
    if(!state.ready||state.busy||state.pending)return;
    const counterparty=upperName(el('operationCounterparty').value);
    const registrationPlate=upperPlate(el('operationPlate').value);
    if(counterparty.length<2||counterparty.length>90){
      status('Wpisz nazwę ekipy lub dostawcy (2–90 znaków).',true);
      el('operationCounterparty').focus();
      return;
    }
    if(!validPlate(registrationPlate)){
      status('Wpisz numer rejestracyjny (2–20 znaków: litery, cyfry, spacje lub myślnik).',true);
      el('operationPlate').focus();
      return;
    }
    el('operationCounterparty').value=counterparty;
    el('operationPlate').value=registrationPlate;
    state.stage='menu';
    status('');
    saveDraft();
    render();
  }

  function editVisit(){
    if(state.pending||state.busy)return;
    state.stage='details';
    closeQuantity();
    stopScanner();
    saveDraft();render();
  }

  function backToMenu(){
    if(!['PZ','WZ'].includes(state.stage))return false;
    state.stage='menu';
    state.searchSeq++;
    closeQuantity();
    el('operationSearchResults').replaceChildren();
    el('operationSearchQuery').value='';
    stopScanner();
    status('');
    saveDraft();render();
    return true;
  }

  function changeDirection(side){
    if(state.pending||state.busy)return;
    if(!['PZ','WZ'].includes(side))return;
    state.direction=side;
    state.stage=side;
    state.searchSeq++;
    closeQuantity();
    el('operationSearchResults').replaceChildren();
    el('operationSearchQuery').value='';
    stopScanner();
    status('');
    saveDraft();render();
  }

  function selectPart(part){
    if(state.pending||state.busy||!['PZ','WZ'].includes(state.stage))return;
    state.part=part;
    el('operationPartName').textContent=part.name+' · '+part.number;
    el('operationQuantity').value='';
    quantityError();
    el('operationQuantityForm').hidden=false;
    const dlg=el('operationQuantityDialog');
    if(!dlg.open)dlg.showModal();
    el('operationQuantity').focus({preventScroll:true});
  }

  function addPart(event){
    event.preventDefault();
    if(!state.part||state.pending||state.busy)return;
    const raw=el('operationQuantity').value;
    const quantity=Number(raw);
    if(!/^[1-9]\d{0,5}$/.test(raw)||!Number.isSafeInteger(quantity)||
      quantity<1||quantity>MAX_QUANTITY){
      quantityError('Wpisz ilość od 1 do 100000 sztuk.');return;
    }
    const target=state.direction==='PZ'?state.pz:state.wz;
    const old=target.get(state.part.id);
    if((old?.quantity||0)+quantity>MAX_QUANTITY){
      quantityError('Na jednej pozycji można zapisać maksymalnie 100000 sztuk.');return;
    }
    target.set(state.part.id,{
      id:state.part.id,name:state.part.name,number:state.part.number,
      quantity:(old?.quantity||0)+quantity
    });
    closeQuantity();
    saveDraft();
    status('Dodano '+quantity+' szt. do '+state.direction+'.');
    render();
  }

  async function search(append=false){
    if(!state.warehouse||state.pending||state.busy)return;
    const seq=++state.searchSeq;
    const warehouseId=state.warehouse.id;
    const page=append?state.searchPage+1:0;
    const query=el('operationSearchQuery').value.trim();
    if(!query){
      status('Wpisz indeks lub numer SAP części.',true);
      return;
    }
    if(!append)el('operationSearchResults').replaceChildren();
    el('operationMore').hidden=true;
    try{
      // An exact manually typed index opens quantity directly; partial entries
      // still use the existing catalogue search to choose the correct part.
      if(!append){
        try{
          const exact=await api('/api/pl/warehouse?view=resolve&warehouse='+
            encodeURIComponent(warehouseId)+'&code='+encodeURIComponent(query));
          if(seq!==state.searchSeq||state.warehouse?.id!==warehouseId||
             !['PZ','WZ'].includes(state.stage))return;
          el('operationSearchQuery').value='';
          selectPart({id:exact.part.id,name:exact.part.name,number:exact.part.number});
          return;
        }catch(error){
          if(error.status!==404&&error.status!==400)throw error;
        }
      }
      const data=await api('/api/pl/warehouse?warehouse='+
        encodeURIComponent(warehouseId)+'&q='+encodeURIComponent(query)+
        '&page='+page);
      if(seq!==state.searchSeq||state.warehouse?.id!==warehouseId||
         !['PZ','WZ'].includes(state.stage))return;
      state.searchPage=page;
      state.hasMore=Boolean(data.stock?.hasMore);
      const results=el('operationSearchResults');
      for(const part of (data.stock?.items||[])){
        const button=document.createElement('button');
        button.type='button';
        button.className='operation-result';
        const description=document.createElement('span');
        description.textContent=part.name+' · '+part.number;
        const stock=document.createElement('small');
        stock.textContent=part.quantity===null?'Nieustalony':'Stan: '+part.quantity+' szt.';
        if(part.needsVerification)stock.textContent+=' · do weryfikacji';
        button.append(description,stock);
        button.addEventListener('click',()=>selectPart({
          id:part.id,name:part.name,number:part.number
        }));
        results.append(button);
      }
      if(!results.children.length)status('Nie znaleziono części. Sprawdź kod lub użyj inwentaryzacji.',true);
      el('operationMore').hidden=!state.hasMore;
    }catch(error){
      if(seq===state.searchSeq)status(error.message,true);
    }
  }

  async function stopScanner(){
    state.scanSeq++;
    state.scanning=false;
    el('operationScanPanel').hidden=true;
    el('operationStartScan').hidden=false;
    if(el('operationScanDialog').open)el('operationScanDialog').close();
    const stop=Promise.resolve(camera()?.stop()).catch(()=>{});
    state.stopPromise=stop;
    await stop;
    if(state.stopPromise===stop)state.stopPromise=null;
  }
  async function startScanner(){
    if(state.scanning||state.pending||state.busy||!state.warehouse||
       !['PZ','WZ'].includes(state.stage))return;
    const warehouseId=state.warehouse.id;
    const direction=state.direction;
    const seq=++state.scanSeq;
    if(state.stopPromise)await state.stopPromise;
    if(seq!==state.scanSeq)return;
    el('operationScanPanel').hidden=false;
    el('operationStartScan').hidden=true;
    if(!el('operationScanDialog').open)el('operationScanDialog').showModal();
    el('operationScannerStatus').textContent='Uruchamianie aparatu…';
    state.scanning=true;
    try{
      await camera().start(async code=>{
        if(seq!==state.scanSeq||state.warehouse?.id!==warehouseId)return;
        // One scan at a time. Camera is stopped before selecting a quantity.
        await stopScanner();
        try{
          const data=await api('/api/pl/warehouse?view=resolve&warehouse='+
            encodeURIComponent(warehouseId)+'&code='+encodeURIComponent(code));
          if(state.warehouse?.id!==warehouseId||state.stage!==direction)return;
          selectPart({id:data.part.id,name:data.part.name,number:data.part.number});
          status('Kod odczytany. Wpisz ilość.');
        }catch(error){
          status(error.status===404
            ?'Nieznany kod. Najpierw dodaj część podczas inwentaryzacji.'
            :error.message,true);
        }
      },'operationReader');
    }catch(error){
      if(seq===state.scanSeq){
        await stopScanner();
        status('Nie udało się uruchomić aparatu: '+error.message,true);
      }
    }
  }

  async function checkReady(){
    if(!state.warehouse)return;
    const warehouseId=state.warehouse.id;
    try{
      const data=await api('/api/pl/session?warehouse='+encodeURIComponent(warehouseId));
      if(state.warehouse?.id!==warehouseId)return;
      state.ready=Boolean(data.ready);
      el('operationReadyNotice').hidden=state.ready;
      el('operationReadyNotice').textContent=state.ready?''
        :'Moduł PZ/WZ wymaga migracji db/13-pl-confirmed-overissues.sql w D1.';
      el('operationForm').hidden=!state.ready;
      render();
    }catch(error){
      if(state.warehouse?.id!==warehouseId)return;
      state.ready=false;
      el('operationReadyNotice').hidden=false;
      el('operationReadyNotice').textContent=error.message;
      el('operationForm').hidden=true;
    }
  }

  function payloadForCommit(){
    const counterparty=upperName(el('operationCounterparty').value);
    const registrationPlate=upperPlate(el('operationPlate').value);
    if(counterparty.length<2||counterparty.length>90){
      status('Wpisz ekipę lub dostawcę (2–90 znaków).',true);
      el('operationCounterparty').focus();
      return null;
    }
    if(!validPlate(registrationPlate)){
      status('Wpisz poprawny numer rejestracyjny.',true);
      el('operationPlate').focus();
      return null;
    }
    el('operationCounterparty').value=counterparty;
    el('operationPlate').value=registrationPlate;
    const pz=lines('PZ').map(row=>({partId:row.id,quantity:row.quantity}));
    const wz=lines('WZ').map(row=>({partId:row.id,quantity:row.quantity}));
    if(!pz.length&&!wz.length){status('Dodaj co najmniej jedną część.',true);return null;}
    return {id:'PL-SES-'+crypto.randomUUID(),warehouseId:state.warehouse.id,
      counterparty,registrationPlate,pz,wz};
  }

  async function review(){
    if(!state.ready||state.busy||!state.warehouse)return;
    if(state.pending){
      const approved=await window.GPBSPlConfirm.ask({
        title:'Czy na pewno chcesz zakończyć wizytę?',
        message:'Ponowić zapis tej samej wizyty? Jej numer nie zostanie zmieniony, więc części nie zostaną naliczone drugi raz.',
        approveLabel:'Tak, ponów zapis'
      });
      if(approved)submit();
      return;
    }
    if(!lines('PZ').length&&!lines('WZ').length){
      await window.GPBSPlConfirm.ask({
        title:'Brak pozycji do zapisania',
        message:'Nie dodano jeszcze żadnej części. Dodaj pozycję w Przyjęciu lub Wydaniu albo wybierz Anuluj wizytę.',
        approveLabel:'Rozumiem'
      });
      return;
    }
    const input=payloadForCommit();
    if(!input)return;
    state.reviewPayload=null;
    state.busy=true;
    disableDuringPending();
    status('Sprawdzanie aktualnych stanów magazynowych…');
    try{
      const preview=await api('/api/pl/session',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...input,action:'preview'})
      });
      if(!state.warehouse||state.warehouse.id!==input.warehouseId)return;
      state.reviewPayload={...input,action:'commit',
        stockSnapshot:preview.stockSnapshot,
        confirmedOverissue:preview.requiresConfirmation};
      const amount=side=>input[side].reduce((n,l)=>n+l.quantity,0);
      el('operationConfirmText').textContent=
        'Ekipa / dostawca / odbiorca: '+input.counterparty+
        '\nNumer rejestracyjny: '+input.registrationPlate+
        '\nPrzyjęcie PZ: '+input.pz.length+' pozycji · '+amount('pz')+' szt.'+
        '\nWydanie WZ: '+input.wz.length+' pozycji · '+amount('wz')+' szt.'+
        '\nZapisze oba dokumenty razem i zaktualizuje stany magazynu.';
      const warnings=preview.warnings||[];
      const warning=el('operationConfirmWarning');
      warning.hidden=!warnings.length;
      warning.textContent=warnings.length?
        'UWAGA! Wydajesz więcej niż jest na stanie. Czy na pewno ilość się zgadza?\n'+
        warnings.map(row=>row.unknown
          ?row.name+': stan nieustalony, wydajesz '+row.issued+
            ' szt. (w tej sesji przyjęto '+row.received+' szt.).'
          :row.name+': na stanie po przyjęciu '+row.available+
            ' szt., wydajesz '+row.issued+
            ' szt. — różnica '+row.shortfall+' szt.').join('\n')
        :'';
      el('operationConfirmTitle').textContent='Czy na pewno chcesz zakończyć wizytę?';
      el('operationConfirmApprove').textContent=warnings.length
        ?'Potwierdź wydanie i zakończ':'Tak, zakończ i zapisz';
      status('');
      el('operationConfirmDialog').showModal();
    }catch(error){
      status('Nie można sprawdzić stanów: '+error.message,true);
    }finally{
      state.busy=false;
      render();
    }
  }

  async function submit(){
    if(!state.warehouse||!state.ready||state.busy)return;
    if(!state.pending){
      if(!state.reviewPayload)return;
      state.pending=state.reviewPayload;
      state.reviewPayload=null;
      saveDraft();
    }
    const payload=state.pending;
    state.busy=true;disableDuringPending();
    status('Zapisywanie sesji…');
    try{
      const data=await api('/api/pl/session',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      });
      if(state.warehouse?.id!==payload.warehouseId)return;
      // The same ID is never sent again once server acknowledges the commit.
      state.pending=null;state.pz.clear();state.wz.clear();
      closeQuantity();
      state.stage='details';
      el('operationCounterparty').value='';
      el('operationPlate').value='';
      el('operationSearchResults').replaceChildren();
      el('operationQuantityForm').hidden=true;
      saveDraft();
      let committedAt='';
      if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(data.committedAt||'')){
        const date=new Date(data.committedAt.replace(' ','T')+'Z');
        committedAt=' Data i godzina (Polska): '+new Intl.DateTimeFormat('pl-PL',{
          timeZone:'Europe/Warsaw',dateStyle:'short',timeStyle:'short'
        }).format(date)+'.';
      }
      status((data.alreadySaved?'Sesja już była zapisana. ':'Zapisano sesję. ')+
        'PZ: '+data.pzItems+' pozycji, WZ: '+data.wzItems+
        ' pozycji. Numer: '+data.id+'.'+committedAt);
      document.dispatchEvent(new Event('gpbs-pl-operation-committed'));
    }catch(error){
      if(error.status===400||error.status===403||error.status===409){
        // Definitive rejection: allow correcting the draft and a new ID.
        state.pending=null;saveDraft();
      }
      status(error.message+(state.pending
        ?' Ponów zapis bez zmieniania sesji — dane nie zostaną naliczone drugi raz.'
        :' Popraw dane i zatwierdź ponownie.'),true);
    }finally{
      state.busy=false;render();
    }
  }

  async function discard(){
    if(state.busy)return;
    if(state.pending){
      await window.GPBSPlConfirm.ask({
        title:'Nie można anulować wizyty',
        message:'Zapis tej wizyty mógł już dotrzeć do D1. Wybierz „Ponów zapis tej samej wizyty”, aby bezpiecznie sprawdzić wynik bez podwójnego naliczania części.',
        approveLabel:'Rozumiem'
      });
      return;
    }
    const approved=await window.GPBSPlConfirm.ask({
      title:'Czy na pewno chcesz anulować wizytę?',
      message:'Wszystkie niezapisane przyjęcia i wydania z tej wizyty zostaną usunięte.',
      approveLabel:'Tak, anuluj wizytę'
    });
    if(!approved||state.pending||state.busy||!state.warehouse)return;
    state.pz.clear();state.wz.clear();closeQuantity();state.stage='details';
    el('operationCounterparty').value='';
    el('operationPlate').value='';
    el('operationSearchResults').replaceChildren();
    status('Anulowano niezapisaną wizytę.');
    saveDraft();render();
  }

  function open(warehouse,userId){
    if(!warehouse?.id||!userId)return;
    const same=state.warehouse?.id===warehouse.id&&state.userId===userId;
    if(!same){
      state.warehouse=warehouse;
      state.userId=userId;
      state.ready=false;
      restoreDraft();
    }
    state.direction=['PZ','WZ'].includes(state.stage)?state.stage:'PZ';
    state.part=null;
    el('operationWarehouseCaption').textContent=warehouse.name+' · '+warehouse.id;
    el('operationSearchResults').replaceChildren();
    el('operationSearchQuery').value='';
    el('operationQuantityForm').hidden=true;
    el('operationScanPanel').hidden=true;
    el('operationStartScan').hidden=false;
    status('');
    render();
    checkReady();
  }
  function close(){
    stopScanner();
    closeQuantity();
    el('operationDirectionPanel').hidden=true;
    document.body.classList.remove('operation-task-open');
    state.searchSeq++;
    state.warehouse=null;state.userId='';
    state.part=null;state.ready=false;
  }
  function clearSaved(warehouseId,userId){
    try{sessionStorage.removeItem('gpbs_pl_session_draft_v1_'+userId+'_'+warehouseId);}catch{}
  }

  function uppercaseInput(id,formatter){
    const input=el(id);
    input.addEventListener('input',()=>{
      const next=formatter(input.value);
      if(next!==input.value){
        const start=input.selectionStart,end=input.selectionEnd;
        input.value=next;
        try{input.setSelectionRange(start,end);}catch{}
      }
      saveDraft();
    });
  }
  uppercaseInput('operationCounterparty',v=>v.toLocaleUpperCase('pl-PL'));
  uppercaseInput('operationPlate',v=>v.toUpperCase());
  el('operationVisitForm').addEventListener('submit',beginVisit);
  el('operationEditVisit').addEventListener('click',editVisit);
  el('operationBackToMenu').addEventListener('click',backToMenu);
  el('operationTabPZ').addEventListener('click',()=>changeDirection('PZ'));
  el('operationTabWZ').addEventListener('click',()=>changeDirection('WZ'));
  el('operationSearchForm').addEventListener('submit',event=>{
    event.preventDefault();search();
  });
  el('operationMore').addEventListener('click',()=>search(true));
  el('operationQuantityForm').addEventListener('submit',addPart);
  el('operationCancelPart').addEventListener('click',()=>{
    closeQuantity();render();
  });
  el('operationQuantityDialog').addEventListener('cancel',event=>{
    event.preventDefault();
    closeQuantity();render();
  });
  el('operationKeypad').addEventListener('click',event=>{
    const button=event.target.closest('button[data-digit]');
    if(!button||!state.part||state.pending||state.busy)return;
    const input=el('operationQuantity');
    const digit=button.dataset.digit;
    if(digit==='clear')input.value='';
    else if(digit==='backspace')input.value=input.value.slice(0,-1);
    else if(/^\\d$/.test(digit)&&input.value.length<6)input.value+=digit;
    quantityError();
  });
  el('operationScanDialog').addEventListener('cancel',event=>{
    event.preventDefault();
    stopScanner();
  });
  el('operationCancelSession').addEventListener('click',discard);
  el('operationStartScan').addEventListener('click',startScanner);
  el('operationStopScan').addEventListener('click',stopScanner);
  el('operationClearSearch').addEventListener('click',()=>{
    el('operationSearchQuery').value='';el('operationSearchResults').replaceChildren();
  });
  el('operationSave').addEventListener('click',review);
  el('operationConfirmCancel').addEventListener('click',()=>{
    state.reviewPayload=null;el('operationConfirmDialog').close();
  });
  el('operationConfirmApprove').addEventListener('click',()=>{
    el('operationConfirmDialog').close();submit();
  });
  el('operationConfirmDialog').addEventListener('cancel',()=>{
    state.reviewPayload=null;
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden&&state.scanning)stopScanner();
  });

  window.GPBSPlOperations={open,close,clearSaved,backToMenu};
})();
