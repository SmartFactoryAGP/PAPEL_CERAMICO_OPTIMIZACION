/* =========================================================
   MIGRACIÓN de server/datos/ (archivos) a SQL Server
   =========================================================
   Destino: las tablas de server/sql/propuesta_tablas_racks.sql (crearlas
   primero). Tres modos, de menos a más riesgo:

     node tools/migracion/migrar-a-sql.js
        Revisa los datos y GENERA un archivo .sql (no se conecta a nada).
        Se puede abrir, revisar o correr a mano en SSMS.

     node tools/migracion/migrar-a-sql.js --ensayo
        Se conecta, hace TODA la migración dentro de una transacción,
        verifica los totales y DESHACE todo al final. No deja nada escrito.

     node tools/migracion/migrar-a-sql.js --ejecutar
        Igual que el ensayo, pero si todo cuadra CONFIRMA (COMMIT).
        Si algo no cuadra, deshace todo y avisa qué.

   Opciones: --datos <carpeta>  (por defecto server/datos)
             --salida <archivo.sql>

   Conexión (en server/.env):
     MIG_DB_SERVER, MIG_DB_DATABASE, MIG_DB_PORT (1433),
     MIG_DB_USER y MIG_DB_PASSWORD, o MIG_DB_TRUSTED_CONNECTION=true

   Reglas:
   - La migración es TODO O NADA: una sola transacción.
   - Se niega a correr si las tablas destino ya tienen datos (evita
     migrar dos veces).
   - Las horas se guardan en UTC en los archivos; acá se pasan a hora de
     Colombia (UTC−5, sin horario de verano).
   - Los archivos NO se tocan ni se borran.
   ========================================================= */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const AREAS = require(path.join(RAIZ, 'js', 'core', 'areas-config.js'));
const AREAS_CASILLAS = Object.values(AREAS.areas).filter(a=>a.rack.tipo==='casillas').map(a=>a.id);   // papel, mallas
const AREAS_INVENTARIO = Object.values(AREAS.areas).filter(a=>a.rack.tipo==='inventario').map(a=>a.id); // tecoflex
const TABLA_CASILLAS = { papel: 'Papel', mallas: 'Mallas' };
const FILAS_POR_INSERT = 500; // SQL Server acepta hasta 1000 filas por INSERT … VALUES

