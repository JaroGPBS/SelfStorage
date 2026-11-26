/* Fikcyjna lista zamówień Belleville. Wyłącznie lokalny podgląd, bez API/D1. */
(()=>{
  'use strict';
  const PARTS=[
    {sap:'DEMO-101',name:'Kotwa do betonu',stock:12,min:20,mode:'minimum',qty:30},
    {sap:'DEMO-102',name:'Zamek tworzywowy',stock:0,min:10,mode:'minimum',qty:20},
    {sap:'DEMO-103',name:'Czujnik T2',stock:5,min:5,mode:'minimum',qty:10},
    {sap:'DEMO-104',name:'Przewód sygnałowy kamery',stock:18,min:10,mode:'minimum',qty:0},
    {sap:'DEMO-105',name:'Karty SIM Orange',stock:32,min:15,mode:'minimum',qty:0},
    {sap:'DEMO-106',name:'Separator INDOOR',stock:50,min:null,mode:'manual',qty:10},
    {sap:'DEMO-107',name:'Łącznik górny OUTDOOR',stock:8,min:null,mode:'manual',qty:0},
    {sap:'DEMO-108',name:'Płyta betonowa 2 m',stock:6,min:null,mode:'manual',qty:0},
    {sap:'DEMO-109',name:'Belka OUTDOOR',stock:5,min:null,mode:'never',qty:0},
    {sap:'DEMO-110',name:'Słupek OUTDOOR',stock:14,min:null,mode:'never',qty:0}
  ];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const status=p=>p.mode==='never'?['Nie zamawiać','never']:p.mode==='manual'?['Według potrzeb','manual']:p.stock<=p.min?['Do zamówienia','low']:['Stan OK','ok'];
  const selected=()=>PARTS.filter(p=>p.mode!=='never'&&p.qty>0);
  const orderText=()=>['Zamówienie części – Belleville (PODGLĄD)', '',...selected().map(p=>p.sap+' | '+p.name+' | '+p.qty+' szt.')].join('\n');
  const emailText=()=>['Dzień dobry,','','Proszę o zamówienie poniższych części do magazynu Belleville:','',...selected().map(p=>p.sap+' – '+p.name+' – '+p.qty+' szt.'),'','Dziękuję.','','DANE FIKCYJNE – PODGLĄD'].join('\n');
  function render(search){
    const q=String(search||'').trim().toLocaleLowerCase('pl');
    const visible=PARTS.filter(p=>!q||[p.sap,p.name,status(p)[0]].join(' ').toLocaleLowerCase('pl').includes(q));
    const rows=visible.map(p=>{
      const [label,cls]=status(p);
      return '<tr class="bel-order-row-'+cls+'"><td>'+esc(p.sap)+'</td><td>'+esc(p.name)+'</td>'+
        '<td class="bel-order-num">'+p.stock+'</td><td class="bel-order-num">'+(p.min===null?'—':p.min)+'</td>'+
        '<td><span class="bel-order-status bel-order-status-'+cls+'">'+label+'</span></td>'+
        '<td class="bel-order-num">'+(p.mode==='never'?'—':'<input class="bel-order-qty" type="number" min="0" max="99999" step="1" inputmode="numeric" data-bel-order-qty="'+esc(p.sap)+'" aria-label="Zamówić: '+esc(p.name)+'" placeholder="—" value="'+(p.qty||'')+'">')+'</td></tr>';
    }).join('')||'<tr><td colspan="6" class="bel-order-empty">Brak pasujących części.</td></tr>';
    return {html:'<div class="bel-order-demo"><div class="bel-order-banner">DANE FIKCYJNE · PODGLĄD UKŁADU · Bez wpływu na stany magazynowe</div>'+
      '<div class="bel-order-scroll"><table class="table bel-order-table"><thead><tr><th>Indeks SAP</th><th>Nazwa części</th><th>Stan aktualny</th><th>Minimum</th><th>Status</th><th>Zamówić</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
      '<div class="bel-order-actions"><strong data-bel-order-summary>Do zamówienia: '+selected().length+' poz.</strong><div class="bel-order-buttons">'+
      '<button class="btn subtle" type="button" data-bel-order-action="copy">Kopiuj zamówienie</button>'+
      '<button class="btn subtle" type="button" data-bel-order-action="email">Utwórz e-mail</button>'+
      '<button class="btn dark" type="button" data-bel-order-action="print">Generuj PDF</button></div></div>'+
      '<div class="bel-order-feedback" data-bel-order-feedback role="status"></div><div class="bel-order-draft" data-bel-order-draft hidden></div></div>',shown:visible.length,total:PARTS.length};
  }
  function bind(root,onPrint){
    const summary=root.querySelector('[data-bel-order-summary]');
    const feedback=root.querySelector('[data-bel-order-feedback]');
    const draft=root.querySelector('[data-bel-order-draft]');
    const sync=()=>{
      summary.textContent='Do zamówienia: '+selected().length+' poz.';
      root.querySelectorAll('[data-bel-order-action]').forEach(b=>b.disabled=!selected().length);
    };
    sync();
    root.querySelectorAll('[data-bel-order-qty]').forEach(input=>{
      input.addEventListener('input',()=>{
        const p=PARTS.find(p=>p.sap===input.dataset.belOrderQty);
        if(!p||p.mode==='never')return;
        const n=Math.max(0,Math.min(99999,Math.floor(Number(input.value)||0)));
        p.qty=n; if(input.value!==''&&Number(input.value)!==n)input.value=String(n);
        feedback.textContent='';draft.hidden=true;sync();
      });
    });
    root.querySelectorAll('[data-bel-order-action]').forEach(button=>button.addEventListener('click',async()=>{
      if(!selected().length)return;
      const action=button.dataset.belOrderAction;
      feedback.textContent='';
      if(action==='copy'){
        try{await navigator.clipboard.writeText(orderText());feedback.textContent='Skopiowano fikcyjne zamówienie.';}
        catch(e){draft.hidden=false;draft.innerHTML='<textarea readonly aria-label="Lista do skopiowania">'+esc(orderText())+'</textarea>';feedback.textContent='Skopiuj listę z pola poniżej.';}
      }else if(action==='email'){
        draft.hidden=false;draft.innerHTML='<strong>Temat: Zamówienie części – Belleville</strong><textarea readonly aria-label="Treść e-maila">'+esc(emailText())+'</textarea>';
      }else if(action==='print'){
        onPrint('<div class="bel-order-print"><div class="doc-print-letterhead"><img src="./gpbs-logo-print.svg?v=1" alt="GPBS"><h2>ZAMÓWIENIE CZĘŚCI</h2></div><p><strong>Magazyn: Belleville</strong></p><p>DANE FIKCYJNE – PODGLĄD</p>'+
          '<table class="doc-print-parts"><thead><tr><th>Indeks SAP</th><th>Nazwa części</th><th>Ilość</th></tr></thead><tbody>'+selected().map(p=>'<tr><td>'+esc(p.sap)+'</td><td>'+esc(p.name)+'</td><td class="doc-print-qty">'+p.qty+'</td></tr>').join('')+'</tbody></table></div>');
      }
    }));
  }
  window.GPBSBellevilleOrderDemo={render,bind};
})();
