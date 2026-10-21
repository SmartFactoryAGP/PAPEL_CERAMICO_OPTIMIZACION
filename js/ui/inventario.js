/* =========================================================
   RACK DE TECOFLEX — inventario por material y medida
   =========================================================
   Tecoflex no va por órdenes: el rack es un stock en cantidades por
   (material, medida). Los materiales y qué medidas tiene cada uno salen
   de js/core/areas-config.js (por ej. el 1,27 para X5 solo tiene 6,5 /
   12 / 16 / 20 / 21 / 28; los demás, 9 a 70).

   Flujo pensado para salidas masivas: se elige material, medida y
   cantidad y se suma al CARRITO; se repite las veces que haga falta y al
   final "Registrar" manda todo junto al puente, que lo aplica entero o no
   aplica nada (ver /api/inventario/movimientos en server.js).

   Muchas PCs a la vez: el stock se mantiene al día con los avisos en vivo
   del puente (tiempo-real.js -> invAplicarResultado). Cada estado tiene
   un número de versión (= cantidad de movimientos registrados): si llega
   el que sigue se aplica tal cual; si se saltó alguno, se pide todo de
   nuevo. Así nunca se muestra un stock viejo ni se aplica dos veces lo mismo.
   ========================================================= */
let invStock = new Map();        // 'material|medida' -> cantidad
let invMovimientos = [];
let invVersion = -1;             // versión del stock que se está mostrando (-1 = todavía nada)
let invHoy = {sale:0, entra:0};  // totales de hoy, calculados por el puente sobre TODO el día
let invTipo = 'salida';          // tipo de la próxima línea del carrito

/* El carrito se guarda en este navegador (un F5 a mitad de armado no lo
   pierde) y es de CADA PERSONA: antes era uno por navegador, y en una PC
   compartida entre turnos el siguiente operario encontraba — y podía
   registrar sin darse cuenta — el carrito del anterior.
   loteId identifica ESTE carrito ante el puente: si "Registrar" se manda
   dos veces (doble clic, o se cortó la red y se reintenta), el puente lo
   reconoce y no descuenta dos veces. Cambia cada vez que el carrito cambia. */
let invCarrito = [], invLoteId = null, invCarritoDe = null;
let invRegistrando = false; // hay un "Registrar" en curso: el carrito queda bloqueado
function invClaveCarrito(){
  const usuario = (typeof authUsuarioActual==='function' && authUsuarioActual()) || 'sin-sesion';
  return 'tecoflex_carrito_v2:' + usuario;
}
function invNuevoLoteId(){
  // crypto.randomUUID solo existe en https/localhost; las otras PCs entran por http://IP
  const b = new Uint8Array(12); crypto.getRandomValues(b);
  return Array.from(b, x=>x.toString(16).padStart(2,'0')).join('');
}
function invCargarCarrito(){
  const clave = invClaveCarrito();
  if(clave===invCarritoDe) return;
  invCarritoDe = clave;
  invCarrito = []; invLoteId = null; document.getElementById('invNota').value = '';
  try {
    const v = JSON.parse(localStorage.getItem(clave)||'null');
    if(v && Array.isArray(v.items)){ invCarrito = v.items; invLoteId = v.loteId || null; if(v.nota) document.getElementById('invNota').value = v.nota; }
  } catch(e){}
}
function invGuardarCarrito(){
  invLoteId = invCarrito.length ? invNuevoLoteId() : null; // carrito distinto = lote distinto
  invEscribirCarrito();
}
/* la nota también se guarda (sin tocar el lote: escribir una nota no cambia lo que se registra) */
function invEscribirCarrito(){
  const nota = document.getElementById('invNota').value;
  try { localStorage.setItem(invCarritoDe, JSON.stringify({items: invCarrito, loteId: invLoteId, nota: invCarrito.length ? nota : ''})); } catch(e){}
}
document.getElementById('invNota').addEventListener('input', ()=>{ if(invCarritoDe) invEscribirCarrito(); });

const invClave = (m, d) => m+'|'+d;
const invNum = d => parseFloat(String(d).replace(',', '.'));
function invArea(){ return areaActual(); }
function invMaterial(id){ return (invArea().materiales||[]).find(m=>m.id===id) || null; }
/* nombre corto para tablas y carrito (campo "corto" de areas-config.js) */
function invNombreCorto(m){ return m.corto || m.nombre; }

/* Lo que quedaría en stock de (material, medida) si se registrara el
   carrito tal como está — es lo que limita cuánto más se puede sacar. */
function invDisponible(material, medida){
  let n = invStock.get(invClave(material, medida)) || 0;
  invCarrito.forEach(l=>{ if(l.material===material && l.medida===medida) n += (l.tipo==='entrada' ? l.cantidad : -l.cantidad); });
  return n;
}

