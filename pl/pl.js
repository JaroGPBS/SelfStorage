// GPBS Storage — isolated PL mobile module; no changes to French /api.
// The PIN is never persisted in browser storage; warehouse and role are always
// revalidated by the API. Office access has a separate login and URL.
(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const pinInput = byId('workerPin');
  const subscreens = ['warehouseSelection','warehouseHome','stockScreen','operationScreen','inventoryScreen','crewHome','officeHome'];
  const warehouseRoles = new Set(['ADMIN','KIEROWNIK','MAGAZYNIER']);
  const roleLabels = {
    ADMIN:'Administrator', KIEROWNIK:'Kierownik', KOORDYNATOR:'Koordynator',
    MAGAZYNIER:'Magazynier', EKIPA:'Ekipa serwisowa'
  };
  const state = {
    user:null, warehouse:null, subview:'', busy:false, stockBusy:false,
    stockPage:0, stockQuery:'', hasMore:false, stockSequence:0,
    inventoryNoticeSequence:0,
    inventory:{draft:null,maxLines:5000,publishingEnabled:false,summary:null,selectedPart:null,
      searchPage:0,searchQuery:'',searchMore:false,searchBusy:false,searchSequence:0,
      loadSequence:0,mutationBusy:false}
  };

  function view(which) {
    byId('loadingScreen').hidden = which !== 'loading';
    byId('loginScreen').hidden = which !== 'login';
    byId('sessionScreen').hidden = which !== 'session';
  }

  // Remember only the screen and warehouse, never a PIN or inventory data.
  // The server validates the signed session and live warehouse grants again
  // after every reload before any remembered screen is restored.
  const SCREEN_STORAGE_KEY='gpbs_pl_last_screen_v1';
  const REMEMBERED_SCREENS=new Set(['warehouseHome','stockScreen','operationScreen','inventoryScreen']);

  function rememberScreen(which) {
    try {
      if(!state.user || !state.warehouse ||
         !warehouseRoles.has(state.user.role) || !REMEMBERED_SCREENS.has(which))return;
      sessionStorage.setItem(SCREEN_STORAGE_KEY,JSON.stringify({
        userId:state.user.id,warehouseId:state.warehouse.id,screen:which
      }));
    }catch(error) {
      // Storage can be disabled by browser privacy settings. Navigation still works.
    }
  }

  function rememberedScreen(user,warehouses) {
    try {
      const raw=sessionStorage.getItem(SCREEN_STORAGE_KEY);
      if(!raw)return null;
      const saved=JSON.parse(raw);
      if(saved?.userId!==user.id || !REMEMBERED_SCREENS.has(saved.screen) ||
         !warehouses.some(w=>w.id===saved.warehouseId)) {
        sessionStorage.removeItem(SCREEN_STORAGE_KEY);
        return null;
      }
      return saved;
    }catch(error) {
      try{sessionStorage.removeItem(SCREEN_STORAGE_KEY);}catch{}
      return null;
    }
  }

  function forgetScreen() {
    try{sessionStorage.removeItem(SCREEN_STORAGE_KEY);}catch{}
  }

  function subview(which) {
    state.subview = which;
    for (const name of subscreens) byId(name).hidden = name !== which;
    rememberScreen(which);
  }

  function errorText(target, content) {
    target.textContent = content || '';
    target.hidden = !content;
  }

  function setWorking(working, button) {
    state.busy = working;
    button.disabled = working;
    if (working) button.setAttribute('aria-busy', 'true');
    else button.removeAttribute('aria-busy');
  }

  async function request(method, path, body) {
    const response = await fetch(path, {
      method,
      credentials:'same-origin',
      cache:'no-store',
      headers:method === 'POST' ? {'Content-Type':'application/json'} : {},
      ...(body ? {body:JSON.stringify(body)} : {})
    });
    let data = null;
    try {data = await response.json();} catch {}
    if (!response.ok || !data?.ok) {
      const failure = new Error(data?.error || (response.status===429
        ? 'Zbyt wiele prób logowania. Spróbuj później.'
        : 'Nie udało się połączyć z serwerem.'));
      failure.status = response.status;
      throw failure;
    }
    return data;
  }

  function stopStockRequest() {
    state.stockSequence++;
    state.stockBusy=false;
    byId('stockSearchButton').disabled=false;
  }

  function stopInventorySearch() {
    state.inventory.searchSequence++;
    state.inventory.searchBusy=false;
    byId('inventorySearchButton').disabled=false;
  }

  function setInventoryNotice(knownItems, catalogItems) {
    const known=Number(knownItems);
    const total=Number(catalogItems);
    let title='';
    let description='';

    if(Number.isFinite(total) && total>0 && Number.isFinite(known)) {
      if(known===0) {
        title='Wymagana inwentaryzacja';
        description='Magazyn nie ma jeszcze ustalonych stanów części. '+
          'Przed rozpoczęciem normalnej pracy należy przeprowadzić pierwszą inwentaryzację.';
      } else if(known<total) {
        title='Nie wszystkie stany są ustalone';
        description='Zapisano stany dla '+known+' z '+total+
          ' części katalogowych. Pozostałe mają status „Nieustalony”.';
      }
    }

    for (const prefix of ['home','stock']) {
      byId(prefix+'InventoryNotice').hidden=!title;
      byId(prefix+'InventoryTitle').textContent=title;
      byId(prefix+'InventoryDetail').textContent=description;
    }
  }

  async function loadInventoryNotice() {
    if(!state.warehouse || !warehouseRoles.has(state.user?.role))return;
    const warehouseId=state.warehouse.id;
    const sequence=++state.inventoryNoticeSequence;
    try {
      const data=await request('GET','/api/pl/warehouse?warehouse='+
        encodeURIComponent(warehouseId)+'&view=summary');
      if(sequence!==state.inventoryNoticeSequence ||
        state.warehouse?.id!==warehouseId)return;
      setInventoryNotice(data.stock?.knownItems,data.stock?.catalogItems);
    } catch(error) {
      if(sequence!==state.inventoryNoticeSequence ||
        state.warehouse?.id!==warehouseId)return;
      if(error.status===401) {
        clearSession();
        view('login');
        errorText(byId('loginError'),'Sesja wygasła. Zaloguj się ponownie.');
      } else {
        // A transient metadata error must not be shown as missing stock.
        setInventoryNotice(null,null);
      }
    }
  }

  function clearSession() {
    forgetScreen();
    window.GPBSPlInventory?.close();
    window.GPBSPlOperations?.close();
    state.user=null;
    state.warehouse=null;
    state.subview='';
    state.inventoryNoticeSequence++;
    state.inventory.loadSequence++;
    stopInventorySearch();
    state.inventory.draft=null;
    state.inventory.selectedPart=null;
    state.inventory.mutationBusy=false;
    byId('inventoryQuantityForm').hidden=true;
    byId('inventoryDraftLines').replaceChildren();
    setInventoryNotice(null,null);
    stopStockRequest();
    state.hasMore=false;
    byId('sessionTitle').textContent='—';
    byId('workerBadge').textContent='—';
    byId('workerRole').textContent='';
    byId('stockList').replaceChildren();
    pinInput.value='';
  }

  function renderWarehouseHeading() {
    if (!state.warehouse) return;
    byId('warehouseName').textContent=state.warehouse.name;
    byId('warehouseCode').textContent=state.warehouse.id;
    byId('stockWarehouseCaption').textContent=state.warehouse.name+' · '+state.warehouse.id;
    byId('switchWarehouseButton').hidden=state.user.warehouses.length<2;
  }

  function selectWarehouse(warehouse) {
    window.GPBSPlInventory?.close();
    window.GPBSPlOperations?.close();
    if (!state.user || !warehouseRoles.has(state.user.role) ||
        !state.user.warehouses.some(w=>w.id===warehouse.id)) return;
    state.warehouse=state.user.warehouses.find(w=>w.id===warehouse.id);
    state.inventoryNoticeSequence++;
    state.inventory.loadSequence++;
    stopInventorySearch();
    state.inventory.draft=null;
    state.inventory.selectedPart=null;
    byId('inventoryQuantityForm').hidden=true;
    setInventoryNotice(null,null);
    stopStockRequest();
    state.stockQuery='';
    state.stockPage=0;
    byId('stockQuery').value='';
    renderWarehouseHeading();
    subview('warehouseHome');
    errorText(byId('sessionError'),'');
    loadInventoryNotice();
  }

  function showWarehousePicker() {
    window.GPBSPlInventory?.close();
    window.GPBSPlOperations?.close();
    state.warehouse=null;
    state.inventory.loadSequence++;
    stopInventorySearch();
    state.inventory.draft=null;
    state.inventory.selectedPart=null;
    byId('inventoryQuantityForm').hidden=true;
    state.inventoryNoticeSequence++;
    setInventoryNotice(null,null);
    stopStockRequest();
    const list=byId('warehousePicker');
    list.replaceChildren();
    for (const warehouse of state.user.warehouses) {
      const button=document.createElement('button');
      button.className='warehouse-item warehouse-option';
      button.type='button';
      const icon=document.createElement('span');
      icon.className='warehouse-symbol';
      icon.setAttribute('aria-hidden','true');
      icon.textContent='▣';
      const details=document.createElement('span');
      details.className='warehouse-details';
      const label=document.createElement('strong');
      label.textContent=warehouse.name;
      const subtitle=document.createElement('small');
      subtitle.textContent=warehouse.id;
      details.append(label,subtitle);
      const arrow=document.createElement('span');
      arrow.className='warehouse-arrow';
      arrow.setAttribute('aria-hidden','true');
      arrow.textContent='→';
      button.append(icon,details,arrow);
      button.addEventListener('click',()=>selectWarehouse(warehouse));
      list.append(button);
    }
    subview('warehouseSelection');
  }

  function renderSession(user) {
    const nickname=typeof user?.nickname==='string'?user.nickname.trim():'';
    const warehouses=Array.isArray(user?.warehouses)?user.warehouses.filter(w=>
      typeof w?.id==='string' && typeof w?.name==='string'
    ):[];
    const role=String(user?.role||'').toUpperCase();
    if(!nickname||!user?.id||warehouses.length===0||!roleLabels[role])
      throw new Error('Konto nie ma przypisanego aktywnego magazynu w Polsce.');

    const firstLoad=!state.user;
    const saved=firstLoad && warehouseRoles.has(role)
      ?rememberedScreen(user,warehouses):null;
    const previous=state.user?.id===user.id&&state.user.role===role ?
      state.warehouse?.id:null;
    const previousSubview=state.subview;
    const keepWorkScreen=Boolean(previous &&
      (previousSubview==='stockScreen'||previousSubview==='inventoryScreen'||previousSubview==='operationScreen') &&
      warehouses.some(w=>w.id===previous) && warehouseRoles.has(role));
    if(!keepWorkScreen) {
      stopStockRequest();
      state.inventory.loadSequence++;
      state.inventory.searchSequence++;
      state.inventory.draft=null;
    }
    state.user={...user,role,warehouses};
    byId('sessionTitle').textContent=nickname;
    byId('workerRole').textContent=roleLabels[role];
    byId('workerBadge').textContent=nickname
      .replace(/[^A-Za-z0-9ĄĆĘŁŃÓŚŹŻąćęłńóśźż]/g,'')
      .slice(0,3).toLocaleUpperCase('pl')||'PL';

    if(role==='KOORDYNATOR') {
      state.warehouse=null;
      subview('officeHome');
    } else if(role==='EKIPA') {
      state.warehouse=null;
      subview('crewHome');
    } else if(warehouseRoles.has(role)) {
      const selected=warehouses.find(w=>w.id===previous) ||
        (saved?warehouses.find(w=>w.id===saved.warehouseId):null) ||
        (warehouses.length===1?warehouses[0]:null);
      if(selected) {
        state.warehouse=selected;
        renderWarehouseHeading();
        const destination=keepWorkScreen?previousSubview:
          (saved?.warehouseId===selected.id?saved.screen:'warehouseHome');
        subview(destination);
        loadInventoryNotice();
        // Reload the draft from D1; never reactivate the camera after refresh.
        if(firstLoad && destination==='inventoryScreen') {
          window.GPBSPlInventory?.open(selected);
          loadInventory();
        } else if(firstLoad && destination==='stockScreen') {
          fetchStock();
        } else if(firstLoad && destination==='operationScreen') {
          window.GPBSPlOperations?.open(selected,user.id,'PZ');
        }
      } else {
        showWarehousePicker();
      }
    }
    errorText(byId('sessionError'),'');
    view('session');
  }

  function renderPart(item) {
    const row=document.createElement('div');
    row.className='stock-row';
    const description=document.createElement('div');
    description.className='stock-description';
    const name=document.createElement('strong');
    name.textContent=String(item.name||item.number||'Część');
    const number=document.createElement('span');
    number.textContent=String(item.number||'Brak numeru')+
      (item.sap?' · SAP '+item.sap:'');
    description.append(name,number);
    const qty=document.createElement('div');
    const known=item.quantity!==null && Number.isFinite(item.quantity);
    qty.className='stock-quantity '+(known?'':'stock-unknown');
    qty.textContent=known?String(item.quantity)+' szt.':'Nieustalony';
    row.append(description,qty);
    return row;
  }

  async function fetchStock({append=false}={}) {
    if (state.stockBusy || !state.warehouse || !warehouseRoles.has(state.user?.role)) return;
    state.stockBusy=true;
    const sequence=++state.stockSequence;
    const warehouseId=state.warehouse.id;
    const page=append?state.stockPage+1:0;
    const q=state.stockQuery;
    if(!append)byId('stockList').replaceChildren();
    byId('stockMoreButton').hidden=true;
    byId('stockSearchButton').disabled=true;
    byId('stockStatus').textContent='Pobieranie stanów…';
    try {
      const url='/api/pl/warehouse?warehouse='+encodeURIComponent(warehouseId)+
        '&page='+page+'&q='+encodeURIComponent(q);
      const result=await request('GET',url);
      if (sequence!==state.stockSequence || state.warehouse?.id!==warehouseId) return;
      state.stockPage=page;
      state.hasMore=Boolean(result.stock?.hasMore);
      for (const item of result.stock?.items||[])
        byId('stockList').append(renderPart(item));
      const shown=byId('stockList').children.length;
      const totalKnown=Number(result.stock?.knownItems||0);
      const totalCatalog=Number(result.stock?.catalogItems||0);
      setInventoryNotice(totalKnown,totalCatalog);
      byId('stockStatus').textContent=shown
        ?'Wyświetlono: '+shown+' · Zapisany stan: '+totalKnown+' z '+totalCatalog+' części katalogowych'
        :'Brak pasujących części. Stan magazynu może być jeszcze nieustalony.';
      byId('stockMoreButton').hidden=!state.hasMore;
    }catch(error) {
      if(sequence!==state.stockSequence) return;
      if(error.status===401) {
        clearSession();
        view('login');
        errorText(byId('loginError'),'Sesja wygasła. Zaloguj się ponownie.');
      } else {
        byId('stockStatus').textContent=error.message;
        byId('stockMoreButton').hidden=!append;
      }
    }finally {
      if(sequence===state.stockSequence) {
        state.stockBusy=false;
        byId('stockSearchButton').disabled=false;
      }
    }
  }

  function openStock() {
    if (!state.warehouse || !warehouseRoles.has(state.user?.role)) return;
    state.stockPage=0;
    state.stockQuery='';
    byId('stockQuery').value='';
    subview('stockScreen');
    fetchStock();
  }


  function inventoryFeedback(text) {
    const el=byId('inventoryFeedback');
    el.textContent=text||'';
    el.hidden=!text;
  }

  function inventoryError(text) {
    errorText(byId('inventoryError'),text);
  }

  function inventoryPartLabel(line) {
    return String(line.name||line.number||line.partId||'Część');
  }

  function inventoryDraftLineButton(label,handler) {
    const button=document.createElement('button');
    button.type='button';
    button.className='inventory-inline-button';
    button.textContent=label;
    button.addEventListener('click',handler);
    return button;
  }

  function renderInventoryDraft(draft) {
    const inv=state.inventory;
    inv.draft=draft||{id:null,revision:0,lines:[],count:0};
    const lines=Array.isArray(inv.draft.lines)?inv.draft.lines:[];
    const list=byId('inventoryDraftLines');
    list.replaceChildren();
    byId('inventoryCounter').textContent=lines.length+' pozycji';
    byId('inventoryDraftInfo').textContent=lines.length
      ?'Arkusz zapisany w D1. Zakończ po sprawdzeniu wszystkich policzonych pozycji.'
      :'Arkusz jest pusty. Wybierz część i wpisz policzoną ilość.';

    for(const line of lines) {
      const row=document.createElement('div');
      row.className='inventory-draft-row';
      const desc=document.createElement('div');
      desc.className='inventory-draft-desc';
      const name=document.createElement('strong');
      name.textContent=inventoryPartLabel(line);
      const nr=document.createElement('small');
      nr.textContent=String(line.number||line.partId);
      desc.append(name,nr);

      const quantity=document.createElement('strong');
      quantity.className='inventory-draft-qty';
      quantity.textContent=String(line.quantity)+' szt.';
      const actions=document.createElement('div');
      actions.className='inventory-draft-actions';
      actions.append(
        inventoryDraftLineButton('Popraw sumę',()=>window.GPBSPlInventory?.showCount({
          id:line.partId,name:line.name,number:line.number,sap:line.sap
        },'set')),
        inventoryDraftLineButton('Usuń',()=>removeInventoryLine(line.partId))
      );
      row.append(desc,quantity,actions);
      list.append(row);
    }
    window.GPBSPlInventory?.setDraft(inv.draft);
    byId('inventoryCommitButton').disabled=
      !inv.publishingEnabled||inv.mutationBusy||lines.length===0;
    byId('inventoryPublishInfo').textContent=inv.publishingEnabled
      ?'Zatwierdzenie trwale zaktualizuje stany w D1 i zapisze historię. '+
       'Niepoliczone części pozostaną bez zmian.'
      :'Zatwierdzanie stanów jest na razie wyłączone. Możesz bezpiecznie '+
       'przygotować i poprawiać arkusz; magazyn nie zostanie zmieniony.';
  }

  function chooseInventoryPart(item) {
    if(state.inventory.mutationBusy)return;
    window.GPBSPlInventory?.showCount(item,'add');
  }

  function renderInventorySearchPart(part) {
    const button=document.createElement('button');
    button.type='button';
    button.className='inventory-search-item';
    const text=document.createElement('span');
    text.className='inventory-search-label';
    const name=document.createElement('strong');
    name.textContent=inventoryPartLabel(part);
    const sub=document.createElement('small');
    sub.textContent=String(part.number||part.id)+(part.sap?' · SAP '+part.sap:'');
    text.append(name,sub);
    const badge=document.createElement('span');
    badge.className='inventory-search-badge';
    const saved=state.inventory.draft?.lines?.find(x=>x.partId===part.id);
    badge.textContent=saved?'Policzono: '+saved.quantity:'Dodaj →';
    button.append(text,badge);
    button.addEventListener('click',()=>chooseInventoryPart(part));
    return button;
  }

  async function fetchInventoryParts({append=false}={}) {
    const inv=state.inventory;
    if(inv.searchBusy||!state.warehouse)return;
    inv.searchBusy=true;
    const sequence=++inv.searchSequence;
    const warehouseId=state.warehouse.id;
    const page=append?inv.searchPage+1:0;
    if(!append)byId('inventoryResults').replaceChildren();
    byId('inventorySearchButton').disabled=true;
    byId('inventorySearchStatus').textContent='Wyszukiwanie części…';
    byId('inventoryMoreButton').hidden=true;
    try {
      const url='/api/pl/warehouse?warehouse='+encodeURIComponent(warehouseId)+
        '&q='+encodeURIComponent(inv.searchQuery)+'&page='+page;
      const result=await request('GET',url);
      if(sequence!==inv.searchSequence||state.warehouse?.id!==warehouseId)return;
      inv.searchPage=page;
      inv.searchMore=Boolean(result.stock?.hasMore);
      for(const part of result.stock?.items||[])
        byId('inventoryResults').append(renderInventorySearchPart(part));
      byId('inventorySearchStatus').textContent=byId('inventoryResults').children.length
        ?'Wybierz część z listy, aby wpisać ilość.'
        :'Nie znaleziono części w katalogu.';
      byId('inventoryMoreButton').hidden=!inv.searchMore;
    }catch(error) {
      if(sequence===inv.searchSequence) {
        byId('inventorySearchStatus').textContent=error.message;
        byId('inventoryMoreButton').hidden=true;
      }
    }finally{
      if(sequence===inv.searchSequence){
        inv.searchBusy=false;
        byId('inventorySearchButton').disabled=false;
      }
    }
  }

  async function loadInventoryHistory() {
    const inv=state.inventory;
    if(!state.warehouse||!byId('inventoryHistoryDetails').open)return;
    const warehouseId=state.warehouse.id;
    const seq=inv.loadSequence;
    const list=byId('inventoryHistoryList');
    list.replaceChildren();
    byId('inventoryHistoryStatus').textContent='Pobieranie historii…';
    try{
      const result=await request('GET','/api/pl/inventory?view=history&warehouse='+
        encodeURIComponent(warehouseId));
      if(seq!==inv.loadSequence||state.warehouse?.id!==warehouseId ||
        !byId('inventoryHistoryDetails').open)return;
      const records=Array.isArray(result.history)?result.history:[];
      for(const record of records){
        const row=document.createElement('div');
        row.className='inventory-history-row';
        const title=document.createElement('strong');
        const dateRaw=String(record.committedAt||'');
        let formatted=dateRaw;
        const parsed=new Date(dateRaw.replace(' ','T')+'Z');
        if(Number.isFinite(parsed.getTime()))
          formatted=new Intl.DateTimeFormat('pl-PL',{
            dateStyle:'short',timeStyle:'short'
          }).format(parsed);
        title.textContent=formatted;
        const meta=document.createElement('span');
        meta.textContent=String(record.partCount||0)+' części · Operator: '+
          String(record.actorId||'—');
        row.append(title,meta);
        list.append(row);
      }
      byId('inventoryHistoryStatus').textContent=records.length
        ?'Ostatnie '+records.length+' zakończonych inwentaryzacji.'
        :'Nie ma jeszcze zakończonych inwentaryzacji.';
    }catch(error){
      if(seq===inv.loadSequence && state.warehouse?.id===warehouseId)
        byId('inventoryHistoryStatus').textContent='Błąd historii: '+error.message;
    }
  }

  async function loadInventory() {
    const inv=state.inventory;
    if(!state.warehouse)return;
    const warehouseId=state.warehouse.id;
    const sequence=++inv.loadSequence;
    stopInventorySearch();
    inventoryError('');
    inventoryFeedback('');
    inv.selectedPart=null;
    byId('inventoryQuantityForm').hidden=true;
    byId('inventoryWarehouseCaption').textContent=state.warehouse.name+
      ' · '+warehouseId;
    byId('inventoryDraftInfo').textContent='Pobieranie arkusza…';
    byId('inventoryCommitButton').disabled=true;
    try {
      const response=await request('GET','/api/pl/inventory?warehouse='+
        encodeURIComponent(warehouseId));
      if(sequence!==inv.loadSequence||state.warehouse?.id!==warehouseId)return;
      inv.maxLines=response.maxLines||5000;
      inv.summary=response.summary||null;
      inv.publishingEnabled=Boolean(response.publishingEnabled);
      renderInventoryDraft(response.draft);
      inv.searchPage=0;
      inv.searchQuery='';
      byId('inventoryQuery').value='';
      if(state.subview==='inventoryScreen')fetchInventoryParts();
      if(byId('inventoryHistoryDetails').open)loadInventoryHistory();
    }catch(error) {
      if(sequence!==inv.loadSequence)return;
      inv.draft=null;
      inv.summary=null;
      inv.publishingEnabled=false;
      byId('inventoryDraftInfo').textContent='Nie można wczytać arkusza.';
      byId('inventoryCounter').textContent='—';
      byId('inventoryCommitButton').disabled=true;
      byId('inventoryResults').replaceChildren();
      inventoryError(error.message);
    }
  }

  function openInventory() {
    if(!state.warehouse||!warehouseRoles.has(state.user?.role))return;
    subview('inventoryScreen');
    window.GPBSPlInventory?.open(state.warehouse);
    loadInventory();
  }

  async function inventoryMutation(action,partId,quantity) {
    const inv=state.inventory;
    if(inv.mutationBusy||!state.warehouse||!inv.draft)return;
    inv.mutationBusy=true;
    const warehouseId=state.warehouse.id;
    byId('inventorySavePart').disabled=true;
    byId('inventoryCommitButton').disabled=true;
    inventoryError('');
    inventoryFeedback('');
    try {
      const data=await request('POST','/api/pl/inventory',{
        action,warehouseId,partId,...(action==='save'?{quantity}:{})
      });
      if(state.warehouse?.id!==warehouseId)return;
      renderInventoryDraft(data.draft);
      inv.selectedPart=null;
      byId('inventoryQuantityForm').hidden=true;
      inventoryFeedback(action==='save'?'Pozycja zapisana w arkuszu.':'Pozycja usunięta z arkusza.');
      // Refresh part badges when the draft changes.
      inv.searchQuery=byId('inventoryQuery').value.trim();
      fetchInventoryParts();
    }catch(error){
      inventoryError(error.message);
    }finally{
      inv.mutationBusy=false;
      byId('inventorySavePart').disabled=false;
      if(inv.draft)renderInventoryDraft(inv.draft);
    }
  }

  function saveInventoryPart(event) {
    event.preventDefault();
    const inv=state.inventory;
    if(inv.mutationBusy||!inv.selectedPart)return;
    const value=byId('inventoryQuantity').value.trim();
    if(!/^\d{1,6}$/.test(value)||Number(value)>100000){
      inventoryError('Wpisz policzoną liczbę sztuk od 0 do 100000.');
      return;
    }
    inventoryMutation('save',inv.selectedPart.id,Number(value));
  }

  function removeInventoryLine(partId) {
    if(state.inventory.mutationBusy)return;
    inventoryMutation('remove',partId);
  }

  function confirmInventoryCommit(count,summary) {
    const dialog=byId('inventoryConfirmDialog');
    const uncounted=Number(summary?.notCountedParts||0);
    const pending=Number(summary?.pendingVerification||0);
    byId('inventoryConfirmText').textContent=
      'Magazyn: '+String(state.warehouse?.name||'')+'. '+
      'Policzone części: '+count+'. '+
      'Niepoliczone pozycje katalogowe: '+uncounted+
      ' — ich dotychczasowe stany pozostaną bez zmian. '+
      'Nowe części wymagające weryfikacji: '+pending+'. '+
      'Potwierdzenie zapisze policzone ilości jako rzeczywiste stany magazynu '+
      'i utworzy historię zmian. Czy na pewno zakończyć inwentaryzację?';
    return new Promise(resolve=>{
      if(dialog.open)dialog.close();
      const yes=byId('inventoryConfirmApprove');
      const no=byId('inventoryConfirmCancel');
      const finish=answer=>{
        yes.removeEventListener('click',onYes);
        no.removeEventListener('click',onNo);
        dialog.removeEventListener('cancel',onEscape);
        dialog.removeEventListener('close',onClose);
        if(dialog.open)dialog.close();
        resolve(answer);
      };
      const onYes=()=>finish(true);
      const onNo=()=>finish(false);
      const onEscape=e=>{e.preventDefault();finish(false);};
      const onClose=()=>finish(false);
      yes.addEventListener('click',onYes);
      no.addEventListener('click',onNo);
      dialog.addEventListener('cancel',onEscape);
      dialog.addEventListener('close',onClose);
      dialog.showModal();
    });
  }

  async function commitInventory() {
    const inv=state.inventory;
    const draft=inv.draft;
    if(inv.mutationBusy||!inv.publishingEnabled||!draft?.id||!draft.count||
       !state.warehouse)return;
    const warehouseId=state.warehouse.id;
    let latest;
    try {
      latest=await request('GET','/api/pl/inventory?warehouse='+encodeURIComponent(warehouseId));
    }catch(error){
      inventoryError('Nie można sprawdzić inwentaryzacji przed zatwierdzeniem: '+error.message);
      return;
    }
    if(state.warehouse?.id!==warehouseId)return;
    if(latest.draft?.id!==draft.id ||
       Number(latest.draft?.revision)!==Number(draft.revision)){
      renderInventoryDraft(latest.draft);
      inventoryError('Arkusz zmienił się w międzyczasie. Sprawdź aktualne ilości i spróbuj ponownie.');
      return;
    }
    if(!await confirmInventoryCommit(draft.count,latest.summary))return;
    if(state.warehouse?.id!==warehouseId)return;
    inv.mutationBusy=true;
    byId('inventoryCommitButton').disabled=true;
    inventoryError('');
    inventoryFeedback('');
    try {
      const result=await request('POST','/api/pl/inventory',{
        action:'commit',warehouseId,
        inventoryId:draft.id,revision:draft.revision,confirm:true
      });
      if(state.warehouse?.id!==warehouseId)return;
      const count=result.committedLines||draft.count;
      // Re-read server state, never invent updated quantities client-side.
      await loadInventory();
      loadInventoryNotice();
      inventoryFeedback('Inwentaryzacja zakończona. Zapisano '+count+
        ' policzonych pozycji do stanów magazynowych. Historia zmian jest zachowana.');
    }catch(error){
      inventoryError(error.message);
      // A conflict requires fresh data before trying again.
      if(error.status===409)loadInventory();
    }finally{
      inv.mutationBusy=false;
      if(inv.draft)renderInventoryDraft(inv.draft);
    }
  }

  async function refreshSession() {
    try {
      const result=await request('GET','/api/pl/auth');
      renderSession(result.user);
    }catch(error) {
      if(error.status===401 || !state.user) {
        clearSession();
        view('login');
        errorText(byId('loginError'),error.status===401?'':(
          error.status?error.message:'Brak połączenia. Logowanie wymaga internetu.'));
      }else{
        errorText(byId('sessionError'),'Nie można sprawdzić sesji: '+error.message);
      }
    }
  }

  async function login(event) {
    event.preventDefault();
    if(state.busy)return;
    errorText(byId('loginError'),'');
    const pin=pinInput.value.trim();
    if(!/^\d{4}$/.test(pin)) {
      errorText(byId('loginError'),'Wpisz czterocyfrowy PIN.');
      return;
    }

    setWorking(true,byId('loginButton'));
    const buttonLabel=byId('loginButton').firstChild;
    buttonLabel.textContent='Logowanie… ';
    pinInput.value='';
    try {
      const result=await request('POST','/api/pl/auth',{action:'login',pin});
      renderSession(result.user);
    }catch(error) {
      errorText(byId('loginError'),error.message);
    }finally{
      setWorking(false,byId('loginButton'));
      buttonLabel.textContent='Zaloguj ';
    }
  }

  async function logout() {
    if(state.busy)return;
    setWorking(true,byId('logoutButton'));
    errorText(byId('sessionError'),'');
    try {
      await request('POST','/api/pl/auth',{action:'logout'});
      clearSession();
      errorText(byId('loginError'),'');
      view('login');
    }catch(error) {
      errorText(byId('sessionError'),'Nie udało się wylogować: '+error.message);
    }finally{
      setWorking(false,byId('logoutButton'));
    }
  }

  byId('loginForm').addEventListener('submit',login);
  byId('logoutButton').addEventListener('click',logout);
  byId('switchWarehouseButton').addEventListener('click',showWarehousePicker);
  byId('openStockButton').addEventListener('click',openStock);
  byId('openInventoryButton').addEventListener('click',openInventory);
  function openOperation(direction) {
    if(!state.warehouse||!state.user||!warehouseRoles.has(state.user.role))return;
    window.GPBSPlInventory?.close();
    subview('operationScreen');
    window.GPBSPlOperations?.open(state.warehouse,state.user.id,direction);
  }
  byId('openReceiptButton').addEventListener('click',()=>openOperation('PZ'));
  byId('openIssueButton').addEventListener('click',()=>openOperation('WZ'));
  byId('backFromOperationButton').addEventListener('click',()=>{
    window.GPBSPlOperations?.close();
    subview('warehouseHome');
    loadInventoryNotice();
  });
  document.addEventListener('gpbs-pl-operation-committed',loadInventoryNotice);
  byId('backFromInventoryButton').addEventListener('click',()=>{
    window.GPBSPlInventory?.close();
    state.inventory.loadSequence++;
    stopInventorySearch();
    state.inventory.selectedPart=null;
    byId('inventoryQuantityForm').hidden=true;
    subview('warehouseHome');
  });
  byId('inventorySearchForm').addEventListener('submit',event=>{
    event.preventDefault();
    if(state.inventory.searchBusy)return;
    state.inventory.searchQuery=byId('inventoryQuery').value.trim().slice(0,80);
    state.inventory.selectedPart=null;
    byId('inventoryQuantityForm').hidden=true;
    fetchInventoryParts();
  });
  byId('inventoryMoreButton').addEventListener('click',()=>{
    fetchInventoryParts({append:true});
  });
  byId('inventoryQuantityForm').addEventListener('submit',saveInventoryPart);
  byId('inventoryCancelPart').addEventListener('click',()=>{
    state.inventory.selectedPart=null;
    byId('inventoryQuantityForm').hidden=true;
  });
  byId('inventoryCommitButton').addEventListener('click',commitInventory);
  byId('inventoryHistoryDetails').addEventListener('toggle',()=>{
    if(byId('inventoryHistoryDetails').open &&
       state.subview==='inventoryScreen')loadInventoryHistory();
  });
  document.addEventListener('gpbs-pl-inventory-updated',event=>{
    const draft=event.detail?.draft;
    if(!draft||state.subview!=='inventoryScreen')return;
    renderInventoryDraft(draft);
    const count=Number(event.detail?.added||0);
    const partId=event.detail?.partId;
    const line=draft.lines?.find(x=>x.partId===partId);
    inventoryFeedback(event.detail?.mode==='set'
      ?'Poprawiono łączną ilość części.'
      :'Dodano '+count+' szt. Łącznie policzono: '+(line?.quantity??'—')+' szt.');
    inventoryError('');
    if(!byId('inventoryManual').hidden){
      state.inventory.searchQuery=byId('inventoryQuery').value.trim();
      fetchInventoryParts();
    }
  });

  byId('backFromStockButton').addEventListener('click',()=>{
    stopStockRequest();
    subview('warehouseHome');
  });
  byId('stockSearchForm').addEventListener('submit',event=>{
    event.preventDefault();
    if(state.stockBusy)return;
    state.stockQuery=byId('stockQuery').value.trim().slice(0,80);
    fetchStock();
  });
  byId('stockMoreButton').addEventListener('click',()=>fetchStock({append:true}));
  pinInput.addEventListener('input',()=>{
    const clean=pinInput.value.replace(/\D/g,'').slice(0,4);
    if(clean!==pinInput.value)pinInput.value=clean;
    if(!byId('loginError').hidden)errorText(byId('loginError'),'');
  });
  window.addEventListener('pageshow',event=>{
    if(event.persisted)refreshSession();
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'&&state.user&&!state.busy)
      refreshSession();
  });

  refreshSession();
})();
