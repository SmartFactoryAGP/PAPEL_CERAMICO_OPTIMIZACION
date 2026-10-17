/* Pequeñas utilidades que comparten los módulos del puente. */

/* Error con código HTTP: los endpoints lo contestan tal cual (ver
   responderError en server.js). Los errores SIN código son imprevistos y
   no se le muestran en detalle a cualquiera. */
function errorHttp(mensaje, status = 400, extra){
  const e = new Error(mensaje);
  e.status = status;
  return Object.assign(e, extra);
}

function esHoy(fechaISO){
  const hoy = new Date();
  const d = new Date(fechaISO);
  return d.getFullYear()===hoy.getFullYear() && d.getMonth()===hoy.getMonth() && d.getDate()===hoy.getDate();
}

module.exports = { errorHttp, esHoy };
