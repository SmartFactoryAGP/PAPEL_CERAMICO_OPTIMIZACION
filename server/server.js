/* =========================================================
   PUENTE "LISTA DE CORTE" — app de Nesting <-> SQL Server
   =========================================================
   Qué hace: la app (que corre en tu navegador, abierta con doble clic)
   no puede hablar con SQL Server directamente — ningún navegador puede.
   Este es un servicio chico que SÍ tiene el driver de SQL Server, corre
   en tu misma PC, y le da a la app 3 direcciones simples para pedirle
   datos con fetch() normal:

     GET  /api/ordenes-pendientes        -> lista de órdenes por cortar (requiere sesión)
     GET  /api/ordenes-pendientes/:orden -> busca UNA orden puntual por número, sin el filtro de Puestodetrabajo (para "Ingreso rápido" — requiere sesión)
     GET  /api/lote/:codigo              -> todas las órdenes 0132 de un Código_Lote (DF_SAGA_LotesVidro), sin el filtro de Puestodetrabajo, sin duplicados (requiere sesión)
     GET  /api/dxf?orden=...&archivo=...  -> el contenido del DXF de una orden (requiere sesión)
     GET  /api/rack-simulado              -> Rack simulado COMPARTIDO (archivo local, no SQL) — SIN login, abierto para cualquiera
     POST /api/rack-simulado/agregar      -> agrega una orden al rack simulado compartido (requiere sesión)
     POST /api/rack-simulado/:orden/salida -> saca una orden del rack simulado compartido — SIN login
     GET  /api/rack-simulado/:orden/ultima-salida -> última vez que ESA orden salió del rack (para reentradas) — SIN login
     POST /api/rack-simulado/reentrada    -> reingresa una orden al rack simulado, EN LA MISMA POSICIÓN que tenía — SIN login
     POST /api/ordenes/:orden/marcar-en-stock  -> marca una orden como cortada (en SQL — requiere sesión, y bloqueado salvo PERMITIR_ESCRITURA_SQL=true)
     GET  /api/rack-actual                -> órdenes que están ahora en el rack (en SQL) — SIN login
     POST /api/rack/:orden/salida         -> le da salida a una orden (en SQL — requiere sesión, y bloqueado salvo PERMITIR_ESCRITURA_SQL=true)
     POST /api/login                      -> inicia sesión (usuario/clave de AUTH_USUARIOS)
     POST /api/logout                     -> cierra sesión
     GET  /api/rack-resumen-dia           -> cuántas entraron/salieron del rack hoy (requiere sesión)

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
/* Área del pedido: la app la manda en la cabecera x-area (ver
   ordApiHeaders en orders.js). Sin cabecera = papel cerámico, para que
   todo lo que ya existía siga funcionando igual. */
function areaDe(req){
  const id = String(req.get('x-area') || req.query.area || AREAS_CONFIG.porDefecto).trim().toLowerCase();
  const area = AREAS_CONFIG.areas[id];
  if(!area){ const e = new Error(`área de trabajo desconocida: "${id}"`); e.status = 400; throw e; }
  return area;
}
/* Consulta SQL propia de un área (Tecoflex y Mallas viven en OTRAS
   tablas — se completan en queries.js → areas.<área>). Mientras no esté
   cargada, se contesta 501 con un mensaje claro en vez de fallar raro. */
function consultaDeArea(area, nombre){
  const q = queries.areas && queries.areas[area.id] && queries.areas[area.id][nombre];
  if(!q){
    const e = new Error(`La consulta de ${area.nombre} todavía no está configurada (server/queries.js → areas.${area.id}.${nombre}).`);
    e.status = 501; e.pendiente = true;
    throw e;
  }
  return q;
}
/* Respuesta de error estándar de los endpoints: usa el código que traiga
   el error (400 área desconocida, 501 consulta pendiente) o 500. */
function responderError(res, etiqueta, err){
  console.error(`[${etiqueta}]`, err.message);
  res.status(err.status || 500).json({ error: err.message, pendiente: !!err.pendiente });
}

const app = express();

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
    cb(new Error('origen no permitido'));
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

/* ============ Usuarios (Programador 1/2/3, etc.) ============
   Quién puede entrar a Lista de corte, Nesting y Editor de archivos —
   el Rack queda siempre abierto, sin pedir nada, para cualquiera.

   Los usuarios y contraseñas se completan en tu .env, como
   "Nombre:clave" separados por coma — ver AUTH_USUARIOS en
   .env.example. Nunca se guardan en ningún archivo de este código,
   solo en tu .env (que vos controlás).

   Las sesiones son simples: al iniciar sesión se genera un token al
   azar, se guarda en la MEMORIA de este proceso (no en un archivo ni
   en SQL), y listo — la app lo manda en cada pedido después. Si
   reiniciás el puente (cerrás y volvés a abrir "iniciar"), todos
   tienen que volver a iniciar sesión — es la forma más simple de que
   nunca quede una sesión "colgada" para siempre. */
