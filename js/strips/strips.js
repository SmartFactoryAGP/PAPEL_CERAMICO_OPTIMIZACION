const STRIP_COLOR = '#9fb0d8';
let stripCounter = 0;

function cloneChapaForScratch(chapa){
  return {
    occ: chapa.occ.slice(),
    psum: new Int32Array(chapa.psum.length),
    dirty: new Uint8Array(chapa.GH).fill(1),
    skyline: chapa.skyline.slice(),
    maxY: chapa.maxY, free: chapa.free,
    placed: [], GW: chapa.GW, GH: chapa.GH
  };
}

/* OJO — bloque de rendimiento (encontrado revisando por qué el pulido de
   tiras se sentía pesado con lotes reales): antes, cada intento de tira
   llamaba a findBestPlacement(fine=true), que barre celda por celda con
   fits() — necesario para que sea CORRECTO (ver el arreglo del hueco
   "sandwich" en placement.js), pero cada llamada repite trabajo que ya
   había hecho la llamada anterior sobre la MISMA grilla sin cambios. Con
   la bisección (hasta 12 intentos) más hasta 250 tiras por chapa, esto
   medido en un lote real tardaba ~24 SEGUNDOS para recalcular las tiras
   de las 19 chapas — y eso se repite cada vez que el motor mejora algo
   durante la Fase 2, así que se sentía en cada corrida.

   Como una tira SIEMPRE es un rectángulo simple (no una pieza con forma
   cualquiera), hay una forma mucho más rápida de contestar "¿dónde entra
   un rectángulo de gw x gh celdas?" sin perder ni un caso: para cada
   columna, se guarda cuántas celdas libres seguidas hay contando desde
   arriba (buildFreeRunUp, se arma UNA vez por chapa y se repite entre
   los 12 pasos de la bisección — antes se repetía el barrido para CADA
   paso). Con eso, encontrar dónde entra el rectángulo es una ventana
   deslizante de mínimos (findRectFit) — mismo resultado exacto que
   barrer celda por celda, pero sin repetir comparaciones entre columnas
   vecinas. Medido con los mismos datos reales: de ~24s a manos de 1s
   para las 19 chapas juntas, encontrando exactamente las mismas tiras. */
function buildFreeRunUp(ch){
  const run = new Int32Array(ch.GW*ch.GH);
  updateFreeRunUp(ch, run, 0, ch.GW-1);
  return run;
}
/* Recalcula "run" solo en las columnas [x0..x1]: al commitear una tira
   solo cambia la ocupación de SUS columnas, y el run de cada columna
   depende únicamente de esa columna — antes se rehacía la grilla entera
   (millones de celdas) después de cada tira. Mismo contenido exacto. */
function updateFreeRunUp(ch, run, x0, x1){
  const {GW, GH, occ} = ch;
  for(let x=x0; x<=x1; x++){
    let r=0;
    for(let y=0; y<GH; y++){
      const idx = y*GW+x;
      r = occ[idx] ? 0 : r+1;
      run[idx] = r;
    }
  }
}
/* Encuentra la posición de MENOR oy (y, a igual oy, menor ox) donde un
   rectángulo libre de gw x gh celdas entra, usando "run" de arriba.
   Ventana deslizante con deque monótono: O(GW) por fila en vez de
   O(GW) llamadas a fits() por fila — el mismo criterio de colisión,
   solo que sin volver a comparar desde cero en cada columna. */
function findRectFit(run, GW, GH, gw, gh, dequeBuf){
  if(gw>GW || gh>GH) return null;
  const deque = dequeBuf || new Int32Array(GW);
  for(let y=gh-1; y<GH; y++){
    const base = y*GW;
    let head=0, tail=0;
    for(let x=0; x<GW; x++){
      const v = run[base+x];
      while(tail>head && run[base+deque[tail-1]] >= v) tail--;
      deque[tail++]=x;
      while(deque[head] <= x-gw) head++;
      if(x>=gw-1 && run[base+deque[head]]>=gh){
        return {ox:x-gw+1, oy:y-gh+1};
      }
    }
  }
  return null;
}
/* Busca, en una chapa (de trabajo, ya con su pared virtual puesta), el
   largo más cercano al máximo real que entra en ALGÚN lugar — probando
   por bisección en vez de una lista fija de tamaños, para acercarse de
   verdad al máximo que el hueco permite. "run" (buildFreeRunUp) se arma
   una sola vez por chapa, afuera, y se reutiliza en los 12 pasos. */
