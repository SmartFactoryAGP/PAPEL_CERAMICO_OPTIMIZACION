# Pruebas automáticas

Desde la carpeta del proyecto:

```
node tools/pruebas/todas.js                  # todo (unos 2 minutos)
node tools/pruebas/todas.js --sin-navegador  # sin Chrome (más rápido)
node tools/pruebas/inventario.js             # una sola
```

**No tocan los datos reales.** Cada prueba copia la app a una carpeta temporal,
levanta ahí su propio puente en otro puerto, y la borra al terminar.
Se pueden correr con el puente de producción encendido.

| Archivo | Qué verifica |
|---|---|
| `../revisar-js.js` | Errores de sintaxis, funciones o variables mal escritas, argumentos de más o de menos |
| `datos.js` | Una carpeta por rack, migración desde el formato viejo, respaldo diario, racks independientes |
| `usuarios.js` | Sin sesión no se ve nada; permisos por área y vista; desactivar o quitar permisos rige al instante; protecciones del administrador; freno de intentos |
| `inventario.js` | Medidas por material (X5), lotes todo-o-nada, carrito duplicado, 30 operarios simultáneos, 35 pestañas en vivo, reinicio, apagón |
| `migracion.js` | El script de migración a SQL: totales correctos, stock igual al de la app, T-SQL en una sola transacción, comillas escapadas, horas en hora de Colombia |
| `seguridad.js` | Intenta robar datos a propósito: leer el `.env` o `usuarios.json` por `/api/dxf`, salirse con `..`, apuntar a una carpeta de red ajena; ver en vivo datos de otra área; seguir conectado después de "Salir" o de ser desactivado; meter basura en el rack; ver errores internos; probar 25 contraseñas a la vez. Todo tiene que fallar |
| `aprobaciones.js` | Papel cerámico: la regla de Lista de corte (CURVE, NivelAGP ≥ 05, CURVE 02–04 solo con ZFER aprobado, X5 incluido) y la vista Aprobaciones (permisos, pedir/rechazar/volver a pedir/aprobar/quitar, nadie aprueba lo propio, aviso en vivo). De punta a punta con un **SQL Server simulado** (`sql-falso.js`) que contesta las consultas reales de `queries.js`: qué sale en la lista, el camino X5/0101, ingreso rápido y lote bloqueados |
| `navegador.js` | La app real en Chrome: dos PCs en vivo, entrada y salida masiva, lectura de la tabla, creación de usuarios y lo que ve cada uno. Guarda capturas en `capturas/` |

| `lista-protegida.js` | Que SQL no se caiga: 600 pedidos de la Lista de corte a la vez = 1 consulta; una operaria no puede forzar, el administrador sí (no dos veces seguidas); al vencer la hora, 1 consulta y aviso en vivo; con SQL caído se sigue viendo la última lista y no se reintenta en cada pedido; aprobar un ZFER no reconsulta todo; tope de búsquedas por persona |
| `mallas.js` | Mallas con el SQL simulado: filtros 2900 + UND + "TNT", agrupado por CodMat (sin los 9 ceros) y puesto, Cantidad = suma de m2, el stock cubre primero el puesto más avanzado; entrada desde Lista de corte sin volver a consultar SQL; salida solo con permiso de Rack y nunca más de lo que hay |
| `nombres-componentes.js` | Nombre correcto desde ODATA_Fullkit: un código 0000000006… con nombre equivocado en SAGA ("ZHAL BUFFER ACEROS CO") entra a Tejidos o Mallas según su nombre real; el código se encuentra con o sin ceros; si Fullkit no responde, todo sigue con los nombres de SAGA |
| `tejidos.js` | Rack de Tejidos: una pieza por posición, de su tamaño o una más grande si no hay; foto obligatoria y reconocida por su contenido; responsables y resistencia 1 obligatorios; reintentos sin duplicar; salida y reuso; permisos (dar entrada/salida solo con Rack); Lista de corte con Tamaño, "Asignar" y "Falta" descontado; reinicio |
| `navegador-tejidos.js` | En Chrome como **celular**: dar entrada con la foto por el campo de la cámara, sticker, ver la posición con su foto y darle salida; y en la PC, "Asignar" tamaño y tocar una fila para ir a dar entrada |
| `navegador-mallas.js` | En Chrome: elegir lo fabricado en la Lista de corte de Mallas, dar entrada (el PDF trae un sticker por malla), "Falta" baja sola; en el Rack, escanear el sticker y dar salida |
| `navegador-aprobaciones.js` | En Chrome, con el SQL simulado: las columnas ZFER / PlanCURVE / NivelAGP en Lista de corte, el ingreso rápido bloqueado, el operario pide un ZFER, el aprobador (otra PC) lo ve con el contador en la pestaña y aprueba, y la lista trae sus órdenes |

Requisitos: Node.js, las dependencias del puente (`server/node_modules`)
y Chrome o Edge instalado (solo para `navegador.js`).
