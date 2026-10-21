/* =========================================================
   MALLAS — Lista de corte por CodMat, entrada al rack con sticker, stock
   =========================================================
   Lista de corte: lo que hay que fabricar, agrupado por CodMat y puesto de
   trabajo (lo arma el puente, ver server/reglas-mallas.js), con el stock
   del Rack ya descontado: "Falta" es lo que hay que hacer.
   Tocar una fila la pasa a "Entrada al rack" (cantidad = lo que falta,
   editable). "Dar entrada" la registra en el stock (el mismo motor que
   Tecoflex: todo o nada, sin duplicados, en vivo) e imprime UN STICKER POR
   MALLA (Zebra, o PDF si la Zebra no está).
   Rack: stock por CodMat, "Falta" por CodMat, salida escaneando el sticker
   (cada escaneo suma 1) y movimientos recientes. */
let msStock = new Map();     // CodMat -> {cantidad, nombre}
let msMovimientos = [];
let msHoy = { sale: 0, entra: 0 };
let msVersion = -1;
let msEntrada = [];          // [{codmat, descripcion, cantidad}]
let msSalida = [];           // [{codmat, descripcion, cantidad}]
let msLotes = { entrada: null, salida: null }; // idCliente de cada carrito (cambia si el carrito cambia)
let msOcupado = false;

/* La lista va por CodMat, SIN puesto de trabajo: así un mismo material no
   aparece repetido en varios grupos y el operario no se confunde. Se
   separa solo en dos grupos: las órdenes ya LIBERADAS (cualquier puesto) y
   las de PLANEACIÓN (todavía no liberadas). El detalle por puesto va en
   el resumen "Necesidad por puesto" (msDibujarPorPuesto).
   Los números (sobre todo "Falta") van antes que el vehículo: así se ven sin desplazar. */
const MS_COLUMNAS = [
  {campo:'CodMat', etiqueta:'CodMat'}, {campo:'Descricao', etiqueta:'Descripción'},
  {campo:'Cantidad', etiqueta:'Cantidad'}, {campo:'Cubierto', etiqueta:'Con stock'}, {campo:'Falta', etiqueta:'Falta'},
  {campo:'Vehiculo', etiqueta:'Vehículo'},
];
/* Tejidos (rack por posiciones) suma el Tamaño, que decide en qué posición entra */
const msColumnas = () => areaActual().rack.tipo==='posiciones'
  ? [MS_COLUMNAS[0], MS_COLUMNAS[1], {campo:'Tamano', etiqueta:'Tamaño'}, ...MS_COLUMNAS.slice(2)] : MS_COLUMNAS;
const MS_GRUPOS = [
  { id: 'liberadas', titulo: 'Liberadas', nota: 'órdenes ya liberadas a producción' },
  { id: 'planeacion', titulo: 'En planeación', nota: 'órdenes todavía no liberadas' },
];
// orden del proceso, para el resumen por puesto (Planeación al final)
const MS_ORDEN_PUESTOS = ['01CORTE','02CNC','03SERIG','04SER_TT','04SER_VT','05EMPAL','06CURVAD','07RECORT','08PULIDO','09IOX_E','09IOX_S','11ZUND','12P_ENSA','PLANEACION'];
const msEsMallas = () => !!areaActual().rack.porCodmat;
const msNuevoId = () => { const b = new Uint8Array(12); crypto.getRandomValues(b); return Array.from(b, x=>x.toString(16).padStart(2,'0')).join(''); };
/* lo que escanea la pistola: el CodMat del sticker (con o sin los 9 ceros de SAP) */
const msCodmat = v => { const s = String(v||'').trim(); return s.startsWith('000000000') ? s.slice(9) : s; };
const msNum = n => Number(n).toLocaleString('es-CO');
/* cómo se llama la unidad en esta área: "3 mallas", "1 tejido" (areas-config.js → pieza) */
const msPiezas = (n, conNumero = true) => { const p = areaActual().pieza || { una: 'unidad', varias: 'unidades' }; return (conNumero ? msNum(n) + ' ' : '') + (n===1 ? p.una : p.varias); };
const msEsPlaneacion = puesto => String(puesto||'').trim().toUpperCase()==='PLANEACION';

