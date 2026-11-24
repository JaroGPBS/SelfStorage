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
        '<td><div class="belleville-doc-datetime">'+
          '<span class="belleville-doc-date">'+formatDate(doc)+'</span>'+
          '<span class="belleville-doc-time">'+escape(doc.time)+'</span>'+
          '</div></td>'+
        '<td>'+escape(doc.route)+'</td>'+
        '<td class="num">'+doc.modules.length+' szt.</td>'+
        '<td class="num">'+doc.parts.length+' poz.</td>'+
        '<td><button type="button" class="belleville-doc-toggle" aria-expanded="'+
          String(isExpanded)+'" data-belleville-demo-toggle="'+escape(doc.id)+'">'+
          (isExpanded?'Zwiń':'Szczegóły')+' <span aria-hidden="true">'+(isExpanded?'⌃':'⌄')+'</span>'+
          '</button></td></tr>'+
        (isExpanded?'<tr class="belleville-doc-expansion"><td colspan="7">'+details(doc)+'</td></tr>':'');
    }).join('')||'<tr><td class="belleville-doc-no-results" colspan="7">Brak pasujących dokumentów pokazowych.</td></tr>';
    return {
      html:'<div class="belleville-doc-demo">'+
        '<p class="belleville-doc-banner">DANE FIKCYJNE — PODGLĄD UKŁADU. Nic nie zapisuje się do D1 ani nie zmienia stanów magazynowych.</p>'+
        '<div class="belleville-doc-table-scroll">'+
        '<table class="table belleville-doc-table"><thead><tr>'+
        '<th>Numer '+direction+'</th><th>Tydz.</th><th>Data i godzina</th>'+
        '<th>Trasa</th><th>Moduły</th><th>Części</th><th></th>'+
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
            '<h2>'+(incoming?'POTWIERDZENIE PRZYJĘCIA':'POTWIERDZENIE WYDANIA')+'</h2>'+
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
        '<section class="belleville-demo-print-section">'+
          '<div class="doc-print-section-title">Części — '+doc.parts.length+
            (doc.parts.length===1?' pozycja':' pozycji')+'</div>'+
          '<table class="doc-print-parts belleville-demo-print-parts">'+
            '<thead><tr><th>Indeks SAP</th><th>Nazwa części</th><th>Ilość (szt.)</th></tr></thead>'+
            '<tbody>'+partLines+'</tbody>'+
          '</table>'+
        '</section>'+
        '<div class="doc-print-bottom">'+
          '<div class="doc-print-notes"><strong>Dodatkowe informacje</strong><p>'+
            escape(doc.comment||'Brak dodatkowych informacji.')+'</p></div>'+
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
  window.GPBSBellevilleDocsDemo={render,printHtml,find:byId};
})();
