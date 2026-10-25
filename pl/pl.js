// GPBS Storage — isolated PL mobile module; no changes to French /api.
// The PIN is never persisted in browser storage; warehouse and role are always
// revalidated by the API. Office access has a separate login and URL.
(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const pinInput = byId('workerPin');
  const subscreens = ['warehouseSelection','warehouseHome','stockScreen','crewHome','officeHome'];
  const warehouseRoles = new Set(['ADMIN','KIEROWNIK','MAGAZYNIER']);
  const roleLabels = {
    ADMIN:'Administrator', KIEROWNIK:'Kierownik', KOORDYNATOR:'Koordynator',
    MAGAZYNIER:'Magazynier', EKIPA:'Ekipa serwisowa'
  };
  const state = {
    user:null, warehouse:null, subview:'', busy:false, stockBusy:false,
    stockPage:0, stockQuery:'', hasMore:false, stockSequence:0,
    inventoryNoticeSequence:0
  };

  function view(which) {
    byId('loadingScreen').hidden = which !== 'loading';
    byId('loginScreen').hidden = which !== 'login';
    byId('sessionScreen').hidden = which !== 'session';
  }

  function subview(which) {
    state.subview = which;
    for (const name of subscreens) byId(name).hidden = name !== which;
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
    state.user=null;
    state.warehouse=null;
    state.subview='';
    state.inventoryNoticeSequence++;
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
    if (!state.user || !warehouseRoles.has(state.user.role) ||
        !state.user.warehouses.some(w=>w.id===warehouse.id)) return;
    state.warehouse=state.user.warehouses.find(w=>w.id===warehouse.id);
    state.inventoryNoticeSequence++;
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
    state.warehouse=null;
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

    const previous=state.user?.id===user.id&&state.user.role===role ?
      state.warehouse?.id:null;
    const previousSubview=state.subview;
    const keepStock=Boolean(previous && previousSubview==='stockScreen' &&
      warehouses.some(w=>w.id===previous) && warehouseRoles.has(role));
    if(!keepStock)stopStockRequest();
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
        (warehouses.length===1?warehouses[0]:null);
      if(selected) {
        state.warehouse=selected;
        renderWarehouseHeading();
        subview(previous && previousSubview==='stockScreen'?'stockScreen':'warehouseHome');
        loadInventoryNotice();
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
