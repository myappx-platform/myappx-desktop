// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import fs from 'fs';
import path from 'path';

import {app} from 'electron';
import extract from 'extract-zip';

import {Logger} from 'common/log';

const log = new Logger('PersistentResources');

/**
 * Get the persistent resources directory in user data folder
 * This directory survives app reinstallation
 */
export function getPersistentResourcesPath(): string {
    return path.join(app.getPath('userData'), 'persistent-resources');
}

/**
 * Get the source extraResources directory from installation
 */
function getInstallResourcesPath(): string {
    return path.resolve(app.getAppPath(), '../extraResources');
}

/**
 * Recursively copy directory
 */
function copyDirectoryRecursive(source: string, destination: string): void {
    if (!fs.existsSync(source)) {
        log.warn(`Source directory does not exist: ${source}`);
        return;
    }

    // Create destination directory if it doesn't exist
    if (!fs.existsSync(destination)) {
        fs.mkdirSync(destination, {recursive: true});
        log.info(`Created directory: ${destination}`);
    }

    const entries = fs.readdirSync(source, {withFileTypes: true});

    for (const entry of entries) {
        const sourcePath = path.join(source, entry.name);
        const destPath = path.join(destination, entry.name);

        if (entry.isDirectory()) {
            copyDirectoryRecursive(sourcePath, destPath);
        } else {
            fs.copyFileSync(sourcePath, destPath);
            log.debug(`Copied file: ${entry.name}`);
        }
    }
}

function readVersionFile(filePath: string): string | undefined {
    if (!fs.existsSync(filePath)) {
        return undefined;
    }
    try {
        return fs.readFileSync(filePath, 'utf-8').trim();
    } catch (err) {
        log.warn(`Failed to read version file at ${filePath}: ${err}`);
    }
    return undefined;
}

function migratePgdataFromBackup(backupAppserverDir: string, newAppserverDir: string): void {
    // Support common layouts: appserver-portable/pgdata and appserver-portable/data/pgdata
    const candidateRelPaths = [
        'pgdata',
        path.join('data', 'pgdata'),
    ];

    for (const rel of candidateRelPaths) {
        const srcPgdata = path.join(backupAppserverDir, rel);
        if (!fs.existsSync(srcPgdata) || !fs.lstatSync(srcPgdata).isDirectory()) {
            continue;
        }

        const destPgdata = path.join(newAppserverDir, rel);
        if (fs.existsSync(destPgdata)) {
            try {
                fs.rmSync(destPgdata, {recursive: true});
                log.info(`Removed new pgdata directory at ${destPgdata} before migration`);
            } catch (err) {
                log.warn(`Failed to remove new pgdata directory at ${destPgdata}: ${err}`);
            }
        }

        const parentDir = path.dirname(destPgdata);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, {recursive: true});
        }

        copyDirectoryRecursive(srcPgdata, destPgdata);
        log.info(`Migrated pgdata directory from backup ${srcPgdata} to ${destPgdata}`);
        return;
    }

    log.info(`No pgdata directory found in backup appserver at ${backupAppserverDir}; skipping pgdata migration`);
}

// Patterns for selective sync: update (overwrite) vs preserve (keep user data)
const UPDATE_PATTERNS = [
    /\.bat$/i,
    /\.exe$/i,
    /\.dll$/i,
    /\.jar$/i,
    /\.sh$/i,
    /^\.version$/i,
];
const PRESERVE_PATTERNS = [
    /^data$/i,
    /^logs$/i,
    /^config$/i,
    /\.log$/i,
    /\.db$/i,
    /\.sqlite$/i,
];

function shouldPreserve(name: string): boolean {
    return PRESERVE_PATTERNS.some((p) => p.test(name));
}
function shouldUpdate(name: string): boolean {
    return UPDATE_PATTERNS.some((p) => p.test(name));
}

/**
 * Sync directory from src to dest with preserve/update rules.
 * @param skipEntry - if returns true for a name, that entry is skipped (e.g. appserver-portable.zip)
 */
