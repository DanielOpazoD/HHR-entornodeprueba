# Arquitectura de Datos y Sincronización

Este documento detalla cómo fluyen los datos en el Sistema de Gestión de Hospitalización HHR, enfocándose en la sincronización entre el cliente (LocalStorage) y la nube (Firestore).

## 1. Niveles de Persistencia

El sistema utiliza tres niveles de persistencia para garantizar la disponibilidad y el rendimiento:

1.  **Estado Reactivo (React Context/Hooks)**: Sincronización inmediata en la UI.
2.  **Capa Local (LocalStorage/IndexedDB)**: Persistencia persistente en el dispositivo del usuario. Permite trabajo offline y carga instantánea.
3.  **Capa Nube (Firestore)**: Fuente de verdad compartida para colaboración multi-usuario y respaldo centralizado.

## 2. Guardar una celda y trabajar sin conexión

El camino de una celda, desde lo escrito hasta la confirmación del servidor, incluida la cola
durable que la conserva sin conexión, está paso a paso en la fila `census.cell-save-flow` de
[`scripts/config/feature-map.json`](../scripts/config/feature-map.json), y
`npm run check:feature-map` comprueba que cada paso exista. Ni la última escritura ni el reloj
del navegador deciden qué versión vale (SAVE-02 en el
[contrato operativo](DOMAIN_RULES.md)); el reparto de lectura y escritura está en
[architecture.md](architecture.md#el-registro-diario).

## 3. Gestión de Personal (Single Source of Truth)

> [!IMPORTANT]
> El Censo Diario es la **Única Fuente de Verdad** para el personal de turno.

- Los nombres de Enfermeros y TENS se guardan en el `DailyRecord`.
- La vista de **Entrega de Turno (Handoff)** consume estos datos directamente.
- **NO** se debe guardar personal en colecciones separadas para evitar inconsistencias por desfase de fechas.
