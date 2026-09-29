function switchView(view){
  const views = {nesting:'viewNesting', repair:'viewRepair', ordenes:'viewOrdenes', rack:'viewRack'};
  const tabs  = {nesting:'tabNesting', repair:'tabRepair', ordenes:'tabOrdenes', rack:'tabRack'};
  const requiereLogin = {nesting:true, repair:true, ordenes:true, rack:false};
  if(requiereLogin[view] && typeof authEstaLogueado==='function' && !authEstaLogueado()){
    if(typeof authMostrarLogin==='function') authMostrarLogin();
    return; // se queda donde estaba, no cambia de pestaña
  }
  Object.keys(views).forEach(k=>{
    document.getElementById(views[k]).style.display = (k===view) ? 'flex' : 'none';
    document.getElementById(tabs[k]).classList.toggle('active', k===view);
  });
  // Auto-refresco del Rack: solo mientras esa pestaña está activa. Se
  // controla acá (no solo en el click de tabRack) para que también se
  // apague/prenda bien cuando switchView('rack') se llama desde otro
  // lado (ej. auth.js al cerrar sesión).
  if(view==='rack'){ if(typeof rackIniciarPolling==='function') rackIniciarPolling(); }
  else { if(typeof rackDetenerPolling==='function') rackDetenerPolling(); }
}
document.getElementById('tabNesting').addEventListener('click', ()=>switchView('nesting'));
document.getElementById('tabRepair').addEventListener('click', ()=>switchView('repair'));
document.getElementById('tabOrdenes').addEventListener('click', ()=>switchView('ordenes'));
document.getElementById('tabRack').addEventListener('click', ()=>{ switchView('rack'); if(typeof rackRender==='function') rackRender(); });

