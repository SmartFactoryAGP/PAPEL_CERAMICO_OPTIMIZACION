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
  Vista          VARCHAR(20)   NOT NULL,           -- ordenes | nesting | rack | repair
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

/* ---------- Rack de MALLAS (misma forma, tablas propias) ---------- */
CREATE TABLE rack.MallasRack (
  OrdenSerial    VARCHAR(50)   NOT NULL PRIMARY KEY,
  Ubicacion      VARCHAR(10)   NOT NULL UNIQUE,
  DatosOrden     NVARCHAR(MAX) NULL,
  Ingreso        DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
  Usuario        NVARCHAR(40)  NULL
);
CREATE TABLE rack.MallasHistorial (
  Id             BIGINT IDENTITY PRIMARY KEY,
  OrdenSerial    VARCHAR(50)   NOT NULL,
  Ubicacion      VARCHAR(10)   NULL,
  Evento         VARCHAR(12)   NOT NULL,
  Usuario        NVARCHAR(40)  NULL,
  Fecha          DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);
CREATE INDEX IX_MallasHistorial_Orden ON rack.MallasHistorial(OrdenSerial, Fecha);

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
