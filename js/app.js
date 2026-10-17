const APP_VISTAS = {nesting:'viewNesting', repair:'viewRepair', ordenes:'viewOrdenes', rack:'viewRack'};
const APP_TABS   = {nesting:'tabNesting', repair:'tabRepair', ordenes:'tabOrdenes', rack:'tabRack'};
const APP_REQUIERE_LOGIN = {nesting:true, repair:true, ordenes:true, rack:false};
let appVistaActual = null;

function switchView(view){
  // una pestaña que el área activa no tiene (por ej. Nesting en Mallas)
  // no se abre — se cae al Rack, que todas las áreas tienen
  if(typeof areaTieneVista==='function' && !areaTieneVista(view)) view = 'rack';
  if(APP_REQUIERE_LOGIN[view] && typeof authEstaLogueado==='function' && !authEstaLogueado()){
    if(typeof authMostrarLogin==='function') authMostrarLogin();
    return; // se queda donde estaba, no cambia de pestaña
  }
  const cambio = view !== appVistaActual;
  appVistaActual = view;
  Object.keys(APP_VISTAS).forEach(k=>{
    const el = document.getElementById(APP_VISTAS[k]);
    el.style.display = (k===view) ? 'flex' : 'none';
    // entrada suave de la vista (ver .viewEnter en styles.css) — solo
    // cuando de verdad cambia de pestaña, no en cada refresco
    if(k===view && cambio){ el.classList.remove('viewEnter'); void el.offsetWidth; el.classList.add('viewEnter'); }
    document.getElementById(APP_TABS[k]).classList.toggle('active', k===view);
  });
  // Auto-refresco del Rack: solo mientras esa pestaña está activa. Se
  // controla acá (no solo en el click de tabRack) para que también se
  // apague/prenda bien cuando switchView('rack') se llama desde otro
  // lado (ej. auth.js al cerrar sesión).
  if(view==='rack'){ if(typeof rackIniciarPolling==='function') rackIniciarPolling(); }
  else { if(typeof rackDetenerPolling==='function') rackDetenerPolling(); }
}
/* Pantalla de ingreso (login + área) vs. la app en sí. */
function appMostrarApp(vista){
  document.getElementById('loginScreen').hidden = true;
  document.getElementById('appShell').hidden = false;
  switchView(vista || 'rack');
  if((vista||'rack')==='rack' && typeof rackRender==='function') rackRender();
}
function appMostrarIngreso(){
  if(typeof rackDetenerPolling==='function') rackDetenerPolling();
  document.getElementById('appShell').hidden = true;
  document.getElementById('loginScreen').hidden = false;
}

document.getElementById('tabNesting').addEventListener('click', ()=>switchView('nesting'));
document.getElementById('tabRepair').addEventListener('click', ()=>switchView('repair'));
document.getElementById('tabOrdenes').addEventListener('click', ()=>switchView('ordenes'));
document.getElementById('tabRack').addEventListener('click', ()=>{ switchView('rack'); if(typeof rackRender==='function') rackRender(); });

// arranque: con sesión abierta se entra directo; sin sesión, la pantalla de ingreso
if(typeof authEstaLogueado==='function' && authEstaLogueado()) appMostrarApp('ordenes');
else appMostrarIngreso();
