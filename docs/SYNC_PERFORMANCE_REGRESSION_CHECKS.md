# Comprobaciones reproducibles del rendimiento de sincronización

Estas pruebas usan pacientes sintéticos, fuentes simuladas y reloj virtual. Detectan
lecturas duplicadas, serialización accidental y reintentos que repiten todo el censo.
No miden la latencia real de Eloísa ni acreditan sincronizaciones inferiores a un minuto.

## Presupuesto clínico sin fallos

| Pacientes | Canales individuales | Canal agrupado |
| --------- | -------------------- | -------------- |
| 13        | 40 peticiones        | 14 peticiones  |
| 30        | 91 peticiones        | 31 peticiones  |

El conteo incluye una captura compartida de CUDYR. Cada paciente requiere tres
lecturas individuales o una agrupada; los formularios se reutilizan para escalas
y signos vitales. Con latencia simulada de 25 ms, las fuentes avanzan en paralelo,
con hasta cuatro lecturas simultáneas por fuente. Un fallo transitorio de dispositivos
añade un intento para esa fuente, sin releer los otros pacientes ni CUDYR.

## Presupuesto ante un fallo parcial del canal agrupado

Para 13 o 30 pacientes, una sección de dispositivos fallida añade exactamente una
petición individual: 15 o 32 peticiones totales, respectivamente. El resto de las
secciones permanece dentro del bundle y CUDYR se captura una sola vez. Si ese único
reintento también falla, la ejecución termina el censo y atribuye el error solamente
al paciente y a la fuente de dispositivos afectados.

Ejecutar desde el checkout correspondiente, con su versión de Node y dependencias:

```sh
npx vitest run src/tests/rayen-import/clinicalFillBundleFailureBudget.test.ts src/tests/rayen-import/clinicalFillRequestBudget.test.ts src/tests/rayen-import/clinicalFillRunner.bundle.test.ts src/tests/rayen-import/clinicalFillRunner.performance.test.ts src/tests/rayen-import/clinicalFillRunnerNoop.test.ts src/tests/rayen-import/rayenSnapshotEvidenceClient.test.ts src/tests/rayen-import/rayenSyncTemporalContext.test.ts --maxWorkers=1
```

El conjunto existente comprueba además los intentos acotados de conexión, la caché
de trazabilidad por ejecución y las fechas de consulta. La recuperación histórica
opcional tiene sus propias pruebas: no debe ampliar silenciosamente el rango diario.

## Repetición después de persistir e hidratar

`clinicalFillRunnerNoop.test.ts` ejecuta el runner, aplica su parche y utiliza la
preparación real del registro para persistencia. Después serializa y vuelve a leer
ese estado antes de repetir las mismas fuentes sintéticas. Con la persistencia
simulada, la primera pasada contabiliza una escritura de paciente
y un snapshot de historia; la repetición produce cero escrituras y cero snapshots,
sin llamar a `applyPatch`. Esto protege el caso de datos idénticos tras una recarga,
además del presupuesto de peticiones anterior.

La verificación del 28-09-2026 aprobó 64 pruebas en los siete archivos del comando
anterior. No mostró una redundancia adicional que justifique introducir otra caché
o cola. Esta evidencia no es una comparación de caché fría/caliente del navegador:
no mide sesiones reales, red de Eloísa ni tiempos humanos de confirmación. Antes de
proponer una optimización adicional, localizar el coste en una medición comparable
y comprobar que la reducción conserva los resultados y los reintentos acotados.

## Comprobación real pendiente de navegador

Para comparar antes y después, usar el mismo censo, versión de extensión, número de
pacientes y disponibilidad de fuentes. Separar captura, lectura clínica, guardado y
tiempo humano de confirmación. Informar al menos tres ejecuciones comparables y los
reintentos; no extrapolar el reloj virtual a segundos reales ni publicar HAR con datos
clínicos. Confirmar también el historial tras recargar y la persistencia de los datos.

La primera línea base leída del historial real, con cinco ejecuciones comparables de
0.48.31 y una observación aislada de 0.48.32, está en
[SYNC_REAL_PERFORMANCE_BASELINE_2026-09-23.md](SYNC_REAL_PERFORMANCE_BASELINE_2026-09-23.md).
La repetición de 0.48.32 y el readback posterior aún están pendientes; esta evidencia
no autoriza a fijar un presupuesto temporal bloqueante ni a declarar una regresión.

La [medición del 29-09-2026](SYNC_REAL_PERFORMANCE_BASELINE_2026-09-29.md) añade tres
repeticiones verificadas en `hhr-pruebas` con extensión 0.48.36 y readback del historial
tras recarga. Sus totales fueron 17, 41 y 15 s; la demora aislada se concentra en la
captura dual. No se atribuye a una fuente concreta ni justifica otra caché.
