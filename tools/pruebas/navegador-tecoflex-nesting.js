// Nesting de Tecoflex: un pedido de tiras (material + medida + cantidad).
// Cada medida tiene su DXF en una carpeta ("CORTE 9MM UND.dxf": una tira de 9 de
// ancho por 3000 de largo); acá la carpeta es de mentira, con archivos del mismo
// formato que los reales (un POLYLINE cerrado). Puente: el endpoint que trae el DXF.
// Navegador: los campos, el cálculo de planchas y los cambios de área.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { ok, sleep, prepararCopia, borrarCopia, arrancarPuente, api, login, abrirChrome, prueba } = require('./comun');
const CAPTURAS = path.join(__dirname, 'capturas');

/* DXF como los de la carpeta real: una POLYLINE cerrada de w x h en la capa PLANE_1 */
const dxf = (w, h) => ['0', 'SECTION', '2', 'ENTITIES', '0', 'POLYLINE', '8', 'PLANE_1', '66', '1', '70', '1',
  ...[[0, 0], [w, 0], [w, h], [0, h]].flatMap(([x, y])=>['0', 'VERTEX', '8', 'PLANE_1', '10', String(x), '20', String(y), '30', '0']),
  '0', 'SEQEND', '8', 'PLANE_1', '0', 'ENDSEC', '0', 'EOF'].join('\n') + '\n';

