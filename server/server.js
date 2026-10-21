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

     GET  /api/ordenes-pendientes[?forzar=1] -> lista de órdenes por cortar, de la última consulta a SQL (1 por hora; forzar: solo administrador) [ordenes]
     GET  /api/ordenes-pendientes/:orden -> UNA orden por número, sin el filtro de Puestodetrabajo [ordenes]
     GET  /api/lote/:codigo              -> todas las órdenes 0132 de un Código_Lote [ordenes]
     GET  /api/dxf?orden=...&archivo=...  -> el contenido del DXF de una orden [ordenes]
     GET  /api/tecoflex/dxf?medida=9      -> el DXF de la tira de esa medida (Tecoflex) [nesting]
     GET  /api/inventario/consumo?desde=&hasta= -> consumo por material y medida en un período [rack]
     GET  /api/rack-simulado              -> rack de casillas compartido (archivo local, no SQL) [rack u ordenes]
     POST /api/rack-simulado/agregar      -> agrega una orden al rack [ordenes]
     POST /api/rack-simulado/:orden/salida -> saca una orden del rack [rack]
     GET  /api/rack-simulado/:orden/ultima-salida -> última salida de ESA orden (para reentradas) [rack]
     POST /api/rack-simulado/reentrada    -> reingresa una orden EN LA MISMA POSICIÓN que tenía [rack]
     GET  /api/inventario                 -> stock de Tecoflex por material y medida [rack]
     POST /api/inventario/movimientos     -> entradas / salidas de stock, en lote [rack]
     GET  /api/eventos                    -> avisos en vivo (Server-Sent Events) [sesión]
     GET  /api/rack-resumen-dia           -> cuántas entraron/salieron del rack hoy [ordenes o rack]
     GET  /api/aprobaciones               -> solicitudes de ZFER + candidatos (papel) [aprobaciones o aprobar]
     POST /api/aprobaciones/solicitar     -> pedir que un ZFER CURVE 02–04 lleve papel [aprobaciones o aprobar]
     POST /api/aprobaciones/:zfer/resolver -> aprobar / rechazar / revocar [aprobar]
     POST /api/imprimir-zpl               -> manda stickers a la Zebra [ordenes o rack]
     POST /api/ordenes/:orden/marcar-en-stock  -> marca una orden como cortada en SQL [ordenes; bloqueado salvo PERMITIR_ESCRITURA_SQL=true]
     GET  /api/rack-actual                -> órdenes en el rack (en SQL) [rack u ordenes]
     POST /api/rack/:orden/salida         -> salida en SQL [rack; bloqueado salvo PERMITIR_ESCRITURA_SQL=true]
     POST /api/login, /api/logout, GET /api/sesion -> sesión (ver server/usuarios.js)
     GET/POST/PUT/DELETE /api/usuarios    -> administración de usuarios [solo administradores]
     GET  /api/salud                      -> ¿está vivo? (sin sesión)

   Módulos: usuarios.js (cuentas y sesiones), datos.js (dónde vive cada
   archivo), racks.js, inventario.js y aprobaciones.js (almacenamiento —
   lo que se reemplaza el día que pasen a SQL), reglas-papel.js (qué orden
   entra a Lista de corte de papel), en-vivo.js (avisos en vivo).

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
const { errorHttp } = require('./comun');
const comprimir = require('./comprimir');
const usuarios = require('./usuarios');
usuarios.iniciar(AREAS_CONFIG, process.env.AUTH_USUARIOS, datos.rutas.usuarios());
const enVivo = require('./en-vivo').crear(usuarios);
const notificar = enVivo.notificar;
const racksMod = require('./racks');
const racks = racksMod.crear({ datos, notificar });
const inventario = require('./inventario').crear({ datos, notificar });
// racks por posiciones (Tejidos): uno por área, ver server/tejidos.js
const racksPosiciones = new Map(Object.values(AREAS_CONFIG.areas).filter(a=>a.rack.tipo==='posiciones')
  .map(a=>[a.id, require('./tejidos').crear({ datos, notificar, area: a })]));
/* Stock por CodMat de un área con Lista de corte por CodMat: el inventario (Mallas) o las posiciones ocupadas (Tejidos). */
const stockDeArea = area => racksPosiciones.has(area.id) ? racksPosiciones.get(area.id).stockPorMaterial() : inventario.stockPorMaterial(area);
const versionStockDeArea = area => racksPosiciones.has(area.id) ? racksPosiciones.get(area.id).version() : inventario.version(area);
const reglasPapel = require('./reglas-papel');
const instantanea = require('./instantanea');
const reglasMallas = require('./reglas-mallas');
const aprobaciones = require('./aprobaciones').crear({ datos, notificar, areaId: 'papel' });
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
app.use(comprimir.middlewareJson); // JSON de la API comprimido (gzip) cuando conviene: ver comprimir.js

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
// index.html y los JS/CSS van comprimidos (gzip, ~4 veces menos): ver comprimir.js
const indexComprimido = comprimir.estaticosComprimidos(path.join(__dirname, '..'), { setHeaders: r=>r.setHeader('Cache-Control', 'no-cache') });
app.get('/', (req, res) => {
  req.url = '/index.html';
  indexComprimido(req, res, ()=>{ req.url = '/'; res.sendFile(path.join(__dirname, '..', 'index.html')); });
});
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
const conVersion = { setHeaders: r=>{ if(/[?&]v=/.test(r.req.originalUrl)) r.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } };
app.use('/css', comprimir.estaticosComprimidos(path.join(__dirname, '..', 'css'), conVersion), express.static(path.join(__dirname, '..', 'css'), estaticoOpts));
app.use('/js', comprimir.estaticosComprimidos(path.join(__dirname, '..', 'js'), conVersion), express.static(path.join(__dirname, '..', 'js'), estaticoOpts));
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

