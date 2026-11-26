/* FIKCYJNY PODGLĄD: jedna wizyta ekipy w Belleville, przyjęcia i wydania razem.
   Bez API, bez zapisu w D1, bez korekt stanu magazynowego. */
(()=>{
  'use strict';
  const VISIT={
    id:'ZE-DEMO-001',
    date:'2026-11-26',
    time:'10:45',
    week:48,
    crew:'AA (DEMO)',
    warehouse:'Belleville',
    worker:'Magazynier DEMO',
    note:'Wizyta przykładowa — ekipa zwróciła niewykorzystane części i pobrała zaopatrzenie.',
    lines:[
      {sap:'DEMO-101',name:'Karty SIM Orange',received:0,issued:5},
      {sap:'DEMO-102',name:'Kotwy do betonu',received:2,issued:6},
      {sap:'DEMO-103',name:'Separator INDOOR',received:4,issued:0},
      {sap:'DEMO-104',name:'Płyta betonowa 2 m',received:1,issued:1},
      {sap:'DEMO-105',name:'Linka górna OUTDOOR',received:0,issued:2}
    ]
  };
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[char]);
  const sum=key=>VISIT.lines.reduce((total,line)=>total+line[key],0);
  const countPositions=key=>VISIT.lines.filter(line=>line[key]>0).length;
  const formatDate=value=>value.slice(8,10)+'.'+value.slice(5,7)+'.'+value.slice(0,4);
  const number=value=>value>0?String(value):'—';
  const summaryLabel=(key,label)=>'<span>'+label+': <strong>'+countPositions(key)+' poz.</strong></span>';
  const rows=VISIT.lines.map(line=>
    '<tr><td>'+esc(line.sap)+'</td><td>'+esc(line.name)+'</td>'+
    '<td class="bel-service-qty bel-service-in">'+number(line.received)+'</td>'+
    '<td class="bel-service-qty bel-service-out">'+number(line.issued)+'</td></tr>'
  ).join('');
  function render(search,expanded){
    const query=String(search||'').trim().toLocaleLowerCase('pl');
    const haystack=[VISIT.id,VISIT.date,formatDate(VISIT.date),VISIT.crew,VISIT.worker,
      VISIT.warehouse,...VISIT.lines.flatMap(line=>[line.sap,line.name])].join(' ')
      .toLocaleLowerCase('pl');
    const visible=!query||haystack.includes(query);
    const open=expanded===VISIT.id;
    const head='<div class="bel-service-demo-banner">'+
      '<strong>Wizyta pokazowa · dane fikcyjne</strong>'+
      '<span>Nie wpływa na stany Belleville i nie zapisuje się do D1.</span></div>';
    if(!visible)return {html:head+'<div class="empty">Nie znaleziono wizyt.</div>',shown:0,total:1};
    const details='<tr class="bel-service-expanded-row"><td colspan="8">'+
      '<div class="bel-service-expanded">'+
      '<div class="bel-service-expanded-head"><strong>Wizyta '+esc(VISIT.id)+'</strong>'+
        '<span>'+esc(VISIT.note)+'</span></div>'+
      '<div class="bel-service-table-scroll"><table class="bel-service-lines"><thead>'+
      '<tr><th>Indeks SAP</th><th>Nazwa części</th><th>Przyjęto</th><th>Wydano</th></tr>'+
      '</thead><tbody>'+rows+'</tbody>'+
      '<tfoot><tr><td colspan="2">RAZEM</td>'+
      '<td class="bel-service-qty bel-service-in">'+sum('received')+'</td>'+
      '<td class="bel-service-qty bel-service-out">'+sum('issued')+'</td>'+
      '</tr></tfoot></table></div>'+
      '</div></td></tr>';
    const table='<div class="bel-service-table-scroll"><table class="table bel-service-demo-table">'+
      '<thead><tr><th>Nr</th><th>Tydzień</th><th>Data</th><th>Ekipa</th>'+
      '<th>Przyjęto</th><th>Wydano</th><th>Obsługiwał</th><th></th></tr></thead>'+
      '<tbody><tr>'+
      '<td><strong>'+esc(VISIT.id)+'</strong></td>'+
      '<td>'+VISIT.week+'</td>'+
      '<td>'+formatDate(VISIT.date)+' <span class="bel-service-time">'+esc(VISIT.time)+'</span></td>'+
      '<td>'+esc(VISIT.crew)+'</td>'+
      '<td class="bel-service-in"><strong>'+sum('received')+'</strong> szt.</td>'+
      '<td class="bel-service-out"><strong>'+sum('issued')+'</strong> szt.</td>'+
      '<td>'+esc(VISIT.worker)+'</td>'+
      '<td class="bel-service-actions">'+
      '<button type="button" class="belleville-doc-toggle" data-bel-service-toggle="'+esc(VISIT.id)+'" aria-expanded="'+String(open)+'">'+
      (open?'Zwiń':'Szczegóły')+'</button> '+
      '<button type="button" class="belleville-doc-action" data-bel-service-print="'+esc(VISIT.id)+'">Drukuj</button>'+
      '</td></tr>'+(open?details:'')+'</tbody></table></div>';
    return {html:head+table,shown:1,total:1};
  }
  function printHtml(id){
    if(id!==VISIT.id)return null;
    const field=(title,value)=>'<div class="doc-print-field"><span>'+esc(title)+
      '</span><strong>'+esc(value)+'</strong></div>';
    const signature=(title,subtitle)=>'<div class="doc-print-signature">'+
      '<div class="doc-print-sign-line"></div><strong>'+esc(title)+'</strong>'+
      '<span>'+esc(subtitle)+'</span></div>';
    const printRows=VISIT.lines.map((line,i)=>
      '<tr><td class="doc-print-number">'+(i+1)+'</td>'+
      '<td>'+esc(line.sap)+'</td><td>'+esc(line.name)+'</td>'+
      '<td class="doc-print-qty">'+number(line.received)+'</td>'+
      '<td class="doc-print-qty">'+number(line.issued)+'</td></tr>'
    ).join('');
    return '<div class="bel-service-print">'+
      '<div class="doc-print-letterhead">'+
        '<div class="doc-print-brand"><img class="bel-service-print-logo" src="./gpbs-logo-print.svg?v=1" alt="GPBS"></div>'+
        '<span class="doc-print-region">GPBS STORAGE · MAGAZYN BELLEVILLE</span>'+
      '</div>'+
      '<div class="doc-print-title-row"><div>'+
        '<span class="doc-print-kicker">DOKUMENT MAGAZYNOWY · WZ / ZWROT</span>'+
        '<h2>ZAOPATRZENIE EKIPY</h2>'+
        '<div class="bel-service-print-number">Nr '+esc(VISIT.id)+'</div>'+
      '</div><div class="doc-print-type">ZE</div></div>'+
      '<div class="bel-service-print-demo-mark">WZÓR · DANE FIKCYJNE · NIE JEST DOKUMENTEM MAGAZYNOWYM</div>'+
      '<div class="doc-print-fields">'+
        field('Magazyn',VISIT.warehouse)+
        field('Ekipa',VISIT.crew)+
        field('Data i godzina',formatDate(VISIT.date)+' · '+VISIT.time)+
        field('Tydzień',VISIT.week)+
        field('Obsługiwał',VISIT.worker)+
      '</div>'+
      '<div class="doc-print-section-title">Części przyjęte i wydane podczas jednej wizyty</div>'+
      '<table class="doc-print-parts"><thead><tr>'+
        '<th>Lp.</th><th>Indeks SAP</th><th>Nazwa części</th><th>Przyjęto</th><th>Wydano</th>'+
      '</tr></thead><tbody>'+printRows+'</tbody></table>'+
      '<div class="doc-print-totals"><span>Pozycji: <strong>'+VISIT.lines.length+'</strong></span>'+
        summaryLabel('received','Przyjęto')+summaryLabel('issued','Wydano')+'</div>'+
      '<div class="doc-print-bottom">'+
        '<div class="doc-print-notes"><strong>Uwagi:</strong><div></div><div></div></div>'+
        '<div class="doc-print-signatures">'+
          signature('Magazynier — przyjął / wydał','Podpis osoby obsługującej wizytę')+
          signature('Ekipa — zwróciła / odebrała','Czytelny podpis przedstawiciela ekipy')+
        '</div>'+
      '</div></div>';
  }
  window.GPBSBellevilleTeamSupplyDemo={render,printHtml,id:VISIT.id};
})();