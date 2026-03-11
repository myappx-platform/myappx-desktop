// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {ChildProcess} from 'child_process';
import {exec, spawn, spawnSync} from 'child_process';
import fs from 'fs';
import path from 'path';

import type {BrowserWindow, Rectangle} from 'electron';
import {app, session, dialog, screen, nativeImage} from 'electron';
import isDev from 'electron-is-dev';
import treeKill from 'tree-kill';

import MainWindow from 'app/mainWindow/mainWindow';
import MenuManager from 'app/menus';
import NavigationManager from 'app/navigationManager';
import {MAIN_WINDOW_CREATED} from 'common/communication';
import Config from 'common/config';
import {Logger} from 'common/log';
import {MattermostServer} from 'common/servers/MattermostServer';
import ServerManager from 'common/servers/serverManager';
import {isValidURI} from 'common/utils/url';
import {localizeMessage} from 'main/i18nManager';
import {getAppserverWorkDir} from 'main/persistentResources';
import {ServerInfo} from 'main/server/serverInfo';

import type {RemoteInfo} from 'types/server';
import type {Boundaries} from 'types/utils';

import {mainProtocol} from './initialize';

const assetsDir = path.resolve(app.getAppPath(), 'assets');
const appIconURL = path.resolve(assetsDir, 'appicon_with_spacing_32.png');
const appIcon = nativeImage.createFromPath(appIconURL);
const log = new Logger('App.Utils');

// Use persistent resources directory (survives reinstallation)
const workDir = getAppserverWorkDir();

/** PID file for appserver; used to kill orphan processes after desktop crash. */
const APPSERVER_PID_FILE = 'appserver.pid';

/** Spawn options for long-running detached processes (e.g. run-appserver.bat) */
const spawnOption = {cwd: workDir, detached: true, stdio: 'ignore' as const};

/** Spawn options for sync DB control (capture output for logging) */
const stopDBOptions = {cwd: workDir, encoding: 'utf8' as const};

let appserver: ChildProcess | undefined;

/**
 * Start PostgreSQL database (fire-and-forget). Does not wait for start-db.bat to finish;
 * the 6s delay in initialize allows DB to become ready before use.
 */
function startDB(): void {
    exec('cmd /C start-db.bat', {cwd: workDir, maxBuffer: 2 * 1024 * 1024}, (error, stdout, stderr) => {
        if (error) {
            log.error(`MyAppx start-db error: ${error.message}`);
            if (stderr) {
                log.error(`MyAppx start-db stderr: ${stderr}`);
            }
        } else {
            if (stdout) {
                log.info(`MyAppx start-db stdout: ${stdout}`);
            }
            log.info('MyAppx start-db completed successfully');
        }
    });
}

/**
 * Stop PostgreSQL database. Blocks until stop-db.bat finishes.
 */
function stopDB(): void {
    const result = spawnSync('cmd', ['/C', 'stop-db.bat'], stopDBOptions);
    if (result.status === 0) {
        log.info('MyAppx stop-db completed successfully');
    } else {
        log.error(`MyAppx stop-db failed with code ${result.status ?? 'null'}. stderr: ${result.stderr ?? ''}`);
    }
}

function restartDB(): void {
    stopDB();
    startDB();
}

/**
 * Run db-sync.bat once after an appserver upgrade when ENV_APPSERVER_MIGRATION=True.
 * Uses the persistent appserver workDir so that it survives reinstallations.
 */
export function runDbSyncIfNeeded(): void {
    const flag = process.env.ENV_APPSERVER_MIGRATION;
    if (!flag || flag.toLowerCase() !== 'true') {
        log.info('ENV_APPSERVER_MIGRATION is not set to True; skipping db-sync.bat');
        return;
    }

    const scriptPath = path.join(workDir, 'db-sync.bat');
    if (!fs.existsSync(scriptPath)) {
        log.warn(`db-sync.bat not found at ${scriptPath}; skipping DB migration`);
        return;
    }

    log.info('Running db-sync.bat for appserver migration (ENV_APPSERVER_MIGRATION=True)');
    const result = spawnSync('cmd', ['/C', 'db-sync.bat'], {cwd: workDir, encoding: 'utf8'});

    if (result.status === 0) {
        log.info('db-sync.bat completed successfully');
    } else {
        log.error(`db-sync.bat failed with code ${result.status ?? 'null'}. stderr: ${result.stderr ?? ''}`);
    }

    // Clear the in-process flag to avoid re-running in this session.
    // The system environment variable (if set by installer) should be updated separately if needed.
    process.env.ENV_APPSERVER_MIGRATION = '';
}

