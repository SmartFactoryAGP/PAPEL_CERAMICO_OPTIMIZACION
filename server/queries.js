/* =========================================================
   TUS CONSULTAS SQL — este archivo es tuyo (copia de trabajo)
   =========================================================
   Server.js (el "motor") puede cambiar en futuras actualizaciones de la
   app (arreglo de bugs, endpoints nuevos, etc.) — este archivo NUNCA se
   va a pisar en esas actualizaciones. Separé las consultas acá adentro
   justo por eso: para que actualizar la app no te haga perder el trabajo
   de completar los nombres reales de tu tabla y tus columnas.

   Diseño: tu vista real (SAGA_View_Ficha_Componentes_Colombia) es el
   catálogo de componentes — de ahí sale qué hay para cortar, y en
   Desenho_Path la RUTA del DXF de cada uno (no está guardado
   adentro de SQL, es un archivo de red — por eso DXF_SOURCE=file en el
   .env).

   La consulta de "pendientes" es SOLO LECTURA de esa vista — no
   necesita ninguna tabla nueva ni permiso de escritura en tu SQL. El
   seguimiento de "esto ya se cortó, quedó en tal rack" lo maneja la app
   en el navegador (mientras tengas tildado "Simular el Rack" en la
   app) — no hace falta crear nada en tu base para eso.

   Las consultas marcarEnStock / rackActual / rackSalida más abajo SÍ
   suponen una tabla nueva (NestingControlCorte, ver
   server/sql/crear_tabla_control.sql) — pero mientras "Simular el Rack"
   esté tildado en la app, esas 3 consultas NUNCA se usan. Si el día de
   mañana conseguís permiso para crear esa tabla y destildás la casilla,
   ahí sí empiezan a usarse.

   *** Cuando reemplaces los demás archivos por una versión nueva de la
   app, NO reemplaces este archivo (ni tu .env) — dejalo tal cual lo
   tenés. ***
   ========================================================= */
