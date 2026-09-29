# Cómo conectar el SQL real — paso a paso

Ya tenés `server/queries.js` completado con tu tabla real
(`SAGA_SAPLotesVidro_Colombia`) y la tabla de control lista para crear.
Esto es lo que falta para que la app hable con tu base de verdad, en
orden.

## 1) Instalar Node.js (una sola vez, si no lo tenés)

Es el programa que hace correr el puente. Bajalo de
[nodejs.org](https://nodejs.org) (la versión "LTS"), instalalo como
cualquier programa de Windows (Siguiente, Siguiente, Instalar).

Para confirmar que quedó instalado: abrí el símbolo del sistema (buscá
"cmd" en el menú de inicio) y escribí:
```
node --version
```
Si te muestra un número de versión (ej. `v20.11.0`), ya está.

## 2) Crear la tabla de control en tu base (una sola vez)

Esto es la tabla nueva y chica donde la app va a ir guardando qué
órdenes ya se cortaron y en qué rack quedaron — tu tabla de SAP no se
toca para nada.

1. Abrí SQL Server Management Studio (o la herramienta que uses para
   conectarte a tu base).
2. Conectate a la base donde está `SAGA_SAPLotesVidro_Colombia`.
3. Abrí el archivo `server/sql/crear_tabla_control.sql` (de la carpeta
   que te mandé) y ejecutalo (F5, o el botón "Ejecutar").
4. Debería crear la tabla `NestingControlCorte` sin errores. Si te tira
   un error de "ya existe", es porque ya la habías creado antes — no
   pasa nada, seguí al paso siguiente.

## 3) Completar tus datos de conexión (`.env`)

1. Andá a la carpeta `server` dentro de donde extrajiste el zip.
2. Copiá el archivo `.env.example` y pegalo en la misma carpeta,
   renombrando la copia a `.env` (sin el ".example" al final — con el
   Explorador de Windows: copiar, pegar, F2 para renombrar).
3. Abrí `.env` con el Bloc de notas (clic derecho → Abrir con → Bloc de
   notas) y completá:

   ```
   DB_SERVER=nombre_o_ip_de_tu_servidor_sql
   DB_DATABASE=nombre_de_tu_base
   DB_PORT=1433

   DB_USER=
   DB_PASSWORD=
   DB_TRUSTED_CONNECTION=false
   ```

   - Si te conectás a SQL Server con usuario y contraseña: completá
     `DB_USER` y `DB_PASSWORD`, dejá `DB_TRUSTED_CONNECTION=false`.
   - Si te conectás con tu usuario de Windows (sin usuario/contraseña
     aparte): dejá `DB_USER` y `DB_PASSWORD` vacíos, y poné
     `DB_TRUSTED_CONNECTION=true`.
   - Si no sabés cuál de los dos usás: es el mismo dato que le pondrías
     a SQL Server Management Studio para conectarte — fijate ahí qué
     modo de autenticación tenés seleccionado.

   El resto del archivo (`DXF_SOURCE=sql`, `PORT=4000`) podés dejarlo
   como viene.

4. Guardá el archivo.

## 4) Instalar lo que necesita el puente (una sola vez)

Dentro de la carpeta `server`, hacé doble clic en **`instalar.bat`**.
Se va a abrir una ventana negra, va a bajar algunas cosas (tarda 1-2
minutos la primera vez), y al final va a decir "Listo". Cerrala o
apretá una tecla cuando lo pida.

*(Si `instalar.bat` no te funciona por algún motivo: abrí el símbolo del
sistema, andá a la carpeta `server` con `cd ruta\a\la\carpeta\server`, y
escribí `npm install`.)*

## 5) Prender el puente

Dentro de la carpeta `server`, hacé doble clic en **`iniciar.bat`**.
Tiene que quedar una ventana abierta con un mensaje como:
```
Puente "Lista de corte" escuchando en http://localhost:4000
Dejá esta ventana abierta mientras usás la app de Nesting.
```
**Dejá esa ventana abierta** todo el tiempo que vayas a usar "Lista de
corte" con SQL real — si la cerrás, el puente se apaga.

## 6) Confirmar que está vivo

Abrí tu navegador y andá a `http://localhost:4000/api/salud` — tendría
que mostrarte algo como `{"ok":true,"hora":"..."}`. Si ves eso, el
puente está corriendo bien (aunque todavía no sepamos si la conexión a
SQL en sí anda — eso se confirma en el paso siguiente).

## 7) Usar el modo real en la app

1. Abrí `index.html` (doble clic, como siempre).
2. Andá a la pestaña "Lista de corte".
3. En **"Origen de datos"**, elegí **"Servidor SQL real"**.
4. Confirmá que "Dirección del puente" diga `http://localhost:4000`
   (o el puerto que hayas puesto en el `.env`, si lo cambiaste).
5. Tocá **"Actualizar lista de pendientes"**.

Si todo está bien, vas a ver tus órdenes reales (filtradas a
`ClaveModelo=32VPMO`) en la tabla. De ahí en más es el mismo flujo de
siempre: seleccionás, "Ejecutar lote de corte", revisás, "Confirmar y
enviar al Rack".

## Si son varias computadoras (no hace falta repetir todo en cada una)

Solo **una** máquina necesita Node.js y el puente corriendo — las demás
solo necesitan los archivos de la app (el `index.html` de siempre), sin
instalar nada.

1. Elegí una PC para que sea "el servidor" — puede ser cualquiera que
   quede prendida y conectada a la red mientras las demás trabajan (no
   hace falta que sea potente, esto es liviano).
2. En ESA PC nomás: hacé todo lo de arriba (Node.js, `.env`,
   `instalar`, `iniciar`).
3. Cuando la ventana de `iniciar` arranque, ahora te va a mostrar algo
   así:
   ```
   Para usar esto desde OTRA computadora de la misma red, en
   "Lista de corte" > "Dirección del puente", poné una de estas:
     http://192.168.1.XX:4000
   ```
   Anotá esa dirección (la IP puede cambiarte según tu red).
4. En las **otras 4 computadoras**: copiá la carpeta de la app entera
   igual (para tener `index.html` y todo lo demás), pero **no hace
   falta que abran la carpeta `server`, ni instalen Node.js, ni corran
   nada de eso** — con abrir `index.html` alcanza.
5. En cada una de esas otras PC, dentro de la app: "Lista de corte" →
   "Origen de datos" → "Servidor SQL real" → en **"Dirección del
   puente"**, en vez de `http://localhost:4000` poné la dirección que
   te mostró la PC servidor (ej. `http://192.168.1.XX:4000`).

**Dos cosas a tener en cuenta:**
- Si el firewall de Windows de la PC servidor pregunta si permitís que
  Node.js acepte conexiones de la red, decile que **sí** (si no, las
  otras PC no van a poder llegar).
- La IP de la PC servidor puede cambiar si se reinicia el router (según
  cómo esté configurada tu red) — si un día deja de andar para los
  demás, fijate si cambió mirando de nuevo la ventana de `iniciar`, o
  pedile a tu área de sistemas que le asignen una IP fija a esa máquina.
- Recomendado en este caso: completá `API_TOKEN` en el `.env` de la PC
  servidor (ver la sección de abajo) y cargá esa misma clave en el
  campo "Clave del puente" de las otras PC — como el puerto ahora queda
  expuesto a toda la red, no solo a esa máquina, es una buena idea
  agregar esa traba extra.

## Si algo falla

- **"No se pudo conectar al puente"** en la app → el puente no está
  corriendo, o el puerto no coincide. Revisá que la ventana de
  `iniciar.bat` siga abierta, y que la URL en la app tenga el mismo
  puerto que ves en esa ventana.
- **Error de conexión a SQL** (lo vas a ver en la ventana negra de
  `iniciar.bat`, o como mensaje en la app) → revisá `DB_SERVER`,
  `DB_DATABASE`, usuario/contraseña en tu `.env`. Es el mismo tipo de
  dato que usás para conectarte con SQL Server Management Studio.
- **"Invalid object name 'NestingControlCorte'"** → todavía no corriste
  el script del paso 2, o lo corriste contra una base distinta a la que
  apunta tu `.env`.
- **La lista aparece vacía** → puede ser que no haya lotes pendientes
  con `ClaveModelo='32VPMO'` ahora mismo, o que el nombre de esa columna
  no sea exactamente así en tu base — revisá contra tu tabla real.
- **Algo más raro** → pegame el mensaje de error exacto (de la ventana
  negra o de la app) y lo vemos.

## Actualización: la tabla real y el DXF por red (no por SQL)

Con tu tabla real (`SAGA_View_Ficha_Componentes_Colombia`) confirmaste
que el DXF **no** está guardado adentro de SQL — la columna
`Desenho_Path` trae la **ruta completa** del archivo en la red
(ej. `\\192.168.2.2\cnc-revisados\CHEVROLET\...`). Esto cambia un paso:

**Si tu `.env` ya decía `DXF_SOURCE=sql`** (lo pusiste así la primera
vez que lo armamos), tenés que editarlo a mano:
1. Abrí `server/.env` con el Bloc de notas.
2. Buscá la línea `DXF_SOURCE=sql` y cambiala a `DXF_SOURCE=file`.
3. Guardá.
4. Cerrá la ventana de `iniciar` (si estaba abierta) y volvé a abrirla,
   para que tome el cambio.

`DXF_BASE_PATH` ya no hace falta completarlo — como las rutas que vienen
de tu tabla son completas, el puente las usa tal cual, sin sumarles
nada. Dejalo como está.

*Validado:* probé los dos casos — una ruta completa de red (se usa tal
cual, se lee bien) y, por las dudas, un nombre suelto sin ruta (ese sí
se combina con `DXF_BASE_PATH`, para no perder esa opción si algún día
hiciera falta).

Los filtros de la lista de pendientes también quedaron ajustados:
`Desenho_Operation = '0132'` y `Centro_Trabalho` en
(`01CORTE`,`02CNC`,`03SERIG`,`04SER_VT`) — sin el filtro de
`ClaveModelo` (confirmaste que ya no aplica en esta tabla).

## Rack simulado, mientras no creás la tabla de control

Pediste que el Rack sea solo simulación por ahora (sin guardar nada en
SQL), aunque la Lista de corte ya venga de tu SQL real. Se agregó una
casilla **"Simular el Rack por ahora"** (tildada por defecto en cuanto
elegís "Servidor SQL real") — con esto activado, "Confirmar" no escribe
nada en tu base: el Rack se maneja en este navegador, como el modo
simulado de siempre. Cuando confirmás una orden así, la próxima vez que
actualices la lista de pendientes (que sigue viniendo de tu SQL real)
esa orden queda oculta acá nomás — tu tabla real no se tocó, solo se
esconde de la vista para no verla duplicada.

Cuando termines de crear `NestingControlCorte`, destildá esa casilla y
el Rack va a empezar a escribir en SQL de verdad, sin tocar nada más.

*Validado:* confirmé una orden con este modo activado y comprobé que NO
se llamó al endpoint de marcar-en-stock de SQL; la orden quedó en el
Rack local con su ubicación; y al refrescar la lista de pendientes
(que sigue trayendo las mismas de tu SQL real, sin marcar), esa orden
apareció correctamente oculta, con un aviso de cuántas se ocultaron así.

Toca: `index.html` (casilla nueva) y `js/ui/orders.js`
(`ordRackEsSimulado`, y el filtro al refrescar pendientes).

## Actualización: sin permiso para crear tablas → no hace falta ninguna

Contaste que no tenés autorización para crear tablas nuevas en ese
servidor SQL. Buena noticia: **no hace falta ninguna** mientras el Rack
esté simulado. La consulta de "Lista de corte" (`ordenesPendientes`) ya
quedó ajustada para ser **solo lectura** de tu vista real — no compara
contra ninguna tabla de control, así que no necesita ningún permiso de
escritura ni que exista nada nuevo en tu base. El seguimiento de "esto
ya se cortó, en tal rack" lo lleva la app en tu navegador, con la
casilla "Simular el Rack" (tildada, que es lo que ya tenías activado).

El script `server/sql/crear_tabla_control.sql` sigue ahí por si algún
día conseguís el permiso y querés que el Rack también quede en SQL de
verdad — hasta entonces, no hace falta tocarlo para nada.

## Ubicaciones reales del rack (A a G, del 1 al 20)

Ajusté las ubicaciones que asigna la app para que coincidan con tu rack
físico: **A1 a A20, B1 a B20, C1 a C20, D1 a D20, E1 a E20, F1 a F20, y
G1 a G20** (140 lugares en total). Además, ahora busca el primer lugar
realmente libre en vez de ir sumando siempre — si sacás algo del rack
(porque ya usaste el material), ese lugar vuelve a estar disponible
para la próxima orden que confirmes, en vez de quedar salteado para
siempre.

*Validado:* llené las 20 posiciones de la letra A y confirmé que la
siguiente orden pasa sola a B1; y saqué una orden del medio del rack
(liberando su lugar) y confirmé que la próxima orden confirmada
reutiliza exactamente ese lugar liberado, en vez de ir a uno nuevo.

Toca: `js/ui/orders.js` (`nextRackLocation`, ahora busca lugares libres
de verdad en vez de un contador), `server/queries.js` (la consulta de
pendientes ya no depende de ninguna tabla nueva), e `index.html` (texto
de la casilla actualizado).

## Más columnas, buscador de rack, y actualización solo manual

Tres pedidos más:

**1) Más columnas en "Lista de corte" y "Rack":** ahora se muestran
Ordem_Serial, Operation, Centro_Trabalho, ClaveModelo, CodMat, Name,
ZTipo y Descricao (Archivo queda aparte, es la ruta real del DXF).
`Centro_Trabalho` en particular ya se ve en pantalla, no solo se usa
como filtro.

**2) Buscador en el Rack:** nuevo campo arriba de la tabla del Rack —
escaneás con la pistola de código de barras (o escribís a mano) el
número de orden y Enter. Si está en el rack, te dice la ubicación
exacta; si no está, dice "pieza no cortada". Después de cada búsqueda
el campo se vacía solo y queda listo para el siguiente escaneo, sin
tocar nada con el mouse.

**3) La lista solo se actualiza con el botón:** encontré (y saqué) dos
lugares donde la app refrescaba sola contra SQL sin que apretaras
"Actualizar" — al tildar/destildar "Simular el Rack", y automáticamente
después de confirmar un lote. Ahora, después de confirmar, lo que se
mandó al rack se saca de la tabla de pendientes en memoria (sin
volver a consultar tu base) — la única forma de traer datos frescos de
SQL es tocando "Actualizar lista de pendientes" a mano.