function usuariosPermitidos(){
  const raw = process.env.AUTH_USUARIOS || '';
  const mapa = new Map();
  raw.split(',').forEach(par=>{
    const i = par.lastIndexOf(':');
    if(i<0) return;
    const usuario = par.slice(0,i).trim();
    const clave = par.slice(i+1).trim();
    if(usuario && clave) mapa.set(usuario, clave);
  });
  return mapa;
}

const sesiones = new Map(); // token -> { usuario, creado }

app.post('/api/login', (req, res) => {
  const { usuario, clave } = req.body || {};
  const usuarios = usuariosPermitidos();
  if(!usuarios.size){
    return res.status(501).json({ error: 'AUTH_USUARIOS no está configurado en el .env del puente todavía.' });
  }
  const claveEsperada = usuario ? usuarios.get(String(usuario).trim()) : undefined;
  if(!usuario || !clave || claveEsperada===undefined || !secretoIgual(clave, claveEsperada)){
    return res.status(401).json({ error: 'usuario o contraseña incorrectos' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  sesiones.set(token, { usuario: String(usuario).trim(), creado: new Date() });
  res.json({ ok: true, token, usuario: String(usuario).trim() });
});

app.post('/api/logout', (req, res) => {
  const token = req.get('x-auth-token');
  sesiones.delete(token);
  res.json({ ok: true });
});

/* Exige una sesión válida (header x-auth-token) — se aplica solo a los
   endpoints de Lista de corte que tocan SQL/DXF; el Rack (ver más
   abajo) queda siempre afuera de esto a propósito. */
function exigirLogin(req, res, next){
  const token = req.get('x-auth-token');
  const sesion = token && sesiones.get(token);
  if(!sesion) return res.status(401).json({ error: 'iniciá sesión para usar Lista de corte' });
  req.usuario = sesion.usuario;
  next();
}

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

const dbConfig = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port: parseInt(process.env.DB_PORT || '1433', 10),
  requestTimeout: DB_REQUEST_TIMEOUT_MS,
  connectionTimeout: DB_CONNECTION_TIMEOUT_MS,
  options: {
    trustServerCertificate: true,
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
    trustServerCertificate: true,
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

app.get('/api/ordenes-pendientes', exigirLogin, async (req, res) => {
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
app.get('/api/ordenes-pendientes/:orden', exigirLogin, async (req, res) => {
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
app.get('/api/lote/:codigo', exigirLogin, async (req, res) => {
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

/* ============ Rack simulado, COMPARTIDO entre todas las PC ============
   Vive en un archivo chico de ESTA PC (la que corre el puente) — no en
   SQL, no en cada navegador por separado. Todas las computadoras que
   le pegan a este mismo puente ven exactamente el mismo Rack, lo
   actualicen desde donde lo actualicen. Nunca toca SQL para nada — es
   solo un archivo de texto plano en esta misma carpeta del servidor. */
/* Un archivo de rack POR ÁREA. Papel cerámico conserva el nombre de
   siempre (rack-simulado.json) para que lo que ya estaba guardado siga
   ahí sin migrar nada. */
const RACK_ARCHIVOS = { papel: 'rack-simulado.json', tecoflex: 'rack-tecoflex.json', mallas: 'rack-mallas.json' };
function rackPath(area){ return path.join(__dirname, RACK_ARCHIVOS[area.id]); }

/* Lee una lista guardada en un JSON de esta carpeta. Si el archivo
   todavía no existe (primera vez) o está vacío, devuelve [] como
   siempre — pero si EXISTE con contenido y no se puede parsear, TIRA
   ERROR en vez de devolver []. Antes, un archivo a medio escribir (corte
   de luz, antivirus bloqueándolo) se leía como "rack vacío", y la
   siguiente orden que entraba al rack lo pisaba con esa lista vacía + 1:
   se perdía el rack entero (o el historial entero) sin ningún aviso. */
/* Caché en memoria de cada archivo, validada por fecha de modificación +
   tamaño: el Rack de cada PC pide /api/rack-simulado cada 6 s, y antes
   cada pedido releía y parseaba el archivo del disco (y el resumen del
   día, el historial ENTERO, que solo crece). Ahora solo se hace un stat
   (barato); si el archivo no cambió, se usa lo ya parseado. Si alguien lo
   edita a mano, cambia la fecha/tamaño y se vuelve a leer solo.
   Se devuelve siempre una COPIA del arreglo: los endpoints hacen push/
   filter sobre lo que leen, y eso no puede ensuciar la caché si después
   la escritura falla. */
const cacheListas = new Map(); // ruta -> {mtimeMs, size, lista}
function leerListaJson(ruta){
  let st;
  try { st = fs.statSync(ruta); }
  catch(e){ if(e.code==='ENOENT'){ cacheListas.delete(ruta); return []; } throw e; }
  const c = cacheListas.get(ruta);
  if(c && c.mtimeMs===st.mtimeMs && c.size===st.size) return c.lista.slice();
  const texto = fs.readFileSync(ruta, 'utf8');
  let lista;
  if(!texto.trim()) lista = [];
  else {
    try { lista = JSON.parse(texto); }
    catch(e){ throw new Error(`${path.basename(ruta)} está dañado (no es JSON válido) — no se toca para no perder datos; revisalo o restauralo a mano`); }
  }
  cacheListas.set(ruta, {mtimeMs: st.mtimeMs, size: st.size, lista});
  return lista.slice();
}
/* Escritura atómica: se escribe a un temporal al lado y se renombra
   encima (en el mismo disco, el renombre es atómico) — el archivo queda
   con el contenido viejo entero o con el nuevo entero, nunca a medias.
   Si Windows no deja renombrar (por ej. el antivirus tiene el archivo
   abierto en ese instante), se escribe directo como antes. */
function escribirListaJson(ruta, lista){
  const texto = JSON.stringify(lista, null, 2);
  const tmp = ruta + '.tmp';
  try {
    fs.writeFileSync(tmp, texto, 'utf8');
    fs.renameSync(tmp, ruta);
  } catch(e){
    try { fs.unlinkSync(tmp); } catch(_){ /* puede no existir */ }
    fs.writeFileSync(ruta, texto, 'utf8');
  }
  // lo que se acaba de escribir queda como caché (sin volver a parsearlo)
  try {
    const st = fs.statSync(ruta);
    cacheListas.set(ruta, {mtimeMs: st.mtimeMs, size: st.size, lista: lista.slice()});
  } catch(_){ cacheListas.delete(ruta); }
}

function leerRackSimulado(area){ return leerListaJson(rackPath(area)); }
function guardarRackSimulado(area, lista){
  escribirListaJson(rackPath(area), lista);
  notificar({ tipo:'rack', area: area.id }); // las demás PCs refrescan su Rack al instante
}
/* Rack de casillas (papel cerámico, mallas): la próxima casilla libre,
   A1, A2 ... G20 — una orden por casilla. */
function proximaUbicacionLibre(area, lista){
  const ocupadas = new Set(lista.map(o=>o.ubicacion));
  for(const letra of area.rack.letras){
    for(let n=1; n<=area.rack.porLetra; n++){
      const loc = letra+n;
      if(!ocupadas.has(loc)) return loc;
    }
  }
  return null; // todas las casillas están ocupadas — no debería pasar en la práctica
}
function capacidadRack(area){ return area.rack.letras.length * area.rack.porLetra; }
/* Los endpoints de rack por órdenes (/api/rack-simulado*) son solo para
   racks de casillas; Tecoflex usa el inventario (/api/inventario). */
function exigirRackCasillas(area){
  if(area.rack.tipo !== 'casillas'){
    const e = new Error(`El rack de ${area.nombre} es un inventario por material y medida, no por órdenes (usá /api/inventario).`);
    e.status = 400; throw e;
  }
}

/* Registro chico de "entró al rack" / "salió del rack" — separado del
   estado ACTUAL del rack (que se borra al sacar algo), para poder
   armar el resumen del día aunque ya se haya sacado. Vive en su propio
   archivo, en la misma carpeta, y solo crece (nunca se reescriben
   filas viejas, solo se agrega una nueva al final). */
const RACK_HISTORIAL_PATH = path.join(__dirname, 'rack-historial.json');
function leerHistorial(){ return leerListaJson(RACK_HISTORIAL_PATH); }
/* El rack (rack-simulado.json) es lo que manda: si el historial no se
   puede leer, se avisa en consola y se saltea ESTE registro — sin pisar
   el archivo dañado (se puede recuperar a mano) y sin hacer fallar la
   operación sobre el rack, que ya quedó guardada. */
function agregarAlHistorial(entrada){
  try {
    const historial = leerHistorial();
    historial.push({ ...entrada, fecha: new Date().toISOString() });
    escribirListaJson(RACK_HISTORIAL_PATH, historial);
  } catch(err){
    console.error('[historial] no se registró el evento:', err.message, entrada);
  }
}
function esHoy(fechaISO){
  const hoy = new Date();
  const d = new Date(fechaISO);
  return d.getFullYear()===hoy.getFullYear() && d.getMonth()===hoy.getMonth() && d.getDate()===hoy.getDate();
}

/* Los registros viejos del historial (de antes de las áreas) no tienen
   "area": son todos de papel cerámico. */
function esDelArea(h, area){ return (h.area || 'papel') === area.id; }

app.get('/api/rack-simulado', (req, res) => {
  const area = areaDe(req);
  exigirRackCasillas(area);
  res.json(leerRackSimulado(area));
});

app.post('/api/rack-simulado/agregar', exigirLogin, (req, res) => {
  const area = areaDe(req);
  exigirRackCasillas(area);
  const orden = Object.assign({}, req.body || {});
  if(!orden.Ordem_Serial) return res.status(400).json({ error: 'falta Ordem_Serial' });
  const lista = leerRackSimulado(area);
  if(lista.find(o=>o.Ordem_Serial===orden.Ordem_Serial)){
    return res.status(409).json({ error: 'esa orden ya está en el rack' });
  }
  const ubicacion = proximaUbicacionLibre(area, lista);
  if(!ubicacion) return res.status(409).json({ error: `rack lleno, las ${capacidadRack(area)} ubicaciones están ocupadas` });
  lista.push({ ...orden, ubicacion });
  guardarRackSimulado(area, lista);
  agregarAlHistorial({ area: area.id, Ordem_Serial: orden.Ordem_Serial, ubicacion, usuario: req.usuario, evento: 'entrada' });
  res.json({ ok: true, ubicacion });
});

app.post('/api/rack-simulado/:orden/salida', (req, res) => {
  const area = areaDe(req);
  exigirRackCasillas(area);
  const { orden } = req.params;
  let lista = leerRackSimulado(area);
  // Guardamos el renglón COMPLETO (no solo el Ordem_Serial) antes de
  // sacarlo — así, si después hace falta una reentrada por error del
  // operario, se puede reconstruir la orden entera (ubicación incluida)
  // sin tener que volver a pedir nada a SQL.
  const encontrada = lista.find(o=>o.Ordem_Serial === orden);
  lista = lista.filter(o=>o.Ordem_Serial !== orden);
  guardarRackSimulado(area, lista);
  const sacada = !!encontrada;
  if(sacada) agregarAlHistorial({ area: area.id, Ordem_Serial: orden, ubicacion: encontrada.ubicacion, orden: encontrada, usuario: req.usuario||null, evento: 'salida' });
  res.json({ ok: true, sacada });
});

/* Para la pantalla de "reentrada": dado un número de orden que NO está
   ahora mismo en el rack, busca en el historial la ÚLTIMA vez que
   salió, y devuelve en qué posición estaba — así el operario puede
   reingresarla ahí mismo en vez de que la app le asigne una posición
   libre cualquiera (útil cuando le dieron salida por error). Si la
   orden SÍ está en el rack ahora mismo, o nunca tuvo una salida
   registrada, devuelve encontrada:false. */
app.get('/api/rack-simulado/:orden/ultima-salida', (req, res) => {
  const area = areaDe(req);
  const { orden } = req.params;
  const enRackAhora = leerRackSimulado(area).some(o=>o.Ordem_Serial === orden);
  if(enRackAhora) return res.json({ encontrada: false, motivo: 'la orden ya está en el rack ahora mismo' });
  const historial = leerHistorial();
  // el historial solo crece (nunca se reescribe), así que la última
  // entrada de 'salida' para esta orden, recorriendo desde el final,
  // es la más reciente.
  for(let i=historial.length-1; i>=0; i--){
    const h = historial[i];
    if(h.Ordem_Serial===orden && h.evento==='salida' && h.ubicacion && esDelArea(h, area)){
      return res.json({ encontrada: true, ubicacion: h.ubicacion, orden: h.orden||null, fecha: h.fecha });
    }
  }
  res.json({ encontrada: false, motivo: 'no hay ninguna salida registrada para esa orden' });
});

/* Reingresa una orden al rack simulado, FORZANDO una ubicación
   específica (en vez de calcular la próxima libre, como hace
   /agregar) — pensado para el caso de "le dieron salida por error,
   hay que reingresarla en el mismo lugar en el que estaba". Si esa
   posición ya la ocupa OTRA orden (por ejemplo porque en el rato que
   pasó, otra pieza cortada ya la usó), se rechaza en vez de pisarla en
   silencio — el operario tiene que resolver ese choque a mano (sacar
   la que está ahí, o reingresar en otra posición desde "+ Agregar"
   normal). */
app.post('/api/rack-simulado/reentrada', exigirLogin, (req, res) => {
  const area = areaDe(req);
  exigirRackCasillas(area);
  const { ubicacion } = req.body || {};
  const orden = (req.body && req.body.orden) || {};
  if(!orden.Ordem_Serial) return res.status(400).json({ error: 'falta Ordem_Serial' });
  if(!ubicacion) return res.status(400).json({ error: 'falta la ubicación a reingresar' });
  const lista = leerRackSimulado(area);
  if(lista.find(o=>o.Ordem_Serial===orden.Ordem_Serial)){
    return res.status(409).json({ error: 'esa orden ya está en el rack' });
  }
  const ocupante = lista.find(o=>o.ubicacion===ubicacion);
  if(ocupante){
    return res.status(409).json({ error: `la posición ${ubicacion} ya la ocupa la orden ${ocupante.Ordem_Serial} — sacala primero, o reingresá esta desde "+ Agregar" para que le asignen otra posición libre` });
  }
  lista.push({ ...orden, ubicacion });
  guardarRackSimulado(area, lista);
  agregarAlHistorial({ area: area.id, Ordem_Serial: orden.Ordem_Serial, ubicacion, usuario: req.usuario, evento: 'reentrada' });
  res.json({ ok: true, ubicacion });
});

/* ============ Inventario por material y medida (Tecoflex) ============
   No va por órdenes: es un stock en cantidades, por (material, medida).
   - GET  /api/inventario[?version=N]  -> {version, stock, movimientos, hoy}  (o {sinCambios:true})
   - POST /api/inventario/movimientos  -> {items:[{tipo, material, medida, cantidad}], nota, idCliente}
     El lote se valida ENTERO antes de tocar nada (material y medida
     válidos, cantidad entera > 0, ninguna salida deja stock negativo): si
     una sola línea falla no se aplica ninguna. Node atiende un pedido por
     vez y todo esto es sincrónico, así que 30 PCs registrando a la vez no
     se pisan.

   Diseño para muchos usuarios a la vez (antes: un JSON con TODO el
   historial que se leía y reescribía entero en cada movimiento — cada
   registro tardaba más que el anterior y bloqueaba el puente para todos):
   - movimientos-<área>.jsonl: DIARIO de movimientos, una línea por
     movimiento, solo se AGREGA al final (costo fijo, no crece con el
     historial). Es la fuente de verdad.
   - El stock vive en memoria y se reconstruye al arrancar repasando el
     diario de punta a punta — así stock e historial nunca pueden quedar
     distintos (antes, un corte entre las dos escrituras los desfasaba).
     inventario-<área>.json queda como foto legible del stock actual.
   - version = cantidad de movimientos; cada cambio se avisa en vivo
     (ver /api/eventos) con el movimiento y el stock nuevo.
   - idCliente: la app manda un id por carrito. Si el mismo lote llega dos
     veces (doble clic, o la red cortó la respuesta y el operario
     reintentó), se devuelve el resultado de la primera vez en lugar de
     descontar dos veces.
   No pide sesión (igual que el Rack); si hay una abierta, queda a su nombre. */
const INV_MAX_CANTIDAD = 100000;
const INV_RECIENTES = 300;  // movimientos que se mandan a la pantalla
const inventarioPath  = area => path.join(__dirname, `inventario-${area.id}.json`);
const diarioPath      = area => path.join(__dirname, `movimientos-${area.id}.jsonl`);
const historialViejoPath = area => path.join(__dirname, `movimientos-${area.id}.json`);
const invClave = (m, d) => m+'|'+d;
const inventarios = new Map(); // área -> {version, stock:Map, movimientos:[], porIdCliente:Map}

/* Carga (una sola vez por área) el diario y reconstruye el stock. */
function inventarioDe(area){
  let inv = inventarios.get(area.id);
  if(inv) return inv;
  // migración única: el historial viejo (JSON con un arreglo) pasa al diario
  const viejo = historialViejoPath(area), diario = diarioPath(area);
  if(fs.existsSync(viejo) && !fs.existsSync(diario)){
    const lista = leerListaJson(viejo);
    fs.writeFileSync(diario, lista.map(m=>JSON.stringify(m)).join('\n') + (lista.length ? '\n' : ''), 'utf8');
    fs.renameSync(viejo, viejo + '.migrado');
    console.log(`[inventario] ${area.id}: ${lista.length} movimiento(s) migrados a ${path.basename(diario)}`);
  }
  inv = {version:0, stock:new Map(), movimientos:[], porIdCliente:new Map()};
  // claves viejas de material -> la actual (campo "alias" en areas-config.js).
  // El diario NO se reescribe: la traducción es solo en memoria.
  const alias = new Map();
  area.materiales.forEach(m=>(m.alias||[]).forEach(a=>alias.set(a, m)));
  const normalizar = items => items.forEach(l=>{
    const m = alias.get(l.material);
    if(m){ l.material = m.id; l.materialNombre = m.nombre; l.codigo = m.codigo||null; }
  });
  if(fs.existsSync(diario)){
    const texto = fs.readFileSync(diario, 'utf8');
    // si un apagón cortó la última línea a la mitad, el próximo movimiento
    // se pegaría a ese pedazo y quedaría ilegible (se perdería en el
    // siguiente reinicio): se cierra esa línea antes de seguir agregando
    if(texto && !texto.endsWith('\n')) fs.appendFileSync(diario, '\n', 'utf8');
    const lineas = texto.split('\n');
    let malas = 0;
    lineas.forEach(t=>{
      if(!t.trim()) return;
      let mv; try { mv = JSON.parse(t); } catch(e){ malas++; return; } // p.ej. una línea cortada por un apagón
      normalizar(mv.items);
      aplicarAlStock(inv.stock, mv.items);
      inv.movimientos.push(mv);
      if(mv.idCliente) inv.porIdCliente.set(mv.idCliente, mv);
    });
    if(malas) console.error(`[inventario] ${area.id}: ${malas} línea(s) ilegibles en ${path.basename(diario)} — se saltearon`);
  }
  // stock de un material que ya no está en la lista: no se esconde, se avisa
  // (la pantalla lo muestra aparte, marcado "material sin configurar")
  const conocidos = new Set(area.materiales.map(m=>m.id));
  const huerfanos = [...new Set([...inv.stock.keys()].map(k=>k.split('|')[0]).filter(m=>!conocidos.has(m)))];
  if(huerfanos.length) console.error(`[inventario] ${area.id}: hay stock de material(es) que no están en js/core/areas-config.js: ${huerfanos.join(', ')} — agregalos ahí (o como "alias" del material correcto)`);
  inv.version = inv.movimientos.length;
  inventarios.set(area.id, inv);
  // la foto legible se guarda con atraso (ver programarFotoStock): si el
  // puente se cerró en ese segundo quedó vieja, así que se rehace al cargar
  try { escribirListaJson(inventarioPath(area), stockComoLista(inv)); } catch(e){ console.error('[inventario] foto del stock:', e.message); }
  return inv;
}
function aplicarAlStock(stock, items){
  items.forEach(l=>{
    const k = invClave(l.material, l.medida);
    const n = (stock.get(k)||0) + (l.tipo==='entrada' ? l.cantidad : -l.cantidad);
    if(n) stock.set(k, n); else stock.delete(k);
  });
}
function stockComoLista(inv){
  const lista = [];
  inv.stock.forEach((cantidad, k)=>{ if(cantidad>0){ const [material, medida] = k.split('|'); lista.push({material, medida, cantidad}); } });
  return lista;
}
/* Totales de HOY sobre TODOS los movimientos del día (antes la pantalla los
   sumaba solo sobre los últimos 300: en un día con mucho movimiento daban
   de menos). Recorre desde el final hasta el primer movimiento de ayer. */
function totalesDeHoy(inv){
  let sale = 0, entra = 0;
  for(let i=inv.movimientos.length-1; i>=0; i--){
    const mv = inv.movimientos[i];
    if(!esHoy(mv.fecha)) break;
    mv.items.forEach(l=>{ if(l.tipo==='salida') sale += l.cantidad; else entra += l.cantidad; });
  }
  return {sale, entra};
}
/* La foto legible del stock (inventario-<área>.json) no es la fuente de
   verdad (lo es el diario), así que no hace falta reescribirla en cada
   movimiento: con mucha actividad se guarda como mucho una vez por segundo. */
const fotosPendientes = new Set();
function programarFotoStock(area, inv){
  if(fotosPendientes.has(area.id)) return;
  fotosPendientes.add(area.id);
  setTimeout(()=>{
    fotosPendientes.delete(area.id);
    try { escribirListaJson(inventarioPath(area), stockComoLista(inv)); }
    catch(e){ console.error('[inventario] no se pudo guardar la foto del stock:', e.message); }
  }, 1000);
}
function exigirInventario(area){
  if(area.rack.tipo !== 'inventario'){
    const e = new Error(`${area.nombre} no maneja inventario por material y medida.`);
    e.status = 400; throw e;
  }
}
function usuarioDeSesion(req){
  const token = req.get('x-auth-token');
  const s = token && sesiones.get(token);
  return s ? s.usuario : null;
}
/* Valida y normaliza una línea; devuelve {linea} o {error}. */
function lineaInventario(area, it, i){
  const n = `línea ${i+1}`;
  if(!it || (it.tipo!=='entrada' && it.tipo!=='salida')) return {error:`${n}: tipo inválido (entrada o salida)`};
  const mat = area.materiales.find(m=>m.id===it.material || (m.alias||[]).includes(it.material));
  if(!mat) return {error:`${n}: material desconocido "${it.material}"`};
  const medida = String(it.medida==null?'':it.medida).trim().replace('.', ',');
  if(!mat.medidas.includes(medida)) return {error:`${n}: ${mat.nombre} no tiene medida ${medida||'(vacía)'} mm`};
  const cantidad = Number(it.cantidad);
  if(!Number.isInteger(cantidad) || cantidad<=0 || cantidad>INV_MAX_CANTIDAD) return {error:`${n}: cantidad inválida "${it.cantidad}" (entero de 1 a ${INV_MAX_CANTIDAD})`};
  return {linea:{tipo:it.tipo, material:mat.id, materialNombre:mat.nombre, codigo:mat.codigo||null, medida, cantidad}};
}

app.get('/api/inventario', (req, res) => {
  const area = areaDe(req);
  exigirInventario(area);
  const inv = inventarioDe(area);
  // respaldo de las PCs sin conexión en vivo: si ya tienen esta versión,
  // no se les manda nada de nuevo
  if(req.query.version!=null && Number(req.query.version)===inv.version) return res.json({ sinCambios: true, version: inv.version });
  res.json({
    version: inv.version,
    stock: stockComoLista(inv),
    movimientos: inv.movimientos.slice(-INV_RECIENTES).reverse(),
    hoy: totalesDeHoy(inv)
  });
});

app.post('/api/inventario/movimientos', (req, res) => {
  const area = areaDe(req);
  exigirInventario(area);
  const inv = inventarioDe(area);
  const idCliente = typeof (req.body && req.body.idCliente)==='string' ? req.body.idCliente.slice(0, 64) : null;
  if(idCliente && inv.porIdCliente.has(idCliente)){
    // el mismo carrito ya se registró (reintento): no se vuelve a aplicar
    return res.json({ ok: true, repetido: true, version: inv.version, movimiento: inv.porIdCliente.get(idCliente), stock: stockComoLista(inv), hoy: totalesDeHoy(inv) });
  }
  const items = (req.body && req.body.items) || [];
  if(!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'no hay ningún movimiento para registrar' });
  if(items.length > 500) return res.status(400).json({ error: 'demasiadas líneas en un solo lote (máximo 500)' });

  const errores = [], lineas = [];
  items.forEach((it, i)=>{ const r = lineaInventario(area, it, i); if(r.error) errores.push(r.error); else lineas.push(r.linea); });
  if(errores.length) return res.status(400).json({ error: 'El lote tiene líneas inválidas — no se registró nada.', detalles: errores });

  // stock resultante = actual + entradas − salidas, por (material, medida)
  const neto = new Map(), saleTotal = new Map();
  lineas.forEach(l=>{
    const k = invClave(l.material, l.medida);
    neto.set(k, (neto.get(k)||0) + (l.tipo==='entrada' ? l.cantidad : -l.cantidad));
    if(l.tipo==='salida') saleTotal.set(k, (saleTotal.get(k)||0) + l.cantidad);
  });
  const faltantes = [];
  neto.forEach((delta, k)=>{
    const hay = inv.stock.get(k)||0;
    if(hay + delta < 0){
      const l = lineas.find(x=>invClave(x.material, x.medida)===k);
      faltantes.push(`${l.materialNombre} ${l.medida} mm: hay ${hay}, salen ${saleTotal.get(k)}`);
    }
  });
  if(faltantes.length) return res.status(409).json({ error: 'No alcanza el stock — no se registró nada.', detalles: faltantes, version: inv.version });

  const movimiento = {
    id: crypto.randomBytes(6).toString('hex'),
    idCliente,
    fecha: new Date().toISOString(),
    usuario: usuarioDeSesion(req),
    nota: String((req.body && req.body.nota) || '').trim().slice(0, 200) || null,
    items: lineas
  };
  // primero el diario (si no se puede escribir, el pedido falla y el stock
  // en memoria no se toca); después la memoria; la foto del stock al final
  fs.appendFileSync(diarioPath(area), JSON.stringify(movimiento) + '\n', 'utf8');
  aplicarAlStock(inv.stock, lineas);
  inv.movimientos.push(movimiento);
  if(idCliente) inv.porIdCliente.set(idCliente, movimiento);
  inv.version++;
  const stock = stockComoLista(inv), hoy = totalesDeHoy(inv);
  programarFotoStock(area, inv);
  notificar({ tipo:'inventario', area: area.id, version: inv.version, movimiento, stock, hoy });
  res.json({ ok: true, version: inv.version, movimiento, stock, hoy });
});

/* ============ Cambios en vivo (Server-Sent Events) ============
   Cada pestaña abierta de la app mantiene UNA conexión acá; cuando
   alguien registra un movimiento o mueve algo del rack, el puente se lo
   avisa al instante a todas. Reemplaza a las 30 PCs preguntando cada 6 s
   "¿cambió algo?" (que además veían los cambios con hasta 6 s de atraso).
   EventSource no puede mandar cabeceras: el API_TOKEN viaja como
   ?api_token=... (ver el control de API_TOKEN de arriba). */
const clientesEnVivo = new Set();
function notificar(evento){
  const datos = `data: ${JSON.stringify(evento)}\n\n`;
  clientesEnVivo.forEach(res=>{ try { res.write(datos); } catch(e){ clientesEnVivo.delete(res); } });
}
app.get('/api/eventos', (req, res) => {
  res.set({ 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', 'Connection':'keep-alive', 'X-Accel-Buffering':'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n'); // si se corta, el navegador reintenta a los 3 s
  clientesEnVivo.add(res);
  req.on('close', ()=>clientesEnVivo.delete(res));
});
// latido cada 20 s: mantiene viva la conexión (antivirus, proxies) y
// permite detectar y soltar las pestañas que se cerraron sin avisar
setInterval(()=>{ clientesEnVivo.forEach(res=>{ try { res.write(': ping\n\n'); } catch(e){ clientesEnVivo.delete(res); } }); }, 20000).unref();

/* Resumen del día para Lista de corte: cuántas entraron y salieron del
   rack HOY, contra el historial de arriba. No hace falta guardar nada
   nuevo para esto — se calcula al vuelo cada vez que lo piden. */
app.get('/api/rack-resumen-dia', exigirLogin, (req, res) => {
  const area = areaDe(req);
  const deHoy = leerHistorial().filter(h=>esHoy(h.fecha) && esDelArea(h, area));
  res.json({
    cortadasHoy: deHoy.filter(h=>h.evento==='entrada').length,
    sacadasHoy: deHoy.filter(h=>h.evento==='salida').length,
    enRackAhora: leerRackSimulado(area).length
  });
});

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
app.post('/api/imprimir-zpl', exigirLogin, (req, res) => {
  const printerShare = process.env.ZEBRA_PRINTER_SHARE;
  if(!printerShare){
    return res.status(501).json({ error: 'ZEBRA_PRINTER_SHARE no está configurado en tu .env — todavía no se puede imprimir directo (ver CONECTAR_SQL.md).' });
  }
  const { zpl } = req.body || {};
  if(!zpl) return res.status(400).json({ error: 'falta el contenido ZPL a imprimir' });

  const tmpFile = path.join(os.tmpdir(), `sticker_${Date.now()}_${Math.random().toString(16).slice(2,8)}.zpl`);
  try {
    fs.writeFileSync(tmpFile, zpl, 'utf8');
  } catch(err){
    return res.status(500).json({ error: 'no se pudo crear el archivo temporal: '+err.message });
  }
  // "copy /b" manda el archivo TAL CUAL (binario/crudo), sin que Windows
  // intente convertirlo — es el mismo truco que se usa hace años para
  // mandar ZPL/PCL/PostScript crudo a una impresora desde la línea de
  // comandos. \\localhost\NombreCompartido apunta a la impresora
  // instalada en ESTA MISMA PC, usando su nombre de recurso compartido.
  const comando = `copy /b "${tmpFile}" "\\\\localhost\\${printerShare}"`;
  exec(comando, (err, stdout, stderr) => {
    fs.unlink(tmpFile, ()=>{}); // limpieza del temporal; si falla no importa, no bloquea la respuesta
    if(err){
      console.error('[imprimir-zpl]', err.message, stderr);
      return res.status(500).json({ error: 'no se pudo mandar a imprimir: '+err.message });
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
app.get('/api/dxf', exigirLogin, async (req, res) => {
  const source = (process.env.DXF_SOURCE || 'sql').toLowerCase();
  try {
    if(source === 'file'){
      const archivo = req.query.archivo;
      if(!archivo) return res.status(400).json({ error: 'falta el parámetro "archivo"' });
      // tu SQL ya trae la RUTA COMPLETA (de red, ej. "\\\\192.168.2.2\\cnc-revisados\\..."
      // o "//192.168.2.2/cnc-revisados/...") — en ese caso se usa tal cual,
      // sin sumarle DXF_BASE_PATH: la base de datos es la que decide dónde
      // está cada archivo, no una carpeta fija. Si en cambio lo que viene
      // es solo un nombre de archivo (sin ruta), sí se le suma
      // DXF_BASE_PATH, y ahí sí se exige que quede DENTRO de esa carpeta
      // (para que un dato sucio en la base no pueda leer cualquier cosa
      // de la PC).
      const esRutaCompleta = /^(\\\\|\/|[a-zA-Z]:[\\/])/.test(archivo);
      let fullPath;
      if(esRutaCompleta){
        // OJO — "archivo" llega como parámetro de la URL, mandado por el
        // navegador: aunque el valor NORMALMENTE viene de tu columna SQL
        // (Desenho_Path), nada impide que alguien ya logueado en la app
        // edite ese parámetro a mano (o con las herramientas del navegador)
        // y pida leer OTRA ruta completa de la PC donde corre este puente
        // — sesión + ruta completa = podría leer cualquier archivo que el
        // usuario de Windows que corre "npm start" pueda leer, no solo DXF.
        // Si configurás DXF_ALLOWED_PREFIXES (uno o más prefijos de red
        // separados por coma, ver .env.example) esto se frena acá: se
        // exige que la ruta pedida empiece por alguno de esos prefijos,
        // igual que ya se exige para el caso de nombre suelto de abajo.
        // Si lo dejás vacío (como venía por default), queda como antes.
        const prefijos = (process.env.DXF_ALLOWED_PREFIXES || '')
          .split(',').map(s=>s.trim()).filter(Boolean);
        if(prefijos.length){
          const norm = s => s.replace(/\//g,'\\').toLowerCase();
          const archivoNorm = norm(archivo);
          const permitido = prefijos.some(p => archivoNorm.startsWith(norm(p)));
          if(!permitido){
            return res.status(400).json({ error: 'ruta de archivo no permitida (fuera de DXF_ALLOWED_PREFIXES)' });
          }
        }
        fullPath = archivo;
      } else {
        const base = path.resolve(process.env.DXF_BASE_PATH || '');
        fullPath = path.resolve(base, archivo);
        if(!fullPath.startsWith(base + path.sep) && fullPath!==base){
          return res.status(400).json({ error: 'nombre de archivo no permitido' });
        }
      }
      if(!fs.existsSync(fullPath)){
        return res.status(404).json({ error: `no se encontró el archivo: ${fullPath}` });
      }
      const contenido = fs.readFileSync(fullPath, 'utf8');
      return res.json({ contenido, ruta: fullPath });
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

app.post('/api/ordenes/:orden/marcar-en-stock', exigirLogin, exigirRackSql, bloquearSiSoloLectura, async (req, res) => {
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
    console.error('[marcar-en-stock]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ============ 4) Órdenes que están ahora mismo en el rack ============ */
app.get('/api/rack-actual', exigirRackSql, async (req, res) => {
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
app.post('/api/rack/:orden/salida', exigirLogin, exigirRackSql, bloquearSiSoloLectura, async (req, res) => {
  try {
    const { orden } = req.params;
    const pool = await getPool();
    await pool.request()
      .input('orden', sql.VarChar, orden)
      .query(queries.rackSalida);
    notificar({ tipo:'rack', area: 'papel' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[rack/salida]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/salud', (req, res) => res.json({ ok: true, hora: new Date().toISOString() }));

/* Cualquier error que se escape de un endpoint (por ej. un JSON del rack
   dañado, ver leerListaJson, o el rechazo de CORS) contesta JSON con un
   mensaje corto — antes caía en el manejador por defecto de Express, que
   devuelve una página HTML con el stack trace completo a quien preguntó. */
app.use((err, req, res, next) => {
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err.message);
  if(res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message, pendiente: !!err.pendiente });
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
  const inv = inventarioDe(a);
  console.log(`Inventario de ${a.nombre}: ${inv.version} movimiento(s) cargados.`);
});
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
