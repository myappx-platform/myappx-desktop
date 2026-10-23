// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import fs from 'fs';
import * as nodeModule from 'module';
import path from 'path';

import {app, BrowserWindow} from 'electron';

import {Logger} from 'common/log';

import {readCdpPort} from './cdpPort';
import {companionRoots} from './mcpLaunch';
import pageCompanion from './pageCompanion';
import {PageRecorder, type ClipEncoder, type ScreencastSession} from './pageRecorder';
import {webuiKey} from './tabPick';

const log = new Logger('PageRecorder');

const CLIP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ENCODER_HTML = `<!doctype html><html><body><canvas id="c"></canvas><script>
var canvas = document.getElementById('c');
var ctx = canvas.getContext('2d');
var rec, stream, chunks = [], last = Promise.resolve(), mime = 'video/webm';
window.recFrame = function (b64) {
  last = last.then(function () {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        if (!img.width || !img.height) { resolve(); return; }
        if (!rec) {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          stream = canvas.captureStream(10);
          mime = (window.MediaRecorder && MediaRecorder.isTypeSupported('video/webm;codecs=vp8'))
            ? 'video/webm;codecs=vp8' : 'video/webm';
          rec = new MediaRecorder(stream, {mimeType: mime});
          rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
          rec.start(250);
          resolve();
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve();
      };
      img.onerror = function () { resolve(); };
      img.src = 'data:image/jpeg;base64,' + b64;
    });
  });
  return last;
};
window.recStop = function () {
  return last.then(function () {
    if (!rec) return '';
    return new Promise(function (resolve) {
      rec.onstop = function () {
        var blob = new Blob(chunks, {type: mime});
        var reader = new FileReader();
        reader.onload = function () {
          var text = String(reader.result || '');
          var cut = text.indexOf(',');
          resolve(cut >= 0 ? text.slice(cut + 1) : '');
        };
        reader.onerror = function () { resolve(''); };
        reader.readAsDataURL(blob);
        if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
      };
      try { rec.stop(); } catch (e) { resolve(''); }
    });
  });
};
</script></body></html>`;

type CdpPage = {
    url: () => string;
    context: () => {newCDPSession: (page: CdpPage) => Promise<CdpSession>};
};

type CdpSession = {
    send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
    on: (event: 'Page.screencastFrame', handler: (event: {data?: string; sessionId: number}) => void) => void;
    detach: () => Promise<void>;
};

type CdpBrowser = {
    contexts: () => Array<{pages: () => CdpPage[]}>;
    on: (event: 'disconnected', handler: () => void) => void;
    close: () => Promise<void>;
};

type ChromiumLike = {
    connectOverCDP: (endpoint: string) => Promise<CdpBrowser>;
};

let connected: {endpoint: string; browser: CdpBrowser} | undefined;

