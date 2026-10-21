/* =========================================================
   NESTING DE TECOFLEX — un pedido de tiras por medida
   =========================================================
   Cada medida (mm) tiene su DXF en una carpeta de la red ("CORTE 9MM UND.dxf":
   una tira de 9 mm de ancho por 3000 de largo). La persona elige el MATERIAL
   (de él sale el ancho de la plancha: PU 1500, Teco Rombos X5 1000, los demás
   1400; el largo es siempre 3000), escribe la MEDIDA y la CANTIDAD de tiras, y
   la app trae el DXF (el puente arma la ruta, ver /api/tecoflex/dxf) y calcula
   cuántas planchas hacen falta.

   El cálculo NO usa el motor por cuadrícula del papel cerámico (redondea a
   celdas de varios mm y para tiras de 9 mm sería impreciso): las tiras corren
   a lo largo de toda la plancha, así que es un problema de UNA dimensión (el
   ancho). Cada plancha se llena con tiras sin pasarse de su ancho, contando la
   separación (kerf) entre una y otra; se prueban dos criterios (primero que
   entra, mejor ajuste) y se queda con el que usa menos planchas.
   El resultado tiene la MISMA forma que el del motor (lastResult), así la vista
   de chapas, el PDF y los DXF funcionan igual.
   Un pedido es de UN solo material (cada material tiene otro ancho de plancha). */
const TN_AREA = 'tecoflex';
const TN_MAX_TIRAS = 50000;       // tope de seguridad: más que esto no es un pedido real
const TN_MAX_POR_LINEA = 9999;
let tnVistas = {};                // área -> lo que había en la pestaña Nesting al salir de ella
let tnAreaPrev = areaActualId;
let tnMatPedido = null;           // material de las medidas ya agregadas
const tnDxfs = new Map();         // medida -> DXF ya traído del puente (no se vuelve a pedir)
const tnInicial = {               // los valores con que nace la pantalla (papel cerámico)
  sheetW: document.getElementById('sheetW').value,
  chapaLen: document.getElementById('chapaLen').value,
  fillStrips: document.getElementById('fillStrips').checked,
  kerf: document.getElementById('kerf').value,
};
const TN_KERF = '0';              // separación entre tiras en Tecoflex: 0 mm (se puede cambiar a mano)

const tnEl = id => document.getElementById(id);
const tnCfg = () => AREAS_CONFIG.areas[TN_AREA].nestingTiras;
const tnMateriales = () => AREAS_CONFIG.areas[TN_AREA].materiales;
const tnMaterial = () => tnMateriales().find(m=>m.id===tnEl('tnMaterial').value) || tnMateriales()[0];
const tnEsTecoflex = () => areaActualId===TN_AREA && !!tnCfg();
const tnUsaPlanDeTiras = tnEsTecoflex;   // lo pregunta runNest() (js/nesting/engine.js)
const tnNum = v => parseFloat(String(v).replace(',', '.'));

/* "9", "9mm", " 9 MM", "6.5" -> "9", "9", "9", "6,5"; '' si no es una medida válida
   (mismas reglas que el puente) */
function tnNormalizar(texto){
  const m = String(texto==null ? '' : texto).trim().toUpperCase().replace(/\s*MM$/, '').replace('.', ',').replace(/^0+(?=\d)/, '');
  return /^\d{1,3}(,\d{1,2})?$/.test(m) && tnNum(m) > 0 ? m : '';
}
const tnNombreArchivo = medida => tnCfg().archivo.replace('{medida}', medida);
function tnFormatoMm(n){ return String(Math.round(n*100)/100).replace('.', ','); }

