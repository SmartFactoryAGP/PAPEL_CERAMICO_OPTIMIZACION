/* ---- ZIP: una carpeta con un DXF por chapa ---- */
async function exportZIP(){
  if(!lastResult || !lastResult.chapas.length){ alert('Ejecuta el nesting primero.'); return; }
  if(typeof JSZip==='undefined'){ alert('JSZip no cargó (revisa tu conexión). Usa "DXF único" como alternativa.'); return; }
  const btn = document.getElementById('btnZip');
  btn.disabled=true; btn.textContent='Comprimiendo...';
  try{
    const {sheetW, chapaLen, chapas, kerf, step, allowMirror, deep} = lastResult;
    const idMap = buildIdMap();
    const groups = groupChapas(chapas, idMap);
    const jobName = document.getElementById('jobName').value || 'nesting';
    const folderName = `${slug(jobName)}_dxf`;
    const zip = new JSZip();
    const folder = zip.folder(folderName);

    // un archivo por chapa
    chapas.forEach((chapa, idx)=>{
      const n = idx+1;
      const util = utilOf(chapa, sheetW, effChapaLen(chapa, chapaLen)).toFixed(1);
      folder.file(`chapa_${pad2(n)}_util${util}.dxf`, buildChapaDXF(chapa, sheetW, chapaLen, idMap, n));
    });

    // subcarpeta con un DXF por diseño único (lo que realmente hay que cortar)
    const uni = folder.folder('disenos_unicos');
    groups.forEach((g, gi)=>{
      const rep = g.indices.length;
      uni.file(`diseno_${pad2(gi+1)}_cortar_x${rep}.dxf`,
        buildChapaDXF(g.chapa, sheetW, chapaLen, idMap, g.indices[0]));
    });

    // combinado
    folder.file('todas_las_chapas.dxf', buildCombinedDXF(chapas, sheetW, chapaLen, idMap));

    // resumen
    let txt = `NESTING DXF — resumen\n`;
    txt += `Trabajo: ${jobName}\nFecha: ${new Date().toLocaleString('es-CO')}\n\n`;
    txt += `Chapa: ${sheetW} x ${chapaLen} mm\nSeparación entre piezas: ${kerf} mm\n`;
    txt += `Paso de rotación (elegido automáticamente por el sistema): ${step}°  |  Espejo: ${allowMirror?'sí':'no'}  |  Búsqueda profunda: ${deep?'sí':'no'}\n\n`;
    txt += `Chapas: ${chapas.length}\nDiseños únicos: ${groups.length}\n`;
    txt += `Piezas colocadas: ${chapas.reduce((s,c)=>s+c.placed.length,0)} / ${lastResult.jobCount}\n`;
    txt += `Piezas espejadas: ${countMirrored(chapas)}\n\n`;
    txt += `IDs de pieza:\n`;
    pieces.filter(p=>p.points).forEach(p=>{
      txt += `  ${idMap.get(p.id)} = ${p.name}  (${p.bbox.w.toFixed(0)}x${p.bbox.h.toFixed(0)} mm, cant. ${p.qty})\n`;
    });
    txt += `\nDetalle por chapa:\n`;
    chapas.forEach((c,i)=>{
      const counts={};
      c.placed.forEach(p=>{ const k=idMap.get(p.pieceId); counts[k]=(counts[k]||0)+1; });
      const eLen = effChapaLen(c, chapaLen);
      txt += `  chapa_${pad2(i+1)}: ${utilOf(c,sheetW,eLen).toFixed(1)}% — corte real ${Math.ceil(eLen)}mm de ${chapaLen}mm nominal — ` +
             Object.keys(counts).map(k=>`ID${k}x${counts[k]}`).join(', ') + `\n`;
    });
    txt += `\nDiseños únicos:\n`;
    groups.forEach((g,gi)=>{ txt += `  diseno_${pad2(gi+1)}: cortar ${g.indices.length} vez(ces) — chapas ${g.indices.join(', ')}\n`; });
    folder.file('resumen.txt', txt);

    const blob = await zip.generateAsync({type:'blob', compression:'DEFLATE', compressionOptions:{level:6}});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url; a.download=`${folderName}.zip`; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
  } finally {
    btn.disabled=false; btn.textContent='Descargar DXF (.zip)';
  }
}
function exportDXFSingle(){
  if(!lastResult || !lastResult.chapas.length){ alert('Ejecuta el nesting primero.'); return; }
  const {sheetW, chapaLen, chapas} = lastResult;
  const idMap = buildIdMap();
  downloadBlob(buildCombinedDXF(chapas, sheetW, chapaLen, idMap),
    `${slug(document.getElementById('jobName').value)}_layout.dxf`, 'application/dxf');
}
function downloadBlob(content, filename, mime){
  const blob = new Blob([content], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download=filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
}
document.getElementById('btnZip').addEventListener('click', exportZIP);
document.getElementById('btnDxfSingle').addEventListener('click', exportDXFSingle);
