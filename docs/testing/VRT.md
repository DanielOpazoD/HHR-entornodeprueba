# Visual Regression Testing (VRT)

Cómo se usa Playwright `toHaveScreenshot` en este repo, qué cubre hoy, qué falta y cómo regenerar baselines sin romper CI.

## Alcance actual

Spec único: [e2e/visual-regression.spec.ts](../../e2e/visual-regression.spec.ts).

Baselines versionados en [e2e/visual-regression.spec.ts-snapshots/](../../e2e/visual-regression.spec.ts-snapshots/), tres por escenario (chromium/firefox/webkit en darwin):

| Escenario                     | Riesgo cubierto                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `login-view`                  | Cambios en branding/layout del login (primer punto de contacto clínico)               |
| `census-dashboard`            | Tabla principal del censo con datos inyectados; protege densidad y orden de columnas  |
| `hospital-3d-map`             | Vista 3D del hospital (Three.js); detecta regresiones de iluminación, modelo o cámara |
| `patient-demographics-dialog` | Modal de datos del paciente; superficie de mayor uso clínico                          |

Datos inyectados vía `__HHR_E2E_OVERRIDE__` y `hhr_e2e_bootstrap_user` (no toca Firebase).

## Gaps codificados como `test.fixme`

El audit (PDF P1-2) marca como críticos los siguientes flujos que aún no tienen baseline. Están declarados en el mismo spec con `test.fixme` para que cualquier siguiente pase de VRT los descubra automáticamente:

- **Destructive confirm dialog (warning variant)**: `useConfirmDialog` con `variant: 'warning'` — usado en `ConsolidationManager` (Optimizar BD). Verifica paleta + copy + botones.
- **Destructive confirm dialog (danger variant)**: `useConfirmDialog` con `variant: 'danger'` — usado en `ErrorDashboard` (Limpiar Registro) y `CancelTransferModal`. Verifica paleta peligrosa + irreversibilidad.
- **Medical handoff signed view**: vista de entrega médica firmada. Debe mostrar firmante, audit banner y lock visible bajo presión.

## Comandos

| Comando                   | Cuándo usarlo                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `npm run test:vrt`        | Ejecuta el spec contra los baselines actuales. Falla si hay diff > tolerancia configurada por escenario.       |
| `npm run test:vrt:update` | **Regenera baselines.** Solo usar tras un cambio visual intencional, en una máquina de referencia (ver abajo). |

## Smoke Visual De Release

Además del VRT con baselines versionados, el release puede ejecutar un smoke visual sin snapshots:

| Comando                                    | Qué cubre                                                                                                                                                                                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:e2e:clinical-visual-release` | Censo autenticado, creación de documento clínico, CUDYR con acceso a Excel mensual y creación de entrega médica con datos determinísticos. Adjunta capturas Playwright y falla ante overflow horizontal. |

Este smoke vive en [clinical-release-visual-smoke.spec.ts](../../e2e/clinical-release-visual-smoke.spec.ts). No reemplaza `test:vrt`: su objetivo es aportar evidencia visual operativa rápida para release sin exigir regenerar PNGs de referencia. El flujo no solo abre superficies: deja evidencia de que el usuario puede iniciar un documento clínico editable, abrir CUDYR con su entrada de Excel mensual y crear una entrega médica mínima. Está conectado al perfil `full` de `test:release-confidence` como paso `extended`, no al perfil `blocking`.

## Política de baselines

1. **Sistema operativo de referencia**: `darwin` (Apple Silicon). Los nombres incluyen `-darwin` por construcción de Playwright. Si se ejecuta en Linux CI los baselines no coinciden por subpixel rendering. Por eso CI VRT no se ejecuta automáticamente; se corre on-demand desde la máquina de referencia.
2. **Una sola persona regenera por release**: tras una refactor visual intencional, quien aprueba la PR corre `npm run test:vrt:update` localmente y commitea los `.png` resultantes en el mismo commit.
3. **Diff aceptable**: cada test declara su `maxDiffPixelRatio` (entre 0.01 y 0.10) según tolerancia visual del escenario. No subir tolerancia para "callar el test"; investigar la diff real.
4. **Modales**: si el modal cambia de tamaño por overflow (texto largo), considerar `mask` para zonas dinámicas en lugar de subir tolerancia.
5. **Datos inyectados**: cualquier cambio en `injectVRTData` rompe todos los baselines del census. Mantener el set fijo (R1..R4, NEO1..NEO2, H1C1..H6C2 con paciente VRT predecible) salvo razón fuerte.

## Cómo agregar un nuevo escenario

1. Abrir [e2e/visual-regression.spec.ts](../../e2e/visual-regression.spec.ts).
2. Agregar `test('Nombre baseline', async ({ page }) => { ... })` con `await expect(...).toHaveScreenshot('nombre.png', { maxDiffPixelRatio: 0.0X })`.
3. Si el escenario aún no es ejecutable (falta fixture, ruta, etc.), declararlo como `test.fixme` con un comentario explicando el bloqueo.
4. Ejecutar `npm run test:vrt:update` en la máquina de referencia para producir los 3 PNGs (chromium/firefox/webkit).
5. Commit incluye spec + 3 PNGs nuevos.

## Cuando un VRT falla

- **Falla esperada (refactor visual intencional)**: ejecutar `npm run test:vrt:update`, revisar visualmente las diffs, commitear los nuevos baselines.
- **Falla inesperada**: NO regenerar baselines a ciegas. Inspeccionar la diff (`playwright show-trace`), identificar el cambio, decidir si:
  - Es regresión real → arreglar el componente.
  - Es flake (animación, timing) → agregar `mask` o `animations: 'disabled'`.
  - Es shift de fuente/SO → la máquina no es la de referencia; regenerar solo si efectivamente cambió la referencia.
