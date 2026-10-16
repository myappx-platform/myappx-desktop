// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {spawn, type ChildProcessWithoutNullStreams} from 'child_process';

import TabManager from 'app/tabs/tabManager';
import {Logger} from 'common/log';

import {readCdpPort} from './cdpPort';
import {companionRoots, mcpLaunch, resolveMcpCli} from './mcpLaunch';
import {pickTabIndex, tabIsCurrent} from './tabPick';

const log = new Logger('PageCompanion');

type PageReport = {
    ok: boolean;
    kind?: 'snapshot' | 'act';
    text?: string;
    url?: string;
    title?: string;
    error?: string;
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

    act = (action: {op: string; ref: string; value?: string}): Promise<PageReport> => this.run(async () => {
        log.info(`page.act ${action.op}`);
        const page = this.activeWebui();
        if (!page) {
            return {ok: false, kind: 'act', error: 'not-webui'};
        }
        if (!this.lastUrl || page.url !== this.lastUrl) {
            return {ok: false, kind: 'act', error: 'page-changed'};
        }
        const started = await this.ensureStarted();
        if (!started) {
            return {ok: false, kind: 'act', error: 'mcp-down'};
        }
        const args = action.op === 'fill_form' ? {
            fields: [{
                name: 'field',
                type: 'textbox',
                ref: action.ref,
                value: action.value ?? '',
            }],
        } : {element: action.ref, ref: action.ref};
        const name = action.op === 'fill_form' ? 'browser_fill_form' : 'browser_click';
        const called = await this.callTool(name, args);
        if (!called.ok) {
            return {ok: false, kind: 'act', error: 'act-failed'};
        }
        return {ok: true, kind: 'act'};
    });

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
        const shot = await this.callTool('browser_snapshot', {});
        if (!shot.ok) {
            return {ok: false, kind: 'snapshot', error: 'mcp-down'};
        }
        this.lastUrl = page.url;
        const text = shot.text.length > 12000 ? shot.text.slice(0, 12000) : shot.text;
        return {ok: true, kind: 'snapshot', text, url: page.url, title: page.title};
    }

    private activeWebui(): {url: string; title: string} | undefined {
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
        try {
            title = view.getWebContentsView().webContents.getTitle() || '';
        } catch {
            log.warn('page title unavailable');
        }
        return {url, title};
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
        const cli = resolveMcpCli(companionRoots(process.resourcesPath, __dirname));
        if (!cli) {
            log.warn('Playwright MCP is not bundled');
            return false;
        }
        const launch = mcpLaunch(cli, port, process.execPath, process.env);
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
        const json = JSON.stringify(message);
        const body = Buffer.from(json, 'utf8');
        this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
        this.child.stdin.write(body);
    }

    private onData(chunk: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (this.buffer.length > 0) {
            const headerEnd = this.buffer.indexOf('\r\n\r\n');
            if (headerEnd < 0) {
                return;
            }
            const header = this.buffer.slice(0, headerEnd).toString('utf8');
            const match = header.match(/Content-Length:\s*(\d+)/i);
            if (!match) {
                this.buffer = Buffer.alloc(0);
                return;
            }
            const length = Number(match[1]);
            const start = headerEnd + 4;
            if (this.buffer.length < start + length) {
                return;
            }
            const body = this.buffer.slice(start, start + length).toString('utf8');
            this.buffer = this.buffer.slice(start + length);
            this.onMessage(body);
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
