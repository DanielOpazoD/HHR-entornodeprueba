# Historial de runbooks (hasta el 22-10-2026)

> Texto trasladado sin cambios desde los runbooks el 22-10-2026, cuando se acordó dejar en ellos
> sólo la guía vigente. La guía activa está en [gates y fallas de CI](../CI_GATES_AND_FAILURE_RUNBOOKS.md),
> el [checklist de cambio seguro](../SAFE_CHANGE_CHECKLIST.md), la
> [definición de terminado](../ENGINEERING_DEFINITION_OF_DONE.md) y el
> [runbook de soporte](../RUNBOOK_SUPPORT_OPERATIONS.md). Los incidentes y parches nuevos se
> documentan en la descripción del PR que los resuelve.

## Desde CI_GATES_AND_FAILURE_RUNBOOKS.md

### Notas de incidentes del encabezado

El [experimento de aislamiento E2E](../E2E_ISOLATION_EXPERIMENT.md) es exclusivamente
manual. Conserva el CI obligatorio y compara corpus, estabilidad, espera y coste
antes de proponer cambios en sus carriles.

Un rechazo de fecha de ingreso durante una sincronización con cambio de cama
requiere comparar el mismo episodio en origen y destino: la cama previa no es
identidad del paciente. El código `HHR-SYNC-1/census/admission-date-policy` conserva
en el historial protegido el paciente, documento, cama y ambas fechas comparadas.
`structural-write-rejected` conserva una categoría técnica acotada para otros
rechazos; no guarda excepciones crudas. `structureConfirmed: false` significa que
el guardado estructural no quedó confirmado, no una sincronización parcial ya
aplicada. Los eventos antiguos sin evidencia siguen sin ella; no reconstruir sus
identidades desde el ocupante actual. Validar con `ci:merge-gate`,
`test:release-confidence`, revisión independiente y CI definitivo.

Para un bloqueo de borrado durante una reubicación, comprobar el episodio de cada ocupante,
incluida la cuna RN: compartir documento no acredita que sigan ambos presentes. La guarda
exige coincidencia única y, sin dos ids persistidos, concordancia de documento completo,
nombre e ingreso. No resolver el bloqueo retirando la guarda ni creando un egreso ficticio.
Validar `dailyRecordErasureRelocation.test.ts`, `dailyRecordWriteAuthorityErasureIdentity.test.ts`,
`test:sync-lifecycle`, `ci:merge-gate` y `test:release-confidence`. El cierre de rollout exige
el despliegue verificado de Functions y de la aplicación: aprobar sólo el cliente no actualiza
la copia de la guarda del servidor.

Para el rollout regional de `applyRayenClinicalEnrichmentBatch`, el deploy debe
verificar `southamerica-east1` y `us-central1`: la segunda conserva los clientes
anteriores. No cambiar el enrutamiento del cliente hasta verificar el despliegue
del head mergeado. Ejecutar merge gate y release confidence para el cambio del
handler; conservar memoria, timeout, autoridad, recibos y transacción.

`ACTIVE` y la presencia en `functions:list` no prueban invocabilidad. Si el primer
deploy regional falla en `setIamPolicy`, mantener el cliente anterior y revisar
el binding de invocación del recurso nuevo. En `hhr-pruebas`, el endpoint anterior
usa `roles/cloudfunctions.invoker` para `allUsers`; replicar ese binding requiere
autorización puntual, preservando los demás bindings y su `etag`. No conceder
Cloud Functions Admin al deployer para resolver este incidente. Comprobar después
una llamada autenticada idempotente y el rechazo `UNAUTHENTICATED` de una petición
sintética válida sin sesión. La validación de payload antecede a Auth: un 400
`INVALID_ARGUMENT` no acredita ese rechazo de autenticación.

El cliente clínico usa el runtime regional existente con el timeout de 20 s.
No implementar fallback a otra región tras una respuesta ambigua: los reintentos
clínicos conservan su política y recibos existentes. Para rollback, revertir solo
el enrutamiento del cliente; el endpoint de Estados Unidos sigue disponible.

La ayuda del login ofrece una recarga normal, no una reparación por borrado.
Ante un acceso que no responde, confirmar que la recarga conserva IndexedDB,
Web Storage, cachés y la cola no confirmada. Cancelar debe mantener credenciales
y errores; mientras se decide, no debe enviar el formulario ni iniciar Google.
Validar `LoginPageCard.test.tsx` y `auth-login-resilience.spec.ts` con datos sintéticos,
además de `ci:merge-gate`, `test:release-confidence`, revisión independiente y CI
del head final. Hasta completar esos gates, el cierre sigue pendiente. Las APIs
de mantenimiento y la recuperación de bootstrap conservan sus propios recorridos.

### Evidencia de reconexión y conflictos (2026-09-29)

`multiuser-offline-conflict.spec.ts` prepara sólo el estado inicial en IndexedDB.
Después comprueba que la edición visible sin red conserva la base persistida hasta
reconectar; la mutación pausada debe entonces guardar por el camino de la aplicación.
El segundo contexto edita desde la UI, se inspecciona su petición callable y se acepta
con `dailyRecordAuthorityRoute`. El snapshot que recibe el primer contexto procede
del guardado aceptado del segundo, no de valores esperados escritos por el test.
`sync-conflict-resolution.spec.ts` tampoco rellena el almacenamiento después de editar.

Estas pruebas usan autoridad remota controlada y una recarga con snapshot explícito:
no prueban reproducción automática de una cola offline, entrega entre navegadores
por Firestore ni resolución CAS de dos escritores reales. La concurrencia real se
verifica separadamente en `sync-concurrency.emulator.test.ts` (versiones, hidratación,
movimientos sin duplicación y retiro de dispositivos) y
`specialty-clinical-concurrency.emulator.test.ts` (autoridad clínica, decisiones
manuales de especialidad y cambios de cama/cuna). No declarar una edición en memoria
como guardado durable, ni sembrar el resultado para ocultar una mutación pausada.

### Reloj de fixtures de autoridad (2026-10-01)

Los tests de autoridad estructural y de especialidad fijan únicamente `Date`, no
los temporizadores ni la E/S. La fecha del fixture y las guardas reales del callable
comparten un instante estable. Los escenarios fuera de la ventana de edición
avanzan explícitamente la fecha antes de invocar el handler; los vencimientos de
consulta Jev siguen verificando aceptación, rechazo y recuperación. Cada test
restaura el reloj, sin marcas `@flake-safe` ni cambios en los umbrales del gate.

