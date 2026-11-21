// GPBS Storage: Polish crew routes, pickup, final report and own history.
(() => {
  'use strict';
  const get=id=>document.getElementById(id);
  const activeButton=get('plCrewActiveRouteButton');
  const activeLabel=get('plCrewActiveRouteLabel');
  const historyButton=get('plCrewRoutesButton');
  const title=get('plCrewRouteTitle');
  const routeScreen=get('crewRouteScreen');
  const errorNode=get('plCrewRoutesError');
  const back=get('plCrewRoutesBack');
  const list=get('plCrewRoutesList');
  const searchWrap=get('plCrewHistorySearchWrap');
  const searchInput=get('plCrewHistorySearch');
  const more=get('plCrewHistoryMore');
  const detail=get('plCrewRouteDetail');
  const routeMeta=get('plCrewRouteMeta');
  const pickupForm=get('plCrewPickupForm');
  const pickupLines=get('plCrewPickupLines');
  const pickupComment=get('plCrewPickupComment');
  const pickupButton=get('plCrewConfirmPickup');
  const reportForm=get('plCrewReportForm');
  const reportLines=get('plCrewReportLines');
  const reportComment=get('plCrewReportComment');
  const reportButton=get('plCrewSubmitReport');
  const readOnly=get('plCrewRouteReadOnly');
  const summary=get('plCrewRouteSummary');
  const comments=get('plCrewRouteComments');
  const dialog=get('plCrewAfterPickup');
  const dialogTitle=get('plCrewAfterPickupTitle');
  const path='/api/pl/route';

  let user=null, active=[], history=[], hasMore=false, nextOffset=0;
  let current=null, screen='home', from='action', busy=false, sequence=0;
  let showScreen=null, hideScreen=null;
  const cleanNumber=value=>Number.isSafeInteger(value)&&value>=0&&value<=999999;
  const el=(tag,className,content)=>{
    const node=document.createElement(tag);
    if(className)node.className=className;
    if(content!==undefined)node.textContent=String(content);
    return node;
  };
  function error(message=''){
    errorNode.textContent=message;
    errorNode.hidden=!message;
  }
  async function request(method,url,body){
    const response=await fetch(url,{
      method,credentials:'same-origin',cache:'no-store',
      ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})
    });
    const data=await response.json().catch(()=>null);
    if(!response.ok||!data?.ok)throw Error(data?.error||'Nie udało się odczytać danych trasy.');
    return data;
  }
  const priority=r=>r.pendingPickup?0:r.pendingReport?1:2;
  const activeSorted=()=>[...active].sort((a,b)=>priority(a)-priority(b)||
    String(b.routeDate).localeCompare(String(a.routeDate))||
    String(b.routeNumber).localeCompare(String(a.routeNumber),'pl',{numeric:true}));
  function activeChoice(){return activeSorted().find(r=>r.pendingPickup||r.pendingReport)||null;}
  function renderTile(){
    const route=activeChoice();
    activeButton.hidden=!route;
    if(!route)return;
    const pickup=route.pendingPickup;
    activeButton.classList.toggle('pickup',pickup);
    activeButton.classList.toggle('report',!pickup);
    activeLabel.replaceChildren();
    if(pickup){
      activeLabel.append(el('strong','',route.routeNumber),
        el('span','','Potwierdź odbiór części'));
    }else{
      activeLabel.append(el('span','',route.routeNumber+' – Zdaj raport z wykorzystanych części'));
    }
  }
  async function refresh(nextUser){
    if(nextUser?.role!=='EKIPA'||!nextUser?.markets?.PL)return;
    user=nextUser;
    const token=++sequence, userId=user.id;
    try{
      const result=await request('GET',path+'?view=active');
      if(token!==sequence||user?.id!==userId)return;
      active=Array.isArray(result.routes)?result.routes:[];
      renderTile();
    }catch(e){
      if(token===sequence&&screen!=='home')error(e.message);
    }
  }
  function clear(){
    sequence++;
    user=null;active=[];history=[];current=null;
    hasMore=false;nextOffset=0;screen='home';busy=false;
    error();list.replaceChildren();pickupLines.replaceChildren();
    reportLines.replaceChildren();summary.replaceChildren();comments.replaceChildren();
    routeScreen.classList.remove('is-report');
    routeMeta.hidden=false;
    detail.hidden=true;pickupForm.hidden=true;reportForm.hidden=true;readOnly.hidden=true;
    searchWrap.hidden=true;more.hidden=true;
    activeButton.hidden=true;
    if(dialog?.open)dialog.close();
  }
  const dateLabel=date=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return String(date||'');
    return date.slice(8)+'.'+date.slice(5,7)+'.'+date.slice(0,4);
  };
  const timeLabel=stamp=>{
    if(!stamp)return '';
    const date=new Date(stamp);
    if(Number.isNaN(date.getTime()))return '';
    return new Intl.DateTimeFormat('pl-PL',{dateStyle:'short',timeStyle:'short',
      timeZone:'Europe/Warsaw'}).format(date);
  };
  function weekLabel(value){
    const d=new Date(String(value)+'T00:00:00Z');
    if(Number.isNaN(d.getTime()))return 'Pozostałe trasy';
    d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));
    const first=new Date(Date.UTC(d.getUTCFullYear(),0,1));
    const week=Math.ceil((((d-first)/86400000)+1)/7);
    return 'Tydzień '+week+' / '+d.getUTCFullYear();
  }
  function statusLabel(route){
    if(route.pendingPickup)return 'Do potwierdzenia odbioru';
    if(route.status==='COMPLETED')return 'Trasa rozliczona';
    if(route.requiresOfficeReview)return 'Odbiór zgłoszony — weryfikacja w Office';
    return 'Odbiór potwierdzony';
  }
  function showHistoryList(){
    screen='history';current=null;detail.hidden=true;searchWrap.hidden=false;
    routeScreen.classList.remove('is-report');routeMeta.hidden=false;
    list.hidden=false;title.textContent='Trasy';error();
    const filter=searchInput.value.trim().toLocaleUpperCase('pl');
    // The API filters across all saved weeks, not only already loaded pages.
    let lastWeek='';
    list.replaceChildren();
    for(const r of history){
      if(filter&&!String(r.routeNumber||'').toLocaleUpperCase('pl').includes(filter))
        continue;
      const week=weekLabel(r.routeDate);
      if(week!==lastWeek){
        list.append(el('h3','crew-week-heading',week));
        lastWeek=week;
      }
      const button=el('button','crew-route-row');
      button.type='button';
      if(r.pendingPickup||r.pendingReport)button.classList.add('pending');
      button.append(el('strong','',r.routeNumber),
        el('small','',dateLabel(r.routeDate)),
        el('span','crew-route-row-status',statusLabel(r)));
      button.addEventListener('click',()=>openDetail(r.id,'history'));
      list.append(button);
    }
    if(!list.childElementCount)list.append(el('p','section-info','Brak tras.'));
    more.hidden=!hasMore;
  }
  async function loadHistory(reset=true){
    if(!user||busy)return;
    const token=++sequence, id=user.id, offset=reset?0:nextOffset;
    const search=searchInput.value.trim().slice(0,80);
    if(reset){history=[];nextOffset=0;hasMore=false;}
    screen='history';searchWrap.hidden=false;detail.hidden=true;list.hidden=false;
    title.textContent='Trasy';more.hidden=true;error();
    try{
      const data=await request('GET',path+'?view=history&offset='+offset+
        '&search='+encodeURIComponent(search));
      if(token!==sequence||user?.id!==id||screen!=='history')return;
      history=reset?(data.routes||[]):[...history,...(data.routes||[])];
      nextOffset=Number(data.nextOffset||0);
      hasMore=Boolean(data.hasMore);
      showHistoryList();
    }catch(e){if(token===sequence)error(e.message);}
  }
  function lineHeader(line){
    const wrapper=el('div','crew-pickup-description');
    wrapper.append(el('strong','',line.partName||line.partCode||'Część'));
    const code=String(line.partCode||'').trim();
    if(code)wrapper.append(el('small','',code));
    return wrapper;
  }
  function quantityInput(value,label,position,field){
    const input=el('input','crew-route-quantity');
    input.type='number';input.inputMode='numeric';
    input.min='0';input.max='999999';input.step='1';
    input.required=true;input.value=String(value);
    input.dataset.position=String(position);
    input.dataset.field=field;
    input.setAttribute('aria-label',label);
    return input;
  }
  function showPickup(lines){
    routeScreen.classList.remove('is-report');routeMeta.hidden=false;
    pickupLines.replaceChildren();
    pickupComment.value='';
    for(const line of lines){
      const row=el('div','crew-pickup-line');
      const head=lineHeader(line);
      head.append(el('small','','Wydano: '+line.quantity+' szt.'));
      row.append(head,quantityInput(line.confirmedQuantity??line.quantity,
        'Faktycznie odebrano: '+(line.partName||line.partCode),line.position,'quantity'));
      pickupLines.append(row);
    }
    pickupForm.hidden=false;
    reportForm.hidden=true;readOnly.hidden=true;
  }
  function showReport(lines){
    reportLines.replaceChildren();
    reportComment.value='';
    routeScreen.classList.add('is-report');
    routeMeta.hidden=true;
    for(const line of lines){
      const accepted=line.verifiedQuantity??line.confirmedQuantity;
      const actual=Number(accepted);
      const partName=line.partName||line.partCode||'Część';
      const row=el('div','crew-report-line');
      const head=el('div','crew-report-part');
      head.append(el('strong','',partName),
        el('small','crew-report-received','Odebrano: '+actual+' szt.'));
      const code=String(line.partCode||'').trim();
      if(code&&code!==partName)head.append(el('small','crew-report-part-code',code));

      // Used quantity is read-only and always follows the entered return count.
      const used=el('output','crew-report-used',String(actual));
      used.setAttribute('aria-label','Wykorzystano: '+partName);
      const returned=quantityInput(line.returnedQuantity??0,
        'Zwrócono: '+partName,line.position,'returned');
      returned.max=String(actual);
      returned.classList.add('crew-report-returned');

      const placeLabel=el('label','crew-report-place','Miejsce zwrotu');
      const place=el('select','crew-place-input');
      for(const [value,label] of [
        ['','Wybierz miejsce zwrotu'],
        ['Magazyn Tychy','Magazyn Tychy'],
        ['InPost','InPost']
      ]){
        const option=el('option','',label);
        option.value=value;place.append(option);
      }
      place.value=line.returnLocation||'';
      place.dataset.position=String(line.position);
      place.dataset.field='returnLocation';
      place.setAttribute('aria-label','Miejsce zwrotu: '+partName);
      placeLabel.append(place);

      function recalculate(){
        const raw=returned.value.trim();
        const count=raw===''?NaN:Number(raw);
        const valid=Number.isSafeInteger(count)&&count>=0&&count<=actual;
        returned.setCustomValidity(valid?'':'Zwrócono: wpisz liczbę od 0 do '+actual+'.');
        used.textContent=valid?String(actual-count):'—';
        used.classList.toggle('crew-report-invalid',!valid);
        placeLabel.hidden=!valid||count===0;
        place.required=valid&&count>0;
        if(valid&&count===0)place.value='';
      }
      returned.addEventListener('input',recalculate);
      recalculate();
      const quantities=el('div','crew-report-quantities');
      const usedGroup=el('div','crew-report-quantity');
      usedGroup.append(el('span','crew-report-quantity-label','Wykorzystano'),used);
      const returnedGroup=el('label','crew-report-quantity');
      returnedGroup.append(el('span','crew-report-quantity-label','Zwrócono'),returned);
      quantities.append(usedGroup,returnedGroup);
      row.append(head,quantities,placeLabel);
      reportLines.append(row);
    }
    reportForm.hidden=false;
    pickupForm.hidden=true;readOnly.hidden=true;
  }
  function showReadOnly(data){
    routeScreen.classList.remove('is-report');routeMeta.hidden=false;
    summary.replaceChildren();comments.replaceChildren();
    const r=data.route;
    for(const line of data.lines||[]){
      const row=el('div','crew-route-summary-row');
      row.append(lineHeader(line));
      const values=el('div','crew-route-summary-values');
      values.append(el('span','','Wydano: '+line.quantity));
      if(line.confirmedQuantity!==null)
        values.append(el('span','','Odebrano: '+line.confirmedQuantity));
      if(line.verifiedQuantity!==null)
        values.append(el('span','','Po weryfikacji: '+line.verifiedQuantity));
      if(line.returnedQuantity!==null){
        const actual=line.verifiedQuantity??line.confirmedQuantity;
        if(actual!==null)
          values.append(el('span','','Wykorzystano: '+(Number(actual)-Number(line.returnedQuantity))));
        values.append(el('span','','Zwrócono: '+line.returnedQuantity));
        if(line.returnLocation)values.append(el('span','','Zwrot: '+line.returnLocation));
      }
      row.append(values);summary.append(row);
    }
    for(const note of data.crewComments||[]){
      if(!note.comment)continue;
      const box=el('section','crew-history-note');
      box.append(el('strong','',note.stage==='PICKUP'?'Komentarz do odbioru':'Komentarz do raportu'));
      const timestamp=timeLabel(note.createdAt);
      if(timestamp)box.append(el('small','',timestamp));
      box.append(el('p','',note.comment));
      comments.append(box);
    }
    if(data.pickupAt||data.reportAt){
      const log=el('p','crew-route-stamps');
      if(data.pickupAt)log.append(el('span','','Odbiór: '+timeLabel(data.pickupAt)));
      if(data.reportAt)log.append(el('span','','Raport: '+timeLabel(data.reportAt)));
      comments.append(log);
    }
    pickupForm.hidden=true;reportForm.hidden=true;readOnly.hidden=false;
  }
  async function openDetail(routeId,origin){
    if(busy||!user)return;
    const token=++sequence,id=user.id;
    from=origin;
    screen='detail';current=null;error();
    routeScreen.classList.remove('is-report');routeMeta.hidden=false;
    list.hidden=true;searchWrap.hidden=true;more.hidden=true;
    detail.hidden=true;
    title.textContent='Trasa';
    try{
      const data=await request('GET',path+'?id='+encodeURIComponent(routeId));
      if(token!==sequence||user?.id!==id||screen!=='detail')return;
      current=data;
      const route=data.route;
      title.textContent='Trasa '+route.routeNumber;
      routeMeta.textContent=dateLabel(route.routeDate)+' · '+statusLabel(route);
      detail.hidden=false;
      if(origin==='action'&&route.pendingPickup)showPickup(data.lines);
      else if(origin==='action'&&route.pendingReport)showReport(data.lines);
      else showReadOnly(data);
    }catch(e){if(token===sequence)error(e.message);}
  }
  function setup(userAccount,show,hide){
    user=userAccount;showScreen=show;hideScreen=hide;showScreen?.();
    error();screen='home';current=null;
  }
  async function openAction(userAccount,show,hide){
    setup(userAccount,show,hide);
    let route=activeChoice();
    if(!route){
      try{await refresh(userAccount);}catch{}
      route=activeChoice();
    }
    if(route)await openDetail(route.id,'action');
    else hideScreen?.();
  }
  async function openHistory(userAccount,show,hide){
    setup(userAccount,show,hide);
    searchInput.value='';
    await loadHistory(true);
  }
  function goBack(){
    if(busy)return;
    if(screen==='detail'&&from==='history'){
      showHistoryList();
      return;
    }
    screen='home';current=null;sequence++;
    routeScreen.classList.remove('is-report');routeMeta.hidden=false;
    hideScreen?.();
  }
  function payload(formFields){
    const items=new Map();
    for(const input of formFields){
      const position=Number(input.dataset.position);
      let item=items.get(position);
      if(!item){item={position};items.set(position,item);}
      const field=input.dataset.field;
      const value=input.value.trim();
      if(field==='returnLocation')item[field]=value;
      else{
        if(!/^\d+$/.test(value)||!cleanNumber(Number(value)))return null;
        item[field]=Number(value);
      }
    }
    return [...items.values()];
  }
  async function submitPickup(event){
    event.preventDefault();
    if(busy||!current?.route?.pendingPickup||!user)return;
    const fields=[...pickupLines.querySelectorAll('[data-field]')];
    const lines=payload(fields);
    if(!lines||lines.length!==current.lines.length){
      error('Wpisz prawidłowe ilości odebranych części.');return;
    }
    busy=true;pickupButton.disabled=true;error();
    try{
      const route=current.route;
      const result=await request('POST',path,{
        action:'confirmPickup',id:route.id,revision:route.revision,
        lines,comment:pickupComment.value.trim()
      });
      current=null;screen='home';
      const existing=active.find(r=>r.id===route.id);
      if(existing){existing.pendingPickup=false;existing.pendingReport=true;
        existing.status=result.status;renderTile();}
      hideScreen?.();
      await refresh(user);
      dialogTitle.textContent=result.discrepancy
        ?'Odbiór zapisany — różnice przekazano do biura':'Odbiór potwierdzony';
      if(dialog&&!dialog.open)dialog.showModal();
    }catch(e){error(e.message);}
    finally{busy=false;pickupButton.disabled=false;}
  }
  async function submitReport(event){
    event.preventDefault();
    if(busy||!current?.route?.pendingReport||!user)return;
    const fields=[...reportLines.querySelectorAll('[data-field]')];
    const lines=payload(fields);
    if(!lines||lines.length!==current.lines.length){
      error('Sprawdź ilości wykorzystane i zwrócone.');return;
    }
    for(const line of lines){
      const source=current.lines.find(x=>Number(x.position)===line.position);
      const received=Number(source?.verifiedQuantity??source?.confirmedQuantity);
      if(!source||!cleanNumber(received)||!cleanNumber(line.returned)||
          line.returned>received){
        error('Zwrócona ilość nie może przekraczać liczby odebranych sztuk.');
        return;
      }
      line.used=received-line.returned;
      if(line.returned>0&&!line.returnLocation){
        error('Podaj miejsce zwrotu dla każdej zwracanej części.');
        return;
      }
      if(line.returned===0)line.returnLocation='';
    }
    busy=true;reportButton.disabled=true;error();
    try{
      const route=current.route;
      await request('POST',path,{
        action:'submitReport',id:route.id,revision:route.revision,
        lines,comment:reportComment.value.trim()
      });
      active=active.filter(r=>r.id!==route.id);
      renderTile();
      current=null;screen='home';hideScreen?.();
      await refresh(user);
    }catch(e){error(e.message);}
    finally{busy=false;reportButton.disabled=false;}
  }
  back.addEventListener('click',goBack);
  more.addEventListener('click',()=>loadHistory(false));
  let searchTimer=null;
  searchInput.addEventListener('input',()=>{
    if(searchTimer!==null)clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>{if(screen==='history')loadHistory(true);},350);
  });
  pickupForm.addEventListener('submit',submitPickup);
  reportForm.addEventListener('submit',submitReport);
  get('plCrewAfterPickupClose').addEventListener('click',()=>dialog.close());
  window.GPBSPlCrewRoutes={refresh,openAction,openHistory,clear,goBack};
})();
