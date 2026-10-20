/* =========================================================
   LISTA DE CORTE DE MALLAS — qué hay que fabricar, y cuánto falta
   =========================================================
   Sale de la misma vista de SAGA (Operation 2900, unMed UND, descripción
   con "TNT") y del mismo BUSCARV de Calendario (Puestodetrabajo,
   Vehículo). A diferencia de papel cerámico no va por orden: se agrupa
   por Desenho_CodMat y Puestodetrabajo, y la Cantidad es la SUMA de
   unidades (columna m2, que con unMed UND trae cuántas mallas lleva cada
   orden: 1,000 / 2,000).

   El stock del rack de Mallas (por CodMat) se descuenta de la necesidad:
   primero cubre los puestos más avanzados (12P_ENSA, el más cerca de
   necesitar la malla) y después los anteriores, terminando en Planeacion.
   Así "Falta" dice qué hay que fabricar de verdad.

   Sin SQL ni archivos: se prueba sola (tools/pruebas/mallas.js). */

// del más avanzado al menos avanzado (orden en que el stock cubre la necesidad).
// Escritos como en Calendario (revisado en la tabla real: "05EMPAL", no "05EMPLA").
const PUESTOS = ['12P_ENSA', '11ZUND', '09IOX_S', '09IOX_E', '08PULIDO', '07RECORT', '06CURVAD', '05EMPAL',
                 '04SER_VT', '04SER_TT', '03SERIG', '02CNC', '01CORTE', 'PLANEACION'];
const PRIORIDAD = new Map(PUESTOS.map((p, i)=>[p, i]));
const texto = v => String(v==null ? '' : v).trim();
const puestoNorm = v => texto(v).toUpperCase();
function puestoPermitido(v){ return PRIORIDAD.has(puestoNorm(v)); }

/* "000000000600019608" -> "600019608" (SAP rellena a 18 con ceros; se
   sacan los 9 primeros, como se pidió — si no los trae, queda igual). */
function codmatCorto(v){ const s = texto(v); return s.startsWith('000000000') ? s.slice(9) : s; }
/* m2 con unMed UND = mallas por orden: "1.000" -> 1, "2,000" -> 2. Vacío o raro -> 1. */
function unidades(v){
  const n = parseFloat(texto(v).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/* filas: las de SAGA (Ordem_Serial, CodMat, Descricao, Cantidad=m2);
   calendario: orden -> {puesto, vehiculo}; stock: Map CodMat corto -> unidades.
   Devuelve { filas: [...por CodMat+puesto, ordenadas], totales: Map CodMat -> {necesidad, stock, falta} } */
function agrupar(filas, calendario, stock){
  const grupos = new Map();
  filas.forEach(f=>{
    const cal = calendario[String(f.Ordem_Serial)] || {};
    if(!puestoPermitido(cal.puesto)) return;
    const codmat = codmatCorto(f.CodMat);
    if(!codmat) return;
    const puesto = puestoNorm(cal.puesto)==='PLANEACION' ? 'Planeacion' : texto(cal.puesto);
    const clave = codmat + '|' + puestoNorm(puesto);
    let g = grupos.get(clave);
    if(!g){ g = { clave, CodMat: codmat, Descricao: texto(f.Descricao), Puestodetrabajo: puesto, vehiculos: new Set(), Cantidad: 0, ordenes: [] }; grupos.set(clave, g); }
    g.Cantidad += unidades(f.Cantidad);
    if(!g.ordenes.includes(String(f.Ordem_Serial))) g.ordenes.push(String(f.Ordem_Serial));
    if(cal.vehiculo) g.vehiculos.add(texto(cal.vehiculo));
    if(!g.Descricao && f.Descricao) g.Descricao = texto(f.Descricao);
  });
  // stock: cubre primero los puestos más avanzados
  const lista = [...grupos.values()].sort((a, b)=>
    a.CodMat.localeCompare(b.CodMat) || PRIORIDAD.get(puestoNorm(a.Puestodetrabajo)) - PRIORIDAD.get(puestoNorm(b.Puestodetrabajo)));
  const restante = new Map(), totales = new Map();
  lista.forEach(g=>{
    if(!restante.has(g.CodMat)) restante.set(g.CodMat, Math.max(0, (stock && stock.get(g.CodMat)) || 0));
    const cubre = Math.min(g.Cantidad, restante.get(g.CodMat));
    restante.set(g.CodMat, restante.get(g.CodMat) - cubre);
    g.Cubierto = cubre; g.Falta = g.Cantidad - cubre;
    const t = totales.get(g.CodMat) || { necesidad: 0, stock: (stock && stock.get(g.CodMat)) || 0, falta: 0, Descricao: g.Descricao };
    t.necesidad += g.Cantidad; t.falta += g.Falta; totales.set(g.CodMat, t);
  });
  const salida = lista.map(g=>({
    clave: g.clave, CodMat: g.CodMat, Descricao: g.Descricao, Vehiculo: [...g.vehiculos].join(' · '),
    Puestodetrabajo: g.Puestodetrabajo, Cantidad: g.Cantidad, Cubierto: g.Cubierto, Falta: g.Falta,
    Ordenes: g.ordenes.length, ordenes: g.ordenes.slice(0, 50)
  }));
  return { filas: salida, totales };
}

module.exports = { PUESTOS, puestoPermitido, codmatCorto, unidades, agrupar };
