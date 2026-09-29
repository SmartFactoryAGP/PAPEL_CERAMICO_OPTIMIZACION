/* =========================================================
   PARSER DXF MÍNIMO
   ========================================================= */
function parseDXFEntities(text){
  const lines = text.split(/\r\n|\r|\n/);
  const pairs = [];
  for(let i=0;i+1<lines.length;i+=2) pairs.push([parseInt(lines[i].trim(),10), lines[i+1]]);
  const entities=[]; let inEnt=false; let i=0;
  const TYPES = ['LWPOLYLINE','POLYLINE','LINE','ARC','CIRCLE','SPLINE','ELLIPSE'];
  while(i<pairs.length){
    const [code,val] = pairs[i];
    const v = (val||'').trim();
    if(code===0 && v==='SECTION'){
      const nxt = pairs[i+1];
      if(nxt && nxt[0]===2 && (nxt[1]||'').trim()==='ENTITIES'){ inEnt=true; i+=2; continue; }
    }
    if(code===0 && v==='ENDSEC'){ inEnt=false; i++; continue; }
    if(inEnt && code===0 && TYPES.includes(v)){
      let j=i+1; const raw=[]; let layer='0';
      // POLYLINE clásico: absorbe sus VERTEX hasta SEQEND
      if(v==='POLYLINE'){
        while(j<pairs.length){
          const [c2,v2]=pairs[j]; const s2=(v2||'').trim();
          if(c2===0 && s2==='SEQEND'){ j++; break; }
          if(c2===8 && raw.length===0) layer=(v2||'0').trim() || '0';
          raw.push(pairs[j]); j++;
        }
      } else {
        while(j<pairs.length && pairs[j][0]!==0){
          if(pairs[j][0]===8) layer=(pairs[j][1]||'0').trim() || '0';
          raw.push(pairs[j]); j++;
        }
      }
      entities.push({type:v, raw, layer});
      i=j; continue;
    }
    i++;
  }
  return entities;
}
function bulgeToPoints(p1,p2,bulge){
  const theta = 4*Math.atan(bulge);
  const [x1,y1]=p1,[x2,y2]=p2;
  const dx=x2-x1, dy=y2-y1;
  const chord=Math.hypot(dx,dy);
  if(chord<1e-9 || Math.abs(bulge)<1e-9) return [p2];
  const rSigned = chord/(2*Math.sin(theta/2));
  const baseAngle = Math.atan2(dy,dx);
  const a = baseAngle + (Math.PI/2 - theta/2);
  const cx = x1 + rSigned*Math.cos(a);
  const cy = y1 + rSigned*Math.sin(a);
  const radius = Math.abs(rSigned);
  let a1 = Math.atan2(y1-cy, x1-cx);
  let a2 = Math.atan2(y2-cy, x2-cx);
  if(bulge>0){ while(a2<a1) a2+=2*Math.PI; } else { while(a2>a1) a2-=2*Math.PI; }
  const n=Math.max(3, Math.ceil(Math.abs(a2-a1)/(Math.PI/16)));
  const pts=[];
  for(let k=1;k<=n;k++){ const t=a1+(a2-a1)*k/n; pts.push([cx+radius*Math.cos(t), cy+radius*Math.sin(t)]); }
  return pts;
}
function entityToGeom(ent){
  if(ent.type==='LWPOLYLINE' || ent.type==='POLYLINE'){
    // una POLYLINE clásica trae su propia cabecera (con un posible 10/20/30
    // de referencia interna, que NO es un vértice) antes del primer VERTEX
    // real — antes se leía todo en una sola bolsa y ese punto de cabecera
    // se colaba como si fuera el primer punto de la forma (por eso todas
    // las polilíneas "empezaban" en el mismo (0,0) fantasma).
    const isLW = ent.type==='LWPOLYLINE';
    let closed=false, vertices=[], curV=null;
    let inHeader = !isLW; // LWPOLYLINE no tiene sub-entidades VERTEX aparte
    for(const [code,val] of ent.raw){
      const v=(val||'').trim();
      if(code===0 && v==='VERTEX'){ inHeader=false; curV=null; continue; }
      if(inHeader){
        if(code===70) closed=(parseInt(v)&1)===1;
        continue; // cualquier 10/20/30 de la cabecera se ignora a propósito
      }
      if(code===70 && isLW) closed=(parseInt(v)&1)===1;
      else if(code===10){ curV={x:parseFloat(v)}; vertices.push(curV); }
      else if(code===20){ if(curV) curV.y=parseFloat(v); }
      else if(code===42){ if(curV) curV.bulge=parseFloat(v); }
      // el 70 dentro de un VERTEX de POLYLINE clásica es la bandera del
      // vértice (no "cerrada") — se ignora a propósito, no corresponde acá.
    }
    vertices = vertices.filter(v=>isFinite(v.x)&&isFinite(v.y));
    let pts=[];
    for(let k=0;k<vertices.length;k++){
      const v=vertices[k]; pts.push([v.x,v.y]);
      const bulge=v.bulge||0;
      const hasNext = k<vertices.length-1 || closed;
      if(bulge!==0 && hasNext){
        const nv = vertices[(k+1)%vertices.length];
        const arcPts = bulgeToPoints([v.x,v.y],[nv.x,nv.y],bulge);
        pts.push(...arcPts.slice(0,-1));
      }
    }
    return {type:'loop', closed, pts};
  }
  if(ent.type==='LINE'){
    let p1=[0,0],p2=[0,0];
    for(const [code,val] of ent.raw){ const v=parseFloat(val);
      if(code===10)p1[0]=v; else if(code===20)p1[1]=v; else if(code===11)p2[0]=v; else if(code===21)p2[1]=v; }
    return {type:'segment', p1, p2};
  }
  if(ent.type==='ARC'){
    let cx=0,cy=0,r=0,a1=0,a2=0;
    for(const [code,val] of ent.raw){ const v=parseFloat(val);
      if(code===10)cx=v; else if(code===20)cy=v; else if(code===40)r=v; else if(code===50)a1=v; else if(code===51)a2=v; }
    if(a2<a1) a2+=360;
    const n=Math.max(4, Math.ceil((a2-a1)/6));
    const pts=[];
    for(let k=0;k<=n;k++){ const a=(a1+(a2-a1)*k/n)*Math.PI/180; pts.push([cx+r*Math.cos(a), cy+r*Math.sin(a)]); }
    return {type:'open', pts};
  }
  if(ent.type==='CIRCLE'){
    let cx=0,cy=0,r=0;
    for(const [code,val] of ent.raw){ const v=parseFloat(val);
      if(code===10)cx=v; else if(code===20)cy=v; else if(code===40)r=v; }
    const pts=[];
    for(let k=0;k<64;k++){ const a=k/64*2*Math.PI; pts.push([cx+r*Math.cos(a), cy+r*Math.sin(a)]); }
    return {type:'loop', closed:true, pts};
  }
  if(ent.type==='ELLIPSE'){
    let cx=0,cy=0,mx=0,my=0,ratio=1,s=0,e=2*Math.PI;
    for(const [code,val] of ent.raw){ const v=parseFloat(val);
      if(code===10)cx=v; else if(code===20)cy=v; else if(code===11)mx=v; else if(code===21)my=v;
      else if(code===40)ratio=v; else if(code===41)s=v; else if(code===42)e=v; }
    const A=Math.hypot(mx,my), B=A*ratio, rot=Math.atan2(my,mx);
    if(e<=s) e=s+2*Math.PI;
    const n=64, pts=[];
    for(let k=0;k<=n;k++){
      const t=s+(e-s)*k/n;
      const x=A*Math.cos(t), y=B*Math.sin(t);
      pts.push([cx + x*Math.cos(rot)-y*Math.sin(rot), cy + x*Math.sin(rot)+y*Math.cos(rot)]);
    }
    const closed = Math.abs((e-s)-2*Math.PI)<1e-6;
    return closed ? {type:'loop', closed:true, pts} : {type:'open', pts};
  }
  if(ent.type==='SPLINE'){
    const fit=[], ctrl=[]; let cf=null, cc=null;
    for(const [code,val] of ent.raw){ const v=parseFloat(val);
      if(code===11){ cf={x:v}; fit.push(cf); } else if(code===21){ if(cf) cf.y=v; }
      else if(code===10){ cc={x:v}; ctrl.push(cc); } else if(code===20){ if(cc) cc.y=v; } }
    const src = fit.length ? fit : ctrl;
    return {type:'open', pts: src.filter(p=>isFinite(p.x)&&isFinite(p.y)).map(p=>[p.x,p.y])};
  }
  return null;
}
function closeEnough(a,b,eps){ return Math.hypot(a[0]-b[0],a[1]-b[1]) < eps; }
function chainSegments(segs, eps){
  const used = new Array(segs.length).fill(false);
  const key = p => Math.round(p[0]/eps)+","+Math.round(p[1]/eps);
  const map = new Map();
  const add=(k,o)=>{ if(!map.has(k)) map.set(k,[]); map.get(k).push(o); };
  segs.forEach((s,i)=>{ add(key(s.p1),{i,end:0}); add(key(s.p2),{i,end:1}); });
  const loops=[];
  for(let i=0;i<segs.length;i++){
    if(used[i]) continue;
    used[i]=true;
    let chain=[segs[i].p1, segs[i].p2];
    let extended=true, guard=0;
    while(extended && guard++<20000){
      extended=false;
      const cands = map.get(key(chain[chain.length-1]))||[];
      for(const c of cands){
        if(used[c.i]) continue;
        const seg=segs[c.i];
        used[c.i]=true; chain.push(c.end===0 ? seg.p2 : seg.p1); extended=true; break;
      }
    }
    if(chain.length>=3 && closeEnough(chain[0], chain[chain.length-1], eps*2)) loops.push(chain);
  }
  return loops;
}
/* Contornos cerrados a partir de geometrías sueltas: lo que ya viene
   cerrado se usa tal cual, y todo lo abierto (líneas, arcos, polilíneas
   sin cerrar) se encadena por extremos para ver si forma algún cierre. */
