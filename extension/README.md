# Extensión · Puente Eloísa → HHR

## Identidad de los paquetes y trabajo en paralelo

El número de versión no demuestra que dos paquetes contengan las mismas funciones.
Cada ZIP generado por HHR incorpora una huella SHA-256 de sus archivos de ejecución y
recursos, independiente del equipo, la ruta local y la fecha. Se conserva el identificador
completo en `manifest.version_name`; el nombre del ZIP y el popup muestran sus primeros
12 caracteres. El sufijo identifica este contenido normalizado, no el checksum del ZIP.
El manifiesto fuente no se modifica al empaquetar y cualquier etiqueta heredada se recalcula.

El reporte de conexión comunica la identidad del paquete. HHR distingue identificadores
iguales, diferentes y ausentes: un número igual o superior no basta para declararlo actual.
Las extensiones anteriores y las carpetas fuente sin empaquetar siguen siendo compatibles
con sus funciones existentes, pero se muestran sin identidad verificable. La huella es una
etiqueta de compilación, no una firma ni una comprobación continua de archivos modificados
a mano: tras editar una carpeta descomprimida, hay que volver a empaquetar y recargar Chrome.

Los números de las ramas son provisionales. Antes de publicar, incorporar la última base y
elegir un número superior al publicado. CI compara los commits exactos de base y candidato
y rechaza cambios del paquete que reutilicen una versión. Esto se suma al requisito de rama
al día y a las pruebas de compatibilidad; no permite inferir compatibilidad a partir de un ZIP.

Extensión de Chrome (Manifest V3) que lee el censo de hospitalizados de **Rayen / Ficha
Médico** y lo entrega al **censo local HHR** para importarlo con revisión. Además, en
**Gestión de cuidados**, agrega accesos separados al reporte de indicaciones y a la receta médica
vigente oficial de Eloísa. Como respaldo sin backend intermedio, cada paciente activo puede copiarse
como un código versionado que HHR valida antes de una admisión manual y de la elección de cama.

## DAU oficial sin abrir Urgencias (0.48.87)

Si no hay una sesión nativa utilizable, «Descargar DAU oficial (PDF)» muestra el acceso
a Rayen Urgencias dentro del panel: usuario, contraseña, dominio y, si corresponde,
código de verificación y perfil. La contraseña se envía directamente a Rayen y no se
guarda. El contexto y el ticket temporales quedan aislados de HHR en la extensión;
cambiar de sesión clínica o cerrar la pestaña revoca ese acceso.

El botón comprueba primero si existe acceso nativo. Cuando falta, prepara el formulario
sin esperar la recarga del historial HCC ni leer datos clínicos. Después del login se
verifican igualmente el paciente y la atención seleccionada antes de descargar el PDF.
El paquete 0.48.87 reúne este acceso con el conector de Exalab incorporado en `main`.

El `ContextId` proviene del login nativo; no se reemplaza por tokens de Eloísa.
La API confirma paciente, atención, admisión y establecimiento antes de solicitar el
PDF oficial. La actualización requiere aceptar el permiso para `api.saludenred.cl`
y recargar HHR/Eloísa. La prueba sintética del iframe, MFA y PDF se ejecuta con
`npm run test:e2e:urgency-dau-login`, sin credenciales ni conexiones clínicas reales.

## Puente 0.48.58: direcciones HHR y despliegues

El puente admite `https://hhr-hospitalizados.app`, los sitios `testinghhr.netlify.app` y
`hhr-entorno-prueba.netlify.app`, sus deploy previews, despliegues por rama y enlaces permanentes
de deploy. En desarrollo admite HTTP en `localhost` y `127.0.0.1`, puertos 3000–3020 inclusive.
`hhr-origin-policy.js` mantiene la misma autorización en los puentes, la trazabilidad y la
recuperación de pestañas. El patrón Netlify del manifiesto se restringe en ejecución a esos dos
proyectos; otros sitios de Netlify no instalan el puente ni reciben consultas o mensajes.
Actualizar/recargar la extensión y las pestañas HHR para aplicar las nuevas direcciones.

## Puente 0.48.52: identidad en el índice de informes

La lista de hospitalizaciones transmite también el nombre y el tipo de identificador de cada
episodio (RUN propio o materno). HHR usa esa evidencia para revisar filas administrativas
ambiguas de censos anteriores; conserva la revisión si la identidad o las fechas no coinciden.
No amplía permisos, no modifica informes de Eloísa ni altera el CUDYR oficial guardado.

## Puente 0.48.51: sincronización histórica por evidencia

La captura admite fechas actuales o pasadas válidas sin el antiguo bloqueo de siete días.
HHR verifica cada episodio antes de reconstruirlo: la antigüedad no garantiza la disponibilidad
de los datos. El historial clínico alcanza la fecha solicitada sin el recorte local de 180 días,
y un formato de respuesta inesperado se informa como fallo de fuente, nunca como ausencia.
Los controles de sesión, establecimiento, corte del turno y timeout se mantienen.
Actualizar/recargar la extensión y las pestañas abiertas para usar estas correcciones.

## Cunas creadas en Gestión de Camas (0.48.45)

Las cunas no requieren un catálogo separado: `CH2C2`, `Cuna H2C2` y las demás
cunas de las 18 camas físicas se reconocen cuando Gestión de Camas confirma el
mismo episodio y la misma ubicación de Ficha Médico. HHR conserva al paciente
principal y agrega el RN como `clinicalCrib`, con Pediatría como valor inicial;
una especialidad modificada manualmente sigue respetándose. Repetir la
sincronización no crea otra cuna. Ubicaciones desconocidas, relaciones no
verificadas y colisiones entre RN siguen requiriendo revisión.

Actualizar/recargar manualmente la extensión a **0.48.45** y recargar las pestañas
de Eloísa abiertas para aplicar este reconocimiento.

## Diagnóstico de fallos del panel (0.48.44)

Cuando una fuente impide cargar el panel, «Detalle de la conexión» conserva el error
original y añade un código `HHR_PANEL_V1` con estado y duración en milisegundos de
historial, cuidados, medicamentos activos/inactivos y validación. El bloque técnico
incluye sólo categorías fijas, estados y tiempos; se puede copiar para diagnosticar
la demora sin compartir identificadores, URLs ni contenido clínico.

Las cinco fuentes siguen consultándose en paralelo. Un fallo conserva el cierre
seguro del panel: no se presenta una lista de medicamentos incompleta como válida.
Las duraciones incluyen todas las páginas de cada consulta de medicamentos; no
miden renderizado ni explican por sí solas un problema del servidor.
Actualizar/recargar manualmente a **0.48.44** para obtener este diagnóstico.

## Epicrisis del episodio actual (0.48.43)

Los iconos de alta del censo descargan por separado el PDF médico y el de enfermería.
Ambos están también disponibles en **Informes de hospitalización** del panel clínico.
Cuando el índice de informes por RUN omite el episodio del censo, se consulta su cabecera
oficial y se comprueba el RUN antes de incorporarlo o descargarlo. No se sustituye por
una hospitalización anterior ni se afirma que siga vigente sin evidencia del origen.
Los episodios ya presentes conservan sus fechas; los RN sin RUN mantienen la consulta
por identificador exacto de episodio.

El PDF médico usa `Reporte_Epicrisis.pdf` y el de enfermería
`Alta_Enfermeria_Blank_A4.pdf`, con `enc_id`, `fac_id`, `pat_id` y `hcp_id` para este último.
Contrato comprobado en el módulo oficial **Informes → Informe Alta de Enfermería**
de Eloísa (02-10-2026); no se reconstruye ni modifica el contenido del PDF.
La descarga sigue pasando por la validación de PDF y sesión del runtime de informes.
Si Eloísa no autoriza o no entrega un PDF válido, HHR muestra el error y permite reintentar.
Actualizar/recargar manualmente la extensión a **0.48.43** para utilizar estos cambios.

## Cómo funciona

