# Serverless Sensitive Contracts

## Netlify Functions críticas

| Endpoint                      | Método                 | Auth            | Roles                                                                                | Variables clave                                               | Errores esperables                |
| ----------------------------- | ---------------------- | --------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------- |
| `syslab-proxy`                | `GET`,`POST`,`OPTIONS` | Bearer Firebase | `admin`, `nurse_hospital`, `doctor_urgency`, `doctor_specialist`, `editor`, `viewer` | `VITE_FIREBASE_*`, `SYSLAB_PROXY_URL` o `VITE_SYSLAB_API_URL` | `400`, `401`, `403`, `502`, `503` |
| `mmrad-search`                | `GET`,`OPTIONS`        | Bearer Firebase | `admin`, `nurse_hospital`, `doctor_urgency`, `doctor_specialist`, `editor`, `viewer` | `VITE_FIREBASE_*`, `MMRAD_USERNAME`, `MMRAD_PASSWORD`         | `400`, `401`, `403`, `500`, `502` |
| `send-census-email`           | `POST`                 | Bearer Firebase | `admin`, `nurse_hospital`                                                            | `VITE_FIREBASE_*`, Gmail secrets                              | `400`, `401`, `403`, `500`        |
| `fhir-api`                    | `GET`, `OPTIONS`       | Bearer Firebase | roles clínicos permitidos                                                            | `VITE_FIREBASE_*`                                             | `401`, `403`, `404`, `500`        |
| `clinical-document-ai-import` | `POST`, `OPTIONS`      | Bearer Firebase | `admin`, `nurse_hospital`, `doctor_urgency`, `doctor_specialist`, `editor`           | `AI_PROVIDER`, provider keys, `VITE_FIREBASE_*`               | `400`, `401`, `403`, `500`, `502` |
| `cie10-ai-search`             | `POST`, `OPTIONS`      | Bearer Firebase | roles clínicos generales                                                             | `AI_PROVIDER`, provider keys                                  | `400`, `401`, `403`, `500`        |
| `admin-ai-provider-status`    | `GET`, `OPTIONS`       | Bearer Firebase | `admin`                                                                              | `AI_PROVIDER`, provider keys                                  | `401`, `403`, `500`               |
| `admin-ai-provider-test`      | `POST`, `OPTIONS`      | Bearer Firebase | `admin`                                                                              | `AI_PROVIDER`, provider keys                                  | `400`, `401`, `403`, `502`        |
| `whatsapp-proxy`              | `POST`, `OPTIONS`      | según handler   | roles permitidos por handler                                                         | credenciales proxy externas                                   | `400`, `401`, `403`, `500`        |

## Reglas de contrato

`mmrad-dicom` (`POST`, `OPTIONS`) exige Bearer Firebase y los mismos roles clínicos
que `mmrad-search`, resueltos por el callable canónico. Usa `VITE_FIREBASE_*`,
`MMRAD_USERNAME` y `MMRAD_PASSWORD`; responde `400`, `401`, `403`, `429` o `502`
ante errores. Metadatos e imágenes se obtienen sólo de destinos fijos institucionales,
sin reenviar cookies RIS al visor. Cada instancia exige una capacidad firmada,
ligada al usuario y al estudio/serie/SOP, con vencimiento y límite de 3,5 MB.
Respuestas `no-store`, sin datos clínicos en logs o telemetría. Protocolo, cotas y
pruebas: [MMRAD_DICOM.md](MMRAD_DICOM.md).

`mmradDicomSantiago` (Firebase HTTP Gen2, `southamerica-west1`; `POST`, `OPTIONS`) trae
los originales de más de 3,5 MB que `mmrad-dicom` no puede llevar, hasta 30 MB. Exige
Bearer Firebase verificado con el Admin SDK, los mismos roles que `mmrad-dicom` con la
lógica de `checkUserRole`, un origen HHR y una capacidad Universitas vigente del mismo
usuario, firmada y sellada con `MMRAD_PASSWORD` (Secret Manager). Sólo consulta la URL
WADO fija del visor; responde `400`, `401`, `403` (`ticket-expired` si venció), `405`,
`413`, `422`, `429`, `502` o `503`, siempre `no-store` y sin registrar capacidades,
cookies, sesiones, UID ni excepciones.

