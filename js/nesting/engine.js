document.getElementById('runBtn').addEventListener('click', runNest);
document.getElementById('stopBtn').addEventListener('click', ()=>{
  nestingState.stop = true;
  // si el cálculo está corriendo adentro del Web Worker en este momento,
  // esto lo corta ya mismo en vez de esperar a que esa pasada termine sola.
  if(typeof abortNestingWorker==='function') abortNestingWorker();
  const sb = document.getElementById('stopBtn');
  sb.disabled = true; sb.textContent = 'Deteniendo...';
});

function runNest(){
  const btn = document.getElementById('runBtn');
  const stopBtn = document.getElementById('stopBtn');
  btn.disabled=true; btn.textContent='Calculando...';
  stopBtn.style.display='block'; stopBtn.disabled=false; stopBtn.textContent='Detener y usar este resultado';
  document.getElementById('reopenLogBtn').style.display='none';
  document.getElementById('progress').textContent='Preparando orientaciones...';
  resetAttemptLog();
  document.getElementById('logOverlay').style.display='flex'; // se abre solo, como en Libélula
  nestingState.running=true; nestingState.stop=false;
  setTimeout(async ()=>{
    try{ await doNest(); }
    catch(err){ console.log('[v0] error nesting:', err); alert('Error en el nesting: '+err.message); }
    finally {
      nestingState.running=false;
      btn.disabled=false; btn.textContent='Ejecutar nesting';
      stopBtn.style.display='none';
      document.getElementById('progress').textContent='';
      // la ventana se puede seguir consultando aunque ya haya terminado
      document.getElementById('reopenLogBtn').style.display =
        (document.getElementById('logOverlay').style.display==='none') ? 'block' : 'none';
    }
  }, 30);
}

