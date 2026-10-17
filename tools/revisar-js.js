/* Revisión rápida del JavaScript de la app — muestra SOLO lo que rompe:
     - errores de sintaxis
     - nombres que no existen (una función o variable mal escrita, o que se
       borró de otro archivo: con <script> sueltos esto no avisa hasta que
       alguien toca ese botón en planta)
     - llamadas con una cantidad de argumentos que la función no acepta
   y deja afuera el ruido de tipos (~190 avisos falsos con este estilo de código).

   Uso, desde la carpeta del proyecto:   node tools/revisar-js.js
   (la primera vez descarga TypeScript con npx; después usa la copia en caché) */
const { execSync } = require('child_process');
const path = require('path');

const RELEVANTES = new Set([
  'TS2304', // no existe el nombre
  'TS2552', // no existe el nombre (¿quisiste decir…?)
  'TS2554', 'TS2555', // cantidad de argumentos
  'TS2300', // identificador duplicado (dos archivos declaran lo mismo)
  'TS2451', // let/const redeclarado entre archivos
]);
const raiz = path.join(__dirname, '..');
let salida = '';
try {
  salida = execSync('npx --yes -p typescript@5 tsc -p jsconfig.json --checkJs --pretty false', { cwd: raiz, encoding: 'utf8', stdio: ['ignore','pipe','pipe'], shell: true });
} catch(e){ salida = (e.stdout||'') + (e.stderr||''); }

const errores = salida.split(/\r?\n/).filter(l=>{
  const m = l.match(/error (TS\d+)/);
  return m && (RELEVANTES.has(m[1]) || /^TS1\d{3}$/.test(m[1])); // TS1xxx = sintaxis
});
if(!errores.length){ console.log('OK — sin errores de sintaxis, nombres inexistentes ni argumentos de más/de menos.'); process.exit(0); }
console.log(`${errores.length} problema(s):\n` + errores.join('\n'));
process.exit(1);
