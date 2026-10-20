/* =========================================================
   CAMBIOS EN VIVO — una conexión por pestaña al puente (/api/eventos)
   =========================================================
   Cuando cualquier PC registra un movimiento de inventario o mueve algo
   del rack, el puente lo avisa al instante y esta pestaña se actualiza
   sola. Si la conexión se cae, el navegador reintenta solo (cada 3 s) y,
   mientras tanto, el Rack sigue con su refresco periódico de respaldo.

   Detalle importante: con la página abierta por http:// cada navegador
   admite como mucho 6 conexiones a la vez con el mismo puente. Una
   conexión en vivo por pestaña, con 5 o 6 pestañas abiertas en la misma
   PC, dejaría sin lugar a los pedidos normales y la app parecería
   colgada. Por eso las pestañas que no están a la vista cierran su
   conexión y la reabren (poniéndose al día) cuando vuelven a verse. */
let trFuente = null;
let trConectado = false;
let trHuboCorte = false;

function trUrl(){
  // EventSource no puede mandar cabeceras: la sesión (y la clave del
  // puente, si hay) van en la dirección
  const q = ['auth='+encodeURIComponent(authToken())];
  const token = document.getElementById('ordApiToken').value.trim();
  if(token) q.push('api_token='+encodeURIComponent(token));
  return ordBridgeUrl() + '/api/eventos?' + q.join('&');
}
function trEstado(conectado){
  trConectado = conectado;
  const tag = document.getElementById('liveTag');
  if(!tag) return;
  tag.classList.toggle('on', conectado);
  tag.querySelector('span').textContent = conectado ? 'En vivo' : 'Reconectando…';
  tag.title = conectado
    ? 'Los cambios de las demás PCs se ven al instante'
    : 'Sin conexión en vivo con el puente — se reintenta solo; mientras tanto se actualiza cada pocos segundos';
}
function trConectar(){
  trDesconectar();
  if(typeof EventSource==='undefined' || document.hidden || !authEstaLogueado()) return;
  try { trFuente = new EventSource(trUrl()); }
  catch(e){ trEstado(false); return; }
  trFuente.onopen = ()=>{
    trEstado(true);
    // volvió después de un corte: lo que pasó mientras tanto no llegó por
    // acá, así que se pide de nuevo lo que se esté mirando
    if(trHuboCorte){ trHuboCorte = false; trRefrescarVistaActual(); }
  };
  trFuente.onerror = ()=>{ trHuboCorte = true; trEstado(false); };
  trFuente.onmessage = ev=>{
    let evento; try { evento = JSON.parse(ev.data); } catch(e){ return; }
    trDespachar(evento);
  };
}
function trDesconectar(){
  if(trFuente){ trFuente.close(); trFuente = null; }
  trEstado(false);
}
function trRefrescarVistaActual(){
  if(typeof appVistaActual!=='undefined' && appVistaActual==='rack' && typeof rackRender==='function') rackRender(true);
}
function trDespachar(evento){
  if(evento.tipo==='inventario'){
    if(typeof invAplicarResultado==='function') invAplicarResultado(evento);
    if(typeof msAplicarResultado==='function') msAplicarResultado(evento);
  } else if(evento.tipo==='tejidos'){
    // entrada, salida o tamaño en el rack de Tejidos (otra PC o un celular)
    if(typeof tjAlCambiar==='function') tjAlCambiar(evento);
  } else if(evento.tipo==='aprobaciones'){
    if(typeof apAlCambiar==='function') apAlCambiar();
  } else if(evento.tipo==='lista'){
    // el puente renovó la Lista de corte (hora cumplida, forzada por el
    // administrador, o un ZFER aprobado): se relee de su memoria, no de SQL
    if(evento.area!==areaActualId) return;
    if(typeof ordUltimaLista!=='undefined' && ordUltimaLista.area===areaActualId) ordRefrescar({auto:true});
    if(typeof appVistaActual!=='undefined' && appVistaActual==='aprobaciones' && typeof apCargar==='function') apCargar();
  } else if(evento.tipo==='rack'){
    // solo si se está mirando el Rack de ESA área (si no, se trae al entrar)
    if(evento.area===areaActualId) trRefrescarVistaActual();
  }
}

document.addEventListener('visibilitychange', ()=>{
  if(document.hidden){ trDesconectar(); return; }
  trConectar();
  trRefrescarVistaActual();
});
// si cambian la dirección o la clave del puente, se reconecta con la nueva
['ordBridgeUrl','ordApiToken'].forEach(id=>document.getElementById(id).addEventListener('change', trConectar));
// la primera conexión la abre auth.js al entrar (sin sesión no hay a qué conectarse)
