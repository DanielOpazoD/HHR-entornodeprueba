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
   login o shell autenticado. El shell se importa con `lazyWithRetry`.
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
npx vitest run src/tests/views/census/PatientRowOrbitalQuickActions.visibility.test.tsx src/tests/views/census/PatientRowOrbitalQuickActions.behavior.test.tsx src/tests/views/census/patientRowOrbitalLauncherRuntimeSupport.test.ts src/tests/features/cudyr/cudyrPending.test.ts
```

For a new comparable baseline, use `npm run test:e2e:census-performance` with the
same environment, sample count, record fixture, Node/lockfile and cache policy.
Diagnostic profilers must be local and removed before the merge gate. The normal
production build and remote CI determine readiness; profiler build payloads are
not release-budget evidence.
