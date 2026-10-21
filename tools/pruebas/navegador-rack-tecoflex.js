// Rack de Tecoflex en Chrome: las vistas (Existencias · Consumo · Movimientos y, en
// pantallas chicas, Registrar), el consumo por material y medida con las salidas como −N,
// su actualización en vivo y el Excel; y que todo entre en el celular y la tablet.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { ok, sleep, prepararCopia, borrarCopia, arrancarPuente, api, login, abrirChrome, prueba } = require('./comun');
const CAPTURAS = path.join(__dirname, 'capturas');
const LISO = '100003239', ROMBOS = '100003554', PU = '100005343';

prueba('Navegador: Rack de Tecoflex (vistas, consumo, celular y tablet)', async limpiar=>{
  fs.mkdirSync(CAPTURAS, { recursive: true });
  const dir = prepararCopia('nav-rack-teco'); limpiar(()=>borrarCopia(dir));
  const p = await arrancarPuente(dir, 5123); limpiar(()=>p.cerrar());
  const t = await login(p.url, 'Hfrodriguez', 'admin123');
  const mov = items => api(p.url, 'POST', '/api/inventario/movimientos', { token: t, area: 'tecoflex', cuerpo: { idCliente: Math.random().toString(16).slice(2), items } });
  const entradas = []; [LISO, ROMBOS, PU].forEach(m=>[9, 15, 20].forEach(d=>entradas.push({ tipo: 'entrada', material: m, medida: String(d), cantidad: 100 })));
  assert.strictEqual((await mov(entradas)).s, 200);
  assert.strictEqual((await mov([{ tipo: 'salida', material: LISO, medida: '9', cantidad: 12 }, { tipo: 'salida', material: PU, medida: '20', cantidad: 5 }])).s, 200);
  assert.strictEqual((await mov([{ tipo: 'salida', material: LISO, medida: '9', cantidad: 8 }, { tipo: 'salida', material: ROMBOS, medida: '15', cantidad: 30 }])).s, 200);

  const chrome = await abrirChrome(9421); limpiar(()=>chrome.cerrar());
  const C = await chrome.pagina();
  const visible = sel => C.ev(`(()=>{ const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.hidden && e.offsetParent!==null; })()`);
  const ver = tab => C.ev(`document.querySelector('.invTab[data-tab="${tab}"]').click(); 1`).then(()=>sleep(500));
  const celdas = () => C.ev(`[...document.querySelectorAll('#invConsMatriz td.conConsumo')].map(td=>td.innerText.trim())`);
  const sinDesborde = async nombre => { const m = await C.ev(`({ pagina: document.documentElement.scrollWidth, vista: innerWidth })`); assert.ok(m.pagina <= m.vista + 1, nombre + ': la página se ensancha ' + JSON.stringify(m)); };

  // ---------- PC ----------
  await C.ir(p.url); await C.entrar('Hfrodriguez', 'admin123', 'tecoflex');
  await C.ev(`document.getElementById('tabRack').click(); 1`); await sleep(1200);
  assert.strictEqual(await visible('.invTab[data-tab="registrar"]'), false, 'en la PC el formulario ya está al lado: no hay pestaña Registrar');
  assert.deepStrictEqual(await C.ev(`[...document.querySelectorAll('.invTab')].filter(b=>b.offsetParent!==null).map(b=>b.textContent.trim())`), ['Existencias', 'Consumo', 'Movimientos']);
  assert.strictEqual(await visible('.invControls'), true, 'el formulario con el carrito sigue a la izquierda');
  assert.strictEqual(await visible('#invMatriz'), true); assert.strictEqual(await visible('#invMovs'), false, 'los movimientos recientes ya no están debajo de la tabla');
  await ver('movimientos');
  assert.strictEqual(await visible('#invMovs'), true); assert.strictEqual(await visible('#invMatriz'), false);
  assert.strictEqual(await C.ev(`document.querySelectorAll('#invMovs tbody tr').length`), 3, 'una entrada y dos salidas');
  ok('PC: Existencias, Consumo y Movimientos son vistas aparte; los movimientos recientes salieron de debajo de la tabla de stock');

  // ---------- consumo ----------
  await ver('consumo');
  assert.strictEqual(await visible('#invConsMatriz table'), true);
  assert.deepStrictEqual((await celdas()).sort(), ['−20', '−30', '−5'].sort(), 'las salidas salen con − y la cantidad: ' + await celdas());
  const cuadro = await C.ev(`(()=>{ const t = document.querySelector('#invConsMatriz table');
    const fila = [...t.tBodies[0].rows].map(r=>r.cells[0].textContent.trim().replace(/\\s+/g,'') + ':' + [...r.cells].slice(1).map(c=>c.innerText.trim()).join(','));
    return { medidas: fila.map(f=>f.split(':')[0]), total: t.tFoot.rows[0].cells[t.tFoot.rows[0].cells.length-1].innerText.trim(), encabezados: [...t.tHead.rows[0].cells].map(c=>c.firstChild.textContent.trim()) }; })()`);
  assert.deepStrictEqual(cuadro.medidas, ['9mm', '15mm', '20mm'], 'solo las medidas con consumo');
  assert.strictEqual(cuadro.total, '−55');
  assert.ok(/−55/.test(await C.ev(`document.getElementById('invConsResumen').innerText`)) && /PU 1,27 Rombos/.test(await C.ev(`document.getElementById('invConsResumen').innerText`)) && /−30/.test(await C.ev(`document.getElementById('invConsResumen').innerText`)), 'resumen: total y la que más sale');
  // las salidas en rojo, y más rojo cuanto más sale
  const color = await C.ev(`(()=>{ const f = [...document.querySelectorAll('#invConsMatriz td.conConsumo')].map(td=>({ t: td.innerText.trim(), c: getComputedStyle(td.querySelector('b')).color, f: getComputedStyle(td).backgroundColor }));
    return f; })()`);
  assert.ok(color.every(x=>x.c !== 'rgb(0, 0, 0)' && /^rgb\(/.test(x.c)), JSON.stringify(color));
  assert.notStrictEqual(color.find(x=>x.t==='−30').f, color.find(x=>x.t==='−5').f, 'el fondo marca cuánto se consumió');
  await C.captura(path.join(CAPTURAS, 'rack-tecoflex-consumo.png'));
  ok('Consumo: la tabla de materiales × medidas con −20, −30 y −5 (rojo, más intenso cuanto más sale), totales −55, y "la que más sale"');

  // períodos
  const periodo = async v => { await C.ev(`{ const s = document.getElementById('invConsPeriodo'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change')); } 1`); await sleep(500); };
  await periodo('1'); assert.strictEqual((await celdas()).length, 3, 'hoy están las tres');
  await periodo('todo'); assert.strictEqual((await celdas()).length, 3);
  await C.ev(`{ const c = document.getElementById('invConsSolo'); c.checked = false; c.dispatchEvent(new Event('change')); } 1`);
  assert.strictEqual(await C.ev(`document.querySelectorAll('#invConsMatriz tbody tr').length`), await C.ev(`new Set(AREAS_CONFIG.areas.tecoflex.materiales.flatMap(m=>m.medidas)).size`), 'sin el filtro salen todas las medidas');
  await C.ev(`{ const c = document.getElementById('invConsSolo'); c.checked = true; c.dispatchEvent(new Event('change')); } 1`);
  ok('períodos (hoy, todo el historial) y "solo medidas con consumo"');

  // en vivo: otra PC da una salida y la tabla se actualiza sola
  assert.strictEqual((await mov([{ tipo: 'salida', material: PU, medida: '9', cantidad: 7 }, { tipo: 'salida', material: LISO, medida: '9', cantidad: 4 }])).s, 200);
  await sleep(1500);
  assert.deepStrictEqual((await celdas()).sort(), ['−24', '−30', '−5', '−7'].sort(), 'no se actualizó en vivo: ' + await celdas());
  assert.strictEqual(await C.ev(`document.querySelector('#invConsMatriz tfoot td:last-child').innerText.trim()`), '−66');
  ok('en vivo: una salida de otra PC aparece sola en el consumo (−24 y −7 nuevas, total −66)');

  // Excel: las salidas como números negativos
  await C.ev(`window.__xlsx = null; { const c0 = URL.createObjectURL; URL.createObjectURL = b=>{ if(/spreadsheetml/.test(b.type)) window.__xlsx = b; return c0(b); }; } document.getElementById('invConsExcel').click(); 1`); await sleep(1000);
  const hoja = await C.ev(`(async()=>{ const z = await JSZip.loadAsync(window.__xlsx); return z.file('xl/worksheets/sheet1.xml').async('string'); })()`);
  assert.ok(hoja.includes('<v>-24</v>') && hoja.includes('<v>-30</v>') && hoja.includes('<v>-66</v>') && hoja.includes('>Medida (mm)<'), 'Excel del consumo mal armado');
  ok('Excel del consumo: las mismas celdas como números negativos (se pueden sumar) y el total');

  // la vista elegida se recuerda
  await C.ir(p.url); await sleep(1500);
  assert.strictEqual(await C.ev(`document.querySelector('.invTab.active').dataset.tab`), 'consumo');
  assert.strictEqual(await C.ev(`document.getElementById('invConsPeriodo').value`), 'todo');

  // ---------- celular y tablet ----------
  for(const [nombre, w, h, abajo] of [['celular', 390, 844, true], ['tablet', 820, 1180, true]]){
    await C.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await C.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await C.ev(`document.getElementById('tabRack').click(); 1`); await sleep(900);
    assert.strictEqual(await visible('.invTab[data-tab="registrar"]'), true, nombre + ': aparece la pestaña Registrar');
    for(const tab of ['existencias', 'consumo', 'movimientos']){
      await ver(tab);
      assert.strictEqual(await visible('.invControls'), false, `${nombre}/${tab}: el formulario no ocupa lugar si no se lo pidió`);
      await sinDesborde(`${nombre}/${tab}`);
    }
    await ver('existencias');
    const arriba = await C.ev(`(()=>{ const t = document.querySelector('#invMatriz table'), w = document.getElementById('invMatriz'); const r = t.getBoundingClientRect(); return { alto: Math.round(r.top), entra: w.scrollWidth >= w.clientWidth, celdaAlta: document.querySelector('.invCell').getBoundingClientRect().height }; })()`);
    assert.ok(arriba.alto < h * 0.6, `${nombre}: la tabla tiene que verse sin bajar mucho (arranca en ${arriba.alto}px)`);
    assert.ok(arriba.celdaAlta >= 40, `${nombre}: las celdas se pueden tocar con el dedo (${arriba.celdaAlta}px)`);
    // tocar una celda con stock la elige (sirve en pantallas táctiles)
    await C.toque('#invMatriz td.invCell.conStock'); await sleep(300);
    assert.ok(await C.ev(`document.querySelectorAll('#invMatriz td.invCell.sel').length`) >= 1, nombre + ': tocar una celda no la eligió');
    // Registrar: aparece el formulario (y las vistas se esconden); el carrito suma al número de la pestaña
    await ver('registrar');
    assert.strictEqual(await visible('.invControls'), true); assert.strictEqual(await visible('#invMatriz'), false);
    await sinDesborde(nombre + '/registrar');
    await C.ev(`invCarrito.push({ tipo: 'salida', material: '${PU}', materialNombre: 'PU', medida: '20', cantidad: 2 }); invGuardarCarrito(); invDibujarCarrito(); 1`);
    assert.strictEqual(await C.ev(`document.getElementById('invTabBadge').textContent`), '1', nombre + ': el carrito no se ve en la pestaña');
    await ver('existencias');
    assert.strictEqual(await C.ev(`document.getElementById('invTabBadge').hidden`), false, 'el número del carrito se ve desde las otras vistas');
    await C.ev(`invCarrito.length = 0; invGuardarCarrito(); invDibujarCarrito(); 1`);
    await ver('consumo'); await C.captura(path.join(CAPTURAS, `rack-tecoflex-${nombre}-consumo.png`));
    await ver('registrar'); await C.captura(path.join(CAPTURAS, `rack-tecoflex-${nombre}-registrar.png`));
    ok(`${nombre}: Registrar es una vista más (con el número del carrito), las demás vistas entran sin desplazarse de lado, y las celdas se tocan con el dedo`);
  }
  // al volver a una pantalla grande, Registrar vuelve a estar a la izquierda
  await C.send('Emulation.setDeviceMetricsOverride', { width: 1536, height: 820, deviceScaleFactor: 1, mobile: false }); await sleep(500);
  assert.strictEqual(await visible('.invControls'), true); assert.strictEqual(await visible('.invTab[data-tab="registrar"]'), false);
  ok('al agrandar la ventana, el formulario vuelve a la izquierda y sin pestaña Registrar');

  assert.deepStrictEqual(C.errores, [], 'errores de JavaScript: ' + C.errores.join(' | '));
  ok('sin errores de JavaScript');
});
