# Maintenance Iteration Log

Registro interno recurrente para mejoras de alto valor y bajo riesgo. Cada iteración debe ser pequeña, verificable y cerrarse con evidencia de checks.

> Usar listas con viñetas (sin tablas anchas, porque Prettier las rellena con espacios).

## Criterios de Uso

- Registrar solo mejoras que reduzcan riesgo real de estabilidad, seguridad, mantenibilidad o escalabilidad.
- Evitar refactors cosméticos sin señal operacional.
- Preferir borrar complejidad y corregir fallos reales antes que agregar capas o scripts nuevos.
- Cerrar cada iteración con comandos ejecutados y próximos pasos concretos.

## Histórico archivado

- Iteraciones de marzo a mayo de 2026: [MAINTENANCE_ITERATION_LOG_2026_H1.md](./MAINTENANCE_ITERATION_LOG_2026_H1.md)
- Instantánea de auditoría de abril de 2026: [TECHNICAL_APPLICATION_AUDIT_2026-04.md](./TECHNICAL_APPLICATION_AUDIT_2026-04.md)

## Iteraciones recientes

### 2026-11-23 · Ola de reducción de deuda técnica (#1949–#1963) (completado)

- **Objetivo:** Retirar dependencias y puentes legacy confirmados, endurecer seguridad puntual en backend/SW, modularizar módulos >500 líneas y compactar configuraciones/bitácoras sin introducir sobreingeniería.
- **Cambios:** Retiro de `ts-node` y `hash.js` (`#1952`), cero `as never` en producción y bloqueo permanente en ESLint (`#1953`, `#1955`), `-401` casteos en tests (`#1949`, `#1954`), consolidación de 25 suites `build/` (`#1950`), modularización de scripts >600L y módulos grandes de backend (`#1956`, `#1959`), poda de 48 documentos archivados sin referencias (`#1957`), retiro de `viewer_census` y defaults v1 de documentos clínicos (`#1960`, `#1961`), comparación timing-safe del PIN + límites/timeout del proxy de recetas + actualización de proveedor IA (`#1962`), y expiración/limpieza de cachés del Service Worker + declaración de `terser` (`#1963`).
- **Verificación:** Todas las PRs integradas con CI completo en verde (`52/52`–`53/53` controles y `ci-summary`).
