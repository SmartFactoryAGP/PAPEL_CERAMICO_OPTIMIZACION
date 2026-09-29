/* =========================================================
   NESTING v2 — orientaciones (rotación libre + espejo)
   Máscaras de orientación en formato "spans por fila": cada fila de la
   pieza se guarda como pares [xIni, xFin] contiguos. Eso permite testear
   colisión y contacto en O(filas) usando conteos acumulados, no celda
   por celda (ver placement.js).
   ========================================================= */
// tope de orientaciones evaluadas por pieza: ya vienen ordenadas de la más
// compacta a la más "desperdiciada", así que recortar la cola casi no cuesta
// calidad y evita que una pieza con muchos ángulos únicos frene todo el cálculo.
let ORI_CAP = 24;
// se sube desde nesting/engine.js cuando el usuario activa "rotación fina":
// con pasos de 2° se generan muchas más orientaciones por pieza, y con el
// tope de fábrica (24) la mayoría se descartarían sin llegar a probarse.
function setOriCap(n){ ORI_CAP = n; }

/* OJO: esto es async — antes era una función común y corriente, pero para
   UNA pieza sola (compleja, muchos vértices, o con "Rotación fina" activa,
   que puede pedir hasta ~180 ángulos × 2 espejos) rasterizar TODAS las
   orientaciones de un tirón podía tardar varios minutos SIN CEDER EL HILO
   ni una vez — el resto del motor sí respira entre piezas (setTimeout(0)),
   pero adentro de una sola pieza no había ningún punto de respiro, y eso
   es lo que se sentía como "la página no responde" aunque el rollo/chapa
   configurados fueran chicos: el tamaño real del problema es la pieza en
   sí (vértices × orientaciones a probar), no el tamaño de la chapa. Ahora
   cede el hilo cada pocas orientaciones — quien llama tiene que hacer
   `await buildOrientations(...)` (ver optimization.js y strips.js). */
/* Caché GLOBAL de orientaciones, por huella de la geometría (no por
   identidad del objeto pieza). La caché de siempre (piece._oris) solo
   acierta si llega el MISMO objeto — pero al Web Worker cada pasada le
   llega una copia nueva de las piezas (postMessage clona), y el "ataque
   dirigido" (runRepackPass) también arma defs nuevos en cada intento:
   en esos dos caminos, que son justo los que más corren en la Fase 2, se
   volvían a rasterizar TODAS las orientaciones de TODAS las piezas en
   cada intento (lo más caro de todo el motor). Resultado idéntico — las
   orientaciones son deterministas para la misma geometría y parámetros —
   solo que calculado una vez. Acotada a ORI_CACHE_MAX entradas (se
   descarta la usada hace más tiempo) para no crecer sin límite en
   sesiones largas. Solo entran piezas reales (con id): los rectángulos
   de prueba de las tiras de relleno (strips.js) cambian de largo en cada
   paso de la bisección y solo servirían para desalojar a las piezas. */
const ORI_CACHE = new Map();
const ORI_CACHE_MAX = 300;
/* Hash de 53 bits (cyrb53) de un texto — para la huella de geometría. */
function hashTexto(str){
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for(let i=0;i<str.length;i++){
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1>>>16), 2246822507) ^ Math.imul(h2 ^ (h2>>>13), 3266489909);
  h2 = Math.imul(h2 ^ (h2>>>16), 2246822507) ^ Math.imul(h1 ^ (h1>>>13), 3266489909);
  return 4294967296*(2097151 & h2) + (h1>>>0);
}
/* Todo lo que determina el resultado de buildOrientations: contorno
   rápido y completo, grabado y agujeros (viajan rotados en cada
   orientación). El largo del texto va en la clave para que un choque de
   hash sea, en la práctica, imposible. */
function huellaGeometria(piece){
  const txt = JSON.stringify([piece.fast||null, piece.points, piece.engraveLoops||null, piece.holes||null]);
  return hashTexto(txt)+':'+txt.length;
}

