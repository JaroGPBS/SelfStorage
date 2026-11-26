// Compact Belleville loading plans in Office. Planning does not create WZ or change stock.
(()=>{'use strict';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={active:false,plans:[],expanded:false,busy:false,editing:null,seq:0};
const button=$('belLoadingAdd'),panel=$('belLoadingPanel'),
  toggle=$('belLoadingToggle'),body=$('belLoadingBody'),
  dialog=$('belLoadingDialog'),form=$('belLoadingForm');
if(!button||!panel||!dialog||!form)return;
const note=$('belLoadingNotice'),dialogError=$('belLoadingError');
const toWeek=date=>{
  const d=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));
  d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));
  const year=d.getUTCFullYear(),start=new Date(Date.UTC(year,0,1));
  return {year,week:Math.ceil((((d-start)/86400000)+1)/7)};
};
function activeNote(text=''){
  note.textContent=text;note.hidden=!text;
}
function formError(text=''){
  dialogError.textContent=text;dialogError.hidden=!text;
}
function parsePasted(value){
  const raw=String(value||'').replace(/\r/g,'');
  if(!raw.trim())throw Error('Wklej dane z Excela: nazwa części lub modułu oraz ilość.');
  const lines=raw.split('\n');
  if(lines.length>300)throw Error('Lista jest za długa (maksymalnie 250 pozycji).');
  const result=[];
  let skippedWithoutQuantity=0;
  let headerColumns=null;
  const nameHeader=/^(?:nazwa(?:\s+(?:excel|części|elementu|towaru))?|name|part\s*name|description|designation|désignation|libellé|opis(?:\s+(?:części|towaru))?|product|produkt|materiał|material)$/i;
  const qtyHeader=/^(?:ilo[śs][ćc]|quantity|qty|qte|qté|quantit[ée]|amount|szt\.?|pcs)$/i;
  const number=value=>{
    const v=String(value).replace(/\u00a0/g,' ').trim().replace(/\s+/g,'');
    if(!/^\d+(?:[,.]0+)?$/.test(v))return null;
    const number=Number(v.replace(',','.'));
    return Number.isInteger(number)&&number>=1&&number<=100000?number:null;
  };
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(!line.trim())continue;
    let columns=line.includes('\t')?line.split('\t'):
      line.includes(';')?line.split(';'):
      line.includes(' | ')?line.split(/\s+\|\s+/):
      line.trim().split(/\s{2,}/);
    if(columns.length===1){
      // Plain-text paste from chat/email can have a single space before quantity.
      const match=line.trim().match(/^(.+?)\s+(\d+(?:[,.]0+)?)$/);
      if(match)columns=[match[1],match[2]];
    }
    columns=columns.map(cell=>cell.trim());
    const filled=columns.map((text,index)=>({text,index})).filter(cell=>cell.text);
    if(!filled.length)continue;
    if(i===0){
      const ni=filled.find(cell=>nameHeader.test(cell.text))?.index;
      const qi=filled.find(cell=>qtyHeader.test(cell.text))?.index;
      if(ni!==undefined&&qi!==undefined&&ni!==qi){
        headerColumns={name:ni,quantity:qi};
        continue;
      }
    }
    let name,quantity;
    if(headerColumns){
      name=columns[headerColumns.name]||'';
      quantity=number(columns[headerColumns.quantity]||'');
    }else{
      // Exported Excel ranges may include filled intermediate columns (codes,
      // comments, supplier labels). Name is the first textual column; quantity
      // is the rightmost positive integer. The preview makes this visible.
      const quantityCell=[...filled].reverse().find(cell=>number(cell.text)!==null);
      const nameCell=quantityCell&&filled.find(cell=>
        cell.index<quantityCell.index&&number(cell.text)===null&&
        /[^\d\s.,+-]/u.test(cell.text));
      name=nameCell?.text||'';
      quantity=quantityCell?number(quantityCell.text):null;
    }
    name=String(name||'').replace(/\s+/g,' ').trim();
    // A carrier's complete Excel checklist includes many named positions
    // with a blank quantity: they are NOT scheduled for this shipment.
    // Ignore them, rather than forcing the user to delete blank lines.
    if(quantity===null && filled.every(cell=>number(cell.text)===null)){
      skippedWithoutQuantity++;
      continue;
    }
    if(name.length<2||name.length>240||/[<>]/.test(name)||quantity===null)
      throw Error('Wiersz '+(i+1)+': nie udało się odczytać nazwy i ilości. '+
        'Sprawdź, czy ilość jest dodatnią liczbą całkowitą.');
    result.push({excelName:name,quantity});
    if(result.length>250)throw Error('Można wkleić maksymalnie 250 pozycji.');
  }
  if(!result.length)throw Error('Nie znaleziono pozycji z ilością do załadunku.');
  result.skippedWithoutQuantity=skippedWithoutQuantity;
  return result;
}
function preview(){
  const host=$('belLoadingPreview');
  try{
    const rows=parsePasted($('belLoadingPaste').value);
    host.innerHTML='<strong>Podgląd · '+rows.length+' pozycji do załadunku</strong>'+
      (rows.skippedWithoutQuantity?
        '<small class="bel-loading-preview-skipped">Pominięto '+
        rows.skippedWithoutQuantity+' bez ilości</small>':'')+
      '<div class="bel-loading-paste-preview">'+rows.slice(0,20).map(line=>
      '<div><span>'+esc(line.excelName)+'</span><b>'+line.quantity+'</b></div>'
      ).join('')+(rows.length>20?'<small>…i '+(rows.length-20)+' kolejnych</small>':'')+
      '</div>';
    formError('');
  }catch(ex){
    host.innerHTML='';
    if($('belLoadingPaste').value.trim())formError(ex.message);
    else formError('');
  }
}
async function api(payload){
  const opts={credentials:'same-origin',cache:'no-store'};
  if(payload){
    opts.method='POST';opts.headers={'Content-Type':'application/json'};
    opts.body=JSON.stringify(payload);
  }
  const res=await fetch('/api/fr-loading-plans',opts);
  const data=await res.json().catch(()=>({}));
  if(!res.ok||!data.ok){
    const error=Error(data.error||'Serwer nie odpowiedział.');
    error.status=res.status;throw error;
  }
  return data;
}
function lineMarkup(lines){
  if(!lines.length)return '<div class="bel-loading-empty">—</div>';
  return lines.map(line=>
    '<div class="bel-loading-line"><span>'+esc(line.displayName||line.excelName)+'</span>'+
    '<strong>'+Number(line.quantity)+'</strong></div>'
  ).join('');
}
function render(){
  button.hidden=!state.active;
  note.hidden=!state.active||!note.textContent;
  if(!state.active){panel.hidden=true;return;}
  const plans=state.plans;
  panel.hidden=plans.length===0;
  if(!plans.length)return;
  $('belLoadingCount').textContent=plans.length+' '+(plans.length===1?'trasa':
    plans.length<5?'trasy':'tras');
  toggle.setAttribute('aria-expanded',String(state.expanded));
  $('belLoadingChevron').textContent=state.expanded?'▴':'▾';
  body.hidden=!state.expanded;
  if(!state.expanded)return;
  body.innerHTML=plans.map(plan=>{
    const modules=plan.lines.filter(line=>line.kind==='MODULE');
    const parts=plan.lines.filter(line=>line.kind!=='MODULE');
    const edit=plan.status==='PLANNED'
      ?'<button type="button" class="bel-loading-edit" data-bel-loading-edit="'+
        esc(plan.id)+'">Edytuj</button>':'';
    const status=plan.status==='IN_PROGRESS'
      ?'<small class="bel-loading-in-progress">W trakcie</small>':'';
    return '<details class="bel-loading-route">'+
      '<summary><span class="bel-loading-week">Tydz. '+Number(plan.week)+
      '</span><strong>'+esc(plan.routeCode)+'</strong>'+status+
      '<span class="bel-loading-route-chevron">⌄</span></summary>'+
      '<div class="bel-loading-columns"><section><h4>MODUŁY</h4>'+
      lineMarkup(modules)+'</section><section><h4>CZĘŚCI</h4>'+
      lineMarkup(parts)+'</section></div>'+
      '<div class="bel-loading-route-actions">'+edit+'</div></details>';
  }).join('');
}
async function load(){
  const seq=++state.seq;
  try{
    const data=await api();
    if(seq!==state.seq||!state.active)return;
    state.plans=data.plans||[];
    activeNote('');
    render();
  }catch(ex){
    if(seq!==state.seq||!state.active)return;
    activeNote(ex.message||'Nie udało się pobrać list załadunkowych.');
    if(ex.status===401)state.plans=[];
    render();
  }
}
function openDialog(plan=null){
  if(!state.active||state.busy)return;
  state.editing=plan?.id||null;
  form.reset();formError('');$('belLoadingPreview').innerHTML='';
  $('belLoadingTitle').textContent=plan?'Edytuj listę załadunkową':'Dodaj listę załadunkową';
  const next=new Date();next.setDate(next.getDate()+7);
  const defaultWeek=toWeek(next);
  $('belLoadingRoute').value=plan?.routeCode||'';
  $('belLoadingWeek').value=plan?.week||defaultWeek.week;
  $('belLoadingYear').value=plan?.year||defaultWeek.year;
  $('belLoadingPaste').value=(plan?.lines||[]).map(line=>
    line.excelName+'\t'+line.quantity).join('\n');
  preview();
  dialog.showModal();
  $('belLoadingRoute').focus();
}
async function save(event){
  event.preventDefault();
  if(state.busy)return;
  let lines;
  try{lines=parsePasted($('belLoadingPaste').value);}
  catch(ex){formError(ex.message);return;}
  const routeCode=$('belLoadingRoute').value.trim().toUpperCase().replace(/\s+/g,'');
  const year=Number($('belLoadingYear').value),week=Number($('belLoadingWeek').value);
  if(!/^[A-Z0-9][A-Z0-9-]{1,39}$/.test(routeCode)){
    formError('Wpisz numer trasy, np. PL1BH.');return;
  }
  const original=state.editing?state.plans.find(row=>row.id===state.editing):null;
  if(state.editing&&!original){formError('Lista została zmieniona. Odśwież widok.');return;}
  state.busy=true;$('belLoadingSave').disabled=true;formError('');
  try{
    const saved=await api({action:'save',id:state.editing||undefined,routeCode,year,week,lines});
    dialog.close();state.editing=null;state.expanded=true;
    await load();
    if(saved.unmapped?.length)activeNote('Zapisano. '+saved.unmapped.length+
      ' pozycji nie ma jeszcze przypisanych indeksów w Admin → Części listy załadunkowej.');
  }catch(ex){formError(ex.message||'Nie udało się zapisać listy.');}
  finally{state.busy=false;$('belLoadingSave').disabled=false;}
}
button.addEventListener('click',()=>openDialog());
toggle.addEventListener('click',()=>{
  state.expanded=!state.expanded;render();
});
body.addEventListener('click',event=>{
  const edit=event.target.closest('[data-bel-loading-edit]');
  if(!edit)return;
  const plan=state.plans.find(row=>row.id===edit.dataset.belLoadingEdit);
  if(plan)openDialog(plan);
});
form.addEventListener('submit',save);
$('belLoadingCancel').addEventListener('click',()=>dialog.close());
$('belLoadingPaste').addEventListener('input',preview);
dialog.addEventListener('cancel',event=>{
  if(state.busy)event.preventDefault();
});
window.GPBSBellevilleLoadingPlans={
  onViewChange(active){
    const next=Boolean(active);
    const entering=next&&!state.active;
    state.active=next;
    if(!next)++state.seq;
    render();
    if(entering)load();
  },
  refresh(){if(state.active)return load();return Promise.resolve();}
};
})();
