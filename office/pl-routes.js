// GPBS Storage — Polish route editor and D1-backed route list.
// The photo chooser is intentionally local-only until AI recognition is implemented.
(()=>{
  'use strict';
  const byId=id=>document.getElementById(id);
  const html=value=>String(value??'').replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
  const endpoint='/api/pl-routes';
  let photoUrl=null;
  let busy=false;
  let loadSeq=0;
  const routeContext=()=>typeof window.getPlRoutesContext==='function'
    ?window.getPlRoutesContext():null;
  function errorMessage(message=''){
    const element=byId('plRouteError');
    element.textContent=message;
    element.hidden=!message;
  }
  function setBusy(next){
    busy=next;
    byId('plRouteSubmit').disabled=next;
    byId('plRouteCancel').disabled=next;
    byId('plRouteClose').disabled=next;
    byId('plRouteSubmit').textContent=next?'Zapisywanie…':'Zapisz trasę';
  }
  function clearPhoto(){
    if(photoUrl)URL.revokeObjectURL(photoUrl);
    photoUrl=null;
    byId('plRoutePhoto').value='';
    byId('plRoutePhotoPreview').hidden=true;
    byId('plRoutePhotoPreview').removeAttribute('src');
    byId('plRoutePhotoFile').textContent='Nie wybrano zdjęcia.';
  }
  function addPartRow(data={}){
    const target=byId('plRouteParts');
    if(target.children.length>=150){
      errorMessage('W jednej trasie można wpisać maksymalnie 150 pozycji.');
      return;
    }
    const row=document.createElement('div');
    row.className='pl-route-part-row';
    row.innerHTML='<label class="pl-route-part-code">Indeks SAP / GPBS (opcjonalnie)'+
      '<input type="text" data-pl-route-part-code maxlength="100" autocomplete="off" placeholder="Indeks części"></label>'+
      '<label class="pl-route-part-name">Nazwa części'+
      '<input type="text" data-pl-route-part-name maxlength="180" autocomplete="off" placeholder="Nazwa części"></label>'+
      '<label class="pl-route-part-quantity">Ilość'+
      '<input type="number" data-pl-route-part-quantity min="1" max="999999" step="1" inputmode="numeric" placeholder="0"></label>'+
      '<button type="button" class="pl-route-remove-part" data-pl-route-remove-part aria-label="Usuń pozycję">×</button>';
    row.querySelector('[data-pl-route-part-code]').value=data.partCode||'';
    row.querySelector('[data-pl-route-part-name]').value=data.partName||'';
    row.querySelector('[data-pl-route-part-quantity]').value=data.quantity||'';
    target.append(row);
  }

  // ISO 8601: weeks begin on Monday and week 1 contains January 4.
  let calendarMonth=null;
  const formatIsoUTC=d=>d.getUTCFullYear()+'-'+
    String(d.getUTCMonth()+1).padStart(2,'0')+'-'+
    String(d.getUTCDate()).padStart(2,'0');
  function isoWeekNumber(day){
    const thursday=new Date(Date.UTC(
      day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate()
    ));
    thursday.setUTCDate(thursday.getUTCDate()+4-(thursday.getUTCDay()||7));
    const yearStart=Date.UTC(thursday.getUTCFullYear(),0,1);
    return Math.ceil(((thursday.getTime()-yearStart)/86400000+1)/7);
  }
  function routeDateObject(){
    const value=byId('plRouteDate').value;
    const valid=/^\d{4}-\d{2}-\d{2}$/.test(value);
    const date=valid?new Date(value+'T00:00:00Z'):new Date();
    return Number.isNaN(date.getTime())?new Date():date;
  }
  function drawRouteCalendar(){
    if(!calendarMonth)calendarMonth=routeDateObject();
    const y=calendarMonth.getUTCFullYear();
    const m=calendarMonth.getUTCMonth();
    byId('plRouteCalendarMonth').textContent=
      new Intl.DateTimeFormat('pl-PL',{month:'long',year:'numeric',timeZone:'UTC'})
        .format(new Date(Date.UTC(y,m,1)));
    const firstDayOfMonth=new Date(Date.UTC(y,m,1));
    const back=(firstDayOfMonth.getUTCDay()+6)%7;
    const daysInMonth=new Date(Date.UTC(y,m+1,0)).getUTCDate();
    const numberOfWeeks=Math.ceil((back+daysInMonth)/7);
    const selected=byId('plRouteDate').value;
    const now=new Date();
    const todayParts=new Intl.DateTimeFormat('en-US',{
      timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(now);
    const tp=Object.fromEntries(todayParts.filter(p=>
      ['year','month','day'].includes(p.type)).map(p=>[p.type,p.value]));
    const today=tp.year+'-'+tp.month+'-'+tp.day;
    let markup='<span class="pl-route-calendar-week-header">Tydz.</span>'+
      ['Pn','Wt','Śr','Cz','Pt','So','Nd'].map(x=>
        '<span class="pl-route-calendar-day-header">'+x+'</span>').join('');
    for(let week=0;week<numberOfWeeks;week++){
      const monday=new Date(Date.UTC(y,m,1-back+week*7));
      const number=isoWeekNumber(monday);
      markup+='<span class="pl-route-calendar-week" title="Tydzień '+number+
        '" aria-label="Tydzień '+number+'">'+String(number).padStart(2,'0')+'</span>';
      for(let d=0;d<7;d++){
        const current=new Date(Date.UTC(y,m,1-back+week*7+d));
        const value=formatIsoUTC(current);
        const classes=['pl-route-calendar-day'];
        if(current.getUTCMonth()!==m)classes.push('is-outside');
        if(value===selected)classes.push('is-selected');
        else if(value===today)classes.push('is-today');
        markup+='<button type="button" class="'+classes.join(' ')+
          '" data-pl-route-day="'+value+'" aria-label="'+value+
          '"'+(value===selected?' aria-pressed="true"':'')+'>'+
          current.getUTCDate()+'</button>';
      }
    }
    byId('plRouteCalendarDays').innerHTML=markup;
  }
  function setRouteCalendarOpen(open){
    const calendar=byId('plRouteCalendar');
    calendar.classList.toggle('hidden',!open);
    byId('plRouteCalendarToggle').setAttribute('aria-expanded',String(open));
    if(open){
      const date=routeDateObject();
      calendarMonth=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1));
      drawRouteCalendar();
    }
  }
  function changeRouteCalendarMonth(offset){
    if(!calendarMonth)calendarMonth=routeDateObject();
    calendarMonth=new Date(Date.UTC(
      calendarMonth.getUTCFullYear(),calendarMonth.getUTCMonth()+offset,1
    ));
    drawRouteCalendar();
  }

  function openForm(){
    if(busy)return;
    const allowed=['ADMIN','KIEROWNIK','KOORDYNATOR'].includes(routeContext()?.role);
    if(!allowed)return;
    const dialog=byId('plRouteDialog');
    byId('plRouteForm').reset();
    errorMessage();
    clearPhoto();
    byId('plRouteParts').replaceChildren();
    addPartRow();
    // Today's Polish date for the coordinator; editable before saving.
    const date=new Intl.DateTimeFormat('en-CA',{
      timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'
    }).format(new Date());
    byId('plRouteDate').value=date;
    setRouteCalendarOpen(false);
    dialog.showModal();
    byId('plRouteNumber').focus();
  }
  function closeForm(){
    if(busy)return;
    byId('plRouteDialog').close();
  }
  async function selectedPhoto(){
    clearPhotoPreview();
    const file=byId('plRoutePhoto').files?.[0];
    if(!file){byId('plRoutePhotoFile').textContent='Nie wybrano zdjęcia.';return;}
    const validTypes=['image/jpeg','image/png','image/webp','image/heic','image/heif'];
    const validExtension=/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name||'');
    if(!validTypes.includes(file.type)&&!(file.type===''&&validExtension)){
      byId('plRoutePhoto').value='';
      byId('plRoutePhotoFile').textContent='Nieobsługiwany format. Wybierz JPG, PNG, WEBP lub HEIC.';
      return;
    }
    if(file.size<16||file.size>15*1024*1024){
      byId('plRoutePhoto').value='';
      byId('plRoutePhotoFile').textContent='Zdjęcie musi mieć maksymalnie 15 MB.';
      return;
    }
    byId('plRoutePhotoFile').textContent='Wybrano: '+file.name+
      ' (podgląd lokalny, bez wysyłania)';
    photoUrl=URL.createObjectURL(file);
    byId('plRoutePhotoPreview').src=photoUrl;
    byId('plRoutePhotoPreview').hidden=false;
    errorMessage();
  }
  function clearPhotoPreview(){
    if(photoUrl)URL.revokeObjectURL(photoUrl);
    photoUrl=null;
    byId('plRoutePhotoPreview').hidden=true;
    byId('plRoutePhotoPreview').removeAttribute('src');
  }
  function routeData(){
    const routeNumber=byId('plRouteNumber').value.trim();
    const routeDate=byId('plRouteDate').value;
    const crewSymbol=byId('plRouteCrewSymbol').value.trim().toUpperCase();
    const lines=[];
    for(const row of byId('plRouteParts').children){
      const partCode=row.querySelector('[data-pl-route-part-code]').value.trim();
      const partName=row.querySelector('[data-pl-route-part-name]').value.trim();
      const rawQty=row.querySelector('[data-pl-route-part-quantity]').value.trim();
      if(!partCode&&!partName&&!rawQty)continue;
      const quantity=Number(rawQty);
      if((!partCode&&!partName)||!Number.isSafeInteger(quantity)||
         quantity<1||quantity>999999)throw Error(
        'Każda pozycja musi mieć indeks lub nazwę części oraz dodatnią ilość.'
      );
      lines.push({partCode,partName,quantity});
    }
    if(!lines.length)throw Error('Dodaj co najmniej jedną część do trasy.');
    return {action:'create',routeNumber,routeDate,crewSymbol,lines};
  }
  async function jsonResponse(response){
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)throw Error(data.error||'Błąd komunikacji z D1.');
    return data;
  }
  async function saveRoute(event){
    event.preventDefault();
    if(busy)return;
    if(!byId('plRouteForm').reportValidity())return;
    let payload;
    try{payload=routeData();}catch(e){errorMessage(e.message);return;}
    setBusy(true);
    errorMessage();
    try{
      const response=await fetch(endpoint,{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      });
      await jsonResponse(response);
      byId('plRouteDialog').close();
      await window.renderPlRoutesList();
      byId('plRoutesListStatus').textContent='Trasa została zapisana w D1.';
    }catch(e){
      errorMessage(e.message||'Nie udało się zapisać trasy.');
    }finally{
      setBusy(false);
    }
  }
  function routeWeekNumber(dateText){
    // Interpret the stored route date in UTC, independent of the browser timezone.
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText||'')))return '—';
    const date=new Date(dateText+'T00:00:00Z');
    return Number.isNaN(date.getTime())?'—':isoWeekNumber(date);
  }
  function statusInfo(route){
    if(Number(route.discrepancyCount)>0||
       ['REVIEW_REQUIRED','DISCREPANCY'].includes(route.status))
      return {label:'Do weryfikacji – niezgodność',className:'is-discrepancy'};
    if(route.status==='COMPLETED'&&Number(route.unconfirmedCount)>0)
      return {label:'Do weryfikacji',className:'is-discrepancy'};
    if(route.status==='COMPLETED')return {label:'Trasa zakończona',className:'is-completed'};
    if(route.status==='CONFIRMED')return {label:'Potwierdzona',className:'is-confirmed'};
    return {label:'Oczekuje na potwierdzenie',className:''};
  }
  function routeWeekYear(dateText){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText||'')))return null;
    const date=new Date(dateText+'T00:00:00Z');
    if(Number.isNaN(date.getTime()))return null;
    const thursday=new Date(date.getTime());
    thursday.setUTCDate(thursday.getUTCDate()+4-(thursday.getUTCDay()||7));
    return thursday.getUTCFullYear();
  }
  function listTable(routes){
    if(!routes.length)
      return '<div class="pl-routes-empty">Brak tras do wyświetlenia.</div>';
    const header='<table class="pl-route-list-table"><thead><tr>'+
      '<th>Numer tygodnia</th><th>Numer trasy</th><th>Symbol ekipy</th><th>Data</th>'+
      '<th>Pozycje</th><th>Status</th><th>Wprowadził</th><th></th>'+
      '</tr></thead><tbody>';
    const rows=routes.map(item=>{
      const status=statusInfo(item);
      return '<tr'+(status.className==='is-discrepancy'
        ?' class="pl-route-needs-review"':'')+
        '><td><strong>'+html(routeWeekNumber(item.routeDate))+'</strong></td>'+
        '<td><strong>'+html(item.routeNumber)+'</strong>'+
        (Number(item.isPresentation)===1
          ?'<sup class="pl-route-presentation-star" title="Trasa prezentacyjna" aria-label="Trasa prezentacyjna">*</sup>'
          :'')+'</td>'+
        '<td>'+html(item.crewSymbol)+'</td>'+
        '<td>'+html(item.routeDate)+'</td>'+
        '<td>'+html(item.positions)+'</td>'+
        '<td><span class="pl-route-status-badge '+status.className+'">'+status.label+'</span></td>'+
        '<td>'+html(item.enteredBy||'—')+'</td>'+
        '<td><button type="button" class="pl-route-details-button" data-pl-route-details="'+
        html(item.id)+'">Szczegóły</button></td></tr>';
    }).join('');
    return header+rows+'</tbody></table>';
  }
  function historyTable(routes){
    if(!routes.length){
      return '<div class="pl-routes-empty">Brak zakończonych tras. Trasy pojawią się tutaj po zakończeniu i rozliczeniu przez ekipę.</div>';
    }
    const groups=new Map();
    for(const route of routes){
      const year=routeWeekYear(route.routeDate);
      const week=routeWeekNumber(route.routeDate);
      const key=String(year||'—')+'-'+String(week).padStart(2,'0');
      if(!groups.has(key))groups.set(key,{year,week,routes:[]});
      groups.get(key).routes.push(route);
    }
    return [...groups.values()]
      .sort((a,b)=>(b.year||0)-(a.year||0)||Number(b.week||0)-Number(a.week||0))
      .map(group=>{
        const year=group.year===null?'—':group.year;
        const key=String(year)+'-'+String(group.week).padStart(2,'0');
        return '<section class="pl-route-history-group">'+
          '<button type="button" class="pl-route-history-toggle" data-pl-route-week="'+html(key)+
          '" aria-expanded="false"><span>Tydzień '+html(group.week)+' / '+html(year)+'</span>'+
          '<span>'+html(group.routes.length)+' tras</span>'+
          '<span aria-hidden="true">⌄</span></button>'+
          '<div class="pl-route-history-content hidden">'+listTable(group.routes)+'</div></section>';
      }).join('');
  }
  window.renderPlRoutesList=async function(){
    const panel=byId('plRoutesListPanel');
    if(!panel)return;
    const context=routeContext();
    const selected=context?.view==='plRoutes'&&
      (context.tab==='list'||context.tab==='history');
    panel.classList.toggle('hidden',!selected);
    byId('officePlRoutesMessage').classList.toggle('hidden',selected);
    if(!selected)return;
    const history=context.tab==='history';
    byId('plRoutesSectionTitle').textContent=history?'Historia tras':'Aktualne trasy';
    byId('plRoutesSectionDescription').textContent=history
      ?'Zakończone trasy według tygodnia realizacji.'
      :'Lista tras w trakcie realizacji.';
    const role=context?.role;
    byId('plRouteAdd').classList.toggle('hidden',history||
      !['ADMIN','KIEROWNIK','KOORDYNATOR'].includes(role));
    byId('plRoutesClearPresentation').classList.toggle('hidden',true);
    const seq=++loadSeq;
    const status=byId('plRoutesListStatus');
    const table=byId('plRoutesTable');
    status.classList.remove('is-error');
    status.textContent='Pobieranie tras…';
    try{
      const result=await jsonResponse(await fetch(
        endpoint+'?scope='+(history?'history':'active'),{
          credentials:'same-origin',cache:'no-store'
        }
      ));
      if(seq!==loadSeq)return;
      byId('plRoutesClearPresentation').classList.toggle('hidden',
        history||role!=='ADMIN'||result.presentationMode!==true);
      table.innerHTML=history?historyTable(result.routes||[]):listTable(result.routes||[]);
      status.textContent='';
    }catch(error){
      if(seq!==loadSeq)return;
      table.replaceChildren();
      status.classList.add('is-error');
      status.textContent=error.message||'Nie udało się pobrać tras.';
    }
  };
  function routeQuantity(value){
    return value===null||value===undefined?'—':html(value);
  }
  function routeDetailsMarkup(result){
    const route=result.route;
    // A completed route stays in "Aktualne trasy" until the weekly rollover.
    // Show return columns only in actual history, not based on status alone.
    const history=routeContext()?.tab==='history';
    const lines=result.lines||[];
    const mismatches=lines.filter(line=>
      line.confirmedQuantity!==null&&line.confirmedQuantity!==undefined&&
      Number(line.confirmedQuantity)!==Number(line.quantity)
    );
    const cols=history
      ?'<th>#</th><th>Indeks</th><th>Nazwa części</th>'+
       '<th>Wydano</th><th>Potwierdzono (ekipa)</th><th>Zakończono</th>'+
       '<th>Zwrócono</th><th>Miejsce zwrotu</th>'
      :'<th>#</th><th>Indeks</th><th>Nazwa części</th>'+
       '<th>Wydano</th><th>Potwierdzono (ekipa)</th><th>Zakończono</th>';
    const rows=lines.map(line=>{
      const mismatch=line.confirmedQuantity!==null&&line.confirmedQuantity!==undefined&&
        Number(line.confirmedQuantity)!==Number(line.quantity);
      let row='<tr'+(mismatch?' class="pl-route-detail-mismatch"':'')+'>'+
        '<td>'+html(line.position)+'</td>'+
        '<td>'+html(line.partCode||'—')+'</td>'+
        '<td>'+html(line.partName||'—')+'</td>'+
        '<td>'+html(line.quantity)+'</td>'+
        '<td>'+routeQuantity(line.confirmedQuantity)+'</td>'+
        '<td>—</td>'; // completion details will be filled by the future team workflow
      if(history){
        row+='<td>'+routeQuantity(line.returnedQuantity)+'</td>'+
          '<td>'+html(line.returnLocation||'—')+'</td>';
      }
      return row+'</tr>';
    }).join('');
    const warning=mismatches.length
      ?'<p class="pl-route-detail-warning">Rozbieżność w '+mismatches.length+
        ' pozycjach: ilość potwierdzona przez ekipę różni się od wydanej.</p>':'';
    const caption=history
      ?'Rozliczenie zakończonej trasy ':'Wydane i potwierdzone części dla trasy ';
    return '<div class="pl-route-detail-lines">'+
      '<strong>'+caption+html(route.routeNumber)+
        (Number(route.isPresentation)===1?' *':'')+'</strong>'+
      warning+
      '<table><thead><tr>'+cols+'</tr></thead><tbody>'+
        rows+'</tbody></table>'+
      (history?'':'<p class="pl-route-detail-note">„—” oznacza brak danych o potwierdzeniu lub zakończeniu, nie zero sztuk.</p>')+
      '</div>';
  }
  async function showDetails(button){
    if(!/^PL-ROUTE-[a-f0-9-]{36}$/.test(button.dataset.plRouteDetails||''))return;
    const row=button.closest('tr');
    if(!row)return;
    if(row.nextElementSibling?.classList.contains('pl-route-expanded')){
      row.nextElementSibling.remove();
      button.textContent='Szczegóły';
      return;
    }
    const detail=document.createElement('tr');
    detail.className='pl-route-expanded';
    detail.innerHTML='<td colspan="8">Pobieranie pozycji…</td>';
    row.after(detail);
    button.textContent='Zwiń';
    try{
      const result=await jsonResponse(await fetch(
        endpoint+'?id='+encodeURIComponent(button.dataset.plRouteDetails),{
          credentials:'same-origin',cache:'no-store'
        }
      ));
      if(!detail.isConnected)return;
      detail.innerHTML='<td colspan="8">'+routeDetailsMarkup(result)+'</td>';
    }catch(error){
      if(detail.isConnected)detail.firstElementChild.textContent=
        error.message||'Nie udało się odczytać pozycji.';
    }
  }
    async function clearPresentationRoutes(){
    if(busy||routeContext()?.role!=='ADMIN')return;
    if(!window.confirm(
      'Usunąć wszystkie trasy oznaczone gwiazdką (*) oraz ich listy części? '+
      'Prawdziwe trasy i stany magazynowe nie zostaną zmienione.'
    ))return;
    const pin=window.prompt('Potwierdź usunięcie 4-cyfrowym PIN-em administratora:');
    if(pin===null)return;
    const status=byId('plRoutesListStatus');
    status.classList.remove('is-error');
    if(!/^\d{4}$/.test(pin)){
      status.classList.add('is-error');
      status.textContent='Wpisz prawidłowy 4-cyfrowy PIN administratora.';
      return;
    }
    const button=byId('plRoutesClearPresentation');
    button.disabled=true;
    try{
      const result=await jsonResponse(await fetch(endpoint,{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'deletePresentation',confirm:'USUŃ TRASY',pin})
      }));
      await window.renderPlRoutesList();
      status.classList.remove('is-error');
      status.textContent='Usunięto '+Number(result.deleted||0)+
        ' tras prezentacyjnych. Prawdziwe trasy pozostały bez zmian.';
    }catch(error){
      status.classList.add('is-error');
      status.textContent=error.message||'Nie udało się wyczyścić tras.';
    }finally{
      button.disabled=false;
    }
  }
  byId('plRoutesClearPresentation').addEventListener('click',clearPresentationRoutes);

  byId('plRouteCalendarToggle').addEventListener('click',()=>{
    setRouteCalendarOpen(byId('plRouteCalendar').classList.contains('hidden'));
  });
  byId('plRouteDate').addEventListener('click',()=>setRouteCalendarOpen(true));
  byId('plRouteCalendarPrev').addEventListener('click',()=>changeRouteCalendarMonth(-1));
  byId('plRouteCalendarNext').addEventListener('click',()=>changeRouteCalendarMonth(1));
  byId('plRouteCalendarDays').addEventListener('click',event=>{
    const day=event.target.closest('button[data-pl-route-day]');
    if(!day)return;
    byId('plRouteDate').value=day.dataset.plRouteDay;
    setRouteCalendarOpen(false);
    byId('plRouteDate').focus();
  });
  document.addEventListener('click',event=>{
    const calendar=byId('plRouteCalendar');
    if(calendar.classList.contains('hidden'))return;
    if(calendar.contains(event.target)||
       byId('plRouteDate').contains(event.target)||
       byId('plRouteCalendarToggle').contains(event.target))return;
    setRouteCalendarOpen(false);
  });

  byId('plRouteAdd').addEventListener('click',openForm);
  byId('plRouteClose').addEventListener('click',closeForm);
  byId('plRouteCancel').addEventListener('click',closeForm);
  byId('plRouteAddPart').addEventListener('click',()=>addPartRow());
  byId('plRouteParts').addEventListener('click',e=>{
    const remove=e.target.closest('[data-pl-route-remove-part]');
    if(!remove)return;
    const row=remove.closest('.pl-route-part-row');
    if(byId('plRouteParts').children.length>1)row.remove();
    else row.querySelectorAll('input').forEach(input=>input.value='');
  });
  byId('plRoutePhotoPick').addEventListener('click',()=>byId('plRoutePhoto').click());
  byId('plRoutePhoto').addEventListener('change',selectedPhoto);
  byId('plRouteForm').addEventListener('submit',saveRoute);
  byId('plRouteDialog').addEventListener('cancel',event=>{
    if(busy){event.preventDefault();return;}
    if(!byId('plRouteCalendar').classList.contains('hidden')){
      event.preventDefault();
      setRouteCalendarOpen(false);
    }
  });
  byId('plRouteDialog').addEventListener('close',()=>{
    clearPhoto();
    if(!busy)errorMessage();
  });
  byId('plRoutesTable').addEventListener('click',e=>{
    const week=e.target.closest('[data-pl-route-week]');
    if(week){
      const container=week.nextElementSibling;
      const expanded=week.getAttribute('aria-expanded')==='true';
      week.setAttribute('aria-expanded',String(!expanded));
      container.classList.toggle('hidden',expanded);
      return;
    }
    const button=e.target.closest('[data-pl-route-details]');
    if(button)showDetails(button);
  });
  if(routeContext()?.view==='plRoutes')
    window.renderPlRoutesList();
})();
