/* Temporary Belleville PZ/WZ presentation only.
   Everything in this file is fictional, read-only and never sent to D1.
   Remove this script (and its tiny Office hooks) when real documents are ready. */
(()=>{
  'use strict';
  const DEMO_DOCUMENTS=[
    {
      id:'PZ-DEMO-001',direction:'PZ',visit:'BEL-DEMO-01',week:47,
      date:'2026-11-18',time:'09:40',route:'PL2BH',carrier:'BERNIHOL',
      driver:'Jan Przykładowy',truck:'TEST-FR-01',trailer:'TEST-N-01',
      worker:'Magazynier DEMO',comment:'Jedna FM przyjechała z uszkodzoną obudową. Sprawdzić w serwisie.',
      modules:[
        {type:'FM',status:'OK',serial:'DEMO/26-FM-0001'},
        {type:'FM',status:'NOK',serial:'DEMO/23-FM-0002'},
        {type:'LQ',status:'NOK',serial:'DEMO/24-LQ-0001'}
      ],
      parts:[
        {sap:'DEMO-101',name:'Separator',qty:4},
        {sap:'DEMO-102',name:'Kotwa słupka',qty:20}
      ]
    },
    {
      id:'WZ-DEMO-001',direction:'WZ',visit:'BEL-DEMO-01',week:47,
      date:'2026-11-18',time:'10:25',route:'PL2BH',carrier:'BERNIHOL',
      driver:'Jan Przykładowy',truck:'TEST-FR-01',trailer:'TEST-N-01',
      worker:'Magazynier DEMO',comment:'Po rozładunku załadowano moduły na kolejną trasę.',
      modules:[
        {type:'FM',status:'OK',serial:'DEMO/26-FM-0101'},
        {type:'RQ',status:'OK',serial:'DEMO/26-RQ-0101'},
        {type:'RQ',status:'OK',serial:'DEMO/26-RQ-0102'},
        {type:'DUO',status:'OK',serial:'DEMO/25-DUO-0101'}
      ],
      parts:[
        {sap:'DEMO-101',name:'Separator',qty:8},
        {sap:'DEMO-103',name:'Słupek',qty:16},
        {sap:'DEMO-104',name:'Płyta betonowa',qty:2}
      ]
    },
    {
      id:'PZ-DEMO-002',direction:'PZ',visit:null,week:48,
      date:'2026-11-23',time:'11:10',route:'PL3P',carrier:'PIOMAR',
      driver:'Piotr Przykładowy',truck:'TEST-FR-02',trailer:'TEST-N-02',
      worker:'Magazynier DEMO',comment:'',
      modules:[
        {type:'XS',status:'NOK',serial:'DEMO/22-XS-0001'},
        {type:'XS',status:'NOK',serial:'DEMO/22-XS-0002'},
        {type:'HICU',status:'OK',serial:'DEMO/26-HICU-0001'},
        {type:'ODL',status:'OK',serial:'DEMO/26-ODL-0001'}
      ],
      parts:[]
    },
    {
      id:'WZ-DEMO-002',direction:'WZ',visit:null,week:48,
      date:'2026-11-23',time:'14:30',route:'NANTES',carrier:'TTS',
      driver:'Adam Przykładowy',truck:'TEST-FR-03',trailer:'—',
      worker:'Magazynier DEMO',comment:'Wydanie samych części serwisowych.',
      modules:[],
      parts:[
        {sap:'DEMO-105',name:'Zamek tworzywowy',qty:5},
        {sap:'DEMO-106',name:'Czujnik T2',qty:3},
        {sap:'DEMO-107',name:'Przewód sygnałowy kamery',qty:2}
      ]
    },
    {
      id:'PZ-DEMO-003',direction:'PZ',visit:'BEL-DEMO-03',week:48,
      date:'2026-11-24',time:'08:55',route:'PL6BH',carrier:'BERNIHOL',
      driver:'Michał Przykładowy',truck:'TEST-FR-04',trailer:'TEST-N-04',
      worker:'Magazynier DEMO',comment:'Części wróciły z trasy, weryfikacja ilości przy odbiorze.',
      modules:[
        {type:'FM',status:'OK',serial:'DEMO/26-FM-0301'},
        {type:'HIUNO',status:'NOK',serial:'DEMO/26-HIUNO-0301'}
      ],
      parts:[
        {sap:'DEMO-101',name:'Separator',qty:3},
        {sap:'DEMO-103',name:'Słupek',qty:2},
        {sap:'DEMO-108',name:'Łącznik górny',qty:4}
      ]
    },
    {
      id:'WZ-DEMO-003',direction:'WZ',visit:'BEL-DEMO-03',week:48,
      date:'2026-11-24',time:'09:35',route:'PL6BH',carrier:'BERNIHOL',
      driver:'Michał Przykładowy',truck:'TEST-FR-04',trailer:'TEST-N-04',
      worker:'Magazynier DEMO',comment:'',
      modules:[
        {type:'FM',status:'OK',serial:'DEMO/26-FM-0302'},
        {type:'LQ',status:'OK',serial:'DEMO/26-LQ-0301'}
      ],
      parts:[
        {sap:'DEMO-106',name:'Czujnik T2',qty:5},
        {sap:'DEMO-103',name:'Słupek',qty:10}
      ]
    }
  ];
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[char]);
  // Imported PZ records are kept only in the current page's memory, never
  // committed to source, browser storage, D1, or transmitted to a server.
  const localDocuments=new Map();
  const byId=id=>localDocuments.get(id)||DEMO_DOCUMENTS.find(doc=>doc.id===id)||null;
  function importPz(raw){
    const value=typeof raw==='string'?JSON.parse(raw):raw;
    if(!value||value.direction!=='PZ'||typeof value.id!=='string'||!/^PZ-\d{4,8}$/.test(value.id))
      throw Error('Nieprawidłowy numer lub typ dokumentu PZ.');
    const str=(v,max=500)=>{
      if(v==null)return '';
      if(typeof v!=='string'||v.length>max)throw Error('Nieprawidłowe pole dokumentu PZ.');
      return v;
    };
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value.date)||!Number.isInteger(value.week)||value.week<1||value.week>53||
       !/^\d{2}:\d{2}(?::\d{2})?$/.test(value.time)||
       !Array.isArray(value.modules)||value.modules.length>1000||
       !Array.isArray(value.parts)||value.parts.length>1000)
      throw Error('Nieprawidłowa data lub lista pozycji PZ.');
    const modules=value.modules.map(m=>{
      if(!m||!['OK','NOK'].includes(m.status)||!m.type||!m.serial)
        throw Error('Nieprawidłowy moduł.');
      return {type:str(m.type,40),serial:str(m.serial,150),status:m.status};
    });
    const parts=value.parts.map(p=>{
      if(!p||!p.name||!Number.isSafeInteger(p.qty)||p.qty<=0)
        throw Error('Nieprawidłowa część lub ilość.');
      return {sap:str(p.sap,80)||'—',name:str(p.name,250),qty:p.qty};
    });
    const doc={id:value.id,direction:'PZ',visit:null,week:value.week,date:value.date,time:value.time,
      route:str(value.route,100),carrier:str(value.carrier,200),driver:str(value.driver,150)||'—',
      truck:str(value.truck,80),trailer:str(value.trailer,80),worker:str(value.worker,150),
      comment:str(value.comment,4000),modules,parts,localImport:true};
    localDocuments.set(doc.id,doc);
    return doc.id;
  }
  function clearLocal(){localDocuments.clear();}
  const related=doc=>doc.visit
    ?DEMO_DOCUMENTS.find(item=>item.visit===doc.visit&&item.direction!==doc.direction):null;
  const groupModules=modules=>{
    const groups=new Map();
    for(const item of modules){
      const key=item.type+'|'+item.status;
      if(!groups.has(key))groups.set(key,{type:item.type,status:item.status,serials:[]});
      groups.get(key).serials.push(item.serial);
    }
    return [...groups.values()].sort((a,b)=>a.type.localeCompare(b.type,'pl')||
      (a.status==='OK'?-1:1));
  };
  const formatDate=doc=>doc.date.slice(8,10)+'.'+doc.date.slice(5,7)+'.'+
    doc.date.slice(0,4);
  const statusLabel=status=>'<span class="belleville-doc-status belleville-doc-status-'+
    (status==='NOK'?'nok':'ok')+'">'+escape(status)+'</span>';
  const moduleRows=doc=>groupModules(doc.modules).map(group=>
    '<tr><td class="belleville-doc-type">'+escape(group.type)+' '+statusLabel(group.status)+'</td>'+
    '<td class="num">'+group.serials.length+'</td>'+
    '<td><div class="belleville-doc-serials">'+group.serials.map(s=>
      '<span class="belleville-doc-serial'+
        (doc.direction==='PZ'&&group.status==='NOK'?' belleville-doc-serial-nok':'')+
        '">'+escape(s)+'</span>').join('')+'</div></td></tr>'
  ).join('');
  const partRows=doc=>doc.parts.map(part=>
    '<tr><td>'+escape(part.sap)+'</td><td>'+escape(part.name)+'</td>'+
    '<td class="num">'+escape(part.qty)+'</td></tr>'
  ).join('');
  const details=doc=>{
    const linked=related(doc);
    const modules=doc.modules.length
      ?'<div class="belleville-doc-subtable"><table><thead><tr>'+
        '<th>Typ / status</th><th>Ilość</th><th>Numery seryjne</th></tr></thead>'+
        '<tbody>'+moduleRows(doc)+'</tbody></table></div>'
      :'<p class="belleville-doc-muted">W tej operacji nie było modułów.</p>';
    const parts=doc.parts.length
      ?'<div class="belleville-doc-subtable belleville-doc-parts"><table><thead><tr>'+
        '<th>Indeks SAP</th><th>Nazwa części</th><th>Ilość (szt.)</th></tr></thead>'+
        '<tbody>'+partRows(doc)+'</tbody></table></div>'
      :'<p class="belleville-doc-muted">Brak części w tej operacji.</p>';
    return '<div class="belleville-doc-detail">'+
      '<div class="belleville-doc-detail-head"><strong>'+escape(doc.id)+'</strong>'+
      '<span>'+(doc.localImport?'IMPORT LOKALNY · DO WYDRUKU':'DANE FIKCYJNE · PODGLĄD')+'</span></div>'+
      '<div class="belleville-doc-top-grid">'+
        '<div class="belleville-doc-meta">'+
          '<div class="belleville-doc-field-carrier"><span>Przewoźnik</span><strong>'+escape(doc.carrier)+'</strong></div>'+
          '<div class="belleville-doc-field-driver"><span>Kierowca</span><strong>'+escape(doc.driver)+'</strong></div>'+
          '<div class="belleville-doc-field-worker"><span>'+(doc.direction==='PZ'?'Przyjmował':'Wydawał')+'</span><strong>'+escape(doc.worker)+'</strong></div>'+
          '<div class="belleville-doc-vehicle belleville-doc-field-truck"><span>Samochód</span><strong>'+escape(doc.truck)+'</strong></div>'+
          '<div class="belleville-doc-vehicle belleville-doc-field-trailer"><span>Przyczepa / naczepa</span><strong>'+escape(doc.trailer)+'</strong></div>'+
          '<div class="belleville-doc-field-date"><span>Data</span><strong>'+formatDate(doc)+'</strong></div>'+
        '</div>'+
        '<div class="belleville-doc-comment"><strong>Dodatkowe informacje</strong><p>'+
          escape(doc.comment||'Brak dodatkowych informacji.')+'</p></div>'+
      '</div>'+
      '<section class="belleville-doc-section"><h3>Moduły — '+doc.modules.length+' szt.</h3>'+
        modules+'</section>'+
      '<section class="belleville-doc-section"><h3>Części — '+doc.parts.length+' '+(doc.parts.length===1?'pozycja':'pozycje')+'</h3>'+
        parts+'</section>'+
      '<div class="belleville-doc-actions">'+
        (linked?'<button type="button" class="belleville-doc-action" data-belleville-demo-related="'+
          escape(linked.id)+'">Zobacz powiązaną '+linked.direction+' · '+escape(linked.id)+'</button>':'')+
        '<button type="button" class="belleville-doc-action" data-belleville-demo-print="'+
          escape(doc.id)+'">Podgląd wydruku '+doc.direction+'</button>'+

      '</div></div>';
  };
  const matches=(doc,term)=>{
    if(!term)return true;
    const haystack=[doc.id,doc.week,doc.date,doc.time,doc.route,doc.carrier,
      doc.driver,doc.truck,doc.trailer,doc.worker,doc.comment,
      ...doc.modules.flatMap(m=>[m.type,m.status,m.serial]),
      ...doc.parts.flatMap(p=>[p.sap,p.name,p.qty])
    ].join(' ').toLocaleLowerCase('pl');
    return haystack.includes(term);
  };
  function render(view,search,expanded){
    const direction=view==='wz'?'WZ':'PZ';
    const documents=[...localDocuments.values(),...DEMO_DOCUMENTS].filter(d=>d.direction===direction);
    const list=documents
      .filter(d=>matches(d,String(search||'').trim().toLocaleLowerCase('pl')))
      .sort((a,b)=>b.date.localeCompare(a.date)||b.time.localeCompare(a.time));
    const rows=list.map(doc=>{
      const isExpanded=expanded===doc.id;
      const comment=doc.comment
        ?'<span class="belleville-doc-comment-mark" title="Dodatkowe informacje">✎</span>':'';
      return '<tr class="belleville-doc-main-row">'+
        '<td><strong>'+escape(doc.id)+'</strong>'+comment+'</td>'+
        '<td>'+doc.week+'</td>'+
        '<td>'+escape(doc.route)+'</td>'+
        '<td><div class="belleville-doc-datetime">'+
          '<span class="belleville-doc-date">'+formatDate(doc)+'</span>'+
          '<span class="belleville-doc-time">'+escape(doc.time)+'</span>'+
          '</div></td>'+
        '<td class="num">'+doc.modules.length+' szt.</td>'+
        '<td class="num">'+doc.parts.length+' poz.</td>'+
        '<td>'+escape(doc.worker)+'</td>'+
        '<td><button type="button" class="belleville-doc-toggle" aria-expanded="'+
          String(isExpanded)+'" data-belleville-demo-toggle="'+escape(doc.id)+'">'+
          (isExpanded?'Zwiń':'Szczegóły')+
          '<svg class="belleville-doc-chevron" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+
            '<path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'+
          '</svg></button></td>'+
        (doc.direction==='WZ'
          ?'<td class="belleville-doc-cmr-cell"><button type="button" class="belleville-doc-action belleville-doc-cmr-action" '+
            'data-belleville-demo-cmr="'+escape(doc.id)+'" aria-label="Drukuj CMR dla '+escape(doc.id)+'">CMR</button></td>'
          :'')+
        '<td class="belleville-doc-print-cell"><button type="button" class="belleville-doc-action" '+
          'data-belleville-demo-direct-print="'+escape(doc.id)+'" aria-label="Drukuj '+escape(doc.id)+'">Drukuj</button></td></tr>'+
        (isExpanded?'<tr class="belleville-doc-expansion"><td colspan="'+
          (doc.direction==='WZ'?'10':'9')+'">'+details(doc)+'</td></tr>':'');
    }).join('')||'<tr><td class="belleville-doc-no-results" colspan="'+(direction==='WZ'?'10':'9')+'">Brak pasujących dokumentów pokazowych.</td></tr>';
    return {
      html:'<div class="belleville-doc-demo">'+
        '<p class="belleville-doc-banner">'+(direction==='PZ'?'DOKUMENTY POKAZOWE / IMPORT LOKALNY. Bez zapisu do D1 i zmiany stanów. <button type="button" class="belleville-doc-action" data-belleville-import-pz>Wczytaj PZ z pliku</button><input type="file" accept=".json,application/json" data-belleville-import-file hidden>':'DANE FIKCYJNE — PODGLĄD UKŁADU. Nic nie zapisuje się do D1 ani nie zmienia stanów magazynowych.')+'</p>'+
        '<div class="belleville-doc-table-scroll">'+
        '<table class="table belleville-doc-table"><thead><tr>'+
        '<th>Numer '+direction+'</th><th>Tydz.</th><th>Trasa</th>'+
        '<th>Data i godzina</th><th>Moduły</th><th>Części</th>'+
        '<th>'+(direction==='PZ'?'Przyjął':'Wydał')+'</th><th></th><th></th>'+
        (direction==='WZ'?'<th></th>':'')+
        '</tr></thead><tbody>'+rows+'</tbody></table></div></div>',
      shown:list.length,total:documents.length
    };
  }
  // Printable Belleville document prototype; mock data only, with the same
  // grouping and original receipt-condition status used by Office PZ/WZ.
  function printHtml(id,driverOverride){
    const source=byId(id);
    const doc=source&&source.direction==='PZ'&&typeof driverOverride==='string'
      ?{...source,driver:driverOverride.trim()||'—'}:source;
    if(!doc)return null;
    const incoming=doc.direction==='PZ';
    const groups=groupModules(doc.modules);
    const field=(label,value)=>'<div class="doc-print-field"><span>'+escape(label)+
      '</span><strong>'+escape(value||'—')+'</strong></div>';
    const signature=(title,person)=>'<div class="doc-print-signature">'+
      '<div class="doc-print-sign-line"></div><strong>'+escape(title)+'</strong>'+
      '<span>'+escape(person)+'</span></div>';
    const moduleLines=groups.map(group=>{
      const serials='<div class="belleville-demo-print-serials">'+group.serials.map(serial=>
        '<span class="'+(group.status==='NOK'?'belleville-demo-print-nok-serial':'')+
        '">'+escape(serial)+'</span>').join('')+'</div>';
      return '<tr><td><strong>'+escape(group.type)+'</strong> '+
        '<span class="belleville-demo-print-status '+(group.status==='NOK'?'nok':'ok')+
        '">'+escape(group.status)+'</span></td>'+
        '<td class="doc-print-qty">'+group.serials.length+'</td>'+
        '<td>'+serials+'</td></tr>';
    }).join('')||'<tr><td colspan="3">Brak modułów</td></tr>';
    const partLines=doc.parts.map(item=>
      '<tr><td>'+escape(item.sap)+'</td><td>'+escape(item.name)+'</td>'+
      '<td class="doc-print-qty">'+escape(item.qty)+'</td></tr>'
    ).join('')||'<tr><td colspan="3">Brak części</td></tr>';
    const ok=doc.modules.filter(item=>item.status==='OK').length;
    const nok=doc.modules.filter(item=>item.status==='NOK').length;
    return {direction:doc.direction,localImport:!!doc.localImport,html:
      '<div class="belleville-demo-print">'+
        '<div class="doc-print-letterhead">'+
          '<div class="doc-print-brand"><img class="belleville-demo-print-logo" src="./gpbs-logo-print.svg?v=1" alt="Logo GPBS"></div>'+
          '<div class="belleville-demo-print-heading">'+
            '<h2>'+(incoming?'POTWIERDZENIE PRZYJĘCIA':'WYDANIE ZEWNĘTRZNE')+'</h2>'+
            '<strong class="belleville-demo-print-number">'+escape(doc.id)+'</strong>'+
          '</div>'+
        '</div>'+
        '<div class="doc-print-fields">'+
          field('Trasa',doc.route)+
          field('Tydzień',doc.week)+
          field('Data',formatDate(doc))+
          field(incoming?'Przyjął':'Wydał',doc.worker)+
          field('Przewoźnik',doc.carrier)+
          field('Kierowca',doc.driver)+
          field('Samochód',doc.truck)+
          field('Przyczepa / naczepa',doc.trailer)+
        '</div>'+
        '<section class="belleville-demo-print-section">'+
          '<div class="doc-print-section-title">Moduły — '+doc.modules.length+' szt.'+
            (doc.modules.length?' <small>OK: '+ok+' · NOK: '+nok+'</small>':'')+
          '</div>'+
          '<table class="doc-print-parts belleville-demo-print-modules">'+
            '<thead><tr><th>Typ / status</th><th>Ilość</th><th>Numery seryjne</th></tr></thead>'+
            '<tbody>'+moduleLines+'</tbody>'+
          '</table>'+
        '</section>'+
        '<div class="belleville-demo-print-lower">'+
          '<section class="belleville-demo-print-section">'+
            '<div class="doc-print-section-title">Części — '+doc.parts.length+
              (doc.parts.length===1?' pozycja':' pozycji')+'</div>'+
            '<table class="doc-print-parts belleville-demo-print-parts">'+
              '<thead><tr><th>Indeks SAP</th><th>Nazwa części</th><th>Ilość (szt.)</th></tr></thead>'+
              '<tbody>'+partLines+'</tbody>'+
            '</table>'+
          '</section>'+
        '</div>'+
        '<div class="doc-print-bottom">'+
          '<div class="doc-print-notes"><strong>Dodatkowe informacje</strong><p>'+
            escape(doc.comment||'Brak dodatkowych informacji.')+'</p>'+
            '<div class="belleville-demo-print-write-lines">'+
              '<div></div><div></div><div></div><div></div>'+
            '</div></div>'+
          '<div class="doc-print-signatures">'+
            signature(incoming?'Przekazujący — kierowca':'Wydający — magazynier',
              incoming?doc.driver:doc.worker)+
            signature(incoming?'Przyjmujący — magazynier':'Odbierający — kierowca',
              incoming?doc.worker:doc.driver)+
          '</div>'+
        '</div>'+
      '</div>'
    };
  }
  // Direct transcription of the "CMR Szablon" tab in Google Sheets MagBelleville.
  // Original field numbers, bilingual captions, payment rows, marginal notes
  // and CMR/IRU footer are preserved. Only known WZ values are filled.
  function cmrHtml(id){
    const doc=byId(id);
    if(!doc||doc.direction!=='WZ')return null;
    const e=escape;
    const date=doc.date.slice(8,10)+'-'+doc.date.slice(5,7)+'-'+doc.date.slice(0,4);
    const field=(num,pl,en,value='',extra='')=>
      '<section class="belleville-cmr-field '+extra+'">'+
        '<div class="belleville-cmr-field-head"><b>'+e(num)+'</b><span>'+e(pl)+
          '<small>'+e(en)+'</small></span></div>'+
        '<div class="belleville-cmr-field-value">'+e(value)+'</div>'+
      '</section>';
    // Keep cargo in the seven original CMR columns; quantities belong in field 7.
    // Group identical module types so the form is readable on a single A4 page.
    const row=(marks,count,nature)=>'<tr><td>'+e(marks)+'</td>'+
      '<td>'+e(count)+'</td><td></td><td>'+e(nature)+
      '</td><td></td><td></td><td></td></tr>';
    const moduleLines=groupModules(doc.modules).map(item=>row(
      item.serials.join(', '),item.serials.length,item.type+' / '+item.status
    ));
    const partLines=doc.parts.map(item=>row(
      'SAP '+item.sap,item.qty,item.name
    ));
    const cargoRows=[...moduleLines,...partLines].join('')||row('','','');
    const feeNames=[
      ['Przewoźne','Carriage'],
      ['Zmniejszenie','Reductions'],
      ['Saldo','Balance'],
      ['Opłaty uzupełniające','Supplement charges'],
      ['Dodatkowe opłaty','Additional charges'],
      ['Koszty dodatkowe','Miscellaneous'],
      ['Razem','Total to be paid']
    ];
    const fees='<section class="belleville-cmr-fees">'+
      '<div class="belleville-cmr-fees-title">'+
        '<span><b>19</b>Do zapłacenia<small>To be paid by</small></span>'+
        '<span>Nadawca<small>Sender</small></span>'+
        '<span>Waluta<small>Currency</small></span>'+
        '<span>Odbiorca<small>Consignee</small></span>'+
      '</div>'+
      '<table><tbody>'+feeNames.map(pair=>'<tr>'+
        '<th>'+e(pair[0])+'<small>'+e(pair[1])+'</small></th>'+
        '<td></td><td></td><td></td></tr>').join('')+
      '</tbody></table>'+
    '</section>';
    const sender='Global Post Box Service\nul. Nad Jeziorem 85\n43-100 Tychy';
    const loading='Belleville-en-Beaujolais 69220 France\n185 Rue Gabriel Voisin\n'+date;
    const agreements='Trasa: '+doc.route+'\nPrzewoźnik: '+doc.carrier+
      '\nKierowca: '+doc.driver+'\nSamochód: '+doc.truck+
      (doc.trailer&&doc.trailer!=='—'?'\nPrzyczepa / naczepa: '+doc.trailer:'');
    const signature=(num,pl,en,extra='')=>
      '<section class="belleville-cmr-signature '+extra+'">'+
        '<div class="belleville-cmr-sign-title"><b>'+num+'</b>'+
          '<span>'+e(pl)+'<small>'+e(en)+'</small></span></div>'+
        '<div class="belleville-cmr-sign-blank"></div>'+
      '</section>';
    return {direction:'CMR',sourceWz:doc.id,html:
      '<div class="belleville-cmr-print">'+
        '<div class="belleville-cmr-page">'+
          '<aside class="belleville-cmr-side">'+
            '<div class="belleville-cmr-side-top">Rubryki obwiedzione tłustymi liniami wypełnia przewoźnik.'+
              '<small>The spaces framed with heavy lines must filied in by the carrier.</small></div>'+
            '<div class="belleville-cmr-side-goods">'+
              '<strong>19+20+21+22</strong><span>włącznie oraz<small>including</small></span>'+
              '<strong>1-15</strong>'+
              '<span>Do wypełnienia pod odpowiedzialnością nadawcy'+
              '<small>Auszufüllen auf Verantwortung des Absenders</small>'+
              '<small>To be completed on sender&#39;s responsability</small></span>'+
            '</div>'+
          '</aside>'+
          '<div class="belleville-cmr-form">'+
            '<div class="belleville-cmr-upper">'+
              '<div class="belleville-cmr-upper-left">'+
                field(1,'Nadawca (nazwisko lub nazwa, adres, kraj)','Sender (name, address, country)',sender,'belleville-cmr-f1')+
                field(2,'Odbiorca (nazwisko lub nazwa, adres, kraj)','Consignee (name, address, country)','','belleville-cmr-f2')+
                field(3,'Miejsce przeznaczenia (miejscowość, kraj)','Place of delivery of the goods (place, country)','','belleville-cmr-f3')+
                field(4,'Miejsce i data załadowania (miejscowość, kraj, data)','Place and date of taking over the goods (place, country, date)',loading,'belleville-cmr-f4')+
                field(5,'Załączam dokumanty','Documents attached','WZ: '+doc.id,'belleville-cmr-f5')+
              '</div>'+
              '<div class="belleville-cmr-upper-right">'+
                '<header class="belleville-cmr-title">'+
                  '<div class="belleville-cmr-title-top">'+
                    '<div class="belleville-cmr-title-name">'+
                      '<strong>MIEDZYNARODOWY SAMOCHODOWY LIST PRZEWOZOWY</strong>'+
                      '<span>INTERNATIONAL CONSIGNEMENT NOTE</span>'+
                    '</div>'+
                    '<div class="belleville-cmr-title-number">№ <span></span></div>'+
                  '</div>'+
                  '<div class="belleville-cmr-terms">'+
                    '<p>Niniejszy przewóz podlega postanowianiom konwencji o umowie miedzynarodowej przewozu drogowego towarów (CMR) bez wzglę du na jakąkolwiek przeciwną klauzulę.</p>'+
                    '<p>This carriage is subject, notwithstanding any clause to the contrary, to the Convention on the Contract for the international Carriage of goods by road (CMR).</p>'+
                  '</div>'+
                '</header>'+
                field(16,'Przewoźnik (nazwisko lub nazwa, adres, kraj)','Carrier (name, address, country)',doc.carrier,'belleville-cmr-f16')+
                field(17,'Kolejni przewoźnicy (nazwisko lub nazwa, adres, kraj)','Successive carriers (name, address, country)','','belleville-cmr-f17')+
                field(18,'Zastrzeżenia i uwagi przewoźnika','Carrier’s reservations and observations','','belleville-cmr-f18')+
              '</div>'+
            '</div>'+
            '<div class="belleville-cmr-goods">'+
              '<table><thead><tr>'+
                '<th><b>6</b> Cechy i numery<small>Marks and Nos</small></th>'+
                '<th><b>7</b> Ilość sztuk<small>Number of pakages</small></th>'+
                '<th><b>8</b> Sposób opakowania<small>Method of packing</small></th>'+
                '<th><b>9</b> Rodzaj towaru*<small>Nature of the goods*</small></th>'+
                '<th><b>10</b> Nr statystyczny<small>Statistical nr.</small></th>'+
                '<th><b>11</b> Waga brutto w kg<small>Gross weight kg</small></th>'+
                '<th><b>12</b> Objętość w m3<small>Volume in m3</small></th>'+
              '</tr></thead><tbody>'+cargoRows+'</tbody></table>'+
              '<div class="belleville-cmr-danger">'+
                '<div><span>Nr UN<small>UN-Nr.</small></span></div>'+
                '<div><span>Klasa zob. pkt 9.<small>name s. nr. 9</small></span></div>'+
                '<div><span>Nr próbki etykiety zagrożenia<small>Hazard label sample no.</small></span></div>'+
                '<div><span>Grupa pakowania<small>Pack group</small></span></div>'+
              '</div>'+
            '</div>'+
            '<div class="belleville-cmr-lower">'+
              '<div class="belleville-cmr-lower-left">'+
                field(13,'Instrukcje nadawcy','Sender’s instructions',
                  'Towar zabezpieczyć dołem pasami za belki.','belleville-cmr-f13')+
                field(14,'Zapłata','Cash on delivery','','belleville-cmr-f14')+
                field(15,'Postanowienia odnośnie przewoźnego','Instruction as to payement carriage',
                  'Przewoźne zapłacone/Carriage paid\nPrzewoźne nieopłacone/Carriage forward','belleville-cmr-f15')+
              '</div>'+
              '<div class="belleville-cmr-lower-right">'+
                fees+
                field(20,'Postanowienia specjalne','Special agreements',agreements,'belleville-cmr-f20')+
              '</div>'+
            '</div>'+
            '<section class="belleville-cmr-issue">'+
              '<b>21</b>'+
              '<span>Wystawiono w<small>Established in</small></span>'+
              '<strong>Belleville-en-Beaujolais</strong>'+
              '<span>dnia<small>on</small></span>'+
              '<strong>'+e(date)+'</strong>'+
            '</section>'+
            '<div class="belleville-cmr-signatures">'+
              signature(22,'Podpis i stempel nadawcy','Signature and stamp of the sender')+
              signature(23,'Podpis i stempel przewoźnika','Signature and stamp of the carrier')+
              '<section class="belleville-cmr-signature belleville-cmr-received">'+
                '<div class="belleville-cmr-sign-title"><b>24</b>'+
                  '<span>Przesyłkę otrzymano<small>Goods received</small></span></div>'+
                '<div class="belleville-cmr-received-place">'+
                  '<span>Miejscowość<small>Place</small></span>'+
                  '<span>dnia<small>on</small></span></div>'+
                '<div class="belleville-cmr-sign-title belleville-cmr-sign-bottom">'+
                  '<span>Podpis i stempel odbiorcy<small>Signature and stamp of the consignee</small></span>'+
                '</div>'+
              '</section>'+
            '</div>'+
            '<footer class="belleville-cmr-footer">'+
              '<p>Wzór CMR/IRU/Polska z 1976 dla międzynarodowych przewozów drogowych odpowiada ustaleniom, które zostały dokonane przez Międzynarodową Unię Transportu Drogowego/IRU/.</p>'+
              '<p>The 1976 CMR/IRU/Poland model for international road transport complies with the rules of the International Road Transport Union/IRU/.</p>'+
            '</footer>'+
          '</div>'+
        '</div>'+
      '</div>'
    };
  }
  window.GPBSBellevilleDocsDemo={render,printHtml,cmrHtml,find:byId,importPz,clearLocal};
})();
