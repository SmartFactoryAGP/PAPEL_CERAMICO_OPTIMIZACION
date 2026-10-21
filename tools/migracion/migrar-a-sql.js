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
const TABLA_INVENTARIO = { tecoflex: 'Tecoflex', mallas: 'Mallas', tejidos: 'Tejidos' }; // prefijo de las tablas de stock de cada área
const porCodmat = a => !!AREAS.areas[a].rack.porCodmat;          // Mallas: stock por CodMat, sin medida
/* columnas que identifican el material en las tablas de stock/líneas de cada área */
const colsMaterial = a => porCodmat(a) ? ['CodMat', 'Descripcion'] : ['Material', 'MedidaMm'];
const colsClave = a => porCodmat(a) ? ['CodMat'] : ['Material', 'MedidaMm'];
const AREAS_APROBACION = Object.values(AREAS.areas).filter(a=>a.aprobacionZfer).map(a=>a.id); // papel (ZFER CURVE 02–04)
const AREAS_POSICIONES = Object.values(AREAS.areas).filter(a=>a.rack.tipo==='posiciones').map(a=>a.id); // tejidos
const TABLA_POSICIONES = { tejidos: 'Tejidos' };
const FILAS_POR_INSERT = 500; // SQL Server acepta hasta 1000 filas por INSERT … VALUES

/* ---------- lectura y validación ---------- */
function leerJson(ruta, porDefecto){
  if(!fs.existsSync(ruta)) return porDefecto;
  const t = fs.readFileSync(ruta, 'utf8');
  return t.trim() ? JSON.parse(t) : porDefecto;
}
/* Historial de un rack de casillas: historial.jsonl (una línea por evento) o,
   si el puente todavía no lo convirtió, el historial.json viejo (un arreglo). */
