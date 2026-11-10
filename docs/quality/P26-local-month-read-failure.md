# P26: fallo de lectura mensual local

Base: `427afc4dadbac8b03f97d28924e7aa6ce9b33053` (`origin/main`). Regla SAVE-01.

## Alcance y mapa de consumidores

La búsqueda de referencias de ambas funciones y sus fachadas encuentra nueve recorridos
hasta decisiones diferentes (contando los dos respaldos). Se limita esta PR al mes,
como permite el encargo. El rango queda pendiente; sus comportamientos siguientes
se describen para que no se confunda este cambio con una corrección completa.

| Camino                                                                                                          | Con `[]` por fallo en la base                                                                                                           | Después de esta PR                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mes → `fetchRecordsForMonth`                                                                                    | Resuelve una lista vacía. No tiene consumidores de producción actuales.                                                                 | Rechaza por el canal de error de la promesa.                                                                                                                                                                                                           |
| Mes → `fetchExistingDaysInMonth` → `useExistingDaysQuery` → `useAuthenticatedAppRuntime` → calendario           | Desaparecen las marcas al refrescar; una primera lectura muestra calendario sin marcas. La pantalla no consume el error de la consulta. | Conserva marcas conocidas. Sin lectura previa mantiene deliberadamente la presentación actual sin marcas; aviso pendiente de decisión de producto, sin texto nuevo. La captura explícita vive en el hook. Las marcas no autorizan crear/copiar censos. |
| Mes → `ensureMonthIntegrity`                                                                                    | Considera que faltan todos los días e intenta inicializarlos copiando el anterior. No tiene llamadores de producción actuales.          | Rechaza antes de inicializar cualquier día.                                                                                                                                                                                                            |
| Mes → `generateCensusMasterExcel` → `useAppContentRuntime.handleExportExcel`                                    | Devuelve `no_data` y la pantalla informa «Sin datos para exportar» cuando falla la fuente local (directa o respaldo de Firestore).      | Devuelve el resultado `failed` existente y la pantalla muestra «No se pudo exportar el censo». No descarga.                                                                                                                                            |
| Rango → `doStoredDaysHavePatientData` → eventos de `useExistingDaysQuery`                                       | Devuelve false y provoca un reescaneo mensual.                                                                                          | Rango sin modificar; el reescaneo mensual ya conserva lo conocido si también falla.                                                                                                                                                                    |
| Rango → `fetchRecordsRangeSorted` → `useMinsalStats` → estadísticas MINSAL                                      | Considera incompleto el rango y puede ejecutar `syncRecordsRange`.                                                                      | Pendiente: no cambia este comportamiento. La consulta tiene canal de error y conserva datos en caché si una promesa rechaza.                                                                                                                           |
| Rango → `hydrateRangeRecords` → `exportMonthRecordsInternal` → mantenimiento                                    | Puede mezclar solo lo remoto y guardarlo; sin remoto informa `no_records`.                                                              | Pendiente: no cambia. Existe resultado de exportación fallida y UI de mantenimiento.                                                                                                                                                                   |
| Rango → `hydrateRangeRecords` → `exportYearToDateRecordsInternal` → mantenimiento                               | Igual que el respaldo mensual, para todo el año.                                                                                        | Pendiente: no cambia.                                                                                                                                                                                                                                  |
| Rango → `loadPatientHistoryRecords` → `getPatientMovementHistoryDetailed` → consumidores de historia/Explorador | Si falla el servidor, la lista local vacía puede parecer historia vacía con procedencia local.                                          | Pendiente: no cambia. El Explorador usa además carga remota completa (`forceFullRemoteHydration`), fuera de estas dos lecturas.                                                                                                                        |
| Rango → `loadPatientUpcHistory` → `UpcEvaluationHistoryPanel`                                                   | Si falla el servidor, usa el vacío local y muestra la evaluación actual con aviso de historial parcial.                                 | Pendiente: no cambia.                                                                                                                                                                                                                                  |

`syncRecordsRange` **no consume ninguna de las dos lecturas locales**: carga Firestore
por import dinámico y guarda lo recibido. Se alcanza desde la decisión de completitud
de `useMinsalStats`; no se modifica en esta unidad.

CUDYR mensual usa `loadCudyrReport`, proyección oficial/caché y
`getRecordFromFirestoreDetailed` por día con resultado discriminado; no usa estas
funciones. La exportación maestra de censo sí usa el mes local como respaldo.
Los respaldos JSON mensual/anual usan el rango, no la fachada mensual.

## Evidencia y límites

Prueba discriminante: `src/tests/services/storage/localMonthReadFailure.test.tsx`.
Ejecuta las fachadas y consumidores reales contra Dexie sintético; simula rechazo
`toArray` y fallo al construir la consulta. Comprueba que no se inicializan días,
que la exportación distingue fallo de ausencia y que el calendario conserva caché.
Caracteriza mes realmente vacío y respaldo local, filtrado y orden descendente.

No cambia el reloj, reglas clínicas, permisos, colas, sincronización remota ni datos
reales. El modo de respaldo existente usa Web Storage; se conserva su comportamiento.
Sus propios fallos de lectura silenciados quedan fuera de esta unidad.

Validación local: regresión sobre la base, 5 fallos y 2 caracterizaciones correctas;
tras la corrección, 65 pruebas correctas en seis suites concretas. La línea base
se regeneró con su propio `--write-baseline`: 30 → 29, sin entradas nuevas.
La primera pasada de suites tras modificar el calendario detectó una regresión del
estado de error inicial; se corrigió conservando ese canal cuando no hay caché y
la ejecución final de las mismas suites pasó completa.

Build y control de bundle correctos antes y después: `app-authenticated-shell`
632.742 → 632.847 bytes (+105), límite 635.136 bytes; margen final 2.289 bytes.
ESLint y Prettier correctos. La primera comprobación de tipos detectó un mock de
la sobrecarga `where` mal tipado; se sustituyó por el rechazo directo de
`Collection.prototype.toArray` y se repitió la regresión (7/7 correctas).
