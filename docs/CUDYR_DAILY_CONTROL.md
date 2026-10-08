# Control diario CUDYR y Excel esencial

## Alcance

CUDYR se registra en Eloísa. En HHR se consultan resultados, cobertura y elegibilidad; la pantalla principal ya no permite llenar ítems ni guardar/eliminar resultados individuales o en lote. El acceso está en Censo diario → Más opciones → CUDYR · control diario. El explorador detallado permanece como complemento.

## Bloques de implementación

1. **Decisiones diarias persistentes:** exclusiones por episodio y fecha censal; callable existente, autor/hora del servidor, revisión optimista, idempotencia y registro de revisiones. No modifica pacientes, altas ni resultados fuente.
2. **Control diario:** tabla de resultados de solo lectura; P. dependencia, P. riesgo y categoría. Revisar muestra motivos automáticos y permite excluir o retirar una exclusión manual. Cumplimiento acumulado hasta la fecha seleccionada, con cobertura parcial explícita.
3. **Excel esencial:** dos hojas, Resumen y Pacientes elegibles; 15 columnas de identificación, contexto de cama, resultado y trazabilidad. Excluidos y casos por revisar no entran al detalle. Los elegibles sin CUDYR sí entran para no ocultar brechas. Auditoría conserva el contexto amplio.

Los bloques forman una sola capacidad: se revisan juntos para evitar una pantalla que no pueda guardar o una descarga que ignore exclusiones. Pueden ajustarse durante las pruebas sin ampliar el alcance a la captura de Eloísa.

## Reglas

- Exclusiones automáticas: cunas y toda modalidad CMA según contexto diario; menos de 8 horas según corte HHR de 01:00 del día siguiente; egreso efectivo comprobado. Las contradicciones y horas desconocidas quedan por revisar.
- Exclusiones manuales: CMA, cuna RN sano, paciente fuera del hospital pendiente de regularización, hospitalización menor de 8 horas. Motivo, nota y confirmación obligatorios. Falta de epicrisis por sí sola no acredita egreso.
- Cada decisión corresponde a un episodio y un día. El servidor exige que ese episodio exista en el censo persistido de ese día o sus movimientos. Un caso histórico únicamente documental sin censo debe reconciliarse antes.
- Retirar una exclusión no fuerza elegibilidad: vuelve a las reglas automáticas. No se borran revisiones. Una sincronización posterior no borra la decisión manual.
- R1–R4 son intermedias; NEO 1–2 y H1C1–H6C2 medias. UPC no interviene.
- Cumplimiento: confirmados elegibles / pacientes-día elegibles conocidos. No promedio de porcentajes ni denominador de camas ocupadas. Sin denominador se muestra —. Cobertura incompleta o casos por revisar hacen provisional el resultado.
- Sin registro observado, sin consulta confirmada, fuente no disponible y captura incompleta son estados diferentes. No encontrar un registro no acredita que no fue realizado.
- Puntajes ausentes se muestran — y celdas vacías, nunca cero inventado.
- Consultar/descargar sólo lee HHR persistido; no sincroniza Eloísa. Cambios en la sincronización del censo recargan la lectura. La descarga esencial se bloquea si hubo errores de lectura, incluidas exclusiones.

## Persistencia y despliegue

`cudyrDailyExclusions/{hash(fecha,episodio)}` contiene la decisión vigente y `revisions` recibos inmutables de cada operación. Lectura/escritura a través de `readCudyrHistory` y `archiveCudyrHistory`; lectura clínica autorizada y escritura admin/enfermería hospital. No se agregan permisos directos de Firestore ni endpoints públicos nuevos.

Orden: validar emulador y navegador con datos sintéticos; actualizar ambas Functions existentes en **hhr-pruebas**; publicar frontend en **hhr-entorno-prueba**. Sin cambios en testinghhr ni datos clínicos reales para probar. Rollback del frontend conserva las decisiones; la versión anterior del explorador no sabe interpretarlas y no debe utilizarse para un cierre estadístico con exclusiones vigentes.

## Validación

Pruebas de identidad/día, autorización, replay, conflicto de revisión, retiro conservando auditoría, no modificación del censo, exclusión del detalle Excel, porcentajes y puntajes ausentes. El E2E de captura por lotes se retira porque la interfaz ya no ofrece esa operación; lo sustituye el flujo de exclusión y Excel en `e2e/cudyr-report-explorer.spec.ts`.

El hook existente `src/features/cudyr/hooks/useCudyrReport.ts` inicializa desde el primer día del mes hasta `initialDate` en su efecto de montaje/cambio de fecha; pasar un día al hook no significa leer sólo ese día. Se conserva ese contrato y se verifica explícitamente con una fecha intermedia y un cambio de mes en `CudyrReportInteractions.test.tsx`.

## Corrección de días y control compacto

- Toda alta, fallecimiento (sección altas) o traslado externo con fecha efectiva igual o anterior al día censal queda excluido, aunque el CUDYR se hubiera registrado antes de esa salida. El egreso de un día posterior no elimina retrospectivamente un día elegible; durante la madrugada se conserva la comparación con la hora de evaluación. Egresos sin fecha o contradictorios siguen por revisar, sin inventar datos.
- El día actual/futuro no entra al cumplimiento. Se reutiliza la ventana nocturna HHR existente: el día previo tampoco se declara incumplido mientras su ventana sigue abierta, hasta las 12:00 del día siguiente en Rapa Nui. El instante de generación del reporte fija el estado de cada día, de forma reproducible. La descarga excluye esos días del detalle y los identifica como pendientes en Resumen.
- Un resultado archivado confirmado se conserva aunque falle una consulta posterior; esa consulta deja una advertencia independiente. Conflictos, anulaciones y guardados pendientes mantienen sus protecciones.
- La vista abre con elegibles, filas compactas y porcentajes diario y acumulado. Revisar conserva identidad, diagnóstico, autor, hora, origen y motivos; Excluidos/Todos permiten cotejar sin incorporarlos a la descarga esencial.
- Esta revisión no autoriza publicar. Los builds de Netlify de hhr-entorno-prueba se detuvieron a pedido de Daniel; la versión publicada se conserva hasta una publicación manual autorizada.
