// GPBS Storage — authenticated Qwen reading of PL route WZ photos. No D1 writes.
import {verifyWorkerSession,workerAuthReady,workerJson} from '../../lib/pl-worker-auth.js';
import {verifyRememberSession} from '../../lib/pl-office-remember.js';
const send=(error,status=400)=>workerJson({ok:false,error},status);
const str=(x,max=200)=>typeof x==='string'?x.trim().slice(0,max):'';
const arr=x=>Array.isArray(x)?x:[];
const qty=x=>x===null||x===undefined||x===''?null:
  Number.isSafeInteger(Number(x))&&Number(x)>0&&Number(x)<=999999?Number(x):null;
function parseData(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Brak danych.');
  const rows=arr(input.rows).slice(0,60).map((r,i)=>({
    lp:Number.isInteger(Number(r?.lp))?Number(r.lp):i+1,
    module_type:str(r?.module_type),
    location:str(r?.location,350),
    location_code:str(r?.location_code,80),
    operation:str(r?.operation,120),
    serial_numbers:arr(r?.serial_numbers).slice(0,20).map(x=>str(x,100)).filter(Boolean),
    parts:arr(r?.parts).slice(0,60).map(p=>({
      name_raw:str(p?.name_raw||p?.name,180),
      quantity:qty(p?.quantity),
      quantity_raw:str(p?.quantity_raw,60)||null
    })).filter(p=>p.name_raw),
    uncertain_fragments:arr(r?.uncertain_fragments).slice(0,20).map(x=>str(x,180)).filter(Boolean)
  }));
  if(!rows.length)throw Error('Brak pozycji WZ.');
  return {
    document_title:str(input.document_title),
    warehouse:str(input.warehouse),
    route_number:str(input.route_number,80),
    document_date:str(input.document_date,24),
    issued_by:str(input.issued_by,80),
    rows,
    extra_items:arr(input.extra_items).slice(0,40).map(p=>({
      name_raw:str(p?.name_raw||p?.name,180),quantity:qty(p?.quantity)
    })).filter(p=>p.name_raw),
    remarks:str(input.remarks,1000),
    warnings:arr(input.warnings).slice(0,40).map(x=>str(x,250)).filter(Boolean)
  };
}
function outputText(result){
  const choice=result?.choices?.[0]?.message?.content??
    result?.result?.choices?.[0]?.message?.content??
    result?.response??result?.result?.response??'';
  const raw=Array.isArray(choice)?choice.map(x=>x?.text||'').join(''):choice;
  if(typeof raw!=='string')throw Error('Brak odpowiedzi Qwen.');
  const first=raw.indexOf('{'),last=raw.lastIndexOf('}');
  if(first<0||last<=first)throw Error('AI nie zwróciło JSON.');
  return parseData(JSON.parse(raw.slice(first,last+1)));
}
function format(bytes){
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)return 'image/png';
  if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&
    String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
  return '';
}
function toBase64(bytes){
  const chunks=[];
  for(let i=0;i<bytes.length;i+=8192)
    chunks.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
  return btoa(chunks.join(''));
}
const prompt=[
  'Odczytaj fotografię polskiego dokumentu magazynowego WZ. Zwróć WYŁĄCZNIE poprawny JSON.',
  'Schemat:',
  '{"document_title":"","warehouse":"","route_number":"","document_date":"YYYY-MM-DD",',
  '"issued_by":"","rows":[{"lp":1,"module_type":"","location":"","location_code":"",',
  '"operation":"","serial_numbers":[""],"parts":[{"name_raw":"","quantity":null,',
  '"quantity_raw":null}],"uncertain_fragments":[]}],',
  '"extra_items":[{"name_raw":"","quantity":null}],"remarks":"","warnings":[]}',
  'Odczytaj wszystkie wiersze osobno. W każdym oddziel moduł, lokalizację, numery seryjne i akcesoria.',
  'Zapisz oryginalne nazwy i numery znak po znaku; nie wymyślaj ani nie uzupełniaj braków.',
  'Dopiski przy numerach seryjnych przenieś do uncertain_fragments zamiast doklejać do numeru.',
  'Zapis 4xKOTWA to ilość 4, a 2x2m Płyta to 2 sztuki płyty 2 m.',
  'Jeżeli ilość nie jest podana, ustaw quantity=null. Nigdy nie zakładaj 1 sztuki.',
  'Nie rozdzielaj złożonej nazwy RYNNA+USZCZELKA na dwie różne części.',
  'Prace typu brukowanie nie są częścią magazynową.',
  'Zaznacz niepewne znaki w warnings i uncertain_fragments.'
].join('\n');
export async function onRequestPost({request,env}){
  if(!env.DB||!workerAuthReady(env))return send('Office jest niedostępny.',503);
  let user;
  try{user=await verifyWorkerSession(request,env)||await verifyRememberSession(request,env);}
  catch{return send('Błąd sprawdzania sesji.',503);}
  if(!user)return send('Zaloguj się ponownie.',401);
  if(!user.apps?.office||!user.markets?.PL||
     !['ADMIN','KIEROWNIK','KOORDYNATOR'].includes(user.role))
    return send('Brak uprawnień do odczytu WZ.',403);
  if(!env.AI||typeof env.AI.run!=='function')
    return send('Brakuje bindingu Workers AI o nazwie AI w projekcie Cloudflare Pages.',503);
  if(!/multipart\/form-data/i.test(request.headers.get('content-type')||''))
    return send('Wybierz zdjęcie dokumentu.',415);
  try{
    const body=await request.formData();
    const file=body.get('image');
    if(!file||typeof file.arrayBuffer!=='function'||file.size<100||file.size>4*1024*1024)
      return send('Zdjęcie musi mieć do 4 MB.',413);
    const bytes=new Uint8Array(await file.arrayBuffer());
    const mime=format(bytes);
    if(!mime)return send('Obsługiwane są JPG, PNG i WEBP.',415);
    const result=await env.AI.run('@cf/qwen/qwen3.8-27b',{
      messages:[
        {role:'system',content:'Dokładny odczyt polskiego WZ. Odpowiadaj wyłącznie JSON.'},
        {role:'user',content:[
          {type:'text',text:prompt},
          {type:'image_url',image_url:{url:'data:'+mime+';base64,'+toBase64(bytes)}}
        ]}
      ],
      reasoning_effort:'low',temperature:0,max_completion_tokens:4000,stream:false
    });
    return workerJson({ok:true,data:outputText(result),model:'@cf/qwen/qwen3.8-27b'});
  }catch(error){
    console.error('PL route WZ OCR failed',error?.name||'Error');
    return send('Odczyt AI nie powiódł się. Możesz nadal wpisać trasę ręcznie.',503);
  }
}