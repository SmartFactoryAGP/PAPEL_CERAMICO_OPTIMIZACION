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
  const cells=[];
  const cellSet = pad>0 ? new Set() : null; // para no revisar dos veces una celda ya adentro

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
      for(let gx=gx0; gx<=gx1; gx++){
        cells.push([gx,gy]);
        if(cellSet) cellSet.add(gy*gw+gx);
      }
    }
  }

  if(pad>0){
    // dilatación por kerf: para cada ARISTA del polígono, cualquier celda a
    // distancia <= pad de ella cae, por geometría, DENTRO de la caja
    // delimitadora de esa arista expandida por pad (el segmento "inflado"
    // por un radio pad nunca sobresale más que eso de su propia caja) —
    // así se puede acotar con certeza qué celdas hace falta revisar con la
    // prueba de distancia (cara), sin dejar ninguna afuera, en vez de
    // probarla en el rectángulo completo de la pieza.
    const cand = new Set();
    for(let i=0,j=n-1;i<n;j=i++){
      const [xi,yi]=pts[i], [xj,yj]=pts[j];
      const gxA = Math.max(0, Math.floor((Math.min(xi,xj)-pad-ox)/cell));
      const gxB = Math.min(gw-1, Math.ceil((Math.max(xi,xj)+pad-ox)/cell));
      const gyA = Math.max(0, Math.floor((Math.min(yi,yj)-pad-oy)/cell));
      const gyB = Math.min(gh-1, Math.ceil((Math.max(yi,yj)+pad-oy)/cell));
      for(let gy=gyA; gy<=gyB; gy++){
        for(let gx=gxA; gx<=gxB; gx++){
          const k = gy*gw+gx;
          if(!cellSet.has(k)) cand.add(k);
        }
      }
    }
    cand.forEach(k=>{
      const gy = Math.floor(k/gw), gx = k - gy*gw;
      const cx = ox+(gx+0.5)*cell, cy = oy+(gy+0.5)*cell;
      if(distToPoly(cx, cy, pts) <= pad) cells.push([gx,gy]);
    });
  }
  // desplazamiento real del polígono respecto a la esquina de su máscara
  return {cells, gw, gh, offX: bb.minx-ox, offY: bb.miny-oy};
}
function cellsToRowSpans(cells, gw, gh){
  const rows = new Array(gh);
  for(let y=0;y<gh;y++) rows[y]=null;
  const byRow = new Array(gh);
  for(let y=0;y<gh;y++) byRow[y]=[];
  for(const [x,y] of cells) byRow[y].push(x);
  let total=0;
  for(let y=0;y<gh;y++){
    const xs = byRow[y];
    if(!xs.length){ rows[y]=[]; continue; }
    xs.sort((a,b)=>a-b);
    const spans=[];
    let s=xs[0], prev=xs[0];
    for(let i=1;i<xs.length;i++){
      if(xs[i]===prev+1){ prev=xs[i]; continue; }
      spans.push([s,prev]); s=xs[i]; prev=xs[i];
    }
    spans.push([s,prev]);
    rows[y]=spans;
    total += xs.length;
  }
  return {rows, total};
}
