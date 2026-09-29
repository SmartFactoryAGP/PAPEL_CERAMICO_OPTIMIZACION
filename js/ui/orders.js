/* =========================================================
   LISTA DE CORTE — trae órdenes pendientes de tu SQL Server real (vía
   el puente de /server), las nestea como un lote, y al confirmar las
   manda al Rack con una ubicación asignada. Nunca escribe/mueve nada
   en el mismo paso que nestea — primero mostrás el resultado, después
   confirmás. La lista SOLO se actualiza cuando tocás "Actualizar" —
   nunca sola, ni al cambiar ninguna casilla.

   Producción: la app habla siempre con SQL real, no hay selector de
   "origen de datos" a propósito (para que nadie lo cambie sin querer).
   ========================================================= */
let ordenesPendientes = [];   // TODAS las pendientes que trajo el puente (incluye las que ya están en el lote)
let ordLote = [];             // [{orden, pieceId}] del último "Ejecutar" corrido

/* "Lote actual": las órdenes que fuiste juntando a mano con el botón
   "+ Lote" (o "Agregar visibles al lote"), para nestear juntas. Mientras
   una orden está acá, desaparece de la tabla de "Lista de corte" de
   arriba — así no la agregás dos veces por error. Si sacás una con
   "Quitar" (por ejemplo porque no entró en la chapa), vuelve sola a la
   lista de arriba para poder armar el lote de nuevo con otra. */
let ordEnLoteIds = new Set();      // Set de Ordem_Serial (como string) en el lote actual
let ordLoteEstado = new Map();     // Ordem_Serial(string) -> 'colocada' | 'sinubicar', solo después de "Ejecutar"
let ordSort = { campo: null, dir: -1 }; // dir -1 = de mayor a menor, 1 = de menor a mayor

/* Columnas que se muestran en Lista de corte y en el Lote actual.
   Centro_Trabalho queda afuera a propósito (pedido explícito) — sigue
   funcionando para buscar/filtrar, solo no se dibuja como columna. */
const ORD_COLUMNAS = [
  {campo:'Ordem_Serial', etiqueta:'Ordem_Serial'},
  {campo:'Operation', etiqueta:'Operation'},
  {campo:'Puestodetrabajo', etiqueta:'Puestodetrabajo'},
  {campo:'ClaveModelo', etiqueta:'ClaveModelo'},
  {campo:'CodMat', etiqueta:'CodMat'},
  {campo:'Name', etiqueta:'Name'},
  {campo:'ZTipo', etiqueta:'ZTipo'},
  {campo:'Descricao', etiqueta:'Descricao'},
  {campo:'ARCHIVO', etiqueta:'Archivo'},
];

/* El Rack puede simularse (mientras no haya permiso para crear la
   tabla de control) — ver la casilla "Simular el Rack". Cuando está
   simulado, el Rack vive en un archivo chico DEL PUENTE (tu PC, la que
   corre "iniciar"), NO en el navegador de cada computadora — así todas
   las PC que usan el mismo puente ven exactamente el mismo Rack, sin
   importar desde cuál se confirmó o se sacó cada orden. Nunca toca SQL
   para nada. Estas funciones son simples: siempre le preguntan al
   puente, nunca guardan nada localmente en este navegador. */
