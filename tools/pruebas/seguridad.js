// Seguridad: se intenta, a propósito, cada forma conocida de sacar datos
// o de saltarse un permiso. Todas tienen que fallar.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), assert = require('assert');
const { ok, sleep, prepararCopia, borrarCopia, arrancarPuente, api, login, oyente, prueba } = require('./comun');

const cabeceras = url => new Promise((res, rej)=>http.get(url, r=>{ r.resume(); res(r.headers); }).on('error', rej));

prueba('Seguridad del puente', async limpiar=>{
  const dir = prepararCopia('seguridad'); limpiar(()=>borrarCopia(dir));
  // una carpeta de "planos" FUERA de la app, como la carpeta de red real
  const planos = fs.mkdtempSync(path.join(os.tmpdir(), 'semiterminados-planos-')); limpiar(()=>borrarCopia(planos));
  fs.writeFileSync(path.join(planos, 'pieza.dxf'), '0\nSECTION\n0\nEOF\n');
  fs.mkdirSync(path.join(planos + '-otra')); limpiar(()=>borrarCopia(planos + '-otra'));
  fs.writeFileSync(path.join(planos + '-otra', 'x.dxf'), 'no');
  fs.writeFileSync(path.join(dir, 'server', '.env'), 'DB_PASSWORD=secreta\n');
  fs.writeFileSync(path.join(dir, 'server', 'trampa.dxf'), 'no');

  const p = await arrancarPuente(dir, 5106, { DXF_SOURCE: 'file', DXF_ALLOWED_PREFIXES: `${planos},${dir}` }); limpiar(()=>p.cerrar());
  const adm = await login(p.url, 'Hfrodriguez', 'admin123');
  const ana = await login(p.url, 'Ana', 'ana123'); // todos los permisos, pero no es administradora

  // ---------- /api/dxf: solo .dxf, solo dentro de las carpetas permitidas ----------
  const dxf = archivo => api(p.url, 'GET', '/api/dxf?archivo=' + encodeURIComponent(archivo), { token: ana });
  const bien = await dxf(path.join(planos, 'pieza.dxf'));
  assert.strictEqual(bien.s, 200); assert.ok(bien.d.contenido.includes('SECTION')); assert.ok(!('ruta' in bien.d));
  const intentos = {
    'el .env con las contraseñas': path.join(dir, 'server', '.env'),
    'el código del puente': path.join(dir, 'server', 'server.js'),
    'usuarios.json': path.join(dir, 'server', 'datos', 'usuarios.json'),
    'salirse con ..': planos + '\\..\\' + path.basename(planos) + '-otra\\x.dxf', // a mano: path.join borraría el ".."
    'carpeta con nombre parecido': path.join(planos + '-otra', 'x.dxf'),
    'carpeta de red de otra PC': '\\\\10.255.255.1\\compartida\\x.dxf',
    'un .dxf dentro de la app': path.join(dir, 'server', 'trampa.dxf'),
  };
  for(const [que, ruta] of Object.entries(intentos)){
    const r = await dxf(ruta);
    assert.strictEqual(r.s, 400, `${que}: ${r.s} ${JSON.stringify(r.d)}`);
  }
  assert.strictEqual((await dxf(path.join(planos, 'no-existe.dxf'))).s, 404);
  ok(`/api/dxf lee el plano permitido y rechaza ${Object.keys(intentos).length} intentos (.env, código, usuarios, "..", carpeta parecida, red ajena, la app)`);

  // ---------- en vivo: cada uno recibe solo lo de sus áreas ----------
  await api(p.url, 'POST', '/api/usuarios', { token: adm, cuerpo: { usuario: 'Solo Mallas', clave: 'mallas1', permisos: { mallas: ['rack', 'ordenes'] } } });
  await api(p.url, 'POST', '/api/usuarios', { token: adm, cuerpo: { usuario: 'Op Dos', clave: 'opdos1', permisos: { tecoflex: ['rack'] } } });
  const tMallas = await login(p.url, 'Solo Mallas', 'mallas1'), tOp = await login(p.url, 'Op Dos', 'opdos1');
  const oAdm = oyente(p.url, adm), oMallas = oyente(p.url, tMallas), oOp = oyente(p.url, tOp);
  limpiar(()=>[oAdm, oMallas, oOp].forEach(o=>o.cerrar()));
  await sleep(300); assert.ok(oAdm.abierto && oMallas.abierto && oOp.abierto);
  const mov = await api(p.url, 'POST', '/api/inventario/movimientos', { token: adm, area: 'tecoflex', cuerpo: { items: [{ tipo: 'entrada', material: '100003239', medida: '9', cantidad: 5 }] } });
  assert.strictEqual(mov.s, 200);
  await api(p.url, 'POST', '/api/inventario/movimientos', { token: adm, area: 'mallas', cuerpo: { items: [{ tipo: 'entrada', material: '600019608', cantidad: 2 }] } });
  await sleep(300);
  const tipos = o => o.eventos.map(e=>`${e.tipo}:${e.area}`).sort().join(',');
  assert.strictEqual(tipos(oAdm), 'inventario:mallas,inventario:tecoflex,lista:mallas');
  assert.strictEqual(tipos(oMallas), 'inventario:mallas,lista:mallas', 'Mallas no tiene que ver el inventario de Tecoflex');
  assert.strictEqual(tipos(oOp), 'inventario:tecoflex', 'Tecoflex no tiene que ver el rack de Mallas');
  ok('avisos en vivo filtrados por permiso: Mallas no ve el stock de Tecoflex, y al revés');

  // ---------- cerrar sesión / desactivar corta la conexión en vivo ----------
  await api(p.url, 'POST', '/api/logout', { token: tMallas });
  await api(p.url, 'PUT', '/api/usuarios/Op%20Dos', { token: adm, cuerpo: { activo: false } });
  await sleep(300);
  assert.ok(oMallas.cerrado, 'después de "Salir" la conexión en vivo seguía abierta');
  assert.ok(oOp.cerrado, 'un usuario desactivado seguía recibiendo datos en vivo');
  assert.ok(!oAdm.cerrado);
  const n = oMallas.eventos.length;
  await api(p.url, 'POST', '/api/inventario/movimientos', { token: adm, area: 'mallas', cuerpo: { items: [{ tipo: 'entrada', material: '600019608', cantidad: 2 }] } });
  await sleep(200); assert.strictEqual(oMallas.eventos.length, n);
  ok('"Salir" y "desactivar usuario" cortan al instante la conexión en vivo');

  // ---------- el rack solo guarda datos sanos ----------
  const agregar = cuerpo => api(p.url, 'POST', '/api/rack-simulado/agregar', { token: ana, area: 'papel', cuerpo });
  assert.strictEqual((await agregar({ Ordem_Serial: 'S1', Descricao: 'Vidrio', raro: { anidado: [1, 2] }, __proto__x: 1 })).s, 200);
  const enRack = (await api(p.url, 'GET', '/api/rack-simulado', { token: ana, area: 'papel' })).d.find(o=>o.Ordem_Serial==='S1');
  assert.ok(enRack && enRack.Descricao==='Vidrio' && !('raro' in enRack) && !('__proto__x' in enRack));
  assert.strictEqual((await agregar({ Ordem_Serial: 'S2', Descricao: 'x'.repeat(5000) })).s, 400);
  assert.strictEqual((await agregar({ Ordem_Serial: 'S'.repeat(100) })).s, 400);
  for(const u of ['Z1', 'A21', 'A0', 'A01', '<b>x</b>', '']){
    const r = await api(p.url, 'POST', '/api/rack-simulado/reentrada', { token: ana, area: 'papel', cuerpo: { ubicacion: u, orden: { Ordem_Serial: 'R1' } } });
    assert.strictEqual(r.s, 400, `reentrada en "${u}": ${r.s}`);
  }
  assert.strictEqual((await api(p.url, 'POST', '/api/rack-simulado/reentrada', { token: ana, area: 'papel', cuerpo: { ubicacion: 'G20', orden: { Ordem_Serial: 'R1' } } })).s, 200);
  ok('rack: campos raros descartados, textos enormes rechazados, reentrada solo en casillas que existen (A1…G20)');

  // ---------- los errores internos no se le muestran a cualquiera ----------
  // sin SQL configurado, la consulta falla con un error del driver
  const rAna = await api(p.url, 'GET', '/api/ordenes-pendientes', { token: ana, area: 'papel' });
  const rAdm = await api(p.url, 'GET', '/api/ordenes-pendientes', { token: adm, area: 'papel' });
  assert.strictEqual(rAna.s, 500); assert.strictEqual(rAdm.s, 500);
  assert.ok(/Error interno del puente/.test(rAna.d.error), rAna.d.error);
  assert.ok(!/Error interno del puente/.test(rAdm.d.error), 'el administrador tiene que ver el detalle');
  ok('error interno: el administrador ve el detalle, el resto un aviso genérico');

  // ---------- cabeceras y freno de intentos ----------
  const h = await cabeceras(p.url + '/');
  assert.strictEqual(h['x-content-type-options'], 'nosniff'); assert.strictEqual(h['x-frame-options'], 'DENY');
  assert.ok(!h['x-powered-by'] && /frame-ancestors 'none'/.test(h['content-security-policy']));
  assert.strictEqual((await cabeceras(p.url + '/api/salud'))['cache-control'], 'no-store');
  ok('cabeceras: sin "X-Powered-By", nosniff, no se puede meter en un marco, la API no se guarda en caché');

  const lluvia = await Promise.all(Array.from({ length: 25 }, ()=>api(p.url, 'POST', '/api/login', { cuerpo: { usuario: 'Beto', clave: 'mala' } })));
  const fallidos = lluvia.filter(r=>r.s===401).length, frenados = lluvia.filter(r=>r.s===429).length;
  assert.strictEqual(fallidos, 8, `pasaron ${fallidos} intentos`); assert.strictEqual(frenados, 17);
  ok('25 contraseñas probadas A LA VEZ: solo 8 llegan a verificarse, el resto frenadas (429)');
});