/* "BUSCARV" contra Calendario: por cada orden trae Puestodetrabajo, ZFER,
   PlanCURVE y NivelAGP (una sola consulta por tanda). Los nombres de las
   columnas salen de queries.js → puestoDeTrabajo; PlanCURVE y NivelAGP
   tienen nombre por defecto, así un queries.js viejo (que no se pisa al
   actualizar) funciona sin tocarlo.
   estricto: si Calendario no está configurado o falla, TIRA ERROR en vez
   de devolver {} — sin esos datos no se puede decidir qué orden lleva
   papel, y una lista vacía en silencio confunde más que un aviso claro.
   Sin estricto (el Rack), se sigue sin Puestodetrabajo como siempre. */
function columnasCalendario(){
  const cfg = queries.puestoDeTrabajo || {};
  const col = (nombre, porDefecto) => (cfg[nombre]===undefined ? porDefecto : cfg[nombre]) || 'NULL';
  return { cfg, orden: cfg.columnaOrden, puesto: col('columnaPuesto', 'Puestodetrabajo'), zfer: col('columnaZfer', null),
           planCurve: col('columnaPlanCurve', 'PlanCURVE'), nivel: col('columnaNivelAgp', 'NivelAGP'),
           vehiculo: col('columnaVehiculo', 'Vehiculo') };
}
async function traerCalendario(ordenes, estricto){
  if(!ordenes.length) return {};
  if(!dbConfigCalendario){
    if(estricto) throw errorHttp('Calendario no está configurado (CAL_DB_SERVER en el .env): sin PlanCURVE y NivelAGP no se puede armar la Lista de corte.', 503);
    return {};
  }
  try {
    const pool = await getPoolCalendario();
    const c = columnasCalendario();
    const mapa = {};
    for(const tanda of enTandas(ordenes, MAX_PARAMS_POR_CONSULTA)){
      const request = pool.request();
      const placeholders = placeholdersIn(request, 'cal', tanda);
      const result = await request.query(
        `SELECT ${c.orden} AS orden, ${c.puesto} AS puesto, ${c.zfer} AS zfer, ${c.planCurve} AS planCurve, ${c.nivel} AS nivel, ${c.vehiculo} AS vehiculo
         FROM ${c.cfg.tabla} WHERE ${c.orden} IN (${placeholders})`
      );
      result.recordset.forEach(r=>{
        mapa[String(r.orden)] = { puesto: r.puesto, zfer: r.zfer==null ? '' : String(r.zfer).trim(), planCurve: r.planCurve, nivel: r.nivel,
                                  vehiculo: r.vehiculo==null ? '' : String(r.vehiculo).trim() };
      });
    }
    return mapa;
  } catch(err){
    console.error('[calendario]', err.message);
    if(estricto){ err.message = 'No se pudo consultar Calendario (PlanCURVE / NivelAGP): ' + err.message; throw err; }
    return {};
  }
}
/* Solo el Puestodetrabajo (lo que muestra el Rack en SQL). */
async function traerPuestosDeTrabajo(ordenes){
  const cal = await traerCalendario(ordenes, false);
  const mapa = {};
  Object.keys(cal).forEach(k=>{ mapa[k] = cal[k].puesto; });
  return mapa;
}

/* Órdenes que entran por ZFER aunque NO tengan Operation='0132': las del
   .env (ZFER_LISTA_ESPECIAL, hoy '70005171', X5) y los ZFER aprobados en
   la vista Aprobaciones. Se buscan en Calendario y devuelve solo los
   NÚMEROS de orden: los datos completos (archivo, modelo...) salen de tu
   vista real. Igual tienen que cumplir la regla de PlanCURVE / NivelAGP
   (ver reglas-papel.js). */
const ZFER_ENV = (process.env.ZFER_LISTA_ESPECIAL || '70005171')
  .split(',').map(s=>s.trim()).filter(Boolean);
/* La orden puede tener VARIAS filas en tu vista real, una por cada
   Operation (0132, 0101...), cada una con su propio Desenho_Path. Para las
   órdenes que entran por ZFER, el archivo correcto es el de la fila
   Operation='0101' (OPERATION_PARA_ORDENES_ZFER en el .env). */
const OPERATION_PARA_ORDENES_ZFER = process.env.OPERATION_PARA_ORDENES_ZFER || '0101';
function zferIncluidos(aprobadosSet){
  return [...new Set([...ZFER_ENV.map(reglasPapel.normalizarZfer), ...aprobadosSet])];
}
async function traerOrdenesPorZfer(zfers){
  const c = columnasCalendario();
  if(!dbConfigCalendario || c.zfer==='NULL' || !zfers.length) return [];
  try {
    const pool = await getPoolCalendario();
    const seriales = new Set();
    for(const tanda of enTandas(zfers, MAX_PARAMS_POR_CONSULTA)){
      const request = pool.request();
      const placeholders = placeholdersIn(request, 'zfer', tanda);
      const result = await request.query(`SELECT DISTINCT ${c.orden} AS orden FROM ${c.cfg.tabla} WHERE ${c.zfer} IN (${placeholders})`);
      result.recordset.forEach(r=>seriales.add(String(r.orden)));
    }
    return [...seriales];
  } catch(err){
    console.error('[zfer-especial]', err.message);
    return [];
  }
}

