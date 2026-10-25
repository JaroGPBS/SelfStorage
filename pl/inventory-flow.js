// GPBS Storage PL — seamless scan -> blank numeric input -> ADD -> scan.
// Runs only in the isolated /pl/ module. The main French scanner is untouched.
(() => {
  'use strict';
  const el=id=>document.getElementById(id);
  const camera=()=>window.GPBSInventoryCamera;
  const state={warehouse:null,epoch:0,opening:false,scanning:false,
    part:null,mode:'add',pendingId:null,busy:false,draft:null};

  function notify(message){
    el('inventoryScannerMessage').textContent=message;
  }
  function showError(id,message){
    const target=el(id);
    target.textContent=message||'';
    target.hidden=!message;
  }
  async function api(method,path,body) {
    const response=await fetch(path,{
      method,cache:'no-store',credentials:'same-origin',
      headers:method==='POST'?{'Content-Type':'application/json'}:{},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    let data=null;
    try{data=await response.json();}catch{}
    if(!response.ok||!data?.ok){
      const error=new Error(data?.error||'Serwer nie odpowiedział.');
      error.status=response.status;
      throw error;
    }
    return data;
  }

  function resume() {
    if(!state.warehouse||!state.scanning)return;
    if(camera()?.resume())notify('Gotowe. Skanuj kolejną część.');
    else notify('Skaner zatrzymany. Naciśnij „Otwórz skaner QR”.');
  }

  function showCount(part,mode='add') {
    if(state.busy||!part?.id||!state.warehouse)return;
    state.part=part;
    state.mode=mode==='set'?'set':'add';
    state.pendingId=null;
    camera()?.pause();
    const previous=state.draft?.lines?.find(line=>line.partId===part.id);
    const dlg=el('inventoryCountDialog');
    if(dlg.open)dlg.close();
    el('inventoryCountTitle').textContent=state.mode==='set'?'Popraw sumę':'Wpisz ilość';
    el('inventoryCountPart').textContent=String(part.name||part.number||part.id);
    el('inventoryCountHint').textContent=state.mode==='set'
      ?'Wpisz łączną, poprawną liczbę policzonych sztuk.'
      :(previous?'Ta część jest już na liście. Wpisz wyłącznie znalezione dodatkowo sztuki — system je zsumuje.'
        :'Wpisz liczbę właśnie znalezionych sztuk. Bez stanu bazowego.');
    el('inventoryCountAdd').textContent=state.mode==='set'?'Zapisz korektę':'Dodaj';
    const input=el('inventoryCountQuantity');
    input.value='';
    showError('inventoryCountError','');
    dlg.showModal();
    input.focus({preventScroll:true});
    input.select();
  }

  function closeCount() {
    if(state.busy)return;
    if(el('inventoryCountDialog').open)el('inventoryCountDialog').close();
    state.part=null;
    state.pendingId=null;
    el('inventoryCountQuantity').value='';
    showError('inventoryCountError','');
    resume();
  }

  function showNewPart(code='') {
    if(!state.warehouse)return;
    camera()?.pause();
    const dlg=el('inventoryNewPartDialog');
    if(dlg.open)dlg.close();
    el('inventoryNewPartForm').reset();
    el('inventoryNewPartCode').value=String(code).slice(0,120);
    showError('inventoryNewPartError','');
    dlg.showModal();
    el('inventoryNewPartName').focus({preventScroll:true});
  }

  function closeNewPart() {
    if(state.busy)return;
    if(el('inventoryNewPartDialog').open)el('inventoryNewPartDialog').close();
    resume();
  }

  async function onScan(raw,epoch,warehouseId) {
    if(epoch!==state.epoch||state.warehouse?.id!==warehouseId)return;
    const code=String(raw||'').replace(/\u0000/g,'').trim();
    notify('Rozpoznawanie części…');
    try{
      const data=await api('GET','/api/pl/warehouse?view=resolve&warehouse='+
        encodeURIComponent(warehouseId)+'&code='+encodeURIComponent(code));
      if(epoch!==state.epoch||state.warehouse?.id!==warehouseId)return;
      showCount(data.part);
    }catch(error){
      if(epoch!==state.epoch||state.warehouse?.id!==warehouseId)return;
      if(error.status===404)showNewPart(code);
      else {
        notify(error.message);
        resume();
      }
    }
  }

  async function start() {
    if(!state.warehouse||state.opening||state.scanning)return;
    const epoch=++state.epoch;
    const warehouseId=state.warehouse.id;
    state.opening=true;
    el('inventoryScannerPanel').hidden=false;
    el('inventoryScannerClosed').hidden=true;
    el('inventoryManual').hidden=true;
    notify('Uruchamianie kamery…');
    try{
      if(!camera())throw Error('Brak modułu skanera.');
      await camera().start(code=>onScan(code,epoch,warehouseId));
      if(epoch!==state.epoch)return;
      state.scanning=camera().isActive();
      notify('Skanuj QR lub Code128. Po „Dodaj” kamera wznowi się automatycznie.');
    }catch(error){
      if(epoch!==state.epoch)return;
      notify('Nie udało się uruchomić aparatu: '+error.message);
      el('inventoryScannerClosed').hidden=false;
      el('inventoryManual').hidden=false;
    }finally{
      if(epoch===state.epoch)state.opening=false;
    }
  }

  async function stop(manual=true) {
    state.epoch++;
    state.scanning=false;
    state.opening=false;
    el('inventoryScannerPanel').hidden=true;
    el('inventoryScannerClosed').hidden=!manual;
    if(manual)el('inventoryManual').hidden=false;
    try{await camera()?.stop();}catch{}
  }

  function open(warehouse){
    if(!warehouse?.id)return;
    state.warehouse=warehouse;
    state.draft=null;
    start();
  }
  function close(){
    stop(false);
    state.warehouse=null;
    state.part=null;
    state.pendingId=null;
    state.busy=false;
    if(el('inventoryCountDialog').open)el('inventoryCountDialog').close();
    if(el('inventoryNewPartDialog').open)el('inventoryNewPartDialog').close();
  }

  async function addQuantity(event){
    event.preventDefault();
    if(state.busy||!state.part||!state.warehouse)return;
    const input=el('inventoryCountQuantity');
    const value=input.value.trim();
    if(!/^\d{1,6}$/.test(value)||Number(value)>100000){
      showError('inventoryCountError','Wpisz liczbę całkowitą od 0 do 100000.');
      input.focus();
      return;
    }
    state.busy=true;
    el('inventoryCountAdd').disabled=true;
    // Keep one UUID through uncertain network errors: retry never double-counts.
    if(!state.pendingId)state.pendingId='PL-EVT-'+crypto.randomUUID();
    const epoch=state.epoch;
    const warehouseId=state.warehouse.id;
    const part=state.part;
    const amount=Number(value);
    try{
      const data=await api('POST','/api/pl/inventory',{
        action:state.mode,warehouseId,partId:part.id,
        quantity:amount,eventId:state.pendingId
      });
      if(state.warehouse?.id!==warehouseId)return;
      state.draft=data.draft;
      document.dispatchEvent(new CustomEvent('gpbs-pl-inventory-updated',{
        detail:{draft:data.draft,partId:part.id,added:amount,mode:state.mode}
      }));
      el('inventoryCountDialog').close();
      state.part=null;
      state.pendingId=null;
      input.value='';
      if(epoch===state.epoch)resume();
    }catch(error){
      showError('inventoryCountError',error.message);
      // For a permanent conflict a new attempt must use a new event id.
      if(error.status===409)state.pendingId=null;
    }finally{
      state.busy=false;
      el('inventoryCountAdd').disabled=false;
    }
  }

  async function createPart(event){
    event.preventDefault();
    if(state.busy||!state.warehouse)return;
    const name=el('inventoryNewPartName').value.trim();
    const code=el('inventoryNewPartCode').value.trim();
    if(name.length<2){
      showError('inventoryNewPartError','Podaj nazwę części.');
      return;
    }
    state.busy=true;
    el('inventoryNewPartSave').disabled=true;
    const warehouseId=state.warehouse.id;
    try{
      const data=await api('POST','/api/pl/inventory',{
        action:'newPart',warehouseId,name,code
      });
      if(state.warehouse?.id!==warehouseId)return;
      el('inventoryNewPartDialog').close();
      showCount(data.part,'add');
    }catch(error){showError('inventoryNewPartError',error.message);}
    finally{
      state.busy=false;
      el('inventoryNewPartSave').disabled=false;
    }
  }

  el('inventoryCloseScanner').addEventListener('click',()=>stop(true));
  el('inventoryScannerManual').addEventListener('click',()=>stop(true));
  el('inventoryStartScanner').addEventListener('click',start);
  el('inventoryCountForm').addEventListener('submit',addQuantity);
  el('inventoryCountCancel').addEventListener('click',closeCount);
  el('inventoryCountDialog').addEventListener('cancel',event=>{
    event.preventDefault();closeCount();
  });
  el('inventoryCountQuantity').addEventListener('input',()=>{
    const input=el('inventoryCountQuantity');
    input.value=input.value.replace(/\D/g,'').slice(0,6);
  });
  el('inventoryNewPartButton').addEventListener('click',()=>showNewPart());
  el('inventoryNewPartForm').addEventListener('submit',createPart);
  el('inventoryNewPartCancel').addEventListener('click',closeNewPart);
  el('inventoryNewPartDialog').addEventListener('cancel',event=>{
    event.preventDefault();closeNewPart();
  });

  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)camera()?.pause();
    else if(state.scanning&&!el('inventoryCountDialog').open&&
      !el('inventoryNewPartDialog').open)resume();
  });

  window.GPBSPlInventory={open,close,showCount,setDraft:draft=>{state.draft=draft;}};
})();
