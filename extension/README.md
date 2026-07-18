# Extensión · Puente Eloísa → HHR

Extensión de Chrome (Manifest V3) que lee el censo de hospitalizados de **Rayen / Ficha
Médico** y lo entrega al **censo local HHR** para importarlo con revisión. Además, en
**Gestión de cuidados**, agrega accesos separados al reporte de indicaciones y a la receta médica
vigente oficial de Eloísa.

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
  `isComplete=true` y entrega el código CIE-10 cuando Ficha Médico lo informa.
- El panel clínico se consulta solo al abrirlo: combina historial, estado vigente de fármacos y
  plan de cuidados. Así distingue suspendidos, muestra acciones de enfermería ejecutadas y separa
  entregas de turno médicas y de enfermería sin persistir ese contenido en HHR.

## Archivos

| Archivo | Rol |
| --- | --- |
| `manifest.json` | MV3: permisos de host, content scripts (MAIN + ISOLATED), service worker |
| `inject-fichamedico.js` | MAIN world en Rayen: captura token, lee y **normaliza** al snapshot |
| `fichamedico-normalization.js` | Selecciona el diagnóstico principal activo y su CIE-10 sin depender de la UI de Rayen |
| `content-fichamedico.js` | ISOLATED en Rayen: relé background ⇄ mundo principal |
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
| `hhr-hospitalized-documents-center.js` | Superficie hospitalizada de Indicaciones y Regímenes + BRADEN |
| `hhr-handoff-scores-center.js` | Superficies de Entrega de turno y Scores, con sus lecturas y escrituras clínicas verificadas |
| `hhr-lab-center.js` | Superficies de Laboratorio: consulta y análisis Syslab, solicitud imprimible y navegación entre ambos flujos |
| `content-prescription-print.js` | Orquesta el shell, navegación, contexto de paciente y montaje de los owners del Centro HHR |
| `background.js` | Enruta lecturas, reportes y escrituras verificadas contra los servicios de Eloísa |
| `content-hhr.js` | ISOLATED en el HHR: relé página (puente) ⇄ background |
| `encounter-navigation.js` | Valida el episodio y construye la ruta segura para abrirlo en Ficha Médico |
| `health-check.js` | Comprueba relés activos en Ficha Médico/Gestión de Camas sin leer tokens ni datos clínicos |
| `gestion-camas-session.js` | Valida y reduce la sesión temporal de Gestión de Camas, incluida su expiración |
| `gestion-camas-runtime.js` | Conserva, verifica, renueva y desconecta la sesión temporal de Gestión de Camas; administra su ventana oficial de acceso |
| `clinical-panel-fetch.js` | Pagina estados farmacológicos y evita presentar fallas parciales como datos vacíos |
| `clinical-panel-runtime.js` | Lee y normaliza el historial, plan de cuidados, estados farmacológicos y validación vigente del panel clínico |
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

### Indicaciones y recetas desde Gestión de cuidados

En todas las vistas de `fichamedico.rayensalud.cl`, la extensión agrega el **Centro HHR** con el logo
oficial del Hospital Hanga Roa. La barra detecta la altura real del encabezado de Eloísa y se ubica en el
extremo derecho de la primera franja gris, sin cubrir la segunda fila de navegación. Es compacta y su
contenedor modular permite incorporar nuevas herramientas. Incluye **Recetas**, **Regímenes**,
**Indicaciones**, **Entrega de turno**, **Scores**, **Conexiones** y **Lab**. En pantallas pequeñas se
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
la extensión se cierra al detectar la sesión; Ficha Médico puede quedar como única pestaña Rayen abierta.
El token temporal permite consultar egresos definitivos y el informe de Alta Administrativa hasta su
vencimiento, incluso si Gestión de Camas ya fue cerrada. **Olvidar** elimina la sesión de la extensión.

Cuando la vista tiene un episodio activo, **Recetas** abre primero **Paciente actual**. Desde listas,
paneles u otras rutas sin episodio abre directamente **Hospitalizados** y deja deshabilitada la pestaña
del paciente actual. Los accesos contextuales de Indicaciones y Receta médica se mantienen solamente en
la tabla de fármacos de Gestión de cuidados.

### Regímenes, BRADEN e indicaciones masivas

- **Regímenes** genera una tabla clínica única para todos los pacientes hospitalizados. Conserva
  servicio, cama, paciente/RUN, régimen y observación, y agrega en la misma fila la fecha del régimen
  y el último BRADEN disponible: puntaje, clasificación y fecha/hora de aplicación. Si alguna lectura
  de régimen o BRADEN falla, la impresión se bloquea para evitar presentar datos parciales como completos.
  El último BRADEN se reconcilia siempre entre el historial y los formularios clínicos resumidos.