function syncDirectoryWithPreserve(
    srcDir: string,
    destDir: string,
    skipEntry?: (name: string) => boolean,
): void {
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, {recursive: true});
    }
    const entries = fs.readdirSync(srcDir, {withFileTypes: true});
    for (const entry of entries) {
        if (skipEntry?.(entry.name)) {
            continue;
        }
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
            if (shouldPreserve(entry.name)) {
                if (!fs.existsSync(destPath)) {
                    fs.mkdirSync(destPath, {recursive: true});
                    log.info(`Creating preserved directory: ${entry.name}`);
                } else {
                    log.info(`Preserving existing directory: ${entry.name}`);
                }
            } else {
                syncDirectoryWithPreserve(srcPath, destPath, skipEntry);
            }
        } else if (shouldPreserve(entry.name)) {
            if (!fs.existsSync(destPath)) {
                fs.copyFileSync(srcPath, destPath);
                log.info(`Creating preserved file: ${entry.name}`);
            } else {
                log.info(`Preserving existing file: ${entry.name}`);
            }
        } else if (shouldUpdate(entry.name) || !fs.existsSync(destPath)) {
            fs.copyFileSync(srcPath, destPath);
            log.debug(`Updating file: ${entry.name}`);
        }
    }
}

/**
 * Check if we need to update resources from installation to persistent directory
 * This compares version files or modification times
 */
function shouldUpdateResources(installPath: string, persistentPath: string): boolean {
    // If persistent directory doesn't exist, we need to copy
    if (!fs.existsSync(persistentPath)) {
        return true;
    }

    // Check if there's a version file in the install directory
    const installVersionFile = path.join(installPath, '.version');
    const persistentVersionFile = path.join(persistentPath, '.version');

    if (fs.existsSync(installVersionFile)) {
        if (!fs.existsSync(persistentVersionFile)) {
            return true;
        }

        const installVersion = fs.readFileSync(installVersionFile, 'utf-8').trim();
        const persistentVersion = fs.readFileSync(persistentVersionFile, 'utf-8').trim();

        if (installVersion !== persistentVersion) {
            log.info(`Version mismatch: install=${installVersion}, persistent=${persistentVersion}`);
            return true;
        }
    }

    return false;
}

/**
 * Selectively update files from installation to persistent directory
 * This preserves user data files while updating executable/system files.
 * Skips appserver-portable.zip (handled by extractAppserverZip).
 */
function updateResources(installPath: string, persistentPath: string): void {
    if (!fs.existsSync(installPath)) {
        log.warn(`Install resources path does not exist: ${installPath}`);
        return;
    }
    log.info(`Updating resources from ${installPath} to ${persistentPath}`);
    syncDirectoryWithPreserve(installPath, persistentPath, (n) => n === 'appserver-portable.zip');
    log.info('Resources update completed');
}

/**
 * Extract appserver-portable.zip from install path to persistent-resources/appserver-portable.
 * Handles both zip with root "appserver-portable" folder and zip with loose files.
 */
async function extractAppserverZip(installPath: string, persistentPath: string): Promise<void> {
    const zipPath = path.join(installPath, 'appserver-portable.zip');
    if (!fs.existsSync(zipPath)) {
        return;
    }
    const extractDir = path.join(persistentPath, '.extract-tmp');
    if (fs.existsSync(extractDir)) {
        fs.rmSync(extractDir, {recursive: true});
    }
    fs.mkdirSync(extractDir, {recursive: true});

    try {
        log.info(`Extracting appserver-portable.zip to ${extractDir}`);
        await extract(zipPath, {dir: extractDir});

        const entries = fs.readdirSync(extractDir, {withFileTypes: true});
        const appserverDir = path.join(extractDir, 'appserver-portable');
        const contentPath = entries.length === 1 && entries[0].isDirectory() && entries[0].name === 'appserver-portable' ? appserverDir : extractDir;

        const destAppserver = path.join(persistentPath, 'appserver-portable');
        syncDirectoryWithPreserve(contentPath, destAppserver);
        log.info('appserver-portable.zip extracted and synced to persistent-resources');
    } finally {
        if (fs.existsSync(extractDir)) {
            fs.rmSync(extractDir, {recursive: true});
        }
    }
}

/**
 * Initialize persistent resources
 * Called during app startup to ensure resources are available in user data directory.
 * Extracts appserver-portable.zip from extraResources to persistent-resources/appserver-portable
 * when the zip exists and (appserver-portable is missing or an update is needed).
 */
