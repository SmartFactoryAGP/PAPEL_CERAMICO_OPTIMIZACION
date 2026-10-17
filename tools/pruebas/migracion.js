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
  await api(p.url, 'POST', '/api/rack-simulado/agregar', { token: t, area: 'mallas', cuerpo: { Ordem_Serial: 'M1' } });
  const mov = (items, nota, idCliente) => api(p.url, 'POST', '/api/inventario/movimientos', { token: t, area: 'tecoflex', cuerpo: { items, nota, idCliente } });
  await mov([{ tipo: 'entrada', material: '100004045', medida: '6,5', cantidad: 40 }, { tipo: 'entrada', material: '100003239', medida: '20', cantidad: 15 }], "entrega de O'Brien", 'c1');
  await mov([{ tipo: 'salida', material: '100005343', medida: '9', cantidad: 30 }, { tipo: 'salida', material: '100004045', medida: '6,5', cantidad: 40 }], null, 'c2');
  const enApp = (await api(p.url, 'GET', '/api/inventario', { token: t, area: 'tecoflex' })).d;
  await new Promise(r=>setTimeout(r, 1300)); // la foto legible del stock se guarda con ~1 s de demora
  await p.cerrar();

  const d = cargar(path.join(dir, 'server', 'datos'));
  const tot = totales(d);
  assert.deepStrictEqual(d.avisos, []);
  assert.deepStrictEqual(tot, { usuarios: 4, permisos: 3*9 + 3, // Hfrodriguez, Ana y Beto importados (9 vistas c/u) + Operario Uno (1+2)
    papelRack: 2, papelHistorial: 4, mallasRack: 1, mallasHistorial: 1,
    tecoflexMovimientos: 3, tecoflexLineas: 5, tecoflexStockFilas: 2, tecoflexStockUnidades: 85 });
  ok(`totales: ${JSON.stringify(tot)}`);

  // el stock que se migra es exactamente el que muestra la app
  const firma = l => JSON.stringify(l.map(s=>`${s.material}|${s.medida}|${s.cantidad}`).sort());
  assert.strictEqual(firma(d.inventario.tecoflex.stock), firma(enApp.stock));
  assert.ok(d.inventario.tecoflex.movimientos[0].items[0].material === '100005343'); // la clave vieja 'pu' llega como el PU actual
  ok('el stock a migrar coincide con el de la app (incluido el movimiento viejo con clave "pu")');

  const sql = generarSql(d, { final: 'ROLLBACK' });
  assert.ok(!/undefined|NaN/.test(sql), 'quedó un valor sin convertir');
  assert.ok(sql.includes("N'Operario Uno'") && sql.includes("N'entrega de O''Brien'") && sql.includes("4''''"), 'comillas mal escapadas');
  assert.ok(sql.startsWith('/*') && sql.includes('SET XACT_ABORT ON') && sql.includes('BEGIN TRANSACTION') && sql.trim().endsWith('ROLLBACK TRANSACTION;'));
  assert.ok(sql.includes('THROW 50001') && (sql.match(/THROW 50002/g)||[]).length === 10);
  assert.ok(sql.includes('SET IDENTITY_INSERT rack.TecoflexMovimientos ON;') && sql.includes("(1, N'viejo1', NULL, NULL, NULL, '2026-10-16 11:56:21.766')"));
  ok('T-SQL: transacción única, se niega a migrar dos veces, 10 verificaciones, comillas escapadas, movimientos sin usuario');
  assert.strictEqual(fechaCo('2026-10-17T03:30:00.000Z'), "'2026-10-16 22:30:00.000'");
  ok('horas pasadas a Colombia (UTC−5), incluso cuando cambia el día');
});
