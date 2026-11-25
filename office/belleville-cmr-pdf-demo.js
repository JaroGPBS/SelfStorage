/* CMR PDF preview for the Belleville WZ demonstration.
   Uses a PDF selected by the user once in this browser (IndexedDB).
   No PDF or WZ data are uploaded to GPBS Storage or D1. */
(()=>{
  'use strict';
  const DB_NAME='gpbs-cmr-template-preview';
  const DB_STORE='assets';
  const DB_KEY='cmr-blank-pdf-v1';
  let templateBytes=null;
  let currentUrl='';
  let currentId='';
  let values=null;
  let renderTimer=null;
  let renderCounter=0;
  let libPromise=null;
  let initialized=false;
  const $=id=>document.getElementById(id);
  const fieldNames=[
    ['route','Trasa','text'],
    ['number','Numer dokumentu WZ','text'],
    ['recipient','2. Odbiorca','textarea'],
    ['delivery','3. Miejsce dostawy','textarea'],
    ['carrier','16. Przewoźnik, samochód, kierowca','textarea'],
    ['loadingDate','4. Data załadunku','text'],
    ['cargo','6. Numery modułów i części','textarea'],
    ['count','7. Liczba modułów','text'],
    ['weight','11. Waga brutto (kg)','text'],
    ['issueDate','21. Data wystawienia','text']
  ];
  function loadLib(){
    if(window.PDFLib)return Promise.resolve(window.PDFLib);
    if(libPromise)return libPromise;
    libPromise=new Promise((resolve,reject)=>{
      const sources=[
        'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'
      ];
      const tryNext=(i)=>{
        if(i>=sources.length){reject(Error('Nie można załadować silnika PDF. Sprawdź połączenie internetowe.'));return;}
        const script=document.createElement('script');
        script.src=sources[i];
        script.onload=()=>window.PDFLib?resolve(window.PDFLib):tryNext(i+1);
        script.onerror=()=>tryNext(i+1);
        document.head.appendChild(script);
      };
      tryNext(0);
    }).catch(error=>{libPromise=null;throw error;});
    return libPromise;
  }
  function idb(operation,data){
    if(!('indexedDB' in window))return Promise.resolve(null);
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open(DB_NAME,1);
      request.onupgradeneeded=()=>{
        if(!request.result.objectStoreNames.contains(DB_STORE))request.result.createObjectStore(DB_STORE);
      };
      request.onerror=()=>reject(request.error||Error('IndexedDB niedostępna'));
      request.onsuccess=()=>{
        const db=request.result;
        const tx=db.transaction(DB_STORE,operation==='put'?'readwrite':'readonly');
        const store=tx.objectStore(DB_STORE);
        const task=operation==='put'?store.put(data,DB_KEY):store.get(DB_KEY);
        task.onsuccess=()=>resolve(task.result||null);
        task.onerror=()=>reject(task.error||Error('Błąd odczytu wzoru'));
        tx.oncomplete=()=>db.close();
        tx.onabort=()=>db.close();
      };
    });
  }
  function showError(message){
    const el=$('cmrPdfDemoError');
    el.textContent=message||'';
    el.classList.toggle('hidden',!message);
  }
  function setHint(message){$('cmrPdfDemoHint').textContent=message||'';}
  function preparedDoc(id){
    const doc=window.GPBSBellevilleDocsDemo?.find(id);
    if(!doc||doc.direction!=='WZ')return null;
    const date=doc.date.slice(8,10)+'-'+doc.date.slice(5,7)+'-'+doc.date.slice(0,4);
    const modules=doc.modules.map(x=>x.type+' - '+x.serial);
    const parts=doc.parts.map(x=>x.name+': '+x.qty);
    return {
      route:doc.route,
      number:doc.id,
      recipient:'',
      delivery:'',
      carrier:[doc.carrier,doc.truck&&'Nr rej.: '+doc.truck+
        (doc.trailer&&doc.trailer!=='—'?' / '+doc.trailer:''),doc.driver&&'Kierowca: '+doc.driver]
        .filter(Boolean).join('\n'),
      loadingDate:date,
      cargo:modules.join('\n')+(parts.length?'\n\nCZĘŚCI:\n'+parts.join('\n'):''),
      count:doc.modules.length?'Parcel locker - '+doc.modules.length+' pcs':'',
      weight:'',
      issueDate:date
    };
  }
  function init(){
    if(initialized)return;
    initialized=true;
    const modal=document.createElement('div');
    modal.id='cmrPdfDemoModal';
    modal.className='cmr-pdf-demo-modal hidden';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.setAttribute('aria-labelledby','cmrPdfDemoTitle');
    modal.innerHTML=[
      '<div class="cmr-pdf-demo-backdrop" data-cmr-close></div>',
      '<div class="cmr-pdf-demo-panel">',
        '<div class="cmr-pdf-demo-head">',
          '<div><div class="cmr-pdf-demo-kicker">BELLEVILLE · DANE POKAZOWE</div>',
            '<h2 id="cmrPdfDemoTitle">Podgląd CMR</h2></div>',
          '<div class="cmr-pdf-demo-actions">',
            '<button type="button" id="cmrPdfDemoChoose" class="btn">Wgraj / zmień wzór PDF</button>',
            '<button type="button" id="cmrPdfDemoPrint" class="btn dark" disabled>Drukuj</button>',
            '<button type="button" id="cmrPdfDemoClose" class="cmr-pdf-demo-close" title="Zamknij podgląd" aria-label="Zamknij podgląd">×</button>',
          '</div>',
        '</div>',
        '<div id="cmrPdfDemoError" class="cmr-pdf-demo-error hidden" role="alert"></div>',
        '<div class="cmr-pdf-demo-workspace">',
          '<div class="cmr-pdf-demo-viewer">',
            '<div id="cmrPdfDemoUpload" class="cmr-pdf-demo-upload">',
              '<strong>Wczytaj pusty formularz CMR</strong>',
              '<p>Wybierz przesłany wzór „CMR Wzór.pdf” (bez żółtych pól). ',
              'Zapiszemy go tylko w tej przeglądarce do kolejnych podglądów.</p>',
              '<button type="button" id="cmrPdfDemoUploadButton" class="btn dark">Wybierz pusty PDF</button>',
            '</div>',
            '<iframe id="cmrPdfDemoFrame" class="cmr-pdf-demo-frame hidden" title="Podgląd wypełnionego CMR PDF"></iframe>',
          '</div>',
          '<div class="cmr-pdf-demo-editor">',
            '<p>Popraw pola CMR. Podgląd PDF aktualizuje się automatycznie. ',
            'Wszystkie wartości są demonstracyjne — nic nie zapisuje się do D1.</p>',
            '<div id="cmrPdfDemoFields"></div>',
            '<p id="cmrPdfDemoHint" class="cmr-pdf-demo-hint"></p>',
          '</div>',
        '</div>',
      '</div>',
      '<input type="file" id="cmrPdfDemoFile" accept="application/pdf,.pdf" hidden>'
    ].join('');
    document.body.appendChild(modal);
    const box=$('cmrPdfDemoFields');
    fieldNames.forEach(([key,label,type])=>{
      const item=document.createElement('label');
      item.className='cmr-pdf-demo-field';
      const caption=document.createElement('span');caption.textContent=label;item.appendChild(caption);
      const input=document.createElement(type==='textarea'?'textarea':'input');
      input.dataset.cmrField=key;
      if(type==='textarea')input.rows=key==='cargo'?11:(key==='carrier'?4:3);
      else input.type='text';
      input.autocomplete='off';
      input.addEventListener('input',()=>{
        if(!values)return;
        values[key]=input.value;
        scheduleRender();
      });
      item.appendChild(input);
      box.appendChild(item);
    });
    $('cmrPdfDemoChoose').addEventListener('click',()=>{$('cmrPdfDemoFile').click();});
    $('cmrPdfDemoUploadButton').addEventListener('click',()=>{$('cmrPdfDemoFile').click();});
    $('cmrPdfDemoClose').addEventListener('click',close);
    modal.querySelector('[data-cmr-close]').addEventListener('click',close);
    document.addEventListener('keydown',ev=>{
      if(ev.key==='Escape'&&!modal.classList.contains('hidden')){
        ev.stopImmediatePropagation();close();
      }
    },true);
    $('cmrPdfDemoFile').addEventListener('change',async ev=>{
      const file=ev.target.files?.[0];
      ev.target.value='';
      if(!file)return;
      if(!file.name.toLowerCase().endsWith('.pdf')||file.size>6*1024*1024){
        showError('Wybierz pusty PDF CMR, maksymalnie 6 MB.');return;
      }
      showError('');
      setHint('Sprawdzanie szablonu PDF…');
      try{
        const bytes=new Uint8Array(await file.arrayBuffer());
        const lib=await loadLib();
        const pdf=await lib.PDFDocument.load(bytes);
        const pages=pdf.getPages();
        if(pages.length!==1)throw Error('Szablon CMR musi mieć dokładnie jedną stronę.');
        const {width,height}=pages[0].getSize();
        if(Math.abs(width-595)>6||Math.abs(height-842)>6)
          throw Error('Wybierz CMR w formacie A4 (pionowo).');
        templateBytes=bytes;
        try{await idb('put',bytes);}catch(_){setHint('Nie udało się zapisać wzoru lokalnie. Wczytaj go ponownie po odświeżeniu strony.');}
        await render();
      }catch(err){showError(err.message||'Nie udało się wczytać CMR PDF.');setHint('');}
    });
    $('cmrPdfDemoPrint').addEventListener('click',()=>{
      if(!currentUrl)return;
      const frame=$('cmrPdfDemoFrame');
      try{
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      }catch(_){
        window.open(currentUrl,'_blank','noopener');
      }
    });
  }
  function close(){
    renderCounter++;
    $('cmrPdfDemoModal').classList.add('hidden');
    if(currentUrl){URL.revokeObjectURL(currentUrl);currentUrl='';}
    $('cmrPdfDemoFrame').removeAttribute('src');
    $('cmrPdfDemoPrint').disabled=true;
  }
  function syncFields(){
    for(const el of $('cmrPdfDemoFields').querySelectorAll('[data-cmr-field]'))
      el.value=values?.[el.dataset.cmrField]||'';
  }
  function scheduleRender(){
    clearTimeout(renderTimer);
    renderTimer=setTimeout(()=>{render().catch(err=>showError(err.message));},350);
  }
  function wrapLines(ctx,text,maxWidth){
    const output=[];
    for(const line of String(text||'').split('\n')){
      if(!line){output.push('');continue;}
      let part='';
      for(const word of line.split(/\s+/)){
        const test=part?part+' '+word:word;
        if(ctx.measureText(test).width>maxWidth&&part){output.push(part);part=word;}
        else part=test;
      }
      if(part)output.push(part);
    }
    return output;
  }
  async function stamp(pdf,page,box,value,options={}){
    if(!String(value||'').trim())return;
    const scale=3.5;
    const canvas=document.createElement('canvas');
    canvas.width=Math.ceil(box.w*scale);
    canvas.height=Math.ceil(box.h*scale);
    const ctx=canvas.getContext('2d');
    if(!ctx)throw Error('Przeglądarka nie obsługuje generowania obrazu.');
    ctx.scale(scale,scale);
    const align=options.align||'center';
    const bold=!!options.bold;
    let size=options.size||8;
    let lines=[],step=0;
    const margin=options.margin===undefined?2:options.margin;
    while(true){
      ctx.font=(bold?'700 ':'400 ')+size+'px Arial, Helvetica, sans-serif';
      lines=wrapLines(ctx,value,box.w-2*margin);
      step=size*(options.leading||1.16);
      const longWord=lines.some(s=>ctx.measureText(s).width>box.w-2*margin);
      if(lines.length*step<=box.h-2*margin&&!longWord)break;
      size-=0.25;
      if(size<(options.minSize||4.8))
        throw Error('Pole „'+(options.label||'CMR')+'” zawiera zbyt dużo tekstu do wydruku w tym miejscu.');
    }
    ctx.textAlign=align;
    ctx.textBaseline='top';
    ctx.fillStyle=options.white?'#ffffff':'#141414';
    const x=align==='left'?margin:(align==='right'?box.w-margin:box.w/2);
    let y=options.top?margin:Math.max(margin,(box.h-lines.length*step)/2);
    for(const line of lines){ctx.fillText(line,x,y);y+=step;}
    const png=await pdf.embedPng(canvas.toDataURL('image/png'));
    const height=page.getHeight();
    page.drawImage(png,{x:box.x,y:height-box.y-box.h,width:box.w,height:box.h});
  }
  function B(x,y,w,h){return {x,y,w,h};}
  async function render(){
    if(!templateBytes||!values)return;
    const sequence=++renderCounter;
    const button=$('cmrPdfDemoPrint');
    button.disabled=true;
    showError('');
    setHint('Tworzenie podglądu na podstawie Twojego PDF…');
    try{
      const lib=await loadLib();
      const pdf=await lib.PDFDocument.load(templateBytes);
      const page=pdf.getPages()[0];
      const jobs=[
        [B(504,18,49,17),values.route,{size:11,bold:true,white:true,align:'right',label:'Trasa'}],
        [B(475,43,37,14),values.number,{size:7,bold:true,label:'Numer WZ'}],
        [B(51,99,258,43),values.recipient,{size:8,minSize:5.2,label:'Odbiorca'}],
        [B(51,170,258,52),values.delivery,{size:8,minSize:5.2,label:'Adres dostawy'}],
        [B(328,93,227,46),values.carrier,{size:9,bold:true,minSize:5.1,label:'Przewoźnik'}],
        [B(138,256,85,12),values.loadingDate,{size:8,label:'Data załadunku'}],
        [B(44,318,118,261),values.cargo,{size:7,align:'left',top:true,minSize:5,label:'Moduły i części'}],
        [B(169,337,68,40),values.count,{size:7,label:'Ilość modułów'}],
        [B(443,349,52,32),values.weight,{size:9,label:'Waga'}]
      ];
      for(const job of jobs)await stamp(pdf,page,...job);
      // The blank template contains an old fixed issue date; cover only its digits.
      page.drawRectangle({x:248.5,y:page.getHeight()-759.7,width:40.5,height:10.5,
        color:lib.rgb(1,1,1),borderWidth:0});
      await stamp(pdf,page,B(248,748.4,41,10),values.issueDate,
        {size:8,label:'Data wystawienia'});
      const data=await pdf.save();
      if(sequence!==renderCounter)return;
      const url=URL.createObjectURL(new Blob([data],{type:'application/pdf'}));
      if(currentUrl)URL.revokeObjectURL(currentUrl);
      currentUrl=url;
      $('cmrPdfDemoFrame').src=url;
      $('cmrPdfDemoFrame').classList.remove('hidden');
      $('cmrPdfDemoUpload').classList.add('hidden');
      button.disabled=false;
      setHint('Podgląd wygenerowany z pustego PDF. Do D1 nie zapisano żadnych danych.');
    }catch(err){
      if(sequence!==renderCounter)return;
      showError(err.message||'Błąd generowania CMR.');
      setHint('');
    }
  }
  async function open(id){
    init();
    const next=preparedDoc(id);
    if(!next)return false;
    currentId=id;
    values=next;
    syncFields();
    $('cmrPdfDemoModal').classList.remove('hidden');
    $('cmrPdfDemoTitle').textContent='Podgląd CMR · '+id;
    $('cmrPdfDemoPrint').disabled=true;
    showError('');
    setHint('');
    if(!templateBytes){
      try{const bytes=await idb('get');if(bytes)templateBytes=new Uint8Array(bytes);}catch(_){}
    }
    if(currentId!==id||$('cmrPdfDemoModal').classList.contains('hidden'))return true;
    if(!templateBytes){
      $('cmrPdfDemoUpload').classList.remove('hidden');
      $('cmrPdfDemoFrame').classList.add('hidden');
      setHint('Najpierw wczytaj pusty wzór PDF. Wystarczy raz na tę przeglądarkę.');
    }else await render();
    return true;
  }
  window.GPBSBellevilleCmrPdfDemo={open};
})();