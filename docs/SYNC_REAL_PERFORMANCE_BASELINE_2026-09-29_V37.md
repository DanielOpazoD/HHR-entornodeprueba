# Sincronización real con extensión 0.48.37 (29-09-2026)

## Alcance

Se midió `localhost:3001/census` con la aplicación de `main` en `eac5f46c`,
Firebase `hhr-pruebas` y la extensión **cargada** 0.48.37, verificada en Chrome
y en HHR. Ficha Médico y Gestión de Camas permanecieron autenticadas. El mismo
censo conservó 14 pacientes clínicos y no tuvo ingresos, egresos ni movimientos
estructurales durante esta serie. No se recopilaron HAR, identificadores de
pacientes, camas, episodios ni valores clínicos.

Se hicieron tres ejecuciones por condición: A, sesión tras recargar la extensión;
B, HHR recargado con las fuentes abiertas; C, ambas fuentes y HHR recargados.
La primera A incorporó 35 hechos clínicos nuevos y se conserva sólo como
observación. Otra A falló y su reintento completo se registra por separado.
Las fuentes siguieron cambiando entre ejecuciones: estas condiciones **no son
una comparación causal** de caché fría/caliente ni de versiones de extensión.

## Resultados del historial persistido

Son los tiempos redondeados que muestra HHR. `—` es una métrica ausente, no cero.
La captura dual incluye las dos fuentes paralelas; la persistencia suma esperas
por paciente y no debe sumarse al total de pared.

| Condición | Resultado | Total | Captura dual | Ficha Médico | Gestión de Camas | Lecturas clínicas | Persistencia sumada | Hechos nuevos |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A1 | Completa 14/14 | 64 s | 9,3 s | 7,6 s | 2,3 s | 6,7 s | 39,2 s | 35 |
| A2 | Completa 14/14 | 76 s | 39,9 s | 39,1 s | 1,8 s | 10,1 s | 23,5 s | 0 |
| A3 | Fallida, sin métricas de captura | 46 s | — | — | — | — | — | — |
| A3, reintento | Completa 14/14 | 74 s | 21,9 s | 21,5 s | 2,2 s | 33,8 s | 12,9 s | 0 |
| B1 | Completa 14/14 | 49 s | 12,2 s | 11,1 s | 11,3 s | 9,3 s | 16,8 s | 2 |
| B2 | Completa 14/14 | 35 s | 6,3 s | 5,9 s | 1,7 s | 4,2 s | 18,7 s | 0 |
| B3 | Completa 14/14 | 40 s | 6,6 s | 5,6 s | 3,5 s | 8,3 s | 20,4 s | 1 |
| C1 | Completa 14/14 | 51 s | 15 s | 14,5 s | 1,2 s | 3,9 s | 21,7 s | 2 |
| C2 | Completa 14/14 | 38 s | 4,8 s | 4,5 s | 0,4 s | 4,4 s | 21,5 s | 1 |
| C3 | Completa 14/14 | 27 s | 3,2 s | 2,9 s | 0,9 s | 4,4 s | 14,4 s | 0 |

Entre las nueve ejecuciones completas, las medianas descriptivas fueron 74 s
en A (rango 64–76), 40 s en B (35–49) y 38 s en C (27–51). Algunas tuvieron
hechos clínicos nuevos; no se atribuye la reducción a una recarga. El historial
se releyó después de recargar HHR y conservó los resultados. El reintento A3
recuperó cobertura 14/14 sin una intervención estructural.

## Decisión

En dos capturas lentas Ficha Médico concentró 39,1 y 21,5 s, mientras Gestión
de Camas tardó 1,8 y 2,2 s. En otras ejecuciones la captura dual bajó a 3,2–6,6 s
y el tiempo relevante se desplazó a lecturas o persistencia clínica. A3 quedó
archivada como `snapshot_timeout`, sin métricas de captura: el código usa esa
categoría tanto para un timeout devuelto por la fuente como para la ausencia de
respuesta del puente. El historial etiquetaba ambos casos como «Sin respuesta
de la extensión», diagnóstico más específico de lo que permite la evidencia.

La serie **no demuestra trabajo local redundante** ni una mejora atribuible a
recargar. No se cambia concurrencia, caché, plazos ni autoridad clínica. Para
optimizar Ficha Médico se necesitan tiempos agregados por operación que separen
red y lector; para optimizar persistencia, identificar una escritura omitible
sin perder auditoría, convergencia o protección ante carreras. Nueve resultados
no permiten calcular un percentil de producción.