function geomsToClosedLoops(geoms){
  const loops = [], soup = [];
  geoms.forEach(g=>{
    if(g.type==='loop'){
      if(g.closed || closeEnough(g.pts[0], g.pts[g.pts.length-1], 0.5)) loops.push(g.pts);
      else for(let k=0;k<g.pts.length-1;k++) soup.push({p1:g.pts[k],p2:g.pts[k+1]});
    } else if(g.type==='segment'){
      soup.push({p1:g.p1,p2:g.p2});
    } else if(g.type==='open'){
      for(let k=0;k<g.pts.length-1;k++) soup.push({p1:g.pts[k],p2:g.pts[k+1]});
    }
  });
  loops.push(...chainSegments(soup, 0.5));
  return loops;
}

/* ============ Bloque 4: capas por tipo de operación (Corte / Grabado) ============
   Antes el lector juntaba TODAS las entidades sin importar la capa y se
   quedaba con el contorno cerrado más grande, tirando todo lo demás. Ahora,
   si el DXF tiene más de una capa, se le pregunta al usuario qué es cada
   una antes de armar la pieza — si solo tiene una (o "0"), se sigue
   comportando exactamente igual que siempre. */

/* Nombres de capa distintos que aparecen en el archivo, en orden de aparición. */
function detectLayers(entities){
  const seen = [];
  entities.forEach(e=>{ if(!seen.includes(e.layer)) seen.push(e.layer); });
  return seen;
}
/* Adivina Corte/Grabado por el nombre de la capa, para dejar la opción ya
   marcada como más probable — el usuario siempre puede cambiarla a mano. */
