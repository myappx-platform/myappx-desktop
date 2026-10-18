// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import fs from 'fs';
import os from 'os';
import path from 'path';

import {applyCdpPort, chooseCdpPort} from 'app/pageCompanion/cdpPort';
import {mcpLaunch, resolveMcpCli, resolveNodeHost} from 'app/pageCompanion/mcpLaunch';
import {extractWindowHint, focusDocumentText} from 'app/pageCompanion/snapshotFocus';
import {pickTabIndex, tabIsCurrent} from 'app/pageCompanion/tabPick';
import {columnOf, zkInvoke} from 'app/pageCompanion/zkFields';
import {ipcValidate, pageActSchema, pageAssistSchema} from 'common/Validator';

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
        expect(pageActSchema.validate({op: 'click', label: 'Search'}).error).toBeUndefined();
        expect(pageActSchema.validate({op: 'click', label: 'Search', ref: 'e12'}).error).toBeDefined();
        expect(pageActSchema.validate({op: 'select_option', label: 'Organization', value: 'HQ'}).error).toBeUndefined();
        expect(pageActSchema.validate({op: 'press', value: 'Enter'}).error).toBeUndefined();
        expect(pageActSchema.validate({op: 'click', ref: 'e12'}).error).toBeUndefined();
        expect(pageActSchema.validate({op: 'fill_form', ref: 'e3', value: 'hello'}).error).toBeUndefined();
        expect(pageActSchema.validate({op: 'type', ref: 'e3', value: 'hello'}).error).toBeUndefined();
        expect(pageActSchema.validate({op: 'press', ref: 'e3', value: 'Tab'}).error).toBeUndefined();
        expect(pageActSchema.validate({op: 'select_option', ref: 'e5', value: 'HQ'}).error).toBeUndefined();
        expect(pageActSchema.validate({op: 'set_text', instanceName: 'C_Order0Description', value: 'hello'}).error).toBeUndefined();
        expect(pageActSchema.validate({op: 'set_text', label: 'Description', value: 'hello'}).error).toBeUndefined();
        expect(pageActSchema.validate({op: 'set_text', instanceName: 'C_Order0Description', value: 'hello', ref: 'e3'}).error).toBeDefined();
        expect(pageActSchema.validate({op: 'set_text', value: 'hello'}).error).toBeDefined();
        expect(pageActSchema.validate({op: 'evaluate', ref: 'e1'}).error).toBeDefined();
        expect(pageActSchema.validate({op: 'script', instanceName: 'Description', value: 'x'}).error).toBeDefined();
        expect(pageAssistSchema.validate({op: 'highlight', label: 'Description'}).error).toBeUndefined();
        expect(pageAssistSchema.validate({op: 'scroll', instanceName: 'C_Order0Description'}).error).toBeUndefined();
        expect(pageAssistSchema.validate({op: 'show_tab', tabName: 'Order'}).error).toBeUndefined();
        expect(pageAssistSchema.validate({op: 'clear'}).error).toBeUndefined();
        expect(pageAssistSchema.validate({op: 'highlight'}).error).toBeDefined();
        expect(pageAssistSchema.validate({op: 'show_tab'}).error).toBeDefined();
        expect(pageAssistSchema.validate({op: 'fill_form', ref: 'e1', value: 'x'}).error).toBeDefined();
        expect(pageAssistSchema.validate({op: 'highlight', label: 'Description', ref: 'e12'}).error).toBeDefined();
    });

    it('reads the column after the table marker in instanceName', () => {
        expect(columnOf('C_Order0Description')).toBe('Description');
        expect(columnOf('Description')).toBe('Description');
    });

    it('keeps the fixed zk script valid when a value contains quotes', () => {
        const src = zkInvoke('setText', {instanceName: 'C_Order0Description', value: '"); alert(1)'});
        expect(() => new Function(`return ${src}`)).not.toThrow();
        expect(src).not.toContain('browser_evaluate');
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

    it('treats /webui and /webui/index.zul as the same tab', () => {
        const list = [
            '- 0: (current) [Downloads](myappx-desktop://renderer/downloadsDropdown.html)',
            '- 5: [MyAppx](https://localhost:18443/webui/index.zul)',
        ].join('\n');
        expect(pickTabIndex(list, 'https://localhost:18443/webui/')).toBe(5);
        expect(pickTabIndex(list, 'https://localhost:18443/webui')).toBe(5);
    });

    it('keeps the open document when shell chrome fills the start of the snapshot', () => {
        const shell = [
            '### Open tabs',
            '- 0: [Downloads](myappx-desktop://renderer/downloadsDropdown.html)',
            '### Snapshot',
            '- generic "Activities" [ref=e1]: "14"',
            '- generic [ref=e2]: SuperUser',
            '- generic [ref=e3]: Favorites',
            '- text: Sales Order',
            '- button "New" [ref=e4]',
            'x'.repeat(7000),
            '- columnheader "Document No" [ref=e441]',
            '- gridcell "80000" [ref=e442]',
            '- textbox "Description" [ref=e450]: Copilot test',
        ].join('\n');
        const focused = focusDocumentText(shell, 6000);
        expect(focused).toContain('Document No');
        expect(focused).toContain('Copilot test');
        expect(focused).toContain('### Window');
        expect(focused).toContain('Sales Order');
        expect(focused).not.toContain('Activities');
        expect(focused).not.toContain('Favorites');
    });

    it('extracts the AD window label before focus drops chrome', () => {
        const shell = [
            '### Snapshot',
            '- tab "Sales Order" [selected] [ref=e10]',
            '- generic [ref=e3]: Favorites',
            'x'.repeat(5000),
            '- columnheader "Document No" [ref=e441]',
        ].join('\n');
        expect(extractWindowHint(shell)).toBe('Sales Order');
        expect(focusDocumentText(shell, 2000)).toContain('Sales Order');
    });

    it('reads the grid row named on the window tab', () => {
        const shell = [
            '### Snapshot',
            '- listitem "Sales Order: 80001" [ref=e2]:',
            '  - text: "Sales Order: 80001"',
            '- grid [ref=e10]:',
            '  - rowgroup [ref=e11]:',
            '    - columnheader [ref=e12]:',
            '      - checkbox [ref=e13]',
            '    - columnheader [ref=e14]',
            '    - columnheader "Organization" [ref=e15]',
            '    - columnheader "Document No" [ref=e16]',
            '    - columnheader "Order Reference" [ref=e17]',
            '    - columnheader "Business Partner" [ref=e18]',
            '  - rowgroup [ref=e19]:',
            '    - checkbox [ref=e20] [cursor=pointer]',
            '    - generic [ref=e21] [cursor=pointer]: HQ',
            '    - generic [ref=e22] [cursor=pointer]: "80002"',
            '    - generic [ref=e23] [cursor=pointer]: Phone Order',
            '    - generic [ref=e24] [cursor=pointer]: C&W Construction',
            '    - checkbox [ref=e25] [cursor=pointer]',
            '    - generic [ref=e26] [cursor=pointer]: ',
            '    - generic [ref=e27] [cursor=pointer]: HQ',
            '    - generic [ref=e28] [cursor=pointer]: "80001"',
            '    - generic [ref=e29] [cursor=pointer]: Standard',
        ].join('\n');
        const focused = focusDocumentText(shell, 4000);
        expect(focused).toContain('Sales Order: 80001');
        expect(focused).toContain('Document No: 80001');
        expect(focused).toContain('Organization: HQ');
        expect(focused).toContain('Standard');
        expect(focused).not.toContain('Phone Order');
        expect(focused).not.toContain('80002');
    });

    it('asks for a selected row when the grid tab has no document number', () => {
        const shell = [
            '### Snapshot',
            '- listitem "Sales Order" [ref=e2]',
            '- grid [ref=e10]:',
            '  - columnheader "Document No" [ref=e16]',
            '  - columnheader "Organization" [ref=e15]',
            '  - checkbox [ref=e20] [cursor=pointer]',
            '  - generic [ref=e22]: "80002"',
            '  - checkbox [ref=e25] [cursor=pointer]',
            '  - generic [ref=e28]: "80001"',
        ].join('\n');
        const focused = focusDocumentText(shell, 2000);
        expect(focused).toContain('没有唯一选中行');
        expect(focused).not.toContain('80002');
    });

    it('keeps the ZK window tab when a later field sits under a long description', () => {
        const shell = [
            '### Snapshot',
            '- listitem "Home" [ref=e1]',
            '- listitem "*Sales Order: 80002" [ref=e2]:',
            '  - text: "*Sales Order: 80002"',
            '- text: ' + ' '.repeat(8),
            '- generic [ref=e546]: Document No',
            '- textbox "Document sequence number of the document" [ref=e547]: "80002"',
            '- textbox "Optional short description of the record" [ref=e552]: ' + 'printed '.repeat(80),
            '- generic [ref=e554]: Target Document Type*',
            '- columnheader "Document No" [ref=e900]',
        ].join('\n');
        expect(extractWindowHint(shell)).toBe('*Sales Order: 80002');
        const focused = focusDocumentText(shell, 4000);
        expect(focused).toContain('*Sales Order: 80002');
        expect(focused).toContain('Document No');
        expect(focused).toContain('80002');
    });
});
