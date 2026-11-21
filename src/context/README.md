# `src/context`

Proveedores de estado React compartido y sus hooks de acceso: autenticación, registro diario,
repositorios (`RepositoryContext.tsx`), interfaz, configuración visual, personal, auditoría y versión. El contexto del registro diario
está fragmentado para no repintar de más: las acciones se importan desde
`useDailyRecordScopedActions` (así no se forman ciclos entre fragmentos) y cada componente lee
el fragmento más estrecho que le sirve (sección «El registro diario» de la
[página de arquitectura](../../docs/architecture.md)). `AuthContext` solo depende de
`useAuthState`; la orquestación de autenticación vive fuera del contexto.

Aquí no van reglas de negocio ni acceso directo a infraestructura. Dónde va cada cosa:
[arquitectura](../../docs/architecture.md).
