# Recuperación mensual de fuentes CUDYR

La acción **Completar y verificar mes**, en la vista simplificada, recupera los informes originales de Gestión de Camas. Requiere una sesión de la extensión y permisos de enfermería hospitalizada o administrador. Abrir CUDYR no consulta Eloísa.

## Alcance de esta etapa

- Censo diario: días del mes y primer día del mes siguiente.
- Categorización Riesgo Dependencia: mes seleccionado y mes siguiente, para cubrir la última noche.
- Sólo meses cerrados: desde las 12:00 del primer día siguiente, en horario de Rapa Nui.
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
