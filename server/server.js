/* =========================================================
   PUENTE "LISTA DE CORTE" — app de Nesting <-> SQL Server
   =========================================================
   Qué hace: la app (que corre en tu navegador, abierta con doble clic)
   no puede hablar con SQL Server directamente — ningún navegador puede.
   Este es un servicio chico que SÍ tiene el driver de SQL Server, corre
   en tu misma PC, y le da a la app 3 direcciones simples para pedirle
   datos con fetch() normal. TODO pide sesión salvo login y salud, y cada
   endpoint verifica el permiso del usuario (área + vista) — entre
   corchetes, la vista que hace falta:

     GET  /api/ordenes-pendientes        -> lista de órdenes por cortar [ordenes]
     GET  /api/ordenes-pendientes/:orden -> UNA orden por número, sin el filtro de Puestodetrabajo [ordenes]
     GET  /api/lote/:codigo              -> todas las órdenes 0132 de un Código_Lote [ordenes]
     GET  /api/dxf?orden=...&archivo=...  -> el contenido del DXF de una orden [ordenes]
     GET  /api/rack-simulado              -> rack de casillas compartido (archivo local, no SQL) [rack u ordenes]
     POST /api/rack-simulado/agregar      -> agrega una orden al rack [ordenes]
     POST /api/rack-simulado/:orden/salida -> saca una orden del rack [rack]
     GET  /api/rack-simulado/:orden/ultima-salida -> última salida de ESA orden (para reentradas) [rack]
     POST /api/rack-simulado/reentrada    -> reingresa una orden EN LA MISMA POSICIÓN que tenía [rack]
     GET  /api/inventario                 -> stock de Tecoflex por material y medida [rack]
     POST /api/inventario/movimientos     -> entradas / salidas de stock, en lote [rack]
     GET  /api/eventos                    -> avisos en vivo (Server-Sent Events) [sesión]
     GET  /api/rack-resumen-dia           -> cuántas entraron/salieron del rack hoy [ordenes o rack]
     POST /api/imprimir-zpl               -> manda stickers a la Zebra [ordenes o rack]
     POST /api/ordenes/:orden/marcar-en-stock  -> marca una orden como cortada en SQL [ordenes; bloqueado salvo PERMITIR_ESCRITURA_SQL=true]
     GET  /api/rack-actual                -> órdenes en el rack (en SQL) [rack u ordenes]
     POST /api/rack/:orden/salida         -> salida en SQL [rack; bloqueado salvo PERMITIR_ESCRITURA_SQL=true]
     POST /api/login, /api/logout, GET /api/sesion -> sesión (ver server/usuarios.js)
     GET/POST/PUT/DELETE /api/usuarios    -> administración de usuarios [solo administradores]
     GET  /api/salud                      -> ¿está vivo? (sin sesión)

   Módulos: usuarios.js (cuentas y sesiones), datos.js (dónde vive cada
   archivo), racks.js y inventario.js (almacenamiento de cada rack — lo que
   se reemplaza el día que pasen a SQL), en-vivo.js (avisos en vivo).

   Cómo arrancarlo:
     1) copiá ".env.example" a ".env" y completá tus datos reales
        (servidor, base, usuario/contraseña o autenticación de Windows,
        y la ruta de la carpeta compartida donde están los DXF)
     2) en esta carpeta: npm install
     3) npm start
     4) dejalo corriendo (esta ventana abierta) mientras usás la app

   *** LO ÚNICO QUE TENÉS QUE AJUSTAR ***: las consultas SQL en
   `server/queries.js` — este archivo (server.js) no hace falta tocarlo,
   y en una actualización futura de la app podés reemplazarlo tranquilo
   sin perder tus consultas: viven aparte, en queries.js.
   ========================================================= */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sql = require('mssql');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const crypto = require('crypto');

// las consultas viven en su propio archivo (queries.js) para que
// actualizar server.js en el futuro nunca te pise lo que ya completaste
// ahí. Si todavía no lo armaste, usa la plantilla de ejemplo (con los
// nombres de tabla genéricos) y te avisa en la consola.
let queries;
try {
  queries = require('./queries');
} catch(e){
  console.warn('⚠ No encontré server/queries.js — usando queries.example.js con nombres genéricos.');
  console.warn('  Copiá queries.example.js a queries.js y completá tu tabla/columnas reales.');
  queries = require('./queries.example');
}

/* Áreas de trabajo (Papel cerámico / Tecoflex / Mallas): la MISMA
   configuración que usa la app (js/core/areas-config.js), así las
   posiciones y materiales que se validan acá nunca difieren de los que
   se muestran en pantalla. */
const AREAS_CONFIG = require(path.join(__dirname, '..', 'js', 'core', 'areas-config.js'));
// datos en server/datos/, una carpeta por rack (ver server/datos.js);
// la primera vez mueve ahí lo que estaba suelto en server/
const datos = require('./datos');
datos.migrar(Object.keys(AREAS_CONFIG.areas));
const { errorHttp, esHoy } = require('./comun');
const usuarios = require('./usuarios');
usuarios.iniciar(AREAS_CONFIG, process.env.AUTH_USUARIOS, datos.rutas.usuarios());
const enVivo = require('./en-vivo').crear(usuarios);
const notificar = enVivo.notificar;
const racksMod = require('./racks');
const racks = racksMod.crear({ datos, notificar });
const inventario = require('./inventario').crear({ datos, notificar });
/* Área del pedido: la app la manda en la cabecera x-area (ver
   ordApiHeaders en orders.js). Sin cabecera = papel cerámico, para que
   todo lo que ya existía siga funcionando igual. */
function areaDe(req){
  const id = String(req.get('x-area') || req.query.area || AREAS_CONFIG.porDefecto).trim().toLowerCase();
  const area = AREAS_CONFIG.areas[id];
  if(!area) throw errorHttp(`área de trabajo desconocida: "${id.slice(0, 40)}"`);
  return area;
}
/* Consulta SQL propia de un área (Tecoflex y Mallas viven en OTRAS
   tablas — se completan en queries.js → areas.<área>). Mientras no esté
   cargada, se contesta 501 con un mensaje claro en vez de fallar raro. */
function consultaDeArea(area, nombre){
  const q = queries.areas && queries.areas[area.id] && queries.areas[area.id][nombre];
  if(!q) throw errorHttp(`La consulta de ${area.nombre} todavía no está configurada (server/queries.js → areas.${area.id}.${nombre}).`, 501, { pendiente: true });
  return q;
}
/* Respuesta de error estándar de los endpoints. Los errores PREVISTOS
   (con código: 400 área desconocida, 501 consulta pendiente, etc.) se
   contestan tal cual. Los IMPREVISTOS (el driver de SQL, el disco, la
   impresora) traen detalles internos: nombre del servidor, usuario de la
   base, rutas de la PC. Esos solo se le muestran a un administrador; al
   resto le llega un aviso genérico, y el detalle completo queda siempre en
   la ventana del puente. */
function mensajeDeError(err, req){
  if(err.status && err.status < 500) return err.message;
  if(err.status === 501 || err.status === 503) return err.message;
  if(req && req.usuarioObj && req.usuarioObj.admin) return err.message;
  return 'Error interno del puente. El detalle quedó registrado en la ventana del puente; si se repite, avisale al administrador.';
}
function responderError(res, etiqueta, err){
  console.error(`[${etiqueta}]`, err.message);
  res.status(err.status || 500).json({ error: mensajeDeError(err, res.req), pendiente: !!err.pendiente });
}

const app = express();
app.disable('x-powered-by'); // no anunciar qué servidor es (pista gratis para un atacante)

/* Cabeceras de seguridad en todas las respuestas:
   - nosniff: el navegador no "adivina" el tipo de un archivo (un JSON nunca
     se ejecuta como script).
   - frame-ancestors / X-Frame-Options: ninguna otra página puede meter la
     app adentro de un marco invisible para hacerle tocar botones al
     usuario sin que se dé cuenta (clickjacking).
   - Referrer-Policy: las direcciones internas no se filtran a otros sitios.
   - object-src / base-uri: cierran dos vías clásicas de inyección. */
