// GPBS Storage - independent office API (Poland): read-only views and guarded new-part creation.
// Existing /panel/ admin API and /pl/ warehouse operations are untouched.
import {verifyWorkerSession,workerAuthReady,workerJson} from '../../lib/pl-worker-auth.js';
import {createRememberToken,verifyRememberSession,officeRememberCookie} from '../../lib/pl-office-remember.js';
import {createUnverifiedPart} from '../../lib/pl-part-create.js';
import {createSharedCataloguePart} from '../../lib/shared-catalogue-create.js';
import {getVehicleCatalogue} from '../../lib/vehicle-catalogue-service.js';
import {readFrWeeklySettings,weeklyInventoryStatus} from '../../lib/fr-weekly-schedule.js';
import {frenchBoxDocuments,frenchBoxDocumentLines} from '../../lib/fr-office-movements.js';
import {readFrBoxOfficeParts} from '../../lib/fr-box-office-stock.js';
import {getPhotoObject,readPhotoResponse} from '../../lib/pl-r2-photos.js';

const ALLOWED=new Set(['ADMIN','KIEROWNIK','KOORDYNATOR','MAGAZYNIER','EKIPA']);
const WAREHOUSE=/^[A-Z0-9-]{2,50}$/;
const PART=/^[A-Za-z0-9_-]{1,100}$/;
const SESSION=/^PL-SES-[a-f0-9-]{36}$/;
const INVENTORY=/^PL-INV-[a-f0-9-]{36}$/;
const error=(message,status=400)=>workerJson({ok:false,error:message},status);