/* ---------- lectura y validación ---------- */
function leerJson(ruta, porDefecto){
  if(!fs.existsSync(ruta)) return porDefecto;
  const t = fs.readFileSync(ruta, 'utf8');
  return t.trim() ? JSON.parse(t) : porDefecto;
}
/* Lee todo server/datos/ y lo deja listo para insertar, con totales y avisos. */
function cargar(dirDatos){
  if(!fs.existsSync(dirDatos)) throw new Error(`No existe la carpeta de datos: ${dirDatos}`);
  const avisos = [];
  const d = { usuarios: [], permisos: [], casillas: {}, inventario: {}, avisos };

  // usuarios
  d.usuarios = leerJson(path.join(dirDatos, 'usuarios.json'), []);
  d.usuarios.forEach(u=>Object.entries(u.permisos||{}).forEach(([area, vistas])=>vistas.forEach(v=>d.permisos.push({ usuario: u.usuario, area, vista: v }))));

  // racks por orden (papel, mallas)
  AREAS_CASILLAS.forEach(area=>{
    const dir = path.join(dirDatos, area);
    const rutaRack = path.join(dir, 'rack.json');
    const rack = leerJson(rutaRack, []), historial = leerJson(path.join(dir, 'historial.json'), []);
    const mtime = fs.existsSync(rutaRack) ? fs.statSync(rutaRack).mtime.toISOString() : new Date().toISOString();
    const ubic = new Set();
    const filas = rack.map(o=>{
      if(ubic.has(o.ubicacion)) avisos.push(`${area}: la ubicación ${o.ubicacion} aparece dos veces en el rack`);
      ubic.add(o.ubicacion);
      // quién y cuándo la ingresó: su última entrada/reentrada en el historial
      const ing = historial.slice().reverse().find(h=>String(h.Ordem_Serial)===String(o.Ordem_Serial) && (h.evento==='entrada' || h.evento==='reentrada'));
      if(!ing) avisos.push(`${area}: la orden ${o.Ordem_Serial} está en el rack pero no tiene entrada en el historial (se usa la fecha del archivo, usuario vacío)`);
      const datosOrden = Object.assign({}, o); delete datosOrden.ubicacion;
      return { orden: String(o.Ordem_Serial), ubicacion: o.ubicacion, datos: JSON.stringify(datosOrden), ingreso: ing ? ing.fecha : mtime, usuario: ing ? (ing.usuario||null) : null };
    });
    const hist = historial.map(h=>({ orden: String(h.Ordem_Serial), ubicacion: h.ubicacion||null, evento: h.evento, usuario: h.usuario||null, fecha: h.fecha }));
    d.casillas[area] = { rack: filas, historial: hist };
  });

  // inventario por cantidad (tecoflex): el diario es la fuente de verdad
  AREAS_INVENTARIO.forEach(area=>{
    const conf = AREAS.areas[area];
    const alias = new Map(); conf.materiales.forEach(m=>(m.alias||[]).forEach(a=>alias.set(a, m.id)));
    const conocidos = new Set(conf.materiales.map(m=>m.id));
    const dir = path.join(dirDatos, area);
    let lineas = [];
    const rutaDiario = path.join(dir, 'movimientos.jsonl');
    if(fs.existsSync(rutaDiario)){
      fs.readFileSync(rutaDiario, 'utf8').split('\n').forEach((t, i)=>{
        if(!t.trim()) return;
        try { lineas.push(JSON.parse(t)); } catch(e){ avisos.push(`${area}: línea ${i+1} del diario ilegible (se saltea — típicamente un corte de luz a mitad de escritura)`); }
      });
    } else lineas = leerJson(path.join(dir, 'movimientos.json'), []); // formato anterior
    const movimientos = [], vistos = new Set(), stock = new Map();
    lineas.forEach((mv, i)=>{
      let idCliente = mv.idCliente || null;
      if(idCliente && vistos.has(idCliente)){ avisos.push(`${area}: idCliente repetido ${idCliente} (se migra sin él)`); idCliente = null; }
      if(idCliente) vistos.add(idCliente);
      const items = mv.items.map((l, j)=>{
        const material = alias.get(l.material) || l.material;
        if(!conocidos.has(material)) avisos.push(`${area}: material desconocido "${l.material}" en el movimiento ${mv.id}`);
        const k = material + '|' + l.medida;
        stock.set(k, (stock.get(k)||0) + (l.tipo==='entrada' ? l.cantidad : -l.cantidad));
        return { linea: j+1, tipo: l.tipo, material, medida: l.medida, cantidad: l.cantidad };
      });
      movimientos.push({ id: i+1, idOrigen: mv.id || null, idCliente, usuario: mv.usuario||null, nota: mv.nota||null, fecha: mv.fecha, items });
    });
    const stockLista = [...stock].filter(([, c])=>c!==0).map(([k, cantidad])=>{ const [material, medida] = k.split('|'); return { material, medida, cantidad }; });
    stockLista.filter(s=>s.cantidad<0).forEach(s=>avisos.push(`${area}: stock NEGATIVO ${s.material} ${s.medida} mm = ${s.cantidad} (no debería pasar; revisar antes de migrar)`));
    // la foto legible debería coincidir con lo que da el diario
    const foto = leerJson(path.join(dir, 'inventario.json'), null);
    if(foto){
      const firma = l => JSON.stringify(l.filter(s=>s.cantidad>0).map(s=>`${alias.get(s.material)||s.material}|${s.medida}|${s.cantidad}`).sort());
      // (la foto se guarda con ~1 s de demora: si el puente se cerró justo
      // después de un movimiento, es normal que esté un paso atrás)
      if(firma(foto) !== firma(stockLista)) avisos.push(`${area}: inventario.json (la foto legible) no coincide con el diario. Es normal si el puente se cerró justo después de un movimiento; se migra lo que da el diario, que es la fuente de verdad y está completo.`);
    }
    d.inventario[area] = { movimientos, stock: stockLista.filter(s=>s.cantidad>0) };
  });
  return d;
}

