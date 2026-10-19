// Papel cerámico: regla de Lista de corte (PlanCURVE / NivelAGP / ZFER
// aprobado) y la vista de Aprobaciones de punta a punta.
// (Sin SQL: la regla se prueba directo; el flujo de aprobación, por HTTP.)
const fs = require('fs'), path = require('path'), assert = require('assert');
const { ok, sleep, RAIZ, prepararCopia, borrarCopia, arrancarPuente, api, login, oyente, prueba } = require('./comun');
const reglas = require(path.join(RAIZ, 'server', 'reglas-papel.js'));
const { cargar, totales } = require(path.join(RAIZ, 'tools', 'migracion', 'migrar-a-sql.js'));

prueba('Aprobaciones de ZFER y regla de Lista de corte', async limpiar=>{
  // ---------- la regla ----------
  const aprobados = new Set(['70012345']);
  const ev = (planCurve, nivel, zfer) => reglas.evaluar({ planCurve, nivel, zfer }, aprobados);
  assert.ok(ev('CURVE', '05').ok && ev('curve ', '5').ok && ev('CURVE', '07').ok && ev('CURVE', 12).ok, 'CURVE 05+ entra');
  assert.ok(!ev('PLANO', '07').ok && !ev('', '07').ok && !ev(null, '09').ok, 'si no es CURVE no entra, sea cual sea el nivel');
  assert.ok(!ev('CURVE', '01').ok && !ev('CURVE', '00').ok && !ev('CURVE', '').ok, 'nivel 00/01/vacío no entra');
  const sinAprobar = ev('CURVE', '03', '70099999');
  assert.ok(!sinAprobar.ok && sinAprobar.candidato && /no está aprobado/.test(sinAprobar.motivo));
  assert.ok(ev('CURVE', '02', '70012345').ok && ev('CURVE', '04', ' 70012345 ').ok, 'CURVE 02–04 con ZFER aprobado entra');
  assert.ok(!ev('CURVE', '03', '').ok && !ev('CURVE', '03', '').candidato, 'CURVE 03 sin ZFER no entra ni es candidato');
  assert.ok(!ev('PLANO', '03', '70012345').ok, 'aprobar un ZFER no hace entrar a lo que no es CURVE');
  ok('regla: CURVE + nivel 05+ entra; CURVE 02–04 solo con ZFER aprobado; lo demás no (X5 incluido)');

  const filas = [
    { Ordem_Serial: 1, ClaveModelo: 'M1' }, { Ordem_Serial: 2, ClaveModelo: 'M1' }, { Ordem_Serial: 3, ClaveModelo: 'M2' },
    { Ordem_Serial: 4 }, { Ordem_Serial: 5 }, { Ordem_Serial: 6 }, { Ordem_Serial: 7 },
  ];
  const cal = {
    1: { puesto: '01CORTE', planCurve: 'CURVE', nivel: '05', zfer: '700A' },
    2: { puesto: '02CNC',   planCurve: 'CURVE', nivel: '03', zfer: '700B' },     // candidato
    3: { puesto: '02CNC',   planCurve: 'CURVE', nivel: '04', zfer: '700B' },     // candidato (mismo ZFER)
    4: { puesto: 'OTRO',    planCurve: 'CURVE', nivel: '03', zfer: '700C' },     // puesto no permitido: ni entra ni es candidato
    5: { puesto: 'Planeacion', planCurve: 'CURVE', nivel: '02', zfer: '70012345' }, // aprobado
    6: { puesto: '01CORTE', planCurve: 'PLANO', nivel: '09', zfer: '700D' },
    // 7: sin datos en Calendario
  };
  const r = reglas.clasificar(filas, cal, aprobados);
  assert.deepStrictEqual(r.entran.map(f=>f.Ordem_Serial), [1, 5]);
  assert.deepStrictEqual(r.candidatos, [{ zfer: '700B', cantidad: 2, ordenes: ['2', '3'], niveles: ['03', '04'], modelos: ['M1', 'M2'], vehiculos: [] }]);
  assert.strictEqual(r.entran[0].PlanCURVE, 'CURVE'); assert.strictEqual(r.entran[0].NivelAGP, '05'); assert.strictEqual(r.entran[0].ZFER, '700A');
  ok('lista: entran 1 y 5; el ZFER 700B queda como candidato con sus 2 órdenes (niveles 03, 04); columnas ZFER/PlanCURVE/NivelAGP pegadas');

  // ---------- la vista de Aprobaciones, por HTTP ----------
  const dir = prepararCopia('aprobaciones'); limpiar(()=>borrarCopia(dir));
  const p = await arrancarPuente(dir, 5107); limpiar(()=>p.cerrar());
  const adm = await login(p.url, 'Hfrodriguez', 'admin123');
  const crear = (usuario, permisos) => api(p.url, 'POST', '/api/usuarios', { token: adm, cuerpo: { usuario, clave: 'clave1', permisos } });
  await crear('Pide', { papel: ['aprobaciones', 'ordenes'] });
  await crear('Aprueba', { papel: ['aprobar'] });
  await crear('Solo Rack', { papel: ['rack'] });
  const tPide = await login(p.url, 'Pide', 'clave1'), tAprueba = await login(p.url, 'Aprueba', 'clave1'), tRack = await login(p.url, 'Solo Rack', 'clave1');
  const ap = (token, metodo, ruta, cuerpo) => api(p.url, metodo, '/api/aprobaciones' + (ruta||''), { token, area: 'papel', cuerpo });

  assert.strictEqual((await ap(tRack, 'GET', '?candidatos=0')).s, 403);
  assert.strictEqual((await api(p.url, 'GET', '/api/aprobaciones?candidatos=0', { token: tPide, area: 'mallas' })).s, 403, 'Pide no tiene Mallas');
  ok('permisos: sin "Aprobaciones" ni "Aprobar ZFER" no se ve nada (403)');

  const oAprueba = oyente(p.url, tAprueba), oRack = oyente(p.url, tRack);
  limpiar(()=>[oAprueba, oRack].forEach(o=>o.cerrar()));
  await sleep(300);

  assert.strictEqual((await ap(tPide, 'POST', '/solicitar', { zfer: 'a b<x>' })).s, 400);
  const s1 = await ap(tPide, 'POST', '/solicitar', { zfer: ' 70055555 ', nota: 'lleva papel en el sensor', detalle: { ordenes: ['1', '2'], niveles: ['03'], modelos: ['M1'], basura: 'x'.repeat(5000) } });
  assert.strictEqual(s1.s, 200); assert.strictEqual(s1.d.estado, 'pendiente'); assert.strictEqual(s1.d.zfer, '70055555');
  assert.deepStrictEqual(s1.d.detalle, { ordenes: ['1', '2'], niveles: ['03'], modelos: ['M1'], vehiculos: [] });
  assert.strictEqual((await ap(tPide, 'POST', '/solicitar', { zfer: '70055555' })).s, 409, 'no se pide dos veces');
  assert.strictEqual((await ap(tPide, 'POST', '/70055555/resolver', { decision: 'aprobar' })).s, 403, 'pedir no da permiso de aprobar');
  await sleep(200);
  assert.ok(oAprueba.eventos.some(e=>e.tipo==='aprobaciones'), 'el aprobador no se enteró en vivo');
  assert.ok(!oRack.eventos.some(e=>e.tipo==='aprobaciones'), 'Solo Rack no tiene por qué recibir esto');
  ok('pedir: ZFER validado y normalizado, sin duplicados; el aprobador se entera en vivo y los demás no');

  assert.strictEqual((await ap(tAprueba, 'POST', '/70055555/resolver', { decision: 'rechazar' })).s, 400, 'rechazar exige motivo');
  assert.strictEqual((await ap(tAprueba, 'POST', '/70055555/resolver', { decision: 'rechazar', motivo: 'no lleva papel según plano rev. C' })).d.estado, 'rechazada');
  assert.strictEqual((await ap(tPide, 'POST', '/solicitar', { zfer: '70055555', nota: 'el plano rev. D sí lo lleva' })).d.estado, 'pendiente');
  const aprobada = await ap(tAprueba, 'POST', '/70055555/resolver', { decision: 'aprobar' });
  assert.strictEqual(aprobada.d.estado, 'aprobada'); assert.strictEqual(aprobada.d.resueltoPor, 'Aprueba');
  assert.deepStrictEqual(aprobada.d.historial.map(h=>h.evento), ['solicitada', 'rechazada', 'solicitada', 'aprobada']);
  assert.strictEqual((await ap(tAprueba, 'POST', '/70055555/resolver', { decision: 'aprobar' })).s, 409, 'ya no está pendiente');
  ok('ciclo: pedir → rechazar (con motivo) → volver a pedir → aprobar; todo queda en el historial');

  // nadie aprueba su propio pedido (salvo un administrador)
  await crear('Pide y Aprueba', { papel: ['aprobaciones', 'aprobar'] });
  const tAmbos = await login(p.url, 'Pide y Aprueba', 'clave1');
  await ap(tAmbos, 'POST', '/solicitar', { zfer: '70066666' });
  assert.strictEqual((await ap(tAmbos, 'POST', '/70066666/resolver', { decision: 'aprobar' })).s, 403);
  assert.strictEqual((await ap(tAprueba, 'POST', '/70066666/resolver', { decision: 'aprobar' })).s, 200);
  await ap(adm, 'POST', '/solicitar', { zfer: '70077777' });
  assert.strictEqual((await ap(adm, 'POST', '/70077777/resolver', { decision: 'aprobar' })).s, 200);
  ok('quien pide no puede aprobar su propio pedido (el administrador sí)');

  assert.strictEqual((await ap(tAprueba, 'POST', '/70077777/resolver', { decision: 'revocar' })).s, 400, 'quitar la aprobación exige motivo');
  assert.strictEqual((await ap(tAprueba, 'POST', '/70077777/resolver', { decision: 'revocar', motivo: 'cambió el diseño' })).d.estado, 'rechazada');
  const lista = (await ap(tPide, 'GET', '?candidatos=0')).d;
  assert.strictEqual(lista.puedeAprobar, false);
  assert.deepStrictEqual(lista.solicitudes.map(s=>`${s.zfer}:${s.estado}`).sort(), ['70055555:aprobada', '70066666:aprobada', '70077777:rechazada']);
  // sin SQL configurado: la lista de candidatos avisa, pero las solicitudes se ven igual
  const conCand = await ap(tPide, 'GET', '');
  assert.strictEqual(conCand.s, 200); assert.ok(conCand.d.errorCandidatos && conCand.d.candidatos===null);
  ok('quitar aprobación (con motivo); sin SQL, la vista sigue funcionando y avisa que no pudo revisar la lista');

  // reinicio: lo aprobado sigue aprobado; y la migración a SQL lo lleva
  await p.reiniciar();
  const tras = (await ap(await login(p.url, 'Aprueba', 'clave1'), 'GET', '?candidatos=0')).d;
  assert.strictEqual(tras.solicitudes.filter(s=>s.estado==='aprobada').length, 2);
  assert.ok(fs.existsSync(path.join(dir, 'server', 'datos', 'papel', 'aprobaciones.json')));
  await p.cerrar();
  const t = totales(cargar(path.join(dir, 'server', 'datos')));
  assert.strictEqual(t.papelAprobaciones, 3); assert.strictEqual(t.papelAprobacionesHistorial, 9);
  ok('reinicio: las aprobaciones se conservan (datos/papel/aprobaciones.json); la migración a SQL las incluye (3 ZFER, 9 eventos)');

  // ---------- de punta a punta, con un SQL Server simulado ----------
  // (las consultas son las REALES de server/queries.js; ver sql-falso.js)
  const dir2 = prepararCopia('aprobaciones-sql'); limpiar(()=>borrarCopia(dir2));
  fs.mkdirSync(path.join(dir2, 'server', 'node_modules', 'mssql'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'sql-falso.js'), path.join(dir2, 'server', 'node_modules', 'mssql', 'index.js'));
  const fila = (Ordem_Serial, Operation, ClaveModelo) => ({ Ordem_Serial, Operation, Centro_Trabalho: '01CORTE', ClaveModelo, CodMat: 'C', Name: 'N', ZTipo: 'Z', Descricao: 'D', ARCHIVO: `\\\\srv\\dxf\\${Ordem_Serial}-${Operation}.dxf` });
  const datosSql = path.join(dir2, 'sql-falso.json');
  fs.writeFileSync(datosSql, JSON.stringify({
    saga: [fila('1001', '0132', 'M1'), fila('1002', '0132', 'M2'), fila('1003', '0132', 'M3'),
           fila('1004', '0101', 'X5'), fila('1005', '0101', 'X5'), fila('1006', '0101', 'M6'), fila('1006', '0200', 'M6')],
    calendario: [
      { orden: '1001', puesto: '01CORTE', zfer: '700A',     planCurve: 'CURVE', nivel: '05' },  // entra
      { orden: '1002', puesto: '01CORTE', zfer: 'Z1',       planCurve: 'CURVE', nivel: '03' },  // espera aprobación de Z1
      { orden: '1003', puesto: '01CORTE', zfer: '700C',     planCurve: 'PLANO', nivel: '07' },  // no es CURVE
      { orden: '1004', puesto: '02CNC',   zfer: '70005171', planCurve: 'CURVE', nivel: '06', vehiculo: 'BMW X5 4D UTILITY' },  // X5 sin 0132: entra por ZFER
      { orden: '1005', puesto: '02CNC',   zfer: '70005171', planCurve: 'CURVE', nivel: '03' },  // X5 nivel 03: ahora se filtra
      { orden: '1006', puesto: '03SERIG', zfer: 'Z1',       planCurve: 'CURVE', nivel: '04' },  // sin 0132: entra al aprobar Z1
    ],
    lotes: { L1: ['1001', '1002', '1003'] }
  }));
  const q = await arrancarPuente(dir2, 5108, { DB_SERVER: 'falso', CAL_DB_SERVER: 'falso', FAKE_SQL_DATOS: datosSql, ZFER_LISTA_ESPECIAL: '70005171' });
  limpiar(()=>q.cerrar());
  const a2 = await login(q.url, 'Hfrodriguez', 'admin123');
  await api(q.url, 'POST', '/api/usuarios', { token: a2, cuerpo: { usuario: 'Pide', clave: 'clave1', permisos: { papel: ['aprobaciones', 'ordenes'] } } });
  await api(q.url, 'POST', '/api/usuarios', { token: a2, cuerpo: { usuario: 'Aprueba', clave: 'clave1', permisos: { papel: ['aprobar'] } } });
  const p2 = await login(q.url, 'Pide', 'clave1'), ap2 = await login(q.url, 'Aprueba', 'clave1');
  const listaCorte = async ()=>{ const r = await api(q.url, 'GET', '/api/ordenes-pendientes', { token: p2, area: 'papel' }); assert.strictEqual(r.s, 200, JSON.stringify(r.d)); return r.d.ordenes; };
  const series = l => l.map(f=>f.Ordem_Serial).sort().join(',');

  const antes = await listaCorte();
  assert.strictEqual(series(antes), '1001,1004');
  const x5 = antes.find(f=>f.Ordem_Serial==='1004');
  assert.ok(x5.ARCHIVO.endsWith('1004-0101.dxf') && x5.PlanCURVE==='CURVE' && x5.NivelAGP==='06' && x5.ZFER==='70005171' && x5.Puestodetrabajo==='02CNC' && x5.Vehiculo==='BMW X5 4D UTILITY');
  ok('Lista de corte: solo CURVE 05+ (1001) y X5 nivel 06 por su ZFER, con el archivo de la 0101; X5 nivel 03, PLANO y CURVE 03 sin aprobar quedan afuera');

  const cand = (await api(q.url, 'GET', '/api/aprobaciones', { token: p2, area: 'papel' })).d.candidatos;
  assert.deepStrictEqual(cand.map(c=>`${c.zfer}:${c.ordenes.join('+')}:${c.niveles.join('+')}`).sort(), ['70005171:1005:03', 'Z1:1002:03']);
  ok('Aprobaciones ofrece los ZFER que esperan: Z1 (orden 1002) y el de X5 (orden 1005, nivel 03)');

  const ingreso = n => api(q.url, 'GET', '/api/ordenes-pendientes/' + n, { token: p2, area: 'papel' });
  const b1002 = (await ingreso('1002')).d, b1003 = (await ingreso('1003')).d, b1001 = (await ingreso('1001')).d;
  assert.ok(b1002.bloqueada && /Z1 no está aprobado/.test(b1002.motivo), JSON.stringify(b1002));
  assert.ok(b1003.bloqueada && /PLANO/.test(b1003.motivo));
  assert.ok(b1001.encontrada && !b1001.bloqueada && b1001.orden.NivelAGP==='05');
  const lote = (await api(q.url, 'GET', '/api/lote/L1', { token: p2, area: 'papel' })).d;
  assert.deepStrictEqual(lote.ordenes.map(f=>f.Ordem_Serial), ['1001']);
  assert.deepStrictEqual(lote.bloqueadas.map(b=>b.Ordem_Serial).sort(), ['1002', '1003']);
  ok('ingreso rápido y lote por código BLOQUEAN lo que no cumple (1002 sin aprobar, 1003 PLANO), diciendo por qué');

  await api(q.url, 'POST', '/api/aprobaciones/solicitar', { token: p2, area: 'papel', cuerpo: { zfer: 'z1' } });
  assert.strictEqual(series(await listaCorte()), '1001,1004', 'pedida no es aprobada');
  await api(q.url, 'POST', '/api/aprobaciones/Z1/resolver', { token: ap2, area: 'papel', cuerpo: { decision: 'aprobar' } });
  const despues = await listaCorte(); // al instante: aprobar reclasifica la lista guardada
  assert.strictEqual(series(despues), '1001,1002,1004,1006');
  assert.ok(despues.find(f=>f.Ordem_Serial==='1006').ARCHIVO.endsWith('1006-0101.dxf'), 'la sin 0132 entra con el archivo de la 0101, como X5');
  assert.ok(!(await ingreso('1002')).d.bloqueada);
  ok('Z1 aprobado: entran YA sus órdenes, la 1002 (0132) y la 1006 (sin 0132, archivo de la 0101, como X5); el ingreso rápido la deja pasar');

  await api(q.url, 'POST', '/api/aprobaciones/Z1/resolver', { token: ap2, area: 'papel', cuerpo: { decision: 'revocar', motivo: 'prueba' } });
  assert.strictEqual(series(await listaCorte()), '1001,1004');
  ok('quitar la aprobación de Z1: sus órdenes vuelven a quedar afuera');
});
