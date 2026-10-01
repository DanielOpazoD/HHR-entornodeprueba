# Contratos de sincronización y persistencia

La cobertura se evalúa por recorrido, no por cantidad de tests. Datos exclusivamente
sintéticos; estas pruebas no confirman el estado de un censo real.

| Recorrido                                                      | Evidencia ejecutable                                                                   | Límite                                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Alta materna/RN, guardado, lectura y repetición                | `src/tests/integration/rayenNewbornPersistence.test.ts`                                | Preparación productiva del repositorio + IndexedDB emulado, sin Firestore real          |
| Reparación RN normalizada, tombstone y repetición              | mismo archivo                                                                          | Conserva snapshot completo y auditoría; no demuestra CAS remoto                         |
| Alta del día anterior, autorización y limpieza del día copiado | `src/tests/rayen-import/rayenHistoricalDischargePersistence.test.ts`                   | Coordinador real con repositorio inyectado; verifica identidad y confirmación histórica |
| Respuesta perdida tras limpieza aceptada                       | mismo archivo, `is idempotent after an accepted clear whose response was lost`         | No recrea movimientos ni vuelve a limpiar la cama                                       |
| Autoridad de escritura y concurrencia                          | `src/tests/functions/dailyRecordWriteAuthorityIdempotency.test.ts`, suites de emulador | Complementa los tests locales; exige sus gates de CI                                    |

Para nuevos incidentes, construir el fixture con el constructor/esquema canónico y
atravesar la normalización que intervenga en el fallo. En el recorrido RN se usa
`prepareDailyRecordForPersistence`, `saveRecordStrict`, cierre/apertura de Dexie y
`getRecordForDate`; una referencia en memoria no reemplaza esa lectura.

No duplicar pruebas históricas ya existentes: extender el recorrido que falte y
conservar casos de cama reutilizada, cuna agregada después de revisar y falta de
confirmación del egreso. Los tests nuevos se descubren en la suite unitaria de CI.
