# Banco de medición de arranque del censo (PR1)

## Escenarios y seguridad

Configuración independiente: `playwright.census-performance.config.ts`. Chromium,
un worker, cero reintentos. Por defecto compila **producción** nuevamente mediante Vite
en `node_modules/.cache/census-performance-dist`; development se solicita explícitamente.
No reutiliza servidores ni builds existentes. Servidor loopback dedicado: puerto 4318.
Ambos escenarios navegan por la ruta canónica `/census?date=…`, nunca `/censo`.

30 muestras por escenario, más una navegación de calentamiento excluida:

- `warm_reload`: mismo contexto efímero, recargas que conservan almacenamiento sintético.
- `cold_context`: contexto efímero nuevo por muestra, sembrado antes de navegar. No es
  navegador/proceso/OS/servidor frío ni visita sin datos locales. Se ejecuta después de
  warm, por lo que el servidor y sus módulos ya están calientes.

**El routing de Playwright deshabilita HTTP cache en ambos escenarios.** Warm significa
contexto/almacenamiento reutilizado y aplicación/servidor precalentados, no HTTP cache.
Service workers bloqueados; viewport 1280×720, locale es-CL, timezone Pacific/Easter.
No se borra almacenamiento del usuario ni se usa su perfil.

Fixture declarado: `isolated-synthetic-no-real-auth-v1`. Utiliza el constructor canónico
de registros existente, pero NO el helper de preview Firebase, que lee `.env.production`,
`.env` y `.env.local`. El servidor dedicado deshabilita `envDir` de Vite y elimina variables
heredadas antes de cargar su configuración; configura exclusivamente un proyecto demo.
Se bloquea tráfico externo, funciones Netlify excepto la respuesta Firebase-config
sintética, métodos diferentes de GET/HEAD y WebSockets externos. Solo HMR local permitido.

Este fixture usa `__HHR_E2E_OVERRIDE__`, que activa el repositorio E2E, no el transporte
real IndexedDB/Firestore. **NO auth Google real, NO emulador, NO latencia remota.** Se
revisaron fixtures existentes y scripts CI de emuladores Firestore/Storage: no se reutilizan
como evidencia de auth real porque también inyectan sesión. El escenario emulador
complementario de abajo usa proyecto demo y endpoints loopback, con contrato separado.

## Comprobación complementaria con emuladores

`npm run test:e2e:census-remote-performance` levanta Auth y Firestore locales con
el proyecto `demo-hhr-e2e`. Crea una cuenta y un registro **sintéticos**, inicia
sesión mediante Firebase Auth y exige que la fila aparezca tras una confirmación
de servidor (`remote_confirmed`). La consulta de rol se responde con una función
simulada porque este comando no levanta el emulador de Functions; la sesión Auth y
la lectura Firestore sí usan sus emuladores. El test elimina usuario y documento
al terminar. Bloquea peticiones del navegador fuera de loopback salvo la función
de rol simulada.

Adjunta al reporte `reports/e2e/census-remote-performance.json` de Playwright tres
duraciones: inicio de bootstrap
hasta confirmación remota, hasta oportunidad de pintura de la tabla e inicio de
visita hasta confirmación remota. No guarda nombres, correos ni datos clínicos.
Es **una muestra de diagnóstico**, en Vite development, sin presupuesto ni
baseline; no se compara con los 30+30 casos sintéticos de producción. Su función
es impedir que llamemos «lectura remota» a un fixture en memoria y ofrecer un
recorrido reproducible antes de optimizar una causa medida. CI ejecuta este test
funcional en el job `e2e-critical`; sus tiempos son observacionales, sin gate
numérico.

## Readiness e instrumentación

Opt-in `localStorage.hhr_perf_audit=1` antes de navegación. La aplicación debe exponer
`window.__HHR_CENSUS_PERF__` schemaVersion 1; el test jamás genera eventos sustitutos.
Se exige tabla visible y R1 `input[name="patientName"]` visible con valor sintético exacto,
antes de consumir paint y nuevamente antes de recolectar. EmptyDayPrompt NO califica.

