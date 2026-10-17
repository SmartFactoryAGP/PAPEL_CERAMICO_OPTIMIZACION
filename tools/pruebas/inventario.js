// Inventario de Tecoflex: validaciones, lotes todo-o-nada, idempotencia,
// carga de 30 operarios con 35 pestañas en vivo, reinicio y apagón.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { ok, RAIZ, prepararCopia, borrarCopia, arrancarPuente, api, login, oyente, sleep, prueba } = require('./comun');
const MATS = require(path.join(RAIZ, 'js', 'core', 'areas-config.js')).areas.tecoflex.materiales;
const X5 = '100004045', PU = '100005343';

prueba('Inventario Tecoflex: reglas y carga', async limpiar=>{
  const dir = prepararCopia('inventario'); limpiar(()=>borrarCopia(dir));
  const p = await arrancarPuente(dir, 5103); limpiar(()=>p.cerrar());
  const t = await login(p.url, 'Ana', 'ana123');
  const mov = (items, extra) => api(p.url, 'POST', '/api/inventario/movimientos', { token: t, area: 'tecoflex', cuerpo: Object.assign({ items }, extra||{}) });
  const stock = async () => (await api(p.url, 'GET', '/api/inventario', { token: t, area: 'tecoflex' })).d;
  const de = (s, m, d) => (s.find(x=>x.material===m && x.medida===d)||{}).cantidad || 0;

  // ---------- reglas ----------
  let r = await mov(MATS.map(m=>({ tipo: 'entrada', material: m.id, medida: m.medidas[0], cantidad: 500 })).concat([{ tipo: 'entrada', material: X5, medida: '6.5', cantidad: 7 }]));
  assert.strictEqual(r.s, 200); assert.strictEqual(r.d.movimiento.usuario, 'Ana');
  r = await mov([{ tipo: 'salida', material: X5, medida: '9', cantidad: 1 }, { tipo: 'salida', material: PU, medida: '6,5', cantidad: 1 },
                 { tipo: 'salida', material: 'vidrio', medida: '20', cantidad: 1 }, { tipo: 'salida', material: PU, medida: '9', cantidad: 1.5 }]);
  assert.strictEqual(r.s, 400); assert.strictEqual(r.d.detalles.length, 4);
  ok('medidas del X5 y de los demás validadas; material inventado y cantidad decimal rechazados');
  const antes = await stock();
  r = await mov([{ tipo: 'salida', material: X5, medida: '6,5', cantidad: 3 }, { tipo: 'salida', material: PU, medida: '9', cantidad: 9999 }]);
  assert.strictEqual(r.s, 409); assert.deepStrictEqual((await stock()).stock, antes.stock);
  ok('lote con una línea sin stock: se rechaza ENTERO, el stock no cambia');
  const lote = { idCliente: 'carrito-1' }, previo = de(antes.stock, X5, '6,5');
  const tres = await Promise.all([1,2,3].map(()=>mov([{ tipo: 'salida', material: X5, medida: '6,5', cantidad: 2 }], lote)));
  assert.strictEqual(tres.filter(x=>x.d.repetido).length, 2); assert.strictEqual(de((await stock()).stock, X5, '6,5'), previo - 2);
  ok('el mismo carrito enviado 3 veces se registra 1 sola vez');

  // ---------- carga: 30 operarios + 35 pestañas en vivo ----------
  const oyentes = Array.from({ length: 35 }, ()=>oyente(p.url, t)); limpiar(()=>oyentes.forEach(o=>o.cerrar()));
  await sleep(500); assert.ok(oyentes.every(o=>o.abierto), 'no se abrieron todas las conexiones en vivo');
  const vInicio = (await stock()).version, lat = []; let registrados = 0, sinStock = 0;
  const azar = n => Math.floor(Math.random()*n);
  await Promise.all(Array.from({ length: 30 }, async ()=>{
    const tok = await login(p.url, 'Beto', 'beto123');
    for(let k=0; k<20; k++){
      const items = Array.from({ length: 1+azar(4) }, ()=>{ const m = MATS[azar(MATS.length)]; return { tipo: Math.random()<0.55 ? 'salida' : 'entrada', material: m.id, medida: m.medidas[azar(3)], cantidad: 1+azar(40) }; });
      const x = await api(p.url, 'POST', '/api/inventario/movimientos', { token: tok, area: 'tecoflex', cuerpo: { items, idCliente: 'c'+Math.random() } });
      lat.push(x.ms); if(x.s===200) registrados++; else if(x.s===409) sinStock++; else throw new Error('respuesta inesperada ' + x.s);
    }
  }));
  lat.sort((a,b)=>a-b);
  ok(`600 lotes de 30 operarios: ${registrados} registrados, ${sinStock} sin stock; p50 ${lat[300]} ms, p95 ${lat[570]} ms`);
  await sleep(500);
  const final = await stock();
  assert.ok(final.stock.every(s=>s.cantidad > 0), 'quedó stock negativo');
  const esperado = Array.from({ length: final.version - vInicio }, (_, i)=>vInicio+1+i);
  oyentes.forEach((o, i)=>assert.deepStrictEqual(o.eventos.filter(e=>e.tipo==='inventario').map(e=>e.version), esperado, `pestaña ${i}`));
  ok(`las 35 pestañas recibieron los ${esperado.length} avisos en orden; ningún stock negativo`);

  // ---------- reinicio y apagón ----------
  const firma = s => JSON.stringify(s.slice().sort((a,b)=>(a.material+a.medida).localeCompare(b.material+b.medida)));
  await p.reiniciar();
  const t2 = await login(p.url, 'Ana', 'ana123');
  let tras = (await api(p.url, 'GET', '/api/inventario', { token: t2, area: 'tecoflex' })).d;
  assert.strictEqual(tras.version, final.version); assert.strictEqual(firma(tras.stock), firma(final.stock));
  fs.appendFileSync(path.join(dir, 'server', 'datos', 'tecoflex', 'movimientos.jsonl'), '{"id":"cortado","items":[{"tip');
  await p.reiniciar();
  const t3 = await login(p.url, 'Ana', 'ana123');
  assert.strictEqual((await api(p.url, 'POST', '/api/inventario/movimientos', { token: t3, area: 'tecoflex', cuerpo: { items: [{ tipo: 'entrada', material: PU, medida: '30', cantidad: 1 }] } })).s, 200);
  await p.reiniciar();
  tras = (await api(p.url, 'GET', '/api/inventario', { token: await login(p.url, 'Ana', 'ana123'), area: 'tecoflex' })).d;
  assert.strictEqual(tras.version, final.version + 1);
  ok('reinicio: mismo stock exacto; apagón a mitad de escritura: no se pierde el movimiento siguiente');
});
