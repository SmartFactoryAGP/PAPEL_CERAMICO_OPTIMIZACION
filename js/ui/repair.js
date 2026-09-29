/* =========================================================
   EDITOR DE ARCHIVOS — interfaz (canvas interactivo + barra de herramientas)
   ========================================================= */
function repairSetFile(text, name){
  repairState.entities = repairParseDXF(text);
  repairState.history = [];
  repairState.manualFirst = null;
  repairState.selectedId = null;
  repairState.drawBuffer = [];
  repairState.fileBase = (name||'reparado').replace(/\.(dxf|DXF)$/,'');
  document.getElementById('repairFileName').textContent = `Archivo: ${name}`;
  document.getElementById('repairUndoBtn').disabled = true;
  repairFitView();
  repairRefresh();
}
/* Arranca de cero, sin cargar nada — para dibujar una pieza nueva. */
function repairNewBlank(){
  repairState.entities = [];
  repairState.history = [];
  repairState.manualFirst = null;
  repairState.selectedId = null;
  repairState.drawBuffer = [];
  repairState.fileBase = 'pieza_nueva';
  document.getElementById('repairFileName').textContent = 'Archivo nuevo (sin guardar)';
  document.getElementById('repairUndoBtn').disabled = true;
  repairSetTool('line'); // arranca directo en una herramienta de dibujo, tiene más sentido que "mover" con el lienzo vacío
  repairFitView();
  repairRefresh();
}

function repairRefresh(){
  const dangling = repairFindDangling();
  const n = dangling.length;
  const hasContent = repairState.entities.length>0;
  const box = document.getElementById('repairStatusBox');
  const countEl = document.getElementById('repairOpenCount');
  countEl.textContent = hasContent ? n : '—';
  box.classList.toggle('warn', n>0);
  countEl.style.color = n>0 ? 'var(--warn)' : 'var(--good)';
  box.querySelector('span').textContent = (n===0 && hasContent) ? '✓ Contorno cerrado' : 'Puntos abiertos';

  const ready = repairBuildLoops().length>0; // alcanza con que haya AL MENOS una forma cerrada lista — una línea abierta suelta (dejada a propósito) no debería bloquear exportar lo demás
  document.getElementById('repairDownloadBtn').disabled = !ready;
  document.getElementById('repairSendBtn').disabled = !ready;
  document.getElementById('repairAutoBtn').disabled = !hasContent;
  document.getElementById('repairDeleteEntityBtn').disabled = !repairState.selectedId;

  const polyRow = document.getElementById('repairPolyActions');
  if(polyRow) polyRow.style.display = (repairState.tool==='polyline' && repairState.drawBuffer.length>=1) ? 'flex' : 'none';

  repairUpdatePrecisionUI();
  repairUpdateSelInfo();
  if(repairState.tool==='measure'){
    const el = document.getElementById('repairMeasureInfo');
    el.textContent = repairState.measureResult
      ? `Distancia: ${repairState.measureResult.dist.toFixed(2)} mm — Ángulo: ${repairState.measureResult.angle.toFixed(1)}°`
      : 'Hacé clic en el primer punto a medir.';
  }

  repairRender(dangling);
}

/* Recalcula zoom/paneo para que entre TODO el dibujo — se llama al
   cargar un archivo, al empezar uno en blanco, o al tocar "Ajustar
   vista". El resto del tiempo la vista la maneja el usuario con el
   zoom/paneo, no se re-encuadra sola en cada edición (si no, perdías el
   zoom cada vez que movías un punto). */
function repairFitView(){
  const wrap = document.getElementById('repairCanvasWrap');
  let minx=0, miny=0, maxx=500, maxy=500; // lienzo por defecto si no hay nada cargado todavía
  const allPts = [];
  repairState.entities.forEach(ent=> ent.points.forEach(p=>allPts.push(p)));
  if(repairState.drawBuffer.length) repairState.drawBuffer.forEach(p=>allPts.push(p));
  if(allPts.length){
    minx=Infinity; miny=Infinity; maxx=-Infinity; maxy=-Infinity;
    allPts.forEach(([x,y])=>{ if(x<minx)minx=x; if(y<miny)miny=y; if(x>maxx)maxx=x; if(y>maxy)maxy=y; });
  }
  const w = Math.max(1,maxx-minx), h = Math.max(1,maxy-miny);
  const availW = Math.min(920, wrap.clientWidth||820), availH = 560;
  const pad = 30;
  const scale = Math.min((availW-pad*2)/w, (availH-pad*2)/h);
  const offX = pad - minx*scale + (availW-pad*2-w*scale)/2;
  const offY = pad - miny*scale + (availH-pad*2-h*scale)/2;
  repairState.view = {scale, offX, offY, w:availW, h:availH};
}
function repairZoomAt(px, py, factor){
  const before = repairScreenToWorld(px,py);
  repairState.view.scale *= factor;
  const {scale, h} = repairState.view;
  repairState.view.offX = px - before[0]*scale;
  repairState.view.offY = (h-py) - before[1]*scale;
}

/* Elige un espaciado de grilla "redondo" (1, 2, 5, 10, 20, 50, 100mm...)
   que quede ni muy apretado ni muy suelto en pantalla, sea cual sea el
   zoom actual — el mismo criterio que usa cualquier CAD. */
function repairNiceGridStep(scale){
  const targetPx = 55;
  const raw = targetPx/scale;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw/mag;
  const step = norm<1.5 ? 1 : norm<3.5 ? 2 : norm<7.5 ? 5 : 10;
  return step*mag;
}

