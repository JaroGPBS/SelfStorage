// GPBS Storage Poland — one-click A4 portrait, exactly two labels per sheet.
// Print attempts are recorded after the native browser print dialog closes.
(()=>{'use strict';
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  const model={warehouse:'',warehouses:[],parts:[],queue:new Map(),search:'',
    pending:null,printing:null,busy:false,request:0};
  const maxCopies=50;
  function notice(value='',error=false){
    const node=$('labelNotice');
    node.textContent=value;
    node.classList.toggle('hidden',!value);
    node.classList.toggle('label-error',error);
  }
  function friendlyDate(raw){
    if(!raw)return '—';
    const date=new Date(String(raw).replace(' ','T'));
    return Number.isNaN(date.valueOf())?'—':
      new Intl.DateTimeFormat('pl-PL',{timeZone:'Europe/Warsaw',
        day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(date);
  }
  function plural(value,one,few,many){
    if(value===1)return one;
    const tens=value%100,ones=value%10;
    return ones>=2&&ones<=4&&(tens<12||tens>14)?few:many;
  }
  function entries(){return model.parts.filter(p=>model.queue.has(p.id));}
  function updateWarehouseSelect(){
    const select=$('labelWarehouse');
    select.replaceChildren();
    for(const w of model.warehouses){
      const option=document.createElement('option');
      option.value=w.id;
      option.textContent=w.name;
      select.add(option);
    }
    select.value=model.warehouse;
  }
  function renderRows(){
    const query=model.search.trim().toLocaleLowerCase('pl');
    const filtered=model.parts.filter(p=>!query||
      [p.name,p.part_number,p.sap_number].some(x=>
        String(x||'').toLocaleLowerCase('pl').includes(query)));
    $('labelList').innerHTML=filtered.length?'<table class="table label-list-table">'+
      '<thead><tr><th>Nazwa części</th><th>Indeks GPBS</th>'+
      '<th>Ostatni wydruk</th><th>Do wydruku</th></tr></thead><tbody>'+
      filtered.map(p=>{
        const chosen=model.queue.get(p.id);
        const disabled=!/^MG-[0-9]{3}-[0-9]{3}$/.test(p.part_number);
        return '<tr class="'+(chosen?'label-selected-row':'')+'">'+
          '<td><strong>'+esc(p.name)+'</strong></td>'+
          '<td class="mono">'+esc(p.part_number)+'</td>'+
          '<td class="label-print-date">'+
            (p.last_print_at?'<span class="label-printed">✓ '+friendlyDate(p.last_print_at)+'</span>':
              '<span class="label-never-printed">— Nie drukowano</span>')+'</td>'+
          '<td class="label-action-cell">'+
            (disabled?'<span class="label-unavailable">Brak nowego indeksu</span>':
            '<button type="button" class="btn '+(chosen?'label-remove':'label-add')+'" '+
            'data-label-toggle="'+esc(p.id)+'">'+(chosen?'✓ Dodano':'Dodaj +')+'</button>')+
          '</td></tr>';
      }).join('')+'</tbody></table>':
      '<div class="empty">Nie znaleziono części.</div>';
    $('labelListFooter').textContent='Wyświetlono '+filtered.length+' z '+model.parts.length+' części';
  }
  function renderQueue(){
    const list=entries();
    const total=list.reduce((sum,p)=>sum+(model.queue.get(p.id)||0),0);
    $('labelQueueCount').textContent=total+' '+plural(total,'etykieta','etykiety','etykiet');
    const sheets=Math.ceil(total/2);
    $('labelSheetCount').textContent=sheets+' '+plural(sheets,'kartka','kartki','kartek')+' A4';
    $('labelPrintNow').disabled=!total||model.busy;
    $('labelQueueList').innerHTML=list.length?list.map(p=>
      '<div class="label-queue-row"><div class="label-queue-name"><strong>'+esc(p.name)+'</strong>'+
      '<small>'+esc(p.part_number)+'</small></div>'+
      '<div class="label-copy-controls">'+
      '<button type="button" data-label-minus="'+esc(p.id)+'" aria-label="Zmniejsz liczbę kopii '+esc(p.name)+'">−</button>'+
      '<strong>'+model.queue.get(p.id)+'</strong>'+
      '<button type="button" data-label-plus="'+esc(p.id)+'" aria-label="Zwiększ liczbę kopii '+esc(p.name)+'">+</button>'+
      '</div><button type="button" class="label-queue-remove" data-label-toggle="'+esc(p.id)+'" aria-label="Usuń '+esc(p.name)+'">×</button></div>'
    ).join(''):'<p class="label-queue-empty">Wybierz części z listy po lewej.</p>';
  }
  function show(){renderRows();renderQueue();}
  function togglePart(id){
    const part=model.parts.find(p=>p.id===id);
    if(!part)return;
    if(model.queue.has(id))model.queue.delete(id);
    else if(/^MG-[0-9]{3}-[0-9]{3}$/.test(part.part_number))model.queue.set(id,1);
    notice();show();
  }
  async function load(){
    const warehouse=model.warehouse;
    if(!warehouse){notice('Wybierz magazyn.',true);return;}
    const request=++model.request;
    $('labelList').innerHTML='<div class="loading">Wczytywanie części…</div>';
    notice();
    try{
      const url='/api/office-labels?warehouse='+encodeURIComponent(warehouse);
      const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
      const json=await response.json().catch(()=>({}));
      if(!response.ok||!json.ok)throw Error(json.error||'Nie można pobrać listy części.');
      if(request!==model.request||model.warehouse!==warehouse)return;
      model.parts=json.parts||[];
      for(const id of model.queue.keys())if(!model.parts.some(p=>p.id===id))model.queue.delete(id);
      if(model.pending){
        const item=model.parts.find(p=>p.id===model.pending.id);
        if(item&&!model.queue.has(item.id)&&/^MG-[0-9]{3}-[0-9]{3}$/.test(item.part_number))
          model.queue.set(item.id,1);
        model.pending=null;
      }
      show();
    }catch(error){
      if(request!==model.request)return;
      $('labelList').innerHTML='<div class="empty">Nie można wczytać listy etykiet.</div>';
      notice(error.message,true);
    }
  }
  function render(warehouses,preferred){
    model.warehouses=(warehouses||[]).filter(w=>w.id);
    const allowed=model.warehouses.some(w=>w.id===model.warehouse);
    if(!allowed){
      model.warehouse=model.warehouses.find(w=>w.id===preferred)?.id||
        model.warehouses[0]?.id||'';
      model.queue.clear();
    }
    updateWarehouseSelect();
    $('labelSearch').value=model.search;
    return load();
  }
  function enqueue(part,warehouseId){
    if(model.warehouse&&model.warehouse!==warehouseId){model.queue.clear();model.warehouse=warehouseId;}
    model.pending={id:part.id};
  }
  function photoMarkup(part,warehouse){
    if(part.has_photo){
      return '<img class="label-part-photo" alt="'+esc(part.name)+
        '" src="/api/office?view=partPhoto&warehouse='+encodeURIComponent(warehouse)+
        '&part='+encodeURIComponent(part.id)+'">';
    }
    return '<div class="label-photo-placeholder">ZDJĘCIE CZĘŚCI<br><small>Brak fotografii</small></div>';
  }
  function itemMarkup(part,warehouse){
    const nameLength=String(part.name||'').length;
    const size=nameLength>90?'label-name-very-long':nameLength>56?'label-name-long':nameLength>37?'label-name-medium':'';
    return '<article class="a5-part-label">'+
      '<div class="a5-label-content">'+
      '<div class="a5-label-heading"><small>NAZWA CZĘŚCI</small>'+
        '<h2 class="'+size+'">'+esc(part.name)+'</h2></div>'+
      '<div class="a5-label-main">'+
        '<div class="a5-qr-column">'+
          '<div class="a5-qr" data-qr="'+esc(part.part_number)+'"></div>'+
          '<img class="a5-brand" src="/office/gpbs-logo-print.svg?v=1" alt="GPBS"></div>'+
        '<div class="a5-information-column"><small>INDEKS GPBS</small>'+
          '<strong>'+esc(part.part_number)+'</strong></div>'+
        '<div class="a5-image-column">'+photoMarkup(part,warehouse)+'</div>'+
      '</div></div></article>';
  }
  async function print(){
    if(model.busy||model.printing)return;
    const selected=entries();
    if(!selected.length)return;
    if(typeof QRCode!=='function'){notice('Nie wczytano generatora QR. Odśwież stronę.',true);return;}
    const total=selected.reduce((sum,p)=>sum+(model.queue.get(p.id)||0),0);
    if(total>200){notice('Jednorazowo przygotuj maksymalnie 200 etykiet.',true);return;}
    model.busy=true;renderQueue();notice();
    const warehouse=model.warehouse;
    const ids=selected.map(p=>p.id);
    try{
      const expanded=selected.flatMap(p=>Array.from({length:model.queue.get(p.id)},()=>p));
      const root=$('labelPrintRoot');
      let sheets='';
      for(let i=0;i<expanded.length;i+=2){
        sheets+='<section class="a4-label-sheet">'+itemMarkup(expanded[i],warehouse)+
          (expanded[i+1]?itemMarkup(expanded[i+1],warehouse):
            '<div class="a5-label-blank"></div>')+'</section>';
      }
      root.innerHTML=sheets;
      for(const node of root.querySelectorAll('[data-qr]')){
        const content=node.dataset.qr;
        new QRCode(node,{text:content,width:240,height:240,colorDark:'#000000',
          colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});
      }
      // Wait for QR/image decoding so the print dialog captures complete labels.
      await Promise.all([...root.querySelectorAll('img')].map(img=>
        img.decode().catch(()=>{
          if(img.classList.contains('label-part-photo')){
            img.replaceWith(Object.assign(document.createElement('div'),{
              className:'label-photo-placeholder',textContent:'Brak podglądu zdjęcia'
            }));
          }
        })
      ));
      model.printing={warehouse,ids};
      const pageStyle=document.createElement('style');
      pageStyle.id='labelA4PageStyle';
      pageStyle.textContent='@page{size:A4 portrait;margin:0}';
      document.head.append(pageStyle);
      document.body.classList.add('printing-office-labels');
      window.print();
    }catch(error){
      model.printing=null;
      cleanupPrint();
      notice(error.message||'Nie udało się przygotować wydruku.',true);
    }finally{
      model.busy=false;renderQueue();
    }
  }
  function cleanupPrint(){
    document.body.classList.remove('printing-office-labels');
    $('labelA4PageStyle')?.remove();
    $('labelPrintRoot').replaceChildren();
  }
  async function finished(){
    if(!model.printing)return;
    const job=model.printing;
    model.printing=null;
    cleanupPrint();
    try{
      const response=await fetch('/api/office-labels',{
        method:'POST',credentials:'same-origin',cache:'no-store',keepalive:true,
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'recordPrint',warehouseId:job.warehouse,partIds:job.ids})
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok||!result.ok)throw Error(result.error||'Nie zapisano daty wydruku.');
      if(model.warehouse===job.warehouse){
        model.queue.clear();
        await load();
      }
    }catch(error){notice('Okno drukowania zostało zamknięte, ale '+error.message,true);}
  }
  $('labelWarehouse').addEventListener('change',e=>{
    model.warehouse=e.target.value;model.queue.clear();model.pending=null;load();
  });
  $('labelSearch').addEventListener('input',e=>{model.search=e.target.value;renderRows();});
  $('labelList').addEventListener('click',e=>{
    const button=e.target.closest('[data-label-toggle]');
    if(button)togglePart(button.dataset.labelToggle);
  });
  $('labelQueueList').addEventListener('click',e=>{
    const remove=e.target.closest('[data-label-toggle]');
    if(remove){togglePart(remove.dataset.labelToggle);return;}
    const minus=e.target.closest('[data-label-minus]');
    const plus=e.target.closest('[data-label-plus]');
    const id=minus?.dataset.labelMinus||plus?.dataset.labelPlus;
    if(!model.queue.has(id))return;
    const count=model.queue.get(id);
    model.queue.set(id,Math.max(1,Math.min(maxCopies,count+(plus?1:-1))));
    renderQueue();
  });
  $('labelPrintNow').addEventListener('click',print);
  window.addEventListener('afterprint',finished);
  window.GPBSOfficeLabels={render,enqueue,refresh:load};
})();