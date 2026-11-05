// Unit tests for the camera model guard (errors skip frames, failing models restart). Run: npm test
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createModelGuard } = require('../SyriAI.Backend/wwwroot/studio/js/shared/model-guard.js');

console.warn = () => { }; // the guard logs every skipped frame

function fakeModel(state) {
    return {
        async send() { if (state.failing) throw new Error('boom'); state.frames++; },
        close() { state.closed++; },
    };
}

test('an error only skips the frame', async () => {
    const state = { failing: true, frames: 0, closed: 0 };
    const guard = createModelGuard('m', () => fakeModel(state));
    assert.equal(await guard.send({}), false);
    state.failing = false;
    assert.equal(await guard.send({}), true);
    assert.equal(state.closed, 0);
});

test('a model that keeps failing is recreated, then switched off after repeated restarts', async (t) => {
    let now = 0;
    t.mock.method(performance, 'now', () => now);
    const state = { failing: true, frames: 0, closed: 0 };
    let created = 0;
    const events = [];
    const guard = createModelGuard('m', () => { created++; return fakeModel(state); }, (e) => events.push(e));

    const failFrames = async (n) => { for (let i = 0; i < n; i++) { await guard.send({}); now += 4000; } };
    await failFrames(8);
    assert.equal(created, 2);
    assert.deepEqual(events, ['restarted']);

    // Recovered after the restart
    state.failing = false;
    now += 4000;
    assert.equal(await guard.send({}), true);

    // Three restarts within five minutes, then off
    state.failing = true;
    await failFrames(8 * 3);
    assert.deepEqual(events, ['restarted', 'restarted', 'restarted', 'off']);
    assert.equal(guard.off, true);
    state.failing = false;
    assert.equal(await guard.send({}), false);
});

test('frames are skipped during the pause after a restart', async (t) => {
    let now = 0;
    t.mock.method(performance, 'now', () => now);
    const state = { failing: true, frames: 0, closed: 0 };
    const guard = createModelGuard('m', () => fakeModel(state));
    for (let i = 0; i < 8; i++) await guard.send({});
    state.failing = false;
    assert.equal(await guard.send({}), false); // still in the 3 s pause
    now += 3001;
    assert.equal(await guard.send({}), true);
});

test('a model that never answers does not freeze the camera loop', async () => {
    const guard = createModelGuard('m', () => ({ send: () => new Promise(() => { }), close() { } }));
    const started = Date.now();
    assert.equal(await guard.send({}), false);
    assert.ok(Date.now() - started < 4000, 'gave up on the stuck frame');
});