/* ---------------- pantalla ---------------- */
function tnAviso(texto, tipo){
  const el = tnEl('tnMsg');
  el.textContent = texto || '';
  el.className = 'hint' + (tipo==='error' ? ' msg-error' : tipo==='ok' ? ' tnOk' : tipo==='aviso' ? ' tnAvisoTxt' : '');
}
function tnLlenarMateriales(){
  const sel = tnEl('tnMaterial');
  sel.innerHTML = tnMateriales().map(m=>`<option value="${escapeHtml(m.id)}">${escapeHtml(m.corto)} · ${m.ancho} mm</option>`).join('');
}
/* Ancho y largo de la plancha según el material: van a los campos de siempre
   (que el motor lee) y quedan bloqueados, para que no se desacomoden. */
function tnAplicarPlancha(){
  const m = tnMaterial(), largo = tnCfg().largo;
  tnEl('sheetW').value = m.ancho; tnEl('chapaLen').value = largo;
  tnEl('tnPlancha').innerHTML = `Plancha <b>${m.ancho} × ${largo} mm</b> · ${escapeHtml(m.nombre)}` +
    (m.soloEstasMedidas ? `<br><span class="tnSolo">Solo se corta en las medidas ${m.medidas.map(escapeHtml).join(' · ')} mm</span>` : '');
}
function tnConfigurarCampos(esTeco){
  ['sheetW', 'chapaLen'].forEach(id=>{
    const el = tnEl(id);
    el.readOnly = esTeco;
    el.title = esTeco ? 'Sale del material elegido (el largo de la plancha es siempre 3000 mm)' : '';
  });
  if(esTeco) tnEl('fillStrips').checked = false; // sin tiras de relleno: el pedido es exacto
}
function tnActualizarArchivo(){
  const t = tnEl('tnMedida').value, m = tnNormalizar(t);
  const el = tnEl('tnArchivo');
  if(!t.trim()){ el.innerHTML = '&nbsp;'; el.classList.remove('msg-error'); return; }
  if(!m){ el.textContent = 'Escribí la medida en mm: un número, ej. 9 o 6,5'; el.classList.add('msg-error'); return; }
  el.classList.remove('msg-error');
  el.textContent = 'Archivo: ' + tnNombreArchivo(m);
}
function tnLimpiarResultado(){
  tnEl('chapasWrap').innerHTML = '<div class="empty">Ejecuta el nesting para ver las chapas.</div>';
  ['stUtil', 'stChapas', 'stUnique', 'stPlaced', 'stMirrored', 'stRollLen', 'stArea', 'stSheet', 'stWaste', 'stTime'].forEach(id=>{ tnEl(id).textContent = '—'; });
  tnEl('stUnplacedRow').style.display = 'none';
  lastResult = null;
}

/* ---------------- traer el DXF de una medida ---------------- */
async function tnTraer(medida){
  let res;
  try { res = await fetch(ordBridgeUrl() + '/api/tecoflex/dxf?medida=' + encodeURIComponent(medida), { headers: ordApiHeaders({ 'x-area': areaActualId }) }); }
  catch(e){ throw new Error('no se pudo conectar con el puente (¿está corriendo el servidor?)'); }
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  const nombre = String(data.archivo || tnNombreArchivo(medida));
  const entidades = parseDXFEntities(data.contenido);
  const capas = detectLayers(entidades), mapa = {};
  capas.forEach(c=>{ mapa[c] = guessLayerOp(c); });
  const r = buildLayeredGeometry(entidades, mapa);
  if(!r || !r.mainPoly) throw new Error(`${nombre} no tiene un contorno cerrado.`);
  let poly = r.mainPoly, holes = r.holes && r.holes.length ? r.holes : null, grabado = r.engraveLoops && r.engraveLoops.length ? r.engraveLoops : null;
  let bb = polyBBox(poly);
  // una tira dibujada acostada se pone parada (el largo siempre en Y); con agujeros o grabado no se toca
  if(bb.w > bb.h && !holes && !grabado){ poly = transformPoly(poly, 90, false); bb = polyBBox(poly); }
  const aOrigen = loop => loop.map(([x, y])=>[x - bb.minx, y - bb.miny]);
  const forma = aOrigen(poly);
  // un rectángulo liso sale en el DXF SIN la tapa de arriba (|_|_|_|); con agujeros o grabado no se toca
  return { nombre: nombre.replace(/\.dxf$/i, ''), archivo: nombre, medida, abierta: !holes && !grabado && tnEsRectangulo(forma),
    poly: forma, holes: holes && holes.map(aOrigen), grabado: grabado && grabado.map(aOrigen) };
}
/* ¿El contorno es un rectángulo derecho (4 vértices, o 5 si repite el primero)? */
function tnEsRectangulo(poly){
  const pts = poly.length===5 && poly[0][0]===poly[4][0] && poly[0][1]===poly[4][1] ? poly.slice(0, 4) : poly;
  if(pts.length !== 4) return false;
  const bb = polyBBox(pts), e = 1e-6;
  return pts.every(([x, y])=>(Math.abs(x - bb.minx) < e || Math.abs(x - bb.maxx) < e) && (Math.abs(y - bb.miny) < e || Math.abs(y - bb.maxy) < e))
    && new Set(pts.map(([x, y])=>x + ',' + y)).size === 4;
}

