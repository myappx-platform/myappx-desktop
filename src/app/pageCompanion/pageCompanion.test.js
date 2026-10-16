// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import fs from 'fs';
import os from 'os';
import path from 'path';

import {applyCdpPort, chooseCdpPort} from 'app/pageCompanion/cdpPort';
import {mcpLaunch, resolveMcpCli, resolveNodeHost} from 'app/pageCompanion/mcpLaunch';
import {pickTabIndex, tabIsCurrent} from 'app/pageCompanion/tabPick';
import {ipcValidate, pageActSchema} from 'common/Validator';

describe('page companion', () => {
    it('does not open a debugging port when no port is passed', () => {
        const appendSwitch = jest.fn();
        expect(applyCdpPort(appendSwitch, undefined)).toBe(false);
        expect(appendSwitch).not.toHaveBeenCalled();
    });

    it('uses 9333 when no port is configured', async () => {
        await expect(chooseCdpPort({}, false, async () => true)).resolves.toBe('9333');
    });

    it('skips a busy default port', async () => {
        const probe = jest.fn(async (port) => port === 9334);
        await expect(chooseCdpPort({}, false, probe)).resolves.toBe('9334');
        expect(probe).toHaveBeenCalledWith(9333);
    });

    it('does not open a port in tests unless one is set', async () => {
        const probe = jest.fn(async () => true);
        await expect(chooseCdpPort({}, true, probe)).resolves.toBeUndefined();
        expect(probe).not.toHaveBeenCalled();
    });

    it('keeps an explicit port', async () => {
        const probe = jest.fn(async () => false);
        await expect(chooseCdpPort({MYAPPX_CDP_PORT: '9444'}, true, probe)).resolves.toBe('9444');
        expect(probe).not.toHaveBeenCalled();
    });

    it('stays closed when the port is turned off', async () => {
        await expect(chooseCdpPort({MYAPPX_CDP_PORT: 'off'}, false, async () => true)).resolves.toBeUndefined();
    });

    it('ignores a port that is not a number', async () => {
        await expect(chooseCdpPort({MYAPPX_CDP_PORT: 'abc'}, false, async () => true)).resolves.toBeUndefined();
    });

    it('launches the bundled mcp with the node host', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'page-companion-'));
        const pkgDir = path.join(root, 'node_modules', '@playwright', 'mcp');
        const hostName = process.platform === 'win32' ? 'node.exe' : 'node';
        fs.mkdirSync(pkgDir, {recursive: true});
        fs.mkdirSync(path.join(root, 'host'), {recursive: true});
        fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({bin: {'playwright-mcp': 'cli.js'}}));
        fs.writeFileSync(path.join(pkgDir, 'cli.js'), '');
        fs.writeFileSync(path.join(root, 'host', hostName), '');
        const cli = resolveMcpCli([root]);
        const nodeHost = resolveNodeHost([root]);
        expect(cli).toBe(path.join(pkgDir, 'cli.js'));
        expect(nodeHost).toBe(path.join(root, 'host', hostName));
        const launch = mcpLaunch(cli, '9333', nodeHost, {PATH: 'kept', ELECTRON_RUN_AS_NODE: '1'});
        expect(launch.command).toBe(nodeHost);
        expect(launch.args).toEqual([cli, '--cdp-endpoint', 'http://127.0.0.1:9333']);
        expect(launch.cwd).toBe(root);
        expect(launch.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
        expect(launch.env.PATH).toBe('kept');
        fs.rmSync(root, {recursive: true, force: true});
    });

    it('opens the debugging port only on 127.0.0.1', () => {
        const appendSwitch = jest.fn();
        expect(applyCdpPort(appendSwitch, '9333')).toBe(true);
        expect(appendSwitch).toHaveBeenCalledWith('remote-debugging-address', '127.0.0.1');
        expect(appendSwitch).toHaveBeenCalledWith('remote-debugging-port', '9333');
    });

    it('rejects a page act that has no ref', () => {
        const handler = jest.fn();
        const wrapped = ipcValidate(handler, [pageActSchema]);
        wrapped({sender: {id: 1}}, {op: 'click'});
        expect(handler).not.toHaveBeenCalled();
        expect(pageActSchema.validate({op: 'click', ref: 'e12'}).error).toBeUndefined();
        expect(pageActSchema.validate({op: 'fill_form', ref: 'e3', value: 'hello'}).error).toBeUndefined();
    });

    it('selects only the tab whose url matches the active view', () => {
        const list = [
            '- 0: (current) [Other](https://localhost:18443/other)',
            '- 1: [Order](https://localhost:18443/webui/)',
        ].join('\n');
        expect(pickTabIndex(list, 'https://localhost:18443/webui')).toBe(1);
        expect(tabIsCurrent(list, 1)).toBe(false);
        expect(pickTabIndex(list, 'https://localhost:18443/missing')).toBeNull();
    });
});
