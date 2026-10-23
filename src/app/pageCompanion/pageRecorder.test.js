// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {PageRecorder, RECORD_LIMIT_MS} from 'app/pageCompanion/pageRecorder';
import {ipcValidate, pageRecordSchema} from 'common/Validator';

const CLIP = '123e4567-e89b-12d3-a456-426614174000';

function harness(overrides = {}) {
    const saved = new Map();
    const scheduled = [];
    let url = 'https://localhost/webui/';
    let now = 1_000;
    let opens = 0;
    const frames = [];
    const session = {
        start: async (cb) => {
            session.onFrame = cb;
        },
        stop: async () => {},
        close: async () => {},
        onFrame: undefined,
    };
    const encoder = {
        pushed: frames,
        push: (jpeg) => frames.push(jpeg),
        finish: async () => Buffer.from('webm'),
        cancel: async () => {},
    };
    const recorder = new PageRecorder({
        readPort: () => '9333',
        activeUrl: () => url,
        openSession: async () => {
            opens += 1;
            return session;
        },
        openEncoder: () => encoder,
        save: (id, body) => {
            saved.set(id, body);
            return {bytes: body.length};
        },
        read: (id) => saved.get(id),
        now: () => now,
        schedule: (ms, fn) => {
            const item = {ms, fn, cancelled: false};
            scheduled.push(item);
            return {cancel: () => {
                item.cancelled = true;
            }};
        },
        ...overrides,
    });
    return {
        recorder,
        saved,
        scheduled,
        session,
        encoder,
        frames,
        setUrl: (next) => {
            url = next;
        },
        setNow: (next) => {
            now = next;
        },
        opens: () => opens,
    };
}

describe('page recorder', () => {
    it('rejects a record request with an unknown op', () => {
        const handler = jest.fn();
        const wrapped = ipcValidate(handler, [pageRecordSchema]);
        wrapped({sender: {id: 1}}, {op: 'evaluate'});
        expect(handler).not.toHaveBeenCalled();
        expect(pageRecordSchema.validate({op: 'start'}).error).toBeUndefined();
        expect(pageRecordSchema.validate({op: 'stop'}).error).toBeUndefined();
        expect(pageRecordSchema.validate({op: 'status'}).error).toBeUndefined();
        expect(pageRecordSchema.validate({op: 'read', id: CLIP}).error).toBeUndefined();
        expect(pageRecordSchema.validate({op: 'start', id: CLIP}).error).toBeDefined();
        expect(pageRecordSchema.validate({op: 'read'}).error).toBeDefined();
        expect(pageRecordSchema.validate({op: 'read', id: '../clip'}).error).toBeDefined();
        expect(pageRecordSchema.validate({op: 'script'}).error).toBeDefined();
    });

    it('records frames, then refuses a second start', async () => {
        const {recorder, session, frames, saved, setNow} = harness();
        const started = await recorder.handle({op: 'start'});
        expect(started.ok).toBe(true);
        expect(started.recording).toBe(true);
        session.onFrame(Buffer.from([1, 2, 3]));
        expect(frames).toHaveLength(1);
        const again = await recorder.handle({op: 'start'});
        expect(again).toEqual({ok: false, kind: 'record', error: 'busy'});
        setNow(4_000);
        const stopped = await recorder.handle({op: 'stop'});
        expect(stopped.ok).toBe(true);
        expect(stopped.recording).toBe(false);
        expect(stopped.durationMs).toBe(3_000);
        expect(stopped.bytes).toBe(4);
        expect(saved.get(stopped.id).toString()).toBe('webm');
        const read = await recorder.handle({op: 'read', id: stopped.id});
        expect(read.ok).toBe(true);
        expect(read.mime).toBe('video/webm');
        expect(Buffer.from(read.data, 'base64').toString()).toBe('webm');
        const secondStop = await recorder.handle({op: 'stop'});
        expect(secondStop.id).toBe(stopped.id);
    });

    it('refuses a start that overlaps one still connecting', async () => {
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        const session = {start: async () => {}, stop: async () => {}, close: async () => {}};
        let opens = 0;
        const recorder = new PageRecorder({
            readPort: () => '9333',
            activeUrl: () => 'https://localhost/webui/',
            openSession: () => {
                opens += 1;
                return gate.then(() => session);
            },
            openEncoder: () => ({push() {}, finish: async () => Buffer.from('webm'), cancel: async () => {}}),
            save: () => ({bytes: 1}),
            read: () => undefined,
            now: () => 1,
            schedule: () => ({cancel() {}}),
        });
        const first = recorder.handle({op: 'start'});
        const second = await recorder.handle({op: 'start'});
        expect(second.error).toBe('busy');
        expect(opens).toBe(1);
        release();
        await expect(first).resolves.toMatchObject({ok: true, recording: true});
    });

    it('stops at the time limit and when the page leaves webui', async () => {
        const {recorder, scheduled, saved} = harness();
        await recorder.handle({op: 'start'});
        const limit = scheduled.find((item) => item.ms === RECORD_LIMIT_MS);
        expect(limit).toBeDefined();
        await limit.fn();
        const status = await recorder.handle({op: 'status'});
        expect(status.recording).toBe(false);
        expect(status.id).toBeDefined();
        expect(saved.size).toBe(1);

        const again = harness();
        await again.recorder.handle({op: 'start'});
        again.setUrl('https://localhost/other');
        const watch = again.scheduled.find((item) => item.ms === 1000);
        await watch.fn();
        const left = await again.recorder.handle({op: 'status'});
        expect(left.recording).toBe(false);
        expect(left.id).toBeDefined();
        expect(again.saved.size).toBe(1);
    });

    it('does not open a session without a port or a webui page', async () => {
        const noPort = harness({readPort: () => undefined});
        await expect(noPort.recorder.handle({op: 'start'})).resolves.toMatchObject({ok: false, error: 'no-cdp'});
        expect(noPort.opens()).toBe(0);

        const other = harness();
        other.setUrl('https://localhost/downloads');
        await expect(other.recorder.handle({op: 'start'})).resolves.toMatchObject({ok: false, error: 'not-webui'});
        expect(other.opens()).toBe(0);
    });

    it('does not keep an empty encoding', async () => {
        const box = harness({
            openEncoder: () => ({
                push() {},
                finish: async () => Buffer.alloc(0),
                cancel: async () => {},
            }),
        });
        await box.recorder.handle({op: 'start'});
        const stopped = await box.recorder.handle({op: 'stop'});
        expect(stopped).toEqual({ok: false, kind: 'record', error: 'encode-failed'});
        expect(box.saved.size).toBe(0);
    });

    it('refuses to read a path outside the recordings directory', async () => {
        const {recorder} = harness();
        await expect(recorder.handle({op: 'read', id: '../page-recordings/x'})).resolves.toMatchObject({error: 'missing'});
    });
});
