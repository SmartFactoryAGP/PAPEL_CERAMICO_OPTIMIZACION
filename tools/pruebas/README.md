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
| `navegador.js` | La app real en Chrome: dos PCs en vivo, entrada y salida masiva, lectura de la tabla, creación de usuarios y lo que ve cada uno. Guarda capturas en `capturas/` |

Requisitos: Node.js, las dependencias del puente (`server/node_modules`)
y Chrome o Edge instalado (solo para `navegador.js`).
