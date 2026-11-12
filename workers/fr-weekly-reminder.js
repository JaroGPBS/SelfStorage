// Deploy as a separate Cloudflare Worker with a 5-minute Cron trigger.
// It shares the production D1 database but never modifies stock or inventory.
// It uses standards-based payload-free Web Push (no encryption keys are exposed).
import {readFrWeeklySettings,weeklyInventoryStatus,isoWeekCode} from '../lib/fr-weekly-schedule.js';
const encoder=new TextEncoder();
const alphabet=bytes=>btoa(String.fromCharCode(...bytes))
  .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
const decode=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')
  .padEnd(Math.ceil(value.length/4)*4,'=')),x=>x.charCodeAt(0));
async function vapidToken(endpoint,env){
  const pub=decode(env.VAPID_PUBLIC_KEY),privateBytes=decode(env.VAPID_PRIVATE_KEY);
  if(pub.length!==65||pub[0]!==4||privateBytes.length!==32)throw Error('Invalid VAPID keys');
  const key=await crypto.subtle.importKey('jwk',{
    kty:'EC',crv:'P-256',x:alphabet(pub.slice(1,33)),y:alphabet(pub.slice(33)),
    d:alphabet(privateBytes),ext:true
  },{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const origin=new URL(endpoint).origin;
  const header=alphabet(encoder.encode(JSON.stringify({typ:'JWT',alg:'ES256'})));
  const payload=alphabet(encoder.encode(JSON.stringify({
    aud:origin,exp:Math.floor(Date.now()/1000)+11*3600,
    sub:env.VAPID_SUBJECT||'https://selfstorage-43f.pages.dev'
  })));
  const content=header+'.'+payload;
  const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,encoder.encode(content));
  return content+'.'+alphabet(new Uint8Array(signature));
}
const parisClock=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
  hourCycle:'h23'});
function localNow(now) {
  const p=Object.fromEntries(parisClock.formatToParts(now)
    .filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  const date=p.year+'-'+p.month+'-'+p.day;
  const weekday=new Date(date+'T12:00:00Z').getUTCDay()||7;
  return {date,weekday,minutes:Number(p.hour)*60+Number(p.minute)};
}
async function sendPush(endpoint,env,week){
  const token=await vapidToken(endpoint,env);
  const response=await fetch(endpoint,{
    method:'POST',headers:{
      'Authorization':'vapid t='+token+', k='+env.VAPID_PUBLIC_KEY,
      'TTL':'86400','Urgency':'normal',
      'Topic':'gbps-fr-'+week.replace(/[^A-Za-z0-9]/g,'')
    },body:null
  });
  return response.status;
}
async function runReminder(env){
  if(!env.DB||!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY)return;
  const settings=await readFrWeeklySettings(env.DB);
  if(!settings.enabled||!settings.startedAt)return;
  const now=new Date(),fr=localNow(now);
  const [hour,minute]=settings.time.split(':').map(Number);
  const elapsed=fr.minutes-(hour*60+minute);
  if(fr.weekday!==settings.weekday||elapsed<0||elapsed>=10)return;
  const week=isoWeekCode(fr.date);
  const ready=(await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN "+
    "('fr_push_subscriptions','fr_vehicle_events','user_archives')"
  ).all()).results||[];
  if(ready.length!==3)return;
  const subs=(await env.DB.prepare(
    'SELECT endpoint,user_id FROM fr_push_subscriptions ORDER BY user_id'
  ).all()).results||[];
  if(!subs.length)return;
  const crews=(await env.DB.prepare(
    'SELECT u.id FROM users u LEFT JOIN user_access_settings a ON a.user_id=u.id '+
    'LEFT JOIN user_archives ar ON ar.user_id=u.id '+
    "WHERE u.active=1 AND u.role_code='EKIPA' AND ar.user_id IS NULL AND ("+
    'a.fr_enabled=1 OR (a.user_id IS NULL AND EXISTS ('+
    'SELECT 1 FROM user_warehouse_access g JOIN warehouses w ON w.id=g.warehouse_id '+
    "WHERE g.user_id=u.id AND w.country_code='FR')))"
  ).all()).results||[];
  const eligible=new Set(crews.map(c=>c.id));
  const events=(await env.DB.prepare(
    "SELECT user_id,event_at FROM fr_vehicle_events WHERE type='INWENTARYZACJA' "+
    "AND event_at>=datetime(?, '-8 days')"
  ).bind(settings.startedAt).all()).results||[];
  const byCrew=new Map();
  for(const e of events){
    if(!byCrew.has(e.user_id))byCrew.set(e.user_id,[]);
    byCrew.get(e.user_id).push(e);
  }
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS fr_weekly_push_sent ('+
    'user_id TEXT NOT NULL,week TEXT NOT NULL,status TEXT NOT NULL DEFAULT \'PENDING\','+
    'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,week))'
  ).run();
  const grouped=new Map();
  for(const entry of subs){
    if(eligible.has(entry.user_id)){
      if(!grouped.has(entry.user_id))grouped.set(entry.user_id,[]);
      grouped.get(entry.user_id).push(entry.endpoint);
    }
  }
  for(const [userId,endpoints] of grouped){
    const status=weeklyInventoryStatus(settings,byCrew.get(userId)||[],now);
    if(!status.due||status.lastDueWeek!==week)continue;
    await env.DB.prepare(
      "INSERT OR IGNORE INTO fr_weekly_push_sent(user_id,week,status) VALUES(?,?,'PENDING')"
    ).bind(userId,week).run();
    const previous=await env.DB.prepare(
      'SELECT status FROM fr_weekly_push_sent WHERE user_id=? AND week=?'
    ).bind(userId,week).first();
    if(previous?.status==='SENT')continue;
    let sent=0;
    for(const endpoint of endpoints){
      try{
        const code=await sendPush(endpoint,env,week);
        if(code>=200&&code<300)sent++;
        if(code===404||code===410)
          await env.DB.prepare('DELETE FROM fr_push_subscriptions WHERE endpoint=?')
            .bind(endpoint).run();
      }catch(e){console.warn('French reminder push unavailable',e?.name||'Error');}
    }
    if(sent){
      await env.DB.prepare(
        "UPDATE fr_weekly_push_sent SET status='SENT',updated_at=CURRENT_TIMESTAMP "+
        'WHERE user_id=? AND week=?'
      ).bind(userId,week).run();
    }
  }
}
export default {
  async scheduled(_controller,env,ctx){
    ctx.waitUntil(runReminder(env));
  }
};