- Toda Function sensible debe validar `Origin`.
- Toda Function sensible debe validar método HTTP.
- Toda Function sensible debe parsear JSON con helper compartido.
- Toda Function sensible debe responder con envelope consistente por runtime.
- Ninguna Function Netlify debe depender de `firebase-functions/v1`.
- Toda Function Netlify sensible que dependa del rol del usuario debe converger con el callable `checkUserRole`, no con una lectura paralela de `config/roles`.
- `mmrad-search` sólo envía credenciales/cookies a `https://ris.mmrad.cl`, sin usuario o contraseña en la URL. Valida enlaces antes del login y cada destino de redirección; conserva rutas relativas institucionales y limita a cinco las redirecciones automáticas. Un enlace externo devuelve `400`; un destino inválido recibido del portal falla sin consultarlo.

## Firebase callable clínico

| Endpoint                            | Auth               | Roles                                                                      | Autoridad                                                                  |
| ----------------------------------- | ------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `applyRayenClinicalEnrichmentBatch` | Firebase requerida | `admin`, `nurse_hospital`, `doctor_urgency`, `doctor_specialist`, `editor` | allowlist de campos, episodio y revisión verificados dentro de transacción |
| `setAdminCudyrResult`               | Firebase requerida | `admin`                                                                    | categoría cerrada, episodio y versión exacta verificados en transacción    |
| `openMedicalHandoffSpreadsheet`     | Firebase requerida | `admin`, `nurse_hospital`, `doctor_urgency`, `doctor_specialist`, `editor` | filas clínicas validadas y envío exclusivo a Apps Script institucional     |

Este callable recibe un lote acotado, no acepta rutas arbitrarias y registra únicamente
telemetría agregada sin identificadores de pacientes ni valores clínicos.

`setAdminCudyrResult` acepta únicamente las categorías CUDYR `A1` a `D3` o `null`
para eliminar el resultado. Exige administrador, coincidencia exacta del episodio clínico y
control optimista de versión; conserva las demás escalas y guarda historia y auditoría.

`previewDailyRecordRestore` y `restoreDailyRecord` exigen administrador y viven en
`southamerica-east1`. La vista previa no escribe. La restauración exige la fecha como
confirmación y control optimista de versión, guarda antes una copia del día vigente y
reemplaza el día y su auditoría en una sola transacción. Procedimiento:
[RUNBOOK_DAILY_RECORD_RESTORE.md](./RUNBOOK_DAILY_RECORD_RESTORE.md).

`openMedicalHandoffSpreadsheet` recibe como máximo 80 filas, no acepta RUT ni columnas
arbitrarias, valida claves estables y envía la carga únicamente a una URL institucional
de Apps Script configurada en el backend. El secreto compartido nunca se expone al navegador.

## Historial CUDYR

`archiveCudyrHistory` conserva observaciones oficiales por episodio/evaluación con
los roles existentes de escritura clínica y autoridad de sincronización verificada
en transacción. `readCudyrHistory` exige acceso clínico callable y pagina por período
o por un conjunto de hasta 30 episodios (100 recibos por página) para el contexto temporal.
Ambos fijan el establecimiento en el servidor y viven en `southamerica-east1`.
No alteran censos históricos ni habilitan acceso directo a la colección.
La operación `correct-discharge` exige `admin` o `nurse_hospital`, confirmación, motivo,
identidad exacta del episodio y revisión optimista. Persiste alta real y auditoría atómicamente,
sin modificar el egreso fuente ni el censo. Las lecturas `discharge-corrections` y
`discharge-audit` conservan el guard clínico. No se añaden endpoints ni permisos IAM.
Contrato, límites y validación: [CUDYR_HISTORY.md](./CUDYR_HISTORY.md).

## Convergencia obligatoria de rol

Para `syslab-proxy` y `mmrad-search`:

- la fuente de verdad sigue siendo `config/roles`;
- la resolución efectiva del rol debe pasar por el callable `checkUserRole`;
- no se debe reintroducir una vía separada de lectura de Firestore con semántica distinta;
- claims sincronizados no reemplazan esta convergencia.