function leerHistorialCasillas(dir){
  const jsonl = path.join(dir, 'historial.jsonl');
  if(!fs.existsSync(jsonl)) return leerJson(path.join(dir, 'historial.json'), []);
  return fs.readFileSync(jsonl, 'utf8').split('\n').filter(t=>t.trim()).map((t, i)=>{
    try { return JSON.parse(t); } catch(e){ throw new Error(`${jsonl}: la línea ${i+1} está dañada`); }
  });
}
/* Lee todo server/datos/ y lo deja listo para insertar, con totales y avisos. */
function cargar(dirDatos){
  if(!fs.existsSync(dirDatos)) throw new Error(`No existe la carpeta de datos: ${dirDatos}`);
  const avisos = [];
  const d = { usuarios: [], permisos: [], casillas: {}, inventario: {}, aprobaciones: {}, avisos };

  // usuarios
  d.usuarios = leerJson(path.join(dirDatos, 'usuarios.json'), []);
  d.usuarios.forEach(u=>Object.entries(u.permisos||{}).forEach(([area, vistas])=>vistas.forEach(v=>d.permisos.push({ usuario: u.usuario, area, vista: v }))));

  // racks por orden (papel, mallas)
  AREAS_CASILLAS.forEach(area=>{
    const dir = path.join(dirDatos, area);
    const rutaRack = path.join(dir, 'rack.json');
    const rack = leerJson(rutaRack, []), historial = leerHistorialCasillas(dir);
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

  // aprobaciones de ZFER (papel): una ficha por ZFER con su historial
  AREAS_APROBACION.forEach(area=>{
    const fichas = leerJson(path.join(dirDatos, area, 'aprobaciones.json'), []);
    const vistos = new Set();
    fichas.forEach(f=>{ if(vistos.has(f.zfer)) avisos.push(`${area}: el ZFER ${f.zfer} aparece dos veces en aprobaciones.json`); vistos.add(f.zfer); });
    d.aprobaciones[area] = {
      fichas: fichas.map(f=>({ zfer: f.zfer, estado: f.estado, solicitadoPor: f.solicitadoPor||null, solicitadoEn: f.solicitadoEn, nota: f.nota||null,
        detalle: f.detalle ? JSON.stringify(f.detalle) : null, resueltoPor: f.resueltoPor||null, resueltoEn: f.resueltoEn||null, motivo: f.motivo||null })),
      historial: fichas.flatMap(f=>(f.historial||[]).map(h=>({ zfer: f.zfer, evento: h.evento, usuario: h.usuario||null, fecha: h.fecha, nota: h.nota||null })))
    };
  });

  // inventario por cantidad (tecoflex): el diario es la fuente de verdad
  AREAS_INVENTARIO.forEach(area=>{
    const conf = AREAS.areas[area];
    const alias = new Map(); (conf.materiales||[]).forEach(m=>(m.alias||[]).forEach(a=>alias.set(a, m.id)));
    const conocidos = new Set((conf.materiales||[]).map(m=>m.id));
    const nombres = new Map(); // por CodMat: la última descripción conocida
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
        if(!conf.rack.porCodmat && !conocidos.has(material)) avisos.push(`${area}: material desconocido "${l.material}" en el movimiento ${mv.id}`);
        // (igual que el puente: una salida sin descripción no pisa la buena)
        if(l.materialNombre && (l.materialNombre!==material || !nombres.has(material))) nombres.set(material, l.materialNombre);
        const k = material + '|' + (l.medida||'');
        stock.set(k, (stock.get(k)||0) + (l.tipo==='entrada' ? l.cantidad : -l.cantidad));
        return { linea: j+1, tipo: l.tipo, material, medida: l.medida||'', nombre: l.materialNombre||null, cantidad: l.cantidad };
      });
      movimientos.push({ id: i+1, idOrigen: mv.id || null, idCliente, usuario: mv.usuario||null, nota: mv.nota||null, fecha: mv.fecha, items });
    });
    const stockLista = [...stock].filter(([, c])=>c!==0).map(([k, cantidad])=>{ const [material, medida] = k.split('|'); return { material, medida, cantidad, nombre: nombres.get(material)||null }; });
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

  // racks por posiciones (Tejidos): posiciones, tamaños, lo que hay hoy y el historial
  d.posiciones = {};
  AREAS_POSICIONES.forEach(area=>{
    const dir = path.join(dirDatos, area);
    const posiciones = leerJson(path.join(dir, 'posiciones.json'), []);
    const tamanos = leerJson(path.join(dir, 'tamanos.json'), {});
    const ocupacion = leerJson(path.join(dir, 'ocupacion.json'), {});
    const existe = new Set(posiciones.map(p=>p.pos));
    Object.keys(ocupacion).forEach(pos=>{ if(!existe.has(pos)) avisos.push(`${area}: la posición ${pos} tiene un tejido pero no está en posiciones.json`); });
    const historial = [];
    const rutaH = path.join(dir, 'historial.jsonl');
    if(fs.existsSync(rutaH)) fs.readFileSync(rutaH, 'utf8').split('\n').forEach((t, i)=>{
      if(!t.trim()) return;
      try { const ev = JSON.parse(t); const u = ev.unidad || {};
        historial.push({ evento: ev.evento, pos: ev.pos || null, codmat: u.codmat || ev.codmat || null, tamano: u.tamano || ev.tamano || null,
          datos: JSON.stringify(ev.unidad ? { ...ev.unidad, ...(ev.motivo ? { motivo: ev.motivo } : {}) } : { tamano: ev.tamano, antes: ev.antes, motivo: ev.motivo }), usuario: ev.usuario || null, fecha: ev.fecha }); }
      catch(e){ avisos.push(`${area}: línea ${i+1} del historial ilegible (se saltea)`); }
    });
    d.posiciones[area] = {
      posiciones,
      tamanos: Object.entries(tamanos).map(([codmat, v])=>({ codmat, tamano: v.tamano, nombre: v.nombre || null, vehiculo: v.vehiculo || null, geometria: v.geometria || null })),
      rack: Object.entries(ocupacion).map(([pos, u])=>({ pos, ...u })),
      historial,
    };
  });
  return d;
}