/* Trae, de tu vista real, los datos completos de una lista puntual de
   números de orden, de la fila Operation=@opFiltro de cada una (ver
   OPERATION_PARA_ORDENES_ZFER). */
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
/* Pendientes de Tecoflex / Mallas: otras tablas, con su propia consulta
   (queries.js → areas.<área>.ordenesPendientes). No se les aplica la regla
   de papel cerámico (Calendario, CURVE, nivel). */
async function pendientesDeArea(area){
  const consulta = consultaDeArea(area, 'ordenesPendientes'); // antes de conectar: si falta, "pendiente" y listo
  const pool = await getPool();
  const result = await pool.request().query(consulta);
  return result.recordset;
}

/* ============ La Lista de corte se consulta a SQL UNA vez por hora ============
   Ver server/instantanea.js. Cada área guarda en memoria la última lista
   consultada ("foto") y TODOS la reciben de ahí: tocar "Actualizar" 50
   veces, o 30 PCs abiertas, no llegan nunca a SQL. La foto se renueva sola
   cuando vence (LISTA_ACTUALIZAR_MIN, por defecto 60 min) y solo un
   administrador puede forzarla antes. Cada vez que se renueva, se avisa en
   vivo y las pantallas se ponen al día leyendo la foto (no SQL). */
const LISTA_PERIODO_MS = Math.max(0.01, parseFloat(process.env.LISTA_ACTUALIZAR_MIN || '60') || 60) * 60 * 1000;
const fotosLista = new Map(); // área -> instantánea
function fotoLista(area){
  let f = fotosLista.get(area.id);
  if(!f){
    f = instantanea.crear({
      periodoMs: LISTA_PERIODO_MS,
      minEntreForzadosMs: parseFloat(process.env.LISTA_FORZAR_CADA_S || '30') * 1000,
      cargar: area.id==='papel' ? cargarPapelCrudo : area.listaPorCodmat ? ()=>cargarMallasCrudo(area) : ()=>pendientesDeArea(area),
      alActualizar: ()=>notificar({ tipo:'lista', area: area.id }),
    });
    fotosLista.set(area.id, f);
  }
  return f;
}

/* Papel: la foto guarda las filas CRUDAS (con Calendario pegado) y la
   clasificación (qué entra, qué espera aprobación) se calcula en memoria
   con los ZFER aprobados de ESE momento. Así aprobar o quitar un ZFER
   cambia la lista al instante, sin volver a consultar SQL entera. */
async function cargarPapelCrudo(){
  const aprobados = aprobaciones.aprobados();
  const pool = await getPool();
  // la consulta principal (SQL de SAGA) y la de ZFER (Calendario, OTRO
  // servidor) no dependen una de la otra: van en paralelo
  const [result, serialesZfer] = await Promise.all([
    pool.request().query(queries.ordenesPendientes),
    traerOrdenesPorZfer(zferIncluidos(aprobados))
  ]);
  let filas = result.recordset;
  // las que entran por ZFER (X5 y aprobados) sin tener Operation='0132':
  // se suman con el archivo de la fila 0101 y pasan por la MISMA regla
  const seriales0132 = new Set(filas.map(f=>String(f.Ordem_Serial)));
  const nuevosPorZfer = serialesZfer.filter(s=>!seriales0132.has(s));
  if(nuevosPorZfer.length) filas = filas.concat(marcarPorZfer(await buscarOrdenesPorSerial(nuevosPorZfer, OPERATION_PARA_ORDENES_ZFER)));
  const cal = await traerCalendario(filas.map(f=>f.Ordem_Serial), true);
  return { filas, cal, rev: 0 };
}
/* Las que vinieron SOLO por su ZFER (sin 0132) quedan marcadas: si ese ZFER
   deja de estar incluido (se quita la aprobación), salen de la lista. La
   marca no viaja en el JSON (no enumerable). */
function marcarPorZfer(filas){ filas.forEach(f=>Object.defineProperty(f, '_porZfer', { value: true, enumerable: false })); return filas; }

let memoPapel = { datos: null, rev: -1, clave: null, resultado: null };
function clasificarPapel(datos){
  const aprobados = aprobaciones.aprobados();
  const clave = [...aprobados].sort().join('|');
  const m = memoPapel;
  if(m.datos===datos && m.rev===datos.rev && m.clave===clave) return m.resultado;
  const incluidos = new Set(zferIncluidos(aprobados));
  const filas = datos.filas.filter(f=>!f._porZfer || incluidos.has(reglasPapel.normalizarZfer((datos.cal[String(f.Ordem_Serial)]||{}).zfer)));
  const resultado = reglasPapel.clasificar(filas, datos.cal, aprobados);
  memoPapel = { datos, rev: datos.rev, clave, resultado };
  return resultado;
}

/* Recién aprobado un ZFER: sus órdenes que ya estaban en la foto (las
   0132) entran solas al reclasificar; las que NO tienen 0132 (camino X5,
   archivo de la 0101) se traen con una consulta CHICA, solo de ese ZFER. */
