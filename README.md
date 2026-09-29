# Nesting DXF — v4 (modular)

Esta es la **V1** del plan que armaste: separar el archivo único de 2147 líneas
en módulos por responsabilidad, **sin cambiar ni una sola línea de lógica**.
Cada función se movió tal cual estaba — nada se reescribió, nada se
"aprovechó para mejorar de paso". Se validó que el resultado es exactamente
el mismo (ver "Cómo se validó" más abajo).

## Cómo abrirlo

Sigue funcionando con doble clic sobre `index.html`, igual que antes —
no hace falta servidor ni instalar nada. Esto fue a propósito: usé
`<script src="...">` normales (variables y funciones globales, como ya
tenías), no módulos ES6 (`import`/`export`). Los navegadores bloquean
`import` cuando abrís un `.html` directo desde el disco (`file://`), así
que si más adelante querés pasar a módulos de verdad (o a un Web Worker
real, no el truco del Blob), hay que sumar el paso de abrir la carpeta con
un servidor local (`npx serve .`, o la extensión "Live Server" de VS Code).
Por ahora elegí no pedirte ese paso.

Para conectar el SQL real (no el modo simulado/Excel), ver
**`CONECTAR_SQL.md`** — el paso a paso completo, con 2 archivos para
hacer doble clic en vez de escribir comandos.

## Estructura

```
NESTING/
├── index.html              ← HTML + orden de carga de todos los <script>
├── css/
│   └── styles.css          ← todo el diseño visual (antes <style> inline)
├── js/
│   ├── core/
│   │   ├── geometry.js     ← bbox, rasterizado, distancias punto-segmento
│   │   ├── polygon.js      ← área, perímetro, normalizar, simplificar
│   │   └── transform.js    ← rotar/espejar un polígono
│   ├── dxf/
│   │   ├── parser.js       ← leer entidades DXF, armar contornos cerrados
│   │   └── repair.js       ← lógica de la pestaña "Reparar DXF" (detectar
│   │                          puntos abiertos, unir, deshacer)
│   ├── nesting/
│   │   ├── orientation.js  ← generar las orientaciones (rotación/espejo) de una pieza
│   │   ├── placement.js    ← la grilla de una chapa y si una pieza entra ahí
│   │   ├── scoring.js      ← % de aprovechamiento, comparar dos resultados
│   │   ├── optimization.js ← una pasada completa de nesting (Fase 1)
│   │   └── engine.js       ← orquesta todo: Fase 1 + Fase 2 (mejora continua) + tiras
│   ├── strips/
│   │   └── strips.js       ← tiras de relleno automáticas
│   ├── ui/
│   │   ├── pieces.js       ← tabla de piezas cargadas, carga de archivos
│   │   ├── render.js       ← dibuja las chapas en pantalla y en el PDF
│   │   ├── history.js      ← ventana de historial de intentos
│   │   └── repair.js       ← canvas, clics y controles de "Reparar DXF"
│   ├── export/
│   │   ├── dxf.js          ← arma el DXF de cada chapa
│   │   ├── zip.js          ← descarga en .zip / DXF combinado
│   │   └── pdf.js          ← reporte en PDF
│   └── app.js               ← cambio entre pestañas (Nesting / Reparar DXF)
└── README.md
```

Antes: para tocar "cómo rota una pieza" tenías que abrir un archivo de
2147 líneas con todo mezclado. Ahora es `js/nesting/orientation.js`
(34 líneas). Para la lectura de DXF: `js/dxf/parser.js`. Y así con todo.

## Qué **no** cambió (a propósito)

Cero cambios de comportamiento en esta entrega. Mismo motor de rotación
automática, mismas tiras de relleno, misma ventana de historial, mismo
reparador de DXF, mismo PDF/ZIP/DXF de salida. Es un movimiento de código,
no una reescritura.

## Cómo se validó

No alcanza con "compila". Se hicieron tres pruebas antes de entregarlo:

1. **Sintaxis de cada archivo por separado** (`node --check` a los 19 `.js`).
2. **Sintaxis del conjunto**, concatenando los 19 en el mismo orden en que
   los carga `index.html` — esto además confirma que **no hay dos archivos
   declarando el mismo nombre** (`const`/`let` duplicado entre archivos
   revienta en un navegador real, aunque cada archivo por separado esté bien).
3. **Prueba de extremo a extremo real**: se cargó `index.html` completo en
   un DOM de verdad (con `<canvas>` funcionando), se cargaron 6 piezas de
   prueba, se corrió `doNest()` tal cual lo dispara el botón "Ejecutar
   nesting", y se confirmó que colocó las 6 piezas en 1 chapa — el motor
   entero, repartido en 19 archivos, corre igual que en el archivo único.

## Lo que sacamos de mirar la configuración de Libélula

Revisé `NestingCatalog.xml`, `LayerMapping.xml` y el resto de lo que
mandaste. Tres datos concretos, no genéricos:

- **`TiltAngle = 2`**: Libélula prueba rotaciones cada **2°** (180
  orientaciones). Nuestro paso más fino hoy es de 6-8° según cuántas
  piezas cargues — bastante más grueso. Es probablemente **la** causa
  principal del ~2% de diferencia que veías. Subir la finura del paso
  cuesta tiempo de cálculo, así que esto es candidato directo para **V3
  (mejorar el algoritmo)**, no para ahora.
- **`ElaborationTime = 300`**: Libélula tiene un **tiempo máximo de
  cálculo configurable** (acá, 5 minutos) y después de eso corta solo y
  usa lo mejor que encontró — en vez de que vos tengas que tocar
  "Detener" a mano. Es una función chica, segura, y no cambia resultados
  (solo cuándo se corta) — buena candidata para agregar temprano, aunque
  sí es una función nueva, así que la dejo para cuando digas "ahora sí,
  sumemos cosas" en vez de meterla de arriba en este split.
