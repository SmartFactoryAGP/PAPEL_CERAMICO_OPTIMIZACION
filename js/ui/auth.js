/* =========================================================
   LOGIN — Lista de corte, Nesting y Editor de archivos piden sesión;
   el Rack queda siempre abierto para cualquiera, sin pedir nada.

   El token vive en sessionStorage (se pierde solo al cerrar la
   pestaña/navegador — no queda una sesión abierta para siempre en una
   PC compartida) y se manda en cada pedido a los endpoints que lo
   exigen. Las contraseñas nunca se guardan acá, ni en ningún archivo
   de este código — viven solo en el .env del puente.
   ========================================================= */
const AUTH_TOKEN_KEY = 'nesting_auth_token_v1';
const AUTH_USUARIO_KEY = 'nesting_auth_usuario_v1';

/* sessionStorage puede no estar disponible (algunos navegadores lo
   bloquean para páginas abiertas como archivo suelto, file://, según
   su configuración de seguridad) — si eso pasa, se guarda en una
   variable común en memoria en vez de romper toda la página. La única
   diferencia práctica: con la reserva en memoria, la sesión no
   sobrevive a un F5/recargar la página (con sessionStorage sí). */
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
function authUsuarioActual(){ return authStorageGet(AUTH_USUARIO_KEY) || ''; }
function authEstaLogueado(){ return !!authToken(); }

/* Para que orders.js (y cualquier otro archivo) sume el token de sesión
   a sus pedidos sin tener que importar nada especial. */
function authHeaders(extra){
  const token = authToken();
  return Object.assign({}, extra||{}, token ? {'x-auth-token': token} : {});
}

function authActualizarUI(){
  const logueado = authEstaLogueado();
  document.getElementById('authLoggedOut').hidden = logueado;
  document.getElementById('authLoggedIn').hidden = !logueado;
  document.body.classList.toggle('sinSesion', !logueado); // las pestañas que piden sesión se ven con candado
  if(logueado){
    const u = authUsuarioActual();
    document.getElementById('authUsuarioActual').textContent = u;
    document.getElementById('authAvatar').textContent = authIniciales(u);
  }
}
function authIniciales(nombre){
  const partes = String(nombre||'').trim().split(/\s+/).filter(Boolean);
  if(!partes.length) return '·';
  return (partes[0][0] + (partes.length>1 ? partes[partes.length-1][0] : '')).toUpperCase();
}

/* La pantalla de ingreso: si se llega acá desde una pestaña que pide
   sesión, el área que estaba activa queda preseleccionada. */
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
/* "Ver solo el Rack": entra sin contraseña, con el área elegida — el Rack
   es para cualquiera (las demás pestañas quedan con candado). */
function authEntrarSoloRack(){
  aplicarArea(areaSeleccionadaEnLogin());
  authLimpiarFormulario();
  appMostrarApp('rack');
}

function authBridgeUrl(){
  // usa la misma función/valor que ya usa Lista de corte, para no
  // duplicar de dónde sale la dirección del puente.
  return (typeof ordBridgeUrl==='function') ? ordBridgeUrl() : document.getElementById('ordBridgeUrl').value.replace(/\/$/, '');
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
    const res = await fetch(authBridgeUrl()+'/api/login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({usuario, clave})
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || ('HTTP '+res.status));
    authStorageSet(AUTH_TOKEN_KEY, data.token);
    authStorageSet(AUTH_USUARIO_KEY, data.usuario);
    aplicarArea(areaSeleccionadaEnLogin());
    authActualizarUI();
    authLimpiarFormulario();
    appMostrarApp('ordenes');
  } catch(e){
    errorBox.textContent = e.message==='Failed to fetch'
      ? 'No se pudo conectar con el puente. ¿Está encendido el servidor?'
      : e.message;
    errorBox.hidden = false;
  } finally {
    btn.disabled = false; btn.classList.remove('cargando');
  }
}

async function authCerrarSesion(){
  try {
    await fetch(authBridgeUrl()+'/api/logout', { method:'POST', headers: authHeaders() });
  } catch(e){ /* si el puente no responde, de todas formas cerramos acá */ }
  authStorageRemove(AUTH_TOKEN_KEY);
  authStorageRemove(AUTH_USUARIO_KEY);
  authActualizarUI();
  authMostrarLogin(); // vuelve a la pantalla de ingreso
}

document.getElementById('authLoginBtn').addEventListener('click', authMostrarLogin);
document.getElementById('authLoginForm').addEventListener('submit', ev=>{ ev.preventDefault(); authIntentarLogin(); });
document.getElementById('authUsuarioInput').addEventListener('keydown', ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); document.getElementById('authClaveInput').focus(); } });
document.getElementById('authRackOnlyBtn').addEventListener('click', authEntrarSoloRack);
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