function loadChromium(): ChromiumLike | undefined {
    const roots = companionRoots(process.resourcesPath, __dirname);
    for (const root of roots) {
        const pkg = path.join(root, 'node_modules', 'playwright-core', 'package.json');
        if (!fs.existsSync(pkg)) {
            continue;
        }
        try {
            // Webpack rewrites a direct createRequire() call to undefined when the
            // path is not a literal. Look the factory up so the bundle keeps it.
            const factory = (nodeModule as unknown as Record<string, (from: string) => NodeRequire>).createRequire;
            const loaded = factory(pkg)('playwright-core') as {chromium?: ChromiumLike};
            if (loaded.chromium) {
                return loaded.chromium;
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'error';
            log.warn(`Playwright did not load: ${message.slice(0, 200)}`);
        }
    }
    return undefined;
}

async function connect(endpoint: string): Promise<CdpBrowser> {
    if (connected?.endpoint === endpoint) {
        return connected.browser;
    }
    const chromium = loadChromium();
    if (!chromium) {
        throw new Error('playwright missing');
    }

    // Keep this socket for the life of the app. browser.close() on a
    // connectOverCDP session can close the attached Electron browser.
    const browser = await chromium.connectOverCDP(endpoint);
    connected = {endpoint, browser};
    browser.on('disconnected', () => {
        if (connected?.browser === browser) {
            connected = undefined;
        }
    });
    return browser;
}

function pickPage(browser: CdpBrowser, pageUrl: string): CdpPage | undefined {
    const pages = browser.contexts().flatMap((context) => context.pages());
    const exact = pages.find((page) => page.url() === pageUrl);
    if (exact) {
        return exact;
    }
    const key = webuiKey(pageUrl);
    if (!key) {
        return undefined;
    }
    const soft = pages.filter((page) => webuiKey(page.url()) === key);
    return soft.length === 1 ? soft[0] : undefined;
}

async function openCdpSession(endpoint: string, pageUrl: string): Promise<ScreencastSession | undefined> {
    const browser = await connect(endpoint);
    const page = pickPage(browser, pageUrl);
    if (!page) {
        return undefined;
    }
    const session = await page.context().newCDPSession(page);
    let onFrame: ((jpeg: Buffer) => void) | undefined;
    let stopped = false;
    session.on('Page.screencastFrame', (event) => {
        session.send('Page.screencastFrameAck', {sessionId: event.sessionId}).catch(() => undefined);
        if (!event.data || !onFrame) {
            return;
        }
        onFrame(Buffer.from(event.data, 'base64'));
    });
    return {
        start: async (cb) => {
            onFrame = cb;
            await session.send('Page.startScreencast', {
                format: 'jpeg',
                quality: 60,
                maxWidth: 1280,
                maxHeight: 720,
                everyNthFrame: 2,
            });
        },
        stop: async () => {
            onFrame = undefined;
            if (stopped) {
                return;
            }
            stopped = true;
            await session.send('Page.stopScreencast').catch(() => undefined);
        },
        close: async () => {
            onFrame = undefined;
            if (!stopped) {
                stopped = true;
                await session.send('Page.stopScreencast').catch(() => undefined);
            }
            await session.detach().catch(() => undefined);
        },
    };
}

class CanvasEncoder implements ClipEncoder {
    private win: BrowserWindow | undefined;
    private closed = false;
    private pending = 0;
    private chain: Promise<void> = Promise.resolve();
    private readonly ready: Promise<void>;

    constructor() {
        this.ready = this.open();
    }

    push(jpeg: Buffer): void {
        if (this.closed || this.pending >= 4 || !jpeg.length) {
            return;
        }
        this.pending += 1;
        const payload = JSON.stringify(jpeg.toString('base64'));
        this.chain = this.chain.then(async () => {
            try {
                await this.ready;
                if (this.closed || !this.win || this.win.isDestroyed()) {
                    return;
                }
                await this.win.webContents.executeJavaScript(`window.recFrame(${payload})`);
            } finally {
                this.pending -= 1;
            }
        }).then(() => undefined, () => undefined);
    }

    async finish(): Promise<Buffer> {
        try {
            await this.ready;
            await this.chain;
            if (this.closed || !this.win || this.win.isDestroyed()) {
                return Buffer.alloc(0);
            }
            const data = await this.win.webContents.executeJavaScript('window.recStop()');
            return typeof data === 'string' && data ? Buffer.from(data, 'base64') : Buffer.alloc(0);
        } finally {
            this.destroy();
        }
    }

    async cancel(): Promise<void> {
        this.destroy();
    }

    private destroy(): void {
        this.closed = true;
        const win = this.win;
        this.win = undefined;
        if (win && !win.isDestroyed()) {
            win.destroy();
        }
    }

    private async open(): Promise<void> {
        const win = new BrowserWindow({
            show: false,
            focusable: false,
            skipTaskbar: true,
            paintWhenInitiallyHidden: true,
            width: 1280,
            height: 720,
            webPreferences: {
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
                backgroundThrottling: false,
            },
        });
        this.win = win;
        win.webContents.setBackgroundThrottling(false);
        if (this.closed) {
            this.destroy();
            return;
        }
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(ENCODER_HTML)}`);
        if (this.closed) {
            this.destroy();
        }
    }
}

function recordingsDir(): string {
    return path.join(app.getPath('userData'), 'page-recordings');
}

function clipFile(id: string): string | undefined {
    if (!CLIP_ID.test(id)) {
        return undefined;
    }
    return path.join(recordingsDir(), `${id}.webm`);
}

function saveClip(id: string, body: Buffer): {bytes: number} {
    const file = clipFile(id);
    if (!file) {
        throw new Error('bad id');
    }
    fs.mkdirSync(recordingsDir(), {recursive: true});
    fs.writeFileSync(file, body);
    return {bytes: body.length};
}

function readClip(id: string): Buffer | undefined {
    const file = clipFile(id);
    if (!file || !fs.existsSync(file)) {
        return undefined;
    }
    return fs.readFileSync(file);
}

const recorder = new PageRecorder({
    readPort: () => readCdpPort(),
    activeUrl: () => pageCompanion.webuiUrl(),
    openSession: (endpoint, pageUrl) => openCdpSession(endpoint, pageUrl),
    openEncoder: () => new CanvasEncoder(),
    save: saveClip,
    read: readClip,
    now: () => Date.now(),
    schedule: (ms, fn) => {
        const timer = setTimeout(() => {
            Promise.resolve(fn()).catch(() => undefined);
        }, ms);
        return {cancel: () => clearTimeout(timer)};
    },
});

export async function shutdownPageRecorder(): Promise<void> {
    await recorder.handle({op: 'stop'}).catch(() => undefined);
}

export default recorder;