function repairRender(dangling){
  const wrap = document.getElementById('repairCanvasWrap');
  if(!repairState.view) repairFitView();
  const { scale, offX, offY, w:availW, h:availH } = repairState.view;
  let canvas = wrap.querySelector('canvas');
  if(!canvas){ wrap.innerHTML=''; canvas=document.createElement('canvas'); wrap.appendChild(canvas); }
  canvas.width = availW; canvas.height = availH;

  const ctx = canvas.getContext('2d');
  const toScreen = ([x,y])=>[offX+x*scale, availH-(offY+y*scale)];

  // ===== fondo tipo "plano" (oscuro, con grilla y ejes) =====
  ctx.fillStyle = '#10141d'; ctx.fillRect(0,0,availW,availH);
  const step = repairNiceGridStep(scale);
  const c1 = repairScreenToWorld(0,0), c2 = repairScreenToWorld(availW,availH);
  const minX = Math.min(c1[0],c2[0]), maxX = Math.max(c1[0],c2[0]);
  const minY = Math.min(c1[1],c2[1]), maxY = Math.max(c1[1],c2[1]);
  ctx.lineWidth = 1;
  for(let x=Math.floor(minX/step)*step; x<=maxX+step; x+=step){
    const major = Math.abs(Math.round(x/(step*5))*(step*5) - x) < step*0.001;
    ctx.strokeStyle = major ? 'rgba(148,163,184,0.20)' : 'rgba(148,163,184,0.07)';
    const [sx1,sy1] = toScreen([x,minY]), [sx2,sy2] = toScreen([x,maxY]);
    ctx.beginPath(); ctx.moveTo(sx1,sy1); ctx.lineTo(sx2,sy2); ctx.stroke();
  }
  for(let y=Math.floor(minY/step)*step; y<=maxY+step; y+=step){
    const major = Math.abs(Math.round(y/(step*5))*(step*5) - y) < step*0.001;
    ctx.strokeStyle = major ? 'rgba(148,163,184,0.20)' : 'rgba(148,163,184,0.07)';
    const [sx1,sy1] = toScreen([minX,y]), [sx2,sy2] = toScreen([maxX,y]);
    ctx.beginPath(); ctx.moveTo(sx1,sy1); ctx.lineTo(sx2,sy2); ctx.stroke();
  }
  // ejes X=0 / Y=0, más marcados — como el origen (UCS) de un CAD
  ctx.lineWidth = 1.4;
  if(minX<=0 && maxX>=0){
    ctx.strokeStyle = 'rgba(239,68,68,0.55)';
    const [sx1,sy1] = toScreen([0,minY]), [sx2,sy2] = toScreen([0,maxY]);
    ctx.beginPath(); ctx.moveTo(sx1,sy1); ctx.lineTo(sx2,sy2); ctx.stroke();
  }
  if(minY<=0 && maxY>=0){
    ctx.strokeStyle = 'rgba(74,222,128,0.55)';
    const [sx1,sy1] = toScreen([minX,0]), [sx2,sy2] = toScreen([maxX,0]);
    ctx.beginPath(); ctx.moveTo(sx1,sy1); ctx.lineTo(sx2,sy2); ctx.stroke();
  }

  // línea guía en cruz, siguiendo al mouse — como el cursor de cualquier CAD
  if(repairMouseScreen){
    const [mx,my] = repairMouseScreen;
    ctx.setLineDash([6,5]);
    ctx.strokeStyle = 'rgba(94,234,212,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mx,0); ctx.lineTo(mx,availH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,my); ctx.lineTo(availW,my); ctx.stroke();
    ctx.setLineDash([]);
  }

  // ===== formas ya cargadas/dibujadas =====
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  repairState.entities.forEach(ent=>{
    const pts = ent.points.map(toScreen);
    const isSel = ent.id===repairState.selectedId;
    const isHoverBody = repairHoverTarget && repairHoverTarget.type==='entity' && repairHoverTarget.entityId===ent.id;
    ctx.beginPath();
    pts.forEach(([x,y],i)=> i===0?ctx.moveTo(x,y):ctx.lineTo(x,y));
    if(ent.closed) ctx.closePath();
    if(ent.closed){ ctx.fillStyle = isSel ? 'rgba(46,230,196,.16)' : isHoverBody ? 'rgba(94,234,212,.09)' : 'rgba(148,163,184,.05)'; ctx.fill(); }
    if(isSel){ ctx.shadowColor = 'rgba(46,230,196,.65)'; ctx.shadowBlur = 8; }
    ctx.strokeStyle = isSel ? '#2ee6c4' : isHoverBody ? '#7dd3c0' : '#e2e8f0';
    ctx.lineWidth = isSel ? 2.4 : isHoverBody ? 2 : 1.6;
    ctx.stroke();
    ctx.shadowBlur = 0;
    // marcadores de vértice — cuadraditos con borde, más "profesionales"
    // que un punto relleno a secas; el que está bajo el mouse se agranda.
    pts.forEach(([x,y],vi)=>{
      const isHoverV = repairHoverTarget && repairHoverTarget.type==='vertex' && repairHoverTarget.entityId===ent.id && repairHoverTarget.vertexIndex===vi;
      const s = isHoverV ? 6 : isSel ? 4.5 : 3.5;
      ctx.fillStyle = isSel ? '#0f2a26' : '#10141d';
      ctx.fillRect(x-s,y-s,s*2,s*2);
      ctx.strokeStyle = isHoverV ? '#ffd23f' : isSel ? '#2ee6c4' : '#94a3b8';
      ctx.lineWidth = 1.3;
      ctx.strokeRect(x-s,y-s,s*2,s*2);
    });
  });

  // puntos abiertos, en rojo — el más prioritario para "reparar"
  dangling.forEach(p=>{
    const [x,y]=toScreen(p);
    const isChosen = repairState.manualFirst && closeEnough(p, repairState.manualFirst, MERGE_EPS);
    ctx.beginPath(); ctx.arc(x,y, isChosen?8:6, 0, 2*Math.PI);
    ctx.fillStyle = isChosen ? '#ffd23f' : '#ff5c5c';
    ctx.fill();
    ctx.strokeStyle='#7a0d0d'; ctx.lineWidth=1.2; ctx.stroke();
  });

  // indicador de "enganche": el punto existente al que se va a pegar el
  // próximo clic (como el OSNAP de cualquier CAD) — un cuadradito hueco
  // alrededor del punto, bien visible.
  if(repairSnapIndicator){
    const [x,y] = toScreen(repairSnapIndicator);
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2;
    ctx.strokeRect(x-7,y-7,14,14);
  }

  // vista previa de lo que se está dibujando ahora mismo
  if(repairState.drawBuffer.length){
    const buf = repairState.drawBuffer;
    const previewPts = buf.slice();
    if(repairDrawPreview) previewPts.push(repairDrawPreview);
    ctx.setLineDash([5,4]);
    ctx.strokeStyle = repairState.tool==='measure' ? '#60a5fa' : '#2ee6c4'; ctx.lineWidth = 1.6;
    if(repairState.tool==='rect' && previewPts.length===2){
      const [a,b] = previewPts;
      const rectPts = [[a[0],a[1]],[b[0],a[1]],[b[0],b[1]],[a[0],b[1]],[a[0],a[1]]].map(toScreen);
      ctx.beginPath(); rectPts.forEach(([x,y],i)=> i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)); ctx.stroke();
    } else if(repairState.tool==='circle' && previewPts.length===2){
      const circPts = repairCirclePoints(previewPts[0], previewPts[1]).map(toScreen);
      ctx.beginPath(); circPts.forEach(([x,y],i)=> i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)); ctx.closePath(); ctx.stroke();
    } else {
      const linePts = previewPts.map(toScreen);
      ctx.beginPath(); linePts.forEach(([x,y],i)=> i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)); ctx.stroke();
    }
    ctx.setLineDash([]);
    buf.forEach(p=>{
      const [x,y]=toScreen(p);
      ctx.beginPath(); ctx.arc(x,y,4,0,2*Math.PI); ctx.fillStyle= repairState.tool==='measure' ? '#60a5fa' : '#2ee6c4'; ctx.fill();
    });

    // medidas en vivo, como en cualquier CAD: distancia+ángulo, ancho×alto, o radio
    if(previewPts.length>=2){
      ctx.font = '11px sans-serif';
      ctx.fillStyle = repairState.tool==='measure' ? '#93c5fd' : '#5eead4';
      const a = previewPts[previewPts.length-2], b = previewPts[previewPts.length-1];
      const mid = toScreen([(a[0]+b[0])/2, (a[1]+b[1])/2]);
      if(repairState.tool==='rect'){
        const wdt = Math.abs(b[0]-a[0]), hgt = Math.abs(b[1]-a[1]);
        const p = toScreen(b);
        ctx.fillText(`${wdt.toFixed(1)} × ${hgt.toFixed(1)} mm`, p[0]+8, p[1]);
      } else if(repairState.tool==='circle'){
        const r = Math.hypot(b[0]-a[0], b[1]-a[1]);
        const p = toScreen(b);
        ctx.fillText(`radio ${r.toFixed(1)} mm`, p[0]+8, p[1]);
      } else {
        const dist = Math.hypot(b[0]-a[0], b[1]-a[1]);
        const angle = (Math.atan2(b[1]-a[1], b[0]-a[0])*180/Math.PI + 360) % 360;
        ctx.fillText(`${dist.toFixed(1)} mm  ${angle.toFixed(1)}°`, mid[0]+6, mid[1]-6);
      }
    }
  }

  // resultado de la última medición (queda a la vista hasta la próxima)
  if(repairState.tool==='measure' && repairState.measureResult && !repairState.drawBuffer.length){
    const {a,b,dist,angle} = repairState.measureResult;
    const [ax,ay]=toScreen(a), [bx,by]=toScreen(b);
    ctx.setLineDash([4,3]); ctx.strokeStyle='#60a5fa'; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(bx,by); ctx.stroke();
    ctx.setLineDash([]);
    [[ax,ay],[bx,by]].forEach(([x,y])=>{ ctx.beginPath(); ctx.arc(x,y,4,0,2*Math.PI); ctx.fillStyle='#60a5fa'; ctx.fill(); });
    ctx.font='12px sans-serif'; ctx.fillStyle='#93c5fd';
    ctx.fillText(`${dist.toFixed(2)} mm, ${angle.toFixed(1)}°`, (ax+bx)/2+6, (ay+by)/2-6);
  }
}
function repairScreenToWorld(px,py){
  const {scale,offX,offY,h} = repairState.view;
  return [(px-offX)/scale, (h-py-offY)/scale];
}

