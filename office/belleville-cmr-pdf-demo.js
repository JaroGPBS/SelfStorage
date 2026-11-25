/* CMR PDF preview for the Belleville WZ demonstration.
   Uses a PDF selected by the user once in this browser (IndexedDB).
   No PDF or WZ data are uploaded to GPBS Storage or D1. */
(()=>{
  'use strict';
  const DB_NAME='gpbs-cmr-template-preview';
  const DB_STORE='assets';
  // New final blank template, separate from the old stored CMR form.
  const DB_KEY='cmr-belleville-final-v2';
  let templateBytes=null;
  let currentUrl='';
  let currentId='';
  let values=null;
  let renderTimer=null;
  let renderCounter=0;
  let renderInProgress=false;
  let renderQueued=false;
  let libPromise=null;
  let fontkitPromise=null;
  let fontBytesPromise=null;
  let initialized=false;
  let weightManuallyEdited=false;
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
  // The text inserted into CMR must be real PDF text, not a canvas/PNG.
  // Lato supports Polish characters; both font files are embedded in the PDF.
  function loadFontkit(){
    if(window.fontkit)return Promise.resolve(window.fontkit);
    if(fontkitPromise)return fontkitPromise;
    fontkitPromise=new Promise((resolve,reject)=>{
      const sources=[
        'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
        'https://unpkg.com/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js'
      ];
      const tryNext=i=>{
        if(i>=sources.length){
          reject(Error('Nie można załadować czcionek PDF. Sprawdź połączenie internetowe.'));
          return;
        }
        const script=document.createElement('script');
        script.src=sources[i];
        script.onload=()=>window.fontkit?resolve(window.fontkit):tryNext(i+1);
        script.onerror=()=>tryNext(i+1);
        document.head.appendChild(script);
      };
      tryNext(0);
    }).catch(error=>{fontkitPromise=null;throw error;});
    return fontkitPromise;
  }
  async function fetchFont(name){
    const urls=[
      'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/lato/'+name,
      'https://raw.githubusercontent.com/google/fonts/main/ofl/lato/'+name
    ];
    for(const url of urls){
      try{
        const res=await fetch(url);
        if(!res.ok)continue;
        const data=new Uint8Array(await res.arrayBuffer());
        // A TTF/OTF must be present; HTML or an error body cannot be embedded.
        if(data.length<15000)continue;
        return data;
      }catch(_){}
    }
    throw Error('Nie udało się pobrać czcionki '+name+'. Sprawdź połączenie internetowe.');
  }
  function loadFontBytes(){
    if(!fontBytesPromise){
      fontBytesPromise=Promise.all([
        fetchFont('Lato-Regular.ttf'),
        fetchFont('Lato-Bold.ttf')
      ]).catch(err=>{fontBytesPromise=null;throw err;});
    }
    return fontBytesPromise;
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
      carrierBase:doc.carrier||'',
      driver:doc.driver||'',
      plate:doc.truck||'',
      trailer:doc.trailer&&doc.trailer!=='—'?doc.trailer:'',
      stampBase64:'',
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
  // Excel's clipboard format uses tabs between cells; quoted cells can contain
  // new lines. We do not save recipients or destinations to any server.
  function parseExcelColumns(raw){
    const rows=[],row=[];
    let cell='',quoted=false;
    for(let i=0;i<raw.length;i++){
      const ch=raw[i];
      if(ch==='"'){
        if(quoted&&raw[i+1]==='"'){cell+='"';i++;}
        else if(!cell||quoted)quoted=!quoted;
        else cell+=ch;
      }else if(!quoted&&ch==='\t'){
        row.push(cell);cell='';
      }else if(!quoted&&(ch==='\n'||ch==='\r')){
        if(ch==='\r'&&raw[i+1]==='\n')i++;
        row.push(cell);cell='';
        rows.push(row.splice(0));
      }else cell+=ch;
    }
    row.push(cell);
    if(row.some(value=>value.trim()))rows.push(row);
    const data=rows.filter(line=>line.some(value=>value.trim()));
    if(!data.length||data.some(line=>line.length!==2))
      throw Error('Zaznacz i skopiuj dokładnie dwie kolumny z Excela: odbiorca i miejsce dostawy.');
    return {
      recipient:data.map(line=>line[0].trim()).filter(Boolean).join('\n'),
      delivery:data.map(line=>line[1].trim()).filter(Boolean).join('\n')
    };
  }
  function importExcelAddresses(){
    if(!values)return;
    try{
      const result=parseExcelColumns($('cmrPdfDemoExcel').value);
      values.recipient=result.recipient;
      values.delivery=result.delivery;
      syncFields();
      showError('');
      scheduleRender();
    }catch(err){showError(err.message);}
  }
  function composeCarrier(){
    if(!values)return;
    values.carrier=[
      values.carrierBase,
      values.plate?'Nr rej.: '+values.plate+(values.trailer?' / '+values.trailer:''):'',
      values.driver?'Kierowca: '+values.driver:''
    ].filter(Boolean).join('\n');
    const input=$('cmrPdfDemoFields')?.querySelector('[data-cmr-field="carrier"]');
    if(input)input.value=values.carrier;
    scheduleRender();
  }
  function selectCmrCarrier(){
    if(!values)return;
    const id=$('cmrPdfDemoCarrierSelect').value;
    const item=(window.GPBSBellevilleCmrCarriers?.get()||[]).find(c=>c.id===id);
    if(item){
      values.carrierBase=[item.name,item.address].filter(Boolean).join('\n');
      values.stampBase64=item.stampBase64||'';
    }else{
      values.carrierBase='';
      values.stampBase64='';
    }
    composeCarrier();
  }
  async function populateCmrDefaults(id){
    const doc=window.GPBSBellevilleDocsDemo?.find(id);
    if(!doc||!values)return;
    const expected=values;
    const carrierService=window.GPBSBellevilleCmrCarriers;
    try{
      const carriers=carrierService?await carrierService.list(true):[];
      if(values!==expected||currentId!==id)return;
      const select=$('cmrPdfDemoCarrierSelect');
      select.replaceChildren(new Option('— Wybierz przewoźnika —',''));
      for(const carrier of carriers)select.add(new Option(carrier.name,carrier.id));
      const matched=carriers.find(x=>x.name.toUpperCase()===String(doc.carrier||'').toUpperCase());
      if(matched){select.value=matched.id;selectCmrCarrier();}
    }catch(_){
      // CMR remains editable even if the Office carrier list is unavailable.
    }
    try{
      const res=await fetch('/api/cmr-belleville?view=weights',{
        credentials:'same-origin',cache:'no-store'
      });
      const data=await res.json();
      if(!res.ok||!data.ok||values!==expected||currentId!==id)return;
      const moduleCode=type=>String(type||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      const byType=new Map((data.modules||[]).map(x=>[
        moduleCode(x.moduleType),Number(x.weightKg)
      ]));
      const bySap=new Map(),byName=new Map();
      for(const part of data.parts||[]){
        if(part.weightKg===null||part.weightKg===undefined)continue;
        const kg=Number(part.weightKg);
        if(!Number.isFinite(kg))continue;
        if(part.sap)bySap.set(String(part.sap).toUpperCase(),kg);
        if(part.name)byName.set(String(part.name).trim().toUpperCase(),kg);
      }
      let total=0,found=false;
      for(const module of doc.modules||[]){
        const kg=byType.get(moduleCode(module.type));
        if(kg!==undefined){total+=kg;found=true;}
      }
      for(const part of doc.parts||[]){
        const kg=bySap.get(String(part.sap||'').toUpperCase())??
          byName.get(String(part.name||'').trim().toUpperCase());
        if(kg!==undefined){total+=kg*(Number(part.qty)||0);found=true;}
      }
      if(found&&!weightManuallyEdited){
        values.weight=total.toFixed(2).replace('.',',');
        syncFields();
        scheduleRender();
      }
    }catch(_){
      // Missing catalogue data is ignored, as requested. No warnings.
    }
  }
  function syncTransportFields(){
    if(!values)return;
    $('cmrPdfDemoDriver').value=values.driver||'';
    $('cmrPdfDemoPlate').value=values.plate||'';
    $('cmrPdfDemoTrailer').value=values.trailer||'';
    $('cmrPdfDemoCarrierSelect').value='';
    $('cmrPdfDemoExcel').value='';
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
              '<p>Wybierz ostateczny wzór „CMR Belleville.pdf”. ',
              'Zapiszemy go tylko w tej przeglądarce do kolejnych podglądów.</p>',
              '<button type="button" id="cmrPdfDemoUploadButton" class="btn dark">Wybierz pusty PDF</button>',
            '</div>',
            '<iframe id="cmrPdfDemoFrame" class="cmr-pdf-demo-frame hidden" title="Podgląd wypełnionego CMR PDF"></iframe>',
          '</div>',
          '<div class="cmr-pdf-demo-editor">',
            '<p>Popraw pola CMR. Podgląd PDF aktualizuje się automatycznie po zakończeniu pisania. ',
            'Wszystkie wartości są demonstracyjne — nic nie zapisuje się do D1.</p>',
            '<section class="cmr-pdf-demo-import">',
              '<strong>Adresy z Excela</strong>',
              '<label>Wklej dwie kolumny: odbiorca | miejsce dostawy',
                '<textarea id="cmrPdfDemoExcel" rows="4" placeholder="Skopiuj dwie kolumny z Excela i wklej tutaj"></textarea>',
              '</label>',
              '<button type="button" id="cmrPdfDemoImport" class="btn dark">Wstaw adresy do CMR</button>',
            '</section>',
            '<section class="cmr-pdf-demo-import">',
              '<strong>Przewoźnik z bazy Belleville</strong>',
              '<label>Wybierz firmę<select id="cmrPdfDemoCarrierSelect"><option value="">— Wybierz przewoźnika —</option></select></label>',
              '<label>Kierowca<input id="cmrPdfDemoDriver" autocomplete="off" placeholder="Imię i nazwisko"></label>',
              '<label>Tablica pojazdu<input id="cmrPdfDemoPlate" autocomplete="off" placeholder="Nr rejestracyjny"></label>',
              '<label>Tablica naczepy<input id="cmrPdfDemoTrailer" autocomplete="off" placeholder="Nr rejestracyjny naczepy"></label>',
            '</section>',
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
        if(key==='weight')weightManuallyEdited=true;
        scheduleRender();
      });
      item.appendChild(input);
      box.appendChild(item);
    });
    $('cmrPdfDemoImport').addEventListener('click',importExcelAddresses);
    $('cmrPdfDemoCarrierSelect').addEventListener('change',selectCmrCarrier);
    for(const [id,key] of [
      ['cmrPdfDemoDriver','driver'],['cmrPdfDemoPlate','plate'],['cmrPdfDemoTrailer','trailer']
    ]){
      $(id).addEventListener('input',()=>{
        if(!values)return;
        values[key]=$(id).value;
        composeCarrier();
      });
    }
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
        scheduleRender(0);
        try{await idb('put',bytes);}catch(_){setHint('Nie udało się zapisać wzoru lokalnie. Wczytaj go ponownie po odświeżeniu strony.');}
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
    clearTimeout(renderTimer);
    renderTimer=null;
    renderQueued=false;
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
  // PDF embedding/serialization is expensive. Debounce input and never start
  // another generation until the previous one finishes.
  function scheduleRender(delay=900){
    if(!templateBytes||!values)return;
    renderCounter++;
    clearTimeout(renderTimer);
    $('cmrPdfDemoPrint').disabled=true;
    setHint('Aktualizacja podglądu po zakończeniu wpisywania…');
    renderTimer=setTimeout(()=>{
      renderTimer=null;
      void render();
    },delay);
  }
  function wrapLines(font,text,size,maxWidth){
    const lines=[];
    const fits=line=>font.widthOfTextAtSize(line,size)<=maxWidth;
    const appendWord=(word,current)=>{
      if(fits(current?current+' '+word:word))return current?current+' '+word:word;
      if(current)lines.push(current);
      if(fits(word))return word;
      // Split only an individually oversized word (e.g. a long serial number).
      let part='';
      for(const char of Array.from(word)){
        if(part&&!fits(part+char)){lines.push(part);part=char;}
        else part+=char;
      }
      return part;
    };
    for(const raw of String(text||'').replace(/\r\n?/g,'\n').split('\n')){
      if(!raw.trim()){lines.push('');continue;}
      let current='';
      for(const word of raw.trim().split(/\s+/))
        current=appendWord(word,current);
      if(current)lines.push(current);
    }
    return lines;
  }
  function stamp(page,box,value,options={},fonts,lib,overflowFields){
    if(!String(value||'').trim())return;
    const margin=options.margin===undefined?2:options.margin;
    const font=options.bold?fonts.bold:fonts.regular;
    const align=options.align||'center';
    const minSize=options.minSize||4.8;
    const leading=options.leading||1.16;
    let size=options.size||8;
    let lines=[],step=0;
    let fits=false;
    for(;size>=minSize-0.001;size-=0.25){
      lines=wrapLines(font,value,size,box.w-2*margin);
      step=size*leading;
      if(lines.length*step<=box.h-2*margin){fits=true;break;}
    }
    if(!fits){
      // Keep the editor and all other fields functional even if the text is
      // longer than the physical CMR box. Mark PDF incomplete and block print.
      size=minSize;
      step=size*leading;
      lines=wrapLines(font,value,size,box.w-2*margin);
      const maxLines=Math.max(0,Math.floor((box.h-2*margin)/step));
      lines=lines.slice(0,maxLines);
      if(lines.length)lines[lines.length-1]='...';
      overflowFields.push(options.label||'CMR');
    }
    if(!lines.length)return;
    const top=options.top?margin:Math.max(margin,(box.h-lines.length*step)/2);
    const color=options.white?lib.rgb(1,1,1):lib.rgb(0.08,0.08,0.08);
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      if(!line)continue;
      const width=font.widthOfTextAtSize(line,size);
      const x=align==='left'?box.x+margin:
        (align==='right'?box.x+box.w-margin-width:box.x+(box.w-width)/2);
      const y=page.getHeight()-box.y-top-size-i*step;
      page.drawText(line,{x,y,size,font,color});
    }
  }
  function B(x,y,w,h){return {x,y,w,h};}
  async function render(){
    if(!templateBytes||!values||$('cmrPdfDemoModal').classList.contains('hidden'))return;
    if(renderInProgress){
      renderQueued=true;
      return;
    }
    renderInProgress=true;
    renderQueued=false;
    const sequence=renderCounter;
    const docId=currentId;
    const source=templateBytes;
    const snapshot={...values};
    const button=$('cmrPdfDemoPrint');
    button.disabled=true;
    showError('');
    setHint('Tworzenie podglądu na podstawie Twojego PDF…');
    try{
      const [lib,fontkit,fontBytes]=await Promise.all([
        loadLib(),loadFontkit(),loadFontBytes()
      ]);
      if(sequence!==renderCounter)return;
      const pdf=await lib.PDFDocument.load(source);
      pdf.registerFontkit(fontkit);
      const fonts={
        regular:await pdf.embedFont(fontBytes[0],{subset:true}),
        bold:await pdf.embedFont(fontBytes[1],{subset:true})
      };
      if(sequence!==renderCounter)return;
      const page=pdf.getPages()[0];
      const jobs=[
        [B(504,18,49,17),snapshot.route,{size:11,bold:true,white:true,align:'right',label:'Trasa'}],
        [B(475,43,37,14),snapshot.number,{size:7,bold:true,label:'Numer WZ'}],
        // The actual template has much taller recipient/destination boxes
        // than the first demo used. Allow full address lists to fit.
        [B(51,88,258,60),snapshot.recipient,{size:8,minSize:4.8,label:'Odbiorca'}],
        [B(51,164,258,61),snapshot.delivery,{size:8,minSize:4.8,label:'Adres dostawy'}],
        [B(328,89,227,58),snapshot.carrier,{size:9,bold:true,minSize:4.8,label:'Przewoźnik'}],
        [B(138,256,85,12),snapshot.loadingDate,{size:8,label:'Data załadunku'}],
        [B(44,318,118,261),snapshot.cargo,{size:7,align:'left',top:true,minSize:5,label:'Moduły i części'}],
        [B(169,337,68,40),snapshot.count,{size:7,label:'Ilość modułów'}],
        [B(443,349,52,32),snapshot.weight,{size:9,label:'Waga'}]
      ];
      const overflowFields=[];
      for(const job of jobs)stamp(page,...job,fonts,lib,overflowFields);
      // The final "CMR Belleville.pdf" has a blank date field.
      stamp(page,B(248,748.4,41,10),snapshot.issueDate,
        {size:8,label:'Data wystawienia'},fonts,lib,overflowFields);
      if(snapshot.stampBase64){
        const raw=Uint8Array.from(atob(snapshot.stampBase64),c=>c.charCodeAt(0));
        const png=await pdf.embedPng(raw);
        const frame=B(330,772,166,33);
        const fit=png.scaleToFit(frame.w,frame.h);
        page.drawImage(png,{
          x:frame.x+(frame.w-fit.width)/2,
          y:page.getHeight()-frame.y-frame.h+(frame.h-fit.height)/2,
          width:fit.width,height:fit.height
        });
      }
      if(sequence!==renderCounter)return;
      const data=await pdf.save();
      if(sequence!==renderCounter||docId!==currentId||
        $('cmrPdfDemoModal').classList.contains('hidden'))return;
      const url=URL.createObjectURL(new Blob([data],{type:'application/pdf'}));
      const previous=currentUrl;
      currentUrl=url;
      $('cmrPdfDemoFrame').src=url;
      $('cmrPdfDemoFrame').classList.remove('hidden');
      $('cmrPdfDemoUpload').classList.add('hidden');
      if(previous)URL.revokeObjectURL(previous);
      if(overflowFields.length){
        showError('Tekst nie mieści się w polu: '+overflowFields.join(', ')+
          '. W podglądzie pokazano tylko część. Skróć wpis lub podziel dane — drukowanie jest wstrzymane do poprawy.');
        button.disabled=true;
        setHint('Zmień zbyt długie pola. Pozostałe dane i edycja nadal działają.');
      }else{
        button.disabled=false;
        showError('');
        setHint('Ostry tekst PDF (nie obraz). Do D1 nie zapisano żadnych danych.');
      }
    }catch(err){
      if(sequence===renderCounter){
        showError(err.message||'Błąd generowania CMR.');
        button.disabled=true;
        setHint('Możesz nadal zmieniać pola. Podgląd spróbuje zaktualizować się po następnej zmianie.');
      }
    }finally{
      renderInProgress=false;
      if(!$('cmrPdfDemoModal').classList.contains('hidden')&&
         (renderQueued||sequence!==renderCounter)&&!renderTimer){
        renderQueued=false;
        renderTimer=setTimeout(()=>{
          renderTimer=null;
          void render();
        },120);
      }
    }
  }
  async function open(id){
    init();
    const next=preparedDoc(id);
    if(!next)return false;
    clearTimeout(renderTimer);
    renderTimer=null;
    renderCounter++;
    currentId=id;
    values=next;
    weightManuallyEdited=false;
    syncFields();
    syncTransportFields();
    void populateCmrDefaults(id);
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
    }else scheduleRender(0);
    return true;
  }
  window.GPBSBellevilleCmrPdfDemo={open};
})();