# `src/services`

Servicios con I/O compartidos: repositorios del registro diario (`repositories/`),
almacenamiento local, Firestore y cola (`storage/`), autenticación (`auth/`), telemetría
(`observability/`), Firebase (`firebase-runtime/`), exportación, PDF, correo e integraciones
externas. La inyección de repositorios en la aplicación vive en `src/context/RepositoryContext.tsx`. Aquí
no van componentes, hooks de UI ni lógica de presentación; un servicio que usa una sola área
va en esa área.

Cada subsistema grande tiene su README con su contrato operativo:
[repositorios](repositories/README.md), [almacenamiento](storage/README.md),
[cola](storage/sync/README.md), [autenticación](auth/README.md),
[Firebase](firebase-runtime/README.md), [telemetría](observability/README.md) y
[respaldos](backup/README.md). Qué puede importar esta carpeta y dónde va cada cosa:
[arquitectura](../../docs/architecture.md).
