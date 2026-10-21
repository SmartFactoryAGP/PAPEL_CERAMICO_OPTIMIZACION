/* =========================================================
   CAMBIOS EN VIVO (Server-Sent Events) — GET /api/eventos
   =========================================================
   Cada pestaña abierta de la app mantiene UNA conexión acá; cuando
   alguien registra un movimiento o mueve algo del rack, el puente se lo
   avisa al instante a todas. Reemplaza a las 30 PCs preguntando cada 6 s
   "¿cambió algo?".

   Seguridad:
   - Cada aviso le llega solo a quien tiene permiso para ver ESA área
     (antes, alguien con permiso solo en Mallas recibía igual todos los
     movimientos del inventario de Tecoflex).
   - Si la sesión se cierra, vence, o el administrador desactiva o borra al
     usuario, su conexión se corta (antes seguía recibiendo datos hasta
     cerrar la pestaña).
   - Tope de conexiones, para que una pestaña con un error que reconecta
     en bucle no pueda agotar la memoria del puente.
   EventSource no puede mandar cabeceras: el token viaja como ?auth=. */
const MAX_CONEXIONES = 1000;
const MAX_POR_SESION = 50;
// qué vistas alcanzan para recibir cada tipo de aviso (las mismas que
// piden los endpoints que esos avisos mandan a refrescar)
const VISTAS_DEL_AVISO = { inventario: ['rack'], rack: ['rack', 'ordenes'], tejidos: ['rack', 'ordenes'], aprobaciones: ['aprobaciones', 'aprobar'],
  lista: ['ordenes', 'aprobaciones', 'aprobar'] }; // lista: se renovó la Lista de corte (las pantallas la releen de la memoria del puente, no de SQL)

function crear(usuarios){
  const clientes = new Map(); // res -> { token, disp }  (disp: 'pc' | 'celular', lo dice cada pantalla)

  const puedeVer = (token, evento) => {
    const u = usuarios.deSesion(token, false);
    if(!u) return null;
    const vistas = VISTAS_DEL_AVISO[evento.tipo];
    return !vistas || !evento.area || vistas.some(v=>usuarios.puede(u, evento.area, v));
  };
  const soltar = res => { clientes.delete(res); try { res.end(); } catch(_){ /* ya cerrada */ } };

  function notificar(evento){
    const texto = `data: ${JSON.stringify(evento)}\n\n`; // se arma una sola vez para todas
    clientes.forEach(({ token }, res)=>{
      const ok = puedeVer(token, evento);
      if(ok === null) return soltar(res); // la sesión ya no vale
      if(!ok) return;
      try { res.write(texto); } catch(e){ clientes.delete(res); }
    });
  }

  /* Un aviso PARA UNA PERSONA: solo les llega a las pantallas con su sesión (y del tipo
     pedido, ej. 'pc'). Devuelve a cuántas pantallas se lo mandó. Lo usa el celular para
     pedirle a la PC del mismo usuario que imprima el sticker. */
  function notificarUsuario(usuario, evento, disp){
    const texto = `data: ${JSON.stringify(evento)}

`;
    let n = 0;
    clientes.forEach(({ token, disp: d }, res)=>{
      const u = usuarios.deSesion(token, false);
      if(!u) return soltar(res);
      if(u.usuario!==usuario || (disp && d!==disp)) return;
      try { res.write(texto); n++; } catch(e){ clientes.delete(res); }
    });
    return n;
  }

  /* Corta las conexiones cuya sesión ya no vale (después de un logout o de
     cambiar/borrar un usuario). */
  function revisarSesiones(){
    clientes.forEach(({ token }, res)=>{ if(!usuarios.deSesion(token, false)) soltar(res); });
  }

  // middleware: va después de exigirLogin (que ya validó el token)
  function manejar(req, res){
    const token = req.query.auth;
    if(clientes.size >= MAX_CONEXIONES) return res.status(503).json({ error: 'demasiadas conexiones en vivo abiertas' });
    // una misma sesión con demasiadas conexiones: se suelta la más vieja
    const deEsta = [...clientes].filter(([, c])=>c.token===token).map(([r])=>r);
    if(deEsta.length >= MAX_POR_SESION) soltar(deEsta[0]);

    res.set({ 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', 'Connection':'keep-alive', 'X-Accel-Buffering':'no' });
    res.flushHeaders();
    res.write('retry: 3000\n\n'); // si se corta, el navegador reintenta a los 3 s
    clientes.set(res, { token, disp: req.query.disp==='pc' ? 'pc' : 'celular' });
    req.on('close', ()=>clientes.delete(res));
  }

  // latido cada 20 s: mantiene viva la conexión (antivirus, proxies),
  // suelta las pestañas que se cerraron sin avisar y las sesiones vencidas
  setInterval(()=>{
    clientes.forEach(({ token }, res)=>{
      if(!usuarios.deSesion(token, false)) return soltar(res);
      try { res.write(': ping\n\n'); } catch(e){ clientes.delete(res); }
    });
  }, 20000).unref();

  return { notificar, notificarUsuario, revisarSesiones, manejar, cantidad: ()=>clientes.size };
}

module.exports = { crear };
