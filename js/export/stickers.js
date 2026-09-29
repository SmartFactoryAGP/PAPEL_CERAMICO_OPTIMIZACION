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
  const zpl = zplDeVariosStickers(ordenesConUbicacion);
  const res = await fetch(ordBridgeUrl()+'/api/imprimir-zpl', {
    method:'POST', headers: ordApiHeaders({'Content-Type':'application/json'}),
    body: JSON.stringify({ zpl })
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || ('HTTP '+res.status));
  return data;
}

