// The original PNG is not sent to non-admin clients.
import {PDFDocument} from 'pdf-lib';
import UPNG from '@pdf-lib/upng';
import {ensureCmrCarriers} from './cmr-belleville-config.js';
export function cmrPublicFields(fields){
  const copy={...fields};delete copy.stampBase64;return copy;
}
function croppedStamp(base64){
  const original=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
  try{
    const img=UPNG.decode(original.buffer),w=img.width,h=img.height;
    if(!w||!h||w*h>2000000)return original;
    const rgba=new Uint8Array(UPNG.toRGBA8(img)[0]);
    let l=w,t=h,r=-1,b=-1;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=(y*w+x)*4;
      if(rgba[i+3]<=12||Math.min(rgba[i],rgba[i+1],rgba[i+2])>=248)continue;
      l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x);b=Math.max(b,y);
    }
    if(r<l||b<t)return original;
    const pad=Math.max(2,Math.round(Math.min(w,h)*.025));
    l=Math.max(0,l-pad);t=Math.max(0,t-pad);r=Math.min(w-1,r+pad);b=Math.min(h-1,b+pad);
    const cw=r-l+1,ch=b-t+1;
    if(cw===w&&ch===h)return original;
    const pixels=new Uint8Array(cw*ch*4);
    for(let y=0;y<ch;y++){
      const start=((t+y)*w+l)*4;
      pixels.set(rgba.subarray(start,start+cw*4),y*cw*4);
    }
    return new Uint8Array(UPNG.encode([pixels.buffer],cw,ch,0));
  }catch{return original;}
}
export async function stampCmrPdf(db,bytes,fields){
  // Empty string means no selected carrier; legacy saved fields resolve by name.
  const id=fields.carrierId;
  if(id==='')return bytes;
  let row;
  await ensureCmrCarriers(db);
  if(id!=null){
    if(typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id))throw Object.assign(Error('Nieprawidłowy przewoźnik.'),{status:400});
    row=await db.prepare('SELECT stamp_png_base64 AS stampBase64 FROM cmr_belleville_carriers WHERE id=?').bind(id).first();
    if(!row)throw Object.assign(Error('Przewoźnik został usunięty. Wybierz ponownie.'),{status:409});
  }else{
    const name=String(fields.carrierBase||'').split('\n')[0].trim();
    if(!name)return bytes;
    row=await db.prepare('SELECT stamp_png_base64 AS stampBase64 FROM cmr_belleville_carriers WHERE name=? COLLATE NOCASE').bind(name).first();
  }
  if(!row?.stampBase64)return bytes;
  const pdf=await PDFDocument.load(bytes);
  const pages=pdf.getPages();
  if(pages.length!==1)throw Object.assign(Error('CMR musi mieć jedną stronę A4.'),{status:400});
  const page=pages[0],size=page.getSize();
  if(Math.abs(size.width-595)>6||Math.abs(size.height-842)>6)
    throw Object.assign(Error('CMR musi mieć format A4 pionowo.'),{status:400});
  const png=await pdf.embedPng(croppedStamp(row.stampBase64));
  const frame={x:260,y:762,w:158,h:35};
  const fit=png.scaleToFit(frame.w,frame.h);
  page.drawImage(png,{x:frame.x+(frame.w-fit.width)/2,
    y:page.getHeight()-frame.y-frame.h+(frame.h-fit.height)/2,
    width:fit.width,height:fit.height});
  return pdf.save();
}
