// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {spawn, type ChildProcessWithoutNullStreams} from 'child_process';
import type {WebContents} from 'electron';

import TabManager from 'app/tabs/tabManager';
import {Logger} from 'common/log';

import {readCdpPort} from './cdpPort';
import {companionRoots, mcpLaunch, resolveMcpCli, resolveNodeHost} from './mcpLaunch';
import {extractWindowHint, focusDocumentText} from './snapshotFocus';
import {pickTabIndex, tabIsCurrent} from './tabPick';
import {parseFieldList, zkInvoke, type ZkField} from './zkFields';

const log = new Logger('PageCompanion');

type PageReport = {
    ok: boolean;
    kind?: 'snapshot' | 'act' | 'assist';
    text?: string;
    url?: string;
    title?: string;
    error?: string;
    fields?: ZkField[];
    highlighted?: boolean;
};

type PageTarget = {
    op: string;
    ref?: string;
    value?: string;
    instanceName?: string;
    label?: string;
    tabName?: string;
};

type Pending = {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
};

export class PageCompanion {
    private child: ChildProcessWithoutNullStreams | undefined;
    private buffer = Buffer.alloc(0);
    private nextId = 1;
    private pending = new Map<number, Pending>();
    private ready = false;
    private tail: Promise<void> = Promise.resolve();
    private lastUrl = '';

    snapshot = (): Promise<PageReport> => this.run(() => this.snapshotOnce());

    warm = (): void => {
        if (!readCdpPort()) {
            return;
        }
        this.run(async () => {
            const started = await this.ensureStarted();
            if (!started) {
                log.warn('Playwright MCP is not ready');
            }
        }).catch(() => {
            log.warn('Playwright MCP is not ready');
        });
    };

    act = (action: PageTarget): Promise<PageReport> => this.run(async () => {
        log.info(`page.act ${action.op}`);
        const page = this.activeWebui();
        if (!page) {
            return {ok: false, kind: 'act', error: 'not-webui'};
        }
        const labelAct = !action.ref && (action.op === 'set_text' || action.op === 'click' || action.op === 'select_option');
        if (!labelAct && (!this.lastUrl || page.url !== this.lastUrl)) {
            return {ok: false, kind: 'act', error: 'page-changed'};
        }
        await this.highlightTarget(page.webContents, action);
        if (action.op === 'set_text' || (!action.ref && (action.op === 'click' || action.op === 'select_option'))) {
            const fn = action.op === 'click' ? 'clickLabel' : action.op === 'select_option' ? 'selectLabel' : 'setText';
            const wrote = await this.zkCall(page.webContents, fn, {
                instanceName: action.instanceName ?? '',
                label: action.label ?? '',
                value: action.value ?? '',
            }) as {ok?: boolean; error?: string} | null;
            if (!wrote || wrote.ok === false) {
                return {ok: false, kind: 'act', error: typeof wrote?.error === 'string' ? wrote.error : 'act-failed'};
            }
            await this.stabilizeAfterAct();
            return {ok: true, kind: 'act'};
        }
        const started = await this.ensureStarted();
        if (!started) {
            return {ok: false, kind: 'act', error: 'mcp-down'};
        }
        const ref = action.ref ?? '';
        let toolName = 'browser_click';
        let args: Record<string, unknown> = {element: ref, ref};
        switch (action.op) {
        case 'fill_form':
            toolName = 'browser_fill_form';
            args = {
                fields: [{
                    name: 'field',
                    type: 'textbox',
                    ref,
                    value: action.value ?? '',
                }],
            };
            break;
        case 'type':
            toolName = 'browser_type';
            args = {ref, text: action.value ?? ''};
            break;
        case 'press':
            toolName = 'browser_press_key';
            args = {key: action.value ?? 'Enter'};
            break;
        case 'select_option':
            toolName = 'browser_select_option';
            args = {ref, values: [action.value ?? '']};
            break;
        default:
            break;
        }
        const called = await this.callTool(toolName, args);
        if (!called.ok) {
            return {ok: false, kind: 'act', error: 'act-failed'};
        }
        await this.stabilizeAfterAct();
        return {ok: true, kind: 'act'};
    });

