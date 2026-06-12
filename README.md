<div align="center">

<img src="assets/icon.png" width="120" alt="Kick Stream Monitor" />

# Kick Stream Monitor

**Detector automático de streams en vivo de [Kick.com](https://kick.com)**

Monitorea a tus streamers favoritos y abre su transmisión automáticamente en cuanto se ponen en vivo.

[![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D6?logo=windows&logoColor=white)](#-instalación)
[![License](https://img.shields.io/badge/License-MIT-53FC18.svg)](LICENSE)

</div>

---

## 📑 Tabla de contenidos

- [¿Qué es?](#-qué-es)
- [Características](#-características)
- [Capturas](#-capturas)
- [Instalación](#-instalación)
- [Cómo se usa](#-cómo-se-usa)
- [Cómo funciona](#-cómo-funciona)
- [Compilar el instalador](#-compilar-el-instalador)
- [Estructura del proyecto](#-estructura-del-proyecto)
- [Tecnologías](#-tecnologías)
- [Licencia](#-licencia)

---

## 🎮 ¿Qué es?

**Kick Stream Monitor** es una aplicación de escritorio que vigila en segundo plano a los streamers
de Kick que vos elijas. Cada cierto intervalo consulta la API de Kick y, cuando detecta que
alguien se pone **en vivo**, te avisa con una notificación de escritorio y abre su canal
automáticamente en **Brave** (o tu navegador por defecto).

Ideal para no perderte el inicio de ningún directo. 🔴

---

## ✨ Características

| | |
|---|---|
| 🔍 **Monitoreo en tiempo real** | Consulta el estado de varios streamers a la vez |
| 🚀 **Apertura automática** | Abre el stream en Brave apenas empieza (sin reabrir si ya estaba abierto) |
| 🔔 **Notificaciones** | Aviso de escritorio cuando un streamer entra en vivo |
| 🖼️ **Vista previa** | Miniatura del directo, avatar, título, categoría y espectadores |
| ⚙️ **Configurable** | Intervalo de verificación ajustable y opciones por casilla |
| 📊 **Estadísticas** | Tiempo monitoreando, streams detectados y cuántos están en vivo |
| 📝 **Log de actividad** | Registro de todo lo que va detectando la app |
| 🎨 **Diseño Kick** | Interfaz oscura con el verde característico de Kick |

---

## 📸 Capturas

> 💡 Agregá tus capturas en una carpeta `docs/` y enlazalas aquí, por ejemplo:
> `![Pantalla principal](docs/screenshot-main.png)`

---

## 📥 Instalación

### Opción A — Instalador (recomendado para usuarios)

1. Descargá el archivo **`KickStreamMonitor-Setup-1.0.0.exe`** desde la sección de
   [Releases](../../releases).
2. Ejecutalo y seguí el asistente (podés elegir la carpeta de instalación).
3. Se crea un acceso directo en el **Escritorio** y en el **Menú Inicio**.
4. ¡Listo! Abrí la app y empezá a monitorear.

### Opción B — Desde el código fuente (para desarrolladores)

```bash
# 1. Cloná el repositorio
git clone https://github.com/usuario/kick-stream-monitor.git
cd kick-stream-monitor

# 2. Instalá las dependencias
npm install

# 3. Iniciá la aplicación
npm start
```

> En Windows también podés hacer doble clic en **`start_electron.bat`**, que instala
> las dependencias (si faltan) y abre la app automáticamente.

---

## 🕹️ Cómo se usa

1. **Agregá streamers**: escribí el nombre de usuario de Kick en el campo y pulsá **Agregar**
   (o Enter). Podés eliminar cualquiera con el botón ✕.
2. **Ajustá el intervalo**: con el deslizador elegís cada cuántos segundos se verifica (30–300s).
3. **Elegí tus opciones**:
   - *Abrir automáticamente en Brave* — abre el canal cuando empieza el directo.
   - *Notificaciones de escritorio* — aviso del sistema al detectar un live.
   - *Minimizar al abrir stream*.
4. **Iniciá el monitor** con el botón verde. El indicador del encabezado pasará a *Monitoreando…*.
5. Las tarjetas muestran el estado de cada streamer en vivo. Hacé clic en una para abrir su canal.

---

## ⚙️ Cómo funciona

```
┌──────────────┐      cada X segundos       ┌─────────────────────┐
│   Interfaz   │ ─────────────────────────▶ │  Proceso principal   │
│  (Electron)  │                            │     (Electron)       │
└──────────────┘                            └──────────┬──────────┘
       ▲                                               │ HTTPS
       │  actualización de estado                      ▼
       │                                    ┌─────────────────────┐
       └─────────────────────────────────── │   API de Kick.com    │
                                            └─────────────────────┘
```

- El **proceso principal** consulta `https://kick.com/api/v2/channels/<streamer>` en cada ciclo.
- Si un streamer pasa de *offline* a *en vivo*, dispara la **notificación** y, si está activado,
  abre el canal en **Brave** una sola vez por sesión en vivo.
- Los datos (título, miniatura, categoría, espectadores) se envían a la **interfaz**, que actualiza
  las tarjetas en tiempo real.

---

## 🏗️ Compilar el instalador

El proyecto usa [electron-builder](https://www.electron.build/) para generar el `.exe`.

```bash
# Genera el icono y construye el instalador NSIS en la carpeta dist/
npm run dist
```

El instalador quedará en **`dist/KickStreamMonitor-Setup-1.0.0.exe`**.

```bash
# Solo empaquetar sin crear instalador (para pruebas)
npm run pack

# Regenerar únicamente el icono
npm run icon
```

---

## 📂 Estructura del proyecto

```
kick-stream-monitor/
├── electron/
│   ├── main.js          # Proceso principal: API, monitoreo, notificaciones
│   └── preload.js       # Puente seguro entre interfaz y backend
├── ui/
│   ├── index.html       # Estructura de la interfaz
│   ├── styles.css        # Estilos (tema Kick)
│   └── app.js           # Lógica de la interfaz
├── build/
│   ├── generate-icon.js # Generador del icono de la app
│   └── icon.ico         # Icono para el instalador
├── assets/
│   └── icon.png         # Icono de la ventana
├── start_electron.bat   # Arranque rápido en Windows
└── package.json
```

---

## 🧰 Tecnologías

- **[Electron](https://www.electronjs.org/)** — aplicación de escritorio multiplataforma
- **[Axios](https://axios-http.com/)** — peticiones HTTP a la API de Kick
- **[electron-builder](https://www.electron.build/)** — empaquetado e instalador
- **HTML / CSS / JavaScript** — interfaz

---

## 📄 Licencia

Distribuido bajo la licencia **MIT**. Mirá el archivo [LICENSE](LICENSE) para más detalles.

<div align="center">

Hecho con 💚 para la comunidad de Kick

</div>