/* ---------------- Lista de corte ---------------- */
/* Las filas que manda el puente vienen por CodMat y puesto (así reparte el
   stock: primero al puesto más avanzado). Acá se juntan por CodMat y grupo
   (liberadas / planeación). Se recalcula solo si cambió la lista. */
let msAgrupadoCache = { de: null, filas: [] };
function msAgrupado(){
  if(msAgrupadoCache.de===ordenesPendientes) return msAgrupadoCache.filas;
  const grupos = new Map();
  ordenesPendientes.forEach(f=>{
    const grupo = msEsPlaneacion(f.Puestodetrabajo) ? 'planeacion' : 'liberadas';
    const clave = f.CodMat + '|' + grupo;
    let g = grupos.get(clave);
    if(!g){ g = { clave, grupo, CodMat: f.CodMat, Descricao: f.Descricao, Tamano: f.Tamano || '', Cantidad: 0, Cubierto: 0, Falta: 0, vehiculos: new Set(), ordenes: [], puestos: [] }; grupos.set(clave, g); }
    g.Cantidad += f.Cantidad; g.Cubierto += f.Cubierto; g.Falta += f.Falta;
    String(f.Vehiculo||'').split(' · ').filter(Boolean).forEach(v=>g.vehiculos.add(v));
    g.ordenes.push(...(f.ordenes||[]));
    g.puestos.push(`${f.Puestodetrabajo}: ${msNum(f.Cantidad)}`);
  });
  const filas = [...grupos.values()].map(g=>({ ...g, Vehiculo: [...g.vehiculos].join(' · '), Ordenes: g.ordenes.length, Grupo: g.grupo==='planeacion' ? 'En planeación' : 'Liberadas' }));
  msAgrupadoCache = { de: ordenesPendientes, filas };
  return filas;
}
/* Lo que se ve en la tabla (filtro del buscador + orden elegido), liberadas
   primero y planeación después: lo usan la tabla y el Excel. */
