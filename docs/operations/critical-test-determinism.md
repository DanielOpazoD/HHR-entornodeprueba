# Determinismo de pruebas críticas de sincronización

## Cambios acotados

- El relay de extensión espera las promesas reales de transporte y sus handlers
  antes de afirmar que una respuesta cancelada no produjo mensajes. Se elimina
  `setTimeout(0)`: no es un criterio de finalización. La prueba adicional resuelve
  una captura pendiente después de cancelar. Un contexto invalidado también se
  verifica después de completar ambas cadenas de respuesta.
- El indicador de cola controla solamente `Date`, con un instante fijo. Los
  temporizadores normales de Testing Library siguen activos. Se verifica el
  instante inmediatamente anterior al umbral de atasco y el umbral exacto, sin
  cambiar el umbral de producción de cinco minutos.
- La lectura IndexedDB de tareas usa un timestamp fijo y limpia la cola antes y
  después de cada caso, incluso cuando falla una aserción. Se conservan los casos
  que impiden sobrescribir revisiones con tareas pendientes, fallidas o en conflicto.

No se añade `@flake-safe` para ocultar indicadores. El inventario heurístico de
riesgo no demuestra flakiness ni permite atribuirle fallos sin reproducirlos.

## Comprobación de sensibilidad

Las 18 pruebas de los tres archivos pasan. Al desactivar temporalmente la guarda
que silencia una respuesta cancelada, las pruebas del relay fallan; se restauró
el código de producción. La sustitución de la espera no debilita las aserciones
negativas ni cambia el comportamiento de la extensión.

## Distribución de shards: evidencia antes de modificar

Se observaron tres ejecuciones completas del mismo workflow con cuatro shards:

| Ejecución   | Shard 1 | Shard 2 | Shard 3 | Shard 4 |
| ----------- | ------: | ------: | ------: | ------: |
| 36773117368 |   316 s |   214 s |   277 s |   306 s |
| 36780776560 |   206 s |   280 s |   287 s |   278 s |
| 36804748761 |   306 s |   307 s |   272 s |   220 s |

Todas aprobaron. La partición más lenta cambia: no se demuestra una carga fija
mal distribuida que justifique recalibrar estimaciones. Estos tiempos incluyen
preparación del job; no equivalen a tiempos por archivo. Se conservan configuración,
afinidades y límites vigentes. Si aparece un desequilibrio repetible, analizar los
perfiles por archivo junto con varias ejecuciones comparables antes de ajustar.

Este PR no promete acelerar la aplicación ni una reducción demostrada del tiempo
CI. Mejora el criterio de finalización y la reproducibilidad de pruebas que
protegen cancelaciones, aislamiento y escrituras pendientes.