- **`LocalMaximumThreads = 16`**: confirma que el "Web Worker /
  paralelización" que ya tenías en el plan como fase agresiva final es
  exactamente lo que hace el competidor real — no es una idea de más,
  es lo que hay que hacer para cerrar el resto de la brecha.
- `LayerMapping.xml` (workingtype por capa DXF: 0/1/2/3) muestra que
  Libélula distingue, **por capa del DXF**, si una línea es corte, marcado,
  grabado, etc. Nuestro lector hoy junta todo en un solo contorno por
  pieza. Es una mejora real pero grande (toca el lector de DXF, el
  motor y la exportación) — la anoto como candidata fuerte para más
  adelante, no para meterla de contrabando en un split.

`ReportCatalog.xml` es sobre todo plantillas de reportes (.rdlc) del lado
.NET de Libélula — confirma que tienen varios estilos de reporte (completo
/ liviano / budget), pero no da ideas nuevas más allá de "podríamos ofrecer
un PDF liviano además del completo" si en algún momento te sirve.

## Próximos pasos (tu plan, tal cual)

- **V2** — optimizar sin cambiar resultados (por ejemplo: cachear cosas
  que hoy se recalculan de más, revisar qué tan seguido se refrescan las
  tiras).
- **V3** — mejorar el algoritmo (acá entra afinar el `TiltAngle`, y
  evaluar cache de orientaciones/heurísticas de próxima pieza).
- **Después** — Web Worker de verdad, paralelización, capas por tipo de
  operación, y si hace falta, WebAssembly.

## Bloques ya implementados (después del split)

**Bloque 1 — Tiempo máximo de cálculo** (inspirado en `ElaborationTime=300`
de Libélula). Campo nuevo en "Motor de nesting": si le ponés minutos, la
Fase 2 se corta sola al llegar ahí y usa lo mejor que encontró — 0 = sin
límite, igual que siempre. Toca `index.html` y `js/nesting/engine.js`.

**Bloque 2 — Rotación fina** (inspirado en `TiltAngle=2` de Libélula).
Casilla opcional, apagada por defecto. Cuando la activás, se suma un paso
de 2° al final de la lista de siempre (no la reemplaza) y se sube el tope
de orientaciones guardadas por pieza. Con la casilla apagada el
comportamiento es idéntico al de antes. Toca `index.html`,
`js/nesting/optimization.js` y `js/nesting/orientation.js`.

**Bloque 3 — Web Worker real** (inspirado en `LocalMaximumThreads=16` de
Libélula). El cálculo pesado (`placeJobPure`, extraído de lo que antes era
`runNestingPass`) ahora puede correr en un hilo aparte, sin frenar la
pestaña ni un instante. Como la app sigue abriéndose con doble clic
(`file://`), el Worker se arma en caliente con `fn.toString()` de las
funciones puras ya cargadas, metidas en un Blob — así no hace falta que el
navegador cargue un archivo adicional (eso Chrome lo bloquea en `file://`).
Si por lo que sea esto falla, `runInWorker()` devuelve `null` y
`runNestingPass` sigue en el hilo principal con la misma función
(`placeJobPure`), sin cortar el nesting. Nuevo archivo:
`js/nesting/worker-bridge.js`.
*Validación:* no tengo navegador en mi entorno para probar la creación real
del Worker, así que lo que sí pude validar a fondo es: (1) el código que se
arma para el Worker no tiene errores de sintaxis, y (2) ejecuté ESE MISMO
código, tal cual, simulando el entorno de un Worker en Node — dio el mismo
resultado que el hilo principal. Lo único que no pude ver con mis propios
ojos es si el navegador de verdad deja crear el Worker desde el Blob bajo
`file://` — miralo la primera vez que lo uses (si algo falla, cae solo al
camino de siempre, no se rompe el nesting, pero avisame si ves algo raro).

**Bloque 4 — Capas por tipo de operación** (inspirado en `LayerMapping.xml`
de Libélula). Si un DXF trae más de una capa, aparece un modal para decir
qué es cada una: **Corte**, **Grabado** o **Ignorar** (con una adivinanza
automática ya marcada según el nombre de la capa). El contorno de corte
sigue siendo el que arma la pieza para el nesting; el grabado viaja con
ella (rotación, espejo y posición incluidos — lo verifiqué a mano con los
números) y sale en su propia capa **GRABADO** en el DXF final, y se ve
punteado en rojo en la vista previa y el PDF. Con una sola capa (o "0"), el
comportamiento es idéntico al de siempre — no aparece ningún modal.
Toca `js/dxf/parser.js`, `js/ui/pieces.js`, `js/core/transform.js`,
`js/nesting/orientation.js`, `js/nesting/optimization.js`,
`js/export/dxf.js`, `js/ui/render.js`, `index.html` y `css/styles.css`.

## Hallazgo real al probar con tus DXF (`acrilico_2.DXF` / `Pala_ensamble.dxf`)

Al probar con tus archivos reales aparecieron dos cosas, ninguna del lado
de capas (los dos vienen en una sola capa, "0" — el modal del Bloque 4 no
se les activa, y está bien que no lo haga):

- **`Pala_ensamble.dxf`** cargó perfecto: un contorno cerrado de 39
  vértices (una polilínea con curvas/bulges), sin problemas.
- **`acrilico_2.DXF`** reveló un hueco real de funcionalidad, no de capas:
  es una lámina de 1510×1113mm con **33 ranuras/agujeros interiores** en
  grilla (armados con 70 líneas + 66 arcos sueltos). El lector solo se
  quedaba con el contorno exterior y **tiraba los 33 agujeros sin avisar**
  — el DXF exportado hubiera salido con la lámina sólida, sin los
  agujeros. Esto es un problema real para cortar (tornillería, ventilación,
  paneles perforados son comunes), así que lo arreglé en la misma pasada:
  ahora cualquier contorno cerrado que quede DENTRO del contorno principal
  se guarda como agujero, viaja rotado junto con la pieza (reutiliza la
  misma maquinaria del grabado), se ve realmente hueco en la vista previa
  (no relleno), y sale en el DXF final en la misma capa que el corte
  (los agujeros también se cortan, no son grabado).
  *Validado con tu archivo real:* detectó los 33 agujeros, los rotó
  correctamente a 90° (los 33 siguieron ahí, con el mismo desplazamiento
  que el contorno), los llevó hasta la pieza colocada en el nesting, y el
  DXF final salió con las 35 entidades esperadas (1 chapa + 1 contorno +
  33 agujeros).
  Toca los mismos archivos que el Bloque 4 (reutiliza su misma
  infraestructura de "geometría extra que viaja con la pieza").