function guessLayerOp(layerName){
  const n = (layerName||'').toUpperCase();
  // cotas/anotaciones: casi nunca hay que cortarlas — si se cuelan como
  // "corte" pueden aparecer como agujeros falsos donde había una medida o
  // una flecha de cota, no una pieza real.
  if(/^DEFPOINTS$|^DIM|DIMENSION|^COTA|ANOT|NOTA|^TEXT/.test(n)) return 'ignore';
  if(/GRAB|ENGRAVE|RAY|SCORE|MARK|HEND|CREASE/.test(n)) return 'engrave';
  return 'cut';
}
/* Arma la geometría final a partir de un mapeo capa -> 'cut'|'engrave'|'ignore'.
   El contorno más grande entre las capas 'cut' define la pieza para el
   nesting, igual que siempre. Lo marcado 'engrave' queda guardado aparte,
   en las MISMAS coordenadas locales de la pieza (ya realineado al origen
   del contorno de corte), para viajar con ella cuando rote/se ubique y
   salir en su propia capa en el DXF final. */
function buildLayeredGeometry(entities, layerMap){
  const cutGeoms = [], engravePaths = [];
  entities.forEach(ent=>{
    const op = layerMap[ent.layer] || 'cut';
    if(op==='ignore') return;
    const g = entityToGeom(ent);
    if(!g) return;
    if(op==='cut'){
      cutGeoms.push(g);
    } else {
      // el grabado NO tiene por qué ser un contorno cerrado (una línea de
      // marcado suele ser abierta) — se guarda tal cual viene, sin exigirle
      // que cierre como al contorno de corte.
      const pts = g.type==='segment' ? [g.p1, g.p2] : g.pts;
      if(pts && pts.length>=2) engravePaths.push(pts);
    }
  });

  // el contorno de corte sí tiene que cerrar, como siempre: encadena lo
  // suelto y se queda con el más grande entre lo que forme un cierre.
  const cutLoops = geomsToClosedLoops(cutGeoms);
  if(!cutLoops.length) return null;
  cutLoops.sort((a,b)=>polyArea(b)-polyArea(a));
  const bb = polyBBox(cutLoops[0]);
  const mainPoly = normalize(cutLoops[0]);
  // el grabado se deja en las MISMAS coordenadas que el contorno de corte
  // ya normalizado (restando el mismo origen), así queda alineado con la
  // pieza sin importar dónde estuviera dibujado en el DXF original.
  const engraveLoops = engravePaths.map(path => path.map(([x,y])=>[x-bb.minx, y-bb.miny]));
  // agujeros interiores: cualquier otro contorno cerrado que haya quedado
  // ADENTRO del contorno principal (probando su primer punto con
  // punto-en-polígono) se guarda como hueco, no se descarta — piezas con
  // agujeros/ranuras son comunes de verdad (paneles perforados, tornillería).
  // Se descartan los de área ridículamente chica (<2mm²): son ruido de
  // teselar arcos/cotas, no un agujero que alguien vaya a cortar de verdad.
  const MIN_HOLE_AREA = 2; // mm²
  const holes = [];
  for(let i=1;i<cutLoops.length;i++){
    const loop = cutLoops[i];
    if(polyArea(loop) < MIN_HOLE_AREA) continue;
    if(pip(loop[0][0], loop[0][1], cutLoops[0])){
      holes.push(loop.map(([x,y])=>[x-bb.minx, y-bb.miny]));
    }
  }
  return { mainPoly, engraveLoops, holes };
}