module.exports = {

  /* Lista de órdenes pendientes de cortar: componentes del catálogo,
     con Operation='0132' y en un centro de trabajo de corte.
     SOLO LECTURA de tu vista real — no depende de ninguna tabla nueva,
     así que no hace falta ningún permiso de escritura ni crear nada en
     tu SQL. Qué ya se cortó y dónde quedó en el rack lo maneja la app
     en el navegador (mientras tengas tildado "Simular el Rack") —
     esta consulta no sabe nada de eso, ni falta que le haga.
     Estas son las columnas que pediste mostrar en la tabla, con sus
     nombres reales tal cual. */
  ordenesPendientes: `
    SELECT
      v.Desenho_OrdemSerial AS "Ordem_Serial",
      v.Desenho_Operation   AS "Operation",
      v.Centro_Trabalho     AS "Centro_Trabalho",
      v.Desenho_ClaveModelo AS "ClaveModelo",
      v.Desenho_CodMat      AS "CodMat",
      v.Desenho_Name        AS "Name",
      v.Desenho_ZTipo       AS "ZTipo",
      v.Desenho_Descricao   AS "Descricao",
      v.Desenho_Path        AS "ARCHIVO"        -- la ruta real del DXF (Desenho_Descricao es solo texto, no la uses para buscar el archivo)
    FROM dbo.SAGA_View_Ficha_Componentes_Colombia v
    WHERE v.Desenho_Operation = '0132'
      AND v.Centro_Trabalho IN ('01CORTE','02CNC','03SERIG','04SER_VT')
    ORDER BY v.Desenho_OrdemSerial ASC
  `,

  /* Búsqueda de UNA orden puntual por su número, para el "Ingreso
     rápido" de Lista de corte: a propósito NO filtra por
     Centro_Trabalho ni por Puestodetrabajo (eso se resuelve aparte, en
     server.js, dejando pasar aunque Puestodetrabajo venga en blanco) —
     la ÚNICA condición que se mantiene es Operation='0132', para no
     traer una orden de otra operación por error. Así, una orden que la
     consulta de arriba no trae (por ejemplo porque todavía no tiene
     Puestodetrabajo cargado) se puede seguir agregando a mano si el
     programador conoce el número, con su archivo/ruta real igual. */
  ordenPorSerial: `
    SELECT
      v.Desenho_OrdemSerial AS "Ordem_Serial",
      v.Desenho_Operation   AS "Operation",
      v.Centro_Trabalho     AS "Centro_Trabalho",
      v.Desenho_ClaveModelo AS "ClaveModelo",
      v.Desenho_CodMat      AS "CodMat",
      v.Desenho_Name        AS "Name",
      v.Desenho_ZTipo       AS "ZTipo",
      v.Desenho_Descricao   AS "Descricao",
      v.Desenho_Path        AS "ARCHIVO"
    FROM dbo.SAGA_View_Ficha_Componentes_Colombia v
    WHERE v.Desenho_OrdemSerial = @orden
      AND v.Desenho_Operation = '0132'
  `,

  /* Órdenes de un "Código_Lote" de vidrios (dbo.DF_SAGA_LotesVidro) — se
     usa para agregar de una todas las órdenes de un lote al "lote de
     corte" de la app, en vez de escribirlas una por una en el ingreso
     rápido. SOLO LECTURA de dos vistas/tablas ya existentes, ningún
     JOIN nuevo escribe nada.

     - Mismo criterio que ordenPorSerial de arriba: NO filtra por
       Centro_Trabalho ni por Puestodetrabajo (eso lo resuelve
       server.js aparte, con traerPuestosDeTrabajo, dejando pasar
       aunque venga en blanco) — la única condición que se mantiene es
       Operation='0132', para no traer una orden de otra operación.
     - DF_SAGA_LotesVidro puede traer más de una fila para la MISMA
       orden dentro de un mismo Código_Lote (por ejemplo, un
       Ponto_Medicao distinto por fila) — el JOIN multiplicaría esas
       filas, así que se usa DISTINCT sobre las columnas que en
       realidad se muestran (todas vienen de la vista v, que es 1 fila
       por orden) para que cada orden aparezca una sola vez. Si la
       MISMA orden aparece en OTRO Código_Lote distinto en otra
       consulta, ese dedupe es tarea de la app (orders.js ya lo hace
       al agregar al lote actual, sea cual sea el origen). */
  ordenesPorLote: `
    SELECT DISTINCT
      v.Desenho_OrdemSerial AS "Ordem_Serial",
      v.Desenho_Operation   AS "Operation",
      v.Centro_Trabalho     AS "Centro_Trabalho",
      v.Desenho_ClaveModelo AS "ClaveModelo",
      v.Desenho_CodMat      AS "CodMat",
      v.Desenho_Name        AS "Name",
      v.Desenho_ZTipo       AS "ZTipo",
      v.Desenho_Descricao   AS "Descricao",
      v.Desenho_Path        AS "ARCHIVO"
    FROM dbo.DF_SAGA_LotesVidro l
    JOIN dbo.SAGA_View_Ficha_Componentes_Colombia v ON v.Desenho_OrdemSerial = l.Ordem_Serial
    WHERE l.Codigo_Lote = @lote
      AND v.Desenho_Operation = '0132'
  `,

  /* El DXF vive en una carpeta de red (la ruta viene de Desenho_Path en
     la consulta de arriba), no adentro de SQL — con DXF_SOURCE=file en
     tu .env, server.js no usa esta consulta para nada. La dejo acá
     solo por si en algún momento volvés a tener el contenido en la base. */
  dxfPorOrden: `
    SELECT Desenho_Path AS contenido
    FROM dbo.SAGA_View_Ficha_Componentes_Colombia
    WHERE Desenho_OrdemSerial = @orden
  `,

  /* Datos completos (mismas columnas de siempre) de una LISTA puntual
     de números de orden, tomando puntualmente la fila
     Operation=@opFiltro de cada una — se usa para las órdenes que
     llegan por el camino de ZFER='70005171' (ver server.js,
     traerOrdenesConZferEspecial/buscarOrdenesPorSerial): la MISMA
     orden puede tener otra fila con Operation='0132' (u otra) y un
     Desenho_Path distinto en tu vista, y esa NO es la que corresponde
     acá — la ruta de archivo tiene que salir específicamente de la
     fila Operation='0101'. El "{{LISTA}}" lo completa server.js con
     los @zs0,@zs1... según cuántas órdenes sean (mismo patrón que ya
     usa el BUSCARV de Puestodetrabajo); @opFiltro lo manda server.js
     también (hoy siempre '0101', ver OPERATION_PARA_ORDENES_ZFER) —
     ninguno de los dos se toca a mano acá. */
  ordenesPorSerialLista: `
    SELECT
      v.Desenho_OrdemSerial AS "Ordem_Serial",
      v.Desenho_Operation   AS "Operation",
      v.Centro_Trabalho     AS "Centro_Trabalho",
      v.Desenho_ClaveModelo AS "ClaveModelo",
      v.Desenho_CodMat      AS "CodMat",
      v.Desenho_Name        AS "Name",
      v.Desenho_ZTipo       AS "ZTipo",
      v.Desenho_Descricao   AS "Descricao",
      v.Desenho_Path        AS "ARCHIVO"
    FROM dbo.SAGA_View_Ficha_Componentes_Colombia v
    WHERE v.Desenho_OrdemSerial IN ({{LISTA}})
      AND v.Desenho_Operation = @opFiltro
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
      v.Desenho_OrdemSerial AS "Ordem_Serial",
      v.Desenho_Operation   AS "Operation",
      v.Centro_Trabalho     AS "Centro_Trabalho",
      v.Desenho_ClaveModelo AS "ClaveModelo",
      v.Desenho_CodMat      AS "CodMat",
      v.Desenho_Name        AS "Name",
      v.Desenho_ZTipo       AS "ZTipo",
      v.Desenho_Descricao   AS "Descricao",
      v.Desenho_Path        AS "ARCHIVO",
      c.Rack                AS ubicacion
    FROM dbo.NestingControlCorte c
    JOIN dbo.SAGA_View_Ficha_Componentes_Colombia v ON v.Desenho_OrdemSerial = c.OrdenSerial
    WHERE c.Estado = 'STOCK'
    ORDER BY c.Rack ASC
  `,

  /* Sacar una orden del rack (ya se usó el material). */
  rackSalida: `
    UPDATE dbo.NestingControlCorte
    SET Estado = 'CONSUMIDO', FechaSalida = GETDATE()
    WHERE OrdenSerial = @orden
  `,

  /* Puestodetrabajo (y ahora también ZFER) vienen de OTRO servidor SQL
     (el de Calendario, ver CAL_DB_* en tu .env) — no de este. server.js
     arma la consulta solo con estos datos: la tabla, la columna que
     hace de "orden" para comparar contra Desenho_OrdemSerial, la
     columna que trae Puestodetrabajo, y la columna que trae ZFER. Es
     como un BUSCARV entre las dos bases.
     columnaZfer: TODO — confirmá que la columna en
     TCAL_CALENDARIO_COLOMBIA_DIRECT se llama literalmente "ZFER"; si
     tiene otro nombre real en tu tabla, cambialo acá (una sola línea,
     no hace falta tocar server.js). Si la dejás vacía o null, ese
     bloque queda desactivado solo (no agrega ninguna orden por ZFER),
     sin romper el resto de Lista de corte. */
  puestoDeTrabajo: {
    tabla: 'dbo.TCAL_CALENDARIO_COLOMBIA_DIRECT',
    columnaOrden: 'Orden',
    columnaPuesto: 'Puestodetrabajo',
    columnaZfer: 'ZFER'
  }
};