```
HHR (localhost / testinghhr)                 Rayen (fichamedico)
  botón "Importar desde Rayen"                 inject (MAIN world)
        │ postMessage                            · envuelve fetch → captura token HSP
        ▼                                        · lee censo + egresos + demografía
  content-hhr.js  ── chrome.runtime ──►  background.js  ── chrome.tabs ──►  content-fichamedico.js
        ▲                                                                      │ postMessage
        └───────────── snapshot ◄──────── background ◄──── snapshot ◄──────────┘  inject normaliza
        │ postMessage (HHR_RAYEN_CENSUS_SNAPSHOT)
        ▼
  bridge del módulo rayen-import  → preview / auto → aplica al DailyRecord
```

- El snapshot de censo cruza hacia HHR ya normalizado. Los tokens necesarios para reportes CORS se
  reducen a una sesión temporal de la extensión y nunca se persisten en disco ni se envían a HHR.
- La lectura usa `filterType=3` (sin médico + Servicio Todos = censo completo) + `filterType=2`
  (egresos), `patientHeaderData/{encId}` y el diagnóstico principal activo por paciente. Marca
  `isComplete=true` y entrega el código CIE-10 cuando Ficha Médico lo informa. Si el paciente
  aún tiene solo un diagnóstico de ingreso, usa su `haoDiagId` (o `diagnosisId` de la lista)
  para buscar el código exacto en el catálogo oficial de Eloísa. Ese catálogo se lee solo si
  hay diagnósticos sin código y se reutiliza durante una hora en la pestaña; nunca se asigna
  un código por semejanza del texto. Una nueva sincronización completa los códigos de los
  pacientes ya presentes en HHR sin rehacer su ingreso.
- El panel clínico se consulta solo al abrirlo: combina historial, estado vigente de fármacos y
  plan de cuidados. Así distingue suspendidos, muestra acciones de enfermería ejecutadas y separa
  entregas de turno médicas y de enfermería sin persistir ese contenido en HHR.

## Lecturas clínicas y recuperación

- CUDYR consulta las tres listas de respaldo en paralelo (máximo tres lecturas), con
  precedencia estable. Una lista ilegible no cuenta como lista vacía válida. El historial
  oficial de Gestión de Camas se conserva si falla el respaldo o sus metadatos opcionales.
- HHR espera hasta 120 segundos la respuesta CUDYR, incluyendo renovación de sesión y
  lecturas del backend de hasta 45 segundos; la sincronización no reduce ese plazo a 15
  segundos. Una respuesta rápida continúa inmediatamente y un timeout real mantiene el
  reintento disponible. Los resultados se asignan por la fecha/turno de registro en Rapa
  Nui: una categoría antigua visible en Eloísa no prueba que exista para el censo elegido.
- `patient-clinical-bundle-runtime.js` coordina dispositivos, historial de escalas,
  formularios y alertas de la ficha; cada sección falla de forma independiente. No decide qué
  persistir en HHR.
- `fichamedico-alert-entry-runtime.js` lee las **Alertas** del episodio
  (`entrySummary/alertEntry`) solo para el día clínico en curso, porque Eloísa entrega las
  vigentes al momento de leer. Otro día responde `skipped` sin consultar Eloísa.
- El canal HHR negocia `acceptEntries: true` también en el paquete clínico. Para el día
  clínico actual se permite el lector JSON de dispositivos; fechas históricas, clientes
  sin opt-in y datos no soportados conservan el respaldo PDF. No confundir una respuesta
  vacía válida con una fuente no disponible.
- `clinicalPatientReaders.ts` normaliza las secciones y permite un único reintento
  individual por fuente, incluso si llegó el PDF pero falló su interpretación. No vuelve
  a consultar las otras fuentes que ya respondieron correctamente.
- El contador de pacientes mide lecturas terminadas, no persistencias confirmadas.
  Después de la última lectura HHR muestra «confirmando datos clínicos» hasta el resultado
  autoritativo. Una respuesta idempotente sin escrituras es válida; una fuente que sigue
  fallando conserva la cobertura parcial y el reintento clínico, sin rehacer el censo.

Pruebas focalizadas: `deviceEvidenceNegotiation.test.ts`,
`patientClinicalBundleRuntime.test.ts`, `fichamedicoDeviceEvidenceRuntime.test.ts`,
`clinicalFillRunner.bundle.test.ts` y `rayenSyncBarViewModel.test.ts`, bajo
`src/tests/rayen-import/`. Usan datos sintéticos, no HAR ni credenciales.

La negociación añade un campo opcional al contrato y al relé. El baseline de tamaño
de esos dos archivos aumenta exactamente una línea por campo; no se amplían los límites
de funciones ni se introduce una excepción general. La compatibilidad queda cubierta por
las pruebas de opt-in explícito y cliente anterior.

En HHR, el historial separa resumen de ejecución, datos clínicos (incidencias por cama
y reporte técnico desplegable) y dotación Enfermería/TENS. `RayenSyncHistorySections.tsx`
es dueño de esos detalles; el modal conserva la lista y agrupación histórica. Las métricas
no modifican el resultado ni reemplazan la cobertura autoritativa.
La dotación muestra un estado breve y un único detalle cerrado por defecto; conserva
turnos afectados y firmas, sin párrafos repetidos ni desplegables anidados. En el censo,
la tarjeta Eloísa comparte la fila de dotación y se redistribuye cuando falta ancho.
Su altura permanece fija: el progreso usa el renglón de la última sincronización,
sin desplazar las acciones ni la tabla al iniciar una lectura.

## Archivos

