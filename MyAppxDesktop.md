# MyAppx Desktop - Documentation

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

## Installation Paths

- **Application**: `C:\Users\ken\AppData\Local\Programs\myappx-desktop`
- **Logs**: `C:\Users\ken\AppData\Roaming\MyappxDesktop\logs`

## Upgrade

### Important Prerequisites

**Before upgrading** (in-app or manual installer), you must:
- Close the running instance
- Ensure appxserver and PostgreSQL are stopped

Otherwise, the installation or startup may fail.

### Upgrade Methods

#### In-App Upgrade

1. Go to **Check for updates** → **Restart and install**
2. The app automatically handles:
   - Runs `before-quit` handler
   - Stops appxserver (kills Java/jetty process)
   - Runs `stop-db.bat` and waits for completion (up to 30s)
   - Quits and runs the installer

**No manual steps required.**

#### Manual Upgrade

1. **Quit the app first**:
   - File → Quit, or
   - Tray icon → Quit
2. This automatically stops appxserver and PostgreSQL
3. Run the new installer (`setup.exe`)

⚠️ **Warning**: Do not run the installer while the app is still running.

#### Upgrade URL

In-app updates use **electron-updater**, which reads a single `publish.url` baked in at package time. Change the URL below, align `buildConfig.ts`, then rebuild with `npm run package:windows-installers`.

**Files to edit**

| File | Key |
|------|-----|
| `electron-builder.json` | `publish[].url` |
| `src/common/config/buildConfig.ts` | `updateNotificationURL`, `linuxUpdateURL` |

**1. Local AppxServer (current default)**

Serves `latest.yml` and installers from `/desktop` on the bundled server (pre-auth bypass). Copy artifacts to `org.adempiere.server/desktop/` before deploying the server plugin.

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

If the desktop instance exits abnormally (force-quit, crash, power loss, etc.), appxserver and PostgreSQL may continue running as orphan processes.

### Automatic Recovery

On the next startup, the app automatically:

1. Reads `appxserver.pid` from the appxserver work directory (if present)
2. Kills the orphan appxserver process tree
3. Runs `stop-db.bat` to stop PostgreSQL
4. Starts appxserver and database as usual

✅ **No manual intervention needed** - just restart the app after a crash.

## Portable Server 相关代码
utils.ts
app.ts
initialize.ts