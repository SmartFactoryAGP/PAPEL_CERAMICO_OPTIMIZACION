/* Chapa = occupancy + prefix sums por fila (para colisión O(1) por span)
   + skyline (altura ocupada máx. por columna) para saltar filas imposibles. */
function makeChapa(GW, GH){
  return {
    occ: new Uint8Array(GW*GH),
    // psum[y*(GW+1)+x] = # celdas ocupadas en la fila y antes de x
    psum: new Int32Array((GW+1)*GH),
    dirty: new Uint8Array(GH),      // filas cuyo psum hay que recalcular
    skyline: new Int32Array(GW),    // primera fila libre por columna
    maxY: 0,                        // fila más alta ocupada hasta ahora (para penalizar crecer sin necesidad)
    free: GW*GH,                    // celdas libres — para descartar rápido una chapa ya llena
    placed: [], GW, GH
  };
}
function refreshRow(ch, y){
  const {GW, occ, psum} = ch;
  const base = y*GW, pb = y*(GW+1);
  let acc=0;
  psum[pb]=0;
  for(let x=0;x<GW;x++){ acc += occ[base+x]; psum[pb+x+1]=acc; }
  ch.dirty[y]=0;
}
function rowOccupied(ch, y, x0, x1){   // ¿hay algo ocupado en [x0..x1]?
  if(ch.dirty[y]) refreshRow(ch, y);
  const pb = y*(ch.GW+1);
  return ch.psum[pb+x1+1] - ch.psum[pb+x0] > 0;
}
function rowCount(ch, y, x0, x1){
  if(x1<x0) return 0;
  if(x0<0) x0=0;
  if(x1>ch.GW-1) x1=ch.GW-1;
  if(x1<x0) return 0;
  if(ch.dirty[y]) refreshRow(ch, y);
  const pb = y*(ch.GW+1);
  return ch.psum[pb+x1+1] - ch.psum[pb+x0];
}

/* colisión: recorre spans, corta al primer choque */
function fits(ch, o, ox, oy){
  const rows=o.rows;
  for(let y=0;y<o.gh;y++){
    const spans=rows[y];
    if(!spans.length) continue;
    const gy=oy+y;
    for(let s=0;s<spans.length;s++){
      if(rowOccupied(ch, gy, ox+spans[s][0], ox+spans[s][1])) return false;
    }
  }
  return true;
}

/* Puntaje de contacto: cuánto perímetro de la pieza toca material vecino
   o el borde de la chapa. Alto = encaje apretado = menos huecos. */
function contact(ch, o, ox, oy){
  const {GW, GH} = ch;
  const rows=o.rows;
  let touch=0;
  for(let y=0;y<o.gh;y++){
    const spans=rows[y];
    if(!spans.length) continue;
    const gy=oy+y;
    const below = rows[y-1], above = rows[y+1];
    for(let s=0;s<spans.length;s++){
      const x0=ox+spans[s][0], x1=ox+spans[s][1];
      // laterales del span
      if(x0===0) touch+=2; else if(rowOccupied(ch,gy,x0-1,x0-1)) touch++;
      if(x1===GW-1) touch+=2; else if(rowOccupied(ch,gy,x1+1,x1+1)) touch++;
      // abajo: sólo cuenta donde la propia pieza no se tapa a sí misma
      if(gy===0) touch += (x1-x0+1)*2;
      else if(!below || spanOverlap(below, ox, x0, x1) < (x1-x0+1)){
        touch += rowCount(ch, gy-1, x0, x1);
      }
      // arriba
      if(gy===GH-1) touch += (x1-x0+1)*2;
      else if(!above || spanOverlap(above, ox, x0, x1) < (x1-x0+1)){
        touch += rowCount(ch, gy+1, x0, x1);
      }
    }
  }
  return touch;
}
function spanOverlap(spans, ox, x0, x1){
  let c=0;
  for(let i=0;i<spans.length;i++){
    const a=ox+spans[i][0], b=ox+spans[i][1];
    const lo=Math.max(a,x0), hi=Math.min(b,x1);
    if(hi>=lo) c += hi-lo+1;
  }
  return c;
}

/* Altura mínima de apoyo: la fila más baja donde la pieza puede empezar
   dado el skyline. Evita barrer filas que seguro chocan. */
function minStartY(ch, o, ox){
  let maxNeed = 0;
  for(let y=0;y<o.gh;y++){
    const spans=o.rows[y];
    for(let s=0;s<spans.length;s++){
      for(let x=ox+spans[s][0]; x<=ox+spans[s][1]; x++){
        const need = ch.skyline[x] - y;
        if(need>maxNeed) maxNeed=need;
      }
    }
  }
  return maxNeed<0?0:maxNeed;
}

/* Busca la mejor posición. Barre X en pasos y, para cada X, arranca en la
   altura mínima viable segun skyline -> muy pocas pruebas por columna. */
