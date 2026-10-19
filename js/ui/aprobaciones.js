/* =========================================================
   APROBACIONES DE ZFER (papel cerámico)
   =========================================================
   Las piezas CURVE de nivel 02, 03 o 04 entran a Lista de corte solo si su
   ZFER está aprobado. Acá el operario lo pide (desde la lista de "sin
   aprobar" o escribiéndolo) y quien tenga el permiso "Aprobar ZFER" lo
   aprueba, lo rechaza o le quita la aprobación. Todo se valida de nuevo en
   el puente (server/aprobaciones.js); esta pantalla es la forma cómoda.
   Los cambios llegan en vivo a las demás PCs (aviso "aprobaciones"). */
let apDatos = { solicitudes: [], candidatos: [], puedeAprobar: false, usuario: '' };
let apFiltro = 'pendiente';
let apDetalleElegido = null; // detalle del candidato elegido con "Pedir" (órdenes, niveles, modelos)

const AP_ESTADOS = { pendiente: 'Pendiente', aprobada: 'Aprobado', rechazada: 'Rechazado' };
const apPuedeAprobar = () => typeof authPuede==='function' && authPuede('papel', 'aprobar');

async function apPedir(metodo, ruta, cuerpo){
  const res = await fetch(ordBridgeUrl()+'/api/aprobaciones'+(ruta||''), {
    method: metodo,
    // la vista es de papel cerámico aunque el badge se actualice desde otra área
    headers: ordApiHeaders(Object.assign({'x-area':'papel'}, cuerpo ? {'Content-Type':'application/json'} : {})),
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || ('HTTP '+res.status));
  return data;
}

/* Trae todo y dibuja. conCandidatos=false: solo las solicitudes (rápido,
   sin consultar SQL) — lo usa el aviso en vivo y el contador de la pestaña. */
async function apCargar(conCandidatos = true){
  try {
    const d = await apPedir('GET', conCandidatos ? '' : '?candidatos=0');
    apDatos.solicitudes = d.solicitudes || [];
    apDatos.puedeAprobar = !!d.puedeAprobar;
    apDatos.usuario = d.usuario || '';
    if(conCandidatos){ apDatos.candidatos = d.candidatos; apDatos.errorCandidatos = d.errorCandidatos; }
  } catch(e){
    document.getElementById('apLista').innerHTML = `<div class="empty">No se pudieron traer las solicitudes: ${escapeHtml(e.message)}</div>`;
    return;
  }
  apDibujar();
}

function apDibujar(){
  const s = apDatos.solicitudes;
  const cuenta = est => s.filter(x=>x.estado===est).length;
  document.getElementById('apKpiPend').textContent = cuenta('pendiente');
  document.getElementById('apKpiAprob').textContent = cuenta('aprobada');
  document.getElementById('apKpiRech').textContent = cuenta('rechazada');
  document.getElementById('apRolNota').textContent = apDatos.puedeAprobar
    ? 'Tenés permiso para aprobar: lo que apruebes entra a Lista de corte al instante, en todas las PCs.'
    : 'Las aprueba la persona con permiso "Aprobar ZFER". Esta pantalla se actualiza sola.';
  apActualizarBadgeCon(s);
  apDibujarCandidatos();
  apDibujarLista();
}

function apDibujarCandidatos(){
  const wrap = document.getElementById('apCandidatos');
  const c = apDatos.candidatos;
  document.getElementById('apCandCount').textContent = Array.isArray(c) ? c.length : '—';
  if(apDatos.errorCandidatos){ wrap.innerHTML = `<div class="empty">No se pudo revisar la lista de corte: ${escapeHtml(apDatos.errorCandidatos)}</div>`; return; }
  if(!Array.isArray(c)){ wrap.innerHTML = '<div class="empty">Cargando…</div>'; return; }
  if(!c.length){ wrap.innerHTML = '<div class="empty">No hay piezas CURVE 02–04 esperando aprobación en la lista de hoy.</div>'; return; }
  wrap.innerHTML = c.map(x=>`
    <div class="apCand">
      <div class="apCandTxt">
        <b class="mono">${escapeHtml(x.zfer)}</b>
        ${x.vehiculos && x.vehiculos.length ? `<span class="apVehiculo">${escapeHtml(x.vehiculos.join(' · '))}</span>` : ''}
        <small>${x.cantidad} ${x.cantidad===1?'orden':'órdenes'} · nivel ${escapeHtml(x.niveles.join(', '))}${x.modelos.length ? ' · '+escapeHtml(x.modelos.join(', ')) : ''}</small>
      </div>
      <button type="button" class="secondary btnSm" data-pedir="${escapeHtml(x.zfer)}">Pedir</button>
    </div>`).join('');
}

const apFecha = iso => iso ? new Date(iso).toLocaleString('es-CO', {dateStyle:'short', timeStyle:'short'}) : '';
function apDibujarLista(){
  const wrap = document.getElementById('apLista');
  const lista = apDatos.solicitudes.filter(x=>!apFiltro || x.estado===apFiltro);
  if(!lista.length){
    const vacio = { pendiente: 'No hay solicitudes pendientes.', aprobada: 'Todavía no hay ningún ZFER aprobado.', rechazada: 'No hay solicitudes rechazadas.' }[apFiltro] || 'Todavía no hay solicitudes.';
    wrap.innerHTML = `<div class="empty">${vacio}</div>`;
    return;
  }
  const filas = lista.map(x=>{
    const d = x.detalle;
    const detalle = d && d.ordenes && d.ordenes.length
      ? `<small>${d.vehiculos && d.vehiculos.length ? escapeHtml(d.vehiculos.join(' · '))+' · ' : ''}${d.ordenes.length} ${d.ordenes.length===1?'orden':'órdenes'}${d.niveles && d.niveles.length ? ' · nivel '+escapeHtml(d.niveles.join(', ')) : ''}${d.modelos && d.modelos.length ? ' · '+escapeHtml(d.modelos.join(', ')) : ''}</small>` : '';
    const resolucion = x.estado==='pendiente' ? '<span class="hint">—</span>'
      : `${escapeHtml(x.resueltoPor||'')} <small>${escapeHtml(apFecha(x.resueltoEn))}</small>${x.motivo ? `<small class="apMotivo">${escapeHtml(x.motivo)}</small>` : ''}`;
    return `<tr data-zfer="${escapeHtml(x.zfer)}">
      <td>${escapeHtml(x.zfer)}</td>
      <td><span class="movTag ap-${x.estado}">${AP_ESTADOS[x.estado]||escapeHtml(x.estado)}</span></td>
      <td>${escapeHtml(x.solicitadoPor||'')} <small>${escapeHtml(apFecha(x.solicitadoEn))}</small></td>
      <td class="apNotaCol">${x.nota ? escapeHtml(x.nota) : '<span class="hint">sin nota</span>'}${detalle}</td>
      <td class="apNotaCol">${resolucion}</td>
      <td class="rowActions">${apAccionesHtml(x)}</td>
    </tr>`;
  }).join('');
  wrap.innerHTML = `<table class="ordTable apTabla"><thead><tr><th>ZFER</th><th>Estado</th><th>Pedido por</th><th>Motivo del pedido</th><th>Resolución</th><th></th></tr></thead><tbody>${filas}</tbody></table>`;
}
function apAccionesHtml(x){
  if(x.estado==='rechazada') return `<button type="button" class="linkBtn" data-repedir="${escapeHtml(x.zfer)}">Volver a pedir</button>`;
  if(!apDatos.puedeAprobar) return '';
  const motivo = `<input type="text" class="apMotivoInput" maxlength="300" placeholder="Motivo (para rechazar)" aria-label="Motivo">`;
  if(x.estado==='pendiente'){
    const propia = x.solicitadoPor===apDatos.usuario && !(typeof authEsAdmin==='function' && authEsAdmin());
    return `<div class="apAcciones">${motivo}
      <button type="button" class="btnSm apAprobar" data-decision="aprobar" ${propia ? 'disabled title="La pediste vos: la tiene que aprobar otra persona"' : ''}>Aprobar</button>
      <button type="button" class="secondary btnSm" data-decision="rechazar">Rechazar</button></div>`;
  }
  if(x.estado==='aprobada') return `<div class="apAcciones">${motivo}<button type="button" class="secondary btnSm" data-decision="revocar">Quitar aprobación</button></div>`;
  return '';
}

function apMensaje(texto, tipo){
  const el = document.getElementById('apFormMsg');
  el.textContent = texto || ' ';
  el.className = 'hint' + (tipo ? ' msg-'+tipo : '');
}
function apElegirZfer(zfer){
  const c = (apDatos.candidatos||[]).find(x=>x.zfer===zfer);
  apDetalleElegido = c ? { ordenes: c.ordenes, niveles: c.niveles, modelos: c.modelos, vehiculos: c.vehiculos } : null;
  document.getElementById('apZfer').value = zfer;
  apMensaje(c ? `${c.cantidad} orden(es) de este ZFER esperan. Si querés, contá por qué lleva papel y tocá "Pedir aprobación".` : '');
  document.getElementById('apNota').focus();
}

async function apSolicitar(){
  const zfer = document.getElementById('apZfer').value.trim();
  if(!zfer){ apMensaje('Escribí el ZFER.', 'error'); document.getElementById('apZfer').focus(); return; }
  const btn = document.getElementById('apSolicitarBtn');
  btn.disabled = true;
  try {
    const detalle = apDetalleElegido && document.getElementById('apZfer').value.trim().toUpperCase()===zfer.toUpperCase() ? apDetalleElegido : null;
    const f = await apPedir('POST', '/solicitar', { zfer, nota: document.getElementById('apNota').value, detalle });
    document.getElementById('apZfer').value = '';
    document.getElementById('apNota').value = '';
    apDetalleElegido = null;
    apMensaje(`Listo: el ZFER ${f.zfer} quedó pendiente de aprobación.`, 'ok');
    apFiltro = 'pendiente'; apMarcarFiltro();
    await apCargar();
  } catch(e){ apMensaje(e.message, 'error'); }
  finally { btn.disabled = false; }
}

async function apResolver(fila, decision){
  const zfer = fila.getAttribute('data-zfer');
  const input = fila.querySelector('.apMotivoInput');
  const motivo = input ? input.value.trim() : '';
  if(decision!=='aprobar' && !motivo){ input.focus(); input.classList.add('apFalta'); return; }
  const pregunta = { aprobar: `¿Aprobar el ZFER ${zfer}? Todas sus órdenes CURVE 02–04 van a entrar a Lista de corte.`,
                     rechazar: `¿Rechazar el ZFER ${zfer}?`,
                     revocar: `¿Quitarle la aprobación al ZFER ${zfer}? Sus órdenes CURVE 02–04 dejan de entrar a Lista de corte.` }[decision];
  if(!confirm(pregunta)) return;
  fila.querySelectorAll('button').forEach(b=>{ b.disabled = true; });
  try {
    await apPedir('POST', '/'+encodeURIComponent(zfer)+'/resolver', { decision, motivo });
    await apCargar();
  } catch(e){
    alert(e.message);
    fila.querySelectorAll('button').forEach(b=>{ b.disabled = false; });
  }
}

function apMarcarFiltro(){
  document.querySelectorAll('#apFiltro .segBtn').forEach(b=>{
    const on = b.getAttribute('data-estado')===apFiltro;
    b.classList.toggle('active', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}

/* Contador de la pestaña: solicitudes pendientes, solo para quien puede aprobarlas. */
function apActualizarBadgeCon(solicitudes){
  const badge = document.getElementById('apBadge');
  const n = apPuedeAprobar() ? solicitudes.filter(x=>x.estado==='pendiente').length : 0;
  badge.textContent = n;
  badge.hidden = !n;
}
async function apActualizarBadge(){
  if(!apPuedeAprobar()){ apActualizarBadgeCon([]); return; }
  try { apActualizarBadgeCon((await apPedir('GET', '?candidatos=0')).solicitudes || []); } catch(e){ /* sin puente: queda como estaba */ }
}
/* Aviso en vivo: si se está mirando la vista se redibuja (sin volver a
   consultar SQL), y el contador de la pestaña se pone al día. */
function apAlCambiar(){
  if(typeof appVistaActual!=='undefined' && appVistaActual==='aprobaciones') apCargar(false);
  else apActualizarBadge();
}

document.getElementById('apForm').addEventListener('submit', ev=>{ ev.preventDefault(); apSolicitar(); });
document.getElementById('apZfer').addEventListener('input', ()=>{ apDetalleElegido = null; });
document.getElementById('apCandidatos').addEventListener('click', ev=>{
  const b = ev.target.closest('[data-pedir]');
  if(b) apElegirZfer(b.getAttribute('data-pedir'));
});
document.getElementById('apLista').addEventListener('click', ev=>{
  const re = ev.target.closest('[data-repedir]');
  if(re){ apElegirZfer(re.getAttribute('data-repedir')); return; }
  const b = ev.target.closest('[data-decision]');
  if(b) apResolver(b.closest('tr'), b.getAttribute('data-decision'));
});
document.getElementById('apLista').addEventListener('input', ev=>{ if(ev.target.classList.contains('apMotivoInput')) ev.target.classList.remove('apFalta'); });
document.getElementById('apFiltro').addEventListener('click', ev=>{
  const b = ev.target.closest('[data-estado]');
  if(!b) return;
  apFiltro = b.getAttribute('data-estado');
  apMarcarFiltro();
  apDibujarLista();
});