    assist = (action: PageTarget): Promise<PageReport> => this.run(async () => {
        log.info(`page.assist ${action.op}`);
        const page = this.activeWebui();
        if (!page) {
            return {ok: false, kind: 'assist', error: 'not-webui'};
        }
        if (action.op === 'clear') {
            await this.zkCall(page.webContents, 'clearHighlight');
            return {ok: true, kind: 'assist', highlighted: false};
        }
        if (action.op === 'show_tab') {
            const shown = await this.zkCall(page.webContents, 'showTab', {tabName: action.tabName ?? ''}) as {ok?: boolean} | null;
            return {ok: !!shown && shown.ok !== false, kind: 'assist', highlighted: false};
        }
        if (action.op === 'scroll') {
            const moved = await this.zkCall(page.webContents, 'scrollField', {
                instanceName: action.instanceName ?? '',
                label: action.label ?? '',
            }) as {ok?: boolean} | null;
            return {ok: !!moved && moved.ok !== false, kind: 'assist', highlighted: false};
        }
        const painted = await this.zkCall(page.webContents, 'highlight', {
            instanceName: action.instanceName ?? '',
            label: action.label ?? '',
        }) as {ok?: boolean; highlighted?: boolean} | null;
        if (!painted) {
            return {ok: false, kind: 'assist', error: 'act-failed', highlighted: false};
        }
        return {ok: true, kind: 'assist', highlighted: painted.highlighted === true};
    });

    webuiUrl = (): string | undefined => this.activeWebui()?.url;

    stop = (): void => {
        this.ready = false;
        this.lastUrl = '';
        for (const waiter of this.pending.values()) {
            clearTimeout(waiter.timer);
            waiter.reject(new Error('stopped'));
        }
        this.pending.clear();
        if (this.child && !this.child.killed) {
            this.child.kill();
        }
        this.child = undefined;
    };

    private run<T>(fn: () => Promise<T>): Promise<T> {
        const next = this.tail.then(fn, fn);
        this.tail = next.then(() => undefined, () => undefined);
        return next;
    }

