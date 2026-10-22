// Mallas: Lista de corte por CodMat y puesto (con el stock descontado),
// entrada al rack desde Lista de corte, salida solo con permiso de Rack.
// De punta a punta con el SQL simulado (sql-falso.js), que usa los mismos
// filtros que la consulta real: Operation 2900, unMed UND, "TNT".
const fs = require('fs'), path = require('path'), assert = require('assert');
const { ok, sleep, RAIZ, prepararCopia, borrarCopia, arrancarPuente, api, login, oyente, prueba } = require('./comun');
const reglas = require(path.join(RAIZ, 'server', 'reglas-mallas.js'));

prueba('Mallas: Lista de corte por CodMat y stock', async limpiar=>{
  // ---------- la regla ----------
  assert.strictEqual(reglas.codmatCorto('000000000600019608'), '600019608');
  assert.strictEqual(reglas.codmatCorto('600019608'), '600019608');
  assert.strictEqual(reglas.unidades('2.000'), 2); assert.strictEqual(reglas.unidades('1,000'), 1); assert.strictEqual(reglas.unidades(''), 1);
  const filas = [
    { Ordem_Serial: 1, CodMat: '000000000600019608', Descricao: 'MTNTF A', Cantidad: '2.000' },  // Planeacion, 2 mallas
    { Ordem_Serial: 2, CodMat: '000000000600019608', Descricao: 'MTNTF A', Cantidad: '1.000' },  // 12P_ENSA
    { Ordem_Serial: 3, CodMat: '000000000600019608', Descricao: 'MTNTF A', Cantidad: '1.000' },  // 12P_ENSA
    { Ordem_Serial: 4, CodMat: '000000000600019608', Descricao: 'MTNTF A', Cantidad: '1.000' },  // 18INSFIN: no está en la lista
    { Ordem_Serial: 5, CodMat: '000000000600039800', Descricao: 'MTNTF B', Cantidad: '1.000' },  // 05EMPAL
  ];
  const cal = { 1: { puesto: 'Planeacion', vehiculo: 'BMW X5' }, 2: { puesto: '12P_ENSA', vehiculo: 'BMW X5' }, 3: { puesto: '12P_ENSA', vehiculo: 'BMW X5' },
                4: { puesto: '18INSFIN' }, 5: { puesto: '05EMPAL', vehiculo: 'URO VAMTAC' } };
  const r = reglas.agrupar(filas, cal, new Map([['600019608', 3]]));
  assert.deepStrictEqual(r.filas.map(f=>[f.CodMat, f.Puestodetrabajo, f.Cantidad, f.Cubierto, f.Falta, f.Ordenes, f.Vehiculo]), [
    ['600019608', '12P_ENSA', 2, 2, 0, 2, 'BMW X5'],     // el stock cubre primero el puesto más avanzado
    ['600019608', 'Planeacion', 2, 1, 1, 1, 'BMW X5'],   // y lo que sobra, Planeacion
    ['600039800', '05EMPAL', 1, 0, 1, 1, 'URO VAMTAC'],
  ]);
  // órdenes mal configuradas: SAGA trae 1 UND de una referencia que en realidad lleva un juego (2 UND)
  const mal = [{ Ordem_Serial: 10, CodMat: '000000000600019608', Cantidad: '1.000' }, { Ordem_Serial: 11, CodMat: '000000000600019608', Cantidad: '2.000' }, { Ordem_Serial: 12, CodMat: '000000000600019608', Cantidad: '3.000' }, { Ordem_Serial: 13, CodMat: '000000000600019608', Cantidad: '' }];
  const calMal = { 10: { puesto: '12P_ENSA' }, 11: { puesto: '12P_ENSA' }, 12: { puesto: '12P_ENSA' }, 13: { puesto: '12P_ENSA' } };
  const sin = reglas.agrupar(mal, calMal, new Map()).filas[0], con = reglas.agrupar(mal, calMal, new Map(), { undMinimas: 2 }).filas[0];
  assert.deepStrictEqual([sin.Cantidad, sin.Ajustadas], [7, 0], 'sin la opción, SAGA tal cual (1+2+3+1)');
  assert.deepStrictEqual([con.Cantidad, con.Ajustadas], [9, 2], 'con 2 UND mínimas: 2+2+3+2; ajustadas la de 1 y la vacía (la de 3 no se toca)');
  ok('regla: cada orden cuenta al menos un juego (2 UND) de cada referencia; las de 1 UND se corrigen, las de 2 o más quedan como están');
  // escritos como en la tabla real de Calendario
  assert.ok(reglas.puestoPermitido('04SER_TT') && reglas.puestoPermitido('05EMPAL') && reglas.puestoPermitido('04ser_vt'));
  assert.ok(!reglas.puestoPermitido('18INSFIN'));
  ok('regla: CodMat sin los 9 ceros; Cantidad = suma de m2; solo los puestos pedidos (+Planeacion); el stock cubre primero 12P_ENSA');

  // ---------- de punta a punta ----------
  const dir = prepararCopia('mallas'); limpiar(()=>borrarCopia(dir));
  fs.mkdirSync(path.join(dir, 'server', 'node_modules', 'mssql'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'sql-falso.js'), path.join(dir, 'server', 'node_modules', 'mssql', 'index.js'));
  const datosSql = path.join(dir, 'sql-falso.json'), conteo = path.join(dir, 'conteo.json');
  const m = (Ordem_Serial, CodMat, Descricao, m2, extra) => Object.assign({ Ordem_Serial, Operation: '2900', unMed: 'UND                ', CodMat, Descricao, m2 }, extra);
  fs.writeFileSync(datosSql, JSON.stringify({
    saga: [], calendario: [
      { orden: '11', puesto: '12P_ENSA', vehiculo: 'BMW X5 4D UTILITY' }, { orden: '12', puesto: 'Planeacion', vehiculo: 'BMW X5 4D UTILITY' },
      { orden: '13', puesto: '02CNC', vehiculo: 'URO VAMTAC ST5' },        { orden: '14', puesto: '16ACV', vehiculo: 'BMW X5 4D UTILITY' },
      { orden: '15', puesto: '01CORTE' }, { orden: '16', puesto: '01CORTE' },
      { orden: '21', puesto: '01CORTE', vehiculo: 'MERCEDES GLS 450' }, { orden: '22', puesto: 'Planeacion', vehiculo: 'RAM 1500' }, { orden: '23', puesto: '05EMPAL' },
    ],
    mallas: [
      m('11', '000000000600019608', 'MTNTF0036.1244.01 D', '1.000'), m('12', '000000000600019608', 'MTNTF0036.1244.01 D', '2.000'),
      m('13', '000000000600039800', 'MTNTF0036.1567.08', '1.000'),  m('14', '000000000600019608', 'MTNTF0036.1244.01 D', '1.000'),
      m('15', '000000000600011111', 'MALLA SIN LA PALABRA', '1.000'), // no tiene "TNT": no entra
      m('16', '000000000600022222', 'MTNTF KG', '5.000', { unMed: 'KG' }), // no es UND: no entra
      // tejidos: PVTE, PUTE o "tejido" en la descripción (no son mallas)
      m('21', '000000000600050001', 'PVTE 000 MERC GLS 450 4D U 2017', '1.000'), m('22', '000000000600050002', 'Tejido - HEATING RMPJ 049', '1.000'),
      m('23', '000000000600050003', 'PUTE 0012.0044', '1.000'),
    ],
  }));
  const p = await arrancarPuente(dir, 5111, { DB_SERVER: 'falso', CAL_DB_SERVER: 'falso', FAKE_SQL_DATOS: datosSql, FAKE_SQL_CONTEO: conteo });
  limpiar(()=>p.cerrar());
  const adm = await login(p.url, 'Hfrodriguez', 'admin123');
  await api(p.url, 'POST', '/api/usuarios', { token: adm, cuerpo: { usuario: 'Fabrica Mallas', clave: 'mallas1', permisos: { mallas: ['ordenes'] } } });
  await api(p.url, 'POST', '/api/usuarios', { token: adm, cuerpo: { usuario: 'Rack Mallas', clave: 'mallas2', permisos: { mallas: ['rack'] } } });
  const tFab = await login(p.url, 'Fabrica Mallas', 'mallas1'), tRack = await login(p.url, 'Rack Mallas', 'mallas2');
  const lista = async ()=>{ const r = await api(p.url, 'GET', '/api/ordenes-pendientes', { token: tFab, area: 'mallas' }); assert.strictEqual(r.s, 200, JSON.stringify(r.d)); return r.d; };
  const resumen = l => l.ordenes.map(f=>`${f.CodMat}@${f.Puestodetrabajo}:${f.Cantidad}/${f.Falta}`).join(' ');

  const l1 = await lista();
  assert.strictEqual(resumen(l1), '600019608@12P_ENSA:2/2 600019608@Planeacion:2/2 600039800@02CNC:2/2');
  const f = l1.ordenes[0];
  assert.ok(f.Vehiculo==='BMW X5 4D UTILITY' && f.Descricao==='MTNTF0036.1244.01 D' && !('ARCHIVO' in f));
  ok('Lista de corte: Operation 2900 + UND + "TNT"; por CodMat (sin ceros) y puesto; Cantidad suma m2 pero cada orden cuenta un juego (2 UND) como mínimo; 16ACV, sin "TNT" y KG afuera');

  // el que fabrica (solo Lista de corte) da ENTRADA; la necesidad baja al instante, sin otra consulta a SQL
  const oFab = oyente(p.url, tFab); limpiar(()=>oFab.cerrar()); await sleep(200);
  const ent = { tipo: 'entrada', material: '600019608', descripcion: 'MTNTF0036.1244.01 D', cantidad: 2 };
  const e1 = await api(p.url, 'POST', '/api/inventario/movimientos', { token: tFab, area: 'mallas', cuerpo: { idCliente: 'carrito-1', items: [ent] } });
  assert.strictEqual(e1.s, 200, JSON.stringify(e1.d));
  assert.strictEqual(e1.d.movimiento.usuario, 'Fabrica Mallas');
  const e2 = await api(p.url, 'POST', '/api/inventario/movimientos', { token: tFab, area: 'mallas', cuerpo: { idCliente: 'carrito-1', items: [ent] } });
  assert.ok(e2.d.repetido, 'el mismo carrito se registró dos veces');
  await sleep(200);
  assert.ok(oFab.eventos.some(e=>e.tipo==='lista' && e.area==='mallas'), 'no se avisó que la lista cambió');
  const l2 = await lista();
  assert.strictEqual(resumen(l2), '600019608@12P_ENSA:2/0 600019608@Planeacion:2/2 600039800@02CNC:2/2');
  assert.notStrictEqual(l2.version, l1.version);
  assert.strictEqual(JSON.parse(fs.readFileSync(conteo, 'utf8')).mallas, 1, 'la entrada volvió a consultar SQL');
  ok('entrada de 2 desde Lista de corte (a nombre de quien la dio, sin duplicar): Falta baja al instante, aviso en vivo, sin consultar SQL');

  // la salida es solo con permiso de Rack, y nunca más de lo que hay
  const sal = (token, cantidad) => api(p.url, 'POST', '/api/inventario/movimientos', { token, area: 'mallas', cuerpo: { items: [{ tipo: 'salida', material: '000000000600019608', cantidad }] } });
  assert.strictEqual((await sal(tFab, 1)).s, 403, 'quien solo fabrica no puede dar salida');
  assert.strictEqual((await sal(tRack, 5)).s, 409, 'salió más de lo que había');
  const s1 = await sal(tRack, 1);
  assert.strictEqual(s1.s, 200);
  assert.deepStrictEqual(s1.d.stock, [{ material: '600019608', medida: '', cantidad: 1, nombre: 'MTNTF0036.1244.01 D' }], 'la salida sin descripción no tiene que pisar el nombre');
  assert.strictEqual(resumen(await lista()), '600019608@12P_ENSA:2/1 600019608@Planeacion:2/2 600039800@02CNC:2/2');
  const rd = (await api(p.url, 'GET', '/api/rack-resumen-dia', { token: tFab, area: 'mallas' })).d;
  assert.deepStrictEqual(rd, { entradasHoy: 2, salidasHoy: 1, enStock: 1 });
  ok('salida: solo con permiso de Rack (403 si no), nunca más de lo que hay (409); el stock que sale vuelve a ser necesidad; resumen del día en unidades');

  assert.strictEqual((await api(p.url, 'POST', '/api/inventario/movimientos', { token: tRack, area: 'mallas', cuerpo: { items: [{ tipo: 'entrada', material: '6000-ABC', cantidad: 1 }] } })).s, 400);
  assert.strictEqual((await api(p.url, 'GET', '/api/rack-simulado', { token: adm, area: 'mallas' })).s, 400, 'mallas ya no es un rack de casillas');
  ok('CodMat inválido rechazado; el rack de casillas viejo ya no aplica a Mallas');

  // ---------- Tejidos: igual que Mallas, otros materiales, stock propio ----------
  const listaT = async token => { const r = await api(p.url, 'GET', '/api/ordenes-pendientes', { token, area: 'tejidos' }); return r; };
  const lt = await listaT(adm);
  assert.strictEqual(lt.s, 200, JSON.stringify(lt.d));
  assert.strictEqual(resumen(lt.d), '600050001@01CORTE:1/1 600050002@Planeacion:1/1 600050003@05EMPAL:1/1');
  assert.strictEqual(lt.d.ordenes[0].Vehiculo, 'MERCEDES GLS 450');
  ok('Tejidos: Operation 2900 + UND + PVTE / PUTE / "tejido" (sin importar mayúsculas); sin las mallas TNT; mismo agrupado por CodMat y puesto');
  assert.strictEqual((await listaT(tFab)).s, 403, 'permiso de Mallas no da Tejidos');
  // Tejidos NO usa el inventario por cantidad de Mallas: su rack es por posición (ver tejidos.js)
  const et = await api(p.url, 'POST', '/api/inventario/movimientos', { token: adm, area: 'tejidos', cuerpo: { items: [{ tipo: 'entrada', material: '600050001', cantidad: 1 }] } });
  assert.strictEqual(et.s, 400, 'a Tejidos no se le da entrada por cantidad');
  const stockMallas = (await api(p.url, 'GET', '/api/inventario', { token: adm, area: 'mallas' })).d.stock.map(s=>s.material+':'+s.cantidad);
  assert.deepStrictEqual(stockMallas, ['600019608:1'], 'el stock de Mallas cambió');
  ok('Tejidos: su rack es por posición (aparte), el stock de Mallas no se toca; permisos propios');
});