/* ---------------- agregar al pedido ---------------- */
async function tnAgregar(){
  const btn = tnEl('tnAgregar');
  const medida = tnNormalizar(tnEl('tnMedida').value), cantidad = parseInt(tnEl('tnCantidad').value, 10);
  const mat = tnMaterial();
  if(!medida){ tnAviso('Escribí la medida en mm (un número, ej. 9 o 6,5).', 'error'); tnEl('tnMedida').focus(); return; }
  if(!(cantidad >= 1 && cantidad <= TN_MAX_POR_LINEA)){ tnAviso(`Escribí la cantidad de tiras (de 1 a ${TN_MAX_POR_LINEA}).`, 'error'); tnEl('tnCantidad').focus(); return; }
  if(mat.soloEstasMedidas && !mat.medidas.includes(medida)){
    tnAviso(`${mat.corto} solo se corta en las medidas ${mat.medidas.join(' · ')} mm.`, 'error'); tnEl('tnMedida').focus(); return;
  }
  const hay = pieces.find(p=>p.isTecoflex && p.tnMedida===medida);
  if(hay && hay.qty + cantidad > TN_MAX_POR_LINEA){ tnAviso(`La medida ${medida} ya tiene ${hay.qty}: el máximo por medida es ${TN_MAX_POR_LINEA}.`, 'error'); return; }
  btn.disabled = true;
  try {
    let d = tnDxfs.get(medida);
    if(!d){ tnAviso(`Trayendo ${tnNombreArchivo(medida)}…`); d = await tnTraer(medida); tnDxfs.set(medida, d); }
    if(areaActualId !== TN_AREA) return; // se cambió de área mientras tanto
    let p = pieces.find(x=>x.isTecoflex && x.tnMedida===medida);
    if(p) p.qty += cantidad;
    else {
      p = createPiece(newPieceId('tn' + medida.replace(',', '_') + '_'), 'Tira ' + medida + ' mm', d.poly, { holes: d.holes, engraveLoops: d.grabado, isTecoflex: true, tnMedida: medida, abierta: d.abierta });
      p.qty = cantidad;
      pieces.push(p);
    }
    tnMatPedido = mat.id;
    tnLimpiarResultado();            // el pedido cambió: el dibujo anterior ya no vale
    renderPieceTable();
    const bb = p.bbox, avisos = [];
    if(Math.abs(bb.w - tnNum(medida)) > 0.6) avisos.push(`el archivo trae una tira de ${tnFormatoMm(bb.w)} mm de ancho, no de ${medida}`);
    if(Math.abs(bb.h - tnCfg().largo) > 1) avisos.push(`el archivo mide ${tnFormatoMm(bb.h)} mm de largo, no ${tnCfg().largo}`);
    const est = tnTextoEstimado().texto;
    if(avisos.length) tnAviso('⚠ ' + d.archivo + ': ' + avisos.join('; ') + '. Revisá el archivo. ' + est, 'aviso');
    else tnAviso(`✔ ${cantidad} × ${medida} mm agregadas. ` + est, 'ok');
    tnEl('tnMedida').value = ''; tnEl('tnCantidad').value = ''; tnActualizarArchivo();
    tnEl('tnMedida').focus();
  } catch(e){
    tnAviso(e.message, 'error');
  } finally { btn.disabled = false; }
}
function tnAlCambiarMaterial(){
  const nuevo = tnEl('tnMaterial').value;
  if(tnMatPedido && nuevo !== tnMatPedido && pieces.some(p=>p.isTecoflex)){
    if(!confirm('Cada material tiene otro ancho de plancha: al cambiar de material se vacía el pedido actual. ¿Seguir?')){ tnEl('tnMaterial').value = tnMatPedido; return; }
    pieces = pieces.filter(p=>!p.isTecoflex);
    tnMatPedido = null; tnDxfs.clear();
    tnLimpiarResultado(); renderPieceTable(); tnAviso('');
  }
  tnAplicarPlancha();
  tnActualizarEstimado();
}