/* ---------- datos ---------- */
/* Trae el estado completo. Con ?version= el puente contesta "sin cambios"
   (un JSON mínimo) si ya está al día — lo normal en el refresco de respaldo. */
async function invRender(silencioso){
  const areaPedida = areaActualId;
  invPrepararForm();
  invCargarCarrito();
  try {
    const qs = silencioso && invVersion>=0 ? '?version='+invVersion : '';
    const res = await fetch(ordBridgeUrl()+'/api/inventario'+qs, {headers: ordApiHeaders()});
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || ('HTTP '+res.status));
    if(areaPedida!==areaActualId) return;
    if(data.sinCambios){ invDibujarCarrito(); return; }
    invStock = new Map((data.stock||[]).map(s=>[invClave(s.material, s.medida), s.cantidad]));
    invMovimientos = data.movimientos || [];
    invHoy = data.hoy || {sale:0, entra:0};
    invVersion = data.version;
  } catch(e){
    if(silencioso || areaPedida!==areaActualId) return;
    document.getElementById('invMatriz').innerHTML = `<div class="empty">No se pudo traer el inventario del puente: ${escapeHtml(e.message)}</div>`;
    return;
  }
  invDibujarTodo();
}
/* Aplica un cambio que llega del puente — por el aviso en vivo de otra PC,
   o por la respuesta a un "Registrar" de esta misma. Puede llegar el mismo
   cambio por los dos lados y en cualquier orden: la versión lo ordena. */
function invAplicarResultado(r){
  if(areaActual().rack.tipo!=='inventario' || areaActual().rack.porCodmat || r.area && r.area!==areaActualId) return; // Mallas: mallas.js
  if(r.recargar){ invRender(true).then(()=>{ if(typeof invConsAlCambiar==='function') invConsAlCambiar(); }); return; } // el administrador borró movimientos: se vuelve a pedir todo
  if(invVersion<0 || r.version<=invVersion) return;       // todavía nada cargado, o ya aplicado
  if(r.version!==invVersion+1){ invRender(true); return; } // se perdió algún cambio en el medio
  invStock = new Map((r.stock||[]).map(s=>[invClave(s.material, s.medida), s.cantidad]));
  if(r.movimiento){ invMovimientos.unshift(r.movimiento); if(invMovimientos.length>300) invMovimientos.length = 300; }
  if(r.hoy) invHoy = r.hoy;
  invVersion = r.version;
  invDibujarTodo();
  if(typeof invConsAlCambiar==='function') invConsAlCambiar(); // la vista de consumo (js/ui/inventario-vistas.js) se rehace sola
}
function invDibujarTodo(){
  invDibujarMateriales();
  invDibujarMedidas();
  invDibujarCarrito();
  invDibujarMatriz();
  invDibujarMovimientos();
  invDibujarKpis();
  if(typeof invVistasAlDibujar==='function') invVistasAlDibujar(); // pestañas del rack (inventario-vistas.js)
}

/* ---------- formulario: selección MASIVA ----------
   Se eligen VARIOS materiales y VARIAS medidas; las posiciones elegidas son
   todas las combinaciones válidas (cada material solo con las medidas que
   tiene — el X5 nunca suma un 9 mm, por ejemplo). "Agregar" pone en el
   carrito una línea por posición, con la misma cantidad cada una o con
   "todo lo que haya" (vaciar). La tabla de existencias elige lo mismo
   arrastrando un bloque de celdas. */
let invSelMats = new Set();   // ids de material elegidos
let invSelMeds = new Set();   // medidas elegidas ('6,5', '9', ...)
let invModoCant = 'igual';    // 'igual' | 'todo' (solo salidas)

function invOrdenMedidas(lista){ return [...lista].sort((a,b)=>invNum(a)-invNum(b)); }
/* medidas que tienen los materiales elegidos (unión, ordenada) */
function invMedidasPosibles(){
  const mats = (invArea().materiales||[]).filter(m=>invSelMats.has(m.id));
  return invOrdenMedidas(new Set(mats.flatMap(m=>m.medidas)));
}
/* todas las posiciones elegidas: [{mat, medida}] */
function invPosicionesElegidas(){
  const out = [];
  (invArea().materiales||[]).forEach(m=>{
    if(!invSelMats.has(m.id)) return;
    m.medidas.forEach(d=>{ if(invSelMeds.has(d)) out.push({mat:m, medida:d}); });
  });
  return out;
}
function invElegido(material, medida){
  const m = invMaterial(material);
  return !!m && invSelMats.has(material) && invSelMeds.has(medida) && m.medidas.includes(medida);
}

