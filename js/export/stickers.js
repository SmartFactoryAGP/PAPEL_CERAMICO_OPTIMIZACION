/* =========================================================
   STICKERS con código de barras — uno por cada orden que entra al
   Rack (simulado o real), tamaño fijo 100mm x 30mm (tu impresora de
   etiquetas). Se generan solos al confirmar un lote, como una descarga
   de PDF aparte (además del PDF del nesting que ya se descargaba).

   El código de barras es Code128 (subset B) implementado acá mismo,
   dibujado como rectángulos vectoriales directo en el PDF (no como
   una imagen rasterizada) — así sale nítido a cualquier tamaño de
   impresión, sin depender de ninguna librería externa ni de internet.
   La tabla de anchos es la oficial del estándar Code128.
   ========================================================= */

const CODE128_WIDTHS = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232'
];
const CODE128_STOP_WIDTHS = '2331112'; // el stop lleva una barra final de más (13 unidades en vez de 11)

/* Convierte el texto a la lista de "anchos" (uno por símbolo, cada uno
   una cadena de 6 u 7 dígitos) lista para dibujar. Solo soporta ASCII
   32-126 (subset B) — de sobra para números de orden y nombres de
   archivo; cualquier otro caracter se saltea en vez de romper todo. */
function code128Widths(texto){
  const valores = [104]; // Start Code B
  for(const ch of String(texto)){
    const code = ch.charCodeAt(0);
    if(code<32 || code>126) continue;
    valores.push(code-32);
  }
  let suma = valores[0];
  for(let i=1;i<valores.length;i++) suma += valores[i]*i;
  valores.push(suma % 103); // checksum
  const anchos = valores.map(v=>CODE128_WIDTHS[v]);
  anchos.push(CODE128_STOP_WIDTHS);
  return anchos;
}

/* Dibuja el código de barras directo en el PDF (rectángulos negros,
   vectoriales) — nada de imágenes ni canvas de por medio. */
function dibujarCodigo128(doc, texto, x, y, anchoTotal, altura){
  const simbolos = code128Widths(texto);
  let unidadesTotales = 0;
  simbolos.forEach(s=>{ for(const d of s) unidadesTotales += parseInt(d,10); });
  const anchoUnidad = anchoTotal / unidadesTotales;

  let cursorX = x;
  doc.setFillColor(0,0,0);
  simbolos.forEach(simbolo=>{
    let esBarra = true;
    for(const d of simbolo){
      const ancho = parseInt(d,10) * anchoUnidad;
      if(esBarra) doc.rect(cursorX, y, ancho, altura, 'F');
      cursorX += ancho;
      esBarra = !esBarra;
    }
  });
}

/* Nombre de archivo, sin la ruta — para que entre en la etiqueta
   (la ruta completa de red no entraría legible en 10cm). */
function soloNombreDeArchivo(ruta){
  if(!ruta) return '—';
  const partes = String(ruta).split(/[\\/]/);
  return partes[partes.length-1] || ruta;
}

/* ordenesConUbicacion: [{orden, ubicacion}] — orden es el objeto
   completo (Ordem_Serial, ARCHIVO, etc.), ubicacion es el string
   asignado en el rack (ej. "A5"). Un sticker por cada una, mismo
   tamaño fijo 100x30mm. */