prueba('Nesting de Tecoflex: pedido de tiras por medida', async limpiar=>{
  fs.mkdirSync(CAPTURAS, { recursive: true });
  const dir = prepararCopia('nesting-teco'); limpiar(()=>borrarCopia(dir));
  // la carpeta de los DXF va AFUERA de la app (el puente nunca abre archivos de su propia carpeta)
  const cortes = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cortes-teco-')); limpiar(()=>borrarCopia(cortes));
  [[9, 3000], [12, 3000], [20, 3000], [131, 3000]].forEach(([w, h])=>fs.writeFileSync(path.join(cortes, `CORTE ${w}MM UND.dxf`), dxf(w, h)));
  fs.writeFileSync(path.join(cortes, 'CORTE 6,5MM UND.dxf'), dxf(6.5, 3000));
  fs.writeFileSync(path.join(cortes, 'CORTE 120MM UND.dxf'), dxf(1600, 3000));   // archivo "equivocado": 1600 de ancho, no 120
  fs.writeFileSync(path.join(dir, 'secreto.dxf'), dxf(5, 5));                      // fuera de la carpeta: no se puede pedir

  const p = await arrancarPuente(dir, 5120, { TECOFLEX_DXF_CARPETA: cortes });
  limpiar(()=>p.cerrar());
  const adm = await login(p.url, 'Hfrodriguez', 'admin123');
  await api(p.url, 'POST', '/api/usuarios', { token: adm, cuerpo: { usuario: 'Operario Teco', clave: 'teco01', permisos: { tecoflex: ['nesting'], papel: ['nesting'] } } });
  await api(p.url, 'POST', '/api/usuarios', { token: adm, cuerpo: { usuario: 'Solo Rack', clave: 'rack01', permisos: { tecoflex: ['rack'] } } });
  const tO = await login(p.url, 'Operario Teco', 'teco01'), tR = await login(p.url, 'Solo Rack', 'rack01');
  const dx = (token, medida, area) => api(p.url, 'GET', '/api/tecoflex/dxf?medida=' + encodeURIComponent(medida), { token, area: area || 'tecoflex' });

  // ---------- puente: el endpoint ----------
  const r9 = await dx(tO, '9');
  assert.strictEqual(r9.s, 200, JSON.stringify(r9.d));
  assert.strictEqual(r9.d.archivo, 'CORTE 9MM UND.dxf'); assert.ok(r9.d.contenido.includes('POLYLINE') && r9.d.contenido.includes('PLANE_1'));
  for(const v of ['9mm', ' 9 MM', '09']) assert.strictEqual((await dx(tO, v)).d.archivo, 'CORTE 9MM UND.dxf', 'alias ' + v);
  assert.strictEqual((await dx(tO, '6.5')).d.archivo, 'CORTE 6,5MM UND.dxf', 'decimal con punto o con coma');
  assert.strictEqual((await dx(tO, '6,5')).s, 200);
  ok('GET /api/tecoflex/dxf: trae "CORTE 9MM UND.dxf" por la medida (9, 9mm, 09, 6.5 y 6,5 valen)');
  const falta = await dx(tO, '77');
  assert.strictEqual(falta.s, 404); assert.ok(/CORTE 77MM UND\.dxf/.test(falta.d.error), falta.d.error);
  for(const malo of ['abc', '1000', '9,555', '', '..\\secreto', '../secreto', '9;dir', '-5', '0'])
    assert.strictEqual((await dx(tO, malo)).s, 400, 'medida mala: ' + JSON.stringify(malo));
  assert.strictEqual((await dx(tR, '9')).s, 403, 'sin permiso de Nesting en Tecoflex');
  assert.strictEqual((await dx(tO, '9', 'mallas')).s, 403);
  assert.strictEqual((await api(p.url, 'GET', '/api/tecoflex/dxf?medida=9', { area: 'tecoflex' })).s, 401, 'sin sesión');
  assert.strictEqual((await dx(adm, '9', 'papel')).s, 400, 'papel no arma el nesting por medida');
  ok('medida inexistente = 404 con el nombre del archivo; medida rara, sin permiso, sin sesión o en otra área = rechazado; nunca sale de la carpeta');

  // ---------- navegador ----------
  const C0 = await abrirChrome(9420); limpiar(()=>C0.cerrar());
  const C = await C0.pagina();
  await C.ir(p.url); await C.entrar('Operario Teco', 'teco01', 'tecoflex');
  await C.ev(`document.getElementById('tabNesting').click(); 1`); await sleep(800);
  const visible = id => C.ev(`(()=>{ const e = document.getElementById(${JSON.stringify(id)}); return !!e && !e.hidden && e.offsetParent!==null; })()`);
  assert.strictEqual(await visible('tnPedido'), true); assert.strictEqual(await visible('dropzone'), false, 'cargar DXF a mano es solo de papel');
  assert.strictEqual(await C.ev(`[...document.querySelectorAll('#viewNesting fieldset')].every(f=>f.offsetParent===null)`), true, 'el motor y las tiras de relleno no aplican');
  assert.strictEqual(await C.ev(`[...document.querySelectorAll('#tnMaterial option')].length`), 6);
  // el material fija la plancha: ancho según material, largo siempre 3000
  const ancho = id => C.ev(`document.getElementById('sheetW').value + 'x' + document.getElementById('chapaLen').value`);
  assert.strictEqual(await ancho(), '1000x3000', 'el primero (Teco Rombos 1,27 X5) mide 1000');
  assert.strictEqual(await C.ev(`document.getElementById('sheetW').readOnly && document.getElementById('chapaLen').readOnly`), true);
  const elegir = async (id, esperado) => { await C.ev(`{ const s = document.getElementById('tnMaterial'); s.value = ${JSON.stringify(id)}; s.dispatchEvent(new Event('change')); } 1`); await sleep(150); assert.strictEqual(await ancho(), esperado, id); };
  await elegir('100003239', '1400x3000'); await elegir('100003554', '1400x3000'); await elegir('100003550', '1400x3000'); await elegir('100003577', '1400x3000');
  await elegir('100005343', '1500x3000'); await elegir('100004045', '1000x3000');
  ok('Material → plancha: PU 1500, Teco Rombos 1,27 (X5) 1000, el resto 1400; el largo siempre 3000 y los campos quedan bloqueados');

  const agregar = async (medida, cantidad) => {
    await C.ev(`{ const m = document.getElementById('tnMedida'); m.value = ${JSON.stringify(String(medida))}; m.dispatchEvent(new Event('input')); document.getElementById('tnCantidad').value = ${JSON.stringify(String(cantidad))}; } 1`);
    const archivo = await C.ev(`document.getElementById('tnArchivo').textContent`);
    await C.ev(`document.getElementById('tnAgregar').click(); 1`); await sleep(700);
    return { archivo, msg: await C.ev(`document.getElementById('tnMsg').textContent`) };
  };
  // validaciones de los campos
  assert.ok(/medida/i.test((await agregar('', 5)).msg));
  assert.ok(/cantidad/i.test((await agregar('9', 0)).msg));
  const x5 = await agregar('9', 5);
  assert.ok(/solo se corta en las medidas/.test(x5.msg) && /6,5 · 12 · 16 · 20 · 21 · 28/.test(x5.msg), x5.msg);
  const sinArchivo = await agregar('12', 3);   // permitida en X5, pero sí hay archivo: entra
  assert.ok(/12 mm agregadas|3 × 12/.test(sinArchivo.msg), sinArchivo.msg);
  assert.strictEqual(sinArchivo.archivo, 'Archivo: CORTE 12MM UND.dxf');
  assert.strictEqual(await C.ev(`document.querySelectorAll('#pieceBody tr').length`), 1);
  ok('campos: sin medida o sin cantidad avisa; muestra el archivo que va a usar; el X5 solo acepta sus medidas');

  // PU (plancha de 1500): 5 de 131, 30 de 20 y 100 de 9
  await C.ev(`window.confirm = () => false; { const s = document.getElementById('tnMaterial'); s.value = '100005343'; s.dispatchEvent(new Event('change')); } 1`); await sleep(150);
  assert.strictEqual(await C.ev(`document.getElementById('tnMaterial').value`), '100004045', 'si no confirma, el material no cambia (el pedido es de un solo material)');
  assert.strictEqual(await C.ev(`document.querySelectorAll('#pieceBody tr').length`), 1);
  await C.ev(`window.confirm = () => true; { const s = document.getElementById('tnMaterial'); s.value = '100005343'; s.dispatchEvent(new Event('change')); } 1`); await sleep(200);
  assert.strictEqual(await C.ev(`pieces.filter(p=>p.isTecoflex).length`), 0, 'cambiar de material vacía el pedido');
  assert.strictEqual(await C.ev(`document.getElementById('emptyMsg').style.display`), 'block');
  assert.strictEqual(await ancho(), '1500x3000');
  await agregar('131', 5); await agregar('20mm', 30); await agregar('9', 60); const mas = await agregar('9', 40);
  assert.strictEqual(await C.ev(`document.querySelectorAll('#pieceBody tr').length`), 3, 'la misma medida se suma, no se repite');
  assert.strictEqual(await C.ev(`[...document.querySelectorAll('#pieceBody tr')].map(tr=>tr.querySelector('.qtyinput').value).join(',')`), '5,30,100');
  assert.ok(/Pedido: 3 medidas, 135 tiras → 2 planchas de 1500 × 3000 mm/.test(await C.ev(`document.getElementById('tnMsg').textContent`)), await C.ev(`document.getElementById('tnMsg').textContent`));
  assert.strictEqual(await C.ev(`document.getElementById('pieceBody').innerText.includes('Tira 131 mm') && document.getElementById('pieceBody').innerText.includes('131×3000')`), true);
  ok('PU: 5 de 131 + 30 de 20 + 100 de 9 (la misma medida se suma): 135 tiras → 2 planchas de 1500 × 3000');

  // ejecutar: cada plancha dentro del ancho, sin encimarse, con la separación pedida
  await C.ev(`document.getElementById('runBtn').click(); 1`); await sleep(600);
  const plan = await C.ev(`(()=>{ const r = lastResult, kerf = r.kerf; const por = {}; let mal = [];
    r.chapas.forEach((c, i)=>{ const ps = [...c.placed].sort((a, b)=>a.x - b.x); let fin = -Infinity;
      ps.forEach(q=>{ const bb = polyBBox(q.rp); por[q.pieceId] = (por[q.pieceId]||0) + 1;
        if(q.y !== 0 || Math.abs(bb.h - 3000) > .001) mal.push('y/largo '+i);
        if(q.x < fin + kerf - 1e-6) mal.push('encimada '+i+' en x='+q.x); fin = q.x + bb.w; });
      if(fin > r.sheetW + 1e-6) mal.push('plancha '+i+' se pasa: '+fin); });
    return { sheetW: r.sheetW, chapaLen: r.chapaLen, kerf, n: r.chapas.length, mal, por: Object.entries(por).map(([id, n])=>pieces.find(p=>p.id===id).tnMedida+'='+n).sort().join(' '), sin: r.unplaced.length,
      llenas: r.chapas.map(c=>c.placed.length), stats: [document.getElementById('stChapas').textContent, document.getElementById('stPlaced').textContent] }; })()`);
  assert.deepStrictEqual(plan.mal, [], JSON.stringify(plan));
  assert.strictEqual(plan.n, 2); assert.strictEqual(plan.sin, 0); assert.strictEqual(plan.por, '131=5 20=30 9=100');
  assert.deepStrictEqual(plan.stats, ['2', '135 / 135']);
  assert.strictEqual(await C.ev(`document.querySelectorAll('#chapasWrap canvas').length`), 2);
  await C.captura(path.join(CAPTURAS, 'tecoflex-nesting.png'));
  ok(`Ejecutar nesting: ${plan.n} planchas, ninguna se pasa de ${plan.sheetW} ni se encima (separación ${plan.kerf} mm); 5 + 30 + 100 tiras ubicadas; la primera plancha lleva ${plan.llenas[0]} tiras`);

  // separación: 0 mm en Tecoflex por defecto
  assert.strictEqual(await C.ev(`document.getElementById('kerf').value`), '0');
  // DXF: un peine (|||||||): paredes verticales y UNA sola línea arriba, sin fondo; una pared compartida se corta UNA sola vez
  const polis = txt => {
    const l = txt.split('\n'), r = [];
    for(let i=0; i<l.length; i++){
      if(l[i] !== 'LWPOLYLINE') continue;
      const n = +l[i+8], pts = [];
      for(let k=0; k<n; k++) pts.push([+l[i+12+4*k], +l[i+14+4*k]]);
      r.push({ capa: l[i+2], cerrada: +l[i+10] === 1, pts });
    }
    return r;
  };
  const dxfDe = i => C.ev(`buildChapaDXF(lastResult.chapas[${i}], lastResult.sheetW, lastResult.chapaLen, buildIdMap(), ${i+1})`);
  const revisar = async () => {
    const todas = polis(await dxfDe(0)), bordes = todas.filter(x=>x.capa==='CHAPA'), cortes = todas.filter(x=>x.capa!=='CHAPA');
    assert.ok(todas.every(x=>!x.cerrada), 'nada se cierra');
    const horizontal = x => x.pts.length === 2 && x.pts[0][1] === x.pts[1][1];
    const vertical = x => x.pts.length === 2 && x.pts[0][0] === x.pts[1][0];
    // el borde de la chapa: solo sus dos lados (no agrega otra raya horizontal)
    assert.ok(bordes.length === 2 && bordes.every(vertical), 'el borde de la chapa lleva solo sus dos lados');
    // UNA sola línea horizontal, arriba (y=3000); ninguna abajo (y=0)
    const rayas = cortes.filter(horizontal), paredes = cortes.filter(vertical);
    assert.strictEqual(rayas.length, 1, 'tiene que haber UNA sola línea horizontal: ' + rayas.length);
    assert.strictEqual(rayas[0].pts[0][1], 3000, 'la línea va arriba');
    assert.strictEqual(rayas.length + paredes.length, cortes.length, 'todo lo demás son paredes verticales');
    assert.ok(paredes.every(x=>x.pts[0][1] === 3000 && x.pts[1][1] === 0), 'cada pared va de arriba (3000) a abajo (0)');
    // cada pared una sola vez (una compartida entre dos tiras no se corta doble)
    const xs = paredes.map(x=>x.pts[0][0].toFixed(3));
    assert.strictEqual(new Set(xs).size, xs.length, 'una pared repetida (se cortaría dos veces)');
    // la línea va de la primera pared a la última
    const ordenadas = xs.map(Number).sort((a, b)=>a - b), raya = rayas[0].pts.map(p=>p[0]).sort((a, b)=>a - b);
    assert.deepStrictEqual([raya[0], raya[1]], [ordenadas[0], ordenadas[ordenadas.length - 1]], 'la línea de arriba cubre de la primera a la última pared');
    return { paredes: paredes.length };
  };
  const nTiras = await C.ev(`lastResult.chapas[0].placed.length`);
  const k0 = await revisar();
  assert.strictEqual(k0.paredes, nTiras + 1, 'con 0 mm: n tiras = n + 1 paredes');
  await C.ev(`{ const k = document.getElementById('kerf'); k.value = '2'; k.dispatchEvent(new Event('input')); } document.getElementById('runBtn').click(); 1`); await sleep(500);
  const nTiras2 = await C.ev(`lastResult.chapas[0].placed.length`);
  const k2 = await revisar();
  assert.strictEqual(k2.paredes, 2*nTiras2, 'con separación cada tira lleva sus dos paredes');
  await C.ev(`{ const k = document.getElementById('kerf'); k.value = '0'; k.dispatchEvent(new Event('input')); } document.getElementById('runBtn').click(); 1`); await sleep(500);
  ok(`DXF: peine (|||||||) con UNA sola línea arriba y sin fondo: con 0 mm ${nTiras} tiras comparten sus paredes (${k0.paredes} paredes, ninguna repetida); con 2 mm cada una lleva las suyas; el borde de la chapa sin rayas horizontales`);

  // el cálculo, con cuentas que se pueden verificar a mano
  const casos = await C.ev(`(()=>{ const t = (w, n) => Array.from({length: n}, ()=>({ w, h: 3000 })); const f = (tiras, W, k) => tnEmpacar(tiras, W, 3000, k).planchas.length;
    return [ f(t(9, 166), 1500, 0),            // 166 x 9 = 1494: entran en una
             f(t(9, 167), 1500, 0),            // 167 x 9 = 1503: una de más, otra plancha
             f(t(9, 150), 1500, 1),            // con 1 mm entre tiras: 150 x 9 + 149 = 1499, entran justas
             f(t(9, 151), 1500, 1),            // 151 x 9 + 150 = 1509: no entran
             f(t(100, 14), 1400, 0),           // 14 x 100 = 1400 justo
             f(t(100, 15), 1400, 0),           // una de más: 2 planchas
             f([...t(700, 2), ...t(500, 2), ...t(300, 2), ...t(200, 2)], 1000, 0),   // 3400 mm en planchas de 1000: mínimo 4 (700+300, 700+300, 500+500, 200+200)
             tnEmpacar([{ w: 1501, h: 3000 }, { w: 9, h: 3001 }, { w: 9, h: 3000 }], 1500, 3000, 1).sinUbicar.length ]; })()`);
  assert.deepStrictEqual(casos, [1, 2, 1, 2, 1, 2, 4, 2], JSON.stringify(casos));
  ok('el cálculo es exacto: 166 tiras de 9 caben en 1500 y una más pide otra plancha; la separación se cuenta entre tiras; mezclas de medidas; lo que no cabe (más ancho o más largo que la plancha) queda aparte');

  // un archivo que no es lo que dice el nombre: se avisa; y lo que no cabe se cuenta
  await C.ev(`{ const s = document.getElementById('tnMaterial'); s.value = '100003239'; s.dispatchEvent(new Event('change')); } 1`); await sleep(150);
  const raro = await agregar('120', 1);
  assert.ok(/⚠/.test(raro.msg) && /1600 mm de ancho, no de 120/.test(raro.msg), raro.msg);
  await C.ev(`document.getElementById('runBtn').click(); 1`); await sleep(400);
  assert.ok(/no cabe/.test(await C.ev(`document.getElementById('tnMsg').textContent`)), await C.ev(`document.getElementById('tnMsg').textContent`));
  assert.strictEqual(await C.ev(`document.getElementById('stUnplacedRow').style.display`), 'flex');
  ok('un archivo con otro ancho que el de la medida (1600 en "CORTE 120MM") se avisa, y la tira que no cabe se cuenta aparte');
  const falta2 = await agregar('77', 2);
  assert.ok(/No existe el archivo "CORTE 77MM UND\.dxf"/.test(falta2.msg), falta2.msg);
  assert.strictEqual(await C.ev(`document.querySelectorAll('#pieceBody tr').length`), 1, 'una medida sin archivo no entra al pedido');
  ok('una medida sin archivo en la carpeta avisa con el nombre y no entra al pedido');

  // áreas: lo de Tecoflex no se mezcla con papel, y vuelve al regresar
  await C.ev(`document.querySelector('[data-area-btn="papel"]').click(); 1`); await sleep(600);
  assert.strictEqual(await C.ev(`pieces.length`), 0, 'papel arranca sin las piezas de Tecoflex');
  assert.strictEqual(await C.ev(`document.getElementById('sheetW').value + 'x' + document.getElementById('chapaLen').value`), '1000x2000');
  assert.strictEqual(await C.ev(`document.getElementById('sheetW').readOnly || document.getElementById('fillStrips').checked===false`), false);
  assert.strictEqual(await C.ev(`document.getElementById('kerf').value`), '1', 'papel vuelve a su separación de 1 mm');
  assert.strictEqual(await visible('dropzone'), true); assert.strictEqual(await visible('tnPedido'), false);
  await C.ev(`document.querySelector('[data-area-btn="tecoflex"]').click(); 1`); await sleep(600);
  assert.strictEqual(await C.ev(`pieces.filter(p=>p.isTecoflex).length`), 1, 'el pedido de Tecoflex sigue ahí');
  assert.strictEqual(await C.ev(`document.getElementById('sheetW').value`), '1400');
  assert.strictEqual(await C.ev(`document.getElementById('fillStrips').checked`), false);
  assert.strictEqual(await C.ev(`document.getElementById('kerf').value`), '0');
  ok('al cambiar de área, Tecoflex y papel no se mezclan (piezas, resultado y tamaños de plancha) y cada uno vuelve como lo dejó');

  // celular: todo entra en la pantalla
  await C.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await C.send('Emulation.setTouchEmulationEnabled', { enabled: true }); await sleep(500);
  await C.ev(`window.scrollTo(0, 0); 1`);
  const cel = await C.ev(`({ pagina: document.documentElement.scrollWidth, vista: innerWidth, campo: document.getElementById('tnMedida').getBoundingClientRect().width })`);
  assert.ok(cel.pagina <= cel.vista + 1 && cel.campo > 100, JSON.stringify(cel));
  await C.captura(path.join(CAPTURAS, 'tecoflex-nesting-celular.png'));
  ok('celular: el pedido entra en la pantalla (sin desplazarse de lado)');

  assert.deepStrictEqual(C.errores, [], 'errores de JavaScript: ' + C.errores.join(' | '));
  ok('sin errores de JavaScript');
});
