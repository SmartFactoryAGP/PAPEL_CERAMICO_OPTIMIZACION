/* =========================================================
   DÓNDE VIVEN LOS DATOS — una carpeta por rack, independiente
   =========================================================
     server/datos/
       usuarios.json                 usuarios, contraseñas (cifradas) y permisos
       papel/rack.json               órdenes en el rack de papel cerámico (A1…G20)
       papel/historial.jsonl         entradas / salidas / reentradas de ese rack (una línea por evento, solo se agrega)
       papel/aprobaciones.json       ZFER aprobados (CURVE 02–04 que llevan papel)
       mallas/movimientos.jsonl      diario de entradas y salidas por CodMat (fuente de verdad)
       mallas/inventario.json        foto legible del stock de mallas
       tecoflex/movimientos.jsonl    diario de entradas y salidas (fuente de verdad)
       tecoflex/inventario.json      foto legible del stock actual
       respaldos/AAAA-MM-DD/…        copia diaria automática (se guardan 30 días)
       _anteriores/                  archivos del formato viejo, ya migrados

   Cada rack tiene su propia carpeta: lo que pase en uno (un archivo
   dañado, una restauración desde un respaldo) no toca a los otros.
   Estos datos NO se suben a git y NO se pisan al actualizar la app.
   ========================================================= */
const fs = require('fs');
const path = require('path');

const SERVIDOR = __dirname;
const DATOS = path.join(SERVIDOR, 'datos');
const RESPALDOS = path.join(DATOS, 'respaldos');
const ANTERIORES = path.join(DATOS, '_anteriores');
const DIAS_RESPALDO = 30;