*Validado:* confirmé un lote en modo SQL real y comprobé que la
consulta a `/api/ordenes-pendientes` no se volvió a llamar (se quedó en
la única vez del refresco manual anterior), y que la orden confirmada
igual desapareció de la tabla. Probé el buscador con una orden que
estaba en el rack (mostró su ubicación) y con una que no (mostró
"pieza no cortada").

## Producción: sin selector de origen de datos

La app ahora habla siempre con SQL real — saqué el selector "Origen de
datos" (y los modos Simulado/Excel que tenía) para que nadie lo pueda
cambiar sin querer una vez desplegado. Ya no hace falta elegir nada:
al abrir la app, "Lista de corte" va directo a consultar tu SQL Server
apenas tocás "Actualizar lista de pendientes".

## Puestodetrabajo, desde un segundo servidor SQL

Agregué la columna `Puestodetrabajo`, que sale de OTRO servidor SQL
(el de Calendario, `TCAL_CALENDARIO_COLOMBIA_DIRECT`), buscando por
número de orden — como un BUSCARV entre las dos bases. Para activarlo,
completá estas líneas nuevas en tu `server/.env`:

```
CAL_DB_SERVER=servidor_del_calendario
CAL_DB_DATABASE=base_del_calendario
CAL_DB_PORT=1433
CAL_DB_USER=
CAL_DB_PASSWORD=
CAL_DB_TRUSTED_CONNECTION=false
```

Mismo criterio que el servidor principal: usuario/contraseña, o
autenticación de Windows con `CAL_DB_TRUSTED_CONNECTION=true`.

Si dejás `CAL_DB_SERVER` vacío, esto queda desactivado solo —
`Puestodetrabajo` llega vacío en la app, pero el resto de "Lista de
corte" sigue funcionando igual. Y si el segundo servidor llegara a
fallar (caído, credenciales vencidas), tampoco se cae la lista
principal — solo avisa en la ventana negra y esa columna queda vacía
para esa consulta puntual.

*Validado:* probé con los dos servidores simulados a la vez — una
orden con Puestodetrabajo cargado en el Calendario lo trajo bien
(`PT-05`), y otra sin match ahí quedó vacía sin romper nada. También
probé sacando `CAL_DB_SERVER` del todo: la lista de pendientes siguió
funcionando exactamente igual, solo con esa columna en blanco.

Toca: `server/.env.example` (variables `CAL_DB_*` nuevas),
`server/queries.js` y `queries.example.js` (bloque `puestoDeTrabajo`),
`server/server.js` (segunda conexión + función `traerPuestosDeTrabajo`),
y `js/ui/orders.js` (columna nueva en las dos tablas).

## Pendiente de tu confirmación

Preguntné si la casilla "Rotación fina (cada 2°, como Libélula)" (en la
pestaña Nesting) también debería sacarse de la pantalla para producción
— todavía no me confirmaste, así que la dejé como estaba por ahora.
Avisame si la sacamos o la dejamos.

## Garantía real de solo lectura (no depende de ningún botón)

Me preguntaste si podía garantizar que los dos SQL (Lista de corte y
Calendario) nunca vayan a tener ninguna modificación, siempre como
vista. Repaso honesto de cómo quedó, después de revisar el código:

- **Calendario (Puestodetrabajo)**: 100% lectura siempre. No existe
  ningún código en toda la app que le escriba nada — es garantía real,
  no depende de configuración.
- **Lista de corte**: la consulta que trae los datos es 100% lectura.
  Pero el código SÍ tenía (y sigue teniendo) dos endpoints capaces de
  escribir en una tabla aparte (`NestingControlCorte`, no en tu vista
  real) si algún día se crea esa tabla y se destilda la casilla
  "Simular el Rack". Eso ya lo tenías, pero dependía de un botón en
  pantalla — no era una garantía real a nivel de código.

  Para que sí lo sea, agregué un freno del lado del servidor: ahora,
  por más que alguien destilde esa casilla, el puente **rechaza**
  cualquier intento de escritura con un error 403, a menos que vos
  mismo pongas `PERMITIR_ESCRITURA_SQL=true` en tu `.env` — a
  propósito, sabiendo lo que estás haciendo. Por default viene en
  `false`. Hacen falta las DOS cosas (la tabla creada, Y esta variable
  en true) para que algo se escriba alguna vez.

*Validado:* probé los dos endpoints de escritura sin tocar esa
variable — los dos devolvieron 403 y no llegaron a tocar SQL para nada.
Con `PERMITIR_ESCRITURA_SQL=true` funcionan normal (por si algún día
conseguís el permiso y de verdad lo querés activar).

Toca: `server/server.js` (freno `bloquearSiSoloLectura` en los dos
endpoints de escritura) y `server/.env.example` (variable nueva
`PERMITIR_ESCRITURA_SQL`, documentada y apagada por defecto).

## Filtro por Puestodetrabajo (Planeacion, 01CORTE, 02CNC, 03SERIG, 04SER_VT)

Además del filtro que ya había por `Centro_Trabalho`, ahora "Lista de
corte" solo muestra órdenes cuyo `Puestodetrabajo` (el que viene del
servidor de Calendario) sea exactamente uno de estos 5:
**Planeacion, 01CORTE, 02CNC, 03SERIG, 04SER_VT**. Todo lo demás se
oculta — incluidas las órdenes que todavía no tienen ningún
Puestodetrabajo cargado (como confirmaste, esas también se ocultan).

La comparación no distingue mayúsculas ni espacios de más (mismo
criterio que usamos antes con Centro_Trabalho), para no repetir el
mismo lío si el dato viene escrito un poco distinto según la fila.

*Validado:* probé 5 órdenes a la vez — una sin Puestodetrabajo (se
ocultó), una con "16ACV" (se ocultó, no es de la lista permitida), y
tres con valores permitidos escritos de formas distintas ("01CORTE",
"02CNC", y "  planeacion  " en minúscula con espacios) — las tres
correctas quedaron, exactamente como se esperaba.

Toca: `server/server.js` (`PUESTOS_PERMITIDOS` y el filtro aplicado en
`/api/ordenes-pendientes`).

## El Rack simulado ahora se comparte de verdad entre todas las PC

Antes, el Rack simulado se guardaba en cada navegador por separado
(cada computadora veía SU PROPIO rack, sin verse entre sí — un problema
real con varias PC usando la app a la vez). Ahora vive en un archivo
chico dentro de `server/` (`rack-simulado.json`), en la PC que corre el
puente — sigue sin tocar SQL para nada, pero todas las computadoras que
le hablan a ese mismo puente ven exactamente el mismo Rack, lo
confirmen o lo saquen desde donde lo hagan.

No hace falta que hagas nada para esto — funciona solo en cuanto
actualices los archivos. Ese archivo (`rack-simulado.json`) se crea
solo la primera vez que alguien confirma una orden; no hace falta
crearlo a mano ni tocarlo.

*Validado:* abrí dos "computadoras" (dos navegadores separados,
hablándole al mismo puente) — confirmé una orden desde la primera, y la
segunda, sin haber tocado nada, la vio en su Rack con la misma
ubicación. También probé el archivo real en disco de punta a punta:
agregar, que no deje agregar la misma orden dos veces (409), asignar la
siguiente ubicación libre correctamente, y sacarla del rack.

Toca: `server/server.js` (endpoints nuevos `/api/rack-simulado*` +
`rack-simulado.json` como almacenamiento), y `js/ui/orders.js` (todo lo
del Rack simulado ahora le pregunta al puente en vez de guardar en
`localStorage`).

## Stickers con código de barras (10x3cm), automáticos al confirmar

Al confirmar un lote, además del PDF del nesting, ahora se descarga solo
un segundo PDF con un sticker de **100mm x 30mm** por cada orden que
entró al rack — pensado para tu impresora de etiquetas. Cada sticker
trae:

- **Orden** — grande, arriba a la izquierda.
- **Posición** — grande, arriba a la derecha (lo primero que hace falta
  ver para ubicarla físicamente).
- **Archivo** — el nombre del DXF (sin la ruta completa, para que entre
  legible).
- **Código de barras** (Code128, con el número de orden) — para volver
  a buscarla después con la pistola en el buscador del Rack.

El código de barras lo genero yo mismo, dibujado como líneas vectoriales
directo en el PDF (no como una imagen) — así sale nítido a cualquier
tamaño de impresión, y no depende de ninguna librería externa ni de
tener internet en esa PC.

*Validado:* comprobé la tabla de anchos de Code128 línea por línea
contra la tabla oficial (ISO/IEC 15417), repliqué el checksum contra el
ejemplo oficial documentado (dio exactamente el valor esperado), y
armé un decodificador propio para probar "ida y vuelta" con varios
números de orden y nombres de archivo reales tuyos — todos decodificaron
exacto. También probé la descarga completa: la cantidad de páginas
correcta, y que confirmar un lote de verdad dispare los stickers con
los datos reales (orden, archivo, ubicación asignada).

Si el tamaño de tu impresora cambia, o querés ajustar qué datos
aparecen o el diseño, avisame — está todo en un solo archivo
(`js/export/stickers.js`), fácil de ajustar.

Toca: `js/export/stickers.js` (nuevo), `index.html` (carga el script
nuevo), `js/ui/orders.js` (`ordConfirmar` llama a
`generarStickersPDF` con lo que efectivamente entró al rack), y
`server/queries.js`/`server.js` (el endpoint de marcar-en-stock ahora
también devuelve la ubicación asignada, para que los stickers funcionen
igual si algún día activás la escritura real en SQL).

## Impresión directa en la Zebra (sin abrir ningún PDF)

Como tu Zebra está conectada por USB a una PC puntual (no por red), la
única forma de que imprima sola, sin ningún diálogo de "Imprimir" de
por medio, es que el puente le mande los comandos directo — por eso
esto tiene que correr en la MISMA PC donde está conectada la Zebra por
USB.

### Paso a paso en Windows (una sola vez)

1. **Verificá que la Zebra esté instalada** en esa PC (Configuración →
   Dispositivos → Impresoras y escáneres). Si no está, instalala con el
   instalador que trae Zebra, o Windows la va a detectar sola al
   conectarla por USB.

2. **Agregá una impresora nueva en modo "Generic / Text Only"**,
   apuntando a esa misma Zebra — esto es lo que permite mandarle texto
   crudo (ZPL) sin que Windows intente "dibujarlo" como si fuera un
   documento normal:
   - Configuración → Impresoras y escáneres → "Agregar dispositivo" →
     "La impresora que quiero no está en la lista".
   - Elegí "Agregar una impresora local con configuración manual".
   - En "Puerto": elegí el puerto USB donde está la Zebra (suele
     aparecer como algo con "USB" en el nombre).
   - En "Fabricante": buscá **"Generic"**, y en "Impresoras": **"Generic
     / Text Only"**.
   - Seguí el asistente y ponele un nombre que reconozcas, por ejemplo
     `ZebraRaw`.

3. **Compartila** (aunque la vayas a usar solo desde esa misma PC —
   Windows necesita esto para el truco de mandarle datos crudos):
   - Clic derecho sobre esa impresora nueva → Propiedades de impresora
     → pestaña "Compartir".
   - Tildá "Compartir esta impresora".
   - En "Nombre del recurso compartido", poné algo simple, por ejemplo
     `ZebraRaw` (sin espacios) — **ese nombre exacto es el que vas a
     poner en tu `.env`**.

4. **Completá tu `.env`** (en la carpeta `server`, la misma donde ya
   tenés el resto):
   ```
   ZEBRA_PRINTER_SHARE=ZebraRaw
   ```
   (cambiá `ZebraRaw` por el nombre que le pusiste vos en el paso 3).

5. **Reiniciá el puente** (cerrá la ventana de `iniciar` y volvé a
   abrirla, para que tome el `.env` nuevo).

6. **Probá confirmando un lote chico** (una sola orden) y fijate si la
   etiqueta sale sola de la Zebra.

### Si el sticker sale mal ubicado o mal escalado

Revisá `ZPL_DPI` en `js/export/stickers.js` (arriba del todo del
archivo) — viene en 203 por default (lo más común en Zebra de
escritorio). Si tu modelo es de 300 dpi (más común en modelos
industriales), cambiá esa línea a `const ZPL_DPI = 300;`. El dato de
dpi de tu modelo suele estar en una etiqueta pegada en la impresora, o
en la caja/manual.

### Si preferís seguir con el PDF

No hace falta que hagas nada de esto — dejando `ZEBRA_PRINTER_SHARE`
vacío en tu `.env`, la app sigue funcionando exactamente como antes
(descarga el PDF de stickers al confirmar).

*Validado (lo que se puede probar sin una Zebra real y sin Windows):*
armé el generador de ZPL y probé que arma bien los comandos (incluido
sacar caracteres `^`/`~` de nombres de archivo raros, para que nunca
rompan un sticker), que el endpoint nuevo del puente avisa claro
cuando `ZEBRA_PRINTER_SHARE` no está configurado (sin intentar nada),
que si está configurado arma y ejecuta bien el comando de impresión
cruda (con limpieza del archivo temporal), y que el flujo completo de
"Confirmar" intenta la Zebra primero y cae solo al PDF si no está
disponible. Lo que **no** pude probar desde acá, por no tener Windows
ni una Zebra real a mano, es el resultado final tal cual sale
impreso — por eso te pido que hagas la prueba del paso 6 y me cuentes
qué tal salió.

Toca: `js/export/stickers.js` (generador de ZPL +
`imprimirStickersZPL`), `js/ui/orders.js` (`ordConfirmar` intenta ZPL
primero, PDF como respaldo), `server/server.js` (endpoint nuevo
`/api/imprimir-zpl`), y `server/.env.example` (variable
`ZEBRA_PRINTER_SHARE`).

## Entrar con una dirección web (en vez de abrir un archivo)

Ahora el mismo puente también sirve la app — así que, en cualquier
computadora de la red, podés escribir directo en el navegador la
dirección que te muestra la ventana de `iniciar` (la misma que ya
usabas para "Dirección del puente"), por ejemplo:

```
http://172.16.60.223:4000
```

y se abre la app completa ahí mismo — sin abrir ningún archivo, sin
carpeta compartida, sin copiar nada a cada PC. Y de yapa, el campo
"Dirección del puente" se completa solo con esa misma dirección, así
que tampoco hay que tocarlo.

Esto es más cómodo que la carpeta compartida (Opción B que charlamos
antes) porque ni siquiera hace falta esa carpeta — todo sale del mismo
lugar donde ya tenés el puente corriendo. Podés armarles a todos un
acceso directo con esa dirección en el escritorio.

**Sobre `https://` (con candado):** no es necesario ni práctico acá —
conseguir un `https://` de verdad (con certificado válido) requiere un
dominio público y expone el puente a internet, cosas que no le hacen
falta a una herramienta interna de tu red. El `http://` normal, dentro
de tu red local, es exactamente lo que corresponde para este caso — el
mismo criterio que usa la gran mayoría de herramientas internas de
empresa.

