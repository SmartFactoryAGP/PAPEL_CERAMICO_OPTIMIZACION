/* =========================================================
   ESCAPE DE HTML — todo texto que venga de afuera (SQL, nombre de un
   archivo, nombre de capa de un DXF, lo que escanea la pistola) y se
   meta en un innerHTML tiene que pasar por acá. Sin esto, un valor como
   "<img src=x onerror=...>" en una columna de SQL o en una capa de DXF
   se ejecutaría como código en el navegador de quien lo esté mirando.
   Para texto normal el resultado es idéntico al de antes.
   ========================================================= */
const HTML_ESCAPES = {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'};
function escapeHtml(valor){
  return String(valor).replace(/[&<>"']/g, c=>HTML_ESCAPES[c]);
}