async function selectRows(db,sql,values=[]){
  const query=db.prepare(sql).bind(...values);
  const response=await query.all();
  return response.results||[];
}
async function tableExists(db,name){
  const row=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(name).first();
  return Boolean(row);
}
// Office-only cross-market warehouse grants; mobile PL session remains limited to PL.
async function officeWarehouses(db,userId,markets,ownerFrenchBoxes=false){
  const rows=await selectRows(db,
    "SELECT w.id,w.name,w.country_code FROM user_warehouse_access a "+
    "JOIN warehouses w ON w.id=a.warehouse_id "+
    "WHERE a.user_id=? AND w.active=1 AND w.country_code IN ('PL','FR') "+
    "ORDER BY w.country_code,w.name",[userId]);
  const allowed=rows.filter(row=>Boolean(markets?.[row.country_code]));
  // The protected owner can inspect existing BOX records without needing a
  // fictitious staff assignment. Other Office users retain their D1 grants.
  if(ownerFrenchBoxes&&markets?.FR){
    const boxes=await selectRows(db,
      "SELECT id,name,country_code FROM warehouses "+
      "WHERE active=1 AND country_code='FR' AND id IN ('FR-TOULOUSE','FR-PARIS') "+
      "ORDER BY CASE id WHEN 'FR-TOULOUSE' THEN 0 ELSE 1 END");
    for(const box of boxes)if(!allowed.some(w=>w.id===box.id))allowed.push(box);
  }
  return allowed;
}
// The long-lived cookie is issued only after a successful normal PIN login.
// A different cookie name and audience keep it unusable in the warehouse app.
export async function onRequestPost({request,env}){
  if(!workerAuthReady(env))return error('Panel biurowy nie jest skonfigurowany.',503);
  const url=new URL(request.url);
  if(request.headers.get('Origin')!==url.origin)return error('Niedozwolona domena.',403);
  if((request.headers.get('Content-Type')||'').toLowerCase().startsWith('multipart/form-data;')){
    if(url.searchParams.get('action')!=='createFrenchCatalogPart')
      return error('Nieznana operacja.',400);
    if(Number(request.headers.get('Content-Length')||0)>22*1024*1024)
      return error('Zdjęcie przekracza 20 MB.',413);
    try{
      const user=await verifyWorkerSession(request,env)||
        await verifyRememberSession(request,env);
      if(!user)return error('Zaloguj się ponownie.',401);
      if(!user.apps?.office||!ALLOWED.has(user.role)||user.features?.stocks===false)
        return error('Brak uprawnień do katalogu.',403);
      const form=await request.formData();
      const key=String(form.get('warehouseKey')||'');
      const id=String(form.get('warehouseId')||'');
      if(!['belleville','toulouse','paris'].includes(key))
        return error('Nieprawidłowy magazyn.',400);
      const isOwner=user.role==='ADMIN'&&String(user.nickname||'').trim().toUpperCase()==='JJ';
      if(id){
        const grants=await officeWarehouses(env.DB,user.id,user.markets);
        const warehouse=grants.find(w=>w.id===id&&w.country_code==='FR');
        const norm=String(warehouse?.name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
          .toLowerCase().replace(/ł/g,'l').replace(/[^a-z0-9]/g,'').replace(/^magazyn/,'');
        const permitted={
          belleville:['belleville'],
          toulouse:['toulouse','toulosebox','toulousebox','boxtoulouse','tuluza','tuluzabox','boxtuluza'],
          paris:['paris','parisbox','boxparis','paryz','paryzbox','boxparyz']
        }[key];
        if(!warehouse||!permitted.includes(norm))
          return error('Brak dostępu do wybranego magazynu.',403);
      }else if(!isOwner)return error('Brak dostępu do wybranego magazynu.',403);
      const part=await createSharedCataloguePart(env,form);
      return workerJson({ok:true,part});
    }catch(err){
      console.error('French Office catalogue create failed',err?.name||'Error');
      return error(err?.status?err.message:'Nie udało się dodać części.',err?.status||503);
    }
  }
  if(!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
    return error('Wymagany format JSON.',415);
  let body;
  try{
    const raw=await request.text();
    if(raw.length>260000)return error('Zbyt duże żądanie.',413);
    body=JSON.parse(raw);
    if(!body||typeof body!=='object'||Array.isArray(body)||
       (body.action!=='newPart'&&raw.length>200))
      return error('Nieprawidłowe dane.',400);
  }catch{return error('Nieprawidłowe dane.',400);}
  if(body.action==='newPart'){
    const warehouseId=String(body.warehouseId||'');
    if(!WAREHOUSE.test(warehouseId))return error('Nieprawidłowy magazyn.',400);
    try{
      const user=await verifyWorkerSession(request,env) ||
        await verifyRememberSession(request,env);
      if(!user)return error('Zaloguj się ponownie.',401);
      if(!user.apps?.office||!ALLOWED.has(user.role)||user.features?.stocks===false)
        return error('Brak uprawnień do katalogu.',403);
      if(!user.warehouses.some(w=>w.id===warehouseId))
        return error('Brak uprawnień do wybranego magazynu.',403);
      const warehouse=await env.DB.prepare(
        "SELECT id FROM warehouses WHERE id=? AND country_code='PL' AND active=1"
      ).bind(warehouseId).first();
      if(!warehouse)return error('Magazyn jest niedostępny.',404);
      if(!await tableExists(env.DB,'pl_part_verifications'))
        return error('Brak tabeli weryfikacji nowych części.',503);
      return await createUnverifiedPart(env.DB,warehouseId,user.id,body);
    }catch(ex){
      console.error('Office new-part creation failed',ex?.name||'Error');
      return error('Nie udało się dodać nowej części.',503);
    }
  }
  if(body.action==='forget'){
    return workerJson({ok:true},200,{'Set-Cookie':officeRememberCookie('',0)});
  }
  if(body?.action!=='remember')return error('Nieznana akcja.',400);
  try{
    const user=await verifyWorkerSession(request,env);
    if(!user||!user.apps?.office||!ALLOWED.has(user.role))return error('Zaloguj się ponownie.',401);
    const token=await createRememberToken(env,user.id);
    return workerJson({ok:true,rememberedForDays:30},200,
      {'Set-Cookie':officeRememberCookie(token)});
  }catch(err){
    console.error('Office remember login error',err?.name||'Error');
    return error('Nie udało się zapamiętać logowania.',503);
  }
}

export async function onRequestGet({request,env}){
  if(!workerAuthReady(env))return error('Panel biurowy nie jest skonfigurowany.',503);
  let user;
  try{user=await verifyWorkerSession(request,env) || await verifyRememberSession(request,env);}
  catch{return error('Nie można potwierdzić sesji.',503);}
  if(!user)return error('Zaloguj się do panelu.',401);
  if(!user.apps?.office||!ALLOWED.has(user.role))return error('Brak dostępu do panelu biurowego.',403);
  const url=new URL(request.url);
  let authorizedWarehouses;
  try{
    const isOwner=user.role==='ADMIN'&&
      String(user.nickname||'').trim().toUpperCase()==='JJ';
    authorizedWarehouses=await officeWarehouses(env.DB,user.id,user.markets,isOwner);
  }catch(e){console.error('Office grants lookup failed',e?.name||'Error');return error('Brak dostępu do magazynów.',503);}
  if(!authorizedWarehouses.length)return error('Brak przypisanych magazynów Office.',403);
  const view=url.searchParams.get('view')||'warehouses';
  const permissions=user.features||{};
  const needed={
    stocks:'stocks',part:'stocks',partPhoto:'stocks',nokStock:'stocks',
    frCatalog:'stocks',frBoxCatalog:'stocks',frCatalogPhoto:'stocks',vehicleCatalog:'stocks',vehicleCrews:'stocks',vehicleInventories:'stocks',
    inventories:'inventory',inventoryLines:'inventory'
  }[view];
  if(needed&&permissions[needed]===false)return error('Brak uprawnień do tej funkcji.',403);
  if(view==='documents'||view==='document'){
    const direction=url.searchParams.get('direction');
    if(direction==='PZ'&&permissions.pz===false||
       direction==='WZ'&&permissions.wz===false)
      return error('Brak uprawnień do tej operacji.',403);
  }
  if(view==='warehouses'){
    // Only this authenticated employee's given name is needed for the greeting.
    // No surname, phone, or other private profile data leaves the server.
    let firstName='';
    try{
      if(await tableExists(env.DB,'user_private_profiles')){
        const profile=await env.DB.prepare(
          'SELECT first_name FROM user_private_profiles WHERE user_id=? LIMIT 1'
        ).bind(user.id).first();
        firstName=String(profile?.first_name||'').trim().slice(0,60);
      }
    }catch(err){
      console.error('Office greeting name unavailable',err?.name||'Error');
    }
    return workerJson({ok:true,user:{...user,firstName},warehouses:authorizedWarehouses});
  }
  if(view==='vehicleInventories'){
    // Inventory history belongs to the vehicle, not the currently logged-in crew.
    const privileged=user.role==='ADMIN'&&
      String(user.nickname||'').trim().toUpperCase()==='JJ';
    if(!privileged&&!authorizedWarehouses.some(w=>w.country_code==='FR'))
      return error('Brak dostępu do samochodów francuskich.',403);
    const vehicleId=String(url.searchParams.get('vehicleId')||'');
    if(!/^[A-Za-z0-9_-]{8,120}$/.test(vehicleId))
      return error('Nieprawidłowy samochód.',400);
    try{
      if(!await tableExists(env.DB,'fr_vehicle_events')||
         !await tableExists(env.DB,'fr_vehicle_event_lines'))
        return workerJson({ok:true,inventories:[]});
      const rows=(await env.DB.prepare(
        'SELECT e.id,e.user_id AS userId,e.vehicle_id AS vehicleId,'+
        'e.event_at AS date,l.part_id AS partId,'+
        'l.quantity_before AS qtyBefore,l.quantity_after AS qtyAfter '+
        'FROM fr_vehicle_events e '+
        'JOIN fr_vehicle_event_lines l ON l.event_id=e.id '+
        "WHERE e.vehicle_id=? AND e.type='INWENTARYZACJA' "+
        'ORDER BY e.event_at DESC,e.id DESC,l.part_id'
      ).bind(vehicleId).all()).results||[];
      const map=new Map();
      for(const line of rows){
        if(!map.has(line.id))map.set(line.id,{
          id:line.id,userId:line.userId,vehicleId:line.vehicleId,
          date:line.date,lines:[]
        });
        map.get(line.id).lines.push({
          partId:line.partId,
          before:line.qtyBefore===null?null:Number(line.qtyBefore),
          counted:Number(line.qtyAfter)
        });
      }
      return workerJson({ok:true,inventories:[...map.values()]});
    }catch(err){
      console.error('FR vehicle inventory history lookup',err?.name||'Error');
      return error('Nie udało się pobrać historii inwentaryzacji.',503);
    }
  }
  if(view==='vehicleCrews'){
    // A crew belongs to a market, not permanently to an outsourced warehouse.
    const privileged=user.role==='ADMIN'&&
      String(user.nickname||'').trim().toUpperCase()==='JJ';
    const frAccess=authorizedWarehouses.filter(w=>w.country_code==='FR');
    if(!privileged&&!frAccess.length)
      return error('Brak dostępu do ekip francuskich.',403);
    try{
      const settingsExist=await tableExists(env.DB,'user_access_settings');
      const accessFilter=settingsExist
        ?("EXISTS(SELECT 1 FROM user_access_settings s "+
          "WHERE s.user_id=u.id AND s.fr_enabled=1) OR "+
          "(NOT EXISTS(SELECT 1 FROM user_access_settings s WHERE s.user_id=u.id) "+
          "AND EXISTS(SELECT 1 FROM user_warehouse_access a JOIN warehouses w "+
          "ON w.id=a.warehouse_id WHERE a.user_id=u.id AND w.country_code='FR'))")
        :("EXISTS(SELECT 1 FROM user_warehouse_access a JOIN warehouses w "+
          "ON w.id=a.warehouse_id WHERE a.user_id=u.id AND w.country_code='FR')");
      const rows=await env.DB.prepare(
        'SELECT u.id,u.name FROM users u '+
        "WHERE u.active=1 AND u.role_code='EKIPA' AND ("+accessFilter+") "+
        'ORDER BY u.name COLLATE NOCASE LIMIT 250'
      ).all();
      const crews=(rows.results||[]).map(x=>({
        id:x.id,team:x.name,plate:null,vehicleId:null,stock:{},
        inventory:false,lastInventory:null,missedWeeks:[],inventoryDue:false
      }));
      const hasUsage=await tableExists(env.DB,'fr_vehicle_usage');
      const hasEvents=await tableExists(env.DB,'fr_vehicle_events');
      const hasSessions=await tableExists(env.DB,'fr_sessions');
      if(hasUsage&&crews.length){
        const usage=(await env.DB.prepare(
          'SELECT a.user_id,a.vehicle_id,v.registration_number '+
          'FROM fr_vehicle_usage a JOIN vehicles v ON v.id=a.vehicle_id AND v.active=1'
        ).all()).results||[];
        const byUser=new Map(usage.map(x=>[x.user_id,x]));
        for(const crew of crews){
          const record=byUser.get(crew.id);
          if(record){crew.plate=record.registration_number;crew.vehicleId=record.vehicle_id;}
        }
        const balances=(await env.DB.prepare(
          'SELECT vehicle_id,part_id,quantity FROM vehicle_stock'
        ).all()).results||[];
        const stocks=new Map();
        for(const item of balances){
          if(!stocks.has(item.vehicle_id))stocks.set(item.vehicle_id,{});
          stocks.get(item.vehicle_id)[item.part_id]=Number(item.quantity);
        }
        for(const crew of crews)if(crew.vehicleId)crew.stock=stocks.get(crew.vehicleId)||{};
        if(hasEvents){
          const events=(await env.DB.prepare(
            "SELECT vehicle_id,user_id,MAX(event_at) AS last_at FROM fr_vehicle_events "+
            "WHERE type='INWENTARYZACJA' GROUP BY vehicle_id,user_id"
          ).all()).results||[];
          const last=new Map(events.map(x=>[x.user_id+'::'+x.vehicle_id,x.last_at]));
          for(const crew of crews)if(crew.vehicleId){
            crew.lastInventory=last.get(crew.id+'::'+crew.vehicleId)||null;
            crew.inventory=Boolean(crew.lastInventory);
          }
        }
      }
      // Weekly status belongs to the crew (user_id), not to a registration plate.
      // Tracking begins only when Admin enables the schedule; historical weeks are
      // never manufactured retroactively.
      const weekly=await readFrWeeklySettings(env.DB);
      if(weekly.enabled&&crews.length&&hasEvents){
        const recent=(await env.DB.prepare(
          "SELECT user_id,event_at FROM fr_vehicle_events "+
          "WHERE type='INWENTARYZACJA' AND event_at >= "+
          "datetime(?, '-8 days') ORDER BY event_at DESC"
        ).bind(weekly.startedAt||new Date().toISOString()).all()).results||[];
        if(await tableExists(env.DB,'fr_car_claims')){
          const pending=(await env.DB.prepare(
            "SELECT user_id,updated_at AS event_at FROM fr_car_claims "+
            "WHERE status='PENDING' AND inventory_json IS NOT NULL"
          ).all()).results||[];
          recent.push(...pending);
        }
        const byCrew=new Map();
        for(const e of recent) {
          if(!byCrew.has(e.user_id))byCrew.set(e.user_id,[]);
          byCrew.get(e.user_id).push(e);
        }
        for(const crew of crews){
          const status=weeklyInventoryStatus(weekly,byCrew.get(crew.id)||[]);
          crew.missedWeeks=status.missedWeeks;
          crew.inventoryDue=status.due;
        }
      }
      let history=[];
      if(hasSessions&&await tableExists(env.DB,'fr_session_lines')){
        history=(await env.DB.prepare(
          'SELECT s.id AS sessionId,s.user_id AS userId,s.vehicle_id AS vehicleId,'+
          's.warehouse_id AS warehouseId,w.name AS warehouseName,s.saved_at AS date,'+
          'l.direction,l.quantity,p.id AS partId,p.name AS partName '+
          'FROM fr_sessions s JOIN fr_session_lines l ON l.session_id=s.id '+
          'JOIN parts p ON p.id=l.part_id '+
          'JOIN warehouses w ON w.id=s.warehouse_id '+
          'ORDER BY s.saved_at DESC,s.id DESC LIMIT 250'
        ).all()).results||[];
      }
      const hasClaims=await tableExists(env.DB,'fr_car_claims');
      if(hasClaims&&crews.length){
        const pending=(await env.DB.prepare(
          "SELECT user_id,requested_plate,inventory_json FROM fr_car_claims "+
          "WHERE status='PENDING'"
        ).all()).results||[];
        const claims=new Map(pending.map(row=>[row.user_id,row]));
        for(const crew of crews){
          const claim=claims.get(crew.id);
          // Directly linked car wins over obsolete pre-approval requests.
          if(!claim||crew.vehicleId)continue;
          crew.carPending=true;
          crew.plate=claim.requested_plate;
          crew.vehicleId=null;
          crew.lastInventory=null;
          crew.inventory=Boolean(claim.inventory_json);
          crew.stock={};
          if(claim.inventory_json){
            try{
              const snapshot=JSON.parse(claim.inventory_json);
              if(Array.isArray(snapshot))
                for(const row of snapshot)crew.stock[row.id]=Number(row.qty);
            }catch{crew.inventory=false;}
          }
        }
      }
      return workerJson({ok:true,crews,history});
    }catch(err){
      console.error('French D1 crew stock lookup',err?.name||'Error');
      return error('Nie udało się pobrać ekip i stanów francuskich.',503);
    }
  }
  if(view==='vehicleCatalog'){
    // Exactly the same D1-backed equipment category that Admin uses.
    // This is not vehicle stock: no crew balances or test car records included.
    try{
      const catalogue=await getVehicleCatalogue(env.DB);
      return workerJson({ok:true,...catalogue});
    }catch(err){
      console.error('Vehicle Office catalogue read failed',err?.name||'Error');
      return error('Nie udało się pobrać katalogu części samochodowych.',503);
    }
  }
  // A BOX without an active D1 warehouse can still display its 78 catalogue
  // references in the owner's layout preview, but NEVER fabricated balances.
  if(view==='frBoxCatalog'){
    if(user.role!=='ADMIN'||String(user.nickname||'').trim().toUpperCase()!=='JJ')
      return error('Brak uprawnień do katalogu BOX.',403);
    const boxId=url.searchParams.get('warehouse')||'';
    if(!['FR-TOULOUSE','FR-PARIS'].includes(boxId))
      return error('Nieprawidłowy magazyn BOX.',400);
    try{
      return workerJson({ok:true,...await readFrBoxOfficeParts(env.DB,boxId)});
    }catch(err){
      console.error('Office FR BOX catalogue read failed',err?.name||'Error');
      return error('Nie udało się pobrać katalogu BOX.',503);
    }
  }
  // An authorized Office administrator can view the common parts catalogue in
  // French layout-only warehouses. No warehouse inventory is created or inferred.
  if(view==='frCatalog'||view==='frCatalogPhoto'){
    if(user.role!=='ADMIN'||String(user.nickname||'').trim().toUpperCase()!=='JJ')
      return error('Brak uprawnień do katalogu.',403);
    const partId=url.searchParams.get('part')||'';
    if(partId&&!PART.test(partId))return error('Nieprawidłowa część.',400);
    try{
      if(view==='frCatalogPhoto'){
        if(!partId)return error('Nieprawidłowa część.',400);
        if(await tableExists(env.DB,'pl_part_photo_objects')){
          const ref=await getPhotoObject(env.DB,partId);
          if(ref){
            if(!env.PART_PHOTOS)return error('Zdjęcie jest niedostępne.',503);
            return await readPhotoResponse(env,ref)||
              error('Nie znaleziono zdjęcia.',404);
          }
        }
        if(!await tableExists(env.DB,'pl_part_photos'))
          return error('Nie znaleziono zdjęcia.',404);
        const photo=await env.DB.prepare(
          'SELECT ph.mime_type,ph.photo_base64 FROM pl_part_photos ph '+
          'JOIN parts p ON p.id=ph.part_id AND p.active=1 WHERE ph.part_id=?'
        ).bind(partId).first();
        if(!photo)return error('Nie znaleziono zdjęcia.',404);
        return new Response(Uint8Array.from(atob(photo.photo_base64),c=>c.charCodeAt(0)),{
          status:200,headers:{'Content-Type':photo.mime_type,
            'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}
        });
      }
      const hasIndices=await tableExists(env.DB,'pl_part_index_migrations');
      const indexJoin=hasIndices
        ?'LEFT JOIN pl_part_index_migrations ix ON ix.part_id=p.id ':'';
      const indexColumn=hasIndices?'COALESCE(ix.new_index,p.part_number)':'p.part_number';
      if(partId){
        const hasPhotos=await tableExists(env.DB,'pl_part_photos');
        const hasR2=await tableExists(env.DB,'pl_part_photo_objects');
        const photoTest=[
          hasR2?'EXISTS(SELECT 1 FROM pl_part_photo_objects r2 WHERE r2.part_id=p.id)':null,
          hasPhotos?'EXISTS(SELECT 1 FROM pl_part_photos ph WHERE ph.part_id=p.id)':null
        ].filter(Boolean).join(' OR ');
        const part=await env.DB.prepare(
          'SELECT p.id,'+indexColumn+' AS part_number,p.name,p.sap_number,'+
          'NULL AS quantity,'+(photoTest?'('+photoTest+')':'0')+' AS has_photo '+
          'FROM parts p '+indexJoin+'WHERE p.id=? AND p.active=1'
        ).bind(partId).first();
        if(!part)return error('Nie znaleziono części.',404);
        return workerJson({ok:true,part,delivery:null,inventory:null});
      }
      const parts=await selectRows(env.DB,
        'SELECT p.id,'+indexColumn+' AS part_number,p.name,p.sap_number,'+
        'NULL AS quantity FROM parts p '+indexJoin+
        'WHERE p.active=1 ORDER BY p.name COLLATE NOCASE,p.id LIMIT 3000');
      return workerJson({ok:true,parts});
    }catch(ex){
      console.error('French shared catalogue read failed',ex?.name||'Error');
      return error('Nie można pobrać katalogu części.',503);
    }
  }
  const warehouseId=url.searchParams.get('warehouse')||'';
  if(!WAREHOUSE.test(warehouseId))return error('Nieprawidłowy magazyn.');
  const authorizedWarehouse=authorizedWarehouses.find(w=>w.id===warehouseId);
  if(!authorizedWarehouse)return error('Brak uprawnień do tego magazynu.',403);
  // In FR self-storage BOXes, recorded mobile sessions are real receipts
  // (ZWROT -> PZ) and issues (POBRANIE -> WZ). No Polish document tables used.
  if(authorizedWarehouse.country_code==='FR' &&
     (view==='documents'||view==='document')){
    if(!['FR-TOULOUSE','FR-PARIS'].includes(warehouseId))
      return error('Historia pobrań i zwrotów nie jest jeszcze dostępna dla tego magazynu.',409);
    const direction=url.searchParams.get('direction')||'';
    if(!['PZ','WZ'].includes(direction))return error('Nieprawidłowy typ operacji.');
    try{
      if(view==='documents'){
        const focus=(url.searchParams.get('focus')||'').trim();
        if(focus&&!/^[A-Za-z0-9_-]{8,120}$/.test(focus))
          return error('Nieprawidłowy numer operacji.');
        return workerJson(await frenchBoxDocuments(env.DB,warehouseId,direction,
          url.searchParams.get('term')||'',focus));
      }
      const id=(url.searchParams.get('id')||'').trim();
      if(!/^[A-Za-z0-9_-]{8,120}$/.test(id))
        return error('Nieprawidłowy numer operacji.');
      return workerJson(await frenchBoxDocumentLines(env.DB,warehouseId,direction,id));
    }catch(err){
      console.error('French BOX Office movements unavailable',err?.name||'Error');
      return error('Nie udało się pobrać ruchów magazynu BOX z D1.',503);
    }
  }
  // Do not mistake PL-specific PZ/WZ/NOK tables for French operational history.
  if(authorizedWarehouse.country_code==='FR' &&
     !['stocks','part','partPhoto'].includes(view))
    return error('Moduł francuski jest przygotowywany; obecnie dostępne są stany i karty części.',409);
  try{
    if(view==='partPhoto') {
      const partId=url.searchParams.get('part')||'';
      if(!PART.test(partId))return error('Nieprawidłowa część.',400);
      if(await tableExists(env.DB,'pl_part_photo_objects')){
        const ref=await getPhotoObject(env.DB,partId);
        if(ref){
          if(!env.PART_PHOTOS)return error('Magazyn zdjęć R2 niedostępny.',503);
          const reply=await readPhotoResponse(env,ref);
          return reply||error('Brak pliku zdjęcia w R2.',404);
        }
      }
      if(!await tableExists(env.DB,'pl_part_photos'))return error('Brak zdjęcia.',404);
      const photo=await env.DB.prepare(
        'SELECT ph.mime_type,ph.photo_base64 FROM pl_part_photos ph '+
        'JOIN parts p ON p.id=ph.part_id AND p.active=1 WHERE ph.part_id=?'
      ).bind(partId).first();
      if(!photo)return error('Brak zdjęcia.',404);
      const image=Uint8Array.from(atob(photo.photo_base64),c=>c.charCodeAt(0));
      return new Response(image,{status:200,headers:{
        'Content-Type':photo.mime_type,
        'Cache-Control':'private, no-store',
        'X-Content-Type-Options':'nosniff'
      }});
    }
    if(view==='stocks'){
      if(authorizedWarehouse.country_code==='FR'&&
         ['FR-TOULOUSE','FR-PARIS'].includes(warehouseId)){
        // Only the 78 BOX references; all amounts are read live from D1.
        return workerJson({ok:true,warehouseId,
          ...await readFrBoxOfficeParts(env.DB,warehouseId)});
      }
      const hasIndices=await tableExists(env.DB,'pl_part_index_migrations');
      const parts=await selectRows(env.DB,
        'SELECT p.id,'+
        (hasIndices?'COALESCE(ix.new_index,p.part_number)':'p.part_number')+
        ' AS part_number,p.name,p.sap_number,s.quantity '+
        'FROM parts p LEFT JOIN warehouse_stock s ON s.part_id=p.id AND s.warehouse_id=? '+
        (hasIndices?'LEFT JOIN pl_part_index_migrations ix ON ix.part_id=p.id ':'')+
        'WHERE p.active=1 ORDER BY p.name COLLATE NOCASE,p.id LIMIT 3000',
        [warehouseId]);
      return workerJson({ok:true,warehouseId,parts});
    }
    if(view==='nokStock'){
      if(!await tableExists(env.DB,'pl_nok_stock'))
        return workerJson({ok:true,parts:[]});
      const hasIndices=await tableExists(env.DB,'pl_part_index_migrations');
      const parts=await selectRows(env.DB,
        'SELECT p.id,p.name,p.sap_number,'+
        (hasIndices?'COALESCE(ix.new_index,p.part_number)':'p.part_number')+
        ' AS part_number,n.quantity '+
        'FROM pl_nok_stock n JOIN parts p ON p.id=n.part_id '+
        (hasIndices?'LEFT JOIN pl_part_index_migrations ix ON ix.part_id=p.id ':'')+
        'WHERE n.warehouse_id=? AND n.quantity>0 ORDER BY p.name COLLATE NOCASE,p.id LIMIT 3000',
        [warehouseId]);
      return workerJson({ok:true,warehouseId,parts});
    }
    if(view==='part'){
      const partId=url.searchParams.get('part')||'';
      if(!PART.test(partId))return error('Nieprawidłowa część.');
      const hasIndices=await tableExists(env.DB,'pl_part_index_migrations');
      const hasPhotos=await tableExists(env.DB,'pl_part_photos');
      const hasR2Photos=await tableExists(env.DB,'pl_part_photo_objects');
      const photoFlags=[
        hasR2Photos?'EXISTS(SELECT 1 FROM pl_part_photo_objects r2 WHERE r2.part_id=p.id)':null,
        hasPhotos?'EXISTS(SELECT 1 FROM pl_part_photos ph WHERE ph.part_id=p.id)':null
      ].filter(Boolean).join(' OR ');
      const part=await env.DB.prepare(
        'SELECT p.id,p.name,p.sap_number,'+
        (hasIndices?'COALESCE(ix.new_index,p.part_number)':'p.part_number')+
        ' AS part_number,s.quantity '+
        (photoFlags?' ,('+photoFlags+') AS has_photo ':
          ' ,0 AS has_photo ')+
        'FROM parts p LEFT JOIN warehouse_stock s ON s.part_id=p.id AND s.warehouse_id=? '+
        (hasIndices?'LEFT JOIN pl_part_index_migrations ix ON ix.part_id=p.id ':'')+
        'WHERE p.id=? AND p.active=1'
      ).bind(warehouseId,partId).first();
      if(!part)return error('Nie znaleziono części.',404);
      let delivery=null,inventory=null;
      if(await tableExists(env.DB,'pl_warehouse_session_lines')){
        delivery=await env.DB.prepare(
          "SELECT s.committed_at AS date,l.quantity FROM pl_warehouse_sessions s "+
          "JOIN pl_warehouse_session_lines l ON l.session_id=s.id "+
          "WHERE s.warehouse_id=? AND l.part_id=? AND l.direction='PZ' "+
          'ORDER BY s.committed_at DESC,s.id DESC LIMIT 1'
        ).bind(warehouseId,partId).first();
      }
      if(await tableExists(env.DB,'pl_warehouse_inventory_changes')){
        inventory=await env.DB.prepare(
          'SELECT i.committed_at AS date FROM pl_warehouse_inventory_changes c '+
          'JOIN pl_warehouse_inventories i ON i.id=c.inventory_id '+
          'WHERE c.warehouse_id=? AND c.part_id=? '+
          'ORDER BY i.committed_at DESC,i.id DESC LIMIT 1'
        ).bind(warehouseId,partId).first();
      }
      return workerJson({ok:true,part,delivery,inventory});
    }
    if(view==='documents'){
      const direction=url.searchParams.get('direction')||'';
      if(!['PZ','WZ'].includes(direction))return error('Nieprawidłowy typ dokumentu.');
      if(!await tableExists(env.DB,'pl_warehouse_sessions'))
        return workerJson({ok:true,documents:[],total:0,matched:0});
      const term=(url.searchParams.get('term')||'').trim().slice(0,100);
      const focus=(url.searchParams.get('focus')||'').trim();
      if(focus&&!SESSION.test(focus))return error('Nieprawidłowy identyfikator dokumentu.');
      const relatedDirection=direction==='PZ'?'WZ':'PZ';
      // Read both legacy "NAZWA | REJ: TABLICA" rows and newer sessions
      // with a dedicated registration_plate column, without modifying D1.
      const columns=await env.DB.prepare('PRAGMA table_info(pl_warehouse_sessions)').all();
      const hasRegistrationPlate=(columns.results||[]).some(col=>col.name==='registration_plate');
      const hasComments=await tableExists(env.DB,'pl_warehouse_session_comments');
      const hasNok=await tableExists(env.DB,'pl_nok_session_lines');
      const lineSource='(SELECT session_id,direction,part_id,quantity,shortage_quantity,0 AS nok '+
        'FROM pl_warehouse_session_lines'+
        (hasNok?' UNION ALL SELECT session_id,direction,part_id,quantity,shortage_quantity,'+
          '1 AS nok FROM pl_nok_session_lines':'')+')';
      const join='FROM pl_warehouse_sessions s '+
        'JOIN '+lineSource+' l ON l.session_id=s.id '+
        'LEFT JOIN users u ON u.id=s.actor_id '+
        (hasComments?'LEFT JOIN pl_warehouse_session_comments c '+
          'ON c.session_id=s.id AND c.direction=l.direction ':'');
      const matching="AND (?='' OR LOWER(s.counterparty) LIKE '%'||LOWER(?)||'%' "+
        (hasRegistrationPlate
          ?"OR LOWER(COALESCE(s.registration_plate,'')) LIKE '%'||LOWER(?)||'%' "
          :'')+
        "OR LOWER(COALESCE(u.name,'')) LIKE '%'||LOWER(?)||'%' "+
        "OR s.committed_at LIKE '%'||?||'%' "+
        'OR EXISTS (SELECT 1 FROM '+lineSource+' x '+
        "JOIN parts p ON p.id=x.part_id WHERE x.session_id=s.id AND x.direction=? "+
        "AND (LOWER(p.name) LIKE '%'||LOWER(?)||'%' "+
        "OR LOWER(COALESCE(p.sap_number,'')) LIKE '%'||LOWER(?)||'%' "+
        "OR LOWER(COALESCE(p.part_number,'')) LIKE '%'||LOWER(?)||'%')))";
      const params=[warehouseId,direction,term,term,
        ...(hasRegistrationPlate?[term]:[]),
        term,term,direction,term,term,term];
      const where='WHERE s.warehouse_id=? AND l.direction=? ';
      const count=await env.DB.prepare(
        'SELECT COUNT(DISTINCT s.id) AS n '+join+where
      ).bind(warehouseId,direction).first();
      const matches=await env.DB.prepare(
        'SELECT COUNT(DISTINCT s.id) AS n '+join+where+matching
      ).bind(...params).first();
      const fields='SELECT s.id,s.committed_at AS date,s.counterparty,'+
        (hasRegistrationPlate?'s.registration_plate,':'NULL AS registration_plate,')+
        'COALESCE(u.name,s.actor_id) AS worker,COUNT(l.part_id) AS positions,'+
        'COALESCE(SUM(l.quantity),0) AS units,'+
        'COALESCE(SUM(l.shortage_quantity),0) AS shortage,'+
        (hasComments?"COALESCE(MAX(c.comment),'') AS comment,":"'' AS comment,")+
        'EXISTS (SELECT 1 FROM '+lineSource+' related '+
        "WHERE related.session_id=s.id AND related.direction='"+relatedDirection+"') AS has_related ";
      const docs=await selectRows(env.DB,fields+join+where+matching+
        ' GROUP BY s.id ORDER BY s.committed_at DESC,s.id DESC LIMIT 200',params);
      // Fetch a linked session even if it falls outside the 200 newest documents.
      if(focus&&!docs.some(doc=>doc.id===focus)){
        const focused=await selectRows(env.DB,fields+join+where+
          'AND s.id=? GROUP BY s.id LIMIT 1',[warehouseId,direction,focus]);
        if(focused.length)docs.unshift(focused[0]);
      }
      return workerJson({
        ok:true,documents:docs,total:Number(count?.n||0),matched:Number(matches?.n||0)
      });
    }
    if(view==='document'){
      const id=url.searchParams.get('id')||'';
      const direction=url.searchParams.get('direction')||'';
      if(!SESSION.test(id)||!['PZ','WZ'].includes(direction))return error('Nieprawidłowy dokument.');
      const indexed=await tableExists(env.DB,'pl_part_index_migrations');
      const hasNok=await tableExists(env.DB,'pl_nok_session_lines');
      const lineSource='(SELECT session_id,direction,part_id,quantity,shortage_quantity,0 AS nok '+
        'FROM pl_warehouse_session_lines'+
        (hasNok?' UNION ALL SELECT session_id,direction,part_id,quantity,shortage_quantity,'+
          '1 AS nok FROM pl_nok_session_lines':'')+')';
      const rows=await selectRows(env.DB,
        'SELECT p.sap_number,'+
        (indexed?'COALESCE(ix.new_index,p.part_number)':'p.part_number')+
        ' AS part_number,p.name,l.quantity,l.nok,'+
        'COALESCE(l.shortage_quantity,0) AS shortage_quantity '+
        'FROM pl_warehouse_sessions s JOIN '+lineSource+' l ON l.session_id=s.id '+
        'JOIN parts p ON p.id=l.part_id '+
        (indexed?'LEFT JOIN pl_part_index_migrations ix ON ix.part_id=p.id ':'')+
        'WHERE s.id=? AND s.warehouse_id=? AND l.direction=? '+
        'ORDER BY p.name COLLATE NOCASE,l.nok',[id,warehouseId,direction]);
      return workerJson({ok:true,lines:rows});
    }
    if(view==='inventories'){
      if(!await tableExists(env.DB,'pl_warehouse_inventories'))return workerJson({ok:true,inventories:[]});
      const rows=await selectRows(env.DB,
        'SELECT i.id,i.committed_at AS date,COALESCE(u.name,i.actor_id) AS worker,'+
        'COUNT(l.part_id) AS positions FROM pl_warehouse_inventories i '+
        'LEFT JOIN pl_warehouse_inventory_lines l ON l.inventory_id=i.id '+
        'LEFT JOIN users u ON u.id=i.actor_id '+
        "WHERE i.warehouse_id=? AND i.status='COMMITTED' "+
        'GROUP BY i.id ORDER BY i.committed_at DESC,i.id DESC LIMIT 200',[warehouseId]);
      return workerJson({ok:true,inventories:rows});
    }
    if(view==='inventory'){
      const id=url.searchParams.get('id')||'';
      if(!INVENTORY.test(id))return error('Nieprawidłowa inwentaryzacja.');
      const indexed=await tableExists(env.DB,'pl_part_index_migrations');
      const rows=await selectRows(env.DB,
        'SELECT p.sap_number,'+
        (indexed?'COALESCE(ix.new_index,p.part_number)':'p.part_number')+
        ' AS part_number,p.name,c.quantity_before,c.quantity_after '+
        'FROM pl_warehouse_inventory_changes c JOIN parts p ON p.id=c.part_id '+
        'JOIN pl_warehouse_inventories i ON i.id=c.inventory_id '+
        (indexed?'LEFT JOIN pl_part_index_migrations ix ON ix.part_id=p.id ':'')+
        "WHERE c.inventory_id=? AND c.warehouse_id=? AND i.status='COMMITTED' "+
        'ORDER BY p.name COLLATE NOCASE',[id,warehouseId]);
      return workerJson({ok:true,lines:rows});
    }
    return error('Nieznany widok.',400);
  }catch(err){
    console.error('Office API read failed',err?.name||'Error');
    return error('Nie udało się pobrać danych z D1.',503);
  }
}