/* Busca si hay un vértice YA EXISTENTE (de cualquier forma, o de la que
   se está dibujando ahora mismo) cerca del punto dado — como el "enganche
   a objeto" (object snap) de cualquier CAD. Sirve para armar un cuadrado,
   triángulo, etc. a mano, conectando el final de una línea con el
   principio de otra en el punto EXACTO, no aproximado. */
function repairSnapCandidate(world, pixTol){
  let best=null, bestD=Infinity;
  const consider = p=>{ const d=Math.hypot(p[0]-world[0], p[1]-world[1]); if(d<bestD){bestD=d;best=p;} };
  repairState.entities.forEach(ent=> ent.points.forEach(consider));
  repairState.drawBuffer.forEach(consider);
  const tol = pixTol/repairState.view.scale;
  return (best && bestD<=tol) ? best : null;
}

/* ---- barra de herramientas ---- */
function repairSetTool(tool){
  repairState.tool = tool;
  repairState.drawBuffer = [];
  repairState.manualFirst = null;
  repairState.measureResult = null;
  document.querySelectorAll('.toolBtn').forEach(b=> b.classList.toggle('active', b.getAttribute('data-tool')===tool));
  const hints = {
    select: 'Mové un punto o una forma arrastrándola. Hacé clic afuera para deseleccionar.',
    pan: 'Arrastrá con el clic izquierdo para mover la vista (el botón del medio también funciona, con cualquier herramienta).',
    repair: 'Hacé clic en un punto rojo y después en otro para unirlos con una línea recta.',
    addPoint: 'Hacé clic sobre una línea (no sobre un punto) para agregar un vértice nuevo ahí.',
    delPoint: 'Hacé clic sobre un punto para borrarlo.',
    line: 'Hacé clic en el primer extremo, y después en el segundo — o escribí distancia y ángulo abajo.',
    rect: 'Hacé clic en una esquina, y después en la esquina opuesta — o escribí ancho y alto abajo.',
    circle: 'Hacé clic en el centro, y después en un punto del borde — o escribí el radio abajo.',
    polyline: 'Hacé clic para ir agregando puntos (o escribí distancia y ángulo abajo). Terminá con los botones de abajo.',
    measure: 'Hacé clic en dos puntos para ver la distancia y el ángulo entre ellos. No dibuja nada.'
  };
  document.getElementById('repairToolHint').textContent = hints[tool] || '\u00a0';
  document.getElementById('repairMeasureInfo').style.display = tool==='measure' ? 'block' : 'none';
  repairUpdateCursor();
  repairRefresh();
}
/* Muestra/oculta el panel de "entrada precisa" según la herramienta y
   si ya hay un primer punto puesto, y le cambia las etiquetas a lo que
   corresponda (distancia+ángulo, ancho+alto, o solo radio). */