function findBestPlacement(ch, oris, deep, budget, fine){
  const {GW, GH} = ch;
  // dos "mejores": uno entre las posiciones que NO hacen crecer el alto ya
  // ocupado de la chapa (bestFit) y otro entre las que sí lo hacen (bestGrow).
  // Se agota siempre primero bestFit: así nunca se apila una pieza más
  // arriba mientras quede un hueco lateral libre dentro de lo ya ocupado,
  // sin tener que pelear por peso contra el puntaje de contacto (lo que
  // antes, con una penalización continua, terminaba desarmando el
  // interlocking apretado de una chapa densa).
  let bestFit=null, bestGrow=null, tries=0;
  const envMax = ch.maxY||0;
  // presupuesto repartido entre orientaciones: garantiza que TODAS se prueben,
  // incluidas las rotadas (que tienen bbox mayor y quedan al final del orden).
  const viable = [];
  for(let oi=0; oi<oris.length; oi++){
    const o=oris[oi];
    if(o.gw<=GW && o.gh<=GH) viable.push(o);
  }
  if(!viable.length) return null;
  const perOri = Math.max(1200, Math.floor(budget/viable.length));

  for(const o of viable){
    let oTries = 0;
    const maxOX = GW-o.gw;
    // paso adaptativo en X: en modo rápido, resolución más gruesa. En modo
    // "fine" (pulido de una chapa sobrante con pocas piezas) se barre X
    // celda por celda — ahí es donde antes se colaban huecos como el que
    // se ve cuando dos piezas podían quedar pegadas y no quedaban.
    const stepX = fine ? 1 : deep ? Math.max(1, Math.floor(o.gw/22)) : Math.max(1, Math.floor(o.gw/5));
    // OJO — bug real encontrado con datos de producción: minStartY() (el
    // atajo de "skyline") asume que todo lo pintado en una columna arranca
    // sin huecos desde y=0 ("ya apilado hasta tal altura"). Eso vale
    // mientras se arma una chapa de cero (cada pieza nueva realmente apoya
    // sobre lo anterior), pero acá en modo fine se busca un hueco en una
    // chapa YA TERMINADA — y una pieza o una tira ya puesta puede dejar una
    // columna ocupada solo en una franja angosta (arriba del todo, o
    // flotando en el medio, sandwich entre dos piezas) con el resto de esa
    // misma columna realmente libre. minStartY() confunde "hay algo pintado
    // en esta columna en ALGÚN lado" con "está apilado desde el piso", y
    // termina descartando huecos perfectamente válidos (el primer caso real
    // que encontramos era un hueco pegado a y=0; después apareció uno
    // "sandwich", ni arriba del todo ni pegado al final — ninguno de los
    // dos lo agarra un atajo de un solo intento). Por eso en fine se hace
    // un barrido lineal REAL, celda por celda desde oy=0 (fits() acá es
    // baratísimo, unos pocos microsegundos), en vez de confiar en el atajo.
    // Para que una columna sin ninguna chance (bloqueada de punta a punta)
    // no le robe presupuesto a columnas buenas más a la derecha, el freno
    // de presupuesto es un TOTAL amplio para toda la orientación (del
    // tamaño de la grilla, nunca más chico que el budget pedido) en vez de
    // abortar la búsqueda entera a mitad de camino como pasaba antes.
    const fineBudgetTotal = fine ? Math.max(perOri, GW*GH) : perOri;
    // freno de RELOJ además del freno de intentos: en una chapa cercana al
    // tope de 4 millones de celdas, barrer entero sin encontrar nada puede
    // llegar a ~500-600ms (medido) — nada catastrófico, pero es tiempo real
    // de bloqueo si esto corre en el hilo principal (cuando el Worker no
    // está disponible), y `repackSingleChapa` puede llamar esto varias
    // veces seguidas (una por pieza) dentro de un solo intento. Por eso se
    // chequea el reloj cada tantos intentos (no en cada uno, para no pagar
    // el costo de performance.now() de más) y se corta apenas se pasa del
    // tope, devolviendo lo mejor encontrado hasta ese momento.
    const fineTimeCapMs = 300;
    const fineT0 = fine ? performance.now() : 0;
    let abortOri = false;
    for(let ox=0; ox<=maxOX && !abortOri; ox+=stepX){
      let placedY=-1;
      if(fine){
        const maxOyHere = GH - o.gh;
        for(let oy=0; oy<=maxOyHere; oy++){
          oTries++; tries++;
          if(fits(ch,o,ox,oy)){ placedY=oy; break; }
          if(tries>fineBudgetTotal){ abortOri=true; break; }
          if((tries & 8191)===0 && (performance.now()-fineT0)>fineTimeCapMs){ abortOri=true; break; }
        }
      } else {
        const y0 = minStartY(ch, o, ox);
        if(y0 <= GH-o.gh){
          for(let oy=y0; oy<=GH-o.gh; oy++){
            oTries++; tries++;
            if(fits(ch,o,ox,oy)){ placedY=oy; break; }
            if(oTries>perOri) break;
          }
        }
        if(placedY<0 && oTries>perOri) abortOri=true;
      }
      if(placedY<0){ continue; }
      const grows = deep && ((placedY+o.gh) > envMax);
      const score = deep
        ? (placedY*3 + ox*0.6) - contact(ch, o, ox, placedY)*1.7
        : (placedY*10000 + ox);
      if(grows){
        if(!bestGrow || score<bestGrow.score) bestGrow={score, ox, oy:placedY, o};
      } else {
        if(!bestFit || score<bestFit.score) bestFit={score, ox, oy:placedY, o};
        // modo rápido: la primera orientación que apoya en el suelo basta
        if(!deep && placedY===0 && ox===0) return bestFit;
      }
      if(!fine && oTries>perOri) break;
    }
    // modo rápido: no seguir explorando orientaciones si ya hay algo al ras
    if(!deep && bestFit && bestFit.oy===0) break;
  }
  return bestFit || bestGrow;
}

function commitPlacement(ch, o, ox, oy){
  const {GW, occ, skyline} = ch;
  for(let y=0;y<o.gh;y++){
    const spans=o.rows[y];
    if(!spans.length) continue;
    const gy=oy+y, base=gy*GW;
    for(let s=0;s<spans.length;s++){
      for(let x=ox+spans[s][0]; x<=ox+spans[s][1]; x++){
        occ[base+x]=1;
        if(gy+1>skyline[x]) skyline[x]=gy+1;
      }
    }
    ch.dirty[gy]=1;
  }
  if(oy+o.gh > ch.maxY) ch.maxY = oy+o.gh;
}