Referencia:

- [docs/architecture/NETLIFY_AUTH_ROLE_CONVERGENCE.md](./architecture/NETLIFY_AUTH_ROLE_CONVERGENCE.md)

## Complemento mensual CUDYR (documental)

`archiveCudyrHistory`, operación `import-monthly-supplement`, admite únicamente
`admin` o `nurse_hospital`, sesión y confirmación. Valida estructura normalizada,
período, establecimiento, límite de 500 pacientes/500 KB y archivo XLS/XLSX de
hasta 256 KiB. Conserva bytes, SHA-256, versión y recibo idempotente por usuario y
operación. No decodifica el binario en el servidor: la evidencia queda rotulada
`user_imported`, nunca aplicación clínica verificada. No acepta hospital del cliente.

`readCudyrHistory`, operación `monthly-supplements`, conserva el guard clínico,
filtra un mes y pagina hasta cinco versiones. No devuelve los bytes del original.
Las tres colecciones documentales quedan inaccesibles por las reglas cliente;
ninguna operación escribe censos, evaluaciones, altas ni categorías estadísticas.
No se añaden endpoints o permisos IAM. El importador no es autor del CUDYR fuente.

## Cuentas individuales de enfermería

`createNursingAccount`, `listNursingAccounts` y `manageNursingAccount` requieren
administrador vigente y autenticación reciente de hasta quince minutos.
`enableIndividualAccounts` exige además el UID de Daniel y verifica los dos
Google protegidos antes de cerrar los accesos legacy. No borra identidades ni
reescribe históricos.

`activateNursingAccount` acepta un código privado de un uso, con vencimiento de
una hora, ligado al RUT verificado; sólo entonces permite elegir la contraseña.
`signInWithRut` verifica la contraseña mediante Firebase Auth del mismo proyecto.
`changeNursingPassword` exige sesión individual vigente y contraseña actual.
Versiones y locks cierran el acceso durante cambios/revocaciones incompletos.
El transporte limita intentos por cuenta/IP, usa destino fijo y nunca registra
contraseñas, códigos o cuerpos del proveedor. Los callables usan el envelope de
Firebase, límite de 60 segundos y errores públicos genéricos.

`signInWithRutSantiago` conserva ese mismo callable dentro de un adaptador HTTP
Gen2 en `southamerica-west1`; no implementa otra ruta de validación de cuenta.
Mantiene envelope de datos/respuesta, CORS/preflight, contexto de autorización,
rechazo de entrada inválida y errores `HttpsError`. La cuenta de servicio Appspot
del proyecto es explícita; memoria 256 MiB, CPU `gcf_gen1`, concurrencia 1,
mínimo 0, máximo 10 instancias y timeout de 60 segundos. El transporte invocable
no reemplaza la validación de credenciales y estado de la cuenta.

El cliente selecciona Santiago por defecto sólo en `hhr-pruebas`; los overrides
US/São Paulo/Santiago tienen allowlist y un valor inválido usa US. Si la ruta
regional no entrega respuesta utilizable (`internal`, `unavailable` o
`deadline-exceeded`), repite el ingreso una sola vez en el callable US y
registra `auth`/`rut_sign_in_region_fallback` con región y código, sin
credenciales ni correo de alerta; los rechazos de credenciales, límite o entrada
no se repiten. `signInWithRut` conserva sus endpoints Gen1 US/São Paulo para
compatibilidad; los otros callables de cuentas y el correo de recuperación no
cambian de región.

Pruebas específicas: `accountFunctionsRegions.test.ts`,
`accountSantiagoFunction.test.ts` y `nursingAccountRegion.test.ts`. El protocolo
HTTP se prueba con el SDK real, incluidos preflight, autorización malformada y
errores estructurados; se conserva el ciclo de vida/emulador de cuentas existente.