## Bug real encontrado por vos: las polilíneas clásicas "empezaban" todas en el mismo punto fantasma

Con el Z-375 marcaste con flechas unas líneas/curvas que conectaban el
contorno con el texto "Z-375" de adentro — tenías razón, esas conexiones
no existen en el archivo. La causa: una `POLYLINE` clásica (a diferencia
de una `LWPOLYLINE`) trae su propia cabecera con un posible punto de
referencia interno (código 10/20/30, normalmente `0,0,0`) **antes** del
primer `VERTEX` real — y ese punto de cabecera no es un vértice de la
forma. El lector viejo lo leía todo en una sola bolsa sin distinguir
"esto es la cabecera" de "esto es un vértice real", así que ese `(0,0)`
fantasma se colaba como si fuera el primer punto de **cada una** de las 6
polilíneas del archivo — por eso todas "arrancaban" del mismo lugar y
aparecían esas conexiones que viste.

Arreglado: ahora el lector distingue la cabecera de los vértices reales
(usando los marcadores `VERTEX` de por medio), así que cada polilínea
clásica lee sus propios puntos, sin el fantasma. De paso confirmé lo otro
que dijiste: **"Z-375" son 5 letras reales** (Z, guion, 3, 7, 5), cada una
su propia polilínea cerrada, adentro del contorno principal — con el
sistema de agujeros del hallazgo anterior, ahora se detectan solas como 5
agujeros y se cortan junto con la pieza, tal como pediste.

Este bug no era solo del Z-375: afectaba a **cualquier archivo con
polilíneas clásicas** (no LWPOLYLINE). Al re-probar el lote de 12,
`599_00_05-06_D.dxf` pasó de mostrar 1 agujero a mostrar **10** — es decir,
antes de este arreglo se estaban perdiendo 9 agujeros reales en ese
archivo también, sin ningún aviso.

*Validado con tu archivo real:* las 6 polilíneas ahora tienen cada una su
propio primer/último punto (ya no comparten el `(0,0)` fantasma), las 5
letras se detectan como agujeros con las medidas correctas, y un nesting
completo (3 copias de la pieza) exportó el DXF con la cantidad exacta de
entidades esperada (19 = 1 chapa + 3 × (1 contorno + 5 letras)).
Toca `js/dxf/parser.js` (`entityToGeom`, el tramo de `POLYLINE`/`VERTEX`).

## Segunda tanda de archivos reales (12 piezas de producción)

Con este lote (`Z-375`, `Plantilla_EF1/EF2`, `821APC00`, `599_00_05-06_D`,
`0543APC07/BPC07`, `963_50_00_C`, `961_26_00`, `940PROBPC02`) aparecieron
dos cosas más, esta vez sí relacionadas con capas y con rendimiento:

**1) Las capas de cotas/dimensiones se colaban como agujeros falsos.**
`963_50_00_C.dxf` trae 3 capas: `0`, `OFFSET` y `DIM10`. La capa `DIM10`
resultó ser texto/flechas de cota (9 polilíneas cerradas, ~25×40mm cada
una) — nada que haya que cortar. Con la adivinanza automática de antes,
esa capa se marcaba "Corte" por defecto, y terminaban colándose **8
agujeros falsos** justo donde estaban las medidas del plano. Arreglé la
adivinanza: ahora cualquier capa que empiece con `DIM`, o se llame
`DEFPOINTS`, `COTA`, `NOTA`/`ANOT` o `TEXT`, se marca **"Ignorar"** por
defecto (el usuario la sigue pudiendo cambiar a mano en el modal). También
agregué un filtro de área mínima (2mm²) para los agujeros — así ni el
ruido numérico de teselar arcos (aparecían 13 "agujeros" de menos de medio
milímetro en este mismo archivo) ni un error de tipeo en el modal pueden
colar un agujero que ningún fabricante cortaría de verdad.
Toca `js/dxf/parser.js` (`guessLayerOp` y `buildLayeredGeometry`).

**2) Piezas grandes e industriales (muchos vértices) podían colgar la
pestaña varias decenas de segundos.** `Plantilla_EF2_2.dxf` es una pieza
de 1300×2728mm con 98 vértices y 27 agujeros — con piezas de prueba
chicas (un rectángulo de 4 vértices) nunca se notó, pero en una pieza real
grande, `rasterizePoly` (la función que decide qué celdas de la grilla
ocupa cada orientación de la pieza) tardaba hasta **26 segundos por
ángulo probado**, porque revisaba la chapa entera celda por celda. Lo
reescribí con barrido de líneas (scanline): en vez de preguntarle a cada
celda si está adentro, corta cada fila contra los bordes del polígono una
sola vez. **Mismo resultado exacto** (lo comparé celda por celda, con y
sin espaciado por kerf, en piezas simples, piezas cóncavas y con la pieza
real de 98 vértices) pero **5 a 7 veces más rápido**. Sumado al Web
Worker del Bloque 3, esto es lo que hace que un lote con piezas grandes de
verdad ya no cuelgue la pestaña.
Toca `js/core/geometry.js` (`rasterizePoly`).

