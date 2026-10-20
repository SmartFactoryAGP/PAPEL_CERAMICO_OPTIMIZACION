/* Utilidades compartidas de las pruebas.
   REGLA: ninguna prueba toca los datos reales. Cada una arma una COPIA de
   la app en una carpeta temporal (sin server/datos/), levanta ahí su
   propio puente en otro puerto, y la borra al terminar. */
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..', '..');
const NODE_MODULES = path.join(RAIZ, 'server', 'node_modules');
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p=>fs.existsSync(p));
const sleep = ms => new Promise(r=>setTimeout(r, ms));
const ok = msg => console.log('  OK ' + msg);
const USUARIOS = 'Hfrodriguez:admin123,Ana:ana123,Beto:beto123'; // se importan al primer arranque (Ana y Beto con todos los permisos)

/* Copia la app (sin datos) a una carpeta temporal y devuelve su ruta. */
function prepararCopia(nombre){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `semiterminados-${nombre}-`));
  ['index.html'].forEach(f=>fs.copyFileSync(path.join(RAIZ, f), path.join(dir, f)));
  ['css', 'js', 'img'].forEach(d=>fs.cpSync(path.join(RAIZ, d), path.join(dir, d), { recursive: true }));
  fs.mkdirSync(path.join(dir, 'server'));
  fs.readdirSync(path.join(RAIZ, 'server')).filter(f=>f.endsWith('.js')).forEach(f=>fs.copyFileSync(path.join(RAIZ, 'server', f), path.join(dir, 'server', f)));
  return dir;
}
function borrarCopia(dir){ try { fs.rmSync(dir, { recursive: true, force: true }); } catch(e){} }

/* Levanta el puente de la copia. Devuelve {url, log(), cerrar(), reiniciar()}. */
async function arrancarPuente(dir, puerto, envExtra){
  const env = Object.assign({}, process.env, { PORT: String(puerto), AUTH_USUARIOS: USUARIOS, NODE_PATH: NODE_MODULES, API_TOKEN: '' }, envExtra||{});
  let proc, texto = '';
  const iniciar = async ()=>{
    texto = '';
    proc = spawn(process.execPath, ['server.js'], { cwd: path.join(dir, 'server'), env });
    proc.stdout.on('data', d=>texto+=d); proc.stderr.on('data', d=>texto+=d);
    for(let i=0; i<100 && !texto.includes('escuchando'); i++) await sleep(100);
    if(!texto.includes('escuchando')) throw new Error('el puente no arrancó:\n' + texto);
  };
  await iniciar();
  return {
    url: `http://localhost:${puerto}`,
    log: ()=>texto,
    cerrar: async ()=>{ proc.kill(); await sleep(300); },
    reiniciar: async ()=>{ proc.kill(); await sleep(400); await iniciar(); },
  };
}

/* Pedido a la API con conexión reutilizable (rápido para pruebas de carga). */
const agente = new http.Agent({ keepAlive: true, maxSockets: 64 });
function api(url, metodo, ruta, opciones){
  const o = opciones || {};
  return new Promise((resolver, rechazar)=>{
    const cuerpo = o.cuerpo ? JSON.stringify(o.cuerpo) : null;
    const t0 = Date.now();
    const headers = { 'Content-Type': 'application/json' };
    if(o.token) headers['x-auth-token'] = o.token;
    if(o.area) headers['x-area'] = o.area;
    const r = http.request(url + ruta, { method: metodo, agent: agente, headers }, res=>{
      let s = ''; res.on('data', c=>s+=c);
      res.on('end', ()=>{ let d = null; try { d = JSON.parse(s); } catch(e){} resolver({ s: res.statusCode, d, ms: Date.now()-t0 }); });
    });
    r.on('error', rechazar); if(cuerpo) r.write(cuerpo); r.end();
  });
}
async function login(url, usuario, clave){
  const r = await api(url, 'POST', '/api/login', { cuerpo: { usuario, clave } });
  if(r.s !== 200) throw new Error(`login de ${usuario} falló: ${r.s} ${JSON.stringify(r.d)}`);
  return r.d.token;
}
/* Escucha los avisos en vivo (/api/eventos) como lo haría una pestaña. */
function oyente(url, token){
  const o = { eventos: [], abierto: false, cerrado: false };
  const r = http.get(`${url}/api/eventos?auth=${encodeURIComponent(token)}`, res=>{
    o.abierto = res.statusCode === 200; let buf = '';
    res.on('end', ()=>{ o.cerrado = true; }); // el puente cortó la conexión
    res.on('data', c=>{ buf += c; let i; while((i = buf.indexOf('\n\n')) >= 0){ const b = buf.slice(0, i); buf = buf.slice(i+2);
      const l = b.split('\n').find(x=>x.startsWith('data: ')); if(l) o.eventos.push(JSON.parse(l.slice(6))); } });
    res.on('error', ()=>{});
  });
  r.on('error', ()=>{});
  o.cerrar = ()=>r.destroy();
  return o;
}