| Archivo | Rol |
| --- | --- |
| `manifest.json` | MV3: permisos de host, content scripts (MAIN + ISOLATED), service worker |
| `inject-fichamedico.js` | MAIN world en Rayen: captura token, lee y **normaliza** al snapshot |
| `fichamedico-diagnosis-coding.js` | Resuelve por ID exacto el CIE-10 oficial de diagnósticos de ingreso sin codificación en el episodio |
| `fichamedico-normalization.js` | Normaliza los episodios y sus campos clínicos para HHR |
| `content-fichamedico.js` | ISOLATED en Rayen: relé background ⇄ mundo principal |
| `fichamedico-clinical-client.js` | Cliente read-only: valida la sesión, construye rutas relativas y centraliza GET JSON/PDF autenticados de Ficha Médico |
| `fichamedico-patient-context.js` | Contexto clínico read-only: caché de cabeceras, modelo normalizado de hospitalizados y revalidación de episodios activos |
| `eloisa-patient-code-contract.js` | Serializa en UTF-8 y agrega un checksum SHA-256 contra daños accidentales; el código no está cifrado ni autentica criptográficamente su origen |
| `fichamedico-manual-patient-copy.js` | Inserta una única acción “Copiar para HHR” en las listas dinámicas de Gestión de cuidados |
| `fichamedico-manual-patient-code-runtime.js` | Revalida el episodio y reúne cabecera y dispositivos mediante los lectores autenticados existentes |
| `hhr-ui.js` | Design system de la extensión: tokens (paleta navy/teal), iconos de trazo, estilos de la barra (Shadow DOM), tooltips y foco por teclado |
| `hhr-center-styles.js` | Estilos light-DOM del Centro HHR y sus avisos; reutiliza los tokens de `hhr-ui.js` |
| `hhr-vitals.js` | Parser de formularios `VITAL_SIGNS` de Ficha Médico + umbrales de alerta (port de HHR) para el módulo de signos vitales |
| `hhr-request-forms.js` | Formularios de solicitud (imágenes: overlays % + coordenadas PDF; laboratorio: catálogo de exámenes y HTML imprimible), port de HHR |
| `forms/` | Plantillas oficiales: PNG de vista previa y PDF de solicitud de imagen, encuesta de contraste y consentimiento informado |
| `prescription-print.js` | Reglas puras para episodio y agrupación de fármacos por profesional |
| `prescription-pdf.js` | Genera recetas con RUN del prescriptor y fecha/hora de emisión; la compacta total conserva el folio oficial |
| `jspdf.umd.min.js` | jsPDF vendorizado para generar el PDF dentro de la extensión |
| `pdf-print.js`, `print-pdf.*` | Abren la receta en el visor PDF de Chrome y activan el diálogo nativo de impresión |
| `runtime-loader.js` | Verifica que PDF y planillas hayan quedado registrados durante el arranque permitido por MV3 |
| `vendor-lock.json` | Versiones, licencias y SHA-256 de las librerías vendorizadas del paquete |
| `hhr-prescription-center.js` | Superficie de Recetas del Centro HHR: paciente actual, hospitalizados, selección e impresión repetible |
| `hhr-hospitalized-documents-center.js` | Superficie hospitalizada de Indicaciones |
| `hhr-scores-presentation.js` | Modelo puro de presentación de Scores: normaliza historiales y deriva valores, etiquetas y estados de acción |
| `hhr-lab-center.js` | Superficies de Laboratorio: consulta y análisis Syslab, solicitud imprimible y navegación entre ambos flujos |
| `hhr-connection-center-runtime.js` | Ciclo de vida del panel de conexiones y su badge: solicitudes vigentes, sondeo cancelable e invalidación al cerrar o cambiar de módulo |
| `hhr-connection-action-model.js` | Deriva una única acción contextual compartida por Ficha Médico y Gestión de Camas, sin duplicar el motor de reparación |
| `gestion-camas-connection-indicator.js` | Barra compacta de estado HHR en Gestión de Camas; muestra las tres fuentes y ejecuta conexión dirigida o reparación limpia |
| `gestion-camas-connection-indicator-bootstrap.js` | Monta la barra compacta sin acoplarla al relé clínico de Gestión de Camas |
| `content-prescription-print.js` | Orquesta el shell, navegación, contexto de paciente y montaje de los owners del Centro HHR |
| `background.js` | Coordina rutas, transforma respuestas para la UI y conecta los runtimes de Eloísa |
| `content-hhr.js` | ISOLATED en el HHR: relé página (puente) ⇄ background |
| `content-hhr-connection-repair.js` | Puente mínimo para invocar desde el censo el runtime seguro de reparación ya existente |
| `encounter-navigation.js` | Valida el episodio y construye la ruta segura para abrirlo en Ficha Médico |
| `health-check.js` | Comprueba relés activos en Ficha Médico/Gestión de Camas sin leer tokens ni datos clínicos |
| `gestion-camas-session.js` | Valida y reduce la sesión temporal de Gestión de Camas, incluida su expiración |
| `gestion-camas-runtime.js` | Conserva, verifica, renueva y desconecta la sesión temporal de Gestión de Camas; administra su ventana oficial de acceso |
| `clinical-panel-fetch.js` | Pagina estados farmacológicos y evita presentar fallas parciales como datos vacíos |
| `clinical-panel-runtime.js` | Lee y normaliza el historial, plan de cuidados, estados farmacológicos y validación vigente del panel clínico |
| `clinical-handoff-runtime.js` | Orquesta lectura, escritura verificada, recuperación e informe oficial de Entrega de turno |
| `clinical-score-runtime.js` | Reconcilia fuentes, lotes y formularios de lectura para CUDYR, Braden y Downton |
| `clinical-score-write-runtime.js` | Orquesta escritura verificada y recuperación de CUDYR, Braden y Downton |
| `lab-viewer.js` | Parser clínico y organización pura de comparación, alertas y tendencias |
| `syslab-bridge.js` | Navega la sesión oficial de Syslab y extrae/valida informes dentro de la red local |
| `pdf.min.mjs`, `pdf.worker.min.mjs` | PDF.js vendorizado para extraer el texto de informes sin servicios auxiliares |

## Instalar (modo desarrollador)

1. Abre `chrome://extensions`.
2. Activa **Modo de desarrollador** (arriba a la derecha).
3. **Cargar descomprimida** → selecciona esta carpeta `extension/`.
4. **Recarga la pestaña de Rayen** (`fichamedico.rayensalud.cl`) si ya estaba abierta — es
   necesario para que el capturador de token quede activo desde el inicio.

## Usar

1. Ten **abierta y con sesión iniciada** una pestaña de Rayen Ficha Médico, en cualquiera de sus rutas.
2. En el HHR (`localhost:3000` o `testinghhr.netlify.app`), abre el censo y pulsa
   **"Importar desde Rayen"**.
3. Según el modo (Configuración → Integraciones): se abre el **preview** para confirmar, o —en
   modo automático experimental— se aplica solo (salvo conflictos/egresos inferidos, que caen a preview).
4. En una fila sincronizada, el icono de enlace externo abre el episodio exacto en Ficha Médico.
   Reutiliza una pestaña existente cuando está disponible; esta acción es solo navegación y no escribe
   datos en Rayen.
5. El Centro HHR muestra la identidad de Ficha Médico y la disponibilidad independiente de Gestión de
   Camas. Esta última se conecta desde una ventana oficial de Rayen; su contraseña nunca pasa por la
   extensión y, una vez capturado el token temporal, la ventana se cierra automáticamente.
6. El botón de panel clínico de cada paciente sincronizado abre una vista en vivo con mundos
   Médico/Enfermería, entregas de turno, indicaciones y cuidados de enfermería.

La captura del censo admite tanto la lista médica como `encounter-list-nurse`. En la ruta de
enfermería, las lecturas de diagnóstico usan el identificador del profesional verificado en la sesión;
si falta o no es numérico, el snapshot se rechaza como incompleto en vez de informar éxito parcial.

### Indicaciones y recetas desde Gestión de cuidados

En todas las vistas de `fichamedico.rayensalud.cl`, la extensión agrega el **Centro HHR** con el logo
oficial del Hospital Hanga Roa. La barra detecta la altura real del encabezado de Eloísa y se ubica en el
extremo derecho de la primera franja gris, sin cubrir la segunda fila de navegación. Agrupa Laboratorio e
Imágenes en el menú accesible **Exámenes**, destaca el módulo abierto y puede contraerse a un acceso HHR;
la preferencia queda guardada solo en Chrome. Tras cuatro segundos sin interacción reduce su presencia
visual, excepto cuando hay foco, un menú abierto o una conexión fuera de línea. En pantallas pequeñas se
convierte en un control flotante para no cubrir la navegación.

### Visor de exámenes de laboratorio

- **Lab** está disponible al abrir un episodio clínico. Obtiene el RUN del encabezado oficial de
  Eloísa y consulta directamente `http://10.4.69.90/syslab/` desde el equipo conectado a la red
  local. No requiere levantar un scraper ni otro servicio.
- La búsqueda muestra los informes por fecha, hora, origen y examen. Permite filtrar, seleccionar
  varios, abrir el PDF autenticado y analizar hasta 24 informes por operación.
- El análisis conserva las capacidades centrales del visor HHR: tabla longitudinal por variable,
  referencias y alertas fuera de rango, tendencias numéricas con cada valor rotulado, vista completa
  por informe y copia tabulada para uso clínico.
- La primera consulta abre la ventana oficial de Syslab. El usuario inicia sesión directamente allí
  —puede usar el gestor de contraseñas de Chrome— y vuelve a pulsar **Actualizar**. La extensión no
  lee, guarda ni distribuye la contraseña.
- Las rutas internas permanecen únicamente en `chrome.storage.session`, ligadas al episodio, RUN y
  lote temporal de 15 minutos; la interfaz recibe solo metadatos e IDs de orden y nunca persiste
  resultados de laboratorio.
- Cada informe se lee con la sesión oficial, con límite de 6 MB y tiempo total. PDF.js extrae el texto
  localmente y el parser HHR organiza variables, referencias, alertas y tendencias.
- La extensión confirma el cuerpo del RUN tanto en la lista como en cada informe; cualquier
  discrepancia o informe fallido cancela el lote completo para evitar presentar datos parciales o de
  otro paciente.
- El portal institucional actualmente está publicado por Syslab mediante HTTP dentro de la LAN. La
  extensión usa exactamente esa ruta oficial y no expone los datos fuera del equipo, pero HTTP no
  aporta cifrado frente a otros actores de la red. Debe utilizarse solo en la red clínica controlada;
  habilitar HTTPS en Syslab sigue siendo la corrección de infraestructura recomendada.

