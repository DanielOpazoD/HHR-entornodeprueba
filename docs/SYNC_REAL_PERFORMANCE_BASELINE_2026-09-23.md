# Línea base observada de sincronización Eloísa · 23-09-2026

## Alcance y fuente

Lectura **de sólo consulta** del historial de sincronización del censo del 22-09-2026 en
`http://localhost:3001/census`, servido desde `main` en `a6704bcbe412db12975948e76199778875a9529e`.
Se inspeccionaron los agregados que HHR ya conserva por ejecución; no se inició una
sincronización para obtener esta muestra. La versión de la extensión y la política son las
registradas en cada evento, no inferidas de la extensión cargada al leer el historial.

Las cinco ejecuciones del grupo de referencia registran extensión **0.48.31**, política
con revisión 7, lote clínico `enforced`, 9/9 de cobertura clínica, cero cambios de camas,
ingresos o egresos, 12 solicitudes, un reintento y cero timeouts cada una. Se omiten
horas exactas, nombres, identificadores, camas y valores clínicos. Los tiempos del historial
se presentan redondeados por la interfaz; por ello estos valores no tienen precisión de
milisegundos ni deben sumarse como si todas las etapas fueran secuenciales.

| Ejecución | Total | Captura dual | Lecturas clínicas | Guardado estructural | Persistencia sumada |
| --- | ---: | ---: | ---: | ---: | ---: |
| A | 23 s | 3,8 s | 7,0 s | 3,8 s | 13,4 s |
| B | 23 s | 6,6 s | 3,9 s | 4,2 s | 8,3 s |
| C | 20 s | 5,3 s | 3,8 s | 4,2 s | 8,5 s |
| D | 34 s | 2,1 s | 4,5 s | 3,3 s | 25,2 s |
| E | 22 s | 4,2 s | 3,0 s | 2,8 s | 13,4 s |
| **Mediana** | **23 s** | **4,2 s** | **3,9 s** | **3,8 s** | **13,4 s** |

La persistencia sumada incluye operaciones por paciente y una corrección histórica de
CUDYR. No es una porción exclusiva del reloj total: puede solaparse con otras lecturas y
superarlo en otras ejecuciones. En estas cinco, el máximo fue 25,2 s; el mismo evento
terminó en 34 s. El historial no registra el SHA de HHR que ejecutó cada evento, por lo
que la comparabilidad de la aplicación no puede acreditarse retrospectivamente.

## Primera observación de 0.48.32

Una ejecución adicional del mismo censo, con 9/9 de cobertura, cero cambios
estructurales, política con revisión 7 y lote `enforced`, registró **61 s** totales:
captura dual **29,9 s**, lecturas clínicas **3,3 s**, guardado estructural **4,6 s** y
persistencia sumada **24,1 s**. También registró 12 solicitudes, un reintento y cero
timeouts. Es **una sola observación**: no atribuye la demora a la versión 0.48.32 ni
demuestra una regresión. La captura dual y la persistencia requieren repetición y
comparación con la disponibilidad de Eloísa y Firestore en el momento de cada intento.

## Repetición y criterio de decisión

1. Repetir al menos tres ejecuciones comparables de lectura/actualización habitual, con
   el mismo censo, cantidad de pacientes, versión de extensión y política. Registrar por
   separado cualquier cambio estructural y la revisión humana. No confirmar cambios
   clínicos sólo para generar una medición.
2. Leer el estado terminal, cobertura, versión, solicitudes, reintentos, timeouts y
   desglose técnico en el historial **después de recargar HHR**. Si el historial o los
   datos clínicos no persisten, clasificarlo como fallo de corrección antes de comparar
   velocidad.
3. Comparar medianas y máximos de captura, lectura y persistencia. Investigar primero
   la etapa cuyo aumento se repita; no paralelizar escrituras ni reducir lecturas
   clínicas sólo porque un total aislado supere un minuto.
4. Conservar únicamente agregados como los de esta tabla. No adjuntar HAR, nombres,
   identificadores de pacientes, episodios, camas, tokens ni respuestas clínicas al PR.

Esta línea base describe tiempos observados, no un presupuesto de CI ni una garantía de
sincronización en menos de un minuto. Las pruebas sintéticas y su presupuesto de
solicitudes siguen documentados en [SYNC_PERFORMANCE_REGRESSION_CHECKS.md](SYNC_PERFORMANCE_REGRESSION_CHECKS.md).
