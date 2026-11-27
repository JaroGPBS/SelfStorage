/* Belleville Office / Przewoźnicy. Shared D1 catalogue, no customer database. */
(()=>{
  'use strict';
  let entries=[];
  let loaded=false;
  let page=null;
  let generation=0;
  let active=()=>false;
  let onCount=()=>{};
  let busy=false;
  let selectionVersion=0;
  let selectedId='';
  let changedStamp=undefined;
  const $=id=>page?.querySelector('#'+id);
  async function request(method,payload){
    const response=await fetch('/api/cmr-belleville'+(method==='GET'?'?view=carriers':''),{
      method,credentials:'same-origin',cache:'no-store',
      ...(method==='POST'?{
        headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
      }:{})
    });
    const json=await response.json().catch(()=>({}));
    if(!response.ok||!json.ok)throw Error(json.error||'Nie udało się pobrać przewoźników.');
    return json;
  }
  async function list(force=false){
    if(!loaded||force){
      const data=await request('GET');
      entries=data.carriers||[];
      loaded=true;
    }
    return entries;
  }
  function notice(text,bad=false){
    const el=$('belCarrierStatus');
    if(!el)return;
    el.textContent=text||'';
    el.classList.toggle('is-error',bad);
  }
  function init(){
    if(page)return;
    page=document.createElement('section');
    page.className='bel-carrier-page';
    page.setAttribute('aria-label','Przewoźnicy Belleville');
    page.innerHTML=[
        '<div class="bel-carrier-content">',
          '<div class="bel-carrier-list">',
            '<button type="button" id="belCarrierNew" class="btn dark">+ Dodaj przewoźnika</button>',
            '<div id="belCarrierRows"></div>',
          '</div>',
          '<form id="belCarrierForm" class="bel-carrier-form">',
            '<h3 id="belCarrierDetailTitle">Dane przewoźnika</h3>',
            '<input type="hidden" id="belCarrierId">',
            '<label>Nazwa przewoźnika<input id="belCarrierName" maxlength="120" required autocomplete="off" placeholder="Np. BERNIHOL"></label>',
            '<label>Adres i dane przewoźnika<textarea id="belCarrierAddress" rows="4" maxlength="1600" placeholder="Adres firmy"></textarea></label>',
            '<label>Pieczątka PNG (opcjonalnie)<input type="file" id="belCarrierStamp" accept="image/png,.png"></label>',
            '<div class="bel-carrier-stamp-preview">',
              '<img id="belCarrierStampPreview" alt="Pieczątka przewoźnika" class="hidden">',
              '<span id="belCarrierStampNone">Brak pieczątki</span>',
              '<button type="button" id="belCarrierClearStamp" class="btn subtle">Usuń pieczątkę</button>',
            '</div>',
            '<p id="belCarrierStatus" role="status"></p>',
            '<div class="bel-carrier-form-actions">',
              '<button type="button" id="belCarrierDelete" class="btn subtle">Usuń przewoźnika</button>',
              '<button type="submit" id="belCarrierSave" class="btn dark">Zapisz</button>',
            '</div>',
          '</form>',
        '</div>'
    ].join('');
    $('belCarrierNew').addEventListener('click',()=>{if(!busy)select('',true);});
    $('belCarrierForm').addEventListener('submit',save);
    $('belCarrierDelete').addEventListener('click',remove);
    $('belCarrierClearStamp').addEventListener('click',()=>{
      if(busy)return;
      ++selectionVersion;changedStamp='';$('belCarrierStamp').value='';showStamp('');
    });
    $('belCarrierStamp').addEventListener('change',async ev=>{
      const file=ev.target.files?.[0];
      if(!file||busy)return;
      const version=++selectionVersion,token=generation;
      try{
        if(file.size>2*1024*1024||file.type!=='image/png')
          throw Error('Wybierz plik PNG, maksymalnie 2 MB.');
        const url=URL.createObjectURL(file);
        const img=new Image();
        try{
          await new Promise((resolve,reject)=>{
            img.onload=resolve;img.onerror=()=>reject(Error('Niepoprawny PNG.'));img.src=url;
          });
          const ratio=Math.min(1,700/img.naturalWidth,230/img.naturalHeight);
          const canvas=document.createElement('canvas');
          canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));
          canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
          const ctx=canvas.getContext('2d');if(!ctx)throw Error('Nie można wczytać PNG.');
          ctx.drawImage(img,0,0,canvas.width,canvas.height);
          const base64=canvas.toDataURL('image/png').split(',')[1];
          if(base64.length>240000)throw Error('Pieczątka jest zbyt duża. Zapisz ją jako mniejszy PNG.');
          if(token!==generation||version!==selectionVersion||!active())return;
          changedStamp=base64;
          showStamp(base64);
          notice('');
        }finally{URL.revokeObjectURL(url);}
      }catch(err){if(token===generation&&version===selectionVersion&&active())notice(err.message,true);}
    });
  }
  function showStamp(base64){
    const img=$('belCarrierStampPreview'),none=$('belCarrierStampNone');
    img.classList.toggle('hidden',!base64);
    none.classList.toggle('hidden',!!base64);
    if(base64)img.src='data:image/png;base64,'+base64;else img.removeAttribute('src');
  }
  function draw(){
    const box=$('belCarrierRows');box.replaceChildren();
    for(const item of entries){
      const btn=document.createElement('button');
      btn.className='bel-carrier-row'+(item.id===selectedId?' active':'');
      btn.type='button';btn.textContent=item.name;
      btn.disabled=busy;
      btn.setAttribute('aria-pressed',String(item.id===selectedId));
      btn.addEventListener('click',()=>{if(!busy)select(item.id);});
      box.append(btn);
    }
  }
  function select(id,focus=false){
    ++selectionVersion;
    selectedId=id;
    changedStamp=undefined;
    const selected=entries.find(x=>x.id===id);
    $('belCarrierDetailTitle').textContent=selected?'Dane przewoźnika: '+selected.name:'Nowy przewoźnik';
    $('belCarrierId').value=id;
    $('belCarrierName').value=selected?.name||'';
    $('belCarrierAddress').value=selected?.address||'';
    $('belCarrierStamp').value='';
    showStamp(selected?.stampBase64||'');
    $('belCarrierDelete').disabled=busy||!id;
    notice('');
    draw();
    onCount(entries.length);
    if(focus)$('belCarrierName').focus();
  }
  function setBusy(value){
    busy=value;
    for(const el of page.querySelectorAll('input,textarea,button'))el.disabled=value;
    if(!value)$('belCarrierDelete').disabled=!selectedId;
  }
  async function save(e){
    e.preventDefault();
    if(busy||!active())return;
    const token=generation;
    setBusy(true);notice('');
    try{
      const data=await request('POST',{
        action:'saveCarrier',id:$('belCarrierId').value,
        name:$('belCarrierName').value.trim(),address:$('belCarrierAddress').value.trim(),
        ...(changedStamp===undefined?{}:{stampBase64:changedStamp})
      });
      await list(true);
      if(token!==generation||!active())return;
      select(data.carrier.id);
      notice('Zapisano przewoźnika w D1.');
    }catch(err){if(token===generation&&active())notice(err.message,true);}
    finally{if(token===generation)setBusy(false);}
  }
  async function remove(){
    if(busy||!active())return;
    const token=generation;
    const item=entries.find(x=>x.id===selectedId);
    if(!item||!window.confirm('Usunąć przewoźnika '+item.name+'?'))return;
    setBusy(true);
    try{
      await request('POST',{action:'deleteCarrier',id:item.id});
      await list(true);
      if(token!==generation||!active())return;
      select(entries[0]?.id||'');notice('Usunięto przewoźnika.');
    }catch(err){if(token===generation&&active())notice(err.message,true);}
    finally{if(token===generation)setBusy(false);}
  }
  async function openManager(host,isActive,count){
    init();
    const token=++generation;
    active=isActive;
    onCount=count;
    host.replaceChildren(page);
    setBusy(true);
    $('belCarrierRows').replaceChildren();
    $('belCarrierName').value='';$('belCarrierAddress').value='';
    $('belCarrierStamp').value='';showStamp('');
    $('belCarrierDetailTitle').textContent='Dane przewoźnika';
    notice('Wczytywanie...');
    try{
      await list(true);
      if(token!==generation||!active())return;
      select(entries.some(x=>x.id===selectedId)?selectedId:(entries[0]?.id||''));
      setBusy(false);
    }catch(err){
      if(token===generation&&active())notice(err.message,true);
    }
  }
  function reset(){
    ++generation;++selectionVersion;active=()=>false;onCount=()=>{};
    entries=[];loaded=false;selectedId='';changedStamp=undefined;
    if(page){page.remove();page=null;}
    busy=false;
  }
  window.GPBSBellevilleCmrCarriers={list,openManager,reset,get:()=>entries};
})();