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
  const byId=id=>DEMO_DOCUMENTS.find(doc=>doc.id===id)||null;
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
      '<span>DANE FIKCYJNE · PODGLĄD</span></div>'+
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
        (doc.direction==='WZ'?'<span class="belleville-doc-muted">CMR — do podłączenia po zatwierdzeniu widoku</span>':'')+
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
    const list=DEMO_DOCUMENTS.filter(d=>d.direction===direction)
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
        '<td class="belleville-doc-print-cell"><button type="button" class="belleville-doc-action" '+
          'data-belleville-demo-direct-print="'+escape(doc.id)+'" aria-label="Drukuj '+escape(doc.id)+'">Drukuj</button></td>'+
        (doc.direction==='WZ'
          ?'<td class="belleville-doc-cmr-cell"><button type="button" class="belleville-doc-action belleville-doc-cmr-action" '+
            'data-belleville-demo-cmr="'+escape(doc.id)+'" aria-label="Drukuj CMR dla '+escape(doc.id)+'">CMR</button></td>'
          :'')+'</tr>'+
        (isExpanded?'<tr class="belleville-doc-expansion"><td colspan="'+
          (doc.direction==='WZ'?'10':'9')+'">'+details(doc)+'</td></tr>':'');
    }).join('')||'<tr><td class="belleville-doc-no-results" colspan="'+(direction==='WZ'?'10':'9')+'">Brak pasujących dokumentów pokazowych.</td></tr>';
    return {
      html:'<div class="belleville-doc-demo">'+
        '<p class="belleville-doc-banner">DANE FIKCYJNE — PODGLĄD UKŁADU. Nic nie zapisuje się do D1 ani nie zmienia stanów magazynowych.</p>'+
        '<div class="belleville-doc-table-scroll">'+
        '<table class="table belleville-doc-table"><thead><tr>'+
        '<th>Numer '+direction+'</th><th>Tydz.</th><th>Trasa</th>'+
        '<th>Data i godzina</th><th>Moduły</th><th>Części</th>'+
        '<th>'+(direction==='PZ'?'Przyjął':'Wydał')+'</th><th></th><th></th>'+
        (direction==='WZ'?'<th></th>':'')+
        '</tr></thead><tbody>'+rows+'</tbody></table></div></div>',
      shown:list.length,total:3
    };
  }
  // Printable Belleville document prototype; mock data only, with the same
  // grouping and original receipt-condition status used by Office PZ/WZ.
  function printHtml(id){
    const doc=byId(id);
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
    return {direction:doc.direction,html:
      '<div class="belleville-demo-print">'+
        '<div class="doc-print-letterhead">'+
          '<div class="doc-print-brand"><img class="belleville-demo-print-logo" src="./gpbs-logo-print.svg?v=1" alt="Logo GPBS"></div>'+
          '<span class="doc-print-region">Magazyn: BELLEVILLE</span>'+
        '</div>'+
        '<div class="doc-print-title-row">'+
          '<div class="belleville-demo-print-heading">'+
            '<h2>'+(incoming?'POTWIERDZENIE PRZYJĘCIA':'WYDANIE ZEWNĘTRZNE')+'</h2>'+
          '</div>'+
          '<strong class="doc-print-type">'+escape(doc.id)+'</strong>'+
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
          '<div class="doc-print-notes"><strong>Dodatkowe informacje</strong><p>'+
            escape(doc.comment||'Brak dodatkowych informacji.')+'</p></div>'+
        '</div>'+
        '<div class="doc-print-bottom">'+
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
  // CMR prototype based on MagBelleville -> "CMR Szablon" (fields 1-24).
  // A WZ does not include consignee address, package count, weight or volume;
  // keep these fields blank rather than deriving them from route or part count.
  function cmrHtml(id){
    const doc=byId(id);
    if(!doc||doc.direction!=='WZ')return null;
    const field=(num,pl,en,value='',extra='')=>
      '<section class="belleville-cmr-field '+extra+'">'+
        '<div class="belleville-cmr-field-head"><b>'+escape(num)+'</b><span>'+escape(pl)+
          '<small>'+escape(en)+'</small></span></div>'+
        '<div class="belleville-cmr-field-value">'+escape(value)+'</div>'+
      '</section>';
    const goodsRow=(marks,nature)=>'<tr>'+
      '<td>'+escape(marks)+'</td><td></td><td></td>'+
      '<td>'+escape(nature)+'</td><td></td><td></td><td></td>'+
      '</tr>';
    const grouped=groupModules(doc.modules);
    const moduleLines=grouped.map(item=>goodsRow(
      'S/N: '+item.serials.join(' · '),
      'Moduł '+item.type+' '+item.status+' — '+item.serials.length+' szt.'
    ));
    const partLines=doc.parts.map(item=>goodsRow(
      'SAP: '+item.sap,'Część: '+item.name+' — '+item.qty+' szt.'
    ));
    const goodsLines=[...moduleLines,...partLines].join('')||goodsRow('','');
    const sender='Global Post Box Service\nul. Nad Jeziorem 85\n43-100 Tychy, Polska';
    const loading='Belleville-en-Beaujolais, 185 Rue Gabriel Voisin\n69220, Francja\n'+formatDate(doc);
    const agreements='Trasa: '+doc.route+
      '\nKierowca: '+doc.driver+
      '\nSamochód: '+doc.truck+
      (doc.trailer&&doc.trailer!=='—'?'\nPrzyczepa / naczepa: '+doc.trailer:'');
    const signature=(num,pl,en)=>
      '<section class="belleville-cmr-signature"><div class="belleville-cmr-sign-title">'+
      '<b>'+num+'</b><span>'+escape(pl)+'<small>'+escape(en)+'</small></span></div>'+
      '<div class="belleville-cmr-sign-blank"></div></section>';
    return {direction:'CMR',sourceWz:doc.id,html:
      '<div class="belleville-cmr-print">'+
        '<div class="belleville-cmr-upper">'+
          '<div class="belleville-cmr-upper-left">'+
            field(1,'Nadawca (nazwa, adres, kraj)','Sender (name, address, country)',sender,'belleville-cmr-large')+
            field(2,'Odbiorca (nazwa, adres, kraj)','Consignee (name, address, country)','','belleville-cmr-large')+
            field(3,'Miejsce przeznaczenia (miejscowość, kraj)','Place of delivery of the goods')+
            field(4,'Miejsce i data załadowania','Place and date of taking over the goods',loading)+
            field(5,'Załączone dokumenty','Documents attached','WZ: '+doc.id)+
          '</div>'+
          '<div class="belleville-cmr-upper-right">'+
            '<header class="belleville-cmr-title">'+
              '<strong>MIĘDZYNARODOWY SAMOCHODOWY LIST PRZEWOZOWY</strong>'+
              '<span>INTERNATIONAL CONSIGNEMENT NOTE</span>'+
              '<div>CMR <span>№ __________</span></div>'+
              '<p>Niniejszy przewóz podlega postanowieniom konwencji CMR.<small>'+
                'This carriage is subject to the CMR Convention.</small></p>'+
            '</header>'+
            field(16,'Przewoźnik (nazwa, adres, kraj)','Carrier (name, address, country)',doc.carrier,'belleville-cmr-large')+
            field(17,'Kolejni przewoźnicy','Successive carriers')+
            field(18,'Zastrzeżenia i uwagi przewoźnika','Carrier’s reservations and observations','', 'belleville-cmr-large')+
          '</div>'+
        '</div>'+
        '<div class="belleville-cmr-goods">'+
          '<table><thead><tr>'+
            '<th><b>6</b> Cechy i numery<small>Marks and Nos</small></th>'+
            '<th><b>7</b> Ilość sztuk<small>Number of packages</small></th>'+
            '<th><b>8</b> Sposób opakowania<small>Method of packing</small></th>'+
            '<th><b>9</b> Rodzaj towaru<small>Nature of the goods</small></th>'+
            '<th><b>10</b> Nr statystyczny<small>Statistical No.</small></th>'+
            '<th><b>11</b> Waga brutto (kg)<small>Gross weight (kg)</small></th>'+
            '<th><b>12</b> Objętość (m³)<small>Volume (m³)</small></th>'+
          '</tr></thead><tbody>'+goodsLines+'</tbody></table>'+
        '</div>'+
        '<div class="belleville-cmr-lower">'+
          '<div class="belleville-cmr-lower-left">'+
            field(13,'Instrukcje nadawcy','Sender’s instructions','','belleville-cmr-large')+
            field(14,'Zapłata','Cash on delivery')+
            field(15,'Postanowienia odnośnie przewoźnego','Instructions as to payment of carriage', 'Przewoźne zapłacone ☐    Przewoźne nieopłacone ☐')+
          '</div>'+
          '<div class="belleville-cmr-lower-right">'+
            field(19,'Do zapłacenia: nadawca / waluta / odbiorca','To be paid by: sender / currency / consignee','','belleville-cmr-large')+
            field(20,'Postanowienia specjalne','Special agreements',agreements,'belleville-cmr-large')+
          '</div>'+
        '</div>'+
        field(21,'Wystawiono w / dnia','Established in / on','Belleville-en-Beaujolais, '+formatDate(doc),'belleville-cmr-issue')+
        '<div class="belleville-cmr-signatures">'+
          signature(22,'Podpis i stempel nadawcy','Signature and stamp of sender')+
          signature(23,'Podpis i stempel przewoźnika','Signature and stamp of carrier')+
          signature(24,'Podpis i stempel odbiorcy','Signature and stamp of consignee')+
        '</div>'+
      '</div>'
    };
  }
  window.GPBSBellevilleDocsDemo={render,printHtml,cmrHtml,find:byId};
})();
