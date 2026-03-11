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
- Ensure appserver and PostgreSQL are stopped

Otherwise, the installation or startup may fail.

### Upgrade Methods

#### In-App Upgrade

1. Go to **Check for updates** → **Restart and install**
2. The app automatically handles:
   - Runs `before-quit` handler
   - Stops appserver (kills Java/jetty process)
   - Runs `stop-db.bat` and waits for completion (up to 30s)
   - Quits and runs the installer

**No manual steps required.**

#### Manual Upgrade

1. **Quit the app first**:
   - File → Quit, or
   - Tray icon → Quit
2. This automatically stops appserver and PostgreSQL
3. Run the new installer (`setup.exe`)

⚠️ **Warning**: Do not run the installer while the app is still running.

#### Upgrade URL
1. Online
  "publish": [
    {
    "provider": "generic",
    "url": "https://myappx.sourceforge.io/desktop"
    }
  ]

2. Test
  "publish": [
    {
    "provider": "generic",
    "url": "https://localhost:18443/desktop"
    }
  ]

## Abnormal Exit (Crash Recovery)

If the desktop instance exits abnormally (force-quit, crash, power loss, etc.), appserver and PostgreSQL may continue running as orphan processes.

### Automatic Recovery

On the next startup, the app automatically:

1. Reads `appserver.pid` from the appserver work directory (if present)
2. Kills the orphan appserver process tree
3. Runs `stop-db.bat` to stop PostgreSQL
4. Starts appserver and database as usual

✅ **No manual intervention needed** - just restart the app after a crash.