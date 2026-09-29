/* =========================================================
   TABLA DE CONTROL DE CORTE / RACK
   =========================================================
   Corré esto UNA SOLA VEZ en tu base, para crear la tabla nueva donde
   la app va a ir guardando qué órdenes ya se cortaron y en qué rack
   quedaron. Tu tabla real de lotes (SAGA_SAPLotesVidro_Colombia) NO se
   toca ni se modifica — esto vive aparte, y se conecta con ella por
   Lote_OrdemSerial / OrdenSerial.

   Si preferís otro nombre de tabla o de columnas, cambialo acá Y en
   server/queries.js (tienen que coincidir).
   ========================================================= */

CREATE TABLE dbo.NestingControlCorte (
  Id           INT IDENTITY(1,1) PRIMARY KEY,
  OrdenSerial  VARCHAR(50)   NOT NULL,              -- mismo valor que Lote_OrdemSerial
  Estado       VARCHAR(20)   NOT NULL DEFAULT 'STOCK',  -- 'STOCK' (cortado, en el rack) | 'CONSUMIDO' (ya se usó el material)
  Rack         VARCHAR(20)   NULL,                  -- ubicación asignada (A1, A2, ...)
  FechaCorte   DATETIME      NULL,                  -- cuándo se marcó como cortado
  FechaSalida  DATETIME      NULL,                  -- cuándo se sacó del rack (se usó el material)
  CreadoEn     DATETIME      NOT NULL DEFAULT GETDATE()
);

-- evita que la misma orden termine con dos filas de control
CREATE UNIQUE INDEX UX_NestingControlCorte_Orden ON dbo.NestingControlCorte(OrdenSerial);
