// Read-only grouping for the Polish route parts balance placeholder.
// One row per canonical part when available; older rows are normalized by name.
// No quantity calculation happens here: unset amounts are NOT zero.
import {normalizeRoutePart} from './pl-route-parts.js';

export function groupRouteBalanceParts(rows=[]){
  const source=Array.isArray(rows)?rows:[];
  const nameOwners=new Map();
  for(const item of source){
    const id=String(item.catalogPartId||'').trim();
    const name=String(item.catalogName||item.partName||'').trim();
    if(!id||!name)continue;
    const key=normalizeRoutePart(name);
    if(!nameOwners.has(key))nameOwners.set(key,new Set());
    nameOwners.get(key).add(id);
  }

  const parts=new Map();
  for(const item of source){
    const name=String(item.catalogName||item.partName||'').trim().replace(/\s+/g,' ');
    const code=String(item.catalogCode||item.partCode||'').trim();
    if(!name&&!code)continue;
    const normalized=normalizeRoutePart(name||code);
    const candidateIds=nameOwners.get(normalized);
    const selectedId=String(item.catalogPartId||'').trim()||
      (candidateIds?.size===1?[...candidateIds][0]:'');
    const key=selectedId?'id:'+selectedId:'name:'+normalized;
    let part=parts.get(key);
    if(!part){
      part={catalogPartId:selectedId,code:'',name:name||code,codes:new Set()};
      parts.set(key,part);
    }
    if(code)part.codes.add(code);
    if(item.catalogName&&part.name!==item.catalogName)
      part.name=String(item.catalogName).trim();
  }
  return [...parts.values()].map(part=>({
    catalogPartId:part.catalogPartId,
    sap:part.codes.size===1?[...part.codes][0]:'',
    name:part.name,
    // These fields are intentionally not populated until settlement rules are agreed.
    issued:null,used:null,returned:null,warehouse:null
  })).sort((a,b)=>a.name.localeCompare(b.name,'pl-PL',{sensitivity:'base'})||
      a.sap.localeCompare(b.sap,'pl-PL'));
}
