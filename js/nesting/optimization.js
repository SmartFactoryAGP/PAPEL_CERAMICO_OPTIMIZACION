function anglesFromStep(step){
  const set = new Set();
  for(let a=0;a<360;a+=step) set.add(a);
  // ángulos "seguros" que siempre se prueban además del paso: son la orientación
  // natural de piezas rectangulares/cuadradas, así nunca se quedan sin programar
  // aunque el paso elegido automáticamente no caiga justo en 90°/180°/270°.
  [0,90,180,270].forEach(a=>set.add(a));
  return [...set].sort((a,b)=>a-b);
}

/* Tamaño de grilla 100% automático: se calcula a partir de la pieza más
   pequeña cargada, para tener resolución suficiente sin frenar el cálculo.
   Ya no lo elige el usuario — reemplaza al viejo campo "Grilla (mm/celda)". */
function autoCellSize(activePieces, totalQty, sheetW, chapaLen){
  let minDim = Infinity;
  activePieces.forEach(p=>{
    if(p.bbox){ minDim = Math.min(minDim, p.bbox.w, p.bbox.h); }
  });
  if(!isFinite(minDim) || minDim<=0) minDim = 100;
  // grilla más gruesa = menos celdas = más fluido. Se afina un poco con
  // pocas piezas (hay margen de sobra) y se mantiene más gruesa con lotes
  // grandes, que es donde antes se sentía más pesado.
  const divisor = (totalQty!=null && totalQty<=60) ? 40 : (totalQty!=null && totalQty<=150) ? 34 : 28;
  let cell = minDim/divisor;
  cell = Math.max(0.6, Math.min(4.2, cell));
  // Freno de seguridad: la celda de arriba solo mira el tamaño de la pieza
  // más chica, nunca el tamaño del rollo. Con un ancho de rollo grande y/o
  // una chapa (largo de corte) larga — algo normal en producción real —
  // una celda fina arma una grilla GIGANTE (GW×GH) para CADA chapa. Antes
  // de ubicar una sola pieza, ya hay que RESERVAR esa memoria (un
  // Uint8Array + varios arrays más por chapa, hasta 80 chapas) — eso es
  // lo que se sentía como "la página no responde" durante varios minutos,
  // sin ningún error ni bucle infinito de por medio, solo una grilla
  // demasiado grande. Acá se engrosa la celda lo MÍNIMO indispensable
  // para que una sola chapa no pase de ~4 millones de celdas — de sobra
  // para nestear bien, solo evita el caso patológico.
  if(sheetW>0 && chapaLen>0){
    const MAX_CELLS_POR_CHAPA = 4000000;
    const cellMinPorGrilla = Math.sqrt((sheetW*chapaLen)/MAX_CELLS_POR_CHAPA);
    if(cellMinPorGrilla > cell) cell = cellMinPorGrilla;
  }
  return Math.round(cell*10)/10;
}

/* Pasos de rotación que el propio sistema va a probar por su cuenta en la
   Fase 1. Antes se probaban hasta 6 pasadas completas para lotes chicos —
   eso multiplicaba el trabajo por 6 y era la causa principal de que la
   página se trabara. Ahora son como máximo 3, y la Fase 2 (mejora continua)
   ya se encarga de seguir afinando sin tener que repetir todo desde cero.
   Si "fine" está activo (Libélula prueba cada 2°), se agrega UN paso extra
   bien fino al final de la lista de siempre — no reemplaza los rápidos,
   solo suma una pasada más precisa después de ya tener un resultado. */
function autoRotationSteps(totalQty, fine){
  const base = totalQty<=60 ? [30,15,6] : totalQty<=150 ? [30,12] : [45,20];
  if(!fine) return base;
  const fineStep = totalQty<=30 ? 2 : totalQty<=80 ? 3 : totalQty<=150 ? 5 : 8;
  return [...base, fineStep];
}

function shuffleArray(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
  return arr;
}

