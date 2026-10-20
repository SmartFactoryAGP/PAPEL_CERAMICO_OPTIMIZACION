/* =========================================================
   PROPUESTA (no está en uso) — racks de Materiales Semiterminados en SQL Server
   =========================================================
   Hoy estos datos viven en archivos en server/datos/ (ver DATOS.md).
   Para pasarlos acá: tools/migracion/migrar-a-sql.js (ver su README).
   Si se decide pasarlos a SQL, esta es la estructura propuesta:

   - una base PROPIA de la app (no dentro de SAGA ni Calendario), con un
     usuario que tenga permiso de escritura SOLO sobre ella;
   - tablas INDEPENDIENTES por rack (papel, mallas, tecoflex): cada una se
     puede respaldar, restaurar o vaciar sin tocar las otras;
   - el historial y los movimientos solo se agregan (nunca se modifican),
     para que la trazabilidad no se pueda alterar.
   ========================================================= */

CREATE SCHEMA rack;
GO

/* ---------- Usuarios y permisos ---------- */
CREATE TABLE rack.Usuarios (
  Usuario        NVARCHAR(40)  NOT NULL PRIMARY KEY,
  ClaveHash      CHAR(128)     NOT NULL,           -- scrypt, nunca la clave en texto
  ClaveSal       CHAR(32)      NOT NULL,
  EsAdmin        BIT           NOT NULL DEFAULT 0,
  Activo         BIT           NOT NULL DEFAULT 1,
  Creado         DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
  Actualizado    DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);
CREATE TABLE rack.Permisos (
  Usuario        NVARCHAR(40)  NOT NULL REFERENCES rack.Usuarios(Usuario) ON DELETE CASCADE,
  Area           VARCHAR(20)   NOT NULL,           -- papel | tecoflex | mallas
  Vista          VARCHAR(20)   NOT NULL,           -- ordenes | nesting | rack | repair | aprobaciones | aprobar
  PRIMARY KEY (Usuario, Area, Vista)
);

/* ---------- Rack de PAPEL CERÁMICO (por orden, casillas A1…G20) ---------- */
CREATE TABLE rack.PapelRack (
  OrdenSerial    VARCHAR(50)   NOT NULL PRIMARY KEY,
  Ubicacion      VARCHAR(10)   NOT NULL UNIQUE,    -- una orden por casilla
  DatosOrden     NVARCHAR(MAX) NULL,               -- columnas de la orden al momento de entrar (JSON)
  Ingreso        DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
  Usuario        NVARCHAR(40)  NULL                -- quién la ingresó (sale del historial)
);
CREATE TABLE rack.PapelHistorial (
  Id             BIGINT IDENTITY PRIMARY KEY,
  OrdenSerial    VARCHAR(50)   NOT NULL,
  Ubicacion      VARCHAR(10)   NULL,
  Evento         VARCHAR(12)   NOT NULL,           -- entrada | salida | reentrada
  Usuario        NVARCHAR(40)  NULL,
  Fecha          DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);
CREATE INDEX IX_PapelHistorial_Orden ON rack.PapelHistorial(OrdenSerial, Fecha);

/* Aprobación de ZFER: piezas CURVE de nivel 02–04 que llevan papel.
   Aprobado = todas las órdenes de ese ZFER entran a Lista de corte. */
CREATE TABLE rack.PapelAprobacionesZfer (
  Zfer           VARCHAR(40)   NOT NULL PRIMARY KEY,
  Estado         VARCHAR(10)   NOT NULL CHECK (Estado IN ('pendiente','aprobada','rechazada')),
  SolicitadoPor  NVARCHAR(40)  NULL,
  SolicitadoEn   DATETIME2     NOT NULL,
  Nota           NVARCHAR(300) NULL,               -- por qué lleva papel (lo escribe el operario)
  Detalle        NVARCHAR(MAX) NULL,               -- órdenes, niveles y modelos al pedirla (JSON)
  ResueltoPor    NVARCHAR(40)  NULL,
  ResueltoEn     DATETIME2     NULL,
  Motivo         NVARCHAR(300) NULL                -- motivo del rechazo o de quitar la aprobación
);
CREATE TABLE rack.PapelAprobacionesZferHistorial (  -- cada pedido, aprobación, rechazo o revocación
  Id             BIGINT IDENTITY PRIMARY KEY,
  Zfer           VARCHAR(40)   NOT NULL,
  Evento         VARCHAR(12)   NOT NULL,           -- solicitada | aprobada | rechazada | revocada
  Usuario        NVARCHAR(40)  NULL,
  Fecha          DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
  Nota           NVARCHAR(300) NULL
);
CREATE INDEX IX_PapelAprobacionesZferHistorial_Zfer ON rack.PapelAprobacionesZferHistorial(Zfer, Fecha);