### Esperas observables de tests (2026-10-01)

En relés MV3, entregar respuestas sólo después de observar la solicitud emitida
y esperar el mensaje o callback terminal exacto. La reinyección verifica además
el anuncio de inicialización antes de limpiar la lista de mensajes. En aislamiento
de sesiones, mantener una promesa de limpieza/cierre retenida y una señal explícita
de inicio; las dos ventanas deben alcanzar el Web Lock antes de liberarla.

Las pruebas de QueryClient fijan el reloj antes de crear la caché y lo avanzan según
el escenario; IndexedDB mantiene sus temporizadores nativos. Los fixtures de código
manual deben tener ingreso anterior a captura también en el caso expirado. El
helper de login ya controla timers: su reloj inicial y el lock del test son ahora
explícitos. No se cambia el detector de flake-risk ni se añaden exenciones.

### Atribución interna de transacciones clínicas

El desglose numérico `transactionTimingsMs` está descrito en
[el protocolo de medición](../operations/sync-session-performance.md). Se acumulan
intentos fallidos y exitosos; el tiempo externo al callback incluye trabajo del SDK
y no acredita una demora de commit aislada. Verificar lectura fallida, replay exacto,
auditoría y retry con reloj monotónico inyectado antes de usar las cifras.

### Censo: aislamiento de renders de dotación y movimientos

`DailyRecordFragmentRendering` usa el proveedor real: veinte ediciones inmutables
de camas y revisión mantenían 21 renders de dotación/movimientos; ahora conservan
uno mientras camas y datos completos publican las 21 revisiones. Las dependencias
son los campos ya existentes, sin comparadores profundos ni otro almacén.
`CensusRegisterRendering` añade JSX nuevo del padre y comprueba el subárbol real de
registros (presentación pesada sustituida): también pasa de 21 a un render por
sección. Fecha, movimientos, permisos, modal y callback vigente siguen propagándose.

Ante datos visuales obsoletos, ejecutar ambas regresiones y los tests de Altas,
Traslados y Hospitalización Diurna; verificar que la escritura reemplaza las
colecciones inmutablemente y que no se eliminó una dependencia relevante.
El encabezado conserva su registro completo para el portal de entrega de turno;
las revisiones usadas por las acciones clínicas no se suprimen. Esta evidencia
reduce trabajo repetido; no es una medición comparativa de tiempo o INP de usuario.

La fixture multiusuario espera explícitamente a que la aplicación cree el almacén
`dailyRecords` antes de sembrar su estado inicial. La visibilidad de auth no prueba
readiness de IndexedDB; abrir una base inexistente desde el test crea un esquema
vacío y compite con Dexie. No se escriben ediciones esperadas desde la fixture.

### Retirar duplicados sin perder escenarios (2026-10-01)

Owner: infraestructura de tests HHR. Se conserva una prueba por cada contrato
único; un nombre antiguo de archivo no demuestra que el comportamiento haya desaparecido.
La cohorte de censo/handoff pasa de 75 a 71 tests al retirar cuatro cuerpos idénticos:

| Caso retirado                                                 | Caso que conserva las mismas entradas y aserciones                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| Handoff: URL en `medicalPatientHandoffViewController.test.ts` | `domain/handoff/view.test.ts`: scope y especialidad desde URL       |
| `useCensusLogic`: fetch de fechas al montar                   | Comprobación del día previo: misma llamada a `useCensusPromptState` |
| Admisión: reparación de `firstSeenDate` obsoleto              | Reparación de `firstSeenDate` con hora presente y fecha corregida   |
| Rayen: paciente ausente del snapshot completo                 | No inferir un alta simple; conservar alta administrativa pendiente  |

Las dos variantes útiles de handoff con clasificación UPC booleana se trasladan
al test del dominio, separadas de los casos con checklist. No se cambia código
clínico, exclusiones, cobertura exigida ni selección de packs. Rollback: revertir
el PR; para nuevas retiradas, comparar fixtures/hooks/entradas/aserciones y ejecutar
los casos conservados, además de los controles del head definitivo.

### Setup DOM sólo para suites con document (2026-10-01)

El setup compartido carga React Testing Library, matchers DOM y su cleanup sólo
cuando el entorno ofrece `document`. IndexedDB simulado, storage y los mocks de
Firebase/auth permanecen disponibles en Node y jsdom; no cambia configuración de
Vitest, aislamiento, concurrencia ni selección de tests.
El adaptador oficial de jest-dom para Vitest registra los matchers y sus tipos;
las aserciones de `z-index` comparan texto CSS conservando sus valores originales.