/* Estrategias de reordenamiento de la Fase 2 — antes vivían como funciones
   sueltas dentro de engine.js, ahora tienen nombre y viven acá para que el
   Web Worker (que no puede recibir funciones por postMessage, solo datos)
   pueda pedir "usá la estrategia X" por su nombre en vez de por referencia. */
const REORDER_FNS = {
  jitter: function(job){
    // variación aleatoria sobre el área: reordena "más o menos" de grande a
    // chico, no en bloques de tamaño exactamente igual — así SIEMPRE cambia
    // algo, tenga o no el lote piezas de tamaño repetido.
    return job.map(it=>({it, key:it.area*(0.82+Math.random()*0.36)}))
              .sort((a,b)=>b.key-a.key).map(x=>x.it);
  },
  maxSide: function(job){
    const arr = job.slice();
    arr.sort((a,b)=> (Math.max(b.def.bbox.w,b.def.bbox.h)-Math.max(a.def.bbox.w,a.def.bbox.h)) || (b.area-a.area));
    return arr;
  },
  perimeter: function(job){
    const arr = job.slice();
    arr.sort((a,b)=> ((b.def.bbox.w+b.def.bbox.h)-(a.def.bbox.w+a.def.bbox.h)) || (b.area-a.area));
    return arr;
  },
  free: function(job){ return shuffleArray(job.slice()); }
};

/* Registro de una pieza ya colocada en una chapa (lo que después dibujan
   el render, el PDF y el DXF) — mismo formato desde la pasada completa
   (placeJobPure) y desde el repack de una chapa (repackSingleChapa). */
function placedRecord(item, o, ox, oy, cell){
  return {
    pieceId:item.pieceId, name:item.name, color:item.color, area:item.area,
    x: ox*cell + o.offX,
    y: oy*cell + o.offY,
    rot:o.rot, mirror:o.mirror, rp:o.rp, engrave:o.engrave||null, holes:o.holes||null
  };
}

/* Núcleo PURO de una pasada de nesting: no lee `pieces` ni ningún otro
   global, no toca el DOM — recibe todo por parámetro y devuelve el
   resultado. Esto es justo lo que hace falta para poder correrlo tal cual,
   como texto, adentro de un Web Worker (ver worker-bridge.js): el hilo
   principal usa esta MISMA función como respaldo si el Worker no está
   disponible, así nunca hay dos copias de la lógica para mantener iguales. */
