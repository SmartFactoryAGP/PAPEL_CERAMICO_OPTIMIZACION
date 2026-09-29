/* =========================================================
   EXPORT DXF
   ========================================================= */
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
// cabecera (mm, $INSUNITS=4) + apertura de ENTITIES, y cierre — iguales
// para todo DXF que arma la app (por chapa, combinado y Editor de archivos).
const DXF_HEADER = '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n';
const DXF_FOOTER = '0\nENDSEC\n0\nEOF\n';

/* Entidades de UNA chapa (borde, rótulo y piezas), corrida offX en X —
   la usan tanto el DXF por chapa (offX=0) como el combinado (cada chapa
   al lado de la anterior). Antes eran dos copias del mismo bucle. */
function dxfChapaEntities(chapa, sheetW, chapaLen, chapaNumber, offX){
  const effLen = effChapaLen(chapa, chapaLen);
  const mover = (loop, p) => loop.map(([x,y])=>[x+p.x+offX, y+p.y]);
  let dxf = dxfPoly([[offX,0],[offX+sheetW,0],[offX+sheetW,effLen],[offX,effLen]], 'CHAPA');
  dxf += dxfText(offX, effLen+15, 30, `CHAPA ${chapaNumber} - ${utilOf(chapa,sheetW,effLen).toFixed(1)}% - corte ${Math.ceil(effLen)}mm`, 'LABELS');
  chapa.placed.forEach(p=>{
    dxf += dxfPoly(mover(p.rp, p), safeLayer(p.name));
    // los agujeros van en la MISMA capa que el corte (también se cortan,
    // no son grabado) — así el post-procesador los toma con la misma herramienta.
    if(p.holes) p.holes.forEach(loop=>{ dxf += dxfPoly(mover(loop, p), safeLayer(p.name)); });
    // Bloque 4: el grabado sale en su propia capa "GRABADO" (compartida
    // por todas las piezas), así el post-procesador de la máquina la
    // reconoce como una sola herramienta aparte del corte.
    if(p.engrave) p.engrave.forEach(loop=>{ dxf += dxfPoly(mover(loop, p), 'GRABADO'); });
  });
  return dxf;
}
/* DXF de una sola chapa (origen 0,0) — sin IDs de texto: esos números solo
   se muestran en el PDF, para que el DXF quede limpio para la máquina. */
function buildChapaDXF(chapa, sheetW, chapaLen, idMap, chapaNumber){
  return DXF_HEADER + dxfChapaEntities(chapa, sheetW, chapaLen, chapaNumber, 0) + DXF_FOOTER;
}
/* DXF con todas las chapas lado a lado en un solo archivo — sin IDs de texto */
function buildCombinedDXF(chapas, sheetW, chapaLen, idMap){
  const gap = 300;
  return DXF_HEADER
    + chapas.map((chapa, idx)=>dxfChapaEntities(chapa, sheetW, chapaLen, idx+1, idx*(sheetW+gap))).join('')
    + DXF_FOOTER;
}

function pad2(n){ return String(n).padStart(2,'0'); }
function slug(s){ return (s||'nesting').trim().replace(/[^\w\-]+/g,'_').replace(/^_+|_+$/g,'') || 'nesting'; }
