// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import fs from 'fs';
import path from 'path';

export type McpLaunch = {
    command: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
};

export function companionRoots(resourcesPath: string | undefined, moduleDir: string): string[] {
    const roots: string[] = [];
    if (resourcesPath) {
        roots.push(path.join(resourcesPath, 'page-companion'));
    }
    roots.push(path.resolve(moduleDir, '../resources/page-companion'));
    return roots;
}

export function resolveMcpCli(roots: string[]): string | undefined {
    for (const root of roots) {
        const pkgPath = path.join(root, 'node_modules', '@playwright', 'mcp', 'package.json');
        if (!fs.existsSync(pkgPath)) {
            continue;
        }
        let bin: unknown;
        try {
            bin = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).bin;
        } catch {
            continue;
        }
        const relative = binPath(bin);
        if (!relative) {
            continue;
        }
        const cli = path.resolve(path.dirname(pkgPath), relative);
        if (fs.existsSync(cli)) {
            return cli;
        }
    }
    return undefined;
}

export function mcpLaunch(cli: string, port: string, execPath: string, env: NodeJS.ProcessEnv): McpLaunch {
    return {
        command: execPath,
        args: [cli, '--cdp-endpoint', `http://127.0.0.1:${port}`],
        cwd: path.resolve(cli, '../../../..'),
        env: {
            ...env,
            ELECTRON_RUN_AS_NODE: '1',
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
        },
    };
}

function binPath(bin: unknown): string | undefined {
    if (typeof bin === 'string' && bin) {
        return bin;
    }
    if (!bin || typeof bin !== 'object') {
        return undefined;
    }
    const record = bin as Record<string, unknown>;
    const named = record['playwright-mcp'];
    if (typeof named === 'string' && named) {
        return named;
    }
    const first = Object.values(record).find((value) => typeof value === 'string' && value);
    return typeof first === 'string' ? first : undefined;
}