async function placeJobPure(pieceDefs, sheetW, chapaLen, cell, grow, angles, mirrors, deep, reorderName, oriCapOverride, deadline){
  if(typeof oriCapOverride === 'number') ORI_CAP = oriCapOverride;
  if(typeof deadline !== 'number') deadline = Infinity; // sin límite si no se pasa nada (compatibilidad)
  const GW = Math.floor(sheetW/cell), GH = Math.floor(chapaLen/cell);

  // arma las orientaciones de cada pieza — con piezas grandes/muchos
  // vértices esto puede tardar de verdad (se vio hasta 1.4s por pieza en
  // una industrial real), así que también respira acá, no solo en el
  // acomodo. Si se acaba el tiempo ACÁ, ni siquiera se llega a intentar
  // colocar esas piezas — quedan directo como "sin ubicar".
  const activeDefs = pieceDefs.filter(p=>p.points && p.qty>0);
  const oriByPiece = new Map();
  let vencido = false;
  for(const p of activeDefs){
    if(performance.now() >= deadline || (typeof nestingState!=='undefined' && nestingState.stop)){ vencido = true; break; }
    oriByPiece.set(p.id, await buildOrientations(p, cell, grow, angles, mirrors));
    await new Promise(r=>setTimeout(r,0));
  }

  const job = [];
  const sinOrientar = [];
  activeDefs.forEach(p=>{
    const oris = oriByPiece.get(p.id);
    if(!oris){ for(let i=0;i<p.qty;i++) sinOrientar.push({pieceId:p.id, def:p, oris:[], minCells:Infinity, color:p.color, area:p.area, name:p.name}); return; }
    const minCells = oris.length ? Math.min(...oris.map(o=>o.n)) : Infinity;
    for(let i=0;i<p.qty;i++) job.push({pieceId:p.id, def:p, oris, minCells, color:p.color, area:p.area, name:p.name});
  });
  if(!job.length && !sinOrientar.length) return null;

  let jobOrdered = job.slice();
  jobOrdered.sort((a,b)=> (b.area-a.area) || ((b.def.bbox.w*b.def.bbox.h)-(a.def.bbox.w*a.def.bbox.h)));
  const reorderFn = reorderName ? REORDER_FNS[reorderName] : null;
  if(reorderFn) jobOrdered = reorderFn(jobOrdered);

  const chapas = [];
  const unplaced = sinOrientar.slice(); // lo que ni siquiera llegó a tener orientaciones, directo acá
  const MAX_CHAPAS = 80;
  const n = jobOrdered.length;
  const BUDGET = deep
    ? (n<=60 ? 130000 : n<=150 ? 85000 : 55000)
    : 25000;

  const newChapa = ()=>{ const c=makeChapa(GW,GH); chapas.push(c); return c; };

  let sinCeder = 0;
  for(const item of jobOrdered){
    // typeof nestingState!=='undefined' es lo que permite compartir esta
    // MISMA función entre el hilo principal y el Web Worker (ver
    // worker-bridge.js): en el hilo principal existe nestingState y corta
    // apenas tocás "Detener"; adentro del Worker esa variable global nunca
    // existe, typeof la devuelve 'undefined' sin tirar error, y esta
    // condición simplemente no aplica ahí (el Worker se corta terminándolo
    // desde afuera, ver abortNestingWorker en worker-bridge.js).
    if(vencido || performance.now() >= deadline || (typeof nestingState!=='undefined' && nestingState.stop)){ unplaced.push(item); vencido = true; continue; }
    if(!item.oris.length || !item.oris.some(o=>o.gw<=GW && o.gh<=GH)){ unplaced.push(item); continue; }
    let done=false;
    for(const chapa of chapas){
      if(chapa.free < item.minCells) continue;
      const best = findBestPlacement(chapa, item.oris, deep, BUDGET);
      if(best){ commit(chapa, item, best); done=true; break; }
    }
    if(!done){
      if(chapas.length>=MAX_CHAPAS){ unplaced.push(item); continue; }
      const chapa = newChapa();
      const best = findBestPlacement(chapa, item.oris, deep, BUDGET);
      if(best) commit(chapa, item, best); else unplaced.push(item);
    }
    // cede el hilo cada 12 piezas — en el hilo principal evita trabar la
    // pestaña; adentro del Worker no hace falta pero tampoco molesta.
    sinCeder++;
    if(sinCeder>=12){ sinCeder=0; await new Promise(r=>setTimeout(r,0)); }
  }

  function commit(chapa, item, best){
    const o=best.o;
    commitPlacement(chapa, o, best.ox, best.oy);
    chapa.free -= o.n;
    chapa.placed.push(placedRecord(item, o, best.ox, best.oy, cell));
  }

  return {chapas, unplaced, jobCount: jobOrdered.length};
}

/* Corre una simulación completa de nesting con un paso de rotación dado.
   Ahora es una envoltura chica: arma la lista de piezas activas y le pasa
   todo a placeJobPure — primero intenta correrlo en el Web Worker (no
   traba la pestaña ni un instante); si el Worker no está disponible o
   falla, sigue en el hilo principal con la misma función, como siempre. */
/* Copia liviana de una pieza para mandarle al Web Worker (postMessage
   solo acepta datos). OJO: tiene que incluir "fast" (contorno de
   colisión), "engraveLoops" y "holes" — hubo un bug real por no
   mandarlos: el grabado y los agujeros se perdían en silencio en toda
   pasada que saliera del Worker. Un solo lugar para no volver a olvidar
   un campo en alguno de los dos caminos (pasada completa y repack). */
