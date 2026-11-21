# Pruebas locales: memoria y concurrencia (29-09-2026)

## Decisión

Mantener la concurrencia predeterminada. En el escenario medido fue más rápida.
Cuando otras tareas presionen la memoria, usar el límite existente de Vitest:

```sh
npm run test:ci:unit -- --maxWorkers=4
```

Para feedback durante edición, pasar archivos concretos a `npx vitest run` y el
mismo límite si hace falta. Esto no reemplaza el gate de cierre ni autoriza omitir
pruebas. No añadir un runner, dependencia, nueva configuración global o timeout.

## Evidencia y límites

Base `ecdb0f1f` (misma configuración de Vitest que `2ffc936a`), Node 22.22.2,
Vitest 4.1.11, macOS, `availableParallelism() = 10`. Se ejecutaron diez archivos
con las mismas 77 pruebas en seis procesos nuevos, secuencialmente, sin otro gate
local de esta tarea en paralelo. Orden: predeterminado, 2, 4, 4, 2, predeterminado.
La memoria es el máximo **muestreado** de la suma del RSS del runner y descendientes
cada 0,5 s; puede contar páginas compartidas y no es el consumo físico exclusivo.
La duración incluye arranque, transformación, pruebas y muestreo.

| Ejecución | maxWorkers     | Segundos | RSS sumado (MiB) | Resultado |
| --------- | -------------- | -------: | ---------------: | --------- |
| 1         | Predeterminado |     9,65 |           1560,2 | 77/77     |
| 2         | 2              |    15,82 |            583,2 | 77/77     |
| 3         | 4              |    13,56 |            841,8 | 77/77     |
| 4         | 4              |    11,53 |            921,1 | 77/77     |
| 5         | 2              |    14,83 |            644,6 | 77/77     |
| 6         | Predeterminado |     9,79 |           1534,3 | 77/77     |

Promedios descriptivos: cuatro procesos redujeron el RSS sumado aproximadamente
43 % (1547 → 881 MiB), a costa de aproximadamente 29 % más tiempo (9,72 → 12,55 s).
Dos procesos redujeron más memoria, pero fueron todavía más lentos. No se
reprodujeron fallos en estas ejecuciones; no demuestra que un límite solucione
los fallos previos bajo carga. Tampoco es una medición de toda la suite ni de CI.

Archivos medidos:

- `src/tests/views/census/censusEloisaBootstrap.integration.test.tsx`
- `src/tests/views/census/PatientIdentityCell.test.tsx`
- `src/tests/views/census/PatientIdentityCell.specialtyScope.test.tsx`
- `src/tests/views/census/IsolationBadge.test.tsx`
- `src/tests/views/census/ClinicalPanelLoadingAndLayering.test.tsx`
- `src/tests/components/AppContent.entrypoint.test.tsx`
- `src/tests/components/modals/RadiologyViewerModal.test.tsx`
- `src/tests/features/auth/useLoginPageController.test.ts`
- `src/tests/hooks/useDailyRecordQuery.test.tsx`
- `src/tests/services/storage/sessionCleanupIsolation.test.ts`

Para repetir: mantener versiones y archivos, alternar el orden, usar procesos
nuevos, registrar carga del equipo y aplicar `--maxWorkers=2`, `--maxWorkers=4`
o ningún override. No extrapolar estas cifras a otros equipos o al navegador.

## Cierre

La capacidad ya existía y el beneficio en memoria quedó medido. Se documenta su
uso sin imponer una regresión de tiempo al caso habitual. No cambia aplicación,
cobertura, selección de pruebas, umbrales, reintentos ni CI. No necesita reversión
operativa: basta ejecutar sin el argumento para usar el comportamiento habitual.
