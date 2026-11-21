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
  let savedRouteId=null; // Retry a failed R2 upload without duplicating the D1 route.
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
    return row;
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

  function lockSavedRouteFields(locked){
    // After the D1 record exists, retrying a failed photo upload must not
    // imply that edits to the visible form would update the stored route.
    for(const id of ['plRouteNumber','plRouteCrewSymbol']){
      byId(id).readOnly=locked;
    }
    byId('plRouteDate').disabled=locked;
    byId('plRouteCalendarToggle').disabled=locked;
    byId('plRouteAddPart').disabled=locked;
    byId('plRouteParts').querySelectorAll('input,button').forEach(field=>{
      field.disabled=locked;
    });
  }
  function openForm(){
    if(busy)return;
    const allowed=['ADMIN','KIEROWNIK','KOORDYNATOR'].includes(routeContext()?.role);
    if(!allowed)return;
    const dialog=byId('plRouteDialog');
    byId('plRouteForm').reset();
    savedRouteId=null;
    lockSavedRouteFields(false);
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
  async function validateRoutePhoto(file){
    // The picker filter alone is not security: verify the actual file
    // signature and make sure the extension and declared MIME agree.
    const ext=String(file?.name||'').split('.').pop().toLowerCase();
    const supported={jpg:'image/jpeg',jpeg:'image/jpeg',jpe:'image/jpeg',
      png:'image/png',webp:'image/webp',heic:'image/heic',heif:'image/heic'};
    if(!Object.hasOwn(supported,ext))
      throw Error('Dozwolone są wyłącznie zdjęcia JPG, PNG, WEBP lub HEIC/HEIF.');
    if(!Number.isSafeInteger(file.size)||file.size<100||file.size>15*1024*1024)
      throw Error('Zdjęcie musi mieć od 100 bajtów do 15 MB.');
    const bytes=new Uint8Array(await file.slice(0,40).arrayBuffer());
    const four=pos=>String.fromCharCode(...bytes.slice(pos,pos+4));
    let detected=null;
    if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)detected='image/jpeg';
    else if(bytes[0]===137&&four(1).slice(0,3)==='PNG'&&
      bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10)
      detected='image/png';
    else if(four(0)==='RIFF'&&four(8)==='WEBP')detected='image/webp';
    else if(four(4)==='ftyp'&&
      ['heic','heix','hevc','hevx','heif','heis','hevm','mif1']
        .includes(four(8)))detected='image/heic';
    const declared={'image/jpg':'image/jpeg','image/pjpeg':'image/jpeg',
      'image/heif':'image/heic'}[file.type]||file.type;
    if(!detected||detected!==supported[ext]||(declared&&declared!==detected))
      throw Error('Plik nie jest poprawnym zdjęciem lub jego format nie zgadza się z rozszerzeniem.');
    return detected;
  }
  async function selectedPhoto(){
    clearPhotoPreview();
    const file=byId('plRoutePhoto').files?.[0];
    if(!file){byId('plRoutePhotoFile').textContent='Nie wybrano zdjęcia.';return;}
    try{
      await validateRoutePhoto(file);
      if(byId('plRoutePhoto').files?.[0]!==file)return;
    }catch(error){
      if(byId('plRoutePhoto').files?.[0]!==file)return;
      byId('plRoutePhoto').value='';
      byId('plRoutePhotoFile').textContent=error.message;
      errorMessage(error.message);
      return;
    }
    byId('plRoutePhotoFile').textContent='Wybrano: '+file.name+
      ' (po zapisaniu trasy zdjęcie będzie pomniejszone i archiwizowane w R2)';
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
    const routeNumber=byId('plRouteNumber').value.trim().toUpperCase();
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
  async function compressRouteDocument(file){
    // The original photo stays local at full resolution; future AI reading
    // will use it before archiving the lighter, legible JPEG derivative.
    let bitmap=null,temporaryUrl=null;
    try{
      await validateRoutePhoto(file);
      if(typeof createImageBitmap==='function'){
        bitmap=await createImageBitmap(file);
      }else{
        temporaryUrl=URL.createObjectURL(file);
        bitmap=await new Promise((resolve,reject)=>{
          const image=new Image();
          image.onload=()=>resolve(image);
          image.onerror=()=>reject(Error('Nie udało się otworzyć zdjęcia w przeglądarce.'));
          image.src=temporaryUrl;
        });
      }
      const width=bitmap.width||bitmap.naturalWidth;
      const height=bitmap.height||bitmap.naturalHeight;
      if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||
         width<250||height<250||width*height>48000000)
        throw Error('Zdjęcie ma nieprawidłowe wymiary lub przekracza 48 megapikseli.');
      const canvas=document.createElement('canvas');
      const context=canvas.getContext('2d',{alpha:false});
      if(!context)throw Error('Nie można przetworzyć zdjęcia w przeglądarce.');
      const encode=(longEdge,quality)=>new Promise((resolve,reject)=>{
        const ratio=Math.min(1,longEdge/Math.max(width,height));
        canvas.width=Math.max(1,Math.round(width*ratio));
        canvas.height=Math.max(1,Math.round(height*ratio));
        context.fillStyle='#ffffff';
        context.fillRect(0,0,canvas.width,canvas.height);
        context.drawImage(bitmap,0,0,canvas.width,canvas.height);
        canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Kompresja zdjęcia nie powiodła się.')),
          'image/jpeg',quality);
      });
      // Prefer a clear 2600px document. Reduce JPEG quality first rather
      // than aggressively shrinking small print on the route sheet.
      const target=900*1024;
      let blob=await encode(2600,0.84);
      if(blob.size>target)blob=await encode(2600,0.77);
      if(blob.size>target)blob=await encode(2600,0.70);
      if(blob.size>1500*1024)blob=await encode(2350,0.75);
      if(blob.size>2300*1024)blob=await encode(2100,0.72);
      if(blob.size>4*1024*1024)
        throw Error('Zdjęcie po kompresji przekracza 4 MB. Wybierz czytelne zdjęcie dokumentu.');
      return new File([blob],'dokument-trasy.jpg',{type:'image/jpeg'});
    }catch(error){
      throw Error(error?.message==='Nie udało się otworzyć zdjęcia w przeglądarce.'
        ?'Nie można pomniejszyć tego zdjęcia. Zapisz je jako JPG lub PNG i wybierz ponownie.'
        :error?.message||'Nie udało się przygotować zdjęcia do R2.');
    }finally{
      if(temporaryUrl)URL.revokeObjectURL(temporaryUrl);
      bitmap?.close?.();
    }
  }
  async function archiveRouteDocument(routeId,file){
    const compressed=await compressRouteDocument(file);
    const form=new FormData();
    form.append('routeId',routeId);
    form.append('photo',compressed);
    return jsonResponse(await fetch('/api/pl-routes-photo',{
      method:'POST',credentials:'same-origin',body:form
    }));
  }
  async function saveRoute(event){
    event.preventDefault();
    if(busy)return;
    if(!byId('plRouteForm').reportValidity())return;
    let payload;
    if(!savedRouteId){
      try{payload=routeData();}catch(error){errorMessage(error.message);return;}
    }
    setBusy(true);
    errorMessage();
    try{
      if(!savedRouteId){
        const result=await jsonResponse(await fetch(endpoint,{
          method:'POST',credentials:'same-origin',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(payload)
        }));
        savedRouteId=result.id;
        lockSavedRouteFields(true);
      }
      const file=byId('plRoutePhoto').files?.[0];
      if(file)await archiveRouteDocument(savedRouteId,file);
      savedRouteId=null;
      byId('plRouteDialog').close();
      await window.renderPlRoutesList();
      byId('plRoutesListStatus').textContent=file
        ?'Trasa i jej pomniejszone zdjęcie zostały zapisane (D1 + R2).'
        :'Trasa została zapisana w D1.';
    }catch(error){
      errorMessage(savedRouteId
        ?'Trasa została zapisana w D1, ale zdjęcia nie udało się zapisać. '+
          (error.message||'Spróbuj ponownie.')+
          ' Kliknij „Zapisz trasę” jeszcze raz, aby ponowić tylko zdjęcie.'
        :error.message||'Nie udało się zapisać trasy.');
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
    let previousWeek=null;
    const rows=routes.map((item,index)=>{
      const status=statusInfo(item);
      const weekKey=String(routeWeekYear(item.routeDate))+'-'+
        String(routeWeekNumber(item.routeDate)).padStart(2,'0');
      const newWeek=index>0&&weekKey!==previousWeek;
      previousWeek=weekKey;
      const rowClasses=[
        status.className==='is-discrepancy'?'pl-route-needs-review':'',
        newWeek?'pl-route-week-separator':''
      ].filter(Boolean);
      return '<tr'+(rowClasses.length?' class="'+rowClasses.join(' ')+'"':'')+
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
      '<div class="pl-route-document-links">'+
        (result.documents?.length
          ?'<strong>Zdjęcia dokumentu:</strong> '+result.documents.map((doc,index)=>{
            const url='/api/pl-routes-photo?routeId='+encodeURIComponent(route.id)+
              '&documentId='+encodeURIComponent(doc.id);
            return '<a href="'+html(url)+'" target="_blank" rel="noopener noreferrer">'+
              'Otwórz zdjęcie '+(index+1)+'</a>';
          }).join(' · ')
          :'<span>Nie dołączono zdjęcia dokumentu.</span>')+
      '</div></div>';
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

  // Uppercase visible text during typing and pasting, without moving the caret.
  for(const id of ['plRouteNumber','plRouteCrewSymbol']){
    const input=byId(id);
    const uppercase=()=>{
      const value=input.value;
      const upper=value.toUpperCase();
      if(value===upper)return;
      const start=input.selectionStart;
      const end=input.selectionEnd;
      input.value=upper;
      if(start!==null&&end!==null){
        input.setSelectionRange(value.slice(0,start).toUpperCase().length,
          value.slice(0,end).toUpperCase().length);
      }
    };
    input.addEventListener('input',event=>{if(!event.isComposing)uppercase();});
    input.addEventListener('compositionend',uppercase);
    input.addEventListener('change',uppercase);
  }
  byId('plRouteAdd').addEventListener('click',openForm);
  byId('plRouteClose').addEventListener('click',closeForm);
  byId('plRouteCancel').addEventListener('click',closeForm);
  byId('plRouteAddPart').addEventListener('click',()=>addPartRow());
  // Enter in a part line adds the next line; it must never submit the route.
  byId('plRouteParts').addEventListener('keydown',event=>{
    if(event.key!=='Enter'||event.isComposing)return;
    const input=event.target;
    const row=input.closest?.('.pl-route-part-row');
    if(!row||!input.matches('input'))return;
    event.preventDefault();
    if(event.repeat||busy)return;
    const code=row.querySelector('[data-pl-route-part-code]');
    const name=row.querySelector('[data-pl-route-part-name]');
    const qty=row.querySelector('[data-pl-route-part-quantity]');
    const quantity=Number(qty.value);
    if(!code.value.trim()&&!name.value.trim()){
      errorMessage('Wpisz indeks lub nazwę części przed dodaniem kolejnej pozycji.');
      name.focus();
      return;
    }
    if(!qty.value.trim()||!Number.isSafeInteger(quantity)||quantity<1||
       quantity>999999){
      errorMessage('Wpisz prawidłową ilość, aby dodać kolejną część.');
      qty.focus();
      return;
    }
    errorMessage();
    const next=addPartRow();
    next?.querySelector('[data-pl-route-part-code]').focus();
  });
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
