# Actas de farmacia

En **Documentos Clínicos → Actas de farmacia**, el panel lateral permite abrir las actas
de devolución y entrega de eliminados. El acceso **Documentos → Formularios** del censo
conserva las mismas actas como atajo; ambos accesos usan el mismo editor y generador PDF.
Las actas admiten
descarga en blanco y **Completar**. El editor propone al responsable, permite buscar la
presentación del fármaco o ingresar un insumo manualmente, y genera un PDF con logo HHR,
tablas paginadas y firmas manuscritas en blanco. Ambas actas se generan en vertical y permiten
elegir A4 o Carta en **Tamaño de papel**. Cambiar el tamaño conserva los datos e invalida el PDF
preparado para que la vista previa, descarga e impresión reflejen la selección. No registra
movimientos de inventario.

## Fuentes

Los dos Word originales fueron enviados por Hospitalizados HHR el 22 de octubre de 2026.
Las versiones institucionales conservan sus columnas y leyendas. El número y año históricos
del acta de eliminación quedan abiertos para completar; no se asigna una aprobación nueva.
Los assets públicos son formularios vacíos, sin pacientes, RUT personales ni firmas.

`domain/pharmacy/arsenalHhr2025.json` procede del archivo **Arsenal 2025 HHROA (1).xlsx**,
recibido en el correo **Arsenal farmacológico** del 13 de julio de 2026. Contiene 356 registros
no vacíos de la primera hoja y sus tres columnas: medicamento, presentación y observaciones.
Se normalizan únicamente espacios. Los IDs `hhr-2025-r…` identifican la fila de origen;
no son códigos institucionales de medicamentos. El SHA-256 del Excel está en `source.sha256`.
El catálogo no contiene lotes, fechas de vencimiento ni existencias. La fecha 2025 se conserva
y no certifica que el arsenal siga vigente en 2026.

Para actualizarlo, revisar un Excel autorizado y sustituir los registros y la procedencia juntos.
Conservar presentaciones distintas y verificar las tres columnas contra el original. El
generador valida ID, nombre y presentación contra el catálogo; cualquier otro producto debe
identificarse explícitamente como ingreso manual.

## Datos y firma

Los valores del acta se mantienen en memoria y se descartan al salir con confirmación. El
perfil profesional editable está separado por UID y no contiene medicamentos ni pacientes.
Los datos propuestos desde un ingreso por RUT sirven para completar el formulario; no cambian
roles, permisos ni autenticación. El usuario revisa nombre, cargo, unidad y RUT antes de
imprimir. Admin no se transforma automáticamente en enfermero. La recepción queda abierta
para nombre, RUT y firma manuscritos.

## Verificación

Las pruebas de dominio comprueban cantidades, fechas, DV del RUT y selección de presentación.
Los tests PDF usan `pdf-lib` real y verifican logo, tipos de acta y paginación, incluyendo filas
largas. Los tests del editor cubren perfil por UID, salida con datos, edición e invalidación del
PDF preparado. `e2e/clinical-library-pharmacy.spec.ts` recorre Formularios con datos sintéticos,
descarga PDF, tablas con varias páginas y vista móvil. No acredita una impresión física ni
una transacción real de farmacia.
