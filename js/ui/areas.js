/* =========================================================
   ÁREA DE TRABAJO ACTIVA — Papel cerámico / Tecoflex / Mallas
   =========================================================
   La configuración (qué pestañas, qué rack, materiales) vive en
   js/core/areas-config.js. Acá solo se maneja CUÁL está activa y se
   aplica a la pantalla:
   - body[data-area] → el acento de color de cada área (ver styles.css)
   - pestañas: solo las que el área tiene
   - cualquier elemento con data-areas="papel tecoflex" se muestra solo
     en esas áreas (así el HTML declara qué es de quién, sin ifs sueltos)
   - avisa a quien necesite saberlo (orders.js limpia su estado) */
const AREA_STORAGE_KEY = 'nesting_area_v1';
let areaActualId = (function(){
  try { const v = sessionStorage.getItem(AREA_STORAGE_KEY); if(v && AREAS_CONFIG.areas[v]) return v; } catch(e){}
  return AREAS_CONFIG.porDefecto;
})();
const areaListeners = [];

function areaActual(){ return AREAS_CONFIG.areas[areaActualId]; }
/* ¿Esta vista existe en el área Y el usuario tiene permiso para verla?
   "usuarios" es la pestaña de administración: solo administradores.
   "aprobar" (aprobar ZFER) no es una pestaña sino un permiso; quien lo
   tiene ve también la pestaña "aprobaciones". */
function areaTieneVista(vista, areaId){
  const id = areaId || areaActualId;
  if(vista==='usuarios') return typeof authEsAdmin==='function' && authEsAdmin();
  if(!AREAS_CONFIG.areas[id].vistas.includes(vista)) return false;
  if(typeof authPuede!=='function') return true;
  return authPuede(id, vista) || (vista==='aprobaciones' && authPuede(id, 'aprobar'));
}
function areaVistasPermitidas(id){ return AREAS_CONFIG.areas[id].vistas.filter(v=>areaTieneVista(v, id)); }
/* la pestaña con la que se abre un área: la primera habilitada, en este orden */
function areaPrimeraVista(id){
  const p = areaVistasPermitidas(id || areaActualId);
  const pestana = ['ordenes','rack','nesting','repair','aprobaciones'].find(v=>p.includes(v));
  if(pestana) return pestana;
  if(p.includes('aprobar')) return 'aprobaciones'; // solo aprueba ZFER
  return areaTieneVista('usuarios') ? 'usuarios' : null;
}
/* Vuelve a aplicar pestañas y botones de área con los permisos actuales. */
function areaRefrescarPermisos(){ aplicarArea(areaActualId, {silencioso:true}); }
function alCambiarArea(fn){ areaListeners.push(fn); }

const AREA_ICONOS = {
  // hoja con capas (papel cerámico)
  papel: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 3 7.5 12 12l9-4.5L12 3Z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/></svg>',
  // rombos (la textura del Tecoflex)
  tecoflex: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 3 4 4-4 4-4-4 4-4Z"/><path d="m17 3 4 4-4 4-4-4 4-4Z"/><path d="m12 13 4 4-4 4-4-4 4-4Z"/></svg>',
  // trama de malla
  mallas: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></svg>',
  // hilos entrelazados (tejido)
  tejidos: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7c3 0 3 3 6 3s3-3 6-3 3 3 6 3"/><path d="M3 14c3 0 3 3 6 3s3-3 6-3 3 3 6 3"/><path d="M8 3v18M16 3v18"/></svg>'
};

