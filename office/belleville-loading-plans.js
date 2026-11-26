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
  const raw=String(value||'').replace(/\r/g,'').trim();
  if(!raw)throw Error('Wklej dwie kolumny z Excela: nazwa oraz ilość.');
  const lines=raw.split('\n');
  if(lines.length>250)throw Error('Można wkleić maksymalnie 250 pozycji.');
  return lines.map((line,i)=>{
    if(!line.trim())return null;
    const columns=line.split('\t');
    if(columns.length<2)throw Error('Wiersz '+(i+1)+': skopiuj dwie kolumny (nazwa i ilość) z Excela.');
    const name=columns[0].trim().replace(/\s+/g,' ');
    const qty=columns[1].trim();
    if(name.length<2||name.length>240||/[<>]/.test(name)||
       !/^\d+$/.test(qty)||Number(qty)<1||Number(qty)>100000)
      throw Error('Wiersz '+(i+1)+': sprawdź nazwę i ilość.');
    return {excelName:name,quantity:Number(qty)};
  }).filter(Boolean);
}
function preview(){
  const host=$('belLoadingPreview');
  try{
    const rows=parsePasted($('belLoadingPaste').value);
    host.innerHTML='<strong>Podgląd · '+rows.length+' pozycji</strong>'+
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
    await api({action:'save',id:state.editing||undefined,routeCode,year,week,lines});
    dialog.close();state.editing=null;state.expanded=true;
    await load();
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
