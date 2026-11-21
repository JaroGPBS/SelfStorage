// Authenticated read-only suggestions for the Polish route catalogue.
import {verifyWorkerSession,workerAuthReady,workerJson} from '../../lib/pl-worker-auth.js';
import {verifyRememberSession} from '../../lib/pl-office-remember.js';
import {listRouteParts} from '../../lib/pl-route-parts.js';

export async function onRequestGet({request,env}){
  if(!env.DB||!workerAuthReady(env))
    return workerJson({ok:false,error:'Panel biurowy jest niedostępny.'},503);
  let user;
  try{
    user=await verifyWorkerSession(request,env)||await verifyRememberSession(request,env);
  }catch{
    return workerJson({ok:false,error:'Nie udało się sprawdzić sesji.'},503);
  }
  if(!user)return workerJson({ok:false,error:'Zaloguj się ponownie.'},401);
  if(!user.apps?.office||!user.markets?.PL)
    return workerJson({ok:false,error:'Brak dostępu do tras PL.'},403);
  const q=(new URL(request.url)).searchParams.get('q')||'';
  if(q.length>100)return workerJson({ok:false,error:'Zbyt długie wyszukiwanie.'},400);
  try{
    const parts=await listRouteParts(env.DB,q,35);
    return workerJson({ok:true,parts});
  }catch(error){
    console.error('PL route part lookup failed',error?.name||'Error');
    return workerJson({ok:false,error:'Nie udało się pobrać katalogu części.'},503);
  }
}
