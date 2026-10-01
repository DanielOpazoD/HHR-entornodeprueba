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