- **Indicaciones** permite buscar y seleccionar uno, varios, los visibles o todos los hospitalizados.
  Cada paciente conserva su `Reporte_Indicaciones_Paciente.pdf` oficial; la extensión une los documentos
  seleccionados y abre un único diálogo de impresión. Las selecciones se validan nuevamente dentro de
  la extensión y caducan a los 30 minutos.

### Entrega de turno y Scores

- **Turno** presenta a todos los hospitalizados en una tabla global, con su última entrega, fecha/hora,
  profesional y estado. El ingreso respeta el límite oficial de 255 caracteres. Después de enviar una
  entrega, la extensión vuelve a consultar Eloísa y solo muestra **Guardado en Eloísa** si encuentra el
  registro exacto; también distingue firmado, pendiente de validación, error y escritura no verificable.
  El selector de estación abre el reporte oficial de entrega de turno en el diálogo de impresión.
- **Scores** ofrece un selector global para **CUDYR**, **Downton** y **Braden**, mostrando el último
  valor y la última aplicación por paciente. Braden y Downton muestran el historial consultable que
  entrega Eloísa y cargan dinámicamente el formulario oficial. CUDYR usa su formulario clínico oficial
  y muestra explícitamente solo el último valor, porque el servicio disponible no expone historial.
  Los tres instrumentos exigen el permiso clínico de ingreso antes de habilitar una escritura.
- Toda escritura requiere una identidad clínica verificable en la sesión. El estado **Sincronizado en
  Eloísa** aparece únicamente después de releer y comprobar el valor guardado; ante una respuesta
  ambigua se conserva una protección persistente por paciente e instrumento hasta confirmar su estado,
  para impedir una repetición accidental incluso si se recarga la vista. Un guardado verificado mantiene
  la misma protección hasta que la interfaz confirma inmediatamente que recibió y presentó el resultado;
  el tiempo por sí solo no libera una escritura clínica pendiente. Si ese acuse se pierde o la respuesta
  es ambigua, la recuperación exige esperar al menos un minuto. Background obtiene una lectura fresca que
  se muestra para revisión explícita y, tras la confirmación, ejecuta un segundo GET: solo libera si ambos
  resultados coinciden exactamente y pertenecen a la misma generación protegida.
- La protección técnica se guarda en `chrome.storage.local` para sobrevivir reinicios de Chrome y
  actualizaciones de la extensión. Su clave usa SHA-256 y el marcador no contiene episodio, nombre, RUN,
  observación, respuestas ni resultados clínicos. El desafío de revisión dura cinco minutos: almacena
  únicamente el hash del token y un HMAC del resultado; ni el token crudo ni un hash directo de datos
  clínicos quedan persistidos.
- Antes de imprimir lotes o guardar un instrumento se revalida la hospitalización. CUDYR además
  comprueba nuevamente el servicio clínico, porque el formulario aplicable cambia según el servicio.

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

- Chrome 111+ (usa `world: "MAIN"` y el selector CSS `:has()`).
- Debe existir **una pestaña de Rayen abierta y logueada**; si no, el HHR muestra el error
  "No hay una pestaña de Rayen abierta".
- El token se captura de las llamadas que hace la propia app de Rayen. Si acabas de instalar la
  extensión, **recarga Rayen** para que el capturador esté activo antes de la primera lectura.
- La escritura al censo la hace el HHR con **tu sesión de Firebase** (rol `nurse_hospital`/`admin`);
  la extensión no toca Firestore ni almacena credenciales.

## Verificación

- `npm run check:rayen-extension-release` valida Manifest V3, recursos declarados, permisos de host,
  sintaxis de todos los scripts, integridad SHA-256 de los vendors y que PDF/XLS se registren durante
  la evaluación inicial del service worker, sin `importScripts()` tardío prohibido por Chrome.
- El núcleo de lectura+normalización se probó contra datos reales de Rayen y produce un
  `RayenCensusSnapshot` con apellidos separados, RUN, cama, diagnóstico principal, CIE-10 e
  `isComplete`.
- La sintaxis de los scripts operativos pasa `node --check`.
- El protocolo v3 minimiza el historial, los estados de medicación y el plan de cuidados antes de
  cruzar hacia HHR; el contenido del panel sigue siendo efímero y de solo lectura.

## Pendiente / a confirmar con datos reales

- Cómo aparece un paciente **CMA** en el encounter API (servicio/cama) — el `bedMapping` lo maneja por
  prefijo `CMA`, pero conviene verlo con un caso real.
- La representación de un **egresado** (alta / CMA / traslado) — la pestaña de egresos estaba vacía.