**Sobre seguridad:** el puente NUNCA sirve la carpeta `server/` (donde
está tu `.env`, con las contraseñas de SQL) — solo `index.html`, `css/`
y `js/`, explícitamente. Nada de eso queda accesible desde ningún
navegador, ni por la ruta directa ni con trucos de `../`.

*Validado:* confirmé que `/server/.env` y `/server/queries.js` dan 404
(no se pueden ver de ninguna forma, ni con intentos de escapar la
carpeta con `../`), que `/js/app.js` sirve exactamente el archivo real,
y probé la app completa cargando de punta a punta contra el servidor
real (no simulado) — el campo de dirección del puente se autocompletó
solo y todo funcionó igual que siempre.

Toca: `server/server.js` (sirve `index.html`, `css/` y `js/`
explícitamente, nunca `server/`) y `js/ui/orders.js` (autocompleta la
dirección del puente si la página se abrió como página web).

## Usuarios: Lista de corte, Nesting y Editor de archivos piden sesión

Agregué inicio de sesión. **El Rack queda siempre abierto**, sin pedir
nada — es la pestaña con la que arranca la app ahora. Las otras 3
(Lista de corte, Nesting, Editor de archivos) muestran un 🔒 y, si
intentás entrar sin haber iniciado sesión, te aparece el formulario de
login en vez de la pestaña.

### Cómo cargar los usuarios

En tu `.env` (la misma carpeta `server`), agregá:
```
AUTH_USUARIOS=Programador 1:clave123,Programador 2:clave456,Programador 3:clave789
```
Formato: `Nombre:clave`, separados por coma. Podés poner los nombres
que quieras (no tienen que ser "Programador N"), y tantos como
necesites. Reiniciá el puente (`iniciar`) después de guardar el `.env`
para que tome los usuarios nuevos.

Si dejás `AUTH_USUARIOS` vacío, nadie va a poder entrar a esas 3
pestañas (van a pedir sesión, pero ningún usuario/clave va a ser
válido) — completalo antes de que alguien lo necesite.

### Cómo funciona por dentro

- Las contraseñas viven SOLO en tu `.env` — nunca en ningún archivo de
  este código, ni se ven en el navegador de nadie.
- Al iniciar sesión, el puente genera un código al azar (el "token") y
  lo guarda en su propia memoria mientras esté prendido — se lo manda
  la app en cada pedido después, para probar que sigue con la sesión
  abierta.
- Si reiniciás el puente (cerrás y volvés a abrir `iniciar`), todas
  las sesiones se cierran solas — todos tienen que volver a loguearse.
  Es intencional: así nunca queda una sesión colgada para siempre.
- La sesión de cada persona se guarda en su propio navegador
  (`sessionStorage`) — se cierra sola si cierra la pestaña o el
  navegador, sin que tengas que hacer nada.
- Del lado del servidor, los pedidos de Lista de corte (traer
  pendientes, traer un DXF, confirmar al rack, mandar a imprimir)
  exigen esa sesión de verdad — no es solo "esconder" el botón en
  pantalla, el puente también lo rechaza si alguien intentara saltarse
  la pantalla.

*Validado:* probé los 2 lados — el puente solo (login con clave mala,
login correcto, pedir datos protegidos sin sesión → rechaza, con
sesión → funciona, cerrar sesión invalida el token) y la app completa
(arranca en Rack, bloquea Lista de corte sin sesión, loguea bien,
desbloquea las pestañas, y cerrar sesión vuelve a Rack) — y de yapa,
una prueba de punta a punta contra el servidor real (no solo
simulado): login real, entrar a Lista de corte, y hasta la consulta a
SQL protegida funcionando con la sesión activa.

Toca: `server/server.js` (usuarios, login/logout, `exigirLogin` en los
endpoints que corresponde), `server/.env.example` (variable
`AUTH_USUARIOS`), `js/ui/auth.js` (nuevo), `js/app.js` (`switchView`
respeta el login), `js/ui/orders.js` (`ordApiHeaders` suma el token de
sesión), e `index.html` (panel de login, pestañas con 🔒, arranca en
Rack).

## Buscador en Lista de corte + Resumen del día

Dos agregados chicos, cada uno independiente:

**Buscador**: campo arriba de la tabla de pendientes — escribís
cualquier texto (número de orden, modelo, centro de trabajo, nombre,
etc.) y filtra la tabla en vivo, sin tocar el servidor para nada (es
sobre lo que ya está en pantalla). El contador arriba pasa a mostrar
"X de Y" mientras hay un filtro activo.

**Resumen del día**: un renglón nuevo debajo de "Órdenes pendientes",
con "Cortadas hoy · Sacadas hoy · En rack ahora". Se arma con un
registro chico y separado (`rack-historial.json`, junto al
`rack-simulado.json` que ya tenías) que anota cada entrada y salida del
Rack con su fecha — a diferencia del estado del rack (que se borra al
sacar algo), este registro solo crece, así el resumen sigue contando
bien aunque ya se haya sacado una orden en el día. Se actualiza junto
con "Actualizar lista de pendientes", nunca solo.

*Validado:* probé el buscador con 3 tipos de filtro (por nombre, por
centro de trabajo, y uno que no matchea nada) y confirmé que la
selección de casillas sigue apuntando a la orden correcta aunque la
tabla esté filtrada — el caso más delicado de este cambio. También
probé el resumen de punta a punta contra el servidor: entradas,
salidas, y que los números cuadren en cada paso. De paso encontré y
corregí un bug real (no relacionado al pedido): el resumen no esperaba
a que terminara de pedirse antes de seguir.

Toca: `server/server.js` (`rack-historial.json`,
`/api/rack-resumen-dia`), `js/ui/orders.js` (`ordFiltroTexto`,
`ordCoincideFiltro`, `ordActualizarResumenDia`), e `index.html` (campo
de búsqueda y renglón de resumen).

## Columnas ordenables, Centro_Trabalho oculto, y "Lote actual" (armar el lote a mano, de a una)

Tres cambios juntos en Lista de corte, todos del lado del navegador (no
tocan SQL ni el puente):

**Columnas ordenables**: tocás cualquier encabezado de la tabla
(Ordem_Serial, Operation, Puestodetrabajo, etc.) y ordena por esa
columna — el primer toque ordena de mayor a menor (▼), el segundo de
menor a mayor (▲). Si la columna es numérica compara como número (para
que Ordem_Serial no ordene como texto), si no, alfabéticamente.

**Centro_Trabalho oculto**: ya no se dibuja como columna en la tabla,
pero el buscador lo sigue usando para filtrar — escribir "01CORTE" en
el buscador sigue funcionando igual que antes, solo que ya no ocupa
lugar en pantalla. Lo mismo vale para Puestodetrabajo y para el número
de orden: el mismo campo de búsqueda de siempre filtra por cualquiera
de los dos (y por los demás campos también).

**Lote actual** (el cambio más grande): antes seleccionabas casillas
en toda la tabla y tocabas "Ejecutar" una sola vez. Ahora se arma como
en SAGA (dos tablas, una abajo de la otra): tocás "+ Lote" en una
orden de Lista de corte y esa orden se pasa a una tabla nueva, "Lote
actual" — y desaparece de Lista de corte mientras está ahí, para no
agregarla dos veces sin querer. "+ Agregar visibles al lote" hace lo
mismo con todo lo que esté filtrado/visible en ese momento, de una
sola vez. "Ejecutar lote de corte" ahora nestea lo que esté en "Lote
actual" (ya no las casillas tildadas). Después de nestear, cada orden
del lote queda marcada "✓ ubicada" o "⚠ sin ubicar" — si alguna no
entró en la chapa, la sacás con el botón "Quitar" de esa misma tabla
(vuelve sola a Lista de corte, lista para agregar otra en su lugar) y
volvés a tocar "Ejecutar". "Confirmar" solo manda al Rack las que
quedaron efectivamente ubicadas en la última corrida de "Ejecutar" —
las demás se quedan esperando en el lote hasta que las saques o
vuelvas a nestear.

Si "Actualizar lista de pendientes" trae una lista donde alguna orden
que tenías en el lote ya no figura (por ejemplo, otro programador ya
la cortó desde otra PC), se saca sola del lote y te avisa en el
mensaje de estado — no hace falta que la busques a mano.

*Validado:* con datos simulados (3 órdenes) probé, en orden: ordenar
por Ordem_Serial en los dos sentidos, que Centro_Trabalho no aparezca
como columna, agregar una orden al lote (desaparece de arriba,
aparece abajo), filtrar por Puestodetrabajo, ejecutar el lote y ver la
marca "✓ ubicada", sacarla con "Quitar" (vuelve arriba), agregar las 3
visibles de una, y confirmar — comprobando que Confirmar solo mueve
las que de verdad se nestearon en la última corrida.

Toca: `js/ui/orders.js` (reescrito el filtrado/orden/render de la
tabla, nuevo `ordEnLoteIds`/`ordLoteEstado`, `ordAgregarALote`,
`ordQuitarDelLote`, `ordRenderLote`, `ordEjecutarLote` y `ordConfirmar`
adaptados al lote en vez de casillas), `index.html` (tabla nueva del
lote, botón "Agregar visibles al lote", saqué "Seleccionar todas"), y
`css/styles.css` (encabezados con cursor de orden, contenedor con
scroll para las dos tablas).

## Código de barras de la Zebra que no salía en la etiqueta física

Reportaste (con foto) que la Zebra imprimía Orden/Posición/Archivo
perfecto, pero el código de barras no se veía en la etiqueta física —
aunque en el PDF de respaldo sí salía completo. Mediste la etiqueta con
una regla y confirmaste que sí es 100x30mm como está configurado, así
que no era un tema de tamaño de etiqueta.

La causa más probable: en el diseño anterior el código de barras
arrancaba a los 18mm de alto y, con su línea de texto legible debajo,
terminaba prácticamente pegado al borde de los 30mm — sin nada de
margen. Cualquier corrimiento chico de calibración de la impresora
(normal en etiquetadoras, no es que esté rota) alcanza para tirarlo
fuera de la etiqueta.

Se reordenó el ZPL: ahora el código de barras va justo después de
Orden/Posición (arranca a los 12mm, termina a los 19mm), y el nombre
de archivo — el dato menos importante de los tres — quedó al final, a
los 21mm, con casi 7mm de margen hasta el borde. También se sacó la
línea de texto legible debajo del código (era redundante, el número ya
se ve grande arriba) para ganar espacio. Si ahora el archivo se llegara
a cortar en algún caso límite, no importa; el código de barras y los
datos clave (Orden, Posición) van a salir siempre.

*Validado:* revisé las cuentas en mm a mano (código de barras 12→19mm,
archivo 21→23.2mm, deja 6.8mm de margen contra el borde de 30mm) y
confirmé que `node --check` sigue pasando. No pude probarlo contra una
Zebra física real desde acá — eso lo tenés que confirmar vos con el
próximo lote que imprimas.

Toca: `js/export/stickers.js` (`zplDeUnSticker`, solo el layout ZPL —
el PDF de respaldo no se tocó, porque ese sí venía saliendo bien).

## Reimprimir un sticker individual desde el Rack

Cada fila de la tabla del Rack ahora tiene un botón **"🖨 Reimprimir
sticker"**, al lado de "Sacar del rack". Lo manda a la Zebra igual que
al confirmar un lote (con el mismo respaldo automático a PDF si la
Zebra no está configurada o falla), usando los mismos datos que ya
están en esa fila — no vuelve a consultar SQL, no cambia la ubicación
asignada, no mueve nada del Rack. El resultado (o el error) se muestra
en un renglón chico debajo del buscador de la izquierda.

De paso, revisando esto until encontré un bug real (no relacionado al
pedido, pero que iba a afectar directamente esta función): al confirmar
un lote con el Rack simulado, no se le mandaba el nombre del archivo al
archivo compartido del puente (`rack-simulado.json`) — solo Ordem_Serial,
Operation, Centro_Trabalho, Puestodetrabajo, ClaveModelo, CodMat, Name,
ZTipo y Descricao, pero no ARCHIVO. Eso significa que cualquier orden
confirmada ANTES de este cambio va a reimprimirse con "—" en vez del
nombre real del archivo (las nuevas, de acá en adelante, van a salir
bien). Lo mismo pasaba del lado de SQL real: la consulta `rackActual`
tampoco traía la columna del archivo — se corrigió también, aunque
mientras sigas con "Simular el Rack" tildado esa consulta no se usa.

*Validado:* con datos simulados (2 órdenes en el rack) probé reimprimir
una con la Zebra "funcionando" (confirmé que se manda con el nombre de
archivo correcto), la otra forzando que la Zebra falle (confirmé que
cae solo al PDF con el mismo dato), y pedir el sticker de una orden que
no existe en el rack (mensaje claro, no rompe nada).

Toca: `js/ui/orders.js` (nueva `ordImprimirStickersConFallback` —
compartida entre "Confirmar" y "Reimprimir" —, `rackReimprimirSticker`,
botón nuevo en `rackRender`, y el fix de ARCHIVO en
`rackSimuladoAgregar`), `index.html` (botón y renglón de estado en la
vista Rack), y `server/queries.js` (columna ARCHIVO agregada a
`rackActual` — ojo, este archivo normalmente NO se pisa al actualizar,
así que si preferís no reemplazarlo entero, el cambio es agregar
`v.Desenho_Path AS "ARCHIVO",` en el SELECT de `rackActual`).

## Más margen abajo en el sticker de la Zebra (el ajuste anterior no alcanzó)

Probaste el ajuste anterior (código de barras a los 12mm) y contaste
que "subió un poco no más" — seguía viéndose parecido. Eso es una
señal de que el problema es más grande de lo que un par de milímetros
de margen alcanzan a tapar, así que esta vez se comprimió bastante más
fuerte: todo el contenido (Orden, Posición, código de barras y
archivo) ahora termina a los ~18.3mm de alto, dejando **11.7mm libres**
hasta el borde real de los 30mm — más de los 10mm que pediste.

*Ojo con esto:* si después de este cambio el código de barras TODAVÍA
sale cortado más o menos igual que antes, ya no es un tema de margen —
es que la Zebra está calibrada pensando que la etiqueta física es más
corta de lo que realmente es (algo común si nunca se hizo una
calibración automática de esa impresora, o si alguien cambió el rollo
de etiquetas sin recalibrar). En ese caso el arreglo no está en el
código sino en la impresora: desde el panel de la Zebra (o el software
Zebra Setup Utilities) se puede correr una calibración automática de
medios ("Sensor Calibration" / "Media Calibration") para que aprenda
el largo real de la etiqueta que tiene cargada ahora. Avisame si llega
a pasar esto para pensar el siguiente paso juntos.