Eventos obligatorios: navigation `auth:ready`, `bootstrap:start`; exactamente un visit
con `record_available`, `table_commit`, `table_paint_opportunity`, tiempos finitos,
no negativos, posteriores o iguales al startedAt de su visit, en el dominio
`performance.now()`. Record debe preceder o igualar commit, y commit debe preceder o igualar paint:
el observador de tabla real registra disponibilidad si es su primer consumidor.
No se exige orden entre auth:ready y paint: los efectos se observan por separado. IDs únicos en todas las
muestras, sin scopes incompletos ni authAttempts inesperados. `timeOrigin` es metadata,
no se resta de performance.now. `local_record_available` es opcional, separado del
record genérico: su ausencia no se convierte en cero ni en confirmación remota.
**Cualquier `remote_confirmed` se rechaza**: tráfico remoto bloqueado y sin auth real
no pueden probar confirmación de servidor, incluso si el evento contiene un número válido.

Paint = **oportunidad double-rAF visible, no garantía de pintura física**. Métricas:

- origen de navegación → paint opportunity;
- inicio de visit → record disponible;
- diferencia observada entre record disponible y paint opportunity: incluye montaje
  y espera de frame. Es diagnóstico, NO duración de una consulta ni gate de regresión.

JSON raw solo contiene campos de timing permitidos; IDs son hashes. No se exportan
registros, nombres, fechas clínicas, correos, URLs, tokens ni capturas DOM. Summary omite
IDs y timeOrigin. Trace, video y screenshots desactivados. Se escribe solo tras validar
todas las muestras. Si output existe se falla, no se reutiliza ni borra automáticamente.

## Comandos

Scripts integrados: `npm run test:e2e:census-performance` y `npm run test:census-performance-report`.

El comando oficial de interacciones pasa también el proceso de Playwright por
`scripts/config/criticalE2EEnvironment.mjs`: las variables frontend heredadas se
sustituyen por valores demo. El servidor ya aislaba su entorno, pero aislar sólo
ese proceso dejaba al lector de configuración del test expuesto a dotenv locales.
Usar el comando npm, no invocar directamente su configuración de Playwright desde
una shell personal. Se mantienen el rechazo de proyectos no demo y el bloqueo de
red externa; no se borra ni modifica la configuración del desarrollador.

El banco complementario `npm run test:e2e:census-interactions` usa el mismo servidor aislado
con un censo sintético de 18 camas regulares ocupadas, una cama extra activa y dos cunas clínicas.
Verifica los 21 pacientes renderizados antes de cada muestra, incluyendo filas con y sin signos
vitales y dispositivos. Mide cinco aperturas del editor de diagnóstico y del panel clínico;
`test-results/census-interactions/summary.json` conserva tiempos, nombres de acción y recuentos
de la cohorte. La etiqueta `isolated-synthetic-full-census-v1` distingue esta medición del banco
anterior de un paciente: sus tiempos no se mezclan. El banco de arranque y sus presupuestos
permanecen independientes y conservan su fixture y tamaño de muestra.
El resultado es una señal de comparación, no un presupuesto de aprobación: cinco muestras no
justifican un umbral estadístico y el doble `requestAnimationFrame` indica oportunidad de pintado,
no presentación física de píxeles. CI lo adjunta al artefacto de performance de producción.
CI ejecuta development y production y exige ambos en `ci-summary`. El archivo
`e2e/census-startup.measurement.ts` solo se descubre con su configuración dedicada,
no desde suites genéricas que usan otros servidores. Ejecutar desde raíz:

```sh
node --test scripts/tests/census-startup-performance-report.test.mjs
npx playwright test --config playwright.census-performance.config.ts --list

# SOLO smoke de cableado, no baseline válido.
CENSUS_PERF_ENV=development CENSUS_PERF_SMOKE=1 CENSUS_PERF_SAMPLES=2 \
  CENSUS_PERF_OUTPUT=reports/e2e/census-dev-smoke-unique.raw.json \
  npx playwright test --config playwright.census-performance.config.ts

# Medición real de 30+30, elegir runner verdaderamente estable y output nuevo.
CENSUS_PERF_ENV=production CENSUS_PERF_RUNNER=ci-linux-x64-fixed \
  CENSUS_PERF_OUTPUT=reports/e2e/census-production-unique.raw.json \
  npx playwright test --config playwright.census-performance.config.ts

node scripts/census-startup-performance-report.mjs \
  reports/e2e/census-production-unique.raw.json \
  reports/e2e/census-production-regenerated.summary.json
```

`CENSUS_PERF_SAMPLES` default 30; menos exige `CENSUS_PERF_SMOKE=1`. Todo smoke tiene
`baselineValid:false`, `gate:not-baseline-smoke`; su éxito no reemplaza CI de medición.
Dependencias de build y binarios Playwright deben estar instalados.
`CENSUS_PERF_EXECUTABLE_PATH` permite seleccionar un Chromium local ya verificado;
si no se define, CI conserva el ejecutable predeterminado de Playwright. No añade
argumentos que debiliten aislamiento, cookies ni controles del navegador.

## Gates y comparación honesta

Gate estructural obligatorio: cuentas/índices exactos, finitud, IDs únicos, visit completo,
entorno correcto y DOM poblado visible. Sin descartar outliers, omitir muestras, retries o
imputar cero. p50/p95 nearest rank: posición `ceil(p*n)` ordenada; n=30 usa rangos 15/29.
También se informa máximo. Gate temporal sobre p95.

**Solo production build/preview** aplica budgets existentes `scripts/config/flow-performance-budgets.json`,
sin overrides de entorno ni aumentar valores:

- navigation→paint usa `censoVisibleMs.enforcedMaxMs` (actualmente 2000 ms);
- visit→record usa `censoRecordReadyMs.enforcedMaxMs` (actualmente 5000 ms).

Son **límites existentes aplicados a fronteras nuevas más estrictas**, NO comparación
histórica contra `waitForCensoReady`/empty prompt o `ensureRecordExists`. No reemplazar
reports ni gates legacy. **Development no aplica estos ceilings del preview de producción**.
Sin baseline devuelve `gate:structural-only` y
`budgetPolicy:development-no-production-budget`; valida íntegramente estructura/DOM,
sin fingir aceptación del presupuesto de producción. Con baseline development comparable
aplica únicamente el gate de regresión. Producción siempre conserva sus límites absolutos,
incluso cuando el baseline también excede los límites. Nunca mezclar entornos ni subir límites.

Baseline opcional: `CENSUS_PERF_BASELINE=/ruta/baseline.raw.json`, o tercer argumento del
CLI. Debe coincidir contract, environment, fixture, runner, browserVersion, platform y
sample count; smoke/incomplete se rechaza. Comparación explícita exige delta p95 ≤0 ms
en navigation→paint y visit→record, sin inventar tolerancias; el offset firmado
record/paint se compara descriptivamente, nunca como gate de duración causal. No es prueba de significancia estadística.
La etiqueta runner no verifica hardware/carga/configuración: el operador debe igualarlos.
Recolectar baseline genuino y estabilizar runner antes de imponer este gate adicional.
Cualquier tolerancia futura necesita datos y revisión, no umbrales inventados.

## Evidencia de implementación

- 32 tests del validador pasan, incluyendo muestras faltantes, NaN, scopes/IDs duplicados,
  incomplete, mismatch de entorno/baseline, smoke y lectura de budgets existentes.
  Cubren también gates development/production distintos, rechazo de confirmación remota
  ficticia y orden de observación realista con scopes temporales válidos.
- `npx tsc --noEmit --pretty false` pasa sin errores.
- Playwright discovery identifica 1 test de medición con 30 muestras por escenario.
- Smoke development intentado: servidor arrancó, pero Chromium no pudo iniciar por
  `MachPortRendezvousServer: Permission denied (1100)` del entorno de ejecución.