*Validado con los 12 archivos juntos:* los 12 cargan sin error, y probé
un nesting combinado real con 4 de ellos (incluida la pieza de 27
agujeros y la que tenía la capa de cotas) — dio 3 chapas, las 8 piezas
colocadas, y el DXF final con la cantidad exacta de entidades esperada
(79 = piezas + agujeros correctos, cero de la capa de cotas).

## Vista nueva: "Lista de corte" (conexión a SQL Server)

Pediste poder traer órdenes de fabricación desde SQL Server (orden,
rack, archivo DXF, fecha de corte), nestearlas todas juntas en un lote, y
que al terminar el sistema marque solas las que se cortaron como "en
stock" — sin tocarlas a mano una por una.

**Por qué hace falta un servidor aparte:** ningún navegador puede
hablar con SQL Server directamente (no es una limitación nuestra, es así
para cualquier página web). Por eso esto viene con dos partes:

- **La vista en la app** (pestaña nueva "Lista de corte"): tabla de
  órdenes pendientes, selección, y dos botones — "Ejecutar lote de
  corte" (trae los DXF, arma las piezas reutilizando el mismo lector de
  capas/agujeros de siempre, y nestea) y "Confirmar y marcar en stock"
  (recién ahí genera el PDF y escribe en la base). Los separé a
  propósito: nestear no toca la base todavía, así podés revisar que no
  haya quedado nada sin ubicar antes de confirmar.
- **Un servidor chico que corre en tu PC** (carpeta `/server`), con el
  driver real de SQL Server. Tiene 3 consultas SQL marcadas con `TODO`
  para que les pongas el nombre real de tu tabla y tus columnas — no me
  arriesgué a escribir un `UPDATE` contra tu base sin saber esos nombres.
  Instrucciones completas en `server/README.md`.

**Qué validé y qué no:** armé un servidor de prueba con datos en memoria
(no tu SQL real) y corrí el circuito completo contra él: trae 3 órdenes,
selecciona 2, descarga sus DXF, nestea, confirma, y verifiqué —contra
ese servidor de prueba, no contra tu base— que marcó exactamente las 2
que se cortaron y dejó la tercera (con un archivo que no existía)
todavía pendiente. También probé que una orden sin contorno cerrado se
salta sola sin frenar el resto del lote. Lo que no pude probar es tu
conexión real a SQL Server ni tus consultas con tus nombres reales —
para eso hace falta que completes los `TODO` de `server.js` con tu
esquema.

Toca: `index.html` (pestaña + vista nueva), `js/app.js` (ahora maneja 3
vistas en vez de 2), `js/ui/orders.js` (nuevo), `css/styles.css` (estilo
de la tabla), y la carpeta nueva `server/`.

## Modo simulado + vista "Rack" (para mostrarle a tu jefa antes de conectar SQL)

Pediste un "SQL simulado" para mostrar cómo queda la vista de órdenes
antes de conectar la base real, y una vista nueva "Rack" donde se
almacenan las órdenes ya cortadas con una ubicación (A1, A2, A3...).

**Cómo se armó:** en "Lista de corte" hay una casilla **"Modo simulado"**,
activada por defecto. Con ella activada, la tabla se llena sola con 8
órdenes de prueba usando los nombres de columna reales que mandaste
(`Ordem_Serial`, `cehiculo`, `Part_Short`, `ordem_SetAtual`, `ARCHIVO`) —
y cada una apunta a un DXF **real** de los que ya probamos en esta
conversación (Z-375, acrilico_2, Plantilla_EF1/EF2, 821APC00, 940PROBPC02,
961_26_00, 0543BPC07), no datos inventados. Al confirmar un lote, en vez
de escribir en SQL, las órdenes cortadas pasan a la vista **"Rack"** con
una ubicación asignada en orden (A1, A2, ... A9, después B1, B2...).
Desactivando la casilla, vuelve a usar el puente real de `/server` tal
como estaba.

**Bug real que encontré haciendo esta prueba (no relacionado con SQL):**
al nestear las 8 órdenes juntas (varias piezas industriales grandes, una
de 1661mm de ancho), la Fase 1 se quedaba corriendo sin ningún freno de
tiempo — a diferencia de la Fase 2, que ya respetaba el "tiempo máximo"
que configurás. Con piezas grandes y varios pasos de rotación probándose
uno tras otro, esto podía tardar varios minutos sin ninguna forma de
cortarlo antes. Lo arreglé: ahora el límite de tiempo se respeta en
**todo** el proceso (Fase 1 y Fase 2), incluso pieza por pieza mientras arma
las orientaciones — si se acaba el tiempo a mitad de camino, deja lo que
ya se armó y sigue, en vez de colgarse. De paso corregí un detalle
para cuando esto corra en el Web Worker: el tiempo máximo se manda como
"cuánto falta" en vez de una hora exacta, porque el Worker tiene su
propio reloj interno que no arranca en el mismo punto que el de la
pestaña — mandar la hora tal cual hubiera dado comparaciones sin sentido.

*Validado:* corrí el lote completo de 8 órdenes reales (con búsqueda
profunda activada) de punta a punta — tardó cerca de un minuto y medio en
total (normal para piezas industriales grandes con ese nivel de
detalle), pero terminó bien: 8 de 8 ubicadas, confirmé, y las 8
aparecieron en el Rack con ubicaciones A1 a A8. Con un tiempo máximo más
corto (probé con pocos segundos) el sistema efectivamente corta ahí y no
ubica nada — esperable, no un error. Si para la demo en vivo preferís que
sea más rápido a costa de un aprovechamiento algo menor, bajá el "tiempo
máximo del lote" o desactivá "búsqueda profunda" en la pestaña Nesting
antes de ejecutar.

Toca: `index.html` (casilla de modo simulado + vista Rack), nuevo archivo
`js/ui/orders-sim-data.js` (los datos de prueba), `js/ui/orders.js`
(soporte de los dos modos + lógica de rack), `js/app.js` (4 vistas en vez
de 3), y `js/nesting/optimization.js` / `js/nesting/engine.js` /
`js/nesting/worker-bridge.js` (el arreglo del freno de tiempo).

