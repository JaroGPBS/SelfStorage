(function(){
  'use strict';
  const report=document.getElementById('report');
  const status=document.getElementById('printState');
  const printButton=document.getElementById('printNow');
  const closeButton=document.getElementById('printClose');
  closeButton.addEventListener('click',()=>window.close());
  printButton.addEventListener('click',()=>window.print());
  const params=new URLSearchParams(window.location.search);
  const id=params.get('id');
  const week=params.get('week');
  const embedded=params.get('embed')==='1';
  const balance=params.get('balance')==='1';
  if(balance)document.documentElement.classList.add('pl-route-balance-print');
  if(embedded)document.documentElement.classList.add('pl-route-print-embedded');
  const api=window.PlRouteExport;
  function notifyParent(type){
    if(embedded&&window.parent!==window)
      window.parent.postMessage({type,routeId:balance?'BALANCE':id},window.location.origin);
  }
  const showError=message=>{
    status.hidden=false;
    status.classList.add('is-error');
    status.textContent=message||'Nie udało się przygotować karty trasy.';
    printButton.disabled=true;
    notifyParent('gpbs-route-export-preview-error');
  };
  async function main(){
    if(!api)throw Error('Moduł eksportu nie został załadowany.');
    if(balance){
      const data=await api.getBalance();
      report.innerHTML=api.balanceCard(data);
      printButton.disabled=false;
      document.title='GPBS Storage – Bilans części';
      status.remove();
      notifyParent('gpbs-route-export-preview-ready');
      return;
    }
    let items=[];
    if(id){
      items=[await api.getRoute(id)];
    }else if(/^\d{4}-W\d{2}$/.test(week||'')){
      const [year,number]=week.split('-W').map(Number);
      const response=await fetch('/api/pl-routes?scope=history',{
        credentials:'same-origin',cache:'no-store'
      });
      const data=await response.json().catch(()=>null);
      if(!response.ok||!data?.ok)
        throw Error(data?.error||'Nie udało się pobrać tras z historii.');
      const ids=(data.routes||[]).filter(route=>{
        const wk=api.isoWeek(route.routeDate);
        return wk?.year===year&&wk.week===number;
      }).map(route=>route.id);
      items=await api.getRoutes(ids);
    }else{
      throw Error('Nie określono trasy do druku.');
    }
    if(!items.length)throw Error('Nie znaleziono tras do eksportu.');
    report.innerHTML=items.map(api.reportCard).join('');
    printButton.disabled=false;
    document.title=items.length===1
      ?'Karta trasy '+(items[0].route.routeNumber||'GPBS')
      :'GPBS Storage – Karty tras '+week;
    status.remove();
    notifyParent('gpbs-route-export-preview-ready');
  }
  main().catch(error=>showError(error.message));
})();