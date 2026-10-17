const APP_VISTAS = {nesting:'viewNesting', repair:'viewRepair', ordenes:'viewOrdenes', rack:'viewRack', usuarios:'viewUsuarios'};
const APP_TABS   = {nesting:'tabNesting', repair:'tabRepair', ordenes:'tabOrdenes', rack:'tabRack', usuarios:'tabUsuarios'};
let appVistaActual = null;

function switchView(view){
  // toda la app pide sesión
  if(typeof authEstaLogueado==='function' && !authEstaLogueado()){
    if(typeof authMostrarLogin==='function') authMostrarLogin();
    return;
  }
  // una pestaña que el área no tiene, o que el usuario no tiene habilitada,
  // no se abre: se va a la primera que sí pueda ver
  if(!areaTieneVista(view)) view = areaPrimeraVista();
  if(!view) return;
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
  // Auto-refresco del Rack: solo mientras esa pestaña está activa.
  if(view==='rack'){ if(typeof rackIniciarPolling==='function') rackIniciarPolling(); }
  else { if(typeof rackDetenerPolling==='function') rackDetenerPolling(); }
  if(view==='usuarios' && typeof usrCargar==='function') usrCargar();
}
/* Pantalla de ingreso (login + área) vs. la app en sí. */
function appMostrarApp(vista){
  document.getElementById('loginScreen').hidden = true;
  document.getElementById('appShell').hidden = false;
  switchView(vista || areaPrimeraVista());
  if(appVistaActual==='rack' && typeof rackRender==='function') rackRender();
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
document.getElementById('tabUsuarios').addEventListener('click', ()=>switchView('usuarios'));

// arranque: con sesión guardada se confirma con el puente (por si vencio o
// cambiaron los permisos) y se entra; si no, la pantalla de ingreso
appMostrarIngreso();
authRefrescarSesion().then(sigue=>{
  if(!sigue) return authMostrarLogin();
  if(!authEntrar(areaActualId)){ authBorrarSesion(); authMostrarLogin(); }
});