En la sección **Solicitud de examen** de un episodio médico o de enfermería se agrega además
**Imprimir selección (2–3 órdenes)**. La acción vuelve a solicitar cada Jasper oficial, extrae y valida sus
campos clínicos y genera una solicitud nueva y compacta: identificación, diagnóstico y establecimiento
aparecen una sola vez, mientras cada folio, código y examen conserva su trazabilidad. Los profesionales
se deduplican y cada folio permanece identificado en su bloque. Los botones individuales de Eloísa permanecen
disponibles y ninguna orden ni estado clínico se modifica.

### Conexión temporal con Gestión de Camas

El módulo **Conexiones** permite abrir `hospitalizado.rayensalud.cl` en una ventana oficial y
temporal. El usuario autentica directamente en Rayen —idealmente mediante el gestor de contraseñas de
Chrome— y la extensión conserva en `chrome.storage.session` un registro temporal con el token de acceso
y los metadatos mínimos de sesión necesarios para validarlo y mostrar su estado (`apiBase`,
establecimiento, fechas de captura/verificación, expiración e identidad derivada). Si el token incluye
expiración, el panel muestra su vigencia y advierte cuando está por vencer. La ventana creada por
la extensión se mantiene abierta después de verificar la sesión: el contrato de sincronización exige
un puente vivo tanto en Gestión de Camas como en Ficha Médico. Cerrarla interrumpe esa condición,
aunque todavía exista un token temporal. No se declara una conexión sana solo porque el token siga
almacenado. **Olvidar** elimina la sesión de la extensión.

La comprobación activa mantiene el chequeo de expiración y de respuesta de las pestañas; no renueva
credenciales ni prolonga artificialmente una sesión vencida. La recuperación de capacidades para
leer evidencia clínica reintenta una comprobación transitoria fallida y usa el presupuesto de
sincronización existente. Una respuesta ausente no equivale a «extensión incompatible».
Los relés aislados admiten reinyección sin registrar dos veces sus escuchas.

### Estabilidad y reactivación de la conexión

El estado de conexión se sostiene sobre seis reglas. Cambiarlas rompe la estabilidad, así que
`src/tests/rayen-import/rayenConnectionTimingContract.test.ts` fija la relación entre los tiempos
(no sus valores exactos, que se pueden ajustar mientras las desigualdades se cumplan).

1. **Una pestaña sana por fuente basta.** Las pestañas que coinciden con el patrón se sondean
   **en paralelo** y gana la primera lista por orden de preferencia (activa, luego la más reciente).
   No importa cuántas pestañas de Ficha Médico o de Gestión de Camas estén abiertas: la espera total
   es un único tiempo de espera y no uno por pestaña, de modo que una pestaña lenta o colgada no
   puede agotar el presupuesto de las demás. Ficha Médico conserva su preferencia por la pestaña que
   publica vigencia.
2. **El presupuesto de espera nunca es menor que el del sondeo.** La aplicación concede al
   diagnóstico pasivo al menos el doble del presupuesto de una fuente, porque la extensión consulta
   dos. Pedirlo con menos margen convertía una respuesta normal en un falso «desconectado».
3. **Un sondeo perdido no es una desconexión.** Mientras el último diagnóstico bueno siga dentro de
   su arriendo de confianza, se conserva y se reintenta en segundo plano. El arriendo cubre al menos
   dos latidos completos. Esto no prolonga ninguna credencial ni inventa salud: un informe que sí
   llega manda siempre —incluido uno que reporte una fuente bloqueada— y el corte real lo sigue
   declarando el vencimiento del arriendo.
4. **La reactivación es automática y activa.** La página reintenta sola con espera creciente hasta
   recuperar, sin que el usuario tenga que enfocar la pestaña ni pulsar nada, y siempre alcanza a
   intentarlo varias veces dentro de la ventana de confianza. En paralelo, la extensión empuja su
   estado por latido periódico y ante cada transición de sesión.
5. **Una transición invalida también los sondeos en curso.** El push de latido limpia la caché antes
   de leer el nuevo estado. Si una comprobación anterior termina tarde, su resultado no repuebla la
   caché ni se publica sobre el diagnóstico posterior. Así, abrir,
   cerrar, recargar o cambiar de pestaña fuente no puede restaurar durante unos segundos un estado
   que ya quedó obsoleto.
6. **Los receptores conservan el orden de publicación.** Cada push recibe un contador monotónico
   persistido en `chrome.storage.session`. HHR, Ficha Médico y Gestión de Camas recuerdan el último
   contador aplicado y descartan duplicados o mensajes anteriores. Esto cubre el caso en que un
   `tabs.sendMessage` antiguo ya había comenzado y termina después de una transición más nueva.

Al instalar, actualizar o recargar la extensión, los relés de las pestañas ya abiertas quedan
huérfanos. `relay-reinjection-runtime.js` los vuelve a inyectar desde el arranque del worker y empuja
el estado fresco de inmediato; una marca en `chrome.storage.session` impide repetir esa reparación
en cada despertar normal del worker. Cada relé nuevo reclama la propiedad de su mundo ISOLATED y
deja inertes los listeners supervivientes antes de atender mensajes. La
generación de la sesión se conserva durante una actualización compatible y los lectores de mundo
MAIN negocian un protocolo independiente de la versión del paquete. Así Ficha Médico, Gestión de
Camas y HHR recuperan la comunicación sin recargar ni duplicar interceptores. Un cambio futuro que
rompa el protocolo seguirá fallando de forma cerrada y pedirá abrir un documento nuevo.

**Límite deliberado:** se sigue exigiendo al menos una pestaña viva por fuente. Un token guardado sin
página que lo respalde no prueba que Rayen siga aceptando la sesión, y mostrarlo como «conectado»
engañaría justo antes de que la sincronización falle.

Cuando la vista tiene un episodio activo, **Recetas** abre primero **Paciente actual**. Desde listas,
paneles u otras rutas sin episodio abre directamente **Hospitalizados** y deja deshabilitada la pestaña
del paciente actual. Los accesos contextuales de Indicaciones y Receta médica se mantienen solamente en
la tabla de fármacos de Gestión de cuidados.

### Alertas de la ficha en el censo (0.48.72)

El responsable pidió ver en el censo diario las **Alertas** de la ficha de hospitalizados. El
paquete clínico por paciente agrega una cuarta lectura, `entrySummary/alertEntry`, la misma que usa
el panel de Ficha Médico. Solo se lee para el día clínico en curso y entrega únicamente los campos
que HHR guarda o necesita para distinguir una nota vigente. Si falla, HHR conserva las alertas que
ya tenía. Una extensión anterior no las envía y HHR sigue sincronizando igual.

### El ZIP de auditoría se guarda donde la persona elige (0.48.71)

El responsable pidió buscar primero y después elegir dónde guardar el ZIP; Chrome lo guardaba solo
en Descargas al terminar la búsqueda. Si la pantalla lo pide (`saveInPage`), el relé ya no hace clic
en un enlace de descarga: une las partes y entrega el Blob a la pantalla, que ofrece «Descargar ZIP»
con el diálogo de guardado del sistema. Una pantalla anterior, que no lo pide, sigue recibiendo el
ZIP en Descargas.

### Tramos que Eloísa no entrega, por mitades (0.48.70)

El 03-11, dos historiales de septiembre que cruzan el 06-09 no se descargaron en ninguna de cuatro
corridas: Eloísa cortó la conexión («Failed to fetch») al pedir uno de los tramos alrededor del
día del cambio de hora. Ahora un tramo que falla por conexión o por error del servidor se pide en
mitades, hasta llegar a días sueltos. Un día que Eloísa sigue sin entregar se rehace igual que el
06-09: con el Resumen diario oficial y un anexo HHR, y el resumen lo nombra «Eloísa no entregó su
historial». Hay dos límites por intento: 20 pedidos de tramos y 3 días rehechos; si se superan, el
documento queda como no descargado, igual que antes. Cada pedido repite el avance, para que HHR
siga esperando.