function generarStickersPDF(ordenesConUbicacion){
  if(!ordenesConUbicacion.length) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:'mm', format:[100,30], orientation:'landscape'});

  ordenesConUbicacion.forEach(({orden, ubicacion}, i)=>{
    if(i>0) doc.addPage([100,30], 'landscape');

    doc.setDrawColor(0); doc.setLineWidth(0.4);
    doc.rect(1,1,98,28); // borde de la etiqueta, para guiar el corte/despegado

    // OJO: si el registro viniera sin número de orden (dato roto de SQL),
    // antes esto imprimía literalmente "undefined" en el sticker Y en el
    // código de barras — una etiqueta con pinta de válida pero con el dato
    // mal, pegada sobre material real. Ahora, si falta, se marca bien
    // visible en vez de fingir que hay un número.
    const tieneOrden = orden && orden.Ordem_Serial!=null && String(orden.Ordem_Serial).trim()!=='';
    const ordenTxt = tieneOrden ? String(orden.Ordem_Serial) : '¡SIN ORDEN!';

    // Orden — grande, arriba a la izquierda
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(90);
    doc.text('ORDEN', 4, 6);
    doc.setFont('helvetica','bold'); doc.setFontSize(15); doc.setTextColor(tieneOrden?0:200);
    doc.text(ordenTxt, 4, 13);

    // Posición — grande, arriba a la derecha (lo más importante para
    // encontrarla físicamente en el rack)
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(90);
    doc.text('POSICIÓN', 70, 6);
    doc.setFont('helvetica','bold'); doc.setFontSize(20); doc.setTextColor(0);
    doc.text(String(ubicacion||'—'), 70, 14);

    // Archivo — una línea, chico, debajo del número de orden
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(60);
    let archivo = soloNombreDeArchivo(orden.ARCHIVO);
    if(archivo.length>42) archivo = archivo.slice(0,39)+'...';
    doc.text(archivo, 4, 17.5);

    // Código de barras (codifica el número de orden) + texto legible debajo
    // — si no hay orden real, no se dibuja ningún código (sería un
    // código de barras válido pero con datos falsos, peor que no tener nada).
    if(tieneOrden) dibujarCodigo128(doc, ordenTxt, 4, 19.5, 92, 7);
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(tieneOrden?0:200);
    doc.text(ordenTxt, 50, 29, {align:'center'});
  });

  doc.save(`stickers_rack_${new Date().toISOString().slice(0,10)}.pdf`);
}

/* =========================================================
   IMPRESIÓN DIRECTA EN LA ZEBRA (ZPL) — sin pasar por ningún PDF.
   Genera el mismo sticker de arriba pero en ZPL (el lenguaje nativo de
   las Zebra), y se lo manda al puente (/api/imprimir-zpl), que a su
   vez se lo pasa crudo a la impresora conectada por USB a esa PC.

   ZPL_DPI: resolución de tu Zebra, en puntos por pulgada. Las Zebra de
   escritorio más comunes son 203; los modelos industriales suelen ser
   300 — normalmente está impreso en una etiqueta pegada en la
   impresora, o en las especificaciones del modelo. Si el sticker sale
   mal ubicado o mal escalado, este es el primer valor a revisar y
   ajustar acá.
   ========================================================= */
const ZPL_DPI = 203;
function mmAdots(valorMm){ return Math.round(valorMm * ZPL_DPI / 25.4); }

/* Saca ^ y ~ del texto — son los caracteres que ZPL usa para sus
   propios comandos, así que si aparecieran en un número de orden o un
   nombre de archivo (poco probable, pero por las dudas) romperían el
   sticker en vez de solo imprimirse raro. */
function escaparZPL(texto){ return String(texto||'').replace(/[\^~]/g,''); }