/* ---------- Stock de MALLAS (por Desenho_CodMat, en unidades) ----------
   No va por orden ni por casilla: se da entrada a lo fabricado (un sticker
   por malla) y salida a lo que se usa. El stock descuenta la necesidad de
   Lista de corte. CodMat sin los 9 ceros iniciales de SAP. */
CREATE TABLE rack.MallasStock (
  CodMat         VARCHAR(18)   NOT NULL PRIMARY KEY,
  Descripcion    NVARCHAR(120) NULL,
  Cantidad       INT           NOT NULL CHECK (Cantidad >= 0)
);
CREATE TABLE rack.MallasMovimientos (               -- un registro por cada entrada o salida registrada
  Id             BIGINT IDENTITY PRIMARY KEY,
  IdOrigen       VARCHAR(20)   NULL,
  IdCliente      VARCHAR(64)   NULL,               -- contra registros duplicados (doble clic, reintento)
  Usuario        NVARCHAR(40)  NULL,
  Nota           NVARCHAR(200) NULL,
  Fecha          DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);
CREATE UNIQUE INDEX UX_MallasMovimientos_IdCliente ON rack.MallasMovimientos(IdCliente) WHERE IdCliente IS NOT NULL;
CREATE TABLE rack.MallasMovimientoLineas (
  MovimientoId   BIGINT        NOT NULL REFERENCES rack.MallasMovimientos(Id),
  Linea          INT           NOT NULL,
  Tipo           VARCHAR(8)    NOT NULL CHECK (Tipo IN ('entrada','salida')),
  CodMat         VARCHAR(18)   NOT NULL,
  Descripcion    NVARCHAR(120) NULL,
  Cantidad       INT           NOT NULL CHECK (Cantidad > 0),
  PRIMARY KEY (MovimientoId, Linea)
);

/* ---------- Rack de TEJIDOS (PVTE, PUTE, tejido): una pieza por POSICIÓN ----------
   Cada posición (A1.1, B12.1…) es de un tamaño (P, G, XG); cada tejido tiene
   su tamaño. Entra uno a uno, en la primera posición libre de su tamaño (o
   una más grande), con foto del calentamiento (archivo en el puente),
   responsables y resistencias. El stock por CodMat = posiciones ocupadas. */
