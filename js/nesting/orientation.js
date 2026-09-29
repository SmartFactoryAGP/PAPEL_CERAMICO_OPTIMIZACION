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
async function buildOrientations(piece, cell, grow, angles, mirrors){
  const key = `${cell}|${grow}|${angles.join(',')}|${mirrors.join(',')}`;
  if(piece._oriKey===key && piece._oris) return piece._oris;
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
  return capped;
}

/* Chapa = occupancy + prefix sums por fila (para colisión O(1) por span)
   + skyline (altura ocupada máx. por columna) para saltar filas imposibles. */
