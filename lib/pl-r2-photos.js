// Private GPBS Storage R2 part photos. Only authenticated Pages Functions call these.
export const MAX_PART_PHOTO_BYTES=20*1024*1024;
export const R2_STORAGE_WARNING_BYTES=8000000000;
export const R2_STORAGE_HARD_BYTES=9000000000;
// Small conservative application-side budgets, far below R2 free-tier operations.
export const R2_MONTHLY_WRITES_MAX=20000;
export const R2_MONTHLY_READS_MAX=200000;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});

export function r2Ready(env){
  return Boolean(env?.DB&&env?.PART_PHOTOS&&
    typeof env.PART_PHOTOS.put==='function'&&typeof env.PART_PHOTOS.get==='function');
}

export async function ensurePhotoTables(db){
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS pl_part_photo_objects ('+
    'part_id TEXT PRIMARY KEY REFERENCES parts(id),'+
    'object_key TEXT NOT NULL UNIQUE,'+
    'mime_type TEXT NOT NULL,'+
    'size_bytes INTEGER NOT NULL CHECK(size_bytes>0),'+
    'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
  ).run();
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS pl_r2_photo_quota ('+
    'id INTEGER PRIMARY KEY CHECK(id=1),'+
    'used_bytes INTEGER NOT NULL DEFAULT 0,'+
    'cycle TEXT NOT NULL DEFAULT \'\','+
    'write_count INTEGER NOT NULL DEFAULT 0,'+
    'read_count INTEGER NOT NULL DEFAULT 0)'
  ).run();
  await db.prepare(
    "INSERT OR IGNORE INTO pl_r2_photo_quota (id) VALUES (1)"
  ).run();
}

const month=()=>new Date().toISOString().slice(0,7);
export async function reservePhotoWrite(db,size){
  const cycle=month();
  const row=await db.prepare(
    'UPDATE pl_r2_photo_quota SET used_bytes=used_bytes+?,'+
    'write_count=CASE WHEN cycle=? THEN write_count+1 ELSE 1 END,'+
    'read_count=CASE WHEN cycle=? THEN read_count ELSE 0 END,'+
    'cycle=? WHERE id=1 AND used_bytes+?<=? AND '+
    '(cycle<>? OR write_count<?) RETURNING used_bytes,write_count'
  ).bind(size,cycle,cycle,cycle,size,R2_STORAGE_HARD_BYTES,
    cycle,R2_MONTHLY_WRITES_MAX).first();
  if(!row)throw fail('Osiągnięto bezpieczny limit R2. Dodawanie zdjęć wstrzymane; część możesz dodać bez zdjęcia.',429);
  return row;
}
export async function releasePhotoBytes(db,size){
  if(size>0)await db.prepare(
    'UPDATE pl_r2_photo_quota SET used_bytes=MAX(0,used_bytes-?) WHERE id=1'
  ).bind(size).run();
}
export async function recordPhotoRead(db){
  const cycle=month();
  const row=await db.prepare(
    'UPDATE pl_r2_photo_quota SET '+
    'read_count=CASE WHEN cycle=? THEN read_count+1 ELSE 1 END,'+
    'write_count=CASE WHEN cycle=? THEN write_count ELSE 0 END,'+
    'cycle=? WHERE id=1 AND (cycle<>? OR read_count<?) RETURNING read_count'
  ).bind(cycle,cycle,cycle,cycle,R2_MONTHLY_READS_MAX).first();
  if(!row)throw fail('Osiągnięto bezpieczny miesięczny limit odczytów R2.',429);
}

const nameType={
  jpg:'image/jpeg',jpeg:'image/jpeg',jpe:'image/jpeg',png:'image/png',
  bmp:'image/bmp',webp:'image/webp',heic:'image/heic',heif:'image/heic',
  avif:'image/avif'
};
function guessType(bytes){
  const b=bytes;
  const chars=(a,n)=>String.fromCharCode(...b.slice(a,a+n));
  if(b[0]===255&&b[1]===216&&b[2]===255&&
     b[b.length-2]===255&&b[b.length-1]===217)return 'image/jpeg';
  if(b[0]===137&&chars(1,3)==='PNG'&&
     b[4]===13&&b[5]===10&&b[6]===26&&b[7]===10&&
     chars(12,4)==='IHDR'&&chars(b.length-8,4)==='IEND')
     return 'image/png';
  if(chars(0,4)==='RIFF'&&chars(8,4)==='WEBP'&&
     ((b[4]|b[5]<<8|b[6]<<16|b[7]<<24)>>>0)===b.length-8&&
     ['VP8 ','VP8L','VP8X'].includes(chars(12,4)))return 'image/webp';
  if(chars(0,2)==='BM'&&b.length>=54&&
     ((b[2]|b[3]<<8|b[4]<<16|b[5]<<24)>>>0)===b.length)
     return 'image/bmp';
  if(chars(4,4)==='ftyp'&&b.length>=20){
    const brand=chars(8,4);
    if(['heic','heix','hevc','hevx','heif','heis','hevm','mif1'].includes(brand))
      return 'image/heic';
    if(['avif','avis'].includes(brand))return 'image/avif';
  }
  return null;
}
export async function readValidatedPhoto(file){
  if(!(file instanceof Blob)||file.size<100||file.size>MAX_PART_PHOTO_BYTES)
    throw fail('Zdjęcie musi mieć maksymalnie 20 MB.',413);
  const filename=String(file.name||'');
  const extension=filename.includes('.')?filename.split('.').pop().toLowerCase():'';
  if(extension&&!nameType[extension])
    throw fail('Wybierz zdjęcie JPG, PNG, BMP, WEBP, HEIC lub AVIF.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  const type=guessType(bytes);
  if(!type||extension&&nameType[extension]!==type)
    throw fail('Plik nie jest poprawnym zdjęciem. ZIP, filmy i dokumenty są zablokowane.');
  const declared=String(file.type||'').toLowerCase();
  const alias={'image/jpg':'image/jpeg','image/pjpeg':'image/jpeg',
    'image/x-ms-bmp':'image/bmp','image/heif':'image/heic'};
  if(declared&&(alias[declared]||declared)!==type)
    throw fail('Format pliku nie zgadza się z deklarowanym zdjęciem.');
  return {bytes,type};
}
export async function getPhotoObject(db,partId){
  return db.prepare('SELECT object_key,mime_type,size_bytes FROM pl_part_photo_objects WHERE part_id=?')
    .bind(partId).first();
}
export async function readPhotoResponse(env,ref){
  await recordPhotoRead(env.DB);
  const object=await env.PART_PHOTOS.get(ref.object_key);
  if(!object)return null;
  return new Response(object.body,{headers:{
    'Content-Type':ref.mime_type,'Cache-Control':'private, no-store',
    'X-Content-Type-Options':'nosniff'
  }});
}
