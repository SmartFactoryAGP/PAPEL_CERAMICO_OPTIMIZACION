// Corre todas las verificaciones y da un resumen.   node tools/pruebas/todas.js
// Opcional: node tools/pruebas/todas.js --sin-navegador   (salta la de Chrome, más rápido)
const { spawnSync } = require('child_process');
const path = require('path');

const PASOS = [
  ['Revisión de código (sintaxis, nombres)', path.join(__dirname, '..', 'revisar-js.js')],
  ['Datos y racks independientes', path.join(__dirname, 'datos.js')],
  ['Usuarios y permisos', path.join(__dirname, 'usuarios.js')],
  ['Inventario Tecoflex y carga', path.join(__dirname, 'inventario.js')],
  ['Migración a SQL (script)', path.join(__dirname, 'migracion.js')],
  ['Seguridad (intentos de robo de datos)', path.join(__dirname, 'seguridad.js')],
  ['Papel: regla CURVE/NivelAGP y Aprobaciones de ZFER', path.join(__dirname, 'aprobaciones.js')],
  ['Lista de corte: 1 consulta a SQL por hora', path.join(__dirname, 'lista-protegida.js')],
  ['Mallas: lista por CodMat y stock', path.join(__dirname, 'mallas.js')],
  ['Navegador (Chrome)', path.join(__dirname, 'navegador.js')],
  ['Navegador: Lista de corte de papel y Aprobaciones', path.join(__dirname, 'navegador-aprobaciones.js')],
  ['Navegador: Mallas (entrada con stickers y salida)', path.join(__dirname, 'navegador-mallas.js')],
].filter(([, f])=>!(process.argv.includes('--sin-navegador') && path.basename(f).startsWith('navegador')));

const resultados = [];
for(const [nombre, archivo] of PASOS){
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [archivo], { stdio: 'inherit' });
  resultados.push([nombre, r.status===0, ((Date.now()-t0)/1000).toFixed(1)]);
}
console.log('\n================ RESUMEN ================');
resultados.forEach(([n, bien, s])=>console.log(`${bien ? 'OK   ' : 'FALLÓ'}  ${n}  (${s} s)`));
const fallas = resultados.filter(r=>!r[1]).length;
console.log(fallas ? `\n${fallas} verificación(es) fallaron.` : '\nTodo OK.');
process.exit(fallas ? 1 : 0);