## Salida del rack (cuando ya usaste el material)

Cada fila del Rack ahora tiene un botón **"Sacar del rack"** — lo sacás
cuando ya usaste esa lámina, y desaparece de la lista (no vuelve a
"Lista de corte", queda dado de baja).

En modo simulado ya funciona de punta a punta (lo probé: confirmé 2
órdenes, saqué una, y quedó solo la otra). Con el puente real agregué 2
endpoints nuevos en `server.js` (mismo patrón de `TODO` que los demás):
`GET /api/rack-actual` (para que la vista Rack traiga lo que hay ahora
mismo en SQL, no solo lo simulado) y `POST /api/rack/:orden/salida`.

Toca: `js/ui/orders.js` (botón + lógica de sacar) y `server/server.js`
(los 2 endpoints nuevos, con sus TODO).

## Editor de archivos — ahora edita y crea, no solo repara

Pediste dos cosas grandes: poder modificar el archivo (mover/agregar/
borrar puntos y formas enteras) y poder crear archivos desde cero.

**Cómo cambió por dentro:** antes esto guardaba el dibujo como una
"sopa" de líneas sueltas (servía para detectar puntos abiertos, pero no
permitía tocar nada con sentido). Ahora cada forma es su propia unidad
(sus puntos, si está cerrada o no) — así se puede seleccionar, mover
entera, o editar punto por punto.

**Herramientas nuevas**, todas en la misma pestaña:
- **Mover**: arrastrá un punto para moverlo solo a él, o arrastrá desde
  adentro/el borde de una forma para moverla entera.
- **+ Punto / − Punto**: agregá un vértice nuevo sobre cualquier lado, o
  borrá uno que ya no haga falta.
- **Unir abiertos**: es el modo manual que ya existía (clic en dos
  puntos rojos para unirlos), ahora como una herramienta más de la barra.
- **Línea / Rectángulo / Círculo / Polilínea**: dibujan formas nuevas
  desde cero — la polilínea se termina abierta o cerrada con los
  botones que aparecen mientras la estás dibujando.
- **Borrar forma seleccionada**: saca la forma completa que tengas
  marcada.
- **Empezar un archivo en blanco**: arranca sin cargar nada, para
  dibujar una pieza de cero.

El botón "Descargar DXF" y "Usar esta pieza en el nesting" ahora piden
solo que haya **alguna** forma cerrada lista (antes se bloqueaban si
quedaba CUALQUIER punto suelto en todo el dibujo, aunque ya tuvieras
formas cerradas de sobra — no tenía sentido si dejás, por ejemplo, una
línea de referencia abierta a propósito).

*Validado:* dibujé una línea, un rectángulo, un círculo y una polilínea
cerrada desde cero; seleccioné y moví una forma entera y un vértice
puntual por separado; agregué un vértice en el medio de un lado y
después lo borré (volvió exacto a como estaba); borré una forma y
deshice el cambio; y cargué un DXF con un hueco de 0.3mm real para
confirmar que la reparación automática lo sigue cerrando bien con el
modelo nuevo. Todo esto lo probé disparando eventos de mouse de verdad
(mousedown/mousemove/mouseup), no solo llamando funciones sueltas.

Toca: `js/dxf/repair.js` (reescrito, modelo por formas), `js/ui/repair.js`
(reescrito, canvas interactivo + herramientas), `index.html` (barra de
herramientas nueva) y `css/styles.css` (estilo de los botones de
herramienta).

## El modo simulado ahora persiste (localStorage)

Notaste que "Lista de corte" y el Rack volvían a su estado inicial cada
vez que cerrabas o actualizabas la página — tenías razón, no se estaba
guardando en ningún lado, todo vivía en memoria del navegador y se
perdía con cada recarga (esperable en modo simulado, ya que no hay
ninguna base de datos real detrás).

Ahora el modo simulado guarda su estado en `localStorage` del navegador
— sobrevive a cerrar la pestaña o actualizar la página. Agregué también
un botón **"Reiniciar datos de prueba"** por si en algún momento querés
volver a las 8 órdenes de arranque con el rack vacío.

*Lo que pude confirmar desde acá:* que la app arranca bien incluso si el
navegador bloqueara `localStorage` (lo probé forzando ese error) — no se
rompe nada, simplemente no persiste en ese caso. *Lo que no pude
confirmar 100%:* el guardado/restaurado real en un navegador de
verdad, porque mi entorno de pruebas tiene una restricción particular
bajo `file://` que un navegador real no tiene. Probalo vos extrayendo el
zip: confirmá una orden al rack, cerrá y volvé a abrir la página, y
fijate que siga ahí.

Toca: `js/ui/orders.js` (guardado/restaurado + botón de reinicio) e
`index.html` (el botón nuevo).

## Tercera opción: modo Excel (mientras no tenés SQL conectado)

Pediste poder pasar un Excel con la lista de corte y que la app haga las
modificaciones del rack ahí, "como si estuviéramos operando ya". En vez
de un intercambio manual acá en el chat, lo armé como una tercera opción
de **"Origen de datos"** en Lista de corte (junto a Simulado y Servidor
SQL real), para que uses el mismo flujo de nesteo/rack de siempre pero
con tus datos reales, sin necesitar SQL todavía:

1. **Importás un Excel** con las columnas `Ordem_Serial`, `cehiculo`,
   `Part_Short`, `ordem_SetAtual` y `ARCHIVO` (el nombre del DXF de cada
   orden) — no importa si los encabezados vienen con mayúsculas/espacios
   distintos, los reconoce igual. Reemplaza la lista de pendientes; lo
   que ya esté en el Rack no se toca.
2. **Subís los DXF** de esas órdenes (selección múltiple) — se enganchan
   solos con la columna ARCHIVO por el nombre del archivo.