- **No hay ejecución integrada válida ni cifras p50/p95 reales de la aplicación.** No se
  inventan reportes ni mejoras. Ejecutar en runner con permiso para lanzar Chromium una
  vez integrada la instrumentación.

## Captura en la aplicación real

La instrumentación se habilita en development o mediante `hhr_perf_audit=1` en producción.
El reporte nuevo contiene IDs aleatorios por navegación/intento y eventos permitidos.
No incluye claves internas del día, registros, detalles libres ni rutas. Retiene como máximo
10 visitas y 20 intentos. El reporte antiguo ya no calcula latencias de login mezclando
primeras marcas de intentos distintos. Su formateador es un chunk opcional fuera del
precache: perderlo offline no afecta captura estructurada ni funcionalidad clínica.

El commit se comprueba sobre la tabla real, y la oportunidad de pintura sobre su
visibilidad (incluida opacidad cuando checkVisibility está disponible). Se cancelan
frames al desmontar o cambiar día; una observación oculta no certifica pintura.
La respuesta remota solo se registra para el día observado y un documento existente
con `fromCache=false` y `hasPendingWrites=false`. Esto prueba respuesta del servidor,
no ausencia de conflictos ni convergencia clínica.

Una comprobación funcional en Aside/localhost con sesión real verifica estos hitos
sin modificar pacientes. No sustituye las 30 muestras aisladas ni mide login Google
real automáticamente. Es evidencia complementaria, no baseline de rendimiento.

## Esperas de observación frente a presupuestos

La espera de readiness (`CENSUS_PERF_READINESS_TIMEOUT_MS`, 60 s por defecto; el triple en
la navegación de calentamiento excluida) existe para **poder observar** un arranque lento.
No es un presupuesto: los veredictos siguen saliendo de p95 contra
`scripts/config/flow-performance-budgets.json`, que no se modifica. Si la espera fuera corta,
una aplicación lenta fallaría por timeout y jamás quedaría medida; ese fue el fallo real
observado en development sobre un servidor de desarrollo recién iniciado, donde la primera
navegación debe compilar todo el grafo de módulos. En este equipo ya se habían medido
recargas de hasta 27,7 s con servidor caliente, por encima de la espera anterior de 20 s.

Cuando la tabla no llega a estar poblada, el banco adjunta un estado estructural de pantalla
(login, día vacío, tabla presente, filas, estado del documento) para distinguir un fallo de
sesión de una compilación lenta. Se conservan captura y traza solo en fallo; el fixture es
sintético, sin pacientes ni credenciales reales. El tiempo máximo del job de CI es un techo,
no una expectativa.

## Continuidad al ingresar y recargar (1 octubre 2026)

En Chrome local con sesión real en `hhr-pruebas`, una recarga reproducía tres
montajes DOM distintos de la cabecera del censo: el primer render, una readmisión
de la sesión restaurada y la inserción tardía del proveedor de recordatorios.
El HAR asociado mostraba una sola navegación; no era una segunda descarga del
documento. La instrumentación temporal midió identidad de nodos y estados de
auth, sin contenidos clínicos, y se retiró antes del commit.

La resolución directa de auth y el primer evento del observer pueden representar
la misma sesión. Se omite solamente ese primer eco autorizado si coinciden UID,
perfil, rol y especialidades. La admisión original sigue esperando el almacenamiento;
no se omiten cambios de permisos, identidad, eventos posteriores ni revocaciones.
El contexto ligero de recordatorios permanece montado desde el primer render y
recibe el valor del runtime diferido sin envolver de nuevo la interfaz clínica.
Si ese chunk opcional falla, el censo permanece utilizable.

La comprobación local posterior observó un solo montaje de la cabecera. Esto
acredita continuidad de la interfaz en el recorrido probado, no un porcentaje de
mejora de latencia ni un resultado equivalente en cada navegador o despliegue.
Las regresiones automatizadas comprueban identidad DOM, conservación de un
borrador, actualización de recordatorios, fallo del chunk y las barreras de
admisión/cierre de sesión.

