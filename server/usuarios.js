/* =========================================================
   USUARIOS, CONTRASEÑAS Y PERMISOS
   =========================================================
   Viven en server/datos/usuarios.json (en la PC del puente; no se sube a git).
   Las contraseñas NUNCA se guardan como texto: solo un hash scrypt con
   sal propia por usuario, comparado en tiempo constante.

   Permisos: por área y por vista, por ejemplo
     { papel: ['ordenes','rack'], tecoflex: ['rack'] }
   Un administrador ve y hace todo, y además administra usuarios.

   Primer arranque (no existe usuarios.json): se importan los usuarios de
   AUTH_USUARIOS del .env; "hfrodriguez" (sin importar mayúsculas) queda
   como administrador. Si no hubiera ninguno, se crea "hfrodriguez" con
   una contraseña al azar que se muestra UNA vez en la consola. Después
   de eso, AUTH_USUARIOS ya no se usa: todo se maneja desde la app.
   ========================================================= */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let RUTA = path.join(__dirname, 'datos', 'usuarios.json'); // la define server.js (ver datos.js)
const ADMIN_INICIAL = 'hfrodriguez';
const CLAVE_MIN = 6;
const SESION_INACTIVA_MS = 12 * 60 * 60 * 1000; // 12 h sin usar la app -> vuelve a pedir contraseña

let AREAS = null;           // AREAS_CONFIG (se inyecta desde server.js)
let usuarios = [];          // [{usuario, salt, hash, admin, activo, permisos, creado, actualizado}]
const sesiones = new Map(); // token -> {usuario, ultimoUso}

const clave = u => String(u||'').trim().toLowerCase();
function hashear(texto, salt){ return crypto.scryptSync(String(texto), salt, 64).toString('hex'); }
/* El login usa la versión asíncrona: scrypt tarda ~50 ms a propósito, y la
   sincrónica frenaba el puente entero ese rato (30 personas entrando al
   empezar el turno = más de un segundo con todo congelado). Esta corre en
   otro hilo; el resultado es el mismo hash. */
function hashearAsync(texto, salt){
  return new Promise((ok, mal)=>crypto.scrypt(String(texto), salt, 64, (e, k)=>e ? mal(e) : ok(k)));
}
function nuevaClave(texto){ const salt = crypto.randomBytes(16).toString('hex'); return {salt, hash: hashear(texto, salt)}; }
async function claveCorrecta(u, texto){
  const a = await hashearAsync(texto, u.salt), b = Buffer.from(u.hash, 'hex');
  return a.length===b.length && crypto.timingSafeEqual(a, b);
}
function todosLosPermisos(){
  const p = {};
  Object.values(AREAS.areas).forEach(a=>{ p[a.id] = a.vistas.slice(); });
  return p;
}
/* Deja solo áreas y vistas que existen (lo que llegue de la app se filtra acá). */
function limpiarPermisos(p){
  const out = {};
  Object.values(AREAS.areas).forEach(a=>{
    const v = Array.isArray(p && p[a.id]) ? p[a.id].filter(x=>a.vistas.includes(x)) : [];
    if(v.length) out[a.id] = [...new Set(v)];
  });
  return out;
}

function guardar(){
  const texto = JSON.stringify(usuarios, null, 2), tmp = RUTA + '.tmp';
  fs.writeFileSync(tmp, texto, 'utf8');
  try { fs.renameSync(tmp, RUTA); } catch(e){ fs.writeFileSync(RUTA, texto, 'utf8'); try{ fs.unlinkSync(tmp); }catch(_){} }
}

function iniciar(areasConfig, authUsuariosEnv, ruta){
  AREAS = areasConfig;
  if(ruta) RUTA = ruta;
  if(fs.existsSync(RUTA)){
    usuarios = JSON.parse(fs.readFileSync(RUTA, 'utf8')); // si está dañado, que falle al arrancar y se vea
  } else {
    usuarios = [];
    String(authUsuariosEnv||'').split(',').forEach(par=>{
      const i = par.lastIndexOf(':');
      if(i<0) return;
      const nombre = par.slice(0,i).trim(), pass = par.slice(i+1).trim();
      if(!nombre || !pass || usuarios.some(u=>clave(u.usuario)===clave(nombre))) return;
      const esAdmin = clave(nombre)===ADMIN_INICIAL;
      usuarios.push({usuario:nombre, ...nuevaClave(pass), admin:esAdmin, activo:true,
        permisos: todosLosPermisos(), creado:new Date().toISOString(), actualizado:new Date().toISOString()});
    });
    if(usuarios.length) console.log(`[usuarios] primer arranque: ${usuarios.length} usuario(s) importados de AUTH_USUARIOS a usuarios.json`);
  }
  if(!usuarios.some(u=>u.admin && u.activo)){
    // nunca puede quedar el sistema sin un administrador
    let u = usuarios.find(x=>clave(x.usuario)===ADMIN_INICIAL);
    if(u){ u.admin = true; u.activo = true; }
    else {
      const pass = crypto.randomBytes(6).toString('base64url');
      usuarios.push({usuario:ADMIN_INICIAL, ...nuevaClave(pass), admin:true, activo:true, permisos:todosLosPermisos(),
        creado:new Date().toISOString(), actualizado:new Date().toISOString()});
      console.log(`\n[usuarios] Se creó el administrador "${ADMIN_INICIAL}" con la contraseña: ${pass}\n           Cambiala desde la app (pestaña Usuarios). Este aviso no se repite.\n`);
    }
  }
  guardar();
}