function aplicarArea(id, opciones){
  if(!AREAS_CONFIG.areas[id]) id = AREAS_CONFIG.porDefecto;
  const cambio = id !== areaActualId;
  areaActualId = id;
  try { sessionStorage.setItem(AREA_STORAGE_KEY, id); } catch(e){}
  const area = areaActual();
  document.body.setAttribute('data-area', id);

  document.querySelectorAll('[data-areas]').forEach(el=>{
    el.hidden = !el.getAttribute('data-areas').split(/\s+/).includes(id);
  });
  // pestañas: solo las que el área tiene Y el usuario puede ver
  document.querySelectorAll('.viewTab[data-view]').forEach(tab=>{
    tab.hidden = !areaTieneVista(tab.getAttribute('data-view'), id);
  });
  // áreas: se esconden las que el usuario no puede usar en absoluto
  document.querySelectorAll('[data-area-btn]').forEach(b=>{
    const bid = b.getAttribute('data-area-btn'), activo = bid===id;
    b.classList.toggle('active', activo);
    b.setAttribute('aria-selected', activo ? 'true' : 'false');
    b.hidden = typeof authEstaLogueado==='function' && authEstaLogueado() && !areaVistasPermitidas(bid).length;
  });
  document.querySelectorAll('[data-area-nombre]').forEach(el=>{ el.textContent = area.nombre; });
  // "malla"/"mallas", "tejido"/"tejidos": cómo se llama cada unidad en esta área
  if(area.pieza) document.querySelectorAll('[data-pieza]').forEach(el=>{ el.textContent = area.pieza[el.getAttribute('data-pieza')] || el.textContent; });

  if(cambio && !(opciones && opciones.silencioso)) areaListeners.forEach(fn=>{ try { fn(area); } catch(e){ console.error('[área]', e); } });
}

/* Tarjetas de "Área de trabajo" del login, armadas desde la config
   (agregar un área nueva = agregarla en areas-config.js, nada más). */
function areaRenderTarjetas(){
  const cont = document.getElementById('areaCards');
  if(!cont) return;
  document.body.setAttribute('data-area', areaActualId); // descarta una vista previa de otra tarjeta que no se usó
  cont.innerHTML = AREAS_CONFIG.orden.map(id=>{
    const a = AREAS_CONFIG.areas[id];
    return `<label class="areaCard${id===areaActualId?' sel':''}" data-area-card="${id}">
      <input type="radio" name="areaLogin" value="${id}" ${id===areaActualId?'checked':''}>
      <span class="areaCardIcon">${AREA_ICONOS[id]||''}</span>
      <span class="areaCardText"><b>${escapeHtml(a.nombre)}</b><small>${escapeHtml(a.resumen)}</small></span>
      <span class="areaCardRadio" aria-hidden="true"></span>
    </label>`;
  }).join('');
}
/* Al elegir una tarjeta en el login: se marca (.sel, por si el navegador
   no soporta :has) y el panel de marca toma el color/textura de esa área
   como vista previa — sin aplicar el área todavía (eso pasa al entrar). */
document.getElementById('areaCards').addEventListener('change', ev=>{
  if(ev.target.name!=='areaLogin') return;
  document.querySelectorAll('.areaCard').forEach(c=>c.classList.toggle('sel', c.getAttribute('data-area-card')===ev.target.value));
  document.body.setAttribute('data-area', ev.target.value);
});
function areaSeleccionadaEnLogin(){
  const r = document.querySelector('input[name="areaLogin"]:checked');
  return r ? r.value : areaActualId;
}

/* Selector de área de la barra superior (cambia sin volver a pedir
   contraseña — la sesión es de la persona, no del área). */
function areaRenderSelector(){
  const nav = document.getElementById('areaSwitch');
  if(!nav) return;
  nav.innerHTML = AREAS_CONFIG.orden.map(id=>
    `<button type="button" class="areaSwitchBtn" role="tab" data-area-btn="${id}">${AREA_ICONOS[id]||''}<span>${escapeHtml(AREAS_CONFIG.areas[id].nombre)}</span></button>`
  ).join('');
  nav.addEventListener('click', ev=>{
    const b = ev.target.closest('[data-area-btn]');
    if(!b) return;
    aplicarArea(b.getAttribute('data-area-btn'));
    // si la pestaña que estaba abierta no existe en el área nueva
    // (por ej. Editor de archivos en Mallas), se va a la primera que sí
    if(typeof switchView==='function') switchView(appVistaActual && areaTieneVista(appVistaActual) ? appVistaActual : areaPrimeraVista());
  });
}

areaRenderTarjetas();
areaRenderSelector();
aplicarArea(areaActualId, {silencioso:true});