/* Totales esperados: lo mismo que se verifica en la base después de insertar. */
function totales(d){
  const t = { usuarios: d.usuarios.length, permisos: d.permisos.length };
  AREAS_CASILLAS.forEach(a=>{ t[a+'Rack'] = d.casillas[a].rack.length; t[a+'Historial'] = d.casillas[a].historial.length; });
  AREAS_INVENTARIO.forEach(a=>{
    const inv = d.inventario[a];
    t[a+'Movimientos'] = inv.movimientos.length;
    t[a+'Lineas'] = inv.movimientos.reduce((s, m)=>s+m.items.length, 0);
    t[a+'StockFilas'] = inv.stock.length;
    t[a+'StockUnidades'] = inv.stock.reduce((s, x)=>s+x.cantidad, 0);
  });
  return t;
}

/* ---------- generación del T-SQL ---------- */
const txt = v => v==null ? 'NULL' : `N'${String(v).replace(/'/g, "''")}'`;
const num = v => v==null ? 'NULL' : String(Number(v));
/* ISO en UTC -> hora de Colombia (UTC−5), literal DATETIME2 */
function fechaCo(iso){
  const ms = Date.parse(iso);
  if(isNaN(ms)) return 'NULL';
  return `'${new Date(ms - 5*3600*1000).toISOString().replace('T', ' ').replace('Z', '')}'`;
}
function inserts(tabla, columnas, filas){
  const out = [];
  for(let i=0; i<filas.length; i+=FILAS_POR_INSERT){
    out.push(`INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES\n  ` + filas.slice(i, i+FILAS_POR_INSERT).map(f=>'(' + f.join(', ') + ')').join(',\n  ') + ';');
  }
  return out.join('\n');
}
function verificar(consulta, esperado, etiqueta){
  return `IF (${consulta}) <> ${esperado} THROW 50002, N'Verificación falló: ${etiqueta} (se esperaban ${esperado}). No se migró nada.', 1;`;
}