/* ---------- sesiones ---------- */
async function login(nombre, pass){
  const u = usuarios.find(x=>clave(x.usuario)===clave(nombre));
  // se hace el hash igual aunque el usuario no exista: así no se puede
  // averiguar qué usuarios existen midiendo cuánto tarda la respuesta
  const ok = u ? await claveCorrecta(u, pass) : (await hashearAsync(pass, 'x'), false);
  if(!ok || !u.activo) return null;
  const token = crypto.randomBytes(24).toString('hex');
  sesiones.set(token, {usuario:u.usuario, ultimoUso:Date.now()});
  return {token, ...publico(u)};
}
function logout(token){ sesiones.delete(token); }
/* Usuario de la sesión, con sus permisos ACTUALES (si el administrador
   cambió algo, rige en el próximo pedido, sin volver a iniciar sesión).
   renovar:false = solo mirar (lo usa la conexión en vivo: una pestaña
   abierta sin que nadie la use no tiene que mantener viva la sesión). */
function deSesion(token, renovar = true){
  const s = token && sesiones.get(token);
  if(!s) return null;
  const u = usuarios.find(x=>x.usuario===s.usuario);
  if(!u || !u.activo || Date.now()-s.ultimoUso > SESION_INACTIVA_MS){ sesiones.delete(token); return null; }
  if(renovar) s.ultimoUso = Date.now();
  return u;
}
// las sesiones abandonadas (pestaña cerrada sin "Salir") se borran solas:
// si no, cada inicio de sesión dejaba una entrada en memoria para siempre
setInterval(()=>{
  const ahora = Date.now();
  sesiones.forEach((s, t)=>{ if(ahora - s.ultimoUso > SESION_INACTIVA_MS) sesiones.delete(t); });
}, 30*60*1000).unref();
function cerrarSesionesDe(nombre){ sesiones.forEach((s, t)=>{ if(s.usuario===nombre) sesiones.delete(t); }); }
function puede(u, areaId, vista){
  if(!u) return false;
  if(u.admin) return true;
  return !!(u.permisos[areaId] && u.permisos[areaId].includes(vista));
}
function publico(u){
  return {usuario:u.usuario, admin:!!u.admin, activo:!!u.activo, permisos: u.admin ? todosLosPermisos() : u.permisos,
          creado:u.creado, actualizado:u.actualizado};
}

/* ---------- administración ---------- */
function error(msg, status){ const e = new Error(msg); e.status = status||400; return e; }
function listar(){ return usuarios.map(publico); }
function validarNombre(nombre){
  const n = String(nombre||'').trim();
  if(!/^[\p{L}\p{N}._ -]{3,40}$/u.test(n)) throw error('El usuario tiene que tener de 3 a 40 letras o números (se permiten espacio, punto, guion y guion bajo).');
  return n;
}
function validarClave(pass){
  if(String(pass||'').length < CLAVE_MIN) throw error(`La contraseña tiene que tener al menos ${CLAVE_MIN} caracteres.`);
  return String(pass);
}
function crear(datos, autor){
  const nombre = validarNombre(datos.usuario);
  if(usuarios.some(u=>clave(u.usuario)===clave(nombre))) throw error(`Ya existe el usuario "${nombre}".`, 409);
  const u = {usuario:nombre, ...nuevaClave(validarClave(datos.clave)), admin:!!datos.admin, activo: datos.activo!==false,
    permisos: limpiarPermisos(datos.permisos), creado:new Date().toISOString(), actualizado:new Date().toISOString(), creadoPor:autor};
  usuarios.push(u); guardar();
  return publico(u);
}
function adminsActivos(){ return usuarios.filter(u=>u.admin && u.activo).length; }
function modificar(nombre, datos, autor){
  const u = usuarios.find(x=>clave(x.usuario)===clave(nombre));
  if(!u) throw error(`No existe el usuario "${nombre}".`, 404);
  const yoMismo = clave(u.usuario)===clave(autor);
  const quitaAdmin = u.admin && u.activo && ((datos.admin===false) || (datos.activo===false));
  if(quitaAdmin && yoMismo) throw error('No podés quitarte a vos mismo el rol de administrador ni desactivarte.');
  if(quitaAdmin && adminsActivos()<=1) throw error('Tiene que quedar al menos un administrador activo.');
  if(datos.clave!=null && datos.clave!=='') Object.assign(u, nuevaClave(validarClave(datos.clave)));
  if(datos.admin!=null) u.admin = !!datos.admin;
  if(datos.activo!=null) u.activo = !!datos.activo;
  if(datos.permisos!=null) u.permisos = limpiarPermisos(datos.permisos);
  u.actualizado = new Date().toISOString(); u.actualizadoPor = autor;
  guardar();
  // contraseña cambiada o usuario desactivado: sus sesiones abiertas se cierran
  // (si se cambió su propia clave, la sesión actual de quien lo hizo sigue)
  if(!u.activo || (datos.clave && !yoMismo)) cerrarSesionesDe(u.usuario);
  return publico(u);
}
function eliminar(nombre, autor){
  const i = usuarios.findIndex(x=>clave(x.usuario)===clave(nombre));
  if(i<0) throw error(`No existe el usuario "${nombre}".`, 404);
  const u = usuarios[i];
  if(clave(u.usuario)===clave(autor)) throw error('No podés eliminar tu propio usuario.');
  if(u.admin && u.activo && adminsActivos()<=1) throw error('Tiene que quedar al menos un administrador activo.');
  usuarios.splice(i, 1); guardar(); cerrarSesionesDe(u.usuario);
}

module.exports = { iniciar, login, logout, deSesion, puede, publico, listar, crear, modificar, eliminar };