async function rackSimuladoTraer(){
  const res = await fetch(ordBridgeUrl()+'/api/rack-simulado', {headers: ordApiHeaders()});
  if(!res.ok) throw new Error('HTTP '+res.status);
  return res.json();
}
async function rackSimuladoAgregar(orden){
  const res = await fetch(ordBridgeUrl()+'/api/rack-simulado/agregar', {
    method:'POST', headers: ordApiHeaders({'Content-Type':'application/json'}),
    body: JSON.stringify(orden)
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || ('HTTP '+res.status));
  return data; // { ok:true, ubicacion }
}
async function rackSimuladoSalida(ordenSerial){
  const res = await fetch(ordBridgeUrl()+'/api/rack-simulado/'+encodeURIComponent(ordenSerial)+'/salida', {
    method:'POST', headers: ordApiHeaders()
  });
  if(!res.ok) throw new Error('HTTP '+res.status);
  return res.json();
}

function ordBridgeUrl(){ return document.getElementById('ordBridgeUrl').value.replace(/\/$/, ''); }
/* Si la propia página se está sirviendo desde el puente (entraste con
   la dirección http://IP:4000 en vez de abrir el archivo suelto),
   el campo de "Dirección del puente" se autocompleta solo con esa
   misma dirección — nadie tiene que escribir ni pegar nada. Si en
   cambio se abrió como archivo (file://) o desde una carpeta
   compartida, queda el default de siempre (localhost:4000) para
   completar a mano. */
(function autocompletarDireccionDelPuente(){
  if(location.protocol==='http:' || location.protocol==='https:'){
    const campo = document.getElementById('ordBridgeUrl');
    if(campo) campo.value = location.origin;
  }
})();
/* El Rack puede simularse independientemente de todo lo demás — es lo
   que decide si "confirmar"/"sacar del rack" escriben en SQL o se
   manejan en el archivo compartido del puente. */
function ordRackEsSimulado(){ return document.getElementById('ordSimRack').checked; }
/* Si cargaste una clave (porque el puente tiene API_TOKEN configurado), se manda en todos los pedidos. */
function ordApiHeaders(extra){
  const token = document.getElementById('ordApiToken').value.trim();
  const conApiToken = Object.assign({}, extra||{}, token ? {'x-api-token': token} : {});
  // suma también el token de sesión (login), si hay uno — así los
  // pedidos a Lista de corte quedan identificados con qué usuario los
  // hizo, sin que cada función tenga que acordarse de juntar los dos.
  return (typeof authHeaders==='function') ? authHeaders(conApiToken) : conApiToken;
}

async function ordRefrescar(){
  const status = document.getElementById('ordBridgeStatus');
  document.getElementById('ordRunBtn').disabled = true;
  document.getElementById('ordConfirmBtn').disabled = true;

  status.textContent = 'Consultando...';
  try {
    const res = await fetch(ordBridgeUrl()+'/api/ordenes-pendientes', {headers: ordApiHeaders()});
    if(!res.ok) throw new Error('HTTP '+res.status);
    let pendientes = await res.json();
    let nota = '';
    if(ordRackEsSimulado()){
      // el Rack se está simulando (archivo compartido del puente) — lo
      // que ya se confirmó ahí no tiene por qué desaparecer de tu SQL
      // real (esa tabla no se tocó), así que se saca de la vista acá
      // nomás, comparando contra lo que ya está en el Rack simulado.
      const rackActual = await rackSimuladoTraer().catch(()=>[]);
      const yaEnRack = new Set(rackActual.map(o=>o.Ordem_Serial));
      const antes = pendientes.length;
      pendientes = pendientes.filter(o=>!yaEnRack.has(o.Ordem_Serial));
      if(antes>pendientes.length) nota = ` (${antes-pendientes.length} ya confirmada(s) en el Rack simulado, ocultas acá)`;
    }
    ordenesPendientes = pendientes;

    // si alguna orden que tenías en el "lote actual" ya no está pendiente
    // (por ejemplo, otro programador ya la cortó y confirmó), se saca
    // sola del lote acá — no tiene sentido dejarla ahí esperando.
    const idsPendientes = new Set(ordenesPendientes.map(o=>String(o.Ordem_Serial)));
    let sacadasDelLote = 0;
    [...ordEnLoteIds].forEach(id=>{
      if(!idsPendientes.has(id)){ ordEnLoteIds.delete(id); ordLoteEstado.delete(id); sacadasDelLote++; }
    });
    if(sacadasDelLote) nota += ` (${sacadasDelLote} se sacaron solas del lote: ya no estaban pendientes)`;

    status.textContent = `Conectado — ${ordenesPendientes.length} pendiente(s)${nota}`;
  } catch(e){
    status.textContent = 'No se pudo conectar al puente (¿está corriendo el servidor en tu PC?): '+e.message;
    ordenesPendientes = [];
  }
  ordRenderTabla();
  ordRenderLote();
  ordActualizarBotonEjecutar();
  await ordActualizarResumenDia();
}

async function ordActualizarResumenDia(){
  const box = document.getElementById('ordResumenDia');
  try {
    const res = await fetch(ordBridgeUrl()+'/api/rack-resumen-dia', {headers: ordApiHeaders()});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const r = await res.json();
    box.textContent = `Cortadas hoy: ${r.cortadasHoy} · Sacadas hoy: ${r.sacadasHoy} · En rack ahora: ${r.enRackAhora}`;
  } catch(e){
    box.textContent = 'No se pudo traer el resumen: '+e.message;
  }
}

function ordFiltroTexto(){
  return (document.getElementById('ordBuscarInput').value||'').trim().toLowerCase();
}
function ordCoincideFiltro(o, filtro){
  if(!filtro) return true;
  // Centro_Trabalho sigue entrando en la búsqueda aunque no se vea como
  // columna — solo se ocultó de la tabla, no del filtro.
  const campos = [o.Ordem_Serial, o.Operation, o.Centro_Trabalho, o.Puestodetrabajo, o.ClaveModelo, o.CodMat, o.Name, o.ZTipo, o.Descricao, o.ARCHIVO];
  return campos.some(v => String(v||'').toLowerCase().includes(filtro));
}

/* Ordena de forma "inteligente": si los dos valores de la columna se
   pueden leer como número (ej. Ordem_Serial), compara numéricamente;
   si no, alfabéticamente (sin importar mayúsculas/tildes). */
function ordCompararValores(a, b){
  const sa = String(a==null?'':a).trim(), sb = String(b==null?'':b).trim();
  const na = parseFloat(sa), nb = parseFloat(sb);
  if(sa!=='' && sb!=='' && !isNaN(na) && !isNaN(nb)) return na - nb;
  return sa.localeCompare(sb, 'es', {sensitivity:'base', numeric:true});
}
function ordOrdenarLista(lista, campo, dir){
  if(!campo) return lista;
  return lista.slice().sort((x,y)=> dir * ordCompararValores(x[campo], y[campo]));
}
function ordEncabezadoOrdenable(col){
  const activo = ordSort.campo===col.campo;
  const flecha = activo ? (ordSort.dir===-1 ? ' ▼' : ' ▲') : '';
  return `<th data-campo="${col.campo}" class="${activo?'ordSortActivo':''}" title="Tocá para ordenar">${col.etiqueta}${flecha}</th>`;
}

function ordRenderTabla(){
  const wrap = document.getElementById('ordTableWrap');
  if(!ordenesPendientes.length){
    document.getElementById('ordCount').textContent = '0';
    wrap.innerHTML = '<div class="empty">No hay órdenes pendientes.</div>';
    return;
  }
  const filtro = ordFiltroTexto();
  // las que ya están en el "lote actual" no se muestran acá — están
  // abajo, en la tabla del lote.
  const disponibles = ordenesPendientes.filter(o=>!ordEnLoteIds.has(String(o.Ordem_Serial)));
  const filtradas = disponibles.filter(o=>ordCoincideFiltro(o, filtro));
  const ordenadas = ordOrdenarLista(filtradas, ordSort.campo, ordSort.dir);

  const enLote = ordEnLoteIds.size;
  document.getElementById('ordCount').textContent = (filtro
    ? `${ordenadas.length} de ${disponibles.length}`
    : String(disponibles.length)) + (enLote ? ` (+${enLote} en el lote)` : '');

  if(!ordenadas.length){
    wrap.innerHTML = disponibles.length
      ? '<div class="empty">Ninguna orden coincide con la búsqueda.</div>'
      : '<div class="empty">Todas las órdenes pendientes ya están en el lote actual.</div>';
    return;
  }
  const headerHtml = ORD_COLUMNAS.map(ordEncabezadoOrdenable).join('');
  const rows = ordenadas.map(o=>`
    <tr>
      <td>${o.Ordem_Serial}</td>
      <td>${o.Operation||'—'}</td>
      <td>${o.Puestodetrabajo||'—'}</td>
      <td>${o.ClaveModelo||'—'}</td>
      <td>${o.CodMat||'—'}</td>
      <td>${o.Name||'—'}</td>
      <td>${o.ZTipo||'—'}</td>
      <td>${o.Descricao||'—'}</td>
      <td>${o.ARCHIVO||'—'}</td>
      <td><button class="secondary ordAddBtn" data-orden="${o.Ordem_Serial}" style="padding:4px 9px;font-size:11px;white-space:nowrap">+ Lote</button></td>
    </tr>`).join('');
  wrap.innerHTML = `<table class="ordTable">
    <thead><tr>${headerHtml}<th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}
document.getElementById('ordBuscarInput').addEventListener('input', ordRenderTabla);

/* Arma la tabla del "Lote actual" (las que agregaste con "+ Lote"). Si
   ya se corrió "Ejecutar", muestra si cada una quedó ubicada o no. */
function ordRenderLote(){
  const wrap = document.getElementById('ordLoteWrap');
  if(!ordEnLoteIds.size){
    wrap.innerHTML = '<div class="empty">Todavía no agregaste ninguna orden al lote.</div>';
    return;
  }
  const filas = [...ordEnLoteIds]
    .map(id=>ordenesPendientes.find(o=>String(o.Ordem_Serial)===id))
    .filter(Boolean);
  const headerHtml = ORD_COLUMNAS.map(c=>`<th>${c.etiqueta}</th>`).join('');
  const rows = filas.map(o=>{
    const estado = ordLoteEstado.get(String(o.Ordem_Serial));
    const marca = estado==='colocada'
      ? '<span style="color:var(--good,#4ade80);font-weight:700">✓ ubicada</span>'
      : estado==='sinubicar'
        ? '<span style="color:var(--warn,#f87171);font-weight:700">⚠ sin ubicar</span>'
        : '<span style="color:var(--muted)">sin nestear todavía</span>';
    return `<tr>
      <td>${o.Ordem_Serial}</td>
      <td>${o.Operation||'—'}</td>
      <td>${o.Puestodetrabajo||'—'}</td>
      <td>${o.ClaveModelo||'—'}</td>
      <td>${o.CodMat||'—'}</td>
      <td>${o.Name||'—'}</td>
      <td>${o.ZTipo||'—'}</td>
      <td>${o.Descricao||'—'}</td>
      <td>${o.ARCHIVO||'—'}</td>
      <td>${marca}</td>
      <td><button class="secondary ordQuitarBtn" data-orden="${o.Ordem_Serial}" style="padding:4px 9px;font-size:11px;white-space:nowrap">✕ Quitar</button></td>
    </tr>`;
  }).join('');
  wrap.innerHTML = `<table class="ordTable">
    <thead><tr>${headerHtml}<th>Estado</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function ordActualizarBotonEjecutar(){
  document.getElementById('ordRunBtn').disabled = ordEnLoteIds.size===0;
  document.getElementById('ordLoteCount').textContent = String(ordEnLoteIds.size);
}

/* Agrega/saca una orden del "lote actual". Agregarla la hace desaparecer
   de la tabla de arriba (Lista de corte); sacarla la hace reaparecer
   sola ahí — no hace falta "Actualizar" para verla de nuevo. */
function ordAgregarALote(ordenSerial){
  ordEnLoteIds.add(String(ordenSerial));
  ordRenderTabla();
  ordRenderLote();
  ordActualizarBotonEjecutar();
}
function ordQuitarDelLote(ordenSerial){
  ordEnLoteIds.delete(String(ordenSerial));
  ordLoteEstado.delete(String(ordenSerial));
  ordRenderTabla();
  ordRenderLote();
  ordActualizarBotonEjecutar();
}

// un solo listener por delegación (cubre las dos tablas, que se
// rearman enteras en cada render): ordenar por columna, agregar al
// lote, o sacar del lote.
document.getElementById('ordStagePanel').addEventListener('click', (ev)=>{
  const th = ev.target.closest('th[data-campo]');
  if(th){
    const campo = th.getAttribute('data-campo');
    if(ordSort.campo===campo) ordSort.dir = -ordSort.dir;
    else { ordSort.campo = campo; ordSort.dir = -1; } // columna nueva: arranca de mayor a menor
    ordRenderTabla();
    return;
  }
  const addBtn = ev.target.closest('.ordAddBtn');
  if(addBtn){ ordAgregarALote(addBtn.getAttribute('data-orden')); return; }
  const quitBtn = ev.target.closest('.ordQuitarBtn');
  if(quitBtn){ ordQuitarDelLote(quitBtn.getAttribute('data-orden')); return; }
});

document.getElementById('ordAddAllVisibleBtn').addEventListener('click', ()=>{
  const filtro = ordFiltroTexto();
  const visibles = ordenesPendientes.filter(o=>!ordEnLoteIds.has(String(o.Ordem_Serial)) && ordCoincideFiltro(o, filtro));
  if(!visibles.length){ alert('No hay ninguna orden visible para agregar (probá cambiar o borrar el filtro).'); return; }
  visibles.forEach(o=>ordEnLoteIds.add(String(o.Ordem_Serial)));
  ordRenderTabla();
  ordRenderLote();
  ordActualizarBotonEjecutar();
});

/* Ingreso rápido al lote: escribís (o escaneás con la pistola) UN número
   de orden y tocás Enter — se agrega sola al lote, el cuadro se vacía
   solo y queda listo para la siguiente, así el operario va poniendo
   orden, Enter, orden, Enter, sin tocar el mouse en ningún momento
   (mismo patrón que el buscador de código de barras del Rack). Si por
   las dudas se escriben o pegan varios números juntos antes de tocar
   Enter (separados por espacio, coma, etc.), también los agrega todos
   de una — no hace falta que sea siempre uno solo.

   Primero busca cada número en ordenesPendientes (lo que ya trajo
   "Actualizar lista de pendientes"). Si no aparece ahí, en vez de
   descartarla de una, la busca DIRECTO en el puente
   (/api/ordenes-pendientes/:orden) — esa búsqueda puntual no aplica el
   filtro de Puestodetrabajo (una orden con Puestodetrabajo en blanco,
   o cualquier otro valor, igual se puede agregar a mano si conocés el
   número), y sigue exigiendo Operation='0132' para no traer una orden
   de otra operación. Si la encuentra así, la suma también a
   ordenesPendientes (con su archivo/ruta real) para que el resto de la
   app la trate exactamente igual que cualquier otra. Solo si tampoco
   aparece ahí queda como "no encontrada" de verdad. */
function ordParsearListaOrdenes(texto){
  return (texto||'')
    .split(/[\s,;]+/)
    .map(t=>t.trim())
    .filter(t=>t.length>0);
}
/* Busca una orden puntual en el puente cuando no está en la lista ya
   cargada. Devuelve el objeto de la orden si la encuentra (y la deja
   agregada a ordenesPendientes de paso), o null si no existe con
   Operation='0132' o si el puente no responde. */
async function ordBuscarOrdenSuelta(serial){
  try {
    const res = await fetch(ordBridgeUrl()+'/api/ordenes-pendientes/'+encodeURIComponent(serial), {headers: ordApiHeaders()});
    const data = await res.json().catch(()=>({}));
    if(!res.ok || !data.encontrada || !data.orden) return null;
    // por si dos búsquedas sueltas se pisan, no la agrega dos veces
    if(!ordenesPendientes.some(o=>String(o.Ordem_Serial)===String(data.orden.Ordem_Serial))){
      ordenesPendientes.push(data.orden);
    }
    return data.orden;
  } catch(e){
    return null;
  }
}
async function ordIngresoRapidoAlLote(){
  const input = document.getElementById('ordIngresoRapidoInput');
  const resultado = document.getElementById('ordIngresoRapidoResultado');
  const tokens = [...new Set(ordParsearListaOrdenes(input.value))];
  input.value = '';
  input.focus();
  if(!tokens.length) return;

  resultado.textContent = tokens.length===1 ? `Buscando la orden ${tokens[0]}...` : 'Buscando...';

  let agregadas = 0, yaEstaban = 0;
  const noEncontradas = [];
  for(const tok of tokens){
    let orden = ordenesPendientes.find(o=>String(o.Ordem_Serial)===tok);
    if(!orden) orden = await ordBuscarOrdenSuelta(tok); // no está en la lista ya cargada: buscala puntual
    if(!orden){ noEncontradas.push(tok); continue; }
    const serial = String(orden.Ordem_Serial);
    if(ordEnLoteIds.has(serial)){ yaEstaban++; continue; }
    ordEnLoteIds.add(serial);
    agregadas++;
  }
  ordRenderTabla();
  ordRenderLote();
  ordActualizarBotonEjecutar();

  if(tokens.length===1 && !noEncontradas.length && !yaEstaban){
    resultado.innerHTML = `✓ orden <b>${tokens[0]}</b> agregada al lote`;
    resultado.style.color = 'var(--good, #4ade80)';
    return;
  }
  if(tokens.length===1 && noEncontradas.length){
    resultado.innerHTML = `⚠ orden <b>${tokens[0]}</b> no existe con Operation 0132 (revisá el número)`;
    resultado.style.color = 'var(--warn, #f87171)';
    return;
  }
  if(tokens.length===1 && yaEstaban){
    resultado.innerHTML = `La orden <b>${tokens[0]}</b> ya estaba en el lote`;
    resultado.style.color = 'var(--muted)';
    return;
  }
  // se escribieron/pegaron varias juntas: mismo resumen que antes
  const partes = [];
  partes.push(`${agregadas} agregada${agregadas===1?'':'s'} al lote`);
  if(yaEstaban) partes.push(`${yaEstaban} ya estaba${yaEstaban===1?'':'n'} en el lote`);
  if(noEncontradas.length) partes.push(`${noEncontradas.length} no se encontró${noEncontradas.length===1?'':'aron'}: ${noEncontradas.join(', ')}`);
  resultado.innerHTML = partes.join(' — ');
  resultado.style.color = noEncontradas.length ? 'var(--warn, #f87171)' : 'var(--good, #4ade80)';
}
document.getElementById('ordIngresoRapidoInput').addEventListener('keydown', ev=>{
  if(ev.key==='Enter'){ ev.preventDefault(); ordIngresoRapidoAlLote(); }
});

/* Agregar por Código_Lote: trae TODAS las órdenes 0132 de un lote de
   vidrios (DF_SAGA_LotesVidro) de una sola vez, en vez de escribirlas
   a mano una por una. Mismo patrón que ordBuscarOrdenSuelta/
   ordIngresoRapidoAlLote de arriba: no filtra por Puestodetrabajo
   (llega igual, solo para mostrarlo), y a cada orden que ya esté en
   ordenesPendientes (por ejemplo porque también salió en la lista
   normal) NO se la vuelve a empujar ahí — se reusa la que ya había.
   El dedupe de "no repetir si ya está en el lote" lo da gratis
   ordEnLoteIds (es un Set), así que una orden que aparece en dos
   códigos de lote distintos (o en un lote y también sola, por
   ingreso rápido) solo queda agregada una vez. */
async function ordBuscarOrdenesDeLote(codigo){
  try {
    const res = await fetch(ordBridgeUrl()+'/api/lote/'+encodeURIComponent(codigo), {headers: ordApiHeaders()});
    const data = await res.json().catch(()=>null);
    if(!res.ok) return { error: (data && data.error) || ('HTTP '+res.status) };
    return { ordenes: Array.isArray(data) ? data : [] };
  } catch(e){
    return { error: 'no se pudo consultar el puente' };
  }
}
async function ordAgregarPorCodigoLote(){
  const input = document.getElementById('ordCodigoLoteInput');
  const resultado = document.getElementById('ordCodigoLoteResultado');
  const codigo = input.value.trim();
  input.value = '';
  input.focus();
  if(!codigo) return;

  resultado.textContent = `Buscando el lote ${codigo}...`;
  const { ordenes, error } = await ordBuscarOrdenesDeLote(codigo);
  if(error){
    resultado.innerHTML = `⚠ no se pudo traer el lote <b>${codigo}</b>: ${error}`;
    resultado.style.color = 'var(--warn, #f87171)';
    return;
  }
  if(!ordenes.length){
    resultado.innerHTML = `El lote <b>${codigo}</b> no tiene ninguna orden con Operation 0132 (revisá el código)`;
    resultado.style.color = 'var(--warn, #f87171)';
    return;
  }

  let agregadas = 0, yaEstaban = 0;
  ordenes.forEach(orden=>{
    const serial = String(orden.Ordem_Serial);
    // si ya la teníamos (de la lista normal, de otro lote, o de ingreso
    // rápido), reusamos esa fila en vez de duplicarla en ordenesPendientes
    if(!ordenesPendientes.some(o=>String(o.Ordem_Serial)===serial)){
      ordenesPendientes.push(orden);
    }
    if(ordEnLoteIds.has(serial)){ yaEstaban++; return; }
    ordEnLoteIds.add(serial);
    agregadas++;
  });
  ordRenderTabla();
  ordRenderLote();
  ordActualizarBotonEjecutar();

  const partes = [`lote ${codigo}: ${ordenes.length} orden(es) encontrada(s)`];
  partes.push(`${agregadas} agregada${agregadas===1?'':'s'} al lote actual`);
  if(yaEstaban) partes.push(`${yaEstaban} ya estaba${yaEstaban===1?'':'n'} en el lote`);
  resultado.textContent = partes.join(' — ');
  resultado.style.color = agregadas ? 'var(--good, #4ade80)' : 'var(--muted)';
}
document.getElementById('ordCodigoLoteInput').addEventListener('keydown', ev=>{
  if(ev.key==='Enter'){ ev.preventDefault(); ordAgregarPorCodigoLote(); }
});

document.getElementById('ordRefreshBtn').addEventListener('click', ordRefrescar);

/* Trae los DXF de las órdenes seleccionadas (del mock embebido si estás
   en modo simulado, o del puente real si no), las arma como piezas
   (reutilizando el mismo lector de capas/agujeros de siempre) y corre
   el nesting — todavía no mueve nada al rack. */
async function ordEjecutarLote(){
  const seleccion = [...ordEnLoteIds]
    .map(id=>ordenesPendientes.find(o=>String(o.Ordem_Serial)===id))
    .filter(Boolean);
  if(!seleccion.length){ alert('Agregá al menos una orden al lote actual (botón "+ Lote") antes de ejecutar.'); return; }

  const status = document.getElementById('ordRunStatus');
  const runBtn = document.getElementById('ordRunBtn');
  const confirmBtn = document.getElementById('ordConfirmBtn');
  runBtn.disabled = true; confirmBtn.disabled = true;
  const url = ordBridgeUrl();

  pieces = pieces.filter(p=>!p.isOrdenLote);
  ordLote = [];
  ordLoteEstado.clear();

  for(const orden of seleccion){
    status.textContent = `Descargando DXF de la orden ${orden.Ordem_Serial}...`;
    try {
      let contenido;
      // se manda orden Y archivo juntos — el puente usa el que le
      // corresponda según tenga el DXF en SQL o en una carpeta (ver
      // DXF_SOURCE en su .env), sin que el navegador necesite saberlo.
      const qs = 'orden='+encodeURIComponent(orden.Ordem_Serial)+'&archivo='+encodeURIComponent(orden.ARCHIVO||'');
      const res = await fetch(url+'/api/dxf?'+qs, {headers: ordApiHeaders()});
      if(!res.ok) throw new Error('HTTP '+res.status);
      const data = await res.json();
      contenido = data.contenido;
      const entities = parseDXFEntities(contenido);
      const layers = detectLayers(entities);
      const layerMap = {}; layers.forEach(l=>{ layerMap[l]=guessLayerOp(l); });
      const result = buildLayeredGeometry(entities, layerMap);
      if(!result){ status.textContent = `Orden ${orden.Ordem_Serial}: sin contorno cerrado, se saltea.`; continue; }
      const poly = result.mainPoly;
      const engraveLoops = result.engraveLoops && result.engraveLoops.length ? result.engraveLoops : null;
      const holes = result.holes && result.holes.length ? result.holes : null;
      const pieza = {
        id: 'ord'+orden.Ordem_Serial+'_'+Date.now()+Math.random().toString(16).slice(2,6),
        name: 'Orden '+orden.Ordem_Serial,
        points: poly, fast: simplify(poly, 0.8),
        engraveLoops, holes,
        bbox: polyBBox(poly), area: polyArea(poly), perimeter: polyPerimeter(poly),
        qty: 1, color: PALETTE[pieces.length % PALETTE.length], error: null,
        isOrdenLote: true
      };
      pieces.push(pieza);
      ordLote.push({orden, pieceId: pieza.id});
    } catch(e){
      status.textContent = `Orden ${orden.Ordem_Serial}: no se pudo traer el DXF (${e.message})`;
    }
  }

  if(!ordLote.length){ status.textContent = 'Ninguna orden se pudo cargar — revisá el puente/la carpeta compartida.'; runBtn.disabled=false; return; }

  renderPieceTable();
  document.getElementById('maxMinutes').value = document.getElementById('ordMaxMinutes').value;
  document.getElementById('deepSearch').checked = true;
  switchView('nesting');

  status.textContent = `Nesteando ${ordLote.length} orden(es)...`;
  try {
    await doNest();
  } catch(e){
    switchView('ordenes');
    status.textContent = 'Error durante el nesting: '+e.message;
    runBtn.disabled = false;
    return;
  }

  const colocadasIds = new Set();
  lastResult.chapas.forEach(c=>c.placed.forEach(p=>colocadasIds.add(p.pieceId)));
  const sinUbicarSet = new Set(
    ordLote.filter(x=>!colocadasIds.has(x.pieceId)).map(x=>String(x.orden.Ordem_Serial))
  );
  const sinUbicar = [...sinUbicarSet];

  // marca en el "Lote actual" cuál quedó ubicada y cuál no, para que se
  // vea de un vistazo al volver a Lista de corte, y para que sepas cuál
  // sacar con "Quitar" si tenés que probar con otra orden en su lugar.
  ordLote.forEach(({orden})=>{
    const idStr = String(orden.Ordem_Serial);
    ordLoteEstado.set(idStr, sinUbicarSet.has(idStr) ? 'sinubicar' : 'colocada');
  });
  ordRenderLote();

  // vuelve solo a "Lista de corte" al terminar — el botón "Confirmar" vive
  // acá, no en la pestaña Nesting, así no hace falta que lo busques a mano.
  switchView('ordenes');
  status.textContent = `Nesting listo: ${ordLote.length-sinUbicar.length} de ${ordLote.length} orden(es) ubicadas.` +
    (sinUbicar.length ? ` Sin ubicar: ${sinUbicar.join(', ')} — no se van a mandar al rack. Sacalas del lote (abajo, "Quitar") y agregá otra si querés reemplazarlas.` : '') +
    ' Podés revisar el resultado en la pestaña Nesting, y tocar "Confirmar y enviar al Rack" acá abajo cuando esté bien.';
  runBtn.disabled = false;
  confirmBtn.disabled = false;
}
document.getElementById('ordRunBtn').addEventListener('click', ordEjecutarLote);

/* Recién acá se mueve algo de verdad: genera el PDF del lote y manda al
   rack (con ubicación asignada) solo las órdenes que quedaron colocadas. */
/* Manda uno o varios stickers a la Zebra (ZPL directo), y si falla —
   no está configurada, está apagada, lo que sea — cae solo al PDF de
   respaldo. La usan tanto "Confirmar y enviar al Rack" (varios de una)
   como "Reimprimir sticker" en el Rack (uno solo). Devuelve un texto
   corto listo para mostrar en un status. */
async function ordImprimirStickersConFallback(ordenesConUbicacion){
  if(!ordenesConUbicacion.length) return '';
  try {
    await imprimirStickersZPL(ordenesConUbicacion);
    return ` Sticker(s) mandado(s) a la Zebra (${ordenesConUbicacion.length}).`;
  } catch(e){
    console.warn('[stickers-zpl]', e.message);
    try {
      generarStickersPDF(ordenesConUbicacion);
      return ' La Zebra no está configurada todavía (o falló) — se descargó el PDF de stickers como respaldo.';
    } catch(e2){
      console.error('[stickers-pdf]', e2);
      return ' No se pudieron generar los stickers.';
    }
  }
}

async function ordConfirmar(){
  if(!ordLote.length) return;
  const status = document.getElementById('ordRunStatus');
  const confirmBtn = document.getElementById('ordConfirmBtn');
  confirmBtn.disabled = true;
  const url = ordBridgeUrl();
  const sim = ordRackEsSimulado();

  const colocadasIds = new Set();
  lastResult.chapas.forEach(c=>c.placed.forEach(p=>colocadasIds.add(p.pieceId)));

  status.textContent = 'Generando el PDF del lote...';
  try { await exportPDF(); } catch(e){ status.textContent = 'No se pudo generar el PDF: '+e.message; }

  let marcadas=0; const fallidas=[]; const confirmadasIds=[]; const confirmadasConUbicacion=[];
  for(const {orden, pieceId} of ordLote){
    if(!colocadasIds.has(pieceId)) continue; // no se manda al rack lo que no se pudo cortar

    if(sim){
      try {
        // ARCHIVO va acá también (antes no se mandaba) — si no, el rack
        // simulado se queda sin el nombre del archivo, y una reimpresión
        // del sticker más adelante saldría con "—" en vez del nombre real.
        const { ubicacion } = await rackSimuladoAgregar({
          Ordem_Serial:orden.Ordem_Serial, Operation:orden.Operation, Centro_Trabalho:orden.Centro_Trabalho,
          Puestodetrabajo:orden.Puestodetrabajo, ClaveModelo:orden.ClaveModelo, CodMat:orden.CodMat,
          Name:orden.Name, ZTipo:orden.ZTipo, Descricao:orden.Descricao, ARCHIVO:orden.ARCHIVO
        });
        marcadas++;
        confirmadasIds.push(orden.Ordem_Serial);
        confirmadasConUbicacion.push({ orden, ubicacion });
      } catch(e){
        fallidas.push(orden.Ordem_Serial+' ('+e.message+')');
      }
      continue;
    }

    status.textContent = `Marcando la orden ${orden.Ordem_Serial}...`;
    try {
      const r = await fetch(url+'/api/ordenes/'+encodeURIComponent(orden.Ordem_Serial)+'/marcar-en-stock', {
        method:'POST', headers: ordApiHeaders({'Content-Type':'application/json'}),
        body: JSON.stringify({rack: orden.rack||null})
      });
      const data = await r.json().catch(()=>({}));
      if(r.ok){
        marcadas++;
        confirmadasIds.push(orden.Ordem_Serial);
        confirmadasConUbicacion.push({ orden, ubicacion: data.ubicacion });
      } else fallidas.push(orden.Ordem_Serial);
    } catch(e){ fallidas.push(orden.Ordem_Serial); }
  }

  let notaStickers = '';
  if(confirmadasConUbicacion.length){
    status.textContent = 'Mandando los stickers a la Zebra...';
    notaStickers = await ordImprimirStickersConFallback(confirmadasConUbicacion);
  }

  status.textContent = `Listo: ${marcadas} orden(es) mandada(s) al rack.${notaStickers}` +
    (fallidas.length ? ` No se pudieron marcar: ${fallidas.join(', ')} (revisá el puente).` : '');
  confirmBtn.disabled = true;
  ordLote = [];
  // Las que sí se confirmaron salen del "lote actual" (ya están en el
  // rack, no tiene sentido seguir mostrándolas ahí). Las que quedaron
  // "sin ubicar" se DEJAN en el lote a propósito — así seguís viéndolas
  // con su marca de advertencia y podés sacarlas vos mismo con "Quitar"
  // para probar con otra orden en su lugar.
  confirmadasIds.forEach(id=>{
    ordEnLoteIds.delete(String(id));
    ordLoteEstado.delete(String(id));
  });
  // OJO: a propósito NO se vuelve a consultar SQL acá — eso solo pasa
  // cuando el usuario toca "Actualizar lista de pendientes" a mano. Acá
  // nomás se sacan de la tabla, en memoria, las que se acaban de
  // confirmar, para que no se vean dos veces.
  if(confirmadasIds.length){
    const idsSet = new Set(confirmadasIds);
    ordenesPendientes = ordenesPendientes.filter(o=>!idsSet.has(o.Ordem_Serial));
  }
  ordRenderTabla();
  ordRenderLote();
  ordActualizarBotonEjecutar();
  if(typeof rackRender==='function') rackRender();
}
document.getElementById('ordConfirmBtn').addEventListener('click', ordConfirmar);

/* ============ vista "Rack" ============
   Con el Rack simulado, se lee/escribe contra /api/rack-simulado* del
   puente (archivo compartido en esa PC, no SQL, no el navegador). Con
   SQL real, se lee de /api/rack-actual y "sacar del rack" pega contra
   /api/rack/:orden/salida (bloqueado salvo PERMITIR_ESCRITURA_SQL). */
let rackListaActual = []; // lo que se está mostrando ahora mismo en el Rack, para que el buscador compare contra esto

/* Buscador para la pistola de código de barras: escaneás (o escribís) el
   número de orden y Enter — te dice dónde está, o "pieza no cortada" si
   no la encuentra. Después de mostrar el resultado, vacía el campo solo
   y le devuelve el foco, para poder seguir escaneando una tras otra sin
   tocar nada con el mouse. */
/* Si no la encuentra en el rack, y estás en modo "Simular el Rack",
   además pregunta si esa orden tuvo una salida reciente registrada —
   así, cuando el operario le dio salida por error, el buscador mismo
   ofrece reingresarla EN LA MISMA POSICIÓN en la que estaba, en vez de
   que tengas que armar todo de nuevo a mano desde Lista de corte. En
   modo SQL real esto queda desactivado (la reentrada forzada solo
   existe para el rack simulado, ver server.js). */
async function rackBuscar(){
  const input = document.getElementById('rackBuscarInput');
  const resultado = document.getElementById('rackBuscarResultado');
  const codigo = input.value.trim();
  if(!codigo) return;
  await rackRender(true); // fuerza traer el rack de nuevo (sin parpadeo) antes de buscar, para no comparar contra una foto vieja si justo otra PC le dio salida a algo
  const encontrado = rackListaActual.find(o=>String(o.Ordem_Serial)===codigo);
  resultado.style.display = 'block';
  if(encontrado){
    resultado.style.background = 'var(--good-soft, rgba(74,222,128,.15))';
    resultado.style.color = 'var(--good, #4ade80)';
    resultado.innerHTML = `Orden <b>${codigo}</b> — está en el rack, ubicación <b style="font-family:var(--font-mono)">${encontrado.ubicacion}</b>`;
    input.value = '';
    input.focus();
    return;
  }
  resultado.style.background = 'var(--warn-soft, rgba(248,113,113,.15))';
  resultado.style.color = 'var(--warn, #f87171)';
  resultado.innerHTML = `Orden <b>${codigo}</b> — pieza no cortada (no está en el rack)`;
  input.value = '';
  input.focus();

  if(!ordRackEsSimulado()) return;
  try {
    const res = await fetch(ordBridgeUrl()+'/api/rack-simulado/'+encodeURIComponent(codigo)+'/ultima-salida', {headers: ordApiHeaders()});
    const data = await res.json().catch(()=>({}));
    if(!res.ok || !data.encontrada) return; // nunca salió, o ya está en el rack — el mensaje de arriba alcanza
    resultado.style.background = 'var(--warn-soft, rgba(248,113,113,.15))';
    resultado.innerHTML = `Orden <b>${codigo}</b> — no está en el rack, pero salió de la posición <b style="font-family:var(--font-mono)">${data.ubicacion}</b> el ${new Date(data.fecha).toLocaleString('es-CO')}.
      ¿Le dieron salida por error?
      <button class="secondary rackReingresarBtn" data-orden="${codigo}" data-ubicacion="${data.ubicacion}" style="margin-top:8px;display:block;padding:6px 10px;font-size:12px">↩ Reingresar en la posición ${data.ubicacion}</button>`;
  } catch(e){ /* si el puente no responde, se queda con el mensaje de "no está en el rack" nomás */ }
}
document.getElementById('rackBuscarInput').addEventListener('keydown', ev=>{
  if(ev.key==='Enter'){ ev.preventDefault(); rackBuscar(); }
});
document.getElementById('rackBuscarBtn').addEventListener('click', rackBuscar);
document.getElementById('rackBuscarResultado').addEventListener('click', ev=>{
  const btn = ev.target.closest('.rackReingresarBtn');
  if(btn) rackReingresar(btn.getAttribute('data-orden'), btn.getAttribute('data-ubicacion'));
});

/* Busca los datos completos de la orden (nombre, modelo, archivo, etc.)
   en lo que el historial guardó de su última salida, y la reingresa al
   rack simulado FORZANDO la misma ubicación — si esa posición ya la
   ocupa otra orden, el servidor lo rechaza (ver /api/rack-simulado/reentrada
   en server.js) y acá se muestra el motivo en vez de romper nada. */
async function rackReingresar(ordenSerial, ubicacion){
  const resultado = document.getElementById('rackBuscarResultado');
  resultado.innerHTML = `Reingresando la orden ${ordenSerial} en ${ubicacion}...`;
  try {
    const histRes = await fetch(ordBridgeUrl()+'/api/rack-simulado/'+encodeURIComponent(ordenSerial)+'/ultima-salida', {headers: ordApiHeaders()});
    const hist = await histRes.json().catch(()=>({}));
    const datosOrden = (hist && hist.orden) || { Ordem_Serial: ordenSerial };
    const res = await fetch(ordBridgeUrl()+'/api/rack-simulado/reentrada', {
      method:'POST', headers: ordApiHeaders({'Content-Type':'application/json'}),
      body: JSON.stringify({ orden: datosOrden, ubicacion })
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || ('HTTP '+res.status));
    resultado.style.background = 'var(--good-soft, rgba(74,222,128,.15))';
    resultado.style.color = 'var(--good, #4ade80)';
    resultado.innerHTML = `Orden <b>${ordenSerial}</b> reingresada en <b style="font-family:var(--font-mono)">${ubicacion}</b>.`;
  } catch(e){
    resultado.style.background = 'var(--warn-soft, rgba(248,113,113,.15))';
    resultado.style.color = 'var(--warn, #f87171)';
    resultado.innerHTML = `No se pudo reingresar la orden ${ordenSerial}: ${e.message}`;
  }
  rackRender();
}

/* silencioso=true: se usa para el refresco automático de abajo — no
   pisa la tabla con "Consultando el rack..." en cada vuelta (eso
   parpadearía cada pocos segundos), solo la reemplaza cuando ya tiene
   la respuesta nueva. Sin el parámetro (llamada normal, al entrar a la
   pestaña o después de una acción propia) se comporta igual que
   siempre. */
async function rackRender(silencioso){
  const wrap = document.getElementById('rackWrap');
  const sim = ordRackEsSimulado();
  let lista;

  if(!silencioso) wrap.innerHTML = '<div class="empty">Consultando el rack...</div>';
  try {
    lista = sim ? await rackSimuladoTraer() : await (async()=>{
      const res = await fetch(ordBridgeUrl()+'/api/rack-actual', {headers: ordApiHeaders()});
      if(!res.ok) throw new Error('HTTP '+res.status);
      return res.json();
    })();
  } catch(e){
    if(silencioso) return; // un refresco automático que falla (por una red lenta, un timeout) no debe borrar lo que ya se estaba viendo
    document.getElementById('rackCount').textContent = '—';
    wrap.innerHTML = `<div class="empty">No se pudo traer el rack del puente: ${e.message}</div>`;
    rackListaActual = [];
    return;
  }
  rackListaActual = lista; // para que el buscador (código de barras) tenga contra qué comparar

  document.getElementById('rackCount').textContent = lista.length;
  if(!lista.length){
    wrap.innerHTML = '<div class="empty">Todavía no hay ninguna orden en el rack.</div>';
    return;
  }
  const rows = lista.slice().reverse().map(o=>`
    <tr>
      <td><b style="color:var(--accent);font-family:var(--font-mono)">${o.ubicacion}</b></td>
      <td>${o.Ordem_Serial}</td>
      <td>${o.Operation||'—'}</td>
      <td>${o.Centro_Trabalho||'—'}</td>
      <td>${o.Puestodetrabajo||'—'}</td>
      <td>${o.ClaveModelo||'—'}</td>
      <td>${o.CodMat||'—'}</td>
      <td>${o.Name||'—'}</td>
      <td>${o.ZTipo||'—'}</td>
      <td>${o.Descricao||'—'}</td>
      <td style="white-space:nowrap">
        <button class="secondary rackReimprimirBtn" data-orden="${o.Ordem_Serial}" style="padding:6px 10px;font-size:11px">🖨 Reimprimir sticker</button>
        <button class="secondary rackSalidaBtn" data-orden="${o.Ordem_Serial}" style="padding:6px 10px;font-size:11px;margin-left:6px">Sacar del rack</button>
      </td>
    </tr>`).join('');
  wrap.innerHTML = `<table class="ordTable">
    <thead><tr><th>Ubicación</th><th>Ordem_Serial</th><th>Operation</th><th>Centro_Trabalho</th><th>Puestodetrabajo</th><th>ClaveModelo</th><th>CodMat</th><th>Name</th><th>ZTipo</th><th>Descricao</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/* ===== Auto-refresco del Rack (para que un "sacar del rack" hecho en
   OTRA PC se vea acá sin tener que apretar F5 a mano) =====
   Solo corre mientras la pestaña del Rack está activa Y la ventana del
   navegador está visible (document.hidden evita pedir de más cuando el
   usuario cambió a otra pestaña o minimizó — ni tiene sentido, ni carga
   de más al puente). rackIniciarPolling() se puede llamar varias veces
   seguidas sin problema (por ej. si por error se llama dos veces al
   entrar a la pestaña): siempre limpia el intervalo anterior primero. */
let rackPollingId = null;
const RACK_POLLING_MS = 6000;

function rackIniciarPolling(){
  rackDetenerPolling();
  rackPollingId = setInterval(()=>{
    if(document.hidden) return; // pestaña del navegador no visible ahora mismo — no pedir nada
    rackRender(true);
  }, RACK_POLLING_MS);
}

function rackDetenerPolling(){
  if(rackPollingId){ clearInterval(rackPollingId); rackPollingId = null; }
}

// un solo listener sobre el contenedor fijo — la tabla de adentro se
// rearma cada vez, así que engancharlo por delegación evita tener que
// re-engancharlo después de cada rackRender().
document.getElementById('rackWrap').addEventListener('click', (ev)=>{
  const salidaBtn = ev.target.closest('.rackSalidaBtn');
  if(salidaBtn){ rackSalida(salidaBtn.getAttribute('data-orden')); return; }
  const reimpBtn = ev.target.closest('.rackReimprimirBtn');
  if(reimpBtn){ rackReimprimirSticker(reimpBtn.getAttribute('data-orden')); return; }
});

/* Le da salida a una orden del rack (ya se usó el material). En modo
   simulado la saca directo de la memoria; con el puente real, pega
   contra /api/rack/:orden/salida (ver TODO en server.js). */
async function rackSalida(ordenSerial){
  try {
    if(ordRackEsSimulado()){
      await rackSimuladoSalida(ordenSerial);
    } else {
      const r = await fetch(ordBridgeUrl()+'/api/rack/'+encodeURIComponent(ordenSerial)+'/salida', { method:'POST', headers: ordApiHeaders() });
      if(!r.ok) throw new Error('HTTP '+r.status);
    }
  } catch(e){
    alert('No se pudo sacar la orden del rack: '+e.message);
    return;
  }
  rackRender();
}

/* Reimprime el sticker de una orden que YA está en el rack — para
   cuando se dañó, se despegó, se perdió, o hace falta uno de más. Usa
   los mismos datos que ya están en la tabla del Rack (rackListaActual),
   no vuelve a pedir nada a SQL ni cambia en nada la ubicación asignada. */
async function rackReimprimirSticker(ordenSerial){
  const status = document.getElementById('rackStickerStatus');
  const orden = rackListaActual.find(o=>String(o.Ordem_Serial)===String(ordenSerial));
  if(!orden){
    if(status) status.textContent = `No se encontró la orden ${ordenSerial} en el rack (¿se acaba de sacar? probá tocar "Actualizar" o cambiar de pestaña y volver).`;
    return;
  }
  if(status) status.textContent = `Reimprimiendo el sticker de la orden ${ordenSerial}...`;
  const nota = await ordImprimirStickersConFallback([{ orden, ubicacion: orden.ubicacion }]);
  if(status) status.textContent = `Orden ${ordenSerial}:${nota}`;
}
