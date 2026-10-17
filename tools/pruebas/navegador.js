// La app de verdad en Chrome: dos PCs a la vez, carga masiva, tabla legible,
// administración de usuarios y permisos. Guarda capturas en tools/pruebas/capturas/.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { ok, sleep, prepararCopia, borrarCopia, arrancarPuente, abrirChrome, prueba } = require('./comun');
const CAPTURAS = path.join(__dirname, 'capturas');
const PU = '100005343';

prueba('Navegador: inventario en vivo, masivo y usuarios', async limpiar=>{
  fs.mkdirSync(CAPTURAS, { recursive: true });
  const dir = prepararCopia('navegador'); limpiar(()=>borrarCopia(dir));
  const p = await arrancarPuente(dir, 5104); limpiar(()=>p.cerrar());
  const chrome = await abrirChrome(9404); limpiar(()=>chrome.cerrar());
  const A = await chrome.pagina(), B = await chrome.pagina();   // dos PCs (perfiles aislados)

  // ---------- ingreso: sin acceso anónimo ----------
  await A.ir(p.url);
  assert.strictEqual(await A.ev(`!!document.getElementById('authRackOnlyBtn')`), false);
  await A.entrar('Hfrodriguez', 'admin123', 'tecoflex');
  await A.ev(`document.getElementById('tabRack').click(); 1`); await sleep(800);
  await B.ir(p.url); await B.entrar('Ana', 'ana123', 'tecoflex');
  await B.ev(`document.getElementById('tabRack').click(); 1`); await sleep(800);
  assert.strictEqual(await A.ev(`document.getElementById('liveTag').textContent.trim()`), 'En vivo');
  ok('sin opción de entrar sin contraseña; las dos PCs "En vivo"');

  // ---------- carga masiva en A ----------
  const resumen = pg => pg.ev(`document.getElementById('invSelResumen').innerText`);
  const registrar = pg => pg.ev(`(async()=>{ await invConfirmar(); return document.getElementById('invStatus').innerText; })()`);
  await A.ev(`document.querySelector('[data-tipo="entrada"]').click(); document.querySelector('[data-mats="todos"]').click();
    const r=document.getElementById('invRango'); r.value='9-20'; r.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    document.getElementById('invCantidad').value=10; document.getElementById('invCantidad').dispatchEvent(new Event('input')); document.getElementById('invAgregarBtn').click(); 1`);
  assert.strictEqual(await A.ev(`invCarrito.length`), 5*12 + 3); // 5 materiales 9..20 + X5 (12,16,20)
  ok('entrada masiva: todos los materiales, rango "9-20" -> 63 líneas (el X5 solo con sus medidas)');
  await registrar(A);
  // B lo ve sin recargar
  let enB; for(let i=0; i<40; i++){ enB = await B.ev(`document.querySelector('td[data-material="${PU}"][data-medida="9"] b')?.textContent`); if(enB==='10') break; await sleep(50); }
  assert.strictEqual(enB, '10');
  ok('lo que registró A apareció en B al instante, sin recargar');

  // salida arrastrando un bloque en la tabla de A
  const centro = sel => A.ev(`(()=>{ const r=document.querySelector('${sel}').getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`);
  await A.ev(`document.querySelector('[data-tipo="salida"]').click(); document.querySelector('[data-mats="ninguno"]').click(); 1`);
  const a = await centro('td[data-material="100003239"][data-medida="9"]'), b = await centro('td[data-material="100003550"][data-medida="12"]');
  await A.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', clickCount: 1 });
  for(let k=1; k<=5; k++) await A.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x+(b.x-a.x)*k/5, y: a.y+(b.y-a.y)*k/5, button: 'left', buttons: 1 });
  await A.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 });
  assert.strictEqual(await A.ev(`document.querySelectorAll('#invMatriz td.sel').length`), 3*4);
  await A.ev(`document.getElementById('invCantidad').value=4; document.getElementById('invCantidad').dispatchEvent(new Event('input')); document.getElementById('invAgregarBtn').click(); 1`);
  // la celda dice el stock real y lo pendiente, sin ambigüedad
  const celda = await A.ev(`document.querySelector('td[data-material="100003239"][data-medida="9"]').innerText.replace(/\\s+/g,' ').trim()`);
  assert.strictEqual(celda, '10 sale 4 → 6');
  ok(`salida arrastrando un bloque 3×4 = 12 posiciones; la celda se lee "${celda}"`);
  await A.captura(path.join(CAPTURAS, 'inventario-carrito.png'));

  // B arma algo que A deja sin stock -> en B se marca solo
  await B.ev(`document.querySelector('[data-tipo="salida"]').click(); document.querySelector('[data-mats="ninguno"]').click(); document.querySelector('#invMateriales [data-mat="${PU}"]').click();
    document.querySelector('[data-meds="ninguna"]').click(); document.querySelector('#invMedidas [data-medida="20"]').click();
    document.getElementById('invCantidad').value=8; document.getElementById('invCantidad').dispatchEvent(new Event('input')); document.getElementById('invAgregarBtn').click(); 1`);
  await A.ev(`document.querySelector('th[data-mat="${PU}"]').click(); document.querySelector('[data-modo="todo"]').click(); document.getElementById('invAgregarBtn').click(); 1`);
  await registrar(A); await sleep(600);
  assert.ok((await B.ev(`document.querySelector('.cartRow').className`)).includes('sinStock'));
  assert.strictEqual(await B.ev(`document.getElementById('invConfirmarBtn').disabled`), true);
  ok('"Todo lo que haya" de PU en A -> en B la línea pasa sola a "falta stock" y no se puede registrar');

  // ---------- usuarios ----------
  await A.ev(`document.getElementById('tabUsuarios').click(); 1`); await sleep(700);
  await A.ev(`document.getElementById('usrNuevoBtn').click(); document.getElementById('usrNombre').value='Supervisor Mallas'; document.getElementById('usrClave').value='mallas2026';
    const f = a => document.querySelector('#usrPermisos tr[data-area="'+a+'"]');
    f('papel').querySelector('[data-vista="rack"]').click(); f('mallas').querySelector('[data-todo]').click(); 1`);
  await A.captura(path.join(CAPTURAS, 'usuarios.png'));
  await A.ev(`document.getElementById('usrGuardarBtn').click(); 1`); await sleep(800);
  assert.ok((await A.ev(`document.getElementById('usrMsg').textContent`)).includes('creado'));
  await B.ev(`document.getElementById('authLogoutBtn').click(); 1`); await sleep(500);
  await B.entrar('Supervisor Mallas', 'mallas2026', 'tecoflex');   // eligió Tecoflex, pero no tiene permiso ahí
  const areas = await B.ev(`[...document.querySelectorAll('[data-area-btn]')].filter(t=>!t.hidden).map(t=>t.textContent.trim()).join(', ')`);
  const tabs = await B.ev(`[...document.querySelectorAll('.viewTab')].filter(t=>!t.hidden).map(t=>t.textContent.trim()).join(', ')`);
  assert.strictEqual(areas, 'Papel cerámico, Mallas'); assert.strictEqual(await B.ev(`areaActualId`), 'papel'); assert.ok(!tabs.includes('Usuarios'));
  ok(`usuario creado desde la pantalla; al entrar ve solo: ${areas} (pestañas: ${tabs})`);

  const errores = A.errores.concat(B.errores);
  assert.deepStrictEqual(errores, [], 'errores de JavaScript en la página: ' + errores.join(' | '));
  ok('sin errores de JavaScript');
});
