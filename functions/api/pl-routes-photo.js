// GPBS Storage — private, authenticated route-document archive in Cloudflare R2.
// Only compressed JPEG copies are stored; route part quantities remain in D1.
import {verifyWorkerSession,workerAuthReady,workerJson} from '../../lib/pl-worker-auth.js';
import {verifyRememberSession} from '../../lib/pl-office-remember.js';
import {
  r2Ready,ensurePhotoTables,readValidatedPhoto,
  reservePhotoWrite,releasePhotoBytes,readPhotoResponse
} from '../../lib/pl-r2-photos.js';
import {routeEditablePredicate} from '../../lib/pl-route-editability.js';

const CAN_UPLOAD=new Set(['ADMIN','KIEROWNIK','KOORDYNATOR']);
const ROUTE_ID=/^PL-ROUTE-[a-f0-9-]{36}$/;
const PHOTO_ID=/^PL-DOC-[a-f0-9-]{36}$/;
const MAX_ARCHIVE_BYTES=4*1024*1024;
const fail=(error,status=400)=>workerJson({ok:false,error},status);

async function auth(request,env,upload=false){
  if(!workerAuthReady(env))return {response:fail('Moduł tras nie jest skonfigurowany.',503)};
  let user;
  try{user=await verifyWorkerSession(request,env)||await verifyRememberSession(request,env);}
  catch{return {response:fail('Nie udało się potwierdzić sesji.',503)};}
  if(!user)return {response:fail('Zaloguj się ponownie.',401)};
  if(!user.apps?.office||!user.markets?.PL)
    return {response:fail('Brak dostępu do tras w Polsce.',403)};
  if(upload&&!CAN_UPLOAD.has(user.role))
    return {response:fail('Brak uprawnień do dodawania zdjęć.',403)};
  return {user};
}
async function hasTable(db,name){
  return Boolean(await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).bind(name).first());
}
async function ensureRouteDocuments(db){
  if(await hasTable(db,'pl_route_documents'))return;
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS pl_route_documents ('+
    'id TEXT PRIMARY KEY,route_id TEXT NOT NULL REFERENCES pl_routes(id),'+
    'object_key TEXT NOT NULL UNIQUE,mime_type TEXT NOT NULL,'+
    'size_bytes INTEGER NOT NULL CHECK(size_bytes>0),'+
    'uploaded_by TEXT NOT NULL,uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
  ).run();
}
export async function onRequestGet({request,env}){
  const access=await auth(request,env);
  if(access.response)return access.response;
  if(!r2Ready(env))return fail('Archiwum R2 jest niedostępne.',503);
  const params=new URL(request.url).searchParams;
  const docId=params.get('documentId')||'';
  const routeId=params.get('routeId')||'';
  if(!PHOTO_ID.test(docId)||!ROUTE_ID.test(routeId))
    return fail('Nieprawidłowy identyfikator zdjęcia.',400);
  try{
    if(!await hasTable(env.DB,'pl_route_documents'))return fail('Nie znaleziono zdjęcia.',404);
    const doc=await env.DB.prepare(
      'SELECT object_key,mime_type,size_bytes FROM pl_route_documents '+
      'WHERE id=? AND route_id=?'
    ).bind(docId,routeId).first();
    if(!doc)return fail('Nie znaleziono zdjęcia.',404);
    const response=await readPhotoResponse(env,doc);
    if(!response)return fail('Plik nie został znaleziony w R2.',404);
    response.headers.set('Content-Security-Policy',"default-src 'none'; sandbox");
    response.headers.set('Content-Disposition','inline; filename="dokument-trasy.jpg"');
    return response;
  }catch(error){
    console.error('PL route photo GET failed',error?.name||'Error');
    return fail('Nie udało się odczytać zdjęcia z R2.',503);
  }
}
export async function onRequestPost({request,env}){
  const url=new URL(request.url);
  if(request.headers.get('Origin')!==url.origin)return fail('Niedozwolona domena.',403);
  if(!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('multipart/form-data'))
    return fail('Wymagane przesłanie pliku.',415);
  const access=await auth(request,env,true);
  if(access.response)return access.response;
  if(!r2Ready(env))return fail('Archiwum R2 jest niedostępne.',503);
  if(Number(request.headers.get('Content-Length')||0)>MAX_ARCHIVE_BYTES+256*1024)
    return fail('Zdjęcie jest zbyt duże po kompresji.',413);
  let form;
  try{form=await request.formData();}
  catch{return fail('Nie udało się odczytać przesłanego zdjęcia.',400);}
  const routeId=String(form.get('routeId')||'');
  const file=form.get('photo');
  if(!ROUTE_ID.test(routeId))return fail('Nieprawidłowy identyfikator trasy.');
  if(!file||typeof file.size!=='number'||file.size>MAX_ARCHIVE_BYTES||file.size<100)
    return fail('Zdjęcie musi mieć maksymalnie 4 MB po kompresji.',413);
  let photo;
  try{photo=await readValidatedPhoto(file);}
  catch(error){return fail(error?.message||'Nieprawidłowe zdjęcie.',error?.status||400);}
  if(photo.type!=='image/jpeg')return fail('Archiwum przyjmuje tylko pomniejszone zdjęcia JPEG.',415);
  const documentId='PL-DOC-'+crypto.randomUUID();
  const objectKey='routes/pl/'+routeId+'/'+crypto.randomUUID()+'.jpg';
  let reserved=false,uploaded=false,stored=false;
  try{
    const predicate=await routeEditablePredicate(env.DB,'r');
    const route=await env.DB.prepare(
      'SELECT r.id,r.status FROM pl_routes r WHERE r.id=?'
    ).bind(routeId).first();
    if(!route)return fail('Trasa nie istnieje.',404);
    const unlocked=await env.DB.prepare(
      'SELECT r.id FROM pl_routes r WHERE r.id=? AND '+predicate
    ).bind(routeId).first();
    if(!unlocked)return fail('Trasa jest już potwierdzona przez ekipę. Nie można zmieniać dokumentów.',409);
    await ensureRouteDocuments(env.DB);
    const count=await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM pl_route_documents WHERE route_id=?'
    ).bind(routeId).first();
    if(Number(count?.total||0)>=10)return fail('Do jednej trasy można dołączyć maksymalnie 10 zdjęć.',409);
    if(!await hasTable(env.DB,'pl_r2_photo_quota'))await ensurePhotoTables(env.DB);
    await reservePhotoWrite(env.DB,photo.bytes.byteLength);
    reserved=true;
    const upload=await env.PART_PHOTOS.put(objectKey,photo.bytes,{
      httpMetadata:{contentType:'image/jpeg',cacheControl:'private, no-store'}
    });
    if(!upload)throw Error('R2 nie potwierdziło zapisu zdjęcia.');
    uploaded=true;
    // Conditional insertion closes the race where the crew confirms during R2 upload.
    const outcome=await env.DB.prepare(
      'INSERT INTO pl_route_documents '+
      '(id,route_id,object_key,mime_type,size_bytes,uploaded_by) '+
      'SELECT ?,r.id,?,?,?,? FROM pl_routes r WHERE r.id=? AND '+predicate
    ).bind(documentId,objectKey,'image/jpeg',photo.bytes.byteLength,
      access.user.id,routeId).run();
    if(Number(outcome?.meta?.changes||0)!==1)
      throw Object.assign(Error('Trasa została potwierdzona przed zapisem zdjęcia.'),{status:409});
    stored=true;
    return workerJson({ok:true,documentId,sizeBytes:photo.bytes.byteLength},201);
  }catch(error){
    console.error('PL route photo POST failed',error?.name||'Error');
    if(!stored){
      if(uploaded){
        try{await env.PART_PHOTOS.delete(objectKey);}
        catch(cleanupError){
          console.error('PL route photo R2 rollback failed',cleanupError?.name||'Error');
          return fail('Nie udało się ukończyć zapisu zdjęcia; administrator musi sprawdzić archiwum R2.',503);
        }
      }
      if(reserved)await releasePhotoBytes(env.DB,photo.bytes.byteLength).catch(()=>{});
    }
    return fail(error?.status?error.message:'Nie udało się zachować zdjęcia w R2.',error?.status||503);
  }
}
