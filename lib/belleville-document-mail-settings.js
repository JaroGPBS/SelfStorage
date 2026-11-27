// Private Belleville document recipient settings; no tokens or mail bodies.
export const DOCUMENT_MAIL_TYPES=['PZ','WZ','CMR'];
export function validateDocumentRecipients(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Object.assign(Error('Nieprawidłowa lista odbiorców.'),{status:400});
  const result={};
  for(const type of DOCUMENT_MAIL_TYPES){
    const value=input[type];
    if(typeof value!=='string'&&(!Array.isArray(value)||value.some(x=>typeof x!=='string')))
      throw Object.assign(Error('Nieprawidłowi odbiorcy '+type+'.'),{status:400});
    const entries=(Array.isArray(value)?value.join(';'):value).split(/[;,\s]+/).filter(Boolean);
    const unique=[...new Map(entries.map(x=>[x.toLowerCase(),x])).values()];
    if(unique.length>20)throw Object.assign(Error(type+': maksymalnie 20 adresów.'),{status:400});
    for(const address of unique){
      if(address.length>254||!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(address)||address.split('@')[0].length>64||address.startsWith('.')||address.includes('..')||address.includes('.@'))
        throw Object.assign(Error(type+': nieprawidłowy adres e-mail: '+address),{status:400});
    }
    result[type]=unique;
  }
  return result;
}
export async function readDocumentRecipients(db){
  const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='belleville_document_mail_settings'").first();
  if(!exists)return {PZ:[],WZ:[],CMR:[]};
  const row=await db.prepare('SELECT recipients_json FROM belleville_document_mail_settings WHERE id=1').first();
  return row?validateDocumentRecipients(JSON.parse(row.recipients_json)):{PZ:[],WZ:[],CMR:[]};
}
export async function saveDocumentRecipients(db,input){
  const recipients=validateDocumentRecipients(input);
  await db.prepare('CREATE TABLE IF NOT EXISTS belleville_document_mail_settings (id INTEGER PRIMARY KEY CHECK(id=1), recipients_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run();
  await db.prepare('INSERT INTO belleville_document_mail_settings(id,recipients_json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET recipients_json=excluded.recipients_json,updated_at=CURRENT_TIMESTAMP').bind(JSON.stringify(recipients)).run();
  return recipients;
}
