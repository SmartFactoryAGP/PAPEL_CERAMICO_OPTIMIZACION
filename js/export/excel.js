/* =========================================================
   DESCARGA A EXCEL (.xlsx de verdad, sin librerías nuevas)
   =========================================================
   Un .xlsx es un ZIP con unos XML adentro: se arma con JSZip (que la app
   ya carga para exportar el nesting). A diferencia de un CSV:
   - las tildes y eñes salen bien en cualquier Excel;
   - los números son números (se pueden sumar), y los códigos (CodMat,
     ZFER, NivelAGP "05", número de orden) quedan como TEXTO: Excel no les
     saca ceros ni los pasa a notación científica;
   - encabezado en negrita, fijo al bajar, con filtros y anchos de columna.
   columnas: [{etiqueta, numero?}]  filas: [[valor, ...], ...] */
function xlsxEscapar(v){
  return String(v==null ? '' : v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') // caracteres que el XML no admite
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function xlsxColumna(i){ let s = ''; i++; while(i){ const r = (i-1) % 26; s = String.fromCharCode(65+r) + s; i = Math.floor((i-1)/26); } return s; }

function xlsxArmarHoja(columnas, filas){
  const celda = (v, c, f, estilo) => {
    const ref = xlsxColumna(c) + (f+1);
    if(columnas[c].numero && v!=='' && v!=null && Number.isFinite(Number(v))) return `<c r="${ref}"${estilo}><v>${Number(v)}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${estilo}><is><t xml:space="preserve">${xlsxEscapar(v)}</t></is></c>`;
  };
  // ancho de cada columna según su texto más largo (con tope)
  const anchos = columnas.map((col, c)=>Math.min(60, Math.max(String(col.etiqueta).length + 2, ...filas.map(r=>String(r[c]==null ? '' : r[c]).length + 1))));
  const encabezado = `<row r="1">${columnas.map((col, c)=>celda(col.etiqueta, c, 0, ' s="1"')).join('')}</row>`;
  const cuerpo = filas.map((r, f)=>`<row r="${f+2}">${columnas.map((_, c)=>celda(r[c], c, f+1, '')).join('')}</row>`).join('');
  const ultima = xlsxColumna(columnas.length-1) + (filas.length+1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${anchos.map((w, c)=>`<col min="${c+1}" max="${c+1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${encabezado}${cuerpo}</sheetData>
<autoFilter ref="A1:${ultima}"/>
</worksheet>`;
}

async function descargarExcel(nombreArchivo, nombreHoja, columnas, filas){
  if(typeof JSZip==='undefined') throw new Error('no se cargó JSZip (¿sin internet en esta PC?)');
  const hoja = xlsxEscapar(String(nombreHoja).replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31));
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${hoja}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${hoja.replace(/'/g, "''")}'!$A$1:$${xlsxColumna(columnas.length-1)}$${filas.length+1}</definedName></definedNames>
</workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
  // estilo 1: encabezado en negrita con fondo gris y borde abajo
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EDF3"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF8592A7"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`);
  zip.file('xl/worksheets/sheet1.xml', xlsxArmarHoja(columnas, filas));
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombreArchivo; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}
