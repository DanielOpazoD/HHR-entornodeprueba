# Limpieza de código y pruebas — lote 2

Base: `origin/main` en `adeac54f2fb18d9267e0ffeba3f1eb8fb0f800a8`, después del merge de #331.

## Alcance y evidencia

Retirar código sin consumidores de producto y pruebas que únicamente conservaban ese código. Consolidar comprobaciones idénticas, sin reducir escenarios únicos del producto activo ni cambiar los controles de CI.

| Retiro                                                                              | Evidencia de ausencia de uso                                                                                                                                                 | Pruebas retiradas                                                           |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/services/admin/utils/diffUtils.ts`: `computeWordDiff`, `DiffPart`              | Su único consumidor de producto era `DiffHighlight`, retirado en #331. Sólo quedaba su propio test. El resumen de auditoría vigente usa `AuditPackageChangeSummary`.         | `src/tests/services/admin/utils/diffUtils.test.ts`: 4 casos.                |
| `src/utils/arrayUtils.ts`: `randomItem`, `shuffle`, `groupBy`, `unique`, `uniqueBy` | Sólo su test y el re-export de `randomItem` en `valueTypes`. Los consumidores de `valueTypes` importan otros símbolos; se retira también ese re-export y la fila del README. | `src/tests/utils/arrayUtils.test.ts`: 6 casos.                              |
| `normalizeName`, `truncate`, `isEmpty`, `searchMatch` de `src/utils/stringUtils.ts` | Sólo utilizados por su propio test. Se conservan `capitalizeWords` y `removeAccents`, usados por CMA, validación de pacientes y búsqueda de pacientes.                       | 8 casos de `src/tests/utils/stringUtils.test.ts`; se conservan los otros 3. |

Verificación por referencias, imports y re-exports en el repositorio, incluidas cargas dinámicas y namespaces. No se encontró un consumidor dinámico de los módulos retirados. Son utilidades sin efectos al cargar y el paquete es privado. Las dos funciones conservadas de strings tienen el mismo código tras normalizar el formato con el parser/printer TypeScript.

## Duplicación de pruebas, sin perder escenarios

| Suite modificada                                          | Consolidación                                                                          | Cobertura conservada                                                                                                                                                                                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/tests/services/pdf/imagingRequestPdfService.test.ts` | Retirar 3 casos de nombres y 1 caso de formato de fecha.                               | Los mismos inputs y assertions contra las mismas funciones reales están en `src/tests/utils/clinicalUtils.test.ts`, sin mocks. Se mantienen el nombre de dos palabras, la edad exacta con reloj fijo y las coordenadas del formulario. |
| `src/tests/components/BaseModal.test.tsx`                 | Unificar los 3 montajes idénticos que verificaban z-index, posición y blur en un caso. | Se mantienen assertions explícitas de `fixed`, `inset-0`, `z-[100]` y `backdrop-blur`. Accesibilidad, foco, interacción y desplazamiento mantienen sus pruebas independientes.                                                         |

No se eliminan archivos de pruebas por similitud de nombre: el escaneo léxico de 1.830 archivos no encontró archivos completos idénticos. La consolidación se basa en comparar imports, mocks, datos de entrada y assertions.

Resultado: 10 funciones sin uso menos, 18 casos huérfanos menos, 4 casos duplicados menos y 2 montajes React menos. Se eliminan 2 archivos de pruebas completos. Todo es recuperable desde Git.

## CI: ahorro acotado y límites de la medición

No se modifican workflows, umbrales de cobertura, presupuestos, shards, exclusiones ni risk packs.

Medición local con Node 22.22.2, Vitest 4.1.11, `CI=true`, `--maxWorkers=1`, reporter JSON y tres corridas seriales por estado:

| Estado del conjunto afectado | Archivos | Casos | Corridas (segundos de pared) | Mediana |
| ---------------------------- | -------: | ----: | ---------------------------- | ------: |
| Antes                        |        6 |    48 | 2,987 / 2,469 / 2,112        | 2,469 s |
| Después                      |        4 |    24 | 1,905 / 1,625 / 1,628        | 1,628 s |

El conjunto incluye arrays, diff, strings, utilidades clínicas, formulario de imágenes y BaseModal; después se omiten los dos archivos eliminados. Los 24 casos restantes pasan en las tres corridas. Es una medición orientativa del lote, con cachés y carga local variables, no un benchmark controlado de GitHub ni una promesa porcentual sobre toda la CI.

En la [CI completa de main anterior al lote](https://github.com/DanielOpazoD/HHR-entornodeprueba/actions/runs/33948253476), los shards unitarios tardaron aproximadamente 4–5 minutos, pero la cadena cobertura → snapshots de gobernanza → calidad → build terminó más tarde. Este lote reduce trabajo innecesario; no elimina ese camino más largo. Una optimización futura debería medir esa cadena con ejecuciones comparables antes de cambiar el pipeline.

`reports/unit-shard-runtime-profile.json` es una medición histórica del 6-07-2026 (SHA `cf972b18`), no evidencia de tiempos actuales. No se reescribe para aparentar una medición nueva: `discoverUnitTestFiles` descubre los archivos existentes y sólo usa el perfil como pista temporal.

## Exclusiones deliberadas

- No modificar sincronización, persistencia, identidad Rayen, UPC, migraciones, autenticación ni la extensión.
- No borrar pruebas clínicas por parecerse: estados, implementaciones o contratos distintos justifican casos separados.
- No regenerar las 2.058 páginas/archivos del snapshot TypeDoc de `docs/api` en este PR. Contiene referencias históricas a arrays/strings, no consumidores ejecutables; `npm run docs:generate` reconstruye ese árbol desde el código vigente. No se borran páginas sueltas dejando sus índices rotos.
- No afirmar validación de PDF generado: la suite de imágenes actual comprueba constantes/utilidades, no renderiza el PDF. Añadir esa cobertura sería otra tarea; este lote no modifica el generador.
- No tocar el servidor ni los datos de prueba del usuario en localhost:3001.

## Verificación del lote

Además del conjunto afectado, ejecutar los vecinos activos: `useCMA`, `usePatientValidation`, `patientMasterContracts`, `globalSearchContracts`, `PatientAuditPackageRow` y `valueTypes`. Completar typecheck, calidad, suite unitaria, build, presupuesto y bootstrap sintético del censo, más revisión de código antes del commit. Los resultados efectivos se registran en el PR; la CI remota sigue siendo necesaria para declarar listo el merge.
