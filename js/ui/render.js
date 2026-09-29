/* =========================================================
   DIBUJO DE CHAPA (pantalla y PDF)
   ========================================================= */
function utilColor(pct){
  if(pct>=85) return '#22a355';
  if(pct>=70) return '#d98a1f';
  return '#e0453a';
}
/* la firma ahora incluye posiciones/rotaciones => sólo agrupa chapas idénticas de verdad */
function drawChapaToCanvas(chapa, sheetW, chapaLen, idMap, pxPerMM, opts){
  opts = opts || {};
  const effLen = opts.effLen!=null ? opts.effLen : chapaLen;
  const showTrim = effLen < chapaLen-0.01 && opts.showTrimLabel!==false;
  const marginL=34, marginT= showTrim ? 28 : 18, marginR=8, marginB=8;
  const w = Math.round(sheetW*pxPerMM), h = Math.round(chapaLen*pxPerMM);
  const canvas = document.createElement('canvas');
  canvas.width = w+marginL+marginR;
  canvas.height = h+marginT+marginB;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);

  ctx.save();
  ctx.translate(marginL, canvas.height-marginB);
  ctx.scale(pxPerMM, -pxPerMM);
  // si hay recorte (rollo), el sobrante que no se corta se ve atenuado
  if(effLen < chapaLen-0.01){
    ctx.fillStyle='rgba(0,0,0,.05)';
    ctx.fillRect(0, effLen, sheetW, chapaLen-effLen);
  }
  ctx.strokeStyle='#dddddd'; ctx.lineWidth=0.4/pxPerMM;
  for(let gx=0; gx<=sheetW; gx+=200){ ctx.beginPath(); ctx.moveTo(gx,0); ctx.lineTo(gx,chapaLen); ctx.stroke(); }
  for(let gy=0; gy<=chapaLen; gy+=200){ ctx.beginPath(); ctx.moveTo(0,gy); ctx.lineTo(sheetW,gy); ctx.stroke(); }
  // borde nominal del rollo/chapa, punteado si se va a recortar
  ctx.strokeStyle='#9aa5b1'; ctx.lineWidth=1/pxPerMM;
  if(effLen < chapaLen-0.01){ ctx.setLineDash([6/pxPerMM,4/pxPerMM]); }
  ctx.strokeRect(0,0,sheetW,chapaLen);
  ctx.setLineDash([]);
  // borde real de corte (largo efectivo)
  ctx.strokeStyle='#2e8b3d'; ctx.lineWidth=2/pxPerMM;
  ctx.strokeRect(0,0,sheetW,effLen);

  const labels=[];
  for(const p of chapa.placed){
    const absPts = p.rp.map(([x,y])=>[x+p.x, y+p.y]);
    ctx.beginPath();
    absPts.forEach(([x,y],i)=> i===0?ctx.moveTo(x,y):ctx.lineTo(x,y));
    ctx.closePath();
    // los agujeros interiores se agregan al MISMO trazado, y se rellena
    // con la regla "evenodd" — así quedan realmente huecos (se ve el fondo
    // blanco de la chapa) en vez de rellenos del color de la pieza.
    if(p.holes) p.holes.forEach(loop=>{
      const abs = loop.map(([x,y])=>[x+p.x, y+p.y]);
      abs.forEach(([x,y],i)=> i===0?ctx.moveTo(x,y):ctx.lineTo(x,y));
      ctx.closePath();
    });
    ctx.fillStyle=p.color; ctx.strokeStyle='#333'; ctx.lineWidth=1/pxPerMM;
    ctx.fill('evenodd'); ctx.stroke();
    // Bloque 4: el grabado se marca punteado y en otro color, para que se
    // distinga del corte a simple vista en la vista previa y en el PDF.
    if(p.engrave) p.engrave.forEach(loop=>{
      const abs = loop.map(([x,y])=>[x+p.x, y+p.y]);
      ctx.beginPath();
      abs.forEach(([x,y],i)=> i===0?ctx.moveTo(x,y):ctx.lineTo(x,y));
      ctx.closePath();
      ctx.strokeStyle='#c0392b'; ctx.lineWidth=1/pxPerMM;
      ctx.setLineDash([3/pxPerMM,2/pxPerMM]);
      ctx.stroke();
      ctx.setLineDash([]);
    });
    const c = absPts.reduce((acc,pt)=>[acc[0]+pt[0],acc[1]+pt[1]],[0,0]).map(v=>v/absPts.length);
    labels.push({c, id: idMap.get(p.pieceId), rot:p.rot, mirror:p.mirror});
  }
  ctx.restore();

  // tamaño de letra: si viene explícito en opts (usado por el PDF, ya calculado
  // para verse grande en la hoja impresa) se respeta tal cual; si no, se usa la
  // fórmula anterior ligada a la escala de pantalla (vista previa en la página).
  const idFontPx = opts.idFontPx || Math.max(10, Math.round(pxPerMM*13));
  const rotFontPx = opts.rotFontPx || Math.max(7, Math.round(pxPerMM*7));
  const showRot = opts.showRot !== undefined ? opts.showRot : (pxPerMM>0.45);

  ctx.textAlign='center'; ctx.textBaseline='middle';
  for(const L of labels){
    const px = marginL + L.c[0]*pxPerMM;
    const py = canvas.height - marginB - L.c[1]*pxPerMM;
    ctx.fillStyle='#111'; ctx.font='bold '+idFontPx+'px monospace';
    ctx.fillText(String(L.id) + (L.mirror?'ᴹ':''), px, py);
    if(showRot){
      ctx.fillStyle='#555'; ctx.font=rotFontPx+'px monospace';
      ctx.fillText(L.rot+'°', px, py + Math.max(9, rotFontPx*1.5));
    }
  }

  ctx.fillStyle='#000'; ctx.font='9px monospace'; ctx.strokeStyle='#000'; ctx.lineWidth=1;
  ctx.textAlign='center'; ctx.textBaseline='bottom';
  for(let gx=0; gx<=sheetW; gx+=200){
    const px = marginL+gx*pxPerMM;
    ctx.beginPath(); ctx.moveTo(px, marginT-4); ctx.lineTo(px, marginT); ctx.stroke();
    ctx.fillText(String(gx), px, marginT-5);
  }
  ctx.textAlign='right'; ctx.textBaseline='middle';
  for(let gy=0; gy<=chapaLen; gy+=200){
    const py = canvas.height-marginB-gy*pxPerMM;
    ctx.beginPath(); ctx.moveTo(marginL-4, py); ctx.lineTo(marginL, py); ctx.stroke();
    ctx.fillText(String(gy), marginL-6, py);
  }
  if(showTrim){
    ctx.textAlign='left'; ctx.textBaseline='top'; ctx.fillStyle='#2e8b3d';
    ctx.font='bold 10px monospace';
    ctx.fillText(`Corte real: ${Math.ceil(effLen)} mm (de ${chapaLen} mm nominal)`, marginL, 1);
  }
  return canvas;
}