export async function initializePersistentResources(): Promise<void> {
    const installPath = getInstallResourcesPath();
    const persistentPath = getPersistentResourcesPath();

    log.info('Initializing persistent resources');
    log.info(`Install path: ${installPath}`);
    log.info(`Persistent path: ${persistentPath}`);

    if (!fs.existsSync(installPath)) {
        log.warn('Install resources path does not exist, skipping initialization');
        return;
    }

    if (!fs.existsSync(persistentPath)) {
        fs.mkdirSync(persistentPath, {recursive: true});
    }

    const zipPath = path.join(installPath, 'appserver-portable.zip');
    const appserverDest = path.join(persistentPath, 'appserver-portable');

    const installVersionFile = path.join(installPath, '.version');
    const persistentVersionFile = path.join(persistentPath, '.version');
    const installVersion = readVersionFile(installVersionFile);
    const persistentVersion = readVersionFile(persistentVersionFile);
    const isUpgrade = Boolean(installVersion && persistentVersion && installVersion !== persistentVersion);

    // Log version state for diagnosing missing backup (e.g. when .version is missing on one side)
    log.info(`Version: install=${installVersion ?? 'none'}, persistent=${persistentVersion ?? 'none'}, isUpgrade=${isUpgrade}`);
    log.info(`Paths: appserverDest exists=${fs.existsSync(appserverDest)}, zipPath exists=${fs.existsSync(zipPath)}`);

    let backupAppserverDir: string | undefined;

    // Backup when: (1) we have existing appserver-portable, (2) we have zip to extract, and
    // (3) either version upgrade is detected OR we're about to overwrite (needUpdateResources).
    // This ensures backup even if persistent .version was never written (e.g. by an older build).
    const willOverwrite = shouldUpdateResources(installPath, persistentPath);
    const shouldBackup = fs.existsSync(appserverDest) &&
        fs.existsSync(zipPath) &&
        (isUpgrade || (Boolean(installVersion) && willOverwrite));

    if (shouldBackup) {
        // Backup existing appserver-portable with original version suffix
        const suffix = persistentVersion || 'backup';
        let candidate = path.join(persistentPath, `appserver-portable-${suffix}`);
        let counter = 1;
        while (fs.existsSync(candidate)) {
            candidate = path.join(persistentPath, `appserver-portable-${suffix}-${counter}`);
            counter++;
        }

        try {
            fs.renameSync(appserverDest, candidate);
            backupAppserverDir = candidate;
            log.info(`Backed up existing appserver-portable to ${candidate}`);

            // Mark that we need to run DB migration on next startup
            process.env.ENV_APPSERVER_MIGRATION = 'True';
            log.info('ENV_APPSERVER_MIGRATION set to True for appserver upgrade migration');
        } catch (err: unknown) {
            const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : '';

            // EPERM on Windows often means directory in use; retry once after short delay
            if (code === 'EPERM' || code === 'EBUSY') {
                log.info(`Retrying backup after brief delay (${code})`);
                await new Promise((r) => setTimeout(r, 500));
                try {
                    fs.renameSync(appserverDest, candidate);
                    backupAppserverDir = candidate;
                    log.info(`Backed up existing appserver-portable to ${candidate}`);

                    process.env.ENV_APPSERVER_MIGRATION = 'True';
                } catch (retryErr) {
                    log.error(`Failed to backup existing appserver-portable (retry): ${retryErr}`);
                }
            } else {
                log.error(`Failed to backup existing appserver-portable: ${err}`);
            }
        }
    }

    const needExtract = fs.existsSync(zipPath) &&
        (!fs.existsSync(appserverDest) || shouldUpdateResources(installPath, persistentPath));

    if (needExtract) {
        log.info('Extracting appserver-portable.zip to persistent-resources');
        await extractAppserverZip(installPath, persistentPath);

        if (backupAppserverDir && fs.existsSync(appserverDest)) {
            migratePgdataFromBackup(backupAppserverDir, appserverDest);
        }
    }

    if (shouldUpdateResources(installPath, persistentPath)) {
        log.info('Resources need to be updated');
        updateResources(installPath, persistentPath);
    } else {
        log.info('Resources are up to date');
    }
}

/**
 * Get the working directory for appserver
 * This returns the path to the persistent appserver-portable directory
 */
export function getAppserverWorkDir(): string {
    return path.join(getPersistentResourcesPath(), 'appserver-portable');
}
