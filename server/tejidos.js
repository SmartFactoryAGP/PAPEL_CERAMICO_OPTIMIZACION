/* =========================================================
   RACK DE TEJIDOS — una pieza por posición, con foto y sticker
   =========================================================
   Las posiciones tienen nombre (A1.1, B12.1…) y un tamaño (P, G, XG); cada
   tejido tiene su tamaño (por CodMat). Al dar entrada (uno a uno), el
   puente elige la primera posición LIBRE de ese tamaño, en orden (A1.1,
   A1.2…); si no hay, una de tamaño más grande (nunca una más chica).
   Cada entrada lleva foto del calentamiento (obligatoria), responsables y
   resistencia 1 (obligatorios), resistencia 2 y ensamble.

   Archivos (server/datos/tejidos/, todos de esta área):
     posiciones.json   [{pos, tamano}]          el rack físico (se carga del Excel)
     tamanos.json      {codmat: {tamano, nombre, vehiculo, geometria}} de cada tejido (Excel + "Asignar")
     ocupacion.json    {pos: unidad}            lo que hay hoy en cada posición
     historial.jsonl   entradas, salidas y tamaños asignados (solo se agrega)
     fotos/            una foto por entrada (no van al respaldo diario: ver datos.js)
   Todo el acceso a esos archivos pasa por acá (el día que vivan en SQL,
   se reemplaza este módulo). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { errorHttp, esHoy } = require('./comun');
const { codmatCorto } = require('./reglas-mallas');

const FOTO_MAX_BYTES = 8 * 1048576;
const LARGO = { nombre: 120, responsables: 80, resistencia: 40, ensamble: 60, nota: 200 };
// tipos de imagen aceptados, reconocidos por sus primeros bytes (no por lo que diga el navegador)
const FIRMAS = [
  { ext: 'jpg',  ok: b => b[0]===0xFF && b[1]===0xD8 && b[2]===0xFF },
  { ext: 'png',  ok: b => b[0]===0x89 && b[1]===0x50 && b[2]===0x4E && b[3]===0x47 },
  { ext: 'webp', ok: b => b.slice(0,4).toString('latin1')==='RIFF' && b.slice(8,12).toString('latin1')==='WEBP' },
];

/* A1.1 < A1.2 < A2.1 < A10.1 < B1.1: letras y después cada número como número */
function compararPos(a, b){
  const pa = String(a).match(/[A-Za-z]+|\d+/g) || [], pb = String(b).match(/[A-Za-z]+|\d+/g) || [];
  for(let i=0; i<Math.max(pa.length, pb.length); i++){
    const x = pa[i], y = pb[i];
    if(x===undefined) return -1; if(y===undefined) return 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if(nx && ny){ if(+x !== +y) return +x - +y; }
    else if(x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function crear({ datos, notificar, area }){
  const TAMANOS = area.rack.tamanos;                       // de menor a mayor
  const dir = () => path.dirname(datos.rutas.rack(area.id));
  const ruta = n => path.join(dir(), n);
  const rutaFotos = () => { const d = ruta('fotos'); fs.mkdirSync(d, { recursive: true }); return d; };
  /* lectura y escritura propias (estos JSON son objetos, no listas): si existe y está
     dañado, falla al arrancar en vez de tomarlo como vacío y pisarlo; la escritura es
     atómica (temporal + renombrar), igual que la del resto de los racks */
  function leerJson(n, porDefecto){
    const r = ruta(n);
    if(!fs.existsSync(r)) return porDefecto;
    const t = fs.readFileSync(r, 'utf8');
    if(!t.trim()) return porDefecto;
    try { return JSON.parse(t); } catch(e){ throw new Error(`${area.id}/${n} está dañado (no es JSON válido): revisalo o restauralo del respaldo`); }
  }
  function escribirJson(n, valor){
    const r = ruta(n), tmp = r + '.tmp', texto = JSON.stringify(valor, null, 1);
    try { fs.writeFileSync(tmp, texto, 'utf8'); fs.renameSync(tmp, r); }
    catch(e){ try { fs.unlinkSync(tmp); } catch(_){} fs.writeFileSync(r, texto, 'utf8'); }
  }

  let posiciones = [], tamanos = {}, ocupacion = {}, version = 0;
  const porIdCliente = new Map();

  function cargar(){
    posiciones = (leerJson('posiciones.json', []) || [])
      .filter(p=>p && p.pos && TAMANOS.includes(p.tamano)).sort((a, b)=>compararPos(a.pos, b.pos));
    tamanos = leerJson('tamanos.json', {});
    ocupacion = leerJson('ocupacion.json', {});
    // el historial cuenta las versiones y recuerda los idCliente (para no duplicar una entrada reintentada)
    const h = ruta('historial.jsonl');
    if(fs.existsSync(h)){
      fs.readFileSync(h, 'utf8').split('\n').forEach(t=>{
        if(!t.trim()) return;
        try { const ev = JSON.parse(t); version++; if(ev.idCliente) porIdCliente.set(ev.idCliente, ev); } catch(e){ /* línea cortada por un apagón */ }
      });
    }
    const n = Object.keys(ocupacion).length;
    console.log(`Rack de ${area.nombre}: ${posiciones.length} posiciones (${n} ocupadas), ${Object.keys(tamanos).length} tejidos con tamaño.`);
  }

  function registrar(ev){
    fs.appendFileSync(ruta('historial.jsonl'), JSON.stringify(ev) + '\n', 'utf8');
    version++;
    if(ev.idCliente) porIdCliente.set(ev.idCliente, ev);
    notificar({ tipo: 'tejidos', area: area.id, version });
    notificar({ tipo: 'lista', area: area.id }); // el stock cambia lo que "Falta" en Lista de corte
  }
  const texto = (v, max) => String(v==null ? '' : v).trim().slice(0, max);

  function estado(){
    return {
      version,
      tamanos: TAMANOS,
      posiciones: posiciones.map(p=>({ pos: p.pos, tamano: p.tamano, unidad: ocupacion[p.pos] || null })),
      tamanosTejidos: tamanos,
      hoy: totalesDeHoy(),
    };
  }
  function totalesDeHoy(){
    let entra = 0, sale = 0;
    try {
      const h = ruta('historial.jsonl');
      if(fs.existsSync(h)) fs.readFileSync(h, 'utf8').split('\n').forEach(t=>{
        if(!t.trim()) return; try { const ev = JSON.parse(t); if(!esHoy(ev.fecha)) return; if(ev.evento==='entrada') entra++; else if(ev.evento==='salida') sale++; } catch(e){}
      });
    } catch(e){}
    return { entra, sale };
  }

  /* Stock por CodMat = posiciones ocupadas con ese tejido (lo usa "Falta" de Lista de corte). */
  function stockPorMaterial(){
    const m = new Map();
    Object.values(ocupacion).forEach(u=>{ if(u.codmat) m.set(u.codmat, (m.get(u.codmat)||0) + 1); });
    return m;
  }
  const tamanoDe = codmat => (tamanos[codmatCorto(codmat)] || {}).tamano || '';

  function fijarTamano({ codmat, tamano, nombre }, usuario){
    const c = codmatCorto(codmat);
    if(!/^\d{1,18}$/.test(c)) throw errorHttp('CodMat inválido.');
    if(!TAMANOS.includes(tamano)) throw errorHttp(`Tamaño inválido: ${TAMANOS.join(', ')}.`);
    const antes = tamanos[c] && tamanos[c].tamano;
    tamanos[c] = { ...(tamanos[c] || {}), tamano, nombre: texto(nombre, LARGO.nombre) || (tamanos[c] && tamanos[c].nombre) || '' };
    escribirJson('tamanos.json', tamanos);
    registrar({ evento: 'tamano', codmat: c, tamano, antes: antes || null, usuario, fecha: new Date().toISOString() });
    return { codmat: c, tamano };
  }

  /* Guarda la foto (ya achicada por el navegador). Devuelve el nombre de archivo. */
  function guardarFoto(buffer){
    if(!Buffer.isBuffer(buffer) || buffer.length < 100) throw errorHttp('No llegó ninguna foto.');
    if(buffer.length > FOTO_MAX_BYTES) throw errorHttp(`La foto pesa demasiado (máximo ${FOTO_MAX_BYTES/1048576} MB).`, 413);
    const tipo = FIRMAS.find(f=>f.ok(buffer));
    if(!tipo) throw errorHttp('El archivo no es una foto (JPG, PNG o WEBP).');
    const archivo = crypto.randomBytes(12).toString('hex') + '.' + tipo.ext;
    fs.writeFileSync(path.join(rutaFotos(), archivo), buffer);
    return archivo;
  }
  function rutaFoto(archivo){
    if(!/^[a-f0-9]{24}\.(jpg|png|webp)$/.test(String(archivo||''))) return null;
    const r = path.join(rutaFotos(), archivo);
    return fs.existsSync(r) ? r : null;
  }

  /* Primera posición libre del tamaño pedido; si no hay, de uno más grande. */
  function posicionLibre(tamano){
    const desde = TAMANOS.indexOf(tamano);
    for(const t of TAMANOS.slice(desde)){
      const p = posiciones.find(x=>x.tamano===t && !ocupacion[x.pos]);
      if(p) return p;
    }
    return null;
  }

  function entrada(cuerpo, usuario){
    const b = cuerpo || {};
    const idCliente = typeof b.idCliente==='string' ? b.idCliente.slice(0, 64) : null;
    if(idCliente && porIdCliente.has(idCliente)){
      const ev = porIdCliente.get(idCliente);
      return { repetido: true, posicion: ev.pos, unidad: ev.unidad, version };
    }
    const codmat = codmatCorto(b.codmat);
    if(!/^\d{1,18}$/.test(codmat)) throw errorHttp('Elegí el tejido (CodMat).');
    const responsables = texto(b.responsables, LARGO.responsables), resistencia1 = texto(b.resistencia1, LARGO.resistencia);
    if(!responsables) throw errorHttp('Falta el responsable.');
    if(!resistencia1) throw errorHttp('Falta la resistencia 1.');
    if(!rutaFoto(b.foto)) throw errorHttp('Falta la foto del calentamiento (obligatoria).');
    const tamano = tamanoDe(codmat);
    if(!tamano) throw errorHttp(`El tejido ${codmat} no tiene tamaño: asignáselo antes de darle entrada.`, 409, { sinTamano: true });
    if(!posiciones.length) throw errorHttp('El rack de tejidos no tiene posiciones cargadas.', 409);
    const p = posicionLibre(tamano);
    if(!p) throw errorHttp(`No queda ninguna posición libre de tamaño ${tamano} ni más grande.`, 409);
    const unidad = {
      id: crypto.randomBytes(6).toString('hex'),
      codmat, nombre: texto(b.nombre, LARGO.nombre) || (tamanos[codmat] && tamanos[codmat].nombre) || codmat,
      tamano, tamanoPosicion: p.tamano,
      // vehículo: el del Excel de tamaños; si no lo tiene, el que mostraba la Lista de corte
      vehiculo: (tamanos[codmat] && tamanos[codmat].vehiculo) || texto(b.vehiculo, LARGO.nombre),
      geometria: (tamanos[codmat] && tamanos[codmat].geometria) || '',
      responsables, resistencia1, resistencia2: texto(b.resistencia2, LARGO.resistencia), ensamble: texto(b.ensamble, LARGO.ensamble),
      nota: texto(b.nota, LARGO.nota) || null,
      foto: b.foto, usuario, fecha: new Date().toISOString(),
    };
    ocupacion[p.pos] = unidad;
    escribirJson('ocupacion.json', ocupacion);
    registrar({ evento: 'entrada', pos: p.pos, unidad, idCliente, usuario, fecha: unidad.fecha });
    return { posicion: p.pos, masGrande: p.tamano !== tamano, unidad, version };
  }

  function salida({ posicion, motivo }, usuario){
    const pos = String(posicion||'').trim().toUpperCase();
    const unidad = ocupacion[pos];
    if(!unidad) throw errorHttp(`La posición ${pos || '(vacía)'} no tiene ningún tejido.`, 409);
    delete ocupacion[pos];
    escribirJson('ocupacion.json', ocupacion);
    registrar({ evento: 'salida', pos, unidad, motivo: texto(motivo, LARGO.nota) || null, usuario, fecha: new Date().toISOString() });
    return { posicion: pos, version };
  }

  /* Histórico de entradas, salidas y tamaños (lo más nuevo primero). Filtros opcionales:
     desde/hasta (AAAA-MM-DD, hora local), evento (entrada, salida, tamano o
     'movimientos' = entradas y salidas), texto (CodMat, nombre, posición,
     responsables, usuario…) y limite (máx. 5000). Devuelve también el total sin límite. */
  function historial({ desde, hasta, evento, texto: q, limite } = {}){
    const dia = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s||'')) ? s : null;
    const d = dia(desde), h = dia(hasta);
    const diaLocal = f => { const x = new Date(f); if(isNaN(x)) return ''; const p = n => String(n).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth()+1)}-${p(x.getDate())}`; };
    const busca = String(q||'').trim().toLowerCase().slice(0, 80);
    const tope = Math.min(Math.max(parseInt(limite, 10) || 1000, 1), 5000);
    const r = ruta('historial.jsonl');
    const lista = [];
    if(fs.existsSync(r)) fs.readFileSync(r, 'utf8').split('\n').forEach(t=>{
      if(!t.trim()) return;
      let ev; try { ev = JSON.parse(t); } catch(e){ return; }
      if(evento==='movimientos' ? ev.evento==='tamano' : (evento && ev.evento !== evento)) return;
      const f = diaLocal(ev.fecha);
      if((d && f < d) || (h && f > h)) return;
      const u = ev.unidad || {};
      if(busca){
        const pajar = [ev.pos, ev.codmat, u.codmat, u.nombre, u.vehiculo, u.responsables, u.resistencia1, u.resistencia2, u.ensamble, ev.usuario, u.usuario, ev.motivo]
          .filter(Boolean).join(' ').toLowerCase();
        if(!pajar.includes(busca)) return;
      }
      lista.push({
        evento: ev.evento, fecha: ev.fecha, usuario: ev.usuario || '', pos: ev.pos || '',
        codmat: u.codmat || ev.codmat || '', nombre: u.nombre || (tamanos[ev.codmat] && tamanos[ev.codmat].nombre) || '',
        vehiculo: u.vehiculo || (tamanos[u.codmat || ev.codmat] || {}).vehiculo || '',
        tamano: ev.evento==='tamano' ? ev.tamano : (u.tamano || ''), antes: ev.antes || null,
        responsables: u.responsables || '', resistencia1: u.resistencia1 || '', resistencia2: u.resistencia2 || '', ensamble: u.ensamble || '',
        foto: u.foto || null, motivo: ev.motivo || null,
        fechaEntrada: ev.evento==='salida' ? (u.fecha || null) : null,
      });
    });
    lista.reverse();
    return { total: lista.length, eventos: lista.slice(0, tope), version };
  }

  cargar();
  return { estado, stockPorMaterial, tamanoDe, fijarTamano, guardarFoto, rutaFoto, entrada, salida, historial, version: ()=>version };
}

module.exports = { crear, compararPos };