function msFilasVisibles(){
  const filtro = ordFiltroTexto();
  const visibles = msAgrupado().filter(f=>!filtro || [f.CodMat, f.Descricao, f.Vehiculo, f.Grupo, ...f.puestos, ...f.ordenes].join('\u0000').toLowerCase().includes(filtro));
  return MS_GRUPOS.flatMap(g=>ordOrdenarLista(visibles.filter(f=>f.grupo===g.id), ordSort.campo, ordSort.dir));
}
function msRenderLista(){
  const wrap = document.getElementById('ordTableWrap');
  const todas = msAgrupado();
  document.getElementById('msKpiFalta').textContent = msNum(todas.filter(f=>f.grupo==='liberadas').reduce((s, f)=>s + f.Falta, 0));
  msDibujarPorPuesto();
  if(!todas.length){
    document.getElementById('ordCount').textContent = '0';
    wrap.innerHTML = `<div class="empty">No hay ${msPiezas(0, false)} pendientes de fabricar.</div>`;
    if(typeof appVistaActual!=='undefined' && appVistaActual==='rack') msDibujarStock();
    return;
  }
  const filtro = ordFiltroTexto();
  const ordenadas = msFilasVisibles();
  document.getElementById('ordCount').textContent = filtro ? `${ordenadas.length} de ${todas.length}` : String(todas.length);
  if(!ordenadas.length){ wrap.innerHTML = '<div class="empty">Ninguna fila coincide con la búsqueda.</div>'; return; }
  const enCarrito = new Set(msEntrada.map(l=>l.codmat));
  const conTamano = areaActual().rack.tipo==='posiciones', columnas = msColumnas();
  const celdaTamano = f => !conTamano ? '' : `<td>${f.Tamano
    ? `<span class="tjTam">${escapeHtml(f.Tamano)}</span>`
    : `<button type="button" class="linkBtn tjAsignar" data-asignar="${escapeHtml(f.CodMat)}" title="Este tejido no tiene tamaño: elegilo para poder darle entrada">Asignar</button>`}</td>`;
  const fila = f=>`
    <tr class="msFila${f.Falta ? '' : ' msCubierta'}${enCarrito.has(f.CodMat) ? ' msElegida' : ''}" data-clave="${escapeHtml(f.clave)}" title="${escapeHtml(f.Ordenes + ' orden(es) · ' + f.puestos.join(' · '))}">
      <td>${escapeHtml(f.CodMat)}</td>
      <td class="msDesc">${escapeHtml(f.Descricao||'—')}</td>
      ${celdaTamano(f)}
      <td class="num">${msNum(f.Cantidad)}</td>
      <td class="num">${f.Cubierto ? msNum(f.Cubierto) : '—'}</td>
      <td class="num"><b class="${f.Falta ? 'msFalta' : 'msOk'}">${f.Falta ? msNum(f.Falta) : '✓ cubierto'}</b></td>
      <td>${escapeHtml(f.Vehiculo||'—')}</td>
      <td class="rowActions"><span class="ordAddBtn">+ Entrada</span></td>
    </tr>`;
  // un encabezado por grupo (liberadas / planeación), con su total de lo que falta
  const cuerpo = MS_GRUPOS.map(g=>{
    const del = ordenadas.filter(f=>f.grupo===g.id);
    if(!del.length) return '';
    const falta = del.reduce((s, f)=>s + f.Falta, 0);
    return `<tbody class="msGrupo ${g.id}"><tr class="msGrupoHead"><td colspan="${columnas.length + 1}">
      <b>${g.titulo}</b> <span>${g.nota} · ${del.length} material${del.length===1?'':'es'} · faltan ${msNum(falta)}</span></td></tr>
      ${del.map(fila).join('')}</tbody>`;
  }).join('');
  wrap.innerHTML = `<table class="ordTable msTabla"><thead><tr>${columnas.map(ordEncabezadoOrdenable).join('')}<th></th></tr></thead>${cuerpo}</table>`;
  // la columna "Falta" del Rack sale de esta misma lista
  if(typeof appVistaActual!=='undefined' && appVistaActual==='rack') msDibujarStock();
}

/* "Necesidad por puesto": cuántas mallas hacen falta en cada puesto de
   trabajo, y de qué CodMat (en el orden del proceso; Planeación al final). */
function msDibujarPorPuesto(){
  const cont = document.getElementById('msPorPuesto');
  if(!cont) return;
  const porPuesto = new Map();
  ordenesPendientes.forEach(f=>{
    const p = msEsPlaneacion(f.Puestodetrabajo) ? 'Planeación' : f.Puestodetrabajo;
    if(!porPuesto.has(p)) porPuesto.set(p, []);
    porPuesto.get(p).push(f);
  });
  const rango = p => { const i = MS_ORDEN_PUESTOS.indexOf(p==='Planeación' ? 'PLANEACION' : String(p).toUpperCase()); return i<0 ? 99 : i; };
  const puestos = [...porPuesto.keys()].sort((a, b)=>rango(a) - rango(b));
  document.getElementById('msPorPuestoCount').textContent = puestos.length;
  cont.innerHTML = puestos.length ? puestos.map(p=>{
    const filas = porPuesto.get(p).slice().sort((a, b)=>b.Falta - a.Falta || a.CodMat.localeCompare(b.CodMat));
    const falta = filas.reduce((s, f)=>s + f.Falta, 0), cantidad = filas.reduce((s, f)=>s + f.Cantidad, 0);
    return `<div class="msPuesto${p==='Planeación' ? ' planeacion' : ''}${falta ? '' : ' cubierto'}">
      <div class="msPuestoHead"><b>${escapeHtml(p)}</b><span>${falta ? `faltan <b>${msNum(falta)}</b>` : '✓ cubierto'}${falta!==cantidad ? ` de ${msNum(cantidad)}` : ''}</span></div>
      ${filas.map(f=>`<div class="msPuestoLinea" title="${escapeHtml(f.Descricao||'')}">
        <span class="mono">${escapeHtml(f.CodMat)}</span><span class="msPuestoDesc">${escapeHtml(f.Descricao||'')}</span><b class="${f.Falta ? 'msFalta' : 'msOk'}">${f.Falta ? msNum(f.Falta) : '✓'}</b>
      </div>`).join('')}
    </div>`;
  }).join('') : `<div class="cartEmpty">No hay ${msPiezas(0, false)} pendientes.</div>`;
}

