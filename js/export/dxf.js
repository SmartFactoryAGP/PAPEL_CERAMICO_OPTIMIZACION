function dxfPoly(pts, layer){
  let s = `0\nLWPOLYLINE\n8\n${layer}\n100\nAcDbEntity\n100\nAcDbPolyline\n90\n${pts.length}\n70\n1\n`;
  for(const [x,y] of pts) s += `10\n${x.toFixed(3)}\n20\n${y.toFixed(3)}\n`;
  return s;
}
function dxfText(x,y,h,val,layer){
  return `0\nTEXT\n8\n${layer}\n10\n${x.toFixed(3)}\n20\n${y.toFixed(3)}\n40\n${h.toFixed(2)}\n1\n${val}\n`;
}
function safeLayer(name){
  return (name||'PIEZA').toUpperCase().replace(/[^A-Z0-9_]/g,'_').slice(0,28) || 'PIEZA';
}
/* DXF de una sola chapa (origen 0,0) — sin IDs de texto: esos números solo
   se muestran en el PDF, para que el DXF quede limpio para la máquina. */
function buildChapaDXF(chapa, sheetW, chapaLen, idMap, chapaNumber){
  const effLen = effChapaLen(chapa, chapaLen);
  let dxf = '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n';
  dxf += dxfPoly([[0,0],[sheetW,0],[sheetW,effLen],[0,effLen]], 'CHAPA');
  dxf += dxfText(0, effLen+15, 30, `CHAPA ${chapaNumber} - ${utilOf(chapa,sheetW,effLen).toFixed(1)}% - corte ${Math.ceil(effLen)}mm`, 'LABELS');
  chapa.placed.forEach(p=>{
    const pts = p.rp.map(([x,y])=>[x+p.x, y+p.y]);
    dxf += dxfPoly(pts, safeLayer(p.name));
    // los agujeros van en la MISMA capa que el corte (también se cortan,
    // no son grabado) — así el post-procesador los toma con la misma herramienta.
    if(p.holes) p.holes.forEach(loop=>{
      dxf += dxfPoly(loop.map(([x,y])=>[x+p.x, y+p.y]), safeLayer(p.name));
    });
    // Bloque 4: el grabado sale en su propia capa "GRABADO" (compartida
    // por todas las piezas), así el post-procesador de la máquina la
    // reconoce como una sola herramienta aparte del corte.
    if(p.engrave) p.engrave.forEach(loop=>{
      dxf += dxfPoly(loop.map(([x,y])=>[x+p.x, y+p.y]), 'GRABADO');
    });
  });
  dxf += '0\nENDSEC\n0\nEOF\n';
  return dxf;
}
/* DXF con todas las chapas lado a lado en un solo archivo — sin IDs de texto */
function buildCombinedDXF(chapas, sheetW, chapaLen, idMap){
  const gap = 300;
  let dxf = '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n';
  chapas.forEach((chapa, idx)=>{
    const effLen = effChapaLen(chapa, chapaLen);
    const offX = idx*(sheetW+gap);
    dxf += dxfPoly([[offX,0],[offX+sheetW,0],[offX+sheetW,effLen],[offX,effLen]], 'CHAPA');
    dxf += dxfText(offX, effLen+15, 30, `CHAPA ${idx+1} - ${utilOf(chapa,sheetW,effLen).toFixed(1)}% - corte ${Math.ceil(effLen)}mm`, 'LABELS');
    chapa.placed.forEach(p=>{
      const pts = p.rp.map(([x,y])=>[x+p.x+offX, y+p.y]);
      dxf += dxfPoly(pts, safeLayer(p.name));
      if(p.holes) p.holes.forEach(loop=>{
        dxf += dxfPoly(loop.map(([x,y])=>[x+p.x+offX, y+p.y]), safeLayer(p.name));
      });
      if(p.engrave) p.engrave.forEach(loop=>{
        dxf += dxfPoly(loop.map(([x,y])=>[x+p.x+offX, y+p.y]), 'GRABADO');
      });
    });
  });
  dxf += '0\nENDSEC\n0\nEOF\n';
  return dxf;
}

function pad2(n){ return String(n).padStart(2,'0'); }
function slug(s){ return (s||'nesting').trim().replace(/[^\w\-]+/g,'_').replace(/^_+|_+$/g,'') || 'nesting'; }

/* ---- ZIP: una carpeta con un DXF por chapa ---- */
