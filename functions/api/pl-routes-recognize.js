// GPBS Storage — authenticated, read-only WZ photo extraction for Office PL.
// No catalogue, route, or R2 writes happen in this endpoint.
import {verifyWorkerSession,workerAuthReady,workerJson} from '../../lib/pl-worker-auth.js';
import {verifyRememberSession} from '../../lib/pl-office-remember.js';
import {readValidatedPhoto} from '../../lib/pl-r2-photos.js';
import {listRouteParts,normalizeRoutePart} from '../../lib/pl-route-parts.js';

const ROLES=new Set(['ADMIN','KIEROWNIK','KOORDYNATOR']);
const AI_MODEL='@cf/cloudflare/clairic';
const MAX_AI_BYTES=4*1024*1024;
const fail=(error,status=400)=>workerJson({ok:false,error},status);

function base64Image(bytes){
  // Chunk boundaries are divisible by three, so no intermediate base64 padding.
  const chunk=24576;
  let encoded='';
  for(let i=0;i<bytes.length;i+=chunk)
    encoded+=btoa(String.fromCharCode(...bytes.subarray(i,i+chunk)));
  return encoded;
}
function clean(value,max){
  return String(value??'').replace(/[\x00-\x1f\x7f]/g,' ')
    .replace(/\s+/g,' ').trim().slice(0,max);
}
function validISODate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T00:00:00Z');
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function extractValue(result,key){
  return result?.answers?.[key]?.value??null;
}
function catalogueMatch(name,code,parts){
  const normName=normalizeRoutePart(name);
  const normCode=normalizeRoutePart(code);
  if(normCode){
    const byCode=parts.filter(part=>normalizeRoutePart(part.code)===normCode);
    if(byCode.length===1)return byCode[0];
  }
  if(normName){
    const byName=parts.filter(part=>normalizeRoutePart(part.name)===normName);
    if(byName.length===1)return byName[0];
  }
  return null; // Never guess a catalogue ID on a fuzzy or ambiguous match.
}
function parseLines(values,parts,confidence){
  const grouped=new Map();
  let missingQuantities=0;
  let unmatched=0;
  let ignored=0;
  for(const candidate of Array.isArray(values)?values.slice(0,150):[]){
    if(!candidate||typeof candidate!=='object'){ignored++;continue;}
    const name=clean(candidate.partName??candidate.name,180);
    const code=clean(candidate.partCode??candidate.code,100).toUpperCase();
    if(!name&&!code){ignored++;continue;}
    const raw=candidate.quantity;
    const numeric=raw===null||raw===undefined||raw===''?NaN:Number(raw);
    const missing=!Number.isSafeInteger(numeric)||numeric<1;
    const quantity=missing?1:numeric;
    if(quantity>999999){ignored++;continue;}
    const match=catalogueMatch(name,code,parts);
    if(!match)unmatched++;
    if(missing)missingQuantities++;
    const key=match?'id:'+match.id:'text:'+normalizeRoutePart(name||code);
    const existing=grouped.get(key);
    if(existing){
      if(existing.quantity+quantity>999999){ignored++;continue;}
      existing.quantity+=quantity;
      existing.review=existing.review||missing||!match;
    }else{
      grouped.set(key,{
        catalogPartId:match?.id||'',
        partName:match?.name||name||code,
        partCode:match?.code||code,
        quantity,
        review:missing||!match||confidence<0.72
      });
    }
  }
  return {lines:[...grouped.values()],missingQuantities,unmatched,ignored};
}
export async function onRequestPost({request,env}){
  const url=new URL(request.url);
  if(request.headers.get('Origin')!==url.origin)
    return fail('Niedozwolona domena.',403);
  if(!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('multipart/form-data'))
    return fail('Prześlij zdjęcie dokumentu WZ.',415);
  if(!env.DB||!workerAuthReady(env))return fail('Panel Office jest niedostępny.',503);
  let user;
  try{user=await verifyWorkerSession(request,env)||await verifyRememberSession(request,env);}
  catch{return fail('Nie udało się sprawdzić sesji.',503);}
  if(!user)return fail('Zaloguj się ponownie.',401);
  if(!user.apps?.office||!user.markets?.PL||!ROLES.has(user.role))
    return fail('Brak uprawnień do rozpoznawania dokumentów tras PL.',403);
  if(!env.AI||typeof env.AI.run!=='function')
    return fail('Odczyt AI nie jest jeszcze skonfigurowany w Cloudflare (binding AI). Części można wpisać ręcznie.',503);
  if(Number(request.headers.get('Content-Length')||0)>MAX_AI_BYTES+262144)
    return fail('Zdjęcie do odczytu AI jest zbyt duże.',413);
  let file;
  try{file=(await request.formData()).get('photo');}
  catch{return fail('Nie udało się odczytać zdjęcia.',400);}
  if(!(file instanceof Blob)||file.size<100||file.size>MAX_AI_BYTES)
    return fail('Zdjęcie AI musi mieć maksymalnie 4 MiB.',413);
  let photo;
  try{photo=await readValidatedPhoto(file);}
  catch(error){return fail(error?.message||'Nieprawidłowy plik zdjęcia.',error?.status||400);}
  if(!['image/jpeg','image/png','image/webp'].includes(photo.type))
    return fail('Odczyt AI obsługuje JPG, PNG lub WEBP.',415);
  try{
    const answer=await env.AI.run(AI_MODEL,{
      model:'clairic',
      state:'Odczytaj wyłącznie dane widoczne na załączonym zdjęciu polskiego dokumentu WZ / załadunku trasy montażowej. '+
        'Rozpoznaj numer trasy, datę załadunku oraz wszystkie wiersze części lub modułów wraz z ilościami sztuk. '+
        'Zachowaj oryginalne nazwy i indeksy SAP/GPBS. Ilość niepodana lub nieczytelna: wpisz null (aplikacja przyjmie 1 do kontroli). '+
        'Nie odczytuj i nie zwracaj numerów seryjnych, podpisów, lokalizacji ani innych danych osobowych. '+
        'Nie wymyślaj brakujących pozycji i nie traktuj numerów katalogowych jako ilości.',
      images:[{content_type:photo.type,base64:base64Image(photo.bytes)}],
      fields:{
        route_number:{type:'text',instructions:'Numer TRASY widoczny na dokumencie; nie numer WZ, jeśli to inne pole.'},
        loading_date:{type:'date',source_only:true,instructions:'Data załadunku trasy z dokumentu, w formacie ISO YYYY-MM-DD; null gdy nie ma takiej daty.'},
        items:{
          type:'list',max_items:150,
          instructions:'Każdy wiersz pozycji części lub modułów z dokumentu; nie łącz powtórzeń, nie uwzględniaj podpisów i numerów seryjnych.',
          items:{type:'object',properties:{
            partName:{type:'text',instructions:'Nazwa części lub modułu w tym wierszu.'},
            partCode:{type:'text',instructions:'Indeks SAP/GPBS, tylko jeśli wydrukowano przy tej części.'},
            quantity:{type:'number',integer:true,instructions:'Liczba sztuk w tym wierszu; null, jeśli brak lub nieczytelna.'}
          }}
        }
      }
    });
    if(!answer||typeof answer!=='object'||!answer.answers)
      throw Error('Nieprawidłowa odpowiedź modelu.');
    const routeNumber=clean(extractValue(answer,'route_number'),80).toUpperCase();
    const rawDate=clean(extractValue(answer,'loading_date'),20);
    const routeDate=validISODate(rawDate)?rawDate:'';
    const catalogue=await listRouteParts(env.DB,'',3000);
    const confidence=Number(answer.answers.items?.confidence??1);
    const parsed=parseLines(extractValue(answer,'items'),catalogue,confidence);
    const warnings=[];
    if(answer.truncated)warnings.push('Odczyt AI mógł pominąć część dokumentu.');
    if(!routeNumber)warnings.push('Nie rozpoznano numeru trasy.');
    if(!routeDate)warnings.push('Nie rozpoznano daty załadunku.');
    if(!parsed.lines.length)warnings.push('Nie rozpoznano pozycji — wprowadź je ręcznie.');
    if(parsed.unmatched)warnings.push('Część nazw nie została jednoznacznie dopasowana do katalogu. Sprawdź je.');
    if(parsed.missingQuantities)warnings.push('Nieczytelne ilości ustawiono na 1. Sprawdź je.');
    if(parsed.ignored)warnings.push('Pominięto niepełne lub nieprawidłowe wiersze. Sprawdź zdjęcie.');
    return workerJson({ok:true,routeNumber,routeDate,lines:parsed.lines,warnings,
      needsReview:parsed.lines.some(line=>line.review)||Boolean(warnings.length)});
  }catch(error){
    console.error('PL route AI recognition failed',error?.name||'Error');
    return fail('Odczyt AI nie powiódł się. Zdjęcie pozostaje wybrane, a dane możesz wpisać ręcznie.',503);
  }
}
