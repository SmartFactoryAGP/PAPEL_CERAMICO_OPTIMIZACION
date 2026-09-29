/* =========================================================
   PUENTE AL WEB WORKER DEL MOTOR DE NESTING
   =========================================================
   Bloque 3 del plan (inspirado en LocalMaximumThreads=16 de Libélula):
   la parte más pesada del cálculo (placeJobPure, en optimization.js) corre
   en un hilo aparte, así la pestaña nunca se congela ni un instante,
   incluso sin los "sleep(0)" que se venían usando como parche.

   Por qué está armado así: la app sigue abriéndose con doble clic
   (file://), y los navegadores BLOQUEAN crear un Worker apuntando a un
   archivo .js aparte cuando la página se abrió como file:// (por
   seguridad). La vuelta: se arma el código del Worker EN CALIENTE, tomando
   el texto de las funciones puras que YA están cargadas en esta misma
   página (mediante fn.toString()) y metiéndolo en un Blob — así no hace
   falta pedirle al navegador que cargue ningún archivo adicional.

   Esto es más frágil que un Worker "de libro": si alguna función de la
   lista cambia de nombre, o si el navegador bloquea Workers desde Blob por
   alguna política local, esto puede fallar. Por eso TODO pasa por
   runInWorker(), que si algo sale mal devuelve null en vez de tirar error
   — y quien la llama (runNestingPass, en optimization.js) cae solo al
   camino de siempre en el hilo principal. El nesting nunca se rompe por
   esto: en el peor caso, simplemente no gana la ganancia de fluidez extra. */

const PURE_FN_NAMES = [
  // core/geometry.js, core/polygon.js, core/transform.js
  'polyBBox','transformPoly','rotateRaw','pip','distPointSeg','distToPoly','rasterizePoly',
  'cellsToRowSpans','polyArea','polyPerimeter','normalize','simplify',
  // nesting/orientation.js
  'buildOrientations',
  // nesting/placement.js
  'makeChapa','refreshRow','rowOccupied','rowCount','fits','contact',
  'spanOverlap','minStartY','findBestPlacement','commitPlacement',
  // nesting/optimization.js
  'shuffleArray','placeJobPure',
  // nesting/optimization.js — repack de una chapa ("ataque dirigido"),
  // antes SIEMPRE en el hilo principal, ahora también viaja al Worker
  'permutations','repackSingleChapa','repackChapaFromDefs',
  // nesting/scoring.js — repackSingleChapa las necesita para desempatar
  // entre acomodos (chapaUsedLen/chapaUsedX); OJO: son las 2 únicas de
  // ese archivo que no tocan el DOM, effChapaLen sí (usa document.*) y
  // por eso queda afuera — no hace falta adentro del Worker.
  'chapaUsedLen','chapaUsedX'
];
// REORDER_FNS es un objeto (no una función con nombre propio), se manda
// aparte como texto de asignación en vez de vía PURE_FN_NAMES.

let nestingWorker = null;
let workerReady = false;
let workerInitError = null;

function buildWorkerSource(){
  const parts = ['"use strict";', 'let ORI_CAP = 24;'];
  PURE_FN_NAMES.forEach(name=>{
    const fn = (typeof window!=='undefined' ? window[name] : self[name]);
    if(typeof fn !== 'function') throw new Error('falta la función pura "'+name+'" — no se pudo armar el Worker');
    parts.push(fn.toString());
  });
  parts.push('const REORDER_FNS = {\n' + Object.keys(REORDER_FNS).map(k=>`  ${k}: ${REORDER_FNS[k].toString()}`).join(',\n') + '\n};');
  parts.push(`
self.onmessage = async function(ev){
  const {id, kind, cfg} = ev.data;
  try {
    // el Worker arma su PROPIO deadline con su propio reloj — nunca usa un
    // timestamp absoluto que haya venido del hilo principal (tienen orígenes
    // de reloj distintos, comparar los timestamps directo daría cualquier cosa).
    let res;
    if(kind === 'repack'){
      const deadline = (typeof cfg.deadlineMsFromNow === 'number') ? performance.now() + cfg.deadlineMsFromNow : (performance.now()+700);
      res = await repackChapaFromDefs(cfg.placedDefs, cfg.GW, cfg.GH, cfg.deep, cfg.budget, cfg.cell, cfg.grow, cfg.angles, cfg.mirrors, deadline);
    } else {
      const deadline = (typeof cfg.deadlineMsFromNow === 'number') ? performance.now() + cfg.deadlineMsFromNow : undefined;
      res = await placeJobPure(cfg.pieceDefs, cfg.sheetW, cfg.chapaLen, cfg.cell, cfg.grow, cfg.angles, cfg.mirrors, cfg.deep, cfg.reorderName, cfg.oriCap, deadline);
    }
    self.postMessage({id, ok:true, res});
  } catch(e){
    self.postMessage({id, ok:false, error: (e && e.message) || String(e)});
  }
};
`);
  return parts.join('\n\n');
}

/* Indicador chico junto al botón "Ejecutar nesting" — para que se pueda
   ver de un vistazo si el cálculo va a correr en paralelo (Worker) o va a
   competir por el mismo hilo que dibuja la pantalla (hilo principal),
   sin tener que abrir la consola del navegador (F12) a buscar nada. */
