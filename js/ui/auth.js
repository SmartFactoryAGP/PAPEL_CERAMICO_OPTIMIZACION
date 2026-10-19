/* =========================================================
   LOGIN Y PERMISOS — toda la app pide sesión (nadie entra sin usuario,
   ni siquiera a mirar el Rack). Los usuarios, contraseñas y permisos los
   administra el administrador desde la pestaña "Usuarios"; viven en el
   puente (server/usuarios.js), nunca en el navegador.

   Lo que se guarda acá (sessionStorage: se pierde al cerrar la pestaña,
   no queda una sesión abierta para siempre en una PC compartida) es el
   token y el perfil: nombre, si es administrador y qué vistas puede ver
   en cada área. El perfil solo decide qué se MUESTRA; el que de verdad
   permite o rechaza cada pedido es el puente.
   ========================================================= */
const AUTH_TOKEN_KEY = 'nesting_auth_token_v1';
const AUTH_PERFIL_KEY = 'nesting_auth_perfil_v2';

/* sessionStorage puede no estar disponible (algunos navegadores lo
   bloquean para páginas abiertas como archivo suelto, file://) — si eso
   pasa, se guarda en memoria en vez de romper la página (la única
   diferencia: la sesión no sobrevive a un F5). */
let authMemoriaRespaldo = {};
function authStorageGet(clave){
  try { return sessionStorage.getItem(clave); } catch(e){ return authMemoriaRespaldo[clave]||null; }
}
function authStorageSet(clave, valor){
  try { sessionStorage.setItem(clave, valor); } catch(e){ authMemoriaRespaldo[clave] = valor; }
}
function authStorageRemove(clave){
  try { sessionStorage.removeItem(clave); } catch(e){ delete authMemoriaRespaldo[clave]; }
}

function authToken(){ return authStorageGet(AUTH_TOKEN_KEY) || ''; }
function authPerfil(){
  try { return JSON.parse(authStorageGet(AUTH_PERFIL_KEY) || 'null'); } catch(e){ return null; }
}
function authUsuarioActual(){ const p = authPerfil(); return p ? p.usuario : ''; }
function authEstaLogueado(){ return !!authToken() && !!authPerfil(); }
function authEsAdmin(){ const p = authPerfil(); return !!(p && p.admin); }
function authPuede(areaId, vista){
  const p = authPerfil();
  if(!p) return false;
  return p.admin || !!(p.permisos && p.permisos[areaId] && p.permisos[areaId].includes(vista));
}
function authGuardarPerfil(perfil){
  authStorageSet(AUTH_PERFIL_KEY, JSON.stringify({usuario:perfil.usuario, admin:!!perfil.admin, permisos:perfil.permisos||{}}));
}

/* Para que orders.js (y cualquier otro archivo) sume el token de sesión
   a sus pedidos sin tener que importar nada especial. */
function authHeaders(extra){
  const token = authToken();
  return Object.assign({}, extra||{}, token ? {'x-auth-token': token} : {});
}

/* Si el puente contesta que la sesión venció (o que el administrador
   desactivó al usuario), cualquier pedido de cualquier pantalla lleva de
   vuelta al ingreso — sin esto, cada pantalla mostraría su propio error
   suelto y el operario no sabría qué pasó. */
const authFetchOriginal = window.fetch.bind(window);
window.fetch = async function(entrada, opciones){
  const res = await authFetchOriginal(entrada, opciones);
  if(res.status===401 && authEstaLogueado()){
    const url = typeof entrada==='string' ? entrada : (entrada && entrada.url) || '';
    if(url.includes('/api/') && !url.includes('/api/login')){
      res.clone().json().then(d=>{ if(d && d.sesion===false) authSesionVencida(); }).catch(()=>{});
    }
  }
  return res;
};
function authSesionVencida(){
  authBorrarSesion();
  authMostrarLogin();
  const errorBox = document.getElementById('authLoginError');
  errorBox.textContent = 'Tu sesión venció o cambiaron tus permisos. Volvé a ingresar.';
  errorBox.hidden = false;
}

function authActualizarUI(){
  const logueado = authEstaLogueado();
  document.getElementById('authLoggedIn').hidden = !logueado;
  if(logueado){
    const u = authUsuarioActual();
    document.getElementById('authUsuarioActual').textContent = u;
    document.getElementById('authAvatar').textContent = authIniciales(u);
    document.getElementById('authRolActual').hidden = !authEsAdmin();
  }
  // ajustes técnicos (dirección/clave del puente, simular el Rack): solo administradores
  document.querySelectorAll('[data-solo-admin]').forEach(el=>{ el.hidden = !(logueado && authEsAdmin()); });
  if(typeof areaRefrescarPermisos==='function') areaRefrescarPermisos();
}
function authIniciales(nombre){
  const partes = String(nombre||'').trim().split(/\s+/).filter(Boolean);
  if(!partes.length) return '·';
  return (partes[0][0] + (partes.length>1 ? partes[partes.length-1][0] : '')).toUpperCase();
}

