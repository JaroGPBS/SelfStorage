/* Belleville CMR PDF preview and time-limited printed document archive.
   Blank template stays in browser IndexedDB. On first 'Zapisz i drukuj',
   the filled PDF is saved privately to R2 with a 60-minute D1 lock. */
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
  let currentPdfBytes=null;
  let pdfMode='draft';
  let printRecord=null;
  let lastSavedSnapshot=null;
  let recordLoaded=false;
  let archiveReady=false;
  let serverClockOffset=0;
  let lockTimer=null;
  let isSavingPrint=false;
  let printRequestVersion=0;
  let editorLocked=false;
  let viewToken=0;
  const $=id=>document.getElementById(id);
  // Route, WZ number and module count come directly from the selected WZ.
  // They remain in the PDF but are not manually editable in the CMR sidebar.
  const fieldNames=[
    ['recipient','2. Odbiorca','textarea'],
    ['delivery','3. Miejsce dostawy','textarea'],
    ['carrier','16. Przewoźnik, samochód, kierowca','textarea'],
    ['cargo','6. Numery modułów i części','textarea'],
    ['weight','11. Waga brutto (kg)','text']
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
  // Both CMR dates refer to the day the document is prepared, not the
  // historical WZ date. Use the loading warehouse's local calendar (France).
  function currentCmrDate(){
    const values=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
      timeZone:'Europe/Paris',day:'2-digit',month:'2-digit',year:'numeric'
    }).formatToParts(new Date()).filter(part=>part.type!=='literal')
      .map(part=>[part.type,part.value]));
    return values.day+'-'+values.month+'-'+values.year;
  }
  function preparedDoc(id){
    const doc=window.GPBSBellevilleDocsDemo?.find(id);
    if(!doc||doc.direction!=='WZ')return null;
    const date=currentCmrDate();
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
      moduleCount:doc.modules.length,
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
    if(!values||!recordLoaded||editorLocked||isSavingPrint)return;
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
    if(!values||!recordLoaded||editorLocked||isSavingPrint)return;
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
    if(!values||!recordLoaded||editorLocked||isSavingPrint)return;
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
  async function populateCmrDefaults(id,restore=false){
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
      if(matched&&!restore){select.value=matched.id;selectCmrCarrier();}
    }catch(_){
      // CMR remains editable even if the Office carrier list is unavailable.
    }
    if(restore)return; // Do not overwrite saved printed CMR weights or carrier.
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
      // Module names can repeat in different families (e.g. Indoor CU,
      // Bloq.it CU and NewGen CU). Prefer a group-qualified weight when WZ
      // provides the family. For old WZ records without group information,
      // retain an existing plain weight or use a unique category match only.
      // Never silently choose between two different CU/DUO family weights.
      const familyCode=group=>{
        const code=moduleCode(group);
        return ['BQ','BLOCKIT','BLOQIT'].includes(code)?'BLOQIT':
          code==='NEWGENERATION'?'NEWGEN':code;
      };
      const resolveModuleKg=module=>{
        const type=moduleCode(module.type);
        const family=familyCode(module.group||module.category||module.family||module.moduleGroup);
        if(family){
          const exact=byType.get(family+type);
          if(exact!==undefined)return exact;
        }
        const ungrouped=byType.get(type);
        if(ungrouped!==undefined)return ungrouped;
        const matches=(data.modules||[]).filter(entry=>{
          const name=String(entry.moduleType||'');
          if(!name.includes(' - '))return false;
          const bare=name.slice(name.indexOf(' - ')+3);
          return moduleCode(bare)===type;
        });
        return matches.length===1?Number(matches[0].weightKg):undefined;
      };
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
        const kg=resolveModuleKg(module);
        if(kg!==undefined&&Number.isFinite(kg)){total+=kg;found=true;}
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
  // All deadlines come from D1; the server clock offset avoids local device
  // time discrepancies. Printed PDFs are fetched from R2 after the lock.
  const documentApi=id=>'/api/cmr-belleville-document?documentId='+encodeURIComponent(id);
  const isLocked=()=>Boolean(printRecord&&
    Date.now()+serverClockOffset>=Number(printRecord.lockedAtMs));
  function setPdfPreview(bytes,mode){
    const previous=currentUrl;
    currentPdfBytes=bytes;
    pdfMode=mode;
    currentUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    // Hide native PDF toolbar to direct first prints through "Zapisz i drukuj".
    $('cmrPdfDemoFrame').src=currentUrl+'#toolbar=0&navpanes=0';
    $('cmrPdfDemoFrame').classList.remove('hidden');
    $('cmrPdfDemoUpload').classList.add('hidden');
    if(previous)URL.revokeObjectURL(previous);
    $('cmrPdfDemoPrint').disabled=!recordLoaded||!archiveReady||isSavingPrint||
      (isLocked()&&mode!=='stored');
  }
  async function readStoredPdf(id,token){
    $('cmrPdfDemoPrint').disabled=true;
    try{
      const res=await fetch(documentApi(id)+'&view=pdf',{
        credentials:'same-origin',cache:'no-store'
      });
      if(!res.ok){
        const data=await res.json().catch(()=>({}));
        throw Error(data.error||'Nie udało się odczytać zapisanego PDF-u.');
      }
      const bytes=new Uint8Array(await res.arrayBuffer());
      if(token!==viewToken||currentId!==id||$('cmrPdfDemoModal').classList.contains('hidden'))return;
      setPdfPreview(bytes,'stored');
      showError('');
      setHint(isLocked()?'To jest zapisany dokument. Dostępny jest tylko wydruk.':
        'Otworzono ostatni zapisany PDF. Możesz drukować bez zmiany danych.');
    }catch(err){
      if(token===viewToken&&currentId===id){
        currentPdfBytes=null;
        $('cmrPdfDemoPrint').disabled=true;
        showError(err.message||'Zapisany dokument jest niedostępny.');
      }
    }
  }
  function lockStatus(){
    if(!initialized)return;
    const status=$('cmrPdfDemoLockStatus');
    const button=$('cmrPdfDemoPrint');
    if(!recordLoaded){
      status.textContent='Sprawdzanie zapisanego CMR i terminu blokady…';
      $('cmrPdfDemoEditor').classList.add('hidden');
      $('cmrPdfDemoChoose').classList.add('hidden');
      button.disabled=true;
      return;
    }
    const locked=isLocked();
    const newlyLocked=locked&&!editorLocked;
    editorLocked=locked;
    $('cmrPdfDemoEditor').classList.toggle('hidden',locked);
    $('cmrPdfDemoModal').querySelector('.cmr-pdf-demo-workspace').classList.toggle('is-locked',locked);
    $('cmrPdfDemoChoose').classList.toggle('hidden',locked);
    button.textContent=locked?'Drukuj':printRecord?'Zapisz poprawkę i drukuj':'Zapisz i drukuj';
    if(!printRecord){
      status.textContent='Nie drukowano jeszcze CMR. Pierwszy zapis i wydruk uruchomi 60 minut na poprawki.';
    }else if(locked){
      status.textContent='CMR zablokowana — upłynęło 60 minut od pierwszego wydruku. Można tylko drukować zapisany PDF.';
    }else{
      const remaining=Math.max(0,Number(printRecord.lockedAtMs)-(Date.now()+serverClockOffset));
      const min=Math.floor(remaining/60000);
      const sec=Math.floor((remaining%60000)/1000);
      status.textContent='Możliwość poprawek jeszcze przez '+String(min).padStart(2,'0')+':'+
        String(sec).padStart(2,'0')+' · ponowny wydruk nie przedłuża czasu.';
    }
    if(newlyLocked){
      renderCounter++;
      clearTimeout(renderTimer);
      renderTimer=null;
      if(printRecord)void readStoredPdf(currentId,viewToken);
    }
    if(!archiveReady||(locked&&pdfMode!=='stored'))button.disabled=true;
    else if(!isSavingPrint&&currentPdfBytes)button.disabled=false;
  }
  function setEditorBusy(busy){
    const editor=$('cmrPdfDemoEditor');
    if(!editor)return;
    for(const control of editor.querySelectorAll('input,textarea,select,button'))
      control.disabled=busy;
    $('cmrPdfDemoChoose').disabled=busy;
  }
  function printPdf(){
    if(!currentUrl)return;
    const frame=$('cmrPdfDemoFrame');
    try{
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    }catch(_){
      window.open(currentUrl,'_blank','noopener');
    }
  }
  async function saveAndPrint(){
    if(!recordLoaded||isSavingPrint)return;
    if(!archiveReady){showError('Archiwum R2 jest niedostępne. Wydruk wstrzymany.');return;}
    if(isLocked()||editorLocked){
      lockStatus();
      if(pdfMode!=='stored')await readStoredPdf(currentId,viewToken);
      if(pdfMode==='stored'&&currentPdfBytes)printPdf();
      return;
    }
    if(printRecord&&JSON.stringify(values)===lastSavedSnapshot){
      // No corrections: reuse the exact saved PDF, without another R2 write.
      if(pdfMode!=='stored')await readStoredPdf(currentId,viewToken);
      if(pdfMode==='stored'&&currentPdfBytes)printPdf();
      return;
    }
    if(pdfMode==='stored'&&currentPdfBytes&&!templateBytes){
      showError('Aby zapisać poprawki, najpierw wczytaj pusty szablon PDF.');
      return;
    }
    if(!currentPdfBytes||pdfMode!=='draft'||!values||renderTimer||renderInProgress){
      showError('Zaczekaj na aktualny podgląd CMR przed wydrukiem.');
      return;
    }
    const id=currentId,token=viewToken,operation=++printRequestVersion;
    const snapshot={...values};
    const pdf=new Blob([currentPdfBytes],{type:'application/pdf'});
    isSavingPrint=true;
    setEditorBusy(true);
    $('cmrPdfDemoPrint').disabled=true;
    setHint('Zapisywanie CMR w archiwum przed wydrukiem…');
    try{
      const form=new FormData();
      form.append('documentId',id);
      form.append('revision',String(printRecord?.revision||0));
      form.append('fields',JSON.stringify(snapshot));
      form.append('pdf',pdf,id+'.pdf');
      const res=await fetch(documentApi(id),{
        method:'POST',credentials:'same-origin',cache:'no-store',body:form
      });
      const data=await res.json().catch(()=>({}));
      if(!res.ok||!data.ok)throw Error(data.error||'Nie udało się zapisać CMR.');
      if(token!==viewToken||currentId!==id)return;
      printRecord=data.document;
      lastSavedSnapshot=JSON.stringify(snapshot);
      serverClockOffset=Number(data.serverNow)-Date.now();
      showError('');
      lockStatus();
      setHint('PDF zapisany. Możesz wydrukować dokument.');
      printPdf();
    }catch(err){
      if(token===viewToken&&currentId===id){
        showError(err.message||'Nie udało się zapisać CMR. Wydruk wstrzymany.');
        setHint('Wydruk nie został zatwierdzony — sprawdź komunikat.');
      }
    }finally{
      if(operation!==printRequestVersion)return;
      isSavingPrint=false;
      setEditorBusy(false);
      if(token===viewToken&&currentId===id){
        if(isLocked())lockStatus();
        else $('cmrPdfDemoPrint').disabled=!currentPdfBytes;
      }
    }
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
            '<button type="button" id="cmrPdfDemoPrint" class="btn dark" disabled>Zapisz i drukuj</button>',
            '<button type="button" id="cmrPdfDemoClose" class="cmr-pdf-demo-close" title="Zamknij podgląd" aria-label="Zamknij podgląd">×</button>',
          '</div>',
        '</div>',
        '<div id="cmrPdfDemoLockStatus" class="cmr-pdf-demo-hint" role="status" aria-live="off"></div>',
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
          '<div id="cmrPdfDemoEditor" class="cmr-pdf-demo-editor">',
            '<p>Przygotuj CMR. Pierwsze „Zapisz i drukuj” uruchamia 60 minut na poprawki. ',
            'Po tym czasie pozostaje podgląd i wydruk zapisanej wersji.</p>',
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
        if(!recordLoaded||editorLocked||isSavingPrint)return;
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
        if(!values||!recordLoaded||editorLocked||isSavingPrint)return;
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
      if(!recordLoaded||editorLocked||isSavingPrint){showError('CMR jest zablokowana lub trwa zapis.');return;}
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
        if(!recordLoaded||editorLocked)return;
        templateBytes=bytes;
        scheduleRender(0);
        try{await idb('put',bytes);}catch(_){setHint('Nie udało się zapisać wzoru lokalnie. Wczytaj go ponownie po odświeżeniu strony.');}
      }catch(err){showError(err.message||'Nie udało się wczytać CMR PDF.');setHint('');}
    });
    $('cmrPdfDemoPrint').addEventListener('click',()=>{void saveAndPrint();});
  }
  function close(){
    viewToken++;
    printRequestVersion++;
    isSavingPrint=false;
    setEditorBusy(false);
    clearInterval(lockTimer);
    lockTimer=null;
    clearTimeout(renderTimer);
    renderTimer=null;
    renderQueued=false;
    renderCounter++;
    $('cmrPdfDemoModal').classList.add('hidden');
    if(currentUrl){URL.revokeObjectURL(currentUrl);currentUrl='';}
    currentPdfBytes=null;
    pdfMode='draft';
    $('cmrPdfDemoFrame').removeAttribute('src');
    $('cmrPdfDemoPrint').disabled=true;
    printRecord=null;
    lastSavedSnapshot=null;
    recordLoaded=false;
    editorLocked=false;
  }
  function syncFields(){
    for(const el of $('cmrPdfDemoFields').querySelectorAll('[data-cmr-field]'))
      el.value=values?.[el.dataset.cmrField]||'';
  }
  // PDF embedding/serialization is expensive. Debounce input and never start
  // another generation until the previous one finishes.
  function scheduleRender(delay=900){
    if(!templateBytes||!values||!recordLoaded||editorLocked||isSavingPrint)return;
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
  // Ignore blank transparent/white scan margins when fitting a stamp.
  // Keep the original stored PNG unchanged and preserve the ink proportions.
  async function croppedStampBytes(base64){
    const original=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
    try{
      const img=new Image();
      img.src='data:image/png;base64,'+base64;
      await img.decode();
      const w=img.naturalWidth,h=img.naturalHeight;
      if(!w||!h||w*h>2000000)return original;
      const canvas=document.createElement('canvas');
      canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(!ctx)return original;
      ctx.drawImage(img,0,0);
      const data=ctx.getImageData(0,0,w,h).data;
      let left=w,top=h,right=-1,bottom=-1;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const i=(y*w+x)*4;
        if(data[i+3]<=12||Math.min(data[i],data[i+1],data[i+2])>=248)continue;
        left=Math.min(left,x);top=Math.min(top,y);
        right=Math.max(right,x);bottom=Math.max(bottom,y);
      }
      if(right<left||bottom<top)return original;
      const pad=Math.max(2,Math.round(Math.min(w,h)*.025));
      left=Math.max(0,left-pad);top=Math.max(0,top-pad);
      right=Math.min(w-1,right+pad);bottom=Math.min(h-1,bottom+pad);
      const cw=right-left+1,ch=bottom-top+1;
      if(cw===w&&ch===h)return original;
      const crop=document.createElement('canvas');crop.width=cw;crop.height=ch;
      const cropCtx=crop.getContext('2d');if(!cropCtx)return original;
      cropCtx.drawImage(canvas,left,top,cw,ch,0,0,cw,ch);
      const encoded=crop.toDataURL('image/png').split(',')[1];
      return encoded?Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)):original;
    }catch{return original;}
  }
  async function render(){
    if(!templateBytes||!values||!recordLoaded||editorLocked||isSavingPrint||
       isLocked()||$('cmrPdfDemoModal').classList.contains('hidden'))return;
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
      // Center the value in physical CMR column 7, vertically alongside
      // the module serial list in column 6 (not next to the parts list).
      const moduleCount=Number(snapshot.moduleCount)||0;
      const countY=Math.max(314,Math.min(556,312+(moduleCount-1)*7*1.16/2));
      const jobs=[
        [B(504,18,49,17),snapshot.route,{size:11,bold:true,white:true,align:'right',label:'Trasa'}],
        [B(467,49,54,13),snapshot.number,{size:7,bold:true,minSize:5.8,label:'Numer WZ'}],
        // The actual template has much taller recipient/destination boxes
        // than the first demo used. Allow full address lists to fit.
        [B(51,88,258,60),snapshot.recipient,{size:8,minSize:4.8,label:'Odbiorca'}],
        [B(51,164,258,61),snapshot.delivery,{size:8,minSize:4.8,label:'Adres dostawy'}],
        [B(328,89,227,58),snapshot.carrier,{size:8,minSize:4.8,label:'Przewoźnik'}],
        [B(138,258,85,12),snapshot.loadingDate,{size:8,label:'Data załadunku'}],
        [B(49,318,163,261),snapshot.cargo,{size:7,align:'left',top:true,minSize:5,label:'Moduły i części'}],
        [B(181,countY,66,18),snapshot.count,{size:6.5,minSize:4.6,label:'Ilość modułów'}],
        [B(443,349,52,32),snapshot.weight,{size:9,label:'Waga'}]
      ];
      const overflowFields=[];
      for(const job of jobs)stamp(page,...job,fonts,lib,overflowFields);
      // The final "CMR Belleville.pdf" has a blank date field.
      stamp(page,B(222,742,65,15),snapshot.issueDate,
        {size:9,margin:1,label:'Data wystawienia'},fonts,lib,overflowFields);
      if(snapshot.stampBase64){
        const raw=await croppedStampBytes(snapshot.stampBase64);
        const png=await pdf.embedPng(raw);
        // Stay below the top rule of field 23 and above the signature caption.
        const frame=B(260,762,158,35);
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
      setPdfPreview(new Uint8Array(data),'draft');
      if(overflowFields.length){
        showError('Tekst nie mieści się w polu: '+overflowFields.join(', ')+
          '. W podglądzie pokazano tylko część. Skróć wpis lub podziel dane — drukowanie jest wstrzymane do poprawy.');
        button.disabled=true;
        setHint('Zmień zbyt długie pola. Pozostałe dane i edycja nadal działają.');
      }else{
        button.disabled=editorLocked||isLocked()||!recordLoaded||!archiveReady;
        if(archiveReady)showError('');
        setHint('Gotowy podgląd. Zapisz i drukuj, aby zachować PDF w R2.');
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
    // Prevent an earlier asynchronous open/read from changing a newer modal.
    const token=++viewToken;
    printRequestVersion++;
    isSavingPrint=false;
    setEditorBusy(false);
    $('cmrPdfDemoModal').querySelector('.cmr-pdf-demo-workspace').classList.remove('is-locked');
    clearInterval(lockTimer);
    lockTimer=null;
    clearTimeout(renderTimer);
    renderTimer=null;
    renderCounter++;
    renderQueued=false;
    currentId=id;
    values=next;
    printRecord=null;
    lastSavedSnapshot=null;
    recordLoaded=false;
    editorLocked=false;
    archiveReady=false;
    weightManuallyEdited=false;
    currentPdfBytes=null;
    pdfMode='draft';
    if(currentUrl){URL.revokeObjectURL(currentUrl);currentUrl='';}
    $('cmrPdfDemoFrame').removeAttribute('src');
    $('cmrPdfDemoFrame').classList.add('hidden');
    $('cmrPdfDemoUpload').classList.add('hidden');
    $('cmrPdfDemoModal').classList.remove('hidden');
    $('cmrPdfDemoTitle').textContent='Podgląd CMR · '+id;
    $('cmrPdfDemoPrint').disabled=true;
    showError('');
    setHint('');
    syncFields();
    syncTransportFields();
    lockStatus();
    try{
      const res=await fetch(documentApi(id)+'&view=status',{
        credentials:'same-origin',cache:'no-store'
      });
      const data=await res.json().catch(()=>({}));
      if(!res.ok||!data.ok)throw Error(data.error||'Nie udało się sprawdzić stanu CMR.');
      if(token!==viewToken||currentId!==id)return true;
      archiveReady=Boolean(data.storageReady);
      printRecord=data.document||null;
      lastSavedSnapshot=printRecord?JSON.stringify(printRecord.fields):null;
      serverClockOffset=Number(data.serverNow)-Date.now();
      if(printRecord){
        values={...next,...printRecord.fields};
        weightManuallyEdited=true;
      }
      recordLoaded=true;
      syncFields();
      syncTransportFields();
      if(!printRecord||!isLocked())void populateCmrDefaults(id,Boolean(printRecord));
      lockStatus();
      lockTimer=setInterval(()=>{
        if(token!==viewToken||currentId!==id)return;
        lockStatus();
      },1000);
      if(!archiveReady){
        showError('Archiwum R2 nie jest dostępne. Podgląd roboczy jest możliwy, ale zatwierdzanie wydruku zostało wstrzymane.');
      }
      if(isLocked())return true; // lockStatus loads only the saved immutable PDF.
      if(!templateBytes){
        try{
          const bytes=await idb('get');
          if(bytes)templateBytes=new Uint8Array(bytes);
        }catch(_){}
      }
      if(token!==viewToken||currentId!==id||$('cmrPdfDemoModal').classList.contains('hidden'))return true;
      if(templateBytes){
        scheduleRender(0);
      }else if(printRecord){
        await readStoredPdf(id,token);
        setHint('Aby zmienić zapisaną CMR w ciągu 60 minut, wczytaj pusty szablon PDF w tej przeglądarce.');
      }else{
        $('cmrPdfDemoUpload').classList.remove('hidden');
        $('cmrPdfDemoFrame').classList.add('hidden');
        setHint('Wczytaj pusty wzór PDF. Wystarczy raz na tę przeglądarkę.');
      }
    }catch(err){
      if(token===viewToken&&currentId===id){
        recordLoaded=false; // Fail closed: no untracked print if D1 is unavailable.
        lockStatus();
        showError(err.message||'Nie udało się odczytać dokumentu z D1.');
        setHint('CMR nie jest dostępna do wydruku, dopóki nie uda się sprawdzić jej blokady.');
      }
    }
    return true;
  }
  window.GPBSBellevilleCmrPdfDemo={open};
})();