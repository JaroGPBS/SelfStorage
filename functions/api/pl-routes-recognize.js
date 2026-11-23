// GPBS Storage — authenticated, read-only WZ extraction for Office PL.
// Whole-page metadata and a separate enlarged-table pass. No D1/R2 writes.
import {verifyWorkerSession,workerAuthReady,workerJson} from '../../lib/pl-worker-auth.js';
import {verifyRememberSession} from '../../lib/pl-office-remember.js';
import {readValidatedPhoto} from '../../lib/pl-r2-photos.js';
import {listRouteParts,normalizeRoutePart} from '../../lib/pl-route-parts.js';

const ROLES=new Set(['ADMIN','KIEROWNIK','KOORDYNATOR']);
const AI_MODEL='@cf/cloudflare/clairic';
const MAX_AI_BYTES=4*1024*1024;
const MAX_ROWS=150;
const fail=(error,status=400)=>workerJson({ok:false,error},status);

function base64Image(bytes){
  const chunk=24576; // divisible by 3; no base64 padding between blocks.
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
const extractValue=(result,key)=>result?.answers?.[key]?.value??null;
function validRowNumber(value){
  const v=Number(value);
  return Number.isSafeInteger(v)&&v>=1&&v<=MAX_ROWS?v:null;
}
function readCount(answer,key){
  const field=answer?.answers?.[key];
  const count=validRowNumber(field?.value);
  const confidence=Number(field?.confidence??0);
  return count&&(confidence>=.55||field?.valid===true)?count:null;
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
  return null; // No fuzzy guesses or automatic substitution.
}
function normalizedRow(raw,hint=null){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const position=validRowNumber(raw.position??raw.rowNumber??raw.row??hint);
  const name=clean(raw.partName??raw.name,180);
  const code=clean(raw.partCode??raw.code,100).toUpperCase();
  const rawQty=raw.quantity;
  const numeric=rawQty===null||rawQty===undefined||rawQty===''?NaN:Number(rawQty);
  const quantity=Number.isSafeInteger(numeric)&&numeric>=1&&numeric<=999999?numeric:null;
  if(!name&&!code)return {position,partName:'',partCode:'',quantity:null,review:true};
  return {position,partName:name,partCode:code,quantity,review:quantity===null};
}
function reconcileRow(first,second){
  if(!first)return second;
  if(!second)return first;
  if(!second.partName&&!second.partCode)return first;
  if(!first.partName&&!first.partCode)return second;
  const a=normalizeRoutePart(first.partName||first.partCode);
  const b=normalizeRoutePart(second.partName||second.partCode);
  const agrees=a===b||a.includes(b)||b.includes(a);
  // Prefer a complete description, but force manual review on contradictions.
  const chosen=(second.partName.length>first.partName.length)?second:first;
  return {
    position:chosen.position||first.position||second.position,
    partName:chosen.partName,
    partCode:chosen.partCode||first.partCode||second.partCode,
    quantity:!agrees||first.quantity!==null&&second.quantity!==null&&
      first.quantity!==second.quantity?null:(chosen.quantity??first.quantity??second.quantity),
    review:first.review||second.review||!agrees
  };
}
function parseTableAnswer(tableAnswer,expectedRows,parts){
  const byPosition=new Map();
  const unknown=[];
  const items=extractValue(tableAnswer,'items');
  const entries=Array.isArray(items)?items.slice(0,MAX_ROWS):[];
  const rowConfidence=Number(tableAnswer?.answers?.items?.confidence??1);
  for(const item of entries){
    const row=normalizedRow(item);
    if(!row)continue;
    if(row.position){
      byPosition.set(row.position,reconcileRow(byPosition.get(row.position),row));
    }else if(row.partName||row.partCode){
      row.review=true;
      unknown.push(row);
    }
  }
  // Per-number fields are extracted independently instead of relying on a
  // list generator to capture every tiny printed row.
  for(let position=1;position<=Math.min(expectedRows||0,20);position++){
    const answer=tableAnswer?.answers?.['row_'+position];
    const row=normalizedRow(answer?.value,position);
    if(!row||!row.partName&&!row.partCode)continue;
    if(Number(answer?.confidence??1)<.75)row.review=true;
    byPosition.set(position,reconcileRow(byPosition.get(position),row));
  }
  const numbered=extractValue(tableAnswer,'row_numbers');
  const detectedNums=(Array.isArray(numbered)?numbered:[])
    .map(validRowNumber).filter(Boolean);
  const maxEnumerated=detectedNums.length?Math.max(...detectedNums):0;
  const lastFound=Math.max(0,...byPosition.keys());
  const tableCount=readCount(tableAnswer,'printed_positions');
  // Use strong independent row count signals; do not treat part indices as Lp.
  const count=Math.max(expectedRows||0,tableCount||0,maxEnumerated,lastFound);
  const bounded=Math.min(MAX_ROWS,Math.max(count,byPosition.size+unknown.length));
  for(const row of unknown){
    for(let position=1;position<=bounded;position++){
      if(!byPosition.has(position)){row.position=position;byPosition.set(position,row);break;}
    }
  }
  const result=[];
  const missingPositions=[];
  let missingQuantities=0,unmatched=0;
  for(let position=1;position<=bounded;position++){
    const row=byPosition.get(position);
    if(!row||!row.partName&&!row.partCode){
      missingPositions.push(position);
      result.push({position,partName:'',partCode:'',catalogPartId:'',
        quantity:null,review:true,missing:true});
      continue;
    }
    const match=catalogueMatch(row.partName,row.partCode,parts);
    if(!match)unmatched++;
    if(row.quantity===null)missingQuantities++;
    result.push({
      position,partName:row.partName,partCode:row.partCode,
      catalogPartId:match?.id||'',quantity:row.quantity,
      review:row.review||!match||rowConfidence<.75,missing:false
    });
  }
  return {lines:result,expected:bounded,recognized:bounded-missingPositions.length,
    missingPositions,missingQuantities,unmatched};
}
function rowField(position){
  return {
    type:'object',
    instructions:'Tylko wiersz z kolumny Lp. = '+position+
      ' w tabeli "Wydane paczkomaty". Nie sąsiedni wiersz. '+
      'Pusta lub niewidoczna pozycja: wszystkie pola null. Zachowaj pełny tekst.',
    properties:{
      partName:{type:'text',instructions:'Pełny, dokładny opis z wiersza Lp. '+position+
        ', bez ucinania po kilku słowach.'},
      partCode:{type:'text',instructions:'Indeks SAP/GPBS z tego wiersza, jeżeli rzeczywiście widoczny.'},
      quantity:{type:'number',integer:true,
        instructions:'Liczba sztuk z kolumny Ilość tego wiersza, null jeśli nieczytelna.'}
    }
  };
}
async function aiRead(env,photo,fields,state){
  return env.AI.run(AI_MODEL,{
    model:'clairic',state,fields,
    images:[{content_type:photo.type,base64:base64Image(photo.bytes)}]
  });
}
async function checkedPhoto(file){
  if(!(file instanceof Blob)||file.size<100||file.size>MAX_AI_BYTES)
    throw Object.assign(Error('Zdjęcie AI musi mieć maksymalnie 4 MiB.'),{status:413});
  const photo=await readValidatedPhoto(file);
  if(!['image/jpeg','image/png','image/webp'].includes(photo.type))
    throw Object.assign(Error('Odczyt AI obsługuje JPG, PNG lub WEBP.'),{status:415});
  return photo;
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
    return fail('Workers AI nie jest skonfigurowane. Możesz wpisać dane ręcznie.',503);
  if(Number(request.headers.get('Content-Length')||0)>2*MAX_AI_BYTES+524288)
    return fail('Zdjęcia do analizy są zbyt duże.',413);
  let form;
  try{form=await request.formData();}
  catch{return fail('Nie udało się odczytać zdjęcia.',400);}
  const fullFile=form.get('photo'),tableFile=form.get('tablePhoto');
  let full,table;
  try{
    full=await checkedPhoto(fullFile);
    table=tableFile?await checkedPhoto(tableFile):full;
  }catch(error){return fail(error?.message||'Nieprawidłowe zdjęcie.',error?.status||400);}
  try{
    const headerFields={
      route_number:{type:'text',instructions:'Wartość pola Numer Trasy, nie numer WZ ani indeks części.'},
      loading_date:{type:'date',source_only:true,instructions:'Data załadunku w stopce dokumentu (pole Data), w formacie ISO YYYY-MM-DD.'},
      printed_positions:{type:'number',integer:true,instructions:
        'Ile osobnych numerowanych wierszy Lp. znajduje się w głównej tabeli Wydane paczkomaty? '+
        'Liczba ostatniego Lp. w ciągłej numeracji od 1, nie suma sztuk ani liczba innych wpisów.'}
    };
    let headerAnswer=null,tableAnswer=null;
    try{
      headerAnswer=await aiRead(env,full,headerFields,
        'Polski dokument WZ dla trasy montażowej. Przeczytaj nagłówek i stopkę. '+
        'Nie zgaduj brakujących danych. Nie zwracaj podpisów, nazwisk ani numerów seryjnych.');
    }catch(error){
      console.error('PL route AI metadata pass failed',error?.name||'Error');
    }
    const headerCount=readCount(headerAnswer,'printed_positions');
    const tableFields={
      printed_positions:{type:'number',integer:true,instructions:
        'Liczba numerowanych wierszy w głównej tabeli Wydane paczkomaty. '+
        'Zwróć liczbę ostatniego Lp., nie ilości sztuk.'},
      row_numbers:{type:'list',max_items:MAX_ROWS,items:'number',instructions:
        'Wszystkie numery Lp. z LEWEJ pierwszej kolumny głównej tabeli, po kolei. '+
        'Nie indeksy części, numer trasy ani ilości sztuk.'},
      items:{
        type:'list',max_items:MAX_ROWS,
        instructions:'Przepisz KAŻDY numerowany wiersz Lp. głównej tabeli '+
          '"Wydane paczkomaty" osobno, w kolejności 1,2,3... '+
          'Pełne opisy, każdą nazwę tak jak na wydruku; bez łączenia podobnych pozycji. '+
          'Nie uwzględniaj tabeli uwag, dodatkowych elementów, podpisów i numerów seryjnych.',
        items:{type:'object',properties:{
          position:{type:'number',integer:true,instructions:'Numer Lp. z pierwszej kolumny w tym wierszu.'},
          partName:{type:'text',instructions:'PEŁEN opis/rodzaj modułu lub części z wiersza, także po zawinięciu na kolejną linię.'},
          partCode:{type:'text',instructions:'Indeks SAP/GPBS tylko jeśli jest w tym wierszu.'},
          quantity:{type:'number',integer:true,instructions:'Ilość sztuk z kolumny Ilość; null gdy brak lub jest nieczytelna.'}
        }}
      }
    };
    // Small printed WZ documents benefit from a separate extraction field for
    // EACH numbered row. Limit this to 20 to avoid runaway model work.
    if(headerCount&&headerCount<=20)
      for(let position=1;position<=headerCount;position++)
        tableFields['row_'+position]=rowField(position);
    try{
      tableAnswer=await aiRead(env,table,tableFields,
        'To jest POWIĘKSZONY FRAGMENT tabeli dokumentu WZ. '+
        'Skup się wyłącznie na tabeli z nagłówkiem "WYDANE PACZKOMATY", kolumnami "Lp.", "Rodzaj i model", "Ilość". '+
        'Odczytaj wszystkie numery Lp. i ich kompletne opisy oraz ilości, także wiersze zawinięte. '+
        'Nie pomijaj numerowanych pozycji, nie dopowiadaj niewidocznego tekstu. '+
        'Nie traktuj numerów seryjnych, kodów modelu ani indeksów jako ilości.');
    }catch(error){
      console.error('PL route AI table pass failed',error?.name||'Error');
    }
    if(!headerAnswer&&!tableAnswer)
      throw Error('Oba przebiegi AI zakończyły się błędem.');
    const routeNumber=clean(extractValue(headerAnswer,'route_number'),80).toUpperCase();
    const rawDate=clean(extractValue(headerAnswer,'loading_date'),20);
    const routeDate=validISODate(rawDate)?rawDate:'';
    const catalogue=await listRouteParts(env.DB,'',3000);
    const parsed=parseTableAnswer(tableAnswer,headerCount,catalogue);
    const warnings=[];
    if(headerAnswer?.truncated||tableAnswer?.truncated)
      warnings.push('Odpowiedź AI może być niekompletna; sprawdź wszystkie pozycje.');
    if(!headerAnswer)
      warnings.push('Nie udało się odczytać nagłówka dokumentu.');
    if(!tableAnswer)
      warnings.push('Nie udało się odczytać tabeli części.');
    if(!routeNumber)warnings.push('Nie rozpoznano numeru trasy.');
    if(!routeDate)warnings.push('Nie rozpoznano daty załadunku.');
    if(!parsed.lines.length)
      warnings.push('Nie udało się ustalić liczby pozycji. Wpisz je ręcznie.');
    if(parsed.missingPositions.length)
      warnings.push('Brakuje danych z Lp. '+parsed.missingPositions.join(', ')+
        '. Dodano puste wiersze — uzupełnij je ze zdjęcia.');
    if(parsed.unmatched)
      warnings.push('Niektóre nazwy nie pasują jednoznacznie do katalogu. Sprawdź je.');
    if(parsed.missingQuantities)
      warnings.push('Nieczytelne ilości pozostawiono PUSTE. Wpisz je ze zdjęcia.');
    if(headerCount&&parsed.expected!==headerCount)
      warnings.push('Różne odczyty liczby pozycji ('+headerCount+' i '+
        parsed.expected+'). Sprawdź tabelę.');
    return workerJson({ok:true,routeNumber,routeDate,lines:parsed.lines,
      expectedPositions:parsed.expected,recognizedPositions:parsed.recognized,
      warnings,needsReview:parsed.lines.some(line=>line.review)||Boolean(warnings.length)});
  }catch(error){
    console.error('PL route AI recognition failed',error?.name||'Error');
    return fail('Odczyt AI nie powiódł się. Zdjęcie pozostaje wybrane; dane możesz wpisać ręcznie.',503);
  }
}