*Validado:* revisé las cuentas en mm a mano (todo el contenido termina
a los 18.3mm, deja 11.7mm de margen) y `node --check` sigue pasando.
No lo pude probar contra una Zebra física real desde acá.

Toca: `js/export/stickers.js` (`zplDeUnSticker`, otra vez solo el
layout ZPL).

## Arreglo: la app se trababa al correr nesting varias veces, y "Parar" tardaba en reaccionar

Contaste que la app se traba después de correr nesting más de 2 veces
(a veces con solo 1 vez alcanza), la página "se pega", y tocar "Parar"
tarda en hacer efecto. Revisando el código encontré dos causas
distintas, las dos reales:

**1) El panel de "intentos" (el historial que se ve durante el
nesting) nunca se limpiaba cuando corrías el nesting desde Lista de
corte ("Ejecutar lote de corte").** Sí se limpiaba cuando corrías
nesting desde la pestaña de Nesting normal, pero el camino de Lista de
corte se lo saltaba — así que cada vez que ejecutabas un lote, todos
los intentos de la corrida anterior se quedaban sumados a los nuevos
en memoria y en la pantalla, sin límite. Con 1 sola corrida larga ya
puede haber miles de intentos; con 2 o 3 corridas sin limpiar, el
navegador termina con demasiado guardado y se pone lento o se cuelga.
Arreglo: ahora la limpieza del panel de intentos pasa siempre, apenas
arranca cualquier corrida de nesting, sin importar desde qué pestaña
se la dispara.

**2) El botón "Parar" ponía una señal (`nestingState.stop`), pero esa
señal solo se revisaba ANTES de empezar cada intento nuevo — nunca
DURANTE el cálculo de un intento ya en curso.** Si un intento
individual tardaba varios segundos en calcularse (piezas difíciles de
acomodar, chapas grandes), tocar "Parar" no hacía nada hasta que ese
intento terminara solo — podía sentirse como que la app no respondía.
Arreglo: ahora el cálculo revisa la señal de "Parar" en varios puntos
DENTRO del propio cálculo (no solo al principio de cada intento), así
que corta mucho más rápido. Además, parte del cálculo corre en un
"hilo" aparte del navegador (para no trabar la pantalla mientras
calcula) — a ese hilo aparte antes no le llegaba la señal de "Parar"
para nada, así que ahora "Parar" también lo apaga de inmediato (y arma
uno nuevo, listo para la próxima vez que nesteés).

*Validado:* armé una prueba automática (con jsdom, simulando 3
corridas seguidas de "Ejecutar lote" con 8 intentos cada una) que
confirma que ahora solo quedan los 8 intentos de la ÚLTIMA corrida en
el panel — antes se hubieran quedado los 24 acumulados. También
`node --check` pasa en los tres archivos tocados. No lo pude probar en
vivo corriendo nesting real varias veces seguidas desde acá (no tengo
tu base de datos ni una pantalla real) — avisame si después de este
cambio la sigue trabando, para seguir revisando con más detalle de lo
que esté pasando en ese momento (cuántas piezas, cuántas chapas,
cuántas veces corriste nesting antes de que se trabe).

Toca: `js/nesting/engine.js` (la limpieza del panel ahora pasa siempre
al arrancar `doNest`, y el botón "Parar" ahora también apaga el hilo
aparte), `js/nesting/optimization.js` (el cálculo revisa la señal de
"Parar" en más puntos), `js/nesting/worker-bridge.js` (nueva función
para apagar el hilo aparte al instante).

## Revisado: el filtro de "01CORTE" en Lista de corte (sin encontrar un bug de código)

Armé una prueba con datos de ejemplo simulando exactamente tu caso
(una orden con `Centro_Trabalho='01CORTE'`, otra con
`Puestodetrabajo='01CORTE'`, otra sin ninguno) y escribí "01CORTE" en
el buscador — el filtro encontró correctamente las 2 que correspondían
y ocultó la que no. O sea: la lógica del filtro en sí está bien.

Dos cosas a tener en cuenta para la próxima vez que lo veas fallar:
- **Lista de corte ya viene recortada desde el servidor** antes de que
  el filtro del buscador toque nada: solo llegan órdenes cuyo
  `Puestodetrabajo` (el que trae del servidor de Calendario) sea
  `PLANEACION`, `01CORTE`, `02CNC`, `03SERIG` o `04SER_VT` — las demás
  ni siquiera llegan a tu navegador. Si en ese momento ninguna de las
  órdenes visibles tenía `Puestodetrabajo` ni `Centro_Trabalho`
  justo en "01CORTE" (por ejemplo, si todas estaban todavía en
  "PLANEACION"), el buscador te iba a mostrar 0 resultados — eso ES
  filtrar, aunque se sienta raro que no aparezca nada.
- Si en cambio la tabla se queda mostrando TODAS las órdenes sin
  recortar nada (no baja el número), eso sí sería un bug real, pero
  distinto al que pude reproducir acá.

Para poder seguir esto si vuelve a pasar, la próxima vez que escribas
"01CORTE" y no filtre, fijate en el número que aparece arriba de la
tabla (algo como "3 de 12" o "0 de 12") y contame qué número te
aparece — con eso puedo saber si es el caso de "0 resultados reales" o
si de verdad no está recortando nada.

Toca: nada (por ahora) — solo revisión y prueba, sin cambios de
código.

## Reentrada al rack en la misma posición (para cuando le dan salida por error)

Nuevo: si buscás una orden en el Rack y NO aparece, pero salió hace
poco (le dieron "Sacar del rack" por error), ahora el buscador mismo
te ofrece un botón para reingresarla **en la misma posición exacta**
en la que estaba — en vez de que tengas que volver a Lista de corte,
buscar la orden, nestearla de nuevo, y que le toque una posición nueva
cualquiera.

Cómo se usa: en la pestaña Rack, escribís o escaneás el número de
orden como siempre. Si no está, y salió hace poco, aparece un mensaje
con la posición donde estaba y un botón "↩ Reingresar en la posición
X" — un clic y queda de vuelta ahí mismo.

Qué pasa si esa posición ya la ocupa OTRA orden (por ejemplo, cortaron
otra pieza y quedó justo ahí mientras tanto): la app lo rechaza con un
mensaje explicando cuál orden la está ocupando — no pisa nada en
silencio. En ese caso hay que sacar esa otra orden primero, o
reingresar la tuya desde "+ Agregar" en Lista de corte para que le
asignen una posición libre cualquiera.

*Ojo:* esto por ahora solo funciona con "Simular el Rack" tildado (que
es como lo estás usando) — no toca SQL para nada, guarda todo en el
mismo archivo del puente que ya usa el resto del Rack simulado.

*Validado:* armé una prueba automática simulando el flujo completo
(buscar una orden que salió por error → que ofrezca el botón → tocarlo
→ que quede reingresada en la posición correcta → volver a buscarla y
que ahora sí diga "está en el rack") y también el caso de rechazo
(posición ya ocupada por otra orden). Los dos casos pasaron. También
`node --check` pasa en los archivos tocados. No lo pude probar contra
tu rack real desde acá.

Toca: `server/server.js` (nuevo endpoint `GET
/api/rack-simulado/:orden/ultima-salida`, nuevo endpoint `POST
/api/rack-simulado/reentrada`, y el endpoint de "salida" ahora guarda
en el historial la ubicación y los datos completos de la orden, no
solo el número, para poder reconstruirla), `js/ui/orders.js`
(`rackBuscar` ahora también consulta si hubo una salida reciente
cuando no encuentra la orden, nueva función `rackReingresar`),
`index.html` (una línea explicando la función nueva).

## Vistas más amigables: ya no hay que bajar tanto la página, y Lista de corte quedó en 3 columnas como SAGA

Mandaste una captura de SAGA como ejemplo: una columna angosta de
configuración a la izquierda, la tabla grande al centro, y otra
columna angosta a la derecha — todo a la vista, sin tener que ir
bajando la página para pasar de una parte a otra.

**Lo que cambié:**

- **Lista de corte ahora tiene 3 columnas lado a lado:** configuración
  (izquierda, angosta), la tabla de órdenes pendientes (centro, la
  grande — es donde más tiempo se pasa), y el Lote actual (derecha,
  angosta) — igual que en tu captura de SAGA. Antes el Lote actual
  quedaba abajo de la tabla de pendientes, en la misma columna, y había
  que bajar bastante para verlo.
- **Ya no hay que scrollear la PÁGINA completa en ninguna pestaña**
  (Lista de corte, Nesting, Rack, Editor de archivos): el título y las
  pestañas de arriba se quedan siempre fijos, y cada columna (la de
  configuración, la de la tabla, etc.) scrollea por su cuenta, por
  dentro, si su contenido no entra completo. Antes, por ejemplo en
  Nesting, para llegar a los últimos ajustes de la columna izquierda
  había que bajar toda la página; ahora esa columna tiene su propio
  scroll interno y el resto de la pantalla no se mueve.