function repairUpdatePrecisionUI(){
  const tool = repairState.tool, buf = repairState.drawBuffer;
  const block = document.getElementById('repairPrecisionBlock');
  const aLabel = document.getElementById('repairPrecALabel');
  const bLabel = document.getElementById('repairPrecBLabel');
  const bField = document.getElementById('repairPrecBField');
  let show = false;
  if((tool==='line'||tool==='polyline') && buf.length>=1){
    show = true;
    aLabel.textContent = 'Distancia (mm)';
    bLabel.textContent = 'Ángulo (°, 0=derecha, sentido antihorario)';
    bField.style.display = 'block';
  } else if(tool==='rect' && buf.length===1){
    show = true;
    aLabel.textContent = 'Ancho (mm)';
    bLabel.textContent = 'Alto (mm)';
    bField.style.display = 'block';
  } else if(tool==='circle' && buf.length===1){
    show = true;
    aLabel.textContent = 'Radio (mm)';
    bField.style.display = 'none';
  }
  block.style.display = show ? 'block' : 'none';
}
/* Medidas de la forma seleccionada — largo y ángulo para una línea,
   perímetro/área para una forma cerrada, o el radio si parece un
   círculo (todos los puntos más o menos a la misma distancia del centro). */
/* Identifica qué tipo de forma es, para saber si se puede editar por
   medidas (círculo, rectángulo, línea) o no (un polígono cualquiera). */
function repairShapeKind(ent){
  if(!ent.closed) return ent.points.length===2 ? 'line' : 'openpoly';
  const cx = ent.points.reduce((s,p)=>s+p[0],0)/ent.points.length;
  const cy = ent.points.reduce((s,p)=>s+p[1],0)/ent.points.length;
  const dists = ent.points.map(p=>Math.hypot(p[0]-cx,p[1]-cy));
  const rAvg = dists.reduce((a,b)=>a+b,0)/dists.length;
  if(ent.points.length>=12 && dists.every(d=>Math.abs(d-rAvg)<=Math.max(0.5,rAvg*0.03))) return 'circle';
  if(ent.points.length===4){
    const bb = polyBBox(ent.points);
    if(Math.abs(bb.w*bb.h - polyArea(ent.points)) < bb.w*bb.h*0.01) return 'rect'; // rectángulo alineado a los ejes
  }
  return 'polygon';
}

function repairUpdateSelInfo(){
  const el = document.getElementById('repairSelInfo');
  const editBlock = document.getElementById('repairEditShapeBlock');
  const ent = repairState.selectedId ? repairFindEntity(repairState.selectedId) : null;
  if(!ent){ el.style.display = 'none'; editBlock.style.display = 'none'; return; }
  el.style.display = 'block';
  const inputA = document.getElementById('repairEditA'), inputB = document.getElementById('repairEditB');
  const labelA = document.getElementById('repairEditALabel'), labelB = document.getElementById('repairEditBLabel');
  const fieldB = document.getElementById('repairEditBField');
  const kind = repairShapeKind(ent);

  if(kind==='circle'){
    const cx = ent.points.reduce((s,p)=>s+p[0],0)/ent.points.length;
    const cy = ent.points.reduce((s,p)=>s+p[1],0)/ent.points.length;
    const r = Math.hypot(ent.points[0][0]-cx, ent.points[0][1]-cy);
    el.textContent = `Círculo seleccionado — radio ≈ ${r.toFixed(2)} mm (diámetro ${(r*2).toFixed(2)} mm)`;
    editBlock.style.display = 'block'; fieldB.style.display = 'none';
    labelA.textContent = 'Radio (mm)';
    if(document.activeElement!==inputA) inputA.value = r.toFixed(2);
  } else if(kind==='rect'){
    const bb = polyBBox(ent.points);
    el.textContent = `Rectángulo seleccionado — ${bb.w.toFixed(2)} × ${bb.h.toFixed(2)} mm`;
    editBlock.style.display = 'block'; fieldB.style.display = 'block';
    labelA.textContent = 'Ancho (mm)'; labelB.textContent = 'Alto (mm)';
    if(document.activeElement!==inputA) inputA.value = bb.w.toFixed(2);
    if(document.activeElement!==inputB) inputB.value = bb.h.toFixed(2);
  } else if(kind==='line'){
    const [a,b] = ent.points;
    const dist = Math.hypot(b[0]-a[0], b[1]-a[1]);
    const angle = (Math.atan2(b[1]-a[1], b[0]-a[0])*180/Math.PI + 360) % 360;
    el.textContent = `Línea — largo ${dist.toFixed(2)} mm, ángulo ${angle.toFixed(1)}°`;
    editBlock.style.display = 'block'; fieldB.style.display = 'block';
    labelA.textContent = 'Distancia (mm)'; labelB.textContent = 'Ángulo (°)';
    if(document.activeElement!==inputA) inputA.value = dist.toFixed(2);
    if(document.activeElement!==inputB) inputB.value = angle.toFixed(2);
  } else if(kind==='polygon'){
    el.textContent = `Forma cerrada — perímetro ${polyPerimeter(ent.points).toFixed(1)} mm, área ${(polyArea(ent.points)/100).toFixed(1)} cm²`;
    editBlock.style.display = 'none';
  } else {
    let total=0;
    for(let i=0;i<ent.points.length-1;i++) total += Math.hypot(ent.points[i+1][0]-ent.points[i][0], ent.points[i+1][1]-ent.points[i][1]);
    el.textContent = `Polilínea abierta — largo total ${total.toFixed(2)} mm`;
    editBlock.style.display = 'none';
  }
}

