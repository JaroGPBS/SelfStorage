/* Belleville: actual stock read, independent saved minimum; order draft only. */
(()=>{
  'use strict';
  let PARTS=[], scope='', canEdit=false;
  function setParts(parts,minimums,scopeKey,editable){
    const drafts=scope===scopeKey?new Map(PARTS.map(p=>[p.id,p.qty])):new Map();
    scope=scopeKey;canEdit=editable;
    const minima=new Map(minimums.map(p=>[p.part_id,p.minimum]));
    PARTS=parts.map(p=>({id:p.id,sap:p.sap_number||'—',name:p.name,stock:p.quantity==null?null:Number(p.quantity),min:minima.get(p.id)??null,qty:drafts.get(p.id)||0}));
  }
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const status=p=>p.min===null?['Według potrzeb','manual']:p.stock===null?['Brak danych o stanie','never']:p.stock<=p.min?['Do zamówienia','low']:['Stan OK','ok'];
  const selected=()=>PARTS.filter(p=>p.qty>0);
  const orderText=()=>['Zamówienie części – Belleville', '',...selected().map(p=>p.sap+' | '+p.name+' | '+p.qty+' szt.')].join('\n');
  const emailText=()=>['Dzień dobry,','','Proszę o zamówienie poniższych części do magazynu Belleville:','',...selected().map(p=>p.sap+' – '+p.name+' – '+p.qty+' szt.'),'','Dziękuję.'].join('\n');
  function render(search){
    const q=String(search||'').trim().toLocaleLowerCase('pl');
    const visible=PARTS.filter(p=>!q||[p.sap,p.name,status(p)[0]].join(' ').toLocaleLowerCase('pl').includes(q));
    const rows=visible.map(p=>{
      const [label,cls]=status(p);
      return '<tr class="bel-order-row-'+cls+'"><td>'+esc(p.sap)+'</td><td>'+esc(p.name)+'</td>'+
        '<td class="bel-order-num">'+(p.stock===null?'—':esc(p.stock))+'</td><td class="bel-order-num"><input class="bel-order-qty" type="number" min="0" max="99999" step="1" inputmode="numeric" data-bel-order-min="'+esc(p.id)+'" aria-label="Minimum: '+esc(p.name)+'" placeholder="—" value="'+(p.min??'')+'" '+(canEdit?'':'disabled')+'></td>'+
        '<td><span class="bel-order-status bel-order-status-'+cls+'">'+label+'</span></td>'+
        '<td class="bel-order-num"><input class="bel-order-qty" type="number" min="0" max="99999" step="1" inputmode="numeric" data-bel-order-qty="'+esc(p.id)+'" aria-label="Zamówić: '+esc(p.name)+'" placeholder="—" value="'+(p.qty||'')+'"></td></tr>';
    }).join('')||'<tr><td colspan="6" class="bel-order-empty">Brak pasujących części.</td></tr>';
    return {html:'<div class="bel-order-demo"><div class="bel-order-banner">'+(canEdit?'Minimum zapisuje się po zatwierdzeniu pola. Puste pole = według potrzeb.':'Brak dostępu do rzeczywistych stanów lub ustawień magazynu.')+'</div>'+
      '<div class="bel-order-scroll"><table class="table bel-order-table"><thead><tr><th>Indeks SAP</th><th>Nazwa części</th><th>Stan aktualny</th><th>Minimum</th><th>Status</th><th>Zamówić</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
      '<div class="bel-order-actions"><strong data-bel-order-summary>Do zamówienia: '+selected().length+' poz.</strong><div class="bel-order-buttons">'+
      '<button class="btn subtle" type="button" data-bel-order-action="copy">Kopiuj zamówienie</button>'+
      '<button class="btn subtle" type="button" data-bel-order-action="email">Utwórz e-mail</button>'+
      '<button class="btn dark" type="button" data-bel-order-action="print">Generuj PDF</button></div></div>'+
      '<div class="bel-order-feedback" data-bel-order-feedback role="status"></div><div class="bel-order-draft" data-bel-order-draft hidden></div></div>',shown:visible.length,total:PARTS.length};
  }
  function bind(root,onPrint,saveMinimum){
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
        const p=PARTS.find(p=>p.id===input.dataset.belOrderQty);
        if(!p)return;
        const n=Math.max(0,Math.min(99999,Math.floor(Number(input.value)||0)));
        p.qty=n; if(input.value!==''&&Number(input.value)!==n)input.value=String(n);
        feedback.textContent='';draft.hidden=true;sync();
      });
    });
    root.querySelectorAll('[data-bel-order-min]').forEach(input=>{
      input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();input.blur();}});
      input.addEventListener('change',async()=>{
        const p=PARTS.find(p=>p.id===input.dataset.belOrderMin);
        if(!p||!canEdit)return;
        const next=input.value===''?null:Number(input.value);
        if(next!==null&&(!Number.isInteger(next)||next<0||next>99999)){input.value=p.min??'';feedback.textContent='Wpisz liczbę całkowitą od 0 do 99999.';return;}
        if(next===p.min)return;
        input.disabled=true;
        try{
          await saveMinimum(p.id,next);p.min=next;
          const [label,cls]=status(p), row=input.closest('tr'), tag=row.querySelector('.bel-order-status');
          row.className='bel-order-row-'+cls;tag.className='bel-order-status bel-order-status-'+cls;tag.textContent=label;
          feedback.textContent='Zapisano minimum.';
        }catch(e){input.value=p.min??'';feedback.textContent=e.message||'Nie udało się zapisać minimum.';}
        finally{input.disabled=false;}
      });
    });
    root.querySelectorAll('[data-bel-order-action]').forEach(button=>button.addEventListener('click',async()=>{
      if(!selected().length)return;
      const action=button.dataset.belOrderAction;
      feedback.textContent='';
      if(action==='copy'){
        try{await navigator.clipboard.writeText(orderText());feedback.textContent='Skopiowano zamówienie.';}
        catch(e){draft.hidden=false;draft.innerHTML='<textarea readonly aria-label="Lista do skopiowania">'+esc(orderText())+'</textarea>';feedback.textContent='Skopiuj listę z pola poniżej.';}
      }else if(action==='email'){
        draft.hidden=false;draft.innerHTML='<strong>Temat: Zamówienie części – Belleville</strong><textarea readonly aria-label="Treść e-maila">'+esc(emailText())+'</textarea>';
      }else if(action==='print'){
        onPrint('<div class="bel-order-print"><div class="doc-print-letterhead"><img src="./gpbs-logo-print.svg?v=1" alt="GPBS"><h2>ZAMÓWIENIE CZĘŚCI</h2></div><p><strong>Magazyn: Belleville</strong></p><p>PROJEKT ZAMÓWIENIA</p>'+
          '<table class="doc-print-parts"><thead><tr><th>Indeks SAP</th><th>Nazwa części</th><th>Ilość</th></tr></thead><tbody>'+selected().map(p=>'<tr><td>'+esc(p.sap)+'</td><td>'+esc(p.name)+'</td><td class="doc-print-qty">'+p.qty+'</td></tr>').join('')+'</tbody></table></div>');
      }
    }));
  }
  window.GPBSBellevilleOrderDemo={render,bind,setParts};
})();
