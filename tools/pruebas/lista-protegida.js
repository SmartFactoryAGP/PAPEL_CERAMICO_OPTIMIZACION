// La Lista de corte protege al SQL: muchas personas tocando "Actualizar"
// (o 30 PCs abiertas) generan UNA consulta por período; solo el
// administrador fuerza; si SQL se cae, se sigue viendo la última lista y no
// se lo martilla con reintentos. Con el SQL simulado, que cuenta las consultas.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { ok, sleep, prepararCopia, borrarCopia, arrancarPuente, api, login, oyente, prueba } = require('./comun');

prueba('Lista de corte: una consulta a SQL por período, aunque la pidan mil veces', async limpiar=>{
  const dir = prepararCopia('lista-protegida'); limpiar(()=>borrarCopia(dir));
  fs.mkdirSync(path.join(dir, 'server', 'node_modules', 'mssql'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'sql-falso.js'), path.join(dir, 'server', 'node_modules', 'mssql', 'index.js'));
  const datosSql = path.join(dir, 'sql-falso.json'), conteo = path.join(dir, 'conteo.json');
  const escribir = extra => fs.writeFileSync(datosSql, JSON.stringify(Object.assign({
    saga: [{ Ordem_Serial: '1', Operation: '0132', ARCHIVO: 'a.dxf' }, { Ordem_Serial: '2', Operation: '0132', ARCHIVO: 'b.dxf' }],
    calendario: [{ orden: '1', puesto: '01CORTE', zfer: 'Z9', planCurve: 'CURVE', nivel: '05' }, { orden: '2', puesto: '01CORTE', zfer: 'Z8', planCurve: 'CURVE', nivel: '03' }],
  }, extra)));
  const consultas = () => { try { return JSON.parse(fs.readFileSync(conteo, 'utf8')).lista; } catch(e){ return 0; } };
  escribir({});
  // período cortito para la prueba (en producción: 60 min)
  const p = await arrancarPuente(dir, 5110, { DB_SERVER: 'falso', CAL_DB_SERVER: 'falso', FAKE_SQL_DATOS: datosSql, FAKE_SQL_CONTEO: conteo, LISTA_ACTUALIZAR_MIN: '0.05', LISTA_FORZAR_CADA_S: '1.5' });
  limpiar(()=>p.cerrar());
  const adm = await login(p.url, 'Hfrodriguez', 'admin123');
  const ana = await login(p.url, 'Ana', 'ana123'); // operaria (no administradora)
  const lista = (token, forzar) => api(p.url, 'GET', '/api/ordenes-pendientes' + (forzar ? '?forzar=1' : ''), { token, area: 'papel' });

  // 30 personas tocando "Actualizar" 20 veces cada una, todo a la vez
  const t0 = Date.now();
  const lluvia = await Promise.all(Array.from({ length: 600 }, (_, i)=>lista(i%2 ? ana : adm)));
  assert.ok(lluvia.every(r=>r.s===200 && r.d.ordenes.length===1));
  assert.strictEqual(consultas(), 1, `llegaron ${consultas()} consultas a SQL`);
  const v = lluvia[0].d;
  assert.ok(v.actualizado && v.proxima && Date.parse(v.proxima) > Date.parse(v.actualizado));
  ok(`600 pedidos a la vez (${Date.now()-t0} ms): 1 sola consulta a SQL; todos reciben la misma lista con su hora y la próxima`);

  // una operaria NO puede forzar; el administrador sí (y no dos veces seguidas)
  const r1 = await lista(ana, true);
  assert.strictEqual(r1.d.puedeForzar, false); assert.strictEqual(consultas(), 1, 'la operaria logró forzar SQL');
  await sleep(100);
  const sa = oyente(p.url, ana); limpiar(()=>sa.cerrar()); await sleep(200);
  // el forzado mira el último INTENTO: el de arriba fue hace muy poco, así que se ignora
  assert.strictEqual((await lista(adm, true)).d.puedeForzar, true); assert.strictEqual(consultas(), 1, 'forzó dos veces seguidas');
  await sleep(1600);
  const forzada = await lista(adm, true);
  assert.strictEqual(consultas(), 2, 'el administrador no pudo forzar');
  assert.ok(Date.parse(forzada.d.actualizado) > Date.parse(v.actualizado));
  assert.strictEqual((await lista(ana, true)).d.actualizado, forzada.d.actualizado, 'la operaria tiene que ver la lista que forzó el administrador');
  ok('?forzar=1 de una operaria se ignora; el del administrador consulta SQL ya (no dos veces seguidas) y todos ven esa lista');
  await sleep(200); sa.eventos.length = 0;

  // vence el período: la próxima vez se renueva sola, UNA vez, y se avisa en vivo
  await sleep(3200);
  await Promise.all(Array.from({ length: 50 }, ()=>lista(ana)));
  assert.strictEqual(consultas(), 3);
  await sleep(200);
  assert.ok(sa.eventos.some(e=>e.tipo==='lista' && e.area==='papel'), 'no se avisó en vivo que la lista se renovó');
  ok('vencido el período: 50 pedidos -> 1 consulta, y aviso en vivo "lista" para que las PCs la relean (sin SQL)');

  // SQL se cae: se sigue viendo la última lista, avisando; y no se reintenta en cada pedido
  escribir({ fallar: true });
  await sleep(3200);
  const caido = await lista(ana);
  assert.strictEqual(caido.s, 200); assert.strictEqual(caido.d.ordenes.length, 1); assert.ok(/última lista buena/.test(caido.d.aviso));
  const intentos = consultas();
  for(let i=0; i<30; i++) await lista(ana);
  await sleep(3200); for(let i=0; i<10; i++) await lista(ana); // aunque vuelva a vencer: espera 2 min entre reintentos
  assert.strictEqual(consultas(), intentos, 'con SQL caído se lo siguió martillando');
  ok('SQL caído: se sigue mostrando la última lista con un aviso, y no se reintenta en cada pedido (1 intento cada 2 min)');

  // el administrador puede forzar igual (pasados 30 s del último intento no hace falta esperar en la prueba: se reinicia)
  escribir({});
  await p.reiniciar();
  const adm2 = await login(p.url, 'Hfrodriguez', 'admin123');
  const n0 = consultas();
  await lista(adm2); assert.strictEqual(consultas(), n0 + 1);
  ok('SQL de vuelta: la lista se recupera');

  // aprobar un ZFER cambia la lista YA, sin volver a consultar SQL entera
  await api(p.url, 'POST', '/api/aprobaciones/solicitar', { token: await login(p.url, 'Ana', 'ana123'), area: 'papel', cuerpo: { zfer: 'Z8' } });
  const antes = (await lista(adm2)).d;
  await api(p.url, 'POST', '/api/aprobaciones/Z8/resolver', { token: adm2, area: 'papel', cuerpo: { decision: 'aprobar' } });
  const despues = (await lista(adm2)).d;
  assert.deepStrictEqual(despues.ordenes.map(o=>o.Ordem_Serial).sort(), ['1', '2']);
  assert.notStrictEqual(despues.version, antes.version);
  assert.strictEqual(consultas(), n0 + 1, 'aprobar volvió a consultar la lista entera');
  ok('aprobar el ZFER Z8 suma su orden a la lista al instante, con versión nueva y SIN otra consulta grande a SQL');

  // ingreso rápido: tope por persona
  let frenado = 0;
  for(let i=0; i<45; i++){ const r = await api(p.url, 'GET', '/api/ordenes-pendientes/' + (1000+i), { token: adm2, area: 'papel' }); if(r.s===429) frenado++; }
  assert.strictEqual(frenado, 5);
  ok('ingreso rápido: más de 40 búsquedas por minuto de una misma persona se frenan (429)');
});
