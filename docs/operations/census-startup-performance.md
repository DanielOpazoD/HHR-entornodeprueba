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
como evidencia de auth real porque también inyectan sesión. Un futuro escenario emulador
debe usar proyecto demo, endpoints loopback y contrato/baseline independiente.

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
