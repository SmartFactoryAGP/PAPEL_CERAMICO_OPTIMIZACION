let pieces = [];   // {id,name,points,fast,area,perimeter,bbox,qty,color,error}
const PALETTE = ['#ff8a5c','#2ee6c4','#ffc857','#5eb3ff','#c792ff','#8ee06b','#ffd23f','#4fd1e8','#ff6fa5','#9ee55a'];
let lastResult = null;

function buildIdMap(){
  const m = new Map(); let i=0;
  pieces.forEach(p=>{ if(p.points){ i++; m.set(p.id,i); } });
  return m;
}

/* ---------- carga de archivos ---------- */
document.getElementById('dropzone').addEventListener('click', ()=>document.getElementById('fileInput').click());
document.getElementById('fileInput').addEventListener('change', e=>handleFiles(e.target.files));
const dz = document.getElementById('dropzone');
dz.addEventListener('dragover', e=>{e.preventDefault(); dz.style.borderColor='var(--accent)';});
dz.addEventListener('dragleave', ()=>{dz.style.borderColor='var(--line)';});
dz.addEventListener('drop', e=>{e.preventDefault(); dz.style.borderColor='var(--line)'; handleFiles(e.dataTransfer.files);});

function handleFiles(fileList){
  [...fileList].forEach(file=>{
    const reader = new FileReader();
    reader.onload = ev=>{
      const text = ev.target.result;
      let entities = [];
      try { entities = parseDXFEntities(text); } catch(err){ entities = []; }
      const layers = detectLayers(entities);
      if(layers.length<=1){
        // un solo layer (o ninguno) -> se comporta exactamente igual que
        // siempre, sin preguntar nada.
        addPieceFromLayers(file.name, entities, {[layers[0]||'0']:'cut'});
      } else {
        layerQueue.push({fileName:file.name, entities, layers});
        layerQueueTotal++;
        processLayerQueue();
      }
    };
    reader.readAsText(file);
  });
}

function addPieceFromLayers(fileName, entities, layerMap){
  let result = null, error = null;
  try {
    result = buildLayeredGeometry(entities, layerMap);
    if(!result) error = 'sin contorno cerrado';
  } catch(err){ error = 'error de lectura'; }
  const poly = result ? result.mainPoly : null;
  const engraveLoops = result && result.engraveLoops && result.engraveLoops.length ? result.engraveLoops : null;
  const holes = result && result.holes && result.holes.length ? result.holes : null;
  const bbox = poly ? polyBBox(poly) : null;
  pieces.push({
    id: 'p'+Date.now()+Math.random().toString(16).slice(2,6),
    name: fileName.replace(/\.(dxf|DXF)$/,''),
    points: poly,
    fast: poly ? simplify(poly, 0.8) : null,  // versión ligera para el nesting
    engraveLoops,  // Bloque 4: geometría de grabado, en las mismas coordenadas locales de la pieza
    holes,         // agujeros interiores (se cortan, van en la misma capa que el contorno)
    bbox,
    area: poly ? polyArea(poly) : 0,
    perimeter: poly ? polyPerimeter(poly) : 0,
    qty: poly ? 1 : 0,
    color: PALETTE[pieces.length % PALETTE.length],
    error
  });
  renderPieceTable();
}

/* Bloque 4: cuando un DXF tiene más de una capa, se le pregunta al usuario
   qué es cada una (Corte / Grabado / Ignorar) antes de armar la pieza. Si
   caen varios archivos con capas a la vez, se procesan de a uno. */
const layerQueue = [];
let layerModalBusy = false;
// cuántos archivos con capas se soltaron juntos en el drop actual, para
// poder mostrar "archivo 2 de 5" en el modal — sin esto, alguien que
// arrastra una carpeta entera con varios DXF de varias capas no tiene
// forma de saber cuántas preguntas más le quedan por responder.
let layerQueueTotal = 0;
function processLayerQueue(){
  if(layerModalBusy || !layerQueue.length) return;
  layerModalBusy = true;
  const job = layerQueue.shift();
  const posicion = layerQueueTotal - layerQueue.length;
  showLayerModal(job, posicion, layerQueueTotal, (layerMap)=>{
    addPieceFromLayers(job.fileName, job.entities, layerMap);
    layerModalBusy = false;
    if(!layerQueue.length) layerQueueTotal = 0;
    processLayerQueue();
  });
}
function showLayerModal(job, posicion, total, onConfirm){
  const overlay = document.getElementById('layerModal');
  const list = document.getElementById('layerModalList');
  document.getElementById('layerModalFile').textContent =
    total>1 ? `${job.fileName}  (archivo ${posicion} de ${total})` : job.fileName;
  list.innerHTML = job.layers.map(layerName=>{
    const guess = guessLayerOp(layerName);
    return `<div class="layerRow" data-layer="${layerName.replace(/"/g,'&quot;')}">
      <span class="layerName">${layerName || '(sin nombre)'}</span>
      <select class="layerOpSelect">
        <option value="cut" ${guess==='cut'?'selected':''}>Corte</option>
        <option value="engrave" ${guess==='engrave'?'selected':''}>Grabado</option>
        <option value="ignore">Ignorar</option>
      </select>
    </div>`;
  }).join('');
  overlay.style.display='flex';
  document.getElementById('layerModalConfirm').onclick = ()=>{
    const map = {};
    list.querySelectorAll('.layerRow').forEach(row=>{
      map[row.getAttribute('data-layer')] = row.querySelector('.layerOpSelect').value;
    });
    overlay.style.display='none';
    onConfirm(map);
  };
}

