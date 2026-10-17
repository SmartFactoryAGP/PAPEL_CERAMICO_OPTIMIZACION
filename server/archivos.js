/* =========================================================
   LECTURA Y ESCRITURA SEGURA DE LOS ARCHIVOS JSON DE DATOS
   ========================================================= */
const fs = require('fs');
const path = require('path');

/* Lee una lista guardada en un JSON. Si el archivo todavía no existe
   (primera vez) o está vacío, devuelve []; pero si EXISTE con contenido y
   no se puede parsear, TIRA ERROR en vez de devolver []. Un archivo a
   medio escribir (corte de luz, antivirus bloqueándolo) leído como "rack
   vacío" hacía que la siguiente escritura lo pisara: se perdía el rack
   entero (o el historial entero) sin ningún aviso.

   Caché en memoria validada por fecha de modificación + tamaño: cada PC
   pide el rack seguido, y releer y parsear el archivo en cada pedido
   costaba más que un stat. Si alguien lo edita a mano, cambia la
   fecha/tamaño y se vuelve a leer solo. Se devuelve siempre una COPIA
   del arreglo: quien lee hace push/filter, y eso no puede ensuciar la
   caché si después la escritura falla. */
const cache = new Map(); // ruta -> {mtimeMs, size, lista}
function leerListaJson(ruta){
  let st;
  try { st = fs.statSync(ruta); }
  catch(e){ if(e.code==='ENOENT'){ cache.delete(ruta); return []; } throw e; }
  const c = cache.get(ruta);
  if(c && c.mtimeMs===st.mtimeMs && c.size===st.size) return c.lista.slice();
  const texto = fs.readFileSync(ruta, 'utf8');
  let lista;
  if(!texto.trim()) lista = [];
  else {
    try { lista = JSON.parse(texto); }
    catch(e){ throw new Error(`${path.basename(ruta)} está dañado (no es JSON válido) — no se toca para no perder datos; revisalo o restauralo a mano`); }
  }
  cache.set(ruta, {mtimeMs: st.mtimeMs, size: st.size, lista});
  return lista.slice();
}

/* Escritura atómica: se escribe a un temporal al lado y se renombra
   encima (en el mismo disco, el renombre es atómico): el archivo queda
   con el contenido viejo entero o con el nuevo entero, nunca a medias.
   Si Windows no deja renombrar (por ej. el antivirus tiene el archivo
   abierto en ese instante), se escribe directo. */
function escribirListaJson(ruta, lista){
  const texto = JSON.stringify(lista, null, 2);
  const tmp = ruta + '.tmp';
  try {
    fs.writeFileSync(tmp, texto, 'utf8');
    fs.renameSync(tmp, ruta);
  } catch(e){
    try { fs.unlinkSync(tmp); } catch(_){ /* puede no existir */ }
    fs.writeFileSync(ruta, texto, 'utf8');
  }
  // lo que se acaba de escribir queda como caché (sin volver a parsearlo)
  try {
    const st = fs.statSync(ruta);
    cache.set(ruta, {mtimeMs: st.mtimeMs, size: st.size, lista: lista.slice()});
  } catch(_){ cache.delete(ruta); }
}

module.exports = { leerListaJson, escribirListaJson };
