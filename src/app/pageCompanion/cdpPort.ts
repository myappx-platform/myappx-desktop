// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createServer} from 'net';

export const DEFAULT_CDP_PORT = 9333;
export const CDP_PORT_ATTEMPTS = 10;

const CDP_OFF = /^(off|false|no)$/i;

export function readCdpPort(env: NodeJS.ProcessEnv = process.env): string | undefined {
    const raw = env.MYAPPX_CDP_PORT;
    if (!raw || !(/^\d{1,5}$/).test(raw.trim())) {
        return undefined;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
        return undefined;
    }
    return String(n);
}

/**
 * Port for the page companion. An explicit MYAPPX_CDP_PORT wins.
 * `off` stays closed. Tests stay closed unless a port is set.
 * Otherwise the first free port from 9333 is used.
 */
export async function chooseCdpPort(
    env: NodeJS.ProcessEnv,
    isTest: boolean,
    probe: (port: number) => Promise<boolean> = probePortFree,
): Promise<string | undefined> {
    const raw = (env.MYAPPX_CDP_PORT ?? '').trim();
    if (CDP_OFF.test(raw)) {
        return undefined;
    }
    const explicit = readCdpPort(env);
    if (explicit) {
        return explicit;
    }
    if (raw || isTest) {
        return undefined;
    }
    return firstFreePort(DEFAULT_CDP_PORT, CDP_PORT_ATTEMPTS, probe);
}

async function firstFreePort(
    port: number,
    remaining: number,
    probe: (port: number) => Promise<boolean>,
): Promise<string | undefined> {
    if (remaining <= 0) {
        return undefined;
    }
    if (await probe(port)) {
        return String(port);
    }
    return firstFreePort(port + 1, remaining - 1, probe);
}

export function probePortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = createServer();
        server.unref();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen(port, '127.0.0.1');
    });
}

export function applyCdpPort(
    appendSwitch: (key: string, value?: string) => void,
    port: string | undefined,
): boolean {
    const normalized = readCdpPort({MYAPPX_CDP_PORT: port});
    if (!normalized) {
        return false;
    }
    appendSwitch('remote-debugging-address', '127.0.0.1');
    appendSwitch('remote-debugging-port', normalized);
    return true;
}
