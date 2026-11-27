// GPBS: owner-only delegated mail composer; no access token in browser.
(()=>{
'use strict';
let account=null,version=0,context=null,busy=false,popup=null;
const $=id=>document.getElementById(id),dialog=()=>$('documentMailDialog');
const allowed=()=>account?.role==='ADMIN'&&String(account?.nickname||'').trim().toUpperCase()==='JJ';
function status(message,error=false){$('documentMailStatus').textContent=message;$('documentMailStatus').classList.toggle('error',error);}
function buttons(){
 const connected=!!context?.connected,sent=!!context?.sent;
 $('documentMailConnect').disabled=busy||connected||sent;
 $('documentMailRefresh').disabled=busy||sent;
 $('documentMailSend').disabled=busy||!connected||sent;
 $('documentMailClose').disabled=busy;
}
function reset(){
 version++;context=null;busy=false;
 if(popup&&!popup.closed)popup.close();popup=null;
 if(dialog().open)dialog().close();
 $('documentMailForm').reset();$('documentMailSend').textContent='Wyślij wiadomość';buttons();
}
function setAccount(user){reset();account=user||null;}
async function request(action,form){
 const r=await fetch('/api/microsoft-mail'+(action?'?action='+action:''),{method:action?'POST':'GET',credentials:'same-origin',cache:'no-store',...(form?{body:form}:{})});
 const d=await r.json().catch(()=>({}));
 if(!r.ok||!d.ok)throw Error(d.error||'Poczta jest niedostępna.');
 return d;
}
async function refresh(load=false){
 const v=version,c=context;if(!c||busy||!allowed()||c.sent)return;
 busy=true;buttons();status('Sprawdzanie połączenia…');
 try{
  const result=await request();
  if(v!==version||context!==c)return;
  $('documentMailSender').textContent=result.email;
  if(load)$('documentMailRecipients').value=c.test?result.email:(result.recipients?.[c.type]||[]).join('; ');
  c.connected=result.connected;
  status(c.connected?'Połączono z Microsoft Exchange.':'Połącz konto Microsoft, aby wysłać wiadomość.');
 }catch(e){if(v===version&&context===c){c.connected=false;status(e.message,true);}}
 finally{if(v===version&&context===c){busy=false;buttons();}}
}
function open(type,id,doc,revision){
 if(!allowed()||busy)return;
 reset();
 const test=id.includes('DEMO'),name=type==='CMR'?'CMR '+id:id;
 context={type,id,doc,revision,test,connected:false,sent:false};
 $('documentMailHeading').textContent='Wyślij e-mail · '+name;
 $('documentMailSender').textContent='—';
 $('documentMailSubject').value=(test?'TEST – ':'')+'GPBS Belleville – '+name;
 $('documentMailBody').value=(test?'Wiadomość testowa – dane fikcyjne.\n\n':'')+'Dzień dobry,\n\nw załączniku przesyłam dokument '+name+'.\n\nPozdrawiam';
 $('documentMailAttachment').textContent=(type==='CMR'?'CMR-':'')+id+'.pdf'+(test?' (dane fikcyjne)':'');
 dialog().showModal();void refresh(true);
}
async function connect(){
 if(!context||busy||!allowed())return;
 const v=version,c=context;
 popup=window.open('about:blank','gpbsMicrosoftMail','popup,width=560,height=760');
 if(!popup){status('Zezwól na wyskakujące okna w przeglądarce.',true);return;}
 const win=popup;
 try{win.opener=null;}catch{}
 busy=true;buttons();status('Otwieranie logowania Microsoft…');
 try{
  const result=await request('start');
  if(v!==version||context!==c){win.close();return;}
  const target=new URL(result.url);
  if(target.origin!=='https://login.microsoftonline.com')throw Error('Nieprawidłowy adres autoryzacji.');
  win.location.replace(target.href);
  status('Zaloguj się do Microsoftu, zamknij okno i kliknij Sprawdź połączenie.');
 }catch(e){win.close();if(v===version)status(e.message,true);}
 finally{if(v===version){busy=false;buttons();}}
}
async function documentPdf(doc){
 if(!doc||!Array.isArray(doc.modules)||!Array.isArray(doc.parts))throw Error('Brak danych dokumentu.');
 const {lib,fontkit,fontBytes}=await window.GPBSBellevilleCmrPdfDemo.pdfResources();
 const pdf=await lib.PDFDocument.create();pdf.registerFontkit(fontkit);
 const reg=await pdf.embedFont(fontBytes[0],{subset:true}),bold=await pdf.embedFont(fontBytes[1],{subset:true});
 const ink=lib.rgb(.1,.13,.17),gray=lib.rgb(.35,.38,.42),line=lib.rgb(.82,.85,.88);
 const left=42,right=553,width=511;let page,y;
 function text(value,x,at,size=10,font=reg,color=ink){page.drawText(String(value??'—'),{x,y:at,size,font,color});}
 function wrap(value,font,size,max){
  const out=[];
  for(const para of String(value??'—').split(/\r?\n/)){
   let row='';
   for(const word of para.split(/\s+/)){
    const candidate=row?row+' '+word:word;
    if(font.widthOfTextAtSize(candidate,size)<=max){row=candidate;continue;}
    if(row){out.push(row);row='';}
    for(const c of word){if(row&&font.widthOfTextAtSize(row+c,size)>max){out.push(row);row='';}row+=c;}
   }
   out.push(row||' ');
  }
  return out;
 }
 function newPage(){
  page=pdf.addPage([595.28,841.89]);y=806;
  text('GPBS STORAGE · BELLEVILLE',left,y,10,bold,gray);
  text(doc.id,right-bold.widthOfTextAtSize(doc.id,11),y,11,bold);y-=26;
 }
 function space(h){if(y-h<45)newPage();}
 function paragraph(value,size=10,font=reg){for(const row of wrap(value,font,size,width)){space(size+4);text(row,left,y,size,font);y-=size+4;}}
 function heading(value){space(32);y-=5;paragraph(value,12,bold);y-=3;}
 function tableRow(values,widths,fonts=values.map(()=>reg),size=9){
  const lines=values.map((v,i)=>wrap(v,fonts[i],size,widths[i]-12));let offset=0,max=Math.max(...lines.map(a=>a.length));
  while(offset<max){
   if(y<75)newPage();
   const count=Math.min(max-offset,Math.max(1,Math.floor((y-53)/12))),height=count*12+8;
   space(height);let x=left;
   for(let i=0;i<values.length;i++){
    page.drawRectangle({x,y:y-height+4,width:widths[i],height,borderWidth:.5,borderColor:line});
    for(let j=0;j<count;j++)if(lines[i][offset+j])text(lines[i][offset+j],x+6,y-8-j*12,size,fonts[i]);
    x+=widths[i];
   }
   y-=height;offset+=count;
  }
 }
 newPage();
 paragraph(doc.direction==='PZ'?'POTWIERDZENIE PRZYJĘCIA':'WYDANIE ZEWNĘTRZNE',17,bold);
 if(doc.id.includes('DEMO'))paragraph('DANE FIKCYJNE – DOKUMENT TESTOWY',10,bold);y-=8;
 const fields=[['Trasa',doc.route,'Tydzień',doc.week],['Data',doc.date+' '+(doc.time||''),doc.direction==='PZ'?'Przyjął':'Wydał',doc.worker],['Przewoźnik',doc.carrier,'Kierowca',doc.driver],['Samochód',doc.truck,'Przyczepa / naczepa',doc.trailer]];
 fields.forEach(row=>tableRow(row,[90,165,104,152],[bold,reg,bold,reg]));
 const grouped=new Map();
 for(const m of doc.modules){const key=m.type+' / '+m.status;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(m.serial);}
 heading('Moduły — '+doc.modules.length+' szt.');
 tableRow(['Typ / status','Ilość','Numery seryjne'],[106,46,359],[bold,bold,bold]);
 for(const [key,serials] of grouped)tableRow([key,serials.length,serials.join('\n')],[106,46,359]);
 if(!grouped.size)paragraph('Brak modułów');
 heading('Części — '+doc.parts.length+' poz.');
 tableRow(['Indeks SAP','Nazwa części','Ilość'],[100,355,56],[bold,bold,bold]);
 for(const p of doc.parts)tableRow([p.sap,p.name,p.qty],[100,355,56]);
 if(!doc.parts.length)paragraph('Brak części');
 heading('Dodatkowe informacje');paragraph(doc.comment||'Brak dodatkowych informacji.');
 space(70);y-=43;
 page.drawLine({start:{x:left,y},end:{x:left+220,y},color:gray,thickness:.6});
 page.drawLine({start:{x:right-220,y},end:{x:right,y},color:gray,thickness:.6});
 const incoming=doc.direction==='PZ';
 text(incoming?'Przekazujący — kierowca':'Wydający — magazynier',left,y-13,9,bold);
 text(incoming?'Przyjmujący — magazynier':'Odbierający — kierowca',right-220,y-13,9,bold);
 text(String(incoming?doc.driver||'—':doc.worker||'—'),left,y-26,9);
 text(String(incoming?doc.worker||'—':doc.driver||'—'),right-220,y-26,9);
 pdf.getPages().forEach((p,i)=>p.drawText((i+1)+' / '+pdf.getPageCount(),{x:535,y:25,size:8,font:reg,color:gray}));
 return await pdf.save();
}
async function send(event){
 event.preventDefault();const c=context,v=version;if(!c?.connected||busy||c.sent||!allowed())return;
 const recipients=$('documentMailRecipients').value.trim(),subject=$('documentMailSubject').value.trim(),body=$('documentMailBody').value;
 if(!recipients||!subject){status('Podaj odbiorców i temat.',true);return;}
 if(!window.confirm((c.test?'Dokument testowy. ':'')+'Wysłać wiadomość do: '+recipients+'?'))return;
 busy=true;buttons();status('Przygotowywanie dokumentu…');
 try{
  const form=new FormData();
  for(const [k,val] of Object.entries({type:c.type,documentId:c.id,recipients,subject,body,revision:c.revision||0}))form.append(k,String(val));
  if(c.type!=='CMR'){
   const bytes=await documentPdf(c.doc);if(bytes.length>2700000)throw Error('PDF przekracza limit 2,7 MB.');
   form.append('pdf',new Blob([bytes],{type:'application/pdf'}),c.id+'.pdf');
  }
  if(v!==version||context!==c||!allowed())return;
  status('Wysyłanie przez Exchange…');await request('send',form);
  if(v!==version||context!==c)return;
  c.sent=true;status('Microsoft przyjął wiadomość do wysłania. Sprawdź Elementy wysłane w Outlooku.');
  $('documentMailSend').textContent='Przyjęto do wysłania';
 }catch(e){if(v===version&&context===c){status(e.message,true);c.connected=false;}}
 finally{if(v===version&&context===c){busy=false;buttons();}}
}
function close(){if(!busy)reset();}
$('documentMailForm').addEventListener('submit',send);
$('documentMailConnect').addEventListener('click',connect);
$('documentMailRefresh').addEventListener('click',()=>void refresh());
$('documentMailClose').addEventListener('click',close);
dialog().addEventListener('cancel',e=>{e.preventDefault();close();});
window.GPBSBellevilleMail={setAccount,allowed,open,disconnect:()=>allowed()?request('disconnect').catch(()=>{}):Promise.resolve()};
})();