/* ---------------- el cálculo ---------------- */
/* Reparte las tiras en planchas. tiras: [{p, w, h}]. Devuelve las planchas (cada una
   con sus tiras, de la más ancha a la más angosta) y las que no caben. */
function tnEmpacar(tiras, sheetW, chapaLen, kerf){
  const entran = [], sinUbicar = [];
  tiras.forEach(t=>{ (t.w <= sheetW + 1e-6 && t.h <= chapaLen + 1e-6 ? entran : sinUbicar).push(t); });
  entran.sort((a, b)=>b.w - a.w);          // las más anchas primero
  const cabe = (pl, t) => pl.usado + (pl.tiras.length ? kerf : 0) + t.w <= sheetW + 1e-6;
  const poner = (pl, t) => { pl.usado += (pl.tiras.length ? kerf : 0) + t.w; pl.tiras.push(t); };
  // 1) primero que entra
  const ffd = [];
  entran.forEach(t=>{ let pl = ffd.find(x=>cabe(x, t)); if(!pl){ pl = { usado: 0, tiras: [] }; ffd.push(pl); } poner(pl, t); });
  // 2) mejor ajuste: la plancha que queda más justa
  const bfd = [];
  entran.forEach(t=>{
    let mejor = null, resto = Infinity;
    for(const pl of bfd){ if(!cabe(pl, t)) continue; const r = sheetW - (pl.usado + kerf + t.w); if(r < resto){ resto = r; mejor = pl; } }
    if(!mejor){ mejor = { usado: 0, tiras: [] }; bfd.push(mejor); }
    poner(mejor, t);
  });
  return { planchas: bfd.length < ffd.length ? bfd : ffd, sinUbicar };
}
function tnTirasDelPedido(){
  const activas = pieces.filter(p=>p.isTecoflex && p.points && p.qty > 0), tiras = [];
  activas.forEach(p=>{ for(let i=0; i<p.qty; i++) tiras.push({ p, w: p.bbox.w, h: p.bbox.h }); });
  return { activas, tiras };
}
/* "Pedido: 3 medidas, 135 tiras → 2 planchas de 1500 × 3000 mm." (se rehace al agregar,
   quitar o cambiar una cantidad); '' si el pedido está vacío */
