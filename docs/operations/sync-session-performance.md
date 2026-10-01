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
