/* =========================================================
   ÚLTIMA LISTA CONSULTADA — protege al SQL de los "Actualizar" repetidos
   =========================================================
   La Lista de corte se consulta a SQL como mucho UNA vez por período
   (por defecto 1 hora), sin importar cuántas PCs estén abiertas ni
   cuántas veces alguien toque un botón: todos reciben la misma "foto"
   guardada en memoria, con la hora en que se tomó.

   - Vencida la foto, el primer pedido dispara UNA consulta; los demás que
     lleguen mientras tanto esperan esa misma (no salen otras a SQL).
   - Si la consulta falla (SQL caído, red, VPN), se sigue mostrando la
     última foto buena, avisando desde cuándo; y NO se reintenta en cada
     pedido sino cada REINTENTO_MS: un SQL con problemas no recibe una
     lluvia de reintentos que lo termine de tumbar.
   - forzar: lo usa solo el administrador (lo decide server.js). Aun así,
     dos forzados seguidos dentro de MIN_ENTRE_FORZADOS_MS no salen a SQL.
   ========================================================= */
function crear({ cargar, periodoMs, reintentoMs = 2*60*1000, minEntreForzadosMs = 30*1000, alActualizar }){
  let foto = null;         // { datos, actualizado:ms }
  let enCurso = null;      // promesa de la consulta en vuelo
  let ultimoIntento = 0;   // ms del último intento (bien o mal)
  let ultimoError = null;  // { mensaje, cuando:ms }

  function refrescar(){
    if(enCurso) return enCurso;
    ultimoIntento = Date.now();
    enCurso = Promise.resolve().then(cargar).then(datos=>{
      foto = { datos, actualizado: Date.now() };
      ultimoError = null;
      if(alActualizar) try { alActualizar(foto); } catch(e){ console.error('[instantanea] alActualizar:', e.message); }
      return foto;
    }, err=>{
      ultimoError = { mensaje: err.message, cuando: Date.now(), err };
      throw err;
    }).finally(()=>{ enCurso = null; });
    return enCurso;
  }

  const vencida = () => !foto || Date.now() - foto.actualizado >= periodoMs;

  /* Devuelve { datos, actualizado, proxima, aviso? }. Solo tira error si
     nunca hubo una foto buena y la consulta falla. */
  async function obtener({ forzar = false } = {}){
    if(enCurso && (!foto || forzar)){ await enCurso.catch(()=>{}); }
    else if(!enCurso) {
      const puedeReintentar = Date.now() - ultimoIntento >= (ultimoError ? reintentoMs : 0);
      // contra el último INTENTO (bien o mal): forzar no puede martillar a un SQL que está fallando
      const forzarOk = forzar && Date.now() - ultimoIntento >= minEntreForzadosMs;
      if(forzarOk || !foto){
        try { await refrescar(); }
        catch(err){ if(!foto) throw err; } // sin foto previa no hay nada que mostrar
      } else if(foto && vencida() && puedeReintentar){
        // vencida pero con una lista buena: se entrega YA (nadie espera la consulta
        // de SQL, que puede tardar minutos) y se renueva por detrás; las pantallas
        // se enteran por el aviso en vivo de alActualizar
        refrescar().catch(err=>console.error('[instantanea] renovación en segundo plano:', err.message));
      }
    }
    if(!foto) throw (ultimoError && ultimoError.err) || new Error('todavía no hay ninguna lista consultada');
    const r = { datos: foto.datos, actualizado: foto.actualizado, proxima: foto.actualizado + periodoMs };
    if(ultimoError && ultimoError.cuando > foto.actualizado) r.aviso = 'No se pudo actualizar desde SQL: se muestra la última lista buena.';
    return r;
  }

  /* Para el reloj del puente: si la lista venció, la renueva por detrás (respetando la
     espera entre reintentos si SQL viene fallando). No hace nada si no venció. */
  function renovarSiVence(){
    if(enCurso || !foto || !vencida()) return;
    if(Date.now() - ultimoIntento < (ultimoError ? reintentoMs : 0)) return;
    refrescar().catch(err=>console.error('[instantanea] renovación en segundo plano:', err.message));
  }

  /* Cambia la foto en memoria sin ir a SQL (ej. sumar las órdenes de un ZFER recién aprobado). */
  function modificar(fn){ if(foto){ fn(foto.datos); if(alActualizar) alActualizar(foto); } }

  return { obtener, modificar, refrescar, renovarSiVence, hayFoto: ()=>!!foto, estado: ()=>({ actualizado: foto && foto.actualizado, enCurso: !!enCurso, ultimoError }) };
}

module.exports = { crear };
