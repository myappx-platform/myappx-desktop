# MyAppx Desktop - Documentation

MyAppx Desktop is an Electron client that wraps the MyAppx Web UI in a native Windows application. It connects to an **externally running** MyAppx Server (AppxServer); it does **not** bundle or start AppxServer, PostgreSQL, or a portable server.

## Development

### Clean Install, Rebuild, and Start

```bash
# Full rebuild workflow
npm install
npm run build
npm run start

# Quick restart
npm run restart

# Clean install and start
npm run clean-install
npm run start

# Watch mode for development
npm run watch
```

### Package Windows Installer

```bash
npm run clean-install
npm run build
npm run package:windows-installers
```

## Prerequisites

Before using the desktop client, ensure MyAppx Server is already running and reachable, for example:

- Web UI: `https://localhost:18443/webui/`
- Desktop update portal: `https://localhost:18443/desktop/`

The desktop app injects `X-MyAppx-Preauth-Secret` for local servers (`localhost`, `127.0.0.1`) using the built-in default secret.

## Installation Paths

- **Application**: `C:\Users\ken\AppData\Local\Programs\myappx-desktop`
- **Logs**: `C:\Users\ken\AppData\Roaming\MyappxDesktop\logs`

## Upgrade

### Important Prerequisites

**Before upgrading** (in-app or manual installer), you must:

- Close the running MyAppx Desktop instance

Otherwise, the installation may fail because installer files are in use.

AppxServer and PostgreSQL are **not** managed by the desktop client. Stop them separately only if your deployment requires it before upgrading the server itself.

### Upgrade Methods

#### In-App Upgrade

1. Go to **Check for updates** → **Restart and install**
2. The app automatically handles:
   - Runs `before-quit` handler
   - Quits and runs the installer

**No manual steps required** beyond having the app closed for the installer to replace files.

#### Manual Upgrade

1. **Quit the app first**:
   - File → Quit, or
   - Tray icon → Quit
2. Run the new installer (`setup.exe`)

⚠️ **Warning**: Do not run the installer while the app is still running.

#### Upgrade URL

In-app updates use **electron-updater**, which reads a single `publish.url` baked in at package time. Change the URL below, align `buildConfig.ts`, then rebuild with `npm run package:windows-installers`.

**Files to edit**

| File | Key |
|------|-----|
| `electron-builder.ts` | `publish[].url` |
| `src/common/config/buildConfig.ts` | `updateNotificationURL`, `linuxUpdateURL` |

**1. Local AppxServer (current default)**

Serves `latest.yml` and installers from `/desktop` on your MyAppx Server. Copy artifacts to `org.adempiere.server/desktop/` before deploying the server plugin.

```json
"publish": [
  {
    "provider": "generic",
    "url": "https://localhost:18443/desktop"
  }
]
```

```typescript
// buildConfig.ts
updateNotificationURL: 'https://localhost:18443/desktop',
linuxUpdateURL: 'https://localhost:18443/desktop/linux-desktop-install.html',
```

**2. SourceForge (online release)**

Use when publishing to the public download site. Host `latest.yml` and versioned installers under the same path layout on SourceForge.

```json
"publish": [
  {
    "provider": "generic",
    "url": "https://myappx.sourceforge.io/desktop"
  }
]
```

```typescript
// buildConfig.ts
updateNotificationURL: 'https://myappx.sourceforge.io/desktop',
linuxUpdateURL: 'https://myappx.sourceforge.io/desktop/linux-desktop-install.html',
```

**Switching**

- Pick **one** base URL per installer build; the running app checks only that URL.
- To move from local → SourceForge (or back), update both files above, repackage Desktop, and distribute the new installer.
- **Dual-source** (try localhost first, then SourceForge) is not supported out of the box; that would need a custom fallback in `src/main/autoUpdater.ts`.

## Abnormal Exit (Crash Recovery)

If the desktop instance exits abnormally (force-quit, crash, power loss, etc.), restart the desktop app normally. The client does not start or stop AppxServer or PostgreSQL.

If MyAppx Server was left running from a separate installation, manage that process outside the desktop client (for example via `myappx-server` scripts or your service manager).
