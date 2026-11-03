// GPBS Storage: long-lived office-only login, isolated from warehouse sessions.
// Only the office read API accepts this cookie; the PIN is never stored here.
import {loadActiveWorker,workerAuthReady} from './pl-worker-auth.js';

const enc=new TextEncoder();
const COOKIE='__Host-gpbs_office_remember';
const AUD='GPBS-PL-OFFICE-REMEMBER-v1';
const TTL=30*24*60*60*1000;
const OFFICE_ROLES=new Set(['ADMIN','KIEROWNIK','KOORDYNATOR','MAGAZYNIER']);

function b64(bytes){
  let str='';
  for(const b of new Uint8Array(bytes))str+=String.fromCharCode(b);
  return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function unb64(str){
  if(typeof str!=='string'||!/^[A-Za-z0-9_-]{1,2048}$/.test(str))throw Error('Invalid token');
  const raw=atob(str.replace(/-/g,'+').replace(/_/g,'/')
    .padEnd(Math.ceil(str.length/4)*4,'='));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
async function key(secret){
  return crypto.subtle.importKey('raw',
    enc.encode('GPBS:PL:OFFICE:SESSION:v1:'+secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
async function stamp(secretKey,pinDigest){
  const tag=await crypto.subtle.sign('HMAC',secretKey,
    enc.encode('GPBS:PL:OFFICE:CREDENTIAL:'+pinDigest));
  return b64(new Uint8Array(tag).slice(0,16));
}
export function officeRememberCookie(token='',maxAge=30*24*60*60){
  return COOKIE+'='+token+
    '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+maxAge;
}
export async function createRememberToken(env,userId){
  if(!workerAuthReady(env))throw Error('Office login not configured');
  const user=await loadActiveWorker(env,userId);
  if(!user||!OFFICE_ROLES.has(user.role))throw Error('Office access denied');
  const secretKey=await key(env.PANEL_SESSION_SECRET);
  const iat=Date.now();
  const bytes=enc.encode(JSON.stringify({
    v:1,aud:AUD,uid:user.id,iat,exp:iat+TTL,
    stamp:await stamp(secretKey,user.pinDigest),
    nonce:crypto.randomUUID()
  }));
  return b64(bytes)+'.'+b64(await crypto.subtle.sign('HMAC',secretKey,bytes));
}
export async function verifyRememberSession(request,env){
  if(!workerAuthReady(env))return null;
  const pair=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim())
    .find(x=>x.startsWith(COOKIE+'='));
  if(!pair)return null;
  const token=pair.slice(COOKIE.length+1);
  if(token.length>2400)return null;
  const pieces=token.split('.');
  if(pieces.length!==2)return null;
  try{
    const bytes=unb64(pieces[0]);
    const signature=unb64(pieces[1]);
    const secretKey=await key(env.PANEL_SESSION_SECRET);
    if(!await crypto.subtle.verify('HMAC',secretKey,signature,bytes))return null;
    const data=JSON.parse(new TextDecoder().decode(bytes));
    const now=Date.now();
    if(data.v!==1||data.aud!==AUD||
      !/^GPBS-U-[a-f0-9-]{36}$/.test(data.uid||'')||
      !Number.isSafeInteger(data.iat)||!Number.isSafeInteger(data.exp)||
      data.iat>now+60000||data.exp<=now||
      data.exp>data.iat+TTL||data.exp<=data.iat||
      typeof data.stamp!=='string')return null;
    const user=await loadActiveWorker(env,data.uid);
    if(!user||!OFFICE_ROLES.has(user.role))return null;
    if(data.stamp!==await stamp(secretKey,user.pinDigest))return null;
    const {pinDigest,...safeUser}=user;
    return safeUser;
  }catch{return null;}
}
