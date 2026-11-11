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
  function makeSheet(report){
    const rows=[],merged=[];
    let tableHeaderRow=0;
    const line=(cells,height=23)=>{
      const n=rows.length+1;
      rows.push({cells,height});
      return n;
    };
    const mergedLine=(value,style,height)=>{
      const cells=Array.from({length:7},(_,i)=>({value:i===0?value:null,style}));
      const n=line(cells,height);
      merged.push('A'+n+':G'+n);
      return n;
    };
    const when=(date,time)=>[date,time].filter(Boolean).join(' ');
    mergedLine('RAPORT INWENTARYZACJI SAMOCHODU',1,37);
    mergedLine('EKIPA: '+(report.team||'—')+'     •     REJESTRACJA: '+
      (report.plate||'—')+'     •     DATA: '+when(report.date,report.time),2,27);
    mergedLine('INWENTARYZACJĘ WYKONAŁ: '+(report.by||'—')+
      (report.periodStart?'     •     POPRZEDNIA INWENTARYZACJA: '+
       report.periodStart:''),2,26);
    if(report.note)mergedLine('KOMENTARZ: '+report.note,8,40);
    line([],12);
    tableHeaderRow=line([
      {value:'Indeks GPBS',style:3},{value:'Indeks SAP',style:3},
      {value:'Nazwa części',style:3},{value:'Stan przed',style:3},
      {value:'Policzono',style:3},{value:'Różnica',style:3},
      {value:'Ruchy części w okresie',style:3}
    ],31);
    let partCount=0;
    for(const part of report.items||[]){
      const movements=Array.isArray(part.movements)?part.movements:[];
      const moveText=movements.map(move=>{
        const outgoing=move.kind==='usage'||move.kind==='warehouse_out'||
          (move.kind==='transfer'&&String(move.description||'').startsWith('Przekazanie'));
        const qty=Number(move.quantity);
        const amount=Number.isFinite(qty)
          ?(outgoing?'−':'+')+qty+' szt.':'—';
        const top=when(move.date,move.time)+' · '+(move.description||'Ruch części')+
          ' · '+amount;
        const bottom='Status: '+(move.status||'Zapisano')+
          (move.actor?' · '+move.actor:'');
        return top+'\\n'+bottom;
      }).join('\\n\\n');
      const hasPending=movements.some(move=>/oczekuje/i.test(move.status||''));
      const height=movements.length?Math.min(390,Math.max(46,
        24+movements.length*44+Math.max(0,movements.length-1)*9)):32;
      line([
        {value:part.index||'—',style:4},
        {value:part.sap||'—',style:4},
        {value:part.name||'—',style:4},
        ...[part.before,part.counted,part.difference]
          .map(n=>({value:n==null?'—':n,style:5})),
        {value:moveText||null,style:moveText?(hasPending?7:6):4}
      ],height);
      partCount++;
    }
    if(!partCount)mergedLine('Brak części w tym raporcie.',8,30);

    const cellXml=(value,r,c)=>{
      if(value===undefined||value===null)return '';
      const info=typeof value==='object'?value:{value,style:0};
      const ref=excelColumn(c)+(r+1),style=' s="'+(info.style||0)+'"';
      if(info.value===undefined||info.value===null)
        return '<c r="'+ref+'"'+style+'/>';
      if(typeof info.value==='number'&&Number.isFinite(info.value))
        return '<c r="'+ref+'"'+style+'><v>'+info.value+'</v></c>';
      return '<c r="'+ref+'"'+style+' t="inlineStr"><is><t xml:space="preserve">'+
        xml(info.value)+'</t></is></c>';
    };
    const rowXml=rows.map((row,index)=>
      '<row r="'+(index+1)+'" ht="'+row.height+'" customHeight="1">'+
      row.cells.map((v,c)=>cellXml(v,index,c)).join('')+'</row>'
    ).join('');
    const widths=[19,19,43,15,15,15,85];
    const columns=widths.map((width,i)=>'<col min="'+(i+1)+
      '" max="'+(i+1)+'" width="'+width+'" customWidth="1"/>').join('');
    const mergedXml='<mergeCells count="'+merged.length+'">'+
      merged.map(r=>'<mergeCell ref="'+r+'"/>').join('')+'</mergeCells>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'+
      '<dimension ref="A1:G'+rows.length+'"/>'+
      '<sheetViews><sheetView workbookViewId="0" showGridLines="0">'+
      '<pane ySplit="'+tableHeaderRow+'" topLeftCell="A'+(tableHeaderRow+1)+
        '" activePane="bottomLeft" state="frozen"/>'+
      '</sheetView></sheetViews>'+
      '<sheetFormatPr defaultRowHeight="22"/>'+
      '<cols>'+columns+'</cols><sheetData>'+rowXml+'</sheetData>'+
      mergedXml+
      '<printOptions horizontalCentered="1"/>'+
      '<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>'+
      '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'+
      '</worksheet>';
  }
  const styles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
    '<fonts count="5">'+
      '<font><sz val="11"/><name val="Calibri"/></font>'+
      '<font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'+
      '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'+
      '<font><b/><sz val="10"/><color rgb="FF445468"/><name val="Calibri"/></font>'+
      '<font><sz val="10"/><color rgb="FF344C62"/><name val="Calibri"/></font>'+
    '</fonts>'+
    '<fills count="7">'+
      '<fill><patternFill patternType="none"/></fill>'+
      '<fill><patternFill patternType="gray125"/></fill>'+
      '<fill><patternFill patternType="solid"><fgColor rgb="FF283846"/></patternFill></fill>'+
      '<fill><patternFill patternType="solid"><fgColor rgb="FF465B6D"/></patternFill></fill>'+
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF6F8FA"/></patternFill></fill>'+
      '<fill><patternFill patternType="solid"><fgColor rgb="FFECF3F9"/></patternFill></fill>'+
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF4DF"/></patternFill></fill>'+
    '</fills>'+
    '<borders count="2">'+
      '<border><left/><right/><top/><bottom/><diagonal/></border>'+
      '<border><left/><right/><top/><bottom style="thin"><color rgb="FFDEE5EC"/></bottom><diagonal/></border>'+
    '</borders>'+
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
    '<cellXfs count="9">'+
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'+
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" indent="1"/></xf>'+
      '<xf numFmtId="0" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" indent="1" wrapText="1"/></xf>'+
      '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'+
      '<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'+
      '<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'+
      '<xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" indent="1" wrapText="1"/></xf>'+
      '<xf numFmtId="0" fontId="4" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" indent="1" wrapText="1"/></xf>'+
      '<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFill="1" applyAlignment="1"><alignment vertical="center" indent="1" wrapText="1"/></xf>'+
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