function renderChapas(sheetW, chapaLen, chapas){
  const wrap = document.getElementById('chapasWrap');
  wrap.innerHTML='';
  if(!chapas.length){ wrap.innerHTML = '<div class="empty">Sin piezas colocadas.</div>'; return; }
  const idMap = buildIdMap();
  const groups = groupChapas(chapas, idMap);
  const pxPerMM = Math.min(320/sheetW, 340/chapaLen, 0.6);
  groups.forEach(g=>{
    const box = document.createElement('div');
    box.className='chapaBox';
    const header = document.createElement('div');
    header.style.cssText='display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:700;padding:0 2px 3px;gap:8px';
    const effLen = effChapaLen(g.chapa, chapaLen);
    const pct = utilOf(g.chapa, sheetW, effLen);
    const repeatHtml = g.indices.length>1 ? `<span class="repeatTag">×${g.indices.length}</span>` : '';
    const mir = g.chapa.placed.filter(p=>p.mirror).length;
    const mirHtml = mir ? `<span class="mirrorTag">${mir} esp.</span>` : '';
    header.innerHTML = `<span style="color:#f1f3fb">Chapa ${g.indices.join(', ')}${repeatHtml}${mirHtml}</span><span style="color:${utilColor(pct)}">${pct.toFixed(1)}%</span>`;
    box.appendChild(header);
    const canvas = drawChapaToCanvas(g.chapa, sheetW, chapaLen, idMap, pxPerMM, {effLen});
    canvas.style.maxWidth='340px'; canvas.style.height='auto'; canvas.style.display='block';
    box.appendChild(canvas);
    wrap.appendChild(box);
  });
}

function updateStats(sheetW, chapaLen, chapas, jobCount, unplacedCount, ms){
  const totalPlaced = chapas.reduce((s,c)=>s+c.placed.length,0);
  const pieceArea = chapas.reduce((s,c)=>s+c.placed.reduce((s2,p)=>s2+p.area,0),0);
  const sheetArea = chapas.reduce((s,c)=>s+sheetW*effChapaLen(c, chapaLen), 0);
  const util = sheetArea>0 ? pieceArea/sheetArea*100 : 0;
  const idMap = buildIdMap();
  const groups = groupChapas(chapas, idMap);
  document.getElementById('stChapas').textContent = chapas.length;
  document.getElementById('stUnique').textContent = groups.length;
  document.getElementById('stPlaced').textContent = `${totalPlaced} / ${jobCount}`;
  const unRow = document.getElementById('stUnplacedRow');
  if(unplacedCount>0){ unRow.style.display='flex'; document.getElementById('stUnplaced').textContent = unplacedCount+' (no caben)'; }
  else unRow.style.display='none';
  document.getElementById('stMirrored').textContent = countMirrored(chapas);
  const totalEffLen = chapas.reduce((s,c)=>s+effChapaLen(c, chapaLen), 0);
  const totalNomLen = chapaLen*chapas.length;
  document.getElementById('stRollLen').textContent =
    isTrimEnabled() ? `${totalEffLen.toFixed(0)} mm (nominal ${totalNomLen.toFixed(0)} mm)` : `${totalNomLen.toFixed(0)} mm`;
  document.getElementById('stArea').textContent = (pieceArea/1e6).toFixed(3)+' m²';
  document.getElementById('stSheet').textContent = (sheetArea/1e6).toFixed(3)+' m²';
  document.getElementById('stUtil').textContent = util.toFixed(1)+' %';
  document.getElementById('stWaste').textContent = (100-util).toFixed(1)+' %';
  document.getElementById('stTime').textContent = ms.toFixed(0)+' ms';
}