### Cada campo del anexo con su propio reloj (0.48.69)

El JSON del historial no usa una sola zona horaria. Lo medí campo por campo el 02-11 contra el
historial oficial, que imprime hora de Rapa Nui, en 52 días-hospitalización (azar 2,7 %):

| Campo | Coincide con el oficial | Se lee como |
| --- | --- | --- |
| Etiqueta de escalas | −2 h en 100 % de 507 | continental |
| Evoluciones | −2 h en 66 % de 218 | continental |
| Registro de administración | −2 h en 56 % de 194 | continental |
| Diagnósticos, indicaciones generales | −2 h en 38–44 % | continental |
| Entregas de turno | −2 h en 31 % de 13 | continental |
| Signos vitales | sin cambio en 66 % de 2.001 | Rapa Nui |
| Hora real de administración | sin cambio en 281 de 281 (reporte farmacológico) | Rapa Nui |
| Indicaciones de medicamentos | el oficial no la imprime | UTC, como el centro de recetas |

La 0.48.68 convertía todo como continental, de modo que dejaba los signos vitales 2 h antes y las
indicaciones de medicamentos 3 h después. Los registros se siguen eligiendo por la fecha que les
puso Ficha Médico, que es la que usa el servidor para cortar sus tramos.

### El día del cambio de hora, reconstruido (0.48.68)

Entre los dos tramos, el historial unido lleva ahora, por cada día que el servidor no genera:

1. El **Resumen diario del paciente** oficial de ese día (`api/report/Resumen_diario_paciente.pdf`,
   otro motor de informes, que sí lo genera). Trae signos, indicaciones, medicamentos, dispositivos
   y riesgos, pero no evoluciones.
2. Un **anexo HHR no oficial** (`audit-day-annex.js`) que reproduce sin resumir los registros de
   ese día desde el historial clínico JSON de Ficha Médico: evoluciones, entregas de turno,
   administración de medicamentos, signos, escalas, indicaciones, dispositivos y exámenes.

Medido el 02-11: el JSON escribe sus horas en hora continental y sin desfase, y el anexo las
convierte a Rapa Nui, igual que el PDF oficial. La hora real de administración se muestra tal cual,
porque el reporte farmacológico oficial la imprime así en el 100 % de los casos comparados. Si falta
el resumen o el anexo, el historial se arma igual y el nombre y `00 Resumen.csv` dicen qué faltó.

### Historial que cruza el cambio de hora (0.48.67)

Medido contra Eloísa el 02-11: `GetHospitalizedEncounterHistory` responde HTTP 500 a cualquier
periodo que incluya el 06-09-2026, el día en que Chile continental se saltó la medianoche al pasar a
horario de verano. Ningún formato de fecha lo evita, y la pantalla Informes de Eloísa envía la misma
petición, así que también falla ahí. Un periodo que termina el día anterior a las 23:59:59 y otro que
empieza el día siguiente a las 00:00 sí se generan. Por eso, si el historial completo falla y la estadía
cruza un día así, `audit-history-segments.js` lo pide en tramos que lo esquivan y los une con pdf-lib.
El archivo y `00 Resumen.csv` dicen qué día falta, porque ese día no se puede obtener. Los días se
calculan con la zona de Chile continental, que es la que usa el servidor de informes, y no con fechas
fijas. Lo corrige de fondo Rayen.

### Reintento de informes de auditoría (0.48.66)

En la primera descarga real (17 RUT), el servidor de informes de Eloísa respondió HTTP 500 a 5 de
los primeros 6 historiales, todos de estadías largas, y después entregó estadías igual de largas.
Ahora un error del servidor o de conexión se reintenta al final, de a uno, hasta dos veces más con
una pausa. Un rechazo de sesión no se reintenta. Lo que siga sin bajar queda en `00 Resumen.csv`
con el número de intentos.

### Documentos para auditoría (0.48.65)

HHR entrega una lista de hasta 20 RUN, con fechas globales o por RUN, y la extensión descarga un ZIP
con el historial de hospitalización y el reporte de cuidados farmacológicos de Eloísa, un PDF por
hospitalización. Busca en ambos índices de informes, porque el del historial omite la
hospitalización en curso, y filtra por el día de Rapa Nui. El ZIP viaja por partes de 4 MB al relé de la
pestaña HHR, que lo une como Blob: una URL `data:` de varios MB no es confiable en Chrome. Desde 0.48.71
el relé entrega ese Blob a la pantalla, que lo guarda donde la persona elige; antes lo guardaba solo
en Descargas. Una lista que Eloísa no entregó
se informa como falla de ese RUN, nunca como «sin hospitalizaciones», y una hospitalización sin
fecha o RUT verificable se cuenta aparte para revisarla en Eloísa. Solo entra el RUN propio: un
recién nacido con el RUN de la madre es otra persona. El ZIP incluye `00 Resumen.csv` y solo llega
al documento HHR que lo pidió. Se detiene, aunque sus partes ya estén viajando, si cambia la sesión
HHR, si se cancela o si la pantalla se rinde por tiempo. Máximo 100 documentos por descarga.

### El permiso termina con la sesión HHR (0.48.64)

Cambiar la generación de sesión HHR revoca en silencio los permisos de episodio de esa pestaña,
incluso al despertar el worker. Una captura o consulta de egreso iniciada antes del cambio no puede
reconcederlos: hace falta una nueva captura. La sesión compartida de Eloísa no cambia.

### El código de traspaso usa la hora de Rapa Nui (0.48.63)

Eloísa puede entregar el ingreso con hora continental. El código de traspaso copiaba esa hora sin
convertirla, y un ingreso de madrugada quedaba con otro día y otra hora. Ahora una hora con desfase se
convierte a Rapa Nui; una sin desfase ya es local y no cambia.

### El catálogo de diagnósticos dura 12 horas (0.48.62)

El catálogo CIE-10 casi no cambia, pero se volvía a leer tras una hora. Como las sincronizaciones suelen
estar separadas por horas, la mayoría pagaba de 4 a 5 s. Una clasificación nueva en Eloísa puede tardar
hasta 12 horas en mostrar su código en una pestaña ya abierta; recargar Ficha Médico lo actualiza.

### El permiso de lectura sobrevive al reposo (0.48.61)

El service worker se duerme a los pocos segundos sin actividad y perdía los permisos de lectura por
episodio mientras una persona revisaba la propuesta. HHR tenía que repetir la captura completa. Ahora
el permiso se conserva en `chrome.storage.session`, con los mismos 5 minutos y por pestaña y episodio.
Ese almacenamiento vive en memoria, se borra al cerrar Chrome y no es accesible para los content scripts.

### Una sola captura por sincronización (0.48.60)

Al reiniciarse, el service worker reinyecta los puentes de la página de HHR. Siete de ellos sumaban
un escuchador en cada reinyección, y cada sincronización lanzaba capturas duplicadas. El permiso de
lectura del episodio solo se registraba al terminar la última, y HHR ya estaba leyendo con la primera.
Ahora cada puente reemplaza su escuchador anterior.

### Centro compacto de Eloísa (0.48.59)

El inicio y la navegación ofrecen **Recetas**, **Laboratorio** e **Imágenes**, junto con
**Sesión**. El acceso **Abrir HHR** permanece en el encabezado para abrir el censo y el
registro clínico completo. La barra flotante conserva Recetas, Exámenes, favoritos y sesión.
El inicio usa tres tarjetas equivalentes y una altura acotada; la navegación móvil distribuye
sus cinco accesos sin huecos.

Los módulos de Entrega de turno, Signos vitales y Scores se retiraron de la interfaz inyectada:
se eliminaron sus controladores, declaraciones de carga, iconos, estilos y todos sus accesos.
También se retiraron el documento Reg + BRADEN y su diálogo rápido. Los protocolos clínicos
del puente usados por HHR y las protecciones persistidas de guardados anteriores conservan
su contrato; no se borran registros ni se vacían protecciones al actualizar la interfaz.