function renderPieceTable(){
  const wrap = document.getElementById('pieceTable');
  const empty = document.getElementById('emptyMsg');
  const body = document.getElementById('pieceBody');
  if(!pieces.length){ wrap.style.display='none'; empty.style.display='block'; return; }
  wrap.style.display='table'; empty.style.display='none';
  body.innerHTML='';
  const idMap = buildIdMap();
  pieces.forEach((p,idx)=>{
    const tr = document.createElement('tr');
    const tdThumb = document.createElement('td');
    const canvas = document.createElement('canvas');
    canvas.className='thumb'; canvas.width=72; canvas.height=52;
    tdThumb.appendChild(canvas); tr.appendChild(tdThumb);

    const tdName = document.createElement('td');
    tdName.className='name'; tdName.title=p.name;
    const badge = p.points ? `<span class="idbadge">${idMap.get(p.id)}</span>` : '';
    const autoTag = p.isStrip ? `<span class="mirrorTag" style="background:var(--accent3-soft);color:var(--accent3)" title="Generada automáticamente por el sistema a partir del sobrante">AUTO</span>` : '';
    const engraveTag = p.engraveLoops ? `<span class="mirrorTag" style="background:var(--accent2-soft);color:var(--accent2)" title="Esta pieza también tiene líneas de grabado, se llevan con ella">GRABADO</span>` : '';
    const holesTag = p.holes ? `<span class="mirrorTag" style="background:var(--info-soft,rgba(94,179,255,.15));color:var(--info)" title="${p.holes.length} agujero(s) interior(es) detectado(s) — se cortan junto con la pieza">${p.holes.length} AGUJERO${p.holes.length===1?'':'S'}</span>` : '';
    tdName.innerHTML = badge + (p.error ? `${p.name}<div class="err">${p.error}</div>` : p.name) + autoTag + engraveTag + holesTag;
    tr.appendChild(tdName);

    const tdDim = document.createElement('td');
    tdDim.textContent = p.bbox ? `${p.bbox.w.toFixed(0)}×${p.bbox.h.toFixed(0)}` : '—';
    tr.appendChild(tdDim);

    const tdQty = document.createElement('td');
    const qtyInput = document.createElement('input');
    qtyInput.type='number'; qtyInput.className='qtyinput'; qtyInput.min=0; qtyInput.value=p.qty;
    qtyInput.disabled = !p.points || p.isStrip;
    if(p.isStrip) qtyInput.title='Se recalcula solo en cada corrida — no se edita a mano';
    qtyInput.oninput = ()=>{
      // un "-5" tipeado a mano (fácil con un guion perdido) pasaba parseInt
      // tal cual (no da NaN), y la pieza quedaba con cantidad negativa: el
      // filtro qty>0 del nesting la sacaba en silencio, sin ningún aviso —
      // parecía que la pieza "desaparecía". Ahora se recorta a 0 y además
      // se corrige lo que se ve en el campo, para que no quede "-5" en
      // pantalla con 0 piezas activas por detrás.
      p.qty = Math.max(0, parseInt(qtyInput.value)||0);
      if(String(p.qty) !== qtyInput.value) qtyInput.value = p.qty;
    };
    tdQty.appendChild(qtyInput); tr.appendChild(tdQty);

    const tdRm = document.createElement('td');
    const rm = document.createElement('span'); rm.className='rm'; rm.textContent='✕';
    rm.onclick = ()=>{ pieces.splice(idx,1); renderPieceTable(); };
    tdRm.appendChild(rm); tr.appendChild(tdRm);

    body.appendChild(tr);
    if(p.points) drawThumb(canvas, p.points, p.color, p.holes);
  });
}
function drawThumb(canvas, pts, color, holes){
  const ctx = canvas.getContext('2d');
  const bb = polyBBox(pts);
  const pad=4;
  const scale = Math.min((canvas.width-pad*2)/bb.w, (canvas.height-pad*2)/bb.h);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.save();
  ctx.translate(pad, canvas.height-pad);
  ctx.scale(scale,-scale);
  ctx.beginPath();
  pts.forEach(([x,y],i)=> i===0?ctx.moveTo(x-bb.minx,y-bb.miny):ctx.lineTo(x-bb.minx,y-bb.miny));
  ctx.closePath();
  if(holes) holes.forEach(loop=>{
    loop.forEach(([x,y],i)=> i===0?ctx.moveTo(x-bb.minx,y-bb.miny):ctx.lineTo(x-bb.minx,y-bb.miny));
    ctx.closePath();
  });
  ctx.fillStyle=color+'aa'; ctx.fill('evenodd');
  ctx.strokeStyle=color; ctx.lineWidth=1.5/scale; ctx.stroke();
  ctx.restore();
}

/* =========================================================
   NESTING v2 — orientaciones (rotación libre + espejo) y
   colocación bottom-left con puntaje de contacto
   ========================================================= */

/* ---------------------------------------------------------
   Máscaras de orientación en formato "spans por fila".
   Cada fila de la pieza se guarda como pares [xIni, xFin]
   contiguos. Eso permite testear colisión y contacto en
   O(filas) usando conteos acumulados, no celda por celda.
   --------------------------------------------------------- */
