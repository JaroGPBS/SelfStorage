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
  function makeWorksheet(lines,widths,headingRows=[0],movementRows=[]){
    const rows=lines.map((cells,r)=>{
      if(!cells.length)return '<row r="'+(r+1)+'"/>';
      const values=cells.map((value,c)=>{
        if(value===null||value===undefined||value==='')return '';
        const ref=excelColumn(c)+(r+1);
        const style=headingRows.includes(r)?' s="1"':movementRows.includes(r)?' s="2"':'';
        if(typeof value==='number'&&Number.isFinite(value))
          return '<c r="'+ref+'"'+style+'><v>'+value+'</v></c>';
        return '<c r="'+ref+'"'+style+' t="inlineStr"><is><t>'+
          xml(value)+'</t></is></c>';
      }).join('');
      const height=movementRows.includes(r)?' ht="30" customHeight="1"':'';
      return '<row r="'+(r+1)+'"'+height+'>'+values+'</row>';
    }).join('');
    const columns=widths.map((width,index)=>
      '<col min="'+(index+1)+'" max="'+(index+1)+'" width="'+width+
        '" customWidth="1"/>').join('');
    const maxColumn=excelColumn(Math.max(0,widths.length-1));
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
      '<dimension ref="A1:'+maxColumn+lines.length+'"/>'+
      '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'+
      '<sheetFormatPr defaultRowHeight="17"/>'+
      '<cols>'+columns+'</cols><sheetData>'+rows+'</sheetData></worksheet>';
  }
  function makeSheet(report){
    const lines=[
      ['RAPORT INWENTARYZACJI SAMOCHODU'],
      ['Data',report.date||'—','Godzina',report.time||'—'],
      ['Ekipa',report.team||'—','Tablica rejestracyjna',report.plate||'—'],
      ['Wykonał',report.by||'—']
    ];
    if(report.note)lines.push(['Komentarz do inwentaryzacji',report.note]);
    lines.push([]);
    const headersAt=lines.length;
    lines.push(['Indeks GPBS','Indeks SAP','Nazwa części',
      'Stan przed','Policzono','Różnica']);
    const movementRows=[];
    const names={usage:'Zużycie',warehouse_in:'Pobranie',
      warehouse_out:'Zwrot',transfer:'Transfer'};
    // Movement records follow the corresponding item, never a second sheet.
    for(const item of report.items||[]){
      lines.push([item.index||'',item.sap||'',item.name||'',
        item.before,item.counted,item.difference]);
      for(const move of item.movements||[]){
        const sending=move.kind==='usage'||move.kind==='warehouse_out'||
          (move.kind==='transfer'&&String(move.description||'').startsWith('Przekazanie'));
        const qty=Number(move.quantity);
        const amount=Number.isFinite(qty)?(sending?'−':'+')+qty+' szt.':'—';
        movementRows.push(lines.length);
        lines.push([
          '↳ '+(names[move.kind]||'Ruch'),
          [move.date,move.time].filter(Boolean).join(' '),
          move.description||'',amount,move.status||'',move.actor||''
        ]);
      }
    }
    return makeWorksheet(lines,[20,21,52,17,34,20],[0,headersAt],movementRows);
  }
  const styles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
    '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font>'+
    '<font><b/><sz val="11"/><name val="Calibri"/></font>'+
    '<font><i/><sz val="10"/><color rgb="FF536172"/><name val="Calibri"/></font></fonts>'+
    '<fills count="3"><fill><patternFill patternType="none"/></fill>'+
      '<fill><patternFill patternType="gray125"/></fill>'+
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF3F6F9"/><bgColor indexed="64"/></patternFill></fill></fills>'+
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
    '<cellXfs count="3">'+
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'+
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'+
      '<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment wrapText="1" vertical="center"/></xf>'+
    '</cellXfs><cellStyles count="1">'+
      '<cellStyle name="Normal" xfId="0" builtinId="0"/>'+
    '</cellStyles></styleSheet>';
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
