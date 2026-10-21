/* =========================================================
   RACK DE TEJIDOS — una pieza por posición, con foto (también en el celular)
   =========================================================
   Dar entrada, uno por uno: se elige el tejido (de la Lista de corte o por
   CodMat / nombre), se completan responsables y resistencias, se saca la
   foto del calentamiento (en el celular abre la cámara) y el puente le
   busca la primera posición libre de su tamaño (o una más grande). En la PC
   sale el sticker (Zebra; si no, PDF); desde el celular NO se imprime: se
   saca después en la PC con "Reimprimir sticker".
   El rack se ve en tres pestañas:
   - Por material: cuántas unidades hay de cada CodMat (con vehículo); al
     elegir uno, en qué posiciones está.
   - Mapa: todas las posiciones; tocar una ocupada muestra su foto y datos,
     y deja reimprimir el sticker o darle salida.
   - Historial: cada entrada, salida y tamaño asignado (nunca se borra), con
     filtros, foto de cada entrada y descarga a Excel.
   Todo se valida de nuevo en el puente (server/tejidos.js). */
let tjEstado = null;          // lo último que mandó el puente (posiciones, tamaños…)
let tjElegido = null;         // { codmat, nombre }
let tjFotoBlob = null;        // la foto ya achicada, lista para subir
let tjFotoSubida = null;      // nombre de la foto ya subida (si la entrada falla, no se vuelve a subir)
let tjIdCliente = null;       // identifica ESTA entrada: un reintento no la duplica
let tjDetallePos = null;
let tjFotoUrl = null;         // URL temporal de la foto que se está mostrando
let tjTab = 'material';       // pestaña del rack: material | mapa | historial
let tjMatSel = null;          // CodMat elegido en "Por material"
let tjHist = null;            // lo último que mandó /historial
let tjHistPedido = 0;         // descarta respuestas viejas si se cambia el filtro rápido
try { const t = localStorage.getItem('tjTab'); if(['material','mapa','historial'].includes(t)) tjTab = t; } catch(e){}

const tjArea = () => areaActual();
const tjHeaders = extra => ordApiHeaders(Object.assign({ 'x-area': areaActualId }, extra||{}));
const tjNuevoId = () => { const b = new Uint8Array(12); crypto.getRandomValues(b); return Array.from(b, x=>x.toString(16).padStart(2,'0')).join(''); };
const tjCodmat = v => { const m = String(v||'').trim().match(/^0*(\d{6,18})/); return m ? m[1] : ''; };
const tjFecha = iso => new Date(iso).toLocaleString('es-CO', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });

