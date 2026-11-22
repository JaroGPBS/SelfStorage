// GPBS Storage — photo on the left, editable WZ interpretation on the right.
// Only the coordinator's verified result can be handed to the existing route form.
(()=>{
'use strict';
const clean=(v,n=500)=>String(v??'').slice(0,n);
const esc=v=>clean(v,2000).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=v=>clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[łŁ]/g,'l').replace(/[^a-z0-9]+/gi,'').toLowerCase();
const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&
  !Number.isNaN(new Date(d+'T00:00:00Z').getTime());
const fromDate=d=>/^\d{2}\.\d{2}\.\d{4}$/.test(d)?
  d.slice(6)+'-'+d.slice(3,5)+'-'+d.slice(0,2):d;
let dlg=null,resolveReview=null,previewUrl='',zoom=1,panX=0,panY=0,drag=null;
function ensure(){
  if(dlg)return dlg;
  dlg=document.createElement('dialog');
  dlg.id='plRouteAiDialog';
  dlg.className='pl-route-ai-dialog';
  dlg.setAttribute('aria-labelledby','plRouteAiTitle');
  dlg.innerHTML=
    '<div class="pl-route-ai-head"><div><small>GPBS STORAGE / POLSKA / TRASY</small>'+
    '<h2 id="plRouteAiTitle">Weryfikacja odczytu WZ</h2></div>'+
    '<button type="button" data-ai-action="close" aria-label="Zamknij">×</button></div>'+
    '<div class="pl-route-ai-warning">ZWERYFIKUJ ZGODNOŚĆ WSZYSTKICH DANYCH ZE ZDJĘCIEM. AI MOŻE POMYLIĆ NUMERY I ILOŚCI.</div>'+
    '<div class="pl-route-ai-columns">'+
    '<div class="pl-route-ai-photo"><div class="pl-route-ai-photo-tools">'+
    '<strong>Oryginalne zdjęcie WZ</strong>'+
    '<button type="button" data-ai-action="minus" aria-label="Pomniejsz">−</button>'+
    '<button type="button" data-ai-action="plus" aria-label="Powiększ">+</button>'+
    '<button type="button" data-ai-action="reset">Reset</button></div>'+
    '<div class="pl-route-ai-photo-canvas" id="plRouteAiCanvas"><img id="plRouteAiImage" alt="Zdjęcie WZ do porównania"></div>'+
    '<small>Powiększ kółkiem myszy lub przyciskami. Przeciągnij zdjęcie, aby je przesunąć.</small></div>'+
    '<div class="pl-route-ai-editor" id="plRouteAiEditor">'+
    '<p id="plRouteAiStatus" role="status" class="pl-route-ai-status">Trwa odczytywanie dokumentu<span class="pl-route-ai-dots">...</span></p>'+
    '<div id="plRouteAiFields" hidden></div>'+
    '<div id="plRouteAiError" role="alert" class="pl-route-ai-error" hidden></div>'+
    '</div></div>'+
    '<div class="pl-route-ai-footer">'+
    '<label><input type="checkbox" id="plRouteAiVerified" disabled> Porównałem dane ze zdjęciem i poprawiłem błędy</label>'+
    '<button type="button" data-ai-action="close" class="btn outline">Anuluj</button>'+
    '<button type="button" id="plRouteAiApply" data-ai-action="apply" class="btn dark" disabled>Zatwierdź i zapisz trasę</button></div>';
  document.body.append(dlg);
  dlg.addEventListener('cancel',e=>{e.preventDefault();finish(null);});
  dlg.addEventListener('close',()=>finish(null));
  dlg.addEventListener('click',event=>{
    const button=event.target.closest('[data-ai-action]');
    if(!button)return;
    const action=button.dataset.aiAction;
    if(action==='close')return finish(null);
    if(action==='plus')return moveZoom(zoom+.25);
    if(action==='minus')return moveZoom(zoom-.25);
    if(action==='reset'){panX=0;panY=0;return moveZoom(1);}
    if(action==='add-module'){
      document.getElementById('plRouteAiRows').insertAdjacentHTML('beforeend',moduleMarkup({
        lp:document.querySelectorAll('#plRouteAiRows .pl-ai-module').length+1,
        module_type:'',parts:[],serial_numbers:[]
      }));
    }else if(action==='remove-module'){
      button.closest('.pl-ai-module')?.remove();
    }else if(action==='add-part'){
      button.closest('.pl-ai-module').querySelector('.pl-ai-parts')
        .insertAdjacentHTML('beforeend',partMarkup({name_raw:'',quantity:null}));
    }else if(action==='remove-part'){
      button.closest('.pl-ai-part')?.remove();
    }else if(action==='apply')apply();
  });
  dlg.querySelector('#plRouteAiVerified').addEventListener('change',event=>{
    dlg.querySelector('#plRouteAiApply').disabled=!event.target.checked;
  });
  const canvas=dlg.querySelector('#plRouteAiCanvas');
  canvas.addEventListener('wheel',event=>{
    event.preventDefault();moveZoom(zoom+(event.deltaY<0?.15:-.15));
  },{passive:false});
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    drag={x:event.clientX-panX,y:event.clientY-panY};
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove',event=>{
    if(!drag)return;
    panX=event.clientX-drag.x;panY=event.clientY-drag.y;transform();
  });
  canvas.addEventListener('pointerup',()=>drag=null);
  canvas.addEventListener('pointercancel',()=>drag=null);
  return dlg;
}
function transform(){
  if(dlg)dlg.querySelector('#plRouteAiImage').style.transform=
    'translate('+panX+'px,'+panY+'px) scale('+zoom+')';
}
function moveZoom(z){zoom=Math.min(5,Math.max(1,z));if(zoom===1){panX=0;panY=0;}transform();}
function finish(value){
  if(!resolveReview)return;
  const resolve=resolveReview;
  resolveReview=null;
  if(dlg?.open)dlg.close();
  if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl='';}
  resolve(value);
}
function partMarkup(part){
  return '<div class="pl-ai-part">'+
    '<label>Nazwa części<input data-ai-part-name maxlength="180" value="'+esc(part?.name_raw||'')+'" placeholder="Nazwa z dokumentu"></label>'+
    '<label>Ilość<input type="number" min="1" max="999999" step="1" data-ai-part-qty value="'+
    (Number.isSafeInteger(part?.quantity)&&part.quantity>0?part.quantity:'')+'" placeholder="Sprawdź"></label>'+
    '<button type="button" data-ai-action="remove-part" aria-label="Usuń część">×</button></div>';
}
function moduleMarkup(row){
  const parts=Array.isArray(row.parts)?row.parts:[];
  return '<section class="pl-ai-module">'+
    '<div class="pl-ai-module-head"><strong>Moduł / pozycja '+esc(row.lp||'')+'</strong>'+
    '<button type="button" data-ai-action="remove-module" class="pl-ai-small">Usuń moduł</button></div>'+
    '<div class="pl-ai-module-grid">'+
    '<label>Typ modułu<input data-ai-module-type maxlength="220" value="'+esc(row.module_type)+'"></label>'+
    '<label>Kod lokalizacji<input data-ai-location-code maxlength="80" value="'+esc(row.location_code)+'"></label>'+
    '<label>Adres / lokalizacja<input data-ai-location maxlength="350" value="'+esc(row.location)+'"></label>'+
    '<label>Operacja<input data-ai-operation maxlength="120" value="'+esc(row.operation)+'"></label>'+
    '<label class="pl-ai-span">Numery seryjne (oddzielone przecinkiem)<textarea rows="2" data-ai-serials>'+
    esc((row.serial_numbers||[]).join(', '))+'</textarea></label></div>'+
    '<div class="pl-ai-parts-heading"><strong>Części / akcesoria</strong><button type="button" data-ai-action="add-part" class="pl-ai-small">+ Część</button></div>'+
    '<div class="pl-ai-parts">'+parts.map(partMarkup).join('')+'</div>'+
    (row.uncertain_fragments?.length?'<small class="pl-ai-uncertain">Niepewne: '+
    esc(row.uncertain_fragments.join(' · '))+'</small>':'')+'</section>';
}
function render(doc,crew){
  const fields=dlg.querySelector('#plRouteAiFields');
  const date=fromDate(doc.document_date||'');
  fields.innerHTML=
    '<div class="pl-ai-general">'+
    '<label>Numer trasy<input id="plAiRouteNumber" maxlength="80" value="'+esc(doc.route_number)+'"></label>'+
    '<label>Data trasy<input id="plAiRouteDate" type="date" value="'+(validDate(date)?date:'')+'"></label>'+
    '<label>Symbol ekipy (wpisz ręcznie)<input id="plAiCrew" maxlength="20" value="'+esc(crew||'')+'" placeholder="Np. GW"></label>'+
    '<label>Wydający<input id="plAiIssuer" maxlength="80" value="'+esc(doc.issued_by)+'"></label>'+
    '<label>Nazwa magazynu<input id="plAiWarehouse" maxlength="180" value="'+esc(doc.warehouse)+'"></label>'+
    '<label>Tytuł dokumentu<input id="plAiTitle" maxlength="180" value="'+esc(doc.document_title)+'"></label></div>'+
    '<div class="pl-ai-parts-heading"><h3>Pozycje WZ</h3>'+
    '<button type="button" data-ai-action="add-module" class="pl-ai-small">+ Moduł</button></div>'+
    '<div id="plRouteAiRows">'+(doc.rows||[]).map(moduleMarkup).join('')+'</div>'+
    '<label class="pl-ai-notes">Uwagi / inne wydane elementy<textarea id="plAiNotes" rows="2">'+
    esc([doc.remarks,...(doc.extra_items||[]).map(x=>x.name_raw+
      (x.quantity==null?'':' ('+x.quantity+' szt.)'))].filter(Boolean).join('\n'))+'</textarea></label>'+
    (doc.warnings?.length?'<div class="pl-ai-alert"><strong>Niepewne odczyty AI:</strong><p>'+
      esc(doc.warnings.join(' · '))+'</p></div>':'');
  fields.hidden=false;
  dlg.querySelector('#plRouteAiVerified').disabled=false;
  dlg.querySelector('#plRouteAiStatus').textContent='Odczyt zakończony. Sprawdź wszystkie pola i popraw błędy.';
}
function apply(){
  const err=dlg.querySelector('#plRouteAiError');
  err.hidden=true;err.textContent='';
  const get=id=>dlg.querySelector('#'+id)?.value?.trim()||'';
  const routeNumber=get('plAiRouteNumber').toUpperCase();
  const routeDate=get('plAiRouteDate'),crewSymbol=get('plAiCrew').toUpperCase();
  if(!routeNumber||!validDate(routeDate)||!crewSymbol){
    err.textContent='Uzupełnij numer trasy, datę oraz symbol ekipy.';
    err.hidden=false;return;
  }
  const rows=[],flat=new Map();
  for(const [i,element] of [...dlg.querySelectorAll('#plRouteAiRows .pl-ai-module')].entries()){
    const parts=[];
    for(const p of element.querySelectorAll('.pl-ai-part')){
      const name=p.querySelector('[data-ai-part-name]').value.trim();
      const raw=p.querySelector('[data-ai-part-qty]').value.trim();
      if(!name&&!raw)continue;
      const quantity=Number(raw);
      if(!name||!raw||!Number.isSafeInteger(quantity)||quantity<1||quantity>999999){
        err.textContent='Sprawdź nazwę i ilość wszystkich części. Nie wolno domyślnie przyjmować jednej sztuki.';
        err.hidden=false;
        p.querySelector(!name?'[data-ai-part-name]':'[data-ai-part-qty]').focus();
        return;
      }
      parts.push({name_raw:name,quantity});
      const key=norm(name);
      if(flat.has(key))flat.get(key).quantity+=quantity;
      else flat.set(key,{partName:name,partCode:'',quantity});
    }
    rows.push({
      lp:i+1,module_type:element.querySelector('[data-ai-module-type]').value.trim(),
      location:element.querySelector('[data-ai-location]').value.trim(),
      location_code:element.querySelector('[data-ai-location-code]').value.trim(),
      operation:element.querySelector('[data-ai-operation]').value.trim(),
      serial_numbers:element.querySelector('[data-ai-serials]').value.split(/[,;\n]+/)
        .map(x=>x.trim()).filter(Boolean),parts
    });
  }
  if(!rows.length||!flat.size||flat.size>150){
    err.textContent='Trasa musi mieć moduły oraz od 1 do 150 różnych części.';
    err.hidden=false;return;
  }
  const wz={
    reviewed:true,document_title:get('plAiTitle'),warehouse:get('plAiWarehouse'),
    issued_by:get('plAiIssuer'),route_number:routeNumber,document_date:routeDate,
    rows,remarks:get('plAiNotes')
  };
  finish({routeNumber,routeDate,crewSymbol,lines:[...flat.values()],wz});
}
async function review(file,prepare,crewSymbol=''){
  ensure();
  if(resolveReview)return null;
  dlg.querySelector('#plRouteAiFields').hidden=true;
  dlg.querySelector('#plRouteAiFields').replaceChildren();
  dlg.querySelector('#plRouteAiStatus').textContent='Trwa odczytywanie dokumentu...';
  dlg.querySelector('#plRouteAiError').hidden=true;
  dlg.querySelector('#plRouteAiVerified').checked=false;
  dlg.querySelector('#plRouteAiVerified').disabled=true;
  dlg.querySelector('#plRouteAiApply').disabled=true;
  zoom=1;panX=0;panY=0;transform();
  previewUrl=URL.createObjectURL(file);
  dlg.querySelector('#plRouteAiImage').src=previewUrl;
  dlg.showModal();
  const promise=new Promise(resolve=>resolveReview=resolve);
  (async()=>{
    try{
      const image=await prepare();
      const body=new FormData();body.append('image',image);
      const response=await fetch('/api/pl-routes-ai',{
        method:'POST',credentials:'same-origin',body,cache:'no-store'
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok||result.ok!==true)throw Error(result.error||'Błąd odczytu AI.');
      if(!resolveReview)return;
      render(result.data,crewSymbol);
    }catch(error){
      if(!resolveReview)return;
      const status=dlg.querySelector('#plRouteAiStatus');
      status.textContent='Odczyt się nie powiódł. Możesz wrócić do ręcznego wpisania trasy.';
      const err=dlg.querySelector('#plRouteAiError');
      err.textContent=error.message||'Błąd połączenia z AI.';err.hidden=false;
    }
  })();
  return promise;
}
window.GPBSRouteAi={review};
})();