function updateWorkerStatusUI(){
  const el = document.getElementById('workerStatus');
  if(!el) return;
  if(workerReady){
    el.innerHTML = '⚡ Cálculo en paralelo: <b style="color:#3ddc97">activo</b> — la pantalla no debería trabarse durante el nesting.';
    el.style.color = '';
  } else {
    el.innerHTML = '⚠️ Cálculo en paralelo: <b style="color:#e6a23c">no disponible</b> (' +
      (workerInitError || 'motivo desconocido') +
      ') — el nesting va a correr en el mismo hilo que la pantalla, puede notarse algo menos fluido.';
  }
}

function initNestingWorker(){
  if(typeof Worker === 'undefined'){ workerInitError = 'este navegador no tiene Web Worker'; updateWorkerStatusUI(); return; }
  try {
    const src = buildWorkerSource();
    const blob = new Blob([src], {type:'application/javascript'});
    const url = URL.createObjectURL(blob);
    nestingWorker = new Worker(url);
    nestingWorker.onmessage = handleWorkerMessage;
    nestingWorker.onerror = function(e){
      console.warn('[worker-bridge] el Worker de nesting tiró un error, se sigue en el hilo principal:', e.message);
      workerReady = false;
      updateWorkerStatusUI();
    };
    workerReady = true;
  } catch(e){
    workerInitError = e.message;
    console.warn('[worker-bridge] no se pudo iniciar el Worker de nesting, se sigue en el hilo principal:', e.message);
    workerReady = false;
  }
  updateWorkerStatusUI();
}

let msgId = 0;
const pending = new Map();
function handleWorkerMessage(ev){
  const cb = pending.get(ev.data.id);
  if(!cb) return;
  pending.delete(ev.data.id);
  cb(ev.data);
}

/* El Worker corre en su propio hilo, así que "Detener" (que solo pone
   nestingState.stop=true en el hilo principal) no lo interrumpe por sí
   solo — el Worker no puede ver esa variable. Antes, tocar "Detener"
   mientras el cálculo estaba corriendo ADENTRO del Worker se sentía como
   que no pasaba nada: había que esperar a que esa pasada terminara sola
   (hasta 20s) para recién ahí frenar. Ahora, apenas se toca "Detener",
   se MATA el Worker en el momento (nestingWorker.terminate()) y se resuelven
   ya mismo con null todas las pasadas que estuvieran esperando respuesta
   — quien llamó (runNestingPass) lo toma igual que un timeout normal y
   sigue su curso. Se arma un Worker nuevo al toque para la próxima vez. */
function abortNestingWorker(){
  if(!nestingWorker) return;
  try { nestingWorker.terminate(); } catch(e){ /* nada que hacer */ }
  pending.forEach(cb=>cb({ok:false, error:'detenido por el usuario'}));
  pending.clear();
  nestingWorker = null;
  workerReady = false;
  // se arma uno nuevo enseguida, listo para la próxima corrida de nesting
  try { initNestingWorker(); } catch(e){ workerInitError = e.message; }
}

/* Corre cfg en el Worker y devuelve el resultado, o null si el Worker no
   está disponible, tarda demasiado, o falla — en cualquiera de esos casos
   quien llama (runNestingPass) sigue con el camino de siempre, sin cortarse. */
function runInWorker(cfg, timeoutMs){
  return new Promise((resolve)=>{
    if(!workerReady || !nestingWorker){ resolve(null); return; }
    const id = ++msgId;
    const timer = setTimeout(()=>{ pending.delete(id); resolve(null); }, timeoutMs||20000);
    pending.set(id, (msg)=>{
      clearTimeout(timer);
      resolve(msg.ok ? msg.res : null);
    });
    try { nestingWorker.postMessage({id, cfg}); }
    catch(e){ clearTimeout(timer); pending.delete(id); resolve(null); }
  });
}

/* Igual que runInWorker, pero para el "ataque dirigido" (repack de una
   chapa). Se distingue "no vino del Worker" (workerReady=false, timeout,
   error) de "el Worker SÍ contestó pero no encontró nada mejor" — esto
   último es un resultado válido (res:null), no un fallo; si se
   confundieran, cada repack sin mejora forzaría repetir el cálculo
   entero en el hilo principal, perdiendo la mitad de la ganancia. */
function runRepackInWorker(cfg, timeoutMs){
  return new Promise((resolve)=>{
    if(!workerReady || !nestingWorker){ resolve({fromWorker:false}); return; }
    const id = ++msgId;
    const timer = setTimeout(()=>{ pending.delete(id); resolve({fromWorker:false}); }, timeoutMs||6000);
    pending.set(id, (msg)=>{
      clearTimeout(timer);
      resolve(msg.ok ? {fromWorker:true, res:msg.res} : {fromWorker:false});
    });
    try { nestingWorker.postMessage({id, kind:'repack', cfg}); }
    catch(e){ clearTimeout(timer); pending.delete(id); resolve({fromWorker:false}); }
  });
}

// se intenta arrancar el Worker apenas carga la página; si falla, queda
// workerReady=false y todo sigue funcionando en el hilo principal como antes.
try { initNestingWorker(); } catch(e){ workerInitError = e.message; }
