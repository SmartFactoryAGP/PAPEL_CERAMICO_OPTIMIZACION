# Cómo actualizar la app sin perder nada

Cuando te pase una versión nueva (porque surgieron más ideas, se corrigió
un bug, etc.), esto es lo que pasa con cada tipo de dato:

## Lista de corte / Rack (modo simulado o Excel)

Estos datos viven en el **`localStorage` del navegador** — no están
adentro de los archivos de la app. Reemplazar los archivos por una
versión nueva **no los toca**, con una sola condición:

> **Actualizá en el mismo lugar.** Sobreescribí los archivos en la misma
> carpeta donde ya estabas usando la app (mismo `index.html`, misma
> ruta). Si en cambio extraés la versión nueva en una carpeta distinta y
> abrís ESE `index.html`, el navegador lo va a tratar como un sitio
> distinto y no vas a ver lo que tenías guardado (sigue estando en el
> `localStorage` de la carpeta vieja, no se perdió, pero no lo vas a ver
> ahí).

Para estar seguro de que sobrevive de verdad: extraé el zip nuevo
**encima** de la carpeta vieja (reemplazando los archivos), no al lado.

De paso, para que el día de mañana yo pueda mejorar cómo se guardan
estos datos sin romper lo que ya tenías, todo lleva un número de versión
interno — si alguna vez hace falta, la propia app adapta tus datos
viejos a la forma nueva en vez de descartarlos.

## Lista de corte / Rack (SQL real, cuando lo conectes)

Estos datos viven en tu base de datos, **totalmente aparte** de los
archivos de la app — actualizar la app no los toca para nada, pase lo
que pase con los archivos.

## Tus consultas SQL (`server/queries.js`)

Este es el único archivo donde SÍ tenés que prestar atención:

> **Cuando te pase una actualización, nunca reemplaces
> `server/queries.js` ni `server/.env`** — son tuyos, con tus datos
> reales. Reemplazá todo lo demás (`index.html`, `css/`, `js/`,
> `server/server.js`) tranquilo.

Separé las consultas SQL de `server.js` justo para esto: `server.js` es
el "motor" (puede cambiar en cualquier actualización), y
`server/queries.js` es donde vive lo que vos completaste — nunca lo voy
a regenerar ni te lo voy a mandar de vuelta en una actualización futura,
a menos que vos me pidas específicamente ayuda para cambiarlo.

## Resumen rápido

| Dato | Dónde vive | ¿Una actualización lo toca? |
|---|---|---|
| Lista de corte / Rack (simulado o Excel) | `localStorage` del navegador | No, si actualizás en el mismo lugar |
| Lista de corte / Rack (SQL real) | Tu base de datos | No, nunca |
| Tus consultas SQL | `server/queries.js` | No, si no reemplazás ese archivo |
| Tu conexión a SQL | `server/.env` | No, si no reemplazás ese archivo |
| El resto de la app | `index.html`, `css/`, `js/`, `server/server.js` | Sí, se actualiza (es lo esperado) |
