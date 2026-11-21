// Parts appearing on Polish routes; table structure only, no stock movements.
import {verifyWorkerSession,workerAuthReady,workerJson} from '../../lib/pl-worker-auth.js';
import {verifyRememberSession} from '../../lib/pl-office-remember.js';
import {routePartsLineColumnExists,routePartsTableExists} from '../../lib/pl-route-parts.js';
import {groupRouteBalanceParts} from '../../lib/pl-route-balance.js';

const send=(message,status)=>workerJson({ok:false,error:message},status);

export async function onRequestGet({request,env}){
  if(!workerAuthReady(env)||!env.DB)return send('Panel biurowy nie jest skonfigurowany.',503);
  let user;
  try{
    user=await verifyWorkerSession(request,env)||await verifyRememberSession(request,env);
  }catch{
    return send('Nie można potwierdzić sesji.',503);
  }
  if(!user)return send('Zaloguj się ponownie.',401);
  if(!user.apps?.office||!user.markets?.PL)
    return send('Brak dostępu do tras w Polsce.',403);
  try{
    const existing=await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_route_lines'"
    ).first();
    if(!existing)return workerJson({ok:true,parts:[]});
    const hasLink=await routePartsLineColumnExists(env.DB);
    const hasCatalogue=hasLink&&await routePartsTableExists(env.DB);
    const query=hasCatalogue
      ?'SELECT DISTINCT l.part_name AS partName,l.part_code AS partCode,'+
        'l.catalog_part_id AS catalogPartId,c.part_name AS catalogName,'+
        'c.part_code AS catalogCode FROM pl_route_lines l '+
        'LEFT JOIN pl_route_part_catalog c ON c.id=l.catalog_part_id'
      :'SELECT DISTINCT l.part_name AS partName,l.part_code AS partCode,'+
        'NULL AS catalogPartId,NULL AS catalogName,NULL AS catalogCode '+
        'FROM pl_route_lines l';
    const result=await env.DB.prepare(query).all();
    return workerJson({ok:true,parts:groupRouteBalanceParts(result.results||[])});
  }catch(error){
    console.error('PL route balance list unavailable',error?.name||'Error');
    return send('Nie udało się odczytać części z tras.',503);
  }
}
