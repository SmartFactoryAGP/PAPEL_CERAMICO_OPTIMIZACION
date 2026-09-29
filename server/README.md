# Puente "Lista de corte" — instrucciones

Este es el servicio chico que le da a la app acceso a SQL Server y a la
carpeta compartida de los DXF. Corre en tu misma PC.

## 1) Completar la configuración

Copiá `.env.example` a `.env` (mismo nombre, sin ".example") y completá:

- `DB_SERVER`, `DB_DATABASE`, `DB_PORT`: los datos de tu SQL Server.
- `DB_USER` / `DB_PASSWORD`: si te conectás con usuario y contraseña.
  Si en cambio usás autenticación de Windows, dejalos vacíos y poné
  `DB_TRUSTED_CONNECTION=true`.
- `DXF_BASE_PATH`: la ruta de la carpeta compartida donde están los DXF
  (ej. `\\SERVIDOR\Ordenes\DXF`).
- `API_TOKEN` (opcional, recomendado): una clave cualquiera que vos
  inventes. Si la completás, cualquiera que le hable a este puente tiene
  que mandar esa misma clave — protege contra que otro proceso en tu PC
  o tu red le pida/escriba datos sin que te des cuenta. Si la dejás
  vacía, no se pide nada (más simple para arrancar, menos protegido).
  Si la usás, cargá la MISMA clave en el campo "Clave del puente" que
  aparece en la app cuando apagás "Modo simulado".

## 2) Instalar y arrancar

Necesitás tener [Node.js](https://nodejs.org) instalado (una sola vez).
Después, en esta carpeta:

```
npm install
npm start
```

Vas a ver:
```
Puente "Lista de corte" escuchando en http://localhost:4000
```

Dejá esa ventana abierta mientras usás la app — es la que mantiene la
conexión con SQL Server y lee los archivos de la red. Si la cerrás, la
pestaña "Lista de corte" de la app deja de poder traer datos (te va a
avisar con un mensaje, no rompe nada del resto de la app).

## 3) Ajustar las 3 consultas SQL

Abrí `server.js` — hay 3 lugares marcados con `TODO:` donde hace falta
poner el nombre real de tu tabla y tus columnas:

1. **Lista de pendientes** (`GET /api/ordenes-pendientes`): qué tabla y
   qué criterio usás para decidir "esta orden todavía no se cortó".
2. **Marcar en stock** (`POST /api/ordenes/:orden/marcar-en-stock`): el
   `UPDATE` que cambia el estado y guarda el rack. Si en tu caso el rack
   ya viene asignado de antes y no hace falta reescribirlo, sacá esa
   parte y dejá solo el cambio de estado.

El endpoint de leer el DXF (`GET /api/dxf`) **no** toca la base — solo
lee el archivo de la carpeta compartida, así que ese no hace falta
tocarlo (a menos que la ruta de tus archivos no sea tan simple como
"carpeta base + nombre de archivo").

## Qué está probado y qué no

Probé de punta a punta todo el circuito **excepto la conexión real a
SQL Server** (no tengo acceso a tu base desde acá): armé un servidor de
prueba con datos en memoria en vez de SQL real, y con eso confirmé que
la app trae la lista, descarga los DXF, nestea, y al confirmar marca
correctamente solo las órdenes que se pudieron colocar — incluyendo que
maneja bien una orden con archivo inexistente y una con geometría
inválida, sin romper el resto del lote. Lo único que te toca validar
vos es que las 3 consultas SQL (una vez que les pongas tus nombres
reales) hagan lo que esperás contra tu base de verdad.

## Qué más se endureció (por defecto, no hace falta tocar nada)

- **Recorrido de rutas**: `/api/dxf` ahora verifica que el archivo pedido
  quede DENTRO de `DXF_BASE_PATH` — no puede escaparse a otra carpeta
  aunque el nombre de archivo viniera con algo raro como `../../otra`.
- **CORS**: solo se acepta pedir datos desde una página abierta con
  doble clic o desde `localhost` — no desde cualquier sitio web.
- **Dos personas marcando la misma orden a la vez**: el `UPDATE` de
  marcar-en-stock ahora exige que la orden todavía no esté en "STOCK" —
  si otra persona (u otra pestaña tuya) ya la marcó mientras tanto, la
  app te avisa en vez de pisarla en silencio.
- **Registro de pedidos**: cada pedido que le llega a este puente queda
  anotado en la consola (método, ruta, hora) — sirve para rastrear qué
  pasó si algo no cuadra después.

## Otros riesgos a tener en cuenta (esto no lo resuelve el código solo)

- **Nombres reales de tabla/columnas todavía sin confirmar** (`Rack`,
  `Estado`, y el nombre de la tabla en sí) — completalos vos en los
  `TODO` antes de usar esto contra tu base de producción.
- **El puente tiene que quedar corriendo** todo el tiempo que uses
  "Lista de corte" — si tu PC se apaga, se suspende, o cerrás la
  ventana de la consola, la app deja de poder traer/marcar órdenes
  (con un aviso claro, no rompe el resto de la app).
- **Credenciales en `.env`**: quedan en texto plano en tu PC — no lo
  subas a ningún repositorio compartido ni lo mandes por chat/mail.
- **Ubicaciones del rack (A1, A2...) son solo un contador interno**, no
  saben nada de tus racks físicos reales (cuántos hay, cuál está
  ocupado por otra cosa) — cuando conectes SQL de verdad, esa
  correspondencia hay que validarla con tu proceso real, no asumirla.
- **Marcar "en stock" es una acción real**: si se confirma un lote sin
  que el material se haya cortado de verdad todavía, la base va a decir
  algo que no pasó — vale la pena que ese botón lo apriete alguien que
  ya vio la pieza cortada, no que sea automático apenas termina de
  nestear.

## El DXF puede venir de SQL directo (sin carpeta compartida)

Si tu tabla no tiene una ruta de archivo pero sí tiene el DXF guardado
adentro (en una columna de texto o binaria), no hace falta ninguna
carpeta compartida — es el modo por defecto ahora.

En tu `.env`, dejá `DXF_SOURCE=sql` (así viene por defecto) y completá
la consulta `dxfPorOrden` en `queries.js` con el nombre real de tu tabla,
tu columna del DXF, y tu columna de orden. Funciona tanto si la columna
es de texto como si es binaria (varbinary/image) — el servidor decodifica
solo, no hace falta que te fijes cuál es.

Si en cambio SÍ tenés los DXF en una carpeta de la red, poné
`DXF_SOURCE=file` y completá `DXF_BASE_PATH` como antes — ese modo sigue
andando igual.