function invPrepararForm(){
  const cont = document.getElementById('invMateriales');
  const mats = invArea().materiales || [];
  if(cont.childElementCount === mats.length) return;
  cont.innerHTML = mats.map(m=>`<button type="button" class="matChip" data-mat="${escapeHtml(m.id)}" aria-pressed="false" title="${escapeHtml(m.nombre)}">
    <b>${escapeHtml(invNombreCorto(m))}</b><small>${escapeHtml(m.codigo||'')}</small><i></i></button>`).join('');
}
/* redibuja todo lo que depende de la selección */
function invActualizarSeleccion(){
  invDibujarMateriales();
  invDibujarMedidas();
  invDibujarResumenSeleccion();
  invDibujarMatriz();
}
function invDibujarMateriales(){
  document.querySelectorAll('#invMateriales .matChip').forEach(b=>{
    const id = b.getAttribute('data-mat'), activo = invSelMats.has(id);
    b.classList.toggle('activa', activo); b.setAttribute('aria-pressed', activo ? 'true' : 'false');
    let n = 0; invStock.forEach((c, k)=>{ if(k.split('|')[0]===id) n += c; });
    b.querySelector('i').textContent = n ? n+' en stock' : 'sin stock';
  });
}
function invDibujarMedidas(){
  const cont = document.getElementById('invMedidas');
  const posibles = invMedidasPosibles();
  // una medida elegida que ningún material elegido tiene, se suelta
  [...invSelMeds].forEach(d=>{ if(!posibles.includes(d)) invSelMeds.delete(d); });
  if(!posibles.length){ cont.innerHTML = '<div class="hint" style="margin:0; grid-column:1/-1">Elegí al menos un material.</div>'; return; }
  cont.innerHTML = posibles.map(d=>{
    let n = 0; invSelMats.forEach(id=>{ n += invStock.get(invClave(id, d)) || 0; });
    return `<button type="button" class="medChip${n?' conStock':''}${invSelMeds.has(d)?' activa':''}" data-medida="${d}" title="${d} mm — ${n} en stock (materiales elegidos)">
      <span>${d}</span><small>${n||'·'}</small></button>`;
  }).join('');
}
/* "9-20, 25, 30-35" -> medidas posibles dentro de esos rangos */
function invParsearRango(texto){
  const posibles = invMedidasPosibles(), elegidas = new Set();
  String(texto).split(/[,;\s]+/).filter(Boolean).forEach(parte=>{
    const m = parte.replace(/\./g, ',').match(/^(\d+(?:,\d+)?)(?:-(\d+(?:,\d+)?))?$/);
    if(!m) return;
    const a = invNum(m[1]), b = m[2]!=null ? invNum(m[2]) : a;
    posibles.forEach(d=>{ const v = invNum(d); if(v>=Math.min(a,b) && v<=Math.max(a,b)) elegidas.add(d); });
  });
  return elegidas;
}
/* Qué se agregaría con la selección y la cantidad actuales — se muestra en
   vivo antes de tocar "Agregar", para que no haya sorpresas en una carga masiva. */
