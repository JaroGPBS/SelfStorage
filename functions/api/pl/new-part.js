// Single authenticated R2 new-part upload for both PL warehouse and Office.
// Multipart form keeps the original photograph, never a compressed base64 copy.
import {verifyWorkerSession,workerAuthReady,workerJson} from '../../../lib/pl-worker-auth.js';
import {verifyRememberSession} from '../../../lib/pl-office-remember.js';
import {createUnverifiedPart} from '../../../lib/pl-part-create.js';
import {r2Ready,ensurePhotoTables,readValidatedPhoto,
  reservePhotoWrite,releasePhotoBytes} from '../../../lib/pl-r2-photos.js';

const ALLOWED=new Set(['ADMIN','KIEROWNIK','KOORDYNATOR','MAGAZYNIER']);
const WAREHOUSE=/^[A-Z0-9-]{2,50}$/;
const fail=(error,status=400)=>workerJson({ok:false,error},status);

export async function onRequestPost({request,env}){
  if(!workerAuthReady(env))return fail('Logowanie nie jest skonfigurowane.',503);
  if(request.headers.get('Origin')!==new URL(request.url).origin)
    return fail('Niedozwolony adres żądania.',403);
  if(!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('multipart/form-data;'))
    return fail('Wymagany formularz zdjęcia.',415);
  const length=Number(request.headers.get('Content-Length')||0);
  if(length>22*1024*1024)return fail('Zdjęcie przekracza 20 MB.',413);
  let user;
  try{user=await verifyWorkerSession(request,env)||
    await verifyRememberSession(request,env);}
  catch{return fail('Nie można potwierdzić sesji.',503);}
  if(!user)return fail('Zaloguj się ponownie.',401);
  if(!ALLOWED.has(user.role))return fail('Brak uprawnień do dodawania części.',403);

  let form;
  try{form=await request.formData();}
  catch{return fail('Nie udało się odczytać formularza.',400);}
  const warehouseId=String(form.get('warehouseId')||'').trim();
  if(!WAREHOUSE.test(warehouseId))return fail('Nieprawidłowy magazyn.');
  if(!user.warehouses.some(w=>w.id===warehouseId))
    return fail('Brak dostępu do magazynu.',403);
  const name=String(form.get('name')||'').trim();
  const sap=String(form.get('sap')||'').trim();
  if(name.length>120||sap.length>100)return fail('Zbyt długa nazwa lub indeks SAP.');
  const file=form.get('photo');
  const hasPhoto=file&&typeof file==='object'&&file.size>0;
  if(hasPhoto&&!r2Ready(env))
    return fail('R2 nie jest jeszcze dostępne. Dodaj część bez zdjęcia lub zgłoś problem administratorowi.',503);
  let photo=null;
  try{
    const enabled=await env.DB.prepare(
      "SELECT id FROM warehouses WHERE id=? AND country_code='PL' AND active=1"
    ).bind(warehouseId).first();
    if(!enabled)return fail('Magazyn niedostępny.',404);
    const verification=await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pl_part_verifications'"
    ).first();
    if(!verification)return fail('Brak tabeli weryfikacji części.',503);
    if(hasPhoto){
      await ensurePhotoTables(env.DB);
      photo=await readValidatedPhoto(file);
    }
  }catch(err){
    return fail(err?.message||'Nie można przygotować zdjęcia.',err?.status||503);
  }
  if(!photo){
    try{return await createUnverifiedPart(env.DB,warehouseId,user.id,{name,sap});}
    catch(err){console.error('R2 new part without photo failed',err?.name||'Error');
      return fail('Nie udało się dodać części.',503);}
  }
  const ext={
    'image/jpeg':'jpg','image/png':'png','image/bmp':'bmp',
    'image/webp':'webp','image/heic':'heic','image/avif':'avif'
  }[photo.type];
  const key='parts/'+crypto.randomUUID()+'.'+ext;
  let reserved=false,uploaded=false;
  try{
    await reservePhotoWrite(env.DB,photo.bytes.byteLength);
    reserved=true;
    const saved=await env.PART_PHOTOS.put(key,photo.bytes,{
      httpMetadata:{contentType:photo.type,cacheControl:'private, no-store'}
    });
    if(!saved)throw Error('R2 nie przyjęło zdjęcia.');
    uploaded=true;
    const response=await createUnverifiedPart(env.DB,warehouseId,user.id,{name,sap},{
      photoObject:{key,type:photo.type,size:photo.bytes.byteLength}
    });
    if(response.ok)return response;
    // Failed database validation (e.g. duplicate part): do not retain an orphan.
    return await discard(response);
  }catch(error){
    console.error('R2 new part failed',error?.name||'Error');
    return await discard(fail(error?.status?error.message:
      'Nie udało się zapisać zdjęcia w R2. Część nie została dodana.',error?.status||503));
  }
  async function discard(response){
    if(uploaded){
      try{await env.PART_PHOTOS.delete(key);}
      catch(err){
        console.error('R2 cleanup failed',err?.name||'Error');
        // Keep bytes reserved if the object was not removed.
        return response;
      }
    }
    if(reserved)await releasePhotoBytes(env.DB,photo.bytes.byteLength)
      .catch(err=>console.error('R2 quota cleanup failed',err?.name||'Error'));
    return response;
  }
}