async function doNest(){
  // Se limpia el historial de intentos ACÁ (no solo en runNest(), el botón
  // de la pestaña Nesting) para que CUALQUIER forma de llamar a doNest() —
  // incluida "Ejecutar lote de corte" desde Lista de corte, que llama a
  // doNest() directo — arranque siempre con el panel vacío. Antes, correr
  // el nesting varias veces desde Lista de corte iba ACUMULANDO todos los
  // intentos de todas las corridas anteriores en el mismo panel sin
  // borrarse nunca (nodos de más en el DOM, snapshots de más en memoria),
  // y eso era lo que terminaba pegando la página después de 2-3 corridas.
  resetAttemptLog();
  const t0 = performance.now();
  const sheetW = parseFloat(document.getElementById('sheetW').value);
  const chapaLen = parseFloat(document.getElementById('chapaLen').value);
  const kerf = Math.max(0, parseFloat(document.getElementById('kerf').value)||0);
  const allowMirror = document.getElementById('allowMirror').checked;
  const deep = document.getElementById('deepSearch').checked;
  const maxMinutes = Math.max(0, parseFloat(document.getElementById('maxMinutes').value)||0);
  const deadline = maxMinutes>0 ? t0 + maxMinutes*60000 : Infinity; // 0 = sin límite
  const fineRotationOn = document.getElementById('fineRotation').checked;
  setOriCap(fineRotationOn ? 60 : 24); // con pasos de 2° hacen falta más orientaciones vivas, no solo las 24 de siempre

  // saca las tiras de relleno de una corrida anterior antes de nestear —
  // son generadas, no deben tratarse como piezas normales a reacomodar
  pieces = pieces.filter(p=>!p.isStrip);
  renderPieceTable();

  const activePieces = pieces.filter(p=>p.points && p.qty>0);
  if(!activePieces.length){ alert('No hay piezas con cantidad mayor a 0.'); return; }

  const totalQty = activePieces.reduce((s,p)=>s+p.qty,0);
  const cell = autoCellSize(activePieces, totalQty, sheetW, chapaLen);  // grilla automática, ya no la define el usuario
  const grow = kerf/2;                       // media separación por lado => kerf total entre dos piezas
  const mirrors = allowMirror ? [false,true] : [false];
  const steps = autoRotationSteps(totalQty, fineRotationOn); // candidatos de rotación que el sistema prueba solo

  // tiras de relleno: se leen una vez acá y se recalculan DURANTE el
  // proceso (cada vez que hay una mejora), no solo al final.
  const fillStripsOn = document.getElementById('fillStrips').checked;
  const stripW = Math.max(1, parseFloat(document.getElementById('stripW').value)||80);
  const stripMinLen = Math.max(1, parseFloat(document.getElementById('stripMinLen').value)||120);
  const stripKerf = Math.max(0, parseFloat(document.getElementById('stripKerf').value)||0);
  let stripLayer = [];
  let lastStripCount = 0;
  let lastStripRefresh = -Infinity;
  const STRIP_COOLDOWN = 800; // ms — no recalcula tiras más seguido que esto, aunque haya mejoras seguidas
  // OJO — rendimiento: recalcular TODAS las chapas cada vez que mejora
  // UNA sola (el caso típico del "ataque dirigido", que solo toca una
  // chapa por vez) era trabajo tirado — con 19 chapas, cada recálculo
  // completo pagaba el costo de las otras 18 que no cambiaron un pixel.
  // Si quien llama sabe QUÉ índices de chapa cambiaron de verdad
  // (onlyIndices), se recalcula solo eso y se pisa en el lugar; si no
  // (reordenamiento, que puede cambiar cualquier chapa o hasta la
  // cantidad de chapas), se recalcula todo como antes.
  async function refreshStrips(chapas, force, onlyIndices){
    if(!fillStripsOn) return;
    const now = performance.now();
    if(!force && now-lastStripRefresh<STRIP_COOLDOWN) return;
    lastStripRefresh = now;
    document.getElementById('progress').textContent = 'Actualizando tiras de relleno...';
    if(onlyIndices && onlyIndices.length && stripLayer.length===chapas.length){
      for(const i of onlyIndices){
        const one = await computeStripLayer([chapas[i]], sheetW, chapaLen, cell, stripW, stripMinLen, stripKerf);
        stripLayer[i] = one[0];
      }
    } else {
      stripLayer = await computeStripLayer(chapas, sheetW, chapaLen, cell, stripW, stripMinLen, stripKerf);
    }
    const count = registerStripLayer(stripLayer);
    if(count !== lastStripCount){
      const utilWithStrips = scorePass({chapas: withStripLayer(chapas, stripLayer), unplaced:bestPass?bestPass.unplaced:[]}, sheetW, chapaLen).util;
      logAttempt({
        label:'Tiras de relleno', detail:`Actualizó las tiras de relleno con el sobrante actual → ${count} tira(s) en total`,
        util: utilWithStrips, utilTxt: fmtPct(utilWithStrips), kept:true, delta:null,
        sheetW, chapaLen, chapasSnapshot: lightChapas(withStripLayer(chapas, stripLayer))
      });
      lastStripCount = count;
    }
  }

  document.getElementById('logConstraints').innerHTML =
    `${totalQty} pieza(s) a acomodar · Espejo: <b style="color:var(--ink)">${allowMirror?'sí':'no'}</b> · ` +
    `Separación (kerf): <b style="color:var(--ink)">${kerf} mm</b> · Búsqueda profunda: <b style="color:var(--ink)">${deep?'sí':'no'}</b> · ` +
    `Ancho rollo: <b style="color:var(--ink)">${sheetW} mm</b>` +
    (fillStripsOn ? ` · Tiras: <b style="color:var(--ink)">${stripW}mm anc. / ${stripMinLen}mm mín.</b>` : '') +
    (maxMinutes>0 ? ` · Tiempo máximo: <b style="color:var(--ink)">${maxMinutes} min</b> (se detiene solo)` : '') +
    (fineRotationOn ? ` · Rotación fina: <b style="color:var(--ink)">sí (cada 2°)</b>` : '');

  // Fase 1: barrido rápido de pasos de rotación para tener un primer
  // resultado decente ya mismo (esto es lo que se muestra "de primeras").
  let bestPass=null, bestScore=null, bestStep=null;
  for(let i=0;i<steps.length;i++){
    if(nestingState.stop) break;
    if(performance.now() >= deadline){
      logAttempt({label:'Barrido inicial', detail:'Se acabó el tiempo máximo durante el barrido inicial — sigue con lo que ya se encontró.', kept:false});
      break;
    }
    const step = steps[i];
    document.getElementById('progress').textContent =
      `Rotación automática: probando paso ${step}° (${i+1}/${steps.length})...`;
    await new Promise(r=>setTimeout(r,0));
    const angles = anglesFromStep(step);
    const res = await runNestingPass({sheetW, chapaLen, cell, grow, angles, mirrors, deep, deadline});
    if(!res){
      logAttempt({label:'Barrido inicial', detail:`Paso ${step}° — no logró ubicar ninguna pieza`, kept:false});
      continue;
    }
    const score = scorePass(res, sheetW, chapaLen);
    const better = !bestPass || passIsBetter(score, bestScore);
    const prevUtil = bestScore ? bestScore.util*100 : null;
    logAttempt({
      label:'Barrido inicial',
      detail:`Probó paso de rotación ${step}° (${angles.length} ángulos por pieza) → ${score.numChapas} chapa(s), ${score.unplaced} sin ubicar`,
      util: score.util, utilTxt: fmtPct(score.util), kept: better,
      delta: better && prevUtil!=null ? (score.util*100-prevUtil) : null,
      sheetW, chapaLen, chapasSnapshot: lightChapas(res.chapas)
    });
    if(better){
      bestPass = res; bestScore = score; bestStep = step;
      renderLive(sheetW, chapaLen, withStripLayer(bestPass.chapas, stripLayer));
      updateStats(sheetW, chapaLen, withStripLayer(bestPass.chapas, stripLayer), bestPass.jobCount + stripLayer.reduce((s,l)=>s+l.length,0), bestPass.unplaced.length, performance.now()-t0);
    }
  }
  if(!bestPass){ alert('No hay piezas con cantidad mayor a 0.'); return; }

  // primer cálculo de tiras, ya con el primer resultado en pantalla —
  // así no hay que esperar a la Fase 2 para verlas por primera vez.
  await refreshStrips(bestPass.chapas, true);
  if(fillStripsOn){
    renderLive(sheetW, chapaLen, withStripLayer(bestPass.chapas, stripLayer));
    updateStats(sheetW, chapaLen, withStripLayer(bestPass.chapas, stripLayer), bestPass.jobCount + stripLayer.reduce((s,l)=>s+l.length,0), bestPass.unplaced.length, performance.now()-t0);
  }

  // Fase 2: mejora continua, sin límite — igual que Libélula. Sigue
  // probando acomodos y cada vez que encuentra algo mejor actualiza la
  // vista en el momento. Cada intento (sirva o no) queda anotado en la
  // ventana de historial, y los que sí produjeron un plano válido se
  // pueden abrir con un clic. Corre hasta que vos toques "Detener".
  const bestAngles = anglesFromStep(bestStep);

  // Estrategias de reordenamiento que se van alternando en cada intento de
  // "reordenamiento" — antes había una sola (mezclar piezas de área
  // EXACTAMENTE igual), que no hacía nada si no había piezas repetidas de
  // igual tamaño y por eso salían intentos idénticos uno tras otro.
  // Las implementaciones viven en REORDER_FNS (optimization.js) para que el
  // Web Worker también pueda usarlas por nombre (no se le puede mandar una
  // función por postMessage, solo datos).
  const REORDER_STRATEGIES = [
    {name:'tamaño con variación', key:'jitter'},
    {name:'lado más largo primero', key:'maxSide'},
    {name:'perímetro primero', key:'perimeter'},
    {name:'orden totalmente libre', key:'free'}
  ];

  // huella de un resultado: si dos intentos dan exactamente esto mismo, es
  // el mismo acomodo aunque el orden de entrada haya sido distinto — sirve
  // para avisarte cuándo el motor ya convergió en vez de mostrar "no
  // mejoró" genérico una y otra vez.
  function resultSignature(chapasArr){
    return chapasArr.map(c=>Math.round(effChapaLen(c, chapaLen)*10)).sort((a,b)=>a-b).join(',')+'|'+chapasArr.length;
  }

  let attempt = 0, reorderIdx = 0, attackRound = 0;
  let stoppedByTimeout = false;
  while(deep && !nestingState.stop){
    if(performance.now() >= deadline){ stoppedByTimeout = true; break; }
    attempt++;
    let improved = false;
    // si la mejora de esta vuelta tocó una sola chapa puntual (ataque
    // dirigido), va acá su índice — así refreshStrips recalcula solo esa
    // en vez de las 19. Si quedó en null, se recalculan todas (caso del
    // reordenamiento, que puede mover cualquier chapa).
    let changedIdx = null;
    const bestSig = resultSignature(bestPass.chapas);

    if(attempt % 2 === 0){
      // ataque dirigido: rearma desde cero UNA de las 3 chapas que hoy MENOS
      // aprovechan (rotando entre ellas, no siempre la misma) — así, una vez
      // que una chapa chica ya quedó en su mejor acomodo posible, no se le
      // siguen gastando intentos encima mientras las otras dos siguen sin tocar.
      const GW = Math.floor(sheetW/cell), GH = Math.floor(chapaLen/cell);
      const candidates = bestPass.chapas
        .map((c,i)=>({i, n:c.placed.length, util: utilOf(c, sheetW, effChapaLen(c, chapaLen))}))
        .filter(c=>c.n>0 && c.n<=25)
        .sort((a,b)=>a.util-b.util)
        .slice(0,3);
      const cand = candidates.length ? candidates[attackRound % candidates.length] : null;
      attackRound++;
      if(cand){
        const chapa = bestPass.chapas[cand.i];
        const itemCount = chapa.placed.length; // para el log — ya no hace falta armar orientaciones acá solo para contar
        const deadline = performance.now() + 700;
        // antes esto SIEMPRE corría acá mismo, en el hilo principal — ahora
        // intenta primero en el Worker (igual que el resto del nesting) y
        // solo cae al hilo principal si el Worker no está disponible.
        const rep = await runRepackPass(chapa, GW, GH, deep, 350000, cell, grow, bestAngles, mirrors, deadline);
        const chapaLabel = `Chapa ${cand.i+1}`;
        if(rep){
          const oldLen = effChapaLen(chapa, chapaLen), newLen = effChapaLen(rep, chapaLen);
          const oldX = chapaUsedX(chapa), newX = chapaUsedX(rep);
          // se acepta si corta menos largo de rollo, O si corta prácticamente
          // lo mismo pero queda notoriamente más junta de lado a lado (esto es
          // lo que cierra huecos como el que marcaste, aunque no ahorre mm).
          const acceptedByLen = newLen < oldLen - 0.5;
          const acceptedByFit = !acceptedByLen && newLen <= oldLen + 0.5 && newX < oldX - 5;
          const accepted = acceptedByLen || acceptedByFit;
          const identical = !accepted && Math.abs(newLen-oldLen)<0.05 && Math.abs(newX-oldX)<0.5;
          const prevUtil2 = bestScore.util*100;
          const previewChapas = bestPass.chapas.slice();
          previewChapas[cand.i] = rep;
          if(accepted){
            bestPass.chapas[cand.i] = rep;
            bestScore = scorePass(bestPass, sheetW, chapaLen);
            improved = true;
            changedIdx = cand.i;
          }
          logAttempt({
            label:'Ataque dirigido',
            detail:`Rearmó ${chapaLabel} (aprovechaba ${cand.util.toFixed(1)}%, ${itemCount} pieza(s), reordenó y probó rotaciones) — ` +
              (acceptedByLen ? `acortó el corte de ${oldLen.toFixed(0)} a ${newLen.toFixed(0)} mm` :
               acceptedByFit ? `mismo largo de corte, pero quedó más junta de lado a lado` :
               identical ? `ya estaba en su mejor acomodo posible (resultado idéntico)` :
               `no superó lo que ya tenía, se descartó`),
            util: accepted ? bestScore.util : scorePass({chapas:previewChapas, unplaced:bestPass.unplaced}, sheetW, chapaLen).util,
            utilTxt: fmtPct(bestScore.util), kept: accepted,
            delta: accepted ? (bestScore.util*100-prevUtil2) : null,
            sheetW, chapaLen, chapasSnapshot: lightChapas(previewChapas)
          });
        } else {
          logAttempt({label:'Ataque dirigido', detail:`Intentó rearmar ${chapaLabel} (${itemCount} pieza(s)) — no encontró un acomodo válido a tiempo`, kept:false});
        }
      }
    } else {
      const strategy = REORDER_STRATEGIES[reorderIdx % REORDER_STRATEGIES.length];
      reorderIdx++;
      const res2 = await runNestingPass({sheetW, chapaLen, cell, grow, angles:bestAngles, mirrors, deep, reorderName: strategy.key, deadline});
      if(res2){
        const score2 = scorePass(res2, sheetW, chapaLen);
        const better2 = passIsBetter(score2, bestScore);
        const identical = !better2 && resultSignature(res2.chapas)===bestSig;
        const prevUtil3 = bestScore.util*100;
        if(better2){ bestPass=res2; bestScore=score2; improved=true; }
        logAttempt({
          label:'Reordenamiento: '+strategy.name,
          detail: identical
            ? `Probó entrar las piezas en otro orden (${strategy.name}) → dio exactamente el mismo acomodo que ya tenías`
            : `Probó entrar las piezas en otro orden (${strategy.name}) → ${score2.numChapas} chapa(s), ${score2.unplaced} sin ubicar`,
          util: score2.util, utilTxt: fmtPct(score2.util), kept: better2,
          delta: better2 ? (score2.util*100-prevUtil3) : null,
          sheetW, chapaLen, chapasSnapshot: lightChapas(res2.chapas)
        });
      } else {
        logAttempt({label:'Reordenamiento: '+strategy.name, detail:`Probó otro orden (${strategy.name}) — no logró ubicar todas las piezas`, kept:false});
      }
    }

    if(improved){
      await refreshStrips(bestPass.chapas, false, changedIdx!=null ? [changedIdx] : null);
      renderLive(sheetW, chapaLen, withStripLayer(bestPass.chapas, stripLayer));
      updateStats(sheetW, chapaLen, withStripLayer(bestPass.chapas, stripLayer), bestPass.jobCount + stripLayer.reduce((s,l)=>s+l.length,0), bestPass.unplaced.length, performance.now()-t0);
    }
    const restante = maxMinutes>0 ? ` — se detiene solo en ${Math.max(0,(deadline-performance.now())/60000).toFixed(1)} min` : ` — tocá "Detener" cuando te convenza`;
    document.getElementById('progress').textContent =
      `Intento ${attempt} — mejor hasta ahora: ${(bestScore.util*100).toFixed(1)}%${restante}`;
    await new Promise(res=>setTimeout(res,0));
  }
  if(stoppedByTimeout){
    logAttempt({
      label:'Tiempo máximo alcanzado', detail:`Llegó a los ${maxMinutes} min configurados y se detuvo solo, usando lo mejor que encontró hasta acá.`,
      util: bestScore.util, utilTxt: fmtPct(bestScore.util), kept:true, delta:null,
      sheetW, chapaLen, chapasSnapshot: lightChapas(withStripLayer(bestPass.chapas, stripLayer))
    });
  }

  // Fase 3 (opcional): pulido dedicado a las tiras de relleno. Ojo con la
  // idea de "que siga probando más tiempo": la búsqueda de tiras es
  // determinística (no tira dados) — sobre la MISMA chapa sin cambios,
  // volver a correrla mil veces da siempre el mismo resultado, así que
  // "esperar más" solo no alcanza. Lo que sí puede abrir un hueco nuevo es
  // REACOMODAR las piezas de esa chapa (el "ataque dirigido" de la Fase 2,
  // que ya prioriza cortar menos rollo — no dejar mejor hueco para tiras).
  // Acá se dedica un rato aparte, después de la Fase 2, a intentar
  // reacomodar puntualmente las chapas que HOY les sobra espacio suelto sin
  // aprovechar, y solo se queda con el reacomodo si de verdad deja más
  // tira(s) que antes (si no, se descarta y no se toca nada, aunque el
  // reacomodo en sí fuera "válido" — acá lo único que importa es si suma
  // tiras). No corre si tocaste "Detener".
  if(fillStripsOn && !nestingState.stop){
    // OJO — encontrado probando la app real de punta a punta: esto SIEMPRE
    // eran 35s EXTRA, sin importar el "Tiempo máximo" que hayas puesto — si
    // configurabas "5 min y que se detenga solo", en la práctica podía
    // terminar tardando 5 min + hasta 35s más, sin avisarte. Ahora, si
    // pusiste un tope de tiempo (maxMinutes>0), el Pulido se achica a un
    // respiro corto (8s) en vez de otros 35s enteros — sigue sumando algo
    // de material real (con el motor de tiras ahora mucho más rápido, 8s
    // alcanza para bastante), pero sin romper la promesa de "se detiene
    // solo en X min". Si NO pusiste tope (maxMinutes=0, "corré hasta que yo
    // toque Detener"), en la práctica esto nunca llega a ejecutarse por su
    // cuenta de todas formas (tocar Detener también corta el Pulido, ver
    // el "!nestingState.stop" de más arriba), así que ahí no hay nada que
    // acotar y se deja el margen completo.
    const POLISH_BUDGET_MS = maxMinutes>0 ? 8000 : 35000;
    const polishDeadline = performance.now() + POLISH_BUDGET_MS;
    const GWp = Math.floor(sheetW/cell), GHp = Math.floor(chapaLen/cell);
    const MAX_INTENTOS_POR_CHAPA = 4; // si una chapa no cede en 4 intentos, se da por perdida — no vale la pena seguir insistiendo con la misma y gastar ahí los 20s enteros
    const intentos = new Map(); // índice de chapa -> cuántas veces ya se probó sin éxito
    let polishRound = 0, polishFound = 0;
    while(performance.now() < polishDeadline && !nestingState.stop){
      document.getElementById('progress').textContent = `Pulido de tiras — revisando qué falta en cada chapa (${polishFound} sumada(s) hasta ahora)...`;
      // ¿qué chapas todavía tienen espacio suelto sin usar (piezas + tiras
      // ya puestas no llenan la chapa), no están vacías ni sobrecargadas, y
      // no se dieron ya por perdidas tras varios intentos sin éxito?
      const conHueco = bestPass.chapas
        .map((c,i)=>{
          const usado = c.placed.reduce((s,p)=>s+p.area,0) + (stripLayer[i]||[]).reduce((s,t)=>s+t.w*t.len,0);
          const libre = sheetW*effChapaLen(c, chapaLen) - usado;
          return {i, libre, n:c.placed.length};
        })
        .filter(c=>c.n>0 && c.n<=25 && c.libre > stripW*stripMinLen*0.4 && (intentos.get(c.i)||0) < MAX_INTENTOS_POR_CHAPA)
        .sort((a,b)=>b.libre-a.libre);
      if(!conHueco.length) break; // ninguna chapa con hueco suelto que valga la pena, o ya se probaron todas sin éxito — no insiste más
      // OJO: antes esto rotaba solo entre las 3 chapas con MÁS hueco libre
      // (`% Math.min(3, conHueco.length)`) — con más de 3 chapas necesitando
      // revisión, las que quedaban 4ta en adelante por ranking de "hueco
      // libre" (aunque genuinamente les faltara una tira) podían quedar
      // afuera toda la sesión mientras el tiempo se gastaba siempre en las
      // mismas 3 primeras. Ahora rota por TODAS las que todavía califican,
      // así ninguna se queda sin su turno.
      const target = conHueco[polishRound % conHueco.length];
      polishRound++;
      intentos.set(target.i, (intentos.get(target.i)||0) + 1);
      const chapa = bestPass.chapas[target.i];
      // si esta era la última chance para esta chapa, corre la MISMA
      // búsqueda de tiras pero sin pedirle el largo mínimo configurado
      // (1mm en vez de stripMinLen) y compara contra lo que YA hay puesto
      // (stripLayer): si encuentra más área, es que queda hueco pero por
      // debajo del mínimo; si no, es que ya está al máximo aprovechable
      // (o el hueco no forma un rectángulo derecho válido). Reusa
      // computeStripLayer tal cual (la misma función que arma stripLayer
      // en el resto de la app) para comparar manzanas con manzanas — antes
      // esto lo medía en una grilla aparte que no sabía qué tiras YA
      // estaban puestas, y podía "redescubrir" una que ya estaba ahí y
      // reportarla como si faltara. Se llama solo al agotar los intentos,
      // no en cada uno (sería carísimo repetirlo cada vez).
      async function logDiagnosticoSiSeAgotaron(){
        if((intentos.get(target.i)||0) < MAX_INTENTOS_POR_CHAPA) return;
        const stripsAntesDiag = stripLayer[target.i] || [];
        const areaAntesDiag = stripsAntesDiag.reduce((s,t)=>s+t.w*t.len,0);
        const sinMinimo = await computeStripLayer([chapa], sheetW, chapaLen, cell, stripW, 1, stripKerf);
        const stripsSinMinimo = sinMinimo[0] || [];
        const areaSinMinimo = stripsSinMinimo.reduce((s,t)=>s+t.w*t.len,0);
        if(areaSinMinimo > areaAntesDiag + 100){ // hay diferencia real, no ruido de redondeo
          const cortas = stripsSinMinimo.filter(s=>s.len < stripMinLen);
          const masLarga = cortas.length ? Math.round(Math.max(...cortas.map(s=>s.len))) : null;
          logAttempt({
            label:'Pulido de tiras',
            detail: masLarga
              ? `Chapa ${target.i+1}: le queda un hueco (mismo ancho de ${stripW}mm) donde entraría una tira de hasta ${masLarga}mm — por debajo del largo mínimo que configuraste (${stripMinLen}mm), por eso no se agregó.`
              : `Chapa ${target.i+1}: le queda algo de hueco suelto, pero repartido — ninguna tira individual del ancho configurado llega a su largo mínimo ahí.`,
            kept:false
          });
        } else {
          logAttempt({label:'Pulido de tiras', detail:`Chapa ${target.i+1}: ya está al máximo aprovechable con tiras de ${stripW}mm de ancho — lo que sobra no forma un rectángulo derecho de ese ancho, seguramente por el borde de una pieza vecina.`, kept:false});
        }
      }
      const rep = await runRepackPass(chapa, GWp, GHp, deep, 350000, cell, grow, bestAngles, mirrors, performance.now()+700);
      if(!rep){ await logDiagnosticoSiSeAgotaron(); await new Promise(r=>setTimeout(r,0)); continue; }
      const stripsAntes = stripLayer[target.i] || [];
      const areaAntes = stripsAntes.reduce((s,t)=>s+t.w*t.len,0);
      const capaProbada = await computeStripLayer([rep], sheetW, chapaLen, cell, stripW, stripMinLen, stripKerf);
      const stripsDespues = capaProbada[0] || [];
      const areaDespues = stripsDespues.reduce((s,t)=>s+t.w*t.len,0);
      if(areaDespues > areaAntes + 1){
        bestPass.chapas[target.i] = rep;
        stripLayer[target.i] = stripsDespues;
        intentos.delete(target.i); // mejoró — le da una tanda fresca de intentos por si todavía le queda hueco
        registerStripLayer(stripLayer);
        bestScore = scorePass(bestPass, sheetW, chapaLen);
        polishFound += Math.max(0, stripsDespues.length - stripsAntes.length);
        renderLive(sheetW, chapaLen, withStripLayer(bestPass.chapas, stripLayer));
        updateStats(sheetW, chapaLen, withStripLayer(bestPass.chapas, stripLayer), bestPass.jobCount + stripLayer.reduce((s,l)=>s+l.length,0), bestPass.unplaced.length, performance.now()-t0);
        logAttempt({
          label:'Pulido de tiras',
          detail:`Rearmó Chapa ${target.i+1} para poder sumarle tira(s) — antes ${stripsAntes.length} tira(s) ahí, ahora ${stripsDespues.length}`,
          util: bestScore.util, utilTxt: fmtPct(bestScore.util), kept:true, delta:null,
          sheetW, chapaLen, chapasSnapshot: lightChapas(withStripLayer(bestPass.chapas, stripLayer))
        });
      } else {
        await logDiagnosticoSiSeAgotaron();
      }
      await new Promise(r=>setTimeout(r,0));
    }
  }

  // recálculo final garantizado de las tiras (por si el último tramo del
  // bucle terminó justo dentro del enfriamiento y no llegó a refrescarlas)
  await refreshStrips(bestPass.chapas, true);
  const displayChapas = withStripLayer(bestPass.chapas, stripLayer);

  const t1 = performance.now();
  lastResult = {sheetW, chapaLen, cell, kerf, chapas: displayChapas, jobCount: bestPass.jobCount + displayChapas.reduce((s,c,i)=>s+((stripLayer[i]||[]).length),0),
                unplaced: bestPass.unplaced, step: bestStep, allowMirror, deep};
  // el resultado final siempre se muestra tal cual, aunque estuvieras
  // mirando un intento viejo en el momento de tocar "Detener"
  nestingState.previewingId = null;
  hidePreviewBanner();
  nestingState.liveSheetW=sheetW; nestingState.liveChapaLen=chapaLen; nestingState.liveChapas=displayChapas;
  renderChapas(sheetW, chapaLen, displayChapas);
  updateStats(sheetW, chapaLen, displayChapas, lastResult.jobCount, bestPass.unplaced.length, t1-t0);
}

/* =========================================================
   MÉTRICAS Y AGRUPACIÓN
   ========================================================= */
