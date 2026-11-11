# Censo Maestro Excel: Hojas Ocultas

Este módulo construye el Excel maestro del censo diario y agrega tres hojas de soporte al inicio del workbook:

- `RESUMEN [MES] [AÑO]`
- `UPC PAC [MES] [AÑO]`
- `UPC DET`

## Pipeline

1. `builder.ts` crea el workbook y resuelve los nombres visibles por día.
2. `censusHiddenSheetsBuilder.ts` agrega las hojas de soporte antes de renderizar las hojas diarias visibles.
3. `censusHiddenSheetsAggregation.ts` transforma `DailyRecord[]` en view models puros:
   - snapshots lógicos por fecha,
   - filas de resumen,
   - pacientes UPC con historial de cama, conteo UCI/UTI y detalle diario por subtipo.
4. `censusHiddenSummarySheet.ts` y `censusHiddenUpcSheets.ts` solo escriben celdas ExcelJS a partir de esos view models.
5. `censusHiddenSheetsProtection.ts` aplica protección por hoja. `RESUMEN` queda oculto por estructura y las dos hojas UPC quedan visibles pero vacías hasta desprotegerlas.
6. `censusWorkbookSerializer.ts` postprocesa `xl/workbook.xml` para aplicar `workbookProtection lockStructure`.

## Reglas E Invariantes

- Las 3 hojas de soporte siempre van primero en el workbook.
- Al abrir el archivo, la hoja activa sigue siendo la última hoja diaria visible.
- La contraseña `HHR` protege la estructura del libro y las hojas UPC de bloqueo cosmético.
- `UPC PAC` y `UPC DET` permanecen visibles como pestañas y quedan desbloqueadas.
- El adjunto del correo reemplaza diagnósticos de especialidad primaria o secundaria de psiquiatría por `[Diagnostico reservado]`, incluyendo movimientos y hojas de soporte. La copia se transforma en el servidor; el censo clínico y la descarga local conservan sus diagnósticos.
- El correo puede cifrar la apertura del archivo completo; la descarga local no.
- La agregación de hojas ocultas opera sobre un solo snapshot lógico por fecha calendario.

## Separación De Responsabilidades

- `config`: nombres, etiquetas, umbrales y headers del módulo.
- `aggregation`: reglas clínicas y consolidación de datos.
- `renderer`: layout Excel, merges, fórmulas, widths y freeze panes.
- `protection/serialization`: protección de hojas y protección OOXML de estructura.

## Validación Manual

1. Exportar un censo diario mensual.
2. Abrir el `.xlsx` y confirmar que la primera pestaña visible es la primera hoja diaria.
3. Confirmar que `RESUMEN` sigue oculto por estructura, mientras `UPC PAC` y `UPC DET` aparecen como pestañas visibles y contiguas.
4. En Excel, desproteger estructura con `HHR` y mostrar `RESUMEN` si se necesita.
5. Para revisar `UPC PAC` o `UPC DET`, abrir la pestaña directamente sin desproteger nada.
6. Revisar:
   - layout del resumen,
   - `% Ocup.` en rojo solo sobre el umbral,
   - historial de camas UPC,
   - distribución UCI/UTI en la hoja de pacientes UPC,
   - matriz diaria UPC con subtipo por día,
   - fórmulas de indicadores consolidados.

## Estrategia De Pruebas

- Unit: agregación, renderer y serializer.
- Integración: builder del workbook completo y flujo de exportación.
- Sanity: carga válida del `.xlsx`, protección de workbook, estados `hidden`, hoja activa correcta.