app.use((req, res, next)=>{
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  if(req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store'); // datos y sesiones: nunca al caché del disco
  next();
});

const PORT = process.env.PORT || 4000;

/* Direcciones de red de ESTA pc (todas las tarjetas, no solo
   localhost) — se usan tanto para el cartel que se imprime al
   arrancar ("otras PC, usen esta dirección") como, acá abajo, para el
   filtro de CORS: hace falta calcularlas ACÁ arriba (antes se
   calculaban más abajo, solo para el cartel) porque si no, el propio
   filtro de CORS terminaba bloqueando exactamente la forma de uso que
   el cartel recomienda (ver el bug de abajo). */
const os = require('os');
function direccionesDeRed(){
  const ifaces = os.networkInterfaces();
  const direcciones = [];
  Object.values(ifaces).forEach(lista=>{
    (lista||[]).forEach(info=>{
      if(info.family==='IPv4' && !info.internal) direcciones.push(info.address);
    });
  });
  return direcciones;
}
const ORIGENES_LAN = new Set(direccionesDeRed().map(ip=>`http://${ip}:${PORT}`));

// CORS: antes dejaba pasar CUALQUIER origen, lo que en teoría permite
// que cualquier página que abras en el navegador (no solo esta app) le
// pida datos a este puente sin que te des cuenta. Se restringió a
// "origen null" (doble clic) y localhost — pero eso bloqueaba en la
// PRÁCTICA el propio uso multi-PC que este mismo server recomienda al
// arrancar ("otras PC, entren con http://TU-IP:4000") — desde esa
// dirección, cualquier pedido del navegador (fetch/login/etc.) traía
// Origin=http://TU-IP:4000, que no matcheaba ni "null" ni localhost, y
// quedaba bloqueado con "origen no permitido" — HTTP 500 en el login,
// aunque el usuario/clave estuvieran bien. Ahora también se permite el
// origen si es justo la/las direcciones de red de ESTA MISMA pc (las
// que ya se imprimen al arrancar) — sigue sin aceptar una página
// cualquiera de otro lado. */
app.use(cors({
  origin: (origin, cb)=>{
    if(!origin || origin==='null' || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || ORIGENES_LAN.has(origin)) return cb(null, true);
    cb(errorHttp('origen no permitido', 403));
  }
}));
app.use(express.json());

/* ============ Servir la app también desde acá ============
   Así, en vez de abrir index.html con doble clic (o desde una carpeta
   compartida), cualquiera en la misma red puede escribir la dirección
   de esta PC en el navegador (la misma que ya te muestra más abajo,
   al arrancar) y usar la app directo, sin archivos que copiar ni
   actualizar en cada PC — cuando vos actualices los archivos ACÁ, todos
   ven la versión nueva solos la próxima vez que entren.

   OJO DE SEGURIDAD: se sirve solo index.html, css/, js/ e img/ — nunca
   la carpeta server/ (ahí vive tu .env, con contraseñas de SQL). No se
   usa un "servir toda la carpeta" genérico a propósito, para que jamás
   quede expuesto ese archivo por error. Va ANTES que la clave
   (API_TOKEN) para que la página siempre cargue — la clave sigue
   pidiéndose igual para los pedidos a /api/...

   OJO — bug encontrado en vivo: faltaba agregar img/ acá (solo estaban
   css/ y js/) — por eso el logo de AGP y el favicon se veían rotos al
   entrar por la dirección del puente (http://IP:4000), aunque
   funcionaban bien abriendo index.html con doble clic (ahí el
   navegador los lee directo del disco, sin pasar por este server). */
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));
/* Caché del navegador para los archivos estáticos: index.html los pide
   con "?v=AAAAMMDDx" (y ese número se sube en cada actualización), así
   que una URL versionada nunca cambia de contenido — se puede guardar un
   año sin volver a preguntar. Antes, cada carga de la página en cada PC
   revalidaba los ~25 archivos uno por uno. Lo que se pide SIN versión
   (logo, favicon) se revalida como siempre. index.html nunca se cachea
   (es el que trae las versiones nuevas). */
