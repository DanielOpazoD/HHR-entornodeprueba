# Runbook: Firestore Sync Issues

Esta entrada remite al procedimiento canónico de
[Sync y Resiliencia](../RUNBOOK_SYNC_RESILIENCE.md). No mantiene una segunda ruta de limpieza.

## Diagnóstico inicial sin borrar datos

1. Confirmar entorno, sesión y fecha clínica. Revisar estado de arranque, red y sincronización
   según el runbook canónico; la ausencia de requests no demuestra por sí sola un firewall.
2. Revisar el error concreto:
   - `permission-denied`: comprobar identidad, rol y permisos; no limpiar almacenamiento.
   - `not-found`: verificar qué recurso falta; no inferir que el día clínico fue eliminado.
   - `unavailable`: distinguir red, runtime y servicio remoto antes de reintentar.
3. Comprobar cambios sin guardar, outbox y conflictos antes de recargar o cerrar pestañas.
   Seguir [Antes de recargar o limpiar](../RUNBOOK_SYNC_RESILIENCE.md#antes-de-recargar-o-limpiar).
4. Si hay altas, traslados, CMA o movimientos afectados, continuar en
   [Recuperación del censo diario](../RUNBOOK_DAILY_CENSUS_RECOVERY.md).

## Almacenamiento local ilegible o presuntamente corrupto

No usar `Delete database`, `Limpieza Dura` ni borrar datos del sitio como primer paso.
Una cola ilegible tiene estado **desconocido**, no equivale a una cola vacía. Conservar
el perfil original y escalar según el runbook canónico. Firestore no puede restaurar
cambios que nunca recibió; un censo visible en otro navegador no prueba que esté todo sincronizado.

## Servicio remoto no disponible

Consultar [estado de Firebase](https://status.firebase.google.com/) como una señal adicional.
El fallback local depende de que IndexedDB sea utilizable; no garantiza todas las operaciones.
Al volver la conexión, verificar confirmación remota y tareas pendientes. Un fallo de permisos
o un conflicto puede requerir intervención y no se resuelve necesariamente con un reintento.