CREATE TABLE rack.TejidosPosiciones (
  Posicion       VARCHAR(12)   NOT NULL PRIMARY KEY,
  Tamano         VARCHAR(3)    NOT NULL CHECK (Tamano IN ('P','G','XG'))
);
CREATE TABLE rack.TejidosTamanos (                   -- tamaño de cada tejido (Excel + "Asignar" en la app)
  CodMat         VARCHAR(18)   NOT NULL PRIMARY KEY,
  Tamano         VARCHAR(3)    NOT NULL CHECK (Tamano IN ('P','G','XG')),
  Nombre         NVARCHAR(120) NULL,
  Vehiculo       NVARCHAR(120) NULL,                 -- VEHICULO_ del Excel
  Geometria      NVARCHAR(60)  NULL                  -- GEOMETRIA_ del Excel
);
CREATE TABLE rack.TejidosRack (                      -- lo que hay hoy: una pieza por posición
  Posicion       VARCHAR(12)   NOT NULL PRIMARY KEY REFERENCES rack.TejidosPosiciones(Posicion),
  IdUnidad       VARCHAR(20)   NOT NULL,
  CodMat         VARCHAR(18)   NOT NULL,
  Nombre         NVARCHAR(120) NULL,
  Vehiculo       NVARCHAR(120) NULL,
  Geometria      NVARCHAR(60)  NULL,
  Tamano         VARCHAR(3)    NOT NULL,
  Responsables   NVARCHAR(80)  NOT NULL,
  Resistencia1   NVARCHAR(40)  NOT NULL,
  Resistencia2   NVARCHAR(40)  NULL,
  Ensamble       NVARCHAR(60)  NULL,
  Nota           NVARCHAR(200) NULL,
  Foto           VARCHAR(40)   NOT NULL,           -- archivo en server/datos/tejidos/fotos/
  Usuario        NVARCHAR(40)  NULL,
  Ingreso        DATETIME2     NOT NULL
);
CREATE TABLE rack.TejidosHistorial (                 -- entradas, salidas y tamaños asignados (solo se agrega)
  Id             BIGINT IDENTITY PRIMARY KEY,
  Evento         VARCHAR(10)   NOT NULL,           -- entrada | salida | tamano
  Posicion       VARCHAR(12)   NULL,
  CodMat         VARCHAR(18)   NULL,
  Tamano         VARCHAR(3)    NULL,
  Datos          NVARCHAR(MAX) NULL,               -- la pieza completa (responsables, resistencias, foto…), JSON
  Usuario        NVARCHAR(40)  NULL,
  Fecha          DATETIME2     NOT NULL
);
CREATE INDEX IX_TejidosHistorial_Fecha ON rack.TejidosHistorial(Fecha);
CREATE INDEX IX_TejidosHistorial_CodMat ON rack.TejidosHistorial(CodMat, Fecha);  -- la pestaña "Historial" busca por CodMat

/* ---------- Inventario de TECOFLEX (por cantidad: material + medida) ---------- */
CREATE TABLE rack.TecoflexStock (
  Material       VARCHAR(20)   NOT NULL,           -- código SAP (100004045, 100005343, …)
  MedidaMm       VARCHAR(6)    NOT NULL,           -- '6,5', '9' … '70'
  Cantidad       INT           NOT NULL CHECK (Cantidad >= 0),   -- nunca negativo
  PRIMARY KEY (Material, MedidaMm)
);
CREATE TABLE rack.TecoflexMovimientos (            -- un registro por "Registrar" del carrito
  Id             BIGINT IDENTITY PRIMARY KEY,
  IdOrigen       VARCHAR(20)   NULL,               -- id que tenía en el diario de la app (trazabilidad de la migración)
  IdCliente      VARCHAR(64)   NULL,               -- evita registrar dos veces el mismo carrito (índice abajo)
  Usuario        NVARCHAR(40)  NULL,               -- NULL = movimientos de antes de exigir inicio de sesión
  Nota           NVARCHAR(200) NULL,
  Fecha          DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);
CREATE TABLE rack.TecoflexMovimientoLineas (
  MovimientoId   BIGINT        NOT NULL REFERENCES rack.TecoflexMovimientos(Id),
  Linea          INT           NOT NULL,
  Tipo           VARCHAR(7)    NOT NULL CHECK (Tipo IN ('entrada','salida')),
  Material       VARCHAR(20)   NOT NULL,
  MedidaMm       VARCHAR(6)    NOT NULL,
  Cantidad       INT           NOT NULL CHECK (Cantidad > 0),
  PRIMARY KEY (MovimientoId, Linea)
);
CREATE INDEX IX_TecoflexMovimientos_Fecha ON rack.TecoflexMovimientos(Fecha);
-- UNIQUE con filtro: en SQL Server un UNIQUE común admite un solo NULL, y los
-- movimientos viejos no tienen IdCliente
CREATE UNIQUE INDEX UX_TecoflexMovimientos_IdCliente ON rack.TecoflexMovimientos(IdCliente) WHERE IdCliente IS NOT NULL;
/* Un "Registrar" = una transacción: insertar el movimiento y sus líneas y
   actualizar TecoflexStock; el CHECK (Cantidad >= 0) hace que una salida sin
   stock suficiente rechace el lote entero, igual que hoy. */