/* Tocar una fila: su CodMat va a "Entrada al rack" con lo que falta (si
   ya estaba, se le suma; si no falta nada, 1). */
function msElegirFila(clave){
  const f = msAgrupado().find(x=>x.clave===clave);
  if(!f) return;
  const suma = f.Falta > 0 ? f.Falta : 1;
  const l = msEntrada.find(x=>x.codmat===f.CodMat);
  if(l) l.cantidad += suma; else msEntrada.push({ codmat: f.CodMat, descripcion: f.Descricao, cantidad: suma });
  msLotes.entrada = null;
  msDibujarCarrito('entrada');
  msRenderLista();
}

/* ---------------- carritos (entrada y salida) ---------------- */
const MS_CARRITO = {
  entrada: { lista: ()=>msEntrada, set: v=>{ msEntrada = v; }, ids: ['msEntLista', 'msEntCount', 'msEntVaciar', 'msEntConfirmar'], vacio: 'Tocá en la lista lo que fabricaste.' },
  salida:  { lista: ()=>msSalida,  set: v=>{ msSalida = v; },  ids: ['msSalLista', 'msSalCount', 'msSalVaciar', 'msSalConfirmar'], vacio: 'Escaneá los stickers o tocá "Salida" en la tabla de stock.' },
};
function msDibujarCarrito(tipo){
  const c = MS_CARRITO[tipo], lista = c.lista();
  const [idLista, idCount, idVaciar, idBtn] = c.ids;
  const total = lista.reduce((s, l)=>s + l.cantidad, 0);
  document.getElementById(idCount).textContent = lista.length;
  document.getElementById(idVaciar).hidden = !lista.length;
  const btn = document.getElementById(idBtn);
  btn.disabled = !lista.length || msOcupado;
  btn.textContent = tipo==='entrada'
    ? (total ? `Dar entrada e imprimir ${msNum(total)} sticker${total===1?'':'s'}` : 'Dar entrada')
    : (total ? `Registrar salida de ${msNum(total)}` : 'Registrar salida');
  document.getElementById(idLista).innerHTML = lista.length ? lista.map((l, i)=>{
    const hay = (msStock.get(l.codmat)||{}).cantidad || 0;
    const sinStock = tipo==='salida' && l.cantidad > hay;
    return `<div class="cartRow ${tipo}${sinStock ? ' sinStock' : ''}">
      <span class="movTag ${tipo}">${tipo==='salida' ? 'Sale' : 'Entra'}</span>
      <div class="cartInfo"><b>${escapeHtml(l.codmat)}</b><small title="${escapeHtml(l.descripcion||'')}">${escapeHtml(l.descripcion||'')}${tipo==='salida' ? ` · hay ${msNum(hay)}` : ''}</small></div>
      <input type="number" class="cartQty msCant" min="1" step="1" value="${l.cantidad}" data-i="${i}" aria-label="Cantidad de ${escapeHtml(l.codmat)}">
      <button type="button" class="cartRm" data-quitar="${i}" aria-label="Quitar">✕</button>
    </div>`;
  }).join('') : `<div class="cartEmpty">${c.vacio}</div>`;
}
function msCambiarCantidad(tipo, i, valor){
  const l = MS_CARRITO[tipo].lista()[i];
  const n = Math.floor(Number(valor));
  if(!l || !(n > 0)) return;
  l.cantidad = n; msLotes[tipo] = null;
  msDibujarCarrito(tipo);
}