3. De ahí en más es idéntico al modo simulado: "Ejecutar lote", revisás,
   "Confirmar y enviar al Rack" — con las ubicaciones A1, A2... y todo
   guardado en este navegador (mismo `localStorage` de antes).
4. Podés bajar un **Excel con el estado actual** (pendientes + rack) en
   cualquier momento, para tener un archivo real que mostrarle a tu jefa
   o guardar como respaldo mientras no hay base de datos.

Para leer/escribir el Excel se usa una librería externa (SheetJS), que
se carga igual que jsPDF/JSZip (desde internet, la primera vez que abrís
la página). *No pude probar que esa librería carga bien desde mi
entorno* (no tengo salida a internet acá) — lo armé simulando sus
funciones para probar toda MI lógica (cómo reconoce las columnas, cómo
engancha los DXF, cómo arma el Excel de salida), que sí validé de punta
a punta. Avisame si al abrirlo en tu navegador la importación no anduviera.

Toca: `index.html` (selector de origen de datos + campos de Excel),
`js/ui/orders.js` (toda la lógica del modo Excel), y el script nuevo de
SheetJS en el `<head>`.

## El editor ahora tiene zoom y paneo (más "tipo AutoCAD")

Pediste que la pantalla de edición se sintiera más como AutoCAD, con
zoom. Agregué:

- **Rueda del mouse**: acerca/aleja, siempre centrado en el cursor (el
  punto que tenés bajo el mouse se queda fijo en pantalla, no se corre
  hacia una esquina como en un zoom simple).
- **Botón del medio, arrastrar**: mueve la vista (paneo), sin importar
  qué herramienta tengas activa.
- **Botones +Zoom / −Zoom / Ajustar vista**, arriba del lienzo, para
  quien prefiera no usar la rueda o el botón del medio.
- **Lectura de coordenadas** en vivo (X/Y en mm) abajo del lienzo.
- Editar (mover un punto, agregar una forma, etc.) ya **no te reinicia
  el zoom** — antes cada cambio volvía a encuadrar todo el dibujo de
  cero, y perdías el acercamiento. Ahora la vista se re-encuadra sola
  solo al cargar un archivo nuevo, empezar uno en blanco, o tocar
  "Ajustar vista" — el resto del tiempo la manejás vos.

*Validado:* probé el zoom con un evento de rueda real, confirmando que
el punto del mundo bajo el cursor es EXACTAMENTE el mismo antes y
después (zoom centrado, no aproximado); probé que mover un punto no
cambia la escala de la vista; probé el paneo con un evento de botón del
medio real, confirmando que se corrió exactamente lo que arrastré; y
probé que "Ajustar vista" vuelve a un encuadre distinto al que tenías
zoomeado a mano.

Toca: `js/ui/repair.js` (vista con zoom/paneo persistente, en vez de
auto-encuadrar en cada render) e `index.html`/`css/styles.css` (la
barra de zoom arriba del lienzo).

## Precisión "tipo CAD": medidas, ángulo, radio, entrada exacta

Pediste que se sintiera más como AutoCAD de verdad — no solo el zoom,
sino medidas, ángulos y radios. Agregué:

- **Medidas en vivo mientras dibujás**: línea/polilínea muestran
  distancia + ángulo (0°=derecha, sentido antihorario, como en
  AutoCAD); rectángulo muestra ancho × alto; círculo muestra el radio.
  Todo se ve en el lienzo, al lado de la forma, mientras movés el mouse
  antes del segundo clic.
- **Entrada precisa**: en vez de hacer clic a ojo, después del primer
  punto aparece un panel donde escribís el valor exacto — distancia y
  ángulo para línea/polilínea, ancho y alto para rectángulo, radio para
  círculo — y confirmás con Enter o el botón. Sirve para seguir
  agregando segmentos de una polilínea con precisión, uno por uno.
- **Herramienta "Medir"**: hacé clic en dos puntos cualquiera del
  dibujo (no tiene que ser sobre una forma) y te dice la distancia y el
  ángulo entre ellos — no dibuja nada, es solo para consultar.
- **Info de la forma seleccionada**: con la herramienta "Mover", al
  seleccionar algo te dice sus medidas — largo y ángulo si es una
  línea, perímetro y área si es una forma cerrada, o el radio si
  reconoce que es un círculo (todos los puntos a la misma distancia del
  centro).

*Validado con números exactos, no aproximados:* dibujé una línea
pidiendo 100mm a 30° y salió exactamente así; un rectángulo de 80×40
salió exactamente así; un círculo de radio 25 dio radio 25 en todos sus
puntos; seleccioné ese círculo y la app lo reconoció como círculo con el
radio correcto; medí dos puntos horizontales y dio ángulo 0° como
corresponde.

Toca: `js/ui/repair.js` (medidas en vivo, entrada precisa, herramienta
Medir, info de selección) e `index.html`/`css/styles.css` (los paneles
nuevos en la barra lateral).

## Enganche a puntos (OSNAP) + lienzo tipo plano

Pediste poder armar un cuadrado/triángulo a mano uniendo el final de una
línea con el principio de otra, viendo dónde se va a pegar — y que el
lienzo se viera más como un plano de verdad. Miré cómo lo resuelven
AutoCAD y otros editores vectoriales (el "enganche a objeto"/OSNAP para
lo primero, grilla + ejes + fondo oscuro para lo segundo) y traje lo que
tenía más sentido para esta herramienta:

- **Enganche a puntos existentes**: con cualquier herramienta de dibujo,
  al acercarte a un punto ya puesto (de cualquier forma, no solo la que
  estás dibujando) aparece un cuadradito amarillo marcando "acá te vas a
  pegar" — si hacés clic ahí, el punto nuevo queda EXACTO en la misma
  coordenada, no aproximado. Así podés armar un cuadrado con 4 líneas
  sueltas (o un triángulo, o lo que sea) enganchando cada esquina con la
  anterior, y el sistema lo reconoce como un contorno cerrado de verdad
  al exportar — lo mismo pasa arrastrando un punto con "Mover": si lo
  soltás cerca de otro, se pega ahí.
