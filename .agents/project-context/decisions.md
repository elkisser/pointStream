# PointStream — Decisiones de Diseño

> Creado: Fase 0 (2026-09-17) | Actualizado: Fase 1 (2026-09-17)

## DEC-001: Scraping con BrowserWindow nativo (no Puppeteer)
**Decisión:** Usar BrowserWindow de Electron para scraping en lugar de Puppeteer/Playwright.
**Razón:** Electron ya está como dependencia; agregar Puppeteer duplicaría Chromium (~150MB extra).
**Consecuencia:** El scraping está acoplado al ciclo de vida de Electron; no funciona sin GUI.
**Estado:** MANTENER

## DEC-002: Sesiones persistentes para Cloudflare
**Decisión:** `partition: 'persist:hltv'` y `partition: 'persist:forg1'`
**Razón:** Las cookies de Cloudflare (cf_clearance) se preservan entre sesiones.
**Consecuencia:** El usuario solo necesita pasar Cloudflare una vez.
**Estado:** MANTENER — crítico para el funcionamiento

## DEC-003: User-Agent = Chrome real sin "Electron"
**Decisión:** `app.userAgentFallback` forzado con versión de Chrome real.
**Razón:** HLTV y otros sitios bloquean el UA que incluye "Electron".
**Estado:** MANTENER

## DEC-004: Token Telegram XOR-ofuscado
**Decisión:** Token no en texto plano sino XOR+base64.
**Razón:** Dificulta búsquedas triviales en el repo/bundle.
**Advertencia:** NO es seguridad real. El token puede extraerse del bundle.
**Estado:** MANTENER (aceptable para app de escritorio personal)

## DEC-005: ZERO FAKE DATA
**Decisión:** Si no hay datos, mostrar estado explícito. Nunca inventar ni interpolar.
**Implementación:** `dataQuality: 'none'` cuando no hay datos HLTV.
**Estado:** REGLA PERMANENTE — no negociable

## DEC-006: Monitoreo con setInterval en el proceso main
**Decisión:** El monitoreo corre en el main process, no en un Worker.
**Razón:** Simplicidad; el main process tiene acceso directo a axios y BrowserWindow.
**Consecuencia:** Si el scraping de HLTV o Forg1 tarda, puede bloquear el event loop del main.
**Estado:** ACEPTABLE para el caso de uso (scraping espaciado, no concurrente por diseño)

## DEC-007: Forg1 usa innerText (texto plano)
**Decisión:** Parsear `document.body.innerText` en lugar del DOM.
**Razón:** Forg1 es una SPA que puede cambiar estructura HTML; el texto plano es más estable.
**Consecuencia:** El parser es más complejo (regex, heurísticas). Un cambio de layout del texto puede romperlo.
**Estado:** MANTENER — fue una decisión deliberada tras experimentación

## DEC-008: Frame personalizado (frame: false)
**Decisión:** Ventana sin frame nativo de Windows, barra de título custom en HTML/CSS.
**Razón:** Estética coherente con el diseño de la app.
**Consecuencia:** Los controles de ventana (min/max/close) están implementados en JS/HTML.
**Estado:** MANTENER

## DEC-009: Vinculación Telegram por polling de getUpdates
**Decisión:** En lugar de webhook, usar polling de `getUpdates` para detectar el /start del usuario.
**Razón:** La app de escritorio no tiene servidor expuesto al exterior.
**Consecuencia:** El polling solo ocurre durante la vinculación (no continuo en producción).
**Estado:** MANTENER

## DEC-010: Launcher robusto con `call npm` y verificaciones explícitas (Fase 1)
**Decisión:** Reescribir `start_electron.bat` con: `cd /d "%~dp0"` anclaje, `where node/npm` para verificar presencia, `if not exist node_modules` para instalación condicional, verificación de electron en node_modules, `call npm start` (no `npm start` directamente).
**Razón:** Doble click en Windows puede iniciar con CWD incorrecto. `call` es necesario para capturar correctamente el errorlevel de npm en cmd.exe.
**Consecuencia:** El bat tiene 121 líneas vs 40 originales. Más verboso pero mucho más robusto.
**Estado:** IMPLEMENTADO ✔

## DEC-011: Forg1 Login con UA en Partición, Redirección de Popups y Carga Directa (Fase 2)
**Decisión:**
1. Configurar User-Agent limpio de Chrome explícitamente en la partición `session.fromPartition('persist:forg1')`.
2. Interceptar `setWindowOpenHandler` para evitar que enlaces de login abran ventanas secundarias huérfanas sin partición compartida; redirigir las navegaciones internas de `forg1.com` y `kick.com` a la misma ventana.
3. Apuntar la URL inicial directamente a `https://www.forg1.com/login` para evitar el 307 Redirect innecesario de `https://forg1.com`.
4. Mantener `contextIsolation: true`, `nodeIntegration: false` y `webSecurity: true` inalterados.
**Razón:** `app.userAgentFallback` no aplica a sesiones de partición personalizada en Electron, lo que exponía el token `Electron/28.0.0` ante Cloudflare Turnstile en Forg1. Los popups rompían la coherencia de la cookie `forg1_oauth` entre Kick y Forg1.
**Consecuencia:** El formulario de autenticación con Cloudflare Turnstile carga limpiamente, el token se emite, y el flujo OAuth entre Forg1 y Kick persiste dentro del mismo almacén de cookies `persist:forg1`.
**Estado:** IMPLEMENTADO ✔

## DEC-012: Modelo Jerárquico de Predicciones: Predicción → Mercados → Elecciones (Fase 3)
**Decisión:**
1. No aplanar las preguntas como predicciones independientes. El modelo representa `Prediction -> markets[] -> selections[]`.
2. Consumir directamente el endpoint interno `/api/predictions/state` ejecutado dentro del contexto de la ventana persistente `persist:forg1`.
3. Para la identidad (`predictionSignature`), priorizar el ID estable UUID de Forg1 (`forg1::${pred.id}`) antes que el texto o los nombres de equipos.
4. Mantener compatibilidad retroactiva proveyendo `pred.teams`, `pred.options` y `pred.predType` derivados del mercado principal para que los consumidores existentes (HLTV analyzer, tarjetas clásicas 1v1) sigan funcionando sin cambios invasivos.
5. Permitir cardinalidad dinámica en mercados y opciones sin números prefijados ni datos inventados (Zero Fake Data).
**Razón:** Forg1 utiliza Next.js con un endpoint REST `/api/predictions/state` que retorna la jerarquía real con IDs estables, puntos y apostadores. El scraper de texto anterior aplanaba datos y perdía la relación entre preguntas y elecciones.
**Consecuencia:** Soporte completo de 2, 3, 4+ opciones, múltiples mercados simultáneos, clasificación precisa de tipos, deduplicación estable en monitoreo y renderizado multi-mercado en Telegram y UI.
**Estado:** IMPLEMENTADO ✔