/**
 * Kill any orphan appserver (from PID file) and stop DB. Run before startAppserver on startup so
 * that a prior desktop crash does not leave appserver/DB running and cause port or lock conflicts.
 */
export function ensureOrphanAppserverAndDbStopped(): Promise<void> {
    return new Promise((resolve) => {
        const pidPath = path.join(workDir, APPSERVER_PID_FILE);

        const runStopDBAndResolve = () => {
            try {
                if (fs.existsSync(workDir)) {
                    log.info('Try to stop-db if it is running');
                    stopDB();
                } else {
                    log.info('Appserver workDir does not exist yet; skipping stop-db');
                }
            } catch (e) {
                log.warn(`stop-db error (continuing anyway): ${e}`);
            }
            resolve();
        };

        let pid: number;
        try {
            const raw = fs.readFileSync(pidPath, 'utf8').trim();
            pid = parseInt(raw, 10);
            if (!Number.isInteger(pid) || pid <= 0) {
                log.warn(`Invalid appserver pid in ${pidPath}, ignoring`);
                runStopDBAndResolve();
                return;
            }
        } catch (e) {
            log.warn(`Could not read appserver pid file ${pidPath}: ${e}`);
            runStopDBAndResolve();
            return;
        }

        log.info(`Killing orphan appserver process ${pid} (desktop likely exited abnormally)`);
        treeKill(pid, (err) => {
            if (err) {
                log.warn(`Orphan appserver treeKill ${pid}: ${err}`);
            } else {
                log.info(`Killed orphan appserver process ${pid}`);
            }
            runStopDBAndResolve();
        });
    });
}

/**
 * Start DB (restart), then run appserver. Caller should allow extra time for DB to
 * become ready before using it (e.g. the 6s delay in initialize).
 */
export function startAppserver(): void {
    restartDB();

    // After DB restart, run optional DB migration if requested by ENV_APPSERVER_MIGRATION.
    runDbSyncIfNeeded();

    try {
        appserver = spawn('cmd', ['/C', 'run-appserver.bat'], spawnOption);
        const pid = appserver.pid!;
        log.info(`Successfully started myappx appserver process ${pid}`);
        try {
            fs.writeFileSync(path.join(workDir, APPSERVER_PID_FILE), String(pid), 'utf8');
        } catch (e) {
            log.warn(`Could not write appserver pid file: ${e}`);
        }
    } catch (err) {
        log.error(`Failed to spawn myappx appserver: ${err}`);
        throw err;
    }
}

/** Timeout (ms) for stopAppserver; if treeKill or stop-db do not complete by then, we resolve to avoid blocking quit. */
const STOP_APPSERVER_TIMEOUT_MS = 45000;

/** Max wait (ms) for stop-db.bat to finish. Ensures DB is fully stopped before upgrade/quit. */
const STOP_DB_TIMEOUT_MS = 30000;

/**
 * Stop appserver process and DB. Waits for stop-db.bat to finish (up to STOP_DB_TIMEOUT_MS) so that
 * appserver and database are fully stopped before upgrade or quit. A global timeout ensures we never
 * block quit indefinitely.
 */
