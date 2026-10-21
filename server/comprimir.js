/* =========================================================
   COMPRESIÓN (gzip) de lo que manda el puente — sin librerías nuevas
   =========================================================
   La Lista de corte de papel pesa ~1 MB en JSON y cada PC la baja; el
   celular entra por el túnel. Comprimida viaja ~8 veces más liviana.
   - JSON de la API (res.json): se comprime si pesa más de 2 KB y el
     navegador acepta gzip. Nunca los avisos en vivo (/api/eventos, que
     no usan res.json) ni las fotos (ya vienen comprimidas).
   - JS, CSS e index.html: se comprimen UNA vez y quedan en memoria
     (validado por fecha y tamaño del archivo), así cada PC que abre la
     app no le cuesta CPU al puente.
   Las pruebas automáticas no mandan Accept-Encoding: les llega sin
   comprimir, igual que antes. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MINIMO = 2048;
const aceptaGzip = req => /\bgzip\b/.test(req.headers['accept-encoding'] || '');

/* gzip de un texto o buffer, sin trabar al puente (zlib corre en otro hilo) */
const gzip = datos => new Promise((ok, mal)=>zlib.gzip(datos, { level: 6 }, (e, r)=>e ? mal(e) : ok(r)));

/* Manda un cuerpo ya armado, comprimido si conviene. Si se pasa `gz`
   (el mismo cuerpo ya comprimido, de una caché), no se vuelve a comprimir. */
async function enviar(req, res, cuerpo, tipo, gz){
  res.setHeader('Vary', 'Accept-Encoding');
  if(!res.getHeader('Content-Type')) res.setHeader('Content-Type', tipo);
  const buf = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo, 'utf8');
  if(buf.length < MINIMO || !aceptaGzip(req)){ res.setHeader('Content-Length', buf.length); return res.end(buf); }
  try {
    const z = gz || await gzip(buf);
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', z.length);
    res.end(z);
  } catch(e){ if(!res.headersSent){ res.removeHeader('Content-Encoding'); res.setHeader('Content-Length', buf.length); } res.end(buf); }
}

/* res.json comprimido para toda la API */
function middlewareJson(req, res, next){
  res.json = obj => {
    if(res.headersSent) return res;
    enviar(req, res, JSON.stringify(obj), 'application/json; charset=utf-8');
    return res;
  };
  // cuerpo ya serializado (y quizás ya comprimido) de una caché: ver cacheRespuesta
  res.jsonCrudo = (texto, gz) => enviar(req, res, texto, 'application/json; charset=utf-8', gz);
  next();
}

/* Archivos estáticos comprimidos en memoria (se sirven antes que express.static). */
const TIPOS = { '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml' };
const cacheEstaticos = new Map(); // ruta -> {mtimeMs, size, gz}
function estaticosComprimidos(raiz, opciones){
  const o = opciones || {};
  return async (req, res, next) => {
    if((req.method!=='GET' && req.method!=='HEAD') || !aceptaGzip(req)) return next();
    const rel = decodeURIComponent(req.path);
    const tipo = TIPOS[path.extname(rel).toLowerCase()];
    if(!tipo) return next();
    const ruta = path.join(raiz, rel);
    if(!ruta.startsWith(raiz + path.sep) && ruta !== raiz) return next(); // nada fuera de la carpeta
    let st; try { st = fs.statSync(ruta); } catch(e){ return next(); }
    if(!st.isFile()) return next();
    try {
      let c = cacheEstaticos.get(ruta);
      if(!c || c.mtimeMs!==st.mtimeMs || c.size!==st.size){
        c = { mtimeMs: st.mtimeMs, size: st.size, gz: await gzip(fs.readFileSync(ruta)) };
        cacheEstaticos.set(ruta, c);
      }
      if(o.setHeaders) o.setHeaders(res);
      // validación (lo pedido sin ?v=): si no cambió, 304 sin cuerpo, como hacía express.static
      const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}-gz"`;
      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', st.mtime.toUTCString());
      res.setHeader('Vary', 'Accept-Encoding');
      if(req.headers['if-none-match']===etag){ res.statusCode = 304; return res.end(); }
      res.setHeader('Content-Type', tipo);
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Content-Length', c.gz.length);
      res.end(req.method==='HEAD' ? undefined : c.gz);
    } catch(e){ next(); }
  };
}

/* Caché de UNA respuesta por clave (por ej. área + versión de la Lista de
   corte): se arma y se comprime una sola vez aunque la pidan 30 PCs juntas
   (las que llegan mientras se arma esperan esa misma promesa). */
function cacheRespuesta(max = 8){
  const m = new Map(); // clave -> Promise<{texto, gz}>
  return function obtener(clave, armar){
    let p = m.get(clave);
    if(!p){
      p = Promise.resolve().then(armar).then(async obj=>{ const texto = JSON.stringify(obj); return { texto, gz: texto.length >= MINIMO ? await gzip(texto) : null }; });
      p.catch(()=>m.delete(clave)); // un error no queda guardado
      m.set(clave, p);
      while(m.size > max) m.delete(m.keys().next().value); // las más viejas afuera
    }
    return p;
  };
}

module.exports = { middlewareJson, estaticosComprimidos, cacheRespuesta, aceptaGzip };