const estaticoOpts = {
  setHeaders(res){
    if(/[?&]v=/.test(res.req.originalUrl)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
};
app.use('/css', express.static(path.join(__dirname, '..', 'css'), estaticoOpts));
app.use('/js', express.static(path.join(__dirname, '..', 'js'), estaticoOpts));
app.use('/img', express.static(path.join(__dirname, '..', 'img'), estaticoOpts));

// Clave opcional para hablarle al puente. Si completás API_TOKEN en tu
// .env, todo pedido tiene que traer el header "x-api-token" con el mismo
// valor — así, aunque el puerto quedara expuesto sin querer en tu red,
// no cualquiera puede leer o escribir tus órdenes. Si dejás API_TOKEN
// vacío (como viene por defecto), no se pide nada, para no complicar el
// arranque inicial.
/* Compara dos secretos (clave del puente, contraseña) en tiempo
   constante: con un === común, lo que tarda la comparación depende de
   cuántos caracteres del principio coinciden, y eso se puede medir desde
   la red para ir adivinando la clave de a un carácter. Mismo resultado
   (true/false) que el === de antes. */
function secretoIgual(recibido, esperado){
  const a = Buffer.from(String(recibido==null ? '' : recibido), 'utf8');
  const b = Buffer.from(String(esperado), 'utf8');
  if(a.length !== b.length){ crypto.timingSafeEqual(b, b); return false; }
  return crypto.timingSafeEqual(a, b);
}

app.use((req, res, next)=>{
  const token = process.env.API_TOKEN;
  if(!token) return next(); // sin clave configurada, no se exige nada
  // la conexión en vivo (EventSource) no puede mandar cabeceras: ahí va en la URL
  const recibido = req.get('x-api-token') || (req.path==='/api/eventos' ? req.query.api_token : undefined);
  if(secretoIgual(recibido, token)) return next();
  res.status(401).json({ error: 'falta o no coincide x-api-token' });
});

// Registro de los pedidos que CAMBIAN algo (POST), para poder rastrear
// después quién hizo qué y cuándo. Antes se registraba TODO pedido, incluidas
// las consultas que cada PC hace sola: con 30 PCs eran varias líneas por
// segundo, y en Windows escribir en la consola es sincrónico — frenaba el
// puente entero. Los errores se siguen registrando siempre (ver más abajo).
app.use((req, res, next)=>{
  if(req.method !== 'GET') console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

/* ============ Usuarios, sesiones y permisos ============
   Ver server/usuarios.js. Toda la app pide sesión (nadie entra sin
   usuario, ni siquiera a mirar el Rack), y cada endpoint verifica el
   permiso del usuario para ESA vista en ESA área — no alcanza con que
   la pestaña esté escondida en la pantalla. */
/* Freno de intentos por IP: después de 8 fallidos en 10 min, se frena el
   login un rato. La contraseña ahora se verifica en otro hilo (asíncrona),
   así que los pedidos de una MISMA IP se atienden en fila, de a uno: si
   no, mandando 100 a la vez se probaban todos antes de que el primero
   llegara a contar como fallido. Las demás IPs no esperan, y 30 personas
   entrando juntas desde una misma IP solo esperan unos milisegundos. */
const LOGIN_VENTANA_MS = 10*60*1000, LOGIN_MAX_FALLIDOS = 8;
const intentosLogin = new Map(); // ip -> {n, desde}
const filaLogin = new Map();     // ip -> promesa del último login en curso
setInterval(()=>{ // sin esto, cada IP que alguna vez falló quedaba en memoria para siempre
  const ahora = Date.now();
  intentosLogin.forEach((r, ip)=>{ if(ahora - r.desde > LOGIN_VENTANA_MS) intentosLogin.delete(ip); });
}, LOGIN_VENTANA_MS).unref();
async function intentarLogin(ip, usuario, clave){
  const ahora = Date.now();
  const reg = intentosLogin.get(ip) || {n:0, desde:ahora};
  if(ahora - reg.desde > LOGIN_VENTANA_MS){ reg.n = 0; reg.desde = ahora; }
  if(reg.n >= LOGIN_MAX_FALLIDOS) return { status: 429, cuerpo: { error: 'Demasiados intentos fallidos. Esperá unos minutos y volvé a probar.' } };
  const s = (typeof usuario==='string' && typeof clave==='string' && usuario && clave && clave.length <= 200)
    ? await usuarios.login(usuario, clave) : null;
  if(!s){ reg.n++; intentosLogin.set(ip, reg); return { status: 401, cuerpo: { error: 'usuario o contraseña incorrectos' } }; }
  intentosLogin.delete(ip);
  return { status: 200, cuerpo: { ok: true, ...s } };
}
app.post('/api/login', async (req, res) => {
  const ip = req.ip;
  const { usuario, clave } = req.body || {};
  const turno = (filaLogin.get(ip) || Promise.resolve()).then(()=>intentarLogin(ip, usuario, clave));
  const fin = turno.catch(()=>{});
  filaLogin.set(ip, fin);
  fin.then(()=>{ if(filaLogin.get(ip)===fin) filaLogin.delete(ip); });
  try {
    const r = await turno;
    res.status(r.status).json(r.cuerpo);
  } catch(err){ responderError(res, 'login', err); }
});
app.post('/api/logout', (req, res) => {
  usuarios.logout(req.get('x-auth-token'));
  enVivo.revisarSesiones(); // su conexión en vivo se corta ya
  res.json({ ok: true });
});

/* Sesión válida (cabecera x-auth-token; la conexión en vivo, que no puede
   mandar cabeceras, lo manda como ?auth=). Deja el usuario en req. */
function exigirLogin(req, res, next){
  const u = usuarios.deSesion(req.get('x-auth-token') || (req.path==='/api/eventos' ? req.query.auth : undefined));
  if(!u) return res.status(401).json({ error: 'Tu sesión venció o no iniciaste sesión. Volvé a ingresar.', sesion: false });
  req.usuarioObj = u;
  req.usuario = u.usuario;
  next();
}
/* Sesión + permiso para alguna de esas vistas en el área del pedido. */
function exigirPermiso(...vistas){
  return (req, res, next)=>exigirLogin(req, res, ()=>{
    let area;
    try { area = areaDe(req); } catch(e){ return res.status(e.status||400).json({ error: e.message }); }
    if(vistas.some(v=>usuarios.puede(req.usuarioObj, area.id, v))) return next();
    res.status(403).json({ error: `Tu usuario no tiene permiso para esto en ${area.nombre}. Pedíselo al administrador.` });
  });
}
function exigirAdmin(req, res, next){
  exigirLogin(req, res, ()=>{
    if(req.usuarioObj.admin) return next();
    res.status(403).json({ error: 'Solo un administrador puede hacer esto.' });
  });
}

// quién soy y qué puedo ver (la app lo pide al abrir, por si cambiaron mis permisos)
app.get('/api/sesion', exigirLogin, (req, res) => res.json(usuarios.publico(req.usuarioObj)));

/* ---- administración de usuarios (solo administradores) ---- */
// después de cada cambio, las conexiones en vivo de quien quedó desactivado
// o borrado se cortan (sus pedidos normales ya se rechazaban)
const responderAdmin = (res, fn) => {
  try { res.json(fn()); enVivo.revisarSesiones(); }
  catch(e){ responderError(res, 'usuarios', e); }
};
app.get('/api/usuarios', exigirAdmin, (req, res) => responderAdmin(res, ()=>usuarios.listar()));
app.post('/api/usuarios', exigirAdmin, (req, res) => responderAdmin(res, ()=>usuarios.crear(req.body||{}, req.usuario)));
app.put('/api/usuarios/:usuario', exigirAdmin, (req, res) => responderAdmin(res, ()=>usuarios.modificar(req.params.usuario, req.body||{}, req.usuario)));
app.delete('/api/usuarios/:usuario', exigirAdmin, (req, res) => responderAdmin(res, ()=>{ usuarios.eliminar(req.params.usuario, req.usuario); return {ok:true}; }));

/* El driver de SQL Server (mssql) trae por default 15 segundos de
   límite tanto para CONECTAR como para que una consulta termine — si
   tu SQL Server está lejos en la red, con VPN, o la vista
   SAGA_View_Ficha_Componentes_Colombia es pesada, 15s a veces no
   alcanza y la consulta corta con "Timeout: Request failed to
   complete in 15000ms" aunque el SQL en sí esté bien (no es un error
   de la app, es justo ese límite). Se sube a un valor bastante más
   generoso por default; si igual llega a tardar más que esto, ya es
   señal de que conviene mirar la consulta/red del lado de SQL (con tu
   DBA o el área de sistemas), no de la app. Se puede ajustar sin
   tocar este archivo poniendo DB_REQUEST_TIMEOUT_MS /
   DB_CONNECTION_TIMEOUT_MS en tu .env. */
const DB_REQUEST_TIMEOUT_MS = parseInt(process.env.DB_REQUEST_TIMEOUT_MS || '60000', 10);
const DB_CONNECTION_TIMEOUT_MS = parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '30000', 10);
/* Aceptar el certificado del SQL Server sin verificarlo: hace falta con
   los servidores internos que usan un certificado propio (el caso normal),
   pero deja la puerta abierta a que alguien en la red se haga pasar por el
   servidor. Si sistemas instala un certificado válido, poner
   DB_TRUST_SERVER_CERTIFICATE=false en el .env lo exige. */
const CONFIAR_CERTIFICADO = String(process.env.DB_TRUST_SERVER_CERTIFICATE || 'true').toLowerCase() !== 'false';

const dbConfig = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  requestTimeout: DB_REQUEST_TIMEOUT_MS,
  connectionTimeout: DB_CONNECTION_TIMEOUT_MS,
  options: {
    trustServerCertificate: CONFIAR_CERTIFICADO,
    // autenticación de Windows si no hay usuario/contraseña cargados
    trustedConnection: String(process.env.DB_TRUSTED_CONNECTION).toLowerCase() === 'true'
  }
};
if(process.env.DB_USER){
  dbConfig.user = process.env.DB_USER;
  dbConfig.password = process.env.DB_PASSWORD;
}

/* Si la conexión (o el pool ya conectado) queda rota — SQL se cayó, la
   VPN se cortó, lo que sea — antes esto quedaba pegado con el mismo
   intento fallido para siempre hasta reiniciar "iniciar.bat" a mano.
   Ahora, apenas un intento de conectar falla, se olvida ese intento
   (poolPromise = null) para que el PRÓXIMO pedido arranque una
   conexión nueva de cero en vez de heredar la misma que ya no sirve. */
let poolPromise = null;
function getPool(){
  if(!poolPromise){
    poolPromise = sql.connect(dbConfig).catch(err=>{ poolPromise = null; throw err; });
  }
  return poolPromise;
}

/* ============ Segundo servidor SQL: Calendario ============
   Es OTRO servidor, distinto al de la lista de corte — ahí vive
   Puestodetrabajo. Se arma esta conexión aparte (con su propio
   sql.ConnectionPool, no con sql.connect() como la de arriba, para que
   las dos convivan sin pisarse) y se usa como un BUSCARV: por cada
   orden de la lista de corte, busca su Puestodetrabajo por número de
   orden y lo pega en la respuesta.

   Si no completás CAL_DB_SERVER en tu .env, esto queda desactivado
   solo — Puestodetrabajo llega vacío en la app, pero el resto de la
   lista de corte sigue andando igual. Si el servidor de Calendario
   llegara a fallar (caído, credenciales vencidas, lo que sea), tampoco
   se cae la lista de corte — solo se avisa en esta consola y
   Puestodetrabajo queda vacío para esa consulta. */
const dbConfigCalendario = process.env.CAL_DB_SERVER ? {
  server: process.env.CAL_DB_SERVER,
  database: process.env.CAL_DB_DATABASE,
  port: parseInt(process.env.CAL_DB_PORT || '1433', 10),
  requestTimeout: DB_REQUEST_TIMEOUT_MS,
  connectionTimeout: DB_CONNECTION_TIMEOUT_MS,
  options: {
    trustServerCertificate: CONFIAR_CERTIFICADO,
    trustedConnection: String(process.env.CAL_DB_TRUSTED_CONNECTION).toLowerCase() === 'true'
  }
} : null;
if(dbConfigCalendario && process.env.CAL_DB_USER){
  dbConfigCalendario.user = process.env.CAL_DB_USER;
  dbConfigCalendario.password = process.env.CAL_DB_PASSWORD;
}

let poolCalendarioPromise = null;
function getPoolCalendario(){
  if(!poolCalendarioPromise){
    poolCalendarioPromise = new sql.ConnectionPool(dbConfigCalendario).connect()
      .catch(err=>{ poolCalendarioPromise = null; throw err; });
  }
  return poolCalendarioPromise;
}

/* SQL Server acepta como máximo 2100 parámetros por consulta — un
   "IN (@p0, @p1, ...)" con más órdenes que eso falla entero. Antes, con
   una lista de corte grande, eso hacía que traerPuestosDeTrabajo cayera
   al catch, devolviera {} y el filtro de Puestodetrabajo escondiera en
   silencio TODAS las órdenes. Ahora las listas largas se consultan por
   tandas y se juntan los resultados — con listas chicas (una sola tanda)
   es exactamente la misma consulta que antes. */
const MAX_PARAMS_POR_CONSULTA = 1000;
function enTandas(lista, tam){
  const tandas = [];
  for(let i=0; i<lista.length; i+=tam) tandas.push(lista.slice(i, i+tam));
  return tandas;
}
/* Arma "@prefijo0,@prefijo1,..." registrando cada valor como parámetro
   VarChar del request — el patrón de siempre para los IN dinámicos. */
function placeholdersIn(request, prefijo, valores){
  return valores.map((v,i)=>{ request.input(prefijo+i, sql.VarChar, String(v)); return '@'+prefijo+i; }).join(',');
}

async function traerPuestosDeTrabajo(ordenes){
  if(!dbConfigCalendario || !ordenes.length) return {};
  try {
    const pool = await getPoolCalendario();
    const cfg = queries.puestoDeTrabajo;
    const mapa = {};
    for(const tanda of enTandas(ordenes, MAX_PARAMS_POR_CONSULTA)){
      const request = pool.request();
      const placeholders = placeholdersIn(request, 'cal', tanda);
      const result = await request.query(
        `SELECT ${cfg.columnaOrden} AS orden, ${cfg.columnaPuesto} AS puesto FROM ${cfg.tabla} WHERE ${cfg.columnaOrden} IN (${placeholders})`
      );
      result.recordset.forEach(r=>{ mapa[String(r.orden)] = r.puesto; });
    }
    return mapa;
  } catch(err){
    console.error('[puesto-de-trabajo]', err.message);
    return {};
  }
}

/* OJO — bloque nuevo (pedido explícito): además de Operation='0132',
   hay órdenes que NO tienen esa Operation pero SÍ tienen que estar en
   Lista de corte igual, porque en el mismo "BUSCARV" contra Calendario
   (la tabla de arriba, la de Puestodetrabajo) traen alguno de los
   códigos de ZFER que pongas en tu .env (ZFER_LISTA_ESPECIAL) — hoy
   '70005171', pero puede haber más de uno, y VOS los agregás ahí
   directo, sin que haga falta tocar código cada vez que aparezca uno
   nuevo (ver .env.example para el formato). ZFER es otra columna de
   esa MISMA tabla de Calendario (columnaZfer en puestoDeTrabajo,
   queries.js) — no de tu vista SAGA.
   Esta función busca, en Calendario, qué números de orden tienen
   CUALQUIERA de esos ZFER — devuelve solo los NÚMEROS (strings), no
   los datos completos: los datos completos (archivo, modelo, etc.)
   hay que traerlos aparte de tu vista real, porque Calendario no los
   tiene. */
const ZFER_INCLUIR = (process.env.ZFER_LISTA_ESPECIAL || '70005171')
  .split(',').map(s=>s.trim()).filter(Boolean);
/* La orden puede tener VARIAS filas en tu vista real, una por cada
   Operation (0132, 0101, etc. — distintas etapas del mismo pedido) —
   cada una con su propio Desenho_Path. Para las órdenes que entran por
   cualquiera de los ZFER de arriba, dijiste que el archivo/ruta
   correcto es el de la fila Operation='0101' puntualmente (no
   cualquiera de sus filas) — esto es una Operation, no un código de
   ZFER, son dos cosas distintas que no hay que confundir. Si el día de
   mañana necesitás que sea otra Operation, también lo podés cambiar en
   el .env (OPERATION_PARA_ORDENES_ZFER, ver .env.example). */
const OPERATION_PARA_ORDENES_ZFER = process.env.OPERATION_PARA_ORDENES_ZFER || '0101';
async function traerOrdenesConZferEspecial(){
  const cfg = queries.puestoDeTrabajo;
  if(!dbConfigCalendario || !cfg.columnaZfer || !ZFER_INCLUIR.length) return [];
  try {
    const pool = await getPoolCalendario();
    const request = pool.request();
    const placeholders = placeholdersIn(request, 'zfer', ZFER_INCLUIR);
    const result = await request
      .query(`SELECT DISTINCT ${cfg.columnaOrden} AS orden FROM ${cfg.tabla} WHERE ${cfg.columnaZfer} IN (${placeholders})`);
    return result.recordset.map(r=>String(r.orden));
  } catch(err){
    console.error('[zfer-especial]', err.message);
    return [];
  }
}

/* Trae, de tu vista real, los datos completos (mismas columnas que
   ordenesPendientes/ordenPorSerial) de una lista puntual de números de
   orden — pero puntualmente de la fila Operation='0101' de cada una
   (ver OPERATION_PARA_ORDENES_ZFER arriba), NO cualquier fila: la
   orden puede tener otra fila con Operation='0132' (o distinta) con un
   Desenho_Path distinto, y ese no es el que corresponde acá. Usa el
   mismo patrón de placeholders dinámicos que traerPuestosDeTrabajo,
   contra tu SQL principal (no Calendario). */
async function buscarOrdenesPorSerial(seriales, operacion){
  if(!seriales.length || !queries.ordenesPorSerialLista) return [];
  try {
    const pool = await getPool();
    let filas = [];
    for(const tanda of enTandas(seriales, MAX_PARAMS_POR_CONSULTA)){
      const request = pool.request();
      const placeholders = placeholdersIn(request, 'zs', tanda);
      request.input('opFiltro', sql.VarChar, operacion);
      const query = queries.ordenesPorSerialLista.replace('{{LISTA}}', placeholders);
      const result = await request.query(query);
      filas = filas.concat(result.recordset);
    }
    return filas;
  } catch(err){
    console.error('[ordenes-por-serial-lista]', err.message);
    return [];
  }
}

/* ============ 1) Lista de órdenes pendientes de cortar ============ */
/* Solo se muestran en "Lista de corte" las órdenes cuyo Puestodetrabajo
   (el que viene del servidor de Calendario) sea justo uno de estos 5 —
   las demás (incluidas las que no tienen ningún Puestodetrabajo
   cargado todavía) se ocultan. Comparación sin importar mayúsculas ni
   espacios de más, para no repetir el mismo lío que tuvimos con
   Centro_Trabalho. */
const PUESTOS_PERMITIDOS = new Set(['PLANEACION','01CORTE','02CNC','03SERIG','04SER_VT']);
function puestoPermitido(valor){
  return PUESTOS_PERMITIDOS.has(String(valor||'').trim().toUpperCase());
}

/* Pendientes de Tecoflex / Mallas: otras tablas, con su propia consulta
   (queries.js → areas.<área>.ordenesPendientes). Tiene que devolver las
   mismas columnas que la de papel cerámico (Ordem_Serial, ARCHIVO...) y,
   para Tecoflex, opcionalmente "Medida" (la posición del rack que se
   sugiere al confirmar). No se le aplica el filtro de Puestodetrabajo de
   papel cerámico — ese filtro es propio de esa área. */
async function pendientesDeArea(area){
  const consulta = consultaDeArea(area, 'ordenesPendientes'); // antes de conectar: si falta, "pendiente" y listo
  const pool = await getPool();
  const result = await pool.request().query(consulta);
  return result.recordset;
}

/* Pedidos iguales casi simultáneos se juntan en UNA consulta: con 30
   personas tocando "Actualizar" a la vez, antes salían 30 consultas
   pesadas a SQL (y otras 30 a Calendario) al mismo tiempo. Ahora, mientras
   una está en curso, las demás esperan esa misma; y el resultado se
   reusa unos segundos. Si falla, no se guarda (el próximo reintenta). */
const CACHE_PENDIENTES_MS = parseInt(process.env.CACHE_PENDIENTES_MS || '15000', 10);
const cacheConsultas = new Map(); // clave -> {hasta, promesa}
function consultaCompartida(clave, ttlMs, fn){
  const c = cacheConsultas.get(clave);
  if(c && (c.enCurso || Date.now() < c.hasta)) return c.promesa;
  const entrada = { enCurso: true, hasta: 0 };
  entrada.promesa = fn().then(
    v=>{ entrada.enCurso = false; entrada.hasta = Date.now() + ttlMs; return v; },
    e=>{ cacheConsultas.delete(clave); throw e; }
  );
  cacheConsultas.set(clave, entrada);
  return entrada.promesa;
}

app.get('/api/ordenes-pendientes', exigirPermiso('ordenes'), async (req, res) => {
  try {
    const area = areaDe(req);
    const filas = await consultaCompartida('pendientes:'+area.id, CACHE_PENDIENTES_MS, ()=>area.id==='papel' ? pendientesPapel() : pendientesDeArea(area));
    res.json(filas);
  } catch (err) {
    responderError(res, 'ordenes-pendientes', err);
  }
});
async function pendientesPapel(){
  const pool = await getPool();
  // la consulta principal (SQL de SAGA) y la de ZFER (Calendario, OTRO
  // servidor) no dependen una de la otra: van en paralelo, así el tiempo
  // de respuesta es el de la más lenta y no la suma de las dos.
  const [result, serialesZfer] = await Promise.all([
    pool.request().query(queries.ordenesPendientes),
    traerOrdenesConZferEspecial()
  ]);
  let filas = result.recordset;

  // pedido explícito: sumar las órdenes que NO tienen Operation='0132'
  // pero sí tienen ZFER='70005171' en Calendario — mismo tratamiento que
  // las de siempre (archivo/ruta real, Puestodetrabajo, y el MISMO
  // filtro de Puestodetrabajo permitido de abajo) una vez que se
  // juntan con las demás.
  const seriales0132 = new Set(filas.map(f=>String(f.Ordem_Serial)));
  const nuevosPorZfer = serialesZfer.filter(s=>!seriales0132.has(s));
  if(nuevosPorZfer.length){
    const extra = await buscarOrdenesPorSerial(nuevosPorZfer, OPERATION_PARA_ORDENES_ZFER);
    filas = filas.concat(extra);
  }

  const puestos = await traerPuestosDeTrabajo(filas.map(f=>f.Ordem_Serial));
  filas.forEach(f=>{ f.Puestodetrabajo = puestos[String(f.Ordem_Serial)] || ''; });
  return filas.filter(f=>puestoPermitido(f.Puestodetrabajo));
}

/* Búsqueda puntual de UNA orden por su número, para el "Ingreso
   rápido" de Lista de corte: a propósito NO aplica el filtro de
   Puestodetrabajo de arriba (una orden con Puestodetrabajo en blanco,
   o en cualquier otro valor, se puede seguir agregando a mano al lote
   si el programador conoce el número) — la única condición que se
   mantiene es Operation='0132' (ver ordenPorSerial en queries.js).
   Devuelve encontrada:false si no existe ninguna orden con ese número
   y esa operación, en vez de un error — es un resultado normal, no
   una falla. */
app.get('/api/ordenes-pendientes/:orden', exigirPermiso('ordenes'), async (req, res) => {
  try {
    const area = areaDe(req);
    const esPapel = area.id === 'papel';
    const consulta = esPapel ? queries.ordenPorSerial : consultaDeArea(area, 'ordenPorSerial');
    const pool = await getPool();
    const result = await pool.request()
      .input('orden', sql.VarChar, req.params.orden)
      .query(consulta);
    if(!result.recordset.length) return res.json({ encontrada: false });
    const fila = result.recordset[0];
    if(esPapel){
      const puestos = await traerPuestosDeTrabajo([fila.Ordem_Serial]);
      fila.Puestodetrabajo = puestos[String(fila.Ordem_Serial)] || '';
    }
    res.json({ encontrada: true, orden: fila });
  } catch (err) {
    responderError(res, 'ordenes-pendientes/:orden', err);
  }
});

/* Todas las órdenes de un "Código_Lote" (tabla de lotes de vidrios,
   DF_SAGA_LotesVidro), para agregarlas de una al lote de corte en vez
   de escribirlas una por una en el "Ingreso rápido" de arriba. Mismo
   criterio que ordenPorSerial: solo exige Operation='0132' (no
   Centro_Trabalho ni Puestodetrabajo), y trae el Puestodetrabajo real
   igual (para mostrarlo), sin usarlo para ocultar ninguna. La consulta
   (ordenesPorLote en queries.js) ya devuelve sin duplicados por orden
   DENTRO de este lote; si la app pide dos códigos de lote distintos que
   comparten una orden, el dedupe entre ellos lo hace el frontend
   (orders.js), no esta ruta. */
app.get('/api/lote/:codigo', exigirPermiso('ordenes'), async (req, res) => {
  try {
    const area = areaDe(req);
    const esPapel = area.id === 'papel';
    const consulta = esPapel ? queries.ordenesPorLote : consultaDeArea(area, 'ordenesPorLote');
    const pool = await getPool();
    const result = await pool.request()
      .input('lote', sql.VarChar, req.params.codigo)
      .query(consulta);
    const filas = result.recordset;
    if(esPapel){
      const puestos = await traerPuestosDeTrabajo(filas.map(f=>f.Ordem_Serial));
      filas.forEach(f=>{ f.Puestodetrabajo = puestos[String(f.Ordem_Serial)] || ''; });
    }
    res.json(filas);
  } catch (err) {
    responderError(res, 'lote/:codigo', err);
  }
});

/* ============ Racks de casillas, COMPARTIDOS entre todas las PC ============
   Viven en archivos de ESTA PC (la que corre el puente), no en SQL ni en
   cada navegador: todas las computadoras ven exactamente el mismo rack.
   El almacenamiento está en server/racks.js; acá solo los endpoints. */
const conArea = (fn, soloCasillas = true) => (req, res) => {
  let area;
  try { area = areaDe(req); if(soloCasillas) racksMod.exigirCasillas(area); }
  catch(e){ return responderError(res, req.path, e); }
  try { fn(req, res, area); } catch(e){ responderError(res, req.path, e); }
};

app.get('/api/rack-simulado', exigirPermiso('rack','ordenes'), conArea((req, res, area) => {
  res.json(racks.leer(area));
}));

app.post('/api/rack-simulado/agregar', exigirPermiso('ordenes'), conArea((req, res, area) => {
  const orden = racksMod.limpiarOrden(req.body);
  const lista = racks.leer(area);
  if(lista.find(o=>o.Ordem_Serial===orden.Ordem_Serial)){
    return res.status(409).json({ error: 'esa orden ya está en el rack' });
  }
  const ubicacion = racksMod.proximaUbicacionLibre(area, lista);
  if(!ubicacion) return res.status(409).json({ error: `rack lleno, las ${racksMod.capacidad(area)} ubicaciones están ocupadas` });
  lista.push({ ...orden, ubicacion });
  racks.guardar(area, lista);
  racks.agregarAlHistorial(area, { area: area.id, Ordem_Serial: orden.Ordem_Serial, ubicacion, usuario: req.usuario, evento: 'entrada' });
  res.json({ ok: true, ubicacion });
}));

app.post('/api/rack-simulado/:orden/salida', exigirPermiso('rack'), conArea((req, res, area) => {
  const { orden } = req.params;
  const lista = racks.leer(area);
  // se guarda el renglón COMPLETO antes de sacarlo: si después hace falta
  // una reentrada por error del operario, se reconstruye la orden entera
  // (ubicación incluida) sin volver a pedir nada a SQL
  const encontrada = lista.find(o=>o.Ordem_Serial === orden);
  // si no estaba, no se reescribe el archivo ni se avisa a todas las PCs
  if(encontrada){
    racks.guardar(area, lista.filter(o=>o.Ordem_Serial !== orden));
    racks.agregarAlHistorial(area, { area: area.id, Ordem_Serial: orden, ubicacion: encontrada.ubicacion, orden: encontrada, usuario: req.usuario||null, evento: 'salida' });
  }
  res.json({ ok: true, sacada: !!encontrada });
}));

/* Para la "reentrada": dado un número de orden que NO está ahora en el
   rack, busca en el historial la ÚLTIMA vez que salió y en qué posición
   estaba, para reingresarla ahí mismo (útil cuando le dieron salida por
   error). */
app.get('/api/rack-simulado/:orden/ultima-salida', exigirPermiso('rack'), conArea((req, res, area) => {
  const { orden } = req.params;
  if(racks.leer(area).some(o=>o.Ordem_Serial === orden)) return res.json({ encontrada: false, motivo: 'la orden ya está en el rack ahora mismo' });
  const historial = racks.leerHistorial(area);
  // el historial solo crece: recorriendo desde el final, la primera
  // 'salida' de esta orden es la más reciente
  for(let i=historial.length-1; i>=0; i--){
    const h = historial[i];
    if(h.Ordem_Serial===orden && h.evento==='salida' && h.ubicacion){
      return res.json({ encontrada: true, ubicacion: h.ubicacion, orden: h.orden||null, fecha: h.fecha });
    }
  }
  res.json({ encontrada: false, motivo: 'no hay ninguna salida registrada para esa orden' });
}));

/* Reingresa una orden FORZANDO una ubicación (la que tenía). Si esa
   posición ya la ocupa OTRA orden, se rechaza en vez de pisarla. */
app.post('/api/rack-simulado/reentrada', exigirPermiso('rack'), conArea((req, res, area) => {
  const { ubicacion } = req.body || {};
  const orden = racksMod.limpiarOrden((req.body && req.body.orden) || {});
  if(!ubicacion) return res.status(400).json({ error: 'falta la ubicación a reingresar' });
  if(!racksMod.ubicacionValida(area, ubicacion)) return res.status(400).json({ error: `la ubicación "${String(ubicacion).slice(0, 10)}" no existe en este rack` });
  const lista = racks.leer(area);
  if(lista.find(o=>o.Ordem_Serial===orden.Ordem_Serial)){
    return res.status(409).json({ error: 'esa orden ya está en el rack' });
  }
  const ocupante = lista.find(o=>o.ubicacion===ubicacion);
  if(ocupante){
    return res.status(409).json({ error: `la posición ${ubicacion} ya la ocupa la orden ${ocupante.Ordem_Serial} — sacala primero, o reingresá esta desde "+ Agregar" para que le asignen otra posición libre` });
  }
  lista.push({ ...orden, ubicacion });
  racks.guardar(area, lista);
  racks.agregarAlHistorial(area, { area: area.id, Ordem_Serial: orden.Ordem_Serial, ubicacion, usuario: req.usuario, evento: 'reentrada' });
  res.json({ ok: true, ubicacion });
}));

/* Resumen del día: cuántas entraron y salieron del rack HOY. */
app.get('/api/rack-resumen-dia', exigirPermiso('ordenes','rack'), conArea((req, res, area) => {
  let cortadasHoy = 0, sacadasHoy = 0;
  const historial = racks.leerHistorial(area);
  // el historial está en orden de llegada: se recorre desde el final y se
  // corta en el primer registro de otro día (antes se filtraba entero)
  for(let i=historial.length-1; i>=0; i--){
    const h = historial[i];
    if(!esHoy(h.fecha)) break;
    if(h.evento==='entrada') cortadasHoy++;
    else if(h.evento==='salida') sacadasHoy++;
  }
  res.json({ cortadasHoy, sacadasHoy, enRackAhora: racks.leer(area).length });
}, false)); // también la piden las áreas sin rack de casillas (contesta ceros)

/* ============ Inventario por material y medida (Tecoflex) ============
   Lógica y almacenamiento en server/inventario.js. */
app.get('/api/inventario', exigirPermiso('rack'), (req, res) => {
  try { res.json(inventario.consultar(areaDe(req), req.query.version)); }
  catch(e){ responderError(res, 'inventario', e); }
});
app.post('/api/inventario/movimientos', exigirPermiso('rack'), (req, res) => {
  try {
    const r = inventario.registrar(areaDe(req), req.body, req.usuario);
    res.status(r.status).json(r.cuerpo);
  } catch(e){ responderError(res, 'inventario/movimientos', e); }
});

/* ============ Cambios en vivo (ver server/en-vivo.js) ============ */
app.get('/api/eventos', exigirLogin, enVivo.manejar);

/* ============ Impresión directa de stickers en la Zebra (USB) ============
   La Zebra está conectada por USB a ESTA PC (la que corre el puente),
   no por red — por eso la impresión tiene que salir de acá, no del
   navegador (ningún navegador puede mandarle datos crudos a una
   impresora). El texto ZPL ya viene armado desde el navegador
   (js/export/stickers.js); acá solo se lo pasa a Windows tal cual,
   usando el nombre de la impresora COMPARTIDA que pusiste en
   ZEBRA_PRINTER_SHARE — Windows entiende que un archivo copiado "en
   crudo" a una impresora compartida (incluso compartida con vos mismo,
   en la misma PC) se manda directo al hardware, sin intentar
   interpretarlo ni convertirlo en imagen. Por eso hace falta que esa
   impresora esté instalada en modo "Generic / Text Only" — ver
   CONECTAR_SQL.md para el paso a paso de esa configuración, una sola
   vez.
   Si no completaste ZEBRA_PRINTER_SHARE en tu .env, este endpoint
   avisa claro en vez de fallar raro — la app entonces sigue ofreciendo
   el PDF de stickers como respaldo. */
app.post('/api/imprimir-zpl', exigirPermiso('ordenes','rack'), (req, res) => {
  const printerShare = process.env.ZEBRA_PRINTER_SHARE;
  if(!printerShare){
    return res.status(501).json({ error: 'ZEBRA_PRINTER_SHARE no está configurado en tu .env — todavía no se puede imprimir directo (ver CONECTAR_SQL.md).' });
  }
  // el nombre va dentro de un comando de Windows: solo caracteres de un
  // nombre de recurso compartido (nada de comillas, & o |, que permitirían
  // colar otro comando si el .env tuviera algo raro)
  if(!/^[\w.$ -]{1,80}$/.test(printerShare)){
    return res.status(500).json({ error: 'ZEBRA_PRINTER_SHARE tiene caracteres no válidos en el .env (solo letras, números, espacio, punto, guion y $).' });
  }
  const { zpl } = req.body || {};
  if(typeof zpl !== 'string' || !zpl) return res.status(400).json({ error: 'falta el contenido ZPL a imprimir' });

  const tmpFile = path.join(os.tmpdir(), `sticker_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.zpl`);
  try {
    fs.writeFileSync(tmpFile, zpl, 'utf8');
  } catch(err){
    return responderError(res, 'imprimir-zpl', err);
  }
  // "copy /b" manda el archivo TAL CUAL (binario/crudo), sin que Windows
  // intente convertirlo — es el mismo truco que se usa hace años para
  // mandar ZPL/PCL/PostScript crudo a una impresora desde la línea de
  // comandos. \\localhost\NombreCompartido apunta a la impresora
  // instalada en ESTA MISMA PC, usando su nombre de recurso compartido.
  const comando = `copy /b "${tmpFile}" "\\\\localhost\\${printerShare}"`;
  // con tope de tiempo: si la impresora no contesta, el pedido no queda
  // colgado para siempre (la app cae sola al PDF de respaldo)
  exec(comando, { timeout: 30000, windowsHide: true }, (err, stdout, stderr) => {
    fs.unlink(tmpFile, ()=>{}); // limpieza del temporal; si falla no importa, no bloquea la respuesta
    if(err){
      console.error('[imprimir-zpl]', stderr);
      err.message = 'no se pudo mandar a imprimir: ' + err.message;
      return responderError(res, 'imprimir-zpl', err);
    }
    res.json({ ok: true });
  });
});

/* ============ 2) Contenido del DXF de una orden ============
   Dos formas de traerlo, según DXF_SOURCE en tu .env:
   - "sql"  (default): el DXF está guardado ADENTRO de la fila en SQL
     (columna de texto o binaria) — no hace falta ninguna carpeta
     compartida. Usa queries.dxfPorOrden, buscando por número de orden.
   - "file": el DXF es un archivo suelto en una carpeta de la red — usa
     DXF_BASE_PATH + el nombre de archivo, como antes.
   La app siempre manda los dos datos (orden y archivo) en el pedido,
   así no hace falta que el navegador sepa cuál de los dos modos tenés
   configurado — este endpoint elige solo. */
const DXF_MAX_BYTES = 50 * 1048576;
const RAIZ_APP = path.resolve(__dirname, '..');
const DXF_PREFIJOS = (process.env.DXF_ALLOWED_PREFIXES || '')
  .split(',').map(s=>s.trim().replace(/\//g,'\\').replace(/\\+$/,'').toLowerCase()).filter(Boolean);
/* "archivo" llega en la URL, mandado por el navegador: normalmente es lo
   que trae tu SQL (Desenho_Path), pero alguien con sesión puede escribir
   otra cosa a mano. Sin estos controles, con eso se podía:
   - leer CUALQUIER archivo de esta PC, incluido server/.env (con las
     contraseñas de SQL) y usuarios.json;
   - hacer que esta PC se conecte a una carpeta de red de otra máquina
     (\\otra-pc\x) y le entregue, sin querer, el hash de la contraseña de
     Windows del usuario que corre el puente.
   Reglas: solo archivos .dxf; nada de ".." para salirse de una carpeta;
   nunca dentro de la carpeta de esta app; y si DXF_ALLOWED_PREFIXES está
   completo, solo dentro de esas carpetas (comparando la carpeta entera:
   "\\srv\cnc" no deja pasar "\\srv\cnc-otra"). */
function rutaDxfPermitida(archivo){
  if(typeof archivo !== 'string' || !archivo.trim()) return { error: 'falta el parámetro "archivo"' };
  if(archivo.length > 1024 || archivo.includes('\0')) return { error: 'nombre de archivo no permitido' };
  if(!/\.dxf$/i.test(archivo.trim())) return { error: 'solo se pueden abrir archivos .dxf' };
  if(archivo.split(/[\\/]+/).some(seg=>seg.trim()==='..')) return { error: 'nombre de archivo no permitido' };
  const esRutaCompleta = /^(\\\\|\/|[a-zA-Z]:[\\/])/.test(archivo);
  let fullPath;
  if(esRutaCompleta){
    // la base de datos ya trae la ruta COMPLETA (ej. \\servidor\carpeta\...):
    // se usa tal cual, sin sumarle DXF_BASE_PATH
    if(DXF_PREFIJOS.length){
      const norm = archivo.replace(/\//g,'\\').toLowerCase();
      if(!DXF_PREFIJOS.some(p=>norm.startsWith(p + '\\'))) return { error: 'ruta de archivo no permitida (fuera de DXF_ALLOWED_PREFIXES)' };
    }
    fullPath = archivo;
  } else {
    // nombre suelto: se le suma DXF_BASE_PATH y tiene que quedar adentro
    const base = path.resolve(process.env.DXF_BASE_PATH || '');
    fullPath = path.resolve(base, archivo);
    if(!fullPath.startsWith(base + path.sep)) return { error: 'nombre de archivo no permitido' };
  }
  const resuelta = path.resolve(fullPath).toLowerCase();
  if(resuelta === RAIZ_APP.toLowerCase() || resuelta.startsWith(RAIZ_APP.toLowerCase() + path.sep)) return { error: 'nombre de archivo no permitido' };
  return { fullPath };
}
app.get('/api/dxf', exigirPermiso('ordenes'), async (req, res) => {
  const source = (process.env.DXF_SOURCE || 'sql').toLowerCase();
  try {
    if(source === 'file'){
      const r = rutaDxfPermitida(req.query.archivo);
      if(r.error) return res.status(400).json({ error: r.error });
      // asíncrono: leer de una carpeta de red puede tardar segundos (o
      // colgarse si el servidor de archivos no contesta). Con la lectura
      // sincrónica de antes, ese rato el puente no atendía a NADIE más.
      let st;
      try { st = await fs.promises.stat(r.fullPath); }
      catch(e){
        if(e.code==='ENOENT' || e.code==='ENOTDIR') return res.status(404).json({ error: `no se encontró el archivo: ${r.fullPath}` });
        throw e;
      }
      if(!st.isFile()) return res.status(400).json({ error: 'la ruta pedida no es un archivo' });
      if(st.size > DXF_MAX_BYTES) return res.status(413).json({ error: `el DXF pesa ${Math.round(st.size/1048576)} MB; el máximo es ${DXF_MAX_BYTES/1048576} MB` });
      const contenido = await fs.promises.readFile(r.fullPath, 'utf8');
      return res.json({ contenido });
    }

    // modo SQL (default): el DXF viene de la base, no de un archivo
    const orden = req.query.orden;
    if(!orden) return res.status(400).json({ error: 'falta el parámetro "orden"' });
    const area = areaDe(req);
    const consulta = area.id==='papel' ? queries.dxfPorOrden : consultaDeArea(area, 'dxfPorOrden');
    const pool = await getPool();
    const result = await pool.request()
      .input('orden', sql.VarChar, orden)
      .query(consulta);
    if(!result.recordset.length){
      return res.status(404).json({ error: `no se encontró la orden ${orden} (o no tiene DXF cargado)` });
    }
    const raw = result.recordset[0].contenido;
    if(raw === null || raw === undefined){
      return res.status(404).json({ error: `la orden ${orden} no tiene DXF cargado en esa columna` });
    }
    // la columna puede ser de texto (llega como string) o binaria (llega
    // como Buffer) — de las dos formas el DXF es texto plano por dentro,
    // así que se decodifica a UTF-8 si hace falta.
    const contenido = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
    res.json({ contenido });
  } catch (err) {
    responderError(res, 'dxf', err);
  }
});

/* ============ Freno de seguridad: nada escribe en SQL salvo que lo
   actives a propósito ============
   Los dos endpoints de abajo (marcar-en-stock y rack/salida) son los
   ÚNICOS lugares de todo este puente que podrían escribir algo en tu
   SQL — ningún otro endpoint hace INSERT/UPDATE/MERGE en ningún lado,
   ni acá ni en el servidor de Calendario. Por default (sin tocar nada
   en tu .env) los dos quedan bloqueados acá mismo, del lado del
   servidor — no depende de que nadie deje tildada la casilla "Simular
   el Rack" en la pantalla. Para escribir de verdad necesitás las DOS
   cosas: la tabla NestingControlCorte creada, Y esta variable puesta a
   propósito en true. */
const PERMITIR_ESCRITURA_SQL = String(process.env.PERMITIR_ESCRITURA_SQL || '').toLowerCase() === 'true';
function bloquearSiSoloLectura(req, res, next){
  if(PERMITIR_ESCRITURA_SQL) return next();
  res.status(403).json({ error: 'Escritura en SQL desactivada a propósito (PERMITIR_ESCRITURA_SQL no está en "true" en tu .env) — este puente solo lee mientras tanto. El Rack se maneja simulado en el navegador.' });
}

/* ============ 3) Marcar una orden como ya cortada / en stock ============ */
/* El rack en SQL (tabla NestingControlCorte) existe solo para papel
   cerámico; Tecoflex y Mallas se manejan con el rack simulado del puente
   hasta que tengan su propia tabla. */
function exigirRackSql(req, res, next){
  let area;
  try { area = areaDe(req); } catch(e){ return responderError(res, 'rack-sql', e); }
  if(area.rackSql) return next();
  res.status(501).json({ error: `El rack de ${area.nombre} todavía no tiene tabla en SQL — se maneja simulado en el puente.`, pendiente: true });
}

app.post('/api/ordenes/:orden/marcar-en-stock', exigirPermiso('ordenes'), exigirRackSql, bloquearSiSoloLectura, async (req, res) => {
  try {
    const { orden } = req.params;
    const { rack } = req.body || {};
    const pool = await getPool();
    const result = await pool.request()
      .input('orden', sql.VarChar, orden)
      .input('rack', sql.VarChar, rack || null)
      .query(queries.marcarEnStock);
    // rowsAffected en 0 significa: no existía, o alguien ya la había
    // marcado antes — mejor avisar que fallar en silencio como si hubiera
    // funcionado.
    // la consulta de marcarEnStock ahora es de varios pasos (calcula el
    // rack y después hace el MERGE) — sumamos todas las filas afectadas
    // en vez de mirar solo la primera, para no depender de en qué paso
    // exacto del lote de sentencias terminó afectando algo.
    const afectadas = (result.rowsAffected||[]).reduce((a,b)=>a+b, 0);
    if(!afectadas){
      return res.status(409).json({ error: 'la orden no existe o ya estaba marcada (¿otra persona la marcó primero?)' });
    }
    // el último SELECT del lote de sentencias (ver marcarEnStock en
    // queries.js) trae la ubicación que quedó asignada, para que la
    // app pueda armar el sticker sin tener que consultar de nuevo.
    const ubicacion = result.recordset && result.recordset[0] ? result.recordset[0].ubicacion : null;
    notificar({ tipo:'rack', area: 'papel' });
    res.json({ ok: true, ubicacion });
  } catch (err) {
    responderError(res, 'marcar-en-stock', err);
  }
});

/* ============ 4) Órdenes que están ahora mismo en el rack ============ */
app.get('/api/rack-actual', exigirPermiso('rack','ordenes'), exigirRackSql, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(queries.rackActual);
    const filas = result.recordset;
    const puestos = await traerPuestosDeTrabajo(filas.map(f=>f.Ordem_Serial));
    filas.forEach(f=>{ f.Puestodetrabajo = puestos[String(f.Ordem_Serial)] || ''; });
    res.json(filas);
  } catch (err) {
    // este endpoint queda a propósito SIN login (el Rack es para
    // cualquiera) — pero eso significa que CUALQUIERA en la red podía ver
    // el mensaje de error crudo del driver de SQL (nombre de servidor,
    // detalle de conexión) si SQL estaba caído o lento. El detalle real
    // sigue quedando en la consola del servidor para vos; a quien pregunta
    // por HTTP sin sesión solo le llega un aviso genérico.
    console.error('[rack-actual]', err.message);
    res.status(500).json({ error: 'no se pudo consultar el rack, intentá de nuevo en un momento' });
  }
});

/* ============ 5) Sacar una orden del rack (ya se usó el material) ============ */
// Defensa extra (a pedido): este es el único endpoint que escribe en SQL
// real (tabla NestingControlCorte — nunca la vista SAGA, ver queries.js)
// y no pedía login, a diferencia de su gemelo "marcar-en-stock". Hoy la
// escritura ya está apagada por default (PERMITIR_ESCRITURA_SQL=false), así
// que esto no podía escribir nada de todas formas — pero si el día de
// mañana alguien prende esa bandera, que quede protegido igual que el resto.
app.post('/api/rack/:orden/salida', exigirPermiso('rack'), exigirRackSql, bloquearSiSoloLectura, async (req, res) => {
  try {
    const { orden } = req.params;
    const pool = await getPool();
    await pool.request()
      .input('orden', sql.VarChar, orden)
      .query(queries.rackSalida);
    notificar({ tipo:'rack', area: 'papel' });
    res.json({ ok: true });
  } catch (err) {
    responderError(res, 'rack/salida', err);
  }
});

app.get('/api/salud', (req, res) => res.json({ ok: true, hora: new Date().toISOString() }));

/* Cualquier error que se escape de un endpoint (por ej. un JSON del rack
   dañado, ver leerListaJson, o el rechazo de CORS) contesta JSON con un
   mensaje corto — antes caía en el manejador por defecto de Express, que
   devuelve una página HTML con el stack trace completo a quien preguntó. */
app.use((err, req, res, next) => {
  console.error(`[error] ${req.method} ${req.path}:`, err.message); // req.path: sin ?auth= en la consola
  if(res.headersSent) return next(err);
  res.status(err.status || err.statusCode || 500).json({ error: mensajeDeError({ ...err, message: err.message, status: err.status || err.statusCode }, req), pendiente: !!err.pendiente });
});

/* Sin decirle una dirección puntual, Node ya escucha en TODAS las
   direcciones de red de esta PC (no solo localhost) — así que las otras
   computadoras de la red YA pueden llegar a este puente, con tal de que
   usen la dirección de red de esta máquina en vez de "localhost". Para
   que sea fácil de encontrar, se imprime acá abajo apenas arranca.
   (direccionesDeRed y PORT se calculan arriba de todo, junto con el
   filtro de CORS — acá abajo solo se reusan para el cartel.) */
// los inventarios se cargan al arrancar (no con el primer pedido): si un
// diario tiene problemas se ve ya en esta ventana, y nadie espera la carga
Object.values(AREAS_CONFIG.areas).filter(a=>a.rack.tipo==='inventario').forEach(a=>{
  const inv = inventario.de(a);
  console.log(`Inventario de ${a.nombre}: ${inv.version} movimiento(s) cargados.`);
});
if((process.env.DXF_SOURCE || 'sql').toLowerCase()==='file' && !DXF_PREFIJOS.length){
  console.warn('⚠ DXF_ALLOWED_PREFIXES está vacío en el .env: cualquiera con permiso de Lista de corte puede pedir un .dxf de');
  console.warn('  cualquier carpeta de red. Completalo con las carpetas donde viven los DXF (ver .env.example).');
}
datos.iniciarRespaldos();
app.listen(PORT, () => {
  console.log(`Puente "Lista de corte" escuchando en http://localhost:${PORT}`);
  const ips = direccionesDeRed();
  if(ips.length){
    console.log('');
    console.log('Para usar esto desde OTRA computadora de la misma red, en');
    console.log('"Lista de corte" > "Dirección del puente", poné una de estas:');
    ips.forEach(ip => console.log(`  http://${ip}:${PORT}`));
    console.log('(esta ventana tiene que seguir abierta en ESTA PC mientras las');
    console.log(' demás la usen — es la única que necesita Node.js instalado)');
  }
  console.log('');
  console.log('Dejá esta ventana abierta mientras usás la app de Nesting.');
});
