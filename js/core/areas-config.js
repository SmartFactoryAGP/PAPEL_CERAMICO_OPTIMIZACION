/* =========================================================
   ÁREAS DE TRABAJO — Materiales Semiterminados
   =========================================================
   Única fuente de verdad de qué tiene cada área: qué pestañas ve, cómo
   es su Rack, y (Tecoflex) sus posiciones y materiales. Lo carga el
   navegador como un <script> más (AREAS_CONFIG queda global) Y lo lee el
   puente (server.js, con require) para validar lo que llega — así las
   listas de posiciones y materiales nunca quedan distintas entre los dos.

   rack.tipo:
   - 'casillas':   una orden por casilla, se asigna sola la próxima libre
                   (A1, A2 ... G20), como en papel cerámico y mallas.
   - 'inventario': no va por órdenes. Es un stock por MATERIAL y MEDIDA
                   (mm) con entradas y salidas en cantidad (Tecoflex).
                   Cada material dice qué medidas tiene; el "id" de cada
                   material es la llave con que se guarda el stock en el
                   puente, así que NO se cambia una vez en uso (el nombre
                   sí se puede corregir sin perder nada).
                   Con porCodmat (Mallas): el stock es por Desenho_CodMat,
                   sin medidas ni lista fija de materiales.
   - 'posiciones': una pieza por posición con nombre (A1.1, B12.1…), cada
                   posición de un tamaño (Tejidos). Las posiciones y los
                   tamaños viven en server/datos/<área>/ (ver server/tejidos.js).
   listaPorCodmat: la Lista de corte va por CodMat y no por orden (Mallas, Tejidos).
   ========================================================= */
(function(){
  // medidas generales de Tecoflex: de 9 a 70 mm
  const medidas9a70 = [];
  for(let mm=9; mm<=70; mm++) medidas9a70.push(String(mm));

  const AREAS_CONFIG = {
    orden: ['papel', 'tecoflex', 'mallas', 'tejidos'],
    porDefecto: 'papel',
    areas: {
      papel: {
        id: 'papel',
        nombre: 'Papel cerámico',
        resumen: 'Nesting de DXF, rack A1–G20 y editor de archivos',
        // 'aprobaciones': pestaña para pedir que un ZFER CURVE 02–04 lleve papel.
        // 'aprobar': no es una pestaña, es el permiso de aprobar o rechazar esos pedidos.
        vistas: ['ordenes', 'nesting', 'rack', 'repair', 'aprobaciones', 'aprobar'],
        aprobacionZfer: true,
        nesting: true,
        stickers: true,
        rackSql: true, // es la única con tabla de control en SQL (NestingControlCorte)
        rack: { tipo: 'casillas', letras: ['A','B','C','D','E','F','G'], porLetra: 20 }
      },
      tecoflex: {
        id: 'tecoflex',
        nombre: 'Tecoflex',
        resumen: 'Inventario por material y medida: entradas y salidas',
        vistas: ['ordenes', 'nesting', 'rack'],
        nesting: true,
        listaCorte: false, // por ahora Tecoflex no maneja órdenes: Lista de corte queda vacía
        stickers: false,   // pedido explícito: Tecoflex no usa sticker
        rackSql: false,
        rack: { tipo: 'inventario', unidad: 'mm' },
        // id = código de material SAP (fijo y único: es la llave del stock)
        materiales: [
          // 100004045 es el de X5: solo estas medidas (pedido explícito)
          // "corto" es lo que se ve en tablas y carrito, donde no entra el nombre entero
          { id:'100004045', codigo:'100004045', nombre:'Tecoflex Rombos 1,27',   corto:'Teco Rombos 1,27 (X5)', medidas: ['6,5','12','16','20','21','28'] },
          { id:'100003239', codigo:'100003239', nombre:'Tecoflex Liso L2',       corto:'Teco Liso L2',          medidas: medidas9a70 },
          { id:'100003554', codigo:'100003554', nombre:'PU Tenflex 1,27 Rombos', corto:'PU 1,27 Rombos',        medidas: medidas9a70 },
          { id:'100003550', codigo:'100003550', nombre:'PU Tenflex 1,91 Liso',   corto:'PU 1,91 Liso',          medidas: medidas9a70 },
          { id:'100003577', codigo:'100003577', nombre:'PU Tenflex 1,91 Rombos', corto:'PU 1,91 Rombos',        medidas: medidas9a70 },
          // alias: claves viejas de este mismo material (antes de usar el código
          // SAP, el PU se guardaba como 'pu'); el puente las traduce al cargar
          { id:'100005343', codigo:'100005343', nombre:'PU',                     corto:'PU',                    medidas: medidas9a70, alias:['pu'] }
        ]
      },
      mallas: {
        id: 'mallas',
        nombre: 'Mallas',
        resumen: 'Qué fabricar por CodMat y stock con sticker por malla',
        vistas: ['ordenes', 'rack'],
        nesting: false,
        stickers: true,
        rackSql: false,
        // stock por Desenho_CodMat (sale de SAGA, sin lista fija) en vez de
        // una orden por casilla: se da entrada a lo fabricado (un sticker por
        // malla) y el stock se descuenta de la necesidad de Lista de corte
        listaPorCodmat: true, // Lista de corte por CodMat (no por orden), con lo que falta
        rack: { tipo: 'inventario', porCodmat: true },
        pieza: { una: 'malla', varias: 'mallas' }   // cómo se nombra cada unidad en pantalla
      },
      // Tejidos: la Lista de corte es igual que Mallas (por CodMat, necesidad
      // por puesto; materiales PVTE, PUTE o "tejido", ver server/queries.js).
      // El rack, en cambio, es por POSICIONES (A1.1, B12.1…): un tejido por
      // posición, de su tamaño (P, G, XG) o uno más grande si no hay lugar;
      // se da entrada uno a uno (también desde el celular) con foto del
      // calentamiento, responsables y resistencias (ver server/tejidos.js).
      tejidos: {
        id: 'tejidos',
        nombre: 'Tejidos',
        resumen: 'PVTE, PUTE y tejidos: rack por posición, con foto y sticker',
        vistas: ['ordenes', 'rack'],
        nesting: false,
        stickers: true,
        rackSql: false,
        listaPorCodmat: true,
        rack: { tipo: 'posiciones', tamanos: ['P', 'G', 'XG'] },   // de menor a mayor
        pieza: { una: 'tejido', varias: 'tejidos' }
      }
    }
  };

  if(typeof module !== 'undefined' && module.exports) module.exports = AREAS_CONFIG;
  else (typeof window !== 'undefined' ? window : self).AREAS_CONFIG = AREAS_CONFIG;
})();
