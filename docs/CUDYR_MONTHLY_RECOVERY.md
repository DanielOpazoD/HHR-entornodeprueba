# Recuperación mensual de fuentes CUDYR

La acción **Actualizar CUDYR**, en la vista simplificada, recupera los informes originales de Gestión de Camas. Requiere una sesión de la extensión y permisos de enfermería hospitalizada o administrador. Abrir CUDYR no consulta Eloísa.

## Alcance de esta etapa

- Primero vuelve a leer HHR y selecciona únicamente los días pendientes cuya ventana ya cerró a las 12:00 del día siguiente, en horario de Rapa Nui. Funciona también durante el mes en curso.
- Censo diario: fechas pendientes y su día siguiente cuando aún no esté verificado.
- Categorización Riesgo Dependencia: los meses necesarios para esas noches; el mes siguiente sólo cuando una noche pendiente cruza el fin de mes.
- Los días verificados y los meses oficiales no se vuelven a consultar. Una lectura fallida de HHR detiene la recuperación antes de decidir que faltan datos.
- Al terminar se vuelve a leer la vista. Los usuarios de sólo consulta conservan **Volver a leer datos**, que no consulta Eloísa.
- Cada fuente confirmada por Firebase es un punto de reanudación. Las consultas fallidas quedan pendientes y se pueden reintentar.

El archivo y su proyección se validan juntos en el servidor. La fecha de captura identifica la consulta, no la aplicación del instrumento. Un respaldo documental no acredita por sí solo un censo completo, una ausencia de CUDYR ni la aprobación oficial del mes. Esas decisiones pertenecen a la conciliación posterior. No se modifican los censos originales ni se generan escalas manuales.

## Persistencia

Las callables existentes `archiveCudyrHistory` y `readCudyrHistory` incorporan las operaciones `import-daily-census-source` y `daily-census-sources`. Los censos se guardan en `cudyrCensusSources`; los bytes originales usan `cudyrSupplementFiles`. Los informes mensuales conservan su archivo y recibo de captura en el archivo de suplementos existente. Todas las rutas mantienen la autorización clínica y el hospital definidos en el servidor.

El parser del navegador y del servidor comparte fuente TypeScript. Tras modificarlo ejecutar `node scripts/build-cudyr-source-parser.mjs`; `--check` verifica que el archivo generado esté actualizado. El flujo de despliegue verifica esa equivalencia antes de desplegar Functions.

## Comprobación

Pruebas de transporte, parser, recuperación interrumpida/reanudada, sesión, roles, bytes alterados y escrituras concurrentes. Las pruebas de integración usan exclusivamente Firebase Emulator y pacientes sintéticos.

## Límite de confianza del archivo documental

La extensión sólo consulta el establecimiento HHR (`FAC_ID=1342`). El XLS censal observado identifica el Servicio de Salud Metropolitano Oriente, pero no el hospital; por ello no se presume que sus bytes contengan una identificación hospitalaria verificable. El servidor valida el contenido, limita el destino a HHR y registra al operador autorizado. Las credenciales de Eloísa permanecen en la extensión.

La captura y su hora son declaraciones del cliente autenticado, no firmas emitidas por Eloísa. Permiten reanudar una operación del equipo autorizado; no constituyen una certificación independiente del origen, de la exhaustividad o de la ausencia de registros. Un archivo importado manualmente sin recibo de captura no satisface ese punto de reanudación. La aprobación clínica y oficial permanece separada. Firmas de origen o adquisición directa desde el servidor requerirían un contrato adicional con Eloísa, fuera de esta etapa documental.

## Excepciones justificadas por contingencia

Un informe vacío de Eloísa prueba ausencia en esa fuente, no ausencia de aplicación
cuando existe un registro manual documentado por una interrupción del servicio.
Para recuperar un resultado del HHR antiguo se valida la identidad, episodio y
noche censal; una diferencia de fecha de ingreso requiere revisión expresa. No se
copian camas, ingresos ni otros datos del censo antiguo.

El resultado se conserva como `HHR · ajuste administrativo`, con motivo y referencia
persistente de auditoría (`adjustmentReason`, `adjustmentEvidence`). Solo las
excepciones justificadas entran al reporte oficial: no se habilita indiscriminadamente
el cómputo de puntajes manuales antiguos. Se mantienen la elegibilidad habitual y
el denominador. La explicación aparece en el detalle y en el Excel diario.

La excepción prevalece sobre sincronizaciones posteriores, incluso frente a un
Excel vacío o con otra categoría. Se conserva por separado la evidencia de Eloísa;
una discrepancia no reemplaza silenciosamente la decisión administrativa. El
archivo de auditoría debe conservar los puntajes originales, la fuente y la
validación. La hora del guardado antiguo no se inventa como hora de aplicación ni
se atribuye al operador de recuperación la autoría clínica original.

La dotación nocturna visible corresponde al censo seleccionado y su calendario
(20:00 hasta las 08:00/09:00 siguientes), a partir de la dotación ya guardada. No se
atribuyen pacientes o incumplimientos individuales a los nombres del turno.

## Apertura rápida y comprobación posterior

La vista conserva la última lectura completa por sesión y puede recuperarla de
`cudyrReadViews` en Firebase, aislada por usuario autenticado y período. Es una
copia de presentación prescindible, no una nueva fuente clínica ni un cierre
oficial. Se muestra como «Última lectura guardada en HHR» mientras continúa la
lectura autoritativa. Hasta finalizarla no habilita exportación ni modificaciones.
Una respuesta tardía nunca sustituye una lectura nueva ni cruza sesiones.

Las copias mensuales cerradas de `cudyrOfficialReports` conservan sus validaciones
originales. La copia de presentación no las modifica ni otorga aprobación a un
censo pendiente. Tampoco se usa para decidir qué fechas consultar en Eloísa:
Actualizar CUDYR mantiene su comprobación de fuentes guardadas antes de consultar
solo lo pendiente. Los errores de red impiden guardar una copia nueva; una
advertencia clínica de una lectura completa permanece visible y no obliga por sí
sola a descartar la lectura anterior.

Las consultas independientes del historial, capturas y censo se ejecutan en
paralelo con concurrencia acotada. Cada consulta conserva su paginación y la
proyección espera toda la evidencia necesaria. Las exclusiones y las excepciones
justificadas forman parte de cada lectura y de su copia; ninguna copia escribe
sobre censo, puntajes, exclusiones ni informes oficiales.

### Continuidad del cierre entre meses

El informe mensual siguiente aporta la madrugada del día 1 al último turno del mes cerrado. Una nueva versión que solo modifica días posteriores no debe invalidar ese cierre. El servidor compara las categorías e identidades de esa primera madrugada y exige que el resto de las fuentes conserve exactamente la huella original. Si cambia, desaparece o se agrega una aplicación relevante, el cierre sí requiere revisión. No se reemplaza el informe oficial ni se recalculan sus pacientes a partir del censo operativo actual.
