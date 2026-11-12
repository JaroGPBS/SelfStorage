// Mobile French weekly inventory status and optional system push enrollment.
// Push is opt-in. The weekly warning never blocks warehouse operations.
import {verifyWorkerSession,workerJson,workerAuthReady} from '../../lib/pl-worker-auth.js';
import {readFrWeeklySettings,weeklyInventoryStatus} from '../../lib/fr-weekly-schedule.js';
const fail=(error,status=400)=>workerJson({ok:false,error},status);
const endpointAllowed=value=>{
  try {
    const u=new URL(value);
    const host=u.hostname.toLowerCase();
    return u.protocol==='https:'&&u.username===''&&u.password===''&&
      u.port===''&&u.hash===''&&String(value).length<=2048&&
      (host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||
       host.endsWith('.push.apple.com')||host==='push.apple.com'||
       host.endsWith('.notify.windows.com')||host==='notify.windows.com');
  }catch{return false;}
};
async function auth(request,env){
  if(!workerAuthReady(env))return null;
  const user=await verifyWorkerSession(request,env);
  return user?.role==='EKIPA'&&user.markets?.FR&&user.apps?.mobile?user:null;
}
async function subscribed(db,id){
  const exists=await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='fr_push_subscriptions'"
  ).first();
  if(!exists)return false;
  return Boolean(await db.prepare('SELECT 1 FROM fr_push_subscriptions WHERE user_id=? LIMIT 1')
    .bind(id).first());
}
export async function onRequestGet({request,env}){
  let user;
  try{user=await auth(request,env);}
  catch{return fail('Nie można sprawdzić sesji.',503);}
  if(!user)return fail('Brak dostępu.',401);
  try{
    const settings=await readFrWeeklySettings(env.DB);
    const events=settings.enabled
      ?(await env.DB.prepare(
        "SELECT event_at FROM fr_vehicle_events WHERE user_id=? "+
        "AND type='INWENTARYZACJA' AND event_at>=datetime(?, '-8 days') "+
        "ORDER BY event_at DESC"
       ).bind(user.id,settings.startedAt||new Date().toISOString()).all()).results||[]
      :[];
    const status=weeklyInventoryStatus(settings,events);
    return workerJson({ok:true,enabled:settings.enabled,
      due:status.due,missedWeeks:status.missedWeeks,
      nextReminder:{weekday:settings.weekday,time:settings.time},
      pushAvailable:typeof env.VAPID_PUBLIC_KEY==='string'&&env.VAPID_PUBLIC_KEY.length>50,
      vapidPublicKey:env.VAPID_PUBLIC_KEY||null,
      subscribed:await subscribed(env.DB,user.id)});
  }catch(error){
    console.error('French weekly inventory lookup failed',error?.name||'Error');
    return fail('Nie udało się pobrać terminu inwentaryzacji.',503);
  }
}
export async function onRequestPost({request,env}){
  if(request.headers.get('Origin')!==new URL(request.url).origin)return fail('Niedozwolony adres.',403);
  let user;
  try{user=await auth(request,env);}
  catch{return fail('Nie można sprawdzić sesji.',503);}
  if(!user)return fail('Brak dostępu.',401);
  let body;
  try{
    const raw=await request.text();
    if(raw.length>6000)return fail('Zbyt dużo danych.',413);
    body=JSON.parse(raw);
  }catch{return fail('Niepoprawne dane.',400);}
  if(!['subscribe','unsubscribe'].includes(body?.action))return fail('Nieznana akcja.',400);
  const endpoint=String(body.subscription?.endpoint||body.endpoint||'');
  if(!endpointAllowed(endpoint))return fail('Niepoprawny adres usługi powiadomień.',400);
  try{
    const exists=await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='fr_push_subscriptions'"
    ).first();
    if(body.action==='unsubscribe'){
      if(exists)await env.DB.prepare(
        'DELETE FROM fr_push_subscriptions WHERE user_id=? AND endpoint=?'
      ).bind(user.id,endpoint).run();
      return workerJson({ok:true});
    }
    if(typeof env.VAPID_PUBLIC_KEY!=='string'||env.VAPID_PUBLIC_KEY.length<50)
      return fail('Powiadomienia nie są jeszcze uruchomione na serwerze.',503);
    const keys=body.subscription?.keys;
    if(!keys||typeof keys.p256dh!=='string'||typeof keys.auth!=='string'||
      keys.p256dh.length>200||keys.auth.length>100||
      !/^[A-Za-z0-9_-]+$/.test(keys.p256dh)||!/^[A-Za-z0-9_-]+$/.test(keys.auth))
      return fail('Niepoprawne dane telefonu.',400);
    await env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS fr_push_subscriptions ('+
      'endpoint TEXT PRIMARY KEY,user_id TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
    ).run();
    await env.DB.prepare(
      'INSERT INTO fr_push_subscriptions(endpoint,user_id) VALUES(?,?) '+
      'ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id'
    ).bind(endpoint,user.id).run();
    return workerJson({ok:true});
  }catch(error){
    console.error('French push enrollment failed',error?.name||'Error');
    return fail('Nie udało się zapisać powiadomień na telefonie.',503);
  }
}
