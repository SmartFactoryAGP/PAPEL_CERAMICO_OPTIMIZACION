// La app de verdad en Chrome, como CELULAR (390 x 844): el operario de ZUND
// da entrada a un tejido con foto, ve el rack, abre una posición con su foto
// y le da salida. Y en la PC: Lista de corte de Tejidos (Tamaño, "Asignar",
// tocar una fila lleva a dar entrada). Capturas en capturas/.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const { ok, sleep, prepararCopia, borrarCopia, arrancarPuente, api, login, abrirChrome, prueba } = require('./comun');
const CAPTURAS = path.join(__dirname, 'capturas');
// una imagen PNG real de 1x1 (el navegador la decodifica, la achica y la sube como JPEG)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

prueba('Navegador: Rack de Tejidos en el celular', async limpiar=>{
  fs.mkdirSync(CAPTURAS, { recursive: true });
  const dir = prepararCopia('nav-tejidos'); limpiar(()=>borrarCopia(dir));
  const tej = path.join(dir, 'server', 'datos', 'tejidos'); fs.mkdirSync(tej, { recursive: true });
  const posiciones = [];
  ['A1','A2','A3'].forEach(e=>[1,2,3].forEach(n=>posiciones.push({ pos: `${e}.${n}`, tamano: 'P' })));
  ['B1','B2'].forEach(e=>[1,2].forEach(n=>posiciones.push({ pos: `${e}.${n}`, tamano: 'G' })));
  posiciones.push({ pos: 'C1.1', tamano: 'XG' });
  fs.writeFileSync(path.join(tej, 'posiciones.json'), JSON.stringify(posiciones));
  fs.writeFileSync(path.join(tej, 'tamanos.json'), JSON.stringify({ '600039736': { tamano: 'P', nombre: 'PUTE0062.1244.14.00.F' } }));
  fs.mkdirSync(path.join(dir, 'server', 'node_modules', 'mssql'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'sql-falso.js'), path.join(dir, 'server', 'node_modules', 'mssql', 'index.js'));
  const m = (Ordem_Serial, CodMat, Descricao) => ({ Ordem_Serial, Operation: '2900', unMed: 'UND', CodMat, Descricao, m2: '1.000' });
  const datosSql = path.join(dir, 'sql-falso.json');
  fs.writeFileSync(datosSql, JSON.stringify({ saga: [], calendario: ['61','62','63'].map(orden=>({ orden, puesto: '11ZUND', vehiculo: 'BMW X5 4D UTILITY' })),
    mallas: [m('61', '000000000600039736', 'PUTE0062.1244.14.00.F'), m('62', '000000000600039736', 'PUTE0062.1244.14.00.F'), m('63', '000000000600051455', 'PUTE0076.1662.005.001.B')] }));
  const p = await arrancarPuente(dir, 5115, { DB_SERVER: 'falso', CAL_DB_SERVER: 'falso', FAKE_SQL_DATOS: datosSql, ZEBRA_PRINTER_POR_USUARIO: 'Beto=ZEBRA_DE_BETO' });
  limpiar(()=>p.cerrar());
  const adm = await login(p.url, 'Hfrodriguez', 'admin123');
  await api(p.url, 'POST', '/api/usuarios', { token: adm, cuerpo: { usuario: 'Operario Zund', clave: 'zund01', permisos: { tejidos: ['rack', 'ordenes'] } } });
  const foto = path.join(os.tmpdir(), 'calentamiento-prueba.png'); fs.writeFileSync(foto, PNG); limpiar(()=>fs.rmSync(foto, { force: true }));

  const chrome = await abrirChrome(9407); limpiar(()=>chrome.cerrar());
  const C = await chrome.pagina();
  await C.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await C.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await C.ir(p.url); await C.entrar('Operario Zund', 'zund01', 'tejidos');
  await C.ev(`document.getElementById('tabRack').click(); 1`); await sleep(1000);

  // en el celular: una sola columna, nada se sale de la pantalla
  const ancho = await C.ev(`({ form: document.querySelector('.tjEntrada').getBoundingClientRect().width, pagina: document.documentElement.scrollWidth, vista: window.innerWidth })`);
  assert.ok(ancho.form > 300 && ancho.pagina <= ancho.vista + 1, JSON.stringify(ancho));
  assert.strictEqual(await C.ev(`document.getElementById('tjFoto').getAttribute('capture')`), 'environment', 'en el celular tiene que abrir la cámara');
  assert.strictEqual(await C.ev(`document.querySelectorAll('#tjMapa .tjCelda').length`), 14);

  // elegir el tejido (lo que pide la Lista de corte aparece primero) y completar
  // lista desplegable propia (en el iPhone el datalist no se despliega): tocar el campo la abre
  await C.toque('#tjTejido'); await sleep(500);
  assert.strictEqual(await C.ev(`document.getElementById('tjLista').hidden`), false, 'tocar el campo tiene que abrir la lista');
  const opciones = await C.ev(`[...document.querySelectorAll('#tjLista .tjOpc')].map(b=>b.dataset.codmat)`);
  assert.strictEqual(opciones[0], '600039736', 'primero lo que pide la Lista de corte: ' + opciones.join(','));
  assert.ok(/Pide la Lista de corte/.test(await C.ev(`document.getElementById('tjLista').textContent`)));
  assert.ok(/Faltan 2/.test(await C.ev(`document.querySelector('#tjLista .tjOpc').textContent`)));
  const caja = await C.ev(`(()=>{ const r=document.getElementById('tjLista').getBoundingClientRect(); return { izq: r.left, der: r.right, alto: r.height, vista: innerWidth }; })()`);
  assert.ok(caja.izq >= 0 && caja.der <= caja.vista && caja.alto > 80, 'la lista tiene que entrar en la pantalla: ' + JSON.stringify(caja));
  await C.captura(path.join(CAPTURAS, 'tejidos-celular-lista.png'));
  // escribir filtra (por nombre, CodMat o vehículo), sin importar mayúsculas
  await C.ev(`{ const t=document.getElementById('tjTejido'); t.value='pute0076'; t.dispatchEvent(new Event('input')); } 1`); await sleep(200);
  assert.deepStrictEqual(await C.ev(`[...document.querySelectorAll('#tjLista .tjOpc')].map(b=>b.dataset.codmat)`), ['600051455']);
  await C.ev(`{ const t=document.getElementById('tjTejido'); t.value='bmw'; t.dispatchEvent(new Event('input')); } 1`); await sleep(200);
  assert.ok((await C.ev(`[...document.querySelectorAll('#tjLista .tjOpc')].map(b=>b.dataset.codmat)`)).includes('600039736'), 'buscar por vehículo');
  await C.toque('#tjLista .tjOpc[data-codmat="600039736"]'); await sleep(300);
  assert.strictEqual(await C.ev(`document.getElementById('tjLista').hidden`), true, 'al elegir se cierra');
  assert.strictEqual(await C.ev(`document.getElementById('tjTejido').value`), '600039736 · PUTE0062.1244.14.00.F');
  assert.ok(/Va a la posición A1\.1/.test(await C.ev(`document.getElementById('tjElegido').textContent`)));
  await C.ev(`document.getElementById('tjResponsables').value='Juan Pérez'; document.getElementById('tjR1').value='12.5'; document.getElementById('tjEnsamble').value='OK'; 1`);
  // sin foto no deja
  await C.ev(`document.getElementById('tjEntrar').click(); 1`); await sleep(300);
  assert.ok(/Falta la foto/.test(await C.ev(`document.getElementById('tjMsg').textContent`)));
  // la foto, por el mismo campo que abre la cámara
  const doc = await C.send('DOM.getDocument', {});
  const nodo = await C.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#tjFoto' });
  await C.send('DOM.setFileInputFiles', { nodeId: nodo.result.nodeId, files: [foto] }); await sleep(600);
  assert.strictEqual(await C.ev(`!document.getElementById('tjFotoPrev').hidden`), true);
  await C.captura(path.join(CAPTURAS, 'tejidos-celular-entrada.png'));
  // la PC del MISMO usuario, abierta en el Rack con su Zebra falsa: es quien imprime lo que se da de alta en el celular
  const PC = await chrome.pagina();
  await PC.ir(p.url); await PC.entrar('Operario Zund', 'zund01', 'tejidos');
  await PC.ev(`document.getElementById('tabRack').click(); window.__impresos = []; window.tjImprimir = async (u, pos)=>{ window.__impresos.push({ pos, foto: u.foto, nombre: u.nombre }); return 'Sticker enviado a la Zebra.'; }; 1`); await sleep(800);
  await C.ev(`window.__pdf = null; { const J0 = window.jspdf.jsPDF; window.jspdf.jsPDF = function(...a){ const d = new J0(...a); d.save = n=>{ window.__pdf = n; }; return d; }; } 1`);
  await C.ev(`document.getElementById('tjEntrar').click(); 1`); await sleep(1500);
  const res = await C.ev(`document.getElementById('tjResultado').innerText.replace(/\\s+/g,' ').trim()`);
  assert.ok(/va en la posición A1\.1/i.test(res), res);
  assert.strictEqual(await C.ev(`window.__pdf`), null, 'desde el celular no se imprime ni se baja el PDF');
  assert.ok(/se está imprimiendo en la PC/.test(res), 'el celular tiene que avisar que la PC de su usuario imprime: ' + res);
  await sleep(700);
  const impresos = await PC.ev(`window.__impresos`);
  assert.strictEqual(impresos.length, 1, 'la PC del mismo usuario imprime una vez: ' + JSON.stringify(impresos));
  assert.strictEqual(impresos[0].pos, 'A1.1');
  assert.ok(/Entrada hecha desde el celular \(A1\.1\)/.test(await PC.ev(`document.getElementById('tjMsg').textContent`)));
  const fotoSubida = impresos[0].foto;
  assert.strictEqual(await C.ev(`document.getElementById('tjResponsables').value`), 'Juan Pérez', 'el responsable se conserva para el siguiente');
  assert.strictEqual(await C.ev(`document.getElementById('tjTejido').value`), '');
  await C.captura(path.join(CAPTURAS, 'tejidos-celular-resultado.png'));
  ok(`celular: elegir tejido → "Va a la posición A1.1"; sin foto no deja; con la foto de la cámara entra: "${res}"; desde el celular NO imprime ni baja PDF: lo imprime la PC del mismo usuario (una vez), y solo esa`);

  // "Por material" (la pestaña de entrada): cuánto hay de cada uno y, al tocarlo, en qué posiciones
  assert.strictEqual(await C.ev(`document.querySelector('.tjTab.active').dataset.tab`), 'material');
  const mat = await C.ev(`[...document.querySelectorAll('#tjMateriales .tjMat')].map(b=>b.innerText.replace(/\\s+/g,' ').trim())`);
  assert.strictEqual(mat.length, 1, JSON.stringify(mat));
  assert.ok(/BMW X5 4D UTILITY/i.test(mat[0]) && /PUTE0062\.1244\.14\.00\.F/.test(mat[0]) && / 1$/.test(mat[0]), mat[0]);
  await C.ev(`document.querySelector('#tjMateriales .tjMat').click(); 1`); await sleep(300);
  assert.deepStrictEqual(await C.ev(`[...document.querySelectorAll('#tjUbicaciones .tjUbi')].map(b=>b.dataset.pos)`), ['A1.1']);
  const anchoMat = await C.ev(`({ pagina: document.documentElement.scrollWidth, vista: window.innerWidth })`);
  assert.ok(anchoMat.pagina <= anchoMat.vista + 1, JSON.stringify(anchoMat));
  await C.captura(path.join(CAPTURAS, 'tejidos-celular-por-material.png'));
  await C.ev(`document.querySelector('#tjUbicaciones .tjUbi').click(); 1`); await sleep(1000);
  assert.strictEqual(await C.ev(`document.getElementById('tjDetalle').style.display`), 'flex');
  assert.ok(/BMW X5/.test(await C.ev(`document.getElementById('tjDetBody').textContent`)), 'el detalle muestra el vehículo');
  await C.ev(`document.getElementById('tjDetCerrar').click(); 1`);
  ok('celular: "Por material" muestra vehículo, material y cantidad (1); al tocarlo, sus posiciones (A1.1), y de ahí la ficha');

  // el mapa: abrir la posición, ver la foto y darle salida
  await C.ev(`document.querySelector('.tjTab[data-tab="mapa"]').click(); 1`); await sleep(200);
  assert.strictEqual(await C.ev(`document.querySelector('.tjVista[data-tab="mapa"]').hidden`), false);
  assert.strictEqual(await C.ev(`document.querySelector('.tjVista[data-tab="material"]').hidden`), true);
  await C.ev(`document.querySelector('.tjCelda.ocupada[data-pos="A1.1"]').click(); 1`); await sleep(1200);
  assert.strictEqual(await C.ev(`document.getElementById('tjDetalle').style.display`), 'flex');
  assert.ok(await C.ev(`(()=>{ const i=document.querySelector('#tjFotoDet img'); return !!i && i.naturalWidth>0; })()`), 'no se vio la foto');
  assert.ok(/Juan Pérez/.test(await C.ev(`document.getElementById('tjDetBody').textContent`)));
  await C.captura(path.join(CAPTURAS, 'tejidos-celular-detalle.png'));
  await C.ev(`document.getElementById('tjDetSalida').click(); 1`); await sleep(1000);
  assert.strictEqual(await C.ev(`document.querySelector('.tjCelda[data-pos="A1.1"]').classList.contains('libre')`), true);
  ok('celular: tocar A1.1 muestra sus datos y la foto del calentamiento; "Dar salida" la deja libre');
  assert.ok(/vacío/.test(await C.ev(`document.getElementById('tjMateriales').textContent`)), '"Por material" se actualiza con la salida');

  // historial: la entrada y la salida, con la foto, y descarga a Excel
  await C.ev(`document.querySelector('.tjTab[data-tab="historial"]').click(); 1`); await sleep(900);
  const filasH = await C.ev(`[...document.querySelectorAll('#tjHist tbody tr')].map(tr=>tr.innerText.replace(/\\s+/g,' ').trim())`);
  assert.strictEqual(filasH.length, 2, JSON.stringify(filasH));
  assert.ok(/Salida/.test(filasH[0]) && /A1\.1/.test(filasH[0]) && /estuvo/.test(filasH[0]), filasH[0]);
  assert.ok(/Entrada/.test(filasH[1]) && /Juan Pérez/.test(filasH[1]) && /12\.5/.test(filasH[1]) && /Operario Zund/.test(filasH[1]), filasH[1]);
  assert.strictEqual(await C.ev(`document.getElementById('tjBuscarRack').hidden`), true, 'el buscador del rack no va en el historial');
  const anchoH = await C.ev(`({ pagina: document.documentElement.scrollWidth, vista: window.innerWidth })`);
  assert.ok(anchoH.pagina <= anchoH.vista + 1, 'la tabla del historial no puede ensanchar la página: ' + JSON.stringify(anchoH));
  await C.captura(path.join(CAPTURAS, 'tejidos-celular-historial.png'));
  await C.ev(`document.querySelector('#tjHist .tjVerFoto').click(); 1`); await sleep(1000);
  assert.ok(await C.ev(`(()=>{ const i=document.querySelector('#tjFotoDet img'); return !!i && i.naturalWidth>0; })()`), 'no se vio la foto desde el historial');
  assert.strictEqual(await C.ev(`document.getElementById('tjDetAcciones').style.display`), 'none', 'desde el historial no se da salida ni se reimprime');
  await C.ev(`document.getElementById('tjDetCerrar').click(); 1`);
  // filtros: solo salidas; buscar algo que no está
  await C.ev(`{ const s=document.getElementById('tjHistEvento'); s.value='salida'; s.dispatchEvent(new Event('change')); } 1`); await sleep(600);
  assert.strictEqual(await C.ev(`document.querySelectorAll('#tjHist tbody tr').length`), 1);
  await C.ev(`{ const t=document.getElementById('tjHistTexto'); t.value='nadie-asi'; t.dispatchEvent(new Event('input')); } 1`); await sleep(900);
  assert.ok(/No hay movimientos/.test(await C.ev(`document.getElementById('tjHist').textContent`)));
  await C.ev(`{ const t=document.getElementById('tjHistTexto'); t.value=''; t.dispatchEvent(new Event('input')); const s=document.getElementById('tjHistEvento'); s.value='movimientos'; s.dispatchEvent(new Event('change')); } 1`); await sleep(900);
  await C.ev(`window.__xlsx = null; { const c0 = URL.createObjectURL; URL.createObjectURL = b=>{ if(/spreadsheetml/.test(b.type)) window.__xlsx = b; return c0(b); }; } document.getElementById('tjHistExcel').click(); 1`); await sleep(1000);
  const hojaH = await C.ev(`(async()=>{ const z = await JSZip.loadAsync(window.__xlsx); return z.file('xl/worksheets/sheet1.xml').async('string'); })()`);
  assert.ok(hojaH.includes('>Responsables<') && hojaH.includes('>Juan Pérez<') && hojaH.includes('>600039736<') && hojaH.includes('<autoFilter ref="A1:N3"/>'), 'Excel del historial mal armado');
  ok('historial: entrada y salida (con cuánto estuvo), foto desde la tabla, filtros por movimiento y texto, y Excel');

  // ---------- en la PC: Lista de corte de Tejidos ----------
  await C.send('Emulation.setDeviceMetricsOverride', { width: 1536, height: 820, deviceScaleFactor: 1, mobile: false });
  await C.ev(`document.getElementById('tabOrdenes').click(); 1`); await sleep(900);
  const enc = await C.ev(`[...document.querySelectorAll('#ordTableWrap thead th')].map(t=>t.textContent.trim()).filter(Boolean).join('|')`);
  assert.strictEqual(enc, 'CodMat|Descripción|Tamaño|Cantidad|Con stock|Falta|Vehículo');
  // el que no tiene tamaño: "Asignar"
  await C.ev(`document.querySelector('[data-asignar="600051455"]').click(); 1`); await sleep(200);
  await C.ev(`const s=document.querySelector('.tjTamSel'); s.value='G'; s.dispatchEvent(new Event('change')); 1`); await sleep(1000);
  assert.strictEqual(await C.ev(`[...document.querySelectorAll('#ordTableWrap tr.msFila')].find(tr=>tr.cells[0].textContent.trim()==='600051455').cells[2].textContent.trim()`), 'G');
  await C.captura(path.join(CAPTURAS, 'tejidos-lista.png'));
  // tocar la fila lleva a dar entrada con ese tejido elegido
  await C.ev(`[...document.querySelectorAll('#ordTableWrap tr.msFila')].find(tr=>tr.cells[0].textContent.trim()==='600051455').click(); 1`); await sleep(1200);
  assert.strictEqual(await C.ev(`appVistaActual`), 'rack');
  assert.ok((await C.ev(`document.getElementById('tjTejido').value`)).startsWith('600051455'));
  assert.ok(/Va a la posición B1\.1/.test(await C.ev(`document.getElementById('tjElegido').textContent`)));
  await C.captura(path.join(CAPTURAS, 'tejidos-rack-pc.png'));
  ok('PC: Lista de corte con Tamaño; "Asignar" G al que no tenía; tocar la fila lleva al Rack con ese tejido (va a B1.1, una G)');

  // PC, "Por material" con varios: 2 del mismo tejido y 1 de otro -> cantidades 2 y 1, y sus posiciones
  await C.ev(`(async()=>{
    const jpg = new Blob([new Uint8Array([0xFF,0xD8,0xFF,0xE0, ...new Array(300).fill(7)])], { type: 'image/jpeg' });
    for(const c of ['600039736', '600039736', '600051455']){
      const f = (await tjPedir('POST', '/fotos', jpg, { 'Content-Type': 'image/jpeg' })).foto;
      await tjPedir('POST', '/entrada', { codmat: c, responsables: 'Ana Gómez', resistencia1: '11.9', foto: f });
    }
    await tjRender(true); document.querySelector('.tjTab[data-tab="material"]').click();
  })()`); await sleep(800);
  const cantidades = await C.ev(`[...document.querySelectorAll('#tjMateriales .tjMat')].map(b=>b.dataset.codmat + '=' + b.querySelector('.tjMatCant').textContent)`);
  assert.deepStrictEqual(cantidades.sort(), ['600039736=2', '600051455=1']);
  await C.ev(`document.querySelector('.tjMat[data-codmat="600039736"]').click(); 1`); await sleep(300);
  assert.deepStrictEqual(await C.ev(`[...document.querySelectorAll('#tjUbicaciones .tjUbi')].map(b=>b.dataset.pos)`), ['A1.1', 'A1.2']);
  await C.ev(`document.getElementById('tjFiltro').value='600051455'; document.getElementById('tjFiltro').dispatchEvent(new Event('input')); 1`);
  assert.strictEqual(await C.ev(`document.querySelectorAll('#tjMateriales .tjMat').length`), 1, 'el buscador filtra los materiales');
  await C.ev(`document.getElementById('tjFiltro').value=''; document.getElementById('tjFiltro').dispatchEvent(new Event('input')); 1`);
  await C.captura(path.join(CAPTURAS, 'tejidos-por-material-pc.png'));
  ok('PC: "Por material" suma por CodMat (2 y 1), muestra las posiciones del elegido (A1.1, A1.2) y el buscador filtra');
  // en la PC, "Reimprimir sticker" sí lo saca (sin Zebra: PDF)
  await C.ev(`window.__pdf = null; window.__aviso = null; window.alert = m=>{ window.__aviso = m; }; 1`);
  await C.ev(`document.querySelector('#tjUbicaciones .tjUbi[data-pos="A1.1"]').click(); 1`); await sleep(800);
  await C.ev(`document.getElementById('tjDetReimp').click(); 1`); await sleep(1500);
  assert.ok(/sticker_tejido_A1\.1_/.test(await C.ev(`window.__pdf`)), 'en la PC "Reimprimir sticker" tiene que sacarlo: ' + await C.ev(`window.__aviso`));
  await C.ev(`document.getElementById('tjDetCerrar').click(); 1`);
  ok('PC: "Reimprimir sticker" saca el sticker de una entrada hecha desde el celular');

  // otra persona (sin PC abierta) da entrada desde el celular: nadie imprime y el celular lo dice; ni la PC de OTRO usuario recibe nada
  const sinPc = await api(p.url, 'POST', '/api/tejidos/entrada', { token: adm, area: 'tejidos', cuerpo: { codmat: '600039736', responsables: 'Ana', resistencia1: '1', foto: fotoSubida, celular: true } });
  assert.strictEqual(sinPc.s, 200, JSON.stringify(sinPc.d)); assert.strictEqual(sinPc.d.impresoEnPc, 0);
  await sleep(500); assert.strictEqual((await PC.ev(`window.__impresos`)).length, 1, 'la PC de otro usuario no debe imprimir lo de Hfrodriguez');
  // lo hecho desde la PC misma (sin la marca de celular) no pide imprimir a nadie más
  const dePc = await api(p.url, 'POST', '/api/tejidos/entrada', { token: adm, area: 'tejidos', cuerpo: { codmat: '600039736', responsables: 'Ana', resistencia1: '1', foto: fotoSubida } });
  assert.strictEqual(dePc.d.impresoEnPc, undefined);
  // con Zebra propia (Beto=ZEBRA_DE_BETO en el .env) el celular imprime solo, por el puente: nadie más es avisado
  const beto = await login(p.url, 'Beto', 'beto123');
  const propia = await api(p.url, 'POST', '/api/tejidos/entrada', { token: beto, area: 'tejidos', cuerpo: { codmat: '600039736', responsables: 'Beto', resistencia1: '1', foto: fotoSubida, celular: true } });
  assert.strictEqual(propia.s, 200, JSON.stringify(propia.d)); assert.strictEqual(propia.d.imprimirAqui, true); assert.strictEqual(propia.d.impresoEnPc, undefined);
  ok('otro usuario sin PC abierta: nadie imprime y el celular lo sabe; la PC de otro usuario no recibe nada; lo hecho desde la PC no pide imprimir a nadie');
  assert.deepStrictEqual(C.errores, [], 'errores de JavaScript: ' + C.errores.join(' | '));
  ok('sin errores de JavaScript');
});
