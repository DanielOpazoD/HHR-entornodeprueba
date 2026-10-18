# Fuentes y alcance de la transición

Decisiones operativas confirmadas por Daniel Opazo el 18-10-2026. Esta política
orienta el trabajo; no certifica por sí sola que una recuperación ya se ejecutó.
La base de destino es `hhr-pruebas`; la fuente antigua es
`hhr-serviciohospitalizados`. Se conserva lo corregido y no se realiza todavía
el cambio oficial. Esta política prevalece sobre propuestas anteriores de
conciliación global; los controles de identidad y escritura siguen vigentes.

## Autoridad por sección y período

| Información | Fuente y alcance |
| --- | --- |
| Censo anterior a julio | Daniel confirma un período completo y confiable en el antiguo. Documentar su frontera exacta antes de una recuperación masiva; no inferirla de la fecha en que aparecieron signos vitales. |
| Censo de julio y agosto | Mantener pruebas; solo siguen vigentes los pendientes documentados y previamente autorizados. Este bloque no inicia una nueva conciliación general del censo. |
| Censo verificado de septiembre y octubre | Cerrado: no volver a comparar presentes, camas, ingresos, egresos o movimientos para reconstruirlo. |
| Censo desde octubre en adelante | Pruebas es la fuente confiable de presentes y movimientos. |
| Entrega completa de enfermería, todos los períodos | El antiguo es la última fuente confiable. Cotejar notas de día y noche, entrega/recepción y nombres, casilleros, novedades, altas, traslados y hospitalización diurna/CMA. |
| Medio de traslado desde julio | Excepción acotada: revisar el dato del medio de los traslados existentes, porque la extensión histórica pudo parametrizarlo incompletamente. |
| Todo el CUDYR de pruebas, incluidos datos saneados, cierres y excepciones justificadas | Conservar íntegro; ninguna escala ni su elegibilidad se recalcula o reemplaza durante esta transición. |

## Entrega de enfermería

La comparación no se limita a vacíos: identificar también versiones distintas o
más completas del antiguo. El tamaño del texto o una fecha de actualización del
censo completo no demuestra cuál nota es más reciente. Las correcciones explícitas
de pruebas se conservan; una contradicción requiere evidencia o revisión.

Usar paciente, episodio, día de censo y turno, nunca solo cama o nombre. Mantener
horas de ingreso/egreso de pruebas cuando representan el mismo día; diferencias
de día requieren revisión. Conservar el turno nocturno del día de censo para los
movimientos de la madrugada siguiente. `false` es un valor, no ausencia; no marcar
casilleros por inferencia. El casillero CUDYR de enfermería no modifica la escala
clínica ni el cumplimiento oficial.

Adaptar datos a la estructura receptora, manteniendo reportes de altas, traslados,
hospitalización diurna y novedades. No copiar HTML, estilos, documentos completos
ni arreglos completos de movimientos. Los planificadores antiguos de vacíos no
acreditan que la entrega completa esté conciliada; ver [enfermería](02-enfermeria.md).

## Medio de los traslados

Consultar primero el antiguo para `evacuationMethod` y `evacuationMethodOther`.
Avión comercial, Aerocardal u otro medio deben proceder de evidencia del evento;
no deducirlos del destino, diagnóstico, acompañante o ausencia de datos.

Los medios ya informados se preservan y quedan fuera de los candidatos de este
bloque, incluidas etiquetas genéricas. Revisar únicamente medios ausentes o vacíos
y clasificarlos como faltante con fuente confirmada, contradicción de identidad
o evento, o sin evidencia suficiente.
Confirmar paciente, episodio y evento, incluidos fecha real y día de censo;
conservar horas corregidas y respetar reclasificaciones y eliminaciones.
Los RN con documento materno y eventos repetidos necesitan identificación adicional.

Esta revisión puede abarcar septiembre y octubre exclusivamente para el medio;
no reabre la conciliación del censo. Si falta el traslado completo, registrarlo
como discrepancia para revisión, sin crearlo por esta vía. Consultar informes o
documentos de fuente solo para casos que el antiguo no resuelva. Una recuperación
posterior debe actualizar únicamente los campos de medio confirmados.

## Bloques de ejecución y aceptación

1. Comparación de solo lectura de enfermería y medios; informe privado, sin datos
   clínicos en Git/CI. Separar candidatos de cambios ya aplicados.
2. Recuperación por lotes confirmados, con versiones exactas, precondiciones,
   recibo y lectura posterior. No sustituir valores corregidos. Repetir debe
   resultar en cero nuevas escrituras para el mismo lote.
3. Respaldo reciente y restauración aislada: comprobar censo y enfermería y
   equivalencia del CUDYR, sin reabrir su aprobación.
4. Ensayo de publicación/accesos y actualización final de enfermería antes de la
   ventana de corte. Dirección oficial nueva, antiguo disponible temporalmente,
   sin reactivar espejo. El cambio oficial requiere la decisión final de Daniel.

No tomar un número de candidatos igual a cero como prueba de migración completa:
los casos retenidos y los bloques no cubiertos por cada herramienta deben figurar
por separado. El detalle de controles está en [preparar corte](03-preparar-corte.md).