/* Aplica la medida escrita a mano sobre la forma seleccionada — círculo
   (radio), rectángulo (ancho/alto, mantiene el centro) o línea
   (distancia/ángulo, mantiene el primer punto). */
function repairApplyShapeEdit(){
  const ent = repairState.selectedId ? repairFindEntity(repairState.selectedId) : null;
  if(!ent) return;
  const kind = repairShapeKind(ent);
  const a = parseFloat(document.getElementById('repairEditA').value);
  if(!isFinite(a) || a<=0) return;
  if(kind==='circle'){
    repairPushHistory();
    const cx = ent.points.reduce((s,p)=>s+p[0],0)/ent.points.length;
    const cy = ent.points.reduce((s,p)=>s+p[1],0)/ent.points.length;
    ent.points = repairCirclePoints([cx,cy], [cx+a,cy]);
  } else if(kind==='rect'){
    const b = parseFloat(document.getElementById('repairEditB').value);
    if(!isFinite(b) || b<=0) return;
    repairPushHistory();
    const bb = polyBBox(ent.points);
    const cx = (bb.minx+bb.maxx)/2, cy = (bb.miny+bb.maxy)/2;
    ent.points = [[cx-a/2,cy-b/2],[cx+a/2,cy-b/2],[cx+a/2,cy+b/2],[cx-a/2,cy+b/2]];
  } else if(kind==='line'){
    const b = parseFloat(document.getElementById('repairEditB').value);
    if(!isFinite(b)) return;
    repairPushHistory();
    const p0 = ent.points[0];
    const rad = b*Math.PI/180;
    ent.points = [p0, [p0[0]+a*Math.cos(rad), p0[1]+a*Math.sin(rad)]];
  } else return;
  repairRefresh();
}
document.getElementById('repairEditApplyBtn').addEventListener('click', repairApplyShapeEdit);
['repairEditA','repairEditB'].forEach(id=>{
  document.getElementById(id).addEventListener('keydown', ev=>{
    if(ev.key==='Enter'){ ev.preventDefault(); repairApplyShapeEdit(); }
  });
});

/* ============ "dibujar por texto" ============
   No es una IA que entienda cualquier frase — es un lector de formatos
   puntuales (círculo/cuadrado/rectángulo/línea con sus medidas). Si no
   reconoce el texto, avisa claro en vez de fallar en silencio. */
function repairParseCommand(text){
  // saca "mm" del texto antes de leerlo — así da igual si lo escribís
  // pegado al número ("100mmx120mm"), con espacio ("100 mm x 120 mm"),
  // o ni lo escribís (siempre se asume milímetros).
  const t = (text||'').toLowerCase().trim().replace(/mm/g, ' ').replace(/,/g, '.');
  const num = s => parseFloat(s.replace(',','.'));

  let m = t.match(/c[ií]rculo[^0-9]*di[aá]metro[^0-9]*(\d+(?:\.\d+)?)/);
  if(m) return {tipo:'circle', radio: num(m[1])/2};
  m = t.match(/c[ií]rculo[^0-9]*(?:radio|r)?[^0-9]*(\d+(?:\.\d+)?)/);
  if(m && t.includes('c')) return {tipo:'circle', radio: num(m[1])};

  m = t.match(/cuadrado[^0-9]*(\d+(?:\.\d+)?)/);
  if(m){ const s=num(m[1]); return {tipo:'rect', ancho:s, alto:s}; }

  m = t.match(/rect[aá]ngulo[^0-9]*(\d+(?:\.\d+)?)\s*(?:x|por|\*)\s*(\d+(?:\.\d+)?)/);
  if(m) return {tipo:'rect', ancho:num(m[1]), alto:num(m[2])};
  if(t.includes('rect')){
    const anchoM = t.match(/ancho[^0-9]*(\d+(?:\.\d+)?)/);
    const altoM = t.match(/alto[^0-9]*(\d+(?:\.\d+)?)/);
    if(anchoM && altoM) return {tipo:'rect', ancho:num(anchoM[1]), alto:num(altoM[1])};
  }

  if(t.includes('linea') || t.includes('línea')){
    const distM = t.match(/(?:distancia|largo)[^0-9]*(\d+(?:\.\d+)?)/) || t.match(/l[ií]nea\D*?(\d+(?:\.\d+)?)/);
    const angM = t.match(/(\d+(?:\.\d+)?)\s*(?:°|grados?)/) || t.match(/[aá]ngulo[^0-9]*(\d+(?:\.\d+)?)/);
    if(distM) return {tipo:'line', distancia: num(distM[1]), angulo: angM?num(angM[1]):0};
  }
  return null;
}
function repairChatSubmit(){
  const input = document.getElementById('repairChatInput');
  const status = document.getElementById('repairChatStatus');
  const cmd = repairParseCommand(input.value);
  if(!cmd){
    status.textContent = 'No entendí esa forma — probá "círculo radio 50", "rectángulo 100x60", "cuadrado 80" o "línea 120mm a 45 grados".';
    return;
  }
  const view = repairState.view;
  const centro = view ? repairScreenToWorld(view.w/2, view.h/2) : [0,0];
  repairPushHistory();
  const eraVacio = repairState.entities.length===0;
  if(cmd.tipo==='circle'){
    repairAddEntity(repairCirclePoints(centro, [centro[0]+cmd.radio, centro[1]]), true);
    status.textContent = `Círculo de radio ${cmd.radio}mm creado.`;
  } else if(cmd.tipo==='rect'){
    const [cx,cy]=centro, a=cmd.ancho, b=cmd.alto;
    repairAddEntity([[cx-a/2,cy-b/2],[cx+a/2,cy-b/2],[cx+a/2,cy+b/2],[cx-a/2,cy+b/2]], true);
    status.textContent = `Rectángulo de ${a}×${b}mm creado.`;
  } else if(cmd.tipo==='line'){
    const rad = cmd.angulo*Math.PI/180;
    repairAddEntity([centro, [centro[0]+cmd.distancia*Math.cos(rad), centro[1]+cmd.distancia*Math.sin(rad)]], false);
    status.textContent = `Línea de ${cmd.distancia}mm a ${cmd.angulo}° creada.`;
  }
  input.value = '';
  repairSetTool('select');
  if(eraVacio) repairFitView();
  repairRefresh();
}
document.getElementById('repairChatBtn').addEventListener('click', repairChatSubmit);
document.getElementById('repairChatInput').addEventListener('keydown', ev=>{
  if(ev.key==='Enter'){ ev.preventDefault(); repairChatSubmit(); }
});