async function sumarOrdenesDeZfer(zfer){
  const f = fotoLista(AREAS_CONFIG.areas.papel);
  if(!f.hayFoto()) return;
  try {
    const seriales = await traerOrdenesPorZfer([zfer]);
    let nuevas = [], cal = {};
    f.modificar(d=>{ const ya = new Set(d.filas.map(x=>String(x.Ordem_Serial))); nuevas = seriales.filter(s=>!ya.has(s)); d.rev++; });
    if(!nuevas.length) return;
    const filas = marcarPorZfer(await buscarOrdenesPorSerial(nuevas, OPERATION_PARA_ORDENES_ZFER));
    cal = await traerCalendario(filas.map(x=>x.Ordem_Serial), true);
    f.modificar(d=>{ d.filas.push(...filas); Object.assign(d.cal, cal); d.rev++; });
  } catch(e){ console.error('[aprobaciones] no se pudieron sumar las órdenes del ZFER', zfer, '— entran en la próxima actualización:', e.message); }
}

/* Mallas: la foto guarda las filas de SAGA (una por orden) con Calendario
   pegado; el agrupado por CodMat y puesto, y lo que cubre el stock, se
   calcula al pedirla (ver reglas-mallas.js): una entrada o salida de stock
   cambia "Falta" al instante, sin consultar SQL. */
async function cargarMallasCrudo(area){
  const materiales = ((queries.areas && queries.areas[area.id] && queries.areas[area.id].materiales) || []).map(m=>String(m).toUpperCase());
  let filas;
  if(materiales.length && queries.componentesPorCodmat){
    // una consulta compartida (Mallas y Tejidos), con el nombre ya corregido;
    // cada área se queda con lo que dice SU material en el nombre correcto
    filas = (await componentesConNombre()).filter(f=>materiales.some(m=>String(f.Descricao||'').toUpperCase().includes(m)));
  } else {
    // área con su propia consulta en queries.js (sin lista de materiales)
    const pool = await getPool();
    filas = (await pool.request().query(consultaDeArea(area, 'ordenesPendientes'))).recordset;
  }
  const cal = await traerCalendario(filas.map(f=>f.Ordem_Serial), true);
  return { filas, cal, rev: 0 };
}

/* Componentes de Mallas y Tejidos (queries.componentesPorCodmat) con el
   nombre CORRECTO (ODATA_Fullkit). Las dos áreas se actualizan casi juntas:
   se comparte la misma carga un ratito (COMPONENTES_CACHE_S, 60 s) para no
   hacer dos veces una consulta que en SAGA tarda casi un minuto. */
const COMPONENTES_CACHE_MS = parseFloat(process.env.COMPONENTES_CACHE_S || '60') * 1000;
let componentesCache = { hasta: 0, promesa: null };
function componentesConNombre(){
  if(componentesCache.promesa && Date.now() < componentesCache.hasta) return componentesCache.promesa;
  const promesa = (async()=>{
    const pool = await getPool();
    const filas = (await pool.request().query(queries.componentesPorCodmat)).recordset;
    const nombres = await nombresDeComponentes(filas.map(f=>f.CodMat).filter(debeCorregirNombre));
    filas.forEach(f=>{
      const n = nombres[sinCeros(f.CodMat)];
      if(n && n!==f.Descricao){ f.DescricaoSaga = f.Descricao; f.Descricao = n; } // el de SAGA queda a mano
    });
    return filas;
  })();
  componentesCache = { hasta: Date.now() + COMPONENTES_CACHE_MS, promesa };
  promesa.catch(()=>{ if(componentesCache.promesa===promesa) componentesCache = { hasta: 0, promesa: null }; });
  return promesa;
}

/* ============ Nombre correcto de los componentes (ODATA_Fullkit) ============
   En SAGA, varios componentes (los CodMat que empiezan por 0000000006, como
   las mallas y los tejidos) traen en Desenho_Descricao un nombre que no es
   el original (ej. "ZHAL BUFFER ACEROS CO"). La tabla ODATA_Fullkit (en
   agpcol.database.windows.net, base agpc-productivity) tiene el nombre bien,
   con el mismo código (COMPONENTE). Se busca ahí, una vez por cada
   actualización de la lista. Se activa con FULLKIT_DB_SERVER y
   FULLKIT_DB_DATABASE en el .env (es OTRO servidor que Calendario:
   agpcolcalendario); usuario y clave, si no se ponen, son los de Calendario.
   Si no está configurado o falla, se deja el nombre de SAGA: nunca deja la
   lista vacía ni la frena. */
