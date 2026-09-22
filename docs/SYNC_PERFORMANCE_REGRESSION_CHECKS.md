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

Ejecutar desde el checkout correspondiente, con su versión de Node y dependencias:

```sh
npx vitest run src/tests/rayen-import/clinicalFillRequestBudget.test.ts src/tests/rayen-import/clinicalFillRunner.performance.test.ts src/tests/rayen-import/rayenSnapshotEvidenceClient.test.ts src/tests/rayen-import/rayenSyncTemporalContext.test.ts --maxWorkers=1
```

El conjunto existente comprueba además los intentos acotados de conexión, la caché
de trazabilidad por ejecución y las fechas de consulta. La recuperación histórica
opcional tiene sus propias pruebas: no debe ampliar silenciosamente el rango diario.

## Comprobación real pendiente de navegador

Para comparar antes y después, usar el mismo censo, versión de extensión, número de
pacientes y disponibilidad de fuentes. Separar captura, lectura clínica, guardado y
tiempo humano de confirmación. Informar al menos tres ejecuciones comparables y los
reintentos; no extrapolar el reloj virtual a segundos reales ni publicar HAR con datos
clínicos. Confirmar también el historial tras recargar y la persistencia de los datos.
