/* =========================================================
   PLANTILLA DE CONSULTAS SQL
   =========================================================
   Copiá este archivo a "queries.js" (sin el ".example") y completá con
   los nombres reales de tu base. Server.js (el "motor") puede cambiar
   en futuras actualizaciones de la app — queries.js nunca se pisa.

   Diseño recomendado: tu tabla real de órdenes/lotes es el catálogo de
   qué hay para cortar (y de ahí sale el DXF de cada una). El
   seguimiento de "esto ya se cortó, quedó en tal rack" vive en una
   tabla NUEVA y chica aparte (ver server/sql/crear_tabla_control.sql)
   — así nunca hace falta tocar tu tabla real. Una orden es "pendiente"
   si existe en el catálogo pero todavía no tiene fila en la tabla de
   control.
   ========================================================= */
module.exports = {

  /* Lista de órdenes pendientes de cortar: lo que existe en tu catálogo
     pero todavía no tiene fila en la tabla de control.
     TODO: nombre real de tu tabla/vista de órdenes, tus columnas, y el
     nombre que le hayas puesto a la tabla de control si no es
     "NestingControlCorte". */
  ordenesPendientes: `
    SELECT
      v.Orden          AS "Ordem_Serial",
      v.OrdenPos        AS "Ordem_Pos",       -- TODO: si no tenés esta columna, sacá la línea
      v.Clase           AS "Classe",          -- TODO: columna real (o la más parecida que tengas)
      v.Archivo         AS "ARCHIVO"          -- TODO: solo hace falta si DXF_SOURCE=file
      ,v.NumeroDeParte   AS "PartnumberAGP"   -- TODO
      ,v.Modelo          AS "ClaveModelo"     -- TODO
    FROM dbo.TuTablaDeOrdenes v               -- TODO: nombre real de tu tabla/vista
    LEFT JOIN dbo.NestingControlCorte c ON c.OrdenSerial = v.Orden
    WHERE c.OrdenSerial IS NULL
      -- AND v.Modelo = 'TU_FILTRO'           -- TODO: si necesitás filtrar por un modelo/clave específica, descomentá y completá
    ORDER BY v.Orden ASC
  `,

  /* Búsqueda de UNA orden puntual por su número, para el "Ingreso
     rápido" de Lista de corte — cuando el programador conoce el
     número de una orden que la consulta de arriba no trajo (por
     ejemplo por algún filtro adicional que le hayas puesto), esto la
     busca directo, sin esos filtros extra, para poder agregarla igual
     al lote con su archivo/ruta real.
     TODO: mismo TuTablaDeOrdenes/columnas de arriba, sin el JOIN contra
     la tabla de control (acá interesa encontrarla exista o no una fila
     de control todavía). */
  ordenPorSerial: `
    SELECT
      v.Orden          AS "Ordem_Serial",
      v.Archivo        AS "ARCHIVO"          -- TODO: solo hace falta si DXF_SOURCE=file
      ,v.Modelo         AS "ClaveModelo"     -- TODO
    FROM dbo.TuTablaDeOrdenes v               -- TODO: nombre real de tu tabla/vista
    WHERE v.Orden = @orden
  `,

  /* OPCIONAL: órdenes de un "código de lote" (una tabla que agrupa
     varias órdenes bajo un mismo código, ej. dbo.DF_SAGA_LotesVidro) —
     se usa para agregar de una todas las órdenes de un lote al "lote
     de corte" de la app, en vez de escribirlas una por una. Si no
     tenés una tabla así, podés borrar este bloque entero (el botón
     "Agregar por código de lote" en la app simplemente no va a
     encontrar nada, sin romper el resto).
     TODO: nombre real de tu tabla de lotes, su columna de código de
     lote, y su columna de número de orden (para el JOIN contra
     TuTablaDeOrdenes). Si esa tabla puede traer más de una fila por la
     MISMA orden dentro del mismo lote, dejá el DISTINCT. */
  ordenesPorLote: `
    SELECT DISTINCT
      v.Orden          AS "Ordem_Serial",
      v.Archivo        AS "ARCHIVO"          -- TODO: solo hace falta si DXF_SOURCE=file
      ,v.Modelo         AS "ClaveModelo"     -- TODO
    FROM dbo.TuTablaDeLotes l                 -- TODO: nombre real de tu tabla de lotes
    JOIN dbo.TuTablaDeOrdenes v ON v.Orden = l.CodigoOrden  -- TODO: columna de orden en la tabla de lotes
    WHERE l.CodigoLote = @lote                -- TODO: columna de código de lote
  `,

  /* Contenido del DXF de una orden, guardado ADENTRO de tu tabla (no en
     un archivo de carpeta compartida) — usalo si DXF_SOURCE=sql.
     TODO: tabla, columna del DXF, y columna de orden reales. */
  dxfPorOrden: `
    SELECT ArchivoDXF AS contenido
    FROM dbo.TuTablaDeOrdenes
    WHERE Orden = @orden
  `,

  /* OPCIONAL: datos completos de una LISTA puntual de números de orden,
     tomando la fila de una Operation puntual (@opFiltro) de cada una —
     se usa para sumar a Lista de corte órdenes que entran por otro
     camino (ver columnaZfer, más abajo) y cuyo archivo/ruta correcto
     sale de OTRA Operation, no la normal. Si tu tabla no tiene varias
     filas por orden (una por Operation), podés sacar el "AND ... =
     @opFiltro" de abajo. Si no usás este camino, podés dejar esto tal
     cual (no se llama nunca). El "{{LISTA}}" y "@opFiltro" los
     completa server.js solo, no se tocan a mano. */
  ordenesPorSerialLista: `
    SELECT
      v.Orden          AS "Ordem_Serial",
      v.Archivo        AS "ARCHIVO"          -- TODO: solo hace falta si DXF_SOURCE=file
      ,v.Modelo         AS "ClaveModelo"     -- TODO
    FROM dbo.TuTablaDeOrdenes v               -- TODO: nombre real de tu tabla/vista
    WHERE v.Orden IN ({{LISTA}})
      AND v.Operation = @opFiltro             -- TODO: columna real de Operation (o sacá esta línea)
  `,

  /* Marcar una orden como cortada: crea/actualiza su fila en la tabla
     de control. Si no mandás un rack explícito, calcula solo la
     próxima ubicación libre (A1, A2, ... A9, B1, ...). Si ya estaba en
     'STOCK', no hace nada (evita pisar en silencio). */
  marcarEnStock: `
    DECLARE @n INT = (SELECT COUNT(*) FROM dbo.NestingControlCorte WHERE Estado = 'STOCK');
    DECLARE @rackCalc VARCHAR(20) = CONCAT(CHAR(65 + (@n / 9)), (@n % 9) + 1);

    MERGE dbo.NestingControlCorte AS target
    USING (SELECT @orden AS OrdenSerial) AS src
    ON target.OrdenSerial = src.OrdenSerial
    WHEN MATCHED AND target.Estado <> 'STOCK' THEN
      UPDATE SET Estado = 'STOCK', Rack = COALESCE(@rack, @rackCalc), FechaCorte = GETDATE()
    WHEN NOT MATCHED THEN
      INSERT (OrdenSerial, Estado, Rack, FechaCorte)
      VALUES (@orden, 'STOCK', COALESCE(@rack, @rackCalc), GETDATE());

    SELECT Rack AS ubicacion FROM dbo.NestingControlCorte WHERE OrdenSerial = @orden;
  `,

  /* Órdenes que están ahora mismo en el rack. */
  rackActual: `
    SELECT
      v.Orden         AS "Ordem_Serial",
      v.OrdenPos      AS "Ordem_Pos",     -- TODO: mismo criterio que ordenesPendientes
      v.Clase         AS "Classe",
      v.NumeroDeParte AS "PartnumberAGP",
      v.Modelo        AS "ClaveModelo",
      c.Rack          AS ubicacion
    FROM dbo.NestingControlCorte c
    JOIN dbo.TuTablaDeOrdenes v ON v.Orden = c.OrdenSerial   -- TODO: nombre real de tu tabla/vista
    WHERE c.Estado = 'STOCK'
    ORDER BY c.Rack ASC
  `,

  /* Sacar una orden del rack (ya se usó el material). */
  rackSalida: `
    UPDATE dbo.NestingControlCorte
    SET Estado = 'CONSUMIDO', FechaSalida = GETDATE()
    WHERE OrdenSerial = @orden
  `,

  /* Opcional: si tenés un Puestodetrabajo (o dato parecido) en OTRO
     servidor SQL, completá esto y las variables CAL_DB_* del .env.example
     — server.js arma solo un BUSCARV entre las dos bases. Si no lo
     necesitás, dejalo como está: sin CAL_DB_SERVER configurado, esto
     nunca se usa. */
  puestoDeTrabajo: {
    tabla: 'dbo.TuTablaDeCalendario',   // TODO
    columnaOrden: 'Orden',              // TODO: columna que compara contra Ordem_Serial
    columnaPuesto: 'Puestodetrabajo',   // TODO
    columnaZfer: null                   // TODO opcional: columna de ZFER en esa misma tabla, o null/'' si no aplica
  }
};
