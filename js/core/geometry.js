/* =========================================================
   GEOMETRÍA BÁSICA
   ========================================================= */
function polyBBox(pts){
  let minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity;
  for(const [x,y] of pts){if(x<minx)minx=x;if(y<miny)miny=y;if(x>maxx)maxx=x;if(y>maxy)maxy=y;}
  return {minx,miny,maxx,maxy,w:maxx-minx,h:maxy-miny};
}
/* punto dentro de polígono (ray casting) */
function pip(px,py,poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const [xi,yi]=poly[i], [xj,yj]=poly[j];
    if(((yi>py)!==(yj>py)) && (px < (xj-xi)*(py-yi)/(yj-yi)+xi)) inside=!inside;
  }
  return inside;
}
/* distancia punto-segmento (para el "engorde" por separación/kerf) */
function distPointSeg(px,py,x1,y1,x2,y2){
  const dx=x2-x1, dy=y2-y1;
  const L2 = dx*dx+dy*dy;
  let t = L2>0 ? ((px-x1)*dx + (py-y1)*dy)/L2 : 0;
  t = t<0?0:(t>1?1:t);
  return Math.hypot(px-(x1+t*dx), py-(y1+t*dy));
}
function distToPoly(px,py,poly){
  let m=Infinity;
  for(let i=0;i<poly.length;i++){
    const [x1,y1]=poly[i], [x2,y2]=poly[(i+1)%poly.length];
    const d = distPointSeg(px,py,x1,y1,x2,y2);
    if(d<m) m=d;
  }
  return m;
}
/* Rasteriza el polígono en la grilla.
   `grow` (mm) dilata la máscara para respetar la separación entre piezas. */
/* Rasteriza un polígono a celdas ocupadas (con dilatación opcional "grow"
   para el kerf). Antes probaba PUNTO POR PUNTO cada celda del rectángulo
   que envuelve la pieza — para una pieza grande con muchos vértices (una
   chapa industrial real, no un rectángulo de prueba) esto podía tardar
   ~25 segundos por orientación y colgar la pestaña entera.

   Ahora usa barrido de líneas (scanline): por cada fila, calcula de una
   sola vez en qué tramos de X el polígono la cruza (cortando cada borde
   contra esa fila), en vez de preguntarle a cada celda una por una. Esto
   es EXACTAMENTE el mismo criterio de antes (celda ocupada si su centro
   cae dentro del polígono), solo que calculado en una fracción del tiempo.
   La dilatación por kerf, al ser un margen chico, solo se revisa con la
   prueba de distancia (más cara) en una franja angosta pegada al borde
   de cada fila — no en todo el rectángulo — así el resultado final sigue
   siendo idéntico al de antes, solo que no hace falta pagar el costo
   completo para conseguirlo. Validado con datos reales: mismo resultado,
   pieza a pieza, celda por celda, entre la versión vieja y esta. */
