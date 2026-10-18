# Dos estados independientes del censo

## Consultando una fecha
Debajo de las barras de navegación, solamente el Manutara.png original del repositorio, sin cambios de imagen, a 96 × 96 px y girando sobre su eje vertical y «Cargando». Se reutiliza el mismo indicador durante la descarga del módulo y la consulta del registro. No se monta la vista de creación ni Moa mientras la ausencia del día no esté confirmada. Se eliminó el temporizador que antes podía dar paso al estado vacío sin confirmación de Firebase. Los registros disponibles se muestran inmediatamente; los errores conservan el aviso operativo existente.

## Día confirmado sin censo
Moa aparece siempre, independientemente de la preferencia del acompañante flotante. Una de sus 18 escenas locales se elige al azar y se reproduce en bucle. Hacer clic precarga y decodifica otra distinta mientras mantiene la escena actual; el cambio es directo, sin Moa por defecto, panel de elección ni botón de cierre. Fallos o timeout de precarga conservan la escena actual. Se reutilizan imágenes y reproductor existentes, sin nuevas dependencias ni descargas de catálogos para poder copiar.

El botón «Copiar censo y sincronizar» muestra antes la fecha completa de origen. Copia únicamente el día calendario inmediatamente anterior a la fecha seleccionada cuando existe, también para fechas históricas confirmadas vacías; permisos, reconstrucción histórica y alternativa manual confirmada siguen intactos. Fuera del horario existente (08:00) el botón permanece visible y deshabilitado; se retiró el bypass forceCopyScheduleOverride y se conserva también la validación del servicio. La copia precede a la comprobación de Eloísa y a la revisión de importación. Una caída de Eloísa tras la copia no elimina el censo.

La señal compacta usa `useRayenExtensionHealth.canSync`, incluyendo compatibilidad, Ficha Médico, Gestión de Camas y vigencia de sesiones. El detalle aparece con ratón o foco. No basta con tener pestañas abiertas.

## Accesibilidad y pruebas
Movimiento reducido detiene giro y sprites en una pose fija; Moa admite teclado. Las pruebas cubren espera remota, llegada de datos, revisita de fecha, copia local vacía, confirmación de ausencia, cambio de escena sin repetición y la secuencia copiar → comprobar → revisión. No se consultan pacientes reales.

La ilustración hospitalaria anterior se retiró de esta pantalla siguiendo la revisión del diseño. No forma parte del flujo actual.

El PNG se publica con los mismos bytes en images/rapanui y se cachea al usarlo, como decoración opcional. El texto Cargando permanece disponible si la imagen no carga. No se modifica el presupuesto global ni la cobertura offline de datos clínicos.