function invPlanAgregar(){
  const pos = invPosicionesElegidas();
  const cantidad = Number(document.getElementById('invCantidad').value);
  const lineas = [], omitidas = [];
  pos.forEach(({mat, medida})=>{
    const disp = invDisponible(mat.id, medida);
    let c;
    if(invTipo==='salida' && invModoCant==='todo') c = disp;
    else c = cantidad;
    if(invTipo==='salida' && (c<=0 || c>disp)){ omitidas.push({mat, medida, disp: Math.max(0,disp)}); return; }
    lineas.push({mat, medida, cantidad:c});
  });
  const cantidadValida = (invTipo==='salida' && invModoCant==='todo') || (Number.isInteger(cantidad) && cantidad>0);
  return {pos, lineas, omitidas, cantidadValida, unidades: lineas.reduce((s,l)=>s+l.cantidad, 0)};
}
function invDibujarResumenSeleccion(){
  const el = document.getElementById('invSelResumen'), btn = document.getElementById('invAgregarBtn');
  const todo = invTipo==='salida' && invModoCant==='todo';
  document.getElementById('invCantidadField').classList.toggle('apagado', todo);
  const p = invPlanAgregar();
  const verbo = invTipo==='salida' ? 'salida' : 'entrada';
  if(!p.pos.length){
    el.textContent = 'Elegí materiales y medidas (una o varias).';
    btn.textContent = invTipo==='salida' ? 'Agregar salida' : 'Agregar entrada'; btn.disabled = true;
    return;
  }
  btn.disabled = !p.cantidadValida || !p.lineas.length;
  btn.textContent = p.lineas.length===1 ? `Agregar ${verbo}` : `Agregar ${p.lineas.length} ${verbo}s`;
  el.innerHTML = `<b>${p.pos.length}</b> posicion${p.pos.length===1?'':'es'} elegida${p.pos.length===1?'':'s'}` +
    (p.cantidadValida ? ` · ${invTipo==='salida'?'salen':'entran'} <b>${p.unidades}</b> unidades` : '') +
    (p.omitidas.length ? ` · <span class="msgWarn">${p.omitidas.length} sin stock suficiente (se saltean)</span>` : '');
}
function invMensaje(texto, tipo){
  const el = document.getElementById('invFormMsg');
  el.textContent = texto || ' ';
  el.className = 'hint' + (tipo ? ' msg-'+tipo : '');
}
function invAgregar(){
  if(invRegistrando) return invMensaje('Esperá un instante: se está registrando el carrito anterior.', 'error');
  const p = invPlanAgregar();
  if(!p.pos.length) return invMensaje('Elegí al menos un material y una medida.', 'error');
  if(!p.cantidadValida) return invMensaje('La cantidad tiene que ser un número entero mayor que 0.', 'error');
  if(!p.lineas.length) return invMensaje('Ninguna de las posiciones elegidas tiene stock suficiente para esa salida.', 'error');
  if(invCarrito.length + p.lineas.length > 500) return invMensaje('El carrito no puede pasar de 500 líneas: registrá lo que tenés y seguí con otro.', 'error');
  // la misma línea (tipo + material + medida) se suma en vez de repetirse
  p.lineas.forEach(({mat, medida, cantidad})=>{
    const igual = invCarrito.find(l=>l.tipo===invTipo && l.material===mat.id && l.medida===medida);
    if(igual) igual.cantidad += cantidad;
    else invCarrito.push({tipo:invTipo, material:mat.id, medida, cantidad});
  });
  invGuardarCarrito();
  document.getElementById('invStatus').innerHTML = '&nbsp;'; // el "Listo" del registro anterior ya no aplica
  let msg = `${p.lineas.length} ${invTipo==='salida'?'salida':'entrada'}${p.lineas.length===1?'':'s'} agregada${p.lineas.length===1?'':'s'} al carrito (${p.unidades} unidades).`;
  if(p.omitidas.length){
    const lista = p.omitidas.slice(0, 6).map(o=>`${invNombreCorto(o.mat)} ${o.medida} (${o.disp})`).join(', ');
    msg += ` Se saltearon ${p.omitidas.length} sin stock suficiente: ${lista}${p.omitidas.length>6?` y ${p.omitidas.length-6} más`:''}.`;
  }
  invMensaje(msg, p.omitidas.length ? 'warn' : 'ok');
  const c = document.getElementById('invCantidad'); c.focus(); c.select();
  invDibujarCarrito();
  invActualizarSeleccion();
}

