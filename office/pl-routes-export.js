/* GPBS Storage – route reporting. No external libraries; real .xlsx (ZIP/OOXML). */
(function(){
  'use strict';
  const endpoint='/api/pl-routes';
  const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
  const human=value=>value===null||value===undefined||value===''?'—':String(value);
  const polishDate=date=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return human(date);
    const [y,m,d]=date.split('-');
    return d+'.'+m+'.'+y;
  };
  const isoWeek=dateText=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText||'')))return null;
    const date=new Date(dateText+'T00:00:00Z');
    if(Number.isNaN(date.getTime()))return null;
    const thursday=new Date(date);
    thursday.setUTCDate(thursday.getUTCDate()+4-(thursday.getUTCDay()||7));
    const year=thursday.getUTCFullYear();
    const first=new Date(Date.UTC(year,0,1));
    return {week:Math.ceil(((thursday-first)/86400000+1)/7),year};
  };
  const when=value=>{
    const d=new Date(value||'');
    return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('pl-PL',{
      dateStyle:'short',timeStyle:'short'
    }).format(d);
  };
  const quantity=value=>value===null||value===undefined?'—':Number(value);
  const rowData=line=>{
    const given=line.quantity;
    const confirmed=line.confirmedQuantity;
    const verified=line.verifiedQuantity;
    const returned=line.returnedQuantity;
    const mismatch=confirmed!=null&&verified==null&&Number(confirmed)!==Number(given);
    const actual=verified??confirmed;
    const valid=actual!=null&&returned!=null&&!mismatch&&
      Number.isSafeInteger(Number(actual))&&Number.isSafeInteger(Number(returned))&&
      Number(actual)>=Number(returned)&&Number(returned)>=0;
    return {
      position:line.position,
      code:line.partCode||'',
      name:line.partName||line.partCode||'Część',
      issued:quantity(given),
      confirmed:quantity(confirmed),
      verified:quantity(verified),
      used:valid?Number(actual)-Number(returned):'—',
      returned:quantity(returned),
      returnLocation:human(line.returnLocation),
      mismatch
    };
  };
  const reportStatus=(route,rows)=>{
    if(route.status==='COMPLETED')return 'Trasa zakończona';
    if(rows.some(x=>x.mismatch))return 'Do weryfikacji – niezgodność';
    if(route.status==='CONFIRMED'||route.status==='REVIEW_EXPLAINED')
      return 'Potwierdzona';
    return 'Oczekuje na potwierdzenie';
  };
  const normalized=detail=>{
    const route=detail.route||{};
    const rows=(detail.lines||[]).map(rowData);
    const week=isoWeek(route.routeDate);
    const history=(detail.audit||[]).map(a=>{
      let extra={};
      try{extra=JSON.parse(a.detailsJson||'{}');}catch{}
      return {
        type:a.action==='EXPLAIN'?'Weryfikacja':'Edycja',
        actor:a.actor||'—',date:when(a.createdAt),
        note:a.action==='EXPLAIN'?String(extra.comment||'').trim():'',
        positions:Array.isArray(extra.positions)?extra.positions:[],
        details:extra
      };
    });
    return {route,rows,week,history,status:reportStatus(route,rows)};
  };
  async function getRoute(id){
    if(!/^PL-ROUTE-[a-f0-9-]{36}$/.test(String(id||'')))throw Error('Nieprawidłowy identyfikator trasy.');
    const res=await fetch(endpoint+'?id='+encodeURIComponent(id),{
      credentials:'same-origin',cache:'no-store'
    });
    const data=await res.json().catch(()=>null);
    if(!res.ok||!data?.ok)throw Error(data?.error||'Nie udało się pobrać danych trasy.');
    return normalized(data);
  }
  async function getRoutes(ids){
    if(!Array.isArray(ids)||!ids.length||ids.length>100)throw Error('Wybierz trasy do eksportu.');
    const output=[];
    for(const id of ids)output.push(await getRoute(id));
    return output;
  }
  const hasVerification=item=>item.rows.some(x=>x.verified!=='—'||x.confirmed!=='—'&&Number(x.issued)!==Number(x.confirmed));
  function reportCard(item){
    const {route,rows,week,history,status}=item;
    const verified=hasVerification(item);
    const isCompleted=route.status==='COMPLETED';
    const hasReturn=rows.some(x=>x.returned!=='—');
    const columns=[
      ['#',r=>r.position],
      ['Część',r=>r.name],
      ['Indeks',r=>human(r.code)],
      ['Wydano',r=>r.issued],
      ['Potw. ekipy',r=>r.confirmed],
      ...(verified?[['Po weryfikacji',r=>r.verified]]:[]),
      ...(isCompleted||hasReturn?[
        ['Wykorzystano',r=>r.used],['Zwrócono',r=>r.returned],
        ['Miejsce zwrotu',r=>r.returnLocation]
      ]:[])
    ];
    const audit=history.filter(x=>x.type==='Weryfikacja');
    const issues=rows.some(x=>x.mismatch)||audit.length>0;
    const note=status==='Oczekuje na potwierdzenie'?
      '<p class="report-warning">Trasa oczekuje na potwierdzenie ekipy. Brakujące ilości nie zostały uzupełnione.</p>':
      rows.some(x=>x.mismatch)?
        '<p class="report-warning">W trasie są nieuzgodnione niezgodności. Nie traktuj jej jako w pełni rozliczonej.</p>':'';
    const details=issues?'<h3 class="report-section-title">Wyjaśnienia i weryfikacje</h3>'+
      (audit.length?audit.map(a=>'<div class="report-explanation">'+
        safe(a.note||'Zapisano weryfikację (bez komentarza w starszym zapisie).')+
        '<small>'+safe(a.date)+' · '+safe(a.actor)+'</small></div>').join(''):
        '<p class="report-subhead">Niezgodność oczekuje na wyjaśnienie.</p>'):'';
    const statusSuffix=Number(route.isPresentation)===1?' (dane pokazowe)':'';
    return '<section class="route-sheet">'+
      '<div class="report-head"><div><div class="report-logo">GPBS STORAGE</div>'+
        '<h1 class="report-name">Karta rozliczenia trasy</h1>'+
        '<div class="report-subhead">Dokument magazynowy · bez załączników fotograficznych</div></div>'+
        '<div><div class="report-week">Tydzień '+safe(week?.week??'—')+'</div>'+
        '<div class="report-year">Rok '+safe(week?.year??'—')+'</div></div></div>'+
      '<div class="report-meta">'+
        itemField('Numer trasy',route.routeNumber)+
        itemField('Data trasy',polishDate(route.routeDate))+
        itemField('Ekipa',route.crewSymbol)+
        itemField('Status',status+statusSuffix)+
        itemField('Dodał',route.enteredBy||'—')+
        itemField('Data dodania',when(route.createdAt))+
      '</div>'+
      '<h3 class="report-section-title">Pobrane i rozliczone części</h3>'+
      '<table class="report-table"><thead><tr>'+columns.map(c=>'<th>'+safe(c[0])+'</th>').join('')+
        '</tr></thead><tbody>'+rows.map(r=>'<tr>'+columns.map(c=>'<td>'+safe(human(c[1](r)))+'</td>').join('')+
        '</tr>').join('')+'</tbody></table>'+
      '<div class="report-summary"><span>Liczba pozycji: <strong>'+rows.length+'</strong></span>'+
        '<span>Łącznie wydano: <strong>'+rows.reduce((n,r)=>n+Number(r.issued||0),0)+'</strong> szt.</span>'+
        '<span>Potwierdzono: <strong>'+rows.filter(x=>x.confirmed!=='—').length+'/'+rows.length+'</strong> pozycji</span></div>'+
      note+details+
      '<div class="report-signatures"><div>Wydał (magazyn)</div><div>Potwierdził odbiór (ekipa)</div>'+
        '<div>Sprawdził / rozliczył</div></div>'+
      '<div class="report-foot"><span>GPBS Storage · karta trasy '+safe(route.routeNumber||'—')+'</span>'+
        '<span>— oznacza brak danych, a nie zero sztuk</span></div>'+
    '</section>';
  }
  function itemField(label,value){
    return '<div class="report-item"><span class="report-item-label">'+safe(label)+'</span>'+
      '<span class="report-item-value">'+safe(human(value))+'</span></div>';
  }
  const encoder=new TextEncoder();
  const bytes=text=>encoder.encode(String(text));
  const LE16=n=>[n&255,n>>>8&255];
  const LE32=n=>[n&255,n>>>8&255,n>>>16&255,n>>>24&255];
  let CRC_TABLE;
  function crc32(input){
    if(!CRC_TABLE){
      CRC_TABLE=Array.from({length:256},(_,n)=>{
        let c=n;
        for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;
        return c>>>0;
      });
    }
    let crc=0xffffffff;
    for(const byte of input)crc=CRC_TABLE[(crc^byte)&255]^(crc>>>8);
    return (crc^0xffffffff)>>>0;
  }
  function zipStore(entries){
    const records=[],central=[];
    let offset=0;
    const date=0,clock=0;
    for(const [name,value] of entries){
      const path=bytes(name);
      const payload=value instanceof Uint8Array?value:bytes(value);
      const sum=crc32(payload);
      const local=new Uint8Array([
        ...LE32(0x04034b50),...LE16(20),...LE16(0x0800),
        ...LE16(0),...LE16(clock),...LE16(date),...LE32(sum),
        ...LE32(payload.length),...LE32(payload.length),
        ...LE16(path.length),...LE16(0),...path
      ]);
      records.push(local,payload);
      const centralRecord=new Uint8Array([
        ...LE32(0x02014b50),...LE16(20),...LE16(20),...LE16(0x0800),
        ...LE16(0),...LE16(clock),...LE16(date),...LE32(sum),
        ...LE32(payload.length),...LE32(payload.length),
        ...LE16(path.length),...LE16(0),...LE16(0),...LE16(0),
        ...LE16(0),...LE32(0),...LE32(offset),...path
      ]);
      central.push(centralRecord);
      offset+=local.length+payload.length;
    }
    const length=central.reduce((n,arr)=>n+arr.length,0);
    const end=new Uint8Array([
      ...LE32(0x06054b50),...LE16(0),...LE16(0),
      ...LE16(central.length),...LE16(central.length),
      ...LE32(length),...LE32(offset),...LE16(0)
    ]);
    return new Blob([...records,...central,end],{
      type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }
  const xEsc=v=>String(v??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'
  }[c]));
  function excelCell(value){
    if(typeof value==='number'&&Number.isFinite(value))
      return '<c><v>'+value+'</v></c>';
    return '<c t="inlineStr"><is><t xml:space="preserve">'+xEsc(human(value))+'</t></is></c>';
  }
  function excelRows(item){
    const {route,rows,history,week,status}=item;
    const data=[
      ['GPBS STORAGE – KARTA TRASY'],
      ['Tydzień',week?.week??'—','Rok',week?.year??'—'],
      ['Numer trasy',route.routeNumber||'—','Data',polishDate(route.routeDate)],
      ['Ekipa',route.crewSymbol||'—','Status',status],
      ['Dodał',route.enteredBy||'—','Data dodania',when(route.createdAt)],
      [''],
      ['Lp.','Część','Indeks','Wydano','Potwierdzono (ekipa)','Po weryfikacji',
        'Wykorzystano','Zwrócono','Miejsce zwrotu']
    ];
    for(const r of rows)data.push([r.position,r.name,r.code,
      r.issued,r.confirmed,r.verified,r.used,r.returned,r.returnLocation]);
    data.push([''],['Wyjaśnienia / weryfikacje']);
    for(const a of history.filter(x=>x.type==='Weryfikacja'))
      data.push([a.date,a.actor,a.note||'Brak komentarza (starszy zapis)']);
    if(!history.some(x=>x.type==='Weryfikacja'))data.push(['Brak zapisanych weryfikacji']);
    data.push([''],['Podpis wydającego','Podpis ekipy','Podpis weryfikującego']);
    return data;
  }
  const excelSheet=data=>{
    const rowXML=data.map((row,i)=>'<row r="'+(i+1)+'">'+
      row.map(value=>excelCell(value)).join('')+'</row>').join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
      '<cols><col min="1" max="1" width="12" customWidth="1"/>'+
      '<col min="2" max="2" width="32" customWidth="1"/>'+
      '<col min="3" max="3" width="24" customWidth="1"/>'+
      '<col min="4" max="9" width="18" customWidth="1"/></cols>'+
      '<sheetData>'+rowXML+'</sheetData></worksheet>';
  };
  function xlsxBlob(items){
    if(!items.length)throw Error('Brak tras do eksportu.');
    const sheets=items.map((item,index)=>({
      name:(item.route.routeNumber||'Trasa '+(index+1))
        .replace(/[:\\/?*\[\]]/g,'').slice(0,31),
      xml:excelSheet(excelRows(item))
    }));
    const workbook='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '+
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
      '<sheets>'+sheets.map((sheet,i)=>'<sheet name="'+xEsc(sheet.name)+
        '" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+
      '</sheets></workbook>';
    const wrels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      sheets.map((_,i)=>'<Relationship Id="rId'+(i+1)+
        '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '+
        'Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+
      '</Relationships>';
    const root='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'+
      '</Relationships>';
    const types='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
      '<Default Extension="xml" ContentType="application/xml"/>'+
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
      sheets.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+
        '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+
      '</Types>';
    return zipStore([
      ['[Content_Types].xml',types],
      ['_rels/.rels',root],
      ['xl/workbook.xml',workbook],
      ['xl/_rels/workbook.xml.rels',wrels],
      ...sheets.map((sheet,i)=>['xl/worksheets/sheet'+(i+1)+'.xml',sheet.xml])
    ]);
  }
  function saveXlsx(items,name){
    const blob=xlsxBlob(items),url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=(String(name||'GPBS-Trasy').replace(/[\\/:*?"<>|]/g,'_')||'GPBS-Trasy')+'.xlsx';
    a.style.display='none';
    document.body.append(a);
    a.click();
    a.remove();
    // Let the browser own the download before releasing its blob URL.
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  window.PlRouteExport=Object.freeze({
    getRoute,getRoutes,reportCard,isoWeek,xlsxBlob,saveXlsx
  });
})();