/* =========================================================
   RACKS DE CASILLAS (papel cerámico, mallas) — una orden por casilla
   =========================================================
   Almacenamiento: server/datos/<área>/rack.json (estado actual) y
   server/datos/<área>/historial.json (entradas / salidas / reentradas,
   solo crece). Todo el acceso a esos archivos pasa por acá: el día que
   los racks vivan en SQL, se reemplaza este módulo y los endpoints de
   server.js no cambian. */
const { leerListaJson, escribirListaJson } = require('./archivos');
const { errorHttp } = require('./comun');

const MAX_CAMPOS = 60, MAX_LARGO_CLAVE = 64, MAX_LARGO_VALOR = 2000, MAX_LARGO_SERIAL = 64;

function crear({ datos, notificar }){
  const rutaRack = area => datos.rutas.rack(area.id);
  const rutaHistorial = area => datos.rutas.historial(area.id);

  const leer = area => leerListaJson(rutaRack(area));
  function guardar(area, lista){
    escribirListaJson(rutaRack(area), lista);
    notificar({ tipo:'rack', area: area.id }); // las demás PCs refrescan su Rack al instante
  }

  const leerHistorial = area => leerListaJson(rutaHistorial(area));
  /* El rack es lo que manda: si el historial no se puede leer, se avisa en
     consola y se saltea ESTE registro, sin pisar el archivo dañado (se
     puede recuperar a mano) y sin hacer fallar la operación sobre el rack,
     que ya quedó guardada. */
  function agregarAlHistorial(area, entrada){
    try {
      const historial = leerHistorial(area);
      historial.push({ ...entrada, fecha: new Date().toISOString() });
      escribirListaJson(rutaHistorial(area), historial);
    } catch(err){
      console.error('[historial] no se registró el evento:', err.message, entrada);
    }
  }

  return { leer, guardar, leerHistorial, agregarAlHistorial };
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
