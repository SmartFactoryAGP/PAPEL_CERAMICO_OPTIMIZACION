/* =========================================================
   RACK DE TECOFLEX — vistas (Registrar · Existencias · Consumo · Movimientos)
   =========================================================
   El Rack tiene varias vistas dentro de la misma pestaña:
   - Existencias: la tabla completa de stock por material y medida (js/ui/inventario.js).
   - Consumo: la MISMA tabla, pero con lo que SALIÓ en un período, cada celda como −N
     (rojo), para empezar a ver el histórico de consumo por material y medida. Los datos
     salen de /api/inventario/consumo, que el puente arma del diario completo.
   - Movimientos: los últimos movimientos, en su propia vista.
   - Registrar: en pantallas CHICAS (celular, tablet) el formulario con el carrito ya no
     va al lado de la tabla (no entra): es una vista más. En pantallas grandes sigue
     a la izquierda y esta pestaña no se ve.
   inventario.js avisa cuando se redibuja (invVistasAlDibujar) o llega un movimiento en
   vivo (invConsAlCambiar). */
const INV_TABS = ['registrar', 'existencias', 'consumo', 'movimientos'];
let invTab = 'existencias';
try { const v = localStorage.getItem('invTab'); if(INV_TABS.includes(v)) invTab = v; } catch(e){}
const invAngosta = window.matchMedia('(max-width: 1100px)');
let invCons = null;          // lo último que mandó /api/inventario/consumo { periodo, data }
let invConsPedido = 0;       // descarta respuestas viejas si se cambia el período rápido
let invConsEspera = null;

const invEl = id => document.getElementById(id);
const invEsTecoflexVista = () => areaActual().rack.tipo==='inventario' && !areaActual().rack.porCodmat;
/* "Registrar" solo existe como vista en pantallas chicas; en las grandes se ve siempre el formulario */
const invTabEfectiva = () => invTab==='registrar' && !invAngosta.matches ? 'existencias' : invTab;

function invTabAplicar(){
  const tab = invTabEfectiva();
  const rack = invEl('viewRack');
  if(rack) rack.setAttribute('data-inv-tab', tab);
  document.querySelectorAll('.invTab').forEach(b=>{ const on = b.dataset.tab===tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
  document.querySelectorAll('.invVista').forEach(v=>{ v.hidden = v.dataset.tab!==tab; });
  if(tab==='consumo' && invEsTecoflexVista()) invConsCargar(!!invCons);
}
function invTabCambiar(tab){
  if(!INV_TABS.includes(tab)) return;
  invTab = tab;
  try { localStorage.setItem('invTab', tab); } catch(e){}
  invTabAplicar();
  if(invAngosta.matches) window.scrollTo(0, 0);
}
/* el número de líneas del carrito, en la pestaña Registrar (se ve aunque se esté en otra vista) */
function invVistasActualizarBadge(){
  const b = invEl('invTabBadge');
  if(!b) return;
  const n = typeof invCarrito!=='undefined' ? invCarrito.length : 0;
  b.textContent = n; b.hidden = !n;
}
function invVistasAlDibujar(){ invVistasActualizarBadge(); invTabAplicar(); }

/* ---------------- consumo ---------------- */
const invDosDig = n => String(n).padStart(2, '0');
const invDia = offset => { const d = new Date(); d.setDate(d.getDate() - offset); return `${d.getFullYear()}-${invDosDig(d.getMonth()+1)}-${invDosDig(d.getDate())}`; };
const invFechaLarga = dia => { const [a, m, d] = String(dia).split('-').map(Number); return new Date(a, m-1, d).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }); };
const invMenos = n => '−' + n;

