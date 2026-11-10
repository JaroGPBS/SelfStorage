// One shared catalogue for all GPBS Storage markets.
// A catalogue insertion never creates stock for any warehouse.
import {allocateMGIndex} from './pl-part-indexes.js';
import {r2Ready,ensurePhotoTables,readValidatedPhoto,
  reservePhotoWrite,releasePhotoBytes} from './pl-r2-photos.js';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export async function createSharedCataloguePart(env,form){
  const db=env.DB;
  const name=String(form.get('name')||'').trim().replace(/\s+/g,' ');
  const sap=String(form.get('sap')||'').trim().toUpperCase();
  if(name.length<2||name.length>120||/[\u0000-\u001f\u007f]/.test(name))
    throw fail('Podaj nazwę części (2–120 znaków).');
  if(sap.length>100||/[\u0000-\u001f\u007f]/.test(sap))
    throw fail('Nieprawidłowy indeks SAP.');
  const existing=await db.prepare(
    'SELECT id FROM parts WHERE active=1 AND '+
    "(name=? COLLATE NOCASE OR (?<>'' AND UPPER(sap_number)=?)) LIMIT 1"
  ).bind(name,sap,sap).first();
  if(existing)throw fail('Ta część lub jej indeks SAP już istnieje w katalogu.',409);

  const file=form.get('photo');
  const withPhoto=file&&typeof file==='object'&&file.size>0;
  if(withPhoto&&!r2Ready(env))
    throw fail('Zdjęcia są chwilowo niedostępne. Dodaj część bez zdjęcia.',503);
  const photo=withPhoto?await readValidatedPhoto(file):null;
  let key='',reserved=false,uploaded=false,committed=false;
  try{
    if(photo){
      await ensurePhotoTables(db);
      await reservePhotoWrite(db,photo.bytes.byteLength);
      reserved=true;
      const ext={
        'image/jpeg':'jpg','image/png':'png','image/bmp':'bmp',
        'image/webp':'webp','image/heic':'heic','image/avif':'avif'
      }[photo.type];
      key='parts/'+crypto.randomUUID()+'.'+ext;
      const saved=await env.PART_PHOTOS.put(key,photo.bytes,{
        httpMetadata:{contentType:photo.type,cacheControl:'private, no-store'}
      });
      if(!saved)throw fail('Nie udało się zapisać zdjęcia.',503);
      uploaded=true;
    }
    const number=await allocateMGIndex(db);
    const id='GPBS-P-'+crypto.randomUUID();
    const statements=[
      db.prepare('INSERT INTO parts(id,part_number,name,sap_number,active) VALUES (?,?,?,?,1)')
        .bind(id,number,name,sap||null)
    ];
    if(photo)statements.push(db.prepare(
      'INSERT INTO pl_part_photo_objects(part_id,object_key,mime_type,size_bytes) '+
      'VALUES (?,?,?,?)'
    ).bind(id,key,photo.type,photo.bytes.byteLength));
    await db.batch(statements);
    committed=true;
    return {id,name,number,sap:sap||null,hasPhoto:Boolean(photo)};
  }catch(error){
    if(!committed){
      let released=true;
      if(uploaded){
        try{await env.PART_PHOTOS.delete(key);}
        catch(cleanupError){
          released=false;
          console.error('Shared catalogue photo cleanup failed',cleanupError?.name||'Error');
        }
      }
      if(reserved&&released)await releasePhotoBytes(db,photo.bytes.byteLength)
        .catch(cleanupError=>console.error('Shared catalogue quota cleanup failed',cleanupError?.name||'Error'));
    }
    if(String(error?.message||'').toLowerCase().includes('constraint'))
      throw fail('Taka część lub indeks już istnieje w katalogu.',409);
    throw error;
  }
}
