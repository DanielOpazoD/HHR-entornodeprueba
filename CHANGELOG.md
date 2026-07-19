# Changelog

Todos los cambios notables de este proyecto serán documentados en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/),
y este proyecto adhiere a [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-01-25

### Añadido

- **Suite de pruebas masiva:** Reparados y actualizados >1,350 tests (99% pass rate).
- **Mapeadores FHIR:** Transformación de datos de censo a recursos FHIR R4 (Core-CL).
- **Dashboard de Auditoría:** Nueva vista de estadísticas para monitoreo de logs.
- **Salud del Sistema:** Reportero de estado de conexión y salud de Firebase.

### Cambiado

- **Arquitectura Feature-First:** Reorganización de `src/features` para mejor escalabilidad.
- **React 19:** Actualización completa a React 19.x y Vite 6.
- **Vitest 4:** Upgrade del framework de pruebas para mayor velocidad.
- **Esquemas Zod:** Validación estricta en todos los repositorios para prevenir regresiones.

### Corregido

- **Mocks de Test:** Reparados fallos en tests de integración de Login y Navbar.
- **Rutas de Importación:** Corregidas referencias rotas tras el movimiento de archivos de CUDYR.
- **Asincronía en Tests:** Implementados Fake Timers para validar formularios con timeouts.
- **Detección de Regresión:** El repositorio ahora bloquea guardados que detecten pérdida masiva de datos.

---

## [Unreleased]

### Añadido

- **Extensión — barra de operaciones 0.32.0:** navegación más compacta con menú Exámenes,
  estado activo, colapso persistente, atenuación segura y soporte completo de teclado.
- Virtualización de tablas para optimizar rendimiento con >50 pacientes.
- Integración directa con API externa de validación de RUT.

### Corregido

- **Documentos clínicos — panel de formato:** el panel avanzado no se desplegaba en
  pantalla (quedaba recortado por la coerción `overflow-x:auto` → `overflow-y:auto` del
  header del modal). Ahora se renderiza por portal a `<body>` con posición fija; los
  controles de sangría vuelven a ser accesibles.
- **Documentos clínicos — sangría en listas:** `Tab`/sangría en listas ya no genera HTML
  inválido (`<ol><ol>`); el anidamiento se normaliza a `<li>…<ol>…</ol></li>`.
- **Documentos clínicos — listas obligatorias:** al reparar la forma de lista
  (Diagnósticos/Plan) ya no se pierde el formato inline (negrita/color/enlaces) y los
  comandos del toolbar re-aplican la forma obligatoria.
- **Documentos clínicos — pegado de tablas:** se preservan filas/celdas pegadas sin su
  `<table>` envolvente.
- **Documentos clínicos — comando `/lab`:** ya no desincroniza el editor del valor ni
  mueve el cursor al final; tampoco corrompe un `src`/`href` que contenga `/lab`.
- **Documentos clínicos — editor:** se limpia el timer de historial al desmontar (sin
  fugas al cambiar de documento).

---

## [1.0.0] - 2024-12-01

### Añadido

- Gestión de censo diario de pacientes hospitalizados
- Vista de 18 camas fijas + camas extra dinámicas
- Sistema CUDYR para scoring de dependencia/riesgo
- Entrega de turno de enfermería y médica
- Exportación a Excel y CSV
- Sincronización en tiempo real con Firebase
- Modo offline con localStorage
- Autenticación con Firebase Auth
- Sistema de roles (viewer, editor, admin)
- Reportes y estadísticas
- PWA con service worker

### Infraestructura

- React 18 + TypeScript
- Vite como bundler
- TailwindCSS para estilos
- Firebase (Auth + Firestore)
- Netlify para hosting
- Gmail API para envío de emails

---

## Tipos de Cambios

- `Añadido` para nuevas funcionalidades
- `Cambiado` para cambios en funcionalidades existentes
- `Obsoleto` para funcionalidades que serán removidas
- `Eliminado` para funcionalidades removidas
- `Corregido` para corrección de bugs
- `Seguridad` para vulnerabilidades
