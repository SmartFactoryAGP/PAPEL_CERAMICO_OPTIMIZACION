/* =========================================================
   EDITOR DE ARCHIVOS — lógica (sin DOM salvo un par de toggles de botón)
   =========================================================
   Modelo: una lista de FORMAS (repairState.entities), cada una con sus
   propios puntos y si está cerrada o no. Antes esto era una "sopa" de
   líneas sueltas (bueno para detectar puntos abiertos, pero no permitía
   mover/agregar/borrar nada con sentido) — ahora cada forma es una unidad:
   se puede seleccionar, mover entera, o editar punto por punto, y se
   pueden crear formas nuevas desde cero (línea, rectángulo, círculo,
   polilínea). La detección de puntos abiertos (para reparar) sigue
   funcionando igual que antes, solo que ahora mirando arista por arista
   de cada forma en vez de una lista plana. ========================================================= */
const MERGE_EPS = 0.05; // qué tan cerca tienen que estar dos extremos para contarlos como "el mismo punto"
const repairState = {
  entities: [],        // [{id, points:[[x,y],...], closed:bool}]
  history: [],
  manualFirst: null,   // punto elegido para "reparar puntos abiertos" (unir a mano)
  selectedId: null,    // forma seleccionada (para moverla entera o borrarla)
  tool: 'select',      // 'select' | 'repair' | 'addPoint' | 'delPoint' | 'line' | 'rect' | 'circle' | 'polyline'
  drawBuffer: [],       // puntos que se van juntando mientras se dibuja una forma nueva
  view: {scale:1, offX:0, offY:0, h:0},
  fileBase: 'reparado',
  nextId: 1
};
function repairNewId(){ return 'e'+(repairState.nextId++); }

function repairGeomToPtsInfo(g){
  if(g.type==='segment') return {pts:[g.p1,g.p2], closed:false};
  if(g.type==='loop') return {pts:g.pts, closed: g.closed || closeEnough(g.pts[0], g.pts[g.pts.length-1], 0.5)};
  if(g.type==='open') return {pts:g.pts, closed:false};
  return null;
}
function repairParseDXF(text){
  const rawEntities = parseDXFEntities(text);
  const entities = [];
  rawEntities.forEach(ent=>{
    const g = entityToGeom(ent);
    if(!g) return;
    const info = repairGeomToPtsInfo(g);
    if(!info || !info.pts || info.pts.length<2) return;
    let pts = info.pts.map(p=>p.slice());
    // si venía "cerrada" con el primer punto repetido al final, se saca
    // ese duplicado — closed=true ya implica la arista de cierre sola.
    if(info.closed && pts.length>2 && closeEnough(pts[0], pts[pts.length-1], 1e-6)) pts = pts.slice(0,-1);
    entities.push({ id: repairNewId(), points: pts, closed: info.closed });
  });
  return entities;
}

function repairEntityEdges(ent){
  const pts = ent.points, n = pts.length, edges=[];
  for(let i=0;i<n-1;i++) edges.push([pts[i], pts[i+1], i]);
  if(ent.closed && n>=3) edges.push([pts[n-1], pts[0], n-1]);
  return edges;
}
/* Puntos de grado impar (aparecen una cantidad impar de veces entre todas
   las aristas de todas las formas): son justo los que no tienen con qué
   cerrar el contorno. */
function repairFindDangling(){
  const key = p => Math.round(p[0]/MERGE_EPS)+","+Math.round(p[1]/MERGE_EPS);
  const deg = new Map();
  const bump = p=>{ const k=key(p); if(!deg.has(k)) deg.set(k,{count:0,point:p}); deg.get(k).count++; };
  repairState.entities.forEach(ent=> repairEntityEdges(ent).forEach(([a,b])=>{ bump(a); bump(b); }) );
  const dangling=[];
  deg.forEach(v=>{ if(v.count%2===1) dangling.push(v.point); });
  return dangling;
}
function repairPushHistory(){
  repairState.history.push(repairState.entities.map(e=>({id:e.id, closed:e.closed, points:e.points.map(p=>p.slice())})));
  if(repairState.history.length>50) repairState.history.shift();
  const btn = document.getElementById('repairUndoBtn'); if(btn) btn.disabled=false;
}
function repairSnapPoint(from, to){
  const key = p=>Math.round(p[0]/MERGE_EPS)+","+Math.round(p[1]/MERGE_EPS);
  const k = key(from);
  repairState.entities.forEach(ent=>{
    ent.points.forEach(p=>{ if(key(p)===k){ p[0]=to[0]; p[1]=to[1]; } });
  });
}
// OJO: encontrado en revisión — este es el mismo patrón que congelaba la
// pestaña en buildOrientations (bucle sync, sin ceder el hilo, con costo
// O(n²) sobre "n" = cantidad de puntos sueltos). Acá "n" lo pone el DXF
// que suba la persona: un archivo realmente desordenado (muchos bordes
// abiertos) puede tener miles de puntos sueltos, y 1000² ya es un millón
// de comparaciones. No es tan grave como el bug viejo (esto lo dispara la
// persona con un clic, no corre solo), pero por las dudas queda igual de
// protegido: ahora es async y cede el hilo cada tantas vueltas.
async function repairAutoFix(){
  const tol = Math.max(0, parseFloat(document.getElementById('repairTol').value)||0);
  const dangling = repairFindDangling();
  if(!dangling.length) return 0;
  repairPushHistory();
  const used = new Array(dangling.length).fill(false);
  let fixed=0;
  let sinCeder=0;
  for(let i=0;i<dangling.length;i++){
    if(used[i]) continue;
    let bestJ=-1, bestD=Infinity;
    for(let j=0;j<dangling.length;j++){
      if(j===i||used[j]) continue;
      const d = Math.hypot(dangling[i][0]-dangling[j][0], dangling[i][1]-dangling[j][1]);
      if(d<bestD){ bestD=d; bestJ=j; }
    }
    if(bestJ>=0 && bestD<=tol){
      repairSnapPoint(dangling[bestJ], dangling[i]);
      used[i]=true; used[bestJ]=true; fixed++;
    }
    sinCeder++;
    if(sinCeder>=200){ sinCeder=0; await new Promise(res=>setTimeout(res,0)); }
  }
  if(!fixed) repairState.history.pop(); // no hizo falta, no ensucia el historial de deshacer
  return fixed;
}

