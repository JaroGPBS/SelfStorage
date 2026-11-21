// A route may be corrected only before the crew has confirmed any line.
// Both Office edits and photo uploads use the same server-side D1 rule.
export const ROUTE_EDITABLE_STATUS='AWAITING_CONFIRMATION';
export const ROUTE_SETTLEMENT_COLUMNS=['confirmed_quantity','returned_quantity','return_location'];

export async function routeEditablePredicate(db,routeAlias='r'){
  const info=await db.prepare('PRAGMA table_info(pl_route_lines)').all();
  const columns=new Set((info.results||[]).map(row=>row.name));
  const settled=ROUTE_SETTLEMENT_COLUMNS.filter(name=>columns.has(name));
  const noAcknowledgments=settled.length
    ?' AND NOT EXISTS (SELECT 1 FROM pl_route_lines checked WHERE checked.route_id='+
      routeAlias+'.id AND ('+settled.map(name=>'checked.'+name+' IS NOT NULL').join(' OR ')+'))'
    :'';
  return routeAlias+".status='"+ROUTE_EDITABLE_STATUS+"'"+noAcknowledgments;
}
export function canEditRoute(status,lines){
  return status===ROUTE_EDITABLE_STATUS&&Array.isArray(lines)&&lines.every(line=>
    line.confirmedQuantity==null&&line.returnedQuantity==null&&line.returnLocation==null);
}
