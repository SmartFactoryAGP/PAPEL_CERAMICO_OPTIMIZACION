const nestingState = {
  running:false, stop:false,
  attemptLog:[], attemptCount:0, attemptsById:new Map(), snapshotOrder:[],
  previewingId:null, liveSheetW:null, liveChapaLen:null, liveChapas:null
};
const SNAPSHOT_CAP = 50; // cuántos intentos recientes guardan su plano en memoria

function fmtPct(x){ return (x*100).toFixed(1)+'%'; }

/* Para guardar una "foto" de un intento sin cargar con las grillas internas
   de cada chapa (occ/psum/skyline — pueden pesar varios MB cada una): el
   render solo necesita .placed, así que un snapshot liviano solo copia eso. */
function lightChapas(chapasArr){
  return chapasArr.map(c=>({placed:c.placed}));
}

/* Registra un intento en el panel — cada vez que el motor prueba un
   acomodo (le sirva o no), queda una línea acá para que se vea EXACTAMENTE
   qué probó, con qué piezas jugó y si lo dejó o lo descartó.
   Si el intento produjo un plano válido (entry.chapasSnapshot), esa línea
   queda clicable para poder ver esas chapas. Para no ir sumando memoria
   mientras corre horas, solo se retiene el plano de los últimos
   SNAPSHOT_CAP intentos — el texto de todos se conserva igual. */
function logAttempt(entry){
  nestingState.attemptCount++;
  entry.n = nestingState.attemptCount;
  entry.id = 'a'+entry.n;
  nestingState.attemptLog.push(entry);
  nestingState.attemptsById.set(entry.id, entry);

  if(entry.chapasSnapshot){
    nestingState.snapshotOrder.push(entry.id);
    if(nestingState.snapshotOrder.length>SNAPSHOT_CAP){
      const oldId = nestingState.snapshotOrder.shift();
      const oldEntry = nestingState.attemptsById.get(oldId);
      if(oldEntry){ oldEntry.chapasSnapshot=null; markEntryStale(oldId); }
    }
  }

  appendAttemptDOM(entry);

  if(nestingState.attemptLog.length>500){
    const removed = nestingState.attemptLog.shift();
    nestingState.attemptsById.delete(removed.id);
    const node = document.querySelector(`#logList .logEntry[data-id="${removed.id}"]`);
    if(node) node.remove();
  }
  updateLogFoot();
}
function markEntryStale(id){
  const el = document.querySelector(`#logList .logEntry[data-id="${id}"]`);
  if(el) el.classList.add('noSnap');
}
function resetAttemptLog(){
  nestingState.attemptLog=[]; nestingState.attemptCount=0;
  nestingState.attemptsById.clear(); nestingState.snapshotOrder=[];
  nestingState.previewingId=null; nestingState.liveChapas=null;
  const list=document.getElementById('logList'); if(list) list.innerHTML='';
  const foot=document.getElementById('logFoot'); if(foot) foot.textContent='—';
  hidePreviewBanner();
}
/* Agrega solo el DOM del intento nuevo (no redibuja los 500 anteriores en
   cada intento — eso era otra causa de que la página se sintiera pesada). */
function appendAttemptDOM(entry){
  const list = document.getElementById('logList');
  if(!list) return;
  const deltaTxt = (entry.delta==null) ? '' :
    (entry.delta>0.05 ? `<span class="delta up">+${entry.delta.toFixed(1)} pp</span>` : `<span class="delta">sin cambio</span>`);
  const div = document.createElement('div');
  div.className = 'logEntry'+(entry.kept?' kept':'')+(entry.chapasSnapshot?'':' noSnap');
  div.setAttribute('data-id', entry.id);
  div.innerHTML =
    `<div class="dot"></div>
     <div class="body">
       <div class="line1"><span>#${entry.n} · ${entry.label}</span>${deltaTxt}</div>
       <div class="line2">${entry.detail}</div>
     </div>`;
  list.appendChild(div);
}
function updateLogFoot(){
  const foot = document.getElementById('logFoot');
  if(!foot) return;
  const kept = nestingState.attemptLog.filter(e=>e.kept);
  const last = kept.length ? kept[kept.length-1] : null;
  foot.textContent = `${nestingState.attemptCount} intento(s) probados · mejor hasta ahora: ${last ? last.utilTxt : '—'} · clic en un intento para ver sus chapas`;
}

/* --- vista previa de un intento: muestra sus chapas en el panel derecho --- */
document.getElementById('logList').addEventListener('click', (ev)=>{
  const row = ev.target.closest('.logEntry');
  if(!row) return;
  const entry = nestingState.attemptsById.get(row.getAttribute('data-id'));
  if(!entry || !entry.chapasSnapshot) return; // sin plano guardado (ya se liberó o no generó uno)
  previewAttempt(entry);
});
function previewAttempt(entry){
  nestingState.previewingId = entry.id;
  renderChapas(entry.sheetW, entry.chapaLen, entry.chapasSnapshot);
  document.querySelectorAll('#logList .logEntry.selected').forEach(el=>el.classList.remove('selected'));
  const el = document.querySelector(`#logList .logEntry[data-id="${entry.id}"]`);
  if(el) el.classList.add('selected');
  const banner = document.getElementById('previewBanner');
  document.getElementById('previewBannerText').textContent =
    `Viendo intento #${entry.n} · ${entry.label} — ${entry.detail}`;
  banner.style.display='flex';
}
function hidePreviewBanner(){
  const banner = document.getElementById('previewBanner');
  if(banner) banner.style.display='none';
  document.querySelectorAll('#logList .logEntry.selected').forEach(el=>el.classList.remove('selected'));
}
function exitPreview(){
  nestingState.previewingId = null;
  hidePreviewBanner();
  if(nestingState.liveChapas) renderChapas(nestingState.liveSheetW, nestingState.liveChapaLen, nestingState.liveChapas);
}
document.getElementById('exitPreviewBtn').addEventListener('click', exitPreview);
/* actualiza la vista en vivo — si estás mirando un intento viejo, no lo pisa */
function renderLive(sheetW, chapaLen, chapas){
  nestingState.liveSheetW=sheetW; nestingState.liveChapaLen=chapaLen; nestingState.liveChapas=chapas;
  if(nestingState.previewingId) return;
  renderChapas(sheetW, chapaLen, chapas);
}

document.getElementById('closeLogBtn').addEventListener('click', ()=>{
  document.getElementById('logOverlay').style.display='none';
  document.getElementById('reopenLogBtn').style.display = 'block';
});
document.getElementById('reopenLogBtn').addEventListener('click', ()=>{
  document.getElementById('logOverlay').style.display='flex';
  document.getElementById('reopenLogBtn').style.display='none';
});

