/* SQL Server SIMULADO para las pruebas (reemplaza al paquete "mssql" en la
   copia temporal de la app). Contesta las consultas REALES de
   server/queries.js con datos inventados (archivo JSON en FAKE_SQL_DATOS):
     { saga: [{Ordem_Serial, Operation, ClaveModelo, ARCHIVO, ...}],
       calendario: [{orden, puesto, zfer, planCurve, nivel, vehiculo}],
       lotes: { "<codigo>": ["<orden>", ...] } }
   Reconoce cada consulta por los parámetros que recibe, igual que la base
   real: @cal* / @zfer* (Calendario), @orden, @lote, @opFiltro + @zs*. */
const fs = require('fs');
const datos = () => JSON.parse(fs.readFileSync(process.env.FAKE_SQL_DATOS, 'utf8')); // se relee: la prueba lo puede cambiar
const valores = (params, prefijo) => Object.keys(params).filter(k=>new RegExp('^'+prefijo+'\\d+$').test(k)).map(k=>params[k]);

function responder(texto, params){
  const d = datos();
  const s = String;
  if(valores(params, 'cal').length){ // BUSCARV de Calendario
    const pedidas = new Set(valores(params, 'cal'));
    return d.calendario.filter(c=>pedidas.has(s(c.orden))).map(c=>({ orden: c.orden, puesto: c.puesto, zfer: c.zfer, planCurve: c.planCurve, nivel: c.nivel, vehiculo: c.vehiculo }));
  }
  if(valores(params, 'fk').length){ // nombre correcto de componentes (ODATA_Fullkit), por código con o sin ceros
    if(d.fullkitCaido) throw new Error('sql-falso: ODATA_Fullkit no responde (simulado)');
    const buscados = new Set([...valores(params, 'fk'), ...valores(params, 'fs')]);
    return (d.fullkit||[]).filter(x=>buscados.has(s(x.COMPONENTE))).map(x=>({ codigo: x.COMPONENTE, nombre: x.DESCRIP_COMPONENTE }));
  }
  if(valores(params, 'zfer').length){ // órdenes por ZFER (X5 y aprobados)
    const z = new Set(valores(params, 'zfer'));
    return d.calendario.filter(c=>z.has(s(c.zfer))).map(c=>({ orden: c.orden }));
  }
  const de0132 = d.saga.filter(f=>f.Operation==='0132');
  if('opFiltro' in params){ const pedidas = new Set(valores(params, 'zs')); return d.saga.filter(f=>pedidas.has(s(f.Ordem_Serial)) && f.Operation===params.opFiltro); }
  if('orden' in params) return de0132.filter(f=>s(f.Ordem_Serial)===params.orden);
  if('lote' in params){ const del = new Set((d.lotes||{})[params.lote]||[]); return de0132.filter(f=>del.has(s(f.Ordem_Serial))); }
  if(/Desenho_Operation = '2900'/.test(texto)){ // Mallas: Operation 2900, UND, "TNT" (como la consulta real)
    if(process.env.FAKE_SQL_CONTEO){
      let c = {}; try { c = JSON.parse(fs.readFileSync(process.env.FAKE_SQL_CONTEO, 'utf8')); } catch(e){}
      c.mallas = (c.mallas||0) + 1; fs.writeFileSync(process.env.FAKE_SQL_CONTEO, JSON.stringify(c));
    }
    // como la consulta REAL: descripción LIKE '%X%' (TNT, PVTE...) O código LIKE '0000000006%'
    const patrones = [...texto.matchAll(/Desenho_Descricao LIKE '%([^%']+)%'/g)].map(m=>m[1].toUpperCase());
    const prefijos = [...texto.matchAll(/Desenho_CodMat LIKE '([^%']+)%'/g)].map(m=>m[1]);
    return (d.mallas||[]).filter(f=>f.Operation==='2900' && String(f.unMed||'UND').trim()==='UND'
        && (patrones.some(x=>String(f.Descricao).toUpperCase().includes(x)) || prefijos.some(x=>String(f.CodMat).startsWith(x))))
      .map(f=>({ Ordem_Serial: f.Ordem_Serial, CodMat: f.CodMat, Descricao: f.Descricao, Cantidad: f.m2 }));
  }
  if(/Desenho_Operation = '0132'/.test(texto)){ // la consulta grande: lista de pendientes
    if(process.env.FAKE_SQL_CONTEO){ // cuántas veces llegó a "SQL" (lo mira la prueba)
      let n = 0; try { n = JSON.parse(fs.readFileSync(process.env.FAKE_SQL_CONTEO, 'utf8')).lista; } catch(e){}
      fs.writeFileSync(process.env.FAKE_SQL_CONTEO, JSON.stringify({ lista: n + 1 }));
    }
    if(d.fallar) throw new Error('sql-falso: SQL caído (simulado)');
    return de0132;
  }
  throw new Error('sql-falso: consulta no reconocida:\n' + texto);
}
function nuevoPool(){
  return {
    request(){
      const params = {};
      const req = {
        input(nombre, tipo, valor){ params[nombre] = valor; return req; },
        async query(texto){ const recordset = responder(texto, params).map(f=>Object.assign({}, f)); return { recordset, rowsAffected: [recordset.length] }; },
      };
      return req;
    },
    async close(){},
  };
}
module.exports = {
  VarChar: 'VarChar',
  connect: async ()=>nuevoPool(),
  ConnectionPool: class { connect(){ return Promise.resolve(nuevoPool()); } },
};