function generarSql(d, opciones){
  const final = (opciones && opciones.final) || 'COMMIT';
  const t = totales(d);
  const s = [];
  s.push(`/* Migración de Materiales Semiterminados — generada ${new Date().toISOString()}`);
  s.push(`   Totales: ${JSON.stringify(t)} */`);
  s.push('SET XACT_ABORT ON;  -- cualquier error deshace TODO', 'SET NOCOUNT ON;', 'BEGIN TRANSACTION;');
  const tablas = ['rack.Usuarios', 'rack.Permisos', ...AREAS_CASILLAS.flatMap(a=>[`rack.${TABLA_CASILLAS[a]}Rack`, `rack.${TABLA_CASILLAS[a]}Historial`]),
                  'rack.TecoflexStock', 'rack.TecoflexMovimientos', 'rack.TecoflexMovimientoLineas'];
  s.push(`IF ${tablas.map(x=>`EXISTS (SELECT 1 FROM ${x})`).join(' OR ')}\n  THROW 50001, N'Las tablas destino ya tienen datos: la migración ya se hizo (o hay datos de prueba). No se hizo nada.', 1;`);

  s.push('\n-- usuarios y permisos');
  if(d.usuarios.length) s.push(inserts('rack.Usuarios', ['Usuario', 'ClaveHash', 'ClaveSal', 'EsAdmin', 'Activo', 'Creado', 'Actualizado'],
    d.usuarios.map(u=>[txt(u.usuario), txt(u.hash), txt(u.salt), u.admin ? '1' : '0', u.activo===false ? '0' : '1', fechaCo(u.creado), fechaCo(u.actualizado||u.creado)])));
  if(d.permisos.length) s.push(inserts('rack.Permisos', ['Usuario', 'Area', 'Vista'], d.permisos.map(p=>[txt(p.usuario), txt(p.area), txt(p.vista)])));

  AREAS_CASILLAS.forEach(a=>{
    const T = TABLA_CASILLAS[a], c = d.casillas[a];
    s.push(`\n-- rack de ${AREAS.areas[a].nombre}`);
    if(c.rack.length) s.push(inserts(`rack.${T}Rack`, ['OrdenSerial', 'Ubicacion', 'DatosOrden', 'Ingreso', 'Usuario'],
      c.rack.map(r=>[txt(r.orden), txt(r.ubicacion), txt(r.datos), fechaCo(r.ingreso), txt(r.usuario)])));
    if(c.historial.length) s.push(inserts(`rack.${T}Historial`, ['OrdenSerial', 'Ubicacion', 'Evento', 'Usuario', 'Fecha'],
      c.historial.map(h=>[txt(h.orden), txt(h.ubicacion), txt(h.evento), txt(h.usuario), fechaCo(h.fecha)])));
  });

  AREAS_INVENTARIO.forEach(a=>{
    const inv = d.inventario[a];
    s.push(`\n-- inventario de ${AREAS.areas[a].nombre}: movimientos (con el mismo orden que en el diario), sus líneas y el stock`);
    if(inv.movimientos.length){
      s.push('SET IDENTITY_INSERT rack.TecoflexMovimientos ON;');
      s.push(inserts('rack.TecoflexMovimientos', ['Id', 'IdOrigen', 'IdCliente', 'Usuario', 'Nota', 'Fecha'],
        inv.movimientos.map(m=>[num(m.id), txt(m.idOrigen), txt(m.idCliente), txt(m.usuario), txt(m.nota), fechaCo(m.fecha)])));
      s.push('SET IDENTITY_INSERT rack.TecoflexMovimientos OFF;');
      s.push(inserts('rack.TecoflexMovimientoLineas', ['MovimientoId', 'Linea', 'Tipo', 'Material', 'MedidaMm', 'Cantidad'],
        inv.movimientos.flatMap(m=>m.items.map(l=>[num(m.id), num(l.linea), txt(l.tipo), txt(l.material), txt(l.medida), num(l.cantidad)]))));
    }
    if(inv.stock.length) s.push(inserts('rack.TecoflexStock', ['Material', 'MedidaMm', 'Cantidad'], inv.stock.map(x=>[txt(x.material), txt(x.medida), num(x.cantidad)])));
  });

  s.push('\n-- verificación: si algo no cuadra, se deshace todo');
  s.push(verificar('SELECT COUNT(*) FROM rack.Usuarios', t.usuarios, 'usuarios'));
  s.push(verificar('SELECT COUNT(*) FROM rack.Permisos', t.permisos, 'permisos'));
  AREAS_CASILLAS.forEach(a=>{
    s.push(verificar(`SELECT COUNT(*) FROM rack.${TABLA_CASILLAS[a]}Rack`, t[a+'Rack'], `órdenes en el rack de ${a}`));
    s.push(verificar(`SELECT COUNT(*) FROM rack.${TABLA_CASILLAS[a]}Historial`, t[a+'Historial'], `historial de ${a}`));
  });
  AREAS_INVENTARIO.forEach(a=>{
    s.push(verificar('SELECT COUNT(*) FROM rack.TecoflexMovimientos', t[a+'Movimientos'], 'movimientos de Tecoflex'));
    s.push(verificar('SELECT COUNT(*) FROM rack.TecoflexMovimientoLineas', t[a+'Lineas'], 'líneas de movimientos de Tecoflex'));
    s.push(verificar('SELECT ISNULL(SUM(Cantidad),0) FROM rack.TecoflexStock', t[a+'StockUnidades'], 'unidades en stock de Tecoflex'));
    // el stock tiene que ser exactamente la suma de entradas menos salidas
    s.push(verificar(`SELECT COUNT(*) FROM (
    SELECT Material, MedidaMm, SUM(CASE Tipo WHEN 'entrada' THEN Cantidad ELSE -Cantidad END) AS Neto
    FROM rack.TecoflexMovimientoLineas GROUP BY Material, MedidaMm HAVING SUM(CASE Tipo WHEN 'entrada' THEN Cantidad ELSE -Cantidad END) <> 0
  ) m FULL JOIN rack.TecoflexStock s ON s.Material = m.Material AND s.MedidaMm = m.MedidaMm
  WHERE ISNULL(m.Neto,0) <> ISNULL(s.Cantidad,0)`, 0, 'el stock de Tecoflex no coincide con sus movimientos'));
  });
  s.push(`\n${final} TRANSACTION;`);
  if(final==='COMMIT') s.push(`PRINT N'Migración completa: ${Object.entries(t).map(([k, v])=>k+'='+v).join(', ')}';`);
  return s.join('\n');
}

