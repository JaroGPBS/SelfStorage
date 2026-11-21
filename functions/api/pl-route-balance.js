// Authenticated read-only balance for Polish routes. Does not change inventory.
import {verifyWorkerSession,workerAuthReady,workerJson} from '../../lib/pl-worker-auth.js';
import {verifyRememberSession} from '../../lib/pl-office-remember.js';
import {routePartsLineColumnExists,routePartsTableExists} from '../../lib/pl-route-parts.js';
import {groupRouteBalanceParts} from '../../lib/pl-route-balance.js';

const send=(message,status)=>workerJson({ok:false,error:message},status);
const tableExists=async(db,name)=>Boolean(await db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
).bind(name).first());
const polishToday=()=>{
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date());
  const date=Object.fromEntries(parts.filter(x=>
    ['year','month','day'].includes(x.type)).map(x=>[x.type,x.value]));
  return date.year+'-'+date.month+'-'+date.day;
};

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
    const today=polishToday();
    if(!await tableExists(env.DB,'pl_route_lines')||
       !await tableExists(env.DB,'pl_routes')){
      return workerJson({ok:true,...groupRouteBalanceParts([],today)});
    }
    const columns=(await env.DB.prepare('PRAGMA table_info(pl_route_lines)').all())
      .results||[];
    const has=field=>columns.some(x=>x.name===field);
    const hasLink=await routePartsLineColumnExists(env.DB);
    const hasCatalogue=hasLink&&await routePartsTableExists(env.DB);
    const hasApprovals=await tableExists(env.DB,'pl_route_return_approvals');
    const optional=(field,alias)=>has(field)
      ?'l.'+field+' AS '+alias:'NULL AS '+alias;
    const query=
      'SELECT r.route_date AS routeDate,r.status AS routeStatus,'+
      'l.part_name AS partName,l.part_code AS partCode,l.quantity,'+
      optional('confirmed_quantity','confirmedQuantity')+','+
      optional('verified_quantity','verifiedQuantity')+','+
      optional('returned_quantity','returnedQuantity')+','+
      optional('return_location','returnLocation')+','+
      (hasCatalogue
        ?'l.catalog_part_id AS catalogPartId,c.part_name AS catalogName,'+
          'c.part_code AS catalogCode,'
        :'NULL AS catalogPartId,NULL AS catalogName,NULL AS catalogCode,')+
      (hasApprovals
        ?'ap.quantity AS approvedReturnQuantity,ap.location AS approvedReturnLocation '
        :'NULL AS approvedReturnQuantity,NULL AS approvedReturnLocation ')+
      'FROM pl_route_lines l JOIN pl_routes r ON r.id=l.route_id '+
      (hasCatalogue?'LEFT JOIN pl_route_part_catalog c ON c.id=l.catalog_part_id ':'')+
      (hasApprovals
        ?'LEFT JOIN pl_route_return_approvals ap '+
          'ON ap.route_id=l.route_id AND ap.position=l.position ':'')+
      'ORDER BY r.route_date,l.route_id,l.position';
    const rows=(await env.DB.prepare(query).all()).results||[];
    return workerJson({ok:true,...groupRouteBalanceParts(rows,today)});
  }catch(error){
    console.error('PL route balance unavailable',error?.name||'Error');
    return send('Nie udało się obliczyć bilansu części z tras.',503);
  }
}