- **Lienzo con estructura de plano**: fondo oscuro (en vez de la hoja
  blanca de antes), grilla con espaciado que se acomoda solo según el
  zoom (como en cualquier CAD — nunca queda ni muy apretada ni muy
  suelta), y los ejes X=0/Y=0 marcados en rojo/verde como el origen de
  cualquier sistema de coordenadas. Los colores de las formas, puntos y
  medidas los reacomodé para que se vean bien contra el fondo oscuro.

*Validado:* armé un cuadrado completo con 4 líneas sueltas, enganchando
cada esquina a la anterior — confirmé que las coordenadas quedaron
EXACTAS (no aproximadas), que el detector de puntos abiertos ya no
encuentra ninguno (las 4 esquinas quedaron con dos líneas encontrándose
ahí, no una punta suelta), y que al exportar se arma como un único
contorno cerrado de 5 vértices. Repetí toda la batería de pruebas
anteriores (dibujar, mover, zoom, precisión) para confirmar que nada se
rompió con estos cambios.

Toca: `js/ui/repair.js` (fondo/grilla/ejes, función de enganche,
indicador visual, y su uso en clic-para-dibujar y arrastre de vértices).

## Herramienta "Mano" + pulido visual

Pediste una forma de moverte por el plano más cómoda (como la mano de
AutoCAD/Illustrator) y que la herramienta se viera profesional de
verdad. Agregué:

- **Herramienta "✋ Mano"**: la seleccionás y el clic izquierdo mueve la
  vista arrastrando (el botón del medio sigue funcionando igual, con
  cualquier herramienta activa). El cursor cambia solo — mano abierta
  en reposo, cerrada mientras arrastrás.
- **Resaltado al pasar el mouse (hover)**: con "Mover" activo, el punto
  o la forma que tenés bajo el cursor se resalta ANTES de hacer clic
  (agranda el marcador, cambia de color), y el cursor pasa a "mano con
  dedo" — así sabés qué vas a agarrar antes de agarrarlo.
- **Líneas guía en cruz** siguiendo al mouse por todo el lienzo (como el
  cursor de cualquier CAD).
- **Marcadores de vértice** rediseñados: cuadraditos con borde en vez de
  puntos rellenos a secas — más nítidos, y se agrandan al pasar el mouse
  por encima.
- **Brillo en la forma seleccionada** (un resplandor suave alrededor del
  contorno), y el lienzo ahora tiene bordes redondeados y una sombra
  sutil, para que se sienta como un panel flotante en vez de un
  rectángulo pegado a la pantalla.

*Validado:* confirmé que el clic izquierdo con "Mano" activa mueve la
vista exactamente lo que arrastrás, que el cursor cambia solo en cada
momento (mano abierta → cerrada → abierta de nuevo al soltar), que el
resaltado detecta bien qué hay bajo el mouse sin necesidad de hacer clic,
y que desaparece cuando te alejás. Repetí toda la batería de pruebas
anteriores — encontré y corregí una regresión real que yo mismo
introduje en el paneo con el botón del medio antes de entregarte esto.

Toca: `js/ui/repair.js` (herramienta Mano, hover, líneas guía,
marcadores nuevos, brillo de selección) e `index.html`/`css/styles.css`
(el botón nuevo y el lienzo con sombra/bordes redondeados).

## Editar medidas de una forma ya dibujada + "Dibujar por texto"

Pediste dos cosas más: poder escribirle las medidas nuevas a un círculo
(u otra forma) que ya está dibujado, y un cuadro de texto tipo "describí
lo que necesitás y lo dibujo".

**Editar por medidas:** al seleccionar (con "Mover") un círculo, un
rectángulo o una línea, ahora aparece un panel con sus medidas actuales
ya cargadas — radio para el círculo, ancho/alto para el rectángulo,
distancia/ángulo para la línea. Cambiás el número y confirmás (Enter o
el botón): el círculo mantiene su centro y cambia de radio, el
rectángulo mantiene su centro y cambia de tamaño, la línea mantiene su
primer punto y cambia de largo/dirección.

**Dibujar por texto:** un cuadro donde escribís, por ejemplo, "círculo
radio 50", "rectángulo 100x60", "cuadrado 80" o "línea 120mm a 45
grados", y aparece dibujado en el centro de lo que estés mirando. Quiero
ser bien claro en esto — **no es una inteligencia artificial que
entienda cualquier frase**: es un lector de estos formatos puntuales. Si
escribís algo que no reconoce, te lo dice clarito (probé justamente con
"dibujame un dinosaurio" para confirmar que no se rompe ni inventa
nada, simplemente avisa que no entendió).

*Validado:* dibujé un círculo, lo seleccioné, le escribí "60" de radio y
el radio real quedó en exactamente 60mm. Lo mismo con un rectángulo
(150×70 exacto). Probé las 3 formas del cuadro de texto (círculo,
rectángulo, línea) y las 3 dieron las medidas exactas pedidas — y
confirmé que un texto que no encaja en ningún formato conocido avisa en
vez de fallar en silencio.

Toca: `js/ui/repair.js` (`repairShapeKind`, panel de edición, lector de
texto) e `index.html` (los 2 paneles nuevos en la barra lateral).

## Actualizaciones sin perder datos

Preguntaste qué pasa si publicás la app y a la semana surgen más ideas —
cómo actualizar sin perder la Lista de corte ni el Rack. Quedó resuelto
en dos partes, ver **`ACTUALIZAR.md`** para el detalle completo:

1. **Datos de Lista de corte/Rack** (simulado, Excel, o SQL real): ya
   viven fuera de los archivos de la app (en el navegador o en tu base),
   así que reemplazar los archivos no los toca — con la única condición
   de actualizar en el mismo lugar (misma carpeta), no en una nueva. De
   paso, el guardado local ahora lleva un número de versión interno, para
   que si el día de mañana cambio cómo se guardan estos datos, la app
   pueda adaptar lo viejo en vez de perderlo.