/* ---------- ejecución contra SQL Server ---------- */
async function ejecutar(script, confirmar){
  require(path.join(RAIZ, 'server', 'node_modules', 'dotenv')).config({ path: path.join(RAIZ, 'server', '.env') });
  const sql = require(path.join(RAIZ, 'server', 'node_modules', 'mssql'));
  const e = process.env;
  if(!e.MIG_DB_SERVER || !e.MIG_DB_DATABASE) throw new Error('Faltan MIG_DB_SERVER y MIG_DB_DATABASE en server/.env');
  const cfg = { server: e.MIG_DB_SERVER, database: e.MIG_DB_DATABASE, port: parseInt(e.MIG_DB_PORT || '1433', 10),
    requestTimeout: 10*60*1000, connectionTimeout: 30000,
    options: { trustServerCertificate: true, trustedConnection: String(e.MIG_DB_TRUSTED_CONNECTION).toLowerCase()==='true' } };
  if(e.MIG_DB_USER){ cfg.user = e.MIG_DB_USER; cfg.password = e.MIG_DB_PASSWORD; }
  const pool = await new sql.ConnectionPool(cfg).connect();
  try {
    await pool.request().batch(script);
    if(confirmar){
      const r = await pool.request().query(`SELECT
        (SELECT COUNT(*) FROM rack.Usuarios) AS usuarios, (SELECT COUNT(*) FROM rack.TecoflexMovimientos) AS movimientos,
        (SELECT ISNULL(SUM(Cantidad),0) FROM rack.TecoflexStock) AS unidades`);
      console.log('En la base quedó:', r.recordset[0]);
    }
  } finally { await pool.close(); }
}

/* ---------- línea de comandos ---------- */
async function main(){
  const args = process.argv.slice(2);
  const opt = n => { const i = args.indexOf(n); return i>=0 ? args[i+1] : null; };
  const dirDatos = path.resolve(opt('--datos') || path.join(RAIZ, 'server', 'datos'));
  const modo = args.includes('--ejecutar') ? 'ejecutar' : args.includes('--ensayo') ? 'ensayo' : 'generar';

  const d = cargar(dirDatos);
  const t = totales(d);
  console.log(`Datos leídos de ${dirDatos}:`);
  Object.entries(t).forEach(([k, v])=>console.log(`  ${k.padEnd(22)} ${v}`));
  if(d.avisos.length){ console.log('\nAvisos:'); d.avisos.forEach(a=>console.log('  - ' + a)); }

  if(modo==='generar'){
    const salida = path.resolve(opt('--salida') || path.join(__dirname, 'salida', `migracion-${new Date().toISOString().slice(0,10)}.sql`));
    fs.mkdirSync(path.dirname(salida), { recursive: true });
    // con BOM: sin él, SQL Server Management Studio puede leer el archivo como
    // ANSI y meter tildes y eñes mal escritas en la base
    fs.writeFileSync(salida, '﻿' + generarSql(d, { final: 'COMMIT' }), 'utf8');
    console.log(`\nScript generado: ${salida}\n(No se conectó a ninguna base. Para probar contra SQL sin dejar nada escrito: --ensayo)`);
    return;
  }
  console.log(`\n${modo==='ensayo' ? 'ENSAYO (se deshace al final)' : 'EJECUTANDO'} contra SQL Server…`);
  await ejecutar(generarSql(d, { final: modo==='ensayo' ? 'ROLLBACK' : 'COMMIT' }), modo==='ejecutar');
  console.log(modo==='ensayo'
    ? 'Ensayo OK: la migración entra completa y todos los totales cuadran. No quedó nada escrito.'
    : 'Migración confirmada. Los archivos de server/datos/ quedan intactos como respaldo.');
}

module.exports = { cargar, totales, generarSql, fechaCo };
if(require.main === module) main().catch(e=>{ console.error('\nERROR: ' + e.message + '\n(Si la migración había empezado, se deshizo completa.)'); process.exit(1); });
