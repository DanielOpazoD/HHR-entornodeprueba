# Diseño: biblioteca personal de indicaciones médicas

## Objetivo

Mejorar el módulo rápido de indicaciones médicas para pacientes hospitalizados agregando indicaciones personales reutilizables, registro clínico trazable por paciente/día y soporte seguro para generar indicaciones con fecha objetivo futura.

El cambio debe preservar el flujo rápido del modal actual. No debe transformarse en un nuevo workspace de documentos clínicos ni en un módulo paralelo complejo.

## Decisiones aprobadas

- Usar el modal actual de indicaciones médicas como base.
- Agregar un panel lateral derecho llamado "Mis indicaciones".
- Guardar las indicaciones reutilizables en Firebase, separadas por `userId`.
- Guardar las indicaciones generadas para un paciente como registro clínico compartido por paciente, episodio y día objetivo.
- Separar la fecha clínica objetivo de la fecha de generación.
- Para indicaciones futuras, mostrar ambas fechas con claridad:
  - `Indicaciones para 31-05-2026`
  - `Generadas el 29-05-2026 10:42`
- Calcular `diasEstada` según la fecha objetivo, no según la fecha de generación.

## Experiencia de usuario

El modal mantiene el área principal de edición a la izquierda:

- banner del paciente;
- selector de fecha objetivo;
- campos de reposo, régimen, pendientes y kinesiología;
- lista editable de indicaciones;
- campo de médico tratante;
- acciones de guardar/imprimir.

El nuevo panel lateral derecho contiene la biblioteca personal del usuario:

- lista de indicaciones guardadas;
- búsqueda/filtro si la lista crece lo suficiente;
- acción para insertar una indicación guardada en la lista activa del paciente/día;
- acción para guardar una indicación actual en la biblioteca personal;
- acciones para editar o eliminar indicaciones personales.

La primera implementación debe preferir controles simples sobre un administrador complejo de biblioteca. Pestañas, carpetas, etiquetas y estadísticas avanzadas quedan fuera del primer bloque salvo que puedan integrarse con muy bajo riesgo.

## Comportamiento de fechas

El modal parte con la fecha del censo actual o con hoy como fecha objetivo, según el contexto que ya tenga disponible el flujo de censo/date strip.

Cuando el usuario selecciona una fecha objetivo futura:

- cambia la fecha objetivo visible en el modal;
- `diasEstada` se recalcula desde la fecha de ingreso del paciente hasta la fecha objetivo;
- el PDF usa la fecha objetivo como fecha clínica;
- el registro generado guarda `targetDate` y `generatedAt`;
- la interfaz deja claro que fue generado anticipadamente para ese día, sin insinuar que fue escrito en la fecha futura.

El usuario puede generar e imprimir indicaciones para una fecha futura porque eso representa un flujo clínico real. El diseño no debe llamar "borrador" a esos registros si fueron generados/imprimidos.

## Modelo de datos

### Biblioteca personal

Forma recomendada de colección:

```text
medical_indication_templates/{userId}/items/{templateId}
```

Campos sugeridos:

- `id`
- `userId`
- `text`
- `createdAt`
- `updatedAt`
- `createdByName`
- `lastUsedAt`
- `useCount`
- `isArchived`

La primera versión puede omitir `useCount` y `lastUsedAt` desde la UI, pero el modelo de escritura puede incluirlos si no agrega riesgo.

### Indicaciones generadas para paciente

Forma recomendada de colección:

```text
medical_indication_records/{episodeId_or_patientKey_targetDate_recordId}
```

También puede usarse una forma anidada si calza mejor con las convenciones actuales de repositorios.

Campos sugeridos:

- `id`
- `patientRut`
- `patientName`
- `episodeId`
- `bedId`
- `targetDate`
- `generatedAt`
- `generatedByUserId`
- `generatedByName`
- `generatedByRole`
- `generatedFromTemplateIds`
- `admissionDate`
- `daysOfStayForTargetDate`
- `treatingDoctor`
- `reposo`
- `regimen`
- `kineType`
- `kineTimes`
- `pendingNotes`
- `indications`
- `pdfPrintedAt`

El registro clínico generado es compartido para usuarios clínicos/admin autorizados. La biblioteca personal sigue siendo privada del usuario autenticado.

## Auditoría y trazabilidad legal

El registro generado debe permitir responder:

- quién generó las indicaciones;
- para qué paciente y episodio;
- para qué día clínico objetivo;
- cuándo fueron generadas;
- qué indicaciones contenían;
- si se originaron desde plantillas guardadas o texto libre.

