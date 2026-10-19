// La app de verdad en Chrome: Lista de corte de papel con las columnas
// nuevas, ingreso rápido bloqueado, y el flujo de Aprobaciones entre dos
// personas en dos PCs (con el SQL Server simulado de sql-falso.js).
// Guarda capturas en tools/pruebas/capturas/.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { ok, sleep, prepararCopia, borrarCopia, arrancarPuente, api, login, abrirChrome, prueba } = require('./comun');
const CAPTURAS = path.join(__dirname, 'capturas');

prueba('Navegador: Lista de corte de papel y Aprobaciones de ZFER', async limpiar=>{
  fs.mkdirSync(CAPTURAS, { recursive: true });
  const dir = prepararCopia('nav-aprobaciones'); limpiar(()=>borrarCopia(dir));
  fs.mkdirSync(path.join(dir, 'server', 'node_modules', 'mssql'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'sql-falso.js'), path.join(dir, 'server', 'node_modules', 'mssql', 'index.js'));
  const fila = (Ordem_Serial, Operation, ClaveModelo) => ({ Ordem_Serial, Operation, Centro_Trabalho: '01CORTE', ClaveModelo, CodMat: '4005', Name: 'Parabrisas', ZTipo: 'ZPAR', Descricao: 'Vidrio laminado', ARCHIVO: `\\\\srv\\dxf\\${Ordem_Serial}.dxf` });
  const datosSql = path.join(dir, 'sql-falso.json');
  fs.writeFileSync(datosSql, JSON.stringify({
    saga: [fila('1001', '0132', 'CHEV-ONIX'), fila('1002', '0132', 'CHEV-TRACKER'), fila('1003', '0132', 'REN-DUSTER'), fila('1007', '0132', 'CHEV-TRACKER'),
           fila('1004', '0101', 'BMW-X5'), fila('1005', '0101', 'BMW-X5')],
    calendario: [
      { orden: '1001', puesto: '01CORTE', zfer: '70011111', planCurve: 'CURVE', nivel: '05', vehiculo: 'TOYOTA COROLLA 4D SEDAN' },
      { orden: '1002', puesto: '01CORTE', zfer: '70022222', planCurve: 'CURVE', nivel: '03', vehiculo: 'STK BRONCO 1 4D UTILITY' },
      { orden: '1007', puesto: '02CNC',   zfer: '70022222', planCurve: 'CURVE', nivel: '04', vehiculo: 'STK BRONCO 1 4D UTILITY' },
      { orden: '1003', puesto: '01CORTE', zfer: '70033333', planCurve: 'FLAT',  nivel: '07', vehiculo: 'VOLKSWAGEN CRAFTER VAN' },
      { orden: '1004', puesto: '02CNC',   zfer: '70005171', planCurve: 'CURVE', nivel: '06', vehiculo: 'BMW X5 4D UTILITY' },
      { orden: '1005', puesto: '02CNC',   zfer: '70005171', planCurve: 'CURVE', nivel: '02', vehiculo: 'BMW X5 4D UTILITY' },
    ],
  }));
  const p = await arrancarPuente(dir, 5109, { DB_SERVER: 'falso', CAL_DB_SERVER: 'falso', FAKE_SQL_DATOS: datosSql, ZFER_LISTA_ESPECIAL: '70005171' });
  limpiar(()=>p.cerrar());
  const adm = await login(p.url, 'Hfrodriguez', 'admin123');
  await api(p.url, 'POST', '/api/usuarios', { token: adm, cuerpo: { usuario: 'Operario Corte', clave: 'corte1', permisos: { papel: ['ordenes', 'aprobaciones'] } } });
  await api(p.url, 'POST', '/api/usuarios', { token: adm, cuerpo: { usuario: 'Jefe Calidad', clave: 'calidad1', permisos: { papel: ['aprobar'] } } });

  const chrome = await abrirChrome(9405); limpiar(()=>chrome.cerrar());
  const A = await chrome.pagina(), B = await chrome.pagina();

  // ---------- Lista de corte ----------
  await A.ir(p.url); await A.entrar('Operario Corte', 'corte1', 'papel');
  // sin tocar ningún botón: la lista se trae sola al abrir la pestaña
  await A.ev(`document.getElementById('tabOrdenes').click(); 1`); await sleep(700);
  assert.strictEqual(await A.ev(`document.getElementById('ordRefreshBtn').offsetParent===null`), true, 'el operario no tiene que ver el botón de actualizar');
  const hora = await A.ev(`document.getElementById('ordBridgeStatus').textContent`);
  assert.ok(/^Lista de las .+ · se actualiza sola a las /.test(hora), hora);
  ok(`la lista se carga sola al abrir; el operario no tiene botón de actualizar y ve: "${hora.trim()}"`);
  const encabezados = await A.ev(`[...document.querySelectorAll('#ordTableWrap thead th')].map(t=>t.textContent.trim()).join('|')`);
  assert.ok(/^Ordem_Serial\|Vehículo\|/.test(encabezados) && /ZFER\|PlanCURVE\|NivelAGP/.test(encabezados) && !/CodMat/.test(encabezados), encabezados);
  const filasA = await A.ev(`[...document.querySelectorAll('#ordTableWrap tbody tr')].map(tr=>tr.cells[0].textContent.trim()).sort().join(',')`);
  assert.strictEqual(filasA, '1001,1004');
  assert.ok((await A.ev(`document.querySelector('#ordTableWrap tr[data-orden="1004"]').cells[1].textContent`)).includes('BMW X5'));
  ok(`Lista de corte: Vehículo al lado de la orden, sin CodMat, con ZFER/PlanCURVE/NivelAGP; salen solo 1001 (CURVE 05) y 1004 (X5 CURVE 06)`);

  // botón Excel en papel: las columnas de la tabla, y NivelAGP "05" sin perder el cero
  await A.ev(`window.__xlsx = null; { const c0 = URL.createObjectURL; URL.createObjectURL = b=>{ if(/spreadsheetml/.test(b.type)) window.__xlsx = b; return c0(b); }; } document.getElementById('ordExcelBtn').click(); 1`); await sleep(800);
  const hojaPapel = await A.ev(`(async()=>{ const z = await JSZip.loadAsync(window.__xlsx); return z.file('xl/worksheets/sheet1.xml').async('string'); })()`);
  assert.ok(hojaPapel.includes('<t xml:space="preserve">Vehículo</t>') && hojaPapel.includes('<t xml:space="preserve">05</t>') && hojaPapel.includes('<autoFilter ref="A1:L3"/>'), 'Excel de papel mal armado');
  ok('botón Excel en papel: mismas columnas que la tabla, 2 órdenes, NivelAGP "05" como texto (no pierde el cero)');

  // el operario NO ve los ajustes técnicos; el cursor ya está en "Agregar orden"
  assert.strictEqual(await A.ev(`document.getElementById('ordAjustesConexion').hidden && document.getElementById('ordSimRack').offsetParent===null && document.getElementById('ordBridgeUrl').offsetParent===null`), true);
  assert.strictEqual(await A.ev(`document.activeElement && document.activeElement.id`), 'ordIngresoRapidoInput');
  const arriba = await A.ev(`document.getElementById('ordIngresoRapidoInput').getBoundingClientRect().top < document.getElementById('ordTableWrap').getBoundingClientRect().top`);
  assert.ok(arriba, 'agregar orden tiene que estar arriba de la lista');
  // tocar la fila la pasa al lote
  await A.ev(`document.querySelector('#ordTableWrap tr[data-orden="1001"] td:nth-child(3)').click(); 1`);
  assert.strictEqual(await A.ev(`[...ordEnLoteIds].join(',')`), '1001');
  await A.captura(path.join(CAPTURAS, 'lista-corte-papel.png'));
  // la lista es lo principal: más de la mitad del ancho en 1536 px (1920 al 125%); Ejecutar/Confirmar al pie del lote
  await A.send('Emulation.setDeviceMetricsOverride', { width: 1536, height: 820, deviceScaleFactor: 1, mobile: false }); await sleep(300);
  const anchoLista = await A.ev(`document.querySelector('#ordStagePanel > .stagepanel').getBoundingClientRect().width / window.innerWidth`);
  assert.ok(anchoLista > 0.55, `la lista ocupa solo el ${Math.round(anchoLista*100)}% del ancho`);
  assert.strictEqual(await A.ev(`!!document.querySelector('.lotePanel #ordRunBtn') && !!document.querySelector('.lotePanel #ordConfirmBtn')`), true);
  assert.strictEqual(await A.ev(`document.querySelector('#ordLoteWrap tbody tr').cells.length`), 4, 'el lote tiene que ser compacto: orden, vehículo, estado, quitar');
  await A.captura(path.join(CAPTURAS, 'lista-corte-papel-1536.png'));
  await A.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false }); await sleep(200);
  await A.ev(`ordQuitarDelLote('1001'); 1`);
  ok('operario: sin "Simular el Rack" ni dirección/clave del puente; "Agregar orden" arriba de la lista y con el cursor listo; tocar una fila la pasa al lote');

  await A.ev(`const i=document.getElementById('ordIngresoRapidoInput'); i.value='1002'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); 1`); await sleep(500);
  const msg = await A.ev(`document.getElementById('ordIngresoRapidoResultado').textContent`);
  assert.ok(/no puede entrar/.test(msg) && /70022222/.test(msg), msg);
  ok(`ingreso rápido de la 1002: "${msg.trim()}"`);

  // ---------- el operario pide la aprobación ----------
  await A.ev(`document.getElementById('tabAprobaciones').click(); 1`); await sleep(700);
  const cand = await A.ev(`[...document.querySelectorAll('.apCand b')].map(b=>b.textContent).join(',')`);
  assert.strictEqual(cand, '70022222,70005171'); // el de más órdenes primero
  await A.ev(`document.querySelector('[data-pedir="70022222"]').click(); document.getElementById('apNota').value='Tracker lleva papel en la zona del sensor de lluvia';
    document.getElementById('apSolicitarBtn').click(); 1`); await sleep(700);
  assert.ok((await A.ev(`document.getElementById('apFormMsg').textContent`)).includes('pendiente'));
  assert.strictEqual(await A.ev(`document.querySelectorAll('#apLista tbody tr').length`), 1);
  assert.strictEqual(await A.ev(`document.querySelectorAll('#apLista [data-decision]').length`), 0, 'el operario no tiene botones de aprobar');
  await A.captura(path.join(CAPTURAS, 'aprobaciones-operario.png'));
  ok('el operario elige el ZFER de la lista "Sin aprobar", explica por qué y lo pide; no ve botones de aprobar');

  // ---------- el jefe de calidad aprueba desde otra PC ----------
  await B.ir(p.url); await B.entrar('Jefe Calidad', 'calidad1', 'papel');
  assert.strictEqual(await B.ev(`appVistaActual`), 'aprobaciones', 'quien solo aprueba entra directo a Aprobaciones');
  await sleep(500);
  assert.strictEqual(await B.ev(`document.getElementById('apBadge').hidden ? '' : document.getElementById('apBadge').textContent`), '1');
  const tabsB = await B.ev(`[...document.querySelectorAll('.viewTab')].filter(t=>!t.hidden).map(t=>t.childNodes[0].textContent.trim()).join(', ')`);
  assert.strictEqual(tabsB, 'Aprobaciones');
  await B.captura(path.join(CAPTURAS, 'aprobaciones-jefe.png'));
  await B.ev(`document.querySelector('#apLista [data-decision="aprobar"]').click(); 1`); await sleep(900);
  ok(`el jefe entra directo a Aprobaciones (solo ve: ${tabsB}), con "1" pendiente en la pestaña, y aprueba`);

  // A lo ve en vivo, y la Lista de corte ya las trae
  let estadoA; for(let i=0; i<30; i++){ estadoA = await A.ev(`document.querySelector('#apKpiAprob').textContent`); if(estadoA==='1') break; await sleep(100); }
  assert.strictEqual(estadoA, '1', 'en la PC del operario no se vio la aprobación en vivo');
  assert.strictEqual(await B.ev(`document.getElementById('apBadge').hidden`), true);
  // la Lista de corte del operario ya se puso al día sola (aviso en vivo), sin botón
  await A.ev(`document.getElementById('tabOrdenes').click(); 1`); await sleep(500);
  const filasDespues = await A.ev(`[...document.querySelectorAll('#ordTableWrap tbody tr')].map(tr=>tr.cells[0].textContent.trim()).sort().join(',')`);
  assert.strictEqual(filasDespues, '1001,1002,1004,1007');
  await A.captura(path.join(CAPTURAS, 'lista-corte-aprobado.png'));
  ok('la aprobación llega en vivo a la PC del operario, y su Lista de corte ya trae las 2 órdenes de ese ZFER (1002 y 1007) sin tocar nada');

  // el administrador sí ve los ajustes técnicos (plegados)
  const C = await chrome.pagina();
  await C.ir(p.url); await C.entrar('Hfrodriguez', 'admin123', 'papel');
  await C.ev(`document.getElementById('tabOrdenes').click(); 1`); await sleep(300);
  assert.strictEqual(await C.ev(`document.getElementById('ordAjustesConexion').hidden`), false);
  assert.strictEqual(await C.ev(`document.getElementById('ordRefreshBtn').offsetParent!==null`), true);
  await C.captura(path.join(CAPTURAS, 'lista-corte-admin.png'));
  ok('el administrador sí ve "Forzar actualización desde SQL" y "Ajustes de conexión" (plegado)');

  const errores = A.errores.concat(B.errores, C.errores);
  assert.deepStrictEqual(errores, [], 'errores de JavaScript en la página: ' + errores.join(' | '));
  ok('sin errores de JavaScript');
});
