// GPBS Storage PL — one simple in-memory/tab-session PZ+WZ draft.
// Uses logged-in worker session; no PIN ever sent or stored here.
(() => {
  'use strict';
  const el=id=>document.getElementById(id);
  const camera=()=>window.GPBSInventoryCamera;
  const state={warehouse:null,userId:'',direction:'PZ',stage:'details',pz:new Map(),wz:new Map(),
    ready:false,part:null,pending:null,busy:false,searchSeq:0,scanSeq:0,
    scanning:false,stopPromise:null,searchPage:0,hasMore:false,photoPreviewUrl:null};
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
      'operationStartScan','operationNewPartOpen','operationAddButton','operationQuantity',
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

  function newPartError(message='') {
    const node=el('operationNewPartError');
    node.textContent=message;
    node.hidden=!message;
  }
  function releaseNewPartPreview() {
    if(state.photoPreviewUrl)URL.revokeObjectURL(state.photoPreviewUrl);
    state.photoPreviewUrl=null;
    el('operationNewPartPreview').removeAttribute('src');
    el('operationNewPartPreview').hidden=true;
  }
  function openNewPart() {
    if(state.pending||state.busy||!state.warehouse||
       !['PZ','WZ'].includes(state.stage))return;
    el('operationNewPartForm').reset();
    releaseNewPartPreview();
    newPartError('');
    el('operationNewPartDialog').showModal();
  }
  function closeNewPart() {
    if(state.busy)return;
    if(el('operationNewPartDialog').open)el('operationNewPartDialog').close();
    releaseNewPartPreview();
    newPartError('');
  }
  // A browser file picker is only a hint: inspect actual bytes before any upload.
  // Camera images and files from disk follow the same rules.
  async function validatePartPhotoFile(file){
    if(!file)return;
    if(file.size<16||file.size>20*1024*1024)
      throw Error('Zdjęcie musi mieć od 16 B do 20 MB.');
    const ext=String(file.name||'').split('.').pop().toLowerCase();
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
  
  async function photoForNewPart(file) {
    if(!file)return '';
    await validatePartPhotoFile(file);
    const objectUrl=URL.createObjectURL(file);
    const img=new Image();
    try {
      await new Promise((resolve,reject)=>{
        img.onload=resolve;
        img.onerror=()=>reject(Error('Nie można otworzyć zdjęcia. Wybierz plik JPG lub zrób nowe zdjęcie.'));
        img.src=objectUrl;
      });
      if(!img.naturalWidth||!img.naturalHeight)throw Error('Nie można odczytać zdjęcia.');
      for(const maxSide of [1050,900,750,600]) {
        const ratio=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));
        const canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));
        canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
        const ctx=canvas.getContext('2d');
        if(!ctx)throw Error('Przeglądarka nie może przygotować zdjęcia.');
        ctx.fillStyle='#ffffff';
        ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img,0,0,canvas.width,canvas.height);
        for(const quality of [.78,.67,.55]) {
          const encoded=canvas.toDataURL('image/jpeg',quality);
          if(encoded.startsWith('data:image/jpeg;base64,')&&encoded.length<=195000)
            return encoded;
        }
      }
      throw Error('Zdjęcie jest zbyt szczegółowe, aby je zapisać. Spróbuj zrobić je bliżej i w lepszym świetle.');
    }finally{URL.revokeObjectURL(objectUrl);}
  }
  async function saveNewPart(event) {
    event.preventDefault();
    if(state.busy||state.pending||!state.warehouse||
       !['PZ','WZ'].includes(state.stage))return;
    const name=el('operationNewPartName').value.trim().replace(/\s+/g,' ');
    const sap=el('operationNewPartSap').value.trim().toUpperCase();
    if(name.length<2){newPartError('Wpisz nazwę nowej części.');return;}
    const warehouseId=state.warehouse.id;
    state.busy=true;
    el('operationNewPartSave').disabled=true;
    disableDuringPending();
    newPartError('');
    try{
      const file=el('operationNewPartPhoto').files?.[0]||null;
      const photo=await photoForNewPart(file);
      if(state.warehouse?.id!==warehouseId)return;
      const response=await api('/api/pl/inventory',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'newPart',warehouseId,name,sap,photo})
      });
      if(state.warehouse?.id!==warehouseId)return;
      el('operationNewPartDialog').close();
      releaseNewPartPreview();
      el('operationNewPartForm').reset();
      state.busy=false;
      disableDuringPending();
      // Reuse the existing PZ/WZ keypad to count the new catalogue part.
      selectPart({id:response.part.id,name:response.part.name,number:response.part.number});
    }catch(error){
      newPartError(error.message||'Nie udało się dodać części.');
    }finally{
      state.busy=false;
      el('operationNewPartSave').disabled=false;
      disableDuringPending();
    }
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
    if(el('operationNewPartDialog').open&&!state.busy)closeNewPart();
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
  el('operationNewPartOpen').addEventListener('click',openNewPart);
  el('operationNewPartForm').addEventListener('submit',saveNewPart);
  el('operationNewPartCancel').addEventListener('click',closeNewPart);
  el('operationNewPartDialog').addEventListener('cancel',event=>{
    if(state.busy){event.preventDefault();return;}
    releaseNewPartPreview();
  });
  el('operationNewPartDialog').addEventListener('close',releaseNewPartPreview);
  el('operationNewPartPhoto').addEventListener('change',async()=>{
    releaseNewPartPreview();
    const file=el('operationNewPartPhoto').files?.[0];
    if(!file)return;
    try{
      await validatePartPhotoFile(file);
      if(el('operationNewPartPhoto').files?.[0]!==file)return;
      state.photoPreviewUrl=URL.createObjectURL(file);
      el('operationNewPartPreview').src=state.photoPreviewUrl;
      el('operationNewPartPreview').hidden=false;
      newPartError('');
    }catch(error){
      if(el('operationNewPartPhoto').files?.[0]!==file)return;
      el('operationNewPartPhoto').value='';
      newPartError(error.message||'Nieprawidłowy plik zdjęcia.');
    }
  });
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
    else if(/^[0-9]$/.test(digit)&&input.value.length<6)input.value+=digit;
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
