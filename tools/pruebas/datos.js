// Datos: migración desde el formato viejo, racks independientes y respaldo diario.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { ok, prepararCopia, borrarCopia, arrancarPuente, api, login, prueba } = require('./comun');

prueba('Datos: una carpeta por rack, migración y respaldo', async limpiar=>{
  const dir = prepararCopia('datos'); limpiar(()=>borrarCopia(dir));
  const srv = path.join(dir, 'server');
  // formato VIEJO: todo suelto en server/, historial compartido entre racks
  fs.writeFileSync(path.join(srv, 'rack-simulado.json'), JSON.stringify([{ Ordem_Serial: 'P1', ubicacion: 'A1' }]));
  fs.writeFileSync(path.join(srv, 'rack-mallas.json'), JSON.stringify([{ Ordem_Serial: 'M1', ubicacion: 'A1' }]));
  fs.writeFileSync(path.join(srv, 'rack-historial.json'), JSON.stringify([
    { Ordem_Serial: 'P0', evento: 'entrada', fecha: '2026-10-01T10:00:00Z' },                 // sin área = papel
    { area: 'papel', Ordem_Serial: 'P1', evento: 'entrada', fecha: '2026-10-02T10:00:00Z' },
    { area: 'mallas', Ordem_Serial: 'M1', evento: 'entrada', fecha: '2026-10-02T11:00:00Z' }]));
  fs.writeFileSync(path.join(srv, 'movimientos-tecoflex.jsonl'),
    JSON.stringify({ id: 'a', fecha: '2026-10-03T10:00:00Z', usuario: null, items: [{ tipo: 'entrada', material: 'pu', medida: '20', cantidad: 9 }] }) + '\n');

  const p = await arrancarPuente(dir, 5101); limpiar(()=>p.cerrar());
  const datos = path.join(srv, 'datos');
  const leer = r => JSON.parse(fs.readFileSync(path.join(datos, r), 'utf8'));
  const leerLineas = r => fs.readFileSync(path.join(datos, r), 'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)); // historial: una línea por evento
  assert.deepStrictEqual(leer('papel/rack.json').map(o=>o.Ordem_Serial), ['P1']);
  assert.deepStrictEqual(leer('mallas/rack.json').map(o=>o.Ordem_Serial), ['M1']);
  assert.deepStrictEqual(leerLineas('papel/historial.jsonl').map(h=>h.Ordem_Serial), ['P0', 'P1']);
  assert.deepStrictEqual(leerLineas('mallas/historial.jsonl').map(h=>h.Ordem_Serial), ['M1']);
  assert.ok(fs.existsSync(path.join(datos, 'tecoflex', 'movimientos.jsonl')) && fs.existsSync(path.join(datos, 'usuarios.json')));
  assert.deepStrictEqual(fs.readdirSync(srv).filter(f=>/\.(json|jsonl)$/.test(f)), []); // nada suelto en server/
  assert.ok(fs.existsSync(path.join(datos, '_anteriores', 'rack-historial.json')));
  ok('formato viejo -> datos/<rack>/; el historial compartido se repartió por rack; originales en _anteriores/');

  const hoy = fs.readdirSync(path.join(datos, 'respaldos'));
  assert.strictEqual(hoy.length, 1);
  assert.ok(fs.existsSync(path.join(datos, 'respaldos', hoy[0], 'papel', 'rack.json')));
  ok(`respaldo del día creado (respaldos/${hoy[0]})`);

  // racks independientes: dar entrada en mallas (stock por CodMat) no toca papel (ni su historial)
  const t = await login(p.url, 'Hfrodriguez', 'admin123');
  const ent = await api(p.url, 'POST', '/api/inventario/movimientos', { token: t, area: 'mallas', cuerpo: { items: [{ tipo: 'entrada', material: '000000000600019608', descripcion: 'MTNTF0036', cantidad: 3 }] } });
  assert.strictEqual(ent.s, 200, JSON.stringify(ent.d));
  assert.deepStrictEqual(leer('papel/rack.json').map(o=>o.Ordem_Serial), ['P1']);
  assert.strictEqual(leerLineas('papel/historial.jsonl').length, 2);
  assert.strictEqual(fs.readFileSync(path.join(datos, 'mallas', 'movimientos.jsonl'), 'utf8').trim().split('\n').length, 1);
  // el stock viejo de Tecoflex (clave 'pu') se ve como el PU actual
  const inv = await api(p.url, 'GET', '/api/inventario', { token: t, area: 'tecoflex' });
  assert.deepStrictEqual(inv.d.stock, [{ material: '100005343', medida: '20', cantidad: 9 }]);
  ok('mover en un rack no toca a los otros; Tecoflex conserva su stock');

  // segundo arranque: la migración no hace nada de nuevo
  await p.reiniciar();
  assert.ok(!p.log().includes('migración'));
  const mallas = await api(p.url, 'GET', '/api/inventario', { token: await login(p.url, 'Hfrodriguez', 'admin123'), area: 'mallas' });
  assert.deepStrictEqual(mallas.d.stock, [{ material: '600019608', medida: '', cantidad: 3, nombre: 'MTNTF0036' }]); // sin los 9 ceros
  ok('reiniciar no vuelve a migrar ni pierde nada (el stock de mallas sigue: 3 de 600019608)');

  // historial de papel en el formato anterior (un arreglo JSON que se reescribía entero
  // en cada movimiento) -> una línea por evento, sin perder nada; los contadores del día siguen
  const dir2 = prepararCopia('datos-historial'); limpiar(()=>borrarCopia(dir2));
  const papel2 = path.join(dir2, 'server', 'datos', 'papel'); fs.mkdirSync(papel2, { recursive: true });
  const ahora = new Date().toISOString();
  fs.writeFileSync(path.join(papel2, 'rack.json'), JSON.stringify([{ Ordem_Serial: 'H2', ubicacion: 'A1' }]));
  fs.writeFileSync(path.join(papel2, 'historial.json'), JSON.stringify([
    { area: 'papel', Ordem_Serial: 'H1', ubicacion: 'A2', evento: 'entrada', fecha: '2026-01-05T10:00:00Z' },
    { area: 'papel', Ordem_Serial: 'H1', ubicacion: 'A2', evento: 'salida', orden: { Ordem_Serial: 'H1', ClaveModelo: 'M1' }, fecha: '2026-01-06T10:00:00Z' },
    { area: 'papel', Ordem_Serial: 'H2', ubicacion: 'A1', evento: 'entrada', fecha: ahora }], null, 2));
  const p2 = await arrancarPuente(dir2, 5102); limpiar(()=>p2.cerrar());
  const datos2 = path.join(dir2, 'server', 'datos');
  const lineas = () => fs.readFileSync(path.join(papel2, 'historial.jsonl'), 'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
  assert.deepStrictEqual(lineas().map(h=>h.Ordem_Serial + ':' + h.evento), ['H1:entrada', 'H1:salida', 'H2:entrada']);
  assert.ok(!fs.existsSync(path.join(papel2, 'historial.json')) && fs.existsSync(path.join(datos2, '_anteriores', 'papel-historial.json')));
  const t2 = await login(p2.url, 'Hfrodriguez', 'admin123');
  const resumen = async () => (await api(p2.url, 'GET', '/api/rack-resumen-dia', { token: t2, area: 'papel' })).d;
  assert.deepStrictEqual(await resumen(), { cortadasHoy: 1, sacadasHoy: 0, enRackAhora: 1 });
  assert.strictEqual((await api(p2.url, 'POST', '/api/rack-simulado/H2/salida', { token: t2, area: 'papel' })).s, 200);
  assert.strictEqual((await api(p2.url, 'POST', '/api/rack-simulado/agregar', { token: t2, area: 'papel', cuerpo: { Ordem_Serial: 'H3' } })).s, 200);
  assert.deepStrictEqual(await resumen(), { cortadasHoy: 2, sacadasHoy: 1, enRackAhora: 1 });
  assert.strictEqual(lineas().length, 5, 'cada movimiento agrega UNA línea');
  const us = (await api(p2.url, 'GET', '/api/rack-simulado/H1/ultima-salida', { token: t2, area: 'papel' })).d;
  assert.ok(us.encontrada && us.ubicacion==='A2' && us.orden.ClaveModelo==='M1', JSON.stringify(us));
  await p2.reiniciar();
  assert.ok(!p2.log().includes('historial.json ('), 'la conversión se hace una sola vez');
  assert.deepStrictEqual(await (async()=>(await api(p2.url, 'GET', '/api/rack-resumen-dia', { token: await login(p2.url, 'Hfrodriguez', 'admin123'), area: 'papel' })).d)(), { cortadasHoy: 2, sacadasHoy: 1, enRackAhora: 1 });
  ok('historial de papel: el arreglo viejo pasa a una línea por evento (original en _anteriores/); cada movimiento agrega una línea; resumen del día y reentrada siguen bien, también tras reiniciar');
});
