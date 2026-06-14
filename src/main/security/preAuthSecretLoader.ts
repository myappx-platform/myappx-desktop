// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import fs from 'fs';
import path from 'path';

import {SECURE_STORAGE_KEYS} from 'common/constants/secureStorage';
import {Logger} from 'common/log';
import ServerManager from 'common/servers/serverManager';
import {getExtraResourcesPath} from 'main/persistentResources';
import secureStorage from 'main/secureStorage';

const log = new Logger('PreAuthSecretLoader');

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

const SECRET_FILE_NAME = 'myappx-preauth.secret';

/** Must match {@code MyAppxDesktopPreAuthConfig.DEFAULT_SECRET} on the server. */
export const DEFAULT_PREAUTH_SECRET = 'MyAppxDesktop-DefaultPreAuth-v1';

function readSecretFile(filePath: string): string | undefined {
    try {
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        const secret = fs.readFileSync(filePath, 'utf8').trim();
        return secret || undefined;
    } catch (error) {
        log.warn('Failed to read pre-auth secret file', {filePath, error});
        return undefined;
    }
}

function isLocalServerUrl(url: URL): boolean {
    return LOCAL_HOSTNAMES.has(url.hostname.toLowerCase());
}

export function loadLocalPreAuthSecret(): string {
    const secretPath = path.join(getExtraResourcesPath(), SECRET_FILE_NAME);
    const secret = readSecretFile(secretPath);
    if (secret) {
        log.info('Loaded local MyAppx Desktop pre-auth secret', {filePath: secretPath});
        return secret;
    }

    return DEFAULT_PREAUTH_SECRET;
}

export async function applyLocalPreAuthSecretToServers(): Promise<void> {
    for (const server of ServerManager.getAllServers()) {
        if (!isLocalServerUrl(server.url)) {
            continue;
        }

        const secret = loadLocalPreAuthSecret();
        ServerManager.updatePreAuthSecret(server.id, secret);
        try {
            await secureStorage.setSecret(server.url.toString(), SECURE_STORAGE_KEYS.PREAUTH, secret);
        } catch (error) {
            log.warn('Failed to persist local pre-auth secret for server', {serverId: server.id, error});
        }
    }
}
