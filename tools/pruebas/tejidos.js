// Rack de Tejidos: una pieza por posición, del tamaño del tejido (o una más
// grande si no hay), con foto obligatoria, responsables y resistencias.
// Con el SQL simulado para la Lista de corte (Tamaño y "Falta").
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert');
const { ok, sleep, prepararCopia, borrarCopia, arrancarPuente, api, login, oyente, prueba } = require('./comun');

/* sube bytes crudos (la foto), como lo hace el navegador */
function subir(url, ruta, token, bytes, tipo){
  return new Promise((ok_, mal)=>{
    const r = http.request(url + ruta, { method: 'POST', headers: { 'x-auth-token': token, 'x-area': 'tejidos', 'Content-Type': tipo || 'image/jpeg', 'Content-Length': bytes.length } }, res=>{
      let s = ''; res.on('data', c=>s+=c); res.on('end', ()=>{ let d = null; try { d = JSON.parse(s); } catch(e){} ok_({ s: res.statusCode, d }); });
    });
    r.on('error', mal); r.write(bytes); r.end();
  });
}
function bajar(url, ruta, token){
  return new Promise((ok_, mal)=>http.get(url + ruta, { headers: { 'x-auth-token': token, 'x-area': 'tejidos' } }, res=>{
    const partes = []; res.on('data', c=>partes.push(c)); res.on('end', ()=>ok_({ s: res.statusCode, tipo: res.headers['content-type'], bytes: Buffer.concat(partes) }));
  }).on('error', mal));
}
const JPG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(400, 7)]); // basta con la firma de un JPEG

