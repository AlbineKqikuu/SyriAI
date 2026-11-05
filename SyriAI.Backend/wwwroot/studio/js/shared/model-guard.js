// SyriAI Studio — keeps a MediaPipe model (hands, face, background) from stopping the camera.
//
// An error only skips that frame, and so does a frame that takes too long (a model stuck in
// WebAssembly or after a graphics reset never answers, which would freeze the camera loop).
// When a model fails several frames in a row, it is closed and created again after a short pause.
// Only after a few such restarts in a short time is it switched off for good.

/**
 * @param {string} label name shown in messages
 * @param {() => object} create returns a new, configured MediaPipe model (with onResults set)
 * @param {(event: 'restarted'|'off', label: string) => void} [onEvent]
 */
function createModelGuard(label, create, onEvent = () => { }) {
    const FAILURES_BEFORE_RESTART = 8;
    const COOLDOWN_MS = 3000;
    const MAX_RESTARTS = 3;
    const RESTART_WINDOW_MS = 5 * 60 * 1000; // restarts older than this are forgiven
    const FRAME_TIMEOUT_MS = 2500;           // normal frames take well under 100 ms

    let model = create();
    let failures = 0;
    let restarts = [];
    let pausedUntil = 0;
    let off = false;

    return {
        get off() { return off; },

        /** Process one frame; resolves to true when the model produced results */
        async send(image) {
            if (off || performance.now() < pausedUntil) return false;
            let timer;
            try {
                await Promise.race([
                    model.send({ image }),
                    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('frame timed out')), FRAME_TIMEOUT_MS); }),
                ]);
                failures = 0;
                return true;
            } catch (err) {
                failures++;
                console.warn(`${label}: frame skipped`, err);
                if (failures < FAILURES_BEFORE_RESTART) return false;

                failures = 0;
                try { Promise.resolve(model.close?.()).catch(() => { }); } catch { /* already broken */ }
                const now = performance.now();
                restarts = restarts.filter(t => now - t < RESTART_WINDOW_MS);
                if (restarts.length >= MAX_RESTARTS) {
                    off = true;
                    onEvent('off', label);
                    return false;
                }
                restarts.push(now);
                pausedUntil = now + COOLDOWN_MS;
                model = create();
                onEvent('restarted', label);
                return false;
            } finally {
                clearTimeout(timer);
            }
        },
    };
}

if (typeof module === 'object' && module.exports) module.exports = { createModelGuard };