/* ============ edición directa (nuevo) ============ */
function repairFindEntity(id){ return repairState.entities.find(e=>e.id===id) || null; }
function repairMoveVertex(entityId, vertexIndex, newPoint){
  const ent = repairFindEntity(entityId);
  if(!ent || !ent.points[vertexIndex]) return;
  ent.points[vertexIndex] = [newPoint[0], newPoint[1]];
}
function repairMoveEntity(entityId, dx, dy){
  const ent = repairFindEntity(entityId);
  if(!ent) return;
  ent.points = ent.points.map(([x,y])=>[x+dx, y+dy]);
}
/* Agrega un vértice nuevo en el medio de una arista existente (edgeIndex
   es el índice del PRIMER punto de esa arista). */
function repairAddVertexOnEdge(entityId, edgeIndex, point){
  const ent = repairFindEntity(entityId);
  if(!ent) return;
  ent.points.splice(edgeIndex+1, 0, [point[0], point[1]]);
}
/* Borra un vértice — si la forma queda con muy pocos puntos para seguir
   siendo una forma (2 si es abierta, 3 si es cerrada), se borra entera
   en vez de dejarla en un estado que no representa nada. */
function repairDeleteVertex(entityId, vertexIndex){
  const ent = repairFindEntity(entityId);
  if(!ent) return;
  ent.points.splice(vertexIndex, 1);
  const minPts = ent.closed ? 3 : 2;
  if(ent.points.length < minPts) repairDeleteEntity(entityId);
}
function repairDeleteEntity(entityId){
  repairState.entities = repairState.entities.filter(e=>e.id!==entityId);
  if(repairState.selectedId===entityId) repairState.selectedId=null;
}
/* Agrega una forma nueva (dibujada desde cero) y la deja seleccionada. */
function repairAddEntity(points, closed){
  const id = repairNewId();
  repairState.entities.push({ id, points: points.map(p=>p.slice()), closed: !!closed });
  repairState.selectedId = id;
  return id;
}
/* Aproxima un círculo como un polígono cerrado de muchos lados — se edita
   y se exporta igual que cualquier otra forma. */
function repairCirclePoints(center, radiusPoint, segments){
  segments = segments || 48;
  const r = Math.hypot(radiusPoint[0]-center[0], radiusPoint[1]-center[1]);
  const pts = [];
  for(let i=0;i<segments;i++){
    const a = (i/segments)*Math.PI*2;
    pts.push([center[0]+r*Math.cos(a), center[1]+r*Math.sin(a)]);
  }
  return pts;
}

/* Las formas que YA quedaron cerradas (cargadas o dibujadas así) se
   exportan tal cual, con los cambios que les hayas hecho. Lo que sigue
   abierto (sobras de reparar puntos sueltos) se intenta encadenar como
   antes, por si todavía se puede armar un contorno cerrado con eso. */
function repairBuildLoops(){
  const closedLoops = [];
  const soup = [];
  repairState.entities.forEach(ent=>{
    if(ent.closed && ent.points.length>=3){
      closedLoops.push(ent.points.map(p=>p.slice()));
    } else {
      for(let i=0;i<ent.points.length-1;i++) soup.push({p1:ent.points[i], p2:ent.points[i+1]});
    }
  });
  closedLoops.push(...chainSegments(soup, MERGE_EPS));
  return closedLoops.map(loop=>normalize(loop));
}