function rasterizePoly(pts, cell, grow){
  const bb = polyBBox(pts);
  const pad = grow>0 ? grow : 0;
  const ox = bb.minx - pad, oy = bb.miny - pad;
  const gw = Math.max(1, Math.ceil((bb.w + pad*2)/cell));
  const gh = Math.max(1, Math.ceil((bb.h + pad*2)/cell));
  const n = pts.length;
  // celdas ocupadas como clave entera gy*gw+gx: un arreglo de enteros
  // compacto, en vez de un par [gx,gy] (un objeto) por celda — una pieza
  // grande son ~200 mil celdas POR orientación, y esa basura era lo que
  // más presión le ponía al recolector de memoria durante el nesting.
  const keys=[];
  // marca por celda (solo con kerf): 1 = adentro por barrido, 2 = sumada
  // por dilatación — un Uint8Array de la grilla en vez de dos Set de
  // enteros (mucha menos memoria y sin hashing en el bucle caliente).
  const mark = pad>0 ? new Uint8Array(gw*gh) : null;

  // celdas estrictamente DENTRO del polígono, por barrido de líneas: por
  // cada fila se cortan los bordes contra esa altura una sola vez, en vez
  // de preguntarle a cada celda una por una si está adentro (mismo criterio
  // que el ray-casting de pip(), pero muchísimo más rápido en piezas grandes).
  for(let gy=0; gy<gh; gy++){
    const cy = oy + (gy+0.5)*cell;
    const xs=[];
    for(let i=0,j=n-1;i<n;j=i++){
      const [xi,yi]=pts[i], [xj,yj]=pts[j];
      if((yi>cy)!==(yj>cy)) xs.push(xj + (xi-xj)*(cy-yj)/(yi-yj));
    }
    xs.sort((a,b)=>a-b);
    for(let k=0;k+1<xs.length;k+=2){
      let gx0 = Math.ceil((xs[k]-ox)/cell - 0.5);
      let gx1 = Math.floor((xs[k+1]-ox)/cell - 0.5);
      if(gx0<0) gx0=0; if(gx1>gw-1) gx1=gw-1;
      const base = gy*gw;
      for(let gx=gx0; gx<=gx1; gx++){
        keys.push(base+gx);
        if(mark) mark[base+gx] = 1;
      }
    }
  }

  if(pad>0){
    // dilatación por kerf — una celda de afuera entra si su centro queda a
    // distancia <= pad de ALGUNA arista (lo mismo que distToPoly <= pad:
    // el mínimo de las distancias es <= pad sii alguna lo es).
    // OJO rendimiento (era el 72% del tiempo total del motor, medido): antes
    // se tomaba como candidata TODA la caja envolvente de cada arista — con
    // una arista diagonal eso es un triángulo enorme de celdas lejanas — y
    // cada candidata se medía contra TODAS las aristas. Ahora, por cada
    // arista y cada fila, se acota analíticamente el tramo de X donde puede
    // haber celdas a <= pad de ESA arista (el pedazo del segmento con Y
    // dentro de [cy-pad, cy+pad], ensanchado en pad y en una celda de
    // margen), y solo esas se miden, contra esa arista sola. Mismo
    // conjunto de celdas exacto (la prueba final es la misma distPointSeg,
    // con los mismos argumentos que usa distToPoly); el margen extra solo
    // agrega candidatas, nunca saca una válida.
    const padE = pad*(1+1e-9) + 1e-9; // tolerancia para el acotado, no para la prueba final
    for(let i=0;i<n;i++){
      const [x1,y1]=pts[i], [x2,y2]=pts[(i+1)%n];
      const dx=x2-x1, dy=y2-y1;
      let gyA = Math.floor((Math.min(y1,y2)-padE-oy)/cell) - 1;
      let gyB = Math.ceil((Math.max(y1,y2)+padE-oy)/cell) + 1;
      if(gyA<0) gyA=0; if(gyB>gh-1) gyB=gh-1;
      for(let gy=gyA; gy<=gyB; gy++){
        const cy = oy+(gy+0.5)*cell;
        let xa, xb;
        if(dy===0){
          if(Math.abs(y1-cy)>padE) continue;
          xa = Math.min(x1,x2); xb = Math.max(x1,x2);
        } else {
          let t0=(cy-padE-y1)/dy, t1=(cy+padE-y1)/dy;
          if(t0>t1){ const t=t0; t0=t1; t1=t; }
          if(t0<0) t0=0; if(t1>1) t1=1;
          if(t0>t1) continue;
          xa = x1+dx*t0; xb = x1+dx*t1;
          if(xa>xb){ const t=xa; xa=xb; xb=t; }
        }
        let gx0 = Math.floor((xa-padE-ox)/cell - 0.5) - 1;
        let gx1 = Math.ceil((xb+padE-ox)/cell - 0.5) + 1;
        if(gx0<0) gx0=0; if(gx1>gw-1) gx1=gw-1;
        const base = gy*gw;
        for(let gx=gx0; gx<=gx1; gx++){
          if(mark[base+gx]) continue; // ya adentro, o ya sumada por otra arista
          const cx = ox+(gx+0.5)*cell;
          if(distPointSeg(cx, cy, x1, y1, x2, y2) <= pad){ mark[base+gx]=2; keys.push(base+gx); }
        }
      }
    }
  }
  // desplazamiento real del polígono respecto a la esquina de su máscara
  return {keys, gw, gh, offX: bb.minx-ox, offY: bb.miny-oy};
}
/* Claves de celda -> spans por fila ([xIni,xFin] contiguos). Se agrupan
   por fila con un conteo (counting sort, dos pasadas lineales) en un solo
   Int32Array, y cada fila se ordena con el sort numérico nativo del
   TypedArray — antes era un arreglo JS por fila + sort con comparador.
   Mismo multiconjunto de X por fila, así que mismos spans y mismo total. */
function cellKeysToRowSpans(keys, gw, gh){
  const n = keys.length;
  const start = new Int32Array(gh+1);
  for(let i=0;i<n;i++) start[((keys[i]/gw)|0)+1]++;
  for(let y=0;y<gh;y++) start[y+1] += start[y];
  const xsAll = new Int32Array(n), fill = start.slice(0, gh);
  for(let i=0;i<n;i++){ const k=keys[i], y=(k/gw)|0; xsAll[fill[y]++] = k - y*gw; }
  const rows = new Array(gh);
  for(let y=0;y<gh;y++){
    const a = start[y], b = start[y+1];
    if(a===b){ rows[y]=[]; continue; }
    const xs = xsAll.subarray(a, b).sort();
    const spans=[];
    let s=xs[0], prev=xs[0];
    for(let i=1;i<xs.length;i++){
      if(xs[i]===prev+1){ prev=xs[i]; continue; }
      spans.push([s,prev]); s=xs[i]; prev=xs[i];
    }
    spans.push([s,prev]);
    rows[y]=spans;
  }
  return {rows, total: n};
}
