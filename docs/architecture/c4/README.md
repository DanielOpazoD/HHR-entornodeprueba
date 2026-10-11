# Mapa arquitectónico C4 de HHR

**Snapshot del código:** [fd06b55824194ad0f8fc5f6d04c31e1c8608c1d3](https://github.com/DanielOpazoD/HHR-entornodeprueba/tree/fd06b55824194ad0f8fc5f6d04c31e1c8608c1d3).
Es la revisión representada en los diagramas, no una afirmación de que describan
cualquier `HEAD` posterior. Los flujos vigentes y sus decisiones siguen gobernados
por la [guía canónica de arquitectura](../../architecture.md) y los ADR.

Mapa condensado basado en lectura estática del repositorio. No acredita despliegue,
certificación clínica ni corrección de los controles de seguridad. No contiene
pacientes, credenciales ni resultados de infraestructura productiva.

## 1. Contexto

Personas, HHR clínico e integraciones externas. Horas Extras comparte repositorio,
pero no login, runtime ni Firebase clínico.

![Contexto C4: usuarios, HHR, integraciones y aplicación independiente de Horas Extras](diagrams/01-contexto.svg)

[Abrir SVG](diagrams/01-contexto.svg) · [Editar PlantUML](01-contexto.puml)

## 2. Contenedores

Web/PWA, extensión MV3, IndexedDB/outbox, Functions, Auth, Firestore y Storage.
La frontera HHR es lógica, no un límite físico o una garantía de autorización.
Firestore es autoridad remota; la política del comando determina el orden local/remoto.

![Contenedores C4: web, extensión, persistencia local y backend HHR](diagrams/02-contenedores.svg)

[Abrir SVG](diagrams/02-contenedores.svg) · [Editar PlantUML](02-contenedores.puml)

## 3. Componentes web

Responsabilidades agregadas: features, consultas, dominio, ports, repositorios,
outbox y adaptadores. No es un grafo exhaustivo de imports ni obliga a que cada
feature atraviese todas las capas.

![Componentes C4: responsabilidades del cliente y caminos de persistencia](diagrams/03-componentes-web.svg)

[Abrir SVG](diagrams/03-componentes-web.svg) · [Editar PlantUML](03-componentes-web.puml)

## 4. Horas Extras

Sistema auxiliar aislado: cliente, API y proyecto Firestore propios. La demo usa
memoria ficticia; el empaquetado alternativo Cloudflare sirve assets, no implementa
la API nube. Consultar su [guía de nube](../../../apps/horas-extras/cloud-setup.md).

![Contenedores C4 de Horas Extras, sin conexión con el sistema clínico](diagrams/04-horas-extras.svg)

[Abrir SVG](diagrams/04-horas-extras.svg) · [Editar PlantUML](04-horas-extras.puml)

## Lectura y evidencia

- Personas fuera de las fronteras del sistema; flechas para solicitudes/dependencias.
  Se omiten respuestas; web/extensión intercambian mensajes en ambos sentidos.
- Líneas discontinuas: ruta alternativa o dependiente de configuración.
- Cloud Functions usa Admin SDK; las reglas de cliente no sustituyen su autorización.
  Netlify verifica tokens/roles en los endpoints que lo requieren y también puede
  resolver roles por `checkUserRole`; no se dibuja cada dependencia auxiliar.
- Proxies institucionales Syslab y bot WhatsApp: servicios externos configurables,
  no servidores implementados en este checkout. IA depende del proveedor seleccionado.

Fuentes de la revisión representada: [arquitectura](https://github.com/DanielOpazoD/HHR-entornodeprueba/blob/fd06b55824194ad0f8fc5f6d04c31e1c8608c1d3/docs/architecture.md),
[repositorios](https://github.com/DanielOpazoD/HHR-entornodeprueba/blob/fd06b55824194ad0f8fc5f6d04c31e1c8608c1d3/src/services/repositories/README.md),
[storage](https://github.com/DanielOpazoD/HHR-entornodeprueba/blob/fd06b55824194ad0f8fc5f6d04c31e1c8608c1d3/src/services/storage/README.md),
[extensión](https://github.com/DanielOpazoD/HHR-entornodeprueba/blob/fd06b55824194ad0f8fc5f6d04c31e1c8608c1d3/extension/manifest.json),
[Functions](https://github.com/DanielOpazoD/HHR-entornodeprueba/blob/fd06b55824194ad0f8fc5f6d04c31e1c8608c1d3/functions/index.js)
y [Netlify](https://github.com/DanielOpazoD/HHR-entornodeprueba/blob/fd06b55824194ad0f8fc5f6d04c31e1c8608c1d3/netlify.toml).

## Regenerar sin servidor externo

Necesarios: Python 3, Java y Graphviz (`brew install graphviz` en macOS;
`sudo apt install graphviz` en Linux). No se añaden dependencias a la aplicación.
Descargar [PlantUML 1.2024.5](https://github.com/plantuml/plantuml/releases/download/v1.2024.5/plantuml-1.2024.5.jar)
y, desde la raíz del repositorio, ejecutar:

```sh
python3 docs/architecture/c4/render.py --jar "$HOME/tools/plantuml-1.2024.5.jar" --check
python3 docs/architecture/c4/render.py --jar "$HOME/tools/plantuml-1.2024.5.jar"
```

También se admite la variable `PLANTUML_JAR` en lugar de `--jar`.
Los SVG se versionan para que GitHub los muestre sin ejecutar herramientas.
Los PNG y fuentes temporales de `build/` se ignoran. No se suben JAR, PDF, ZIP,
entornos Python ni logs.

Los fuentes conservan los includes C4 remotos del playbook; el renderer los cambia
**solo en `build/`** por las copias locales. Verifica sus SHA-256 contra
[provenance.json](vendor/provenance.json); [LICENSE](vendor/LICENSE) conserva MIT.
No envía código ni diagramas a un servidor PlantUML. Fonts/Graphviz pueden cambiar
el layout entre plataformas; se verificó Java 17 y Graphviz 16.1.0 en macOS.

## Mantenimiento

Editar el `.puml` dueño del flujo, actualizar el SHA representado en esta guía y
en [style.puml](style.puml), regenerar las cuatro vistas y revisar visualmente el
diff. Los cambios de arquitectura real deben seguir documentándose primero en
la guía canónica/ADR; estos dibujos no reemplazan sus contratos.