async function findLongestStripFit(run, GW, GH, stripW, stripMinLen, capLen, cell, grow, angles, mirrors, dequeBuf, rectOris){
  let lo = stripMinLen, hi = capLen, found = null;
  for(let iter=0; iter<12 && lo<=hi; iter++){
    const mid = Math.round((lo+hi)/2);
    // la bisección pide casi siempre los mismos largos (misma secuencia de
    // lo/hi) tira tras tira y chapa tras chapa: las orientaciones de cada
    // rectángulo de prueba se arman una sola vez por llamada a
    // computeStripLayer (rectOris), en vez de rasterizarlo de nuevo cada vez.
    let oris = rectOris && rectOris.get(mid);
    if(!oris){
      const rect = [[0,0],[stripW,0],[stripW,mid],[0,mid]];
      oris = await buildOrientations({points:rect, bbox:{minx:0,miny:0,maxx:stripW,maxy:mid,w:stripW,h:mid}}, cell, grow, angles, mirrors);
      if(rectOris) rectOris.set(mid, oris);
    }
    // se prueban las orientaciones viables (por lo general 2: acostada y
    // parada) y se toma la de menor oy (y, a igualdad, menor ox) — mismo
    // criterio de "lo más apretado hacia arriba" que ya usaba la app.
    let best=null;
    for(const o of oris){
      if(o.gw>GW || o.gh>GH) continue;
      const pos = findRectFit(run, GW, GH, o.gw, o.gh, dequeBuf);
      if(pos && (!best || pos.oy<best.pos.oy || (pos.oy===best.pos.oy && pos.ox<best.pos.ox))){
        best = {pos, o};
      }
    }
    if(best){
      found = {len:mid, placement:{ox:best.pos.ox, oy:best.pos.oy, o:best.o}};
      lo = mid+1;
    } else { hi = mid-1; }
  }
  return found;
}

/* Corre la búsqueda en todas las chapas del resultado actual (sin tocar
   las chapas reales) y devuelve, por chapa, la lista de tiras que
   entrarían — agrupadas por tamaño para poder numerarlas como piezas. */
