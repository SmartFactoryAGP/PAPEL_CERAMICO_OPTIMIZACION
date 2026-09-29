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
  document.getElementById('authLoggedOut').style.display = logueado ? 'none' : 'flex';
  document.getElementById('authLoggedIn').style.display = logueado ? 'flex' : 'none';
  if(logueado) document.getElementById('authUsuarioActual').textContent = authUsuarioActual();
}

function authMostrarLogin(){
  document.getElementById('authLoginPanel').style.display = 'block';
  document.getElementById('authLoginError').style.display = 'none';
  document.getElementById('authUsuarioInput').focus();
}
function authOcultarLogin(){
  document.getElementById('authLoginPanel').style.display = 'none';
  document.getElementById('authUsuarioInput').value = '';
  document.getElementById('authClaveInput').value = '';
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
  errorBox.style.display = 'none';
  if(!usuario || !clave) return;
  try {
    const res = await fetch(authBridgeUrl()+'/api/login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({usuario, clave})
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || ('HTTP '+res.status));
    authStorageSet(AUTH_TOKEN_KEY, data.token);
    authStorageSet(AUTH_USUARIO_KEY, data.usuario);
    authActualizarUI();
    authOcultarLogin();
  } catch(e){
    errorBox.textContent = e.message;
    errorBox.style.display = 'block';
  }
}

async function authCerrarSesion(){
  try {
    await fetch(authBridgeUrl()+'/api/logout', { method:'POST', headers: authHeaders() });
  } catch(e){ /* si el puente no responde, de todas formas cerramos acá */ }
  authStorageRemove(AUTH_TOKEN_KEY);
  authStorageRemove(AUTH_USUARIO_KEY);
  authActualizarUI();
  if(typeof switchView==='function') switchView('rack'); // por si estaba en una vista que ya no puede ver
}

document.getElementById('authLoginBtn').addEventListener('click', authMostrarLogin);
document.getElementById('authLoginCancelBtn').addEventListener('click', authOcultarLogin);
document.getElementById('authLoginConfirmBtn').addEventListener('click', authIntentarLogin);
document.getElementById('authClaveInput').addEventListener('keydown', ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); authIntentarLogin(); } });
document.getElementById('authUsuarioInput').addEventListener('keydown', ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); document.getElementById('authClaveInput').focus(); } });
document.getElementById('authLogoutBtn').addEventListener('click', authCerrarSesion);

authActualizarUI();
