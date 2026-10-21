/* PRUEBA DE CARGA (rendimiento) — no es parte de todas.js: se corre a mano.
     node tools/pruebas/carga.js
   Arma una copia de la app con un AÑO de datos (70.000 eventos en el
   historial de papel, 20.000 en el de tejidos, Lista de corte de 3.000
   órdenes con el SQL simulado) y mide, con 30 PCs pidiendo a la vez:
   tiempo de respuesta (mediana y p95), bytes que viajan por la red y
   memoria del puente. Sirve para comparar antes / después de un cambio. */
const fs = require('fs'), path = require('path'), http = require('http'), zlib = require('zlib');
const { execSync } = require('child_process');
const { prepararCopia, borrarCopia, arrancarPuente, login, sleep } = require('./comun');
const RAIZ = path.join(__dirname, '..', '..');
const PC = 30, RONDAS = 10;

function pedir(url, metodo, ruta, { token, area, cuerpo, gzip } = {}){
  return new Promise((ok, mal)=>{
    const t0 = process.hrtime.bigint();
    const headers = { 'Content-Type': 'application/json', 'x-auth-token': token, 'x-area': area };
    if(gzip) headers['Accept-Encoding'] = 'gzip';
    const r = http.request(url + ruta, { method: metodo, headers, agent: new http.Agent({ keepAlive: false }) }, res=>{
      const partes = []; res.on('data', c=>partes.push(c));
      res.on('end', ()=>{
        const crudo = Buffer.concat(partes);
        const texto = res.headers['content-encoding']==='gzip' ? zlib.gunzipSync(crudo).toString() : crudo.toString();
        ok({ s: res.statusCode, ms: Number(process.hrtime.bigint() - t0) / 1e6, bytes: crudo.length, texto });
      });
    });
    r.on('error', mal); if(cuerpo) r.write(JSON.stringify(cuerpo)); r.end();
  });
}
const pct = (l, p) => { const s = [...l].sort((a, b)=>a-b); return s[Math.min(s.length-1, Math.floor(p*s.length))]; };
async function medir(nombre, fn, rondas = RONDAS, paralelo = PC){
  const tiempos = []; let bytes = 0, n = 0, malos = 0;
  for(let r=0; r<rondas; r++){
    const t = await Promise.all(Array.from({ length: paralelo }, (_, i)=>fn(i, r)));
    t.forEach(x=>{ tiempos.push(x.ms); bytes += x.bytes; n++; if(x.s>=400) malos++; });
  }
  const res = { prueba: nombre, pedidos: n, mediana_ms: +pct(tiempos, .5).toFixed(1), p95_ms: +pct(tiempos, .95).toFixed(1), kb_por_pedido: +(bytes/n/1024).toFixed(1), errores: malos };
  console.log(JSON.stringify(res));
  return res;
}
function memoriaMb(puerto){
  try {
    const out = execSync(`netstat -ano -p tcp`, { encoding: 'utf8' }).split('\n').find(l=>l.includes(`:${puerto} `) && /LISTENING/.test(l));
    const pid = out.trim().split(/\s+/).pop();
    const csv = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8' });
    return Math.round(parseInt(csv.split('","')[4].replace(/[^\d]/g, ''), 10) / 1024);
  } catch(e){ return null; }
}

