# ADR: Fachada Canónica de Acceso App Shell

**Estado:** Vigente

## Decisión

La navegación del app shell consume una fachada única en `shared/access/operationalAccessPolicy.ts` para visibilidad de módulos, edición y saneamiento de rutas.

## Motivo

La coexistencia entre helpers legacy de `utils/permissions` y políticas más nuevas generaba wiring duplicado y decisiones dispersas entre `Navbar`, `AppContent` y `AppRouter`.

## Consecuencia

- El app shell usa `getVisibleAppModules`, `canEditAppModule` y `sanitizeAppModuleForRole`.
- Las acciones por rol viven en `shared/access/rolePermissions.ts` (antes `utils/permissions`, fundido en `shared/access` el 18-11-2026), detrás de la fachada.
- Los consumidores nuevos deben entrar por la fachada operativa, no por combinaciones ad hoc: ESLint rechaza comparar o listar roles a mano fuera de `shared/access`.