## Revisión del coste de CI — 2026-10-02 (America/Santiago)

Se revisaron tres ejecuciones de `main`:
[37081755881](https://github.com/DanielOpazoD/HHR-entornodeprueba/actions/runs/37081755881),
[37081345404](https://github.com/DanielOpazoD/HHR-entornodeprueba/actions/runs/37081345404) y
[37078273780](https://github.com/DanielOpazoD/HHR-entornodeprueba/actions/runs/37078273780).
La etapa de medición en development duró respectivamente 471, 698 y 898 segundos;
fue el principal coste observado. Son observaciones históricas, no un presupuesto
nuevo ni el tiempo esperado de cada ejecución futura.

El banco conserva un solo servidor, un calentamiento excluido y navegaciones
secuenciales con 30 muestras por escenario en pushes. No hay una espera fija ni
un build repetido por muestra que retirar. No se cambió el banco para reducir su
tiempo: paralelizar muestras, activar HTTP cache o reducirlas alteraría el contrato.
Una optimización posterior debe investigar el arranque de la aplicación con
mediciones comparables; no atribuir al CI un ahorro obtenido cambiando la prueba.

## Lecturas del cuadro de copia bajo demanda — 2026-10-03

`useCensusLogic` habilita `useCensusPromptState` solamente cuando no existe un objeto
`beds`, la misma condición que selecciona `EmptyDayPrompt`. Con un registro cargado
no se consultan el día previo ni las fechas recientes para un cuadro invisible, y
no se escuchan cambios de almacenamiento destinados a refrescar ese cuadro.
Al pasar a un día vacío vuelven a ejecutarse ambos lectores existentes; se conservan
sus fallbacks, límites y controles de acceso. Una lectura ya iniciada no se cancela
en el repositorio, pero su respuesta se descarta si deja de ser pertinente.

La regresión `src/tests/hooks/useCensusPromptState.test.ts` reprodujo cinco
invocaciones del lector de día previo durante montaje, cambio de día, remontaje
(equivalente al ciclo del hook tras F5) y eventos de almacenamiento, aun sin necesitar
el cuadro. Después del cambio exige cero invocaciones de ambos lectores en ese
recorrido, y verifica reactivación y aislamiento por fecha. Es evidencia de trabajo
eliminado en el hook, no una medida de segundos ahorrados en F5 ni de latencia remota.
Los bancos de navegador mantienen sus escenarios y presupuestos sin cambios.

## Observación local del 03-10-2026

Referencia histórica, no estado vigente ni comparación antes/después de velocidad.
Node 22.22.2, Chromium 143.0.7499.4, macOS arm64, un worker y cero reintentos:

- Arranque sobre `f936e28e`: 30 muestras por escenario, p95 de navegación a
  oportunidad de pintura de 611,6 ms en `warm_reload` y 751,2 ms en `cold_context`.
  Ambos cumplieron el presupuesto de 2.000 ms. Este fixture no mide autenticación
  real ni confirmación remota de Firestore.
- Interacciones sobre el código de aplicación de `a3cf5463`, con el comando aislado:
  19 camas y dos cunas, cinco muestras por acción. Diagnóstico p50/p95: 25/33 ms;
  panel clínico: 322/324 ms. Se ejecutó con variables `VITE_FIREBASE_*` externas
  sintéticas y el comando las sustituyó por su entorno demo.
- El comando anterior se detenía antes de navegar al encontrar la configuración
  personal desde el proceso del test; el servidor ya estaba aislado. Reutilizar el
  runner existente resolvió esa incompatibilidad sin retirar la protección.

Estas muestras no demuestran un cuello de botella de red ni justifican otra caché,
precarga o reorganización de módulos. El siguiente diagnóstico de lentitud real
requiere sesiones autorizadas que midan la etapa remota; no extrapolar estos
resultados sintéticos ni presentar la variación entre ejecuciones como una mejora.
