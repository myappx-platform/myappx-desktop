// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import fs from 'fs';
import path from 'path';

import {app} from 'electron';
import extract from 'extract-zip';

import {Logger} from 'common/log';

const log = new Logger('PersistentResources');

const LEGACY_PORTABLE_DIR = 'appserver-portable';
const PORTABLE_DIR = 'appxserver-portable';
const LEGACY_PORTABLE_ZIP = 'appserver-portable.zip';
const PORTABLE_ZIP = 'appxserver-portable.zip';
const LEGACY_SERVER_DIR = 'appserver';
const SERVER_DIR = 'appxserver';

const PORTABLE_ZIP_NAMES = [PORTABLE_ZIP, LEGACY_PORTABLE_ZIP];
const PORTABLE_DIR_NAMES = [PORTABLE_DIR, LEGACY_PORTABLE_DIR];

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
export function getExtraResourcesPath(): string {
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

function resolvePortableZipPath(installPath: string): string | undefined {
    for (const zipName of PORTABLE_ZIP_NAMES) {
        const zipPath = path.join(installPath, zipName);
        if (fs.existsSync(zipPath)) {
            return zipPath;
        }
    }
    return undefined;
}

function isPortableZipName(name: string): boolean {
    return PORTABLE_ZIP_NAMES.includes(name);
}

/**
 * Rename legacy appserver-portable to appxserver-portable when upgrading existing installs.
 */
function migrateLegacyPortableDir(persistentPath: string): void {
    const legacy = path.join(persistentPath, LEGACY_PORTABLE_DIR);
    const current = path.join(persistentPath, PORTABLE_DIR);
    if (fs.existsSync(legacy) && !fs.existsSync(current)) {
        fs.renameSync(legacy, current);
        log.info(`Migrated legacy ${LEGACY_PORTABLE_DIR}/ to ${PORTABLE_DIR}/`);
    }
}

/**
 * Rename legacy appserver/ to appxserver/ inside the portable work directory.
 */
function migrateLegacyServerDir(workDir: string): void {
    const legacy = path.join(workDir, LEGACY_SERVER_DIR);
    const current = path.join(workDir, SERVER_DIR);
    if (fs.existsSync(legacy) && !fs.existsSync(current)) {
        fs.renameSync(legacy, current);
        log.info(`Migrated legacy ${LEGACY_SERVER_DIR}/ to ${SERVER_DIR}/ in ${workDir}`);
    }
}

function migratePgdataFromBackup(backupAppxserverDir: string, newAppxserverDir: string): void {
    // Support common layouts: appxserver-portable/pgdata and appxserver-portable/data/pgdata
    const candidateRelPaths = [
        'pgdata',
        path.join('data', 'pgdata'),
    ];

    for (const rel of candidateRelPaths) {
        const srcPgdata = path.join(backupAppxserverDir, rel);
        if (!fs.existsSync(srcPgdata) || !fs.lstatSync(srcPgdata).isDirectory()) {
            continue;
        }

        const destPgdata = path.join(newAppxserverDir, rel);
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

    log.info(`No pgdata directory found in backup appxserver at ${backupAppxserverDir}; skipping pgdata migration`);
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
 * @param skipEntry - if returns true for a name, that entry is skipped (e.g. appxserver-portable.zip)
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
 * Skips appxserver-portable.zip (handled by extractAppxserverZip).
 */
function updateResources(installPath: string, persistentPath: string): void {
    if (!fs.existsSync(installPath)) {
        log.warn(`Install resources path does not exist: ${installPath}`);
        return;
    }
    log.info(`Updating resources from ${installPath} to ${persistentPath}`);
    syncDirectoryWithPreserve(installPath, persistentPath, (n) => isPortableZipName(n));
    log.info('Resources update completed');
}

/**
 * Extract appxserver-portable.zip from install path to persistent-resources/appxserver-portable.
 * Handles zip with root wrapper folder or loose files at zip root.
 */
async function extractAppxserverZip(installPath: string, persistentPath: string): Promise<void> {
    const zipPath = resolvePortableZipPath(installPath);
    if (!zipPath) {
        return;
    }
    const extractDir = path.join(persistentPath, '.extract-tmp');
    if (fs.existsSync(extractDir)) {
        fs.rmSync(extractDir, {recursive: true});
    }
    fs.mkdirSync(extractDir, {recursive: true});

    try {
        log.info(`Extracting ${path.basename(zipPath)} to ${extractDir}`);
        await extract(zipPath, {dir: extractDir});

        const entries = fs.readdirSync(extractDir, {withFileTypes: true});
        let contentPath = extractDir;
        if (entries.length === 1 && entries[0].isDirectory()) {
            const wrapperName = entries[0].name;
            if (PORTABLE_DIR_NAMES.includes(wrapperName)) {
                contentPath = path.join(extractDir, wrapperName);
            }
        }

        const destAppxserver = path.join(persistentPath, PORTABLE_DIR);
        syncDirectoryWithPreserve(contentPath, destAppxserver);
        migrateLegacyServerDir(destAppxserver);
        log.info(`${path.basename(zipPath)} extracted and synced to persistent-resources`);
    } finally {
        if (fs.existsSync(extractDir)) {
            fs.rmSync(extractDir, {recursive: true});
        }
    }
}

/**
 * Initialize persistent resources
 * Called during app startup to ensure resources are available in user data directory.
 * Extracts appxserver-portable.zip from extraResources to persistent-resources/appxserver-portable
 * when the zip exists and (appxserver-portable is missing or an update is needed).
 */
export async function initializePersistentResources(): Promise<void> {
    const installPath = getExtraResourcesPath();
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

    migrateLegacyPortableDir(persistentPath);

    const zipPath = resolvePortableZipPath(installPath);
    const appxserverDest = path.join(persistentPath, PORTABLE_DIR);

    const installVersionFile = path.join(installPath, '.version');
    const persistentVersionFile = path.join(persistentPath, '.version');
    const installVersion = readVersionFile(installVersionFile);
    const persistentVersion = readVersionFile(persistentVersionFile);
    const isUpgrade = Boolean(installVersion && persistentVersion && installVersion !== persistentVersion);

    // Log version state for diagnosing missing backup (e.g. when .version is missing on one side)
    log.info(`Version: install=${installVersion ?? 'none'}, persistent=${persistentVersion ?? 'none'}, isUpgrade=${isUpgrade}`);
    log.info(`Paths: appxserverDest exists=${fs.existsSync(appxserverDest)}, zipPath exists=${Boolean(zipPath)}`);

    let backupAppxserverDir: string | undefined;

    // Backup when: (1) we have existing appxserver-portable, (2) we have zip to extract, and
    // (3) either version upgrade is detected OR we're about to overwrite (needUpdateResources).
    // This ensures backup even if persistent .version was never written (e.g. by an older build).
    const willOverwrite = shouldUpdateResources(installPath, persistentPath);
    const shouldBackup = fs.existsSync(appxserverDest) &&
        Boolean(zipPath) &&
        (isUpgrade || (Boolean(installVersion) && willOverwrite));

    if (shouldBackup) {
        // Backup existing appxserver-portable with original version suffix
        const suffix = persistentVersion || 'backup';
        let candidate = path.join(persistentPath, `${PORTABLE_DIR}-${suffix}`);
        let counter = 1;
        while (fs.existsSync(candidate)) {
            candidate = path.join(persistentPath, `${PORTABLE_DIR}-${suffix}-${counter}`);
            counter++;
        }

        try {
            fs.renameSync(appxserverDest, candidate);
            backupAppxserverDir = candidate;
            log.info(`Backed up existing ${PORTABLE_DIR} to ${candidate}`);

            // Mark that we need to run DB migration on next startup
            process.env.ENV_APPXSERVER_MIGRATION = 'True';
            log.info('ENV_APPXSERVER_MIGRATION set to True for appxserver upgrade migration');
        } catch (err: unknown) {
            const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : '';

            // EPERM on Windows often means directory in use; retry once after short delay
            if (code === 'EPERM' || code === 'EBUSY') {
                log.info(`Retrying backup after brief delay (${code})`);
                await new Promise((r) => setTimeout(r, 500));
                try {
                    fs.renameSync(appxserverDest, candidate);
                    backupAppxserverDir = candidate;
                    log.info(`Backed up existing ${PORTABLE_DIR} to ${candidate}`);

                    process.env.ENV_APPXSERVER_MIGRATION = 'True';
                } catch (retryErr) {
                    log.error(`Failed to backup existing ${PORTABLE_DIR} (retry): ${retryErr}`);
                }
            } else {
                log.error(`Failed to backup existing ${PORTABLE_DIR}: ${err}`);
            }
        }
    }

    const needExtract = Boolean(zipPath) &&
        (!fs.existsSync(appxserverDest) || shouldUpdateResources(installPath, persistentPath));

    if (needExtract) {
        log.info(`Extracting ${path.basename(zipPath!)} to persistent-resources`);
        await extractAppxserverZip(installPath, persistentPath);

        if (backupAppxserverDir && fs.existsSync(appxserverDest)) {
            migratePgdataFromBackup(backupAppxserverDir, appxserverDest);
        }
    } else if (fs.existsSync(appxserverDest)) {
        migrateLegacyServerDir(appxserverDest);
    }

    if (shouldUpdateResources(installPath, persistentPath)) {
        log.info('Resources need to be updated');
        updateResources(installPath, persistentPath);
    } else {
        log.info('Resources are up to date');
    }
}

/**
 * Get the working directory for appxserver
 * This returns the path to the persistent appxserver-portable directory
 */
export function getAppxserverWorkDir(): string {
    return path.join(getPersistentResourcesPath(), PORTABLE_DIR);
}
