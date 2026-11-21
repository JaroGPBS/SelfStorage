// GPBS Storage PL: crew route card and pickup confirmation.
(() => {
  'use strict';
  const byId=id=>document.getElementById(id);
  const routeButton=byId('plCrewRoutesButton');
  const routeAlert=byId('plCrewRoutesAlert');
  const list=byId('plCrewRoutesList');
  const form=byId('plCrewPickupForm');
  const linesContainer=byId('plCrewPickupLines');
  const errorBox=byId('plCrewRoutesError');
  const title=byId('plCrewRouteTitle');
  const back=byId('plCrewRoutesBack');
  const confirm=byId('plCrewConfirmPickup');
  const dialog=byId('plCrewAfterPickup');
  const dialogTitle=byId('plCrewAfterPickupTitle');
  let user=null, routes=[], current=null, busy=false, generation=0;
  let showScreen=null, hideScreen=null;

  function error(message=''){
    errorBox.textContent=message;
    errorBox.hidden=!message;
  }
  async function request(method,path,body){
    const response=await fetch(path,{
      method,credentials:'same-origin',cache:'no-store',
      ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})
    });
    const data=await response.json().catch(()=>null);
    if(!response.ok||!data?.ok)throw new Error(data?.error||'Nie udało się pobrać trasy.');
    return data;
  }
  const endpoint='/api/pl/route';
  const pendingRoutes=()=>routes.filter(r=>r.pending);
  function renderTile(){
    const pending=pendingRoutes();
    const next=pending[0];
    routeButton.classList.toggle('crew-routes-attention',pending.length>0);
    routeAlert.hidden=!next;
    routeAlert.textContent=next
      ?next.routeNumber+' — do potwierdzenia odbioru'+
        (pending.length>1?' (+'+(pending.length-1)+')':'')
      :'';
  }
  function clear(){
    generation++;
    user=null;routes=[];current=null;busy=false;
    error();list.replaceChildren();linesContainer.replaceChildren();
    form.hidden=true;
    title.textContent='Trasy';
    confirm.disabled=false;
    renderTile();
    if(dialog?.open)dialog.close();
  }
  async function refresh(nextUser){
    if(nextUser?.role!=='EKIPA'||!nextUser?.markets?.PL)return;
    const id=nextUser.id;
    user=nextUser;
    const generationAtStart=++generation;
    try{
      const data=await request('GET',endpoint);
      if(generationAtStart!==generation||user?.id!==id)return;
      routes=Array.isArray(data.routes)?data.routes:[];
      renderTile();
    }catch(e){
      if(generationAtStart===generation&&user?.id===id&&
        document.getElementById('crewRouteScreen')?.hidden===false)
        error(e.message);
    }
  }
  function statusLabel(route){
    if(route.pending)return 'Do potwierdzenia odbioru';
    if(route.status==='REVIEW_REQUIRED'||route.status==='DISCREPANCY')
      return 'Przekazano różnice do weryfikacji';
    return 'Odbiór potwierdzony';
  }
  function showRouteList(){
    current=null;
    title.textContent='Trasy';
    form.hidden=true;
    error();
    list.replaceChildren();
    const ordered=[...routes].sort((a,b)=>
      Number(b.pending)-Number(a.pending)||
      String(b.routeDate).localeCompare(String(a.routeDate)));
    if(!ordered.length){
      const empty=document.createElement('p');
      empty.className='section-info';
      empty.textContent='Brak przypisanych tras.';
      list.append(empty);
      return;
    }
    for(const route of ordered){
      const button=document.createElement('button');
      button.type='button';
      button.className='crew-route-row'+(route.pending?' pending':'');
      const number=document.createElement('strong');
      number.textContent=route.routeNumber;
      const date=document.createElement('small');
      date.textContent=route.routeDate;
      const status=document.createElement('span');
      status.className='crew-route-row-status';
      status.textContent=statusLabel(route);
      button.append(number,date,status);
      button.addEventListener('click',()=>openDetail(route.id));
      list.append(button);
    }
  }
  async function openDetail(routeId){
    if(busy)return;
    const atStart=++generation;
    error();list.replaceChildren();form.hidden=true;
    title.textContent='Trasa';
    try{
      const data=await request('GET',endpoint+'?id='+encodeURIComponent(routeId));
      if(atStart!==generation||user===null)return;
      current=data;
      const route=data.route;
      title.textContent='Trasa '+route.routeNumber;
      if(!Array.isArray(data.lines)||!data.lines.length){
        error('Ta trasa nie ma listy części.');
        return;
      }
      linesContainer.replaceChildren();
      const canConfirm=Boolean(route.pending);
      for(const line of data.lines){
        const row=document.createElement('div');
        row.className='crew-pickup-line';
        const description=document.createElement('div');
        description.className='crew-pickup-description';
        const name=document.createElement('strong');
        name.textContent=line.partName||line.partCode||'Część';
        const issued=document.createElement('small');
        issued.textContent='Wydano: '+line.quantity+' szt.'+
          (line.partCode?' · '+line.partCode:'');
        description.append(name,issued);
        const input=document.createElement('input');
        input.type='number';
        input.inputMode='numeric';
        input.min='0';input.max='999999';input.step='1';
        input.value=String(line.confirmedQuantity??line.quantity);
        input.disabled=!canConfirm;
        input.dataset.position=String(line.position);
        input.setAttribute('aria-label','Odebrana ilość: '+name.textContent);
        row.append(description,input);
        linesContainer.append(row);
      }
      form.hidden=false;
      confirm.hidden=!canConfirm;
      confirm.disabled=false;
    }catch(e){
      if(atStart===generation)error(e.message);
    }
  }
  async function open(nextUser,show,hide){
    if(!nextUser?.id)return;
    user=nextUser;showScreen=show;hideScreen=hide;
    showScreen?.();
    error();
    const atStart=++generation;
    try{
      const data=await request('GET',endpoint);
      if(atStart!==generation||user?.id!==nextUser.id)return;
      routes=Array.isArray(data.routes)?data.routes:[];
      renderTile();
      const pending=pendingRoutes();
      if(pending.length===1)return openDetail(pending[0].id);
      showRouteList();
    }catch(e){
      if(atStart===generation)error(e.message);
    }
  }
  function goBack(){
    if(busy)return;
    if(current){
      showRouteList();
    }else{
      hideScreen?.();
    }
  }
  async function submit(event){
    event.preventDefault();
    if(busy||!current?.route?.pending||!user)return;
    const route=current.route;
    const items=[...linesContainer.querySelectorAll('input[data-position]')].map(input=>({
      position:Number(input.dataset.position),
      quantity:Number(input.value)
    }));
    if(items.length!==current.lines.length||
      [...linesContainer.querySelectorAll('input')].some(input=>
        !/^\d+$/.test(input.value.trim())||
        !Number.isSafeInteger(Number(input.value))||Number(input.value)>999999)){
      error('Wpisz prawidłową liczbę sztuk przy każdej części.');
      return;
    }
    busy=true;confirm.disabled=true;error();
    try{
      const result=await request('POST',endpoint,{
        action:'confirmPickup',id:route.id,revision:route.revision,lines:items
      });
      current=null;
      hideScreen?.();
      await refresh(user);
      dialogTitle.textContent=result.discrepancy?'Odbiór zapisany — różnice przekazano do biura':
        'Odbiór potwierdzony';
      if(dialog&&!dialog.open)dialog.showModal();
    }catch(e){
      error(e.message);
      if(e.message.includes('zmieniona')||e.message.includes('potwierdzony')){
        await refresh(user);
      }
    }finally{
      busy=false;confirm.disabled=false;
    }
  }
  back.addEventListener('click',goBack);
  form.addEventListener('submit',submit);
  byId('plCrewAfterPickupClose').addEventListener('click',()=>dialog.close());
  window.GPBSPlCrewRoutes={refresh,open,clear,goBack};
})();
