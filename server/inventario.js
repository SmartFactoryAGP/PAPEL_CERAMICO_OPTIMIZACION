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

const MAX_CANTIDAD = 100000;
const MAX_LINEAS = 500;
const RECIENTES = 300;  // movimientos que se mandan a la pantalla
const invClave = (m, d) => m+'|'+d;

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
  inv.stock.forEach((cantidad, k)=>{ if(cantidad>0){ const [material, medida] = k.split('|'); lista.push({material, medida, cantidad}); } });
  return lista;
}
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
  const mat = area.materiales.find(m=>m.id===it.material || (m.alias||[]).includes(it.material));
  if(!mat) return {error:`${n}: material desconocido "${String(it.material).slice(0, 40)}"`};
  const medida = String(it.medida==null?'':it.medida).trim().replace('.', ',');
  if(!mat.medidas.includes(medida)) return {error:`${n}: ${mat.nombre} no tiene medida ${medida.slice(0, 20)||'(vacía)'} mm`};
  const cantidad = Number(it.cantidad);
  if(!Number.isInteger(cantidad) || cantidad<=0 || cantidad>MAX_CANTIDAD) return {error:`${n}: cantidad inválida "${String(it.cantidad).slice(0, 20)}" (entero de 1 a ${MAX_CANTIDAD})`};
  return {linea:{tipo:it.tipo, material:mat.id, materialNombre:mat.nombre, codigo:mat.codigo||null, medida, cantidad}};
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
    inv = {version:0, stock:new Map(), movimientos:[], porIdCliente:new Map()};
    // claves viejas de material -> la actual (campo "alias" en areas-config.js).
    // El diario NO se reescribe: la traducción es solo en memoria.
    const alias = new Map();
    area.materiales.forEach(m=>(m.alias||[]).forEach(a=>alias.set(a, m)));
    const normalizar = items => items.forEach(l=>{
      const m = alias.get(l.material);
      if(m){ l.material = m.id; l.materialNombre = m.nombre; l.codigo = m.codigo||null; }
    });
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
        inv.movimientos.push(mv);
        if(mv.idCliente) inv.porIdCliente.set(mv.idCliente, mv);
      });
      if(malas) console.error(`[inventario] ${area.id}: ${malas} línea(s) ilegibles en ${path.basename(diario)} — se saltearon`);
    }
    // stock de un material que ya no está en la lista: no se esconde, se avisa
    const conocidos = new Set(area.materiales.map(m=>m.id));
    const huerfanos = [...new Set([...inv.stock.keys()].map(k=>k.split('|')[0]).filter(m=>!conocidos.has(m)))];
    if(huerfanos.length) console.error(`[inventario] ${area.id}: hay stock de material(es) que no están en js/core/areas-config.js: ${huerfanos.join(', ')} — agregalos ahí (o como "alias" del material correcto)`);
    inv.version = inv.movimientos.length;
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
        faltantes.push(`${l.materialNombre} ${l.medida} mm: hay ${hay}, salen ${saleTotal.get(k)}`);
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
    inv.movimientos.push(movimiento);
    if(idCliente) inv.porIdCliente.set(idCliente, movimiento);
    inv.version++;
    const stock = stockComoLista(inv), hoy = totalesDeHoy(inv);
    programarFoto(area, inv);
    notificar({ tipo:'inventario', area: area.id, version: inv.version, movimiento, stock, hoy });
    return { status: 200, cuerpo: { ok: true, version: inv.version, movimiento, stock, hoy } };
  }

  return { de, consultar, registrar };
}

module.exports = { crear };