async function tjPedir(metodo, ruta, cuerpo, extraHeaders){
  const esBlob = cuerpo instanceof Blob;
  const res = await fetch(ordBridgeUrl()+'/api/tejidos'+ruta, {
    method: metodo,
    headers: tjHeaders(Object.assign(cuerpo && !esBlob ? {'Content-Type':'application/json'} : {}, extraHeaders||{})),
    body: cuerpo ? (esBlob ? cuerpo : JSON.stringify(cuerpo)) : undefined
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok){ const e = new Error(data.error || ('HTTP '+res.status)); e.sinTamano = data.sinTamano; throw e; }
  return data;
}

/* ---------------- datos ---------------- */
async function tjRender(silencioso){
  if(tjArea().rack.tipo!=='posiciones') return;
  const area = areaActualId;
  try {
    // refresco automático con el rack ya en pantalla: se manda la firma que se tiene y,
    // si nada cambió, el puente contesta {sinCambios} en vez del rack entero (~90 KB)
    const q = silencioso && tjEstado && tjEstado.firma ? '?version=' + encodeURIComponent(tjEstado.firma) : '';
    const e = await tjPedir('GET', '/rack' + q);
    if(area!==areaActualId || e.sinCambios) return;
    tjEstado = e;
  } catch(err){
    if(!silencioso) document.getElementById('tjMapa').innerHTML = `<div class="empty">No se pudo traer el rack: ${escapeHtml(err.message)}</div>`;
    return;
  }
  // los tejidos que pide la Lista de corte (para elegir rápido); de la memoria del puente, no de SQL
  if(areaTieneVista('ordenes') && typeof ordUltimaLista!=='undefined' && ordUltimaLista.area!==areaActualId) await ordRefrescar({ auto: true }).catch(()=>{});
  tjDibujarTodo();
}
function tjDibujarTodo(){
  if(!tjEstado) return;
  tjDibujarKpis(); tjDibujarMapa(); tjDibujarMateriales(); tjDibujarOpciones(); tjDibujarElegido();
  if(tjDetallePos) tjAbrirDetalle(tjDetallePos, true);
  if(tjTab==='historial') tjHistCargar(true);
}
function tjAlCambiar(ev){
  if(!ev || ev.area!==areaActualId || tjArea().rack.tipo!=='posiciones') return;
  if(!tjEstado || ev.version!==tjEstado.version) tjRender(true);
}

/* ---------------- KPIs y mapa ---------------- */
function tjDibujarKpis(){
  const t = tjEstado.tamanos;
  document.getElementById('tjKpis').innerHTML = t.map(tam=>{
    const del = tjEstado.posiciones.filter(p=>p.tamano===tam), libres = del.filter(p=>!p.unidad).length;
    return `<div class="stat big${libres ? '' : ' warn'}"><span>Libres ${escapeHtml(tam)}</span><b>${libres}<small> / ${del.length}</small></b></div>`;
  }).join('');
}
const tjFiltroTxt = () => (document.getElementById('tjFiltro').value||'').trim().toLowerCase();
const tjInfo = c => (tjEstado && tjEstado.tamanosTejidos || {})[c] || {};
const tjVehiculo = u => u.vehiculo || tjInfo(u.codmat).vehiculo || '';
const tjGeometria = u => u.geometria || tjInfo(u.codmat).geometria || '';
function tjDibujarMapa(){
  const filtro = tjFiltroTxt();
  const coincide = p => !filtro || [p.pos, p.unidad && p.unidad.codmat, p.unidad && p.unidad.nombre, p.unidad && tjVehiculo(p.unidad)].join(' ').toLowerCase().includes(filtro);
  // agrupado por estante: A1.1, A1.2, A1.3 -> estante A1
  const estantes = new Map();
  tjEstado.posiciones.forEach(p=>{
    const est = p.pos.split('.')[0];
    if(!estantes.has(est)) estantes.set(est, []);
    estantes.get(est).push(p);
  });
  const html = [...estantes].map(([est, ps])=>{
    const vis = ps.filter(coincide);
    if(!vis.length) return '';
    return `<div class="tjEstante"><span class="tjEstNom">${escapeHtml(est)}</span><div class="tjCeldas">${vis.map(p=>{
      const u = p.unidad;
      return `<button type="button" class="tjCelda ${u ? 'ocupada' : 'libre'} t-${escapeHtml(p.tamano)}" data-pos="${escapeHtml(p.pos)}"
        title="${escapeHtml(p.pos + ' · ' + p.tamano + (u ? ' · ' + u.nombre : ' · libre'))}" ${u ? '' : 'tabindex="-1"'}>
        <b>${escapeHtml(p.pos)}</b><small>${escapeHtml(p.tamano)}</small>${u ? `<i>${escapeHtml(u.nombre)}</i>` : ''}</button>`;
    }).join('')}</div></div>`;
  }).join('');
  document.getElementById('tjMapa').innerHTML = html || (tjEstado.posiciones.length
    ? '<div class="empty">Ninguna posición coincide con la búsqueda.</div>'
    : '<div class="empty">El rack no tiene posiciones cargadas (ver tools/tejidos/importar-excel.ps1).</div>');
}

/* ---------------- pestañas ---------------- */
function tjCambiarTab(tab, sinCargar){
  tjTab = tab;
  try { localStorage.setItem('tjTab', tab); } catch(e){}
  document.querySelectorAll('.tjTab').forEach(b=>{ const on = b.dataset.tab===tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
  document.querySelectorAll('.tjVista').forEach(v=>{ v.hidden = v.dataset.tab!==tab; });
  document.getElementById('tjBuscarRack').hidden = tab==='historial'; // el historial tiene su propio buscador
  if(tab==='historial' && !sinCargar) tjHistCargar();
}

/* ---------------- por material: cuánto hay y dónde ---------------- */
/* Agrupa lo que hay hoy en el rack por CodMat (cantidad = posiciones ocupadas). */
function tjMateriales(){
  const m = new Map();
  tjEstado.posiciones.forEach(p=>{
    const u = p.unidad; if(!u) return;
    if(!m.has(u.codmat)) m.set(u.codmat, { codmat: u.codmat, nombre: u.nombre, vehiculo: tjVehiculo(u), geometria: tjGeometria(u), tamano: u.tamano, posiciones: [] });
    m.get(u.codmat).posiciones.push(p);
  });
  return [...m.values()].sort((a, b)=>(a.vehiculo||'~').localeCompare(b.vehiculo||'~') || a.nombre.localeCompare(b.nombre));
}
function tjDibujarMateriales(){
  const filtro = tjFiltroTxt();
  const todos = tjMateriales();
  const lista = todos.filter(x=>!filtro || [x.codmat, x.nombre, x.vehiculo, x.geometria, ...x.posiciones.map(p=>p.pos)].join(' ').toLowerCase().includes(filtro));
  const box = document.getElementById('tjMateriales');
  box.innerHTML = lista.length ? lista.map(x=>`<button type="button" class="tjMat${x.codmat===tjMatSel ? ' activo' : ''}" data-codmat="${escapeHtml(x.codmat)}" role="option" aria-selected="${x.codmat===tjMatSel}">
      <span class="tjMatVeh">${escapeHtml(x.vehiculo || 'Sin vehículo')}</span>
      <span class="tjMatNom">${escapeHtml(x.nombre)}</span>
      <span class="tjMatTags"><span>${escapeHtml(x.codmat)}</span>${x.geometria ? `<span>${escapeHtml(x.geometria)}</span>` : ''}<span>${escapeHtml(x.tamano)}</span></span>
      <b class="tjMatCant" title="unidades en el rack">${x.posiciones.length}</b></button>`).join('')
    : `<div class="empty">${todos.length ? 'Ningún material coincide con la búsqueda.' : 'El rack está vacío.'}</div>`;
  // si el elegido ya no está en el rack (salió la última), se limpia
  if(tjMatSel && !todos.some(x=>x.codmat===tjMatSel)) tjMatSel = null;
  tjDibujarUbicaciones(todos);
}
function tjDibujarUbicaciones(todos){
  const box = document.getElementById('tjUbicaciones');
  const x = tjMatSel && (todos || tjMateriales()).find(m=>m.codmat===tjMatSel);
  if(!x){ box.innerHTML = '<div class="empty">Elegí un material para ver en qué posiciones está.</div>'; return; }
  box.innerHTML = `<div class="tjUbiHead"><b>${escapeHtml(x.nombre)}</b><small>${escapeHtml([x.vehiculo, 'CodMat ' + x.codmat].filter(Boolean).join(' · '))}</small>
      <small><b>${x.posiciones.length}</b> en el rack · tocá una posición para ver la foto o darle salida</small></div>`
    + x.posiciones.map(p=>`<button type="button" class="tjUbi" data-pos="${escapeHtml(p.pos)}">
      <b>${escapeHtml(p.pos)}</b>
      <span>Entró ${escapeHtml(tjFecha(p.unidad.fecha))}<small>${escapeHtml(p.unidad.responsables || '')}</small></span>
      <i>${escapeHtml(p.tamano)}</i></button>`).join('');
}
function tjElegirMaterial(codmat){
  tjMatSel = tjMatSel===codmat ? null : codmat;
  tjDibujarMateriales();
  // en el celular la lista de posiciones queda debajo: se baja hasta ella
  if(tjMatSel && window.matchMedia('(max-width: 900px)').matches) document.getElementById('tjUbicaciones').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------------- historial: entradas y salidas (nunca se borra) ---------------- */
function tjDia(offsetDias){
  const d = new Date(); d.setDate(d.getDate() - offsetDias);
  const dos = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth()+1)}-${dos(d.getDate())}`;
}
function tjHistParams(){
  const per = document.getElementById('tjHistPeriodo').value, q = new URLSearchParams({ limite: '2000' });
  if(per!=='') q.set('desde', tjDia(Number(per)));
  const ev = document.getElementById('tjHistEvento').value; if(ev) q.set('evento', ev);
  const t = document.getElementById('tjHistTexto').value.trim(); if(t) q.set('texto', t);
  return q;
}
async function tjHistCargar(silencioso){
  if(tjArea().rack.tipo!=='posiciones') return;
  const n = ++tjHistPedido, area = areaActualId;
  if(!silencioso && !tjHist) document.getElementById('tjHist').innerHTML = '<div class="empty">Cargando…</div>';
  try {
    const h = await tjPedir('GET', '/historial?' + tjHistParams());
    if(n!==tjHistPedido || area!==areaActualId) return;
    tjHist = h; tjDibujarHist();
  } catch(e){
    if(n===tjHistPedido) document.getElementById('tjHist').innerHTML = `<div class="empty">No se pudo traer el historial: ${escapeHtml(e.message)}</div>`;
  }
}
const TJ_EVENTO = { entrada: 'Entrada', salida: 'Salida', tamano: 'Tamaño' };
function tjDuracion(desde, hasta){
  const ms = new Date(hasta) - new Date(desde); if(!(ms >= 0)) return '';
  const h = ms / 3600000;
  return h < 1 ? `${Math.max(1, Math.round(ms/60000))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h/24)} días`;
}
function tjDibujarHist(){
  const h = tjHist, evs = h.eventos;
  const cuenta = t => evs.filter(e=>e.evento===t).length;
  document.getElementById('tjHistResumen').innerHTML = evs.length
    ? `<b>${h.total}</b> movimiento${h.total===1 ? '' : 's'} · <b>${cuenta('entrada')}</b> entradas · <b>${cuenta('salida')}</b> salidas${h.total > evs.length ? ` · se muestran los ${evs.length} más nuevos (acotá el período o la búsqueda)` : ''}`
    : '';
  if(!evs.length){ document.getElementById('tjHist').innerHTML = '<div class="empty">No hay movimientos con ese filtro.</div>'; return; }
  document.getElementById('tjHist').innerHTML = `<table><thead><tr>
      <th>Fecha</th><th>Movimiento</th><th>Posición</th><th>Tejido</th><th>Vehículo</th><th>Responsables</th><th>Resistencias</th><th>Ensamble</th><th>Usuario</th><th>Foto</th>
    </tr></thead><tbody>${evs.map((e, i)=>{
      const detalle = e.evento==='salida' && e.fechaEntrada ? `<br><small class="hint">estuvo ${escapeHtml(tjDuracion(e.fechaEntrada, e.fecha))}${e.motivo ? ' · ' + escapeHtml(e.motivo) : ''}</small>`
        : e.evento==='tamano' ? `<br><small class="hint">${escapeHtml((e.antes ? e.antes + ' → ' : '') + e.tamano)}</small>` : '';
      return `<tr>
        <td>${escapeHtml(tjFecha(e.fecha))}</td>
        <td><span class="tjEv ${escapeHtml(e.evento)}">${escapeHtml(TJ_EVENTO[e.evento] || e.evento)}</span>${detalle}</td>
        <td class="pos">${escapeHtml(e.pos || '—')}</td>
        <td class="mat">${escapeHtml(e.nombre || '—')}<br><small class="hint">${escapeHtml(e.codmat)}</small></td>
        <td>${escapeHtml(e.vehiculo || '—')}</td>
        <td>${escapeHtml(e.responsables || '—')}</td>
        <td>${escapeHtml([e.resistencia1, e.resistencia2].filter(Boolean).join(' / ') || '—')}</td>
        <td>${escapeHtml(e.ensamble || '—')}</td>
        <td>${escapeHtml(e.usuario || '—')}</td>
        <td>${e.foto ? `<button type="button" class="secondary tjVerFoto" data-i="${i}">Ver</button>` : ''}</td></tr>`;
    }).join('')}</tbody></table>`;
}
/* Un movimiento del historial en la misma ventana del detalle, pero solo para mirar. */
function tjVerMovimiento(e){
  tjDetallePos = null;
  document.getElementById('tjDetTitulo').textContent = `${TJ_EVENTO[e.evento] || e.evento} · ${e.pos} · ${e.nombre}`;
  document.getElementById('tjDetSub').textContent = `CodMat ${e.codmat} · ${tjFecha(e.fecha)} (${e.usuario || '—'})`;
  document.getElementById('tjDetBody').innerHTML = `<dl class="tjDatos">
      <dt>Vehículo</dt><dd>${escapeHtml(e.vehiculo || '—')}</dd>
      <dt>Responsables</dt><dd>${escapeHtml(e.responsables || '—')}</dd>
      <dt>Resistencia 1</dt><dd>${escapeHtml(e.resistencia1 || '—')}</dd>
      <dt>Resistencia 2</dt><dd>${escapeHtml(e.resistencia2 || '—')}</dd>
      <dt>Ensamble</dt><dd>${escapeHtml(e.ensamble || '—')}</dd></dl>
    <div class="tjFotoDet" id="tjFotoDet"><span class="hint">Cargando la foto…</span></div>`;
  document.getElementById('tjDetAcciones').style.display = 'none';
  document.getElementById('tjDetalle').style.display = 'flex';
  tjCargarFoto(e.foto);
}
async function tjHistExcel(){
  const btn = document.getElementById('tjHistExcel');
  btn.disabled = true;
  try {
    // el Excel lleva TODO lo del filtro, no solo lo que se ve en pantalla
    const q = tjHistParams(); q.set('limite', '5000');
    const h = await tjPedir('GET', '/historial?' + q);
    if(!h.eventos.length){ alert('No hay movimientos con ese filtro.'); return; }
    const columnas = ['Fecha', 'Movimiento', 'Posición', 'CodMat', 'Tejido', 'Vehículo', 'Tamaño', 'Responsables', 'Resistencia 1', 'Resistencia 2', 'Ensamble', 'Usuario', 'Entró', 'Motivo']
      .map(etiqueta=>({ etiqueta }));
    const filas = h.eventos.map(e=>[tjFecha(e.fecha), TJ_EVENTO[e.evento] || e.evento, e.pos, e.codmat, e.nombre, e.vehiculo, e.tamano,
      e.responsables, e.resistencia1, e.resistencia2, e.ensamble, e.usuario, e.fechaEntrada ? tjFecha(e.fechaEntrada) : '', e.motivo || '']);
    await descargarExcel(`historial-tejidos_${tjDia(0)}.xlsx`, 'Historial tejidos', columnas, filas);
    if(h.total > h.eventos.length) alert(`El Excel trae los ${h.eventos.length} movimientos más nuevos de ${h.total}: acotá el período para el resto.`);
  } catch(e){ alert('No se pudo armar el Excel: ' + e.message); }
  finally { btn.disabled = false; }
}

/* ---------------- elegir el tejido ---------------- */
/* Opciones: primero lo que pide la Lista de corte (lo que falta), después
   todos los tejidos con tamaño conocido. */
function tjCatalogo(){
  const m = new Map();
  if(typeof msAgrupado==='function' && ordUltimaLista && ordUltimaLista.area===areaActualId){
    msAgrupado().forEach(f=>{
      const x = m.get(f.CodMat) || { codmat: f.CodMat, nombre: f.Descricao, vehiculo: f.Vehiculo || '', falta: 0 };
      if(f.grupo==='liberadas') x.falta += f.Falta;
      m.set(f.CodMat, x);
    });
  }
  Object.entries(tjEstado.tamanosTejidos||{}).forEach(([c, v])=>{ if(!m.has(c)) m.set(c, { codmat: c, nombre: v.nombre || c, vehiculo: '', falta: 0 }); });
  // vehículo y tamaño: los del Excel de tamaños mandan; si no hay, el vehículo de la Lista de corte
  return [...m.values()].map(x=>{ const i = tjInfo(x.codmat); return { ...x, vehiculo: i.vehiculo || x.vehiculo || '', tamano: i.tamano || '' }; })
    .sort((a, b)=>b.falta - a.falta || a.nombre.localeCompare(b.nombre));
}

/* Lista desplegable de tejidos (propia: el <datalist> del iPhone solo sugiere 3
   arriba del teclado). Se abre al tocar el campo, filtra mientras se escribe
   (CodMat, nombre o vehículo) y primero muestra lo que pide la Lista de corte. */
const TJ_LISTA_MAX = 60;      // opciones dibujadas a la vez (con 400+ tejidos, el resto aparece al escribir)
let tjListaIdx = -1;          // opción marcada con las flechas (PC)
function tjComboAbierto(){ return !document.getElementById('tjLista').hidden; }
function tjAbrirLista(){
  if(!tjEstado) return;
  const lista = document.getElementById('tjLista'), input = document.getElementById('tjTejido');
  lista.hidden = false; input.setAttribute('aria-expanded', 'true');
  tjDibujarOpciones();
  // en el celular el teclado tapa media pantalla: se sube el campo para que la lista se vea entera
  if(window.matchMedia('(max-width: 900px)').matches) setTimeout(()=>document.getElementById('tjCombo').scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
}
function tjCerrarLista(){
  document.getElementById('tjLista').hidden = true;
  document.getElementById('tjTejido').setAttribute('aria-expanded', 'false');
  tjListaIdx = -1;
}
function tjDibujarOpciones(){
  const lista = document.getElementById('tjLista');
  if(lista.hidden || !tjEstado) return;
  const input = document.getElementById('tjTejido');
  // si el campo muestra el ya elegido ("600039736 · PUTE…"), se lista todo
  const q = tjElegido && input.value===tjElegido.codmat + ' · ' + tjElegido.nombre ? '' : input.value.trim().toLowerCase();
  const palabras = q.split(/\s+/).filter(Boolean);
  const todos = tjCatalogo().filter(x=>{ const t = [x.codmat, x.nombre, x.vehiculo].join(' ').toLowerCase(); return palabras.every(p=>t.includes(p)); });
  const vis = todos.slice(0, TJ_LISTA_MAX);
  const opcion = (x, i) => `<button type="button" role="option" class="tjOpc${i===tjListaIdx ? ' marcada' : ''}${tjElegido && tjElegido.codmat===x.codmat ? ' elegida' : ''}" data-codmat="${escapeHtml(x.codmat)}" data-i="${i}">
      <span class="tjOpcNom">${escapeHtml(x.nombre)}</span>
      <span class="tjOpcSub">${escapeHtml([x.codmat, x.vehiculo].filter(Boolean).join(' · '))}</span>
      <span class="tjOpcTags">${x.tamano ? `<span class="tjTam">${escapeHtml(x.tamano)}</span>` : '<span class="tjSinTam">sin tamaño</span>'}${x.falta ? `<span class="tjFalta">Faltan ${x.falta}</span>` : ''}</span></button>`;
  const piden = vis.filter(x=>x.falta), resto = vis.filter(x=>!x.falta);
  let i = 0, html = '';
  if(piden.length) html += `<div class="tjListaGrupo">Pide la Lista de corte</div>` + piden.map(x=>opcion(x, i++)).join('');
  if(resto.length) html += (piden.length ? `<div class="tjListaGrupo">Todos los tejidos</div>` : '') + resto.map(x=>opcion(x, i++)).join('');
  if(todos.length > vis.length) html += `<div class="tjListaMas">${todos.length - vis.length} más… escribí para achicar la lista</div>`;
  lista.innerHTML = html || `<div class="tjListaMas">Ningún tejido coincide con “${escapeHtml(input.value.trim())}”.</div>`;
  const m = lista.querySelector('.tjOpc.marcada'); if(m) m.scrollIntoView({ block: 'nearest' });
}
function tjElegirDeLista(codmat){
  const x = tjCatalogo().find(c=>c.codmat===codmat);
  tjElegir(codmat, x && x.nombre);
  tjCerrarLista();
  document.getElementById('tjTejido').blur();
  // lo siguiente para completar: el responsable (si ya está, la resistencia 1)
  const sig = document.getElementById(document.getElementById('tjResponsables').value.trim() ? 'tjR1' : 'tjResponsables');
  if(!window.matchMedia('(max-width: 900px)').matches) sig.focus(); // en el celular no: abriría el teclado encima del resumen
}
function tjElegir(codmat, nombre){
  const c = tjCodmat(codmat);
  if(!c){ tjElegido = null; tjDibujarElegido(); return; }
  const cat = tjCatalogo().find(x=>x.codmat===c);
  tjElegido = { codmat: c, nombre: nombre || (cat && cat.nombre) || ((tjEstado.tamanosTejidos||{})[c]||{}).nombre || c };
  document.getElementById('tjTejido').value = tjElegido.codmat + ' · ' + tjElegido.nombre;
  tjDibujarElegido();
}
function tjDibujarElegido(){
  const box = document.getElementById('tjElegido');
  if(!tjElegido || !tjEstado){ box.hidden = true; return; }
  const tam = ((tjEstado.tamanosTejidos||{})[tjElegido.codmat]||{}).tamano;
  const cat = tjCatalogo().find(x=>x.codmat===tjElegido.codmat);
  let destino = '';
  if(tam){
    const orden = tjEstado.tamanos.slice(tjEstado.tamanos.indexOf(tam));
    const libre = orden.map(t=>tjEstado.posiciones.find(p=>p.tamano===t && !p.unidad)).find(Boolean);
    destino = libre ? `Va a la posición <b>${escapeHtml(libre.pos)}</b>${libre.tamano!==tam ? ` <span class="tjAviso">(no quedan ${escapeHtml(tam)} libres: usa una ${escapeHtml(libre.tamano)})</span>` : ''}`
                    : `<span class="tjAviso">No queda ninguna posición libre de tamaño ${escapeHtml(tam)} ni más grande.</span>`;
  }
  box.hidden = false;
  box.innerHTML = `<b>${escapeHtml(tjElegido.nombre)}</b><small>CodMat ${escapeHtml(tjElegido.codmat)}${cat && cat.falta ? ` · faltan ${cat.falta} en Lista de corte` : ''}</small>
    <div class="tjElegidoTam">${tam ? `Tamaño <span class="tjTam">${escapeHtml(tam)}</span> · ${destino}`
      : `<span class="tjAviso">Sin tamaño:</span> <select id="tjTamNuevo" aria-label="Tamaño del tejido"><option value="">elegí…</option>${tjEstado.tamanos.map(t=>`<option>${t}</option>`).join('')}</select>`}</div>`;
}

/* ---------------- foto ---------------- */
/* Se achica en el celular antes de subirla (lado mayor 1600 px, JPEG): una
   foto de cámara de 4–8 MB queda en unos 300 KB, sube rápido por wifi. */
function tjAchicarFoto(archivo){
  return new Promise((ok, mal)=>{
    const url = URL.createObjectURL(archivo), img = new Image();
    img.onload = ()=>{
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b=>b ? ok(b) : mal(new Error('no se pudo procesar la foto')), 'image/jpeg', 0.82);
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); mal(new Error('el archivo no es una imagen')); };
    img.src = url;
  });
}
async function tjElegirFoto(ev){
  const f = ev.target.files && ev.target.files[0];
  if(!f) return;
  const msg = document.getElementById('tjMsg');
  try {
    tjFotoBlob = await tjAchicarFoto(f);
    tjFotoSubida = null;
    const prev = document.getElementById('tjFotoPrev');
    if(prev.src) URL.revokeObjectURL(prev.src);
    prev.src = URL.createObjectURL(tjFotoBlob); prev.hidden = false;
    document.getElementById('tjFotoTxt').textContent = '📷 Cambiar foto';
    msg.textContent = ''; msg.className = 'hint';
  } catch(e){ msg.textContent = 'Foto: ' + e.message; msg.className = 'hint msg-error'; }
}

/* ---------------- dar entrada ---------------- */
async function tjDarEntrada(){
  const msg = document.getElementById('tjMsg'), btn = document.getElementById('tjEntrar');
  const v = id => document.getElementById(id).value.trim();
  if(!tjElegido) tjElegir(v('tjTejido'));
  const falta = !tjElegido ? 'Elegí el tejido.' : !v('tjResponsables') ? 'Falta el responsable.' : !v('tjR1') ? 'Falta la resistencia 1.' : !tjFotoBlob ? 'Falta la foto del calentamiento.' : '';
  if(falta){ msg.textContent = falta; msg.className = 'hint msg-error'; return; }
  btn.disabled = true; msg.className = 'hint';
  try {
    if(!tjFotoSubida){ msg.textContent = 'Subiendo la foto…'; tjFotoSubida = (await tjPedir('POST', '/fotos', tjFotoBlob, { 'Content-Type': 'image/jpeg' })).foto; }
    msg.textContent = 'Buscando posición…';
    if(!tjIdCliente) tjIdCliente = tjNuevoId();
    const cat = tjCatalogo().find(x=>x.codmat===tjElegido.codmat);
    const r = await tjPedir('POST', '/entrada', { idCliente: tjIdCliente, codmat: tjElegido.codmat, nombre: tjElegido.nombre, vehiculo: (cat && cat.vehiculo) || '',
      responsables: v('tjResponsables'), resistencia1: v('tjR1'), resistencia2: v('tjR2'), ensamble: v('tjEnsamble'), foto: tjFotoSubida });
    // desde el celular no se imprime ni se baja el PDF: el sticker se saca después
    // desde la PC con "Reimprimir sticker" (pedido del usuario)
    const impreso = tjEsCelular() ? 'El sticker se imprime desde la PC: abrí la posición y tocá "Reimprimir sticker".'
                                  : await tjImprimir(r.unidad, r.posicion);
    const res = document.getElementById('tjResultado');
    res.hidden = false;
    res.innerHTML = `<span>Va en la posición</span><b>${escapeHtml(r.posicion)}</b><small>${escapeHtml(r.unidad.nombre)}${r.masGrande ? ' · en una posición más grande (no quedaban de su tamaño)' : ''}</small><small>${escapeHtml(impreso)}</small>`;
    // listo para el siguiente: se conserva el responsable (suele ser la misma persona)
    tjElegido = null; tjFotoBlob = null; tjFotoSubida = null; tjIdCliente = null;
    ['tjTejido', 'tjR1', 'tjR2', 'tjEnsamble', 'tjFoto'].forEach(id=>{ document.getElementById(id).value = ''; });
    const prev = document.getElementById('tjFotoPrev'); if(prev.src) URL.revokeObjectURL(prev.src); prev.removeAttribute('src'); prev.hidden = true;
    document.getElementById('tjFotoTxt').textContent = '📷 Tomar foto';
    msg.textContent = '';
    await tjRender(true);
  } catch(e){
    msg.textContent = 'No se dio entrada: ' + e.message; msg.className = 'hint msg-error';
  } finally { btn.disabled = false; }
}
/* Celular o tablet: pantalla táctil y angosta. Ahí la entrada no imprime. */
const tjEsCelular = () => navigator.maxTouchPoints > 0 && window.matchMedia('(max-width: 900px)').matches;
/* Zebra primero; si no está, PDF. */
async function tjImprimir(unidad, posicion){
  try { await imprimirStickerTejidoZPL(unidad, posicion); return 'Sticker enviado a la Zebra.'; }
  catch(e){
    console.warn('[tejidos] Zebra:', e.message);
    try { generarStickerTejidoPDF(unidad, posicion); return 'La Zebra no está disponible: se descargó el PDF del sticker.'; }
    catch(e2){ return 'No se pudo generar el sticker: ' + e2.message; }
  }
}

/* ---------------- detalle de una posición ---------------- */
async function tjAbrirDetalle(pos, refresco){
  const p = tjEstado && tjEstado.posiciones.find(x=>x.pos===pos);
  if(!p || !p.unidad){ tjCerrarDetalle(); return; }
  const u = p.unidad;
  tjDetallePos = pos;
  document.getElementById('tjDetTitulo').textContent = `${p.pos} · ${u.nombre}`;
  document.getElementById('tjDetSub').textContent = `CodMat ${u.codmat} · tamaño ${u.tamano}${u.tamanoPosicion!==u.tamano ? ` (en posición ${u.tamanoPosicion})` : ''} · entró ${tjFecha(u.fecha)} (${u.usuario||'—'})`;
  if(!refresco){
    document.getElementById('tjDetBody').innerHTML = `<dl class="tjDatos">
      <dt>Vehículo</dt><dd>${escapeHtml(tjVehiculo(u) || '—')}</dd>
      <dt>Responsables</dt><dd>${escapeHtml(u.responsables)}</dd>
      <dt>Resistencia 1</dt><dd>${escapeHtml(u.resistencia1)}</dd>
      <dt>Resistencia 2</dt><dd>${escapeHtml(u.resistencia2||'—')}</dd>
      <dt>Ensamble</dt><dd>${escapeHtml(u.ensamble||'—')}</dd></dl>
      <div class="tjFotoDet" id="tjFotoDet"><span class="hint">Cargando la foto…</span></div>`;
    document.getElementById('tjDetAcciones').style.display = '';
    const o = document.getElementById('tjDetalle'); o.style.display = 'flex';
    tjCargarFoto(u.foto);
  }
}
async function tjCargarFoto(archivo){
  const cont = document.getElementById('tjFotoDet');
  try {
    const res = await fetch(ordBridgeUrl()+'/api/tejidos/fotos/'+encodeURIComponent(archivo), { headers: tjHeaders() });
    if(!res.ok) throw new Error('HTTP '+res.status);
    if(tjFotoUrl) URL.revokeObjectURL(tjFotoUrl);
    tjFotoUrl = URL.createObjectURL(await res.blob());
    cont.innerHTML = `<a href="${tjFotoUrl}" target="_blank" rel="noopener"><img src="${tjFotoUrl}" alt="Foto del calentamiento"></a>`;
  } catch(e){ cont.innerHTML = `<span class="hint">No se pudo cargar la foto (${escapeHtml(e.message)}).</span>`; }
}
function tjCerrarDetalle(){
  tjDetallePos = null;
  document.getElementById('tjDetalle').style.display = 'none';
  if(tjFotoUrl){ URL.revokeObjectURL(tjFotoUrl); tjFotoUrl = null; }
}
async function tjSalida(){
  const pos = tjDetallePos, p = tjEstado.posiciones.find(x=>x.pos===pos);
  if(!p || !p.unidad || !confirm(`¿Dar salida al tejido de la posición ${pos}?\n${p.unidad.nombre}\n\nLa posición queda libre.`)) return;
  try { await tjPedir('POST', '/salida', { posicion: pos }); tjCerrarDetalle(); await tjRender(true); }
  catch(e){ alert('No se dio salida: ' + e.message); }
}

/* Desde la Lista de corte: ir al Rack con ese tejido ya elegido. */
function tjIrAEntrada(codmat, nombre){
  if(typeof switchView==='function') switchView('rack');
  tjRender(true).then(()=>{ tjElegir(codmat, nombre); document.getElementById('tjResponsables').focus(); });
}

/* ---------------- eventos ---------------- */
document.body.appendChild(document.getElementById('tjDetalle')); // el detalle flota sobre todo (fuera de la vista animada)
document.getElementById('tjForm').addEventListener('submit', ev=>{ ev.preventDefault(); tjDarEntrada(); });
{
  const input = document.getElementById('tjTejido'), lista = document.getElementById('tjLista');
  input.addEventListener('focus', tjAbrirLista);
  input.addEventListener('click', ()=>{ if(!tjComboAbierto()) tjAbrirLista(); });
  input.addEventListener('input', ()=>{
    // al escribir, lo elegido antes deja de valer (salvo que se pegue un CodMat completo)
    if(tjElegido){ tjElegido = null; tjDibujarElegido(); }
    tjListaIdx = -1;
    if(!tjComboAbierto()) tjAbrirLista(); else tjDibujarOpciones();
  });
  input.addEventListener('keydown', ev=>{
    const n = lista.querySelectorAll('.tjOpc').length;
    if(ev.key==='ArrowDown' || ev.key==='ArrowUp'){
      ev.preventDefault(); if(!tjComboAbierto()) return tjAbrirLista();
      tjListaIdx = n ? (tjListaIdx + (ev.key==='ArrowDown' ? 1 : -1) + n) % n : -1; tjDibujarOpciones();
    } else if(ev.key==='Enter' && tjComboAbierto()){
      ev.preventDefault(); // que no mande el formulario
      const b = lista.querySelector(tjListaIdx>=0 ? `.tjOpc[data-i="${tjListaIdx}"]` : '.tjOpc');
      if(b) tjElegirDeLista(b.dataset.codmat);
    } else if(ev.key==='Escape') tjCerrarLista();
  });
  // pointerdown (no click): así el campo no pierde el foco antes de elegir
  lista.addEventListener('pointerdown', ev=>{ if(ev.target.closest('.tjOpc')) ev.preventDefault(); });
  lista.addEventListener('click', ev=>{ const b = ev.target.closest('.tjOpc'); if(b) tjElegirDeLista(b.dataset.codmat); });
  document.getElementById('tjComboBtn').addEventListener('click', ()=>{ if(tjComboAbierto()) tjCerrarLista(); else { input.focus(); tjAbrirLista(); } });
  // tocar afuera la cierra; si quedó escrito un CodMat completo, se toma
  const cerrarYTomar = () => {
    tjCerrarLista();
    const c = tjCodmat(input.value);
    if(!tjElegido && c && tjCatalogo().some(x=>x.codmat===c)) tjElegir(c);
  };
  document.addEventListener('pointerdown', ev=>{ if(tjComboAbierto() && !ev.target.closest('#tjCombo')) cerrarYTomar(); });
  // con Tab (PC) a otro campo, también; el "Listo" del teclado del celular no la cierra (sirve para ver la lista entera)
  document.getElementById('tjCombo').addEventListener('focusout', ev=>{
    if(tjComboAbierto() && ev.relatedTarget && !ev.currentTarget.contains(ev.relatedTarget)) cerrarYTomar();
  });
}
document.getElementById('tjFoto').addEventListener('change', tjElegirFoto);
document.getElementById('tjFiltro').addEventListener('input', ()=>{ if(tjEstado){ tjDibujarMapa(); tjDibujarMateriales(); } });
document.getElementById('tjMapa').addEventListener('click', ev=>{ const b = ev.target.closest('.tjCelda.ocupada'); if(b) tjAbrirDetalle(b.getAttribute('data-pos')); });
document.querySelectorAll('.tjTab').forEach(b=>b.addEventListener('click', ()=>tjCambiarTab(b.dataset.tab)));
document.getElementById('tjActualizar').addEventListener('click', ()=>{ tjRender(); if(tjTab==='historial') tjHistCargar(); });
document.getElementById('tjMateriales').addEventListener('click', ev=>{ const b = ev.target.closest('.tjMat'); if(b) tjElegirMaterial(b.dataset.codmat); });
document.getElementById('tjUbicaciones').addEventListener('click', ev=>{ const b = ev.target.closest('.tjUbi'); if(b) tjAbrirDetalle(b.dataset.pos); });
['tjHistPeriodo', 'tjHistEvento'].forEach(id=>document.getElementById(id).addEventListener('change', ()=>tjHistCargar()));
let tjHistEspera = null; // busca mientras se escribe, sin pedir en cada tecla
document.getElementById('tjHistTexto').addEventListener('input', ()=>{ clearTimeout(tjHistEspera); tjHistEspera = setTimeout(()=>tjHistCargar(), 350); });
document.getElementById('tjHist').addEventListener('click', ev=>{ const b = ev.target.closest('.tjVerFoto'); if(b && tjHist) tjVerMovimiento(tjHist.eventos[+b.dataset.i]); });
document.getElementById('tjHistExcel').addEventListener('click', tjHistExcel);
tjCambiarTab(tjTab, true); // el historial se pide al entrar al Rack (tjRender)
document.getElementById('tjElegido').addEventListener('change', async ev=>{
  if(ev.target.id!=='tjTamNuevo' || !ev.target.value || !tjElegido) return;
  try { await tjPedir('PUT', '/tamano', { codmat: tjElegido.codmat, tamano: ev.target.value, nombre: tjElegido.nombre }); await tjRender(true); }
  catch(e){ alert('No se pudo asignar el tamaño: ' + e.message); }
});
document.getElementById('tjDetCerrar').addEventListener('click', tjCerrarDetalle);
document.getElementById('tjDetalle').addEventListener('click', ev=>{ if(ev.target.id==='tjDetalle') tjCerrarDetalle(); });
document.getElementById('tjDetSalida').addEventListener('click', tjSalida);
document.getElementById('tjDetReimp').addEventListener('click', async ()=>{
  const p = tjEstado.posiciones.find(x=>x.pos===tjDetallePos);
  if(p && p.unidad) alert(await tjImprimir(p.unidad, p.pos));
});
document.getElementById('tjIrRackBtn').addEventListener('click', ()=>{ if(typeof switchView==='function') switchView('rack'); tjRender(); });
alCambiarArea(()=>{ tjEstado = null; tjElegido = null; tjMatSel = null; tjHist = null; tjCerrarDetalle(); document.getElementById('tjResultado').hidden = true; });
