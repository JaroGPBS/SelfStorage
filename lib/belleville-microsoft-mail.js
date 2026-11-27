// Delegated Exchange integration, only the immutable protected owner.
// No refresh token, no mailbox reads. Token is encrypted at rest and bound
// to the exact authenticated GPBS session. OAuth callback uses a one-time flow.
import {verifyWorkerSession,workerJson} from './pl-worker-auth.js';
import {verifyRememberSession} from './pl-office-remember.js';
import {ownerContext} from './super-admin-security.js';
import {readDocumentRecipients,validateDocumentRecipients} from './belleville-document-mail-settings.js';
import {recordPhotoRead} from './pl-r2-photos.js';

const ORIGIN='https://selfstorage-43f.pages.dev';
const REDIRECT=ORIGIN+'/api/microsoft-mail-callback';
const FLOW_COOKIE='__Host-gpbs_mail_flow';
const enc=new TextEncoder(),dec=new TextDecoder();
const MAX_PDF=2700000;
const SCOPES='https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Send';
const uuid=/^[a-f0-9-]{36}$/i;
const fail=(error,status=400)=>workerJson({ok:false,error},status);
const b64url=bytes=>btoa(Array.from(new Uint8Array(bytes),b=>String.fromCharCode(b)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'=')),c=>c.charCodeAt(0));
const random=()=>b64url(crypto.getRandomValues(new Uint8Array(32)));
const hash=async value=>b64url(await crypto.subtle.digest('SHA-256',enc.encode(value)));
function cookie(request,name){
  return (request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
}
function flowCookie(value='',age=0){return FLOW_COOKIE+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+age;}
function config(env){
  if(!uuid.test(env.MICROSOFT_CLIENT_ID||'')||!uuid.test(env.MICROSOFT_TENANT_ID||'')||
    !env.MICROSOFT_CLIENT_SECRET||!env.MICROSOFT_ALLOWED_EMAIL||!env.PANEL_SESSION_SECRET)
    return null;
  return {client:env.MICROSOFT_CLIENT_ID,tenant:env.MICROSOFT_TENANT_ID,secret:env.MICROSOFT_CLIENT_SECRET,email:env.MICROSOFT_ALLOWED_EMAIL.trim().toLowerCase()};
}
async function ownerSession(request,env){
  const worker=await verifyWorkerSession(request,env);
  const user=worker||await verifyRememberSession(request,env);
  if(!user?.apps?.office||!user.markets?.FR||user.role!=='ADMIN')return null;
  const owner=await ownerContext(env);
  if(!owner||owner.owner.id!==user.id)return null;
  const raw=cookie(request,worker?'__Host-gpbs_pl_worker':'__Host-gpbs_office_remember');
  if(!raw)return null;
  return {user,session:await hash('GPBS:mail:'+raw)};
}
async function ensure(db){
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS belleville_mail_flows (state TEXT PRIMARY KEY, session_key TEXT NOT NULL, owner_id TEXT NOT NULL, browser_hash TEXT NOT NULL, verifier TEXT NOT NULL, expires INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS belleville_mail_tokens (session_key TEXT PRIMARY KEY, owner_id TEXT NOT NULL, email TEXT NOT NULL, encrypted_token TEXT NOT NULL, expires INTEGER NOT NULL)')
  ]);
}
async function encryptionKey(env){
  return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',enc.encode('GPBS:MSMAIL:V1:'+env.PANEL_SESSION_SECRET)),{name:'AES-GCM'},false,['encrypt','decrypt']);
}
async function encryptToken(env,token,session){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const result=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(session)},await encryptionKey(env),enc.encode(token));
  return b64url(iv)+'.'+b64url(result);
}
async function decryptToken(env,value,session){
  const [iv,data]=value.split('.');
  return dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv),additionalData:enc.encode(session)},await encryptionKey(env),unb64(data)));
}
async function activeToken(env,auth,cfg){
  const row=await env.DB.prepare('SELECT owner_id,email,encrypted_token,expires FROM belleville_mail_tokens WHERE session_key=?').bind(auth.session).first();
  if(!row||row.owner_id!==auth.user.id||row.email!==cfg.email||Number(row.expires)<=Date.now()+30000)return null;
  return row;
}
const msUrl=(cfg,path)=>'https://login.microsoftonline.com/'+cfg.tenant+'/oauth2/v2.0/'+path;
async function start(request,env,auth,cfg){
  const state=random(),browser=random(),verifier=random(),now=Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM belleville_mail_flows WHERE expires<=? OR session_key=?').bind(now,auth.session),
    env.DB.prepare('DELETE FROM belleville_mail_tokens WHERE expires<=? OR session_key=?').bind(now,auth.session),
    env.DB.prepare('INSERT INTO belleville_mail_flows(state,session_key,owner_id,browser_hash,verifier,expires) VALUES(?,?,?,?,?,?)')
      .bind(state,auth.session,auth.user.id,await hash(browser),verifier,now+600000)
  ]);
  const params=new URLSearchParams({client_id:cfg.client,response_type:'code',redirect_uri:REDIRECT,response_mode:'query',
    scope:SCOPES,state,code_challenge:await hash(verifier),code_challenge_method:'S256',login_hint:cfg.email,prompt:'select_account'});
  return workerJson({ok:true,url:msUrl(cfg,'authorize')+'?'+params},200,{'Set-Cookie':flowCookie(browser,600)});
}
function callbackPage(ok,message){
  // Fixed messages only, no query/code/token echoed into HTML.
  return new Response('<!doctype html><html lang="pl"><meta charset="utf-8"><title>GPBS Storage – poczta</title><body style="font:16px system-ui;padding:30px"><h2>'+(ok?'Połączono pocztę':'Nie udało się połączyć poczty')+'</h2><p>'+message+'</p><p>Zamknij to okno i wróć do Office.</p></body></html>',{
    status:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",'Set-Cookie':flowCookie()}
  });
}
export async function microsoftCallback({request,env}){
  const cfg=config(env),url=new URL(request.url);
  if(url.origin!==ORIGIN||!cfg)return callbackPage(false,'Konfiguracja poczty jest niedostępna.');
  try{
    const state=url.searchParams.get('state')||'',browser=cookie(request,FLOW_COOKIE);
    if(!/^[A-Za-z0-9_-]{43}$/.test(state)||!/^[A-Za-z0-9_-]{43}$/.test(browser))
      return callbackPage(false,'Sesja logowania wygasła. Rozpocznij połączenie ponownie w Office.');
    await ensure(env.DB);
    const flow=await env.DB.prepare('SELECT * FROM belleville_mail_flows WHERE state=?').bind(state).first();
    if(!flow||flow.expires<=Date.now()||flow.browser_hash!==await hash(browser))return callbackPage(false,'Nieprawidłowa lub wygasła sesja logowania.');
    // One-time redemption, including concurrent callbacks.
    const consumed=await env.DB.prepare('DELETE FROM belleville_mail_flows WHERE state=? AND browser_hash=? AND expires>?').bind(state,flow.browser_hash,Date.now()).run();
    if(Number(consumed.meta?.changes)!==1)return callbackPage(false,'Ta sesja została już wykorzystana.');
    const code=url.searchParams.get('code');
    if(!code||url.searchParams.has('error'))return callbackPage(false,'Microsoft nie udzielił zgody na połączenie.');
    const owner=await ownerContext(env);
    if(!owner||owner.owner.id!==flow.owner_id)return callbackPage(false,'Brak uprawnień właściciela.');
    const tokenResponse=await fetch(msUrl(cfg,'token'),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({
      client_id:cfg.client,client_secret:cfg.secret,grant_type:'authorization_code',code,redirect_uri:REDIRECT,code_verifier:flow.verifier,scope:SCOPES
    }),redirect:'error'});
    const token=await tokenResponse.json();
    if(!tokenResponse.ok||typeof token.access_token!=='string'||!Number.isFinite(Number(token.expires_in)))
      return callbackPage(false,'Microsoft odrzucił autoryzację. Sprawdź zgodę i konfigurację aplikacji.');
    const me=await fetch('https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName',{headers:{Authorization:'Bearer '+token.access_token},redirect:'error'});
    const profile=await me.json();
    const address=String(profile.mail||profile.userPrincipalName||'').trim().toLowerCase();
    if(!me.ok||!profile.id||address!==cfg.email)return callbackPage(false,'Wybrano inne konto Microsoft niż dozwolone.');
    if(!String(token.scope||'').toLowerCase().split(/\s+/).some(s=>s==='mail.send'||s.endsWith('/mail.send')))
      return callbackPage(false,'Brakuje zgody na wysyłanie poczty.');
    const expires=Date.now()+Math.min(Number(token.expires_in),3600)*1000;
    if(expires<=Date.now()+30000)return callbackPage(false,'Token Microsoft wygasł.');
    await env.DB.prepare('INSERT INTO belleville_mail_tokens(session_key,owner_id,email,encrypted_token,expires) VALUES(?,?,?,?,?) ON CONFLICT(session_key) DO UPDATE SET owner_id=excluded.owner_id,email=excluded.email,encrypted_token=excluded.encrypted_token,expires=excluded.expires')
      .bind(flow.session_key,flow.owner_id,address,await encryptToken(env,token.access_token,flow.session_key),expires).run();
    return callbackPage(true,'Konto Microsoft jest gotowe do wysyłania.');
  }catch(error){console.error('Microsoft mail callback',error?.name||'Error');return callbackPage(false,'Nie udało się połączyć z Microsoftem. Spróbuj ponownie.');}
}
function validPdf(bytes){return bytes.length>=300&&bytes.length<=MAX_PDF&&dec.decode(bytes.slice(0,5))==='%PDF-'&&dec.decode(bytes.slice(-1024)).includes('%%EOF');}
function base64(bytes){let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(text);}
async function send(request,env,auth,cfg){
  const row=await activeToken(env,auth,cfg);
  if(!row)return fail('Połącz ponownie konto Microsoft.',401);
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('multipart/form-data;'))return fail('Wymagany formularz dokumentu.',415);
  if(Number(request.headers.get('Content-Length')||0)>MAX_PDF+64000)return fail('Dokument jest za duży.',413);
  const form=await request.formData();
  const type=String(form.get('type')||''),id=String(form.get('documentId')||'');
  if(!['PZ','WZ','CMR'].includes(type)||!new RegExp('^'+(type==='CMR'?'WZ':type)+'-[A-Z0-9-]{1,64}$').test(id))return fail('Nieprawidłowy dokument.');
  const subject=String(form.get('subject')||'').trim(),body=String(form.get('body')||'');
  if(!subject||subject.length>240||/[\r\n]/.test(subject)||body.length>10000)return fail('Nieprawidłowa treść wiadomości.');
  const recipients=validateDocumentRecipients({PZ:type==='PZ'?String(form.get('recipients')||''):'',WZ:type==='WZ'?String(form.get('recipients')||''):'',CMR:type==='CMR'?String(form.get('recipients')||''):''})[type];
  if(!recipients.length)return fail('Wpisz adres odbiorcy.');
  let bytes;
  if(type==='CMR'){
    const revision=Number(form.get('revision'));
    const record=await env.DB.prepare('SELECT object_key,size_bytes,revision FROM cmr_belleville_documents WHERE document_id=?').bind(id).first();
    if(!record||!env.PART_PHOTOS)return fail('Najpierw zapisz CMR.',409);
    if(Number(record.revision)!==revision)return fail('CMR zmieniła się. Otwórz dokument ponownie.',409);
    if(Number(record.size_bytes)>MAX_PDF)return fail('CMR przekracza limit 2,7 MB.',413);
    await recordPhotoRead(env.DB);
    const object=await env.PART_PHOTOS.get(record.object_key);
    if(!object)return fail('Nie znaleziono zapisanej CMR.',404);
    bytes=new Uint8Array(await object.arrayBuffer());
  }else{
    const file=form.get('pdf');
    if(!file||typeof file.arrayBuffer!=='function'||file.size>MAX_PDF)return fail('Wymagany PDF do 2,7 MB.',413);
    bytes=new Uint8Array(await file.arrayBuffer());
  }
  if(!validPdf(bytes))return fail('Nieprawidłowy PDF lub przekroczony limit 2,7 MB.',413);
  const token=await decryptToken(env,row.encrypted_token,auth.session);
  const name=(type==='CMR'?'CMR-':'')+id+'.pdf';
  // No automatic retries: a network interruption can happen after acceptance.
  const response=await fetch('https://graph.microsoft.com/v1.0/me/sendMail',{
    method:'POST',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({message:{subject,body:{contentType:'Text',content:body},toRecipients:recipients.map(address=>({emailAddress:{address}})),attachments:[{'@odata.type':'#microsoft.graph.fileAttachment',name,contentType:'application/pdf',contentBytes:base64(bytes)}]},saveToSentItems:true})
  });
  if(response.status===202)return workerJson({ok:true,accepted:true});
  if(response.status===401){await env.DB.prepare('DELETE FROM belleville_mail_tokens WHERE session_key=?').bind(auth.session).run();return fail('Autoryzacja Microsoft wygasła. Połącz konto ponownie.',401);}
  if(response.status===403)return fail('Microsoft nie zezwolił na wysłanie. Sprawdź uprawnienie Mail.Send.',403);
  if(response.status===429)return fail('Microsoft ograniczył liczbę wysyłek. Spróbuj później.',429);
  return fail('Microsoft nie potwierdził przyjęcia wiadomości. Sprawdź Elementy wysłane przed ponowną próbą.',502);
}
export async function microsoftMail({request,env}){
  const url=new URL(request.url);
  if(url.origin!==ORIGIN)return fail('Poczta działa tylko w produkcyjnym Office.',403);
  try{
    const auth=await ownerSession(request,env);
    if(!auth)return fail('Brak uprawnień do poczty.',403);
    const cfg=config(env);
    if(!cfg)return fail('Brak konfiguracji Microsoft w Cloudflare.',503);
    await ensure(env.DB);
    if(request.method==='GET'){
      const token=await activeToken(env,auth,cfg);
      return workerJson({ok:true,connected:!!token,email:cfg.email,recipients:await readDocumentRecipients(env.DB)});
    }
    if(request.method!=='POST'||request.headers.get('Origin')!==url.origin)return fail('Niedozwolone żądanie.',403);
    const action=url.searchParams.get('action');
    if(action==='start')return await start(request,env,auth,cfg);
    if(action==='disconnect'){
      await env.DB.batch([env.DB.prepare('DELETE FROM belleville_mail_tokens WHERE session_key=?').bind(auth.session),env.DB.prepare('DELETE FROM belleville_mail_flows WHERE session_key=?').bind(auth.session)]);
      return workerJson({ok:true},200,{'Set-Cookie':flowCookie()});
    }
    if(action==='send')return await send(request,env,auth,cfg);
    return fail('Nieznana operacja.',404);
  }catch(error){console.error('Microsoft mail operation',error?.name||'Error');return fail(error?.status?error.message:'Nie udało się wykonać operacji pocztowej. Przy wysyłce sprawdź Elementy wysłane przed ponowną próbą.',error?.status||503);}
}
