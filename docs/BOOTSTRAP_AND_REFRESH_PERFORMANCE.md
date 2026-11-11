# Arranque y recarga: guía vigente

Revisada el 04-10-2026 sobre `48961735`. Esta guía orienta el diagnóstico;
el código, los contratos y los scripts del checkout son la fuente de verdad.

## Contratos y responsables

- [Comportamientos del sistema](./system-behaviors.md): contrato de login y F5.
- [Modelo de acceso](./AUTH_ACCESS_MODEL.md): sesión, roles y autorización.
- [Recuperación de auth](./ADR_AUTH_RUNTIME_RECOVERY.md): estados y recuperación.
- [Recuperación operativa](./RUNBOOK_INDEX.md): elegir el procedimiento del incidente.
- [Gates y fallos](./CI_GATES_AND_FAILURE_RUNBOOKS.md): validación según el cambio.

Para seguir el arranque en código:

1. `src/app-shell/bootstrap/bootstrapAppRuntime.ts` prepara el runtime.
2. `src/App.tsx` consume `useAppBootstrapState` y decide la superficie de carga,
   login o shell autenticado. El shell reutiliza su dependencia estática; las vistas
   y herramientas secundarias conservan sus cargas diferidas.
3. `src/app-shell/bootstrap/appShellLoadingPolicy.ts` decide la presentación
   de carga; `BootstrapCensusChrome.tsx` contiene el chrome provisional.
4. `src/services/auth/authSession.ts` y `authRuntimeSnapshot.ts` definen los
   contratos de sesión y estado operativo. Un usuario Firebase presente no
   sustituye la autorización por rol.
5. `src/shared/runtime/perfAudit.ts` y `perfAuditReport.ts` contienen la
   instrumentación y el reporte de rendimiento existentes.

El chrome visible no demuestra que el registro clínico esté listo. Distinguir
carga de módulos, resolución de sesión/rol y disponibilidad del censo al medir.

## Diagnóstico reproducible

Comparar el mismo flujo, fecha sintética, perfil de autenticación, estado de caché,
versión de Node, lockfile y entorno. Separar desarrollo de build productivo y
primera carga de recarga. Registrar SHA, comando, resultado y limitaciones.
No comparar tiempos de sesiones distintas como si fueran una prueba controlada.

- Diagnóstico de bundle: `npm run build` y `npm run ci:preview-gate`.
  El segundo usa el build existente y verifica presupuesto, grafo y preview.
- Medición sintética de flujos: `npm run test:e2e:flow-performance:gate`.
- Cierre de un cambio de arranque: seguir el gate y las pruebas de login/F5 de
  [SAFE_CHANGE_CHECKLIST.md](./SAFE_CHANGE_CHECKLIST.md), sin repetir sus etapas.

No aumentar presupuestos, reintentos o timeouts para ocultar una regresión.
El shell y su incremento equivalente de precaché mantienen holgura medida
(autorización 2026-11-11): repetir la comparación del censo al superar ~97 %
de uso, conservando NEAR-LIMIT. Evidencia y reversión en
[BUNDLE_RISK_LEDGER.md](./BUNDLE_RISK_LEDGER.md).
No trasladar código de snapshots antiguos sin revisar el contrato vigente.

## Referencia histórica

