/* =========================================================
   EXPORT PDF — una hoja por diseño de corte único
   ========================================================= */
function exportPDF(){
  if(!lastResult || !lastResult.chapas.length){ alert('Ejecuta el nesting primero.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:'mm', format:'a4', orientation:'portrait'});
  const {sheetW, chapaLen, chapas, kerf, step, allowMirror} = lastResult;
  const idMap = buildIdMap();
  const groups = groupChapas(chapas, idMap);
  const jobName = document.getElementById('jobName').value || '-';
  const machineName = document.getElementById('machineName').value || '-';
  const now = new Date().toLocaleString('es-CO');

  groups.forEach((g, gi)=>{
    if(gi>0) doc.addPage();
    const chapa = g.chapa;
    const effLen = effChapaLen(chapa, chapaLen);
    const util = utilOf(chapa, sheetW, effLen);
    const totalIconos = chapa.placed.length;

    doc.setDrawColor(120); doc.setLineWidth(0.3);
    doc.rect(10,8,26,14);
    doc.setFontSize(8); doc.setTextColor(120); doc.text('AGP', 23, 16, {align:'center'});
    doc.setFontSize(16); doc.setTextColor(20); doc.text('Datos Nesting', 105, 15, {align:'center'});
    doc.rect(164,8,36,14);
    doc.setFontSize(8); doc.setTextColor(100); doc.text('Máquina', 182, 12, {align:'center'});
    doc.setFontSize(11); doc.setTextColor(20); doc.text(machineName, 182, 18, {align:'center'});

    doc.setFontSize(9); doc.setTextColor(20);
    doc.text('Trabajo', 10, 26); doc.text(jobName, 26, 26);
    doc.setTextColor(100); doc.text(now, 10, 31);
    doc.setTextColor(20);
    doc.text(`Página: ${gi+1} / ${groups.length}`, 200, 26, {align:'right'});
    doc.text('REV 2.0', 200, 31, {align:'right'});
    doc.setDrawColor(60); doc.line(10,34,200,34);

    if(g.indices.length>1){
      doc.setFillColor(224,164,88); doc.rect(10,36.5,190,6,'F');
      doc.setFontSize(9.5); doc.setTextColor(30);
      doc.text(`CORTAR ESTA PLANCHA ${g.indices.length} VECES  (chapas: ${g.indices.join(', ')})`, 105, 40.5, {align:'center'});
    } else {
      doc.setFillColor(235,235,235); doc.rect(10,36.5,190,6,'F');
      doc.setFontSize(9); doc.setTextColor(60);
      doc.text(`Chapa ${g.indices[0]}`, 105, 40.5, {align:'center'});
    }

    let ty0 = 45;
    doc.setFillColor(230,230,230); doc.rect(10,ty0,190,5.5,'F');
    doc.setFontSize(9); doc.setTextColor(20); doc.text('Datos Chapa', 105, ty0+4, {align:'center'});
    const rows = [
      ['Chapa n°', String(g.indices[0]), 'Nombre fichero', jobName, 'Descripción', '-'],
      ['Material', '-', 'Separación (mm)', String(kerf), 'Cant. Iconos', String(totalIconos)],
      ['Espesor (mm)', '-', 'Paso rotación (auto)', step+'°', 'Espejo', allowMirror?'Sí':'No'],
      ['Dim XY (mm x mm)', `${sheetW.toFixed(1)} x ${chapaLen.toFixed(1)}`, 'Aprovechamiento', util.toFixed(1)+'%', 'Número Cortes', String(g.indices.length)],
      ['Corte real (mm x mm)', `${sheetW.toFixed(1)} x ${effLen.toFixed(1)}`, 'Recorte %', (100-util).toFixed(1)+'%', 'Tiempo Corte', '-'],
    ];
    const colX = [10, 42, 78, 110, 146, 178, 200];
    let ry = ty0+5.5;
    const rowH = 5.6;
    doc.setLineWidth(0.15); doc.setDrawColor(150);
    rows.forEach(r=>{
      doc.rect(colX[0], ry, colX[6]-colX[0], rowH);
      for(let i=0;i<colX.length-1;i++) doc.line(colX[i],ry,colX[i],ry+rowH);
      doc.setFontSize(6.8); doc.setTextColor(110);
      doc.text(r[0], colX[0]+1.2, ry+2.4); doc.text(r[2], colX[2]+1.2, ry+2.4); doc.text(r[4], colX[4]+1.2, ry+2.4);
      doc.setFontSize(8); doc.setTextColor(20);
      doc.text(String(r[1]), colX[0]+1.2, ry+4.9); doc.text(String(r[3]), colX[2]+1.2, ry+4.9); doc.text(String(r[5]), colX[4]+1.2, ry+4.9);
      ry += rowH;
    });

    const drawY = ry + 4;
    const drawH = 140;
    doc.setDrawColor(150); doc.rect(10, drawY, 190, drawH);
    const pxPerMM = Math.min(1500/sheetW, 1000/chapaLen, 1.4);
    // calcula primero cuánto se va a achicar la imagen al insertarla en el PDF,
    // para pedirle al canvas una letra de ID que YA IMPRESA se vea grande y clara.
    const CHAPA_M = {L:34, T:18, R:8, B:8}; // debe coincidir con los márgenes de drawChapaToCanvas
    const preW = Math.round(sheetW*pxPerMM) + CHAPA_M.L + CHAPA_M.R;
    const preH = Math.round(chapaLen*pxPerMM) + CHAPA_M.T + CHAPA_M.B;
    const availW = 186, availH = drawH-4;
    const preRatio = Math.min(availW/preW, availH/preH);
    const idMM = 6.5;   // alto de letra del ID, ya en tamaño impreso en el PDF
    const rotMM = 3;    // alto de letra de la rotación
    const canvas = drawChapaToCanvas(chapa, sheetW, chapaLen, idMap, pxPerMM, {
      idFontPx: Math.round(idMM/preRatio),
      rotFontPx: Math.round(rotMM/preRatio),
      showRot: true,
      effLen: effLen,
      showTrimLabel: false
    });
    const img = canvas.toDataURL('image/png');
    const ratio = Math.min(availW/canvas.width, availH/canvas.height);
    const imgW = canvas.width*ratio, imgH = canvas.height*ratio;
    doc.addImage(img, 'PNG', 12+(availW-imgW)/2, drawY+2+(availH-imgH)/2, imgW, imgH);

    let ty = drawY + drawH + 5;
    const headers = ['ID','Código icono (archivo)','Dim (mm)','Perím. (mm)','Cant.','Rotaciones','Espejadas'];
    const wCols = [10, 56, 26, 24, 16, 34, 24];
    doc.setFontSize(7); doc.setTextColor(255); doc.setFillColor(60,70,75);
    doc.rect(10, ty, 190, 5, 'F');
    let cx = 10;
    headers.forEach((h,i)=>{ doc.text(h, cx+1, ty+3.5); cx += wCols[i]; });
    ty += 5;

    const counts = new Map();
    chapa.placed.forEach(p=>{
      if(!counts.has(p.pieceId)) counts.set(p.pieceId, {p, count:0, rots:new Set(), mir:0});
      const e = counts.get(p.pieceId);
      e.count++; e.rots.add(p.rot); if(p.mirror) e.mir++;
    });
    const idsSorted = [...counts.values()].sort((a,b)=>idMap.get(a.p.pieceId)-idMap.get(b.p.pieceId));
    doc.setTextColor(20);
    idsSorted.forEach((e, ri)=>{
      const pieceDef = pieces.find(pp=>pp.id===e.p.pieceId);
      const bbox = pieceDef ? pieceDef.bbox : null;
      const perim = pieceDef ? pieceDef.perimeter : 0;
      if(ri%2===1){ doc.setFillColor(245,245,245); doc.rect(10,ty,190,5,'F'); }
      const rotList = [...e.rots].sort((a,b)=>a-b).map(r=>r+'°').join(' ');
      const vals = [
        String(idMap.get(e.p.pieceId)),
        (pieceDef ? pieceDef.name : e.p.name).slice(0,40),
        // si la pieza vino de un DXF degenerado (sin puntos válidos), bbox.w/h
        // pueden dar NaN — antes eso imprimía literal "NaNxNaN" en la hoja de
        // corte real; ahora se ve igual que cuando no hay bbox.
        (bbox && Number.isFinite(bbox.w) && Number.isFinite(bbox.h)) ? `${bbox.w.toFixed(0)}x${bbox.h.toFixed(0)}` : '-',
        perim.toFixed(1),
        String(e.count),
        rotList.length>26 ? rotList.slice(0,26)+'…' : rotList,
        String(e.mir)
      ];
      cx = 10;
      doc.setFontSize(7.2);
      vals.forEach((v,i)=>{ doc.text(v, cx+1, ty+3.5); cx += wCols[i]; });
      ty += 5;
    });
    doc.setDrawColor(150); doc.rect(10, drawY+drawH+5, 190, ty-(drawY+drawH+5));
  });

  doc.save(`${slug(jobName)}_reporte.pdf`);
}
document.getElementById('btnPdf').addEventListener('click', exportPDF);