function authMostrarLogin(){
  areaRenderTarjetas();
  document.getElementById('authLoginError').hidden = true;
  appMostrarIngreso();
  setTimeout(()=>document.getElementById('authUsuarioInput').focus(), 60);
}
function authLimpiarFormulario(){
  document.getElementById('authUsuarioInput').value = '';
  document.getElementById('authClaveInput').value = '';
}
function authBorrarSesion(){
  authStorageRemove(AUTH_TOKEN_KEY);
  authStorageRemove(AUTH_PERFIL_KEY);
  if(typeof trDesconectar==='function') trDesconectar();
  authActualizarUI();
}

function authBridgeUrl(){
  // usa la misma función/valor que ya usa Lista de corte, para no
  // duplicar de dónde sale la dirección del puente.
  return (typeof ordBridgeUrl==='function') ? ordBridgeUrl() : document.getElementById('ordBridgeUrl').value.replace(/\/$/, '');
}

/* Entra con el área elegida en el login; si el usuario no tiene ninguna
   vista habilitada ahí, con la primera área en la que sí tenga. */
function authEntrar(areaPreferida){
  const area = areaVistasPermitidas(areaPreferida).length ? areaPreferida : AREAS_CONFIG.orden.find(id=>areaVistasPermitidas(id).length);
  if(!area) return false;
  aplicarArea(area);
  authActualizarUI();
  if(typeof trConectar==='function') trConectar();
  appMostrarApp(areaPrimeraVista(area));
  if(typeof apActualizarBadge==='function') apActualizarBadge(); // pendientes de aprobar, en la pestaña
  return true;
}

async function authIntentarLogin(){
  const usuario = document.getElementById('authUsuarioInput').value.trim();
  const clave = document.getElementById('authClaveInput').value;
  const errorBox = document.getElementById('authLoginError');
  const btn = document.getElementById('authLoginConfirmBtn');
  errorBox.hidden = true;
  if(!usuario || !clave){
    errorBox.textContent = 'Escribí tu usuario y tu contraseña.';
    errorBox.hidden = false;
    return;
  }
  btn.disabled = true; btn.classList.add('cargando');
  try {
    const res = await authFetchOriginal(authBridgeUrl()+'/api/login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({usuario, clave})
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || ('HTTP '+res.status));
    authStorageSet(AUTH_TOKEN_KEY, data.token);
    authGuardarPerfil(data);
    authLimpiarFormulario();
    if(!authEntrar(areaSeleccionadaEnLogin())){
      authBorrarSesion();
      throw new Error('Tu usuario todavía no tiene ninguna vista habilitada. Pedíle al administrador que te dé permisos.');
    }
  } catch(e){
    errorBox.textContent = e.message==='Failed to fetch'
      ? 'No se pudo conectar con el puente. ¿Está encendido el servidor?'
      : e.message;
    errorBox.hidden = false;
  } finally {
    btn.disabled = false; btn.classList.remove('cargando');
  }
}

/* Al abrir la app con una sesión guardada (F5), se pide el perfil actual
   al puente: si el administrador cambió los permisos mientras tanto, la
   pantalla ya arranca con los nuevos. Devuelve true si la sesión sigue. */
async function authRefrescarSesion(){
  if(!authToken()) return false;
  try {
    const res = await authFetchOriginal(authBridgeUrl()+'/api/sesion', {headers: authHeaders()});
    if(res.status===401){ authBorrarSesion(); return false; }
    if(res.ok) authGuardarPerfil(await res.json());
  } catch(e){ /* puente caído: se sigue con el perfil guardado; los pedidos avisarán */ }
  return authEstaLogueado();
}

async function authCerrarSesion(){
  try {
    await authFetchOriginal(authBridgeUrl()+'/api/logout', { method:'POST', headers: authHeaders() });
  } catch(e){ /* si el puente no responde, de todas formas cerramos acá */ }
  authBorrarSesion();
  authMostrarLogin(); // vuelve a la pantalla de ingreso
}

document.getElementById('authLoginForm').addEventListener('submit', ev=>{ ev.preventDefault(); authIntentarLogin(); });
document.getElementById('authUsuarioInput').addEventListener('keydown', ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); document.getElementById('authClaveInput').focus(); } });
document.getElementById('authLogoutBtn').addEventListener('click', authCerrarSesion);
// ojo de la contraseña: mostrar / ocultar lo que se escribió
document.getElementById('authClaveToggle').addEventListener('click', ()=>{
  const input = document.getElementById('authClaveInput');
  const ver = input.type==='password';
  input.type = ver ? 'text' : 'password';
  document.getElementById('authClaveToggle').setAttribute('aria-pressed', ver ? 'true' : 'false');
  document.getElementById('authClaveToggle').setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
});

authActualizarUI();
