/* =========================================================
   ELIMINAR REGISTROS DE LOS HISTORIALES — solo el administrador
   =========================================================
   En las tablas de historial/movimientos (Tejidos, Tecoflex, Mallas) el
   administrador ve una casilla en cada fila y el botón "Eliminar
   seleccionados". El puente vuelve a comprobar que sea administrador y deja
   copia de lo borrado (eliminados.jsonl / historial-eliminado.jsonl).
   Cada tabla arma sus filas y usa estas piezas:
     haTh() / haTd(id)  → la columna de casillas (vacía si no es admin)
     haBarra()          → la barra con "N seleccionados · Eliminar"
     haAplicar(id, fn)  → engancha la tabla; fn(ids) hace el borrado
   La selección sobrevive a los redibujos (los avisos en vivo rehacen la tabla). */
const haSeleccion = new Map(); // id del contenedor -> Set de ids elegidos
const haBorrar = new Map();    // id del contenedor -> fn(ids)
const haEsAdmin = () => typeof authEsAdmin==='function' && authEsAdmin();

const haTh = () => haEsAdmin() ? '<th class="haCol"><input type="checkbox" class="haTodos" aria-label="Elegir todos los que se ven"></th>' : '';
const haTd = id => haEsAdmin() ? `<td class="haCol">${id ? `<input type="checkbox" class="haSel" data-id="${escapeHtml(id)}" aria-label="Elegir este registro">` : ''}</td>` : '';
const haBarra = () => haEsAdmin()
  ? '<div class="haBarra" hidden><span class="haCuenta"></span><button type="button" class="haEliminar">Eliminar seleccionados</button><button type="button" class="linkBtn haLimpiar">Quitar selección</button></div>'
  : '';

function haPintar(cont){
  const sel = haSeleccion.get(cont.id) || new Set();
  const visibles = new Set([...cont.querySelectorAll('.haSel')].map(c=>c.dataset.id));
  [...sel].forEach(id=>{ if(!visibles.has(id)) sel.delete(id); }); // lo que ya no está en la tabla, deja de estar elegido
  cont.querySelectorAll('.haSel').forEach(c=>{ c.checked = sel.has(c.dataset.id); });
  const todos = cont.querySelector('.haTodos');
  if(todos){ todos.checked = !!visibles.size && sel.size===visibles.size; todos.indeterminate = sel.size>0 && sel.size<visibles.size; }
  const barra = cont.querySelector('.haBarra');
  if(barra){
    barra.hidden = !sel.size;
    barra.querySelector('.haCuenta').textContent = `${sel.size} seleccionado${sel.size===1 ? '' : 's'}`;
  }
}
/* Llamar después de dibujar la tabla dentro del contenedor. */
function haAplicar(contId, borrarFn){
  const cont = document.getElementById(contId);
  if(!cont || !haEsAdmin()) return;
  haBorrar.set(contId, borrarFn);
  if(!haSeleccion.has(contId)) haSeleccion.set(contId, new Set());
  if(!cont.dataset.haListo){
    cont.dataset.haListo = '1';
    cont.addEventListener('change', ev=>{
      const sel = haSeleccion.get(cont.id);
      if(ev.target.classList.contains('haSel')){ ev.target.checked ? sel.add(ev.target.dataset.id) : sel.delete(ev.target.dataset.id); }
      else if(ev.target.classList.contains('haTodos')){
        cont.querySelectorAll('.haSel').forEach(c=>{ ev.target.checked ? sel.add(c.dataset.id) : sel.delete(c.dataset.id); });
      } else return;
      haPintar(cont);
    });
    cont.addEventListener('click', async ev=>{
      const sel = haSeleccion.get(cont.id);
      if(ev.target.closest('.haLimpiar')){ sel.clear(); haPintar(cont); return; }
      const btn = ev.target.closest('.haEliminar');
      if(!btn || !sel.size) return;
      const n = sel.size;
      if(!confirm(`¿Eliminar ${n} registro${n===1 ? '' : 's'} del historial?\n\nQuedan fuera de las tablas y del consumo. El puente guarda una copia de lo borrado, pero la app no lo puede recuperar.`)) return;
      btn.disabled = true;
      try { await haBorrar.get(cont.id)([...sel]); sel.clear(); }
      catch(e){ alert('No se pudo eliminar: ' + e.message); }
      finally { btn.disabled = false; haPintar(cont); }
    });
  }
  haPintar(cont);
}

/* POST de borrado al puente (movimientos de Tecoflex / Mallas) */
async function haEliminarMovimientos(ids){
  const res = await fetch(ordBridgeUrl()+'/api/inventario/movimientos/eliminar', {
    method:'POST', headers: ordApiHeaders({'Content-Type':'application/json'}), body: JSON.stringify({ ids })
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || ('HTTP '+res.status));
  return data;
}