El [playbook de portabilidad conservado en Git a 48961735](https://github.com/DanielOpazoD/HHR-entornodeprueba/blob/48961735ffad9912cf06d61379051a6901627f8e/docs/BOOTSTRAP_AND_REFRESH_PERFORMANCE.md)
contiene el análisis de versiones anteriores, código inline y la comparación con
“copia 14”. Es evidencia histórica, no una receta aplicable al checkout actual.
Sus estimaciones y mediciones no describen el rendimiento de la versión vigente.
La referencia conserva el contenido sin mantener otra copia de código en las guías.

## Build environment and startup size

Compare the same commit, lockfile, Node version and environment profile before
attributing a bundle-size change to code. A normal local build reads personal
dotenv files; CI has no such files. Never include their values in reports.

Client configuration readers must use explicit `import.meta.env.VITE_*` accesses.
Reading the whole object makes Vite embed unrelated settings in that consumer,
including optional feature configuration that belongs outside startup. Keep the
validator schema intact when narrowing reads.

On the 2026-10-03 baseline (`a303c302`), identical local dependencies produced a
630,040-byte authenticated shell with the local environment versus 627,734 bytes
without dotenv. Narrowing the two full-object readers reduced the configured
local shell to 629,561 bytes, below the unchanged 630,000-byte limit. This measures
bundle bytes, not a demonstrated improvement in user-visible startup latency.

The focused regression check compiles the real configuration readers with Vite,
without personal dotenv files or the application build configuration:

```sh
npx vitest run src/tests/build/clientEnvironmentBundle.test.ts
```

It preserves both reader entry points, asserts that their synthetic consumed
settings remain in the output, and rejects an unrelated synthetic setting. This
protects against accidental whole-environment serialization without snapshots of
configuration values, another CI job, or a full application build per test. The
existing unit suite discovers it automatically. Continue to use the full build
budget and flow-performance gates for bundle size and user-visible timings;
this narrow regression check does not replace either one.

## Census pointer and CUDYR profiling (2026-10-11)

Owner: Census UI. Baseline: `c8265492`; Node 22.22.2. Measurements used the
existing synthetic full-census cohort (19 occupied main rows and two clinical
cribs), isolated storage, demo Firebase configuration and blocked remote writes.
Chrome Performance and a temporary production React profiling build were used;
the application source retains no profiling callbacks or clinical telemetry.

| Operation                                  | Baseline                  | Candidate         | Meaning                                                                        |
| ------------------------------------------ | ------------------------- | ----------------- | ------------------------------------------------------------------------------ |
| Move pointer into one diagnosis control    | 21 row-bound reads        | 2 row-bound reads | Avoid probing unrelated rows; retain the external left-gutter path             |
| Resize with unchanged launcher coordinates | 20 React Profiler entries | 0 entries         | Do not schedule position updates with identical coordinates                    |
| 2,000 CUDYR status resolutions             | 334.63 ms median          | 33.73 ms median   | Seven alternating paired runs of the pure function; identical output checksums |

The formatter result is a local microbenchmark, not an application speedup.
It reuses the canonical clinical-clock `Intl.DateTimeFormat` instance, never the current time or eligibility
result. Repeated winter/summer calls still cross the 11:59/12:00 boundary in
`Pacific/Easter` correctly.

The diagnostic Chrome captures identified the decorative navbar image as LCP;
it does not prove populated census readiness. Capture timings varied between
runs, so no before/after startup latency claim is made. The existing populated
census paint-opportunity and interaction measurements remain the acceptance
signals; their budgets, auth checks and observation semantics are unchanged.

Focused behavior checks:

```sh
npx vitest run src/tests/views/census/PatientClinicalAccess.test.tsx src/tests/features/cudyr/cudyrPending.test.ts
```

For a new comparable baseline, use `npm run test:e2e:census-performance` with the
same environment, sample count, record fixture, Node/lockfile and cache policy.
Diagnostic profilers must be local and removed before the merge gate. The normal
production build and remote CI determine readiness; profiler build payloads are
not release-budget evidence.

## Confirmación del rol fuera del camino de F5 (02-11-2026)

El responsable midió en producción 2,4–3 s hasta ver filas después de F5, con
0,7–0,8 s bloqueados por `checkUserRole`. La decisión aprobada permite usar la
confirmación de la misma cuenta durante la recarga y comprobarla en segundo plano;
ver [el contrato de acceso](AUTH_ACCESS_MODEL.md). Sin confirmación vigente se
mantiene la espera. No se usa el caché histórico por correo para admitir una cuenta.

Estas cifras son la evidencia de entrada aportada por el responsable, no resultados
del cambio. Las pruebas sintéticas verifican el orden de admisión y confirmación,
revocación, fallo temporal, expiración y aislamiento; el efecto sobre los tiempos
hasta filas requiere una medición comparable después de publicar.

El responsable midió además unos 0,7 s en la consulta de rol posterior al ingreso
por RUT. El callable ahora puede devolver el rol usando el documento y token ya
verificados, y el cliente evita esa consulta si coincide la cuenta Firebase.
Respuestas antiguas mantienen el camino de consulta. Esta eliminación se verifica
con transporte sintético y el escenario de cuentas en emuladores; no constituye
una medición de latencia en producción.

## Import redundante del shell autenticado — 2026-11-02

Métrica objetivo: **fin de `auth-role:lookup-done` → `table_paint_opportunity`**.
Se conserva una sola optimización: `App.tsx` importa `AuthenticatedAppShell`
estáticamente en vez de volver a envolverlo en `lazyWithRetry`. No cambia la
admisión de sesión, los permisos, las lecturas/escrituras ni la sincronización.
Las vistas secundarias y sus recuperaciones de chunks permanecen diferidas.

Causa medida: el bundle de App ya dependía estáticamente del chunk
`app-authenticated-shell` por sus otros consumidores. En el control, ese chunk
terminó de descargarse antes de App y antes de resolver el rol. Su segundo import
asíncrono suspendía el montaje y lo enviaba al reintento diferido de React. En 20
recargas, la diferencia observada `auth:ready` → inicio de visita fue 307,8 ms p50
y 312,8 ms p95. En la candidata ambos efectos pertenecen al mismo commit; el
offset observado es −0,2/−0,1 ms por el orden hijo/padre de los efectos, no una
lectura anterior a la autorización.

Entorno: Node 22.22.2, Chromium 143.0.7499.4, macOS arm64, lockfile del checkout,
builds Vite de producción con el mismo entorno demo. Base: `8e5bb9315`. Un único
contexto efímero, viewport 1280×720, es-CL, Pacific/Easter, HTTP cache deshabilitado
por routing y service workers bloqueados. Se alternaron 20 pares control/candidata,
tras una recarga de calentamiento excluida por variante, sin eliminar muestras ni
reintentar. El control conserva cuatro marcas temporales de importación; no lleva
otras modificaciones de producto. La candidata se compiló desde la fuente final,
sin esas marcas. No se comparan las corridas preliminares bajo carga con estos pares.

Fixture: 18 camas regulares sintéticas ocupadas, sin extras activas ni cunas.
Auth usa el emulador `demo-hhr-e2e`; ingreso y rol callable tienen respuestas
simuladas. Producción elimina las conexiones DEV a emuladores, por lo que el
banco temporal dirigió solo los transportes Auth del SDK a loopback. Tras resolver
la sesión se sembró IndexedDB **real**, sin `__HHR_E2E_OVERRIDE__`; cada muestra
exigió paciente visible y `local_record_available`. Firestore y el resto de la red
externa estuvieron bloqueados. Los intentos de confirmación remota de este banco
no funcionaron y no son evidencia de lectura ni autorización remotas.

| Señal, ms (p50 / p95 nearest-rank)                          |       Control |     Candidata |
| ----------------------------------------------------------- | ------------: | ------------: |
| Rol resuelto → oportunidad de pintura                       | 389,0 / 392,6 | 111,3 / 135,3 |
| Navegación → oportunidad de pintura                         | 555,6 / 570,9 | 285,3 / 324,7 |
| Mayor lectura individual de `dailyRecords` antes del commit |     3,1 / 5,4 |     2,6 / 4,4 |
| Registro observado → oportunidad de pintura                 |   12,9 / 15,5 |   59,7 / 79,9 |

La métrica objetivo mejora **277,7 ms p50 y 257,3 ms p95**, por encima de 100 ms.
Todas las parejas mejoran; no se afirma significancia estadística ni una mejora
ya publicada. El último offset aumenta porque el registro local se observa antes
mientras termina de cargarse la vista: no es una regresión de la lectura de IndexedDB.

Dos trazas adicionales, excluidas de las muestras, separaron espera y trabajo del
hilo principal. En ventanas rol→pintura de 388,5 ms y 149,1 ms, la unión de intervalos
`RunTask` ocupó 143,4 y 147,5 ms; `FunctionCall`/`EvaluateScript`/`V8.Execute`, 81,9
y 95,1 ms; layout/estilos, 24,5 y 23,9 ms. Estas categorías se solapan y no se suman.
Son tiempo de tareas observado, no CPU exclusiva ni un profiler de React. La mejora
proviene de retirar espera; no se atribuye a menos parsing, menos render ni menos
lecturas. La oportunidad double-rAF tampoco demuestra pintura física de píxeles.

Pares completos, rol→pintura, ms (control / candidata):

```text
390.1 / 100.5    388.5 / 116.0    389.0 / 112.1    390.9 /  98.9
388.5 / 111.3    390.3 /  99.2    388.6 /  97.3    386.1 / 100.1
397.1 / 110.7    390.9 / 144.2    380.1 / 119.1    382.4 / 130.1
377.6 / 108.3    390.3 / 105.2    392.6 / 124.4    392.0 / 130.4
389.4 / 129.9    389.3 / 131.1    384.6 / 135.3    379.1 / 110.2
```

No se retiran POST de telemetría, el segundo `version.json`, `firebase-config`,
`runtime-contract` ni el catálogo Moa: este fixture no mide sus respuestas reales
y no aporta una mejora causal de 100 ms o 20 KB que justifique hacerlo. Tampoco se
dividen chunks ni se toca el camino de IndexedDB. No se subieron presupuestos.
Los tiempos locales no acreditan los 0,6–0,9 s observados en producción ni el efecto
de #1161; se necesita observación posterior a una publicación autorizada.

Validación local de la candidata:

- `npm run typecheck` (ambos tsconfig), `npm run lint`,
  `check:test-governance`, `check:module-size`, `check:import-cycles`,
  `check:architecture`, build de producción y `check:bundle-budget`.
- 153 pruebas pasan en siete archivos: `AppLoadingBehavior`, `index.bootstrap`,
  `perfAudit`, `chunkingPolicy`, `pwaPrecachePolicy`, `pwaPrecacheGraph` y
  `authenticatedRoutePreloadController`.
- `npm run test:e2e:census-performance`: build nuevo, 30+30 muestras, sin baseline
  comparativo. Navegación→pintura p95: 724,1 ms en recargas y 977,5 ms en contextos
  nuevos; ambos dentro de 2.000 ms. Es el fixture en memoria del banco oficial,
  distinto del fixture de IndexedDB real usado en los pares anteriores.
- `npm run test:e2e:flow-performance:gate`, con `PLAYWRIGHT_SKIP_PREVIEW_BUILD=1`
  y el build productivo ya validado: todos los límites aprobados. Censo visible
  590,5 ms; registro listo 55,8 ms; cierre de sesión→login 147,6 ms.

Las dos primeras preparaciones del banco agotaron sus esperas de servidor de
240 y 600 s mientras el equipo ejecutaba otras cargas, antes de obtener muestras.
El diagnóstico posterior con aquel artefacto y carga concurrente tuvo p95
3.165/4.104 ms y no aprobó el límite de pintura: no se usa como control de esta
mejora. Las compilaciones y los dos gates finales de arriba sí finalizaron.
La instrumentación y el banco temporal no forman parte del cambio publicado.
