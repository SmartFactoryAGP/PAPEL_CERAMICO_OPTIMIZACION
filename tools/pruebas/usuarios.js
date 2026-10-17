// Usuarios y permisos: lo que el puente deja y no deja hacer a cada uno.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { ok, prepararCopia, borrarCopia, arrancarPuente, api, login, prueba } = require('./comun');

prueba('Usuarios y permisos', async limpiar=>{
  const dir = prepararCopia('usuarios'); limpiar(()=>borrarCopia(dir));
  const p = await arrancarPuente(dir, 5102); limpiar(()=>p.cerrar());
  const guardado = fs.readFileSync(path.join(dir, 'server', 'datos', 'usuarios.json'), 'utf8');
  assert.ok(JSON.parse(guardado).find(u=>u.usuario==='Hfrodriguez').admin && !guardado.includes('admin123'));
  ok('primer arranque: Hfrodriguez administrador, contraseñas guardadas solo como hash');

  assert.strictEqual((await api(p.url, 'GET', '/api/rack-simulado')).s, 401);
  assert.strictEqual((await api(p.url, 'GET', '/api/inventario', { area: 'tecoflex' })).s, 401);
  ok('sin sesión no se ve nada (401)');

  const adm = await login(p.url, 'hfrodriguez', 'admin123'); // mayúsculas no importan
  assert.strictEqual((await api(p.url, 'POST', '/api/usuarios', { token: adm, cuerpo: { usuario: 'op1', clave: '123' } })).s, 400);
  const op = await api(p.url, 'POST', '/api/usuarios', { token: adm, cuerpo: { usuario: 'op1', clave: 'clave1', permisos: { tecoflex: ['rack'], papel: ['inventada'] } } });
  assert.strictEqual(op.s, 200); assert.deepStrictEqual(op.d.permisos, { tecoflex: ['rack'] });
  assert.strictEqual((await api(p.url, 'POST', '/api/usuarios', { token: adm, cuerpo: { usuario: 'OP1', clave: 'xxxxxx' } })).s, 409);
  ok('crear: clave corta rechazada, vista inexistente filtrada, nombre repetido 409');

  const t1 = await login(p.url, 'op1', 'clave1');
  assert.strictEqual((await api(p.url, 'GET', '/api/inventario', { token: t1, area: 'tecoflex' })).s, 200);
  assert.strictEqual((await api(p.url, 'POST', '/api/inventario/movimientos', { token: t1, area: 'tecoflex', cuerpo: { items: [{ tipo: 'entrada', material: '100005343', medida: '20', cantidad: 5 }] } })).s, 200);
  for(const [ruta, area] of [['/api/rack-simulado', 'papel'], ['/api/ordenes-pendientes', 'tecoflex'], ['/api/usuarios', null]])
    assert.strictEqual((await api(p.url, 'GET', ruta, { token: t1, area })).s, 403, ruta);
  ok('op1 (solo Tecoflex/Rack): mueve inventario; papel, Lista de corte y administración 403');

  await api(p.url, 'PUT', '/api/usuarios/op1', { token: adm, cuerpo: { permisos: {} } });
  assert.strictEqual((await api(p.url, 'GET', '/api/inventario', { token: t1, area: 'tecoflex' })).s, 403);
  await api(p.url, 'PUT', '/api/usuarios/op1', { token: adm, cuerpo: { activo: false } });
  assert.strictEqual((await api(p.url, 'GET', '/api/inventario', { token: t1, area: 'tecoflex' })).s, 401);
  assert.strictEqual((await api(p.url, 'POST', '/api/login', { cuerpo: { usuario: 'op1', clave: 'clave1' } })).s, 401);
  ok('quitar permisos rige al instante; desactivar cierra la sesión y bloquea el ingreso');

  assert.strictEqual((await api(p.url, 'PUT', '/api/usuarios/hfrodriguez', { token: adm, cuerpo: { admin: false } })).s, 400);
  assert.strictEqual((await api(p.url, 'DELETE', '/api/usuarios/hfrodriguez', { token: adm })).s, 400);
  ok('el administrador no puede quitarse el rol ni borrarse');

  for(let i=0; i<8; i++) await api(p.url, 'POST', '/api/login', { cuerpo: { usuario: 'Ana', clave: 'mala' } });
  assert.strictEqual((await api(p.url, 'POST', '/api/login', { cuerpo: { usuario: 'Ana', clave: 'ana123' } })).s, 429);
  ok('8 intentos fallidos -> el ingreso se frena (429)');
});
