/* =========================================================
   ADMINISTRACIÓN DE USUARIOS (solo administradores)
   =========================================================
   Crear usuarios, cambiar contraseñas, activar/desactivar, hacer
   administrador y elegir qué vistas puede ver cada uno en cada área.
   Todo se valida de nuevo en el puente (server/usuarios.js): esta
   pantalla es solo la forma cómoda de pedirlo. */
const USR_NOMBRES_VISTA = {ordenes:'Lista de corte', nesting:'Nesting', rack:'Rack', repair:'Editor de archivos',
  aprobaciones:'Aprobaciones (pedir)', aprobar:'Aprobar ZFER'};
const USR_ORDEN_VISTAS = ['ordenes','nesting','rack','repair','aprobaciones','aprobar'];
let usrLista = [];
let usrEditando = null;   // nombre del usuario abierto en el editor; null = creando uno nuevo

async function usrPedir(metodo, ruta, cuerpo){
  const res = await fetch(ordBridgeUrl()+'/api/usuarios'+(ruta||''), {
    method: metodo, headers: ordApiHeaders({'Content-Type':'application/json'}),
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || ('HTTP '+res.status));
  return data;
}

async function usrCargar(){
  const lista = document.getElementById('usrLista');
  try { usrLista = await usrPedir('GET'); }
  catch(e){ lista.innerHTML = `<div class="empty">No se pudo traer la lista de usuarios: ${escapeHtml(e.message)}</div>`; return; }
  usrDibujarLista();
  // si había alguien abierto, se refresca con lo guardado; si no, el primero
  const abierto = usrEditando && usrLista.find(u=>u.usuario===usrEditando);
  if(abierto) usrAbrir(abierto.usuario); else if(usrEditando===null && !document.getElementById('usrForm').dataset.nuevo) usrAbrir(usrLista[0] && usrLista[0].usuario);
}

/* "Papel: Lista de corte, Rack · Tecoflex: Rack" */
function usrResumenPermisos(u){
  if(u.admin) return 'Todo (administrador)';
  const partes = AREAS_CONFIG.orden.map(id=>{
    const v = (u.permisos[id]||[]).map(x=>USR_NOMBRES_VISTA[x]);
    return v.length ? `${AREAS_CONFIG.areas[id].nombre}: ${v.join(', ')}` : null;
  }).filter(Boolean);
  return partes.length ? partes.join(' · ') : 'Sin vistas habilitadas';
}
function usrDibujarLista(){
  document.getElementById('usrCount').textContent = usrLista.length;
  document.getElementById('usrLista').innerHTML = usrLista.map(u=>`
    <button type="button" class="usrItem${u.usuario===usrEditando?' activo':''}${u.activo?'':' inactivo'}" data-usuario="${escapeHtml(u.usuario)}">
      <span class="avatar sm">${escapeHtml(authIniciales(u.usuario))}</span>
      <span class="usrItemTxt"><b>${escapeHtml(u.usuario)}${u.admin?' <em class="rolTag">Admin</em>':''}${u.activo?'':' <em class="rolTag off">Inactivo</em>'}</b>
      <small>${escapeHtml(usrResumenPermisos(u))}</small></span>
    </button>`).join('');
}

/* ---------- editor ---------- */
function usrAbrir(nombre){
  const u = nombre ? usrLista.find(x=>x.usuario===nombre) : null;
  const form = document.getElementById('usrForm');
  usrEditando = u ? u.usuario : null;
  if(u) delete form.dataset.nuevo; else form.dataset.nuevo = '1';
  document.getElementById('usrTitulo').textContent = u ? u.usuario : 'Nuevo usuario';
  const inNombre = document.getElementById('usrNombre');
  inNombre.value = u ? u.usuario : '';
  inNombre.readOnly = !!u;
  document.getElementById('usrNombreField').hidden = !!u;
  document.getElementById('usrClave').value = '';
  document.getElementById('usrClaveLabel').textContent = u ? 'Nueva contraseña (dejala vacía para no cambiarla)' : 'Contraseña';
  document.getElementById('usrAdmin').checked = !!(u && u.admin);
  document.getElementById('usrActivo').checked = u ? !!u.activo : true;
  document.getElementById('usrEliminarBtn').hidden = !u;
  const esYo = u && u.usuario===authUsuarioActual();
  // a uno mismo no se le puede quitar el rol ni desactivar (el puente también lo impide)
  document.getElementById('usrAdmin').disabled = esYo;
  document.getElementById('usrActivo').disabled = esYo;
  document.getElementById('usrEliminarBtn').disabled = esYo;
  document.getElementById('usrMeta').textContent = u
    ? `Creado ${new Date(u.creado).toLocaleString('es-CO')}${u.actualizado && u.actualizado!==u.creado ? ' · modificado '+new Date(u.actualizado).toLocaleString('es-CO') : ''}`
    : '';
  usrDibujarPermisos(u ? u.permisos : {});
  usrMensaje('');
  usrDibujarLista();
  if(!u) setTimeout(()=>inNombre.focus(), 30);
}
function usrDibujarPermisos(permisos){
  const tabla = document.getElementById('usrPermisos');
  const admin = document.getElementById('usrAdmin').checked;
  tabla.classList.toggle('apagado', admin);
  document.getElementById('usrPermisosNota').hidden = !admin;
  tabla.innerHTML = `<thead><tr><th>Área</th>${USR_ORDEN_VISTAS.map(v=>`<th>${USR_NOMBRES_VISTA[v]}</th>`).join('')}<th></th></tr></thead><tbody>` +
    AREAS_CONFIG.orden.map(id=>{
      const a = AREAS_CONFIG.areas[id];
      return `<tr data-area="${id}"><th scope="row">${escapeHtml(a.nombre)}</th>${USR_ORDEN_VISTAS.map(v=>a.vistas.includes(v)
        ? `<td><label class="permChk"><input type="checkbox" data-vista="${v}" ${admin || (permisos[id]||[]).includes(v) ? 'checked' : ''} aria-label="${escapeHtml(a.nombre)} — ${USR_NOMBRES_VISTA[v]}"></label></td>`
        : '<td class="invNa" title="Esta área no tiene esta vista">—</td>').join('')}
        <td><button type="button" class="linkBtn" data-todo="${id}">Todo</button></td></tr>`;
    }).join('') + '</tbody>';
}
function usrLeerPermisos(){
  const p = {};
  document.querySelectorAll('#usrPermisos tbody tr').forEach(tr=>{
    const v = [...tr.querySelectorAll('input[data-vista]:checked')].map(i=>i.getAttribute('data-vista'));
    if(v.length) p[tr.getAttribute('data-area')] = v;
  });
  return p;
}
function usrMensaje(texto, tipo){
  const el = document.getElementById('usrMsg');
  el.textContent = texto || ' ';
  el.className = 'hint' + (tipo ? ' msg-'+tipo : '');
}

async function usrGuardar(){
  const nuevo = usrEditando===null;
  const datos = {
    clave: document.getElementById('usrClave').value,
    admin: document.getElementById('usrAdmin').checked,
    activo: document.getElementById('usrActivo').checked,
    permisos: usrLeerPermisos()
  };
  if(nuevo) datos.usuario = document.getElementById('usrNombre').value.trim();
  if(!datos.admin && !Object.keys(datos.permisos).length && !confirm('Este usuario no va a tener ninguna vista habilitada (no va a poder entrar). ¿Guardar igual?')) return;
  const btn = document.getElementById('usrGuardarBtn');
  btn.disabled = true;
  try {
    const u = nuevo ? await usrPedir('POST', '', datos) : await usrPedir('PUT', '/'+encodeURIComponent(usrEditando), datos);
    usrEditando = u.usuario;
    await usrCargar();
    usrMensaje(nuevo ? `Usuario "${u.usuario}" creado.` : 'Cambios guardados. Rigen desde el próximo clic de esa persona.', 'ok');
    // si me cambié mis propios permisos, la pantalla se actualiza ya
    if(u.usuario===authUsuarioActual()){ authGuardarPerfil(u); authActualizarUI(); }
  } catch(e){
    usrMensaje(e.message, 'error');
  } finally { btn.disabled = false; }
}
async function usrEliminar(){
  if(!usrEditando || !confirm(`¿Eliminar el usuario "${usrEditando}"? No va a poder volver a entrar. (Sus movimientos ya registrados se conservan con su nombre.)`)) return;
  try {
    await usrPedir('DELETE', '/'+encodeURIComponent(usrEditando));
    usrEditando = null;
    delete document.getElementById('usrForm').dataset.nuevo;
    await usrCargar();
    usrMensaje('Usuario eliminado.', 'ok');
  } catch(e){ usrMensaje(e.message, 'error'); }
}

document.getElementById('usrLista').addEventListener('click', ev=>{
  const b = ev.target.closest('[data-usuario]');
  if(b) usrAbrir(b.getAttribute('data-usuario'));
});
document.getElementById('usrNuevoBtn').addEventListener('click', ()=>usrAbrir(null));
document.getElementById('usrForm').addEventListener('submit', ev=>{ ev.preventDefault(); usrGuardar(); });
document.getElementById('usrEliminarBtn').addEventListener('click', usrEliminar);
document.getElementById('usrAdmin').addEventListener('change', ()=>usrDibujarPermisos(usrLeerPermisos()));
document.getElementById('usrPermisos').addEventListener('click', ev=>{
  const b = ev.target.closest('[data-todo]');
  if(!b) return;
  const fila = b.closest('tr'), checks = [...fila.querySelectorAll('input[data-vista]')];
  const marcar = checks.some(c=>!c.checked); // si falta alguna, marca todas; si están todas, las quita
  checks.forEach(c=>{ c.checked = marcar; });
});
document.getElementById('usrClaveToggle').addEventListener('click', ()=>{
  const i = document.getElementById('usrClave'); i.type = i.type==='password' ? 'text' : 'password';
});