function tnTextoEstimado(){
  const { activas, tiras } = tnTirasDelPedido();
  if(!tiras.length || tiras.length > TN_MAX_TIRAS) return { texto: '', sinUbicar: 0 };
  const sheetW = tnNum(tnEl('sheetW').value), chapaLen = tnNum(tnEl('chapaLen').value), kerf = Math.max(0, tnNum(tnEl('kerf').value) || 0);
  const r = tnEmpacar(tiras, sheetW, chapaLen, kerf), n = r.planchas.length;
  const base = `Pedido: ${activas.length} medida${activas.length===1 ? '' : 's'}, ${tiras.length} tira${tiras.length===1 ? '' : 's'}`;
  return { sinUbicar: r.sinUbicar.length, texto: n ? `${base} → ${n} plancha${n===1 ? '' : 's'} de ${sheetW} × ${chapaLen} mm.` + (r.sinUbicar.length ? ` ⚠ ${r.sinUbicar.length} no caben en la plancha.` : '')
                                      : `${base}. ⚠ Ninguna cabe en la plancha de ${sheetW} × ${chapaLen} mm.` };
}
function tnActualizarEstimado(){
  const el = tnEl('tnMsg');
  if(!tnEsTecoflex() || el.classList.contains('msg-error') || el.classList.contains('tnAvisoTxt')) return; // un error o aviso no se pisa
  const e = tnTextoEstimado();
  if(e.texto) tnAviso(e.texto, e.sinUbicar ? 'aviso' : 'ok');
}

/* Botón "Ejecutar nesting" (lo llama runNest, ver engine.js) */
function tnEjecutar(){
  const sheetW = tnNum(tnEl('sheetW').value), chapaLen = tnNum(tnEl('chapaLen').value), kerf = Math.max(0, tnNum(tnEl('kerf').value) || 0);
  const { activas, tiras } = tnTirasDelPedido();
  if(!tiras.length){ alert('Agregá al pedido al menos una medida con su cantidad.'); return; }
  if(tiras.length > TN_MAX_TIRAS){ alert(`El pedido tiene ${tiras.length} tiras: el máximo es ${TN_MAX_TIRAS}.`); return; }
  const t0 = performance.now();
  const { planchas, sinUbicar } = tnEmpacar(tiras, sheetW, chapaLen, kerf);
  // el dibujo de cada pieza (mismo arreglo para todas las tiras de una medida)
  const forma = new Map();
  activas.forEach(p=>forma.set(p.id, { rp: p.points, holes: p.holes || null, engrave: p.engraveLoops || null }));
  const chapas = planchas.map(pl=>{
    let x = 0;
    const placed = pl.tiras.map(t=>{
      const f = forma.get(t.p.id), rec = { pieceId: t.p.id, name: t.p.name, color: t.p.color, area: t.p.area, x, y: 0, rot: 0, mirror: false, rp: f.rp, engrave: f.engrave, holes: f.holes, abierta: !!t.p.abierta };
      x += t.w + kerf;
      return rec;
    });
    return { placed };
  });
  lastResult = { sheetW, chapaLen, cell: 1, kerf, chapas, jobCount: tiras.length, unplaced: sinUbicar, step: 0, allowMirror: false, deep: false };
  nestingState.previewingId = null;
  if(typeof hidePreviewBanner==='function') hidePreviewBanner();
  nestingState.liveSheetW = sheetW; nestingState.liveChapaLen = chapaLen; nestingState.liveChapas = chapas;
  renderChapas(sheetW, chapaLen, chapas);
  updateStats(sheetW, chapaLen, chapas, tiras.length, sinUbicar.length, performance.now() - t0);
  const grupos = groupChapas(chapas, buildIdMap()).length;
  tnAviso(`${chapas.length} plancha${chapas.length===1 ? '' : 's'} de ${sheetW} × ${chapaLen} mm para ${tiras.length - sinUbicar.length} tiras` +
    (grupos < chapas.length ? ` (${grupos} diseño${grupos===1 ? '' : 's'} de corte distinto${grupos===1 ? '' : 's'}).` : '.') +
    (sinUbicar.length ? ` ⚠ ${sinUbicar.length} tira${sinUbicar.length===1 ? '' : 's'} no cabe${sinUbicar.length===1 ? '' : 'n'} en la plancha (más anchas que ${sheetW} mm o más largas que ${chapaLen} mm).` : ''),
    sinUbicar.length ? 'aviso' : 'ok');
}

