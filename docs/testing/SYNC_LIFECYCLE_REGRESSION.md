# Regresión permanente de sincronización

Ejecutar `npm run test:sync-lifecycle`. Los archivos también pertenecen al descubrimiento
unitario normal de CI; el comando permite reproducir esta cobertura sin una sesión de Eloísa.
No consulta ni escribe Firebase. Todos los pacientes y documentos son sintéticos.

| Secuencia                                                                      | Resultado protegido                                                                                      | Prueba                                                         |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Hoy y ayer: ingreso → movimiento → repetición → alta → repetición              | Un episodio en la ubicación correcta, notas conservadas, un solo egreso y cierre completo                | `syncLifecycleReplay.test.ts`                                  |
| Madre dada de alta → RN pendiente → documento propio del RN → captura atrasada | El RN permanece hasta verificar su propio egreso; después no reaparece ni cuenta como egreso estadístico | `syncLifecycleReplay.test.ts`                                  |
| Madre cambia de cama y Eloísa conserva la cuna anterior                        | La asociación conocida acompaña a la madre, conserva la nota neonatal y converge al repetir              | `syncLifecycleReplay.test.ts`                                  |
| Ingreso de madrugada y altas propias madre/RN a las 00:17/00:19                | Censo anterior, fechas calendario reales conservadas y sin duplicados                                    | `syncLifecycleReplay.test.ts`, `dischargeCalendarDate.test.ts` |
| Episodio ausente con documento de egreso del día siguiente                     | Ese documento puede acreditar presencia histórica sin anticipar el alta                                  | `historicalFollowingDayEvidence.test.ts`                       |
| Madre ya egresada, RN omitido del censo                                        | Recuperar el movimiento del episodio correcto, preservando el censo existente                            | `recordedMotherMissingNewbornDischarge.test.ts`                |
| Identidad materna ambigua, cama coincidente o RN en cama independiente         | La ubicación sola no demuestra parentesco; respetar la clasificación propia                              | `clinicalCribMaternalAssociation.test.ts`                      |
| CUDYR nocturno y repetición                                                    | Fecha de censo correcta, recuperación tras fallo y sin duplicar historia                                 | `deterministicCudyrReplay.test.ts`                             |

El replay usa el puente correlacionado, conciliación, aplicación, serialización JSON,
esquema de persistencia, enriquecimiento clínico y presentación del historial reales.
Simula las fuentes externas y la persistencia; no acredita autenticación de Chrome,
permisos del backend ni una sincronización real. Las pruebas de reconstrucción recorren
por separado el descubrimiento, documento propio, reconstrucción y planificación.

Al corregir otro caso, añadirlo al recorrido pertinente con la segunda sincronización
sobre el resultado guardado de la primera. Comprobar resultados observables: identidad,
ubicación, notas, movimientos, fecha clínica e historial. No sustituir evidencia clínica
faltante por expectativas que obliguen artificialmente a un resultado «completo».

La comparación ingreso/egreso convierte primero el día clínico del egreso a su fecha
calendario. `dischargeAdmissionCalendarOrder.test.ts` protege altas nocturnas válidas,
egresos realmente anteriores al ingreso, reingresos, cambios de mes/año y ambos
horarios históricos de entrega de turno.