function pieceDefForWorker(p){
  return {id:p.id, name:p.name, points:p.points, fast:p.fast||null, bbox:p.bbox, area:p.area, color:p.color, engraveLoops:p.engraveLoops||null, holes:p.holes||null};
}

async function runNestingPass(cfg){
  const {sheetW, chapaLen, cell, grow, angles, mirrors, deep, reorderName, deadline} = cfg;
  const pieceDefs = pieces.filter(p=>p.points && p.qty>0);

  if(typeof runInWorker === 'function'){
    // OJO: el Worker tiene su propio reloj (performance.now() arranca en
    // otro punto que el del hilo principal) — nunca se manda el deadline
    // absoluto, se manda cuánto falta en milisegundos, y el Worker arma
    // SU propio deadline al recibirlo.
    const deadlineMsFromNow = (typeof deadline==='number' && isFinite(deadline)) ? Math.max(0, deadline - performance.now()) : undefined;
    const viaWorker = await runInWorker({
      pieceDefs: pieceDefs.map(p=>Object.assign(pieceDefForWorker(p), {qty:p.qty})),
      sheetW, chapaLen, cell, grow, angles, mirrors, deep, reorderName: reorderName||null, oriCap: ORI_CAP, deadlineMsFromNow
    });
    if(viaWorker) return viaWorker;
  }
  return await placeJobPure(pieceDefs, sheetW, chapaLen, cell, grow, angles, mirrors, deep, reorderName, undefined, deadline);
}

/* Versión PURA de "armar orientaciones + repackSingleChapa": recibe los
   defs de las piezas ya achicados a datos simples (nada de referencias
   al array `pieces` del hilo principal), así se puede correr ENTERA
   adentro del Web Worker. Antes, el "ataque dirigido" de la Fase 2
   (engine.js) SIEMPRE corría en el hilo principal, aunque el resto del
   nesting ya usara el Worker — se notaba como una traba chiquita cada
   vez que probaba rearmar una chapa. Ahora esto también se manda al
   Worker cuando está disponible (ver runRepackPass más abajo). */
async function repackChapaFromDefs(placedDefs, GW, GH, deep, budget, cell, grow, angles, mirrors, deadline){
  const items = [];
  for(const pd of placedDefs){
    const oris = pd.def ? await buildOrientations(pd.def, cell, grow, angles, mirrors) : [];
    items.push({pieceId:pd.pieceId, def:pd.def, oris, color:pd.color, area:pd.area, name:pd.name});
  }
  return await repackSingleChapa(items, GW, GH, deep, budget, cell, deadline);
}

/* Envoltura del "ataque dirigido": arma los defs livianos de las piezas
   de ESA chapa (con grabado/agujeros incluidos, para no perderlos) y
   primero intenta correr todo en el Worker; si no está disponible o
   falla, cae al mismo camino de siempre en el hilo principal — nunca
   se rompe por esto, en el peor caso no gana la fluidez extra. */
async function runRepackPass(chapa, GW, GH, deep, budget, cell, grow, angles, mirrors, deadline){
  const placedDefs = chapa.placed.map(p=>{
    const def = pieces.find(pp=>pp.id===p.pieceId);
    return {
      pieceId: p.pieceId,
      def: def ? pieceDefForWorker(def) : null,
      color:p.color, area:p.area, name:p.name
    };
  });
  if(typeof runRepackInWorker === 'function'){
    const deadlineMsFromNow = Math.max(0, deadline - performance.now());
    const out = await runRepackInWorker({placedDefs, GW, GH, deep, budget, cell, grow, angles, mirrors, deadlineMsFromNow}, 6000);
    if(out.fromWorker) return out.res;
  }
  return await repackChapaFromDefs(placedDefs, GW, GH, deep, budget, cell, grow, angles, mirrors, deadline);
}
/* Genera permutaciones de un arreglo chico, una por una (no las junta todas
   en memoria). Con pocas piezas (≤7) esto reemplaza el sorteo al azar: en
   vez de tirar dados y arriesgarse a repetir un orden ya probado, se prueban
   TODAS las combinaciones posibles exactamente una vez. */
