/* GPBS Storage: local Excel (.xlsx) export for one vehicle inventory report.
   No external library, network calls, or D1 writes. Uses plain OOXML in a ZIP.
   The provided report must be an immutable snapshot of one inventory. */
(function(){
  'use strict';
  const encoder=new TextEncoder();
  const xml=value=>String(value??'').replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'
  }[ch])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
  const excelColumn=n=>{
    let name='';
    for(let i=n+1;i>0;i=Math.floor((i-1)/26))name=String.fromCharCode(65+(i-1)%26)+name;
    return name;
  };
  // One clear Excel report: each part is followed immediately by its activity.
  // The export uses merged, lightly shaded detail rows instead of mixing
  // unrelated fields under the 'Stan przed / Policzono / Różnica' headers.
  // Plain, editable spreadsheet based on the original TEST-A report.
  // No coloured backgrounds, no merged cells and visible Excel gridlines.
  function makeSheet(report){
    const rows=[
      ['RAPORT INWENTARYZACJI SAMOCHODU'],
      ['Data',report.date||'—','Godzina',report.time||'—'],
      ['Ekipa',report.team||'—','Tablica rejestracyjna',report.plate||'—'],
      ['Wykonał',report.by||'—'],
      [],
      ['Indeks GPBS','Indeks SAP','Nazwa części',
       'Stan przed','Policzono','Różnica','Ruchy części']
    ];
    if(report.note)rows[4]=['Komentarz',report.note];
    const when=(date,time)=>[date,time].filter(Boolean).join(' ');
    for(const part of report.items||[]){
      const movements=Array.isArray(part.movements)?part.movements:[];
      const movementText=movements.map(move=>{
        const outgoing=move.kind==='usage'||move.kind==='warehouse_out'||
          (move.kind==='transfer'&&String(move.description||'').startsWith('Przekazanie'));
        const q=Number(move.quantity);
        const amount=Number.isFinite(q)?(outgoing?'−':'+')+q+' szt.':'—';
        return when(move.date,move.time)+' — '+(move.description||'Ruch części')+
          ' — '+amount+'\n'+(move.status||'Zapisano')+
          (move.actor?' — '+move.actor:'');
      }).join('\n\n');
      rows.push([
        part.index||'',part.sap||'',part.name||'',
        part.before==null?'':part.before,
        part.counted==null?'':part.counted,
        part.difference==null?'':part.difference,
        movementText
      ]);
    }
    const cellXml=(value,row,col)=>{
      if(value===undefined||value===null||value==='')return '';
      const ref=excelColumn(col)+(row+1);
      // Normal Excel cells; only report title and column labels are bold.
      const bold=row===0||row===5;
      const style=(bold?' s="1"':col===6&&row>5?' s="2"':'');
      if(typeof value==='number'&&Number.isFinite(value))
        return '<c r="'+ref+'"'+style+'><v>'+value+'</v></c>';
      return '<c r="'+ref+'"'+style+' t="inlineStr"><is><t xml:space="preserve">'+
        xml(value)+'</t></is></c>';
    };
    const content=rows.map((cells,r)=>{
      const value=cells.map((v,c)=>cellXml(v,r,c)).join('');
      if(!cells.length)return '<row r="'+(r+1)+'"/>';
      const moves=r>5?String(cells[6]||''):'';
      const numberOfLines=moves?moves.split('\n').length:0;
      const height=numberOfLines?Math.min(390,Math.max(30,numberOfLines*15+8)):null;
      return '<row r="'+(r+1)+'"'+
        (height?' ht="'+height+'" customHeight="1"':'')+'>'+value+'</row>';
    }).join('');
    const widths=[19,19,46,16,16,16,80];
    const columns=widths.map((width,i)=>
      '<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+width+
        '" customWidth="1"/>').join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
      '<dimension ref="A1:G'+rows.length+'"/>'+
      '<sheetViews><sheetView workbookViewId="0" showGridLines="1"/></sheetViews>'+
      '<sheetFormatPr defaultRowHeight="17"/>'+
      '<cols>'+columns+'</cols><sheetData>'+content+'</sheetData></worksheet>';
  }
  const styles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
    '<fonts count="2">'+
      '<font><sz val="11"/><name val="Calibri"/></font>'+
      '<font><b/><sz val="11"/><name val="Calibri"/></font>'+
    '</fonts>'+
    '<fills count="2">'+
      '<fill><patternFill patternType="none"/></fill>'+
      '<fill><patternFill patternType="gray125"/></fill>'+
    '</fills>'+
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
    '<cellXfs count="3">'+
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'+
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'+
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">'+
        '<alignment wrapText="1" vertical="center"/></xf>'+
    '</cellXfs>'+
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'+
    '</styleSheet>';
  function makeFiles(report){
    return [
      ['[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8"?>'+
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
        '<Default Extension="xml" ContentType="application/xml"/>'+
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'+
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+
        '</Types>'],
      ['_rels/.rels',
        '<?xml version="1.0" encoding="UTF-8"?>'+
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'+
        '</Relationships>'],
      ['xl/workbook.xml',
        '<?xml version="1.0" encoding="UTF-8"?>'+
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '+
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
        '<sheets><sheet name="Raport inwentaryzacji" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels',
        '<?xml version="1.0" encoding="UTF-8"?>'+
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'+
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'+
        '</Relationships>'],
      ['xl/worksheets/sheet1.xml',makeSheet(report)],
      ['xl/styles.xml',styles]
    ];
  }
  function crc32(bytes){
    let crc=0xffffffff;
    for(const b of bytes){
      crc^=b;
      for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
    }
    return (crc^0xffffffff)>>>0;
  }
  function zip(files){
    const local=[],central=[];
    let offset=0,centralBytes=0;
    for(const [filename,content] of files){
      const name=encoder.encode(filename),data=encoder.encode(content);
      const checksum=crc32(data);
      const localHeader=new Uint8Array(30+name.length);
      const v=new DataView(localHeader.buffer);
      v.setUint32(0,0x04034b50,true);
      v.setUint16(4,20,true);
      v.setUint16(6,0x0800,true); // UTF-8 filenames
      v.setUint16(8,0,true); // STORE (no compressor, works offline)
      v.setUint32(14,checksum,true);
      v.setUint32(18,data.length,true);
      v.setUint32(22,data.length,true);
      v.setUint16(26,name.length,true);
      localHeader.set(name,30);
      local.push(localHeader,data);
      const entry=new Uint8Array(46+name.length);
      const c=new DataView(entry.buffer);
      c.setUint32(0,0x02014b50,true);
      c.setUint16(4,20,true);
      c.setUint16(6,20,true);
      c.setUint16(8,0x0800,true);
      c.setUint16(10,0,true);
      c.setUint32(16,checksum,true);
      c.setUint32(20,data.length,true);
      c.setUint32(24,data.length,true);
      c.setUint16(28,name.length,true);
      c.setUint32(42,offset,true);
      entry.set(name,46);
      central.push(entry);
      centralBytes+=entry.length;
      offset+=localHeader.length+data.length;
    }
    const end=new Uint8Array(22),v=new DataView(end.buffer);
    v.setUint32(0,0x06054b50,true);
    v.setUint16(8,files.length,true);
    v.setUint16(10,files.length,true);
    v.setUint32(12,centralBytes,true);
    v.setUint32(16,offset,true);
    return new Blob([...local,...central,end],{
      type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }
  function download(report){
    if(!report||!Array.isArray(report.items))throw Error('Brak danych raportu.');
    const workbook=zip(makeFiles(report));
    const clean=x=>String(x||'').replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,45);
    const filename='Inwentaryzacja_'+clean(report.team)+'_'+
      clean(report.date)+'.xlsx';
    const url=URL.createObjectURL(workbook);
    const link=document.createElement('a');
    link.href=url;
    link.download=filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  window.GPBSVehicleReportExport={download};
})();
