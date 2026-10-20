// Nombre correcto de los componentes (ODATA_Fullkit): en SAGA muchos códigos
// 0000000006… traen un nombre que no es el original ("ZHAL BUFFER ACEROS CO")
// y, como Mallas y Tejidos se filtran por el nombre, se perdían de la lista.
// Con el SQL simulado (sql-falso.js), que contesta las consultas reales.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { ok, prepararCopia, borrarCopia, arrancarPuente, api, login, prueba } = require('./comun');

prueba('Nombres de componentes desde ODATA_Fullkit (Mallas y Tejidos)', async limpiar=>{
  const dir = prepararCopia('nombres'); limpiar(()=>borrarCopia(dir));
  fs.mkdirSync(path.join(dir, 'server', 'node_modules', 'mssql'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'sql-falso.js'), path.join(dir, 'server', 'node_modules', 'mssql', 'index.js'));
  const m = (Ordem_Serial, CodMat, Descricao) => ({ Ordem_Serial, Operation: '2900', unMed: 'UND', CodMat, Descricao, m2: '1.000' });
  const datosSql = path.join(dir, 'sql-falso.json');
  const escribir = extra => fs.writeFileSync(datosSql, JSON.stringify(Object.assign({
    saga: [],
    calendario: ['41','42','43','44','45'].map(orden=>({ orden, puesto: '01CORTE', vehiculo: 'BMW X5 4D UTILITY' })),
    mallas: [
      m('41', '000000000600054110', 'ZHAL BUFFER ACEROS CO'),  // en Fullkit es un PVTE -> Tejidos
      m('42', '000000000600039736', 'BUFFER ZHAL CO01'),       // en Fullkit es una malla TNT (código guardado CON ceros)
      m('43', '000000000600012661', 'MAAC.1244.09.00 B'),      // no es malla ni tejido: afuera
      m('44', '000000000600011111', 'ZHAL BUFFER ACEROS CO'),  // no está en Fullkit: sigue con el nombre de SAGA (afuera)
      m('45', '000000000600050001', 'PVTE 000 MERC GLS 450'),  // ya tenía bien el nombre en SAGA
    ],
    fullkit: [
      { COMPONENTE: '600054110', DESCRIP_COMPONENTE: 'PVTE0076.1110.05.00.B' },
      { COMPONENTE: '000000000600039736', DESCRIP_COMPONENTE: 'MTNTF0036.2000.01.00' },
      { COMPONENTE: '600012661', DESCRIP_COMPONENTE: 'MAAC.1244.09.00 B' },
    ],
  }, extra)));
  escribir({});
  const p = await arrancarPuente(dir, 5113, { DB_SERVER: 'falso', CAL_DB_SERVER: 'falso', FAKE_SQL_DATOS: datosSql,
    FULLKIT_DB_SERVER: 'falso', FULLKIT_DB_DATABASE: 'FullkitFalso', LISTA_FORZAR_CADA_S: '0', COMPONENTES_CACHE_S: '0' });
  limpiar(()=>p.cerrar());
  const adm = await login(p.url, 'Hfrodriguez', 'admin123');
  const lista = async (area, forzar) => { const r = await api(p.url, 'GET', '/api/ordenes-pendientes' + (forzar ? '?forzar=1' : ''), { token: adm, area }); assert.strictEqual(r.s, 200, JSON.stringify(r.d)); return r.d.ordenes; };
  const ver = filas => filas.map(f=>`${f.CodMat}=${f.Descricao}`).sort();

  assert.deepStrictEqual(ver(await lista('tejidos')), ['600050001=PVTE 000 MERC GLS 450', '600054110=PVTE0076.1110.05.00.B']);
  assert.deepStrictEqual(ver(await lista('mallas')), ['600039736=MTNTF0036.2000.01.00']);
  ok('"ZHAL BUFFER ACEROS CO" que en Fullkit es un PVTE entra a Tejidos con su nombre correcto; "BUFFER ZHAL CO01" (TNT) entra a Mallas');
  ok('el código se encuentra en Fullkit guardado con o sin los ceros; MAAC y los que Fullkit no conoce siguen afuera');

  // si ODATA_Fullkit no responde: no se cae nada, se usan los nombres de SAGA (como antes)
  escribir({ fullkitCaido: true });
  assert.deepStrictEqual(ver(await lista('tejidos', true)), ['600050001=PVTE 000 MERC GLS 450']);
  assert.deepStrictEqual(await lista('mallas', true), []);
  assert.ok(/no se pudo consultar ODATA_Fullkit/.test(p.log()));
  ok('ODATA_Fullkit caído: la lista sigue funcionando con los nombres de SAGA, y queda el aviso en la ventana del puente');
});
