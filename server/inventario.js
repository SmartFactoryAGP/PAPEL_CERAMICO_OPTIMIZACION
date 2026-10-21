/* =========================================================
   INVENTARIO POR MATERIAL Y MEDIDA (Tecoflex)
   =========================================================
   No va por órdenes: es un stock en cantidades, por (material, medida).

   Diseño para muchos usuarios a la vez:
   - movimientos.jsonl: DIARIO de movimientos, una línea por movimiento,
     solo se AGREGA al final (costo fijo, no crece con el historial). Es la
     fuente de verdad.
   - El stock vive en memoria y se reconstruye al arrancar repasando el
     diario de punta a punta: stock e historial nunca pueden quedar
     distintos. inventario.json queda como foto legible del stock actual.
   - version = cantidad de movimientos; cada cambio se avisa en vivo.
   - idCliente: la app manda un id por carrito. Si el mismo lote llega dos
     veces (doble clic, o la red cortó la respuesta y el operario
     reintentó), se devuelve el resultado de la primera vez en lugar de
     descontar dos veces.
   - El lote se valida ENTERO antes de tocar nada: si una sola línea falla
     no se aplica ninguna. Node atiende un pedido por vez y todo esto es
     sincrónico, así que 30 PCs registrando a la vez no se pisan.
   Todo el acceso a los archivos del inventario pasa por acá (el día que
   viva en SQL, se reemplaza este módulo). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { leerListaJson, escribirListaJson } = require('./archivos');
const { errorHttp, esHoy } = require('./comun');
const { codmatCorto } = require('./reglas-mallas');

const MAX_CANTIDAD = 100000;
const MAX_LINEAS = 500;
const RECIENTES = 300;  // movimientos que se mandan a la pantalla
/* En memoria solo hace falta lo que se muestra (los últimos RECIENTES) y lo de
   HOY (los totales del día); el diario en disco sigue teniendo TODO. Antes se
   guardaba el año entero en memoria (~3 KB por movimiento masivo de Tecoflex). */
const MAX_EN_MEMORIA = 2000;
function recortar(inv){
  if(inv.movimientos.length <= MAX_EN_MEMORIA) return; // se recorta de a tandas, no en cada movimiento
  let desde = inv.movimientos.length - RECIENTES;
  while(desde > 0 && esHoy(inv.movimientos[desde-1].fecha)) desde--; // los de hoy se quedan todos
  inv.movimientos.splice(0, desde).forEach(mv=>{ if(mv.idCliente && inv.porIdCliente.get(mv.idCliente)===mv) inv.porIdCliente.delete(mv.idCliente); });
}
const invClave = (m, d) => m+'|'+d;

/* CONSUMO: cuánto entró y salió de cada (material, medida) en cada DÍA. Se arma al
   cargar el diario (que tiene TODO el historial) y se va sumando en cada movimiento:
   así la pantalla de consumo contesta al instante sin releer el diario ni guardar
   todos los movimientos en memoria. dias: 'AAAA-MM-DD' (hora local) -> Map clave -> [sale, entra] */
const dosDig = n => String(n).padStart(2, '0');
const diaLocal = f => { const x = new Date(f); return isNaN(x) ? '' : `${x.getFullYear()}-${dosDig(x.getMonth()+1)}-${dosDig(x.getDate())}`; };
function sumarConsumo(inv, mv){
  const dia = diaLocal(mv.fecha);
  if(!dia) return;
  let m = inv.dias.get(dia);
  if(!m){ m = new Map(); inv.dias.set(dia, m); }
  mv.items.forEach(l=>{
    const k = invClave(l.material, l.medida);
    const c = m.get(k) || [0, 0];
    c[l.tipo==='salida' ? 0 : 1] += l.cantidad;
    m.set(k, c);
  });
}

function exigirInventario(area){
  if(area.rack.tipo !== 'inventario') throw errorHttp(`${area.nombre} no maneja inventario por material y medida.`);
}