/* ---------------- entrar y salir de Tecoflex ----------------
   Las piezas, el resultado y los tamaños de plancha son globales de la pestaña
   Nesting: al cambiar de área se guardan los de la que se deja y se pone lo que
   tenía la otra, así el pedido de Tecoflex nunca se mezcla con el papel. */
function tnAlCambiarArea(area){
  const sale = tnAreaPrev, entra = area.id;
  tnAreaPrev = entra;
  if(sale === entra) return;
  const conNesting = id => id==='papel' || id===TN_AREA;
  if(conNesting(sale)) tnVistas[sale] = { pieces, lastResult, sheetW: tnEl('sheetW').value, chapaLen: tnEl('chapaLen').value, fillStrips: tnEl('fillStrips').checked, kerf: tnEl('kerf').value, matPedido: tnMatPedido, material: tnEl('tnMaterial').value };
  if(!conNesting(entra)) return;
  const v = tnVistas[entra] || (entra===TN_AREA ? null : { pieces: [], lastResult: null, ...tnInicial });
  pieces = v ? v.pieces : [];
  lastResult = v ? v.lastResult : null;
  tnMatPedido = v ? v.matPedido || null : null;
  if(entra === TN_AREA){
    if(v && v.material) tnEl('tnMaterial').value = v.material;
    tnEl('kerf').value = v ? v.kerf : TN_KERF;
    tnConfigurarCampos(true); tnAplicarPlancha();
  } else {
    tnConfigurarCampos(false);
    tnEl('sheetW').value = v.sheetW; tnEl('chapaLen').value = v.chapaLen; tnEl('fillStrips').checked = v.fillStrips; tnEl('kerf').value = v.kerf;
  }
  renderPieceTable();
  if(lastResult && lastResult.chapas.length){
    renderChapas(lastResult.sheetW, lastResult.chapaLen, lastResult.chapas);
    updateStats(lastResult.sheetW, lastResult.chapaLen, lastResult.chapas, lastResult.jobCount, lastResult.unplaced.length, 0);
  } else tnLimpiarResultado();
  tnAviso(''); tnActualizarEstimado();
}

/* ---------------- eventos ---------------- */
tnLlenarMateriales();
tnEl('tnMaterial').addEventListener('change', tnAlCambiarMaterial);
tnEl('tnMedida').addEventListener('input', tnActualizarArchivo);
tnEl('tnMedida').addEventListener('keydown', ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); tnEl('tnCantidad').focus(); } });
tnEl('tnCantidad').addEventListener('keydown', ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); tnAgregar(); } });
tnEl('tnAgregar').addEventListener('click', tnAgregar);
tnEl('kerf').addEventListener('input', ()=>{ if(tnEsTecoflex()) tnActualizarEstimado(); });
// la tabla de piezas de siempre muestra las medidas del pedido (cantidad editable, ✕ para quitar):
// cada vez que se redibuja o se cambia una cantidad, el estimado se rehace
{
  const dibujar = renderPieceTable;
  renderPieceTable = function(){ dibujar.apply(this, arguments); if(tnEsTecoflex()) tnActualizarEstimado(); };
  tnEl('pieceBody').addEventListener('input', ()=>{ if(tnEsTecoflex()){ tnLimpiarResultado(); tnEl('tnMsg').classList.remove('tnAvisoTxt', 'msg-error'); tnActualizarEstimado(); } });
}
alCambiarArea(tnAlCambiarArea);
if(areaActualId === TN_AREA){ tnEl('kerf').value = TN_KERF; tnConfigurarCampos(true); tnAplicarPlancha(); } // la página se abrió estando en Tecoflex