Si el camino actual de auditoría puede registrar IP, user-agent y acción sin una refactorización amplia, la implementación debe emitir eventos clínicos cuando:

- se genera un registro de indicaciones para paciente/día;
- se crea, edita, archiva o elimina una indicación personal;
- se inserta una indicación guardada en un set de indicaciones de paciente/día.

Los nombres de auditoría deben ser clínicos y legibles, no nombres internos de código.

## Arquitectura

Mantener la implementación pequeña y cercana a los límites existentes:

- La UI principal permanece en `src/components/layout/date-strip/MedicalIndicationsDialog.tsx`.
- El estado local actual permanece en `useMedicalIndicationsEditor`.
- Agregar un hook o servicio focalizado para leer/escribir la biblioteca personal en Firebase.
- Agregar un repositorio/servicio para registros generados por paciente/día.
- Mantener estable el contrato de generación PDF, agregando fecha objetivo y días de estadía recalculados desde el mapeo actual del modal hacia el PDF.
- Evitar importar servicios amplios del workspace `clinical-documents` dentro de este módulo rápido.

El catálogo personal existente de `clinical-documents` no será la fuente de verdad de este módulo. Puede inspirar comportamiento, pero las indicaciones médicas rápidas necesitan su propio almacenamiento Firebase por usuario y su propio registro clínico por paciente/día.

## Criterios de aceptación del primer bloque funcional

El primer PR funcional derivado de este diseño se considera completo cuando:

- el modal actual sigue permitiendo generar PDF sin exigir biblioteca personal;
- el usuario puede guardar, editar, archivar/eliminar e insertar indicaciones de su biblioteca privada;
- otro usuario no puede ver ni modificar la biblioteca privada del primero;
- el usuario puede seleccionar una fecha objetivo futura;
- la interfaz muestra fecha objetivo y fecha de generación como conceptos separados;
- el PDF usa fecha objetivo y días de estadía calculados para esa fecha;
- al guardar/imprimir queda un registro clínico compartido para paciente, episodio y día objetivo;
- el registro clínico conserva autor, fecha de generación y contenido exacto de las indicaciones;
- las fallas de Firebase no se silencian cuando afectan trazabilidad clínica.

## Alcance de esta rama

Esta rama solo deja aprobado el diseño funcional y técnico. No agrega funciones productivas, no cambia reglas Firestore y no altera el modal actual. La implementación debe hacerse en un PR posterior o en un nuevo commit explícitamente orientado a código.

## Manejo de errores

Falla al cargar biblioteca personal:

- el modal sigue funcionando para ingresar indicaciones manuales y generar PDF;
- el panel muestra un estado compacto de error/reintento.

Falla al guardar una plantilla:

- la indicación actual permanece en la lista del paciente/día;
- el usuario ve un mensaje de error y puede reintentar.

Falla al guardar el registro generado:

- la impresión no debe sugerir silenciosamente que la trazabilidad quedó completa;
- si el PDF aún puede generarse, la UI debe advertir claramente que el registro clínico no se guardó;
- el comportamiento preferido es guardar el registro antes o durante la impresión y mostrar el fallo antes de confirmar el cierre del flujo.

## Pruebas

La cobertura focalizada debe incluir:

- las plantillas personales cargan solo para el `userId` actual;
- insertar una indicación guardada en la lista activa;
- guardar una indicación actual en la biblioteca personal;
- cambiar la fecha objetivo recalcula días de estadía;
- el payload del PDF usa fecha objetivo y días de estadía para esa fecha;
- el registro generado guarda `targetDate` y `generatedAt`;
- la etiqueta de fecha futura diferencia fecha objetivo de fecha de generación;
- pruebas de reglas/permisos para acceso privado a plantillas y acceso clínico compartido a registros si se modifican reglas Firestore.

Gate sugerido antes de PR:

```text
npx vitest run src/tests/components/layout/date-strip/MedicalIndicationsQuickAction.test.tsx src/tests/services/pdf/medicalIndicationsPdfService.test.ts
npm run typecheck
npm run lint -- --max-warnings 0
npm run build
```

Si se tocan reglas Firestore o repositorios remotos, agregar el gate de emulator/rules correspondiente.

## Fuera de alcance para el primer bloque

- Timeline avanzado con comparación entre días.
- Bibliotecas compartidas por especialidad o rol.
- Flujo de aprobación/firma.
- Conciliación automática de medicamentos.
- Reemplazar el catálogo de indicaciones de `clinical-documents`.
- Taxonomía compleja de etiquetas/carpetas para plantillas guardadas.
