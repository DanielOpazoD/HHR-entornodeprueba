# Comparar sesiones reales de sincronización

## Uso

En Historial de sincronización, **Copiar resumen de rendimiento** exporta un JSON
agregado del historial del día abierto. Para reunir varias sesiones/días, mantener
los resúmenes separados por cohortes; no promediar medianas. El botón no incorpora
un recolector remoto ni cambia los datos persistidos o el protocolo de extensión.

La proyección permite exclusivamente versión numérica validada, categorías fijas
y métricas numéricas finitas no negativas. Omite identificadores de sesión,
censo, camas, profesionales, pacientes, tiempos absolutos y texto de errores.
Los identificadores se usan internamente para evitar contar dos veces una sesión.

Separar versiones de extensión, resultado, modo de batch, actividad clínica,
alcance actual/histórico y reintentos clínicos explícitos. Una categoría ausente
queda desconocida. No inferir reintento clínico a partir de reintentos de red.

Cada métrica informa cuántas observaciones existen, mediana y máximo. P95 solo
aparece con al menos 20 observaciones de esa métrica dentro de la misma cohorte.
Una métrica ausente no equivale a cero. Las sesiones sin finalización válida o
sin rendimiento quedan contadas como omitidas.

## Interpretación

- `wallMs`: tiempo entre inicio y fin; incluye revisión humana.
- `wallWithoutReviewMs`: solo se calcula cuando existe revisión medida, válida y
  menor o igual al tiempo total; no reemplaza el tiempo de la sesión.
- Captura dual y sus fuentes se superponen. Las etapas de Ficha son partes de su
  captura, no tiempos adicionales.
- Persistencia y espera de cola pueden sumar varias escrituras. No sumarlas con
  otras etapas ni deducir una ruta crítica a partir de ese total.
- Intentos callable y reintentos cliente/transacción son magnitudes distintas.
- El alcance es el historial proporcionado al componente, no todos los días ni
  todos los dispositivos. No publicar HAR, sesiones completas o datos clínicos.

## Evidencia local observada y decisión del bloque de optimización

Se inspeccionaron en modo lectura 48 sesiones de seis versiones de extensión:
41 completas y siete fallidas. No se combinaron versiones para recomendar una
optimización. Dos sesiones de varios minutos incluían aproximadamente 286 y
488 segundos de revisión humana. La confirmación clínica se conserva.

La versión 0.48.42 aportó siete sesiones: seis completas y una fallida antes de
capturar. En las completas:

| Medición                     | Mínimo | Mediana | Máximo |
| ---------------------------- | -----: | ------: | -----: |
| Tiempo total                 | 17,7 s |  29,8 s | 55,8 s |
| Captura dual                 |  1,7 s |   3,7 s |  8,3 s |
| Lectura clínica              |  1,9 s |   5,3 s |  6,0 s |
| Persistencia clínica actual  |  4,0 s |  14,7 s | 23,2 s |
| Persistencia CUDYR histórica |  88 ms |  141 ms | 225 ms |
| Espera de cola medida        |   0 ms |    0 ms |   1 ms |

Son observaciones exploratorias con diferente cantidad de cambios y revisión;
no constituyen una comparación controlada, una tendencia ni un P95. La escritura
actual merece la siguiente investigación. Los datos aún no separan latencia de
red, trabajo de la autoridad remota y reintentos; una sesión carece de traza de
persistencia. Optimizar la captura o aumentar concurrencia de escrituras no está
justificado por estas muestras.

Una sesión adicional, medida directamente en Chrome en el entorno de prueba,
completó dos llamadas a la autoridad clínica en 18,4 y 2,2 segundos. Es una
observación de red, no una medición del trabajo interno del servidor.

**Decisión para el bloque 3:** no crear una optimización especulativa. Antes de
modificar producción, contrastar varias sesiones comparables con los intentos
callable y de transacción y la telemetría existente de la autoridad. Verificar
una causa corregible y medir antes/después con la misma versión, alcance y carga.
Conservar idempotencia, guardas de episodio/revisión, paridad, atomicidad y revisión
humana. Este informe ofrece el instrumento mínimo para continuar esa medición.

## Contratos de validación

`rayenSyncSessionReport.test.ts` cubre privacidad, cohortes, duplicados, métricas
inválidas/ausentes, solapamiento y tamaño mínimo para percentiles.
`RayenSyncSessionReportButton.test.tsx` cubre copiar, fallo y reintento a través del
runtime existente. Los controles de historial continúan pasando.