`signInWithRut` agrupa límites IP/cuenta e índice privado en una transacción con
`getAll`; sólo expone el índice del intento cuyo commit terminó. El límite sigue
siendo 100/IP y 10/cuenta por cinco minutos: un rechazo de cuenta consume IP y un
rechazo de IP no consume cuenta. Activación, recuperación y cambio de clave
comparten el transporte conservando sus claves de limitación. Un error de lectura
o commit no habilita un camino sin límites.

Una clave sin el formato numérico inicial evita leer preparación de primer ingreso.
La autorización sigue exigiendo token del mismo proyecto con revocación comprobada
y una lectura vigente de estado/lock después del proveedor; no se conserva como permiso para
ingresos posteriores. La clave inicial sólo concede preparación y revalida estado,
versión y lock transaccionalmente. No cambia el envelope, los endpoints ni CUDYR.

Pruebas: ciclo de vida y transporte, Auth/Firestore/Storage emulados y Chromium
con datos sintéticos. El puente del navegador ejecuta handlers de producción;
no sustituye la validación de CORS o Functions desplegadas. Contrato operativo:
[AUTH_ACCESS_MODEL.md](./AUTH_ACCESS_MODEL.md).

## Inventario completo de Netlify

`check:serverless-sensitive-coverage` descubre todos los archivos `.ts`, `.mts` y `.js`
de primer nivel de `netlify/functions/`, sin recorrer `lib/`. Cada archivo debe estar en
`entries` o en `exempt` de `scripts/config/serverless-sensitive-coverage.json`.
`entries` no puede estar vacío: exige archivo, pruebas existentes y endpoint documentado.
Cada exención exige archivo existente y motivo no vacío; ningún archivo puede estar en
ambas listas. Las exenciones sensibles siguientes son deuda visible, no garantías de cobertura.

La tabla describe el comportamiento actual de los handlers. Las reglas de contrato anteriores
son requisitos; esta clasificación no añade verificaciones al runtime. En particular, los
handlers reciben identificadores o texto enviados por el cliente y no comprueban por sí
mismos su pertenencia a un episodio del censo.

