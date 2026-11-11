# Codebase Canon

Este documento define la taxonomía canónica del repo. Su objetivo es bajar ambigüedad: cuando se agrega o mueve código, primero se decide la responsabilidad y después la carpeta.

## Capas canónicas

| Zona               | Dueño                | Qué vive aquí                                                                            | Qué no debe vivir aquí                                        |
| ------------------ | -------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `src/features/`    | bounded context      | UI, hooks locales, controllers y contratos propios de una feature                        | utilidades transversales sin dueño de negocio                 |
| `src/application/` | casos de uso         | use cases, outcomes, puertos y coordinación cross-feature                                | componentes React, providers globales, adapters concretos     |
| `src/services/`    | infraestructura      | repositorios, storage, auth, integraciones externas, runtime adapters concretos          | componentes, lógica de presentación, wiring de feature        |
| `src/hooks/`       | shell/UI transversal | hooks de composición reutilizables por más de una feature o por el shell                 | duplicados de controllers dueños de feature                   |
| `src/context/`     | estado global        | providers, access hooks y contratos de estado global                                     | reglas de negocio profundas, acceso directo a infraestructura |
| `src/domain/`      | dominio puro         | reglas agnósticas de framework y modelos puros                                           | side effects, React, detalles de storage                      |
| `src/shared/`      | transversal real     | contracts genéricos, presentation helpers y runtime adapters usados por varios contextos | dumping ground de código sin dueño claro o aliases de dominio |
| `src/types/`       | tipos globales       | DTOs y tipos estables de dominio o integración no ligados a React                        | tipos efímeros de una sola feature o un solo hook             |
| `src/schemas/`     | validación runtime   | schemas Zod y contratos de entrada/salida validados                                      | reglas de UI o helpers genéricos                              |
| `src/utils/`       | utilidades puras     | helpers pequeños y genéricos sin semántica clínica fuerte                                | reglas de negocio, adapters, estado                           |

## Reglas rápidas de decisión

1. Si el código pertenece a un solo contexto funcional, vive en su `feature`.
2. Si coordina varios contextos o expone un contrato de caso de uso, vive en `application`.
3. Si toca red, storage, Firebase, Netlify o vendors externos, vive en `services`.
4. Si solo sirve al shell o a más de una feature desde React, vive en `hooks` o `context`.
5. Si parece transversal pero solo lo usa una feature, no va a `shared`: se queda en la feature.
6. Si es una entidad de dominio o payload estable, el owner es `src/types/`; `shared` solo puede ofrecer compatibilidad temporal o helpers derivados.

## Reglas de ownership

- Los consumers externos a una feature deben entrar por su `index.ts` o `public.ts`.
- `src/hooks/controllers` no debe duplicar controllers dueños de `src/features/*/controllers`.
- `src/shared/` y `src/types/` requieren justificación transversal real.
- Nuevas compatibilidades legacy deben entrar por boundaries explícitos, no por convenience imports.
- Outcomes y helpers de mensaje reutilizados por varias capas pertenecen a `src/shared/contracts/`, no a `application/shared/`.
- Los tipos del paciente tienen un solo hogar en `src/types/domain/patient.ts` y se importan desde ahí con su nombre.
- Las formas más estrechas llevan nombre propio; nunca reutilizan `PatientData`.
- No se crean alias puros ni reexportaciones de esos tipos desde contratos por capa.

## Compatibilidad legacy

Las compatibilidades legacy de roles, auth, `firestore.rules` y `storage.rules` se mantienen como protección de migración hasta que esta aplicación sea la versión oficial. No deben recibir consumidores nuevos ni usarse como ruta conveniente para features nuevas.

Su retiro solo se habilita después de auditar producción y confirmar que no quedan claims, `config/roles`, sesiones o flujos operativos activos dependientes de alias legacy como `viewer_census`. Hasta ese hito, la mejora correcta es mantenerlas inventariadas, testeadas y sin crecimiento.

## Estado de `src/infrastructure`

`src/infrastructure/` queda retirado como capa activa. Se conserva solo como marcador histórico para evitar reintroducir una migración incompleta.

- No agregar código nuevo allí.
- La infraestructura concreta vive en `src/services/`.
- Si en el futuro se quiere reactivar esa capa, debe existir primero una ADR o documento equivalente que redefina ownership y plan de migración.

## Anti-patrones a evitar

- Duplicar el mismo controller en `hooks/controllers` y en una `feature`.
- Mover contratos a `shared` solo para evitar imports largos.
- Crear nuevas capas nominales sin consumers reales ni reglas de ownership.
- Dejar carpetas “en transición” por tiempo indefinido.