/* período elegido -> {desde, hasta, etiqueta} (días calendario, contando hoy) */
function invConsRango(){
  const v = invEl('invConsPeriodo').value, hasta = invDia(0);
  if(v==='todo') return { desde: null, hasta, clave: 'todo' };
  if(v==='anio') return { desde: `${new Date().getFullYear()}-01-01`, hasta, clave: 'anio' };
  const n = parseInt(v, 10) || 30;
  return { desde: invDia(n - 1), hasta, clave: String(n) };
}
async function invConsCargar(silencioso){
  if(!invEsTecoflexVista() || (typeof authEstaLogueado==='function' && !authEstaLogueado())) return;
  const n = ++invConsPedido, area = areaActualId, r = invConsRango();
  const qs = new URLSearchParams(); if(r.desde) qs.set('desde', r.desde); qs.set('hasta', r.hasta);
  try {
    const res = await fetch(ordBridgeUrl() + '/api/inventario/consumo?' + qs, { headers: ordApiHeaders() });
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    if(n!==invConsPedido || area!==areaActualId) return;
    invCons = { periodo: r, data };
    invConsDibujar();
  } catch(e){
    if(n!==invConsPedido || silencioso) return;
    invEl('invConsMatriz').innerHTML = `<div class="empty">No se pudo traer el consumo: ${escapeHtml(e.message)}</div>`;
  }
}
/* aviso en vivo de un movimiento nuevo: si se está mirando el consumo, se rehace (sin pedidos de más) */
function invConsAlCambiar(){
  if(!invEsTecoflexVista() || invTabEfectiva()!=='consumo') return;
  clearTimeout(invConsEspera);
  invConsEspera = setTimeout(()=>invConsCargar(true), 500);
}
/* materiales de la tabla: los de la configuración y, si hubo movimientos de uno que ya no está, también ese */
function invConsMateriales(filas){
  const mats = (invArea().materiales || []).slice(), conocidos = new Set(mats.map(m=>m.id)), extra = new Map();
  filas.forEach(f=>{ if(!conocidos.has(f.material) && !extra.has(f.material)) extra.set(f.material, { id: f.material, nombre: `Material "${f.material}" (sin configurar)`, corto: f.material, medidas: [], desconocido: true }); });
  return mats.concat([...extra.values()]);
}
/* lo que muestra la tabla: { mats, medidas, sale(material, medida), totales... } — lo usan la pantalla y el Excel */
function invConsModelo(){
  if(!invCons) return null;
  const filas = invCons.data.filas || [], mats = invConsMateriales(filas);
  const sale = new Map(filas.filter(f=>f.sale).map(f=>[invClave(f.material, f.medida), f.sale]));
  const todas = [...new Set(mats.flatMap(m=>m.medidas).concat(filas.map(f=>f.medida)))].sort((a, b)=>invNum(a) - invNum(b));
  const solo = invEl('invConsSolo').checked;
  const medidas = solo ? todas.filter(d=>mats.some(m=>sale.get(invClave(m.id, d)))) : todas;
  const totMat = new Map(), totMed = new Map();
  let total = 0, maxCelda = 0, mejor = null;
  medidas.forEach(d=>mats.forEach(m=>{
    const n = sale.get(invClave(m.id, d)) || 0;
    if(!n) return;
    totMat.set(m.id, (totMat.get(m.id) || 0) + n); totMed.set(d, (totMed.get(d) || 0) + n); total += n;
    if(n > maxCelda){ maxCelda = n; mejor = { m, d, n }; }
  }));
  return { mats, medidas, sale, totMat, totMed, total, maxCelda, mejor, combinaciones: [...sale.values()].length };
}
function invConsDibujar(){
  const modelo = invConsModelo(), wrap = invEl('invConsMatriz');
  if(!modelo) return;
  const { data, periodo } = invCons;
  const { mats, medidas, sale, totMat, totMed, total, maxCelda, mejor, combinaciones } = modelo;
  // resumen
  invEl('invConsResumen').innerHTML = `
    <div class="stat big"><span>Consumo del período</span><b class="invNeg">${total ? invMenos(total) : '0'}</b></div>
    <div class="stat big"><span>Combinaciones con salidas</span><b>${combinaciones}</b></div>
    <div class="stat big"><span>La que más sale</span><b class="invMejor">${mejor ? `${escapeHtml(invNombreCorto(mejor.m))} · ${escapeHtml(mejor.d)} mm <small class="invNeg">${invMenos(mejor.n)}</small>` : '—'}</b></div>`;
  const desde = periodo.desde ? invFechaLarga(periodo.desde) : (data.primerDia ? invFechaLarga(data.primerDia) : '');
  invEl('invConsHint').innerHTML = data.primerDia
    ? `Salidas del <b>${desde}</b> al <b>${invFechaLarga(periodo.hasta)}</b> · el historial empieza el ${invFechaLarga(data.primerDia)}. Cada salida se ve en rojo con − y la cantidad.`
    : 'Todavía no hay movimientos registrados: apenas se den salidas, el consumo por material y medida aparece acá.';
  if(!medidas.length){
    wrap.innerHTML = `<div class="empty">${data.primerDia ? 'No hubo salidas en este período. Probá con uno más largo o destildá "Solo medidas con consumo".' : 'Sin datos todavía.'}</div>`;
    return;
  }
  const filas = medidas.map(d=>{
    const celdas = mats.map(m=>{
      if(!m.medidas.includes(d) && !sale.get(invClave(m.id, d))) return '<td class="invNa" title="Este material no tiene esta medida">—</td>';
      const n = sale.get(invClave(m.id, d)) || 0;
      if(!n) return '<td class="invCons sinConsumo" title="Sin salidas en el período">·</td>';
      const fuerza = Math.max(6, Math.round(n / maxCelda * 30)); // más consumo = más rojo (mapa de calor)
      return `<td class="invCons conConsumo${m.desconocido ? ' invHuerfano' : ''}" style="--p:${fuerza}%" title="${escapeHtml(m.nombre + ' · ' + d + ' mm — salieron ' + n)}"><b>${invMenos(n)}</b></td>`;
    }).join('');
    return `<tr><th scope="row" class="invEncFila">${escapeHtml(d)}<small>mm</small></th>${celdas}<td class="invTot invNeg">${totMed.get(d) ? invMenos(totMed.get(d)) : ''}</td></tr>`;
  }).join('');
  const encabezado = mats.map(m=>`<th class="${m.desconocido ? 'invHuerfano' : ''}" title="${escapeHtml(m.nombre)}${m.codigo ? ' · ' + escapeHtml(m.codigo) : ''}">${escapeHtml(invNombreCorto(m))}${m.codigo ? `<small>${escapeHtml(m.codigo)}</small>` : ''}${m.desconocido ? '<small>sin configurar</small>' : ''}</th>`).join('');
  const pie = mats.map(m=>`<td class="invNeg">${totMat.get(m.id) ? invMenos(totMat.get(m.id)) : '0'}</td>`).join('');
  wrap.innerHTML = `<table class="ordTable invTable invConsTabla">
    <thead><tr><th>Medida</th>${encabezado}<th>Total</th></tr></thead>
    <tbody>${filas}</tbody>
    <tfoot><tr><th scope="row">Total</th>${pie}<td class="invTot invNeg">${total ? invMenos(total) : '0'}</td></tr></tfoot>
  </table>`;
}

