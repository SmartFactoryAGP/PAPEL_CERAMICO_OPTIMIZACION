# Dónde está la información — Materiales Semiterminados

## Resumen

| Información | Dónde vive | ¿Se escribe ahí? |
|---|---|---|
| Órdenes pendientes de corte (papel cerámico) | SQL Server de SAGA (vista `SAGA_View_Ficha_Componentes_Colombia`) | **No.** La app solo lee |
| Puesto de trabajo de cada orden | SQL Server de Calendario (`TCAL_CALENDARIO_COLOMBIA_DIRECT`) | **No.** La app solo lee |
| Archivos DXF | Carpeta de red (`\\192.168.2.2\cnc-revisados\…`) | **No.** La app solo lee |
| DXF de las tiras de Tecoflex (uno por medida: `CORTE 9MM UND.dxf`) | Carpeta de red `\\192.168.2.2\cnc-revisados\OPTIMIZACION TECO` (se cambia con `TECOFLEX_DXF_CARPETA` en el `.env`) | **No.** La app solo lee |
| **Racks, inventario, historial y usuarios** | **PC del puente**, carpeta `server/datos/` | **Sí.** Es lo único que la app escribe |

La app **no modifica ninguna tabla de SAP/SAGA ni de Calendario**.

## Los racks: uno por área, independientes

```
server/datos/
├── usuarios.json              usuarios, contraseñas (cifradas) y permisos
├── papel/aprobaciones.json    ZFER CURVE 02–04 aprobados para Lista de corte, con quién pidió, quién aprobó y cuándo
├── papel/
│   ├── rack.json              órdenes que están hoy en el rack (A1 … G20)
│   └── historial.jsonl        cada entrada, salida y reentrada, con usuario y hora (una línea por evento, solo se agrega)
├── mallas/
│   ├── movimientos.jsonl      diario de entradas y salidas por CodMat (fuente de verdad)
│   └── inventario.json        stock actual por CodMat
├── tejidos/                  rack por POSICIÓN (A1.1, B12.1…): una pieza por posición
│   ├── posiciones.json        el rack físico: cada posición con su tamaño (P, G, XG)
│   ├── tamanos.json           tamaño, vehículo y geometría de cada tejido por CodMat (del Excel + "Asignar")
│   ├── ocupacion.json         qué tejido hay hoy en cada posición (responsables, resistencias, vehículo…)
│   ├── historial.jsonl        entradas, salidas y tamaños asignados: solo se agrega, nunca se borra (pestaña "Historial")
│   └── fotos/                 la foto del calentamiento de cada entrada (NO va al respaldo diario)
├── tecoflex/
│   ├── movimientos.jsonl      diario de entradas y salidas (fuente de verdad)
│   └── inventario.json        stock actual por material y medida
└── respaldos/
    └── AAAA-MM-DD/            copia completa de todo lo anterior, una por día
```

- **Independientes:** cada rack tiene su propia carpeta. Un problema en uno (archivo dañado, restauración) no afecta a los otros.
- **Cómo se guarda:**
  - Papel cerámico se maneja **por orden**: cada orden ocupa una casilla.
  - Tecoflex se maneja **por cantidad**: stock por material y medida, con entradas y salidas.
  - Tejidos se maneja **por posición**: cada tejido entra solo a una posición libre de su tamaño (o una más grande), con foto del calentamiento, responsables y resistencias. Las fotos se guardan en `tejidos/fotos/` y **no** entran en el respaldo diario (copiarlas 30 veces llenaría el disco): incluí esa carpeta en el respaldo de red de la empresa.
  - Mallas se maneja **por cantidad y por CodMat**, con su propio stock: entra lo fabricado (un sticker por malla) y sale lo usado. Ese stock se descuenta de lo que pide la Lista de corte.
- **Trazabilidad:** todo movimiento queda registrado con **quién** lo hizo y **cuándo**. Nadie puede usar la app sin usuario.
- **Formato:** archivos de texto JSON, legibles con cualquier editor. Se pueden abrir para auditoría.
- **Consumo de Tecoflex:** no tiene archivo propio: sale del diario `tecoflex/movimientos.jsonl` (cada salida queda ahí con fecha, material, medida y cantidad). Al arrancar, el puente lo suma por día, material y medida; la vista "Consumo" del Rack lo consulta de ahí. No se pierde nada ni hay que cargar datos aparte.
- **Historiales:** una línea por evento (`.jsonl`) que solo se agrega al final; nunca se reescriben enteros. Con un año de uso, cada movimiento sigue tardando lo mismo que el primer día. El `historial.json` del formato anterior se convierte solo al arrancar el puente, y el original queda en `_anteriores/`.

## Respaldos y recuperación

- **Respaldo automático:** el puente copia `server/datos/` completo una vez por día, en `server/datos/respaldos/AAAA-MM-DD/`, y conserva los últimos **30 días**.
- **Para restaurar un rack:**
  1. Cerrar el puente.
  2. Copiar la carpeta de ese rack desde el respaldo del día elegido a `server/datos/`.
  3. Volver a abrir el puente.

  Los demás racks no se tocan.
- **Si se corta la luz:** el inventario de Tecoflex se reconstruye solo desde su diario al arrancar. Una línea a medio escribir se descarta con aviso, sin perder lo anterior.
- **Recomendación:** que sistemas incluya la carpeta `server/datos/` en el respaldo de red de la empresa. Los respaldos diarios están en el mismo disco: protegen de errores, pero **no** de una falla del disco o de la PC.

## Seguridad

- **Contraseñas:** se guardan cifradas (scrypt con sal propia por usuario), nunca legibles.
- **Permisos:** el administrador asigna qué vistas ve cada usuario en cada área. El puente verifica cada operación contra esos permisos, incluidos los avisos en vivo: nadie recibe datos de un área que no tiene asignada.
- **Sesiones:** vencen tras 12 h sin uso. "Salir", cambiar la contraseña o desactivar a un usuario corta al instante todo lo que tenía abierto. Tras 8 contraseñas fallidas en 10 minutos, ese equipo queda frenado un rato.
- **Archivos de planos:** el puente solo abre archivos `.dxf` dentro de las carpetas de red indicadas en `DXF_ALLOWED_PREFIXES`. Nunca abre su propia carpeta, donde están las credenciales.
- **Errores:** los detalles internos (servidor, usuario de la base, rutas) solo los ve un administrador. El resto recibe un aviso genérico.
- **Credenciales de SQL:** viven solo en `server/.env`, en la PC del puente. Ese archivo, y cualquier copia suya, está excluido de git.
- **Fuera de git:** los datos no se suben al repositorio y no se pisan al actualizar la app.
- **Prueba automática:** `node tools/pruebas/seguridad.js` intenta cada una de estas vías de ataque y verifica que fallen.

## Si se decide llevarlo a SQL Server

Con el volumen actual (decenas de usuarios en red local), los archivos alcanzan y son simples de respaldar. Si la empresa prefiere tenerlo en su servidor de base de datos, la propuesta conserva la misma separación: **tablas independientes por rack**, en una base propia de la app, sin tocar las tablas de SAGA.

- **Diseño propuesto:** `server/sql/propuesta_tablas_racks.sql`. Es solo una propuesta y todavía no está en uso.
- **Qué hace falta:**
  1. Que sistemas cree esa base y dé un usuario con permiso de escritura **solo** sobre ella.
  2. Adaptar el puente para leer y escribir ahí en lugar de en los archivos. La pantalla no cambia.