**Indicaciones**, dentro de Recetas, permite seleccionar uno o varios hospitalizados y reunir
sus `Reporte_Indicaciones_Paciente.pdf` oficiales en un solo PDF. La selección caduca a los
30 minutos y se valida nuevamente antes de imprimir.

### Horario de emisión de recetas

El historial de farmacia entrega `PUBLISH_DATETIME` ISO en UTC, también cuando omite el sufijo.
Se explicita esa zona en el límite de lectura de las indicaciones y se presenta el instante con
`Pacific/Easter`. Los valores que ya traen `Z` u offset se respetan; los textos clínicos de fecha
legible conservan su hora local. La fecha calendario de la receta usa el mismo reloj, incluido
el cruce de medianoche. Pantalla e impresión consumen la misma normalización.

La zona IANA resuelve los cambios de horario estacional: no se resta un número fijo de horas.
Ejemplo sintético: `2026-10-29T15:34:00` se presenta como `29-10-2026 10:34`.

### Impresión de recetas e indicaciones

1. Abre un paciente desde **Gestión de cuidados** y entra a **Resumen → Indicaciones
   (Medicamento)**.
2. Junto a **Mostrar Suspendidos** aparecen dos acciones diferentes:
   - El icono de documento, titulado **Indicaciones**, descarga el informe general que puede incluir
     fármacos, indicaciones libres, reposo y régimen.
   - El icono de impresora, titulado **Receta médica**, abre el panel de selección.
3. Elige **Receta completa** para imprimir el mismo Jasper oficial que usa el botón médico, o elige
   un profesional para incluir exclusivamente sus fármacos activos.
4. Elige el formato **Estándar** o **Compacta**. El segundo conserva el contenido de la receta
   seleccionada y solo reduce márgenes, tipografía y altura de filas, con un máximo de 22 fármacos
   por hoja para mantener una lectura clínica cómoda.
5. La receta por profesional se genera sin folio, identifica al prescriptor y su RUN, conserva la
   fecha/hora de emisión y la última validación, y deja el espacio de firma manual.
6. Si Eloísa marca uno o más fármacos como **Externos**, el panel crea una opción independiente por
   cada `MRE_ID` activo. Esa impresión contiene solamente el medicamento seleccionado, conserva fecha,
   hora, prescriptor y RUN, y se rotula **Receta médica externa**. La receta completa oficial continúa
   disponible y mantiene el contenido combinado que entrega Eloísa.
7. La receta compacta total se deriva del mismo PDF oficial: conserva encabezado, datos del paciente,
   orden y hora de cada fármaco, columna de despacho, prescriptor, RUN, fecha, folio e impreso por.
8. Todas las recetas se abren en el visor PDF de Chrome con el diálogo nativo de impresión.
9. Al volver del diálogo de impresión, el panel y el acceso contextual siguen disponibles para
   imprimir otra selección sin recargar la ficha.

La pestaña **Hospitalizados** del mismo panel permite buscar y seleccionar uno, varios o todos los
pacientes con fármacos activos. Cada fila informa cama, paciente, RUN, cantidad de fármacos,
prescriptor y fecha/hora de su última validación disponible. La extensión genera las recetas vigentes
elegidas, inicia cada paciente en una página nueva y las consolida en un solo PDF y un solo diálogo de
impresión. Los pacientes sin fármacos activos o cuya receta no pudo consultarse permanecen visibles,
pero no se pueden seleccionar. La selección caduca a los 30 minutos y se valida nuevamente dentro de
la extensión antes de imprimir.

La receta completa sigue siendo el reporte nativo `Reporte_Receta_Medica.pdf`. Para las recetas por
profesional, la extensión agrupa los fármacos activos por `HCP_NAME` y deduplica cada indicación por
`MRE_ID`; el PDF por profesional se genera localmente y no agrega folio. La fecha de validación se cruza
con `/api/encounter/validateTreatment/{encId}` para el mismo profesional y conserva como respaldo la
última fecha y hora asociadas a ese autor en el historial. El folio y la hora de emisión se leen del PDF
oficial vigente. Si Eloísa responde 401/403, se informa que el perfil
actual no está autorizado; la extensión no intenta eludir esa autorización.

## Requisitos y notas

- Chrome 118+. La extensión fija PDF.js 5.5.207, anterior al rango afectado conocido y todavía
  compatible con el build `legacy` validado para leer informes Syslab. Antes de distribuir una
  versión que eleve este mínimo, confirma que todos los equipos clínicos usan Chrome 118 o superior:
  Chrome deja silenciosamente sin futuras actualizaciones a instalaciones que permanezcan bajo el
  valor de `minimum_chrome_version`.
- Debe existir **una pestaña de Rayen abierta y logueada**; si no, el HHR muestra el error
  "No hay una pestaña de Rayen abierta".
- El token se captura de las llamadas que hace la propia app de Rayen. Si acabas de instalar la
  extensión, **recarga Rayen** para que el capturador esté activo antes de la primera lectura.
- La escritura al censo la hace el HHR con **tu sesión de Firebase** (rol `nurse_hospital`/`admin`);
  la extensión no toca Firestore ni almacena credenciales.

## Verificación

- `npm run check:rayen-extension-release` valida Manifest V3, Chrome 118+, recursos declarados,
  permisos de host, sintaxis de todos los scripts, integridad SHA-256 de los vendors, el origen
  `legacy` de PDF.js y que PDF/XLS se registren durante la evaluación inicial del service worker,
  sin `importScripts()` tardío prohibido por Chrome.
- El núcleo de lectura+normalización se probó contra datos reales de Rayen y produce un
  `RayenCensusSnapshot` con apellidos separados, RUN, cama, diagnóstico principal, CIE-10 e
  `isComplete`.
- La sintaxis de los scripts operativos pasa `node --check`.
- `npm run test:e2e:rayen-extension-upgrade` comprueba en Chromium aislado la actualización
  descomprimida 0.48.33 → 0.48.34 con las tres pestañas abiertas; al publicar una versión nueva,
  actualizar el commit de origen y la versión anterior esperada en el smoke.
- El protocolo v3 minimiza el historial, los estados de medicación y el plan de cuidados antes de
  cruzar hacia HHR; el contenido del panel sigue siendo efímero y de solo lectura.

## Pendiente / a confirmar con datos reales

- Antecedentes (v0.48.40): el panel HHR consulta HCC de forma efímera y resuelve la identidad
  desde el episodio. La primera consulta cubre 35 meses; «Cargar período anterior» permite
  recorrer ventanas contiguas de hasta 35 meses hacia atrás (hasta 1900), sin enviar una
  solicitud de tres años completos que provoque el rechazo HCC 20. Cada período se solicita
  a demanda para no multiplicar lecturas clínicas; el detalle de períodos antiguos se abre
  al pulsarlo. La fuente secundaria espera hasta 15 segundos, igual que la ambulatoria, y
  una respuesta parcial indica qué falta y permite reintentar sin borrar la otra fuente.
  El detalle ambulatorio se
  valida contra el listado del mismo paciente. Las evoluciones ambulatorias parten desplegadas,
  sobreviven al cambio de pestaña y sólo las atenciones nuevas se completan en segundo plano. Los
  adjuntos combinan el contenedor, `PathAzure` y la firma dentro de la extensión, sin entregar la
  URL temporal a HHR. El contrato se contrastó con una captura y una ficha del entorno de prueba;
  falta confirmar variantes de atenciones secundarias. Los antecedentes sólo se conservan en la
  memoria de la pestaña para evitar recargas visibles; no se persisten ni se envían URLs firmadas
  a HHR/Firestore.
- El permiso exacto `https://saludteintegrachileapi.rayensalud.cl/*` habilita las lecturas del visor
  HCC. Owner: runtime de Antecedentes; rollback: retirar la pestaña, ruta y permiso en conjunto.
  La línea base registra únicamente los módulos nuevos de lectura y detalle/adjuntos;
  los presupuestos de archivos existentes no aumentan.

- Cómo aparece un paciente **CMA** en el encounter API (servicio/cama) — el `bedMapping` lo maneja por
  prefijo `CMA`, pero conviene verlo con un caso real.
