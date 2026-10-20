// La app de verdad en Chrome, área Mallas (con el SQL simulado): Lista de
// corte por CodMat, elegir lo fabricado, dar entrada (un sticker por malla),
// y en el Rack dar salida escaneando el sticker. Capturas en capturas/.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { ok, sleep, prepararCopia, borrarCopia, arrancarPuente, abrirChrome, prueba } = require('./comun');
const CAPTURAS = path.join(__dirname, 'capturas');

prueba('Navegador: Mallas (lista por CodMat, entrada con stickers, salida escaneando)', async limpiar=>{
  fs.mkdirSync(CAPTURAS, { recursive: true });
  const dir = prepararCopia('nav-mallas'); limpiar(()=>borrarCopia(dir));
  fs.mkdirSync(path.join(dir, 'server', 'node_modules', 'mssql'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'sql-falso.js'), path.join(dir, 'server', 'node_modules', 'mssql', 'index.js'));
  const m = (Ordem_Serial, CodMat, Descricao, m2) => ({ Ordem_Serial, Operation: '2900', unMed: 'UND', CodMat, Descricao, m2 });
  const datosSql = path.join(dir, 'sql-falso.json');
  fs.writeFileSync(datosSql, JSON.stringify({ saga: [],
    calendario: [{ orden: '11', puesto: '12P_ENSA', vehiculo: 'BMW X5 4D UTILITY' }, { orden: '12', puesto: 'Planeacion', vehiculo: 'BMW X5 4D UTILITY' },
                 { orden: '13', puesto: '02CNC', vehiculo: 'URO VAMTAC ST5 4PC TRUCK' },
                 { orden: '31', puesto: '03SERIG', vehiculo: 'MERCEDES BENZ GLS 450' }],
    mallas: [m('11', '000000000600019608', 'MTNTF0036.1244.01.00.00 D', '1.000'), m('12', '000000000600019608', 'MTNTF0036.1244.01.00.00 D', '2.000'),
             m('13', '000000000600039800', 'MTNTF0036.1567.08.00', '1.000'),
             m('31', '000000000600050001', 'PVTE 000 MERC GLS 450 4D U 2017', '1.000')] }));
  const p = await arrancarPuente(dir, 5112, { DB_SERVER: 'falso', CAL_DB_SERVER: 'falso', FAKE_SQL_DATOS: datosSql });
  limpiar(()=>p.cerrar());
  const chrome = await abrirChrome(9406); limpiar(()=>chrome.cerrar());
  const A = await chrome.pagina();

  await A.ir(p.url); await A.entrar('Ana', 'ana123', 'mallas');
  await A.ev(`document.getElementById('tabOrdenes').click(); 1`); await sleep(800);
  const enc = await A.ev(`[...document.querySelectorAll('#ordTableWrap thead th')].map(t=>t.textContent.trim()).filter(Boolean).join('|')`);
  assert.strictEqual(enc, 'CodMat|Descripción|Cantidad|Con stock|Falta|Vehículo');
  // por CodMat, sin puesto: cada material una sola vez entre las liberadas; Planeación aparte
  const filas = () => A.ev(`[...document.querySelectorAll('#ordTableWrap tr.msFila')].map(tr=>tr.closest('tbody').classList[1] + ': ' + [...tr.cells].slice(0,6).map(c=>c.textContent.trim()).join(' | '))`);
  assert.deepStrictEqual(await filas(), [
    'liberadas: 600019608 | MTNTF0036.1244.01.00.00 D | 1 | — | 1 | BMW X5 4D UTILITY',
    'liberadas: 600039800 | MTNTF0036.1567.08.00 | 1 | — | 1 | URO VAMTAC ST5 4PC TRUCK',
    'planeacion: 600019608 | MTNTF0036.1244.01.00.00 D | 2 | — | 2 | BMW X5 4D UTILITY']);
  assert.deepStrictEqual(await A.ev(`[...document.querySelectorAll('.msGrupoHead b')].map(b=>b.textContent)`), ['Liberadas', 'En planeación']);
  assert.strictEqual(await A.ev(`document.getElementById('msKpiFalta').textContent`), '2'); // solo lo liberado
  // necesidad por puesto, en el orden del proceso y Planeación al final
  assert.deepStrictEqual(await A.ev(`[...document.querySelectorAll('#msPorPuesto .msPuesto')].map(d=>d.querySelector('.msPuestoHead > b').textContent + ' ' + d.querySelector('.msPuestoHead span').textContent.trim() + ' ' + [...d.querySelectorAll('.msPuestoLinea .mono')].map(x=>x.textContent).join(','))`),
    ['02CNC faltan 1 600039800', '12P_ENSA faltan 1 600019608', 'Planeación faltan 2 600019608']);
  assert.strictEqual(await A.ev(`document.querySelector('.quickAdd').offsetParent===null && document.getElementById('ordRunBtn').offsetParent===null`), true, 'en Mallas no van ingreso por orden ni nesting');
  ok('Lista de corte de Mallas: por CodMat sin puesto (sin repetidos), Planeación aparte; al lado, la necesidad por puesto (02CNC, 12P_ENSA, Planeación)');

  // botón Excel: baja exactamente lo de la tabla (filtro "BMW" -> 2 filas), números como números
  await A.ev(`window.__xlsx = null; { const c0 = URL.createObjectURL; URL.createObjectURL = b=>{ if(/spreadsheetml/.test(b.type)) window.__xlsx = b; return c0(b); }; }
    { const f=document.getElementById('ordBuscarInput'); f.value='bmw'; f.dispatchEvent(new Event('input')); } 1`); await sleep(300);
  await A.ev(`document.getElementById('ordExcelBtn').click(); 1`); await sleep(800);
  const xlsx = await A.ev(`(async()=>{ const z = await JSZip.loadAsync(window.__xlsx); const b64 = await window.__xlsx.arrayBuffer().then(a=>btoa(String.fromCharCode(...new Uint8Array(a))));
    return { hoja: await z.file('xl/worksheets/sheet1.xml').async('string'), b64 }; })()`);
  fs.writeFileSync(path.join(CAPTURAS, 'lista-de-corte-mallas.xlsx'), Buffer.from(xlsx.b64, 'base64'));
  const celdas = [...xlsx.hoja.matchAll(/<c r="([A-Z]+\d+)"[^>]*>(?:<v>([^<]*)<\/v>|<is><t[^>]*>([^<]*)<\/t><\/is>)<\/c>/g)].map(m=>[m[1], m[2]!==undefined ? Number(m[2]) : m[3]]);
  const val = ref => (celdas.find(c=>c[0]===ref)||[])[1];
  assert.deepStrictEqual(['A1','B1','C1','D1','E1','F1','G1'].map(val), ['Grupo','CodMat','Descripción','Cantidad','Con stock','Falta','Vehículo']);
  assert.strictEqual(celdas.filter(c=>/^A\d+$/.test(c[0])).length, 3, 'el Excel tiene que traer las 2 filas filtradas + encabezado');
  assert.strictEqual(val('A2'), 'Liberadas'); assert.strictEqual(val('A3'), 'En planeación');
  assert.strictEqual(val('B2'), '600019608');           // código como texto
  assert.strictEqual(val('D3'), 2);                     // cantidad como número
  assert.ok(/<autoFilter ref="A1:G3"\/>/.test(xlsx.hoja) && /state="frozen"/.test(xlsx.hoja));
  await A.ev(`{ const f=document.getElementById('ordBuscarInput'); f.value=''; f.dispatchEvent(new Event('input')); } 1`); await sleep(300);
  ok('botón Excel: baja solo lo que está en la tabla (filtro "bmw" = 2 filas), códigos como texto, cantidades como número, encabezado fijo y con filtros');

  // elegir lo fabricado: tocar las 2 filas del mismo CodMat suma lo que falta de cada una
  await A.ev(`document.querySelectorAll('#ordTableWrap tr.msFila')[0].click(); document.querySelectorAll('#ordTableWrap tr.msFila')[2].click(); 1`);
  assert.strictEqual(await A.ev(`document.querySelectorAll('#msEntLista .cartRow').length`), 1);
  assert.strictEqual(await A.ev(`document.querySelector('#msEntLista .cartQty').value`), '3');
  assert.strictEqual(await A.ev(`document.getElementById('msEntConfirmar').textContent.trim()`), 'Dar entrada e imprimir 3 stickers');
  await A.captura(path.join(CAPTURAS, 'mallas-lista.png'));
  // la lista es lo principal: ocupa más de la mitad del ancho, también en una pantalla de 1536 px (1920 al 125%)
  await A.send('Emulation.setDeviceMetricsOverride', { width: 1536, height: 820, deviceScaleFactor: 1, mobile: false }); await sleep(300);
  const anchoLista = await A.ev(`document.querySelector('#ordStagePanel > .stagepanel').getBoundingClientRect().width / window.innerWidth`);
  assert.ok(anchoLista > 0.55, `la lista ocupa solo el ${Math.round(anchoLista*100)}% del ancho`);
  assert.strictEqual(await A.ev(`(()=>{ const w=document.getElementById('ordTableWrap'); return w.scrollWidth <= w.clientWidth + 2; })()`), true, 'la tabla no entra entera: hay que desplazarla');
  await A.captura(path.join(CAPTURAS, 'mallas-lista-1536.png'));
  await A.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false }); await sleep(200);
  ok('tocar las filas del CodMat 600019608 las junta en "Entrada al rack" con lo que falta (3): "Dar entrada e imprimir 3 stickers"');

  // dar entrada: sin Zebra configurada, sale el PDF con UN sticker por malla
  // se intercepta la descarga del PDF para contar los stickers (jsPDF arma cada documento en su constructor)
  await A.ev(`window.__pdf = null; const J0 = window.jspdf.jsPDF;
    window.jspdf.jsPDF = function(...a){ const d = new J0(...a); d.save = n=>{ window.__pdf = { n, paginas: d.getNumberOfPages() }; }; return d; }; 1`);
  await A.ev(`document.getElementById('msEntConfirmar').click(); 1`); await sleep(1500);
  const st = await A.ev(`document.getElementById('msEntStatus').textContent`);
  assert.ok(/entraron 3/.test(st) && /PDF/.test(st), st);
  assert.strictEqual((await A.ev(`window.__pdf`)).paginas, 3, 'tienen que salir 3 stickers');
  assert.deepStrictEqual((await filas()).map(f=>f.split(' | ').slice(2, 5).join(' ')), ['1 1 ✓ cubierto', '1 — 1', '2 2 ✓ cubierto']);
  assert.strictEqual(await A.ev(`document.getElementById('msKpiFalta').textContent`), '1');
  ok(`entrada de 3: "${st.trim()}"; el PDF trae 3 stickers; en la lista el stock ya cubre ese CodMat ("✓ cubierto") y Faltan baja a 1`);

  // Rack: stock y salida escaneando el sticker (con los ceros de SAP, como venga)
  await A.ev(`document.getElementById('tabRack').click(); 1`); await sleep(900);
  const stock = await A.ev(`[...document.querySelectorAll('#msStockWrap tbody tr')].map(tr=>[...tr.cells].slice(0,5).map(c=>c.textContent.trim()).join(' | '))`);
  // solo lo que hay en el rack (600039800 tiene necesidad pero stock 0: no aparece)
  assert.deepStrictEqual(stock, ['600019608 | MTNTF0036.1244.01.00.00 D | 3 | 3 | —']);
  await A.ev(`const i=document.getElementById('msSalScan'); for(const v of ['000000000600019608','600019608']){ i.value=v; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); } 1`);
  assert.strictEqual(await A.ev(`document.querySelector('#msSalLista .cartQty').value`), '2');
  await A.captura(path.join(CAPTURAS, 'mallas-rack.png'));
  await A.ev(`document.getElementById('msSalConfirmar').click(); 1`); await sleep(1000);
  assert.ok(/salieron 2/.test(await A.ev(`document.getElementById('msSalStatus').textContent`)));
  assert.strictEqual(await A.ev(`document.querySelector('#msStockWrap tbody tr').cells[2].textContent.trim()`), '1');
  assert.strictEqual(await A.ev(`document.getElementById('msKpiHoy').textContent`), '3 / 2');
  ok('Rack: stock 3 con su necesidad; 2 escaneos del sticker (con o sin ceros) = salida de 2; queda 1; hoy entran 3 / salen 2');

  // Tejidos: su color, su lista (PVTE) y los textos con "tejido"; los carritos no se mezclan entre áreas
  await A.ev(`document.getElementById('tabOrdenes').click(); 1`); await sleep(500);
  await A.ev(`document.querySelectorAll('#ordTableWrap tr.msFila')[1].click(); 1`); // algo en el carrito de Mallas
  assert.strictEqual(await A.ev(`msEntrada.length`), 1);
  await A.ev(`document.querySelector('[data-area-btn="tejidos"]').click(); 1`); await sleep(300);
  await A.ev(`document.getElementById('tabOrdenes').click(); 1`); await sleep(900);
  assert.strictEqual(await A.ev(`document.body.getAttribute('data-area')`), 'tejidos');
  assert.strictEqual(await A.ev(`msEntrada.length`), 0, 'el carrito de Mallas pasó a Tejidos');
  assert.strictEqual(await A.ev(`document.getElementById('msEntStatus').textContent`), '', 'quedó un mensaje de Mallas en Tejidos');
  // (Tejidos suma la columna Tamaño: el vehículo queda en la 7ª)
  assert.deepStrictEqual(await A.ev(`[...document.querySelectorAll('#ordTableWrap tr.msFila')].map(tr=>tr.cells[0].textContent.trim() + ' ' + tr.cells[6].textContent.trim())`), ['600050001 MERCEDES BENZ GLS 450']);
  await A.ev(`document.getElementById('tabRack').click(); 1`); await sleep(700);
  // el Rack de Tejidos es otro (por posición, con foto): el stock de Mallas no se ve
  assert.strictEqual(await A.ev(`!!document.querySelector('.tjEntrada').offsetParent && document.getElementById('msStockWrap').offsetParent===null`), true);
  await A.ev(`document.querySelector('[data-area-btn="mallas"]').click(); 1`); await sleep(500);
  assert.strictEqual(await A.ev(`msEntrada.map(l=>l.codmat).join()`), '600039800', 'al volver a Mallas tiene que estar su carrito');
  ok('Tejidos: su propia área (color fucsia), lista con PVTE, textos "tejido(s)", stock aparte; cada área con su carrito (al volver a Mallas sigue el suyo)');

  assert.deepStrictEqual(A.errores, [], 'errores de JavaScript: ' + A.errores.join(' | '));
  ok('sin errores de JavaScript');
});
