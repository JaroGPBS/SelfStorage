// Compatibility for still-open mobile sessions and saved offline queues.
// Old /api never calls Google. Supported French operations go to authenticated D1.
import {onRequestPost as handleFrenchD1} from './api/fr.js';

const FR_D1_ACTIONS=new Set([
  'LOGIN','POBIERZ_DANE_STARTOWE','SPRAWDZ_SYNC_AUTA',
  'POBIERZ_STAN_AUTA','AKTUALIZUJ_STAN_AUTA','USTAW_SAMOCHOD',
  'SKAN_MAGAZYNU','ZAPISZ_SESJE','ZAKONCZ_WIZYTE','PING'
]);

export async function onRequestPost(context) {
  let action='';
  try {
    const payload=await context.request.clone().json();
    action=String(payload?.action||'').trim().toUpperCase();
  } catch {}
  if(!FR_D1_ACTIONS.has(action)) {
    return Response.json({
      ok:false,
      error:'Ta operacja starego API jest wyłączona. Otwórz aktualną wersję GPBS Storage.'
    },{status:410,headers:{'Cache-Control':'no-store'}});
  }
  return handleFrenchD1(context);
}

export function onRequestGet() {
  return Response.json({ok:true,service:'GPBS Storage',legacyAppsScript:false},
    {headers:{'Cache-Control':'no-store'}});
}
