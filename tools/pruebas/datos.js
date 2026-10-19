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
  assert.deepStrictEqual(leer('papel/rack.json').map(o=>o.Ordem_Serial), ['P1']);
  assert.deepStrictEqual(leer('mallas/rack.json').map(o=>o.Ordem_Serial), ['M1']);
  assert.deepStrictEqual(leer('papel/historial.json').map(h=>h.Ordem_Serial), ['P0', 'P1']);
  assert.deepStrictEqual(leer('mallas/historial.json').map(h=>h.Ordem_Serial), ['M1']);
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
  assert.strictEqual(leer('papel/historial.json').length, 2);
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
});