- La representación de un **egresado** (alta / CMA / traslado) — la pestaña de egresos estaba vacía.

## Recuperación de conexión (0.48.25)

Ver [diagnóstico, política de recuperación y matriz de regresión](../docs/extension-connection-resilience.md) para múltiples pestañas, sesiones prolongadas y actualización del puente.
La transición a protocolo MAIN 1 conserva lectores 0.48.25 y 0.48.26 solamente cuando
pertenecen a la generación confiable de la instalación. Desde 0.48.34 esa generación se
conserva en `chrome.storage.local` sin guardar credenciales; `storage.session` sigue guardando
los tokens temporales. En una migración sin copia local, si las pestañas supervivientes discrepan,
la recuperación falla cerrado y exige documentos nuevos.

## Día calendario antes del relevo (0.48.26)

- Antes de las 08:00 en días hábiles o 09:00 en días inhábiles, la captura acepta tanto el día
  clínico todavía activo como el nuevo día calendario creado manualmente en HHR.
- La captura sigue invalidándose si cruza la medianoche o el relevo de enfermería, para no mezclar
  evidencia perteneciente a dos contextos temporales.

### Descargar desde HHR (instalación manual)

La barra Eloísa ofrece el ZIP de la extensión incluida en esa publicación de HHR,
con la versión detectada y la disponible. El aviso ámbar no bloquea una extensión
antigua compatible; las protecciones de compatibilidad siguen vigentes. Descargar
no actualiza Chrome: reemplazar el contenido de la carpeta instalada, recargar la
extensión en `chrome://extensions` y recargar HHR/Eloísa. Esperar a que termine una
sincronización activa. El aviso sólo desaparece cuando el reporte detecta la nueva versión.

Vite sirve el mismo paquete en desarrollo y lo emite en `dist/downloads/` al ejecutar
`npm run build`, por lo que Netlify lo publica como archivo estático del mismo origen.
La versión procede del manifest y el nombre incluye un hash del ZIP. No requiere backend,
permisos adicionales ni compresión en el navegador; no se precarga en el service worker.
El empaquetado incluye código raíz y recursos explícitos del manifest, excluyendo HAR,
archivos locales y documentación. El release gate valida sus dependencias.
`fflate` 0.8.2 se declara como dependencia de desarrollo (ya era transitiva): sólo comprime
al generar el artefacto. Responsable: mantenimiento HHR. Riesgo: distribución incompleta;
control: prueba de ZIP, release gate y descarga en dev/build. Rollback: revertir este PR.

### Antecedentes APS y UEA (v0.48.42)

Desde v0.48.79, las consultas de resúmenes y detalles HCC envían en `Authorization`
`VHCC-TICKET <TokenSesion>`, con el token obtenido por `/api/ObtenerToken`, como hace
el visor original. La versión 0.48.78 enviaba el token sin este esquema y seguía
recibiendo HTTP 401.
El lector HTTP autenticado conserva el token en un cierre propio del historial
efímero verificado por paciente, episodio y autorización, dentro de
`clinical-antecedents-transport.js`; no lo comparte como estado global ni lo envía a HHR.
La actualización conserva los permisos existentes y requiere recargar la extensión.

Desde v0.48.80, el lector incorpora también `ResumenHistorial.ResumenHistorial` de
la fuente secundaria y sus identificadores alfanuméricos. Consulta sus detalles con
`IdAtencion`, establecimiento y `Key`, y verifica `XMLDetalleHistoria`, episodio y
RUT antes de mostrarlos. La caché distingue las fuentes aunque coincida el número
de atención. El resumen de la fuente se presenta como texto; hospitalización conserva
su etiqueta. No se necesitan permisos nuevos ni una sesión directa de Urgencias.

HCC puede rotular ambas atenciones como APS. Tras verificar episodio, RUT y sesión, el
lector clasifica como UEA únicamente un formulario `Examen Fisico Urgencia` o
`Examen Físico Segmentario Urgencia` (normalizando acentos y espacios). El texto libre
no clasifica el episodio. Se conservan los formularios distintos aunque tengan igual nombre.

La proyección efímera muestra motivo, enfermedad actual, todos los diagnósticos e
indicaciones. UEA añade los exámenes físicos; APS añade las recetas y sus descripciones
completas, agrupadas por número. No se exportan actividades ni otros formularios, y las
URLs firmadas de adjuntos permanecen en la extensión. No hay escrituras en Eloísa ni HHR.

La descarga con icono genera una **copia PDF de las prescripciones registradas**, con
paciente verificado, profesional, fecha, centro y número de receta. No afirma ser el
PDF original firmado del visor; no modifica dosis ni crea una indicación nueva. El
runtime PDF se carga sólo al solicitarlo. Cerrar el panel cancela una descarga pendiente.

Las versiones anteriores siguen mostrando su detalle básico; actualizar manualmente
la extensión a 0.48.42 permite ver los campos nuevos. El ZIP se genera desde los mismos
archivos para localhost, preview y Netlify; no requiere permisos de host adicionales.
Validación: fixtures ficticios para singleton/listas/0, clasificación, contrato del bridge,
identidad/sesión, copia PDF multipágina y prueba de navegador APS/UEA con descarga por teclado.

La espera de la fuente secundaria es de 45 segundos: una respuesta válida observada
superó los 33 segundos. Primaria y detalles mantienen 15 segundos. Un fallo real o
vencimiento sigue notificando cobertura parcial; no se interpreta como ausencia de
antecedentes. El estado parcial ocupa una tarjeta discreta con el motivo desplegable
y reintento explícito. Se eliminan sólo exámenes con igual nombre normalizado e igual
conjunto de etiquetas/valores; distintas fechas o mediciones permanecen visibles.

La caché breve empieza sus 30 segundos de vigencia **al terminar la lectura**, no
al iniciarla. Una respuesta secundaria lenta no expira mientras todavía está en vuelo,
y los detalles posteriores reutilizan el mismo historial validado en vez de volver a
pedirlo inmediatamente. Los fallos y cambios de autorización conservan su invalidación.
Los detalles pueden reutilizar durante esos 30 segundos un listado parcial ya
verificado: no vuelven a bloquearse por la fuente que falló. Un reintento explícito
del listado vuelve a consultar las fuentes pendientes, manteniendo la información
previa visible. Las lecturas simultáneas continúan compartiendo la solicitud en vuelo.

## Captura permanente CUDYR (0.48.46)

La respuesta compartida agrega IDs de autor/rol, token de versión y observaciones
anuladas (`isDeleted`), separadas del resultado clínico vigente. Conserva episodios
observados sin evaluaciones y distingue metadatos incompletos. HHR archiva estas
capturas durante la sincronización; abrir el reporte o descargar Excel no consulta
Eloísa. Recargar manualmente la extensión y las pestañas conectadas para utilizar
el nuevo contrato; una extensión anterior conserva compatibilidad y se identifica
como cobertura desconocida. No acredita recuperación histórica completa.

El módulo `cudyr-capture-support.js` concentra el historial y lectura de metadatos
opcionales. Owner: sincronización HHR/Eloísa. Su registro nuevo en el ratchet de
extensión no aumenta límites de archivos existentes ni admite hotspots nuevos.

### CUDYR 0.48.47: cama y modalidad observadas

El historial captura además la asignación original de cama/servicio con su intervalo,
ID y versión. Los mapeos anidados antiguos se conservan como evidencia, sin anunciar
ocupación vigente. La fecha centinela de término no se interpreta como alta. El nuevo
helper `cudyr-placement-support.js` carga después de los normalizadores de camas/cunas.

### Puente 0.48.48: dominio publicado de HHR de pruebas

Se habilita `https://hhr-entorno-prueba.netlify.app` en los permisos, los content
scripts y las validaciones internas de origen. Se conservan localhost:3000,
localhost:3001 y testinghhr.netlify.app; no se habilitan otros sitios Netlify ni
previews. La autorización de cada episodio sigue ligada a su pestaña y snapshot.

