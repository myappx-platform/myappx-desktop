// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {randomUUID} from 'crypto';

export const RECORD_LIMIT_MS = 90_000;
const WATCH_MS = 1000;

const CLIP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RecordReport = {
    ok: boolean;
    kind: 'record';
    recording?: boolean;
    id?: string;
    startedAt?: number;
    durationMs?: number;
    bytes?: number;
    error?: string;
    mime?: string;
    data?: string;
};

export type PageRecordRequest = {
    op: string;
    id?: string;
};

export type ScreencastSession = {
    start: (onFrame: (jpeg: Buffer) => void) => Promise<void>;
    stop: () => Promise<void>;
    close: () => Promise<void>;
};

export type ClipEncoder = {
    push: (jpeg: Buffer) => void;
    finish: () => Promise<Buffer>;
    cancel: () => Promise<void>;
};

export type RecorderDeps = {
    readPort: () => string | undefined;
    activeUrl: () => string | undefined;
    openSession: (endpoint: string, pageUrl: string) => Promise<ScreencastSession | undefined>;
    openEncoder: () => ClipEncoder;
    save: (id: string, body: Buffer) => {bytes: number};
    read: (id: string) => Buffer | undefined;
    now: () => number;
    schedule: (ms: number, fn: () => Promise<unknown> | undefined) => {cancel: () => void};
};

type Live = {
    session: ScreencastSession;
    encoder: ClipEncoder;
    startedAt: number;
};

function fail(error: string): RecordReport {
    return {ok: false, kind: 'record', error};
}

function isWebui(url: string | undefined): url is string {
    return Boolean(url && url.toLowerCase().includes('/webui'));
}

/**
 * One page clip at a time. Frames come from a CDP screencast; the encoder
 * turns them into a WebM file. A second start while one is open is refused.
 */
export class PageRecorder {
    private live: Live | undefined;
    private starting = false;
    private generation = 0;
    private finishing: Promise<RecordReport> | undefined;
    private ready: RecordReport | undefined;
    private limit: {cancel: () => void} | undefined;
    private watch: {cancel: () => void} | undefined;
    private readonly deps: RecorderDeps;

    constructor(deps: RecorderDeps) {
        this.deps = deps;
    }

    handle(action: PageRecordRequest): Promise<RecordReport> {
        switch (action.op) {
        case 'start':
            return this.start();
        case 'stop':
            return this.stop();
        case 'status':
            return Promise.resolve(this.status());
        case 'read':
            return Promise.resolve(this.readClip(action.id));
        default:
            return Promise.resolve(fail('idle'));
        }
    }

    private status(): RecordReport {
        if (this.live || this.starting || this.finishing) {
            return {ok: true, kind: 'record', recording: true, startedAt: this.live?.startedAt};
        }
        if (this.ready) {
            return {...this.ready, recording: false};
        }
        return {ok: true, kind: 'record', recording: false};
    }

    private async start(): Promise<RecordReport> {
        if (this.live || this.starting || this.finishing) {
            return fail('busy');
        }
        const port = this.deps.readPort();
        if (!port) {
            return fail('no-cdp');
        }
        const url = this.deps.activeUrl();
        if (!isWebui(url)) {
            return fail('not-webui');
        }
        this.starting = true;
        const generation = this.generation;
        const encoder = this.deps.openEncoder();
        let session: ScreencastSession | undefined;
        try {
            session = await this.deps.openSession(`http://127.0.0.1:${port}`, url);
            if (generation !== this.generation) {
                await session?.close();
                await encoder.cancel();
                return this.ready ?? fail('idle');
            }
            if (!session) {
                await encoder.cancel();
                return fail('not-webui');
            }
            const startedAt = this.deps.now();
            this.live = {session, encoder, startedAt};
            this.ready = undefined;
            await session.start((jpeg) => this.onFrame(jpeg));
            if (generation !== this.generation || !this.live) {
                if (this.finishing) {
                    return this.finishing;
                }
                return this.ready ?? fail('idle');
            }
            this.armTimers();
            return {ok: true, kind: 'record', recording: true, startedAt};
        } catch {
            const live = this.live;
            this.live = undefined;
            if (live) {
                await live.session.close().catch(() => undefined);
                await live.encoder.cancel().catch(() => undefined);
            } else {
                await session?.close().catch(() => undefined);
                await encoder.cancel().catch(() => undefined);
            }
            return fail('no-cdp');
        } finally {
            this.starting = false;
        }
    }

    private stop(): Promise<RecordReport> {
        if (this.live || this.starting) {
            return this.finish();
        }
        if (this.finishing) {
            return this.finishing;
        }
        if (this.ready) {
            return Promise.resolve({...this.ready, recording: false});
        }
        return Promise.resolve(fail('idle'));
    }

    private onFrame = (jpeg: Buffer): void => {
        if (!this.live || !jpeg.length) {
            return;
        }
        if (!isWebui(this.deps.activeUrl())) {
            this.finish().catch(() => undefined);
            return;
        }
        this.live.encoder.push(jpeg);
    };

    private armTimers(): void {
        this.limit?.cancel();
        this.watch?.cancel();
        this.limit = this.deps.schedule(RECORD_LIMIT_MS, () => this.finish());
        this.armWatch();
    }

    private armWatch(): void {
        this.watch = this.deps.schedule(WATCH_MS, () => {
            if (!this.live) {
                return undefined;
            }
            if (!isWebui(this.deps.activeUrl())) {
                return this.finish();
            }
            this.armWatch();
            return undefined;
        });
    }

    private finish(): Promise<RecordReport> {
        if (this.finishing) {
            return this.finishing;
        }
        this.finishing = this.finishOnce().finally(() => {
            this.finishing = undefined;
        });
        return this.finishing;
    }

    private async finishOnce(): Promise<RecordReport> {
        this.generation += 1;
        const live = this.live;
        this.live = undefined;
        this.limit?.cancel();
        this.watch?.cancel();
        this.limit = undefined;
        this.watch = undefined;
        if (!live) {
            return this.ready ?? fail('idle');
        }
        try {
            await live.session.stop();
        } catch {
            // Keep whatever frames were already encoded.
        }
        try {
            await live.session.close();
        } catch {
            // The session may already be detached.
        }
        let body = Buffer.alloc(0);
        try {
            body = await live.encoder.finish();
        } catch {
            await live.encoder.cancel().catch(() => undefined);
            return fail('encode-failed');
        }
        if (!body.length) {
            return fail('encode-failed');
        }
        const id = randomUUID();
        let bytes = body.length;
        try {
            bytes = this.deps.save(id, body).bytes;
        } catch {
            return fail('encode-failed');
        }
        const durationMs = Math.max(0, this.deps.now() - live.startedAt);
        this.ready = {
            ok: true,
            kind: 'record',
            recording: false,
            id,
            startedAt: live.startedAt,
            durationMs,
            bytes,
        };
        return {...this.ready};
    }

    private readClip(id: string | undefined): RecordReport {
        if (!id || !CLIP_ID.test(id)) {
            return fail('missing');
        }
        const body = this.deps.read(id);
        if (!body?.length) {
            return fail('missing');
        }
        return {
            ok: true,
            kind: 'record',
            id,
            bytes: body.length,
            mime: 'video/webm',
            data: body.toString('base64'),
        };
    }
}
