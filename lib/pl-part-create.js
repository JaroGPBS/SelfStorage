// Shared, authenticated PL catalogue part creation for warehouse and office.
// Duplicate checks, optional SAP, one compressed D1 photo and pending review.
import {workerJson} from './pl-worker-auth.js';

const fail=(message,status=400)=>workerJson({ok:false,error:message},status);

export async function createUnverifiedPart(db,warehouseId,actorId,body) {
  const name=String(body.name||'').trim().replace(/\s+/g,' ');
  const sap=String(body.sap||'').trim().toUpperCase();
  const rawCode=String(body.code||'').replace(/\u0000/g,'').trim().toUpperCase();
  if(name.length<2||name.length>120||/[\u0000-\u001f\u007f]/.test(name))
    return fail('Wpisz oryginalną nazwę części (od 2 do 120 znaków).',400);
  if(sap.length>100||/[\u0000-\u001f\u007f]/.test(sap))
    return fail('Nieprawidłowy indeks SAP.',400);
  if(rawCode.length>120||/[\u0000-\u001f\u007f]/.test(rawCode))
    return fail('Niepoprawny kod części.',400);
  const number=/^[A-Z0-9._\/-]{2,80}$/.test(rawCode)
    ?rawCode
    :'NOWA-PL-'+crypto.randomUUID().slice(0,12).toUpperCase();

  // Do not create another central catalogue entry for the same SAP/code or
  // exactly the same name. The admin can later correct a newly added part.
  const existing=await db.prepare(
    'SELECT id FROM parts WHERE active=1 AND ('+
    'name=? COLLATE NOCASE OR (?<>\'\' AND (UPPER(sap_number)=? OR UPPER(part_number)=?)) '+
    'OR (?<>\'\' AND (UPPER(part_number)=? OR UPPER(sap_number)=?))) LIMIT 1'
  ).bind(name,sap,sap,sap,rawCode,rawCode,rawCode).first();
  if(existing)return fail('Ta część lub jej indeks już istnieje w katalogu. Wyszukaj ją zamiast dodawać ponownie.',409);
  if(rawCode) {
    const reserved=await db.prepare(
      'SELECT part_id FROM pl_part_verifications WHERE raw_code=? LIMIT 1'
    ).bind(rawCode).first();
    if(reserved)return fail('Część o tym kodzie już istnieje. Wyszukaj ją w katalogu.',409);
  }

  const photo=body.photo;
  let mime='',base64='';
  if(photo!==undefined&&photo!==null&&photo!=='') {
    if(typeof photo!=='string'||photo.length>240000)
      return fail('Zdjęcie jest za duże. Wybierz mniejsze zdjęcie.',413);
    const match=/^data:(image\/jpeg|image\/webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo);
    if(!match||match[2].length>225000||match[2].length%4!==0)
      return fail('Nieprawidłowy format zdjęcia.',400);
    mime=match[1];base64=match[2];
    let data;
    try{data=atob(base64);}catch{return fail('Nie można odczytać zdjęcia.',400);}
    if(data.length<100||data.length>160000||
      (mime==='image/jpeg'&&!(data.charCodeAt(0)===255&&data.charCodeAt(1)===216&&data.charCodeAt(2)===255))||
      (mime==='image/webp'&&!(data.slice(0,4)==='RIFF'&&data.slice(8,12)==='WEBP')))
      return fail('Zdjęcie musi mieć format JPG/WEBP i maksymalnie 160 KB.',400);
  }

  const id='GPBS-P-'+crypto.randomUUID();
  try {
    if(base64)await db.prepare(
      'CREATE TABLE IF NOT EXISTS pl_part_photos ('+
      'part_id TEXT PRIMARY KEY REFERENCES parts(id),'+
      'mime_type TEXT NOT NULL CHECK(mime_type IN (\'image/jpeg\',\'image/webp\')),'+
      'photo_base64 TEXT NOT NULL,'+
      'created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
    ).run();
    const statements=[
      db.prepare('INSERT INTO parts (id,part_number,name,sap_number,active) VALUES (?,?,?,?,1)')
        .bind(id,number,name,sap||null),
      db.prepare(
        'INSERT INTO pl_part_verifications '+
        '(part_id,warehouse_id,raw_code,created_by,status) VALUES (?,?,?,?,\'PENDING\')'
      ).bind(id,warehouseId,rawCode||null,actorId)
    ];
    if(base64)statements.push(db.prepare(
      'INSERT INTO pl_part_photos (part_id,mime_type,photo_base64) VALUES (?,?,?)'
    ).bind(id,mime,base64));
    await db.batch(statements);
    return workerJson({ok:true,part:{id,name,number,sap:sap||null,needsVerification:true},
      message:'Nowa część zapisana w katalogu i przekazana do weryfikacji.'});
  }catch(error) {
    if(String(error?.message||'').toLowerCase().includes('constraint'))
      return fail('Istnieje już część o takim numerze, indeksie lub nazwie. Wyszukaj ją.',409);
    throw error;
  }
}
