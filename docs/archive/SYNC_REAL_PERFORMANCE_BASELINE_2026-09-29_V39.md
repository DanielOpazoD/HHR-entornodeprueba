# Sincronización real: convergencia sin lotes redundantes (29-09-2026)

## Entorno y método

Chrome, `localhost:3001/census`, Firebase `hhr-pruebas`, extensión **cargada**
0.48.39 y base `09acbb52`. Se mantuvo el censo del 29-09-2026 con cobertura
13/13. B contiene tres ejecuciones después de recargar HHR y ambas fuentes;
C contiene otras tres después de recargar sólo HHR. Son dos condiciones de
sesión de una misma tarde, no días ni usuarios independientes. Las fuentes
continuaron cambiando, por lo que no es un experimento causal de caché fría/caliente.

Una ejecución preliminar A1 duró 24 s, completa, pero no incluyó las cuatro
fases: un MAIN anterior puede seguir abierto aunque el worker anuncie 0.48.39.
Después de recargar las fuentes aparecieron las fases. A1 queda fuera de la
comparación por etapas; una versión anunciada no demuestra qué lector estaba
vivo dentro de cada pestaña.

Se recogieron agregados del historial y, en C2/C3 y D1–D3, observación de red
local. No se guardaron HAR, cuerpos clínicos, credenciales, pacientes ni camas.
La inspección transitoria de peticiones/respuestas produjo sólo tipos de campo,
conteos, igualdad de contenido, estados HTTP y tiempos. No hubo cambios
estructurales propuestos que requiriesen confirmación en estas ejecuciones.

## Antes del cambio

Segundos, salvo indicación. Los tiempos por fase están incluidos en Ficha Médico;
no se suman al total. La persistencia sumada es una suma de operaciones, no una
medición independiente del tiempo de pared.

| Serie | Total | Ficha Médico | Contexto (ms) | Listas y catálogo | Lecturas por paciente | Codificación | Persistencia sumada | Actual | CUDYR histórico |
| ----- | ----: | -----------: | ------------: | ----------------: | --------------------: | -----------: | ------------------: | -----: | --------------: |
| B1    |    18 |          6,6 |            71 |               1,5 |                 0,438 |          3,9 |                 8,6 |    2,8 |             4,3 |
| B2    |    20 |          3,1 |            51 |               1,7 |                 0,521 |            0 |                 8,2 |    2,8 |             4,0 |
| B3    |    49 |         25,7 |            35 |              24,5 |                 0,312 |            0 |                14,8 |    9,6 |             3,9 |
| C1    |    18 |          2,3 |            35 |             0,807 |                 0,568 |            0 |                 9,0 |    3,0 |             4,0 |
| C2    |    34 |         19,2 |            42 |             0,978 |                  16,3 |            0 |                 9,5 |    2,9 |             4,5 |
| C3    |    16 |          3,0 |            39 |               1,8 |                 0,466 |            0 |                 8,3 |    2,6 |             3,5 |

Todas completas, 13/13 y sin timeouts. B3 incorporó dos hechos nuevos; B2 y C1–C3
no incorporaron hechos nuevos ni correcciones. La mediana descriptiva del total
fue 19 s (rango 16–49); no es un percentil de producción.

La demora no se concentra siempre en la misma fase. En C2 la red mostró respuestas
HTTP 200 y preflight 204 alrededor de 15,7–16,1 s, con esperas hasta las cabeceras;
no prueba si la causa está en el servidor, intermediarios o transporte. B3 no tuvo
esa observación por solicitud y sólo permite atribuir su pico a listas/catálogo.
No se justifican más concurrencia, caché nueva ni cambios de timeout.

## Redundancia demostrada y corrección

En C3 se enviaron dos POST al callable de enriquecimiento: uno histórico con nueve
objetivos CUDYR y uno actual con trece objetivos de signos vitales. Ambos devolvieron
`idempotent`, cero escrituras, cero snapshots y cero reintentos de transacción.
Los campos vitales enviados ya eran iguales al readback remoto anterior al POST.

Dos reproducciones sintéticas fallaron antes de la corrección:

- La hidratación real (`docToRecord`) elimina hojas `null`. El parser vital las
  reconstruye y el comparador interpretaba la diferencia como un cambio clínico.
- Firestore puede devolver las claves anidadas de CUDYR en otro orden. Su comparación
  con `JSON.stringify` generaba otra operación aunque los valores fueran iguales.

El cambio normaliza sólo los campos expresamente nullable de signos vitales **para
comparar** y reutiliza la igualdad canónica existente para objetos anidados de CUDYR.
No cambia los valores enviados, fechas, identidades, reglas de autoridad, reintentos,
versiones de contrato ni persistencia. Un valor real que pasa a cero o se retira,
una corrección del historial y las anulaciones administrativas siguen distinguiéndose.

## Verificación con el cambio

Misma extensión y censo, HHR recargado con el cambio local. En paralelo hubo controles
de código y carga adicional del equipo: los tiempos totales no son un A/B controlado.

| Serie | Total | Ficha Médico | Persistencia sumada | CUDYR histórico | POST de lotes clínicos | Cobertura      |
| ----- | ----: | -----------: | ------------------: | --------------: | ---------------------: | -------------- |
| D1    |    22 |          4,2 |                 3,5 |             2,0 |                      0 | 13/13 completa |
| D2    |    13 |          3,1 |                 2,8 |           0,657 |                      0 | 13/13 completa |
| D3    |    24 |          6,6 |                 2,3 |           0,480 |                      0 | 13/13 completa |

Las tres terminaron sin hechos nuevos, sin correcciones y sin escrituras clínicas.
El historial conserva un contador de un parche; ese contador no equivale a un POST
ni a una escritura clínica efectiva. La observación de red completa, sin eventos
truncados, verificó cero llamadas a `applyRayenClinicalEnrichmentBatch` en D1–D3.
CUDYR aún lee el registro histórico para comprobar que no necesita cambios; ese coste
no debe describirse como una escritura. La ausencia de una métrica de persistencia
actual tampoco se interpreta por sí sola como cero.

**Resultado demostrado:** desaparecen los dos lotes redundantes del escenario sin
cambios, conservando la cobertura. **Resultado no demostrado:** una reducción fija del
tiempo total (mediana posterior 22 s frente a 19 s anterior). Las demoras de red y de
la etapa estructural permanecen. No se abre otra optimización sin evidencia adicional.

## Controles y reversión

Cambio `critical_runtime`, limitado a dos comparadores de dominio. Pruebas focalizadas:
`clinicalFieldCanonicalization`, `historicalCudyrPatch`, `mergeReportVitals` y
`clinicalFillRunnerNoop`: 28 aprobadas. Las dos regresiones nuevas fallaron en la base.
Los controles completos y la revisión independiente se registran en el PR.

Revertir los dos comparadores restaura el comportamiento previo; no hay migración,
modificación de datos almacenados ni actualización de extensión necesaria.
