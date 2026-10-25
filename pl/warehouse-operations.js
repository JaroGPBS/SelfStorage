// GPBS Storage PL — one simple in-memory/tab-session PZ+WZ draft.
// Uses logged-in worker session; no PIN ever sent or stored here.
(() => {
  'use strict';
  const el=id=>document.getElementById(id);
  const camera=()=>window.GPBSInventoryCamera;
  const state={warehouse:null,userId:'',direction:'PZ',pz:new Map(),wz:new Map(),
    ready:false,part:null,pending:null,busy:false,searchSeq:0,scanSeq:0,
    scanning:false,stopPromise:null,searchPage:0,hasMore:false};
  const MAX_QUANTITY=100000;

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
        counterparty:el('operationCounterparty').value,
        pz:lines('PZ'),wz:lines('WZ'),pending:state.pending
      }));
    }catch{}
  }
  function restoreDraft(){
    state.pz.clear();state.wz.clear();state.pending=null;
    el('operationCounterparty').value='';
    try{
      const data=JSON.parse(sessionStorage.getItem(key())||'null');
      if(!data)return;
      el('operationCounterparty').value=String(data.counterparty||'').slice(0,120);
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
    const node=el('operationStatus');
    node.textContent=text;
    node.hidden=!text;
    node.classList.toggle('error',error);
  }
  function disableDuringPending(){
    const lock=!!state.pending||state.busy;
    for(const id of ['operationCounterparty','operationSearchQuery','operationSearchButton',
      'operationStartScan','operationAddButton','operationQuantity',
      'operationTabPZ','operationTabWZ','operationCancelSession','operationClearSearch']){
      el(id).disabled=lock;
    }
    el('operationSave').disabled=state.busy||!state.ready||
      (!state.pending&&!lines('PZ').length&&!lines('WZ').length);
    el('operationSave').textContent=state.pending?'Ponów zapis tej samej sesji':'Zakończ i zapisz sesję';
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
      const quantity=entries.reduce((sum,line)=>sum+line.quantity,0);
      el('operation'+side+'Count').textContent=entries.length+' poz. · '+quantity+' szt.';
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
      const active=state.direction===side;
      tab.setAttribute('aria-pressed',String(active));
      tab.classList.toggle('selected',active);
    }
    el('operationSearchCaption').textContent=state.direction==='PZ'
      ?'Dodaj część przyjmowaną do magazynu.'
      :'Dodaj część wydawaną z magazynu.';
    el('operationQuantityForm').hidden=!state.part;
    disableDuringPending();
  }

  function changeDirection(side){
    if(state.pending||state.busy)return;
    state.direction=side;
    state.part=null;
    el('operationSearchResults').replaceChildren();
    el('operationSearchQuery').value='';
    el('operationQuantityForm').hidden=true;
    stopScanner();
    render();
  }

  function selectPart(part){
    if(state.pending||state.busy)return;
    state.part=part;
    el('operationPartName').textContent=part.name+' · '+part.number;
    el('operationQuantity').value='';
    el('operationQuantityForm').hidden=false;
    el('operationQuantity').focus({preventScroll:true});
  }

  function addPart(event){
    event.preventDefault();
    if(!state.part||state.pending||state.busy)return;
    const raw=el('operationQuantity').value;
    const quantity=Number(raw);
    if(!/^[1-9]\d{0,5}$/.test(raw)||!Number.isSafeInteger(quantity)||
      quantity<1||quantity>MAX_QUANTITY){
      status('Wpisz ilość od 1 do 100000 sztuk.',true);return;
    }
    const target=state.direction==='PZ'?state.pz:state.wz;
    const old=target.get(state.part.id);
    if((old?.quantity||0)+quantity>MAX_QUANTITY){
      status('Na jednej pozycji można zapisać maksymalnie 100000 sztuk.',true);return;
    }
    target.set(state.part.id,{
      id:state.part.id,name:state.part.name,number:state.part.number,
      quantity:(old?.quantity||0)+quantity
    });
    state.part=null;
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
    if(!append)el('operationSearchResults').replaceChildren();
    el('operationMore').hidden=true;
    try{
      const data=await api('/api/pl/warehouse?warehouse='+
        encodeURIComponent(warehouseId)+'&q='+encodeURIComponent(query)+
        '&page='+page);
      if(seq!==state.searchSeq||state.warehouse?.id!==warehouseId)return;
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
    const stop=Promise.resolve(camera()?.stop()).catch(()=>{});
    state.stopPromise=stop;
    await stop;
    if(state.stopPromise===stop)state.stopPromise=null;
  }
  async function startScanner(){
    if(state.scanning||state.pending||state.busy||!state.warehouse)return;
    const warehouseId=state.warehouse.id;
    const seq=++state.scanSeq;
    if(state.stopPromise)await state.stopPromise;
    if(seq!==state.scanSeq)return;
    el('operationScanPanel').hidden=false;
    el('operationStartScan').hidden=true;
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
          if(state.warehouse?.id!==warehouseId)return;
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
        :'Moduł PZ/WZ wymaga jeszcze migracji db/11-pl-warehouse-sessions.sql w D1.';
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
    const counterparty=el('operationCounterparty').value.trim().replace(/\s+/g,' ');
    if(counterparty.length<2||counterparty.length>120){
      status('Wpisz ekipę, dostawcę lub odbiorcę (2–120 znaków).',true);
      el('operationCounterparty').focus();
      return null;
    }
    const pz=lines('PZ').map(row=>({partId:row.id,quantity:row.quantity}));
    const wz=lines('WZ').map(row=>({partId:row.id,quantity:row.quantity}));
    if(!pz.length&&!wz.length){status('Dodaj co najmniej jedną część.',true);return null;}
    return {id:'PL-SES-'+crypto.randomUUID(),warehouseId:state.warehouse.id,
      counterparty,pz,wz};
  }

  function review(){
    if(!state.ready||state.busy||!state.warehouse)return;
    if(state.pending){submit();return;}
    const input=payloadForCommit();
    if(!input)return;
    state.reviewPayload=input;
    const amount=side=>input[side].reduce((n,l)=>n+l.quantity,0);
    el('operationConfirmText').textContent=
      'Ekipa / dostawca / odbiorca: '+input.counterparty+
      '\nPrzyjęcie PZ: '+input.pz.length+' pozycji · '+amount('pz')+' szt.'+
      '\nWydanie WZ: '+input.wz.length+' pozycji · '+amount('wz')+' szt.'+
      '\nZapisze oba dokumenty razem i zaktualizuje stany magazynu.';
    el('operationConfirmDialog').showModal();
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
      state.pending=null;state.pz.clear();state.wz.clear();state.part=null;
      el('operationCounterparty').value='';
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

  function discard(){
    if(state.pending)return;
    if((state.pz.size||state.wz.size)&&!confirm('Usunąć niezapisane PZ i WZ z tej sesji?'))return;
    state.pz.clear();state.wz.clear();state.part=null;
    el('operationCounterparty').value='';
    el('operationSearchResults').replaceChildren();
    status('Wyczyszczono bieżący szkic sesji.');
    saveDraft();render();
  }

  function open(warehouse,userId,direction='PZ'){
    if(!warehouse?.id||!userId)return;
    const same=state.warehouse?.id===warehouse.id&&state.userId===userId;
    if(!same){
      state.warehouse=warehouse;
      state.userId=userId;
      state.ready=false;
      restoreDraft();
    }
    state.direction=direction==='WZ'?'WZ':'PZ';
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
    state.searchSeq++;
    state.warehouse=null;state.userId='';
    state.part=null;state.ready=false;
  }
  function clearSaved(warehouseId,userId){
    try{sessionStorage.removeItem('gpbs_pl_session_draft_v1_'+userId+'_'+warehouseId);}catch{}
  }

  el('operationCounterparty').addEventListener('input',saveDraft);
  el('operationTabPZ').addEventListener('click',()=>changeDirection('PZ'));
  el('operationTabWZ').addEventListener('click',()=>changeDirection('WZ'));
  el('operationSearchForm').addEventListener('submit',event=>{
    event.preventDefault();search();
  });
  el('operationMore').addEventListener('click',()=>search(true));
  el('operationQuantityForm').addEventListener('submit',addPart);
  el('operationCancelPart').addEventListener('click',()=>{
    state.part=null;render();
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

  window.GPBSPlOperations={open,close,clearSaved};
})();