document.querySelectorAll('.toolBtn').forEach(btn=>{
  btn.addEventListener('click', ()=> repairSetTool(btn.getAttribute('data-tool')));
});

/* ---- hit-testing sobre el modelo, en coordenadas del mundo ---- */
function repairHitVertex(wx, wy, pixTol){
  let best=null, bestD=Infinity;
  repairState.entities.forEach(ent=>{
    ent.points.forEach((p,i)=>{
      const d = Math.hypot(p[0]-wx, p[1]-wy);
      if(d<bestD){ bestD=d; best={entityId:ent.id, vertexIndex:i}; }
    });
  });
  const tol = pixTol/repairState.view.scale;
  return (best && bestD<=tol) ? best : null;
}
function repairHitEdge(wx, wy, pixTol){
  let best=null, bestD=Infinity;
  repairState.entities.forEach(ent=>{
    repairEntityEdges(ent).forEach(([a,b,idx])=>{
      const d = distPointSeg(wx,wy, a[0],a[1], b[0],b[1]);
      if(d<bestD){ bestD=d; best={entityId:ent.id, edgeIndex:idx}; }
    });
  });
  const tol = pixTol/repairState.view.scale;
  return (best && bestD<=tol) ? best : null;
}
function repairHitEntityBody(wx, wy, pixTol){
  for(const ent of repairState.entities){
    if(ent.closed && ent.points.length>=3 && pip(wx, wy, ent.points)) return ent.id;
  }
  const eHit = repairHitEdge(wx, wy, pixTol);
  return eHit ? eHit.entityId : null;
}

/* ---- mouse sobre el lienzo ---- */
const repairWrapEl = document.getElementById('repairCanvasWrap');
let repairDrag = null;
let repairPan = null;
let repairDrawPreview = null;
let repairSnapIndicator = null; // punto existente al que el próximo clic se va a enganchar, si hay uno cerca
let repairMouseScreen = null;   // posición del mouse en pantalla, para las líneas guía en cruz
let repairHoverTarget = null;   // punto/forma que está bajo el mouse ahora mismo, con "Mover" activo

/* Cursor del lienzo según la herramienta y lo que esté pasando ahora
   mismo — manito para paneo, cruz para dibujar, mano abierta/cerrada
   para la herramienta "Mano". */
function repairUpdateCursor(){
  const canvas = repairWrapEl.querySelector('canvas');
  if(!canvas) return;
  if(repairPan){ canvas.style.cursor = 'grabbing'; return; }
  if(repairState.tool==='pan'){ canvas.style.cursor = 'grab'; return; }
  if(['line','rect','circle','polyline','measure'].includes(repairState.tool)){ canvas.style.cursor = 'crosshair'; return; }
  if(['addPoint','delPoint','repair'].includes(repairState.tool)){ canvas.style.cursor = 'pointer'; return; }
  canvas.style.cursor = repairHoverTarget ? 'pointer' : 'default';
}