2. **Tus consultas SQL**: las separé de `server.js` a un archivo nuevo,
   `server/queries.js` — así `server.js` (el motor) puede actualizarse
   en el futuro sin pisar lo que ya completaste ahí con tus nombres
   reales de tabla y columnas.

Toca: `js/ui/orders.js` (versión + migración del guardado local),
`server/server.js` (usa `queries.js` en vez de SQL embebido),
`server/queries.js` y `server/queries.example.js` (nuevos), y
`ACTUALIZAR.md` (nuevo).

## El DXF también puede venir directo de SQL (sin carpeta compartida)

Contaste que tu tabla real no tiene una ruta de archivo, pero sí tiene
el DXF guardado adentro de la fila. Cambié el default: ahora el puente
asume que el DXF vive en SQL (no en una carpeta de red), y solo hace
falta completar una consulta más en `server/queries.js`
(`dxfPorOrden`, busca por número de orden) con el nombre real de tu
tabla y tu columna del DXF — funciona tanto si esa columna es de texto
como si es binaria, el servidor lo decodifica solo.

Si en algún momento SÍ tenés los archivos en una carpeta compartida
(hoy o en el futuro), la opción sigue estando — se activa con
`DXF_SOURCE=file` en tu `.env`. La app manda siempre los dos datos
(número de orden y nombre de archivo) en cada pedido, así no necesita
saber cuál de los dos modos tenés configurado.

*Validado:* armé una base de SQL simulada (sin conexión real, pero con
la misma forma de respuesta que da el driver real) con una orden guardada
como texto y otra como binario — las dos devolvieron el DXF exacto y
correcto. Confirmé también que una orden inexistente avisa claro (404)
en vez de fallar en silencio, y que el modo de carpeta compartida sigue
funcionando igual que antes para quien lo necesite.

Toca: `server/server.js` (el endpoint de DXF ahora elige entre SQL y
archivo), `server/queries.js` y `queries.example.js` (consulta nueva
`dxfPorOrden`), `server/.env.example` (la opción `DXF_SOURCE`), y
`js/ui/orders.js` (manda orden + archivo juntos en cada pedido).

## SQL real ya conectado — tu tabla + una tabla de control nueva

Me pasaste tu tabla real (`dbo.SAGA_SAPLotesVidro_Colombia`) y aclaraste
dos cosas clave: el DXF vive en `Lote_File` (adentro de la fila, sin
carpeta compartida), y esa tabla es solo el catálogo visual de lotes —
el rack no existe ahí ni en ningún otro lado todavía.

**Cómo quedó armado:** tu tabla de SAP nunca se toca. Se agrega una
tabla nueva y chica, `NestingControlCorte` (script para crearla en
`server/sql/crear_tabla_control.sql`, corré eso una vez en tu base), que
solo guarda "esta orden ya se cortó, en tal rack, tal fecha". Una orden
es "pendiente" si existe en tu catálogo pero todavía no tiene fila en
esta tabla de control — apenas se marca como cortada, desaparece de
pendientes y aparece en el rack, con una ubicación (A1, A2...) que se
calcula sola si no mandás una explícita.

**De paso corregí una inconsistencia real:** la consulta de pendientes
que había dejado antes devolvía nombres de columna genéricos (`orden`,
`rack`...) que nunca iban a coincidir con lo que la pantalla realmente
lee (`Ordem_Serial`, `cehiculo`, etc., los de tu captura original) — la
alineé bien.

*Validado de punta a punta* con una base simulada que se comporta como
la real (catálogo + tabla de control, cálculo de rack incluido): traje
3 pendientes, marqué una — bajó a 2 pendientes y apareció en el rack con
ubicación A1 calculada sola; marqué otra y le tocó A2 (el cálculo
secuencial funciona); intenté marcar la misma orden dos veces y avisó
409 en vez de pisarla; la saqué del rack y desapareció de ahí.

**Lo único que falta de tu lado:** correr el script
`server/sql/crear_tabla_control.sql` una vez en tu base, y revisar 3
columnas que adiviné para mostrar en la tabla (`Lote_Classe`,
`Lote_ClasseMat`, `Lote_Code` — las marqué con `TODO` en `queries.js`)
por si hay algo más representativo que prefieras mostrar ahí.

Toca: `server/queries.js` y `queries.example.js` (las 4 consultas
completas con el diseño de tabla de control), `server/sql/` (nuevo,
script de creación), y `server/server.js` (ajuste menor en cómo detecta
que el marcado funcionó).

## Columnas reales confirmadas (Ordem_Pos, Classe, PartnumberAGP, ClaveModelo)

Me pasaste una captura de tu tabla real con las columnas exactas que
necesitás en Lista de corte: `Lote_OrdemSerial`, `Lote_OrdemPos`,
`Lote_Classe`, `Lote_File`, `Lote_PartnumberAGP` y
`Desenho_ClaveModelo` — con el filtro `Desenho_ClaveModelo = '32VPMO'`.
Esto reemplaza las 3 columnas que había adivinado antes
(`Lote_Classe`/`Lote_ClasseMat`/`Lote_Code`), y quedó así en toda la
app — la tabla en pantalla, el rack, el modo Excel, y los datos de la
demo simulada (usan las mismas 8 piezas reales de antes, con estos
nombres de columna).

*Validado:* con una base simulada de 3 lotes (2 con `ClaveModelo=32VPMO`
y uno con otro valor a propósito) confirmé que el filtro funciona —
solo aparecen los 2 correctos en pendientes, nunca el tercero, ni ahí ni
después en el rack.

Toca: `server/queries.js` y `queries.example.js` (las columnas y el
filtro), `js/ui/orders.js` (tabla en pantalla, rack, lector de Excel),
`js/ui/orders-sim-data.js` (demo actualizada), e `index.html` (texto de
ayuda del modo Excel).
