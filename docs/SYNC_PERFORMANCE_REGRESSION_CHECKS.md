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

### Revalidación del historial y correcciones de reloj

Un checkpoint futuro no prueba frescura: tras atrasar el reloj, HHR vuelve a solicitar
la ventana completa acotada. Los checkpoints recientes válidos conservan los plazos
de 15 minutos/24 horas existentes. Sólo una ventana efectiva entera positiva y dentro
del máximo de 180 días puede certificar cobertura. Las pruebas
`clinicalHistoryReadPolicy.test.ts` cubren este contrato sin alterar fechas ni turnos clínicos.

### Atribución de la captura dual (extensión 0.48.37)

La medición de septiembre encontró una captura dual de 29,3 s sin poder atribuirla
a una fuente. La extensión añade cuatro duraciones con reloj monotónico: conexión
previa, Ficha Médico, Gestión de Camas y conexión posterior. HHR conserva solamente
los enteros no negativos conocidos, sin identificadores ni valores clínicos, y los
presenta en el detalle técnico del historial. Las fuentes siguen en paralelo: sus
duraciones están incluidas en el total y no deben sumarse a la captura dual.

La aplicación acepta extensiones anteriores sin estas métricas; su ausencia no es
un tiempo cero. Se conservan las comprobaciones de sesión, establecimiento, desfase
y día clínico. Esta instrumentación diagnostica capturas exitosas, no demuestra una
mejora de velocidad ni persiste duraciones de capturas fallidas. Repetir el escenario
de tres sincronizaciones sin cambios cuando las sesiones estén disponibles y decidir
la próxima optimización por la fuente que concentre la demora.

La [serie real con extensión 0.48.37](SYNC_REAL_PERFORMANCE_BASELINE_2026-09-29_V37.md)
incluye nueve ejecuciones completas y una fallida en tres condiciones de recarga.
Localiza demoras variables en Ficha Médico, lecturas y persistencia clínica, pero
no prueba una operación local redundante ni una mejora causada por la recarga.

### Límites de espera identificables (extensión 0.48.38)

El error opcional `timeoutStage` distingue el plazo del relé de Ficha Médico en la
pestaña (`ficha_main_relay`) del plazo del mensaje que el worker envió a esa pestaña
(`ficha_tab_relay`). HHR acepta sólo esos códigos; una extensión antigua sigue la
clasificación previa por mensaje. Cuando vence el plazo de HHR sin respuesta, se sabe
que no llegó la captura, **no** qué componente interno la demoró. Tampoco se atribuye
un timeout al servidor de Eloísa sin una respuesta o una medición de esa fuente.
Estos códigos no contienen datos clínicos y no alteran la captura ni los plazos.

### Fases agregadas de Ficha Médico (extensión 0.48.39)

El lector MAIN separa cuatro duraciones de pared: verificación del contexto,
listas de censo y catálogo de médicos, lecturas y normalización por paciente,
y codificación diagnóstica. El catálogo comienza en paralelo con las listas,
por lo que la segunda fase mide hasta que ambos están disponibles. Las cuatro
fases son subconjuntos del tiempo total de Ficha Médico; la diferencia restante
incluye los relés y el enriquecimiento de cunas. No se suman al tiempo total de
sincronización ni se interpretan como latencia exclusiva del servidor.

La extensión extrae las fases del snapshot antes de entregarlo a HHR y acepta
únicamente cuatro enteros no negativos conocidos en el bundle técnico. No se
registran rutas, episodios, pacientes ni respuestas clínicas en estas métricas.
Las versiones anteriores siguen funcionando sin ellas. La instrumentación no
cambia concurrencia, caché, plazos ni criterios de censo completo. Para decidir
una optimización, repetir varias capturas reales completas y localizar una fase
dominante que se mantenga entre sesiones comparables; una captura fallida no
produce estas cuatro fases.

### Convergencia tras la hidratación de campos sin medición

La [serie real de 0.48.39](SYNC_REAL_PERFORMANCE_BASELINE_2026-09-29_V39.md)
detectó dos lotes redundantes: los nulls eliminados al hidratar signos vitales y
el orden de claves de CUDYR se interpretaban como cambios. Las regresiones de
`clinicalFieldCanonicalization.test.ts` usan `docToRecord` y comprueban también
ceros, retiradas de medición y borrado de historial; `historicalCudyrPatch.test.ts`
conserva la detección de correcciones y la autoridad administrativa. La corrección
evita esos lotes sin añadir cachés ni debilitar las validaciones del servidor.
