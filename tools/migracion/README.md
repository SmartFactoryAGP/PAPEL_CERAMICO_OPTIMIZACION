# Migración de los racks a SQL Server

Mientras no hay credenciales, todo se guarda en `server/datos/` (ver `DATOS.md`).
Este script lo pasa a SQL Server cuando estén.

## Pasos el día de la migración

1. **Sistemas** crea una base propia para la app y corre `server/sql/propuesta_tablas_racks.sql`
   (antes, revisar con ellos nombres y tipos de columna).
2. Completar en `server/.env` los datos de conexión: `MIG_DB_SERVER`, `MIG_DB_DATABASE`,
   `MIG_DB_USER`, `MIG_DB_PASSWORD` (o `MIG_DB_TRUSTED_CONNECTION=true`).
3. **Ensayo**, que no deja nada escrito:
   ```
   node tools/migracion/migrar-a-sql.js --ensayo
   ```
   Hace toda la migración en una transacción, verifica los totales y la deshace.
4. En un momento **sin movimiento** (fin de turno): cerrar el puente y ejecutar
   ```
   node tools/migracion/migrar-a-sql.js --ejecutar
   ```
5. Pasar el puente a leer y escribir en SQL. Esto es un desarrollo aparte, a hacer
   cuando se confirme el diseño de tablas.
6. **No borrar `server/datos/`** hasta confirmar varios días de funcionamiento con SQL.

## Otras formas de uso

```
node tools/migracion/migrar-a-sql.js
```
Sin opciones, solo revisa los datos y genera un `.sql` en `tools/migracion/salida/`.
No se conecta a nada. Sirve para mostrarlo o correrlo a mano en SSMS.

## Qué garantiza

- **Todo o nada:** una sola transacción. Si algo falla, no queda nada a medias.
- **No duplica:** se niega a correr si las tablas ya tienen datos.
- **Verificación antes de confirmar:** cantidad de usuarios, permisos, órdenes, historial,
  movimientos y líneas. Además comprueba que el stock de Tecoflex sea exactamente
  entradas − salidas.
- **Horas:** se convierten de UTC (como se guardan) a hora de Colombia.
- **Archivos:** no se modifican ni se borran.
- **Probado:** `node tools/pruebas/migracion.js`.
