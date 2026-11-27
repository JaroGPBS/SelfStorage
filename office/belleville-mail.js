// GPBS: prepare a local unsent EML, never send or authorize Microsoft.
(()=>{
'use strict';
const FILE='GPBS Storage - Ruch magazynowy.eml';
let account=null,version=0,context=null,busy=false;
const $=id=>document.getElementById(id),dialog=()=>$('documentMailDialog');
const allowed=()=>account?.role==='ADMIN'&&String(account?.nickname||'').trim().toUpperCase()==='JJ';
function status(message,error=false){$('documentMailStatus').textContent=message;$('documentMailStatus').classList.toggle('error',error);}
function buttons(){
 $('documentMailSend').disabled=busy||!context||!allowed();
 $('documentMailClose').disabled=busy;
}
function reset(){
 version++;context=null;busy=false;
 if(dialog().open)dialog().close();
 $('documentMailForm').reset();buttons();status('');
}
function setAccount(user){reset();account=user||null;}
async function loadRecipients(c,v){
 try{
  const r=await fetch('/api/belleville-eml-settings',{credentials:'same-origin',cache:'no-store'});
  const d=await r.json();
  if(v!==version||context!==c)return;
  if(!r.ok||!d.ok)throw Error(d.error||'Nie udało się pobrać odbiorców.');
  if(!c.test&&!busy&&!$('documentMailRecipients').value.trim())$('documentMailRecipients').value=(d.recipients?.[c.type]||[]).join('; ');
 }catch(e){if(v===version&&context===c&&!busy)status('Nie pobrano zapisanych odbiorców. Wpisz adres ręcznie.',true);}
}
function open(type,id,doc,revision){
 if(!allowed()||busy)return;
 reset();
 const test=id.includes('DEMO'),name=type==='CMR'?'CMR '+id:id,order=type==='ORDER';
 context={type,id,doc,revision,test};
 $('documentMailHeading').textContent='Generuj e-mail · '+name;
 $('documentMailSender').textContent='Konto wybrane w Outlooku';
 $('documentMailSubject').value=order?'Zamówienie części – Belleville':(test?'TEST – ':'')+'GPBS Belleville – '+name;
 $('documentMailBody').value=order?'Dzień dobry,\n\nw załączniku przesyłam zamówienie części do magazynu Belleville.':(test?'Wiadomość testowa – dane fikcyjne.\n\n':'')+'Dzień dobry,\n\nw załączniku przesyłam dokument '+name+'.';
 $('documentMailAttachment').textContent=attachmentName(context)+(test?' (dane fikcyjne)':'');
 dialog().showModal();buttons();status('Wpisz adres testowy lub docelowy. Wiadomość wyślesz ręcznie w Outlooku.');
 if(!test&&!order)void loadRecipients(context,version);
}
function openOrder(parts){
 const doc={id:'Zamowienie_Belleville',direction:'ORDER',modules:[],parts:parts.map(p=>({sap:p.sap,name:p.name,qty:p.qty}))};
 open('ORDER',doc.id,doc);
}
function attachmentName(c){return (c.type==='CMR'?'CMR-':'')+c.id+'.pdf';}
const utf8=new TextEncoder();
function base64(bytes){
 let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return btoa(binary);
}
const wrap64=s=>(s.match(/.{1,76}/g)||[]).join('\r\n');
function encodedSubject(s){
 const words=[];let chunk='';
 for(const ch of s){if(utf8.encode(chunk+ch).length>42&&chunk){words.push(chunk);chunk='';}chunk+=ch;}
 if(chunk)words.push(chunk);
 return words.map(w=>'=?UTF-8?B?'+base64(utf8.encode(w))+'?=').join('\r\n ');
}
const SIGNATURE_LINES=['Pozdrawiam / Best regards,','Jarosław Juszczyk','','GPBS Sp. z o.o.','ul. Nad Jeziorem 85','43-100 Tychy, POLAND','NIP / VAT ID / SIRET: 6462932155'];
const escapeHtml=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
async function signatureLogo(){
 const image=new Image();
 await new Promise((resolve,reject)=>{
  image.onload=resolve;
  image.onerror=()=>reject(Error('Nie udało się wczytać logo GPBS.'));
  image.src='./gpbs-logo-print.svg?v=1';
 });
 const canvas=document.createElement('canvas');
 canvas.width=300;canvas.height=130;
 const ctx=canvas.getContext('2d');
 if(!ctx)throw Error('Nie udało się przygotować logo GPBS.');
 ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
 const scale=Math.min(canvas.width/image.naturalWidth,canvas.height/image.naturalHeight);
 const width=image.naturalWidth*scale,height=image.naturalHeight*scale;
 ctx.drawImage(image,(canvas.width-width)/2,(canvas.height-height)/2,width,height);
 const png=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Nie udało się zapisać logo GPBS.')),'image/png'));
 return new Uint8Array(await png.arrayBuffer());
}
function emlBlob(recipients,subject,body,pdfBytes,name,logoBytes){
 const boundary='gpbs_'+crypto.randomUUID().replace(/-/g,'');
 const alt=boundary+'_alt',related=boundary+'_related',cid=boundary+'@gpbs-storage';
 const safeName=name.replace(/[^A-Za-z0-9._-]/g,'_');
 const cleanBody=body.trimEnd().replace(/(?:^|\r?\n)[ \t]*Pozdrawiam(?:[ \t]*\/[ \t]*Best regards)?[,.]?[ \t]*$/i,'').trimEnd();
 const plain=(cleanBody?cleanBody+'\n\n':'')+SIGNATURE_LINES.join('\n');
 const formatted='<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,Calibri,sans-serif;font-size:11pt;color:#222222;">'+
  '<div style="font-family:Arial,Calibri,sans-serif;font-size:11pt;line-height:1.4;">'+escapeHtml(cleanBody).replace(/\r\n|\r|\n/g,'<br>')+'</div><br><br>'+
  '<div style="font-family:Arial,Calibri,sans-serif;font-size:10pt;color:#334155;">Pozdrawiam / Best regards,</div>'+
  '<div style="font-family:Arial,Calibri,sans-serif;font-size:11pt;font-weight:bold;color:#1e293b;">Jarosław Juszczyk</div><br>'+
  '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,Calibri,sans-serif;"><tr>'+
  '<td valign="middle" style="vertical-align:middle;font-family:Arial,Calibri,sans-serif;font-size:8pt;line-height:12pt;color:#596273;">GPBS Sp. z o.o.<br>ul. Nad Jeziorem 85<br>43-100 Tychy, POLAND<br>NIP / VAT ID / SIRET: 6462932155</td>'+
  '<td width="20" style="width:20px;">&nbsp;</td><td valign="middle" style="vertical-align:middle;"><img src="cid:'+cid+'" width="100" height="43" alt="GPBS – Global Post Box Service" style="display:block;width:100px;height:43px;border:0;"></td></tr></table></body></html>';
 const encodedText=value=>wrap64(base64(utf8.encode(value.replace(/\r?\n/g,'\r\n'))));
 const lines=['X-Unsent: 1','To: '+recipients.join(',\r\n '),'Subject: '+encodedSubject(subject),'MIME-Version: 1.0','Content-Type: multipart/mixed; boundary="'+boundary+'"','',
 '--'+boundary,'Content-Type: multipart/alternative; boundary="'+alt+'"','',
 '--'+alt,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',encodedText(plain),
 '--'+alt,'Content-Type: multipart/related; type="text/html"; boundary="'+related+'"','',
 '--'+related,'Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',encodedText(formatted),
 '--'+related,'Content-Type: image/png; name="GPBS-logo.png"','Content-Transfer-Encoding: base64','Content-ID: <'+cid+'>','Content-Disposition: inline; filename="GPBS-logo.png"','',wrap64(base64(logoBytes)),
 '--'+related+'--','--'+alt+'--',
 '--'+boundary,'Content-Type: application/pdf; name="'+safeName+'"','Content-Transfer-Encoding: base64','Content-Disposition: attachment; filename="'+safeName+'"','',wrap64(base64(pdfBytes)),'--'+boundary+'--',''];
 return new Blob([lines.join('\r\n')],{type:'message/rfc822'});
}
async function pdfFor(c){
 if(c.type!=='CMR')return documentPdf(c.doc);
 const url='/api/cmr-belleville-document?documentId='+encodeURIComponent(c.id);
 const r=await fetch(url+'&view=pdf',{credentials:'same-origin',cache:'no-store'});
 if(!r.ok||!r.headers.get('Content-Type')?.startsWith('application/pdf'))throw Error('Nie udało się pobrać zapisanego CMR.');
 return new Uint8Array(await r.arrayBuffer());
}
function download(blob){
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=FILE;document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),60000);
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
 if(doc.direction==='ORDER'){
  paragraph('ZAMÓWIENIE CZĘŚCI',17,bold);
  paragraph('Magazyn: Belleville');
  paragraph('PROJEKT ZAMÓWIENIA');
  y-=8;
  tableRow(['Indeks SAP','Nazwa części','Ilość'],[100,355,56],[bold,bold,bold]);
  for(const p of doc.parts)tableRow([p.sap,p.name,p.qty],[100,355,56]);
  pdf.getPages().forEach((p,i)=>p.drawText((i+1)+' / '+pdf.getPageCount(),{x:535,y:25,size:8,font:reg,color:gray}));
  return await pdf.save();
 }
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
// Hide both windows before the native browser save prompt. Restore on cancellation/error.
function suspendSaveWindows(c){
 const preview=c.type==='CMR'?$('cmrPdfDemoModal'):(c.type==='PZ'||c.type==='WZ')?$('docPrintModal'):null;
 c.savePreview=preview&&!preview.classList.contains('hidden')?preview:null;
 if(dialog().open)dialog().close();
 c.savePreview?.classList.add('hidden');
}
function restoreSaveWindows(c,v){
 if(v!==version||context!==c||!allowed())return;
 c.savePreview?.classList.remove('hidden');
 c.savePreview=null;
 if(!dialog().open)dialog().showModal();
}
function finishSave(c,v){
 if(v!==version||context!==c)return;
 const type=c.type,preview=c.savePreview;
 reset();
 if(preview&&(type==='PZ'||type==='WZ')){
  document.dispatchEvent(new Event('gpbs:close-document-print'));
 }else if(preview&&type==='CMR'){
  window.GPBSBellevilleCmrPdfDemo?.reset();
 }
}
async function save(event){
 event.preventDefault();const c=context,v=version;if(!c||busy||!allowed())return;
 const recipients=$('documentMailRecipients').value.split(/[;,\s]+/).filter(Boolean);
 const subject=$('documentMailSubject').value.trim(),body=$('documentMailBody').value;
 if(!recipients.length||recipients.length>50||recipients.some(a=>!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z0-9-]+$/.test(a))||!subject||/[\r\n]/.test(subject)){
  status('Podaj poprawny adres odbiorcy i temat.',true);return;
 }
 busy=true;buttons();status('Wybierz miejsce zapisu wiadomości…');
 try{
  suspendSaveWindows(c);
  let handle=null;
  if(typeof window.showSaveFilePicker==='function'){
   try{
    handle=await window.showSaveFilePicker({id:'gpbs-eml',startIn:'downloads',suggestedName:FILE,types:[{description:'Wiadomość e-mail',accept:{'message/rfc822':['.eml']}}]});
   }catch(e){
    if(e.name==='AbortError'){restoreSaveWindows(c,v);status('Anulowano zapis.');return;}
    if(e.name!=='SecurityError'&&e.name!=='NotSupportedError')throw e;
   }
  }
  if(v!==version||context!==c||!allowed())return;
  status('Przygotowywanie PDF i wiadomości…');
  const [bytes,logoBytes]=await Promise.all([pdfFor(c),signatureLogo()]);
  if(v!==version||context!==c||!allowed())return;
  const blob=emlBlob(recipients,subject,body,bytes,attachmentName(c),logoBytes);
  if(handle){
   const stream=await handle.createWritable();
   try{await stream.write(blob);await stream.close();}catch(e){try{await stream.abort();}catch{}throw e;}
   finishSave(c,v);
  }else{
   download(blob);
   finishSave(c,v);
  }
 }catch(e){if(v===version&&context===c){restoreSaveWindows(c,v);status(e.message||'Nie udało się zapisać wiadomości.',true);}}
 finally{if(v===version&&context===c){busy=false;buttons();}}
}
function close(){if(!busy)reset();}
$('documentMailForm').addEventListener('submit',save);
$('documentMailClose').addEventListener('click',close);
dialog().addEventListener('cancel',e=>{e.preventDefault();close();});
window.GPBSBellevilleMail={setAccount,allowed,open,openOrder,disconnect:()=>Promise.resolve()};
})();
