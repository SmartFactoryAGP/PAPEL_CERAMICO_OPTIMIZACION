// Cambiar de área mientras la Lista de corte todavía está llegando: la respuesta
// lenta de una área NO se pinta en la otra (bug: en Mallas salía la lista de
// Tejidos hasta cambiar de pestaña). También: el Rack de Tejidos se ve sin esperar la lista.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { ok, sleep, prepararCopia, borrarCopia, arrancarPuente, abrirChrome, prueba } = require('./comun');

prueba('Navegador: cambiar de área con la Lista de corte en camino', async limpiar=>{
  const dir = prepararCopia('nav-cambio-area'); limpiar(()=>borrarCopia(dir));
  fs.mkdirSync(path.join(dir, 'server', 'node_modules', 'mssql'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'sql-falso.js'), path.join(dir, 'server', 'node_modules', 'mssql', 'index.js'));
  const m = (Ordem_Serial, CodMat, Descricao) => ({ Ordem_Serial, Operation: '2900', unMed: 'UND', CodMat, Descricao, m2: '1.000' });
  const datosSql = path.join(dir, 'sql-falso.json');
  fs.writeFileSync(datosSql, JSON.stringify({ saga: [], calendario: ['61','62'].map(orden=>({ orden, puesto: '11ZUND', vehiculo: 'BMW X5' })),
    mallas: [m('61', '000000000600039736', 'PUTE0062.1244.14.00.F'), m('62', '000000000600011111', 'TNT MALLA PRUEBA')] }));
  const p = await arrancarPuente(dir, 5127, { DB_SERVER: 'falso', CAL_DB_SERVER: 'falso', FAKE_SQL_DATOS: datosSql });
  limpiar(()=>p.cerrar());
  const chrome = await abrirChrome(9411); limpiar(()=>chrome.cerrar());
  const C = await chrome.pagina();
  await C.ir(p.url); await C.entrar('Hfrodriguez', 'admin123', 'mallas');
  await C.ev(`document.getElementById('tabOrdenes').click(); 1`); await sleep(1500);
  assert.ok(/TNT/.test(await C.ev(`document.getElementById('ordTableWrap').textContent`)), 'Mallas muestra su lista');

  // la lista de Tejidos tarda 2,5 s en llegar; mientras, se vuelve a Mallas
  await C.ev(`{ const f = window.fetch; window.fetch = (u, o)=>{ const h = (o && o.headers) || {};
    const lento = String(u).includes('/api/ordenes-pendientes') && h['x-area']==='tejidos';
    return lento ? new Promise(r=>setTimeout(r, 2500)).then(()=>f(u, o)) : f(u, o); }; } 1`);
  await C.ev(`document.querySelector('[data-area-btn="tejidos"]').click(); 1`); await sleep(300);
  await C.ev(`document.querySelector('[data-area-btn="mallas"]').click(); 1`); await sleep(300);
  await C.ev(`document.getElementById('tabOrdenes').click(); 1`);
  await sleep(4000); // llegó la de Tejidos (y se descartó)
  const texto = await C.ev(`document.getElementById('ordTableWrap').textContent`);
  assert.ok(/TNT/.test(texto) && !/PUTE/.test(texto), 'Mallas mostró la lista de Tejidos: ' + texto.slice(0, 200));
  assert.strictEqual(await C.ev(`ordUltimaLista.area`), 'mallas');
  assert.strictEqual(await C.ev(`ordenesPendientes.every(o=>!/PUTE/.test(o.Descricao||''))`), true);
  ok('Tejidos tarda en responder, se vuelve a Mallas: la lista de Mallas queda intacta (la de Tejidos se descarta)');

  // y yendo a Tejidos de verdad, sí muestra la suya
  await C.ev(`document.querySelector('[data-area-btn="tejidos"]').click(); document.getElementById('tabOrdenes').click(); 1`);
  await sleep(4000);
  assert.ok(/PUTE/.test(await C.ev(`document.getElementById('ordTableWrap').textContent`)));
  assert.strictEqual(await C.ev(`ordUltimaLista.area`), 'tejidos');
  ok('en Tejidos se ve la lista de Tejidos');
});
