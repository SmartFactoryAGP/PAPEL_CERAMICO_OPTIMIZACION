/* =========================================================
   MÉTRICAS Y AGRUPACIÓN
   ========================================================= */
/* Puntaje de un resultado, para que el sistema compare pasos de rotación
   y elija el que mejor optimización da: primero menos piezas sin ubicar,
   luego menos chapas usadas, luego mejor aprovechamiento de material. */
function scorePass(res, sheetW, chapaLen){
  const numChapas = res.chapas.length;
  const totalArea = res.chapas.reduce((s,c)=>s+c.placed.reduce((s2,p)=>s2+p.area,0),0);
  const totalSheetArea = res.chapas.reduce((s,c)=>s+sheetW*effChapaLen(c, chapaLen), 0);
  const util = totalSheetArea>0 ? totalArea/totalSheetArea : 0;
  return {numChapas, util, unplaced: res.unplaced.length};
}
function passIsBetter(a,b){
  if(a.unplaced !== b.unplaced) return a.unplaced < b.unplaced;
  if(a.numChapas !== b.numChapas) return a.numChapas < b.numChapas;
  return a.util > b.util;
}

function utilOf(chapa, sheetW, chapaLen){
  const area = chapa.placed.reduce((s,p)=>s+p.area,0);
  return area/(sheetW*chapaLen)*100;
}
/* Largo real ocupado por las piezas ya colocadas (extremo más alto en Y). */
function chapaUsedLen(chapa){
  let maxY=0;
  for(const p of chapa.placed){
    if(!p.rp || !p.rp.length) continue;
    const bb = polyBBox(p.rp);
    const y2 = p.y + bb.h;
    if(y2>maxY) maxY=y2;
  }
  return maxY;
}
/* Ancho real ocupado (extremo más lejano en X) — se usa como desempate al
   pulir una chapa: entre dos acomodos que cortan el mismo largo de rollo,
   prefiere el que además queda apretado de lado a lado, sin huecos sueltos. */
function chapaUsedX(chapa){
  let maxX=0;
  for(const p of chapa.placed){
    if(!p.rp || !p.rp.length) continue;
    const bb = polyBBox(p.rp);
    const x2 = p.x + bb.w;
    if(x2>maxX) maxX=x2;
  }
  return maxX;
}

/* ============ TIRAS DE RELLENO AUTOMÁTICAS ============
   Se recalculan DURANTE el proceso (cada vez que el resultado mejora, no
   solo al final) y buscan el largo lo más cerca posible del máximo real
   que entra en cada hueco (por bisección, no una lista fija de tamaños).

   Importante: esta búsqueda corre sobre una COPIA de la grilla de cada
   chapa (nunca la real) — así el optimizador de piezas sigue viendo
   siempre el estado "limpio" sin tiras, y las tiras nunca interfieren con
   sus comparaciones. El resultado se guarda aparte (stripLayer) y solo se
   mezcla con las piezas reales al momento de dibujar/exportar. */
function isTrimEnabled(){
  const el = document.getElementById('trimChapa');
  return el ? el.checked : true;
}
/* Largo "efectivo" de una chapa para %, DXF y PDF: si el recorte está activo
   (rollo), no se cuenta ni se corta el largo nominal completo cuando las
   piezas de esa chapa ocupan menos — se deja un margen de separación (kerf)
   después de la última pieza. Así una chapa con pocas piezas sobrantes no
   queda con un % artificialmente bajo, igual que hace un nesting profesional. */
function effChapaLen(chapa, chapaLen){
  if(!isTrimEnabled()) return chapaLen;
  if(!chapa.placed.length) return chapaLen;
  const kerf = Math.max(0, parseFloat(document.getElementById('kerf').value)||0);
  const used = chapaUsedLen(chapa) + kerf;
  return Math.min(chapaLen, Math.max(used, 1));
}
function chapaSignature(chapa, idMap){
  return chapa.placed
    .map(p=>`${idMap.get(p.pieceId)}@${p.x.toFixed(1)},${p.y.toFixed(1)},${p.rot},${p.mirror?1:0}`)
    .sort().join('|');
}
function groupChapas(chapas, idMap){
  const seen = new Map(); const groups=[];
  chapas.forEach((chapa, idx)=>{
    const sig = chapaSignature(chapa, idMap);
    if(seen.has(sig)) seen.get(sig).indices.push(idx+1);
    else { const g={chapa, sig, indices:[idx+1]}; seen.set(sig,g); groups.push(g); }
  });
  return groups;
}
function countMirrored(chapas){
  return chapas.reduce((s,c)=>s+c.placed.filter(p=>p.mirror).length,0);
}