function zplDeUnSticker(orden, ubicacion){
  const anchoDots = mmAdots(100);
  const altoDots = mmAdots(30);
  let archivo = escaparZPL(soloNombreDeArchivo(orden.ARCHIVO));
  if(archivo.length>42) archivo = archivo.slice(0,39)+'...';
  // igual que en el PDF: si no hay número de orden real, se marca bien
  // visible en vez de imprimir un campo vacío o un código de barras con
  // datos vacíos/rotos (ver nota arriba, en generarStickersPDF).
  const tieneOrden = orden && orden.Ordem_Serial!=null && String(orden.Ordem_Serial).trim()!=='';
  const ordenTxt = tieneOrden ? escaparZPL(orden.Ordem_Serial) : 'SIN ORDEN';
  const ubicacionTxt = escaparZPL(ubicacion||'—');

  return [
    '^XA',
    `^PW${anchoDots}`,
    `^LL${altoDots}`,
    `^FO${mmAdots(4)},${mmAdots(1.5)}^A0N,${mmAdots(2)},${mmAdots(2)}^FDORDEN^FS`,
    `^FO${mmAdots(4)},${mmAdots(3.5)}^A0N,${mmAdots(5)},${mmAdots(5)}^FD${ordenTxt}^FS`,
    `^FO${mmAdots(65)},${mmAdots(1.5)}^A0N,${mmAdots(2)},${mmAdots(2)}^FDPOSICION^FS`,
    `^FO${mmAdots(65)},${mmAdots(3.5)}^A0N,${mmAdots(5.5)},${mmAdots(5.5)}^FD${ubicacionTxt}^FS`,
    // Todo el contenido (código de barras incluido) termina antes de los
    // 19mm a propósito, para dejar un margen de ~11mm libre hasta el
    // borde real de los 30mm — bastante más de lo que pediste (10mm).
    // El código de barras sigue yendo ANTES del archivo: si algo se
    // llega a recortar igual, que sea el archivo, nunca el código.
    `^FO${mmAdots(4)},${mmAdots(9.5)}^BY2^BCN,${mmAdots(6)},N,N,N^FD${ordenTxt}^FS`,
    `^FO${mmAdots(4)},${mmAdots(16.5)}^A0N,${mmAdots(1.8)},${mmAdots(1.8)}^FD${archivo}^FS`,
    '^XZ'
  ].join('\n');
}

/* Une un sticker (^XA...^XZ) por cada orden en un solo trabajo — la
   Zebra los va a imprimir seguidos, una etiqueta atrás de la otra. */
function zplDeVariosStickers(ordenesConUbicacion){
  return ordenesConUbicacion.map(({orden, ubicacion})=>zplDeUnSticker(orden, ubicacion)).join('\n');
}

/* Le pide al puente que mande el ZPL directo a la Zebra. Si el puente
   no tiene ZEBRA_PRINTER_SHARE configurado, devuelve ese error tal
   cual — quien llama a esto decide qué hacer (normalmente: ofrecer el
   PDF como respaldo). */
async function imprimirStickersZPL(ordenesConUbicacion){
  if(!ordenesConUbicacion.length) return { ok:true };
  return mandarZPL(zplDeVariosStickers(ordenesConUbicacion));
}

/* =========================================================
   STICKERS DE MALLAS — uno por cada malla que entra al Rack
   =========================================================
   Mismo tamaño (100x30mm) y el mismo cuidado con el margen de abajo que el
   de papel cerámico (todo termina antes de los ~18,5mm). Lleva: CodMat
   (grande y en código de barras, para escanearlo al dar salida),
   descripción, quién le dio la entrada y cuándo.
   lineas: [{codmat, descripcion, cantidad}] — usuario y fecha, de la entrada. */