export function stopAppserver(): Promise<void> {
    return new Promise((resolve) => {
        let done = false;
        let dbTimeout: ReturnType<typeof setTimeout> | undefined;
        const t = setTimeout(() => {
            log.warn('stopAppserver: timeout, continuing quit');
            finish();
        }, STOP_APPSERVER_TIMEOUT_MS);

        const finish = () => {
            if (done) {
                return;
            }
            done = true;
            clearTimeout(t);
            if (dbTimeout) {
                clearTimeout(dbTimeout);
            }
            resolve();
        };

        const runStopDBAndWait = () => {
            const child = spawn('cmd', ['/C', 'stop-db.bat'], {cwd: workDir});
            const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
                if (dbTimeout) {
                    clearTimeout(dbTimeout);
                    dbTimeout = undefined;
                }
                if (code === 0) {
                    log.info('MyAppx stop-db completed successfully');
                } else {
                    log.warn(`MyAppx stop-db exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`);
                }
                finish();
            };
            child.on('close', onClose);
            child.on('error', (err) => {
                log.error(`MyAppx stop-db spawn error: ${err.message}`);
                onClose(null, null);
            });
            dbTimeout = setTimeout(() => {
                dbTimeout = undefined;
                log.warn('stopAppserver: stop-db timeout, continuing quit');
                try {
                    child.kill();
                } catch {
                    /* ignore */
                }
                finish();
            }, STOP_DB_TIMEOUT_MS);
        };

        if (appserver?.pid) {
            const pid = appserver.pid;
            appserver = undefined;
            treeKill(pid, (err) => {
                if (err) {
                    log.error(`Failed to kill myappx appserver process ${pid}: ${err}`);
                } else {
                    log.info(`Successfully killed myappx appserver process ${pid}`);
                }
                try {
                    const pidPath = path.join(workDir, APPSERVER_PID_FILE);
                    if (fs.existsSync(pidPath)) {
                        fs.unlinkSync(pidPath);
                    }
                } catch (e) {
                    log.warn(`Could not remove appserver pid file: ${e}`);
                }
                runStopDBAndWait();
            });
        } else {
            log.warn('MyAppx Appserver process is not running.');
            runStopDBAndWait();
        }
    });
}

export function openDeepLink(deeplinkingUrl: string) {
    try {
        if (MainWindow.get()) {
            MainWindow.show();
            NavigationManager.openLinkInPrimaryTab(deeplinkingUrl);
        } else {
            MainWindow.on(MAIN_WINDOW_CREATED, () => NavigationManager.openLinkInPrimaryTab(deeplinkingUrl));
        }
    } catch (err) {
        log.error(`There was an error opening the deeplinking url: ${err}`);
    }
}

export function updateSpellCheckerLocales() {
    if (Config.spellCheckerLocales.length && app.isReady()) {
        session.defaultSession.setSpellCheckerLanguages(Config.spellCheckerLocales);
    }
}

export function getDeeplinkingURL(args: string[]) {
    if (Array.isArray(args) && args.length) {
    // deeplink urls should always be the last argument, but may not be the first (i.e. Windows with the app already running)
        const url = args[args.length - 1];
        const protocol = isDev ? 'mattermost-dev' : mainProtocol;
        if (url && protocol && url.startsWith(protocol) && isValidURI(url)) {
            return url;
        }
    }
    return undefined;
}

export function shouldShowTrayIcon() {
    return Config.showTrayIcon || process.platform === 'win32';
}

export function wasUpdated(lastAppVersion?: string) {
    return lastAppVersion !== app.getVersion();
}

export function clearAppCache() {
    // TODO: clear cache on browserviews, not in the renderer.
    const mainWindow = MainWindow.get();
    if (mainWindow) {
        mainWindow.webContents.session.clearCache().
            then(mainWindow.webContents.reload).
            catch((err) => {
                log.error('clearAppCache', {err});
            });
    } else {
    //Wait for mainWindow
        setTimeout(clearAppCache, 100);
    }
}

function isWithinDisplay(state: Rectangle, display: Boundaries) {
    const startsWithinDisplay = !(state.x > display.maxX || state.y > display.maxY || state.x < display.minX || state.y < display.minY);
    if (!startsWithinDisplay) {
        return false;
    }

    // is half the screen within the display?
    const midX = state.x + (state.width / 2);
    const midY = state.y + (state.height / 2);
    return !(midX > display.maxX || midY > display.maxY);
}

function getDisplayBoundaries() {
    const displays = screen.getAllDisplays();

    return displays.map((display) => {
        return {
            maxX: display.workArea.x + display.workArea.width,
            maxY: display.workArea.y + display.workArea.height,
            minX: display.workArea.x,
            minY: display.workArea.y,
            maxWidth: display.workArea.width,
            maxHeight: display.workArea.height,
        };
    });
}

function getValidWindowPosition(state: Rectangle) {
    // Check if the previous position is out of the viewable area
    // (e.g. because the screen has been plugged off)
    const boundaries = getDisplayBoundaries();
    const display = boundaries.find((boundary) => {
        return isWithinDisplay(state, boundary);
    });

    if (typeof display === 'undefined') {
        return {};
    }
    return {x: state.x, y: state.y};
}

