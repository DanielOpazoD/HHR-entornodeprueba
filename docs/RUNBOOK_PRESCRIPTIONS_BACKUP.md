# Runbook Recetas: respaldo mensual y eliminación manual

## Política vigente

Las recetas del módulo de visualización no se eliminan automáticamente por edad.
El campo histórico `expiresAt` se conserva como fecha sugerida de revisión para
el respaldo mensual, no como TTL operativo.

## Cierre mensual

1. Entrar al visor de recetas con una cuenta autorizada.
2. Exportar el respaldo mensual en PDF y guardarlo en el repositorio operativo definido por el hospital.
3. Revisar que el respaldo incluya las recetas esperadas del período.
4. Recién después del respaldo, eliminar manualmente las recetas que el administrador decida retirar.
5. Si hay duda sobre un respaldo, no eliminar la receta y escalar a administración.

## Verificación técnica

Después de desplegar Functions, confirmar que no exista una función o scheduler
activo llamado `cleanExpiredPrescriptions`. La eliminación esperada debe generar
eventos `PRESCRIPTION_MANUAL_DELETED`; los eventos `PRESCRIPTION_RETENTION_DELETED`
solo pueden aparecer como historial de versiones antiguas.
