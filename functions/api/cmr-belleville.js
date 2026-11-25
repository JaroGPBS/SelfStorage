// Authenticated Belleville Office CMR configuration.
// Weights are read-only here; their editors live in Admin. Carriers are edited
// ONLY in Office/Belleville and stored in shared D1 (including optional PNG).
import {verifyWorkerSession,workerAuthReady,workerJson} from '../../lib/pl-worker-auth.js';
import {verifyRememberSession} from '../../lib/pl-office-remember.js';
import {listCmrCarriers,upsertCmrCarrier,deleteCmrCarrier,
  listCmrModuleWeights,listCmrPartWeights} from '../../lib/cmr-belleville-config.js';

const fail=(msg,status=400)=>workerJson({ok:false,error:msg},status);
async function allowedUser(request,env){
  if(!workerAuthReady(env))return null;
  const user=await verifyWorkerSession(request,env)||
    await verifyRememberSession(request,env);
  if(!user?.apps?.office||!user?.markets?.FR||
     !['ADMIN','KIEROWNIK','KOORDYNATOR','MAGAZYNIER'].includes(user.role))
    return null;
  return user;
}
export async function onRequestGet({request,env}){
  let user;
  try{user=await allowedUser(request,env);}catch(_){return fail('Nie udało się sprawdzić sesji.',503);}
  if(!user)return fail('Brak uprawnień do Office Francja.',403);
  try{
    const action=new URL(request.url).searchParams.get('view')||'carriers';
    if(action==='carriers')
      return workerJson({ok:true,carriers:await listCmrCarriers(env.DB)});
    if(action==='weights'){
      // D1 schema setup runs once per table; avoid concurrent CREATE TABLE
      // operations on the first request after deployment.
      const modules=await listCmrModuleWeights(env.DB);
      const parts=await listCmrPartWeights(env.DB);
      return workerJson({ok:true,modules:modules.weights,parts});
    }
    return fail('Nieznany widok CMR.',404);
  }catch(err){
    console.error('Belleville CMR lookup failed',err?.name||'Error');
    return fail('Nie udało się pobrać konfiguracji CMR.',503);
  }
}
export async function onRequestPost({request,env}){
  const url=new URL(request.url);
  if(request.headers.get('Origin')!==url.origin)
    return fail('Niedozwolona domena.',403);
  if(!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
    return fail('Wymagany format JSON.',415);
  let user;
  try{user=await allowedUser(request,env);}catch(_){return fail('Błąd sesji.',503);}
  if(!user)return fail('Brak dostępu do Office Francja.',403);
  if(!['ADMIN','KIEROWNIK','KOORDYNATOR'].includes(user.role))
    return fail('Brak uprawnień do edycji przewoźników.',403);
  let body;
  try{
    const raw=await request.text();
    if(raw.length>270000)return fail('Zbyt duża pieczątka PNG.',413);
    body=JSON.parse(raw);
  }catch(_){return fail('Nieprawidłowe dane.',400);}
  if(!body||typeof body!=='object'||Array.isArray(body))
    return fail('Nieprawidłowe dane.',400);
  try{
    if(body.action==='saveCarrier'){
      const carrier=await upsertCmrCarrier(env.DB,body);
      return workerJson({ok:true,carrier});
    }
    if(body.action==='deleteCarrier'){
      await deleteCmrCarrier(env.DB,body.id);
      return workerJson({ok:true});
    }
    return fail('Nieznana operacja CMR.',400);
  }catch(err){
    if(/UNIQUE constraint/i.test(String(err?.message||'')))
      return fail('Przewoźnik o tej nazwie już istnieje.',409);
    if(/SQLITE|D1_ERROR/i.test(String(err?.message||''))){
      console.error('Belleville carrier D1 failed',err?.name||'Error');
      return fail('Nie udało się zapisać przewoźnika w D1.',503);
    }
    return fail(err.message||'Nieprawidłowe dane przewoźnika.',400);
  }
}