function carpetaArea(areaId){
  const dir = path.join(DATOS, areaId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const rutas = {
  usuarios:    ()     => path.join(DATOS, 'usuarios.json'),
  rack:        areaId => path.join(carpetaArea(areaId), 'rack.json'),
  historial:   areaId => path.join(carpetaArea(areaId), 'historial.jsonl'),
  historialViejo: areaId => path.join(carpetaArea(areaId), 'historial.json'), // formato anterior (un arreglo); se convierte solo
  aprobaciones: areaId => path.join(carpetaArea(areaId), 'aprobaciones.json'), // ZFER aprobados para Lista de corte (papel)
  diario:      areaId => path.join(carpetaArea(areaId), 'movimientos.jsonl'),
  inventario:  areaId => path.join(carpetaArea(areaId), 'inventario.json'),
  diarioViejo: areaId => path.join(carpetaArea(areaId), 'movimientos.json'), // formato anterior (arreglo); se convierte solo
};

/* ---------- migración única desde el formato anterior ----------
   Antes todo estaba suelto en server/ y el historial de los racks era un
   solo archivo compartido. Se mueve cada cosa a su lugar SOLO si el
   destino todavía no existe (correrlo dos veces no hace nada), y los
   originales quedan en datos/_anteriores/ por si hiciera falta mirarlos. */
function guardarAnterior(origen){
  fs.mkdirSync(ANTERIORES, { recursive: true });
  let destino = path.join(ANTERIORES, path.basename(origen));
  if(fs.existsSync(destino)) destino += '.' + Date.now();
  fs.renameSync(origen, destino);
}
function mover(viejoNombre, destino, log){
  const origen = path.join(SERVIDOR, viejoNombre);
  if(!fs.existsSync(origen) || fs.existsSync(destino)) return;
  fs.copyFileSync(origen, destino);
  guardarAnterior(origen);
  log.push(`${viejoNombre} -> ${path.relative(SERVIDOR, destino)}`);
}
function migrar(areaIds){
  fs.mkdirSync(DATOS, { recursive: true });
  const log = [];
  mover('usuarios.json', rutas.usuarios(), log);
  mover('rack-simulado.json', rutas.rack('papel'), log);
  mover('rack-mallas.json', rutas.rack('mallas'), log);
  mover('inventario-tecoflex.json', rutas.inventario('tecoflex'), log);
  mover('movimientos-tecoflex.jsonl', rutas.diario('tecoflex'), log);
  mover('movimientos-tecoflex.json', rutas.diarioViejo('tecoflex'), log);
  ['movimientos-tecoflex.json.migrado', 'rack-tecoflex.json'].forEach(n=>{ // restos que ya no se usan
    const o = path.join(SERVIDOR, n); if(fs.existsSync(o)){ guardarAnterior(o); log.push(`${n} -> _anteriores/`); }
  });
  // el historial viejo era UNO solo para todos los racks: se reparte
  const histViejo = path.join(SERVIDOR, 'rack-historial.json');
  if(fs.existsSync(histViejo)){
    const texto = fs.readFileSync(histViejo, 'utf8');
    const lista = texto.trim() ? JSON.parse(texto) : []; // dañado: que falle al arrancar y se vea, sin perder nada
    const porArea = {};
    lista.forEach(h=>{ const a = h.area || 'papel'; (porArea[a] = porArea[a] || []).push(h); });
    Object.keys(porArea).forEach(a=>{
      if(!areaIds.includes(a)) return;
      const destino = rutas.historial(a);
      if(fs.existsSync(destino) || fs.existsSync(rutas.historialViejo(a))) return;
      fs.writeFileSync(destino, porArea[a].map(h=>JSON.stringify(h)).join('\n') + '\n', 'utf8');
      log.push(`rack-historial.json (${porArea[a].length} de ${a}) -> ${path.relative(SERVIDOR, destino)}`);
    });
    guardarAnterior(histViejo);
  }
  /* historial de cada rack de casillas: de arreglo JSON (historial.json) a una
     línea por evento (historial.jsonl). Con el arreglo, cada entrada o salida
     reescribía el archivo ENTERO (con un año de uso, ~28 MB y ~0,5 s por
     movimiento); ahora se agrega una línea. Una sola vez; el original queda
     en _anteriores/<área>-historial.json. */
  areaIds.forEach(a=>{
    const viejo = path.join(DATOS, a, 'historial.json'), nuevo = path.join(DATOS, a, 'historial.jsonl');
    if(!fs.existsSync(viejo) || fs.existsSync(nuevo)) return;
    const texto = fs.readFileSync(viejo, 'utf8');
    const lista = texto.trim() ? JSON.parse(texto) : []; // dañado: que falle al arrancar y se vea, sin perder nada
    fs.writeFileSync(nuevo + '.tmp', lista.map(h=>JSON.stringify(h)).join('\n') + (lista.length ? '\n' : ''), 'utf8');
    fs.renameSync(nuevo + '.tmp', nuevo);
    fs.mkdirSync(ANTERIORES, { recursive: true });
    let destino = path.join(ANTERIORES, a + '-historial.json');
    if(fs.existsSync(destino)) destino += '.' + Date.now();
    fs.renameSync(viejo, destino);
    log.push(`${a}/historial.json (${lista.length} eventos) -> ${a}/historial.jsonl`);
  });
  if(log.length) console.log('[datos] migración al formato por rack:\n  ' + log.join('\n  '));
}

/* ---------- respaldo diario ----------
   Una copia completa de datos/ por día (sin los respaldos mismos), en
   datos/respaldos/AAAA-MM-DD/. Se guardan los últimos 30 días. Para
   restaurar un rack: cerrar el puente y copiar su carpeta de vuelta. */
function hoyTexto(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function respaldar(){
  try {
    const destino = path.join(RESPALDOS, hoyTexto());
    if(fs.existsSync(destino)) return; // ya hay uno de hoy
    fs.mkdirSync(destino, { recursive: true });
    fs.readdirSync(DATOS).forEach(nombre=>{
      if(nombre==='respaldos' || nombre==='_anteriores') return;
      // las fotos (Tejidos) NO se copian cada día: solo se agregan, nunca cambian, y
      // copiarlas 30 veces llenaría el disco. Se respaldan aparte (ver DATOS.md).
      fs.cpSync(path.join(DATOS, nombre), path.join(destino, nombre), { recursive: true, filter: src=>path.basename(src)!=='fotos' });
    });
    const dias = fs.readdirSync(RESPALDOS).filter(n=>/^\d{4}-\d{2}-\d{2}$/.test(n)).sort();
    dias.slice(0, Math.max(0, dias.length - DIAS_RESPALDO)).forEach(n=>fs.rmSync(path.join(RESPALDOS, n), { recursive: true, force: true }));
    console.log(`[datos] respaldo del día guardado en ${path.relative(SERVIDOR, destino)}`);
  } catch(e){
    console.error('[datos] no se pudo hacer el respaldo del día:', e.message);
  }
}
function iniciarRespaldos(){
  respaldar();
  setInterval(respaldar, 60*60*1000).unref(); // revisa cada hora; copia una vez por día
}

module.exports = { DATOS, rutas, migrar, iniciarRespaldos };
