// French weekly vehicle inventory calendar. No stock or vehicle ownership changes.
const DEFAULT={enabled:false,weekday:5,time:'16:00',
  message:'Przypomnienie: wykonaj cotygodniową inwentaryzację części na samochodzie.',
  startedAt:null};
const zone='Europe/Paris';
const fmt=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',
  day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const pad=n=>String(n).padStart(2,'0');
function parisStamp(value) {
  const d=value instanceof Date?value:new Date(String(value||'').replace(' ','T')+
    (/Z$|[+-]\d{2}:\d{2}$/.test(String(value||''))?'':'Z'));
  if(!Number.isFinite(d.getTime()))return null;
  const p=Object.fromEntries(fmt.formatToParts(d).filter(x=>x.type!=='literal')
    .map(x=>[x.type,x.value]));
  return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute;
}
function monday(date) {
  const d=new Date(date+'T12:00:00Z');
  d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
  return d;
}
function dateText(d){return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate());}
function addDays(d,n){const x=new Date(d.getTime());x.setUTCDate(x.getUTCDate()+n);return x;}
export function isoWeekCode(localDate){
  const d=new Date(localDate.slice(0,10)+'T12:00:00Z');
  const weekday=(d.getUTCDay()+6)%7;
  d.setUTCDate(d.getUTCDate()+3-weekday);
  const year=d.getUTCFullYear();
  const firstThursday=new Date(Date.UTC(year,0,4,12));
  firstThursday.setUTCDate(firstThursday.getUTCDate()+3-(firstThursday.getUTCDay()+6)%7);
  const week=1+Math.round((d-firstThursday)/(7*86400000));
  return year+'-W'+pad(week);
}
export async function readFrWeeklySettings(db) {
  const present=await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='fr_weekly_settings'"
  ).first();
  if(!present)return {...DEFAULT};
  const record=await db.prepare(
    'SELECT enabled,weekday,local_time,message,started_at FROM fr_weekly_settings WHERE id=1'
  ).first();
  return record?{enabled:record.enabled===1,weekday:Number(record.weekday),
    time:record.local_time,message:record.message,startedAt:record.started_at}: {...DEFAULT};
}
export async function saveFrWeeklySettings(db,input) {
  if(!input||typeof input.enabled!=='boolean'||
    !Number.isInteger(input.weekday)||input.weekday<1||input.weekday>7||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.time||'')||
    typeof input.message!=='string'||input.message.trim().length<5||
    input.message.length>200)throw Error('Nieprawidłowy harmonogram.');
  const previous=await readFrWeeklySettings(db);
  const changed=!previous.enabled||previous.weekday!==input.weekday||previous.time!==input.time;
  const startedAt=input.enabled
    ?(changed||!previous.startedAt?new Date().toISOString():previous.startedAt)
    :previous.startedAt;
  await db.prepare('CREATE TABLE IF NOT EXISTS fr_weekly_settings ('+
    'id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL,'+
    'weekday INTEGER NOT NULL,local_time TEXT NOT NULL,message TEXT NOT NULL,'+
    'started_at TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run();
  await db.prepare('INSERT INTO fr_weekly_settings(id,enabled,weekday,local_time,message,started_at) '+
    'VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET '+
    'enabled=excluded.enabled,weekday=excluded.weekday,local_time=excluded.local_time,'+
    'message=excluded.message,started_at=excluded.started_at,updated_at=CURRENT_TIMESTAMP'
  ).bind(Number(input.enabled),input.weekday,input.time,input.message.trim(),startedAt).run();
  return {enabled:input.enabled,weekday:input.weekday,time:input.time,
    message:input.message.trim(),startedAt};
}
export function weeklyInventoryStatus(settings,events=[],now=new Date()){
  const result={missedWeeks:[],due:false,lastDueWeek:null};
  if(!settings?.enabled||!settings.startedAt)return result;
  const started=parisStamp(settings.startedAt),today=parisStamp(now);
  if(!started||!today)return result;
  const counted=new Set();
  let latestEvent=null;
  for(const event of events) {
    const date=parisStamp(event.event_at||event.eventAt||event);
    if(!date)continue;
    counted.add(isoWeekCode(date));
    if(!latestEvent||latestEvent<date)latestEvent=date;
  }
  const dueTime=settings.time;
  let cursor=monday(started.slice(0,10));
  const lastMonday=monday(today.slice(0,10));
  const missing=[];
  for(let n=0;n<110&&cursor<=lastMonday;n++,cursor=addDays(cursor,7)){
    const date=dateText(addDays(cursor,settings.weekday-1));
    const due=date+'T'+dueTime;
    if(due<=started||due>today)continue;
    const week=isoWeekCode(date);
    if(!counted.has(week))missing.push({week,due});
  }
  result.missedWeeks=missing.map(x=>x.week);
  const last=missing[missing.length-1];
  if(last) {
    result.lastDueWeek=last.week;
    result.due=!latestEvent||latestEvent<last.due;
  }
  return result;
}