function aplicarAlStock(stock, items){
  items.forEach(l=>{
    const k = invClave(l.material, l.medida);
    const n = (stock.get(k)||0) + (l.tipo==='entrada' ? l.cantidad : -l.cantidad);
    if(n) stock.set(k, n); else stock.delete(k);
  });
}
function stockComoLista(inv){
  const lista = [];
  inv.stock.forEach((cantidad, k)=>{
    if(cantidad<=0) return;
    const [material, medida] = k.split('|');
    // por CodMat (Mallas) no hay lista fija de materiales: va la descripción
    lista.push(inv.nombres ? {material, medida, cantidad, nombre: inv.nombres.get(material) || material} : {material, medida, cantidad});
  });
  return lista;
}
/* Stock por material, en unidades (lo usa la Lista de corte de Mallas). */
function stockPorMaterial(inv){
  const m = new Map();
  inv.stock.forEach((cantidad, k)=>{ if(cantidad>0){ const mat = k.split('|')[0]; m.set(mat, (m.get(mat)||0) + cantidad); } });
  return m;
}
/* La descripción de cada CodMat: la última REAL (una salida escaneada no
   trae descripción y llega con el CodMat como nombre: no pisa la buena). */
const recordarNombres = (inv, items) => {
  if(!inv.nombres) return;
  items.forEach(l=>{ if(l.materialNombre && (l.materialNombre!==l.material || !inv.nombres.has(l.material))) inv.nombres.set(l.material, l.materialNombre); });
};
/* Totales de HOY sobre TODOS los movimientos del día (no solo los últimos
   300). Recorre desde el final hasta el primer movimiento de ayer. */
function totalesDeHoy(inv){
  let sale = 0, entra = 0;
  for(let i=inv.movimientos.length-1; i>=0; i--){
    const mv = inv.movimientos[i];
    if(!esHoy(mv.fecha)) break;
    mv.items.forEach(l=>{ if(l.tipo==='salida') sale += l.cantidad; else entra += l.cantidad; });
  }
  return {sale, entra};
}
/* Valida y normaliza una línea; devuelve {linea} o {error}. */
function lineaInventario(area, it, i){
  const n = `línea ${i+1}`;
  if(!it || (it.tipo!=='entrada' && it.tipo!=='salida')) return {error:`${n}: tipo inválido (entrada o salida)`};
  if(area.rack.porCodmat){
    // Mallas: stock por Desenho_CodMat (sale de SQL, no hay lista fija) y sin medida
    const codmat = codmatCorto(it.material);
    if(!/^\d{1,18}$/.test(codmat)) return {error:`${n}: CodMat inválido "${String(it.material).slice(0, 20)}"`};
    const cantidad = Number(it.cantidad);
    if(!Number.isInteger(cantidad) || cantidad<=0 || cantidad>MAX_CANTIDAD) return {error:`${n}: cantidad inválida "${String(it.cantidad).slice(0, 20)}" (entero de 1 a ${MAX_CANTIDAD})`};
    const nombre = String(it.descripcion || it.materialNombre || '').trim().slice(0, 120) || codmat;
    return {linea:{tipo:it.tipo, material:codmat, materialNombre:nombre, codigo:codmat, medida:'', cantidad}};
  }
  const mat = area.materiales.find(m=>m.id===it.material || (m.alias||[]).includes(it.material));
  if(!mat) return {error:`${n}: material desconocido "${String(it.material).slice(0, 40)}"`};
  const medida = String(it.medida==null?'':it.medida).trim().replace('.', ',');
  if(!mat.medidas.includes(medida)) return {error:`${n}: ${mat.nombre} no tiene medida ${medida.slice(0, 20)||'(vacía)'} mm`};
  const cantidad = Number(it.cantidad);
  if(!Number.isInteger(cantidad) || cantidad<=0 || cantidad>MAX_CANTIDAD) return {error:`${n}: cantidad inválida "${String(it.cantidad).slice(0, 20)}" (entero de 1 a ${MAX_CANTIDAD})`};
  return {linea:{tipo:it.tipo, material:mat.id, materialNombre:mat.nombre, codigo:mat.codigo||null, medida, cantidad}};
}

/* claves viejas de material -> la actual (campo "alias" en areas-config.js). */
function normalizadorDe(area){
  const alias = new Map();
  (area.materiales||[]).forEach(m=>(m.alias||[]).forEach(a=>alias.set(a, m)));
  return items => items.forEach(l=>{
    const m = alias.get(l.material);
    if(m){ l.material = m.id; l.materialNombre = m.nombre; l.codigo = m.codigo||null; }
  });
}

