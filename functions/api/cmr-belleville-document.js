// GPBS Storage — Belleville CMR: one current PDF per WZ, 60-minute edit window.
// The first "Zapisz i drukuj" starts the server-side timer. No edit history.
// PDF is private in the existing R2 bucket; D1 stores timing and current pointer.
import {verifyWorkerSession,workerAuthReady,workerJson} from '../../lib/pl-worker-auth.js';
import {verifyRememberSession} from '../../lib/pl-office-remember.js';
import {
  r2Ready,ensurePhotoTables,reservePhotoWrite,releasePhotoBytes,recordPhotoRead
} from '../../lib/pl-r2-photos.js';

import {cmrPublicFields,stampCmrPdf} from '../../lib/cmr-belleville-stamp.js';

const WINDOW_MS=60*60*1000;
const MAX_PDF=6*1024*1024;
const MAX_FIELDS=240000;
const WZ_ID=/^WZ-[A-Z0-9-]{1,64}$/;
const allowedRoles=new Set(['ADMIN','KIEROWNIK','KOORDYNATOR','MAGAZYNIER']);
const fail=(message,status=400)=>workerJson({ok:false,error:message},status);

async function authorize(request,env){
  if(!workerAuthReady(env))return null;
  const user=await verifyWorkerSession(request,env)||
    await verifyRememberSession(request,env);
  if(!user?.apps?.office||!user?.markets?.FR||!allowedRoles.has(user.role))return null;
  return user;
}
async function ensureTable(db){
  await db.prepare('CREATE TABLE IF NOT EXISTS cmr_belleville_documents ('+
    'document_id TEXT PRIMARY KEY,'+
    'started_at_ms INTEGER NOT NULL,'+
    'locked_at_ms INTEGER NOT NULL,'+
    'object_key TEXT NOT NULL UNIQUE,'+
    'size_bytes INTEGER NOT NULL CHECK(size_bytes>0),'+
    'fields_json TEXT NOT NULL,'+
    'revision INTEGER NOT NULL DEFAULT 1,'+
    'updated_at_ms INTEGER NOT NULL)').run();
}
async function getRow(db,id){
  return db.prepare('SELECT document_id,started_at_ms,locked_at_ms,object_key,'+
    'size_bytes,fields_json,revision,updated_at_ms '+
    'FROM cmr_belleville_documents WHERE document_id=?').bind(id).first();
}
function publicRecord(row,now){
  if(!row)return null;
  return {
    documentId:row.document_id,firstPrintedAtMs:Number(row.started_at_ms),
    lockedAtMs:Number(row.locked_at_ms),revision:Number(row.revision),
    locked:now>=Number(row.locked_at_ms),
    fields:cmrPublicFields(JSON.parse(row.fields_json))
  };
}
function documentId(request){
  return new URL(request.url).searchParams.get('documentId')||'';
}
function pdfResponse(body,id){
  return new Response(body,{
    headers:{
      'Content-Type':'application/pdf',
      'Content-Disposition':'inline; filename="'+id+'.pdf"',
      'Cache-Control':'private, no-store',
      'X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'none'; sandbox"
    }
  });
}
export async function onRequestGet({request,env}){
  let user;
  try{user=await authorize(request,env);}
  catch(_){return fail('Nie udało się zweryfikować sesji.',503);}
  if(!user)return fail('Brak dostępu do Office Francja.',403);
  const id=documentId(request);
  if(!WZ_ID.test(id))return fail('Nieprawidłowy numer WZ.');
  const view=new URL(request.url).searchParams.get('view')||'status';
  try{
    await ensureTable(env.DB);
    const row=await getRow(env.DB,id);
    if(view==='status'){
      const now=Date.now();
      return workerJson({ok:true,serverNow:now,storageReady:r2Ready(env),
        document:publicRecord(row,now)});
    }
    if(view==='pdf'){
      if(!row)return fail('Nie zapisano jeszcze CMR dla tej WZ.',404);
      if(!r2Ready(env))return fail('Archiwum CMR jest niedostępne.',503);
      await recordPhotoRead(env.DB);
      const object=await env.PART_PHOTOS.get(row.object_key);
      if(!object)return fail('Nie znaleziono zapisanego PDF-u CMR.',503);
      return pdfResponse(object.body,id);
    }
    return fail('Nieznany widok dokumentu.',404);
  }catch(err){
    console.error('Belleville CMR document GET failed',err?.name||'Error');
    return fail('Nie udało się odczytać CMR z archiwum.',503);
  }
}
export async function onRequestPost({request,env}){
  const url=new URL(request.url);
  if(request.headers.get('Origin')!==url.origin)
    return fail('Niedozwolona domena.',403);
  if(!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('multipart/form-data'))
    return fail('Wymagany dokument PDF.',415);
  let user;
  try{user=await authorize(request,env);}
  catch(_){return fail('Nie udało się zweryfikować sesji.',503);}
  if(!user)return fail('Brak dostępu do Office Francja.',403);
  const previewOnly=url.searchParams.get('view')==='preview';
  if(!previewOnly&&!r2Ready(env))return fail('Archiwum R2 nie jest skonfigurowane. Nie można zatwierdzić wydruku.',503);
  if(Number(request.headers.get('Content-Length')||0)>MAX_PDF+MAX_FIELDS+16384)
    return fail('Dokument CMR jest zbyt duży.',413);
  let form;
  try{form=await request.formData();}
  catch(_){return fail('Nie udało się odczytać dokumentu.',400);}
  const id=String(form.get('documentId')||'');
  const revision=Number(form.get('revision'));
  const raw=String(form.get('fields')||'');
  const file=form.get('pdf');
  if(!WZ_ID.test(id))return fail('Nieprawidłowy numer WZ.');
  if(!Number.isSafeInteger(revision)||revision<0)return fail('Nieprawidłowa wersja CMR.');
  if(raw.length<2||raw.length>MAX_FIELDS)return fail('Nieprawidłowe dane CMR.',413);
  if(!file||typeof file.arrayBuffer!=='function'||
     file.size<300||file.size>MAX_PDF)
    return fail('CMR musi być dokumentem PDF do 6 MB.',413);
  let fields;
  try{
    fields=JSON.parse(raw);
    if(!fields||Array.isArray(fields)||typeof fields!=='object'||
       fields.number!==id||typeof fields.route!=='string'||
       typeof fields.loadingDate!=='string'||typeof fields.issueDate!=='string')
      throw Error();
  }catch(_){return fail('Nieprawidłowe pola CMR.',400);}
  if(Object.prototype.hasOwnProperty.call(fields,'stampBase64'))
    return fail('Odśwież Office, aby użyć nowego zabezpieczenia CMR.',409);
  let bytes=new Uint8Array(await file.arrayBuffer());
  const pdfHead=new TextDecoder().decode(bytes.slice(0,5));
  const pdfTail=new TextDecoder().decode(bytes.slice(-1024));
  if(pdfHead!=='%PDF-'||!pdfTail.includes('%%EOF'))
    return fail('Wysłany plik nie jest prawidłowym PDF-em.',415);
  if(previewOnly){
    try{
      const result=await stampCmrPdf(env.DB,bytes,fields);
      if(result.byteLength>MAX_PDF)return fail('Dokument CMR jest zbyt duży.',413);
      return pdfResponse(result,id);
    }catch(err){
      console.error('Belleville CMR preview failed',err?.name||'Error');
      return fail(err?.status?err.message:'Nie udało się przygotować podglądu CMR.',err?.status||503);
    }
  }
  const cleanFields=JSON.stringify(cmrPublicFields(fields));
  let reserved=false,uploaded=false,stored=false;
  const objectKey='cmr/belleville/'+id+'/'+crypto.randomUUID()+'.pdf';
  let previous=null;
  try{
    await ensureTable(env.DB);
    const now=Date.now();
    previous=await getRow(env.DB,id);
    if(previous&&now>=Number(previous.locked_at_ms))
      return fail('Minęło 60 minut od pierwszego wydruku. CMR jest zablokowana.',423);
    if(revision!==(previous?Number(previous.revision):0))
      return fail('CMR została zmieniona na innym urządzeniu. Otwórz ją ponownie.',409);
    bytes=await stampCmrPdf(env.DB,bytes,fields);
    if(bytes.byteLength>MAX_PDF)return fail('Dokument CMR jest zbyt duży.',413);
    await ensurePhotoTables(env.DB);
    await reservePhotoWrite(env.DB,bytes.byteLength);
    reserved=true;
    const upload=await env.PART_PHOTOS.put(objectKey,bytes,{
      httpMetadata:{contentType:'application/pdf',cacheControl:'private, no-store'}
    });
    if(!upload)throw Error('R2 nie potwierdziło zapisu CMR.');
    uploaded=true;
    const writtenAt=Date.now();
    let outcome;
    if(previous){
      outcome=await env.DB.prepare('UPDATE cmr_belleville_documents SET '+
        'object_key=?,size_bytes=?,fields_json=?,revision=revision+1,updated_at_ms=? '+
        'WHERE document_id=? AND revision=? AND locked_at_ms>?')
        .bind(objectKey,bytes.byteLength,cleanFields,writtenAt,id,revision,writtenAt).run();
    }else{
      outcome=await env.DB.prepare('INSERT OR IGNORE INTO cmr_belleville_documents '+
        '(document_id,started_at_ms,locked_at_ms,object_key,size_bytes,'+
        'fields_json,revision,updated_at_ms) VALUES (?,?,?,?,?,?,1,?)')
        .bind(id,writtenAt,writtenAt+WINDOW_MS,objectKey,bytes.byteLength,cleanFields,writtenAt).run();
    }
    if(Number(outcome?.meta?.changes||0)!==1)
      throw Object.assign(Error('CMR została właśnie zmieniona albo zablokowana. Otwórz ją ponownie.'),{status:409});
    stored=true;
    // Keep only the current PDF. Remove replaced R2 file; no edit history.
    if(previous){
      try{
        await env.PART_PHOTOS.delete(previous.object_key);
        await releasePhotoBytes(env.DB,Number(previous.size_bytes));
      }catch(cleanupError){
        console.error('Belleville CMR old PDF cleanup failed',cleanupError?.name||'Error');
      }
    }
    const current=await getRow(env.DB,id);
    const serverNow=Date.now();
    return workerJson({ok:true,serverNow,document:publicRecord(current,serverNow)});
  }catch(err){
    console.error('Belleville CMR print save failed',err?.name||'Error');
    if(!stored){
      if(uploaded){
        try{
          await env.PART_PHOTOS.delete(objectKey);
          if(reserved)await releasePhotoBytes(env.DB,bytes.byteLength);
        }catch(cleanupError){
          console.error('Belleville CMR R2 rollback failed',cleanupError?.name||'Error');
        }
      }else if(reserved){
        await releasePhotoBytes(env.DB,bytes.byteLength).catch(()=>{});
      }
    }
    return fail(err?.status?err.message:'Nie udało się zapisać CMR. Drukowanie wstrzymane.',err?.status||503);
  }
}
