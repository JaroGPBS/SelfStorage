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
    row.innerHTML='<label class="pl-route-part-code">Indeks SAP / GPBS'+
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
  function openForm(){
    if(busy)return;
    const allowed=typeof state==='object'&&
      ['ADMIN','KIEROWNIK','KOORDYNATOR'].includes(state.user?.role);
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
    const crewNumber=byId('plRouteCrewNumber').value.trim();
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
    return {action:'create',routeNumber,routeDate,crewNumber,crewSymbol,lines};
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
  function listTable(routes){
    if(!routes.length)
      return '<div class="pl-routes-empty">Brak zapisanych tras. Kliknij „Dodaj trasę”, aby wprowadzić pierwszą.</div>';
    const header='<table><thead><tr>'+
      '<th>Numer trasy</th><th>Data</th><th>Symbol ekipy</th><th>Numer ekipy</th>'+
      '<th>Pozycje</th><th>Sztuki</th><th>Status</th><th></th>'+
      '</tr></thead><tbody>';
    const rows=routes.map(item=>
      '<tr><td><strong>'+html(item.routeNumber)+'</strong></td>'+
      '<td>'+html(item.routeDate)+'</td>'+
      '<td>'+html(item.crewSymbol)+'</td>'+
      '<td>'+html(item.crewNumber)+'</td>'+
      '<td>'+html(item.positions)+'</td>'+
      '<td>'+html(item.units)+'</td>'+
      '<td><span class="pl-route-status-badge">Oczekuje na potwierdzenie</span></td>'+
      '<td><button type="button" class="pl-route-details-button" data-pl-route-details="'+
       html(item.id)+'">Szczegóły</button></td></tr>'
    ).join('');
    return header+rows+'</tbody></table>';
  }
  window.renderPlRoutesList=async function(){
    const panel=byId('plRoutesListPanel');
    if(!panel)return;
    const selected=typeof state==='object'&&state.view==='plRoutes'&&
      state.plRoutesTab==='list';
    panel.classList.toggle('hidden',!selected);
    byId('officePlRoutesMessage').classList.toggle('hidden',selected);
    if(!selected)return;
    const role=state.user?.role;
    byId('plRouteAdd').classList.toggle('hidden',
      !['ADMIN','KIEROWNIK','KOORDYNATOR'].includes(role));
    const seq=++loadSeq;
    const status=byId('plRoutesListStatus');
    const table=byId('plRoutesTable');
    status.classList.remove('is-error');
    status.textContent='Pobieranie tras…';
    try{
      const result=await jsonResponse(await fetch(endpoint,{
        credentials:'same-origin',cache:'no-store'
      }));
      if(seq!==loadSeq)return;
      table.innerHTML=listTable(result.routes||[]);
      status.textContent='';
    }catch(e){
      if(seq!==loadSeq)return;
      table.replaceChildren();
      status.classList.add('is-error');
      status.textContent=e.message||'Nie udało się pobrać listy tras.';
    }
  };
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
      detail.innerHTML='<td colspan="8"><div class="pl-route-detail-lines">'+
        '<strong>Lista części dla trasy '+html(result.route.routeNumber)+'</strong>'+
        '<table><thead><tr><th>#</th><th>Indeks</th><th>Nazwa</th><th>Ilość</th></tr></thead><tbody>'+
        (result.lines||[]).map(line=>'<tr><td>'+html(line.position)+'</td>'+
          '<td>'+html(line.partCode||'—')+'</td>'+
          '<td>'+html(line.partName||'—')+'</td>'+
          '<td>'+html(line.quantity)+'</td></tr>').join('')+
        '</tbody></table></div></td>';
    }catch(e){
      if(detail.isConnected)detail.firstElementChild.textContent=
        e.message||'Nie udało się odczytać pozycji.';
    }
  }
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
    if(busy)event.preventDefault();
  });
  byId('plRouteDialog').addEventListener('close',()=>{
    clearPhoto();
    if(!busy)errorMessage();
  });
  byId('plRoutesTable').addEventListener('click',e=>{
    const button=e.target.closest('[data-pl-route-details]');
    if(button)showDetails(button);
  });
  if(typeof state==='object'&&state.view==='plRoutes')
    window.renderPlRoutesList();
})();