function crear({ datos, notificar }){
  const inventarioPath = area => datos.rutas.inventario(area.id);
  const diarioPath     = area => datos.rutas.diario(area.id);
  const viejoPath      = area => datos.rutas.diarioViejo(area.id);
  const inventarios = new Map(); // área -> {version, stock:Map, movimientos:[], porIdCliente:Map}

  /* Carga (una sola vez por área) el diario y reconstruye el stock. */
  function de(area){
    let inv = inventarios.get(area.id);
    if(inv) return inv;
    // migración única: el historial viejo (JSON con un arreglo) pasa al diario
    const viejo = viejoPath(area), diario = diarioPath(area);
    if(fs.existsSync(viejo) && !fs.existsSync(diario)){
      const lista = leerListaJson(viejo);
      fs.writeFileSync(diario, lista.map(m=>JSON.stringify(m)).join('\n') + (lista.length ? '\n' : ''), 'utf8');
      fs.renameSync(viejo, viejo + '.migrado');
      console.log(`[inventario] ${area.id}: ${lista.length} movimiento(s) migrados a ${path.basename(diario)}`);
    }
    inv = {version:0, stock:new Map(), movimientos:[], dias:new Map(), porIdCliente:new Map(), nombres: area.rack.porCodmat ? new Map() : null};
    // claves viejas de material -> la actual (campo "alias" en areas-config.js).
    // El diario NO se reescribe: la traducción es solo en memoria.
    const normalizar = normalizadorDe(area);
    if(fs.existsSync(diario)){
      const texto = fs.readFileSync(diario, 'utf8');
      // si un apagón cortó la última línea a la mitad, el próximo movimiento
      // se pegaría a ese pedazo y quedaría ilegible: se cierra esa línea
      if(texto && !texto.endsWith('\n')) fs.appendFileSync(diario, '\n', 'utf8');
      let malas = 0;
      texto.split('\n').forEach(t=>{
        if(!t.trim()) return;
        let mv; try { mv = JSON.parse(t); } catch(e){ malas++; return; } // p.ej. una línea cortada por un apagón
        normalizar(mv.items);
        aplicarAlStock(inv.stock, mv.items);
        recordarNombres(inv, mv.items);
        sumarConsumo(inv, mv);
        inv.movimientos.push(mv);
        if(mv.idCliente) inv.porIdCliente.set(mv.idCliente, mv);
        inv.version++;
        recortar(inv);
      });
      if(malas) console.error(`[inventario] ${area.id}: ${malas} línea(s) ilegibles en ${path.basename(diario)} — se saltearon`);
    }
    // stock de un material que ya no está en la lista: no se esconde, se avisa
    // (por CodMat no hay lista fija: cualquier CodMat es válido)
    const conocidos = new Set((area.materiales||[]).map(m=>m.id));
    const huerfanos = area.rack.porCodmat ? [] : [...new Set([...inv.stock.keys()].map(k=>k.split('|')[0]).filter(m=>!conocidos.has(m)))];
    if(huerfanos.length) console.error(`[inventario] ${area.id}: hay stock de material(es) que no están en js/core/areas-config.js: ${huerfanos.join(', ')} — agregalos ahí (o como "alias" del material correcto)`);
    inventarios.set(area.id, inv);
    // la foto legible se guarda con atraso (ver programarFoto): si el puente
    // se cerró en ese segundo quedó vieja, así que se rehace al cargar
    try { escribirListaJson(inventarioPath(area), stockComoLista(inv)); } catch(e){ console.error('[inventario] foto del stock:', e.message); }
    return inv;
  }

  /* La foto legible no es la fuente de verdad (lo es el diario): con mucha
     actividad se guarda como mucho una vez por segundo. */
  const fotosPendientes = new Set();
  function programarFoto(area, inv){
    if(fotosPendientes.has(area.id)) return;
    fotosPendientes.add(area.id);
    setTimeout(()=>{
      fotosPendientes.delete(area.id);
      try { escribirListaJson(inventarioPath(area), stockComoLista(inv)); }
      catch(e){ console.error('[inventario] no se pudo guardar la foto del stock:', e.message); }
    }, 1000);
  }

  /* GET: lo que necesita la pantalla (o {sinCambios} si ya tiene esa versión). */
  function consultar(area, versionCliente){
    exigirInventario(area);
    const inv = de(area);
    if(versionCliente!=null && Number(versionCliente)===inv.version) return { sinCambios: true, version: inv.version };
    return {
      version: inv.version,
      stock: stockComoLista(inv),
      movimientos: inv.movimientos.slice(-RECIENTES).reverse(),
      hoy: totalesDeHoy(inv)
    };
  }

  /* POST: registra un lote. Devuelve {status, cuerpo}. */
  function registrar(area, body, usuario){
    exigirInventario(area);
    const inv = de(area);
    body = body || {};
    const idCliente = typeof body.idCliente==='string' ? body.idCliente.slice(0, 64) : null;
    if(idCliente && inv.porIdCliente.has(idCliente)){
      // el mismo carrito ya se registró (reintento): no se vuelve a aplicar
      return { status: 200, cuerpo: { ok: true, repetido: true, version: inv.version, movimiento: inv.porIdCliente.get(idCliente), stock: stockComoLista(inv), hoy: totalesDeHoy(inv) } };
    }
    const items = body.items || [];
    if(!Array.isArray(items) || !items.length) return { status: 400, cuerpo: { error: 'no hay ningún movimiento para registrar' } };
    if(items.length > MAX_LINEAS) return { status: 400, cuerpo: { error: `demasiadas líneas en un solo lote (máximo ${MAX_LINEAS})` } };

    const errores = [], lineas = [];
    items.forEach((it, i)=>{ const r = lineaInventario(area, it, i); if(r.error) errores.push(r.error); else lineas.push(r.linea); });
    if(errores.length) return { status: 400, cuerpo: { error: 'El lote tiene líneas inválidas — no se registró nada.', detalles: errores } };

    // stock resultante = actual + entradas − salidas, por (material, medida)
    const neto = new Map(), saleTotal = new Map();
    lineas.forEach(l=>{
      const k = invClave(l.material, l.medida);
      neto.set(k, (neto.get(k)||0) + (l.tipo==='entrada' ? l.cantidad : -l.cantidad));
      if(l.tipo==='salida') saleTotal.set(k, (saleTotal.get(k)||0) + l.cantidad);
    });
    const faltantes = [];
    neto.forEach((delta, k)=>{
      const hay = inv.stock.get(k)||0;
      if(hay + delta < 0){
        const l = lineas.find(x=>invClave(x.material, x.medida)===k);
        faltantes.push(`${l.materialNombre}${l.medida ? ` ${l.medida} mm` : ` (${l.material})`}: hay ${hay}, salen ${saleTotal.get(k)}`);
      }
    });
    if(faltantes.length) return { status: 409, cuerpo: { error: 'No alcanza el stock — no se registró nada.', detalles: faltantes, version: inv.version } };

    const movimiento = {
      id: crypto.randomBytes(6).toString('hex'),
      idCliente,
      fecha: new Date().toISOString(),
      usuario,
      nota: String(body.nota || '').trim().slice(0, 200) || null,
      items: lineas
    };
    // primero el diario (si no se puede escribir, el pedido falla y el stock
    // en memoria no se toca); después la memoria; la foto del stock al final
    fs.appendFileSync(diarioPath(area), JSON.stringify(movimiento) + '\n', 'utf8');
    aplicarAlStock(inv.stock, lineas);
    recordarNombres(inv, lineas);
    sumarConsumo(inv, movimiento);
    inv.movimientos.push(movimiento);
    if(idCliente) inv.porIdCliente.set(idCliente, movimiento);
    inv.version++;
    recortar(inv);
    const stock = stockComoLista(inv), hoy = totalesDeHoy(inv);
    programarFoto(area, inv);
    notificar({ tipo:'inventario', area: area.id, version: inv.version, movimiento, stock, hoy });
    return { status: 200, cuerpo: { ok: true, version: inv.version, movimiento, stock, hoy } };
  }

  /* ADMINISTRADOR: borra movimientos del diario (por su id). El stock y el consumo se rehacen
     del diario que queda, así que borrar una entrada de prueba también la quita del stock.
     No se deja borrar si con eso algún stock quedaría negativo en algún momento (ej. una
     entrada cuyas unidades ya salieron): hay que borrar también esas salidas.
     Lo borrado queda guardado en eliminados.jsonl (quién, cuándo y el movimiento completo). */
  function eliminar(area, ids, usuario){
    exigirInventario(area);
    const inv = de(area);
    const quitar = new Set((Array.isArray(ids) ? ids : []).map(x=>String(x)).slice(0, 5000));
    if(!quitar.size) throw errorHttp('No elegiste ningún movimiento.');
    const archivo = diarioPath(area);
    const normalizar = normalizadorDe(area);
    const quedan = [], borrados = [], hallados = new Set();
    (fs.existsSync(archivo) ? fs.readFileSync(archivo, 'utf8') : '').split('\n').forEach(t=>{
      if(!t.trim()) return;
      let mv; try { mv = JSON.parse(t); } catch(e){ quedan.push({ t }); return; } // ilegible: se conserva tal cual
      if(quitar.has(mv.id)){ borrados.push({ t, mv }); hallados.add(mv.id); } else quedan.push({ t, mv });
    });
    if(hallados.size !== quitar.size) throw errorHttp('Alguno de esos movimientos ya no existe (¿lo borró otra PC?). Actualizá la pantalla.', 404);
    // con lo que queda, el stock nunca puede bajar de cero
    const stock = new Map();
    for(const { mv } of quedan){
      if(!mv) continue;
      const items = JSON.parse(JSON.stringify(mv.items || []));
      normalizar(items);
      aplicarAlStock(stock, items);
      const neg = [...stock].find(([, n])=>n < 0);
      if(neg){
        const [material, medida] = neg[0].split('|');
        const nombre = (inv.nombres && inv.nombres.get(material)) || material;
        throw errorHttp(`No se puede: después del movimiento del ${new Date(mv.fecha).toLocaleString('es-CO')} quedaría ${neg[1]} de ${nombre}${medida ? ' ' + medida + ' mm' : ''}. Hay salidas posteriores que dependen de lo que querés borrar: borralas también.`, 409);
      }
    }
    const texto = quedan.map(x=>x.t).join('\n') + (quedan.length ? '\n' : '');
    const tmp = archivo + '.tmp';
    fs.appendFileSync(path.join(path.dirname(archivo), 'eliminados.jsonl'),
      borrados.map(b=>JSON.stringify({ eliminadoPor: usuario, eliminadoEn: new Date().toISOString(), movimiento: b.mv })).join('\n') + '\n', 'utf8');
    fs.writeFileSync(tmp, texto, 'utf8'); fs.renameSync(tmp, archivo);
    // todo se rehace del diario nuevo; la versión sigue subiendo para que ninguna pantalla se quede con una vieja
    const versionAntes = inv.version;
    inventarios.delete(area.id);
    const nuevo = de(area);
    nuevo.version = Math.max(nuevo.version, versionAntes + 1);
    notificar({ tipo: 'inventario', area: area.id, version: nuevo.version, recargar: true });
    return { ok: true, eliminados: borrados.length, version: nuevo.version, stock: stockComoLista(nuevo), hoy: totalesDeHoy(nuevo) };
  }

  /* Consumo del período [desde, hasta] (AAAA-MM-DD, hora local; sin límite si falta uno):
     por (material, medida) cuánto salió y cuánto entró, y los totales de cada día.
     "primerDia" es el día del primer movimiento registrado (para saber desde cuándo hay datos). */
  function consumo(area, { desde, hasta } = {}){
    exigirInventario(area);
    const inv = de(area);
    const valido = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s||'')) ? s : null;
    const d = valido(desde), h = valido(hasta);
    const acum = new Map(), porDia = [];
    let sale = 0, entra = 0;
    const dias = [...inv.dias.keys()].sort();
    dias.forEach(dia=>{
      if((d && dia < d) || (h && dia > h)) return;
      let s = 0, e = 0;
      inv.dias.get(dia).forEach(([sa, en], k)=>{
        const x = acum.get(k) || { sale: 0, entra: 0 };
        x.sale += sa; x.entra += en; acum.set(k, x);
        s += sa; e += en;
      });
      porDia.push({ dia, sale: s, entra: e });
      sale += s; entra += e;
    });
    const filas = [...acum].map(([k, x])=>{ const [material, medida] = k.split('|'); return { material, medida, sale: x.sale, entra: x.entra }; })
      .filter(x=>x.sale || x.entra);
    return { desde: d, hasta: h, version: inv.version, primerDia: dias[0] || null, filas, porDia, totales: { sale, entra } };
  }

  return { de, consultar, consumo, registrar, eliminar, stockPorMaterial: area => stockPorMaterial(de(area)), version: area => de(area).version };
}

module.exports = { crear };
