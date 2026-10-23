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
    const add = (root: string) => {
        const resolved = path.resolve(root);
        if (!roots.includes(resolved)) {
            roots.push(resolved);
        }
    };
    if (resourcesPath) {
        add(path.join(resourcesPath, 'page-companion'));
    }

    // Packaged apps keep the companion in process.resourcesPath. `electron dist/`
    // does not: webpack reports __dirname as src/app/pageCompanion, and Electron's
    // own resources directory does not contain the companion.
    add(path.resolve(moduleDir, '../resources/page-companion'));
    add(path.resolve(moduleDir, '../../../resources/page-companion'));
    add(path.resolve('resources/page-companion'));
    return roots;
}

export function resolveNodeHost(roots: string[]): string | undefined {
    const name = process.platform === 'win32' ? 'node.exe' : 'node';
    for (const root of roots) {
        const host = path.join(root, 'host', name);
        if (fs.existsSync(host)) {
            return host;
        }
    }
    return undefined;
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

export function mcpLaunch(cli: string, port: string, nodeHost: string, env: NodeJS.ProcessEnv): McpLaunch {
    const childEnv: NodeJS.ProcessEnv = {
        ...env,
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
    };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    return {
        command: nodeHost,
        args: [cli, '--cdp-endpoint', `http://127.0.0.1:${port}`],
        cwd: path.resolve(cli, '../../../..'),
        env: childEnv,
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
