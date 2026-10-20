/* Carga en el rack de Tejidos las POSICIONES (con su tamaño) y los TAMAÑOS de
   cada tejido, desde el Excel TEJIDOS.xlsx (ya leído por importar-excel.ps1).
     node tools/tejidos/importar.js <excel-exportado.json> [--datos server/datos]
   - Posiciones (hoja "Rack": Rack, CAPACIDAD, MATERIAL_TEJ, Tamaño, ...):
     reemplaza la lista; una posición OCUPADA hoy en la app nunca se borra
     ni se le cambia el tamaño (se avisa).
   - Tamaños (hoja "tamaño": Text.Breve, GEOMETRIA_, VEHICULO_, Componente,
     CATIDAD, TAMAÑO): agrega o actualiza los del Excel; los que se asignaron
     a mano en la app y no están en el Excel se conservan.
   No toca lo que hay en el rack (ocupación) ni el historial. Con el puente
   apagado, o reiniciarlo después (lo lee al arrancar). */
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const archivo = args[0];
const iDatos = args.indexOf('--datos');
const DATOS = path.resolve(iDatos>=0 ? args[iDatos+1] : path.join(RAIZ, 'server', 'datos'));
const TAMANOS = ['P', 'G', 'XG'];
if(!archivo){ console.error('Uso: node tools/tejidos/importar.js <excel-exportado.json> [--datos <carpeta>]'); process.exit(1); }

const excel = JSON.parse(fs.readFileSync(archivo, 'utf8').replace(/^﻿/, ''));
const dir = path.join(DATOS, 'tejidos'); fs.mkdirSync(dir, { recursive: true });
const leer = (n, d) => { const r = path.join(dir, n); return fs.existsSync(r) && fs.readFileSync(r, 'utf8').trim() ? JSON.parse(fs.readFileSync(r, 'utf8')) : d; };
const escribir = (n, v) => { const r = path.join(dir, n); fs.writeFileSync(r + '.tmp', JSON.stringify(v, null, 1)); fs.renameSync(r + '.tmp', r); };
const tam = v => String(v||'').trim().toUpperCase();
const sinCeros = v => String(v||'').trim().replace(/\.0+$/, '').replace(/^0+/, '');

// ---- posiciones ----
const ocupacion = leer('ocupacion.json', {});
const avisos = [];
const posiciones = [], vistas = new Set();
(excel.rack||[]).forEach((f, i)=>{
  const pos = String(f[0]||'').trim().toUpperCase(), t = tam(f[3]);
  if(!pos) return;
  if(!/^[A-Z]+\d+(\.\d+)?$/.test(pos)){ avisos.push(`fila ${i+2} de "Rack": posición rara "${pos}" (se saltea)`); return; }
  if(!TAMANOS.includes(t)){ avisos.push(`fila ${i+2} de "Rack": ${pos} con tamaño "${f[3]}" (se saltea)`); return; }
  if(vistas.has(pos)){ avisos.push(`posición repetida: ${pos} (se usa la primera)`); return; }
  vistas.add(pos); posiciones.push({ pos, tamano: t });
});
const anteriores = leer('posiciones.json', []);
Object.keys(ocupacion).forEach(pos=>{
  const nueva = posiciones.find(p=>p.pos===pos), vieja = anteriores.find(p=>p.pos===pos);
  if(!nueva && vieja){ posiciones.push(vieja); avisos.push(`${pos} ya no está en el Excel pero tiene un tejido: se mantiene`); }
  else if(nueva && vieja && nueva.tamano!==vieja.tamano){ nueva.tamano = vieja.tamano; avisos.push(`${pos} cambió de tamaño en el Excel pero tiene un tejido: se mantiene ${vieja.tamano}`); }
});
escribir('posiciones.json', posiciones);

// ---- tamaños de cada tejido ----
const tamanos = leer('tamanos.json', {});
let nuevos = 0, cambiados = 0, conflictos = 0;
const delExcel = {};
(excel.tamano||[]).forEach((f, i)=>{
  const codmat = sinCeros(f[3]), t = tam(f[5]), nombre = String(f[0]||'').trim();
  if(!/^\d{1,18}$/.test(codmat) || !TAMANOS.includes(t)) return;
  if(delExcel[codmat] && delExcel[codmat]!==t){ conflictos++; avisos.push(`${codmat} aparece con tamaños distintos en el Excel (${delExcel[codmat]} y ${t}): queda ${delExcel[codmat]}`); return; }
  delExcel[codmat] = t;
  if(!tamanos[codmat]) nuevos++; else if(tamanos[codmat].tamano!==t) cambiados++;
  const antes = tamanos[codmat] || {}, geo = String(f[1]||'').trim();
  tamanos[codmat] = { ...antes, tamano: t, nombre: nombre || antes.nombre || '',
    vehiculo: String(f[2]||'').trim() || antes.vehiculo || '', geometria: /^0*$/.test(geo) ? '' : geo }; // "0" en el Excel = sin dato
});
escribir('tamanos.json', tamanos);

const cuenta = t => posiciones.filter(p=>p.tamano===t).length;
console.log(`Posiciones: ${posiciones.length} (P ${cuenta('P')}, G ${cuenta('G')}, XG ${cuenta('XG')})`);
console.log(`Tamaños de tejidos: ${Object.keys(tamanos).length} en total (${nuevos} nuevos, ${cambiados} cambiados${conflictos ? `, ${conflictos} con conflicto` : ''})`);
if(avisos.length){ console.log('Avisos:'); avisos.forEach(a=>console.log('  - ' + a)); }
console.log(`Listo, en ${dir}. Reiniciá el puente para que lo tome.`);
