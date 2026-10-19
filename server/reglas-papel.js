/* =========================================================
   QUÉ ÓRDENES ENTRAN A LA LISTA DE CORTE DE PAPEL CERÁMICO
   =========================================================
   Una sola regla para todo lo que llega a Lista de corte (lista normal,
   órdenes por ZFER como X5, ingreso rápido y lote por código), con los
   datos del "BUSCARV" contra Calendario:

     1. PlanCURVE = CURVE, siempre.
     2. NivelAGP >= 05  -> entra.
        NivelAGP 02, 03 o 04 -> entra SOLO si su ZFER está aprobado
        (vista "Aprobaciones"). Si no, queda como CANDIDATO: la vista de
        Aprobaciones lo ofrece para pedir la aprobación.
        NivelAGP 00/01 o vacío -> no entra.
     3. Puestodetrabajo permitido (Planeacion, 01CORTE, 02CNC, 03SERIG,
        04SER_VT) — solo en la lista normal: el ingreso manual (ingreso
        rápido, lote por código) no lo exige, como siempre.

   Sin acceso a SQL ni a archivos: se prueba sola (tools/pruebas/aprobaciones.js). */

const PUESTOS_PERMITIDOS = new Set(['PLANEACION','01CORTE','02CNC','03SERIG','04SER_VT']);
const NIVEL_MINIMO = 5;              // NivelAGP >= 05 entra sin aprobación
const NIVELES_CON_APROBACION = [2, 3, 4];

const texto = v => String(v==null ? '' : v).trim();
function puestoPermitido(valor){ return PUESTOS_PERMITIDOS.has(texto(valor).toUpperCase()); }
/* "05", "5", " 05 " -> 5; vacío o sin números -> null */
function nivelNumero(valor){
  const d = texto(valor).replace(/\D/g, '');
  return d ? parseInt(d, 10) : null;
}
const normalizarZfer = z => texto(z).toUpperCase();

/* ¿Entra esta orden? cal = {planCurve, nivel, zfer}; aprobados = Set de
   ZFER aprobados (normalizados). Devuelve {ok, motivo, candidato}. */
function evaluar(cal, aprobados){
  cal = cal || {};
  const plan = texto(cal.planCurve).toUpperCase();
  if(plan !== 'CURVE') return { ok:false, motivo: plan ? `PlanCURVE es "${texto(cal.planCurve)}", no CURVE` : 'sin PlanCURVE en Calendario' };
  const nivel = nivelNumero(cal.nivel);
  if(nivel===null) return { ok:false, motivo: 'sin NivelAGP en Calendario' };
  if(nivel >= NIVEL_MINIMO) return { ok:true };
  const nivelTxt = String(nivel).padStart(2, '0');
  if(NIVELES_CON_APROBACION.includes(nivel)){
    const zfer = normalizarZfer(cal.zfer);
    if(zfer && aprobados && aprobados.has(zfer)) return { ok:true, porAprobacion:true };
    return { ok:false, candidato: !!zfer,
      motivo: zfer ? `CURVE nivel ${nivelTxt}: el ZFER ${zfer} no está aprobado (pedilo en Aprobaciones)` : `CURVE nivel ${nivelTxt} sin ZFER en Calendario` };
  }
  return { ok:false, motivo: `NivelAGP ${nivelTxt} (menor a 05)` };
}

/* Pega los datos de Calendario en cada fila (columnas que se ven en la
   tabla) y separa la lista normal en: las que entran, y los CANDIDATOS a
   aprobación agrupados por ZFER. */
function pegarCalendario(fila, cal){
  cal = cal || {};
  fila.Puestodetrabajo = cal.puesto || '';
  fila.Vehiculo = cal.vehiculo || '';
  fila.ZFER = cal.zfer || '';
  fila.PlanCURVE = cal.planCurve || '';
  fila.NivelAGP = cal.nivel==null ? '' : String(cal.nivel);
  return fila;
}
function clasificar(filas, calendario, aprobados){
  const entran = [], porZfer = new Map();
  filas.forEach(f=>{
    const cal = calendario[String(f.Ordem_Serial)];
    pegarCalendario(f, cal);
    if(!puestoPermitido(f.Puestodetrabajo)) return;
    const r = evaluar(cal, aprobados);
    if(r.ok){ entran.push(f); return; }
    if(!r.candidato) return;
    const zfer = normalizarZfer(f.ZFER);
    let c = porZfer.get(zfer);
    if(!c){ c = { zfer, ordenes: [], niveles: new Set(), modelos: new Set(), vehiculos: new Set() }; porZfer.set(zfer, c); }
    if(!c.ordenes.includes(String(f.Ordem_Serial))) c.ordenes.push(String(f.Ordem_Serial));
    c.niveles.add(String(nivelNumero(f.NivelAGP)).padStart(2, '0'));
    if(f.ClaveModelo) c.modelos.add(texto(f.ClaveModelo));
    if(f.Vehiculo) c.vehiculos.add(texto(f.Vehiculo));
  });
  const candidatos = [...porZfer.values()].map(c=>({
    zfer: c.zfer, cantidad: c.ordenes.length, ordenes: c.ordenes.slice(0, 20),
    niveles: [...c.niveles].sort(), modelos: [...c.modelos].slice(0, 5), vehiculos: [...c.vehiculos].slice(0, 3)
  })).sort((a, b)=>b.cantidad - a.cantidad || a.zfer.localeCompare(b.zfer));
  return { entran, candidatos };
}

module.exports = { PUESTOS_PERMITIDOS, puestoPermitido, nivelNumero, normalizarZfer, evaluar, pegarCalendario, clasificar };