async function computeStripLayer(chapas, sheetW, chapaLen, cell, stripW, stripMinLen, stripKerf){
  const grow = stripKerf/2;
  // una tira de relleno es un rectángulo simple: solo tiene sentido
  // acostada u horizontal (0°/180° dan la misma forma) o parada
  // (90°/270°) — probarla en ángulos intermedios (20°, 40°...) nunca
  // encaja bien contra piezas ya puestas en la grilla y solo diluye el
  // presupuesto de búsqueda entre orientaciones que casi nunca sirven.
  const angles = [0,90,180,270];
  const mirrors = [false];
  const capLen = Math.max(stripMinLen, sheetW, chapaLen);

  const layer = chapas.map(()=>[]);
  const rectOris = new Map(); // largo -> orientaciones del rectángulo de prueba (ver findLongestStripFit)
  for(let ci=0; ci<chapas.length; ci++){
    const scratch = cloneChapaForScratch(chapas[ci]);
    const boundYcells = Math.min(scratch.GH, Math.max(0, Math.ceil(effChapaLen(chapas[ci], chapaLen)/cell)));
    for(let y=boundYcells; y<scratch.GH; y++){
      const base=y*scratch.GW;
      for(let x=0;x<scratch.GW;x++) scratch.occ[base+x]=1;
      scratch.dirty[y]=1;
    }
    // "run" (cuántas celdas libres seguidas hay, contando desde arriba, en
    // cada columna) se arma una vez acá y se reusa en toda la bisección de
    // cada tira; solo hay que rehacerlo después de COMMITEAR una tira
    // nueva (cambió la ocupación real), no en cada paso de la búsqueda.
    let run = buildFreeRunUp(scratch);
    const dequeBuf = new Int32Array(scratch.GW);
    // el tope de "cuántas tiras como máximo por chapa" era 40 — con la
    // búsqueda ahora encontrando huecos que antes se saltaba, en una chapa
    // bien fragmentada (muchos recortes chicos) se puede necesitar más.
    let guard=0;
    while(guard++<250){
      const found = await findLongestStripFit(run, scratch.GW, scratch.GH, stripW, stripMinLen, capLen, cell, grow, angles, mirrors, dequeBuf, rectOris);
      if(!found) break;
      const {len, placement} = found;
      commitPlacement(scratch, placement.o, placement.ox, placement.oy);
      // la ocupación cambió, pero solo en las columnas de esta tira
      updateFreeRunUp(scratch, run, placement.ox, placement.ox + placement.o.gw - 1);
      layer[ci].push({
        w:stripW, len,
        x: placement.ox*cell + placement.o.offX, y: placement.oy*cell + placement.o.offY,
        rot: placement.o.rot, mirror:false, rp: placement.o.rp
      });
      if((guard & 15)===0) await new Promise(r=>setTimeout(r,0)); // por las dudas, en una chapa con MUCHAS tiras chicas
    }
    await new Promise(r=>setTimeout(r,0));
  }
  return layer;
}

/* Convierte el stripLayer (medidas puras) en piezas registradas — así
   quedan numeradas, en la tabla de piezas y en el PDF/DXF, igual que
   cualquier pieza que hubieras subido. Se llama cada vez que se refresca
   la vista en vivo, reemplazando el registro de tiras anterior. */
function registerStripLayer(layer){
  pieces = pieces.filter(p=>!p.isStrip);
  const groups = new Map();
  let total=0;
  layer.forEach((chapaStrips, ci)=>{
    chapaStrips.forEach(s=>{
      const key = Math.round(s.w)+'x'+Math.round(s.len);
      if(!groups.has(key)) groups.set(key, {w:Math.round(s.w), l:Math.round(s.len), items:[]});
      groups.get(key).items.push({ci, s});
      total++;
    });
  });
  groups.forEach(g=>{
    stripCounter++;
    const id = 'strip'+stripCounter;
    const rect = [[0,0],[g.w,0],[g.w,g.l],[0,g.l]];
    pieces.push({
      id, name:`TIRA ${g.w}×${g.l}mm`, points:rect, fast:rect,
      bbox:{minx:0,miny:0,maxx:g.w,maxy:g.l,w:g.w,h:g.l},
      area:g.w*g.l, perimeter:2*(g.w+g.l),
      qty:g.items.length, color: STRIP_COLOR, error:null, isStrip:true,
      _idFor: g.items // referencia para poder asignar el pieceId a cada tira del layer
    });
    g.items.forEach(({s})=>{ s.pieceId = id; s.name = `TIRA ${g.w}×${g.l}mm`; });
  });
  renderPieceTable();
  return total;
}

/* Junta piezas reales + tiras (del stripLayer) en una lista de chapas
   "para mostrar" — nunca modifica las chapas reales que usa el optimizador. */
function withStripLayer(chapas, layer){
  if(!layer) return chapas;
  return chapas.map((c,i)=>{
    const extra = layer[i];
    if(!extra || !extra.length) return c;
    return { ...c, placed: c.placed.concat(extra.map(s=>({
      pieceId:s.pieceId, name:s.name, color:STRIP_COLOR, area:s.w*s.len,
      x:s.x, y:s.y, rot:s.rot, mirror:s.mirror, rp:s.rp
    }))) };
  });
}