/* Chrome sin interfaz, manejado por el protocolo DevTools.
   pagina(): abre una pestaña en un perfil aislado (= otra PC). */
async function abrirChrome(puertoDebug){
  if(!CHROME) throw new Error('no encontré Chrome ni Edge instalados');
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'semiterminados-chrome-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${puertoDebug}`, `--user-data-dir=${perfil}`, '--no-first-run', 'about:blank']);
  let version;
  for(let i=0; i<80 && !version; i++){ await sleep(150); try { version = await (await fetch(`http://127.0.0.1:${puertoDebug}/json/version`)).json(); } catch(e){} }
  if(!version) throw new Error('Chrome no respondió');
  const nav = await conectar(version.webSocketDebuggerUrl);
  return {
    async pagina(){
      const ctx = await nav.send('Target.createBrowserContext');
      const t = await nav.send('Target.createTarget', { url: 'about:blank', browserContextId: ctx.result.browserContextId });
      const p = await conectar(`ws://127.0.0.1:${puertoDebug}/devtools/page/${t.result.targetId}`);
      await p.send('Page.enable'); await p.send('Runtime.enable');
      await p.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
      p.ev = async expr=>{ const r = await p.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if(r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails)); return r.result.result.value; };
      p.ir = async url=>{ await p.send('Page.navigate', { url }); await sleep(1800); };
      p.entrar = async (usuario, clave, area)=>{
        await p.ev(`document.querySelector('input[value="${area}"]').click(); document.getElementById('authUsuarioInput').value=${JSON.stringify(usuario)};
          document.getElementById('authClaveInput').value=${JSON.stringify(clave)}; document.getElementById('authLoginConfirmBtn').click(); 1`);
        await sleep(1200);
      };
      // un toque de dedo de verdad (eventos táctiles, como en el celular) en el centro del elemento
      p.toque = async selector=>{
        const c = await p.ev(`(()=>{ const e=document.querySelector(${JSON.stringify(selector)}); if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
        if(!c) throw new Error('no existe ' + selector);
        await sleep(150);
        await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
        await sleep(60);
        await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      p.captura = async archivo=>{ const r = await p.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(archivo, Buffer.from(r.result.data, 'base64')); };
      return p;
    },
    async cerrar(){ try { proc.kill(); } catch(e){} await sleep(300); try { fs.rmSync(perfil, { recursive: true, force: true }); } catch(e){} }
  };
}
async function conectar(wsUrl){
  const ws = new WebSocket(wsUrl); await new Promise((r, x)=>{ ws.onopen = r; ws.onerror = x; });
  let id = 0; const pend = new Map(); const errores = [];
  const c = { errores, ws };
  ws.onmessage = e=>{ const m = JSON.parse(e.data);
    if(m.id && pend.has(m.id)){ pend.get(m.id)(m); pend.delete(m.id); }
    if(m.method === 'Runtime.exceptionThrown') errores.push(JSON.stringify(m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description : m.params.exceptionDetails.text));
    if(m.method === 'Page.javascriptDialogOpening') c.send('Page.handleJavaScriptDialog', { accept: true }); // los confirm() se aceptan solos
  };
  c.send = (method, params)=>new Promise(r=>{ const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params||{} })); });
  return c;
}

/* Corre una prueba: imprime el título, atrapa errores y limpia siempre. */
async function prueba(titulo, fn){
  console.log(`\n== ${titulo} ==`);
  const limpiar = [];
  try {
    await fn(f=>limpiar.push(f));
    console.log('  PASÓ');
  } catch(e){
    console.error('  FALLÓ: ' + (e && e.stack || e));
    process.exitCode = 1;
  } finally {
    for(const f of limpiar.reverse()){ try { await f(); } catch(e){} }
    agente.destroy();
  }
}

module.exports = { RAIZ, sleep, ok, prepararCopia, borrarCopia, arrancarPuente, api, login, oyente, abrirChrome, prueba };