    private stabilizeAfterAct(): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(resolve, 400);
        });
    }

    private async snapshotOnce(): Promise<PageReport> {
        log.info('page.snapshot');
        const page = this.activeWebui();
        if (!page) {
            this.lastUrl = '';
            return {ok: false, kind: 'snapshot', error: 'not-webui'};
        }
        if (!readCdpPort()) {
            return {ok: false, kind: 'snapshot', error: 'no-cdp'};
        }
        const started = await this.ensureStarted();
        if (!started) {
            return {ok: false, kind: 'snapshot', error: 'mcp-down'};
        }
        const listed = await this.callTool('browser_tabs', {action: 'list'});
        if (!listed.ok) {
            return {ok: false, kind: 'snapshot', error: 'no-tab'};
        }
        const index = pickTabIndex(listed.text, page.url);
        if (index == null) {
            return {ok: false, kind: 'snapshot', error: 'no-tab'};
        }
        if (!tabIsCurrent(listed.text, index)) {
            const selected = await this.callTool('browser_tabs', {action: 'select', index});
            if (!selected.ok) {
                return {ok: false, kind: 'snapshot', error: 'no-tab'};
            }
        }
        await this.zkCall(page.webContents, 'clearHighlight');
        const shot = await this.callTool('browser_snapshot', {});
        if (!shot.ok) {
            return {ok: false, kind: 'snapshot', error: 'mcp-down'};
        }
        this.lastUrl = page.url;
        const windowHint = extractWindowHint(shot.text);
        const text = focusDocumentText(shot.text, 12000);
        const title = windowHint || page.title;
        const fields = await this.readFields(page.webContents);
        return {ok: true, kind: 'snapshot', text, url: page.url, title, fields};
    }

    private activeWebui(): {url: string; title: string; webContents: WebContents} | undefined {
        const view = TabManager.getCurrentActiveTabView();
        const current = view?.currentURL;
        if (!current) {
            return undefined;
        }
        const url = current.href;
        if (!url.toLowerCase().includes('/webui')) {
            return undefined;
        }
        let title = '';
        let webContents: WebContents;
        try {
            webContents = view.getWebContentsView().webContents;
            title = webContents.getTitle() || '';
        } catch {
            log.warn('page title unavailable');
            return undefined;
        }
        return {url, title, webContents};
    }

    private async readFields(webContents: WebContents): Promise<ZkField[]> {
        const raw = await this.zkCall(webContents, 'read');
        return parseFieldList(raw);
    }

    private async highlightTarget(webContents: WebContents, action: PageTarget): Promise<void> {
        if (!action.instanceName && !action.label) {
            return;
        }
        await this.zkCall(webContents, 'highlight', {
            instanceName: action.instanceName ?? '',
            label: action.label ?? '',
        });
        await this.pause(250);
    }

    private async zkCall(webContents: WebContents, fn: 'read' | 'setText' | 'highlight' | 'clearHighlight' | 'showTab' | 'scrollField' | 'clickLabel' | 'selectLabel', arg?: unknown): Promise<unknown> {
        try {
            return await webContents.executeJavaScript(zkInvoke(fn, arg), true);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'error';
            log.warn(`zk script ${fn} failed: ${message}`);
            return null;
        }
    }

    private pause(ms: number): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }

    private async ensureStarted(): Promise<boolean> {
        const port = readCdpPort();
        if (!port) {
            return false;
        }
        if (this.ready && this.child && !this.child.killed) {
            return true;
        }
        if (this.child && !this.child.killed) {
            this.child.kill();
        }
        this.child = undefined;
        this.ready = false;
        const roots = companionRoots(process.resourcesPath, __dirname);
        const cli = resolveMcpCli(roots);
        const nodeHost = resolveNodeHost(roots);
        if (!cli || !nodeHost) {
            log.warn('Playwright MCP is not bundled');
            return false;
        }
        const launch = mcpLaunch(cli, port, nodeHost, process.env);
        let spawned: ChildProcessWithoutNullStreams;
        try {
            spawned = spawn(launch.command, launch.args, {
                cwd: launch.cwd,
                env: launch.env,
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe'] as const,
            });
            this.child = spawned;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'error';
            log.warn(`Playwright MCP did not start: ${message}`);
            return false;
        }
        let starting = true;
        const failed = new Promise<never>((_, reject) => {
            spawned.once('error', (error: Error) => {
                if (!starting) {
                    log.warn(`Playwright MCP stopped: ${error.message}`);
                    return;
                }
                reject(error);
            });
        });
        spawned.stdout.on('data', (chunk: Buffer) => this.onData(chunk));
        spawned.stderr.on('data', (chunk: Buffer) => {
            const line = chunk.toString('utf8').trim().slice(0, 400);
            if (line) {
                log.warn(`playwright-mcp: ${line}`);
            }
        });
        spawned.on('exit', () => {
            if (this.child === spawned) {
                this.ready = false;
                this.child = undefined;
            }
        });
        try {
            await Promise.race([
                this.request('initialize', {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    clientInfo: {name: 'myappx-page-companion', version: '1.0.0'},
                }),
                failed,
            ]);
            starting = false;
            this.notify('notifications/initialized', {});
            this.ready = true;
            return true;
        } catch {
            log.warn('Playwright MCP initialize failed');
            this.stop();
            return false;
        }
    }

    private async callTool(name: string, args: Record<string, unknown>): Promise<{ok: boolean; text: string}> {
        try {
            const result = await this.request('tools/call', {name, arguments: args}) as {
                content?: Array<{type?: string; text?: string}>;
                isError?: boolean;
            };
            const text = (result?.content || []).
                filter((part) => part && part.type === 'text' && part.text).
                map((part) => part.text).
                join('\n');
            return {ok: !result?.isError, text};
        } catch {
            return {ok: false, text: ''};
        }
    }

    private notify(method: string, params: Record<string, unknown>): void {
        this.send({jsonrpc: '2.0', method, params});
    }

    private request(method: string, params: Record<string, unknown>): Promise<unknown> {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('timeout'));
            }, 30000);
            this.pending.set(id, {resolve, reject, timer});
            try {
                this.send({jsonrpc: '2.0', id, method, params});
            } catch {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(new Error('mcp down'));
            }
        });
    }

    private send(message: unknown): void {
        if (!this.child || !this.child.stdin.writable) {
            throw new Error('mcp down');
        }

        // Current @playwright/mcp uses newline-delimited JSON, not Content-Length frames.
        this.child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    private onData(chunk: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        let newline = this.buffer.indexOf('\n');
        while (newline >= 0) {
            const line = this.buffer.slice(0, newline).toString('utf8').replace(/\r$/, '');
            this.buffer = this.buffer.slice(newline + 1);
            if (line) {
                this.onMessage(line);
            }
            newline = this.buffer.indexOf('\n');
        }
    }

    private onMessage(body: string): void {
        let message: {id?: number; result?: unknown; error?: {message?: string}};
        try {
            message = JSON.parse(body);
        } catch {
            return;
        }
        if (message.id == null) {
            return;
        }
        const waiter = this.pending.get(message.id);
        if (!waiter) {
            return;
        }
        this.pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.error) {
            waiter.reject(new Error('mcp error'));
            return;
        }
        waiter.resolve(message.result);
    }
}

const pageCompanion = new PageCompanion();
export default pageCompanion;