const fechaSticker = iso => { const d = iso ? new Date(iso) : new Date(); return d.toLocaleString('es-CO', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'}); };
function zplStickerMalla(l, usuario, fecha){
  const codmat = escaparZPL(l.codmat);
  let desc = escaparZPL(l.descripcion || '');
  if(desc.length>48) desc = desc.slice(0,45)+'...';
  let quien = escaparZPL(usuario || '—');
  if(quien.length>24) quien = quien.slice(0,23)+'.';
  return [
    '^XA', '^CI28', // ^CI28: UTF-8 (tildes y eñes en la descripción y el nombre)
    `^PW${mmAdots(100)}`, `^LL${mmAdots(30)}`,
    `^FO${mmAdots(4)},${mmAdots(1.5)}^A0N,${mmAdots(2)},${mmAdots(2)}^FDCODMAT^FS`,
    `^FO${mmAdots(4)},${mmAdots(3.5)}^A0N,${mmAdots(5)},${mmAdots(5)}^FD${codmat}^FS`,
    `^FO${mmAdots(56)},${mmAdots(1.5)}^A0N,${mmAdots(2)},${mmAdots(2)}^FDENTRADA^FS`,
    `^FO${mmAdots(56)},${mmAdots(3.6)}^A0N,${mmAdots(2.6)},${mmAdots(2.6)}^FD${escaparZPL(fechaSticker(fecha))}^FS`,
    `^FO${mmAdots(56)},${mmAdots(6.6)}^A0N,${mmAdots(2.2)},${mmAdots(2.2)}^FD${quien}^FS`,
    `^FO${mmAdots(4)},${mmAdots(9.5)}^BY2^BCN,${mmAdots(6)},N,N,N^FD${codmat}^FS`,
    `^FO${mmAdots(4)},${mmAdots(16.5)}^A0N,${mmAdots(1.8)},${mmAdots(1.8)}^FD${desc}^FS`,
    // una copia por malla: un solo diseño con ^PQ (no N etiquetas repetidas en el pedido)
    `^PQ${Math.max(1, Math.round(l.cantidad))}`,
    '^XZ'
  ].join('\n');
}
async function imprimirStickersMallasZPL(lineas, usuario, fecha){
  if(!lineas.length) return { ok:true };
  return mandarZPL(lineas.map(l=>zplStickerMalla(l, usuario, fecha)).join('\n'));
}
function generarStickersMallasPDF(lineas, usuario, fecha){
  if(!lineas.length) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:'mm', format:[100,30], orientation:'landscape'});
  let primera = true;
  lineas.forEach(l=>{
    for(let i=0; i<Math.max(1, Math.round(l.cantidad)); i++){
      if(!primera) doc.addPage([100,30], 'landscape');
      primera = false;
      doc.setDrawColor(0); doc.setLineWidth(0.4); doc.rect(1,1,98,28);
      doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(90);
      doc.text('CODMAT', 4, 6); doc.text('ENTRADA', 58, 6);
      doc.setFont('helvetica','bold'); doc.setFontSize(15); doc.setTextColor(0);
      doc.text(String(l.codmat), 4, 13);
      doc.setFont('helvetica','normal'); doc.setFontSize(8);
      doc.text(fechaSticker(fecha), 58, 10);
      doc.text(String(usuario||'—').slice(0, 28), 58, 13.5);
      dibujarCodigo128(doc, String(l.codmat), 4, 15.5, 60, 7);
      doc.setFontSize(7); doc.setTextColor(60);
      let desc = String(l.descripcion||''); if(desc.length>60) desc = desc.slice(0,57)+'...';
      doc.text(desc, 4, 26.5);
    }
  });
  doc.save(`stickers_${typeof areaActualId!=='undefined' ? areaActualId : 'rack'}_${new Date().toISOString().slice(0,10)}.pdf`);
}

/* =========================================================
   STICKER DE TEJIDOS — uno por tejido, como el que ya usaban
   =========================================================
   POSICIÓN (grande), material, fecha y hora, responsables, resistencias 1
   y 2 y ensamble. Sin "puntos negros" ni código de barras (pedido
   explícito). Usa toda la etiqueta (ajustado con la ZD230 real). */