const sinCeros = v => String(v==null ? '' : v).trim().replace(/^0+/, '');
const debeCorregirNombre = codmat => /^0000000006/.test(String(codmat||'').trim());
const fkEnv = (k, porDefecto) => process.env['FULLKIT_DB_' + k] || porDefecto;
const dbConfigFullkit = process.env.FULLKIT_DB_DATABASE && process.env.FULLKIT_DB_SERVER ? {
  server: process.env.FULLKIT_DB_SERVER,
  database: process.env.FULLKIT_DB_DATABASE,
  port: parseInt(fkEnv('PORT', process.env.CAL_DB_PORT || '1433'), 10),
  requestTimeout: DB_REQUEST_TIMEOUT_MS,
  connectionTimeout: DB_CONNECTION_TIMEOUT_MS,
  options: {
    trustServerCertificate: CONFIAR_CERTIFICADO,
    trustedConnection: String(fkEnv('TRUSTED_CONNECTION', process.env.CAL_DB_TRUSTED_CONNECTION)).toLowerCase() === 'true'
  }
} : null;
if(dbConfigFullkit && fkEnv('USER', process.env.CAL_DB_USER)){
  dbConfigFullkit.user = fkEnv('USER', process.env.CAL_DB_USER);
  dbConfigFullkit.password = fkEnv('PASSWORD', process.env.CAL_DB_PASSWORD);
}
let poolFullkitPromise = null;
function getPoolFullkit(){
  if(!poolFullkitPromise){
    poolFullkitPromise = new sql.ConnectionPool(dbConfigFullkit).connect()
      .catch(err=>{ poolFullkitPromise = null; throw err; });
  }
  return poolFullkitPromise;
}
/* CodMat (como venga) -> nombre correcto, por el código SIN ceros (COMPONENTE
   puede estar guardado con o sin los ceros de SAP: se buscan las dos formas). */
async function nombresDeComponentes(codmats){
  const cfg = queries.nombresComponente || { tabla: 'dbo.ODATA_Fullkit', columnaCodigo: 'COMPONENTE', columnaNombre: 'DESCRIP_COMPONENTE' };
  const unicos = [...new Set(codmats.map(c=>String(c).trim()))];
  if(!dbConfigFullkit || !unicos.length) return {};
  try {
    const pool = await getPoolFullkit();
    const mapa = {};
    for(const tanda of enTandas(unicos, 400)){ // 2 parámetros por código: muy por debajo del tope de 2100
      const request = pool.request();
      const conCeros = placeholdersIn(request, 'fk', tanda), sinCerosPh = placeholdersIn(request, 'fs', tanda.map(sinCeros));
      const result = await request.query(
        `SELECT ${cfg.columnaCodigo} AS codigo, MAX(${cfg.columnaNombre}) AS nombre FROM ${cfg.tabla}
         WHERE ${cfg.columnaCodigo} IN (${conCeros}) OR ${cfg.columnaCodigo} IN (${sinCerosPh})
         GROUP BY ${cfg.columnaCodigo}`);
      result.recordset.forEach(r=>{ const n = String(r.nombre==null ? '' : r.nombre).trim(); if(n) mapa[sinCeros(r.codigo)] = n; });
    }
    return mapa;
  } catch(err){
    console.error('[nombres-componentes] no se pudo consultar ODATA_Fullkit, se dejan los nombres de SAGA:', err.message);
    return {};
  }
}

/* Rendimiento con 30 PCs: la lista de una misma versión se arma (regla de
   papel / agrupado de mallas), se serializa y se comprime UNA vez y se
   reparte a todas (cacheLista). Y la PC que ya tiene esa versión manda
   ?version= y recibe solo {sinCambios} (unos bytes, en vez de ~1 MB). */
const cacheLista = comprimir.cacheRespuesta(12);
app.get('/api/ordenes-pendientes', exigirPermiso('ordenes'), async (req, res) => {
  try {
    const area = areaDe(req);
    const puedeForzar = !!req.usuarioObj.admin;
    const r = await fotoLista(area).obtener({ forzar: puedeForzar && req.query.forzar==='1' });
    const porCodmat = !!area.listaPorCodmat;
    // cambia con cada consulta a SQL, con cada aprobación (papel) y con cada
    // movimiento de stock (mallas, tejidos): esas dos cambian la lista sin consultar SQL
    const aprob = area.id==='papel' ? crypto.createHash('sha1').update([...aprobaciones.aprobados()].sort().join('|')).digest('base64url').slice(0, 10) : '';
    const version = `${r.actualizado}.${(r.datos && r.datos.rev) || 0}.${aprob}.${porCodmat ? versionStockDeArea(area) : ''}`; // corta: viaja en ?version=
    const cabecera = { actualizado: new Date(r.actualizado).toISOString(), proxima: new Date(r.proxima).toISOString(), version, aviso: r.aviso || null, puedeForzar };
    if(req.query.version && req.query.version===version) return res.json({ sinCambios: true, ...cabecera });
    const c = await cacheLista(`${area.id}|${version}|${puedeForzar}|${r.aviso || ''}`, ()=>({
      ordenes: area.id==='papel' ? clasificarPapel(r.datos).entran
             : porCodmat ? conTamano(area, reglasMallas.agrupar(r.datos.filas, r.datos.cal, stockDeArea(area)).filas)
             : r.datos,
      ...cabecera
    }));
    res.jsonCrudo(c.texto, c.gz);
  } catch (err) {
    responderError(res, 'ordenes-pendientes', err);
  }
});

/* Ingreso manual (ingreso rápido, lote por código): no exige
   Puestodetrabajo (como siempre), pero SÍ la regla de CURVE / NivelAGP /
   ZFER aprobado. Pega las columnas de Calendario y separa las que no
   pueden entrar, con el motivo. */