## Atribuir la duración de la autoridad clínica

La callable clínica devuelve opcionalmente `serverTimingsMs` (también en detalles
numéricos de errores): `authorizationMs`, `transactionMs`, `telemetryMs` y
`handlerMs`. Son intervalos medidos con reloj monotónico en el servidor. Una fase
no iniciada se omite; los clientes siguen funcionando si una versión anterior
no devuelve estas métricas. No se amplía el timeout ni se cambia el orden de
escritura o el contrato de autoridad.

La telemetría administrativa existente contiene autorización y transacción antes
de su propia escritura. Su `durationMs` conserva ese alcance anterior a la
telemetría. La respuesta incluye la espera de esa escritura y el total del
handler; no se hace una segunda escritura para medir la primera. El total también
incluye preparación y procesamiento entre fases: no sumar el total a las fases.

Comparar respuestas de varias sesiones de la misma versión, alcance, actividad
y cantidad de campos. El tiempo HTTP menos el tiempo del handler no prueba
latencia de red ni un arranque en frío: incluye etapas fuera del handler. Una
respuesta perdida no aporta mediciones del intento perdido. Estas métricas son
para diagnóstico, no modifican la decisión de éxito, paridad o reintento.

Las fases se consultan en la respuesta callable de Chrome y en el contexto de
la telemetría administrativa disponible. El resumen compartible de sesiones
mantiene su allowlist actual; no exporta respuestas, hashes de correlación ni
payloads. Para comparar fases, extraer localmente solo esos cuatro números y la
carga agregada. Nunca compartir un HAR autenticado o datos clínicos.

## Sesiones reales tras instrumentar la autoridad (2026-10-01)

Se observaron tres sincronizaciones completas en Chrome sobre `hhr-pruebas`,
con extensión 0.48.42, SDK web 12.14.0 y Functions de la revisión
`7a06487081fe84afe263fad22ebd28bfb020c37d`. Se consultaron el historial del día y la
telemetría administrativa existente; aquí se conservan solo cargas y tiempos
agregados, sin identificadores clínicos. Las filas siguen el orden de observación.

| Sesión |    Total | Destinos clínicos / solo checkpoint | Campos | Autorización | Transacción | Servidor antes de telemetría |
| ------ | -------: | ----------------------------------: | -----: | -----------: | ----------: | ---------------------------: |
| 1      | 41,069 s |                               1 / 4 |      5 |      4,588 s |    10,947 s |                     15,537 s |
| 2      | 35,831 s |                               2 / 0 |      5 |      1,048 s |     9,498 s |                     10,551 s |
| 3      | 33,241 s |                               3 / 0 |     10 |      1,159 s |    10,619 s |                     11,785 s |

Las tres conservaron paridad `matched`, un intento callable y cero reintentos
clínicos del cliente o de transacción. La espera de cola fue 0, 0 y 1 ms; no hubo
timeouts. El contador general de reintentos fue uno por sesión y no representa
un reintento de la transacción. Se excluyó una cuarta ejecución en estado
`applied`, sin traza de persistencia clínica ni cobertura comparable.

Los tiempos de autorización y transacción vienen del contexto administrativo de
la callable; `durationMs` finaliza antes de escribir esa telemetría. No se capturó
el cuerpo de respuesta, por lo que no hay medición observada de `telemetryMs`,
`handlerMs` ni una atribución de tiempo HTTP. Los temporizadores del cliente se
superponen: no se suman para fabricar una ruta crítica.

**Decisión:** la transacción clínica es el siguiente tramo a descomponer con una
medición acotada de lecturas, procesamiento y escrituras. No aplicar todavía
caché, más concurrencia, cambios de región ni omisión de verificaciones: las
cargas difieren y esta muestra no identifica una operación interna corregible,
una mejora antes/después, una tendencia o un P95. La validación de asignaciones
confiables ya usa lecturas paralelas; no hay evidencia de beneficio por volver a
paralelizarla. Conservar recibos exactos, guardas de episodio/revisión, auditoría,
paridad y atomicidad. Una optimización posterior requiere una causa reproducible
y comparación de cargas equivalentes con esos contratos intactos.

## Decisión sobre Firebase web 12.19.0