/* Totales esperados: lo mismo que se verifica en la base después de insertar. */
function totales(d){
  const t = { usuarios: d.usuarios.length, permisos: d.permisos.length };
  AREAS_CASILLAS.forEach(a=>{ t[a+'Rack'] = d.casillas[a].rack.length; t[a+'Historial'] = d.casillas[a].historial.length; });
  AREAS_APROBACION.forEach(a=>{ t[a+'Aprobaciones'] = d.aprobaciones[a].fichas.length; t[a+'AprobacionesHistorial'] = d.aprobaciones[a].historial.length; });
  AREAS_INVENTARIO.forEach(a=>{
    const inv = d.inventario[a];
    t[a+'Movimientos'] = inv.movimientos.length;
    t[a+'Lineas'] = inv.movimientos.reduce((s, m)=>s+m.items.length, 0);
    t[a+'StockFilas'] = inv.stock.length;
    t[a+'StockUnidades'] = inv.stock.reduce((s, x)=>s+x.cantidad, 0);
  });
  AREAS_POSICIONES.forEach(a=>{
    const p = d.posiciones[a];
    t[a+'Posiciones'] = p.posiciones.length; t[a+'Tamanos'] = p.tamanos.length;
    t[a+'EnRack'] = p.rack.length; t[a+'Historial'] = p.historial.length;
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
                  ...AREAS_APROBACION.flatMap(a=>[`rack.${TABLA_CASILLAS[a]}AprobacionesZfer`, `rack.${TABLA_CASILLAS[a]}AprobacionesZferHistorial`]),
                  ...AREAS_INVENTARIO.flatMap(a=>['Stock', 'Movimientos', 'MovimientoLineas'].map(x=>`rack.${TABLA_INVENTARIO[a]}${x}`)),
                  ...AREAS_POSICIONES.flatMap(a=>['Posiciones', 'Tamanos', 'Rack', 'Historial'].map(x=>`rack.${TABLA_POSICIONES[a]}${x}`))];
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

  AREAS_APROBACION.forEach(a=>{
    const T = TABLA_CASILLAS[a], ap = d.aprobaciones[a];
    s.push(`\n-- aprobaciones de ZFER de ${AREAS.areas[a].nombre} (CURVE 02–04 que llevan papel)`);
    if(ap.fichas.length) s.push(inserts(`rack.${T}AprobacionesZfer`, ['Zfer', 'Estado', 'SolicitadoPor', 'SolicitadoEn', 'Nota', 'Detalle', 'ResueltoPor', 'ResueltoEn', 'Motivo'],
      ap.fichas.map(f=>[txt(f.zfer), txt(f.estado), txt(f.solicitadoPor), fechaCo(f.solicitadoEn), txt(f.nota), txt(f.detalle), txt(f.resueltoPor), fechaCo(f.resueltoEn), txt(f.motivo)])));
    if(ap.historial.length) s.push(inserts(`rack.${T}AprobacionesZferHistorial`, ['Zfer', 'Evento', 'Usuario', 'Fecha', 'Nota'],
      ap.historial.map(h=>[txt(h.zfer), txt(h.evento), txt(h.usuario), fechaCo(h.fecha), txt(h.nota)])));
  });

  AREAS_INVENTARIO.forEach(a=>{
    const inv = d.inventario[a], T = `rack.${TABLA_INVENTARIO[a]}`;
    // Tecoflex: material + medida; Mallas: CodMat + descripción
    const valMaterial = x => porCodmat(a) ? [txt(x.material), txt(x.nombre)] : [txt(x.material), txt(x.medida)];
    s.push(`\n-- inventario de ${AREAS.areas[a].nombre}: movimientos (con el mismo orden que en el diario), sus líneas y el stock`);
    if(inv.movimientos.length){
      s.push(`SET IDENTITY_INSERT ${T}Movimientos ON;`);
      s.push(inserts(`${T}Movimientos`, ['Id', 'IdOrigen', 'IdCliente', 'Usuario', 'Nota', 'Fecha'],
        inv.movimientos.map(m=>[num(m.id), txt(m.idOrigen), txt(m.idCliente), txt(m.usuario), txt(m.nota), fechaCo(m.fecha)])));
      s.push(`SET IDENTITY_INSERT ${T}Movimientos OFF;`);
      s.push(inserts(`${T}MovimientoLineas`, ['MovimientoId', 'Linea', 'Tipo', ...colsMaterial(a), 'Cantidad'],
        inv.movimientos.flatMap(m=>m.items.map(l=>[num(m.id), num(l.linea), txt(l.tipo), ...valMaterial(l), num(l.cantidad)]))));
    }
    if(inv.stock.length) s.push(inserts(`${T}Stock`, [...colsMaterial(a), 'Cantidad'], inv.stock.map(x=>[...valMaterial(x), num(x.cantidad)])));
  });

  AREAS_POSICIONES.forEach(a=>{
    const p = d.posiciones[a], T = `rack.${TABLA_POSICIONES[a]}`;
    s.push(`\n-- rack de ${AREAS.areas[a].nombre}: posiciones, tamaño de cada tejido, lo que hay hoy y el historial (las fotos quedan como archivos)`);
    if(p.posiciones.length) s.push(inserts(`${T}Posiciones`, ['Posicion', 'Tamano'], p.posiciones.map(x=>[txt(x.pos), txt(x.tamano)])));
    if(p.tamanos.length) s.push(inserts(`${T}Tamanos`, ['CodMat', 'Tamano', 'Nombre', 'Vehiculo', 'Geometria'], p.tamanos.map(x=>[txt(x.codmat), txt(x.tamano), txt(x.nombre), txt(x.vehiculo), txt(x.geometria)])));
    if(p.rack.length) s.push(inserts(`${T}Rack`, ['Posicion', 'IdUnidad', 'CodMat', 'Nombre', 'Vehiculo', 'Geometria', 'Tamano', 'Responsables', 'Resistencia1', 'Resistencia2', 'Ensamble', 'Nota', 'Foto', 'Usuario', 'Ingreso'],
      p.rack.map(u=>[txt(u.pos), txt(u.id), txt(u.codmat), txt(u.nombre), txt(u.vehiculo), txt(u.geometria), txt(u.tamano), txt(u.responsables), txt(u.resistencia1), txt(u.resistencia2), txt(u.ensamble), txt(u.nota), txt(u.foto), txt(u.usuario), fechaCo(u.fecha)])));
    if(p.historial.length) s.push(inserts(`${T}Historial`, ['Evento', 'Posicion', 'CodMat', 'Tamano', 'Datos', 'Usuario', 'Fecha'],
      p.historial.map(h=>[txt(h.evento), txt(h.pos), txt(h.codmat), txt(h.tamano), txt(h.datos), txt(h.usuario), fechaCo(h.fecha)])));
  });

  s.push('\n-- verificación: si algo no cuadra, se deshace todo');
  s.push(verificar('SELECT COUNT(*) FROM rack.Usuarios', t.usuarios, 'usuarios'));
  s.push(verificar('SELECT COUNT(*) FROM rack.Permisos', t.permisos, 'permisos'));
  AREAS_CASILLAS.forEach(a=>{
    s.push(verificar(`SELECT COUNT(*) FROM rack.${TABLA_CASILLAS[a]}Rack`, t[a+'Rack'], `órdenes en el rack de ${a}`));
    s.push(verificar(`SELECT COUNT(*) FROM rack.${TABLA_CASILLAS[a]}Historial`, t[a+'Historial'], `historial de ${a}`));
  });
  AREAS_APROBACION.forEach(a=>{
    s.push(verificar(`SELECT COUNT(*) FROM rack.${TABLA_CASILLAS[a]}AprobacionesZfer`, t[a+'Aprobaciones'], `aprobaciones de ZFER de ${a}`));
    s.push(verificar(`SELECT COUNT(*) FROM rack.${TABLA_CASILLAS[a]}AprobacionesZferHistorial`, t[a+'AprobacionesHistorial'], `historial de aprobaciones de ${a}`));
  });
  AREAS_INVENTARIO.forEach(a=>{
    const T = `rack.${TABLA_INVENTARIO[a]}`, nom = AREAS.areas[a].nombre, k = colsClave(a);
    s.push(verificar(`SELECT COUNT(*) FROM ${T}Movimientos`, t[a+'Movimientos'], `movimientos de ${nom}`));
    s.push(verificar(`SELECT COUNT(*) FROM ${T}MovimientoLineas`, t[a+'Lineas'], `líneas de movimientos de ${nom}`));
    s.push(verificar(`SELECT ISNULL(SUM(Cantidad),0) FROM ${T}Stock`, t[a+'StockUnidades'], `unidades en stock de ${nom}`));
    // el stock tiene que ser exactamente la suma de entradas menos salidas
    s.push(verificar(`SELECT COUNT(*) FROM (
    SELECT ${k.join(', ')}, SUM(CASE Tipo WHEN 'entrada' THEN Cantidad ELSE -Cantidad END) AS Neto
    FROM ${T}MovimientoLineas GROUP BY ${k.join(', ')} HAVING SUM(CASE Tipo WHEN 'entrada' THEN Cantidad ELSE -Cantidad END) <> 0
  ) m FULL JOIN ${T}Stock s ON ${k.map(c=>`s.${c} = m.${c}`).join(' AND ')}
  WHERE ISNULL(m.Neto,0) <> ISNULL(s.Cantidad,0)`, 0, `el stock de ${nom} no coincide con sus movimientos`));
  });
  AREAS_POSICIONES.forEach(a=>{
    const T = `rack.${TABLA_POSICIONES[a]}`, nom = AREAS.areas[a].nombre;
    s.push(verificar(`SELECT COUNT(*) FROM ${T}Posiciones`, t[a+'Posiciones'], `posiciones del rack de ${nom}`));
    s.push(verificar(`SELECT COUNT(*) FROM ${T}Tamanos`, t[a+'Tamanos'], `tamaños de ${nom}`));
    s.push(verificar(`SELECT COUNT(*) FROM ${T}Rack`, t[a+'EnRack'], `${nom} en el rack`));
    s.push(verificar(`SELECT COUNT(*) FROM ${T}Historial`, t[a+'Historial'], `historial de ${nom}`));
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
