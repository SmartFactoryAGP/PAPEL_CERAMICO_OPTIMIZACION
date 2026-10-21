// Consumo histórico de Tecoflex por material y medida: lo que SALIÓ en un período,
// armado desde el diario completo (que ya tiene días de movimientos) y sumado en cada
// movimiento nuevo. Con permisos, períodos y reinicio.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { ok, prepararCopia, borrarCopia, arrancarPuente, api, login, prueba } = require('./comun');
const X5 = '100004045', LISO = '100003239', PU = '100005343';

/* 'AAAA-MM-DD' de hoy menos N días (hora local, como lo cuenta el puente) */
const dia = n => { const d = new Date(); d.setDate(d.getDate() - n); const p = x=>String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; };
/* un movimiento guardado a las 12:00 de ese día */
const mov = (n, items) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(12, 0, 0, 0);
  return JSON.stringify({ id: 'm' + n + Math.random().toString(16).slice(2, 6), idCliente: null, fecha: d.toISOString(), usuario: 'Ana', nota: null, items: items.map(([tipo, material, medida, cantidad])=>({ tipo, material, materialNombre: material, codigo: material, medida, cantidad })) }); };

prueba('Consumo de Tecoflex por material y medida', async limpiar=>{
  const dir = prepararCopia('consumo'); limpiar(()=>borrarCopia(dir));
  const teco = path.join(dir, 'server', 'datos', 'tecoflex'); fs.mkdirSync(teco, { recursive: true });
  fs.writeFileSync(path.join(teco, 'movimientos.jsonl'), [
    mov(40, [['entrada', LISO, '9', 100], ['entrada', PU, '20', 50], ['entrada', X5, '12', 30]]),
    mov(40, [['salida', LISO, '9', 10]]),
    mov(10, [['salida', LISO, '9', 15], ['salida', PU, '20', 5], ['entrada', LISO, '9', 40]]),
    mov(1,  [['salida', LISO, '9', 8], ['salida', X5, '12', 4]]),
    mov(0,  [['salida', PU, '20', 6]]),
  ].join('\n') + '\n');
  const p = await arrancarPuente(dir, 5122); limpiar(()=>p.cerrar());
  const t = await login(p.url, 'Ana', 'ana123');
  const consumo = (q, token, area) => api(p.url, 'GET', '/api/inventario/consumo' + (q ? '?' + q : ''), { token: token || t, area: area || 'tecoflex' });
  const de = (r, material, medida) => r.d.filas.find(x=>x.material===material && x.medida===medida) || { sale: 0, entra: 0 };

  // ---------- todo el historial ----------
  const todo = await consumo();
  assert.strictEqual(todo.s, 200, JSON.stringify(todo.d));
  assert.strictEqual(todo.d.primerDia, dia(40));
  assert.deepStrictEqual([de(todo, LISO, '9').sale, de(todo, LISO, '9').entra], [10 + 15 + 8, 100 + 40]);
  assert.deepStrictEqual([de(todo, PU, '20').sale, de(todo, PU, '20').entra], [5 + 6, 50]);
  assert.deepStrictEqual([de(todo, X5, '12').sale, de(todo, X5, '12').entra], [4, 30]);
  assert.deepStrictEqual(todo.d.totales, { sale: 10 + 15 + 8 + 5 + 6 + 4, entra: 100 + 50 + 30 + 40 });
  assert.deepStrictEqual(todo.d.porDia.map(x=>x.dia), [dia(40), dia(10), dia(1), dia(0)], 'un renglón por día con movimientos, en orden');
  assert.deepStrictEqual(todo.d.porDia.map(x=>x.sale), [10, 20, 12, 6]);
  assert.strictEqual(todo.d.filas.length, 3, 'solo combinaciones con movimientos');
  ok('desde el diario de 5 movimientos en 4 días: lo que salió y entró por material y medida, y el total de cada día');

  // ---------- períodos ----------
  const ult30 = await consumo(`desde=${dia(30)}&hasta=${dia(0)}`);
  assert.deepStrictEqual([de(ult30, LISO, '9').sale, de(ult30, PU, '20').sale], [15 + 8, 11], 'lo de hace 40 días queda afuera');
  assert.strictEqual(ult30.d.primerDia, dia(40), 'primerDia es de todo el historial, no del período');
  const ayer = await consumo(`desde=${dia(1)}&hasta=${dia(1)}`);
  assert.deepStrictEqual(ayer.d.filas.map(x=>x.material + '|' + x.medida + '|' + x.sale).sort(), [`${LISO}|9|8`, `${X5}|12|4`].sort());
  const hoy = await consumo(`desde=${dia(0)}`);
  assert.deepStrictEqual(hoy.d.filas, [{ material: PU, medida: '20', sale: 6, entra: 0 }]);
  assert.strictEqual((await consumo(`desde=${dia(-5)}`)).d.filas.length, 0, 'un período sin movimientos = nada');
  assert.strictEqual((await consumo('desde=ayer&hasta=basura')).d.totales.sale, todo.d.totales.sale, 'fechas que no son AAAA-MM-DD se ignoran');
  ok('períodos: últimos 30 días, solo ayer, solo hoy, uno vacío; una fecha rara se ignora');

  // ---------- movimientos nuevos suman ----------
  const reg = await api(p.url, 'POST', '/api/inventario/movimientos', { token: t, area: 'tecoflex', cuerpo: { items: [{ tipo: 'salida', material: LISO, medida: '9', cantidad: 20 }, { tipo: 'salida', material: PU, medida: '20', cantidad: 3 }] } });
  assert.strictEqual(reg.s, 200, JSON.stringify(reg.d));
  const hoy2 = await consumo(`desde=${dia(0)}`);
  assert.deepStrictEqual(hoy2.d.filas.map(x=>x.material + '|' + x.medida + '|' + x.sale).sort(), [`${LISO}|9|20`, `${PU}|20|9`].sort());
  assert.strictEqual(hoy2.d.porDia.length, 1); assert.strictEqual(hoy2.d.porDia[0].sale, 29);
  assert.strictEqual(hoy2.d.version, reg.d.version, 'lleva la versión del inventario');
  // una salida que no se pudo registrar (sin stock) no cuenta como consumo
  const mal = await api(p.url, 'POST', '/api/inventario/movimientos', { token: t, area: 'tecoflex', cuerpo: { items: [{ tipo: 'salida', material: X5, medida: '12', cantidad: 9999 }] } });
  assert.strictEqual(mal.s, 409);
  assert.strictEqual((await consumo(`desde=${dia(0)}`)).d.totales.sale, 29);
  ok('cada movimiento nuevo suma al día de hoy; un lote rechazado por falta de stock no cuenta');

  // ---------- reinicio: sale del diario, igual ----------
  await p.reiniciar();
  const t2 = await login(p.url, 'Ana', 'ana123');
  const igual = await consumo('', t2);
  assert.deepStrictEqual(igual.d.totales, { sale: 48 + 20 + 3, entra: 220 });
  assert.deepStrictEqual(de(igual, LISO, '9').sale, 10 + 15 + 8 + 20);
  ok('después de reiniciar el puente el consumo es el mismo (se rearma del diario)');

  // ---------- permisos y áreas ----------
  await api(p.url, 'POST', '/api/usuarios', { token: await login(p.url, 'Hfrodriguez', 'admin123'), cuerpo: { usuario: 'Solo Lista', clave: 'lista1', permisos: { tecoflex: ['ordenes'] } } });
  assert.strictEqual((await consumo('', await login(p.url, 'Solo Lista', 'lista1'))).s, 403, 'sin permiso de Rack no se ve el consumo');
  assert.strictEqual((await api(p.url, 'GET', '/api/inventario/consumo', { area: 'tecoflex' })).s, 401, 'sin sesión');
  assert.strictEqual((await consumo('', t2, 'papel')).s, 400, 'papel no maneja inventario por material y medida');
  ok('el consumo pide permiso de Rack del área; sin sesión o en un área sin inventario, se rechaza');
});