function repairEventWorld(ev){
  const canvas = repairWrapEl.querySelector('canvas');
  if(!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const px = (ev.clientX-rect.left) * (canvas.width/rect.width);
  const py = (ev.clientY-rect.top) * (canvas.height/rect.height);
  return repairScreenToWorld(px,py);
}

repairWrapEl.addEventListener('mousedown', ev=>{
  // botón del medio (con cualquier herramienta) o clic izquierdo con la
  // herramienta "Mano" activa: los dos paneen igual — esto no depende de
  // pegarle justo al <canvas>, alcanza con estar dentro del panel.
  if(ev.button===1 || (ev.button===0 && repairState.tool==='pan')){
    ev.preventDefault();
    repairPan = { startClientX: ev.clientX, startClientY: ev.clientY, startOffX: repairState.view.offX, startOffY: repairState.view.offY };
    repairUpdateCursor();
    return;
  }
  if(ev.button!==0) return; // solo clic izquierdo dispara el resto de las herramientas
  if(!ev.target.closest('canvas')) return;
  const world = repairEventWorld(ev); if(!world) return;
  const tool = repairState.tool;

  if(tool==='select'){
    const vHit = repairHitVertex(world[0], world[1], 10);
    if(vHit){
      repairPushHistory();
      repairState.selectedId = vHit.entityId;
      repairDrag = {type:'vertex', entityId:vHit.entityId, vertexIndex:vHit.vertexIndex};
      repairRefresh();
      return;
    }
    const bodyHit = repairHitEntityBody(world[0], world[1], 10);
    if(bodyHit){
      repairPushHistory();
      repairState.selectedId = bodyHit;
      repairDrag = {type:'entity', entityId:bodyHit, lastWorld:world};
      repairRefresh();
      return;
    }
    repairState.selectedId = null;
    repairRefresh();
    return;
  }

  if(tool==='repair'){
    const dangling = repairFindDangling();
    let best=null, bestD=Infinity;
    dangling.forEach(p=>{ const d=Math.hypot(p[0]-world[0], p[1]-world[1]); if(d<bestD){bestD=d;best=p;} });
    const pixTol = 12/repairState.view.scale;
    if(!best || bestD>pixTol) return;
    if(!repairState.manualFirst){
      repairState.manualFirst = best;
      document.getElementById('repairToolHint').textContent = 'Ahora hacé clic en el segundo punto para unirlos.';
    } else {
      repairPushHistory();
      repairAddEntity([repairState.manualFirst, best], false);
      repairState.manualFirst = null;
      document.getElementById('repairToolHint').textContent = 'Unidos. Elegí otros dos puntos si hace falta.';
    }
    repairRefresh();
    return;
  }

  if(tool==='addPoint'){
    const eHit = repairHitEdge(world[0], world[1], 10);
    if(!eHit) return;
    repairPushHistory();
    repairAddVertexOnEdge(eHit.entityId, eHit.edgeIndex, world);
    repairRefresh();
    return;
  }

  if(tool==='delPoint'){
    const vHit = repairHitVertex(world[0], world[1], 10);
    if(!vHit) return;
    repairPushHistory();
    repairDeleteVertex(vHit.entityId, vHit.vertexIndex);
    repairRefresh();
    return;
  }

  if(tool==='line' || tool==='rect' || tool==='circle' || tool==='polyline'){
    const snap = repairSnapCandidate(world, 10);
    repairHandleDrawClick(snap || world);
    return;
  }

  if(tool==='measure'){
    repairState.drawBuffer.push(world);
    if(repairState.drawBuffer.length===2){
      const [a,b] = repairState.drawBuffer;
      const dist = Math.hypot(b[0]-a[0], b[1]-a[1]);
      const angle = (Math.atan2(b[1]-a[1], b[0]-a[0])*180/Math.PI + 360) % 360;
      repairState.measureResult = {a,b,dist,angle};
      repairState.drawBuffer = [];
    }
    repairRefresh();
    return;
  }
});

/* Agrega un punto a la forma que se está dibujando (línea, rectángulo,
   círculo o polilínea) y la termina cuando corresponde — la usan tanto
   un clic en el lienzo como la entrada precisa (escribir el valor
   exacto en vez de hacer clic a ojo). */
function repairHandleDrawClick(world){
  const tool = repairState.tool;
  if(tool==='line' || tool==='rect' || tool==='circle'){
    repairState.drawBuffer.push(world);
    if(repairState.drawBuffer.length===2){
      repairPushHistory();
      if(tool==='line'){ repairAddEntity(repairState.drawBuffer, false); }
      else if(tool==='rect'){
        const [a,b] = repairState.drawBuffer;
        repairAddEntity([[a[0],a[1]],[b[0],a[1]],[b[0],b[1]],[a[0],b[1]]], true);
      } else if(tool==='circle'){
        repairAddEntity(repairCirclePoints(repairState.drawBuffer[0], repairState.drawBuffer[1]), true);
      }
      repairState.drawBuffer = [];
    }
    repairRefresh();
    return;
  }
  if(tool==='polyline'){
    repairState.drawBuffer.push(world);
    document.getElementById('repairToolHint').textContent = `${repairState.drawBuffer.length} punto(s) — seguí haciendo clic, o usá los botones de abajo para terminar.`;
    repairRefresh();
    return;
  }
}

/* Entrada precisa: en vez de hacer clic a ojo, escribís la distancia y
   el ángulo (línea/polilínea), el ancho y el alto (rectángulo), o el
   radio (círculo), y confirmás — calcula el punto exacto y lo agrega
   como si hubieras hecho clic justo ahí. */
function repairPrecisionConfirm(){
  const tool = repairState.tool;
  const buf = repairState.drawBuffer;
  const a = parseFloat(document.getElementById('repairPrecA').value);
  if(!isFinite(a)) return;
  if((tool==='line'||tool==='polyline') && buf.length>=1){
    const b = parseFloat(document.getElementById('repairPrecB').value);
    if(!isFinite(b)) return;
    const p0 = buf[buf.length-1];
    const rad = b*Math.PI/180;
    repairHandleDrawClick([p0[0]+a*Math.cos(rad), p0[1]+a*Math.sin(rad)]);
  } else if(tool==='rect' && buf.length===1){
    const b = parseFloat(document.getElementById('repairPrecB').value);
    if(!isFinite(b)) return;
    const p0 = buf[0];
    repairHandleDrawClick([p0[0]+a, p0[1]+b]);
  } else if(tool==='circle' && buf.length===1){
    const p0 = buf[0];
    repairHandleDrawClick([p0[0]+a, p0[1]]);
  }
}
document.getElementById('repairPrecConfirmBtn').addEventListener('click', repairPrecisionConfirm);
['repairPrecA','repairPrecB'].forEach(id=>{
  document.getElementById(id).addEventListener('keydown', ev=>{
    if(ev.key==='Enter'){ ev.preventDefault(); repairPrecisionConfirm(); }
  });
});
/* Lectura de coordenadas, indicador de enganche, resaltado al pasar el
   mouse (hover) sobre un punto/forma, y la posición para las líneas guía
   en cruz — todo junto en un solo listener para no pisarse entre sí. */
repairWrapEl.addEventListener('mousemove', ev=>{
  const canvas = repairWrapEl.querySelector('canvas');
  if(canvas){
    const rect = canvas.getBoundingClientRect();
    repairMouseScreen = [(ev.clientX-rect.left)*(canvas.width/rect.width), (ev.clientY-rect.top)*(canvas.height/rect.height)];
  }
  const world = repairEventWorld(ev);
  const coordsEl = document.getElementById('repairCoordsReadout');
  if(coordsEl && world) coordsEl.textContent = `X: ${world[0].toFixed(1)}  Y: ${world[1].toFixed(1)} mm`;
  if(!world){ repairRender(repairFindDangling()); return; }

  const tool = repairState.tool;
  const isDrawTool = tool==='line'||tool==='rect'||tool==='circle'||tool==='polyline';
  repairHoverTarget = null;
  if(isDrawTool || tool==='measure'){
    const snap = isDrawTool ? repairSnapCandidate(world, 10) : null;
    repairSnapIndicator = snap;
    repairDrawPreview = snap || world;
  } else {
    repairDrawPreview = null;
    repairSnapIndicator = null;
    if(tool==='select' && !repairDrag && !repairPan){
      const vHit = repairHitVertex(world[0], world[1], 10);
      if(vHit) repairHoverTarget = {type:'vertex', entityId:vHit.entityId, vertexIndex:vHit.vertexIndex};
      else {
        const bodyHit = repairHitEntityBody(world[0], world[1], 10);
        if(bodyHit) repairHoverTarget = {type:'entity', entityId:bodyHit};
      }
    }
  }
  repairUpdateCursor();
  repairRender(repairFindDangling());
});
repairWrapEl.addEventListener('mouseleave', ()=>{
  repairMouseScreen = null; repairHoverTarget = null;
  repairRender(repairFindDangling());
});
window.addEventListener('mousemove', ev=>{
  if(repairPan){
    const dx = ev.clientX - repairPan.startClientX;
    const dy = ev.clientY - repairPan.startClientY;
    repairState.view.offX = repairPan.startOffX + dx;
    repairState.view.offY = repairPan.startOffY - dy; // Y de pantalla va al revés que Y del mundo
    repairRender(repairFindDangling());
    return;
  }
  if(!repairDrag) return;
  const world = repairEventWorld(ev); if(!world) return;
  if(repairDrag.type==='vertex'){
    const snap = repairSnapCandidate(world, 10);
    repairSnapIndicator = snap;
    repairMoveVertex(repairDrag.entityId, repairDrag.vertexIndex, snap || world);
  } else if(repairDrag.type==='entity'){
    const dx = world[0]-repairDrag.lastWorld[0], dy = world[1]-repairDrag.lastWorld[1];
    repairMoveEntity(repairDrag.entityId, dx, dy);
    repairDrag.lastWorld = world;
  }
  repairRefresh();
});
window.addEventListener('mouseup', ()=>{ repairDrag = null; repairPan = null; repairSnapIndicator = null; repairUpdateCursor(); });

/* Zoom con la rueda del mouse, centrado en el cursor (como en cualquier
   CAD): el punto que tenés bajo el mouse se queda fijo en pantalla, en
   vez de que el zoom "se vaya" hacia la esquina. */
repairWrapEl.addEventListener('wheel', ev=>{
  if(!ev.target.closest('canvas')) return;
  ev.preventDefault();
  const canvas = repairWrapEl.querySelector('canvas');
  const rect = canvas.getBoundingClientRect();
  const px = (ev.clientX-rect.left) * (canvas.width/rect.width);
  const py = (ev.clientY-rect.top) * (canvas.height/rect.height);
  repairZoomAt(px, py, ev.deltaY < 0 ? 1.15 : (1/1.15));
  repairRender(repairFindDangling());
}, {passive:false});

/* Lectura de coordenadas en vivo, indicador de enganche, resaltado al
   pasar el mouse y línea guía en cruz: todo eso ya lo hace el listener
   de mousemove consolidado más arriba. */

document.getElementById('repairZoomInBtn') && document.getElementById('repairZoomInBtn').addEventListener('click', ()=>{
  repairZoomAt(repairState.view.w/2, repairState.view.h/2, 1.3);
  repairRender(repairFindDangling());
});
document.getElementById('repairZoomOutBtn') && document.getElementById('repairZoomOutBtn').addEventListener('click', ()=>{
  repairZoomAt(repairState.view.w/2, repairState.view.h/2, 1/1.3);
  repairRender(repairFindDangling());
});
document.getElementById('repairZoomFitBtn') && document.getElementById('repairZoomFitBtn').addEventListener('click', ()=>{
  repairFitView();
  repairRender(repairFindDangling());
});

document.getElementById('repairDeleteEntityBtn').addEventListener('click', ()=>{
  if(!repairState.selectedId) return;
  repairPushHistory();
  repairDeleteEntity(repairState.selectedId);
  repairRefresh();
});
document.getElementById('repairPolyFinishOpen') && document.getElementById('repairPolyFinishOpen').addEventListener('click', ()=>{
  if(repairState.drawBuffer.length<2) return;
  repairPushHistory();
  repairAddEntity(repairState.drawBuffer, false);
  repairState.drawBuffer = [];
  repairRefresh();
});
document.getElementById('repairPolyFinishClosed') && document.getElementById('repairPolyFinishClosed').addEventListener('click', ()=>{
  if(repairState.drawBuffer.length<3) return;
  repairPushHistory();
  repairAddEntity(repairState.drawBuffer, true);
  repairState.drawBuffer = [];
  repairRefresh();
});

document.getElementById('repairAutoBtn').addEventListener('click', async ()=>{
  const n = await repairAutoFix();
  repairRefresh();
  document.getElementById('repairToolHint').textContent = n
    ? `Se unieron ${n} punto(s) automáticamente.` : 'No encontró puntos lo bastante cerca — probá subir la tolerancia o unilos a mano.';
});
document.getElementById('repairUndoBtn').addEventListener('click', ()=>{
  if(!repairState.history.length) return;
  repairState.entities = repairState.history.pop();
  repairState.manualFirst = null;
  repairState.selectedId = null;
  if(!repairState.history.length) document.getElementById('repairUndoBtn').disabled = true;
  repairRefresh();
});
document.getElementById('repairDropzone').addEventListener('click', ()=>document.getElementById('repairFileInput').click());
document.getElementById('repairFileInput').addEventListener('change', e=>repairHandleFiles(e.target.files));
document.getElementById('repairNewBtn').addEventListener('click', repairNewBlank);
const repairDz = document.getElementById('repairDropzone');
repairDz.addEventListener('dragover', e=>{e.preventDefault(); repairDz.style.borderColor='var(--accent)';});
repairDz.addEventListener('dragleave', ()=>{repairDz.style.borderColor='var(--line)';});
repairDz.addEventListener('drop', e=>{e.preventDefault(); repairDz.style.borderColor='var(--line)'; repairHandleFiles(e.dataTransfer.files);});
function repairHandleFiles(fileList){
  const file = fileList[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ev=> repairSetFile(ev.target.result, file.name);
  reader.readAsText(file);
}

document.getElementById('repairDownloadBtn').addEventListener('click', ()=>{
  const loops = repairBuildLoops();
  if(!loops.length){ alert('No se encontró ningún contorno cerrado para exportar.'); return; }
  let dxf = DXF_HEADER;
  loops.forEach((loop,i)=>{ dxf += dxfPoly(loop, safeLayer(repairState.fileBase+'_'+(i+1))); });
  dxf += DXF_FOOTER;
  downloadBlob(dxf, `${repairState.fileBase}.dxf`, 'application/dxf');
});
document.getElementById('repairSendBtn').addEventListener('click', ()=>{
  const loops = repairBuildLoops();
  if(!loops.length){ alert('No se encontró ningún contorno cerrado para exportar.'); return; }
  loops.sort((a,b)=>polyArea(b)-polyArea(a));
  pieces.push(createPiece(newPieceId(), repairState.fileBase, loops[0]));
  renderPieceTable();
  switchView('nesting');
});