// fecha en números (20/10/2026): deja agrandar la letra sin que un mes largo se salga del borde
const fechaHoraTejido = iso => { const d = iso ? new Date(iso) : new Date();
  return { fecha: d.toLocaleDateString('es-CO', { day:'2-digit', month:'2-digit', year:'numeric' }), hora: d.toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' }) }; };
const corta = (t, n) => { t = String(t||''); return t.length > n ? t.slice(0, n-1) + '…' : t; };
/* Medidas tomadas de la etiqueta real impresa en la ZD230 (100 x 30 mm): en la
   fuente A0 cada carácter ocupa ~0,5 x el ancho pedido. Va de 2 a ~28 mm de alto. */
function zplStickerTejido(u, posicion){
  const f = fechaHoraTejido(u.fecha), e = v => escaparZPL(v);
  const t = (x, y, alto, ancho, texto) => `^FO${mmAdots(x)},${mmAdots(y)}^A0N,${mmAdots(alto)},${mmAdots(ancho)}^FD${texto}^FS`;
  return [
    '^XA', '^CI28', `^PW${mmAdots(100)}`, `^LL${mmAdots(30)}`,
    // izquierda: la POSICIÓN, enorme (en la foto "A15.1" midió 19 mm con ancho 8: con 13,5, ~33 mm)
    t(3, 2, 2.6, 2.6, 'POSICIÓN'),
    t(2.5, 4.8, 15.5, 13.5, e(posicion)),
    // derecha (de 39 a 97 mm): material, fecha y responsable
    t(39, 2, 4.2, 3.6, e(corta(u.nombre, 30))),
    t(39, 7, 2.6, 2.6, 'FECHA'),
    t(49, 6.6, 3.6, 3.2, `${e(f.fecha)}  ${e(f.hora)}`),
    t(39, 11.2, 2.6, 2.6, 'RESPONSABLE'),
    t(39, 13.6, 6.6, 5.6, e(corta(u.responsables, 20))),
    // abajo, separado por una línea: las resistencias y el ensamble, con su nombre completo
    `^FO${mmAdots(2.5)},${mmAdots(20.7)}^GB${mmAdots(95)},3,3^FS`,
    t(3, 21.6, 2.6, 2.6, 'RESISTENCIA 1'),  t(3, 24, 4.4, 4, e(corta(u.resistencia1, 14))),
    t(36, 21.6, 2.6, 2.6, 'RESISTENCIA 2'), t(36, 24, 4.4, 4, e(corta(u.resistencia2||'-', 14))),
    t(69, 21.6, 2.6, 2.6, 'ENSAMBLE'),      t(69, 24, 4.4, 4, e(corta(u.ensamble||'-', 14))),
    '^XZ'
  ].join('\n');
}
async function imprimirStickerTejidoZPL(unidad, posicion){ return mandarZPL(zplStickerTejido(unidad, posicion)); }
function generarStickerTejidoPDF(u, posicion){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:'mm', format:[100,30], orientation:'landscape'});
  const f = fechaHoraTejido(u.fecha);
  doc.setDrawColor(0); doc.setLineWidth(0.4); doc.rect(1,1,98,28);
  // mismo diseño que el de la Zebra (zplStickerTejido)
  const rotulo = (t, x, y) => { doc.setFont('helvetica','bold'); doc.setFontSize(6.5); doc.setTextColor(40,40,110); doc.text(t, x, y); doc.setTextColor(0); };
  rotulo('POSICIÓN', 3, 4.4);
  doc.setFont('helvetica','bold'); doc.setFontSize(40); doc.text(String(posicion), 2.5, 18);
  doc.setFontSize(11); doc.text(corta(u.nombre, 30), 39, 5.6);
  rotulo('FECHA', 39, 9.4); doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.text(`${f.fecha}  ${f.hora}`, 49, 9.4);
  rotulo('RESPONSABLE', 39, 13.4); doc.setFont('helvetica','bold'); doc.setFontSize(17); doc.text(corta(u.responsables, 20), 39, 19.2);
  doc.setLineWidth(0.4); doc.line(2.5, 20.8, 97.5, 20.8);
  rotulo('RESISTENCIA 1', 3, 23.6); rotulo('RESISTENCIA 2', 36, 23.6); rotulo('ENSAMBLE', 69, 23.6);
  doc.setFont('helvetica','bold'); doc.setFontSize(12);
  doc.text(corta(u.resistencia1, 14), 3, 28); doc.text(corta(u.resistencia2||'—', 14), 36, 28); doc.text(corta(u.ensamble||'—', 14), 69, 28);
  doc.save(`sticker_tejido_${String(posicion).replace(/[^\w.-]/g,'')}_${new Date().toISOString().slice(0,10)}.pdf`);
}

async function mandarZPL(zpl){
  const res = await fetch(ordBridgeUrl()+'/api/imprimir-zpl', {
    method:'POST', headers: ordApiHeaders({'Content-Type':'application/json'}),
    body: JSON.stringify({ zpl })
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || ('HTTP '+res.status));
  return data;
}