Para aplicar: reemplazar el contenido de la carpeta de la extensión con el ZIP
0.48.48, recargar la extensión en Chrome y recargar HHR y las pestañas Eloísa.
El ingreso Google y el reconocimiento de la extensión son comprobaciones distintas.
Owner: integración HHR/Eloísa. Rollback: volver al paquete anterior; el dominio
hhr-entorno-prueba dejaría de enlazarse. Cierre: release gate, pruebas de los cuatro
orígenes y rechazo de dominios ajenos, smoke MV3 sintético y reconocimiento en Chrome.

### Puente 0.48.49: lectura CUDYR y evidencia de captura

El relé HHR conserva `captureContract`, `observedEpisodeIds` y `metadataStatus`;
una captura moderna no debe archivarse como una extensión antigua por perder esos campos.
Las lecturas de camas, autores y definiciones reintentan una vez errores de red,
HTTP 408/429 o 5xx. Un rechazo de autorización o una respuesta inválida siguen
informándose; un fallo persistente no se convierte en ausencia de CUDYR.

A las 22:41 del día D se recupera el historial previo: el CUDYR del turno D
corresponde a la mañana D+1. Una captura vacía válida no es un error y no
inventa un resultado para hoy. El archivo conserva la trazabilidad por episodio.
Actualizar la extensión cargada en Chrome y recargar HHR para activar este relé.

### Puente 0.48.50: egresos de madrugada

La búsqueda de episodios sin identificador usa el día del censo de enfermería de Rapa Nui
para timestamps con zona horaria. Un egreso ocurrido durante la madrugada pertenece
al turno previo; su fecha y hora oficiales se conservan. Si hay dos episodios candidatos,
la búsqueda sigue sin elegir uno automáticamente. No cambia permisos ni el protocolo.

En HHR, la reconstrucción de un episodio local puede completar metadatos de egreso
incompletos mediante el informe estadístico individual: exige episodio exacto, RUN,
intervalo completo y fecha/hora coincidente al minuto. Una marca administrativa negativa
y los traslados sin ubicación comprobada siguen requiriendo revisión.

### Errores de formularios · 0.48.53

Las respuestas individuales de escalas y la sección `forms` del paquete clínico incluyen
un `errorCode` estable además del mensaje `error` existente. HHR anterior puede ignorar
el campo adicional; HHR actualizado admite extensiones anteriores sin ese campo.
El contrato y la recuperación compatible se documentan en
[`rayen-import`](../src/features/rayen-import/README.md#códigos-estables-de-errores-de-lectura).
El módulo `clinical-read-error-contract.js` se carga antes del cliente de Ficha Médico.
No cambian permisos, vigencia de autorización, escrituras ni reglas de CUDYR.

### Recuperación acotada de captura (0.48.55)

La captura conjunta permite una sola segunda lectura por fuente ante un error de red
rápido (fallo recibido y salud comprobada dentro de los primeros 10 s). Reutiliza la
fuente que ya respondió, verifica la salud sin caché y conserva las comprobaciones
de establecimiento, desfase y corte temporal. No repite permisos rechazados, sesión
vencida, datos parciales ni timeouts. La cancelación impide iniciar el reintento y
descarta cualquier resultado tardío. Los contadores del historial incluyen estas
segundas lecturas. Las conexiones mostradas en el historial son las del inicio del
intento: un fallo de red posterior no demuestra una sesión vencida.

### Diagnóstico de informes y unidades (0.48.56)

El puente identifica orden/fecha ante un fallo de lectura y distingue sesión vencida,
RUN distinto y encabezado no verificable. Se conservan los controles de identidad:
todos los encabezados de paciente deben coincidir; no basta la primera página.
El parser elimina separadores de columna al separar unidad y referencia, sin alterar
valores, escalas ni comparadores. No cambian hosts, permisos, sesión ni CUDYR.

### DAU oficial y antecedentes compactos · 0.48.81

«Descargar DAU oficial (PDF)» está disponible en las urgencias de la fuente primaria.
HCC verifica el paciente y la atención antes de delegar la lectura en una pestaña HTTPS
principal de `https://urgencia.saludenred.cl/Emergency/` con sesión iniciada. El permiso
nuevo `https://urgencia.saludenred.cl/*` permite esa ejecución; no se inyectan scripts
en pestañas PDF/blob ni se amplía el permiso al API de Urgencias.

El lector usa `API.ADMISSIONS.BY_IDENT`, `EmergencyAdmissionService.newResource`,
`DAUReport` y `$http` del cliente oficial. Sólo ejecuta GET. Exige un único registro
con RUN y `PatientCare.Id` exactos, centro igual al de la sesión activa, relaciones paciente/admisión consistentes y un
DAU_C.pdf del mismo establecimiento, admisión y atención. Comprueba dueño de sesión,
contenido PDF y autorización hospitalaria antes de descargar. No copia credenciales,
no persiste datos clínicos y no entrega el PDF ni enlaces de acceso a la página HHR.
Si Urgencias no está abierto, el botón explica que debe iniciarse esa sesión.
Los DAU con identificadores secundarios opacos quedan fuera de este contrato: no se
elige una atención por cercanía de fecha. Owner: `urgency-dau-runtime.js`; rollback:
retirar su import, acción `dau`, botón y permiso juntos.

El panel reduce separaciones y rellenos, manteniendo todos los campos visibles.

### Atención histórica completa antes del DAU · 0.48.82

La búsqueda histórica puede devolver `PatientCare` con `IsEmergency=false` y
relaciones en cero aunque la atención exista. Igual que el modal oficial de Rayen,
el lector ejecuta `PatientCareService.loadFull(admission, true)` antes de comprobar
los vínculos y generar el DAU. Conserva el RUN y la atención exactos del listado y
los identificadores originales de paciente/admisión; un cambio durante la carga se
rechaza. Toda la lectura comparte el límite de 60 segundos y verifica de nuevo la
sesión. El adaptador de página vive en `urgency-dau-page.js`, cargado antes del runtime.

El DAU pregunta dónde guardar el PDF (`saveAs=true`) para que el usuario elija un
destino explícito. Los demás informes mantienen su descarga habitual por defecto.
No cambian permisos, no se copia el token y no se persiste el contenido en HHR.

### Sesión personal Exalab · 0.48.85

HHR puede abrir `exalab-connect.html` desde su módulo Laboratorio. La página explica
la vinculación personal y solicita `cookies` y el host Exalab como permisos
opcionales, únicamente tras pulsar Conectar mi sesión. Solo lee las cookies
`PHPSESSID` y `cf_clearance` aplicables a Exalab y las entrega por HTTPS al gateway
HHR con un token de vinculación de cinco minutos y un solo uso. Nunca recibe una
contraseña ni envía cookies mediante `window.postMessage`, storage o logs.
El origen de destino se obtiene de la pestaña HHR autorizada; no admite destinos
arbitrarios ni solicitudes de subframes. Ver el contrato en el README de laboratorio.

### Identificador de paciente del DAU · 0.48.83

El filtro nativo `DAUReport` llama a `PatientCareService.dauURL`, que entrega
`IdPatient` como cuarto argumento de `REPORTS.ENCOUNTER.DAU.LETTER`; ese argumento
se serializa como `uspId`. Se verifica contra el paciente ya validado de la admisión,
no contra el profesional conectado. Los controles de sesión siguen comparando el
establecimiento y el profesional antes y después de cada lectura. La regresión usa
identificadores distintos para paciente y profesional y rechaza enlaces que los confundan.

### Solicitud de laboratorio: OTROS en dos líneas · 0.48.84

La solicitud impresa muestra OTROS en dos líneas, como el formulario en papel y la versión de HHR;
el texto escrito pasa a la segunda línea cuando no cabe en la primera. MÉDICO TRATANTE sigue en una
línea y FIRMA queda en blanco para firmar a mano. Los campos «Otros exámenes» y «Médico tratante» no
guardan lo escrito en el autocompletado del navegador, porque los computadores son compartidos.
Nada de esto se guarda con el paciente. Actualizar/recargar la extensión para usarlo.