function* permutations(arr){
  if(arr.length<=1){ yield arr; return; }
  for(let i=0;i<arr.length;i++){
    const rest = arr.slice(0,i).concat(arr.slice(i+1));
    for(const p of permutations(rest)) yield [arr[i], ...p];
  }
}

async function repackSingleChapa(items, GW, GH, deep, budget, cell, deadline){
  let best=null;
  let sinCeder = 0;
  // pocas piezas => se agotan TODAS las combinaciones posibles (nunca repite
  // una que ya probó). Con más piezas, sigue siendo al azar, pero evitando
  // repetir exactamente el mismo orden dentro de esta misma pulida.
  const exhaustive = items.length>0 && items.length<=7;
  const gen = exhaustive ? permutations(items) : null;
  const triedSig = exhaustive ? null : new Set();
  function nextOrder(){
    if(exhaustive){
      const nxt = gen.next();
      return nxt.done ? null : nxt.value;
    }
    for(let tries=0; tries<25; tries++){
      const cand = shuffleArray(items.slice());
      const sig = cand.map(it=>it.pieceId).join(',');
      if(!triedSig.has(sig)){ triedSig.add(sig); return cand; }
    }
    return shuffleArray(items.slice()); // ya probó casi todo lo posible por las buenas, sigue igual
  }

  while(performance.now() < deadline && !(typeof nestingState!=='undefined' && nestingState.stop)){
    const order = nextOrder();
    if(!order) break; // modo agotado: ya se probaron todas las combinaciones posibles, no hay más que buscar
    const ch = makeChapa(GW,GH);
    let ok=true;
    for(const item of order){
      // el freno de deadline de arriba (el while) solo se chequea ENTRE
      // órdenes completos — con la búsqueda fina ahora barriendo de verdad
      // (ver placement.js), un solo item en una chapa grande y muy llena
      // puede tardar varios cientos de ms en descartar que no entra en
      // ningún lado; con varios items por orden, eso se puede sumar más
      // del deadline pedido antes de que el while de arriba se entere. Por
      // eso también se corta ACÁ, a mitad de un orden, si ya se pasó.
      if(performance.now() >= deadline){ ok=false; break; }
      if(!item.oris.length){ ok=false; break; }
      // fine=true: barrido exhaustivo en X, celda por celda. Con pocas piezas
      // (esto solo corre sobre chapas chicas) es barato y es lo que cierra los
      // huecos horizontales que antes quedaban por el salteo de posiciones.
      const placement = findBestPlacement(ch, item.oris, deep, budget, true);
      if(!placement){ ok=false; break; }
      commitPlacement(ch, placement.o, placement.ox, placement.oy);
      ch.placed.push(placedRecord(item, placement.o, placement.ox, placement.oy, cell));
    }
    if(ok){
      const used = chapaUsedLen(ch);
      const usedX = chapaUsedX(ch);
      // primero el que corta menos largo de rollo (lo único que cuesta plata);
      // entre dos que cortan prácticamente lo mismo, el que además queda más
      // junto de lado a lado (así no vuelve a aparecer un hueco como el marcado)
      if(!best || used < best.used - 0.05 || (Math.abs(used-best.used)<=0.05 && usedX<best.usedX)){
        best = {ch, used, usedX};
      }
    }
    // cede el hilo tras cada orden probado — antes este while corría los
    // 900ms de un tirón sin dejar respirar al navegador.
    sinCeder++;
    if(sinCeder>=1){ sinCeder=0; await new Promise(r=>setTimeout(r,0)); }
  }
  return best ? best.ch : null;
}
