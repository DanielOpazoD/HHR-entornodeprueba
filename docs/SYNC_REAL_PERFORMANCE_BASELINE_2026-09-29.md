# Línea base de sincronización verificada el 29-09-2026

## Entorno y procedimiento

Medición desde Chrome en `localhost:3001/census`, checkout de HHR en la rama
`codex/offline-persistence-evidence`, SHA `c4d2ec2b9583fd989ec4ca3c453a7aa9ed369acd`.
El runtime de aplicación coincide con main `859d71db`: el cambio de la rama afecta
sólo pruebas y documentación. Destino Firebase comprobado: `hhr-pruebas`.
La interfaz acreditó extensión cargada **0.48.36**, ambas fuentes disponibles,
política de revisión 7 y lote clínico `enforced`.

Se sincronizó primero el censo seleccionado para actualizar su estado. Esa ejecución
contenía ingresos, actualizaciones y un egreso; duró 1 min 43 s con intervención humana.
Se excluye de la comparación. Después se hicieron tres repeticiones sobre el mismo
censo, sin cambios estructurales ni confirmaciones humanas intermedias. Las tres
terminaron completas con cobertura **14/14**. Se recargó HHR y se volvió a abrir el
historial: los tres resultados y sus métricas permanecían disponibles.

Sólo se conservan agregados técnicos; no se adjuntan HAR, valores clínicos ni
identificadores de personas o episodios. Las horas mostradas por HHR corresponden a
su calendario clínico; la verificación del equipo fue el 29-09-2026.

## Resultados observados

Valores leídos del reporte técnico persistido, redondeados por la interfaz:

| Métrica                      | Repetición 1 | Repetición 2 | Repetición 3 |
| ---------------------------- | -----------: | -----------: | -----------: |
| Duración total               |         17 s |         41 s |         15 s |
| Preflight                    |       128 ms |        61 ms |        59 ms |
| Captura dual                 |        3,4 s |       29,3 s |        3,2 s |
| Reconciliación total         |       251 ms |       312 ms |       235 ms |
| Evidencia histórica incluida |       236 ms |       293 ms |       221 ms |
| Guardado estructural         |        3,5 s |        3,5 s |        3,5 s |
| Lecturas clínicas            |        5,5 s |          2 s |        1,4 s |
| Espera interna sumada        |         1 ms |         0 ms |         1 ms |
| Persistencia sumada          |        9,4 s |        8,3 s |        8,2 s |
| Persistencia clínica actual  |        3,4 s |        2,7 s |        2,9 s |
| Persistencia CUDYR histórica |        4,8 s |        3,9 s |        3,6 s |
| Solicitudes Eloísa           |           17 |           17 |           17 |
| Aciertos de caché            |           13 |           13 |           13 |
| Parches reportados           |            8 |            8 |            8 |
| Reintentos / timeouts        |        1 / 0 |        1 / 0 |        1 / 0 |

Las tres repeticiones reportaron cero escrituras de entradas incrementales, un lote
autoritativo actual y uno histórico, sin reintentos cliente ni Firestore en esa
persistencia. Cero escrituras incrementales no significa cero escrituras del censo:
los contadores pertenecen a capas distintas.

## Decisión y límites

La mediana total fue **17 s**, el máximo **41 s**. El aumento de la segunda ejecución
se localiza en captura dual (**29,3 s** frente a **3,2–3,4 s**); las lecturas clínicas
y la persistencia no muestran un aumento equivalente. Esto localiza la etapa,
pero no permite atribuir causalidad a Ficha Médico, Gestión de Camas, red o extensión.
El coordinador existente ya lee ambas fuentes con `Promise.all` y comprueba su salud
antes y después; no hay evidencia para eliminar esas comprobaciones ni añadir cachés.

No se introdujo una optimización de runtime ni un presupuesto temporal bloqueante.
Para investigar otra demora, obtener el desglose de las dos fuentes y verificaciones
de salud dentro de esa captura, manteniendo la privacidad y las protecciones actuales.
No sumar todas las filas: evidencia histórica forma parte de reconciliación y algunas
persistencias/esperas son agregados solapados. La muestra es de tres repeticiones en
una sesión; no representa percentiles de producción ni una comparación fría/caliente.
El readback verifica historial y estado terminal tras recarga, no equivalencia campo a
campo de toda la información clínica ni una auditoría de producción.
