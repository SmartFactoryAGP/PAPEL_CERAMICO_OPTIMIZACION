/* =========================================================
   RACKS DE CASILLAS (papel cerámico, mallas) — una orden por casilla
   =========================================================
   Almacenamiento: server/datos/<área>/rack.json (estado actual) y
   server/datos/<área>/historial.jsonl (entradas / salidas / reentradas,
   una línea por evento, solo crece). Todo el acceso a esos archivos pasa por acá: el día que
   los racks vivan en SQL, se reemplaza este módulo y los endpoints de
   server.js no cambian. */
const fs = require('fs');
const { leerListaJson, escribirListaJson } = require('./archivos');
const { errorHttp, esHoy } = require('./comun');

const MAX_CAMPOS = 60, MAX_LARGO_CLAVE = 64, MAX_LARGO_VALOR = 2000, MAX_LARGO_SERIAL = 64;

function crear({ datos, notificar }){
  const rutaRack = area => datos.rutas.rack(area.id);
  const rutaHistorial = area => datos.rutas.historial(area.id);

  const leer = area => leerListaJson(rutaRack(area));
  function guardar(area, lista){
    escribirListaJson(rutaRack(area), lista);
    notificar({ tipo:'rack', area: area.id }); // las demás PCs refrescan su Rack al instante
  }

  /* Historial: una línea por evento (historial.jsonl), que solo se AGREGA.
     Antes era un arreglo JSON que se reescribía entero en cada entrada o
     salida: con un año de uso (~70.000 eventos, ~28 MB) cada movimiento
     tardaba ~0,5 s y trababa al puente para todas las PCs. */
  /* Recorre el historial DESDE EL FINAL, de a bloques de 64 KB, hasta que `cada`
     devuelva false: para lo de hoy o lo último de una orden no hace falta leer
     (ni tener en memoria) el año entero. */
  function desdeElFinal(area, cada){
    const r = rutaHistorial(area);
    if(!fs.existsSync(r)) return;
    const fd = fs.openSync(r, 'r');
    try {
      let pos = fs.fstatSync(fd).size, resto = Buffer.alloc(0);
      const BLOQUE = 65536;
      while(pos > 0){
        const n = Math.min(BLOQUE, pos); pos -= n;
        const buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, pos);
        const todo = Buffer.concat([buf, resto]);
        // la primera línea del bloque puede estar cortada: queda para la vuelta siguiente
        const corte = pos > 0 ? todo.indexOf(10) : -1;
        resto = corte >= 0 ? todo.subarray(0, corte) : Buffer.alloc(0);
        const lineas = todo.subarray(corte + 1).toString('utf8').split('\n');
        for(let i=lineas.length-1; i>=0; i--){ if(lineas[i].trim() && cada(lineas[i])===false) return; }
      }
      if(resto.length){ const l = resto.toString('utf8'); if(l.trim()) cada(l); }
    } finally { fs.closeSync(fd); }
  }
  const parsear = t => { try { return JSON.parse(t); } catch(e){ return null; } }; // una línea cortada por un apagón se saltea
  /* Cuántas entraron y salieron HOY, llevado en memoria: se cuenta una vez desde
     el final del archivo (hasta el primer evento de otro día) y después se suma en cada evento. */
  const hoyPorArea = new Map(); // área -> {dia, entradas, salidas}
  const diaHoy = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`; };
  function resumenHoy(area){
    const dia = diaHoy();
    let c = hoyPorArea.get(area.id);
    if(!c){
      c = { dia, entradas: 0, salidas: 0 };
      desdeElFinal(area, t=>{
        const h = parsear(t); if(!h) return true;
        if(!esHoy(h.fecha)) return false;
        if(h.evento==='entrada') c.entradas++; else if(h.evento==='salida') c.salidas++;
        return true;
      });
      hoyPorArea.set(area.id, c);
    } else if(c.dia !== dia){ c.dia = dia; c.entradas = 0; c.salidas = 0; } // pasó la medianoche
    return { entradas: c.entradas, salidas: c.salidas };
  }
  /* La última salida de una orden (para la "reentrada"): desde el final,
     parseando solo las líneas que nombran esa orden. */
  function ultimaSalida(area, orden){
    const aguja = '"Ordem_Serial":' + JSON.stringify(String(orden));
    let encontrada = null;
    desdeElFinal(area, t=>{
      if(!t.includes(aguja)) return true;
      const h = parsear(t);
      if(h && h.Ordem_Serial===orden && h.evento==='salida' && h.ubicacion){ encontrada = h; return false; }
      return true;
    });
    return encontrada;
  }
  /* El rack es lo que manda: si el historial no se puede escribir, se avisa en
     consola y se saltea ESTE registro, sin hacer fallar la operación sobre el
     rack, que ya quedó guardada. */
  function agregarAlHistorial(area, entrada){
    try {
      const h = { ...entrada, fecha: new Date().toISOString() };
      fs.appendFileSync(rutaHistorial(area), JSON.stringify(h) + '\n', 'utf8');
      const c = hoyPorArea.get(area.id);
      if(c){
        if(c.dia !== diaHoy()){ c.dia = diaHoy(); c.entradas = 0; c.salidas = 0; }
        if(h.evento==='entrada') c.entradas++; else if(h.evento==='salida') c.salidas++;
      }
    } catch(err){
      console.error('[historial] no se registró el evento:', err.message, entrada);
    }
  }

  return { leer, guardar, resumenHoy, ultimaSalida, agregarAlHistorial };
}

/* Los endpoints de rack por órdenes son solo para racks de casillas;
   Tecoflex usa el inventario (/api/inventario). */
function exigirCasillas(area){
  if(area.rack.tipo !== 'casillas') throw errorHttp(`El rack de ${area.nombre} es un inventario por material y medida, no por órdenes (usá /api/inventario).`);
}
const capacidad = area => area.rack.letras.length * area.rack.porLetra;
/* La próxima casilla libre, A1, A2 ... G20. */
function proximaUbicacionLibre(area, lista){
  const ocupadas = new Set(lista.map(o=>o.ubicacion));
  for(const letra of area.rack.letras){
    for(let n=1; n<=area.rack.porLetra; n++){
      if(!ocupadas.has(letra+n)) return letra+n;
    }
  }
  return null; // todas las casillas están ocupadas
}
/* ¿Existe esa casilla en este rack? (A1…G20). La reentrada la manda el
   navegador: sin esto se podía "reingresar" en una casilla inventada. */
function ubicacionValida(area, ubicacion){
  const m = /^([A-Za-z]+)(\d+)$/.exec(String(ubicacion||''));
  if(!m) return false;
  const n = Number(m[2]);
  return area.rack.letras.includes(m[1]) && n>=1 && n<=area.rack.porLetra && String(n)===m[2];
}

/* La fila de la orden que manda el navegador se guarda en el rack: se
   aceptan solo valores simples y de largo razonable. Antes se guardaba el
   cuerpo del pedido tal cual: cualquiera con sesión podía meter objetos
   enormes o anidados en rack.json (y en cada respaldo diario). */
function limpiarOrden(orden){
  if(!orden || typeof orden!=='object' || Array.isArray(orden)) throw errorHttp('la orden no es válida');
  const out = {};
  const claves = Object.keys(orden);
  if(claves.length > MAX_CAMPOS) throw errorHttp(`la orden tiene demasiados campos (máximo ${MAX_CAMPOS})`);
  for(const k of claves){
    if(k.length > MAX_LARGO_CLAVE || k.startsWith('__')) continue;
    const v = orden[k];
    if(v===null || typeof v==='number' || typeof v==='boolean') out[k] = v;
    else if(typeof v==='string'){
      if(v.length > MAX_LARGO_VALOR) throw errorHttp(`el campo ${k} es demasiado largo`);
      out[k] = v;
    }
    // objetos y listas no son columnas de una orden: se descartan
  }
  if(!out.Ordem_Serial) throw errorHttp('falta Ordem_Serial');
  if(String(out.Ordem_Serial).length > MAX_LARGO_SERIAL) throw errorHttp('Ordem_Serial demasiado largo');
  return out;
}

module.exports = { crear, exigirCasillas, capacidad, proximaUbicacionLibre, ubicacionValida, limpiarOrden };
