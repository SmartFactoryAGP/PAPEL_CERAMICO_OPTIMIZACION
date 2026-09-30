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
  const cov = o._cov || (o._cov = contactSelfCover(o));
  let touch=0;
  for(let y=0;y<o.gh;y++){
    const spans=rows[y];
    if(!spans.length) continue;
    const gy=oy+y, base=cov.off[y];
    for(let s=0;s<spans.length;s++){
      const x0=ox+spans[s][0], x1=ox+spans[s][1];
      // laterales del span
      if(x0===0) touch+=2; else if(rowOccupied(ch,gy,x0-1,x0-1)) touch++;
      if(x1===GW-1) touch+=2; else if(rowOccupied(ch,gy,x1+1,x1+1)) touch++;
      // abajo: sólo cuenta donde la propia pieza no se tapa a sí misma
      if(gy===0) touch += (x1-x0+1)*2;
      else if(cov.below[base+s]) touch += rowCount(ch, gy-1, x0, x1);
      // arriba
      if(gy===GH-1) touch += (x1-x0+1)*2;
      else if(cov.above[base+s]) touch += rowCount(ch, gy+1, x0, x1);
    }
  }
  return touch;
}
/* Para cada span de cada fila de una orientación: ¿la propia pieza lo
   deja al descubierto por debajo / por arriba? (si lo tapa entero, ese
   lado no puede tocar a nadie). Antes contact() lo recalculaba con
   spanOverlap en CADA posición probada — pero no depende de la posición:
   con los dos spans corridos en el mismo ox, el solapamiento es
   min(b1,s1)-max(b0,s0)+1 igual, ox se cancela. Se calcula una sola vez
   por orientación y queda guardado en ella (o._cov). Medido: contact()
   era ~19% del tiempo total del motor. Todo en dos Uint8Array planos (un
   byte por span) + el offset de cada fila, no un arreglo por fila: cada
   TypedArray suelto pesa ~100 bytes de más, y una pieza grande tiene
   cientos de filas por orientación. */
function contactSelfCover(o){
  const rows=o.rows, off=new Int32Array(o.gh+1);
  for(let y=0;y<o.gh;y++) off[y+1] = off[y] + rows[y].length;
  const below=new Uint8Array(off[o.gh]), above=new Uint8Array(off[o.gh]);
  for(let y=0;y<o.gh;y++){
    const spans=rows[y], b=rows[y-1], a=rows[y+1];
    for(let s=0;s<spans.length;s++){
      const len = spans[s][1]-spans[s][0]+1;
      below[off[y]+s] = (!b || spanOverlap(b, 0, spans[s][0], spans[s][1]) < len) ? 1 : 0;
      above[off[y]+s] = (!a || spanOverlap(a, 0, spans[s][0], spans[s][1]) < len) ? 1 : 0;
    }
  }
  return {off, below, above};
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
function minStartY(ch, o, ox, skyMax){
  let maxNeed = 0;
  for(let y=0;y<o.gh;y++){
    const spans=o.rows[y];
    for(let s=0;s<spans.length;s++){
      // máximo del skyline en todo el span de una sola consulta O(1) a la
      // sparse table, en vez de recorrerlo celda por celda (mismo valor:
      // max(sky)-y). Va escrito acá adentro (no llamando a skylineMax)
      // porque este es el bucle más caliente del modo rápido.
      const a = ox+spans[s][0], b = ox+spans[s][1];
      const k = 31 - Math.clz32(b-a+1), L = skyMax[k];
      const m1 = L[a], m2 = L[b-(1<<k)+1];
      const need = (m1>m2 ? m1 : m2) - y;
      if(need>maxNeed) maxNeed=need;
    }
  }
  return maxNeed<0?0:maxNeed;
}
/* Sparse table de máximos del skyline: nivel k guarda el máximo de cada
   tramo de 2^k columnas. Se arma una vez por findBestPlacement (el
   skyline no cambia mientras se busca, recién al commitear) y después
   cualquier "máximo entre la columna a y la b" sale en O(1) (ver
   minStartY: nivel k = log2 del largo, y dos tramos que se pisan). */
function buildSkylineMax(ch){
  const n=ch.GW, levels=[ch.skyline];
  for(let k=1; (1<<k)<=n; k++){
    const prev=levels[k-1], h=1<<(k-1), len=n-(1<<k)+1, cur=new Int32Array(len);
    for(let i=0;i<len;i++){ const a=prev[i], b=prev[i+h]; cur[i] = a>b ? a : b; }
    levels.push(cur);
  }
  return levels;
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
  const skyMax = fine ? null : buildSkylineMax(ch); // solo el modo no-fine usa minStartY

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
        const y0 = minStartY(ch, o, ox, skyMax);
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

