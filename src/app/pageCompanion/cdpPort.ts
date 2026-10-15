// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

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
