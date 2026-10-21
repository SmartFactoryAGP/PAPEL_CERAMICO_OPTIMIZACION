// El administrador borra registros de los historiales (Tecoflex / Mallas / Tejidos): el stock y el consumo se
// rehacen del diario que queda, no se deja dejar el stock en negativo, solo el admin puede, y lo borrado
// queda guardado aparte.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { ok, prepararCopia, borrarCopia, arrancarPuente, api, login, prueba } = require('./comun');
const LISO = '100003239', PU = '100005343';

prueba('Historiales: el administrador elimina registros', async limpiar=>{
  const dir = prepararCopia('historial-admin'); limpiar(()=>borrarCopia(dir));
  const tej = path.join(dir, 'server', 'datos', 'tejidos'); fs.mkdirSync(tej, { recursive: true });
  fs.writeFileSync(path.join(tej, 'posiciones.json'), JSON.stringify([{ pos: 'A1.1', tamano: 'P' }, { pos: 'A1.2', tamano: 'P' }]));
  fs.writeFileSync(path.join(tej, 'tamanos.json'), JSON.stringify({ '600039736': { tamano: 'P', nombre: 'PUTE0062' } }));
  const p = await arrancarPuente(dir, 5133); limpiar(()=>p.cerrar());
  const adm = await login(p.url, 'Hfrodriguez', 'admin123'), ana = await login(p.url, 'Ana', 'ana123');
  const mov = (items, token) => api(p.url, 'POST', '/api/inventario/movimientos', { token: token || adm, area: 'tecoflex', cuerpo: { idCliente: Math.random().toString(16).slice(2), items } });
  const estado = () => api(p.url, 'GET', '/api/inventario', { token: adm, area: 'tecoflex' });
  const eliminar = (ids, token, area) => api(p.url, 'POST', '/api/inventario/movimientos/eliminar', { token: token === undefined ? adm : token, area: area || 'tecoflex', cuerpo: { ids } });
  const cuanto = (r, m, d) => ((r.d.stock.find(x=>x.material===m && x.medida===d) || {}).cantidad) || 0;

  const e1 = (await mov([{ tipo: 'entrada', material: LISO, medida: '9', cantidad: 100 }])).d.movimiento;
  const s1 = (await mov([{ tipo: 'salida', material: LISO, medida: '9', cantidad: 30 }])).d.movimiento;
  const e2 = (await mov([{ tipo: 'entrada', material: PU, medida: '20', cantidad: 50 }])).d.movimiento;
  assert.strictEqual(cuanto(await estado(), LISO, '9'), 70);

  // solo el administrador
  assert.strictEqual((await eliminar([s1.id], ana)).s, 403, 'una operaria no puede borrar');
  assert.strictEqual((await eliminar([s1.id], null)).s, 401);
  assert.strictEqual(cuanto(await estado(), LISO, '9'), 70);
  ok('una operaria (o sin sesión) no puede eliminar movimientos');

  // borrar una salida de prueba: el stock y el consumo la olvidan
  const antes = (await estado()).d.version;
  const r = await eliminar([s1.id]);
  assert.strictEqual(r.s, 200, JSON.stringify(r.d)); assert.strictEqual(r.d.eliminados, 1);
  const despues = await estado();
  assert.strictEqual(cuanto(despues, LISO, '9'), 100, 'sin la salida, el stock vuelve a 100');
  assert.ok(despues.d.version > antes, 'la versión sigue subiendo (ninguna pantalla se queda con una vieja)');
  assert.ok(!despues.d.movimientos.some(m=>m.id===s1.id));
  const cons = await api(p.url, 'GET', '/api/inventario/consumo', { token: adm, area: 'tecoflex' });
  assert.strictEqual(cons.d.totales.sale, 0, 'el consumo ya no cuenta la salida borrada'); assert.strictEqual(cons.d.totales.entra, 150);
  ok('eliminar una salida: el stock vuelve a 100, el consumo baja a 0 y la versión sigue subiendo');

  // no se puede borrar una entrada cuyas unidades ya salieron
  const s2 = (await mov([{ tipo: 'salida', material: LISO, medida: '9', cantidad: 60 }])).d.movimiento;
  const mal = await eliminar([e1.id]);
  assert.strictEqual(mal.s, 409, JSON.stringify(mal.d)); assert.ok(/borralas también/.test(mal.d.error), mal.d.error);
  assert.strictEqual(cuanto(await estado(), LISO, '9'), 40, 'no se tocó nada');
  // las dos juntas sí
  const ambas = await eliminar([e1.id, s2.id]);
  assert.strictEqual(ambas.s, 200, JSON.stringify(ambas.d)); assert.strictEqual(ambas.d.eliminados, 2);
  assert.strictEqual(cuanto(await estado(), LISO, '9'), 0);
  assert.strictEqual(cuanto(await estado(), PU, '20'), 50, 'lo demás queda igual');
  ok('una entrada cuyas unidades ya salieron no se borra sola (409 con el motivo); entrada y salida juntas sí');

  // ids que no existen, vacío, otra área sin inventario
  assert.strictEqual((await eliminar(['nadie'])).s, 404);
  assert.strictEqual((await eliminar([])).s, 400);
  assert.strictEqual((await eliminar([e2.id], null, 'papel')).s, 401);
  assert.strictEqual((await eliminar([e2.id], adm, 'papel')).s, 400, 'papel no maneja inventario');
  ok('un movimiento que no existe (404), una lista vacía (400) y un área sin inventario se rechazan');

  // queda copia de lo borrado, y sobrevive a reiniciar
  const copia = fs.readFileSync(path.join(dir, 'server', 'datos', 'tecoflex', 'eliminados.jsonl'), 'utf8').trim().split('\n').map(l=>JSON.parse(l));
  assert.deepStrictEqual(copia.map(c=>c.movimiento.id).sort(), [s1.id, e1.id, s2.id].sort());
  assert.ok(copia.every(c=>c.eliminadoPor === 'Hfrodriguez' && c.eliminadoEn));
  await p.reiniciar();
  const adm2 = await login(p.url, 'Hfrodriguez', 'admin123');
  const tras = await api(p.url, 'GET', '/api/inventario', { token: adm2, area: 'tecoflex' });
  assert.deepStrictEqual(tras.d.stock.map(x=>x.material + '|' + x.medida + '|' + x.cantidad), [`${PU}|20|50`]);
  ok('lo borrado queda guardado en eliminados.jsonl (quién y cuándo) y, al reiniciar, el stock sale igual del diario');

  // ---------- Tejidos ----------
  const tjp = (m, ruta, cuerpo, token) => api(p.url, m, '/api/tejidos' + ruta, { token: token || adm2, area: 'tejidos', cuerpo });
  const JPG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(300, 7)]);
  const subida = await fetch(p.url + '/api/tejidos/fotos', { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'x-area': 'tejidos', 'x-auth-token': adm2 }, body: JPG }).then(r=>r.json()).catch(()=>({}));
  const nombreFoto = subida.foto;
  assert.ok(nombreFoto, 'no se pudo subir la foto de prueba: ' + JSON.stringify(subida));
  const en = await tjp('POST', '/entrada', { codmat: '600039736', responsables: 'Juan', resistencia1: '10', foto: nombreFoto });
  assert.strictEqual(en.s, 200, JSON.stringify(en.d));
  await tjp('POST', '/salida', { posicion: 'A1.1' });
  const h = (await tjp('GET', '/historial?evento=movimientos')).d;
  assert.strictEqual(h.eventos.length, 2); assert.ok(h.eventos.every(e=>/^[0-9a-f]{12}$/.test(e.id)), 'cada evento trae su id');
  assert.strictEqual((await tjp('POST', '/historial/eliminar', { ids: [h.eventos[0].id] }, await login(p.url, 'Ana', 'ana123'))).s, 403, 'una operaria no puede');
  const ids = h.eventos.map(e=>e.id);
  const v0 = (await tjp('GET', '/rack')).d.version;
  const del = await tjp('POST', '/historial/eliminar', { ids: [ids[0]] });
  assert.strictEqual(del.s, 200, JSON.stringify(del.d)); assert.strictEqual(del.d.eliminados, 1);
  const h2 = (await tjp('GET', '/historial?evento=movimientos')).d;
  assert.deepStrictEqual(h2.eventos.map(e=>e.id), [ids[1]], 'queda solo el otro');
  assert.ok((await tjp('GET', '/rack')).d.version > v0);
  assert.strictEqual((await tjp('POST', '/historial/eliminar', { ids: [ids[0]] })).s, 404, 'ya no existe');
  assert.ok(fs.readFileSync(path.join(tej, 'historial-eliminado.jsonl'), 'utf8').includes('Hfrodriguez'));
  // el rack (lo que hay hoy en las posiciones) no cambia, y se puede seguir trabajando
  assert.strictEqual((await tjp('POST', '/entrada', { codmat: '600039736', responsables: 'Juan', resistencia1: '10', foto: nombreFoto })).s, 200);
  await p.reiniciar();
  const adm3 = await login(p.url, 'Hfrodriguez', 'admin123');
  const h3 = (await tjp('GET', '/historial?evento=movimientos', null, adm3)).d;
  assert.strictEqual(h3.eventos.length, 2); assert.ok(h3.eventos.some(e=>e.id === ids[1]), 'los ids son estables al reiniciar');
  ok('Tejidos: cada evento tiene id estable; solo el admin borra; lo demás sigue y queda copia de lo eliminado');
});
