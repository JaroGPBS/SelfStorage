// Read-only PL routes balance. No D1 stock writes or inferred warehouse quantities.
import {normalizeRoutePart} from './pl-route-parts.js';

const nonnegativeInt=value=>{
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>=0?n:null;
};
const normalizedName=item=>String(item.catalogName||item.partName||item.partCode||'')
  .trim().replace(/\s+/g,' ');

// Week begins on Monday. Comparisons operate on ISO YYYY-MM-DD strings.
export function routeBalanceWeek(today){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(today||'')))
    throw Error('Nieprawidłowa data bilansu.');
  const day=new Date(today+'T00:00:00Z');
  if(Number.isNaN(day.valueOf())||day.toISOString().slice(0,10)!==today)
    throw Error('Nieprawidłowa data bilansu.');
  const monday=new Date(day);
  monday.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);
  const sunday=new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate()-1);
  const thursday=new Date(monday);
  thursday.setUTCDate(monday.getUTCDate()+3);
  const jan4=new Date(Date.UTC(thursday.getUTCFullYear(),0,4));
  const firstMonday=new Date(jan4);
  firstMonday.setUTCDate(jan4.getUTCDate()-(jan4.getUTCDay()+6)%7);
  const week=1+Math.floor((monday.getTime()-firstMonday.getTime())/(7*86400000));
  return {weekStart:monday.toISOString().slice(0,10),
    closedThrough:sunday.toISOString().slice(0,10),week,year:thursday.getUTCFullYear()};
}

const settledLine=row=>{
  if(row.routeStatus!=='COMPLETED')return null;
  // A final weekly report supplies actual accepted quantity and return count.
  // Until then, using the original issued quantity would invent consumption.
  const accepted=nonnegativeInt(row.verifiedQuantity??row.confirmedQuantity);
  const returned=nonnegativeInt(row.returnedQuantity);
  if(accepted===null||returned===null||returned>accepted)return null;
  if(returned>0&&(
    nonnegativeInt(row.approvedReturnQuantity)!==returned||
    String(row.approvedReturnLocation||'').trim()!==
      String(row.returnLocation||'').trim()
  ))return null;
  return {used:accepted-returned,returned};
};

export function groupRouteBalanceParts(rows=[],today){
  const {weekStart,closedThrough,week,year}=routeBalanceWeek(today);
  const source=Array.isArray(rows)?rows:[];
  // Legacy lines without an ID join an existing canonical ID by unique name
  // only. A name shared by multiple IDs is never merged speculatively.
  const nameOwners=new Map();
  for(const row of source){
    const id=String(row.catalogPartId||'').trim();
    const key=normalizeRoutePart(normalizedName(row));
    if(!id||!key)continue;
    if(!nameOwners.has(key))nameOwners.set(key,new Set());
    nameOwners.get(key).add(id);
  }
  const parts=new Map();
  let firstDocumentDate=null;
  let unsettledHistorical=0;
  let unsettledHistoricalUnits=0;
  let currentWeekIssued=0;
  for(const row of source){
    const name=normalizedName(row);
    if(!name)continue;
    const date=String(row.routeDate||'');
    const qty=nonnegativeInt(row.quantity);
    if(qty===null||!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
    if(!firstDocumentDate||date<firstDocumentDate)firstDocumentDate=date;
    const normalized=normalizeRoutePart(name);
    const ids=nameOwners.get(normalized);
    const id=String(row.catalogPartId||'').trim()||
      (ids?.size===1?[...ids][0]:'');
    const key=id?'id:'+id:'name:'+normalized;
    let part=parts.get(key);
    if(!part){
      part={catalogPartId:id,name,issued:0,used:0,returned:0,warehouse:null,
        inRoute:0,currentWeekIssued:0,historicalUnsettled:0,_codes:new Set(),
        _canonicalCode:''};
      parts.set(key,part);
    }
    const code=String(row.catalogCode||row.partCode||'').trim();
    if(code)part._codes.add(code);
    if(row.catalogCode)part._canonicalCode=String(row.catalogCode).trim();
    if(row.catalogName)part.name=String(row.catalogName).trim();
    const settled=settledLine(row);
    if(date<weekStart){
      part.issued+=qty;
      if(settled){
        part.used+=settled.used;
        part.returned+=settled.returned;
      }else{
        part.historicalUnsettled+=qty;
        unsettledHistorical++;
        unsettledHistoricalUnits+=qty;
      }
    }else if(date>=weekStart){
      // Current week is kept entirely outside cumulative completed weeks.
      part.currentWeekIssued+=qty;
      currentWeekIssued+=qty;
      if(!settled)part.inRoute+=qty;
    }
  }
  const items=[...parts.values()].map(part=>{
    const { _codes,_canonicalCode,...record }=part;
    return {...record,sap:_canonicalCode||(_codes.size===1?[..._codes][0]:'')};
  }).sort((a,b)=>a.name.localeCompare(b.name,'pl-PL',{sensitivity:'base'})||
      a.sap.localeCompare(b.sap,'pl-PL'));
  return {parts:items,period:{weekStart,closedThrough,week,year,
    firstDocumentDate,currentWeekIssued,unsettledHistorical,unsettledHistoricalUnits}};
}
