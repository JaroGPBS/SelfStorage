// Legacy Apps Script gateway disabled. French mobile uses /api/fr (D1 only).
export async function onRequestPost() {
  return Response.json({ok:false,error:'Stare API Google jest wyłączone. Odśwież aplikację GPBS Storage.'},
    {status:410,headers:{'Cache-Control':'no-store'}});
}
export function onRequestGet() {
  return Response.json({ok:true,service:'GPBS Storage',legacyAppsScript:false},
    {headers:{'Cache-Control':'no-store'}});
}