async function filtrarIngresoManualPapel(filas){
  const cal = await traerCalendario(filas.map(f=>f.Ordem_Serial), true);
  const aprobados = aprobaciones.aprobados();
  const permitidas = [], bloqueadas = [];
  filas.forEach(f=>{
    const c = cal[String(f.Ordem_Serial)];
    reglasPapel.pegarCalendario(f, c);
    const r = reglasPapel.evaluar(c, aprobados);
    if(r.ok) permitidas.push(f); else bloqueadas.push({ Ordem_Serial: f.Ordem_Serial, ZFER: f.ZFER, motivo: r.motivo });
  });
  return { permitidas, bloqueadas };
}

/* Ingreso rápido y lote por código SÍ consultan SQL (una orden o un lote
   puntual, consultas chicas). Igual tienen tope por persona: alguien
   pegado al Enter no puede convertirlos en una lluvia de consultas. */
const BUSQUEDAS_POR_MINUTO = parseInt(process.env.BUSQUEDAS_POR_MINUTO || '40', 10);
const busquedasPorUsuario = new Map(); // usuario -> [ms, ...]
setInterval(()=>{ const lim = Date.now() - 60000; busquedasPorUsuario.forEach((l, u)=>{ if(!l.some(t=>t>lim)) busquedasPorUsuario.delete(u); }); }, 5*60000).unref();
function limitarBusquedas(req, res, next){
  const ahora = Date.now(), lista = (busquedasPorUsuario.get(req.usuario) || []).filter(t=>t > ahora - 60000);
  if(lista.length >= BUSQUEDAS_POR_MINUTO) return res.status(429).json({ error: `Demasiadas búsquedas seguidas (máximo ${BUSQUEDAS_POR_MINUTO} por minuto). Esperá un momento.` });
  lista.push(ahora); busquedasPorUsuario.set(req.usuario, lista);
  next();
}

/* Búsqueda puntual de UNA orden por su número, para el "Ingreso
   rápido": exige Operation='0132' (ver ordenPorSerial en queries.js) y,
   en papel, la regla de CURVE / nivel / ZFER aprobado. Devuelve
   encontrada:false si no existe, o bloqueada:true con el motivo si existe
   pero no puede entrar — son resultados normales, no fallas. */
app.get('/api/ordenes-pendientes/:orden', exigirPermiso('ordenes'), limitarBusquedas, async (req, res) => {
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
      const { bloqueadas } = await filtrarIngresoManualPapel([fila]);
      if(bloqueadas.length) return res.json({ encontrada: true, bloqueada: true, motivo: bloqueadas[0].motivo, orden: fila });
    }
    res.json({ encontrada: true, orden: fila });
  } catch (err) {
    responderError(res, 'ordenes-pendientes/:orden', err);
  }
});

/* Todas las órdenes de un "Código_Lote" (DF_SAGA_LotesVidro), para
   agregarlas de una al lote de corte. Solo exige Operation='0132' y, en
   papel, la regla de CURVE / nivel / ZFER aprobado: devuelve
   {ordenes, bloqueadas:[{Ordem_Serial, ZFER, motivo}]}. */
app.get('/api/lote/:codigo', exigirPermiso('ordenes'), limitarBusquedas, async (req, res) => {
  try {
    const area = areaDe(req);
    const esPapel = area.id === 'papel';
    const consulta = esPapel ? queries.ordenesPorLote : consultaDeArea(area, 'ordenesPorLote');
    const pool = await getPool();
    const result = await pool.request()
      .input('lote', sql.VarChar, req.params.codigo)
      .query(consulta);
    if(!esPapel) return res.json({ ordenes: result.recordset, bloqueadas: [] });
    const { permitidas, bloqueadas } = await filtrarIngresoManualPapel(result.recordset);
    res.json({ ordenes: permitidas, bloqueadas });
  } catch (err) {
    responderError(res, 'lote/:codigo', err);
  }
});

/* ============ Aprobación de ZFER (papel cerámico) ============
   Lógica y almacenamiento en server/aprobaciones.js; la regla que la usa,
   en reglas-papel.js. */
function exigirAprobacionZfer(req, res, next){
  let area;
  try { area = areaDe(req); } catch(e){ return responderError(res, 'aprobaciones', e); }
  if(area.aprobacionZfer) return next();
  res.status(400).json({ error: `${area.nombre} no maneja aprobación de ZFER.` });
}