prueba('Rack de Tejidos: por posición, con foto', async limpiar=>{
  const dir = prepararCopia('tejidos'); limpiar(()=>borrarCopia(dir));
  const tej = path.join(dir, 'server', 'datos', 'tejidos'); fs.mkdirSync(tej, { recursive: true });
  fs.writeFileSync(path.join(tej, 'posiciones.json'), JSON.stringify([
    { pos: 'A1.2', tamano: 'P' }, { pos: 'A1.1', tamano: 'P' }, { pos: 'B1.1', tamano: 'G' }, { pos: 'C1.1', tamano: 'XG' }])); // desordenadas a propósito
  fs.writeFileSync(path.join(tej, 'tamanos.json'), JSON.stringify({ '600039736': { tamano: 'P', nombre: 'PUTE0062.1244.14.00.F', vehiculo: 'BMW X5 4D UTILITY', geometria: 'X5' }, '600051507': { tamano: 'G', nombre: 'PVTE0076.1662.005.000.C' } }));
  fs.mkdirSync(path.join(dir, 'server', 'node_modules', 'mssql'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'sql-falso.js'), path.join(dir, 'server', 'node_modules', 'mssql', 'index.js'));
  const m = (Ordem_Serial, CodMat, Descricao) => ({ Ordem_Serial, Operation: '2900', unMed: 'UND', CodMat, Descricao, m2: '1.000' });
  const datosSql = path.join(dir, 'sql-falso.json');
  fs.writeFileSync(datosSql, JSON.stringify({ saga: [], calendario: ['51','52','53'].map(orden=>({ orden, puesto: '01CORTE', vehiculo: 'BMW X5' })),
    mallas: [m('51', '000000000600039736', 'PUTE0062.1244.14.00.F'), m('52', '000000000600039736', 'PUTE0062.1244.14.00.F'), m('53', '000000000600099999', 'PVTE SIN TAMAÑO')] }));
  const p = await arrancarPuente(dir, 5114, { DB_SERVER: 'falso', CAL_DB_SERVER: 'falso', FAKE_SQL_DATOS: datosSql });
  limpiar(()=>p.cerrar());
  const adm = await login(p.url, 'Hfrodriguez', 'admin123');
  await api(p.url, 'POST', '/api/usuarios', { token: adm, cuerpo: { usuario: 'Operario Zund', clave: 'zund01', permisos: { tejidos: ['rack'] } } });
  await api(p.url, 'POST', '/api/usuarios', { token: adm, cuerpo: { usuario: 'Solo Lista', clave: 'lista1', permisos: { tejidos: ['ordenes'] } } });
  const tZ = await login(p.url, 'Operario Zund', 'zund01'), tL = await login(p.url, 'Solo Lista', 'lista1');
  const tj = (token, metodo, ruta, cuerpo) => api(p.url, metodo, '/api/tejidos' + ruta, { token, area: 'tejidos', cuerpo });

  const e0 = (await tj(tZ, 'GET', '/rack')).d;
  assert.deepStrictEqual(e0.posiciones.map(x=>x.pos), ['A1.1', 'A1.2', 'B1.1', 'C1.1']);
  ok('posiciones en orden (A1.1, A1.2, B1.1, C1.1), con su tamaño');

  // ---------- foto ----------
  assert.strictEqual((await subir(p.url, '/api/tejidos/fotos', tZ, Buffer.from('esto no es una foto, es texto plano con más de cien bytes para que no lo rechace por chico ......'), 'image/jpeg')).s, 400);
  const f1 = await subir(p.url, '/api/tejidos/fotos', tZ, JPG);
  assert.strictEqual(f1.s, 200); assert.ok(/^[a-f0-9]{24}\.jpg$/.test(f1.d.foto));
  assert.strictEqual((await subir(p.url, '/api/tejidos/fotos', tL, JPG)).s, 403, 'subir fotos es del permiso de Rack');
  ok('foto: se reconoce por su contenido (un texto con nombre de foto se rechaza), y solo con permiso de Rack');

  // ---------- validaciones ----------
  const base = { codmat: '600039736', responsables: 'Juan Pérez', resistencia1: '12.5', resistencia2: '12.4', ensamble: 'OK', foto: f1.d.foto };
  assert.strictEqual((await tj(tZ, 'POST', '/entrada', { ...base, foto: undefined })).s, 400, 'sin foto no entra');
  assert.strictEqual((await tj(tZ, 'POST', '/entrada', { ...base, foto: 'abc.jpg' })).s, 400, 'con una foto inventada no entra');
  assert.strictEqual((await tj(tZ, 'POST', '/entrada', { ...base, responsables: '' })).s, 400);
  assert.strictEqual((await tj(tZ, 'POST', '/entrada', { ...base, resistencia1: ' ' })).s, 400);
  const sinTam = await tj(tZ, 'POST', '/entrada', { ...base, codmat: '600099999' });
  assert.strictEqual(sinTam.s, 409); assert.ok(/no tiene tamaño/.test(sinTam.d.error), sinTam.d.error);
  assert.strictEqual((await tj(tL, 'POST', '/entrada', base)).s, 403, 'dar entrada es del permiso de Rack');
  ok('entrada exige foto real, responsables y resistencia 1; un tejido sin tamaño no entra; quien solo ve Lista de corte no da entradas');

  // ---------- posiciones ----------
  const oZ = oyente(p.url, tZ); limpiar(()=>oZ.cerrar()); await sleep(200);
  const entrar = async (extra) => { const f = await subir(p.url, '/api/tejidos/fotos', tZ, JPG); return tj(tZ, 'POST', '/entrada', { ...base, foto: f.d.foto, ...extra }); };
  const r1 = await entrar({ idCliente: 'e1' });
  assert.strictEqual(r1.d.posicion, 'A1.1'); assert.strictEqual(r1.d.masGrande, false); assert.strictEqual(r1.d.unidad.usuario, 'Operario Zund');
  const r1b = await tj(tZ, 'POST', '/entrada', { ...base, idCliente: 'e1' });
  assert.ok(r1b.d.repetido && r1b.d.posicion==='A1.1', 'el mismo envío se registró dos veces');
  assert.strictEqual((await entrar()).d.posicion, 'A1.2');
  const r3 = await entrar();
  assert.strictEqual(r3.d.posicion, 'B1.1'); assert.strictEqual(r3.d.masGrande, true);
  assert.strictEqual((await entrar()).d.posicion, 'C1.1');
  const lleno = await entrar();
  assert.strictEqual(lleno.s, 409); assert.ok(/No queda ninguna posición libre/.test(lleno.d.error));
  ok('P entra en A1.1 y A1.2; sin P libres usa una G (B1.1) y después una XG, avisando; lleno = 409; un reintento no duplica');
  await sleep(200);
  assert.ok(oZ.eventos.some(e=>e.tipo==='tejidos'), 'no hubo aviso en vivo');

  // ---------- salida y reuso ----------
  assert.strictEqual((await tj(tL, 'POST', '/salida', { posicion: 'A1.1' })).s, 403);
  assert.strictEqual((await tj(tZ, 'POST', '/salida', { posicion: 'a1.1' })).s, 200);
  assert.strictEqual((await tj(tZ, 'POST', '/salida', { posicion: 'A1.1' })).s, 409, 'ya estaba libre');
  assert.strictEqual((await entrar()).d.posicion, 'A1.1');
  ok('salida libera la posición (sin importar mayúsculas) y la próxima entrada la reusa; quien solo ve Lista de corte no da salidas');

  // ---------- foto guardada ----------
  const est = (await tj(tL, 'GET', '/rack')).d;
  const u = est.posiciones.find(x=>x.pos==='A1.2').unidad;
  assert.ok(u.responsables==='Juan Pérez' && u.resistencia1==='12.5' && u.resistencia2==='12.4' && u.ensamble==='OK' && u.nombre==='PUTE0062.1244.14.00.F');
  const foto = await bajar(p.url, '/api/tejidos/fotos/' + u.foto, tL);
  assert.strictEqual(foto.s, 200); assert.ok(/image\/jpeg/.test(foto.tipo)); assert.ok(foto.bytes.equals(JPG));
  assert.strictEqual((await bajar(p.url, '/api/tejidos/fotos/..%2F..%2Fusuarios.json', tL)).s, 404);
  assert.strictEqual((await bajar(p.url, '/api/tejidos/fotos/' + u.foto, (await login(p.url, 'Beto', 'beto123')))).s, 200); // Beto tiene todos los permisos
  ok('cada pieza guarda responsables, resistencias, ensamble y su foto (se ve con permiso; no se puede pedir otro archivo)');

  // ---------- Lista de corte: Tamaño, "Falta" descontado y "Asignar" ----------
  const lista = async () => (await api(p.url, 'GET', '/api/ordenes-pendientes', { token: tL, area: 'tejidos' })).d.ordenes;
  const l1 = await lista();
  const fila = c => l1.find(x=>x.CodMat===c);
  assert.strictEqual(fila('600039736').Tamano, 'P'); assert.strictEqual(fila('600039736').Cantidad, 2); assert.strictEqual(fila('600039736').Falta, 0, 'las 4 piezas en el rack cubren las 2');
  assert.strictEqual(fila('600099999').Tamano, '');
  assert.strictEqual((await tj(tL, 'PUT', '/tamano', { codmat: '600099999', tamano: 'M' })).s, 400);
  assert.strictEqual((await tj(tL, 'PUT', '/tamano', { codmat: '600099999', tamano: 'XG', nombre: 'PVTE SIN TAMAÑO' })).s, 200);
  assert.strictEqual((await lista()).find(x=>x.CodMat==='600099999').Tamano, 'XG');
  ok('Lista de corte de Tejidos: columna Tamaño; el rack descuenta "Falta"; "Asignar" tamaño desde la lista (solo P, G, XG)');
  // "Asignar" no le borra el vehículo que vino del Excel
  assert.strictEqual((await tj(tL, 'PUT', '/tamano', { codmat: '600039736', tamano: 'P' })).s, 200);
  assert.strictEqual((await tj(tL, 'GET', '/rack')).d.tamanosTejidos['600039736'].vehiculo, 'BMW X5 4D UTILITY');
  assert.strictEqual(u.vehiculo, 'BMW X5 4D UTILITY'); assert.strictEqual(u.geometria, 'X5');
  ok('cada entrada guarda el vehículo y la geometría del tejido; "Asignar" tamaño no los borra');

  // ---------- historial: entradas y salidas ----------
  const hist = async (q, token) => tj(token || tL, 'GET', '/historial' + (q ? '?' + q : ''));
  const h0 = (await hist()).d;
  // 5 entradas, 1 salida, 2 tamaños asignados
  assert.strictEqual(h0.total, 8, JSON.stringify(h0.eventos.map(e=>e.evento)));
  assert.strictEqual(h0.eventos[0].evento, 'tamano', 'lo más nuevo primero');
  assert.strictEqual((await hist('evento=movimientos')).d.total, 6);
  assert.strictEqual((await hist('evento=entrada')).d.total, 5);
  const sal = (await hist('evento=salida')).d.eventos;
  assert.strictEqual(sal.length, 1); assert.strictEqual(sal[0].pos, 'A1.1'); assert.ok(sal[0].fechaEntrada, 'la salida dice cuándo había entrado');
  assert.strictEqual(sal[0].vehiculo, 'BMW X5 4D UTILITY'); assert.strictEqual(sal[0].usuario, 'Operario Zund');
  assert.ok((await hist('evento=entrada')).d.eventos.every(e=>e.foto && e.responsables==='Juan Pérez' && e.resistencia1==='12.5'));
  ok('historial: todo lo nuevo primero; filtro por entradas, salidas o ambas; cada movimiento con quién, foto, responsables y resistencias');
  assert.strictEqual((await hist('texto=600099999')).d.total, 1);
  assert.strictEqual((await hist('texto=' + encodeURIComponent('juan pérez'))).d.total, 6);
  assert.strictEqual((await hist('texto=x5&evento=salida')).d.total, 1, 'busca también por vehículo');
  assert.strictEqual((await hist('desde=2999-01-01')).d.total, 0);
  assert.strictEqual((await hist('hasta=2000-01-01')).d.total, 0);
  const hoy = new Date(), dd = n => String(n).padStart(2, '0'), dia = `${hoy.getFullYear()}-${dd(hoy.getMonth()+1)}-${dd(hoy.getDate())}`;
  assert.strictEqual((await hist(`desde=${dia}&hasta=${dia}`)).d.total, 8);
  assert.strictEqual((await hist('evento=cualquiera')).d.total, 8, 'un filtro desconocido se ignora');
  const h2 = (await hist('limite=2')).d;
  assert.strictEqual(h2.eventos.length, 2); assert.strictEqual(h2.total, 8);
  assert.strictEqual((await api(p.url, 'GET', '/api/tejidos/historial', { area: 'tejidos' })).s, 401, 'sin sesión no se ve');
  await api(p.url, 'POST', '/api/usuarios', { token: adm, cuerpo: { usuario: 'Solo Papel', clave: 'papel1', permisos: { papel: ['rack'] } } });
  assert.strictEqual((await hist('', await login(p.url, 'Solo Papel', 'papel1'))).s, 403, 'quien no tiene Tejidos no ve su historial');
  ok('historial: busca por CodMat, responsable o vehículo; filtra por fechas; tope de filas con el total; pide sesión y permiso de Tejidos');

  // ---------- reinicio ----------
  await p.reiniciar();
  const t2 = await login(p.url, 'Operario Zund', 'zund01');
  const e2 = (await api(p.url, 'GET', '/api/tejidos/rack', { token: t2, area: 'tejidos' })).d;
  assert.deepStrictEqual(e2.posiciones.map(x=>x.unidad ? x.pos : '-').join(' '), 'A1.1 A1.2 B1.1 C1.1');
  assert.strictEqual(e2.tamanosTejidos['600099999'].tamano, 'XG');
  const r9 = await tj(t2, 'POST', '/entrada', { ...base, idCliente: 'e1' });
  assert.ok(r9.d.repetido, 'después del reinicio el mismo envío no tiene que volver a entrar');
  ok('reinicio: el rack, los tamaños y los envíos ya registrados se conservan');
});