/* Excel: la misma tabla, con las salidas como números negativos (se pueden sumar) */
async function invConsExcel(){
  const modelo = invConsModelo(), btn = invEl('invConsExcel');
  if(!modelo || !modelo.medidas.length){ alert('No hay consumo para descargar en este período.'); return; }
  const { mats, medidas, sale, totMat, totMed, total } = modelo, { periodo } = invCons;
  const columnas = [{ etiqueta: 'Medida (mm)' }, ...mats.map(m=>({ etiqueta: invNombreCorto(m) + (m.codigo ? ' · ' + m.codigo : ''), numero: true })), { etiqueta: 'Total', numero: true }];
  const filas = medidas.map(d=>[d, ...mats.map(m=>{ const n = sale.get(invClave(m.id, d)); return n ? -n : ''; }), totMed.get(d) ? -totMed.get(d) : '']);
  filas.push(['Total', ...mats.map(m=>totMat.get(m.id) ? -totMat.get(m.id) : ''), total ? -total : '']);
  btn.disabled = true;
  try { await descargarExcel(`consumo-tecoflex_${periodo.desde || 'inicio'}_a_${periodo.hasta}.xlsx`, 'Consumo Tecoflex', columnas, filas); }
  catch(e){ alert('No se pudo armar el Excel: ' + e.message); }
  finally { btn.disabled = false; }
}

/* ---------------- eventos ---------------- */
document.querySelectorAll('.invTab').forEach(b=>b.addEventListener('click', ()=>invTabCambiar(b.dataset.tab)));
invAngosta.addEventListener('change', invTabAplicar);
{
  let guardado = null; try { guardado = localStorage.getItem('invConsPeriodo'); } catch(e){}
  const sel = invEl('invConsPeriodo');
  if(guardado && [...sel.options].some(o=>o.value===guardado)) sel.value = guardado;
  sel.addEventListener('change', ()=>{ try { localStorage.setItem('invConsPeriodo', sel.value); } catch(e){} invConsCargar(false); });
}
invEl('invConsSolo').addEventListener('change', ()=>{ if(invCons) invConsDibujar(); });
invEl('invConsExcel').addEventListener('click', invConsExcel);
alCambiarArea(()=>{ invCons = null; invConsPedido++; });
invTabAplicar();
