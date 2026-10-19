// Migración a SQL: con datos generados por la app (en una copia), el script
// tiene que llevar TODO, con las cuentas bien y el T-SQL bien armado.
// (No hay SQL Server en esta prueba: se verifica el script generado. La
//  prueba contra la base real es el modo --ensayo, cuando haya credenciales.)
const fs = require('fs'), path = require('path'), assert = require('assert');
const { ok, RAIZ, prepararCopia, borrarCopia, arrancarPuente, api, login, prueba } = require('./comun');
const { cargar, totales, generarSql, fechaCo } = require(path.join(RAIZ, 'tools', 'migracion', 'migrar-a-sql.js'));

prueba('Migración de archivos a SQL', async limpiar=>{
  const dir = prepararCopia('migracion'); limpiar(()=>borrarCopia(dir));
  // un movimiento viejo: de antes de exigir sesión y con la clave vieja 'pu'
  const datos = path.join(dir, 'server', 'datos', 'tecoflex'); fs.mkdirSync(datos, { recursive: true });
  fs.writeFileSync(path.join(datos, 'movimientos.jsonl'),
    JSON.stringify({ id: 'viejo1', fecha: '2026-10-16T16:56:21.766Z', usuario: null, nota: null, items: [{ tipo: 'entrada', material: 'pu', medida: '9', cantidad: 100 }] }) + '\n');

  const p = await arrancarPuente(dir, 5105); limpiar(()=>p.cerrar());
  const t = await login(p.url, 'Hfrodriguez', 'admin123');
  await api(p.url, 'POST', '/api/usuarios', { token: t, cuerpo: { usuario: 'Operario Uno', clave: 'clave1', permisos: { tecoflex: ['rack'], mallas: ['ordenes', 'rack'] } } });
  for(const o of ['P1', 'P2', 'P3']) await api(p.url, 'POST', '/api/rack-simulado/agregar', { token: t, area: 'papel', cuerpo: { Ordem_Serial: o, Descricao: "Vidrio 4'' templado" } });
  await api(p.url, 'POST', '/api/rack-simulado/P2/salida', { token: t, area: 'papel' });
  // mallas: stock por CodMat (entra con los 9 ceros de SAP, se guarda sin ellos)
  const movM = items => api(p.url, 'POST', '/api/inventario/movimientos', { token: t, area: 'mallas', cuerpo: { items } });
  await movM([{ tipo: 'entrada', material: '000000000600019608', descripcion: "MALLA TNT 4'' A", cantidad: 5 }, { tipo: 'entrada', material: '600039800', descripcion: 'MTNTF B', cantidad: 2 }]);
  await movM([{ tipo: 'salida', material: '600019608', cantidad: 2 }]);
  const enAppMallas = (await api(p.url, 'GET', '/api/inventario', { token: t, area: 'mallas' })).d;
  const mov = (items, nota, idCliente) => api(p.url, 'POST', '/api/inventario/movimientos', { token: t, area: 'tecoflex', cuerpo: { items, nota, idCliente } });
  await mov([{ tipo: 'entrada', material: '100004045', medida: '6,5', cantidad: 40 }, { tipo: 'entrada', material: '100003239', medida: '20', cantidad: 15 }], "entrega de O'Brien", 'c1');
  await mov([{ tipo: 'salida', material: '100005343', medida: '9', cantidad: 30 }, { tipo: 'salida', material: '100004045', medida: '6,5', cantidad: 40 }], null, 'c2');
  const enApp = (await api(p.url, 'GET', '/api/inventario', { token: t, area: 'tecoflex' })).d;
  await new Promise(r=>setTimeout(r, 1300)); // la foto legible del stock se guarda con ~1 s de demora
  await p.cerrar();

  const d = cargar(path.join(dir, 'server', 'datos'));
  const tot = totales(d);
  assert.deepStrictEqual(d.avisos, []);
  assert.deepStrictEqual(tot, { usuarios: 4, permisos: 3*13 + 3, // Hfrodriguez, Ana y Beto importados (13 vistas c/u) + Operario Uno (1+2)
    papelRack: 2, papelHistorial: 4, papelAprobaciones: 0, papelAprobacionesHistorial: 0,
    tecoflexMovimientos: 3, tecoflexLineas: 5, tecoflexStockFilas: 2, tecoflexStockUnidades: 85,
    mallasMovimientos: 2, mallasLineas: 3, mallasStockFilas: 2, mallasStockUnidades: 5,
    tejidosMovimientos: 0, tejidosLineas: 0, tejidosStockFilas: 0, tejidosStockUnidades: 0 });
  ok(`totales: ${JSON.stringify(tot)}`);

  // el stock que se migra es exactamente el que muestra la app
  const firma = l => JSON.stringify(l.map(s=>`${s.material}|${s.medida}|${s.cantidad}`).sort());
  assert.strictEqual(firma(d.inventario.tecoflex.stock), firma(enApp.stock));
  assert.strictEqual(firma(d.inventario.mallas.stock), firma(enAppMallas.stock));
  assert.ok(d.inventario.tecoflex.movimientos[0].items[0].material === '100005343'); // la clave vieja 'pu' llega como el PU actual
  ok('el stock a migrar coincide con el de la app (incluido el movimiento viejo con clave "pu")');

  const sql = generarSql(d, { final: 'ROLLBACK' });
  assert.ok(!/undefined|NaN/.test(sql), 'quedó un valor sin convertir');
  assert.ok(sql.includes("N'Operario Uno'") && sql.includes("N'entrega de O''Brien'") && sql.includes("4''''"), 'comillas mal escapadas');
  assert.ok(sql.startsWith('/*') && sql.includes('SET XACT_ABORT ON') && sql.includes('BEGIN TRANSACTION') && sql.trim().endsWith('ROLLBACK TRANSACTION;'));
  assert.ok(sql.includes('THROW 50001') && (sql.match(/THROW 50002/g)||[]).length === 18);
  assert.ok(sql.includes('INSERT INTO rack.MallasStock (CodMat, Descripcion, Cantidad)') && sql.includes("(N'600019608', N'MALLA TNT 4'''' A', 3)"), 'stock de mallas mal armado');
  assert.ok(sql.includes('SET IDENTITY_INSERT rack.TecoflexMovimientos ON;') && sql.includes("(1, N'viejo1', NULL, NULL, NULL, '2026-10-16 11:56:21.766')"));
  ok('T-SQL: transacción única, se niega a migrar dos veces, 18 verificaciones, comillas escapadas, movimientos sin usuario, stock de mallas por CodMat');
  assert.strictEqual(fechaCo('2026-10-17T03:30:00.000Z'), "'2026-10-16 22:30:00.000'");
  ok('horas pasadas a Colombia (UTC−5), incluso cuando cambia el día');
});