/* ---------- carrito ---------- */
function invDibujarCarrito(){
  invDibujarResumenSeleccion(); // lo disponible para agregar depende de lo que ya hay en el carrito
  const lista = document.getElementById('invCartList');
  const btn = document.getElementById('invConfirmarBtn');
  document.getElementById('invCartCount').textContent = invCarrito.length;
  if(typeof invVistasActualizarBadge==='function') invVistasActualizarBadge(); // número en la pestaña "Registrar" (pantallas chicas)
  document.getElementById('invVaciarBtn').hidden = !invCarrito.length;
  if(!invCarrito.length){
    lista.innerHTML = '<div class="cartEmpty">El carrito está vacío. Elegí material, medida y cantidad, y tocá "Agregar".</div>';
    btn.disabled = true; btn.textContent = 'Registrar movimientos';
    return;
  }
  // un aviso en vivo de otra PC no puede borrarle a nadie la cantidad que
  // está escribiendo en una línea del carrito: si hay foco adentro, la
  // lista se redibuja recién al soltarlo (ver el "change" de .cartQty)
  const escribiendo = lista.contains(document.activeElement);
  if(!escribiendo) lista.innerHTML = invCarrito.map((l, i)=>{
    const mat = invMaterial(l.material);
    const queda = invDisponible(l.material, l.medida);
    return `<div class="cartRow ${l.tipo}${queda<0?' sinStock':''}">
      <span class="movTag ${l.tipo}">${l.tipo==='salida'?'Sale':'Entra'}</span>
      <div class="cartInfo"><b title="${escapeHtml(mat ? mat.nombre : l.material)}">${escapeHtml(mat ? invNombreCorto(mat) : l.material)}</b><small>${escapeHtml(l.medida)} mm · ${queda<0 ? 'falta stock' : 'quedan '+queda}</small></div>
      <input type="number" class="cartQty" min="1" step="1" value="${l.cantidad}" data-i="${i}" aria-label="Cantidad">
      <button type="button" class="cartRm" data-i="${i}" aria-label="Quitar del carrito">✕</button>
    </div>`;
  }).join('');
  const sale = invCarrito.filter(l=>l.tipo==='salida').reduce((s,l)=>s+l.cantidad, 0);
  const entra = invCarrito.filter(l=>l.tipo==='entrada').reduce((s,l)=>s+l.cantidad, 0);
  const partes = [];
  if(sale) partes.push(`salen ${sale}`);
  if(entra) partes.push(`entran ${entra}`);
  btn.textContent = `Registrar ${invCarrito.length} línea${invCarrito.length===1?'':'s'} (${partes.join(' · ')})`;
  btn.disabled = invRegistrando || invCarrito.some(l=>invDisponible(l.material, l.medida)<0);
}
async function invConfirmar(){
  if(!invCarrito.length || invRegistrando) return;
  const sale = invCarrito.filter(l=>l.tipo==='salida').reduce((s,l)=>s+l.cantidad, 0);
  const entra = invCarrito.filter(l=>l.tipo==='entrada').reduce((s,l)=>s+l.cantidad, 0);
  if(!confirm(`¿Registrar ${invCarrito.length} línea(s)?\n\nSalen: ${sale} unidad(es)\nEntran: ${entra} unidad(es)`)) return;
  const btn = document.getElementById('invConfirmarBtn');
  const status = document.getElementById('invStatus');
  // mientras se registra, el carrito no se puede tocar: si no, una línea
  // agregada en ese medio segundo se borraría junto con las registradas
  invRegistrando = true;
  btn.disabled = true;
  document.getElementById('invCartList').classList.add('bloqueado');
  status.className = 'hint'; status.textContent = 'Registrando...';
  try {
    const res = await fetch(ordBridgeUrl()+'/api/inventario/movimientos', {
      method:'POST', headers: ordApiHeaders({'Content-Type':'application/json'}),
      body: JSON.stringify({ items: invCarrito, nota: document.getElementById('invNota').value, idCliente: invLoteId })
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok){
      status.className = 'hint msg-error';
      status.innerHTML = escapeHtml(data.error || ('HTTP '+res.status)) +
        (data.detalles ? '<ul>'+data.detalles.map(d=>`<li>${escapeHtml(d)}</li>`).join('')+'</ul>' : '');
      await invRender(true); // stock fresco: puede que otra PC haya sacado antes
      return;
    }
    invCarrito = []; invGuardarCarrito();
    document.getElementById('invNota').value = '';
    invMensaje('');
    status.className = 'hint msg-ok';
    status.textContent = `Listo: ${data.movimiento.items.length} línea(s) registradas (salen ${sale}, entran ${entra}).`;
    invAplicarResultado(data);
  } catch(e){
    // la respuesta no llegó, pero el puente pudo haberlo registrado igual:
    // el carrito queda tal cual (mismo lote), así que reintentar es seguro
    status.className = 'hint msg-error';
    status.textContent = 'No llegó la respuesta del puente ('+e.message+'). El carrito sigue intacto: podés volver a tocar "Registrar" sin miedo a duplicar — si ya se había registrado, no se descuenta dos veces.';
  } finally {
    invRegistrando = false;
    document.getElementById('invCartList').classList.remove('bloqueado');
    invDibujarCarrito();
  }
}

/* ---------- existencias (medidas × materiales) ---------- */
/* Materiales a mostrar: los de la configuración y, si hay stock de algún
   material que no está en ella (una clave vieja, un material borrado de
   areas-config.js), también ese, marcado — antes ese stock contaba en
   "Unidades en stock" pero no aparecía en la tabla, y parecía que no había nada. */
function invMaterialesVisibles(){
  const mats = (invArea().materiales || []).slice();
  const conocidos = new Set(mats.map(m=>m.id));
  const huerfanos = new Map();
  invStock.forEach((n, k)=>{
    const [id, medida] = k.split('|');
    if(conocidos.has(id)) return;
    if(!huerfanos.has(id)) huerfanos.set(id, {id, nombre:`Material "${id}" (sin configurar)`, corto:id, medidas:[], desconocido:true});
    huerfanos.get(id).medidas.push(medida);
  });
  return mats.concat([...huerfanos.values()]);
}
function invDibujarMatriz(){
  const wrap = document.getElementById('invMatriz');
  const mats = invMaterialesVisibles();
  const soloConStock = document.getElementById('invSoloConStock').checked;
  const todas = [...new Set(mats.flatMap(m=>m.medidas))].sort((a,b)=>invNum(a)-invNum(b));
  const medidas = soloConStock ? todas.filter(d=>mats.some(m=>invStock.get(invClave(m.id, d)))) : todas;
  if(!medidas.length){
    wrap.innerHTML = '<div class="empty">No hay nada en stock todavía. Registrá una entrada para empezar (o destildá "Solo medidas con stock").</div>';
    return;
  }
  const totMat = new Map();
  const filas = medidas.map(d=>{
    let totFila = 0;
    const celdas = mats.map(m=>{
      if(!m.medidas.includes(d)) return '<td class="invNa" title="Este material no tiene esta medida">—</td>';
      const n = invStock.get(invClave(m.id, d)) || 0;
      totFila += n; totMat.set(m.id, (totMat.get(m.id)||0) + n);
      if(m.desconocido) return `<td class="invHuerfano" title="Stock de un material que no está en la lista de materiales — no se puede mover hasta configurarlo">${n}</td>`;
      // lo que ya está en el carrito para esta posición, a la vista (−4 / +10)
      // número grande = stock real AHORA. Si hay algo en el carrito para esta
      // posición, abajo dice qué y cómo queda: "entra 11 → 22" / "sale 4 → 7"
      // (antes decía solo "+11", y se leía como si ya hubiera 11 más)
      const queda = invDisponible(m.id, d), pend = queda - n;
      const marca = pend
        ? `<small class="cartDelta ${pend<0?'sale':'entra'}">${pend<0?'sale':'entra'} ${Math.abs(pend)} → ${queda}</small>`
        : '';
      const titulo = `${m.nombre} · ${d} mm — hay ${n}` + (pend ? `; en tu carrito ${pend<0?'salen':'entran'} ${Math.abs(pend)}, quedaría ${queda} al registrar` : '');
      return `<td class="invCell${n?' conStock':''}${pend?' pendiente':''}${invElegido(m.id, d)?' sel':''}" data-material="${m.id}" data-medida="${d}" title="${escapeHtml(titulo)}"><b>${n}</b>${marca}</td>`;
    }).join('');
    return `<tr><th scope="row" class="invEncFila" data-med="${d}" title="Elegir la medida ${d} mm">${d}<small>mm</small></th>${celdas}<td class="invTot">${totFila||''}</td></tr>`;
  }).join('');
  const encabezado = mats.map(m=>`<th class="${m.desconocido?'invHuerfano':'invEncCol'}" ${m.desconocido?'':`data-mat="${escapeHtml(m.id)}"`} title="${escapeHtml(m.nombre)}${m.codigo?' · '+escapeHtml(m.codigo):''}">${escapeHtml(invNombreCorto(m))}${m.codigo?`<small>${escapeHtml(m.codigo)}</small>`:''}${m.desconocido?'<small>sin configurar</small>':''}</th>`).join('');
  const pie = mats.map(m=>`<td>${totMat.get(m.id)||0}</td>`).join('');
  const total = [...totMat.values()].reduce((s,n)=>s+n, 0);
  invOrdenTabla = {cols: mats.filter(m=>!m.desconocido).map(m=>m.id), filas: medidas};
  wrap.innerHTML = `<table class="ordTable invTable">
    <thead><tr><th>Medida</th>${encabezado}<th>Total</th></tr></thead>
    <tbody>${filas}</tbody>
    <tfoot><tr><th scope="row">Total</th>${pie}<td class="invTot">${total}</td></tr></tfoot>
  </table>`;
}

/* ---------- movimientos ---------- */
function invDibujarMovimientos(){
  const wrap = document.getElementById('invMovs');
  if(!invMovimientos.length){ wrap.innerHTML = '<div class="empty">Todavía no hay movimientos registrados.</div>'; return; }
  const filas = invMovimientos.slice(0, 120).map(mv=>{
    const sale = mv.items.filter(l=>l.tipo==='salida').reduce((s,l)=>s+l.cantidad, 0);
    const entra = mv.items.filter(l=>l.tipo==='entrada').reduce((s,l)=>s+l.cantidad, 0);
    const tipo = sale && entra ? 'mixto' : sale ? 'salida' : 'entrada';
    const etiqueta = tipo==='mixto' ? 'Mixto' : tipo==='salida' ? 'Salida' : 'Entrada';
    const detalle = mv.items.map(l=>`<span class="movItem ${l.tipo}">${l.tipo==='salida'?'−':'+'}${l.cantidad} <b>${escapeHtml(invNombreCorto(invMaterial(l.material) || {nombre:l.materialNombre}))}</b> ${escapeHtml(l.medida)} mm</span>`).join('');
    return `<tr>
      ${haTd(mv.id)}<td class="mono">${escapeHtml(new Date(mv.fecha).toLocaleString('es-CO', {dateStyle:'short', timeStyle:'short'}))}</td>
      <td><span class="movTag ${tipo}">${etiqueta}</span></td>
      <td class="movDetalle"><div class="movItems">${detalle}</div>${mv.nota?`<small>${escapeHtml(mv.nota)}</small>`:''}</td>
      <td class="mono">${sale?'−'+sale:''}${sale&&entra?' / ':''}${entra?'+'+entra:''}</td>
      <td>${escapeHtml(mv.usuario || 'sin sesión')}</td>
    </tr>`;
  }).join('');
  wrap.innerHTML = haBarra() + `<table class="ordTable"><thead><tr>${haTh()}<th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Unidades</th><th>Usuario</th></tr></thead><tbody>${filas}</tbody></table>`;
  haAplicar('invMovs', async ids=>{ await haEliminarMovimientos(ids); await invRender(true); if(typeof invConsAlCambiar==='function') invConsAlCambiar(); });
}
function invDibujarKpis(){
  let total = 0, combinaciones = 0;
  invStock.forEach(n=>{ total += n; if(n) combinaciones++; });
  document.getElementById('invKpiTotal').textContent = total;
  document.getElementById('invKpiComb').textContent = combinaciones;
  document.getElementById('invKpiHoy').textContent = `−${invHoy.sale} / +${invHoy.entra}`;
}

/* ---------- eventos ---------- */
document.getElementById('invTipo').addEventListener('click', ev=>{
  const b = ev.target.closest('[data-tipo]');
  if(!b) return;
  invTipo = b.getAttribute('data-tipo');
  document.querySelectorAll('#invTipo [data-tipo]').forEach(x=>{
    const activo = x===b; x.classList.toggle('active', activo); x.setAttribute('aria-checked', activo ? 'true' : 'false');
  });
  // "Todo lo que haya" solo tiene sentido para salidas
  document.querySelector('#invModoCant [data-modo="todo"]').disabled = invTipo!=='salida';
  if(invTipo!=='salida' && invModoCant==='todo') invElegirModo('igual');
  invMensaje('');
  invDibujarResumenSeleccion();
});
function invElegirModo(modo){
  invModoCant = modo;
  document.querySelectorAll('#invModoCant [data-modo]').forEach(x=>{
    const activo = x.getAttribute('data-modo')===modo; x.classList.toggle('active', activo); x.setAttribute('aria-checked', activo ? 'true' : 'false');
  });
  invDibujarResumenSeleccion();
}
document.getElementById('invModoCant').addEventListener('click', ev=>{
  const b = ev.target.closest('[data-modo]');
  if(b && !b.disabled) invElegirModo(b.getAttribute('data-modo'));
});

/* materiales: tocar suma o quita; atajos Todos / Ninguno */
document.getElementById('invMateriales').addEventListener('click', ev=>{
  const b = ev.target.closest('[data-mat]');
  if(!b) return;
  const id = b.getAttribute('data-mat');
  if(invSelMats.has(id)) invSelMats.delete(id); else invSelMats.add(id);
  invMensaje(''); invActualizarSeleccion();
});
document.querySelectorAll('[data-mats]').forEach(b=>b.addEventListener('click', ()=>{
  invSelMats = b.getAttribute('data-mats')==='todos' ? new Set((invArea().materiales||[]).map(m=>m.id)) : new Set();
  invMensaje(''); invActualizarSeleccion();
}));
/* medidas: tocar suma o quita; atajos Todas / Con stock / Ninguna; rango escrito */
document.getElementById('invMedidas').addEventListener('click', ev=>{
  const b = ev.target.closest('[data-medida]');
  if(!b) return;
  const d = b.getAttribute('data-medida');
  if(invSelMeds.has(d)) invSelMeds.delete(d); else invSelMeds.add(d);
  invMensaje(''); invActualizarSeleccion();
});
document.querySelectorAll('[data-meds]').forEach(b=>b.addEventListener('click', ()=>{
  const modo = b.getAttribute('data-meds'), posibles = invMedidasPosibles();
  if(modo==='todas') invSelMeds = new Set(posibles);
  else if(modo==='ninguna') invSelMeds = new Set();
  else invSelMeds = new Set(posibles.filter(d=>[...invSelMats].some(id=>invStock.get(invClave(id, d)))));
  invMensaje(''); invActualizarSeleccion();
}));
document.getElementById('invRango').addEventListener('keydown', ev=>{
  if(ev.key!=='Enter') return;
  ev.preventDefault();
  if(!invSelMats.size) return invMensaje('Elegí primero los materiales.', 'error');
  const elegidas = invParsearRango(ev.target.value);
  if(!elegidas.size) return invMensaje(`"${ev.target.value}" no coincide con ninguna medida de los materiales elegidos. Ejemplo: 9-20, 25, 30-35`, 'error');
  invSelMeds = elegidas; invMensaje(''); invActualizarSeleccion();
});

/* tabla de existencias: clic = una posición; arrastrar o Shift+clic = un
   bloque (todas las celdas entre la primera y la última); Ctrl+clic suma
   a lo ya elegido; encabezado de material o de medida = esa fila/columna. */
let invOrdenTabla = {cols:[], filas:[]};
let invAncla = null, invArrastre = null;
function invBloque(a, b){
  const c1 = invOrdenTabla.cols.indexOf(a.mat), c2 = invOrdenTabla.cols.indexOf(b.mat);
  const f1 = invOrdenTabla.filas.indexOf(a.med), f2 = invOrdenTabla.filas.indexOf(b.med);
  return {
    mats: invOrdenTabla.cols.slice(Math.min(c1,c2), Math.max(c1,c2)+1),
    meds: invOrdenTabla.filas.slice(Math.min(f1,f2), Math.max(f1,f2)+1)
  };
}
function invAplicarBloque(bloque, sumar){
  if(sumar){ bloque.mats.forEach(m=>invSelMats.add(m)); bloque.meds.forEach(d=>invSelMeds.add(d)); }
  else { invSelMats = new Set(bloque.mats); invSelMeds = new Set(bloque.meds); }
}
/* durante el arrastre solo se repintan las celdas (no se rearma la tabla) */
function invPintarSeleccionTabla(){
  document.querySelectorAll('#invMatriz td[data-material]').forEach(td=>{
    td.classList.toggle('sel', invElegido(td.getAttribute('data-material'), td.getAttribute('data-medida')));
  });
}
const invCelda = td => ({mat: td.getAttribute('data-material'), med: td.getAttribute('data-medida')});
document.getElementById('invMatriz').addEventListener('mousedown', ev=>{
  if(ev.button!==0) return;
  const td = ev.target.closest('td[data-material]');
  if(!td) return;
  ev.preventDefault(); // que el arrastre no seleccione texto
  const celda = invCelda(td), sumar = ev.ctrlKey || ev.metaKey;
  const desde = ev.shiftKey && invAncla ? invAncla : celda;
  invArrastre = {desde, sumar, base:{mats:new Set(invSelMats), meds:new Set(invSelMeds)}};
  if(!ev.shiftKey) invAncla = celda;
  invAplicarBloque(invBloque(desde, celda), sumar);
  invPintarSeleccionTabla(); invDibujarMateriales(); invDibujarMedidas(); invDibujarResumenSeleccion();
});
document.getElementById('invMatriz').addEventListener('mouseover', ev=>{
  if(!invArrastre) return;
  const td = ev.target.closest('td[data-material]');
  if(!td) return;
  invSelMats = new Set(invArrastre.base.mats); invSelMeds = new Set(invArrastre.base.meds);
  invAplicarBloque(invBloque(invArrastre.desde, invCelda(td)), invArrastre.sumar);
  invPintarSeleccionTabla(); invDibujarMateriales(); invDibujarMedidas(); invDibujarResumenSeleccion();
});
window.addEventListener('mouseup', ()=>{
  if(!invArrastre) return;
  invArrastre = null;
  invMensaje('');
  const c = document.getElementById('invCantidad'); c.focus(); c.select();
});
document.getElementById('invMatriz').addEventListener('click', ev=>{
  const sumar = ev.ctrlKey || ev.metaKey;
  const thCol = ev.target.closest('th[data-mat]');
  if(thCol){
    // un material entero: sus medidas con stock (si no tiene, se eligen después)
    const m = invMaterial(thCol.getAttribute('data-mat'));
    const conStock = m.medidas.filter(d=>invStock.get(invClave(m.id, d)));
    invAplicarBloque({mats:[m.id], meds:conStock}, sumar);
    invMensaje(''); invActualizarSeleccion(); return;
  }
  const thFila = ev.target.closest('th[data-med]');
  if(thFila){
    // una medida entera: los materiales que tienen stock en ella (o que la tienen)
    const d = thFila.getAttribute('data-med');
    const tienen = (invArea().materiales||[]).filter(m=>m.medidas.includes(d));
    const conStock = tienen.filter(m=>invStock.get(invClave(m.id, d)));
    invAplicarBloque({mats:(conStock.length ? conStock : tienen).map(m=>m.id), meds:[d]}, sumar);
    invMensaje(''); invActualizarSeleccion();
  }
});
document.getElementById('invAgregarBtn').addEventListener('click', invAgregar);
document.getElementById('invCantidad').addEventListener('input', invDibujarResumenSeleccion);
document.getElementById('invCantidad').addEventListener('keydown', ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); invAgregar(); } });
document.getElementById('invCartList').addEventListener('click', ev=>{
  const b = ev.target.closest('.cartRm');
  if(!b || invRegistrando) return;
  invCarrito.splice(Number(b.getAttribute('data-i')), 1);
  invGuardarCarrito(); invDibujarCarrito(); invDibujarMatriz();
});
document.getElementById('invCartList').addEventListener('change', ev=>{
  const inp = ev.target.closest('.cartQty');
  if(!inp || invRegistrando) return;
  const l = invCarrito[Number(inp.getAttribute('data-i'))];
  const n = Number(inp.value);
  if(l && Number.isInteger(n) && n>0 && n!==l.cantidad){ l.cantidad = n; invGuardarCarrito(); }
  inp.blur(); // suelta el foco para que la lista se pueda redibujar con lo nuevo
  invDibujarCarrito(); invDibujarMatriz();
});
document.getElementById('invVaciarBtn').addEventListener('click', ()=>{
  if(invRegistrando) return;
  if(!confirm('¿Vaciar el carrito? Se pierden las líneas que armaste.')) return;
  invCarrito = []; invGuardarCarrito(); invDibujarCarrito(); invDibujarMatriz();
});
document.getElementById('invConfirmarBtn').addEventListener('click', invConfirmar);
document.getElementById('invSoloConStock').addEventListener('change', invDibujarMatriz);
