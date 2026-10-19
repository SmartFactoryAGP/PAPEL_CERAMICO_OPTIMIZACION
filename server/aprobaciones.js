/* =========================================================
   APROBACIÓN DE ZFER CON PAPEL CERÁMICO (piezas CURVE nivel 02–04)
   =========================================================
   Las piezas CURVE de nivel 02, 03 o 04 a veces llevan papel y a veces
   no. El operario pide que un ZFER se trate como "lleva papel"; un
   usuario con permiso "Aprobar ZFER" lo aprueba o lo rechaza. Aprobado,
   TODAS las órdenes de ese ZFER entran a Lista de corte de ahí en
   adelante, igual que el ZFER especial de X5 (ver reglas-papel.js y
   pendientesPapel en server.js).

   Una ficha por ZFER (su estado actual) con su historial completo:
     pendiente  -> aprobada | rechazada
     aprobada   -> rechazada  (el aprobador le quita la aprobación)
     rechazada  -> pendiente  (se puede volver a pedir, con otra nota)
   Quien pidió no puede aprobar su propio pedido (salvo un administrador):
   la idea es que lo confirme otra persona.

   Almacenamiento: server/datos/<área>/aprobaciones.json. Todo el acceso
   pasa por acá (el día que viva en SQL, se reemplaza este módulo). */
const { leerListaJson, escribirListaJson } = require('./archivos');
const { errorHttp } = require('./comun');
const { normalizarZfer } = require('./reglas-papel');

const MAX_NOTA = 300;
const zferValido = z => /^[A-Z0-9._-]{1,40}$/.test(z);

function crear({ datos, notificar, areaId = 'papel' }){
  const ruta = () => datos.rutas.aprobaciones(areaId);
  const leer = () => leerListaJson(ruta());
  function guardar(lista){
    escribirListaJson(ruta(), lista);
    notificar({ tipo:'aprobaciones', area: areaId }); // la vista se actualiza sola en las demás PCs
  }
  const ahora = () => new Date().toISOString();
  const nota = v => String(v==null ? '' : v).trim().slice(0, MAX_NOTA) || null;

  /* ZFER aprobados, normalizados (lo que usa la regla de Lista de corte). */
  function aprobados(){
    return new Set(leer().filter(a=>a.estado==='aprobada').map(a=>a.zfer));
  }

  function solicitar({ zfer, nota: n, detalle }, usuario){
    const z = normalizarZfer(zfer);
    if(!zferValido(z)) throw errorHttp('Escribí un ZFER válido (letras y números, hasta 40).');
    const lista = leer();
    let ficha = lista.find(a=>a.zfer===z);
    if(ficha && ficha.estado==='pendiente') throw errorHttp(`El ZFER ${z} ya tiene una solicitud pendiente (la pidió ${ficha.solicitadoPor}).`, 409);
    if(ficha && ficha.estado==='aprobada') throw errorHttp(`El ZFER ${z} ya está aprobado: sus órdenes ya entran a Lista de corte.`, 409);
    const d = detalle && typeof detalle==='object' ? {
      ordenes: Array.isArray(detalle.ordenes) ? detalle.ordenes.slice(0, 20).map(x=>String(x).slice(0, 40)) : [],
      niveles: Array.isArray(detalle.niveles) ? detalle.niveles.slice(0, 5).map(x=>String(x).slice(0, 4)) : [],
      modelos: Array.isArray(detalle.modelos) ? detalle.modelos.slice(0, 5).map(x=>String(x).slice(0, 60)) : [],
      vehiculos: Array.isArray(detalle.vehiculos) ? detalle.vehiculos.slice(0, 3).map(x=>String(x).slice(0, 80)) : [],
    } : null;
    const f = ahora();
    if(!ficha){ ficha = { zfer: z, historial: [] }; lista.push(ficha); }
    Object.assign(ficha, { estado:'pendiente', solicitadoPor: usuario, solicitadoEn: f, nota: nota(n), detalle: d,
                           resueltoPor: null, resueltoEn: null, motivo: null });
    ficha.historial.push({ evento:'solicitada', usuario, fecha: f, nota: ficha.nota });
    guardar(lista);
    return ficha;
  }

  /* decision: 'aprobar' | 'rechazar' (una pendiente) | 'revocar' (una aprobada). */
  function resolver(zfer, { decision, motivo }, usuarioObj){
    const z = normalizarZfer(zfer);
    const lista = leer();
    const ficha = lista.find(a=>a.zfer===z);
    if(!ficha) throw errorHttp(`No hay ninguna solicitud para el ZFER ${z}.`, 404);
    const usuario = usuarioObj.usuario;
    if(decision==='aprobar' || decision==='rechazar'){
      if(ficha.estado!=='pendiente') throw errorHttp(`La solicitud del ZFER ${z} ya no está pendiente (está ${ficha.estado}).`, 409);
      if(decision==='aprobar' && ficha.solicitadoPor===usuario && !usuarioObj.admin){
        throw errorHttp('No podés aprobar tu propia solicitud: la tiene que confirmar otra persona.', 403);
      }
    } else if(decision==='revocar'){
      if(ficha.estado!=='aprobada') throw errorHttp(`El ZFER ${z} no está aprobado.`, 409);
    } else throw errorHttp('decisión inválida (aprobar, rechazar o revocar)');
    const f = ahora(), m = nota(motivo);
    if(decision!=='aprobar' && !m) throw errorHttp('Escribí el motivo: el operario lo va a ver.');
    Object.assign(ficha, { estado: decision==='aprobar' ? 'aprobada' : 'rechazada', resueltoPor: usuario, resueltoEn: f, motivo: m });
    ficha.historial.push({ evento: decision==='aprobar' ? 'aprobada' : decision==='rechazar' ? 'rechazada' : 'revocada', usuario, fecha: f, nota: m });
    guardar(lista);
    return ficha;
  }

  return { leer, aprobados, solicitar, resolver };
}

module.exports = { crear };