- **Nombre y logo:** el título de la pestaña del navegador y el
  encabezado ahora dicen "Nesting - Optimización" (antes "Nesting DXF
  — v4"), y le agregué un ícono para la pestaña del navegador
  (favicon) con el mismo punto turquesa que ya tenía el encabezado.

*Ojo con esto:* en una pantalla MUY angosta (menos de ~1100px de
ancho) las 3 columnas de Lista de corte pueden no entrar todas juntas
— ahí aparece un scroll horizontal en vez de amontonarse. En cualquier
monitor normal de PC de oficina esto no debería pasar.

*Validado:* probé la app con Playwright (un navegador automatizado)
en dos resoluciones típicas de PC de oficina (1440×850 y 1366×720),
con datos de prueba cargados en las tablas — en las dos, la página
completa mide EXACTAMENTE el alto de la pantalla (cero scroll de
página) y cada columna scrollea por separado como corresponde;
también revisé Rack y Editor de archivos para confirmar que no se
rompió nada ahí. `node --check` pasa en todos los `.js`. No lo pude
ver en tu pantalla real ni con tus datos reales — avisame si en tu PC
se ve distinto a lo que esperabas (por ejemplo, el tamaño de letra, o
si en tu monitor las columnas sí se amontonan).

Toca: `css/styles.css` (reestructuré cómo se reparte el alto de la
página y el ancho de las columnas), `index.html` (Lista de corte
ahora arma sus dos tablas como dos paneles separados lado a lado en
vez de uno apilado; título, encabezado y favicon nuevos). No toqué
nada de `js/` — los mismos ids (`ordTableWrap`, `ordLoteWrap`,
`ordStagePanel`, etc.) siguen donde estaban, así que ninguna función
existente necesitó cambios.

## Logo de AGP en el encabezado y en la pestaña del navegador

En la segunda captura que mandaste venía el logo de AGP, pero se veía
en blanco — no fue que no llegó: el archivo SÍ tenía el logo (las
letras "AGP" en blanco, con el arco arriba), pero estaba con el fondo
totalmente transparente, así que al mostrarlo sobre un fondo blanco
quedaba invisible. Lo recorté (le saqué el margen vacío de los
costados) y ahora aparece:

- **En el encabezado**, al lado de "Nesting Optimización".
- **En la pestaña del navegador** (favicon), en una versión cuadrada
  con fondo oscuro para que se vea bien de chiquito.

*Validado:* levanté la página con un navegador automatizado y
confirmé que las dos imágenes cargan bien (HTTP 200, sin errores en
consola) y se ven correctamente sobre el fondo oscuro de la app.

Toca: `index.html` (encabezado reorganizado con el logo y el favicon),
`css/styles.css` (tamaño y acomodo del logo), y dos archivos nuevos en
`img/` (`agp-logo.png` para el encabezado, `favicon-agp.png` para la
pestaña).

## Ingreso rápido de órdenes al lote (orden + Enter, orden + Enter...)

Nuevo cuadro "Ingreso rápido" en Lista de corte, arriba de "Lote de
corte": escribís (o escaneás con la pistola) un número de orden y
tocás Enter — se agrega sola al lote, el cuadro se vacía solo y queda
listo para la siguiente, así vas poniendo orden, Enter, orden, Enter,
sin tocar el mouse en ningún momento. Es el mismo patrón que ya usa el
buscador del Rack.

(La primera versión de esto pedía pegar todas las órdenes juntas
separadas por comas en un cuadro grande y tocar un botón — pero eso no
era lo que hacía falta; lo cambié por este flujo de "una por una con
Enter", que es como realmente se trabaja.)

Cómo se comporta:
- Cada número se busca contra las órdenes que trajo "Actualizar lista
  de pendientes" — nunca agrega algo que no esté ahí.
- Después de cada Enter te dice, en una sola línea, si la agregó (✓),
  si no la encontró (⚠, por typo o porque ya se cortó), o si esa orden
  ya estaba en el lote.
- Si por accidente escribís o pegás varios números juntos separados
  por espacio o coma antes de tocar Enter, también los agrega todos de
  una — no hace falta que sea siempre uno solo.
- No duplica nada: una orden que ya está en el lote no se vuelve a
  agregar aunque la escribas de nuevo.

*Validado:* prueba automática simulando la secuencia real (escribir
una orden y Enter, la siguiente y Enter, una repetida, una que no
existe, y un Enter con el cuadro vacío) — los cinco casos se
comportaron exactamente como se espera, incluyendo que el cuadro
quede vacío y listo después de cada Enter. También lo miré armado en
pantalla para confirmar que se ve bien dentro del panel izquierdo, que
ya scrollea solo. `node --check` pasa.

Toca: `js/ui/orders.js` (`ordIngresoRapidoAlLote`, reemplaza a la
versión anterior de "ingreso masivo"), `index.html` (el cuadro ahora
es un campo de una sola línea con Enter, no un cuadro grande con
botón).

## Ingreso rápido: ahora también encuentra órdenes sin Puestodetrabajo cargado

Aclaraste que en "Ingreso rápido" no querés que una orden se omita
solo porque no salió en la Lista de corte que ya se cargó — recordá
que esa lista SOLO trae órdenes con Puestodetrabajo en
PLANEACION/01CORTE/02CNC/03SERIG/04SER_VT (ver más arriba, "Revisado:
el filtro de 01CORTE"), así que una orden con Puestodetrabajo en
blanco (o con cualquier otro valor) nunca llega a esa lista, aunque sí
exista en SQL con Operation 0132 y tenga su archivo/ruta real
cargados.

Ahora, cuando escribís una orden en "Ingreso rápido" y esa orden NO
está en la lista ya cargada, antes de darla por perdida la busca
DIRECTO en tu SQL — esa búsqueda puntual no exige nada de
Puestodetrabajo, la única condición que mantiene es Operation='0132'
(como pediste, "acuerdate del 0132"). Si la encuentra así, la agrega
al lote con su archivo/ruta real, igual que cualquier otra — el nesting
y el resto de la app no notan ninguna diferencia. Solo si tampoco
existe con Operation 0132 queda como "no existe" de verdad (ahí sí es
un número mal escrito, o de otra operación).

*Ojo con esto:* esta búsqueda puntual pega contra tu SQL real cada vez
que escribís una orden que no está en la lista cargada — en modo
"Simular el Rack" esto no cambia nada del Rack (sigue simulado), solo
trae los DATOS de la orden desde SQL para poder nestearla.

*Validado:* prueba automática con tres casos — una orden ya cargada
localmente, una orden que NO está cargada pero existe en SQL sin
Puestodetrabajo (debe encontrarla igual), y una que de verdad no
existe — los tres se comportaron como se espera. `node --check` pasa
en servidor y cliente.

Toca: `server/queries.js` y `server/queries.example.js` (nueva
consulta `ordenPorSerial`, sin filtro de Puestodetrabajo, solo
Operation='0132'), `server/server.js` (nuevo endpoint `GET
/api/ordenes-pendientes/:orden`), `js/ui/orders.js`
(`ordBuscarOrdenSuelta`, y `ordIngresoRapidoAlLote` ahora es async y
recurre a esa búsqueda cuando no encuentra la orden en lo ya cargado).

## "No se pudo conectar al puente... HTTP 500" / Timeout de 15000ms en /api/ordenes-pendientes

Mandaste una captura con este error, y la consola del puente mostraba
varias veces seguidas:
```
[ordenes-pendientes] Timeout: Request failed to complete in 15000ms
```
Esto es un límite de tiempo del propio driver de SQL Server (15
segundos por default), no un error de la app ni de los cambios de hoy
— revisé y la consulta de `ordenesPendientes` en `queries.js` quedó
exactamente igual que antes, no la toqué. El puente sí logró
conectarse (el login funcionó bien), pero la consulta contra
`SAGA_View_Ficha_Componentes_Colombia` tardó más de 15 segundos en
volver — puede ser por VPN/red lenta hacia tu SQL Server, la vista
siendo pesada, o el servidor con carga en ese momento.

Dos cambios para esto:

1. **Subí el límite de tiempo por default** a 60 segundos para las
   consultas y 30 para conectar (antes eran 15 y 15) — así una
   consulta que tarda un poco más que el default del driver, pero que
   de verdad iba a terminar, ahora tiene margen para hacerlo en vez de
   cortarse. Es ajustable desde tu `.env` con `DB_REQUEST_TIMEOUT_MS` /
   `DB_CONNECTION_TIMEOUT_MS` si hiciera falta subirlo más (ver
   `.env.example` — no hace falta tocar nada si 60s ya alcanza).
2. **Arreglé un bug real que encontré de paso**: si la conexión a SQL
   fallaba una vez (por lo que sea), el puente se quedaba "pegado" con
   ese mismo intento fallido para siempre — había que cerrar la
   ventana de "iniciar.bat" y volver a abrirla para que probara de
   nuevo. Ahora, apenas un intento de conectar falla, se olvida solo y
   el PRÓXIMO pedido arranca una conexión nueva de cero, sin que haga
   falta reiniciar nada a mano.

*Si con 60 segundos TODAVÍA tarda más y sigue cortando*: ya no es algo
que se arregle desde la app — ahí conviene mirar del lado de SQL
(con tu DBA o el área de sistemas): si la vista tiene índices, si la
VPN/red hacia el servidor anda lenta en ese horario, o si el servidor
está con mucha carga. Una forma rápida de confirmar si es la red o la
consulta en sí: correr la misma consulta directo en SQL Server
Management Studio desde esa PC y ver cuánto tarda.

*Validado:* `node --check` pasa en `server/server.js`. No pude probar
esto contra tu SQL Server real desde acá (no tengo esa conexión), así
que no puedo confirmar si el timeout más alto alcanza para tu caso —
avisame si te sigue pasando después de este cambio.

Toca: `server/server.js` (timeouts configurables con default más alto,
y el arreglo de que ya no se quede pegado con una conexión rota),
`server/.env.example` (documenta las dos variables nuevas, opcionales
— tu `.env` real no se tocó).

## Freno de seguridad para nesting con rollos largos (la página se trababa "no responde")

Reportaste que el nesting quedó trabado más de 5 minutos con el aviso
de Chrome "La página no responde." Encontré una causa real, distinta
al bug de "corridas acumuladas" que ya se había arreglado antes (ese
seguía funcionando bien).

**La causa:** el tamaño de la grilla interna (con la que el motor
calcula dónde entra cada pieza) se calculaba automáticamente mirando
SOLO el tamaño de la pieza más chica cargada, nunca el ancho del rollo
ni el largo de chapa/corte configurado. Con una pieza chica Y un rollo
ancho y/o un largo de corte grande (normal en producción real, por
ejemplo un rollo largo), la celda quedaba muy fina y la grilla
resultante (ancho × largo, EN CELDAS) se volvía gigantesca — se llegó
a calcular un caso de más de 200 millones de celdas por cada chapa,
hasta 80 chapas. Antes de ubicar una sola pieza, el navegador tenía
que reservar toda esa memoria — eso es lo que se sintió como la
página congelada, no un bucle infinito ni un error.

**El arreglo:** ahora, al calcular el tamaño de celda automático,
también se mira el ancho de rollo × largo de chapa que configuraste, y
si hiciera falta, se engrosa la celda lo MÍNIMO indispensable para que
ninguna chapa individual pase de ~4 millones de celdas (de sobra
resolución para que el acomodo siga siendo preciso — esto solo frena
el caso patológico de una grilla desproporcionada).

*Validado:* probé la función `autoCellSize` con un caso normal (pieza
chica, rollo de 1500×3000mm) y confirmé que da la misma celda que
antes; con un caso de rollo largo (1500×50000mm, el tipo de caso que
sospecho que disparó esto) la celda ahora se engruesa a ~4.3mm y la
grilla por chapa queda en ~4 millones de celdas en vez de los ~208
millones que hubiera dado antes.

*Para confirmar del todo que esto es lo que te pasó*, contame (si te
acordás) qué ancho de rollo y qué largo de chapa tenías puestos
cuando se trabó, y cuántas piezas eran — así puedo verificar que el
número cierra exactamente con tu caso. Mientras tanto, si se te vuelve
a trabar, contame también si tenías tildado "Búsqueda profunda".

Toca: `js/nesting/optimization.js` (`autoCellSize` ahora recibe
`sheetW`/`chapaLen` y pone un freno de grilla máxima),
`js/nesting/engine.js` (pasa esos dos valores al llamar a
`autoCellSize`).

## Corrección: la causa real del freeze era otra (confirmado con tus medidas)

Con 1000×2000mm de rollo/chapa, mi primera sospecha (grilla gigante por
un rollo muy largo) no aplica — ese tamaño da una grilla chica y normal.
Seguí investigando y encontré la causa real, que además explica por
qué el tamaño de rollo no tenía nada que ver:

**La causa real:** armar las orientaciones de UNA pieza (rotarla y
"pixelarla" contra la grilla, para cada ángulo que el sistema prueba)
es una función que corría de punta a punta SIN CEDER EL HILO NI UNA
VEZ — a diferencia del resto del motor, que sí va respirando entre
piezas. Con una pieza compleja (muchos vértices, como suele traer un
DXF industrial real) y sobre todo si tenías tildado "Rotación fina"
(que le hace probar hasta 180 ángulos × 2 si permitís espejo), esa
UNA función podía tardar varios segundos para una sola pieza —
en una prueba con una pieza de 300 vértices armé una situación
así y tardó casi 11 segundos SOLO para esa pieza. Con varias piezas
complejas en el lote, y como el sistema recalcula esto de nuevo cada
vez que prueba un paso de rotación distinto (30°, 15°, 6°, y de nuevo
si tenías rotación fina), esos segundos se van acumulando en bloques
grandes sin que el navegador tenga chance de respirar — eso es
exactamente lo que se siente como "la página no responde" durante
varios minutos, y no depende del tamaño del rollo, depende de la
COMPLEJIDAD de las piezas (y de si tenías rotación fina activada).

**El arreglo:** esa función ahora cede el hilo cada pocas orientaciones
probadas (igual que ya hacía el resto del motor), en vez de calcular
las 360 de un tirón. El resultado final es exactamente el mismo, solo
que ahora el navegador puede seguir respondiendo mientras tanto.

*Validado:* corrí la misma función (ya con el arreglo) con una pieza
sintética de 300 vértices y rotación fina activada (360 combinaciones)
y devolvió el resultado esperado sin bloquear — confirmé que ahora
devuelve una promesa que cede el control en vez de bloquear de un
tirón. El freno de grilla del mensaje anterior (rollo gigante) lo dejé
igual, no molesta y cubre ese otro caso por las dudas, aunque no era
tu situación.

*Para terminar de confirmar*: contame si tenías tildado "Rotación
fina" cuando se trabó, y más o menos cuántas piezas distintas (no
cantidad total, sino modelos/diseños distintos) tenía el lote — así
confirmo del todo que encaja con tu caso.

Toca: `js/nesting/orientation.js` (`buildOrientations` ahora es
`async` y cede el hilo cada 6 orientaciones), `js/nesting/optimization.js`
y `js/nesting/engine.js` (esperan (`await`) ese resultado en los 2
lugares donde se llama), `js/strips/strips.js` (mismo ajuste, para
que calcular las tiras de relleno tampoco bloquee).

## Tiras de relleno: no llenaba huecos donde sí entraba una tira

Confirmado: 35 archivos/modelos distintos — encaja con la causa del
freeze de arriba (muchas piezas complejas, cada una con su propio
costo de armar orientaciones).

Sobre las tiras que no se agregaban donde sí cabían: encontré un bug
concreto en `js/strips/strips.js`. La función que busca dónde entra
cada tira (`findBestPlacement`) tiene un 5° parámetro (`fine`) que hace
que la búsqueda barra la posición X **celda por celda** en vez de en
saltos gruesos — ya se usa así en otro lado del motor (al pulir una
chapa sobrante) justo para no saltarse huecos ajustados. En la
búsqueda de tiras, ese parámetro NO se estaba pasando, así que cuando
la tira era relativamente larga, la búsqueda probaba su posición en X
en saltos de varias celdas (el paso se calcula como `ancho_en_celdas /
22`) — si el hueco real quedaba justo entre dos de esos saltos, la
búsqueda pasaba de largo aunque la tira entrara perfecto ahí. Esto
también explica que se viera peor cuanto más largas eran las tiras
(saltos más grandes) y en huecos más angostos/ajustados, que es
justo donde más se nota.

De paso, la búsqueda probaba la tira en ~22 ángulos distintos
(0°, 20°, 40°...) heredados de una función pensada para piezas reales
— para una tira, que es un simple rectángulo, solo importan 0°/90° (los
demás nunca encajan limpio contra piezas ya puestas), así que ahora
solo se prueban esos, y todo el presupuesto de búsqueda que antes se
repartía entre 22 orientaciones inútiles ahora se concentra en las 2
que sí sirven — más intentos reales por orientación. También subí el
tope de "tiras como máximo por chapa" de 40 a 250 (con la búsqueda
encontrando más huecos que antes, una chapa muy fragmentada podía
necesitar más de 40).

*Sobre la validación, con honestidad*: confirmé el bug por inspección
directa del código (comparándolo con el mismo patrón ya usado y
documentado en otra parte del motor) y con una prueba sintética simple
donde SÍ mostré la diferencia entre buscar con y sin este parámetro.
Armar una prueba que reproduzca exactamente la forma de hueco real que
viste en tu pantalla es más difícil desde acá (dependo de la forma
exacta de tus piezas) — así que decime si con este cambio ya rellena
esos huecos que veías vacíos, o si todavía se te siguen quedando
espacios sueltos sin tira, para seguir afinando si hace falta.

Toca: `js/strips/strips.js` (pasa `fine=true` a `findBestPlacement`,
angles reducidos a [0,90,180,270], tope de tiras por chapa 40→250).

## Más fluidez: el "ataque dirigido" también corre en el Worker ahora

Pediste que se vea más fluido, que no se note ninguna traba. Encontré
una pieza que faltaba: el resto del nesting (Fase 1 y los
reordenamientos de la Fase 2) ya corre en el Web Worker cuando está
disponible — un hilo aparte, así el navegador nunca deja de responder
mientras calcula. Pero el "ataque dirigido" (que rearma una chapa
sobrante desde cero, una de cada dos vueltas en la Fase 2) SIEMPRE
corría en el hilo principal, sin importar si el Worker estaba
disponible o no. Cada vez que le tocaba el turno, se sentía como una
mini-traba — nada de 5 minutos, pero sí lo suficiente para que se note
si estás mirando la pantalla fijo.

**El arreglo:** ese "ataque dirigido" ahora también intenta correr
primero en el Worker (con el mismo Worker que ya se usaba para el
resto), y solo cae al hilo principal si el Worker no está disponible.

**De paso, encontré algo más importante que la fluidez**:
armando esto, vi que cuando el Worker SÍ está disponible (que es lo
normal), las piezas que se le mandaban para nestear NO incluían el
grabado (`engraveLoops`) ni los agujeros (`holes`) — se perdían en
silencio en cualquier pasada calculada por el Worker. Esto es un bug
que ya existía antes de todo lo de esta sesión, no algo que rompí yo
ahora. Si tus piezas no usan grabado ni agujeros no te afectaba, pero
si alguna sí los tiene, esto era importante. Ya está arreglado — se
manda todo completo.

*Validado, con detalle porque toca varios archivos a la vez*: armé una
simulación que reconstruye EXACTAMENTE el código que arma el Worker de
verdad (tomé el texto real de `worker-bridge.js`, la misma lista de
funciones y el mismo bloque `self.onmessage`, no una versión mía
aparte) y lo corrí de cero, como si fuera el Worker real:
- El camino nuevo (`repack` en el Worker) da el mismo resultado que el
  camino viejo (en el hilo principal), pieza por pieza.
- El grabado/agujeros llegan completos al resultado.
- El camino de nesting normal (Fase 1/2) sigue funcionando igual que
  antes.
- De paso, esta misma prueba encontró y me permitió arreglar ANTES de
  mandártelo un problema real: `repackSingleChapa` necesita dos
  funciones (`chapaUsedLen`, `chapaUsedX`) que no estaban en la lista
  de funciones que se le mandan al Worker — sin esto, el Worker hubiera
  tirado error apenas le tocara el turno al ataque dirigido, y hubiera
  caído en silencio al hilo principal en cada intento (sin romper nada,
  pero sin ganar tampoco la fluidez que buscamos). Ya está agregado.

Con esto, la única parte del nesting que puede llegar a tocar el hilo
principal por un ratito es cuando el Worker no está disponible en tu
navegador (poco común, pero puede pasar por alguna política local) —
en ese caso ya no hay más margen para mejorar sin cambiar de enfoque
completo; avisame si después de este cambio TODAVÍA se siente alguna
traba y reviso si tu navegador está usando el Worker de verdad.

Toca: `js/nesting/worker-bridge.js` (rutea mensajes 'nest'/'repack',
suma `permutations`/`repackSingleChapa`/`repackChapaFromDefs`/
`chapaUsedLen`/`chapaUsedX` a la lista de funciones del Worker, nueva
`runRepackInWorker`), `js/nesting/optimization.js` (nueva
`repackChapaFromDefs` y `runRepackPass`, arregla el envío de
grabado/agujeros/contorno rápido al Worker en la pasada normal),
`js/nesting/engine.js` (usa `runRepackPass` en vez de armar todo a
mano en el hilo principal).

## Indicador visible: "¿tengo el Worker activo?"

Le agregué un aviso chico justo debajo del botón "Ejecutar nesting"
(pestaña Nesting) que dice de un vistazo si el cálculo en paralelo está
activo:
- **⚡ Cálculo en paralelo: activo** (en verde) — todo lo que viste en
  los últimos cambios (que no se trabe) está funcionando.
- **⚠️ Cálculo en paralelo: no disponible** (en naranja), con el motivo
  — en ese caso el nesting corre en el mismo hilo que la pantalla, y
  ahí sí puede notarse menos fluido por más que el código esté bien.

No hace falta tocar nada para verlo — aparece solo apenas abrís la
pestaña Nesting, antes incluso de ejecutar nada.

*Validado*: lo probé con Playwright abriendo la página tal cual
(file://) y confirmé que el aviso muestra "activo" en un navegador
Chromium normal.

Toca: `index.html` (el aviso nuevo), `js/nesting/worker-bridge.js`
(`updateWorkerStatusUI()`, se llama apenas la página carga y de nuevo
si el Worker llegara a fallar más adelante).

## Tiras: nueva Fase 3 — pulido dedicado, más allá del tiempo máximo

Sobre lo que viste en la captura (Chapa 11 y 12 con hueco visible y sin
ninguna tira): iba a implementar literalmente "esperar más tiempo",
pero hay que ser honesto sobre por qué eso solo, por las dudas, NO
hubiera arreglado nada: la búsqueda de tiras es determinística — sobre
la MISMA chapa, sin cambiar nada, correrla de nuevo mil veces da
siempre el mismo resultado. Si no encontró una tira la primera vez, no
la iba a encontrar en el segundo, tercer, ni el intento número mil,
esperando nomás.

Lo que SÍ puede abrir un hueco nuevo es reacomodar las piezas de esa
chapa — así que armé algo que realmente hace eso: una **Fase 3**
nueva, que corre DESPUÉS de que termina la Fase 2 (ya sea porque
tocaste "Detener" o porque llegó al tiempo máximo configurado), y que
dedica hasta 20 segundos extra a:
1. Buscar qué chapas todavía tienen espacio suelto sin aprovechar
   (piezas + tiras puestas no llenan la chapa).
2. Para cada una, intentar un reacomodo (el mismo "ataque dirigido" de
   la Fase 2, ahora corriendo en el Worker, así no traba nada).
3. Ver si ESE reacomodo en particular deja más tira(s) que antes — si
   sí, lo adopta; si no, lo descarta y prueba otra chapa. Si una chapa
   no cede en 4 intentos, se da por perdida y no le sigue insistiendo
   (para no gastar los 20s enteros en la misma sin resultado).

Vas a ver "Pulido de tiras" como una etiqueta nueva en el historial de
intentos cuando esto encuentre algo.

*Validado*: corrí el nesting completo (Fase 1 + Fase 2 + esta Fase 3
nueva) de punta a punta en un navegador real (Playwright), con piezas
sintéticas armando huecos no rectangulares a propósito — terminó sin
errores, con 6 tiras coladas en un caso, y confirmé que cuando ya no
hay más para mejorar, corta en ~5s en vez de agotar siempre los 20s
completos dando vueltas sin sentido.

De paso subí el presupuesto de búsqueda de la Fase de tiras "normal"
(la de siempre, no esta nueva) de 20.000 a 60.000 intentos, por si el
hueco es angosto/ajustado contra el borde curvo de una pieza real y
necesitaba barrer más posiciones antes de encontrar dónde apoya.

*Sobre tu caso puntual (Chapa 11/12 de la captura)*: no tengo la forma
real de esas piezas para confirmar si esto las hubiera llenado — puede
que sí (si el hueco se abre reacomodando) o puede que ese hueco
específico, tal como quedó esa chapa, genuinamente no dé para una tira
completa del ancho/largo mínimo que configuraste (por ejemplo si el
borde curvo de la pieza de al lado invade parte de ese espacio a
cierta altura, aunque de lejos se vea todo libre). Probalo con tu caso
real y contame qué tal.

Toca: `js/nesting/engine.js` (Fase 3 nueva, después de la Fase 2),
`js/strips/strips.js` (presupuesto de búsqueda 20000→60000).

## Pulido de tiras: se estaba salteando chapas (encontré por qué)

Mejoró bastante, pero viste que Chapa 13 seguía sin ninguna tira a
pesar de tener hueco visible para al menos 3. Encontré la causa: la
Fase 3 nueva (pulido de tiras) rotaba SOLO entre las 3 chapas con MÁS
hueco libre en cada vuelta — con más de 3 chapas necesitando revisión
en el mismo lote, las que quedaban 4ta en adelante en ese ranking
(aunque genuinamente les faltara una tira, como la 13) podían quedar
completamente afuera de toda la sesión, mientras el tiempo se gastaba
siempre en las mismas 3 primeras.

**El arreglo:** ahora rota por TODAS las chapas que todavía califican
(tienen hueco y no se dieron por perdidas tras 4 intentos), no solo
las 3 con más hueco — así ninguna se queda sin su turno. También subí
el tope de tiempo de esta fase de 20 a 35 segundos, para que alcance a
cubrir más chapas en un lote grande sin cortarse a mitad de camino.

*Validado*: repetí la misma prueba automática de antes (nesting
completo de punta a punta en un navegador real) y sigue terminando
limpio, sin errores, y sigue cortando temprano (no espera los 35s
completos) cuando ya no queda nada para mejorar.

Toca: `js/nesting/engine.js` (rotación de la Fase 3 ahora cubre todas
las chapas candidatas, tope de tiempo 20s→35s).

## Diagnóstico real: por qué una chapa se queda sin tira

Con el arreglo de la rotación, TODAS las demás chapas ya suman tiras
bien — solo Chapa 13 y 14 seguían sin ninguna. Antes de asumir que es
un bug, le agregué a la app la forma de contestar esto con datos en
vez de conjeturas: cuando una chapa agota sus 4 intentos sin lograr
sumar tira, corre la MISMA búsqueda de tiras una vez más, pero sin
pedirle el largo mínimo que configuraste (dejándola aceptar cualquier
largo, hasta 1mm) — si con eso encuentra más área que la que ya tiene
puesta, es que SÍ queda un hueco pero es más corto que tu mínimo
configurado (te dice cuánto, en mm); si no encuentra nada más, es que
esa chapa genuinamente ya está al máximo aprovechable con ese ancho de
tira — el espacio que sobra no forma un rectángulo derecho válido
(normalmente porque el borde curvo de una pieza vecina lo recorta).

Vas a ver esto como una línea nueva de "Pulido de tiras" en el
historial, con el número exacto. Con eso ya sabemos si Chapa 13/14 es
"le falta bajar el largo mínimo" o "genuinamente no entra nada ahí" —
en vez de yo seguir adivinando sin ver tus piezas reales.

*Corregí de paso un bug que encontré haciendo esto*: mi primer intento
de este diagnóstico medía el hueco en una grilla aparte que no sabía
qué tiras YA estaban puestas — podía "redescubrir" una tira que ya
estaba colocada y reportarla como si faltara (en una prueba mía dio un
falso "755mm libres" en una chapa que en realidad ya estaba
prácticamente llena). Lo corregí comparando siempre contra lo que
`stripLayer` ya tiene puesto, con la misma función que arma las tiras
en el resto de la app — así el número que ves es real, no un
falso positivo.

*Validado*: repetí la prueba automática de siempre y confirmé que el
mensaje ahora da un número chico y coherente (unos pocos mm, "ruido")
en un caso donde la chapa ya estaba bien llena, en vez del falso
positivo de antes.

Fijate qué dice el log para Chapa 13 y 14 esta vez y contame — con eso
ya sabemos si hay que bajar el largo mínimo configurado o si de verdad
no hay más margen ahí.

Toca: `js/nesting/engine.js` (diagnóstico nuevo en el "Pulido de
tiras" cuando una chapa se da por perdida).

## El bug real de la Chapa 13/14 — encontrado con tus DXF reales

Tenías razón: SÍ había un bug, no era el largo mínimo configurado.

Bajé el ZIP de cortes que mandaste (`nesting_dxf_1.zip`) y usé los DXF
reales de la Chapa 13 para reproducir el problema con tus piezas
exactas, no con datos inventados. Confirmé primero, leyendo las
coordenadas del propio DXF, que tenías razón en la geometría: la pieza
11 (Orden 11390251) ocupa x:0–597mm, y la pieza 32 (Orden 11362305)
recién empieza en y:1399mm — dejando un hueco real y limpio de
x:597–1000 (≈400mm) por y:0–1399 (≈1400mm), sin ninguna pieza ahí.

Después armé una prueba aparte que corre el motor real de la app
(las mismas funciones de rasterizado/búsqueda que usa el navegador)
sobre ese mismo hueco, y encontré la causa exacta: la búsqueda de
huecos usa un atajo ("skyline") que anota, por cada columna de la
grilla, la altura más alta que ALGUNA vez se pintó ahí — para no
tener que revisar casilla por casilla si algo cabe. Ese atajo asume
que todo lo pintado en una columna está apilado desde abajo, sin
huecos por debajo (como apilar cajas: si hay algo arriba, seguro hay
algo abajo también). Eso vale mientras se arma una chapa de cero,
pero falla en una chapa ya terminada cuando una pieza de forma no
rectangular queda "flotando" — como la pieza 32 en tu Chapa 13, que
ocupa esas columnas SOLO a partir de y:1399mm, dejando la parte de
abajo (y:0–1399) realmente libre. El atajo veía "algo pintado más
arriba en esa columna" y descartaba la columna ENTERA, incluida toda
la parte baja libre — exactamente el hueco que decías que "obviamente
cabía".

**El arreglo:** en la búsqueda fina (la que usan el pulido de tiras y
el ataque dirigido sobre una chapa ya armada), antes de confiar en ese
atajo, ahora se prueba primero si la pieza entra pegada al borde de
arriba (y=0) — un chequeo directo y barato. Si entra ahí, listo, ni
falta hace el atajo. Si no entra, recién ahí se usa el atajo de
siempre (que sigue sirviendo bien para el caso normal de apilado desde
abajo). No toca el modo rápido de armado inicial de cada chapa, solo
la búsqueda fina de huecos sobrantes — así no hay riesgo de que esto
cambie cómo arma el resto del nesting.

*Validado con tus datos reales*: reconstruí la Chapa 13 exacta (las 2
piezas, en sus posiciones y ángulos reales del DXF que mandaste) y
corrí la búsqueda de tiras real de la app sobre esa grilla:
- **Antes** del arreglo: 0 tiras encontradas (igual que lo que viste).
- **Después** del arreglo: 5 tiras de 80mm de ancho, largos entre
  1467mm y 1661mm, puestas exactamente en el hueco que señalabas
  (x≈596 a 996mm, y desde 0mm) — más de 6.7 m² de material que antes
  se estaba perdiendo en esa sola chapa.

Toca: `js/nesting/placement.js` (la función `findBestPlacement`, que
usan tanto la búsqueda de tiras como el ataque dirigido).

## Vuelta al mismo bug — esta vez un hueco "sandwich" (Chapa 16)

Con el arreglo anterior mejoró en grande (lo viste vos mismo), pero
mandaste otro caso real, Chapa 16, con un hueco en x:650, y:0 a 210
que seguía sin usarse. Repetí el mismo proceso: bajé tus DXF nuevos y
reconstruí esa chapa exacta (las 2 piezas + las tiras que ya te había
puesto ahí).

Es el MISMO bug de fondo, pero en una variante que mi primer arreglo
no cubría. La vez pasada el hueco estaba pegado al borde de arriba
(y=0) y el arreglo probaba esa posición primero. Esta vez el hueco
está "sandwich": hay una tira ya puesta justo en el borde de arriba
(y:0 a 81mm), y recién más abajo (y:82 a 344mm, contra el borde curvo
de la otra pieza) está el hueco real — ni pegado arriba del todo, ni
al final. Probar solo y=0 no lo agarra.

**El arreglo, más de fondo esta vez:** en vez de "probar y=0 y si no,
usar el atajo de siempre", ahora en la búsqueda de huecos (pulido de
tiras + ataque dirigido) se barre de verdad, fila por fila desde
y=0, sin el atajo del skyline (que, como vimos, no es confiable en
una chapa ya armada). Cada chequeo es baratísimo (microsegundos), así
que barrer entero no se nota. Lo que si arreglé aparte: antes, si una
sola columna resultaba cara de revisar (bloqueada de punta a punta),
la búsqueda directamente TIRABA LA TOALLA con todas las columnas que
quedaban por probar a la derecha — ahora sigue revisando el resto
igual, solo con un tope generoso al trabajo total (no por columna)
como freno de seguridad.

*Validado con tus datos reales* (Chapa 16 tal cual la mandaste,
piezas + tiras ya puestas incluidas): antes del arreglo, 0 tiras
nuevas encontradas ahí. Después, encuentra 5 tiras más justo en esa
franja (entre 279mm y 422mm de largo) más 2 tiras chicas en otro
resto de la misma chapa — unos 2.9 m² más de material aprovechado
que antes se perdía. También repetí la Chapa 13 de la vuelta pasada
para confirmar que sigue encontrando sus tiras igual que antes (no se
rompió nada), y un tercer chequeo aparte con piezas rectangulares
simples para confirmar que el armado normal de una chapa (no el
pulido de huecos) sigue colocando exactamente igual que antes —
este cambio no toca esa parte.

Toca: `js/nesting/placement.js` (misma función `findBestPlacement`,
esta vez el barrido interno de huecos en modo fino).

## Revisión proactiva — otros bugs encontrados y corregidos

Pediste una revisión general por las dudas. Encontré y corregí estos,
todos verificados antes de mandarlos (no son conjeturas):

1. **Riesgo de traba que yo mismo metí con el arreglo de arriba.** El
   barrido "de verdad" que agregué para encontrar huecos, en el peor
   caso teórico (una chapa casi al tope de celdas permitido, y la
   pieza no entra en NINGÚN lado) podía tardar hasta ~0.6 segundos
   por intento — y el "ataque dirigido" puede probar varios intentos
   seguidos. Le puse un freno de reloj (300ms por orientación) además
   del freno por cantidad de intentos que ya tenía, y un corte extra
   dentro de `repackSingleChapa` para que un solo intento lento no se
   coma el tiempo pedido sin que nadie se entere. Medido: mismo peor
   caso, ahora se corta a tiempo y sigue encontrando las tiras reales
   igual de bien (repetí las pruebas de Chapa 13 y 16, dan lo mismo).

2. **Endpoint del rack sin login.** `POST /api/rack/:orden/salida`
   (server.js) escribe en el SQL real de producción (cuando está
   prendida la escritura) sin pedir haber iniciado sesión — cualquiera
   en la red podría sacar una orden del rack. Lo dejé COMO ESTABA
   porque el propio comentario del archivo lo marca a propósito ("SIN
   login", igual que el rack simulado) — probablemente para que
   cualquiera en piso lo use sin loguearse. Avisame si eso es a
   propósito o si querés que le agregue el mismo login que tiene
   "marcar-en-stock".

3. **Reparador de DXF (el de arreglar polígonos abiertos a mano)**
   tenía el mismo patrón que trababa la pestaña con `buildOrientations`
   (un bucle sin ceder el hilo, que crece al cuadrado con la cantidad
   de puntos sueltos) — con un DXF MUY desordenado (miles de bordes
   abiertos) se podía sentir pesado igual que el bug viejo. Lo hice
   async con el mismo patrón de "ceder cada tantas vueltas" que ya usa
   el resto de la app.

4. **Stickers con "undefined" impreso.** Si algún registro de SQL
   viniera sin número de orden (dato roto), el sticker físico Y su
   código de barras imprimían literalmente el texto "undefined" — una
   etiqueta con pinta de válida pero con el dato mal, pegada sobre
   material real. Ahora, si falta el número, se marca bien visible
   ("¡SIN ORDEN!") en vez de fingir que hay uno — tanto en el PDF como
   en la impresión directa a la Zebra.

5. **"NaNxNaN" en la hoja de corte (PDF).** Si una pieza viniera de un
   DXF degenerado (geometría rota, sin puntos válidos), la columna de
   medidas de la hoja de corte podía imprimir literalmente "NaNxNaN"
   en vez de avisar que esa pieza no tiene medida. Ahora se ve igual
   que cuando no hay dato ("-").

**Encontré 3 cosas más que NO toqué** porque cambiarlas a ciegas es
más riesgoso que dejarlas — te las dejo para que decidas:

- **El importador de DXF no mira las unidades del archivo
  ($INSUNITS).** Si algún día llega un archivo dibujado en pulgadas
  (típico de software gringo), la app lo va a tratar como si fuera
  milímetros — la pieza saldría ~25 veces más chica o más grande, sin
  ningún aviso. Si TODOS tus archivos vienen siempre en mm (lo más
  probable acá), esto no te afecta nunca; si alguna vez recibís un
  archivo de otro país/software, avisame y lo agrego.
- **Curvas tipo SPLINE se aplanan a líneas rectas** en vez de calcular
  la curva real — si algún diseño tuyo usa splines (curvas suaves,
  no arcos simples), el contorno importado puede quedar levemente
  distinto al real. Si tus diseños solo usan líneas y arcos (lo común
  en corte de chapa), esto tampoco te afecta.
- **Si un DXF trae más de un contorno cerrado** (por ejemplo, un
  cajetín o marco de referencia además de la pieza), la app se queda
  con el más grande de área — si ese marco fuera más grande que la
  pieza real, importaría el marco en vez de la pieza, sin avisar.
  Vale la pena tenerlo presente si alguna vez un archivo importa con
  una forma rara.

## Defensa extra: login en `/api/rack/:orden/salida`

Confirmaste que la vista real (`SAGA_View_Ficha_Componentes_Colombia`)
sigue sin tocarse en ningún lado — reviso el código y sigue siendo así,
solo `SELECT`. Lo único que se escribe es una tabla de control aparte
(`NestingControlCorte`, no la vista), y esa escritura sigue apagada
por default (`PERMITIR_ESCRITURA_SQL=false`).

Igual, como pediste la defensa extra: `/api/rack/:orden/salida` ahora
también pide `exigirLogin`, igual que su gemelo `marcar-en-stock`. El
frontend (`js/ui/orders.js`) ya mandaba el mismo header de sesión en
esa llamada que en las demás, así que no cambia nada de cómo lo usás
— solo cierra el hueco por si el día de mañana alguien prende
`PERMITIR_ESCRITURA_SQL=true`.

Toca: `server/server.js` (esa ruta ahora lleva `exigirLogin` antes de
`bloquearSiSoloLectura`, y se corrigió el comentario del listado de
endpoints arriba del archivo, que decía "SIN login").

## Rendimiento: tiras de relleno mucho más rápidas + Fase 3 respeta el tiempo configurado

Después de los arreglos de las chapas 13 y 16, pediste mirar en general
si se podía mejorar la velocidad. Until now, cada vez que el motor
mejoraba algo durante la Fase 2 (o corría el pulido final), recalculaba
TODAS las tiras de relleno de TODAS las chapas desde cero — y la
búsqueda de tiras, aunque correcta (después del arreglo del hueco
"sandwich"), barría celda por celda cada vez. Con un lote real de 19
chapas esto tardaba **~24 segundos por recálculo**, y se repetía muchas
veces en una corrida normal.

**1) Reescribí la búsqueda de tiras (`js/strips/strips.js`).** Una tira
siempre es un rectángulo simple, así que en vez de preguntarle celda
por celda "¿entra acá?", ahora se precalcula por columna cuántas
celdas libres seguidas hay contando desde arriba, y se usa una ventana
deslizante (deque monótono) para encontrar dónde entra el rectángulo —
mismo resultado exacto, sin repetir comparaciones. Medido con los
mismos datos reales de las chapas 13/16 y las 38 chapas de los dos
lotes que mandaste: **de ~24s a ~1.6s** para las 19 chapas juntas,
encontrando exactamente las mismas tiras (mismo total de m² recuperado,
con variación mínima en el orden/desempate de tiras equivalentes — no
en la cantidad).

**2) Cuando el motor mejora UNA chapa en la Fase 2, ahora solo se
recalculan las tiras de ESA chapa**, no las de las 19 (`refreshStrips`
en `js/nesting/engine.js` ahora acepta qué chapa cambió).

**3) La Fase 3 ("pulido de tiras") tenía un presupuesto de tiempo fijo
de 35 segundos, sin importar el límite de tiempo que configuraste
arriba.** Si ponías, por ejemplo, 1 minuto de límite, la corrida real
podía tardar hasta 35 segundos MÁS de lo que pediste. Ahora, si
configuraste un límite de tiempo (>0), la Fase 3 usa como máximo 8
segundos en vez de 35 (si dejás el límite en 0 = "sin límite", sigue
usando 35s como antes, porque ahí no hay un tiempo que respetar).

**Cómo lo verifiqué:** además de los tests contra datos reales de DXF
(igual que en las chapas 13/16), corrí la aplicación real completa en
un navegador (Chromium headless) — cargando `index.html`, metiendo
piezas reales de uno de tus lotes, y ejecutando el nesting de punta a
punta con un límite de 15 segundos configurado. Antes del arreglo de
Fase 3, la corrida completa tardaba **56.8 segundos** (41.8s de más).
Después del arreglo, la misma corrida con el mismo límite tardó **29.7
segundos** — ahorro consistente con lo esperado (35s → 8s). Sin
errores nuevos en consola (los únicos que aparecen son de la red
restringida de mi entorno de pruebas al pedir una librería externa, no
de la app).

Toca: `js/strips/strips.js` (reescrito), `js/nesting/engine.js`
(`refreshStrips` con parámetro opcional de qué chapa recalcular, y el
presupuesto de la Fase 3).

## Revisión general: oportunidades de mejora (no son bugs de los que ya arreglamos)

Pediste una revisión completa de la app buscando qué más se podía
mejorar. Encontré varias cosas reales — arreglé las de bajo riesgo
ahora mismo, y te dejo las demás anotadas para decidir vos.

### Arreglado

1. **Cantidad negativa de una pieza la hacía "desaparecer" en
   silencio.** Si escribías, por error, "-5" en la cantidad de una
   pieza, la app la guardaba tal cual (no rechazaba el negativo) y el
   nesting la filtraba sin avisar — la pieza simplemente no aparecía
   en ningún lado, sin error. Ahora se recorta a 0 y se corrige lo que
   ves en el campo. (`js/ui/pieces.js`)

2. **Lectura de DXF por ruta completa, autenticado, sin freno de
   carpeta.** El endpoint `/api/dxf` ya pide login, pero cuando tu SQL
   trae una ruta de red completa (tu caso normal, `DXF_SOURCE=file`),
   esa ruta viaja como parámetro en la URL que arma el navegador — así
   que alguien YA logueado en la app podría, en teoría, editar ese
   parámetro a mano y pedir leer otro archivo cualquiera de la PC
   donde corre el puente (no solo DXF). Agregué una variable opcional
   nueva, `DXF_ALLOWED_PREFIXES` en el `.env`, para decirle al puente
   "solo aceptá rutas que empiecen así" (tus carpetas de red reales).
   **Queda vacía por default — no cambia nada de cómo funciona hoy
   hasta que vos la completes** (ver el ejemplo en `.env.example`).
   Te recomiendo completarla cuando puedas, es la que más vale la pena
   de esta lista. (`server/server.js`, `server/.env.example`)

3. **`/api/rack-actual` (sin login, abierto para cualquiera en la red)
   mostraba el error crudo del driver de SQL si el servidor estaba
   caído o lento** — nombre de servidor, detalle de conexión, visible
   para cualquiera. Ahora, a quien pregunta sin sesión le llega un
   aviso genérico; el detalle real lo seguís viendo vos en la consola
   del servidor. (`server/server.js`)

4. **El modal de "¿qué es cada capa del DXF?" no decía cuántos
   archivos más quedaban en cola.** Si arrastrabas una carpeta entera
   con varios DXF de varias capas, te iba preguntando uno por uno sin
   avisar cuántos faltaban — ahora dice "archivo 2 de 5" cuando hay
   más de uno en la cola. (`js/ui/pieces.js`)

### Encontré, pero NO toqué — para que decidas vos

- **Los `fetch()` a el puente no tienen tiempo límite.** Si el puente
  queda inalcanzable (PC apagada, dirección mal puesta), la app se
  queda pegada en "Consultando..." sin límite de tiempo, en vez de
  avisar rápido "no responde el puente". Se puede agregar, pero toca
  varios lugares distintos (login, refrescar órdenes, correr lote,
  rack) — prefiero hacerlo en un pase aparte para probarlo bien en
  cada pantalla antes de mandarlo.
- **Duplicación de columnas en las tablas de órdenes.** Las 3 tablas
  de "Lista de corte" (lista, lote y rack) arman las filas a mano en
  3 lugares distintos — si algún día agregás o sacás una columna, hay
  que acordarse de tocar los 3. No rompe nada hoy, pero es fácil que
  algún día una tabla quede desactualizada respecto a las otras dos.
- **Duplicación del "objeto pieza colocada"** entre el motor principal
  y el pulido/repack (`js/nesting/optimization.js`) — dos lugares
  arman el mismo dato por separado. Es exactamente el tipo de cosa que
  ya nos mordió una vez esta sesión (un campo que se actualiza en un
  lugar y se olvida en el otro) — vale la pena unificarlo, pero
  requiere probarlo bien contra datos reales antes de tocarlo, así que
  lo dejo para un pase aparte si querés.
- **El caché de orientaciones no siempre se reutiliza durante el
  pulido de tiras (Fase 3)** — en algunos casos recalcula geometría
  que ya había calculado antes en la misma corrida. No es el cuello de
  botella grande (ese ya lo resolvimos con lo de las tiras), pero es
  una mejora de rendimiento más chica que queda pendiente si seguimos
  por ese lado.

Ninguno de estos toca la vista de SQL ni la lógica de
lectura/escritura — todo lo de esta sección es del lado de la app o
del puente.

## Nuevo: agregar al lote por "Código de lote" (DF_SAGA_LotesVidro)

Pediste poder escribir un Código_Lote (de tu tabla `DF_SAGA_LotesVidro`,
la que agrupa las órdenes que van a cortarse más adelante) y que la app
agregue de una todas las órdenes de ese lote al "lote de corte" que se
va a nestear — igual que el ingreso rápido, pero de a un lote entero en
vez de orden por orden.

**Cómo quedó armado, siguiendo el mismo criterio que ya usa "Ingreso
rápido":**

- Nueva consulta `ordenesPorLote` en `server/queries.js` (y su plantilla
  en `queries.example.js`): hace `JOIN` entre `DF_SAGA_LotesVidro` y tu
  vista real `SAGA_View_Ficha_Componentes_Colombia`, **SOLO LECTURA**,
  filtrando por el `Codigo_Lote` que escribís y por `Operation='0132'`
  (igual que ya se exige en todos lados) — **sin** filtrar por
  Centro_Trabalho ni por Puestodetrabajo, tal como pediste ("sale sin
  puesto de trabajo").
- El Puestodetrabajo SÍ se sigue trayendo (del servidor de Calendario,
  igual que en toda la app) y se muestra en la tabla — solo que acá no
  se usa para ocultar ninguna orden, nada más para que lo veas.
- **Duplicados:** hay dos capas para que una orden repetida no aparezca
  dos veces:
  1. Dentro de un mismo Código_Lote, si `DF_SAGA_LotesVidro` trae más
     de una fila para la misma orden, la consulta usa `DISTINCT` y
     queda en una sola fila.
  2. Si escribís dos códigos de lote distintos (o mezclás con ingreso
     rápido) y una orden aparece en más de uno, la app no la agrega dos
     veces al lote de corte — ya la tenía, así que la cuenta como "ya
     estaba" en vez de duplicarla.
- Nuevo endpoint `GET /api/lote/:codigo` (requiere sesión, igual que el
  resto de Lista de corte).
- En la pantalla: nuevo cuadro "Agregar por código de lote" arriba de
  "Lote de corte" (mismo lugar que Ingreso rápido) — escribís el código
  y Enter, y te dice cuántas encontró, cuántas agregó y cuántas ya
  estaban.

Toca: `server/queries.js`, `server/queries.example.js`,
`server/server.js`, `js/ui/orders.js`, `index.html`. No modifica en
nada la consulta de "pendientes" normal ni ninguna otra ya existente —
es 100% nueva, solo lectura, y usa la misma vista de siempre.

## Nuevo: órdenes sin Operation 0132 pero con ZFER=0101 (Calendario)

Pediste que, además de las órdenes normales (Operation='0132'), la
lista de corte también incluya las que NO tienen esa Operation pero sí
traen `ZFER='0101'` en el mismo "BUSCARV" contra Calendario que ya se
usa para Puestodetrabajo.

**Confirmaste, antes de tocar nada:**
- ZFER sale de la MISMA tabla de Calendario que Puestodetrabajo
  (`TCAL_CALENDARIO_COLOMBIA_DIRECT`), buscada por número de orden.
- Estas órdenes SÍ tienen que cumplir el mismo filtro de Puestodetrabajo
  permitido (PLANEACION/01CORTE/02CNC/03SERIG/04SER_VT) que ya aplica a
  la lista normal.
- "32VPA" no aplica a este cambio (quedó afuera).

**Cómo quedó armado:**

1. `server/queries.js`: la config `puestoDeTrabajo` ahora tiene una
   línea más, `columnaZfer: 'ZFER'` — **confirmá que ese es el nombre
   real de la columna** en `TCAL_CALENDARIO_COLOMBIA_DIRECT`; si es
   otro, es la única línea que hay que cambiar (queda comentado ahí
   mismo). Si la dejás vacía, este bloque entero queda apagado solo,
   sin romper nada de lo demás.
2. Nueva consulta `ordenesPorSerialLista` (también SOLO LECTURA de tu
   vista real) — trae los datos completos (archivo, modelo, etc.) de
   una lista puntual de números de orden, sin exigirles Operation
   '0132' (a propósito, ya se sabe que estas no lo tienen).
3. En `server.js`, `/api/ordenes-pendientes` ahora hace 3 pasos en vez
   de 1: trae la lista normal de siempre → busca en Calendario qué
   números tienen ZFER='0101' y **todavía no están** en esa lista →
   busca los datos completos de esos números en tu vista real → junta
   todo, trae Puestodetrabajo para el conjunto completo, y aplica el
   MISMO filtro de Puestodetrabajo permitido a todo junto (así una
   orden por ZFER con Puestodetrabajo no permitido se oculta igual que
   cualquier otra).

**Sobre duplicados:** si una orden ya venía por el camino normal
(0132), no se vuelve a buscar ni se duplica por el camino de ZFER —
queda solo la de la lista normal.

**Una decisión que tomé sin preguntarte, para que la revises:** el
filtro de `Centro_Trabalho` (01CORTE/02CNC/03SERIG/04SER_VT) que sí
aplica a la lista normal, **no** se lo apliqué a las órdenes que entran
por ZFER — solo les exigí que su Puestodetrabajo esté en la lista
permitida (que sí confirmaste). Si también tenés que exigirles
Centro_Trabalho, avisame y lo agrego — es un cambio de una línea.

**Cómo lo probé:** armé una simulación con datos de prueba (fuera de
esta app, sin tocar tu SQL) con 2 órdenes por el camino normal (una con
Puestodetrabajo permitido, otra no) y 3 por ZFER (una repetida con el
camino normal, dos nuevas, una de esas dos con Puestodetrabajo
permitido y la otra no) — el resultado final trajo exactamente las 2
que debían quedar, sin duplicados y sin las que tenían Puestodetrabajo
no permitido.

Toca: `server/queries.js`, `server/queries.example.js`,
`server/server.js`. No cambia en nada la consulta de "pendientes"
original ni el filtro que ya tenías — solo se le suma lo nuevo encima.

### Corrección: el archivo tiene que salir de la fila Operation='0101', no de cualquiera

Me aclaraste que me había entendido mal: una misma orden puede tener
VARIAS filas en tu vista real (una por cada Operation — 0132, 0101,
etc., distintas etapas), cada una con su propio `Desenho_Path`. Mi
primera versión traía "cualquier fila" de la orden sin filtrar por
Operation — podía traer la fila equivocada (por ejemplo la de 0132, si
existiera) en vez de la de 0101.

**Corregido:** `ordenesPorSerialLista` ahora exige puntualmente
`Operation='0101'` (antes no filtraba por Operation en absoluto) — así
que para las órdenes que entran por ZFER, el archivo/ruta que se trae
es específicamente el de su fila 0101, ignorando cualquier otra fila
que esa misma orden tenga con otra Operation.

Lo probé con una simulación donde una orden tiene DOS filas (0132 con
un archivo, 0101 con otro) — confirmé que ahora se queda con la de
0101 y descarta la de 0132.

Toca (de nuevo): `server/queries.js`, `server/queries.example.js`,
`server/server.js`.

### Corrección: el valor de ZFER es 70005171, no 0101

Aclaraste el valor real: el código que hay que buscar en la columna
ZFER de Calendario es **`70005171`** — el `0101` es (y siempre fue) el
código de Operation en tu vista real, para saber de cuál fila sacar el
archivo. Son dos cosas distintas, ya separadas en el código como dos
constantes en `server.js`:

- `ZFER_INCLUIR = '70005171'` → qué buscar en la columna ZFER de
  Calendario, para decidir qué órdenes sumar.
- `OPERATION_PARA_ORDENES_ZFER = '0101'` → de qué fila (Operation) de
  esa orden, en tu vista real, sacar el archivo/ruta.

Si alguno de los dos valores no es exacto, son las únicas dos líneas
que hay que tocar (una en cada extremo, bien marcadas en el código).

Toca (de nuevo): `server/server.js`, `server/queries.js`.

### Ahora podés agregar más ZFER vos mismo, sin pedírmelo

Pasé el/los código(s) de ZFER a una variable nueva en tu `.env`,
`ZFER_LISTA_ESPECIAL` — así que la próxima vez que te aparezca un ZFER
nuevo que también tenga que entrar a Lista de corte, lo agregás ahí
directo (separado por coma si son varios) y reiniciás el puente
("npm start" de nuevo) — no hace falta que me escribas ni que yo
toque ningún archivo de código.

```
ZFER_LISTA_ESPECIAL=70005171,70005180,70005199
```

Si no agregás esta línea a tu `.env`, sigue funcionando exactamente
igual que antes (usa `70005171` por default) — no rompe nada mientras
no la toques.

También pasé a variable, por las dudas, de qué Operation sacar el
archivo (`OPERATION_PARA_ORDENES_ZFER=0101`) — pero esa normalmente no
deberías necesitar tocarla, es la misma para todos los ZFER de la
lista.

Probé el parseo de la lista (con espacios de más, comas dobles, un
solo valor, vacío) y el armado de la consulta con varios códigos a la
vez — todo quedó bien.

Toca: `server/server.js`, `server/.env.example` (tu `.env` real no se
toca — vos agregás la línea cuando quieras).

## Bug encontrado en vivo: login con HTTP 500 al entrar por la IP de red

Lo encontraste probando: entraste a la app por `http://172.16.60.118:4000`
(la dirección que el mismo server te recomienda para "otras PC de la
red", en el cartel que sale al hacer `npm start`) y el login tiraba
`HTTP 500`. En la consola del server se veía `Error: origen no
permitido`.

**Causa:** un filtro de CORS (ya estaba en el código de antes, no es
de esta sesión) que solo dejaba pasar pedidos con origen `localhost`,
`127.0.0.1` o "null" (doble clic) — pero bloqueaba exactamente la
dirección de red que el propio server te recomienda imprimir para que
otras PC lo usen. En la práctica, esto rompía el login (y todo lo
demás que pide sesión) para CUALQUIERA que entrara por la IP de red —
vos en esta prueba, y cualquier otra PC de la fábrica que lo intentara
igual.

**Arreglado:** el filtro de CORS ahora también acepta como origen
válido las direcciones de red de la PC donde corre el puente (las
mismas que ya se imprimen en el cartel al arrancar) — calculadas una
sola vez al arrancar el server. Sigue bloqueando cualquier otra
dirección (una página cualquiera de internet, u otra IP que no sea la
de esta PC).

Probé la lógica del filtro con 8 casos (doble clic, localhost, la IP
de esta PC, otra IP de esta PC si tuviera varias tarjetas de red, una
IP de red que NO es de esta PC, y una página externa) — todos se
comportan como corresponde.

Toca: `server/server.js` únicamente. **Hace falta reiniciar el puente**
(parar con Ctrl+C y volver a `npm start`) para que tome el cambio —
los archivos de la app (`index.html`, `js/`) no hace falta tocarlos.

## Arranque automático y oculto del puente (Programador de tareas)

Pediste que el puente ("iniciar") esté siempre prendido sin tener que
abrirlo a mano cada vez, y en modo oculto (sin ventana).

**Nuevos archivos en `server/`** (no tocan nada de la app, son solo
para esto):

- `iniciar_oculto.bat` — como `iniciar.bat` de siempre, pero SIN el
  `pause` final, y con un bucle: si Node se cae por cualquier motivo
  (SQL Server caído, un error), lo vuelve a prender solo a los 5
  segundos, sin que nadie tenga que hacer nada.
- `iniciar_oculto.vbs` — lanza el `.bat` de arriba sin mostrar NINGUNA
  ventana (ni un parpadeo). Es este archivo el que hay que apuntar en
  el Programador de tareas, no el `.bat` directo.

**Configuración en Windows** (una sola vez, ver los pasos que te pasé
en el chat): Programador de tareas → tarea nueva apuntando a
`wscript.exe` con `iniciar_oculto.vbs` como argumento, disparador "Al
iniciar el sistema", ejecutar "tanto si el usuario inició sesión como
si no" (para que ande incluso sin que nadie loguee en esa PC), y
reintento automático si la tarea falla.

Para actualizaciones futuras: seguís reemplazando archivos de la app
normal; estos dos archivos nuevos no hace falta tocarlos salvo que
cambies dónde vive el proyecto.

Toca: `server/iniciar_oculto.bat`, `server/iniciar_oculto.vbs` (los
dos nuevos). No modifica `server.js` ni ningún otro archivo existente.

## Bug encontrado en vivo: logo/favicon rotos al entrar por la IP del puente

Lo viste vos mismo probando: entrando por `http://172.16.60.118:4000`,
el logo de AGP (arriba de la página) y el ícono de la pestaña aparecían
rotos. Andaban bien si abrías `index.html` con doble clic.

**Causa:** el server sabe servir `css/` y `js/` cuando la app se abre a
través del puente, pero se había olvidado la carpeta `img/` — así que
cualquier imagen (el logo, el favicon) tiraba 404 al pedirse por esa
vía. Abriendo con doble clic no se nota porque ahí el navegador lee
las imágenes directo del disco, sin pasar por el server.

**Arreglado:** se agregó `img/` a la lista de carpetas que el puente
sirve — mismo criterio de seguridad que ya tenía (solo esas carpetas
puntuales, nunca `server/` completa, para que tu `.env` jamás quede
expuesto).

Toca: `server/server.js` únicamente. Hace falta reiniciar el puente
para que tome el cambio.

## Auto-refresco del Rack entre computadores

Lo que reportaste: le dabas "Sacar del rack" a una orden en una PC, y
en las otras PCs seguía apareciendo ahí hasta que alguien apretaba F5 a
mano.

**Causa:** el Rack solo se volvía a consultar al SQL/rack simulado en
dos momentos: al entrar a esa pestaña, o justo después de una acción
tuya (sacar una orden, reimprimir). Ninguna PC avisaba a las demás, así
que si el cambio lo hacía OTRA PC, la tuya no se enteraba hasta el
próximo F5.

**Arreglado:** mientras la pestaña "Rack" está abierta y visible (no
minimizada ni en otra pestaña del navegador), la app vuelve a consultar
sola cada 6 segundos y actualiza la tabla si hubo cambios — sin
parpadeo ni "Consultando el rack..." de por medio, solo se actualizan
los datos. Se apaga solo al salir de esa pestaña (para no gastar
consultas de más contra el puente/SQL desde una pantalla que nadie está
mirando), y se prende de nuevo al volver a entrar.

No hace falta que hagas nada en Windows ni en el `.env` para esto —
funciona solo, en las 4 PCs por igual, apenas actualices los archivos.

Toca: `js/ui/orders.js` (las funciones nuevas `rackIniciarPolling` /
`rackDetenerPolling`, y `rackRender` ahora acepta un parámetro opcional
para no parpadear en cada refresco automático), `js/app.js` (arranca y
frena el auto-refresco al entrar/salir de la pestaña Rack). No toca
`server.js` ni `.env` — con hacer `Ctrl+Shift+R` en el navegador de
cada PC alcanza, no hace falta reiniciar el puente.

## El botón "Buscar" del Rack ahora fuerza actualizar la tabla primero

Antes, el buscador del Rack (el que usás con la pistola de código de
barras) comparaba contra lo último que esa PC tenía cargado en
pantalla — que podía tener hasta 6 segundos de atraso por el
auto-refresco, o estar más viejo todavía si el auto-refresco venía
fallando en silencio.

**Ahora:** al apretar "Buscar" (o Enter en el campo), primero se vuelve
a traer el rack completo del puente (sin parpadeo, como el
auto-refresco) y recién con eso ya actualizado se hace la búsqueda —
así la tabla que ves y el resultado del buscador siempre reflejan el
estado más reciente, aunque el cambio lo haya hecho otra PC un segundo
antes.

Toca: `js/ui/orders.js` únicamente (`rackBuscar`). Con `Ctrl+Shift+R`
en el navegador alcanza, no hace falta reiniciar el puente.

## Los cambios no se veían aunque hicieras Ctrl+Shift+R

Reportaste que después de este último cambio, el botón "Buscar" del
Rack seguía comportándose como antes aunque ya habías reemplazado la
carpeta. La causa real: el navegador tenía cacheado el archivo
`js/ui/orders.js` VIEJO, y en algunas PCs/navegadores el
`Ctrl+Shift+R` no alcanza a limpiar esa caché de scripts sueltos (pasa
sobre todo si el archivo se pidió antes sin encabezados que digan "no
cachear", que es lo que traía por default).

**Arreglado de raíz:** ahora `index.html` le pide cada archivo `.js` y
`.css` propio con un "número de versión" pegado al final
(`orders.js?v=20260929c`, por ejemplo). Para el navegador eso es una
URL distinta cada vez que cambio ese número, así que no tiene caché
vieja que le pueda estorbar — no dependemos más de que el
Ctrl+Shift+R funcione bien en cada PC.

**Importante:** esta vez SÍ hace falta un último Ctrl+Shift+R manual
en cada PC (para que bajen el `index.html` nuevo con los números de
versión) — pero de acá para adelante, cada vez que te mande una
actualización nueva, yo voy a subir ese número (`v=20260929c` →
`v=20260929d`, etc.) y con solo recargar la página normal (F5) alcanza,
sin Ctrl+Shift+R.

Toca: `index.html` únicamente.
