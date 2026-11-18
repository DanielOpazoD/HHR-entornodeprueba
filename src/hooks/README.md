# `src/hooks`

Estado React y orquestación que usan dos o más áreas o el armazón de la aplicación: el
registro diario (`useDailyRecord*`, con `useDailyRecordQuery` para leer y
`usePatchDailyRecordMutation` para parchar), la autenticación, los respaldos y la exportación.
La lógica pura que usan va en `controllers/`. Un hook que usa una sola área va en esa área, y
una operación que coordina repositorios o reutiliza semántica clínica entre áreas va en un
caso de uso de `application/`, dejando al hook como adaptador de React. **Hoy** el registro
diario todavía compone acciones del censo y la entrega (`useDailyRecordDomainModules.ts`); la
[página de arquitectura](../../docs/architecture.md) dice la precedencia entre ambos.

Reglas que se mantienen aquí: un hook no importa implementaciones de componentes
(control de capas, en `check:quality`); si existe un caso de uso o puerto, el hook no importa el
servicio concreto, y sus pruebas simulan el caso de uso o el puerto (regla
`hook-tests-mock-ports` del control de patrones de `src/`, en `check:quality`); si cambia el camino de arranque o
inicio de sesión, el hook afectado gana una prueba directa además de la de integración. La
persistencia de la entrega usa los casos de uso de `application/handoff`
([contrato de entrega](../../docs/ADR_HANDOFF_RUNTIME_SURFACES.md)). Referencia de hooks:
[docs/hooks-reference.md](../../docs/hooks-reference.md).