app.get('/api/aprobaciones', exigirPermiso('aprobaciones','aprobar'), exigirAprobacionZfer, async (req, res) => {
  const solicitudes = aprobaciones.leer().sort((a, b)=>String(b.solicitadoEn).localeCompare(String(a.solicitadoEn)));
  const puedeAprobar = usuarios.puede(req.usuarioObj, 'papel', 'aprobar');
  // candidatos: ZFER de piezas CURVE 02–04 que hoy quedan afuera de la
  // lista, sacados de la MISMA foto de la Lista de corte (no consulta SQL
  // aparte). Si nunca se pudo consultar, las solicitudes se ven igual.
  let candidatos = null, errorCandidatos = null;
  if(req.query.candidatos !== '0'){
    try {
      const enCurso = new Set(solicitudes.filter(s=>s.estado==='pendiente' || s.estado==='aprobada').map(s=>s.zfer));
      const r = await fotoLista(AREAS_CONFIG.areas.papel).obtener();
      candidatos = clasificarPapel(r.datos).candidatos.filter(c=>!enCurso.has(c.zfer));
    } catch(e){
      console.error('[aprobaciones/candidatos]', e.message);
      errorCandidatos = mensajeDeError(e, req);
    }
  }
  res.json({ solicitudes, candidatos, errorCandidatos, puedeAprobar, usuario: req.usuario });
});
app.post('/api/aprobaciones/solicitar', exigirPermiso('aprobaciones','aprobar'), exigirAprobacionZfer, (req, res) => {
  try { res.json(aprobaciones.solicitar(req.body || {}, req.usuario)); }
  catch(e){ responderError(res, 'aprobaciones/solicitar', e); }
});
app.post('/api/aprobaciones/:zfer/resolver', exigirPermiso('aprobar'), exigirAprobacionZfer, async (req, res) => {
  try {
    const ficha = aprobaciones.resolver(req.params.zfer, req.body || {}, req.usuarioObj);
    // la Lista de corte cambia ya (avisa en vivo); si se aprobó, se suman
    // las órdenes de ese ZFER que no tienen 0132 (consulta chica)
    if(ficha.estado==='aprobada') await sumarOrdenesDeZfer(ficha.zfer);
    else fotoLista(AREAS_CONFIG.areas.papel).modificar(d=>{ d.rev++; });
    res.json(ficha);
  } catch(e){ responderError(res, 'aprobaciones/resolver', e); }
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
  // el historial solo crece: la primera 'salida' de esta orden desde el final es la más reciente
  const h = racks.ultimaSalida(area, orden);
  if(h) return res.json({ encontrada: true, ubicacion: h.ubicacion, orden: h.orden||null, fecha: h.fecha });
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
  if(racksPosiciones.has(area.id)){ // por posiciones (Tejidos): piezas que entraron / salieron hoy, y ocupadas
    const r = racksPosiciones.get(area.id).resumenDia(); // sin armar el rack entero: solo los contadores
    return res.json({ entradasHoy: r.entra, salidasHoy: r.sale, enStock: r.ocupadas });
  }
  if(area.rack.tipo==='inventario'){ // por cantidad: unidades que entraron / salieron hoy, y stock
    const inv = inventario.consultar(area);
    return res.json({ entradasHoy: inv.hoy.entra, salidasHoy: inv.hoy.sale, enStock: inv.stock.reduce((s, x)=>s + x.cantidad, 0) });
  }
  const hoy = racks.resumenHoy(area); // contadores en memoria (ver racks.js)
  res.json({ cortadasHoy: hoy.entradas, sacadasHoy: hoy.salidas, enRackAhora: racks.leer(area).length });
}, false)); // también la piden las áreas sin rack de casillas (contesta ceros)

/* ============ Inventario por material y medida (Tecoflex) ============
   Lógica y almacenamiento en server/inventario.js. */
app.get('/api/inventario', exigirPermiso('rack'), (req, res) => {
  try { res.json(inventario.consultar(areaDe(req), req.query.version)); }
  catch(e){ responderError(res, 'inventario', e); }
});
/* Consumo histórico por material y medida: lo que salió (y entró) en un período.
   ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD (opcionales). Sale de lo acumulado por día en
   server/inventario.js, no de releer el diario. */
app.get('/api/inventario/consumo', exigirPermiso('rack'), (req, res) => {
  try { res.json(inventario.consumo(areaDe(req), { desde: req.query.desde, hasta: req.query.hasta })); }
  catch(e){ responderError(res, 'inventario/consumo', e); }
});
/* Rack: entradas y salidas. En Mallas, quien trabaja en Lista de corte
   (permiso "ordenes") también puede dar ENTRADA a lo que fabricó — pero
   solo quien tiene "rack" puede dar salida. */
app.post('/api/inventario/movimientos', exigirPermiso('rack','ordenes'), (req, res) => {
  try {
    const area = areaDe(req);
    if(!usuarios.puede(req.usuarioObj, area.id, 'rack')){
      const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
      if(!area.rack.porCodmat || items.some(it=>!it || it.tipo!=='entrada')){
        return res.status(403).json({ error: `Para dar salidas en ${area.nombre} hace falta el permiso de Rack. Pedíselo al administrador.` });
      }
    }
    const r = inventario.registrar(area, req.body, req.usuario);
    // Mallas: el stock descuenta la necesidad de Lista de corte: avisarla
    if(r.status===200 && !r.cuerpo.repetido && area.rack.porCodmat) notificar({ tipo:'lista', area: area.id });
    res.status(r.status).json(r.cuerpo);
  } catch(e){ responderError(res, 'inventario/movimientos', e); }
});

/* ============ Rack por posiciones (Tejidos), ver server/tejidos.js ============
   Entradas (una a una, con foto obligatoria) y salidas: permiso de Rack.
   Ver el rack y asignar el tamaño de un tejido: Rack o Lista de corte. */
function conRackPosiciones(fn){
  return (req, res) => {
    let area;
    try { area = areaDe(req); } catch(e){ return responderError(res, req.path, e); }
    const rp = racksPosiciones.get(area.id);
    if(!rp) return res.status(400).json({ error: `${area.nombre} no tiene rack por posiciones.` });
    Promise.resolve().then(()=>fn(req, res, rp, area)).catch(e=>responderError(res, req.path, e));
  };
}
/* El estado del rack se arma y se comprime una vez por firma (versión + día) para
   todas las PCs; la que ya tiene esa firma manda ?version= y recibe solo {sinCambios}. */