function getNewWindowPosition(browserWindow: BrowserWindow) {
    const mainWindow = MainWindow.get();
    if (!mainWindow) {
        return browserWindow.getPosition();
    }

    const newWindowSize = browserWindow.getSize();
    const mainWindowSize = mainWindow.getSize();
    const mainWindowPosition = mainWindow.getPosition();

    return [
        Math.floor(mainWindowPosition[0] + ((mainWindowSize[0] - newWindowSize[0]) / 2)),
        Math.floor(mainWindowPosition[1] + ((mainWindowSize[1] - newWindowSize[1]) / 2)),
    ];
}

export function resizeScreen(browserWindow: BrowserWindow) {
    const position = getNewWindowPosition(browserWindow);
    const size = browserWindow.getSize();
    const validPosition = getValidWindowPosition({
        x: position[0],
        y: position[1],
        width: size[0],
        height: size[1],
    });
    if (typeof validPosition.x !== 'undefined' || typeof validPosition.y !== 'undefined') {
        browserWindow.setPosition(validPosition.x || 0, validPosition.y || 0);
    } else {
        browserWindow.center();
    }
}

export function flushCookiesStore() {
    log.debug('flushCookiesStore');
    session.defaultSession.cookies.flushStore().catch((err) => {
        log.error(`There was a problem flushing cookies:\n${err}`);
    });
}

export async function updateServerInfos(servers: MattermostServer[]) {
    await Promise.all(servers.map(async (srv) => {
        const serverInfo = new ServerInfo(srv);
        let data: RemoteInfo;
        try {
            data = await serverInfo.fetchRemoteInfo();
        } catch (error) {
            log.error('updateServerInfos: Failed to fetch remote info', {error});
            return;
        }

        if (data.siteURL) {
            // We need to validate the site URL is reachable by pinging the server
            const tempServer = new MattermostServer({name: 'temp', url: data.siteURL}, false);
            const tempServerInfo = new ServerInfo(tempServer);
            try {
                const tempRemoteInfo = await tempServerInfo.fetchConfigData();
                if (tempRemoteInfo.siteURL === data.siteURL) {
                    ServerManager.updateRemoteInfo(srv.id, data, true);
                    return;
                }
            } catch (error) {
                log.error('updateServerInfos: Failed to fetch temp remote info', {error});
                ServerManager.updateRemoteInfo(srv.id, data, false);
                return;
            }
        }

        ServerManager.updateRemoteInfo(srv.id, data, false);
    }));

    // TODO: Would be better encapsulated in the MenuManager
    MenuManager.refreshMenu();
}

export async function clearDataForServer(server: MattermostServer) {
    const mainWindow = MainWindow.get();
    if (!mainWindow) {
        return;
    }

    const response = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: [
            localizeMessage('main.app.utils.clearDataForServer.confirm', 'Clear Data'),
            localizeMessage('main.app.utils.clearDataForServer.cancel', 'Cancel'),
        ],
        defaultId: 1,
        message: localizeMessage('main.app.utils.clearDataForServer.message', 'This action will erase all session, cache, cookie and storage data for the server "{serverName}". Are you sure you want to clear data for this server?', {serverName: server.name}),
    });

    if (response.response === 0) {
        await session.defaultSession.clearData({
            origins: [server.url.origin],
        });

        ServerManager.reloadServer(server.id);
    }
}

export async function clearAllData() {
    const mainWindow = MainWindow.get();
    if (!mainWindow) {
        return;
    }

    const response = await dialog.showMessageBox(mainWindow, {
        title: app.name,
        type: 'warning',
        buttons: [
            localizeMessage('main.app.utils.clearAllData.confirm', 'Clear All Data'),
            localizeMessage('main.app.utils.clearAllData.cancel', 'Cancel'),
        ],
        defaultId: 1,
        message: localizeMessage('main.app.utils.clearAllData.message', 'This action will erase all session, cache, cookie and storage data for all server. Performing this action will restart the application. Are you sure you want to clear all data?'),
    });

    if (response.response === 0) {
        await session.defaultSession.clearAuthCache();
        await session.defaultSession.clearCodeCaches({});
        await session.defaultSession.clearHostResolverCache();
        await session.defaultSession.clearData();

        // These are here to suppress an unnecessary exception thrown when the app is force exited
        // The app will restart anyways so we don't need to handle the exception
        process.removeAllListeners('uncaughtException');
        process.removeAllListeners('unhandledRejection');

        app.relaunch();
        app.exit();
    }
}
