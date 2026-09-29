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
app.use('/css', express.static(path.join(__dirname, '..', 'css')));
app.use('/js', express.static(path.join(__dirname, '..', 'js')));
app.use('/img', express.static(path.join(__dirname, '..', 'img')));

// Clave opcional para hablarle al puente. Si completás API_TOKEN en tu
// .env, todo pedido tiene que traer el header "x-api-token" con el mismo
// valor — así, aunque el puerto quedara expuesto sin querer en tu red,
// no cualquiera puede leer o escribir tus órdenes. Si dejás API_TOKEN
// vacío (como viene por defecto), no se pide nada, para no complicar el
// arranque inicial.
app.use((req, res, next)=>{
  const token = process.env.API_TOKEN;
  if(!token) return next(); // sin clave configurada, no se exige nada
  if(req.get('x-api-token')===token) return next();
  res.status(401).json({ error: 'falta o no coincide x-api-token' });
});

// Registro simple de cada pedido, para poder rastrear después quién
// marcó qué y cuándo si algo no cuadra (no guarda contraseñas ni datos
// del DXF, solo método+ruta+hora).
app.use((req, res, next)=>{
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
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
  if(!usuario || !clave || usuarios.get(String(usuario).trim()) !== String(clave)){
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

async function traerPuestosDeTrabajo(ordenes){
  if(!dbConfigCalendario || !ordenes.length) return {};
  try {
    const pool = await getPoolCalendario();
    const request = pool.request();
    const placeholders = ordenes.map((o,i)=>{ request.input('cal'+i, sql.VarChar, String(o)); return '@cal'+i; }).join(',');
    const cfg = queries.puestoDeTrabajo;
    const result = await request.query(
      `SELECT ${cfg.columnaOrden} AS orden, ${cfg.columnaPuesto} AS puesto FROM ${cfg.tabla} WHERE ${cfg.columnaOrden} IN (${placeholders})`
    );
    const mapa = {};
    result.recordset.forEach(r=>{ mapa[String(r.orden)] = r.puesto; });
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
    const placeholders = ZFER_INCLUIR.map((z,i)=>{ request.input('zfer'+i, sql.VarChar, z); return '@zfer'+i; }).join(',');
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
    const request = pool.request();
    const placeholders = seriales.map((s,i)=>{ request.input('zs'+i, sql.VarChar, s); return '@zs'+i; }).join(',');
    request.input('opFiltro', sql.VarChar, operacion);
    const query = queries.ordenesPorSerialLista.replace('{{LISTA}}', placeholders);
    const result = await request.query(query);
    return result.recordset;
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

app.get('/api/ordenes-pendientes', exigirLogin, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(queries.ordenesPendientes);
    let filas = result.recordset;

    // pedido explícito: sumar las órdenes que NO tienen Operation='0132'
    // pero sí tienen ZFER='70005171' en Calendario — mismo tratamiento que
    // las de siempre (archivo/ruta real, Puestodetrabajo, y el MISMO
    // filtro de Puestodetrabajo permitido de abajo) una vez que se
    // juntan con las demás.
    const seriales0132 = new Set(filas.map(f=>String(f.Ordem_Serial)));
    const serialesZfer = await traerOrdenesConZferEspecial();
    const nuevosPorZfer = serialesZfer.filter(s=>!seriales0132.has(s));
    if(nuevosPorZfer.length){
      const extra = await buscarOrdenesPorSerial(nuevosPorZfer, OPERATION_PARA_ORDENES_ZFER);
      filas = filas.concat(extra);
    }

    const puestos = await traerPuestosDeTrabajo(filas.map(f=>f.Ordem_Serial));
    filas.forEach(f=>{ f.Puestodetrabajo = puestos[String(f.Ordem_Serial)] || ''; });
    res.json(filas.filter(f=>puestoPermitido(f.Puestodetrabajo)));
  } catch (err) {
    console.error('[ordenes-pendientes]', err.message);
    res.status(500).json({ error: err.message });
  }
});

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
    const pool = await getPool();
    const result = await pool.request()
      .input('orden', sql.VarChar, req.params.orden)
      .query(queries.ordenPorSerial);
    if(!result.recordset.length) return res.json({ encontrada: false });
    const fila = result.recordset[0];
    const puestos = await traerPuestosDeTrabajo([fila.Ordem_Serial]);
    fila.Puestodetrabajo = puestos[String(fila.Ordem_Serial)] || '';
    res.json({ encontrada: true, orden: fila });
  } catch (err) {
    console.error('[ordenes-pendientes/:orden]', err.message);
    res.status(500).json({ error: err.message });
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
    const pool = await getPool();
    const result = await pool.request()
      .input('lote', sql.VarChar, req.params.codigo)
      .query(queries.ordenesPorLote);
    const filas = result.recordset;
    const puestos = await traerPuestosDeTrabajo(filas.map(f=>f.Ordem_Serial));
    filas.forEach(f=>{ f.Puestodetrabajo = puestos[String(f.Ordem_Serial)] || ''; });
    res.json(filas);
  } catch (err) {
    console.error('[lote/:codigo]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ============ Rack simulado, COMPARTIDO entre todas las PC ============
   Vive en un archivo chico de ESTA PC (la que corre el puente) — no en
   SQL, no en cada navegador por separado. Todas las computadoras que
   le pegan a este mismo puente ven exactamente el mismo Rack, lo
   actualicen desde donde lo actualicen. Nunca toca SQL para nada — es
   solo un archivo de texto plano en esta misma carpeta del servidor. */
const RACK_SIMULADO_PATH = path.join(__dirname, 'rack-simulado.json');
const RACK_LETRAS = ['A','B','C','D','E','F','G'];
const RACK_POR_LETRA = 20;

function leerRackSimulado(){
  try {
    return JSON.parse(fs.readFileSync(RACK_SIMULADO_PATH, 'utf8'));
  } catch(e){
    return []; // primera vez (todavía no existe el archivo) o quedó corrupto — arranca vacío
  }
}
function guardarRackSimulado(lista){
  fs.writeFileSync(RACK_SIMULADO_PATH, JSON.stringify(lista, null, 2), 'utf8');
}
function proximaUbicacionLibre(lista){
  const ocupadas = new Set(lista.map(o=>o.ubicacion));
  for(const letra of RACK_LETRAS){
    for(let n=1; n<=RACK_POR_LETRA; n++){
      const loc = letra+n;
      if(!ocupadas.has(loc)) return loc;
    }
  }
  return null; // las 140 ubicaciones están ocupadas — no debería pasar en la práctica
}

/* Registro chico de "entró al rack" / "salió del rack" — separado del
   estado ACTUAL del rack (que se borra al sacar algo), para poder
   armar el resumen del día aunque ya se haya sacado. Vive en su propio
   archivo, en la misma carpeta, y solo crece (nunca se reescriben
   filas viejas, solo se agrega una nueva al final). */
const RACK_HISTORIAL_PATH = path.join(__dirname, 'rack-historial.json');
function leerHistorial(){
  try {
    return JSON.parse(fs.readFileSync(RACK_HISTORIAL_PATH, 'utf8'));
  } catch(e){
    return [];
  }
}
function agregarAlHistorial(entrada){
  const historial = leerHistorial();
  historial.push({ ...entrada, fecha: new Date().toISOString() });
  fs.writeFileSync(RACK_HISTORIAL_PATH, JSON.stringify(historial, null, 2), 'utf8');
}
function esHoy(fechaISO){
  const hoy = new Date();
  const d = new Date(fechaISO);
  return d.getFullYear()===hoy.getFullYear() && d.getMonth()===hoy.getMonth() && d.getDate()===hoy.getDate();
}

app.get('/api/rack-simulado', (req, res) => {
  res.json(leerRackSimulado());
});

app.post('/api/rack-simulado/agregar', exigirLogin, (req, res) => {
  const orden = req.body || {};
  if(!orden.Ordem_Serial) return res.status(400).json({ error: 'falta Ordem_Serial' });
  const lista = leerRackSimulado();
  if(lista.find(o=>o.Ordem_Serial===orden.Ordem_Serial)){
    return res.status(409).json({ error: 'esa orden ya está en el rack simulado' });
  }
  const ubicacion = proximaUbicacionLibre(lista);
  if(!ubicacion) return res.status(409).json({ error: 'rack lleno, las 140 ubicaciones están ocupadas' });
  lista.push({ ...orden, ubicacion });
  guardarRackSimulado(lista);
  agregarAlHistorial({ Ordem_Serial: orden.Ordem_Serial, ubicacion, usuario: req.usuario, evento: 'entrada' });
  res.json({ ok: true, ubicacion });
});

app.post('/api/rack-simulado/:orden/salida', (req, res) => {
  const { orden } = req.params;
  let lista = leerRackSimulado();
  // Guardamos el renglón COMPLETO (no solo el Ordem_Serial) antes de
  // sacarlo — así, si después hace falta una reentrada por error del
  // operario, se puede reconstruir la orden entera (ubicación incluida)
  // sin tener que volver a pedir nada a SQL.
  const encontrada = lista.find(o=>o.Ordem_Serial === orden);
  lista = lista.filter(o=>o.Ordem_Serial !== orden);
  guardarRackSimulado(lista);
  const sacada = !!encontrada;
  if(sacada) agregarAlHistorial({ Ordem_Serial: orden, ubicacion: encontrada.ubicacion, orden: encontrada, usuario: req.usuario||null, evento: 'salida' });
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
  const { orden } = req.params;
  const enRackAhora = leerRackSimulado().some(o=>o.Ordem_Serial === orden);
  if(enRackAhora) return res.json({ encontrada: false, motivo: 'la orden ya está en el rack ahora mismo' });
  const historial = leerHistorial();
  // el historial solo crece (nunca se reescribe), así que la última
  // entrada de 'salida' para esta orden, recorriendo desde el final,
  // es la más reciente.
  for(let i=historial.length-1; i>=0; i--){
    const h = historial[i];
    if(h.Ordem_Serial===orden && h.evento==='salida' && h.ubicacion){
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
  const { ubicacion } = req.body || {};
  const orden = (req.body && req.body.orden) || {};
  if(!orden.Ordem_Serial) return res.status(400).json({ error: 'falta Ordem_Serial' });
  if(!ubicacion) return res.status(400).json({ error: 'falta la ubicación a reingresar' });
  const lista = leerRackSimulado();
  if(lista.find(o=>o.Ordem_Serial===orden.Ordem_Serial)){
    return res.status(409).json({ error: 'esa orden ya está en el rack' });
  }
  const ocupante = lista.find(o=>o.ubicacion===ubicacion);
  if(ocupante){
    return res.status(409).json({ error: `la posición ${ubicacion} ya la ocupa la orden ${ocupante.Ordem_Serial} — sacala primero, o reingresá esta desde "+ Agregar" para que le asignen otra posición libre` });
  }
  lista.push({ ...orden, ubicacion });
  guardarRackSimulado(lista);
  agregarAlHistorial({ Ordem_Serial: orden.Ordem_Serial, ubicacion, usuario: req.usuario, evento: 'reentrada' });
  res.json({ ok: true, ubicacion });
});

/* Resumen del día para Lista de corte: cuántas entraron y salieron del
   rack HOY, contra el historial de arriba. No hace falta guardar nada
   nuevo para esto — se calcula al vuelo cada vez que lo piden. */
app.get('/api/rack-resumen-dia', exigirLogin, (req, res) => {
  const historial = leerHistorial();
  const deHoy = historial.filter(h=>esHoy(h.fecha));
  res.json({
    cortadasHoy: deHoy.filter(h=>h.evento==='entrada').length,
    sacadasHoy: deHoy.filter(h=>h.evento==='salida').length,
    enRackAhora: leerRackSimulado().length
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
    const pool = await getPool();
    const result = await pool.request()
      .input('orden', sql.VarChar, orden)
      .query(queries.dxfPorOrden);
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
    console.error('[dxf]', err.message);
    res.status(500).json({ error: err.message });
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
app.post('/api/ordenes/:orden/marcar-en-stock', exigirLogin, bloquearSiSoloLectura, async (req, res) => {
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
    res.json({ ok: true, ubicacion });
  } catch (err) {
    console.error('[marcar-en-stock]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ============ 4) Órdenes que están ahora mismo en el rack ============ */
app.get('/api/rack-actual', async (req, res) => {
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
app.post('/api/rack/:orden/salida', exigirLogin, bloquearSiSoloLectura, async (req, res) => {
  try {
    const { orden } = req.params;
    const pool = await getPool();
    await pool.request()
      .input('orden', sql.VarChar, orden)
      .query(queries.rackSalida);
    res.json({ ok: true });
  } catch (err) {
    console.error('[rack/salida]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/salud', (req, res) => res.json({ ok: true, hora: new Date().toISOString() }));

/* Sin decirle una dirección puntual, Node ya escucha en TODAS las
   direcciones de red de esta PC (no solo localhost) — así que las otras
   computadoras de la red YA pueden llegar a este puente, con tal de que
   usen la dirección de red de esta máquina en vez de "localhost". Para
   que sea fácil de encontrar, se imprime acá abajo apenas arranca.
   (direccionesDeRed y PORT se calculan arriba de todo, junto con el
   filtro de CORS — acá abajo solo se reusan para el cartel.) */
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
