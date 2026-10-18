# Dos estados independientes del censo

## Consultando una fecha
Debajo de las barras de navegación, cuatro puntos de colores que giran y se agrupan suavemente, sin motivos Rapa Nui ni texto visible. «Cargando» permanece como etiqueta para lectores de pantalla; movimiento reducido deja los puntos quietos. Se reutiliza durante la descarga del módulo y la consulta del registro. No se monta creación ni Moa mientras la ausencia no esté confirmada.

La corrección abarca el origen de la clasificación, no un retraso visual:
- Una búsqueda local sin registro tiene `unconfirmed_missing`; no acredita ausencia en Firebase.
- `confirmed_missing` requiere evidencia explícita de ausencia remota en el resultado del repositorio o de la suscripción.
- El bootstrap exige evidencia de la fecha seleccionada y que no siga ejecutándose una lectura.
- Las respuestas negativas en caché se revalidan al visitar una fecha; un censo pudo haberse creado en otro equipo. Los registros existentes conservan el plazo de frescura configurado.
- Un resultado vacío de una consulta anterior no sustituye un registro realtime que llegó después de iniciar esa consulta.
- Se eliminó el temporizador que convertía espera en supuesto vacío. Los datos disponibles se muestran inmediatamente.

## Resolución sin esperas redundantes
El primer acceso local se mantiene para mostrar datos existentes rápidamente. Si esa lectura no encuentra un registro, la consulta remota empieza sin esperar al callback idle (hasta 1,2 s). La recuperación adicional de hoy solo se activa tras una lectura fallida, nunca mientras la consulta principal sigue pendiente ni tras una ausencia confirmada. La prueba retiene deliberadamente el callback idle y verifica una sola consulta remota, sin recuperación duplicada.

## Día confirmado sin censo
Moa aparece siempre, independientemente de la preferencia del acompañante flotante. Una de sus 18 escenas locales se elige al azar y se reproduce en bucle. Hacer clic precarga y decodifica otra distinta mientras mantiene la escena actual; el cambio es directo, sin Moa por defecto, panel de elección ni botón de cierre. Fallos o timeout de precarga conservan la escena actual. Se reutilizan imágenes y reproductor existentes, sin nuevas dependencias ni descargas de catálogos para poder copiar.

El botón «Copiar censo y sincronizar» muestra antes la fecha completa de origen. Copia únicamente el día calendario inmediatamente anterior a la fecha seleccionada cuando existe, también para fechas históricas confirmadas vacías; permisos, reconstrucción histórica y alternativa manual confirmada siguen intactos. Fuera del horario existente (08:00) el botón permanece visible y deshabilitado; se retiró el bypass forceCopyScheduleOverride y se conserva también la validación del servicio. La copia precede a la comprobación de Eloísa y a la revisión de importación. Una caída de Eloísa tras la copia no elimina el censo.

La señal compacta usa `useRayenExtensionHealth.canSync`, incluyendo compatibilidad, Ficha Médico, Gestión de Camas y vigencia de sesiones. El detalle aparece con ratón o foco. No basta con tener pestañas abiertas.

## Accesibilidad y pruebas
Movimiento reducido detiene los sprites en una pose fija; Moa admite teclado. Las pruebas cubren espera remota, llegada de datos, revisita de fecha, copia local vacía, confirmación de ausencia, cambio de escena sin repetición y la secuencia copiar → comprobar → revisión. No se consultan pacientes reales.

La ilustración hospitalaria anterior se retiró de esta pantalla siguiendo la revisión del diseño. No forma parte del flujo actual.

El botón bloqueado por horario usa fondo gris, texto atenuado y cursor de no disponible, además de disabled nativo y validación en la acción.