(async()=>{
  const dir = prepararCopia('carga');
  try {
    const datos = path.join(dir, 'server', 'datos');
    // ---- un año de historial de papel (70.000 eventos, con la orden completa como el real) ----
    fs.mkdirSync(path.join(datos, 'papel'), { recursive: true });
    const inicio = Date.now() - 365*864e5;
    const orden = i => ({ Ordem_Serial: String(500000+i), Operation: '0132', ClaveModelo: 'M'+(i%300), CodMat: 'C'+i, Name: 'PARABRISAS', ZTipo: 'ZPAR', Descricao: 'VIDRIO LAMINADO', ARCHIVO: `\\\\srv\\dxf\\${i}.dxf`, ubicacion: 'A1' });
    const histPapel = Array.from({ length: 70000 }, (_, i)=>({ area: 'papel', Ordem_Serial: String(500000+i), ubicacion: 'A1', usuario: 'Ana', evento: i%2 ? 'salida' : 'entrada', orden: i%2 ? orden(i) : undefined, fecha: new Date(inicio + i*450000).toISOString() }));
    fs.writeFileSync(path.join(datos, 'papel', 'historial.json'), JSON.stringify(histPapel, null, 2));
    fs.writeFileSync(path.join(datos, 'papel', 'rack.json'), '[]');
    // ---- tejidos: el rack real (posiciones y tamaños) y 20.000 movimientos ----
    const tej = path.join(datos, 'tejidos'); fs.mkdirSync(tej, { recursive: true });
    ['posiciones.json', 'tamanos.json'].forEach(f=>fs.copyFileSync(path.join(RAIZ, 'server', 'datos', 'tejidos', f), path.join(tej, f)));
    const posiciones = JSON.parse(fs.readFileSync(path.join(tej, 'posiciones.json'), 'utf8'));
    const codmats = Object.keys(JSON.parse(fs.readFileSync(path.join(tej, 'tamanos.json'), 'utf8')));
    const unidad = i => ({ id: 'u'+i, codmat: codmats[i%codmats.length], nombre: 'PVTE0076.1244.01.00.C', tamano: 'P', tamanoPosicion: 'P', vehiculo: 'BMW X5 4D UTILITY', geometria: 'X5',
      responsables: 'Juan Pérez', resistencia1: '12.5', resistencia2: '', ensamble: 'OK', nota: null, foto: 'a'.repeat(24)+'.jpg', usuario: 'Zund', fecha: new Date(inicio + i*1570000).toISOString() });
    const lineas = [];
    for(let i=0; i<20000; i++) lineas.push(JSON.stringify({ evento: i%2 ? 'salida' : 'entrada', pos: posiciones[i%posiciones.length].pos, unidad: unidad(i), idCliente: i%2 ? undefined : 'c'+i, usuario: 'Zund', fecha: unidad(i).fecha }));
    fs.writeFileSync(path.join(tej, 'historial.jsonl'), lineas.join('\n') + '\n');
    const ocupacion = {}; posiciones.slice(0, 100).forEach((p, i)=>{ ocupacion[p.pos] = unidad(i); });
    fs.writeFileSync(path.join(tej, 'ocupacion.json'), JSON.stringify(ocupacion));
    // ---- SQL simulado: 3.000 órdenes de papel que entran a la Lista de corte ----
    fs.mkdirSync(path.join(dir, 'server', 'node_modules', 'mssql'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'sql-falso.js'), path.join(dir, 'server', 'node_modules', 'mssql', 'index.js'));
    const saga = [], calendario = [];
    for(let i=0; i<3000; i++){
      const o = String(800000+i);
      saga.push({ Ordem_Serial: o, Operation: '0132', Centro_Trabalho: '01CORTE', ClaveModelo: 'M'+(i%400), CodMat: '4005'+i, Name: 'PARABRISAS DELANTERO', ZTipo: 'ZPAR', Descricao: 'VIDRIO LAMINADO VERDE', ARCHIVO: `\\\\srv\\cnc-revisados\\modelo-${i}\\pieza-${i}.dxf` });
      calendario.push({ orden: o, puesto: '01CORTE', zfer: '7000'+(i%500), planCurve: 'CURVE', nivel: '05', vehiculo: 'TOYOTA LAND CRUISER 4D UTILITY 2022' });
    }
    const datosSql = path.join(dir, 'sql-falso.json'); fs.writeFileSync(datosSql, JSON.stringify({ saga, calendario }));

    const puerto = 5199;
    const t0 = Date.now();
    const p = await arrancarPuente(dir, puerto, { DB_SERVER: 'falso', CAL_DB_SERVER: 'falso', FAKE_SQL_DATOS: datosSql });
    console.log(JSON.stringify({ arranque_ms: Date.now() - t0, memoria_al_arrancar_mb: memoriaMb(puerto) }));
    try {
      const token = await login(p.url, 'Hfrodriguez', 'admin123');
      const gzip = process.argv.includes('--sin-gzip') ? false : true;
      await pedir(p.url, 'GET', '/api/ordenes-pendientes', { token, area: 'papel' }); // primera: la consulta a SQL

      await medir('Lista de corte papel (3.000 órdenes), 30 PCs a la vez', ()=>pedir(p.url, 'GET', '/api/ordenes-pendientes', { token, area: 'papel', gzip }));
      // lo que hace cada PC cuando ya tiene la lista y llega el aviso "lista" (o vence la hora) sin cambios
      const v = JSON.parse((await pedir(p.url, 'GET', '/api/ordenes-pendientes', { token, area: 'papel' })).texto).version;
      await medir('Lista de corte papel, ya la tiene (misma versión)', ()=>pedir(p.url, 'GET', '/api/ordenes-pendientes?version=' + encodeURIComponent(v), { token, area: 'papel', gzip }));
      await medir('Rack de tejidos (estado), 30 PCs a la vez', ()=>pedir(p.url, 'GET', '/api/tejidos/rack', { token, area: 'tejidos', gzip }));
      const et = JSON.parse((await pedir(p.url, 'GET', '/api/tejidos/rack', { token, area: 'tejidos' })).texto), vt = et.firma || et.version;
      await medir('Rack de tejidos, ya lo tiene (misma versión)', ()=>pedir(p.url, 'GET', '/api/tejidos/rack?version=' + vt, { token, area: 'tejidos', gzip }));
      await medir('Historial de tejidos (últimos 7 días)', ()=>pedir(p.url, 'GET', '/api/tejidos/historial?limite=2000&evento=movimientos&desde=' + new Date(Date.now()-7*864e5).toISOString().slice(0, 10), { token, area: 'tejidos', gzip }));
      await medir('Historial de tejidos, buscar texto en todo', ()=>pedir(p.url, 'GET', '/api/tejidos/historial?limite=2000&texto=perez', { token, area: 'tejidos', gzip }), 3);
      await medir('Resumen del día papel, 30 PCs', ()=>pedir(p.url, 'GET', '/api/rack-resumen-dia', { token, area: 'papel', gzip }));
      // escrituras: cada entrada y salida de papel agrega al historial de 70.000
      await medir('Papel: entrada + salida (historial de 70.000)', async (i, r)=>{
        const o = { ...orden(900000 + r*100 + i), Ordem_Serial: 'B' + r + '-' + i };
        const a = await pedir(p.url, 'POST', '/api/rack-simulado/agregar', { token, area: 'papel', cuerpo: o });
        const b = await pedir(p.url, 'POST', `/api/rack-simulado/${encodeURIComponent(o.Ordem_Serial)}/salida`, { token, area: 'papel' });
        return { ms: a.ms + b.ms, bytes: a.bytes + b.bytes, s: Math.max(a.s, b.s) };
      }, 2, 10);
      console.log(JSON.stringify({ memoria_al_final_mb: memoriaMb(puerto) }));
      await p.reiniciar(); // con los datos ya convertidos: memoria de un arranque normal
      await login(p.url, 'Hfrodriguez', 'admin123');
      console.log(JSON.stringify({ memoria_tras_reiniciar_mb: memoriaMb(puerto) }));
    } finally { await p.cerrar(); }
  } finally { borrarCopia(dir); }
})().catch(e=>{ console.error(e); process.exit(1); });