const cacheRackPosiciones = comprimir.cacheRespuesta(8);
app.get('/api/tejidos/rack', exigirPermiso('rack','ordenes'), conRackPosiciones(async (req, res, rp, area)=>{
  const firma = rp.firma();
  if(req.query.version && req.query.version===firma) return res.json({ sinCambios: true, firma });
  const c = await cacheRackPosiciones(area.id + '|' + firma, ()=>rp.estado());
  res.jsonCrudo(c.texto, c.gz);
}));
// la foto llega cruda (ya achicada por el navegador): no pasa por el lector de JSON
app.post('/api/tejidos/fotos', exigirPermiso('rack'), express.raw({ type: ()=>true, limit: '9mb' }),
  conRackPosiciones((req, res, rp)=>res.json({ ok: true, foto: rp.guardarFoto(req.body) })));
app.get('/api/tejidos/fotos/:archivo', exigirPermiso('rack','ordenes'), conRackPosiciones((req, res, rp)=>{
  const r = rp.rutaFoto(req.params.archivo);
  if(!r) return res.status(404).json({ error: 'no existe esa foto' });
  res.setHeader('Cache-Control', 'private, max-age=86400'); // la foto de una entrada no cambia nunca
  res.sendFile(r);
}));
app.post('/api/tejidos/entrada', exigirPermiso('rack'), conRackPosiciones((req, res, rp)=>res.json({ ok: true, ...rp.entrada(req.body, req.usuario) })));
app.post('/api/tejidos/salida', exigirPermiso('rack'), conRackPosiciones((req, res, rp)=>res.json({ ok: true, ...rp.salida(req.body || {}, req.usuario) })));
app.put('/api/tejidos/tamano', exigirPermiso('rack','ordenes'), conRackPosiciones((req, res, rp)=>res.json({ ok: true, ...rp.fijarTamano(req.body || {}, req.usuario) })));
app.get('/api/tejidos/historial', exigirPermiso('rack','ordenes'), conRackPosiciones((req, res, rp)=>{
  const q = req.query || {};
  const evento = ['entrada','salida','tamano','movimientos'].includes(q.evento) ? q.evento : null;
  res.json(rp.historial({ desde: q.desde, hasta: q.hasta, evento, texto: q.texto, limite: q.limite }));
}));
/* Lista de corte de un área por posiciones: cada fila con el tamaño de su tejido ('' = sin tamaño). */
function conTamano(area, filas){
  const rp = racksPosiciones.get(area.id);
  return rp ? filas.map(f=>({ ...f, Tamano: rp.tamanoDe(f.CodMat) })) : filas;
}

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

/* ============ DXF de una tira de Tecoflex, por medida ============
   El nesting de Tecoflex es un pedido de tiras: cada medida (mm) tiene su
   propio DXF ("CORTE 9MM UND.dxf": una tira de 9 mm de ancho por 3000 de
   largo) en una carpeta de la red (TECOFLEX_DXF_CARPETA). La app manda solo
   la MEDIDA; el nombre del archivo y la carpeta los arma el puente, así nadie
   puede pedir otra ruta. Igual pasa por rutaDxfPermitida (DXF_ALLOWED_PREFIXES). */
const TECOFLEX_DXF_CARPETA = (process.env.TECOFLEX_DXF_CARPETA || '\\\\192.168.2.2\\cnc-revisados\\OPTIMIZACION TECO').replace(/[\\/]+$/, '');
app.get('/api/tecoflex/dxf', exigirPermiso('nesting'), async (req, res) => {
  try {
    const area = areaDe(req);
    if(!area.nestingTiras) return res.status(400).json({ error: `${area.nombre} no arma el nesting por medida.` });
    // "9", "9mm", "9 MM", "6.5" -> "9", "9", "9", "6,5"
    const medida = String(req.query.medida==null ? '' : req.query.medida).trim().toUpperCase().replace(/\s*MM$/, '').replace('.', ',').replace(/^0+(?=\d)/, '');
    if(!/^\d{1,3}(,\d{1,2})?$/.test(medida) || !(parseFloat(medida.replace(',', '.')) > 0)) return res.status(400).json({ error: 'Medida inválida: escribí un número en mm, por ejemplo 9 o 6,5.' });
    // los decimales pueden estar escritos con coma o con punto en el nombre del archivo
    const nombres = [...new Set([medida, medida.replace(',', '.')])].map(m=>area.nestingTiras.archivo.replace('{medida}', m));
    for(const nombre of nombres){
      const r = rutaDxfPermitida(TECOFLEX_DXF_CARPETA + '\\' + nombre);
      if(r.error) return res.status(400).json({ error: r.error });
      let st;
      try { st = await fs.promises.stat(r.fullPath); }
      catch(e){ if(e.code==='ENOENT' || e.code==='ENOTDIR') continue; throw e; }
      if(!st.isFile()) continue;
      if(st.size > DXF_MAX_BYTES) return res.status(413).json({ error: `el DXF pesa ${Math.round(st.size/1048576)} MB; el máximo es ${DXF_MAX_BYTES/1048576} MB` });
      return res.json({ contenido: await fs.promises.readFile(r.fullPath, 'utf8'), archivo: nombre, medida });
    }
    res.status(404).json({ error: `No existe el archivo "${nombres[0]}" en la carpeta de cortes de Tecoflex.`, archivo: nombres[0] });
  } catch (err) {
    responderError(res, 'tecoflex/dxf', err);
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