Medición local: Node 22.22.2, 20 suites Node, las mismas 96 pruebas, dos workers,
seis procesos nuevos alternados antes/después (A-B-B-A-A-B). Medianas: 50,8 s
antes y 26,6 s después; rangos 28,3–53,0 s y 19,4–27,3 s. La carga del equipo
varía: el ahorro corresponde a esta cohorte, no al CI completo. Los tests de UI,
auth, persistencia y limpieza deben seguir pasando antes del cierre.
Owner: infraestructura de tests HHR. Rollback: revertir el PR para restaurar
imports DOM incondicionales; no reducir el pack para conservar una cifra de tiempo.
Referencias: [setupFiles de Vitest](https://vitest.dev/config/setupfiles) y
[cleanup de React Testing Library](https://testing-library.com/docs/react-testing-library/api/#cleanup).

### Canal entre pestañas: comprobar mensajes y cleanup reales (2026-10-02)

`authBroadcastChannel` utiliza una instancia simulada por caso y un módulo recién
cargado; nunca abre un BroadcastChannel nativo durante estas pruebas. Comprueba
los payloads vigentes de actividad/logout, la generación admitida, la reutilización
del canal, el filtrado de mensajes entregados por la propia pestaña y la retirada
del listener exacto sin desuscribir otros consumidores. Se mantiene degradación
ante API ausente o constructor fallido. El descriptor global original se restaura
sin retirar fixtures compartidos de storage/auth.

Owner: infraestructura de tests/auth HHR. Estos casos reemplazan comprobaciones
vacías o que sólo comprobaban no lanzar errores; no cambian el protocolo real.
Validar también `useAuthState.crossTabLogout` y `sessionActivityMonitor`.
Rollback: revertir el PR; no convertir de nuevo payloads o limpieza en aserciones
constantes para silenciar una regresión.

### Telemetría CLI sin modificar reportes versionados (2026-10-02)

`ciRuntimeTelemetryScripts` ejecuta el script real con una ruta absoluta y un
`cwd` temporal distinto por entrada. No cambia el directorio global del proceso
de Vitest ni copia algoritmos del CLI. El perfil estimado versionado se copia como
fixture de entrada y se comprueba la comparación estimado/observado real.
Los JSON/Markdown generados se leen dentro
del workspace y se eliminan al terminar el caso, incluidos los fallos de parsing.
Se preservan las comprobaciones de errores accionables y metadatos del colector;
un caso adicional comprueba que otra ejecución no sobrescribe el primer reporte.

Owner: infraestructura de tests/CI HHR. Los reportes del repositorio deben conservar
sus bytes antes/después de esta cohorte. No regenerar artefactos versionados como
efecto lateral de un test. Rollback: revertir el PR y restaurar sólo reportes
generados por la propia ejecución; no descartar modificaciones ajenas.

### PDF: probar el servicio, no copias de su algoritmo (2026-10-02)

Los siete casos de `pdfStorageService` ejecutan ahora `createPdfStorageService`,
`listFilesInMonth` y `listFilesInMonthWithReport` reales. Se sustituyen objetos
literales de tipo, regex copiados y concatenación local de rutas por comprobaciones
de ruta para ambos turnos, parsing del formato actual y legacy, URL/metadatos,
fallback de timestamp y reporte de nombre no reconocido sin perder archivos válidos.

Firebase Storage se simula y el runtime ya existente se inyecta explícitamente;
no se llama a servicios remotos ni se exportan helpers privados para facilitar el
test. Los timers de consulta se simulan y limpian por caso. Se retira el mock de
una ruta inexistente a Firebase. `pdfStorageRuntime` conserva su cobertura de
permisos, fechas inválidas y fallos de consulta/mutación sin modificar el pack crítico.
Owner: infraestructura de tests/backup HHR. Rollback: revertir el PR; no reemplazar
una regresión del servicio por volver a comprobar una copia del algoritmo.

### Handshake Ficha Médico con reloj controlado (2026-10-02)

Los casos de versión/generación conservan sus variantes y ejecutan el relay real
en VM con timers de Vitest por caso. El probe no responde antes de 4500 ms; salud
no vence antes de 4000 ms y descarta la respuesta tardía. No se duerme 4,5 segundos
reales ni se amplía el timeout de Vitest. Los deadlines inertes que el relay deja
tras responder se eliminan al terminar cada caso; no se cambia la extensión.
Owner: infraestructura de tests/extensión HHR. Rollback: revertir el PR.

### Suscripciones del repositorio con entrega explícita (2026-10-02)

Los casos de realtime en `dailyRecordRepositorySyncService` esperan la entrega del
callback real mediante una promesa del fixture; no dependen de dormir un turno ni
de adivinar el número de microtareas. Cada suscripción se cierra al terminar el caso.
Los mocks de IndexedDB, loader remoto y suscripción recuperan un estado independiente
antes de cada test, incluidos los casos de unsubscribe con una lectura pendiente.
Conserva las 11 comprobaciones de consistencia, cache-only y protección tras cierre.
Owner: infraestructura de tests/repositorios HHR. Rollback: revertir el PR.

### Syslab: recursos de cada caso bajo control (2026-10-02)

Toda la suite del transporte offscreen usa timers simulados por caso, también en
éxito, cancelación, navegación, límite de pendientes y error de postMessage.
Cada relay creado pertenece al caso y se dispone aun cuando falle una aserción.
Se comprueba que no queden timers; el timeout respeta su límite exacto de 250 ms
y una respuesta posterior no reenvía operaciones ni recupera trabajo vencido.
Se preservan los nueve escenarios y los filtros de origen, ventana y reqId.
Owner: infraestructura de tests/extensión HHR. Rollback: revertir el PR.

### Popup: worker silencioso y respuestas tardías (2026-10-02)

La suite ejecuta el script real del estado del worker con reloj simulado por caso.
Conserva versión del manifest y respuestas de éxito, rechazo y excepción síncrona.
Añade un worker sin respuesta: sigue pendiente a 4999 ms, falla a 5000 ms, limpia
su timer y no vuelve a estar listo si llega tarde el contexto. También rechaza una
versión distinta o una generación ausente. El teardown comprueba cero timers.
Owner: infraestructura de tests/extensión HHR. Rollback: revertir el PR.
No cambia el paquete de extensión ni sus plazos de respuesta.

### Entornos explícitos para lógica pura (2026-10-02)

Las suites de utilidades clínicas (12 archivos: fechas, RUT, permisos, cadenas,
clonado, patches e integridad) usan Node mediante la anotación de cada archivo.
Conservan sus casos, aserciones, mocks y reloj clínico; no requieren DOM ni renderizado.
Las suites de descargas CSV y hooks optimistas conservan jsdom porque sí usan DOM.

La comparación local de 50 suites candidatas, en cuatro procesos BAAB con cuatro
workers, conservó los mismos 438 casos y resultados: mediana de 5,12 s en jsdom
y 1,83 s en Node (64,4 % menos). Es una medida de esa cohorte local, no del CI
completo ni del tiempo de la aplicación. No cambian cobertura, aislamiento,
workers, plazos ni umbrales. Owner: infraestructura de tests/HHR.
Rollback: revertir la anotación del PR afectado; no adaptar una prueba que necesita
DOM para hacerla pasar en Node.

Las ocho suites de escalas clínicas (Braden/CUDYR), UPC y entrega de turno
también declaran Node. Preservan estados legacy, criterios, auditoría histórica,
carryover y visibilidad por especialidad; no se cambia ninguna regla clínica.

Las diez suites de esquemas y validación declaran Node: parsing de pacientes,
movimientos, entrega, heridas y telemetría Rayen. Conservan rechazo de entradas
inválidas, normalización legacy y reportes de reparación; los esquemas no cambian.

Veinte suites de contratos y políticas del repositorio declaran Node. Conservan
autoridad clínica, conflictos de campos/movimientos, CUDYR, fechas de ingreso,
intención explícita de patch, compatibilidad y preparación de persistencia.
No migrar junto a ellas las pruebas de integración que sí ejercen APIs de navegador.

### Declaraciones de test exclusivas u omitidas (2026-10-02)

El control de gobernanza conserva la política existente basada en los nombres
`it`, `test` y `describe`, y analiza sus llamadas estáticas con el parser de
TypeScript ya instalado. Detecta `only`/`skip` en cadenas `each`/`concurrent`,
acceso por clave literal y wrappers de expresiones TypeScript. Los comentarios y
strings de fixtures no cuentan como declaraciones ejecutables.

No resuelve símbolos: un método local con esos nombres conserva el tratamiento
conservador previo. Imports renombrados y claves dinámicas requieren revisión de
código; no se presenta este detector como análisis completo de JavaScript.
La resolución de aliases queda fuera de este PR: no hay uso demostrado que
justifique construir una política de bindings propia.

La CLI se prueba en directorios temporales propios con declaraciones prohibidas,
texto inocuo, la excepción de skip de reglas Firestore y el límite intacto de
500 líneas. Owner: infraestructura de tests/CI HHR. Rollback: revertir el PR del
detector; no crear allowlists nuevas para hacer pasar un test exclusivo u omitido.

El gate y el reporte de métricas comparten el mismo detector. Así los ejemplos
de fixtures no degradan el scorecard y las cadenas prohibidas sí se contabilizan.

Ocho suites críticas de políticas/controladores de autenticación declaran Node.
Conservan permisos, sesión, redirects, configuración y headers. Los tests de lock,
online y ciclo de vida del navegador mantienen jsdom.

La medición local de las cinco cohortes críticas (46 suites, 251 casos), en cuatro
procesos BAAB con la configuración crítica intacta, pasó de mediana 15,07 s a
8,04 s (46,7 % menos). Los puntos cubiertos de 481 archivos de fuente fueron
idénticos, sin pérdidas ni ganancias. No es una medida del CI completo.
No cambian código de producción, workers, aislamiento, plazos ni umbrales.
Rollback: revertir las anotaciones del PR afectado. Owner: tests críticos/HHR.

Quince suites críticas de contratos y controladores de respaldos declaran Node.
Conservan errores, disponibilidad, listados, resultados, PDF storage y backfill.
Los tests de generación de PDF y cargas con contrato de navegador mantienen jsdom.

Seis suites críticas de servicios y controladores de traslados declaran Node.
Conservan consultas, mutaciones, estado y suscripciones, incluyendo errores.
No se modifica el comportamiento clínico ni la persistencia de los traslados.

Cinco suites críticas de historial de pacientes declaran Node. Conservan
paginación, rangos, disponibilidad de lectura e historia UPC, sin modificar
consultas ni registros clínicos.

Doce suites críticas de políticas de persistencia/sincronización declaran Node.
Conservan autoridad de escritura, reparación heredada, intención de patch,
contratos de tareas, presupuestos operacionales y recuperación IndexedDB.
Los tests de integración que necesitan el navegador mantienen jsdom.

### Contratos de reportes sin DOM (04-10-2026)

Doce suites de `src/tests/build` sobre frescura/procedencia de reportes, contratos
de release/preview, dependencias de evidencia, auditoría npm, Git y resultados
Playwright usan Node por archivo. Sus imports y operaciones son de filesystem,
procesos y datos; no requieren DOM. El setup global conserva sus fixtures para
Node y la UI sigue en jsdom. No extender la migración solo por ubicación.

Con dos workers y los mismos 133 tests, tres ejecuciones por variante dieron
medianas de 6,28 s en jsdom y 4,60 s en Node; el entorno pasó de unos 3 s agregados
a cero. Se midió primero la base y luego el cambio, sin aislamiento de la carga
del equipo: es evidencia de esta cohorte, no una ganancia del pipeline completo.
Rollback: retirar solo las doce anotaciones de entorno, sin cambiar tests,
workers, timeouts ni umbrales.

### Separar transporte y planificación en los tests de IA

`cie10AISearch.test.ts` sustituye el gestor mediante su ruta canónica y verifica
que la búsqueda pase por él con su señal de cancelación. Sus seis casos siguen
cubriendo serverless y fallback; no deben pagar las pausas reales del planificador.
`aiRequestManager.test.ts` prueba ese planificador real con reloj controlado e
instancia aislada: intervalo de 1.500 ms, aborto, error y backoff de 2/4/8 s para
429/503. Mantener ambas responsabilidades; quitar el mock no aumenta la cobertura
del transporte y vuelve a introducir esperas entre casos.

### Evidencia incompleta: controles existentes verificados (04-10-2026)

La revisión del bloque 6 no requiere otro validador: `previewBootstrapEvidenceSupport.test.ts`
rechaza reportes ausentes/corruptos, interrumpidos, omitidos o de otro workflow/run/SHA;
`releaseEvidenceContract.test.ts` rechaza inventarios incompletos y paquetes dirty;
`reportFreshness.test.ts` y `evidenceDependencyGraph.test.ts` verifican procedencia,
dependencias y frescura antes de reutilizar resultados. `ciFinalConfidenceWorkflow.test.ts`
comprueba la dependencia del consumidor respecto a sus productores de la misma ejecución.
Conservar estos contratos y sus casos negativos al optimizar CI. El benchmark de
arranque también rechaza sobrescribir evidencia: para repetir, usar una ruta nueva
con `CENSUS_PERF_OUTPUT`, sin borrar el resultado anterior para hacerlo parecer vigente.

### Transacción cerrada en el emulador CUDYR

Los runs `38166306055` y `38169209959` fallaron en la prueba concurrente de
recibos CUDYR con `3 INVALID_ARGUMENT: Transaction is invalid or closed.`.
El emulador Firestore 1.20.4 devuelve ese mensaje para una transacción que ya
no está activa; el SDK reintenta otro mensaje de expiración, pero no éste.

El archivo CUDYR admite hasta dos reintentos adicionales únicamente ante ese
mensaje exacto y con `FIRESTORE_EMULATOR_HOST` apuntando a `localhost` o
`127.0.0.1`. Cada intento abre una transacción nueva y vuelve a comprobar la
autoridad. No reconoce un guardado sin confirmación. Los errores de argumentos
distintos y el comportamiento fuera del emulador local permanecen intactos.

Validar con `npx vitest run src/tests/functions/cudyrHistoryFunctions.test.ts`
y `npm run test:emulator:sync:ci`. Conservar los escenarios concurrentes y sus
asserts; no añadir reintentos de suite ni serializarlos. Rollback: revertir el
parche y repetir esas pruebas, sin modificar datos, permisos ni umbrales.

### Calibración unitaria publicada (12-10-2026)

El reparto conserva cuatro particiones, afinidades, exclusiones de emulador,
tolerancia y presupuestos. `scripts/config/unit-shard-balance.json` publica los
pesos de ejecución obtenidos de los CI aprobados 38276199931 y 38274966947,
con Node 22 y la base 89d2395e1. Los casos lentos usan medianas redondeadas a
100 ms; el resto comparte su media observada. El coste fijo de preparación
sigue separado. Son estimaciones para repartir trabajo, no tiempos garantizados.

`durationSource: hints` evita que un snapshot de julio o un perfil privado cambie
el reparto del mismo commit. `profile:unit-shard-runtime` conserva el experimento
local mediante `--measured`; sus resultados deben revisarse antes de publicar
una nueva calibración. No se añaden jobs ni se cambian umbrales.

El runner utiliza `vitest.unit-shard.config.ts` con `include` exacto. Los filtros
posicionales de Vitest son coincidencias parciales: el filtro de un archivo
`.test.ts` podía seleccionar también su hermano `.test.tsx` y ejecutar una suite
en dos particiones. El listado real debe coincidir con cada partición y su unión
con toda la selección. El reporte observado calcula la estimación del checkout
actual, en vez de comparar los tiempos de CI con el antiguo snapshot versionado.

Validar la selección, ejecutar las cuatro particiones completas y comparar
ejecuciones equivalentes. Las variaciones del runner, los imports y la preparación
no permiten atribuir el tiempo total únicamente al reparto de casos.

## Desde SAFE_CHANGE_CHECKLIST.md

### CLI de despliegue Firebase (2026-10-11)

- **Owner:** CI/Functions HHR.
- **Reason:** 15.15.0 comparte tokens de fuente entre grupos; Firebase rechazó
  el despliegue de la región clínica con el error `Invalid source token`.
- **TargetVersion:** `firebase-tools` 15.16.0, fijado en manifest y lockfile raíz.
  Es el único paquete resuelto que cambia; SDK, Functions y overrides se conservan.
- **RiskLevel:** medio: herramienta de despliegue y emulador, con corrección
  [upstream #10432](https://github.com/firebase/firebase-tools/pull/10432).
- **RollbackPlan:** revertir el PR y ejecutar `npm ci`; no volver a desplegar
  varias regiones con el CLI afectado. No borrar datos ni ampliar permisos.
- **VerificationGate:** `dependency_upgrade`: instalación limpia, audit de ambos
  paquetes, prueba de aislamiento de tokens, `ci:merge-gate`, suites Functions,
  emuladores sintéticos, revisión independiente, CI y despliegue en hhr-pruebas.

### Parche transitivo gRPC (2026-10-01)

- **Owner:** plataforma Firebase/Functions HHR.
- **Reason:** corregir GHSA-m9gg-hp2v-232j actualizando el override existente en
  ambos paquetes; no se ha demostrado explotación en HHR.
- **TargetVersion:** `@grpc/grpc-js` 1.14.5 en los dos manifests y lockfiles.
- **RiskLevel:** bajo/medio: parche de transporte Node utilizado por Admin/Google;
  se conserva Firebase web 12.14.0 y el resto del grafo.
- **RollbackPlan:** revertir este commit y ejecutar `npm ci` en raíz y Functions;
  la versión anterior volvería a estar señalada por el audit. No borrar datos ni colas.
- **VerificationGate:** categoría `dependency_upgrade`: audit de ambos paquetes,
  `ci:merge-gate`, revisión independiente y CI del head final; ampliar con
  `test:release-confidence` para validar el transporte de la autoridad.

Referencia: [aviso gRPC](https://github.com/advisories/GHSA-m9gg-hp2v-232j).

El gate ampliado `check:release-evidence` sigue señalando 27 archivos de tests con
relojes reales o esperas de turno. Esa señal es anterior al parche: no cambia ningún
archivo de tests ni su detector. No se declara aprobado ese gate, no se añaden
marcas `@flake-safe` ni excepciones para silenciarlo. Su revisión corresponde a un
bloque propio de determinismo de fixtures y control de esperas. Este parche
transitivo no actualiza el SDK Firebase web ni su bootstrap; conserva los controles
exigidos por `dependency_upgrade` sin modificar la política de clasificación.

### Parche del tooling FTP de CI (2026-10-01)

- **Owner:** infraestructura de tests/CI HHR.
- **Reason:** GHSA-c475-qrg2-pj4r bloquea el audit del tooling Firebase; no se ha
  demostrado explotación en HHR.
- **TargetVersion:** override existente de `basic-ftp` a 6.2.1; sólo manifest y
  lockfile raíz. No cambia Firebase web, Functions ni la política de audit.
- **RiskLevel:** medio: el salto 5 a 6 rechaza hosts de transferencia FTP distintos
  por defecto. `get-uri` conserva las APIs usadas (`Client`, `access`, `list`,
  `lastMod`, `downloadTo`, `close`); no habilitar `allowSeparateTransferHost`.
- **RollbackPlan:** revertir este PR y ejecutar `npm ci`; el audit volvería a
  bloquear la versión vulnerable. No borrar datos ni colas.
- **VerificationGate:** categoría `dependency_upgrade`: audit de raíz y Functions,
  carga del consumidor `get-uri`, emulador/autoridad sintética, revisión independiente
  y CI completo del head final con sus umbrales intactos.

Referencias: [aviso FTP](https://github.com/advisories/GHSA-c475-qrg2-pj4r),
[cambio de seguridad en 6.0](https://github.com/patrickjuchli/basic-ftp/releases/tag/v6.0.0).

### Alineación del SDK Admin de tooling raíz (2026-10-02)

- **Owner:** plataforma Firebase/Functions y emuladores HHR.
- **Reason:** los scripts y emuladores importan Admin directamente, pero la raíz
  lo recibía como peer de Functions 7.2.5. Admin 13.9 incorporaba `node-forge`
  1.4.0, señalado por GHSA-86w9-cpqp-85rv; no se ha demostrado explotación en HHR.
- **TargetVersion:** declarar Admin 14.4.0 y Functions 7.4.0 como dev dependencies
  explícitas de raíz, alineadas con las versiones ya usadas en `functions/`.
  Functions 7.4 admite Admin 13 y 14; actualizar sólo Functions no garantiza el retiro.
- **RiskLevel:** medio: cambia el SDK de tooling y sus tipos/transitivos. Firebase web,
  el paquete Functions desplegable, APIs clínicas y reglas permanecen intactos.
- **RollbackPlan:** revertir manifest/lock raíz y ejecutar `npm ci`; reaparece la
  cadena vulnerable. No borrar datos, colas ni aplicar un override criptográfico.
- **VerificationGate:** `dependency_upgrade`: instalación limpia, audit en ambos
  paquetes, tipos/lint y `ci:merge-gate`, suites Functions, emuladores sintéticos
  de autoridad, revisión independiente y CI del head final.

Referencia: [aviso node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
El aviso no publica un parche; Admin 14 elimina esa dependencia. Los permisos IAM
y el despliegue no forman parte de esta alineación del tooling local/CI.

### Retiro de dependencias de desarrollo sin consumidores

- **Owner:** tooling frontend HHR.
- **Reason:** retirar `autoprefixer` (fuera del pipeline Vite/Tailwind actual) y
  `@types/jspdf` (tipos antiguos redundantes; jsPDF ya declara sus tipos propios).
  `deno.lock` no corresponde a un runtime/comando vigente; los lockfiles npm de
  raíz y Functions siguen siendo las fuentes de instalación.
- **TargetVersion:** eliminación de esas dos declaraciones; sin upgrades del resto.
- **RiskLevel:** bajo: no cambian SDK, código runtime, peers ni overrides de seguridad.
- **RollbackPlan:** revertir el PR y ejecutar `npm ci`; no modificar datos ni colas.
- **VerificationGate:** tipos, lint, audit, exportación PDF, comparación del grafo
  retenido y CSS, build/preview, revisión independiente y CI del head final.

### Lector del respaldo mensual CUDYR (2026-10-07)

- **Owner:** módulo CUDYR de HHR.
- **Reason:** leer los informes BIFF/XLS de Eloísa como evidencia consultiva.
- **TargetVersion:** SheetJS 0.20.3, tarball oficial fijado con integridad en lockfile.
- **RiskLevel:** medio: archivo externo; tamaño 256 KiB, firma, expansión ZIP declarada,
  filas/columnas acotadas, fórmulas rechazadas y worker terminable a los 10 segundos.
- **RollbackPlan:** revertir este PR; el archivo documental de servidor permanece
  conservado y el reporte principal mantiene su contrato.
- **VerificationGate:** tipo `dependency_upgrade`, controles estáticos, unitarios,
  build/presupuesto, navegador sintético y revisión independiente. Worker opcional
  fuera del precache; no se amplían los presupuestos de arranque o tamaño.

### Parches transitivos de HTTP (2026-10-06)

- **Owner:** plataforma Firebase/Functions y tooling HHR.
- **Reason:** corregir versiones vulnerables detectadas por el audit de ambos
  paquetes; no se ha demostrado explotación en HHR.
- **TargetVersion:** `proxy-addr` 2.0.8 y `@fastify/busboy` 3.2.2 en raíz y
  Functions; `compression` 1.8.2, `http-cache-semantics` 4.3.0 y `source-map-js`
  1.2.2 en raíz. Sólo resoluciones compatibles con los manifests existentes.
- **RiskLevel:** medio: cambia procesamiento HTTP y tooling transitivo; no cambia
  el SDK Firebase, permisos, contratos clínicos ni configuración de proxies.
- **RollbackPlan:** revertir los dos lockfiles y ejecutar `npm ci` en raíz y
  Functions; reaparecerían las versiones vulnerables. No modificar datos ni colas.
- **VerificationGate:** `dependency_upgrade`: instalación, auditoría de ambos
  paquetes, `ci:merge-gate`, suites Functions, runtime PDF, revisión independiente
  y CI del head definitivo. Un fallo de audit impide el merge.

La auditoría posterior conserva hallazgos altos en la cadena de desarrollo de
`braces` 3.0.3, sin versión corregida publicada al comprobarla. Estos parches no
resuelven ese bloqueo ni autorizan excepciones o rebajas del umbral.

Estos mismos parches se incorporan al PR CUDYR #764 para reducir su bloqueo de
auditoría, conservando la dependencia SheetJS y los controles vigentes. El origen
es el PR #738; no se incorporan otros cambios de ese PR. La auditoría remota del
head actualizado determinará los hallazgos restantes. Las consultas locales
frescas al registro npm están bloqueadas por la cadena TLS de la red; resultados
en caché no acreditan disponibilidad actual de versiones. No se desactiva TLS.

### Parches de Sharp y SDK MCP para #764 (2026-10-07)

- **Owner:** plataforma de imágenes y tooling Firebase HHR.
- **Reason:** completar las actualizaciones disponibles de la auditoría; no se ha
  demostrado explotación en HHR.
- **TargetVersion:** Sharp 0.35.5, sus binarios 0.35.5 y libvips 1.3.4; SDK MCP
  transitivo 1.32.1. Se conservan los rangos de los manifests y el SDK Firebase.
- **RiskLevel:** medio: dependencias nativas de imagen y cliente MCP del tooling.
- **RollbackPlan:** revertir este commit y ejecutar npm ci; reaparecen los avisos.
  No modificar censos, credenciales ni permisos.
- **VerificationGate:** instalación limpia, runtime Sharp, carga del tooling,
  ci:merge-gate, navegador/emulador sintético, revisión independiente y auditoría
  remota del head definitivo. No integrar mientras existan altos/críticos activos.

El diagnóstico aislado de GitHub Actions, run 37685292433, resolvió los paquetes
con TLS validado, scripts de instalación deshabilitados y token de sólo lectura.
Se verificaron los SHA-512 de 28 tarballs oficiales en el runner y localmente.
Únicamente esas 28 entradas se trasladan al lockfile; se descartan 16 cambios de
metadatos libc ajenos. La instalación local usa caché por integridad, sin rebajar
TLS. El workflow diagnóstico no se incorpora a este PR ni a main.

La auditoría del árbol resuelto conserva siete paquetes altos en una misma cadena
de braces 3.0.3; el registro fresco sigue publicando esa versión como latest.
Esta evidencia no autoriza una excepción ni un downgrade del plugin de límites
arquitectónicos. Sharp: GHSA-wq5f-xc86-pv6w. SDK MCP: GHSA-6qxp-vccf-f47h.

### Propuesta de sincronización con solo datos de episodio (2026-10-16)

Si todas las actualizaciones quedan ocultas por
sus etiquetas internas, la revisión muestra a los pacientes afectados y «datos
del episodio». Conserva la confirmación manual y la presentación habitual de
planes mixtos. La autoridad de especialidad compara metadatos por sus valores
y tipos, independientemente del orden de las claves de los mapas Firestore.
Cambiar autor, decisión, regla, tipo o valor sigue rechazado; no se amplían
permisos ni se reescriben decisiones. Validar propuesta vacía, metadatos
reordenados/anidados, intentos de falsificación y RN. Cierre: `ci:merge-gate`,
`test:release-confidence`, revisión independiente y CI del head final. Publicar
la función requiere autorización separada y prueba real posterior.

### Exportación DICOM a MP4 (2026-10-17)

- **Owner:** visor radiológico HHR.
- **Reason:** exportar cada corte verificado a un MP4 local con tiempos explícitos,
  sin perder cuadros por grabación de pantalla ni enviar imágenes a un servicio.
- **TargetVersion:** Mediabunny 1.61.6 (MPL-2.0), fijado con integridad en lockfile;
  import dinámico, codificación nativa H.264, sin plugins ni codecs remotos.
- **RiskLevel:** medio: codificación y memoria del navegador, limitada a 64 MiB,
  con cancelación y revisión de privacidad antes de descargar. CSP media-src
  self/blob para vista previa; no se amplían connect-src ni permisos de captura.
- **RollbackPlan:** revertir este PR; no modifica originales, pacientes ni servidor.
- **VerificationGate:** ci:merge-gate, audit, revisión independiente, pruebas
  sintéticas de orden/conteo/duración MP4, cancelación y cierre, CI del head final.

### Parche de Markdown en documentación (2026-10-20)

- **Owner:** tooling y documentación HHR.
- **Reason:** corregir [GHSA-r7fv-28h4-cvq7](https://github.com/advisories/GHSA-r7fv-28h4-cvq7), publicado en la base de avisos el 20 de octubre; bloqueó Security Audit del candidato de cuentas.
- **TargetVersion:** `markdown-it` 14.3.2, override de desarrollo usado por TypeDoc 0.28.15; es el único nodo resuelto que cambia.
- **RiskLevel:** bajo; se mantiene la misma versión mayor y no cambia el grafo de producción ni Functions.
- **RollbackPlan:** revertir el parche; la auditoría volverá a señalar el aviso. No sustituir la corrección por una excepción.
- **VerificationGate:** `dependency_upgrade`: manifiesto oficial, integridad npm comprobada en instalación limpia de CI, generación TypeDoc, regresiones del control de auditoría, hooks y CI del SHA definitivo. Reutilizar controles de runtime clínico cuyos inputs no cambian.

La huella exacta del lock en la excepción preexistente de `braces` se vuelve a vincular al lock corregido tras comprobar que sus siete nodos, versiones, clasificación de desarrollo y dependencias permanecen idénticos. Se conservan el aviso, los resultados sin modificar, el rechazo de otros riesgos altos/críticos y todos los controles de alcance. El riesgo de `braces` no está corregido ni se amplía su aceptación.

### Primer ingreso por RUT y recuperación (20 octubre 2026)

Runtime crítico de autenticación. Verificar clave inicial sin sesión clínica, cambio
obligatorio y correo requerido, credenciales personales con mayúscula/número,
mostrar/ocultar en todas las entradas de clave del flujo, códigos con vencimiento,
cinco intentos persistidos, consumo único concurrente, revocación, suspensión y
respuesta perdida. Reusar protección de identidades/censos/CUDYR sin modificarla.
Gate: `ci:merge-gate`, `test:release-confidence`, `test:accounts:emulator:ci`, revisión
independiente y CI definitivo. Probar envío real requiere despliegue y configuración
separados; el emulador sustituye únicamente el transporte de correo.

Ampliación administrativa solicitada para PR 919: probar roles de activación,
modificación y recuperación sin claims fijos de enfermería; reseteo a clave inicial,
deshabilitar/habilitar sin pérdida de clave, eliminación de Auth sin borrar autorías,
fallos intermedios y suspensión concurrente. Verificar listado de correo solo admin,
confirmaciones de botones y controles antiguos colapsados. Emulator Auth/Firestore/
Storage debe rechazar sesiones previas y escritura del rol de solo lectura.

### Lecturas eficientes de acceso RUT (22 octubre 2026)

Runtime crítico de autenticación. Agrupar IP/cuenta/índice mediante `getAll` conserva
ventanas y contadores, incluido el intento de IP rechazado por cuenta. Verificar
que el índice no se entrega antes del commit ni desde un reintento abandonado y
que un error no continúa al proveedor. La clave personal evita la lectura de
preparación inicial, conservando su revalidación para el primer ingreso y el
estado/lock leído después del proveedor. La limpieza de roles debe respetar el
guard de sesión dentro de la transición serializada. No cambia regiones ni añade
caché de permisos. Conservar los gates de cuentas anteriores y el CUDYR intacto;
rollback mediante reversión de código, sin borrar contadores, sesiones o colas.

### Parches del tooling para PR #922 (2026-10-21)

- **Owner:** tooling y pruebas HHR.
- **Reason:** corregir los nuevos avisos de Storybook, Vitest, Vite y markdown-it que bloquean Security Audit.
- **TargetVersion:** Storybook y su grupo de nueve paquetes 10.6.2, Vitest y su grupo 4.1.12, Vite 6.4.4 y markdown-it 14.3.3. Cambian 22 nodos resueltos. Se conservan Firebase CLI, Functions y las dependencias de producción.
- **RiskLevel:** medio; afecta el servidor y las compilaciones de desarrollo, las pruebas de componentes y TypeDoc.
- **RollbackPlan:** revertir este commit y ejecutar `npm ci`; reaparecerían los avisos corregidos. No modificar credenciales, permisos ni datos clínicos.
- **VerificationGate:** `dependency_upgrade`: instalación limpia sin omitir validación de peers, auditoría de ambos paquetes, regresiones de la excepción, `ci:merge-gate`, compilaciones Storybook y TypeDoc, revisión independiente y CI del head definitivo.

La resolución aislada utiliza TLS válido en GitHub Actions. Los tarballs
oficiales se comprueban por integridad antes de incorporarse a la caché local.
No se desactiva TLS ni se cambia la configuración de confianza del Mac.
La comparación conserva íntegros los siete nodos de la excepción de braces,
incluidas sus dependencias. Sólo se vuelve a vincular la huella del lockfile.
El gate sigue rechazando cualquier aviso alto o crítico adicional.

Fuentes: [Storybook](https://github.com/advisories/GHSA-f2ph-cmg5-wxc8),
[Vite](https://github.com/advisories/GHSA-698v-4r3x-3vcv) y
[markdown-it](https://github.com/advisories/GHSA-vfgh-jcmw-g37q).

La compilación de Storybook detectó imports a componentes movidos y tres
stories de componentes retirados. Las stories conservadas apuntan a las rutas
actuales. Se retiran únicamente ConflictVersionsAdminControl, TraceabilitySummary
y TraceabilityTimeline, sin componente ni referencias productivas vigentes.
No se modifica ningún componente ni contrato clínico. La compilación completa
de Storybook comprueba conjuntamente estas rutas.

La auditoría tras la instalación limpia detectó también los avisos de
`@vitest/mocker` [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)
y [GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp).
El grupo Vitest 4.1.12 los corrige sin modificar el rechazo de causas cíclicas
del control de auditoría.

Los artefactos generados en `storybook-static` quedan fuera de ESLint, igual que
`dist`. Las fuentes de las stories siguen sujetas al lint. La story de dotación
utiliza los props vigentes y conserva los escenarios de dotación poblada y vacía
a través del contexto. La compilación no acredita interacciones de todas las stories.

Storybook desactiva VitePWA mediante su señal `STORYBOOK=true`, sin cambiar
el límite de precaché de la aplicación. El preview importa el CSS global.
La API pública de handoff reexporta `HandoffRow` para que su story respete
la frontera del módulo, sin modificar el componente.

La prueba de correo de recuperación resuelve `googleapis` desde el módulo del
transporte. Esto conserva el aislamiento cuando raíz y Functions tienen sus
propias instalaciones, sin cambiar el envío real ni sus aserciones.

El E2E de recuperación DICOM espera hasta 60 segundos el estado exacto de
23 cortes listos antes de operar el cine parcial. El botón de reintento puede
aparecer mientras otros cortes siguen preparándose. Se mantienen el corte
fallido, los conteos de solicitudes y las comprobaciones de recuperación.

### Cierre de sesión resistente al canal · 22-10-2026

Clasificación: `critical_runtime`. Un error de postMessage no debe detener el
cierre de Firebase y la limpieza ya existente. Preservar generación admitida,
cierre entre pestañas y cola de enfermería. Verificar regresión conductual del
handler, mensajes vigentes, `ci:merge-gate`, `test:release-confidence`, revisión
independiente y CI. Solo retirar APIs cuyo árbol de consumidores esté vacío.

### Ruta regional de acceso por RUT (22 octubre 2026)

- **Owner:** autenticación y Functions HHR.
- **Reason:** cinco pares intercalados mostraron mejor mediana de validación y
  autenticación en Santiago, conservando los diez ingresos correctos y la recarga.
  Permanecen picos iniciales; la muestra no acredita arranque frío ni p95 y cambia
  región y generación conjuntamente.
- **TargetVersion:** `signInWithRutSantiago`, adaptador HTTP Gen2 del callable
  Gen1 existente. Conservar cuenta de servicio Appspot explícita, protocolo,
  errores/CORS y capacidad equivalente. Default West sólo para el proyecto exacto
  `hhr-pruebas`; overrides permitidos US/East/West, flag inválido → US.
- **RiskLevel:** runtime crítico de autenticación. No cambiar verificación de
  credenciales, sesión, reglas, recuperación, otros callables ni CUDYR. Un fallo
  no habilita fallback ni doble envío.
- **RollbackPlan:** fijar `VITE_ACCOUNT_FUNCTIONS_REGION=us-central1` en el
  cliente afectado y reconstruir/reiniciar; quitar el flag selecciona Santiago en
  pruebas. Conservar el endpoint US y no mover datos ni ampliar permisos.
- **VerificationGate:** `ci:merge-gate`, `test:release-confidence`,
  `test:accounts:emulator:ci`, cobertura sensible, binding de servicio/región y
  protocolo HTTP real, revisión independiente y CI del SHA definitivo. Verificar
  endpoint desplegado y censo/sesión tras recarga antes de declarar activo el
  rollout; los tests focalizados o el merge no acreditan disponibilidad.

## Desde ENGINEERING_DEFINITION_OF_DONE.md

### Cuentas RUT: primer ingreso y recuperación

La entrega se valida con `test:accounts:emulator:ci` (Auth/Firestore/Storage y UI
sintéticos) y los gates de runtime crítico. El correo se sustituye en emuladores;
no acredita entrega real. Ver [operación y publicación](../RUT_PASSWORD_RECOVERY.md).

El monitor de cuentas RUT debe conservar todos los roles administrables que
confirma el servidor, incluido Administrador. Probar el control inicial y periódico,
revocación, vencimiento, fallo transitorio y desmontaje; una contraseña aceptada
no acredita una sesión utilizable. La aceptación real requiere leer datos básicos
y recargar contra las reglas efectivamente publicadas en el proyecto de pruebas.

### Fallo de publicación al cerrar sesión · 22-10-2026

El cierre no depende del éxito del canal entre pestañas. Para este cambio de
auth runtime se exige `ci:merge-gate`, `test:release-confidence`, revisión
independiente y CI del head definitivo. La regresión del handler real debe
confirmar signOut, limpieza del propietario y conservación de trabajo pendiente
con BroadcastChannel fallido, sin modificar autoridad clínica ni CUDYR.

### Ruta regional de acceso RUT · 22-10-2026

Para cambiar la ruta regional RUT, comprobar el endpoint Gen2
`signInWithRutSantiago`, su identidad de servicio Appspot explícita y la
compatibilidad HTTP con el callable Gen1: datos/respuesta, CORS, autorización,
entrada inválida y errores. Probar que el valor predeterminado Santiago se limita
al proyecto exacto `hhr-pruebas`, que US/East/West se seleccionan sólo mediante la
allowlist y que un flag inválido usa US. Conservar otros callables, recuperación,
sesión y CUDYR; una respuesta incierta no autoriza fallback ni otro envío.

La aceptación de rendimiento debe conservar todas las muestras y distinguir
medianas, primeros accesos observados, región y generación. Los cinco pares de
la prueba regional orientan el rollout de pruebas; no garantizan arranque frío,
p95 ni tiempo de pintura del censo. Verificar disponibilidad del endpoint y
sesión/censo después de recargar por separado del CI o merge.

Al agrupar lecturas del ingreso RUT, demostrar que sólo sale de la transacción el
índice cuyo commit terminó; cubrir reintento, error de lectura/commit y políticas
de IP/cuenta sin reducir límites. La clave personal debe evitar la lectura de
preparación inicial sin omitir verificación de token revocado ni estado de acceso
posterior al proveedor. Probar que una sesión reemplazada mientras espera el lock
no limpia los resultados de rol del nuevo propietario. No añadir cachés de
autorización, ni presentar menos RPC como solución probada a los arranques en frío.
