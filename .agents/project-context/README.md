# PointStream — Contexto Persistente del Proyecto

> Creado: 2026-09-17 | Fase 0 — Auditoría inicial

Esta carpeta contiene el contexto estructurado del proyecto PointStream.
Su propósito es permitir que las siguientes fases de desarrollo trabajen sobre
información pre-analizada en lugar de re-explorar el repo desde cero.

## Índice de documentos

| Archivo | Contenido |
|---------|-----------|
| [architecture.md](./architecture.md) | Mapa completo de arquitectura Electron, IPC, BrowserWindows, flujos |
| [modules.md](./modules.md) | Responsabilidades, dependencias y riesgos por módulo |
| [ipc-map.md](./ipc-map.md) | Tabla completa de todos los canales IPC y payloads |
| [dependencies.md](./dependencies.md) | Dependencias npm, APIs externas, runtime, empaquetado |
| [build.md](./build.md) | Scripts de build, electron-builder, NSIS, assets |
| [known-issues.md](./known-issues.md) | 8 problemas documentados con root cause y severidad |
| [decisions.md](./decisions.md) | Decisiones de diseño con justificación y estado |

## Uso en fases futuras

Al iniciar una nueva fase, el agente debe:
1. Leer este README para orientarse
2. Leer los docs relevantes a la tarea (no todos)
3. Verificar que los archivos referenciados no hayan cambiado
4. Actualizar este contexto si la fase modifica arquitectura o decisiones

## Reglas permanentes del proyecto

- **ZERO FAKE DATA**: Nunca inventar estadísticas ni completar valores faltantes
- **No refactors no solicitados**
- **No actualizar dependencias sin justificación**
- **No cambiar arquitectura sin documentarlo en decisions.md**

## Stack

- Electron ^28.0.0 (Chromium ~120)
- Node.js v24.19.0
- axios ^1.17.0
- electron-builder ^24.9.1
- UI: HTML + CSS + Vanilla JS (sin frameworks)
- Fuente: Inter (Google Fonts)