async function buildOrientations(piece, cell, grow, angles, mirrors){
  // ORI_CAP va en la clave: el resultado se recorta a ese tope, así que
  // con otro tope no es el mismo resultado.
  const key = `${cell}|${grow}|${angles.join(',')}|${mirrors.join(',')}|${ORI_CAP}`;
  if(piece._oriKey===key && piece._oris) return piece._oris;
  const globalKey = piece.id!=null ? huellaGeometria(piece)+'|'+key : null;
  const enCache = globalKey && ORI_CACHE.get(globalKey);
  if(enCache){
    ORI_CACHE.delete(globalKey); ORI_CACHE.set(globalKey, enCache); // pasa a "usada recién"
    piece._oriKey=key; piece._oris=enCache;
    return enCache;
  }
  const src = piece.fast || piece.points;
  const hasEngrave = piece.engraveLoops && piece.engraveLoops.length;
  const hasHoles = piece.holes && piece.holes.length;
  const oris=[];
  const seen = new Set();
  let sinCeder = 0;
  for(const mirror of mirrors){
    for(const rot of angles){
      const rp = transformPoly(src, rot, mirror);
      const r = rasterizePoly(rp, cell, grow);
      if(!r.cells.length) continue;
      const {rows, total} = cellsToRowSpans(r.cells, r.gw, r.gh);
      // descarta orientaciones geométricamente idénticas (piezas simétricas)
      const sig = `${r.gw}x${r.gh}:${total}:${rows.map(sp=>sp.map(s=>s[0]+'-'+s[1]).join(',')).join(';')}`;
      if(seen.has(sig)) continue;
      seen.add(sig);
      // rota el contorno completo con el mismo giro/espejo, y guarda el
      // desplazamiento exacto que usó (bbMain) para poder alinear el
      // grabado y los agujeros con este mismo movimiento — no cada uno
      // reencuadrado por su cuenta, sino todos juntos, tal como están
      // dibujados de verdad.
      const rawMain = rotateRaw(piece.points, rot, mirror);
      const bbMain = polyBBox(rawMain);
      const full = rawMain.map(([x,y])=>[x-bbMain.minx, y-bbMain.miny]);
      const engrave = hasEngrave ? piece.engraveLoops.map(loop=>{
        const rawL = rotateRaw(loop, rot, mirror);
        return rawL.map(([x,y])=>[x-bbMain.minx, y-bbMain.miny]);
      }) : null;
      const holes = hasHoles ? piece.holes.map(loop=>{
        const rawL = rotateRaw(loop, rot, mirror);
        return rawL.map(([x,y])=>[x-bbMain.minx, y-bbMain.miny]);
      }) : null;
      oris.push({rot, mirror, rows, n:total, gw:r.gw, gh:r.gh,
                 offX:r.offX, offY:r.offY, rp:full, engrave, holes, bb:polyBBox(full)});
      // cede el hilo cada 6 orientaciones probadas — adentro del Worker no
      // hace falta (nadie lo está mirando ahí) pero tampoco molesta.
      sinCeder++;
      if(sinCeder>=6){ sinCeder=0; await new Promise(res=>setTimeout(res,0)); }
    }
  }
  // más compactas primero
  oris.sort((a,b)=>(a.gw*a.gh)-(b.gw*b.gh));
  // recorta la cola: las orientaciones menos compactas casi nunca ganan y
  // solo suman tiempo de búsqueda por cada pieza que las evalúa.
  const capped = oris.length>ORI_CAP ? oris.slice(0,ORI_CAP) : oris;
  piece._oriKey=key; piece._oris=capped;
  if(globalKey){
    ORI_CACHE.set(globalKey, capped);
    if(ORI_CACHE.size>ORI_CACHE_MAX) ORI_CACHE.delete(ORI_CACHE.keys().next().value);
  }
  return capped;
}
