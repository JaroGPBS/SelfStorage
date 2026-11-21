// GPBS Storage — Polish route editor and D1-backed route list.
// The photo chooser is intentionally local-only until AI recognition is implemented.
(()=>{
  'use strict';
  const byId=id=>document.getElementById(id);
  const html=value=>String(value??'').replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
  const endpoint='/api/pl-routes';
  let savedRouteId=null; // Retry a failed R2 upload without duplicating the D1 route.
  let editingRouteId=null; // Existing route opened for corrections before team confirmation.
  let editingRouteRevision=0;
  const routeAuditCache=new Map();
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
    byId('plRouteSubmit').textContent=next?'Zapisywanie…':
      (savedRouteId?'Ponów zapis zdjęcia':editingRouteId?'Zapisz zmiany':'Zapisz trasę');
  }
  function clearPhoto(){
    byId('plRoutePhoto').value='';
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
    editingRouteId=null;
    editingRouteRevision=0;
    byId('plRouteTitle').textContent='Dodaj trasę';
    byId('plRouteSubmit').textContent='Zapisz trasę';
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
  async function editRoute(button){
    if(busy||byId('plRouteDialog').open)return;
    if(!['ADMIN','KIEROWNIK','KOORDYNATOR'].includes(routeContext()?.role))return;
    const id=button.dataset.plRouteEdit||'';
    if(!/^PL-ROUTE-[a-f0-9-]{36}$/.test(id))return;
    const status=byId('plRoutesListStatus');
    button.disabled=true;
    try{
      const result=await jsonResponse(await fetch(
        endpoint+'?id='+encodeURIComponent(id),{
          credentials:'same-origin',cache:'no-store'
        }
      ));
      if(!result.route?.canEdit){
        await window.renderPlRoutesList();
        status.classList.add('is-error');
        status.textContent='Edycja jest zablokowana: trasa została potwierdzona przez ekipę.';
        return;
      }
      openForm();
      editingRouteId=id;
      editingRouteRevision=Number(result.route.editRevision)||0;
      byId('plRouteTitle').textContent='Edytuj trasę';
      byId('plRouteSubmit').textContent='Zapisz zmiany';
      byId('plRouteNumber').value=result.route.routeNumber||'';
      byId('plRouteCrewSymbol').value=result.route.crewSymbol||'';
      byId('plRouteDate').value=result.route.routeDate||'';
      const target=byId('plRouteParts');
      target.replaceChildren();
      (result.lines||[]).forEach(line=>addPartRow(line));
      if(!target.children.length)addPartRow();
      const photoCount=result.documents?.length||0;
      byId('plRoutePhotoFile').textContent=photoCount
        ?'Zapisane zdjęcia: '+photoCount+'. Zostaną zachowane. Możesz dodać nowe zdjęcie.'
        :'Nie dołączono zdjęcia. Możesz je dodać podczas edycji.';
      byId('plRouteNumber').focus();
    }catch(error){
      status.classList.add('is-error');
      status.textContent=error.message||'Nie udało się otworzyć edycji trasy.';
    }finally{
      button.disabled=false;
    }
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
    errorMessage();
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
      if(blob.size>1500*1024){
        const smaller=await encode(2350,0.75);
        if(smaller.size<blob.size)blob=smaller;
      }
      if(blob.size>2300*1024){
        const smaller=await encode(2100,0.72);
        if(smaller.size<blob.size)blob=smaller;
      }
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
      try{
        payload=routeData();
        if(editingRouteId){
          payload.action='update';
          payload.id=editingRouteId;
          payload.baseRevision=editingRouteRevision;
        }
      }catch(error){errorMessage(error.message);return;}
    }
    if(!savedRouteId&&!await confirmRouteAction(editingRouteId
      ?'Czy na pewno wszystkie zmienione dane trasy są poprawne? Zapisać edycję?'
      :'Czy na pewno wszystkie dane trasy zostały wprowadzone poprawnie? Zapisać trasę?'))return;
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
      const wasEdit=Boolean(editingRouteId);
      savedRouteId=null;
      editingRouteId=null;
      editingRouteRevision=0;
      byId('plRouteDialog').close();
      await window.renderPlRoutesList();
      byId('plRoutesListStatus').textContent=(wasEdit?'Zapisano zmiany trasy.':'Trasa zapisana w D1.')+
        (file?' Dodano zdjęcie dokumentu do R2.':'');
    }catch(error){
      errorMessage(savedRouteId
        ?(editingRouteId?'Zmiany trasy zapisano w D1, ale zdjęcia nie udało się dodać. '
          :'Trasa jest zapisana w D1, ale zdjęcia nie udało się dodać. ')+
          (error.message||'Spróbuj ponownie.')+
          ' Kliknij „Ponów zapis zdjęcia”, aby ponowić samo zdjęcie.'
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
    const discrepancy=Number(route.discrepancyCount)>0||
      ['REVIEW_REQUIRED','DISCREPANCY'].includes(route.status);
    if(discrepancy)
      return {label:'Do weryfikacji – niezgodność',className:'is-discrepancy'};
    if(route.status==='COMPLETED'&&Number(route.unconfirmedCount)>0)
      return {label:'Do weryfikacji',className:'is-discrepancy'};
    const hadDiscrepancy=Number(route.hadDiscrepancy)>0;
    const hadVerification=Number(route.hadVerification)>0;
    const note=hadVerification?' – wyjaśniona':hadDiscrepancy?' – była niezgodność':'';
    if(route.status==='COMPLETED')
      return {label:'Trasa zakończona'+note,className:'is-completed'};
    if(route.status==='CONFIRMED'||route.status==='REVIEW_EXPLAINED'&&
       Number(route.unconfirmedCount)===0)
      return {label:'Potwierdzona'+note,className:'is-confirmed'};
    return {label:'Oczekuje na potwierdzenie',className:'is-pending'};
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
      '<th>Pozycje</th><th>Status</th><th>Dodał</th><th></th>'+
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
        '<td><span class="pl-route-status-badge '+status.className+'">'+
          html(status.label)+'</span></td>'+
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
    byId('plRoutesSeedDemo48').classList.add('hidden');
    byId('plRoutesDeleteDemo48').classList.add('hidden');
    byId('plRoutesCompleteDemo45').classList.add('hidden');
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
      const showDemo=!history&&role==='ADMIN'&&result.presentationMode===true;
      const demoCount=Number(result.demoWeek48Count||0);
      byId('plRoutesSeedDemo48').classList.toggle('hidden',!showDemo||demoCount>=8);
      byId('plRoutesDeleteDemo48').classList.toggle('hidden',!showDemo||demoCount===0);
      const demo45=(result.routes||[]).filter(route=>
        Number(route.isPresentation)===1&&
        ['02HH','02HP'].includes(route.routeNumber)&&
        route.routeDate>='2026-11-02'&&route.routeDate<='2026-11-08'
      );
      const demo45Ready=history&&role==='ADMIN'&&
        demo45.length===2&&
        demo45.some(route=>route.status!=='COMPLETED');
      byId('plRoutesCompleteDemo45').classList.toggle('hidden',!demo45Ready);
      routeAuditCache.clear();
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
  function auditTime(stamp){
    const date=new Date(stamp||'');
    return Number.isNaN(date.getTime())?'—':new Intl.DateTimeFormat('pl-PL',{
      dateStyle:'short',timeStyle:'short',timeZone:'Europe/Warsaw'
    }).format(date);
  }
  function routeDetailsMarkup(result){
    const route=result.route;
    const history=routeContext()?.tab==='history';
    const lines=result.lines||[];
    const mismatches=lines.filter(line=>
      line.confirmedQuantity!=null&&line.verifiedQuantity==null&&
      Number(line.confirmedQuantity)!==Number(line.quantity)
    );
    const completed=route.status==='COMPLETED';
    // Show verification only when a discrepancy was reported, or a verified
    // quantity was recorded. Ordinary agreed routes stay compact.
    const showVerification=lines.some(line=>
      line.verifiedQuantity!=null||
      line.confirmedQuantity!=null&&Number(line.confirmedQuantity)!==Number(line.quantity)
    );
    const cols='<th>#</th><th>Indeks</th><th>Nazwa części</th>'+
      '<th>Wydano</th><th>Potwierdzono (ekipa)</th>'+
      (showVerification?'<th>Po weryfikacji</th>':'')+
      (completed?'<th>Wykorzystano</th><th>Zwrócono</th>':'<th>Zakończono</th>')+
      (history?'<th>Miejsce zwrotu</th>':'');
    const rows=lines.map(line=>{
      const mismatch=line.confirmedQuantity!=null&&line.verifiedQuantity==null&&
        Number(line.confirmedQuantity)!==Number(line.quantity);
      let row='<tr'+(mismatch?' class="pl-route-detail-mismatch"':'')+'>'+
        '<td>'+html(line.position)+'</td>'+
        '<td>'+html(line.partCode||'—')+'</td>'+
        '<td>'+html(line.partName||'—')+'</td>'+
        '<td>'+html(line.quantity)+'</td>'+
        '<td>'+routeQuantity(line.confirmedQuantity)+'</td>';
      if(showVerification)row+='<td>'+routeQuantity(line.verifiedQuantity)+'</td>';
      if(completed){
        // Used = actual confirmed/verified pieces minus returned pieces.
        // Do not guess when either count is unknown or still disputed.
        const actual=line.verifiedQuantity??line.confirmedQuantity;
        const returned=line.returnedQuantity;
        const valid=actual!=null&&returned!=null&&!mismatch&&
          Number.isSafeInteger(Number(actual))&&Number.isSafeInteger(Number(returned))&&
          Number(actual)>=Number(returned)&&Number(returned)>=0;
        row+='<td>'+routeQuantity(valid?Number(actual)-Number(returned):null)+'</td>'+
          '<td>'+routeQuantity(returned)+'</td>';
      }else{
        row+='<td>—</td>';
      }
      if(history)row+='<td>'+
        (Number(line.returnedQuantity)===0?'':html(line.returnLocation||'—'))+
        '</td>';
      return row+'</tr>';
    }).join('');
    const warning=mismatches.length
      ?'<p class="pl-route-detail-warning">'+
       'Niezgodność w '+mismatches.length+
          ' pozycjach. Zweryfikuj ilości i dodaj komentarz.'+
       '</p>':'';
    const caption=history
      ?(completed?'Rozliczenie zakończonej trasy ':'Archiwalne dane trasy ')
      :'Wydane i potwierdzone części dla trasy ';
    const role=routeContext()?.role;
    const canWork=['ADMIN','KIEROWNIK','KOORDYNATOR'].includes(role);
    const editable=!history&&route.canEdit===true&&canWork;
    const explainable=!history&&canWork&&mismatches.length>0&&
      route.status!=='COMPLETED';
    const photoButtons=(result.documents||[]).length
      ?result.documents.map((doc,index)=>
        '<button type="button" class="pl-route-document-button" '+
          'data-pl-route-document="'+html(doc.id)+'" '+
          'data-pl-route-document-route="'+html(route.id)+'" '+
          'title="Otwórz zapisane zdjęcie WZ">'+
          (result.documents.length===1?'Zdjęcie WZ':'Zdjęcie WZ '+(index+1))+
        '</button>'
      ).join('')
      :'<button type="button" class="pl-route-document-button" disabled '+
        'title="Do tej trasy nie dołączono zdjęcia WZ">Zdjęcie WZ</button>';
    const editButton=editable
      ?'<button type="button" class="pl-route-edit-button" '+
        'data-pl-route-edit="'+html(route.id)+'">Edytuj</button>'
      :'';
    const explainButton=explainable
      ?'<button type="button" class="pl-route-explain-button" '+
        'data-pl-route-explain="'+html(route.id)+'">Wyjaśnij niezgodność</button>'
      :'';
    const showDemoDelete=role==='ADMIN'&&
      Number(route.isPresentation)===1&&
      route.id==='PL-ROUTE-48de0000-0000-4000-8000-000000000003'&&
      route.routeNumber==='48PL-03';
    const deleteDemoButton=showDemoDelete
      ?'<button type="button" class="pl-route-delete-single-button" '+
        'data-pl-route-delete-demo03="'+html(route.id)+'">Usuń demo 48PL-03</button>'
      :'';
    const exportButton='<button type="button" class="pl-route-export-button" '+
      'data-pl-route-export="'+html(route.id)+'" '+
      'data-pl-route-export-number="'+html(route.routeNumber)+'">Eksportuj</button>';
    const audit=(result.audit||[]).map(event=>{
      routeAuditCache.set(event.id,event);
      return '<button type="button" class="pl-route-audit-event" '+
          'data-pl-route-audit="'+html(event.id)+'" '+
          'title="Otwórz szczegóły zapisanej operacji">'+
          '<span>'+html(event.action==='EXPLAIN'?'Weryfikacja':'Edycja')+
            ' · '+html(event.actor||'Użytkownik')+'</span>'+
          '<small>'+html(auditTime(event.createdAt))+'</small>'+
        '</button>';
    }).join('');
    // All three sections start on the exact table-heading line.
    // Audit history is to the RIGHT of the vertical button stack.
    return '<div class="pl-route-detail-layout">'+
      '<div class="pl-route-detail-head">'+
        '<strong>'+caption+html(route.routeNumber)+
          (Number(route.isPresentation)===1?' *':'')+'</strong>'+
        exportButton+
      '</div>'+
      warning+
      '<div class="pl-route-detail-content">'+
        '<div class="pl-route-detail-lines">'+
          '<table><thead><tr>'+cols+'</tr></thead><tbody>'+
            rows+'</tbody></table>'+
          (history?'':'<p class="pl-route-detail-note">„—” oznacza brak danych o potwierdzeniu lub zakończeniu, nie zero sztuk.</p>')+
        '</div>'+
        '<div class="pl-route-detail-side">'+
          '<div class="pl-route-detail-actions">'+photoButtons+editButton+explainButton+deleteDemoButton+'</div>'+
          (audit?'<div class="pl-route-audit-history">'+audit+'</div>':'')+
        '</div>'+
      '</div>'+
    '</div>';
  }
  let routeConfirmResolve=null;
  function finishRouteConfirmation(approved){
    const resolve=routeConfirmResolve;
    routeConfirmResolve=null;
    const dialog=byId('plRouteConfirmDialog');
    if(dialog.open)dialog.close();
    if(resolve)resolve(Boolean(approved));
  }
  function confirmRouteAction(message){
    if(routeConfirmResolve)return Promise.resolve(false);
    return new Promise(resolve=>{
      routeConfirmResolve=resolve;
      byId('plRouteConfirmMessage').textContent=message;
      try{
        byId('plRouteConfirmDialog').showModal();
        byId('plRouteConfirmCancel').focus();
      }catch{
        finishRouteConfirmation(false);
      }
    });
  }
  let explainSaving=false;
  async function openDiscrepancyExplanation(button){
    if(explainSaving||byId('plRouteExplainDialog').open)return;
    const id=button.dataset.plRouteExplain||'';
    if(!/^PL-ROUTE-[a-f0-9-]{36}$/.test(id))return;
    button.disabled=true;
    try{
      const result=await jsonResponse(await fetch(
        endpoint+'?id='+encodeURIComponent(id),{
          credentials:'same-origin',cache:'no-store'
        }
      ));
      const wrong=(result.lines||[]).filter(line=>
        line.confirmedQuantity!=null&&line.verifiedQuantity==null&&
        Number(line.confirmedQuantity)!==Number(line.quantity));
      if(!wrong.length||result.route?.status==='COMPLETED')
        throw Error('Ta trasa nie wymaga już wyjaśnienia niezgodności.');
      const dialog=byId('plRouteExplainDialog');
      byId('plRouteExplainForm').reset();
      byId('plRouteExplainError').hidden=true;
      byId('plRouteExplainLines').innerHTML=
        '<div class="pl-route-explain-head"><span>Część</span>'+
          '<span>Magazyn wpisał</span><span>Ekipa zgłosiła</span>'+
          '<span>Po weryfikacji</span></div>'+
        wrong.map(line=>
          '<div class="pl-route-explain-line" data-pl-route-explain-row="'+html(line.position)+'">'+
            '<strong>'+html(line.partName||line.partCode||'Poz. '+line.position)+'</strong>'+
            '<span>'+html(line.quantity)+'</span>'+
            '<span>'+html(line.confirmedQuantity)+'</span>'+
            '<input type="number" min="0" max="999999" step="1" required '+
              'data-pl-route-explain-quantity '+
              'aria-label="Ilość po weryfikacji: '+html(line.partName||line.partCode||line.position)+'" '+
              'value="'+html(line.confirmedQuantity)+'">'+
          '</div>'
        ).join('');
      dialog.dataset.routeId=id;
      dialog.dataset.revision=String(result.route.editRevision||0);
      dialog.showModal();
      byId('plRouteExplainComment').focus();
    }catch(error){
      const status=byId('plRoutesListStatus');
      status.classList.add('is-error');
      status.textContent=error.message||'Nie można otworzyć weryfikacji.';
    }finally{
      button.disabled=false;
    }
  }
  async function submitDiscrepancyExplanation(event){
    event.preventDefault();
    if(explainSaving)return;
    const form=byId('plRouteExplainForm');
    if(!form.reportValidity())return;
    const comment=byId('plRouteExplainComment').value.trim();
    const error=byId('plRouteExplainError');
    if(comment.length<15){
      error.hidden=false;
      error.textContent='Opisz wyjaśnienie niezgodności (minimum 15 znaków).';
      byId('plRouteExplainComment').focus();
      return;
    }
    const corrections=[...byId('plRouteExplainLines').querySelectorAll(
      '[data-pl-route-explain-row]'
    )].map(row=>{
      const field=row.querySelector('[data-pl-route-explain-quantity]');
      return {
        position:Number(row.dataset.plRouteExplainRow),
        quantity:field.value.trim()===''?NaN:Number(field.value)
      };
    });
    if(!corrections.length||corrections.some(row=>
      !Number.isSafeInteger(row.position)||row.position<1||
      !Number.isSafeInteger(row.quantity)||row.quantity<0||row.quantity>999999)){
      error.hidden=false;
      error.textContent='Wpisz prawidłową ilość po weryfikacji dla każdej części.';
      return;
    }
    if(!await confirmRouteAction(
      'Zatwierdzić ilości po weryfikacji i zapisać komentarz?'))return;
    explainSaving=true;
    byId('plRouteExplainSave').disabled=true;
    error.hidden=true;
    try{
      await jsonResponse(await fetch(endpoint,{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          action:'explainDiscrepancy',
          id:byId('plRouteExplainDialog').dataset.routeId,
          baseRevision:Number(byId('plRouteExplainDialog').dataset.revision),
          comment,corrections
        })
      }));
      byId('plRouteExplainDialog').close();
      await window.renderPlRoutesList();
      const status=byId('plRoutesListStatus');
      status.classList.remove('is-error');
      status.textContent='Weryfikacja i komentarz zapisane w historii trasy.';
    }catch(ex){
      error.hidden=false;
      error.textContent=ex.message||'Nie udało się zatwierdzić weryfikacji.';
    }finally{
      explainSaving=false;
      byId('plRouteExplainSave').disabled=false;
    }
  }
  function openRouteAudit(button){
    const entry=routeAuditCache.get(button.dataset.plRouteAudit||'');
    if(!entry)return;
    let details;
    try{details=JSON.parse(entry.detailsJson||'{}');}
    catch{details={};}
    const isExplain=entry.action==='EXPLAIN';
    byId('plRouteAuditTitle').textContent=isExplain?'Weryfikacja niezgodności':'Historia edycji trasy';
    let content='<p class="pl-route-audit-meta">'+html(entry.actor||'Użytkownik')+
      ' · '+html(auditTime(entry.createdAt))+'</p>';
    if(isExplain){
      content+='<h3>Komentarz</h3>'+
        '<p class="pl-route-audit-comment">'+html(details.comment||'Brak ogólnego komentarza (starszy zapis).')+'</p>'+
        '<h3>Zweryfikowane ilości</h3>'+
        '<div class="pl-route-audit-table-wrap"><table class="pl-route-audit-quantity-table">'+
        '<thead><tr><th>Część</th><th>Magazyn wpisał</th>'+
        '<th>Ekipa zgłosiła</th><th>Po weryfikacji</th></tr></thead><tbody>';
      for(const item of details.positions||[]){
        // Older audit events can have an unresolved difference. Do not
        // misrepresent an unverified quantity as the final actual count.
        const isNew=item.verified===true;
        const legacyMatched=item.decision==='MATCH_CREW'||
          (!item.decision&&item.after!=null&&Number(item.after)===Number(item.confirmed));
        const actual=isNew?item.after:(legacyMatched?item.confirmed:null);
        content+='<tr'+(actual!==null?' class="pl-route-audit-corrected"':'')+'>'+
          '<td>'+html(item.partName||'Pozycja '+item.position)+'</td>'+
          '<td>'+html(item.before)+'</td>'+
          '<td>'+html(item.confirmed)+'</td>'+
          '<td>'+html(actual===null?'—':actual)+'</td></tr>';
      }
      content+='</tbody></table></div>';
      const olderNotes=(details.positions||[]).filter(item=>item.note);
      if(olderNotes.length){
        content+='<p class="pl-route-audit-help">Wcześniejsze uwagi do pozycji: '+
          olderNotes.map(item=>html(item.partName||'Poz. '+item.position)+
            ' — '+html(item.note)).join(' · ')+'</p>';
      }
    }else{
      const prev=details.before||{},next=details.after||{};
      const changed=[];
      const addChange=(name,before,after)=>{
        if(String(before??'')!==String(after??''))
          changed.push({name,before:before??'—',after:after??'—'});
      };
      for(const [name,key] of [
        ['Numer trasy','routeNumber'],['Data','routeDate'],['Symbol ekipy','crewSymbol']
      ])addChange(name,prev[key],next[key]);
      if(prev.status!==undefined&&next.status!==undefined){
        const friendlyStatus=status=>({
          COMPLETED:'Trasa zakończona',CONFIRMED:'Potwierdzona',
          AWAITING_CONFIRMATION:'Oczekuje na potwierdzenie',
          REVIEW_REQUIRED:'Do weryfikacji – niezgodność'
        }[status]||status);
        addChange('Status trasy',friendlyStatus(prev.status),friendlyStatus(next.status));
      }
      const beforeLines=prev.lines||[],afterLines=next.lines||[];
      for(let index=0;index<Math.max(beforeLines.length,afterLines.length);index++){
        const original=beforeLines[index],updated=afterLines[index];
        const position=index+1;
        if(!original&&updated){
          changed.push({name:'Dodano: '+(updated.partName||updated.partCode||'Część')+
            ' (poz. '+position+')',before:'—',after:updated.quantity+' szt.'});
          continue;
        }
        if(original&&!updated){
          changed.push({name:'Usunięto: '+(original.partName||original.partCode||'Część')+
            ' (poz. '+position+')',before:original.quantity+' szt.',after:'—'});
          continue;
        }
        if(!original||!updated)continue;
        const partLabel=updated.partName||original.partName||updated.partCode||
          original.partCode||'Pozycja '+position;
        addChange('Nazwa części (poz. '+position+')',original.partName,updated.partName);
        addChange('Indeks – '+partLabel,original.partCode,updated.partCode);
        addChange(partLabel,original.quantity,updated.quantity);
        if(original.confirmedQuantity!==undefined||updated.confirmedQuantity!==undefined)
          addChange('Potwierdzenie ekipy – '+partLabel,
            original.confirmedQuantity,updated.confirmedQuantity);
        if(original.returnedQuantity!==undefined||updated.returnedQuantity!==undefined)
          addChange('Zwrot – '+partLabel,original.returnedQuantity,updated.returnedQuantity);
        if(original.returnLocation!==undefined||updated.returnLocation!==undefined)
          addChange('Miejsce zwrotu – '+partLabel,
            original.returnLocation||'—',updated.returnLocation||'—');
      }
      content+='<h3>Zmienione dane</h3>';
      if(changed.length){
        content+='<div class="pl-route-audit-table-wrap">'+
          '<table class="pl-route-audit-quantity-table pl-route-audit-edit-table">'+
          '<thead><tr><th>Zmieniona pozycja</th><th>Przed edycją</th>'+
          '<th>Po edycji</th></tr></thead><tbody>'+
          changed.map(item=>'<tr>'+
            '<td>'+html(item.name)+'</td>'+
            '<td>'+html(item.before)+'</td>'+
            '<td>'+html(item.after)+'</td>'+
          '</tr>').join('')+'</tbody></table></div>';
      }else{
        content+='<p class="pl-route-audit-empty">Zapisano bez zmian.</p>';
      }
    }
    byId('plRouteAuditContent').innerHTML=content;
    const dialog=byId('plRouteAuditDialog');
    if(dialog.open)dialog.close();
    dialog.showModal();
  }
  let viewedDocumentUrl=null;
  let photoLoadId=0;
  function resetRouteDocumentViewer(){
    ++photoLoadId;
    const image=byId('plRouteDocumentImage');
    image.hidden=true;
    image.removeAttribute('src');
    if(viewedDocumentUrl){
      URL.revokeObjectURL(viewedDocumentUrl);
      viewedDocumentUrl=null;
    }
    const status=byId('plRouteDocumentStatus');
    status.hidden=false;
    status.textContent='';
  }
  async function showRouteDocument(button){
    const routeId=button.dataset.plRouteDocumentRoute||'';
    const documentId=button.dataset.plRouteDocument||'';
    if(!/^PL-ROUTE-[a-f0-9-]{36}$/.test(routeId)||
       !/^PL-DOC-[a-f0-9-]{36}$/.test(documentId))return;
    const dialog=byId('plRouteDocumentDialog');
    if(dialog.open)dialog.close();
    resetRouteDocumentViewer();
    const seq=photoLoadId;
    byId('plRouteDocumentTitle').textContent=button.textContent.trim();
    const status=byId('plRouteDocumentStatus');
    status.hidden=false;
    status.textContent='Otwieranie zapisanego zdjęcia…';
    dialog.showModal();
    try{
      const response=await fetch('/api/pl-routes-photo?routeId='+
        encodeURIComponent(routeId)+'&documentId='+encodeURIComponent(documentId),{
          credentials:'same-origin',cache:'no-store'
        });
      if(!response.ok)throw Error('Nie udało się otworzyć zdjęcia dokumentu.');
      const type=(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
      if(type!=='image/jpeg')throw Error('Serwer nie zwrócił zdjęcia JPEG.');
      const blob=await response.blob();
      if(blob.size===0||blob.size>4*1024*1024)
        throw Error('Zdjęcie ma nieprawidłowy rozmiar.');
      if(seq!==photoLoadId||!dialog.open)return;
      viewedDocumentUrl=URL.createObjectURL(blob);
      const image=byId('plRouteDocumentImage');
      image.onload=()=>{
        if(seq!==photoLoadId||!dialog.open)return;
        image.hidden=false;
        status.hidden=true;
      };
      image.onerror=()=>{
        if(seq!==photoLoadId||!dialog.open)return;
        image.hidden=true;
        status.hidden=false;
        status.textContent='Nie można wyświetlić zdjęcia dokumentu.';
      };
      image.src=viewedDocumentUrl;
    }catch(error){
      if(seq!==photoLoadId||!dialog.open)return;
      status.hidden=false;
      status.textContent=error.message||'Nie udało się pobrać zdjęcia.';
    }
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
  async function seedDemoWeek48(){
    if(busy||routeContext()?.role!=='ADMIN')return;
    if(!window.confirm(
      'Dodać brakujące przykładowe trasy z tygodnia 48? '+
      'Już zapisane trasy pozostaną bez zmian; nowe będą oznaczone gwiazdką (*).'
    ))return;
    const button=byId('plRoutesSeedDemo48');
    const status=byId('plRoutesListStatus');
    button.disabled=true;
    try{
      const result=await jsonResponse(await fetch(endpoint,{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'seedDemoWeek48',confirm:'DODAJ DEMO 48'})
      }));
      await window.renderPlRoutesList();
      status.classList.remove('is-error');
      status.textContent='Wstawiono '+Number(result.added||0)+
        ' tras demo (tydzień 48). '+
        (Number(result.alreadyPresent||0)
          ?'Wcześniej istniało '+Number(result.alreadyPresent)+' — nie powielono ich.':'');
    }catch(error){
      status.classList.add('is-error');
      status.textContent=error.message||'Nie udało się załadować tras demo.';
    }finally{
      button.disabled=false;
    }
  }
  let deletingDemo03=false;
  function openDeleteDemo03(button){
    if(deletingDemo03||routeContext()?.role!=='ADMIN')return;
    const id=button.dataset.plRouteDeleteDemo03;
    if(id!=='PL-ROUTE-48de0000-0000-4000-8000-000000000003')return;
    const dialog=byId('plRouteDeleteDemo03Dialog');
    if(dialog.open)return;
    byId('plRouteDeleteDemo03Form').reset();
    byId('plRouteDeleteDemo03Error').hidden=true;
    dialog.showModal();
    byId('plRouteDeleteDemo03Pin').focus();
  }
  async function submitDeleteDemo03(event){
    event.preventDefault();
    if(deletingDemo03||routeContext()?.role!=='ADMIN')return;
    const form=byId('plRouteDeleteDemo03Form');
    if(!form.reportValidity())return;
    deletingDemo03=true;
    const btn=byId('plRouteDeleteDemo03Save');
    const err=byId('plRouteDeleteDemo03Error');
    btn.disabled=true;
    err.hidden=true;
    try{
      const result=await jsonResponse(await fetch(endpoint,{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          action:'deleteDemo48PL03',confirm:'USUŃ 48PL-03',
          pin:byId('plRouteDeleteDemo03Pin').value
        })
      }));
      byId('plRouteDeleteDemo03Dialog').close();
      await window.renderPlRoutesList();
      const status=byId('plRoutesListStatus');
      status.classList.remove('is-error');
      status.textContent=Number(result.deleted)>0
        ?'Usunięto tylko trasę demo 48PL-03 i jej historię weryfikacji.'
        :'Trasa 48PL-03 była już usunięta.';
    }catch(error){
      err.hidden=false;
      err.textContent=error.message||'Nie udało się usunąć trasy.';
    }finally{
      deletingDemo03=false;
      btn.disabled=false;
      byId('plRouteDeleteDemo03Pin').value='';
    }
  }
  async function deleteDemoWeek48(){
    if(busy||routeContext()?.role!=='ADMIN')return;
    if(!window.confirm(
      'Usunąć TYLKO trasy demo tygodnia 48 i ich przykładowe ilości? '+
      'Pozostałe trasy (w tym wcześniejsze prezentacyjne) pozostaną bez zmian.'
    ))return;
    const pin=window.prompt('Potwierdź usunięcie PIN-em administratora:');
    if(pin===null)return;
    const status=byId('plRoutesListStatus');
    if(!/^[0-9]{4}$/.test(pin)){
      status.classList.add('is-error');
      status.textContent='Wpisz 4-cyfrowy PIN administratora.';
      return;
    }
    const button=byId('plRoutesDeleteDemo48');
    button.disabled=true;
    try{
      const result=await jsonResponse(await fetch(endpoint,{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'deleteDemoWeek48',confirm:'USUŃ DEMO 48',pin})
      }));
      await window.renderPlRoutesList();
      status.classList.remove('is-error');
      status.textContent='Usunięto '+Number(result.deleted||0)+
        ' tras demo z tygodnia 48. Pozostałe trasy zachowano.';
    }catch(error){
      status.classList.add('is-error');
      status.textContent=error.message||'Nie udało się usunąć tras demo 48.';
    }finally{
      button.disabled=false;
    }
  }
  byId('plRouteDeleteDemo03Form').addEventListener('submit',submitDeleteDemo03);
  byId('plRouteDeleteDemo03Close').addEventListener('click',()=>{
    if(!deletingDemo03)byId('plRouteDeleteDemo03Dialog').close();
  });
  byId('plRouteDeleteDemo03Cancel').addEventListener('click',()=>{
    if(!deletingDemo03)byId('plRouteDeleteDemo03Dialog').close();
  });
  byId('plRouteDeleteDemo03Dialog').addEventListener('cancel',event=>{
    if(deletingDemo03)event.preventDefault();
  });
  async function completeDemoWeek45(){
    if(busy||routeContext()?.role!=='ADMIN'||routeContext()?.tab!=='history')return;
    if(!window.confirm(
      'Rozliczyć TYLKO trasy pokazowe 02HH i 02HP z tygodnia 45? '+
      '02HH: bez zwrotów. 02HP: 5 słupków → InPost, 2 kotwy → Magazyn Tychy. '+
      'Stany magazynowe nie zostaną zmienione.'
    ))return;
    const pin=window.prompt('Wpisz 4-cyfrowy PIN administratora:');
    if(pin===null)return;
    const status=byId('plRoutesListStatus');
    if(!/^\d{4}$/.test(pin)){
      status.classList.add('is-error');
      status.textContent='Wpisz poprawny PIN administratora.';
      return;
    }
    const button=byId('plRoutesCompleteDemo45');
    button.disabled=true;
    try{
      const result=await jsonResponse(await fetch(endpoint,{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'completeDemoWeek45',
          confirm:'ROZLICZ DEMO 45',pin})
      }));
      await window.renderPlRoutesList();
      status.classList.remove('is-error');
      status.textContent=Number(result.updated)>0
        ?'Rozliczono '+Number(result.updated)+' trasy pokazowe tygodnia 45. '+
          'Zwroty zapisano według lokalizacji (InPost / Magazyn Tychy).'
        :'Obie trasy pokazowe są już rozliczone.';
    }catch(error){
      status.classList.add('is-error');
      status.textContent=error.message||'Nie udało się rozliczyć tras demo.';
    }finally{
      button.disabled=false;
    }
  }
  byId('plRoutesCompleteDemo45').addEventListener('click',completeDemoWeek45);
  byId('plRoutesSeedDemo48').addEventListener('click',seedDemoWeek48);
  byId('plRoutesDeleteDemo48').addEventListener('click',deleteDemoWeek48);


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
  byId('plRouteConfirmApprove').addEventListener('click',()=>finishRouteConfirmation(true));
  byId('plRouteConfirmCancel').addEventListener('click',()=>finishRouteConfirmation(false));
  byId('plRouteConfirmDialog').addEventListener('close',()=>finishRouteConfirmation(false));
  byId('plRouteExplainForm').addEventListener('submit',submitDiscrepancyExplanation);
  byId('plRouteExplainClose').addEventListener('click',()=>{
    if(!explainSaving)byId('plRouteExplainDialog').close();
  });
  byId('plRouteExplainCancel').addEventListener('click',()=>{
    if(!explainSaving)byId('plRouteExplainDialog').close();
  });
  byId('plRouteExplainDialog').addEventListener('cancel',event=>{
    if(explainSaving)event.preventDefault();
  });
  byId('plRouteAuditClose').addEventListener('click',()=>byId('plRouteAuditDialog').close());
  byId('plRouteDocumentClose').addEventListener('click',()=>
    byId('plRouteDocumentDialog').close());
  byId('plRouteDocumentDialog').addEventListener('close',()=>{
    // A pending close event must not clear a new preview opened immediately.
    if(!byId('plRouteDocumentDialog').open)resetRouteDocumentViewer();
  });
  byId('plRouteDocumentDialog').addEventListener('click',event=>{
    if(event.target===byId('plRouteDocumentDialog'))
      byId('plRouteDocumentDialog').close();
  });
  let routeExportBusy=false;
  let routePreviewReady=false;
  const routeExportDialog=byId('plRouteExportDialog');
  const routePreview=byId('plRouteExportPreview');
  function setRoutePreviewReady(ready){
    routePreviewReady=ready;
    byId('plRouteExportLoading').hidden=ready;
    for(const id of ['plRouteExportPdf','plRouteExportExcel','plRouteExportPrint'])
      byId(id).disabled=!ready||routeExportBusy;
  }
  function openRouteExport(button){
    if(routeExportBusy||routeExportDialog.open)return;
    const id=String(button.dataset.plRouteExport||'');
    if(!/^PL-ROUTE-[a-f0-9-]{36}$/.test(id))return;
    routeExportDialog.dataset.routeId=id;
    byId('plRouteExportTitle').textContent='Karta trasy – '+
      (button.dataset.plRouteExportNumber||'trasa');
    const error=byId('plRouteExportError');
    error.hidden=true;
    error.textContent='';
    setRoutePreviewReady(false);
    routeExportDialog.showModal();
    routePreview.src='/office/pl-routes-print.html?id='+
      encodeURIComponent(id)+'&embed=1';
  }
  function closeRouteExport(){
    if(routeExportBusy)return;
    routeExportDialog.close();
    routePreview.src='about:blank';
    setRoutePreviewReady(false);
  }
  byId('plRouteExportClose').addEventListener('click',closeRouteExport);
  routeExportDialog.addEventListener('cancel',event=>{
    if(routeExportBusy)event.preventDefault();
  });
  routeExportDialog.addEventListener('close',()=>{
    routePreview.src='about:blank';
    routePreviewReady=false;
  });
  window.addEventListener('message',event=>{
    if(event.origin!==window.location.origin||
       event.source!==routePreview.contentWindow||
       !routeExportDialog.open||
       !event.data||event.data.routeId!==routeExportDialog.dataset.routeId)
      return;
    if(event.data.type==='gpbs-route-export-preview-ready'){
      setRoutePreviewReady(true);
    }else if(event.data.type==='gpbs-route-export-preview-error'){
      byId('plRouteExportLoading').hidden=true;
      const error=byId('plRouteExportError');
      error.textContent='Nie udało się przygotować podglądu tej trasy.';
      error.hidden=false;
    }
  });
  function printRoutePreview(){
    if(!routePreviewReady||!routeExportDialog.open)return;
    // Same A4 document for Print and PDF. In the print dialog the user
    // selects the printer or the "Save as PDF" destination.
    const frame=routePreview.contentWindow;
    if(!frame)return;
    frame.focus();
    frame.print();
  }
  byId('plRouteExportPdf').addEventListener('click',printRoutePreview);
  byId('plRouteExportPrint').addEventListener('click',printRoutePreview);
  byId('plRouteExportExcel').addEventListener('click',async()=>{
    if(routeExportBusy||!routePreviewReady)return;
    const id=routeExportDialog.dataset.routeId;
    if(!/^PL-ROUTE-[a-f0-9-]{36}$/.test(String(id||'')))return;
    const error=byId('plRouteExportError');
    routeExportBusy=true;
    setRoutePreviewReady(true);
    error.hidden=true;
    try{
      if(!window.PlRouteExport)throw Error('Moduł Excel nie został załadowany.');
      const data=await window.PlRouteExport.getRoute(id);
      window.PlRouteExport.saveXlsx([data],'GPBS-Trasa-'+
        (data.route.routeNumber||'Raport'));
    }catch(ex){
      error.textContent=ex.message||'Nie udało się zapisać pliku Excel.';
      error.hidden=false;
    }finally{
      routeExportBusy=false;
      setRoutePreviewReady(routePreviewReady);
    }
  });
  byId('plRoutesTable').addEventListener('click',e=>{
    const exportButton=e.target.closest('[data-pl-route-export]');
    if(exportButton){openRouteExport(exportButton);return;}
    const deleteButton=e.target.closest('[data-pl-route-delete-demo03]');
    if(deleteButton){openDeleteDemo03(deleteButton);return;}
    const auditButton=e.target.closest('[data-pl-route-audit]');
    if(auditButton){openRouteAudit(auditButton);return;}
    const explainButton=e.target.closest('[data-pl-route-explain]');
    if(explainButton){openDiscrepancyExplanation(explainButton);return;}
    const editButton=e.target.closest('[data-pl-route-edit]');
    if(editButton){
      editRoute(editButton);
      return;
    }
    const photoButton=e.target.closest('[data-pl-route-document]');
    if(photoButton){
      showRouteDocument(photoButton);
      return;
    }
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