El [PR #460](https://github.com/DanielOpazoD/HHR-entornodeprueba/pull/460) se revisó
y cerró sin merge. Las correcciones de Auth ofrecían un beneficio preventivo, pero
el head `27dc1917e273fbb275e19034e7847196ded83322` excedió los presupuestos vigentes:
precache 4973,0 KB frente a 4836,0 KB y chunk Firestore 593,6 KB frente a 488,3 KB,
confirmado localmente y en [Preview Validation](https://github.com/DanielOpazoD/HHR-entornodeprueba/actions/runs/36817549235).
La revisión independiente, 353 pruebas focales y el suite unitario completo pasaron;
no sustituyen los controles de tamaño ni prueban una mejora de latencia. Se conserva
Firebase web 12.14.0, sin elevar límites ni reparticionar chunks para ocultar el coste.

El audit detectó además GHSA-m9gg-hp2v-232j en el override existente de `grpc-js`
1.14.4. Se priorizó el parche 1.14.5 en raíz y Functions, con evidencia y rollback
en el [checklist de cambios](../SAFE_CHANGE_CHECKLIST.md#parche-transitivo-grpc-2026-10-01).
No se ha demostrado explotación en HHR. Esta decisión separa un parche de seguridad
acotado de una actualización general del runtime cliente que no pasó sus controles.

El gate ampliado de evidencia de release señala además 27 archivos de tests con
relojes reales o esperas de turno. Es una brecha anterior al parche transitivo;
los tests y el detector no se modifican. No se declara ese gate aprobado ni se
silencian sus señales. Revisar por separado determinismo de fixtures y esperas;
los controles exigidos para el parche siguen siendo audit, merge gate y CI del
head final, ampliados con el pack de confianza de transporte.

### Desglose de transacción clínica

La respuesta y la telemetría existente incluyen opcionalmente
`transactionTimingsMs`, agregado numérico de **todos** los intentos de Firestore:

- `callbackMs`: tiempo acumulado dentro de los callbacks, incluso los fallidos.
- `documentReadMs`: lecturas directas de registro, autoridad, políticas e historial.
- `specialtyAuditMs`: comprobaciones de procedencia y de IDs, cada grupo con sus
  lecturas paralelas existentes. No sumar este valor otra vez a las lecturas directas.
- `otherCallbackMs`: resto del callback (guardas, proyección, serialización y
  preparación de escrituras); no representa solamente CPU.
- `outsideCallbackMs`: resto de `transactionMs`, que puede incluir commit del SDK,
  backoff, transporte y planificación; no atribuirlo íntegramente al commit.

Los valores se redondean a milisegundos al finalizar. No se añaden lecturas,
colecciones, escrituras ni tareas en segundo plano. Se conserva la transacción
atómica y el replay por recibo. Si la transacción no empezó, el desglose se omite.

La siguiente optimización exige sesiones comparables y una etapa dominante:
si predominan lecturas o auditoría, revisar exclusivamente su trabajo y dependencias;
si predomina el resto externo, estudiar transporte/SDK antes de tocar la lógica
clínica. Las mediciones anteriores de 9,5–10,9 s no permiten identificar por sí solas
la causa interna. No modificar paralelismo, guardas o retries sólo por esos totales.

## Rollout regional medido (2026-10-01)

Se verificó por CLI el proyecto de prueba: Firestore usa `southamerica-west1`
(Santiago), mientras `applyRayenClinicalEnrichmentBatch` estaba desplegada en
`us-central1`, primera generación, Node 22, 256 MB, timeout 60 s. La autoridad
principal usa `southamerica-east1`. No se modifican memoria ni timeouts. El cliente
Admin ya se reutiliza por instancia; esa optimización está cubierta.

Firebase documenta que Santiago solo admite segunda generación y que las
Functions deben estar cerca de los servicios que usan. Se prepara São Paulo
para conservar primera generación, sin migrar la base ni la generación:
[ubicaciones oficiales](https://firebase.google.com/docs/functions/locations).
El endpoint anterior permanece desplegado para clientes ya cargados. El cambio
del cliente requiere primero verificar el despliegue automático de ambas regiones.

Dos sincronizaciones previas al rollout, con extensión 0.48.42 y el mismo censo
en `hhr-pruebas`, produjeron las siguientes llamadas exitosas:

| Carga               | Resultado   |    HTTP | Autorización | Transacción | Lecturas directas | Fuera del callback |
| ------------------- | ----------- | ------: | -----------: | ----------: | ----------------: | -----------------: |
| 1 destino, 1 campo  | idempotente | 3782 ms |      1088 ms |     1731 ms |           1535 ms |             184 ms |
| 1 destino, 3 campos | escritura   | 9481 ms |       199 ms |     8520 ms |           1180 ms |            6296 ms |

Ambas conservaron paridad `matched` y un intento de transacción. Son cargas
distintas: no constituyen una comparación controlada ni prueban una ganancia
regional. Una repetición diagnóstica del payload anterior fue rechazada por las
guardas vigentes y queda excluida de la comparación de éxito; no se cambian las
guardas para permitir reutilizar requests obsoletos. No se exportan payloads.

La siguiente etapa compara regiones desplegadas con el mismo batch válido y
convergente, usando recibos exactos cuando existen, y sesiones reales separadas
por carga/resultado. Una repetición de recibo solo mide ese camino: no acredita
la velocidad de una escritura nueva. Mantener las protecciones y verificar la
convergencia antes de enrutar el cliente a la región nueva. No añadir caché de
roles, más escrituras paralelas o instancias mínimas por esta evidencia.

## Comparación regional controlada y cambio del cliente (2026-10-01)

El handler de la revisión `694cb5e49c766643d4ede95e0c7716b0072eb593` se desplegó
sin modificar su cuerpo en ambas regiones, con primera generación, Node 22,
256 MB y timeout de servidor de 60 s. El primer deploy automático falló al
configurar el invoker del endpoint nuevo. Con autorización puntual se replicó
solo su binding de invocación del endpoint anterior; no se ampliaron roles del
workflow. Ambos endpoints aceptaron el mismo recibo autenticado y rechazaron
una petición sintética válida sin sesión con HTTP 401 / `UNAUTHENTICATED`.

Se ejecutaron 20 pares secuenciales alternando el orden de las regiones en Chrome,
sobre el mismo recibo confirmado, con un destino y tres campos. Las 40 llamadas
fueron idempotentes, con paridad matched, un intento de transacción, cero reintentos
y cero escrituras de pacientes o snapshots de historial. Sí se conserva la
telemetría administrativa habitual. No se excluyeron las respuestas lentas.

| Medición HTTP                     | us-central1 | southamerica-east1 |
| --------------------------------- | ----------: | -----------------: |
| Observaciones                     |          20 |                 20 |
| Mediana                           |  1.547,5 ms |         1.212,5 ms |
| Promedio                          |    1.966 ms |           1.730 ms |
| P95 observado (rango más próximo) |    3.069 ms |           6.451 ms |
| Máximo                            |    7.467 ms |           6.724 ms |

Sudamérica fue más rápida en 15 de los 20 pares: la mediana HTTP bajó 21,6 %,
la mediana de transacción de 815,5 a 658 ms y la de autorización de 141,5 a
80,5 ms. Sin embargo, su P95 observado fue peor: dos picos de autorización
superaron 3,4 s. No se etiquetan como arranques en frío porque no hay evidencia
que lo acredite. La muestra procede de una sesión y llamadas consecutivas;
no representa el P95 del uso real ni una reducción equivalente del censo entero.

La primera sincronización real con el cliente regional completó siete destinos
y ocho campos: una escritura de paciente y un snapshot, paridad matched,
sin reintentos, HTTP 5.043 ms, handler 4.856 ms, autorización 85 ms y transacción
4.679 ms (lecturas 468 ms, fuera del callback 3.014 ms). Su carga difiere de
las sesiones anteriores: no se calcula una mejora porcentual entre ellas.

**Decisión:** usar el runtime regional ya existente para el batch clínico,
conservando su timeout de cliente de 20 s y propagación de errores. El endpoint
anterior sigue atendiendo clientes abiertos y permite revertir solo el cliente.
No añadir fallback entre regiones, caché de roles, minInstances, concurrencia
clínica ni cambios de índices a partir de este experimento. La cola de latencia
y el tiempo fuera del callback quedan como investigación posterior con sesiones
separadas y cargas comparables; no se consideran resueltos.

`rayenClinicalEnrichmentBatchClient.test.ts` protege la selección regional,
el timeout y el paso de payload/respuesta, y demuestra una sola invocación sin
fallback ante timeout, rechazo de permisos, conflicto o fallo de inicialización.
