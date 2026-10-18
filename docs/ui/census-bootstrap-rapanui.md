# Inicio del censo y carga remota

- El diseño aprobado se conserva como SVG editable local, sin dependencias ni solicitudes externas.
- La fecha de origen se muestra completa antes de «Copiar censo y sincronizar». La elegibilidad sigue usando exclusivamente el día calendario inmediatamente anterior, según el controlador existente.
- Se mantienen los permisos, reconstrucción histórica, alternativa manual confirmada, orden copiar → comprobar → abrir revisión y advertencia cuando la copia se completa pero Eloísa no está disponible.
- El indicador compacto consume `useRayenExtensionHealth.canSync`: extensión compatible, Ficha Médico y Gestión de Camas listas y sesiones con vigencia suficiente. No infiere disponibilidad solo por pestañas abiertas. La explicación se muestra con ratón o foco.
- Mientras un registro sin datos no esté en `confirmed_empty`, no se monta la vista de creación. Agotar el plazo de espera nunca constituye prueba de ausencia. Los registros disponibles se muestran inmediatamente.
- La consulta pendiente usa un manu tara pequeño en colores `medical`. Timeout/modo local sin registro muestra un mensaje quieto de recuperación, no una animación indefinida que sugiera progreso. Los errores conservan el aviso operativo existente.
- El movimiento reducido detiene tanto el giro del manu tara como el pestañeo de la ilustración.

## Verificación
Pruebas focalizadas cubren espera remota más allá del plazo anterior, cambio/revisita de fecha, llegada de datos, cache local vacía, creación confirmada, fuentes incompletas y secuencia de copia/sincronización. Las pruebas de componente usan el flujo real con fuentes/contextos simulados, sin pacientes reales.

La ilustración es una representación estilizada de Hanga Roa, no una reconstrucción arquitectónica del hospital. El manu tara es un dibujo original simplificado inspirado en un ave marina.
