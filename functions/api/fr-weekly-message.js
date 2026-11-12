// Publicly readable notification text only; no user, stock or push endpoint data.
import {readFrWeeklySettings} from '../../lib/fr-weekly-schedule.js';
export async function onRequestGet({env}){
  try{
    const settings=await readFrWeeklySettings(env.DB);
    return new Response(JSON.stringify({
      message:settings.message
    }),{headers:{'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }catch{
    return new Response(JSON.stringify({message:'Wymagana cotygodniowa inwentaryzacja części.'}),
      {headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }
}