| Endpoint                              | Método                                                                                                     | Autenticación y rol actuales                                                                                                                                                                                              | Entradas                                                                                                                                                                | Salidas actuales                                                                                                                                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `syslab-proxy`                        | `GET`, `POST`, `OPTIONS`; las acciones de trabajos fijan su método, las acciones clásicas no lo restringen | Bearer Firebase y `admin`, `nurse_hospital`, `doctor_urgency`, `doctor_specialist`, `editor`, `viewer`; `OPTIONS` sin autenticación                                                                                       | `action`, RUT, enlaces, identificador de trabajo o JSON del censo/revisión; token de puente en servidor                                                                 | Estado de conexión, exámenes, detalles, PDF o respuesta del trabajo. `health` puede devolver `200` con `connected:false`; los fallos de consultas devuelven error. El propietario de trabajos se deriva de proyecto, usuario y hospital.  |
| `exalab-proxy`                        | `GET` para `status`/`pdf`, `POST` para `pair`/`connect`/`disconnect`/`search`, `OPTIONS`                   | Bearer Firebase y los seis roles de `syslab-proxy`, salvo `connect`, que delega la capacidad de emparejamiento al puente sin Bearer ni rol. Admite origen de extensión Chrome para `connect`; `OPTIONS` sin autenticación | Acción, RUT y Desde/Hasta, enlace `hhr-exalab://report/`, o `pair`/`session`/`expectedOwner`; token de puente en servidor                                               | JSON del puente o PDF validado, hasta 4 MiB, `no-store`. El propietario de las acciones autenticadas se deriva del token; el puente resuelve la conexión.                                                                                 |
| `mmrad-search`                        | `GET`, `OPTIONS`                                                                                           | Bearer Firebase y los seis roles de `syslab-proxy`; `OPTIONS` sin autenticación                                                                                                                                           | RUT, nombre opcional, Desde/Hasta; acciones `pdf`, `portalReceipt` o `check-digit` con enlace o nombre según corresponda; credenciales RIS en servidor                  | Exámenes y enlaces, secciones de informe, PDF o HTML del comprobante. El PDF y comprobante usan caché privada de 300 s. Puede informar búsqueda por dígito parcial; la hidratación de un informe CT fallida conserva el examen.           |
| `prescription-image-proxy`            | `GET`, `OPTIONS`                                                                                           | Sin Bearer ni comprobación de rol; valida origen. El acceso depende de la URL de Storage recibida                                                                                                                         | URL HTTPS de `firebasestorage.googleapis.com` en un bucket HHR configurado y ruta `prescriptions/`, ancho y calidad acotados. Acepta localhost solo con flag de fixture | Imagen JPEG optimizada o imagen JPEG/PNG/WebP original si falla la transformación; base64, `no-store`, sandbox y `nosniff`. No verifica propietario, episodio ni token de descarga por separado.                                          |
| `send-fuga-notification`              | `POST`, `OPTIONS`                                                                                          | Bearer Firebase, `admin` o `nurse_hospital`; modo prueba solo `admin`; `OPTIONS` sin autenticación                                                                                                                        | Nombre, RUT, diagnóstico, cama, fecha/hora, mensaje y destinatarios; destinatarios de psiquiatría configurados en servidor                                              | Envía correo con Gmail una vez, sin reintento automático; devuelve `success`, mensaje y `gmailId`, o error. Valida esquema y política de destinatarios; no consulta el episodio ni verifica su estado de fuga.                            |
| `clinical-document-ai-import`         | `POST`, `OPTIONS`                                                                                          | Bearer Firebase, `admin`, `nurse_hospital`, `doctor_urgency`, `doctor_specialist`, `editor`; `OPTIONS` y respuesta de IA no configurada antes de autenticar                                                               | JSON con texto fuente saneado; enrutamiento y credenciales del proveedor en servidor                                                                                    | `available:false` si no hay IA, o proveedor, modelo y documento estructurado validado. El texto saneado se envía al proveedor; la instrucción de no inventar contenido no equivale a una verificación clínica del resultado.              |
| `clinical-attachment-name-suggestion` | `POST`, `OPTIONS`                                                                                          | Los cinco roles y excepciones previas a autenticación de `clinical-document-ai-import`                                                                                                                                    | Metadatos del adjunto y documento, nombres original/visible, tipo, MIME y fechas; enrutamiento IA en servidor                                                           | `available:false` o proveedor, modelo y nombre saneado con extensión original. El prompt pide omitir identificadores, pero el saneamiento de salida elimina caracteres de archivo y limita longitud; no detecta identidades de pacientes. |
| `operational-telemetry`               | `POST`, `OPTIONS`                                                                                          | Sin Bearer ni comprobación de rol; valida origen y limita por IP                                                                                                                                                          | Evento de telemetría validado/saneado, cuerpo de hasta 8 KiB; contexto privado Netlify para Blobs y correo                                                              | `202` con aceptación y estado de alerta; registra evento saneado, cuenta resultados y puede encolar/enviar alertas. Devuelve `503` si no puede obtener recibo durable o la cola está llena.                                               |
| `admin-ai-provider-test`              | `POST`, `OPTIONS`                                                                                          | Bearer Firebase y `admin`; `OPTIONS` sin autenticación                                                                                                                                                                    | Acción y proveedor de listas cerradas, modelo opcional; credenciales IA solo en servidor                                                                                | Prueba al proveedor con prompt fijo sin datos clínicos; devuelve `ok`, proveedor/modelo y mensaje. La ausencia de configuración es `200` con `ok:false`; fallos del proveedor son `502`.                                                  |

### Exenciones registradas

- `operational-telemetry-retry`: sensible, sin prueba de comportamiento todavía. Tarea
  programada cada cinco minutos mediante `config.schedule`, sin validación propia de Bearer,
  rol ni origen; el acceso privado depende del runtime Netlify. Usa contexto privado para
  drenar una alerta, registra el resultado y lanza un error genérico si falla. Las pruebas
  de cola y empaquetado no ejercitan esta invocación.
- `firebase-config`: configuración pública del cliente Firebase, incluida su API key
  pública. No lee pacientes ni expone credenciales de servidor.
- `runtime-contract`: constantes públicas de versiones de runtime y esquema, sin lecturas
  clínicas ni acciones administrativas.