/* Registra el carrito. Entrada: además, un sticker por unidad. */
async function msRegistrar(tipo){
  const lista = MS_CARRITO[tipo].lista();
  if(!lista.length || msOcupado) return;
  const status = document.getElementById(tipo==='entrada' ? 'msEntStatus' : 'msSalStatus');
  if(tipo==='salida'){
    const faltan = lista.filter(l=>l.cantidad > ((msStock.get(l.codmat)||{}).cantidad||0));
    if(faltan.length){ status.textContent = `No alcanza el stock de: ${faltan.map(l=>l.codmat).join(', ')}.`; status.className = 'hint msg-error'; return; }
  }
  msOcupado = true; msDibujarCarrito(tipo);
  status.className = 'hint'; status.textContent = 'Registrando…';
  if(!msLotes[tipo]) msLotes[tipo] = msNuevoId(); // mismo id si se reintenta: el puente no lo registra dos veces
  try {
    const nota = document.getElementById(tipo==='entrada' ? 'msEntNota' : 'msSalNota').value;
    const res = await fetch(ordBridgeUrl()+'/api/inventario/movimientos', {
      method:'POST', headers: ordApiHeaders({'Content-Type':'application/json'}),
      body: JSON.stringify({ idCliente: msLotes[tipo], nota, items: lista.map(l=>({ tipo, material: l.codmat, descripcion: l.descripcion, cantidad: l.cantidad })) })
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error((data.error || ('HTTP '+res.status)) + (data.detalles ? ' ' + data.detalles.join(' · ') : ''));
    msAplicarResultado(Object.assign({ area: areaActualId }, data));
    const total = lista.reduce((s, l)=>s + l.cantidad, 0);
    MS_CARRITO[tipo].set([]); msLotes[tipo] = null;
    document.getElementById(tipo==='entrada' ? 'msEntNota' : 'msSalNota').value = '';
    if(tipo==='entrada'){
      status.className = 'hint msg-ok';
      status.textContent = `Listo: entraron ${msPiezas(total)}. Imprimiendo stickers…`;
      status.textContent = `Listo: entraron ${msPiezas(total)}. ` + await msImprimir(lista, data.movimiento);
      if(typeof ordRefrescar==='function') ordRefrescar({auto:true}); // "Falta" baja ya
    } else {
      status.className = 'hint msg-ok';
      status.textContent = `Listo: salieron ${msPiezas(total)}.`;
    }
  } catch(e){
    status.className = 'hint msg-error';
    status.textContent = 'No se registró: ' + e.message;
  } finally {
    msOcupado = false;
    msDibujarCarrito(tipo);
    if(tipo==='entrada') msRenderLista();
  }
}
/* Zebra primero; si no está configurada o falla, PDF para imprimir a mano. */
async function msImprimir(lineas, movimiento){
  const usuario = (movimiento && movimiento.usuario) || (typeof authUsuarioActual==='function' ? authUsuarioActual() : '');
  const fecha = movimiento && movimiento.fecha;
  try { await imprimirStickersMallasZPL(lineas, usuario, fecha); return 'Stickers enviados a la Zebra.'; }
  catch(e){
    console.warn('[mallas] Zebra:', e.message);
    try { generarStickersMallasPDF(lineas, usuario, fecha); return 'La Zebra no está disponible: se descargó el PDF de stickers para imprimirlo.'; }
    catch(e2){ return 'No se pudieron generar los stickers: ' + e2.message; }
  }
}

/* ---------------- Rack (stock) ---------------- */
async function msRackRender(silencioso){
  const area = areaActualId;
  msDibujarCarrito('salida');
  try {
    const qs = silencioso && msVersion>=0 ? '?version='+msVersion : '';
    const res = await fetch(ordBridgeUrl()+'/api/inventario'+qs, {headers: ordApiHeaders()});
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || ('HTTP '+res.status));
    if(area!==areaActualId) return;
    if(!data.sinCambios) msAplicarTodo(data);
  } catch(e){
    if(!silencioso && area===areaActualId) document.getElementById('msStockWrap').innerHTML = `<div class="empty">No se pudo traer el stock: ${escapeHtml(e.message)}</div>`;
    return;
  }
  // la necesidad de Lista de corte (si esta persona la puede ver): de la memoria del puente, no de SQL
  // sin esperarla: el stock se ve ya, y se vuelve a dibujar cuando llegue la lista
  if(areaTieneVista('ordenes') && ordUltimaLista.area!==areaActualId) ordRefrescar({auto:true}).then(()=>{ if(area===areaActualId) msDibujarStock(); });
  msDibujarStock();
}
function msAplicarTodo(data){
  msStock = new Map((data.stock||[]).map(s=>[s.material, { cantidad: s.cantidad, nombre: s.nombre || s.material }]));
  if(data.movimientos) msMovimientos = data.movimientos;
  if(data.hoy) msHoy = data.hoy;
  msVersion = data.version;
}
/* Cambio que llega del puente (aviso en vivo o la respuesta a un registro):
   la versión lo ordena, igual que en Tecoflex. */
function msAplicarResultado(r){
  if(!msEsMallas() || (r.area && r.area!==areaActualId) || r.version==null) return;
  if(r.recargar){ msRackRender(true); return; } // el administrador borró movimientos: se vuelve a pedir todo
  if(msVersion>=0 && r.version<=msVersion) return;
  if(msVersion>=0 && r.version!==msVersion+1){ msRackRender(true); return; }
  msStock = new Map((r.stock||[]).map(s=>[s.material, { cantidad: s.cantidad, nombre: s.nombre || s.material }]));
  if(r.movimiento){ msMovimientos.unshift(r.movimiento); if(msMovimientos.length>300) msMovimientos.length = 300; }
  if(r.hoy) msHoy = r.hoy;
  msVersion = r.version;
  msDibujarStock();
  msDibujarCarrito('salida');
}
function msDibujarStock(){
  if(!msEsMallas()) return;
  // necesidad por CodMat (de la Lista de corte, si se tiene)
  const nec = new Map();
  (ordUltimaLista.area===areaActualId ? ordenesPendientes : []).forEach(f=>{
    const n = nec.get(f.CodMat) || { necesidad: 0, falta: 0, desc: f.Descricao };
    n.necesidad += f.Cantidad; n.falta += f.Falta; nec.set(f.CodMat, n);
  });
  // solo lo que hay en el rack: lo que falta fabricar sin stock se ve en Lista de corte
  const codmats = [...msStock.keys()].filter(c=>msStock.get(c).cantidad > 0).sort();
  const total = [...msStock.values()].reduce((s, x)=>s + x.cantidad, 0);
  document.getElementById('msKpiStock').textContent = msNum(total);
  document.getElementById('msKpiHoy').textContent = `${msNum(msHoy.entra)} / ${msNum(msHoy.sale)}`;
  const conLista = ordUltimaLista.area===areaActualId;
  document.getElementById('msStockWrap').innerHTML = codmats.length ? `<table class="ordTable msTabla">
    <thead><tr><th>CodMat</th><th>Descripción</th><th class="num">Stock</th>${conLista ? '<th class="num">Necesidad</th><th class="num">Falta</th>' : ''}<th></th></tr></thead>
    <tbody>${codmats.map(c=>{
      const s = msStock.get(c), n = nec.get(c);
      return `<tr>
        <td>${escapeHtml(c)}</td><td class="msDesc">${escapeHtml((s && s.nombre!==c ? s.nombre : n && n.desc) || '—')}</td>
        <td class="num"><b>${s ? msNum(s.cantidad) : '0'}</b></td>
        ${conLista ? `<td class="num">${n ? msNum(n.necesidad) : '—'}</td><td class="num">${n && n.falta ? `<b class="msFalta">${msNum(n.falta)}</b>` : '<span class="msOk">—</span>'}</td>` : ''}
        <td class="rowActions">${s ? `<button type="button" class="secondary btnSm" data-sal="${escapeHtml(c)}">− Salida</button>
          <button type="button" class="linkBtn" data-reimp="${escapeHtml(c)}" title="Imprime 1 sticker de este CodMat (sin mover el stock)">🖨 Sticker</button>` : ''}</td>
      </tr>`; }).join('')}</tbody></table>`
    : `<div class="empty">Todavía no hay ${msPiezas(0, false)} en stock. Se les da entrada desde Lista de corte.</div>`;
  const movs = msMovimientos.slice(0, 80);
  document.getElementById('msMovs').innerHTML = movs.length ? haBarra() + `<table class="ordTable"><thead><tr>${haTh()}<th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Usuario</th></tr></thead><tbody>${
    movs.map(mv=>{
      const tipo = mv.items.every(l=>l.tipo==='entrada') ? 'entrada' : mv.items.every(l=>l.tipo==='salida') ? 'salida' : 'mixto';
      return `<tr>${haTd(mv.id)}<td class="mono">${escapeHtml(new Date(mv.fecha).toLocaleString('es-CO', {dateStyle:'short', timeStyle:'short'}))}</td>
        <td><span class="movTag ${tipo}">${tipo==='entrada' ? 'Entrada' : tipo==='salida' ? 'Salida' : 'Mixto'}</span></td>
        <td class="movDetalle"><div class="movItems">${mv.items.map(l=>`<span class="movItem ${l.tipo}">${l.tipo==='salida'?'−':'+'}${l.cantidad} <b>${escapeHtml(l.material)}</b></span>`).join('')}</div>${mv.nota ? `<small>${escapeHtml(mv.nota)}</small>` : ''}</td>
        <td>${escapeHtml(mv.usuario||'—')}</td></tr>`;
    }).join('')}</tbody></table>` : '<div class="empty">Todavía no hay movimientos.</div>';
  haAplicar('msMovs', async ids=>{ await haEliminarMovimientos(ids); await msRackRender(true); });
}

/* Salida: cada escaneo (o "− Salida") suma 1 de ese CodMat, hasta lo que hay. */
function msSumarSalida(codmat){
  const msg = document.getElementById('msSalScanMsg');
  const s = msStock.get(codmat);
  if(!s){ msg.className = 'hint msg-error'; msg.textContent = `No hay stock del CodMat ${codmat}.`; return; }
  const l = msSalida.find(x=>x.codmat===codmat);
  const ya = l ? l.cantidad : 0;
  if(ya >= s.cantidad){ msg.className = 'hint msg-error'; msg.textContent = `De ${codmat} hay ${msNum(s.cantidad)} y ya están todas en la salida.`; return; }
  if(l) l.cantidad++; else msSalida.push({ codmat, descripcion: s.nombre, cantidad: 1 });
  msLotes.salida = null;
  msg.className = 'hint msg-ok'; msg.textContent = `+1 ${codmat} (${ya+1} en la salida)`;
  msDibujarCarrito('salida');
}

/* ---------------- eventos ---------------- */
document.getElementById('ordTableWrap').addEventListener('click', ev=>{
  if(!areaActual().listaPorCodmat) return;
  // Tejidos: "Asignar" elige el tamaño del tejido (sin tamaño no se le puede dar entrada)
  const asignar = ev.target.closest('[data-asignar]');
  if(asignar){ msAsignarTamano(asignar); return; }
  if(ev.target.closest('.tjTamSel')) return;
  const tr = ev.target.closest('tr.msFila');
  if(!tr) return;
  const f = msAgrupado().find(x=>x.clave===tr.getAttribute('data-clave'));
  // Tejidos se ingresan uno a uno en el Rack (con foto): tocar la fila lleva ahí, con el tejido elegido
  if(areaActual().rack.tipo==='posiciones'){ if(f && typeof tjIrAEntrada==='function') tjIrAEntrada(f.CodMat, f.Descricao); return; }
  if(msEsMallas()) msElegirFila(tr.getAttribute('data-clave'));
});
/* "Asignar" tamaño (P, G, XG) a un tejido de la Lista de corte que no lo tiene. */
function msAsignarTamano(btn){
  const codmat = btn.getAttribute('data-asignar');
  const f = msAgrupado().find(x=>x.CodMat===codmat) || {};
  const td = btn.closest('td');
  td.innerHTML = `<select class="tjTamSel" aria-label="Tamaño de ${escapeHtml(codmat)}"><option value="">Tamaño…</option>${
    (areaActual().rack.tamanos||[]).map(t=>`<option value="${t}">${t}</option>`).join('')}</select>`;
  const sel = td.querySelector('select');
  sel.focus();
  sel.addEventListener('change', async ()=>{
    if(!sel.value) return;
    sel.disabled = true;
    try {
      const res = await fetch(ordBridgeUrl()+'/api/tejidos/tamano', { method: 'PUT', headers: ordApiHeaders({'Content-Type':'application/json'}),
        body: JSON.stringify({ codmat, tamano: sel.value, nombre: f.Descricao }) });
      const data = await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error || ('HTTP '+res.status));
      await ordRefrescar({ auto: true }); // la lista ya la trae con su tamaño (aviso en vivo a las demás PCs)
    } catch(e){ alert('No se pudo asignar el tamaño: ' + e.message); msRenderLista(); }
  });
  sel.addEventListener('blur', ()=>{ if(!sel.disabled && !sel.value) msRenderLista(); });
}
['entrada', 'salida'].forEach(tipo=>{
  const [idLista, , idVaciar, idBtn] = MS_CARRITO[tipo].ids;
  document.getElementById(idLista).addEventListener('change', ev=>{ if(ev.target.classList.contains('msCant')) msCambiarCantidad(tipo, +ev.target.getAttribute('data-i'), ev.target.value); });
  document.getElementById(idLista).addEventListener('click', ev=>{
    const b = ev.target.closest('[data-quitar]');
    if(!b) return;
    MS_CARRITO[tipo].lista().splice(+b.getAttribute('data-quitar'), 1); msLotes[tipo] = null;
    msDibujarCarrito(tipo); if(tipo==='entrada') msRenderLista();
  });
  document.getElementById(idVaciar).addEventListener('click', ()=>{ MS_CARRITO[tipo].set([]); msLotes[tipo] = null; msDibujarCarrito(tipo); if(tipo==='entrada') msRenderLista(); });
  document.getElementById(idBtn).addEventListener('click', ()=>msRegistrar(tipo));
});
document.getElementById('msSalScan').addEventListener('keydown', ev=>{
  if(ev.key!=='Enter') return;
  ev.preventDefault();
  const v = ev.target.value; ev.target.value = '';
  if(v.trim()) msSumarSalida(msCodmat(v));
});
document.getElementById('msStockWrap').addEventListener('click', async ev=>{
  const sal = ev.target.closest('[data-sal]');
  if(sal){ msSumarSalida(sal.getAttribute('data-sal')); return; }
  const re = ev.target.closest('[data-reimp]');
  if(re){
    const c = re.getAttribute('data-reimp'), s = msStock.get(c) || {};
    const msg = document.getElementById('msSalStatus');
    msg.className = 'hint'; msg.textContent = await msImprimir([{ codmat: c, descripcion: s.nombre, cantidad: 1 }], null);
  }
});
/* Cada área (Mallas, Tejidos) tiene SUS carritos: al cambiar de área se
   guardan los de la que se deja y vuelven los de la que se abre. Sin esto,
   lo que estaba en el carrito de Mallas quedaba en el de Tejidos y se le
   podía dar entrada en el área equivocada. Los mensajes se limpian. */
const msCarritosPorArea = {};
let msCarritosDe = areaActualId;
alCambiarArea(()=>{
  msAgrupadoCache = { de: null, filas: [] };
  msCarritosPorArea[msCarritosDe] = { entrada: msEntrada, salida: msSalida, lotes: msLotes };
  const g = msCarritosPorArea[areaActualId] || { entrada: [], salida: [], lotes: { entrada: null, salida: null } };
  msEntrada = g.entrada; msSalida = g.salida; msLotes = g.lotes; msCarritosDe = areaActualId;
  msStock = new Map(); msMovimientos = []; msVersion = -1; msHoy = { sale: 0, entra: 0 };
  ['msEntStatus', 'msSalStatus', 'msSalScanMsg'].forEach(id=>{ const el = document.getElementById(id); el.textContent = ''; el.className = 'hint'; });
  ['msEntNota', 'msSalNota', 'msSalScan'].forEach(id=>{ document.getElementById(id).value = ''; });
  msDibujarCarrito('entrada'); msDibujarCarrito('salida');
});
msDibujarCarrito('entrada'); msDibujarCarrito('salida');
