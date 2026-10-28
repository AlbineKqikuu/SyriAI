// SyriAI Studio — writing on the prompter / document: tools, colours, size, undo and the
// floating toolbar. The hand (camera.js) and the mouse both draw through AdminInk.
//
// Strokes are kept (normalised 0..1 to the drawing canvas) so the drawing survives a
// resize and can be undone. Every stroke is also sent to the presenter screen and the
// YouTube output (ink_begin / ink_point / ink_end / ink_sync), which draw it with the same
// StudioInkRender code, so they show exactly what the studio shows.

const AdminInk = (() => {
    const COLORS = ['#ff3b30', '#22d3ee', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#ffffff', '#111827'];
    const LASER_COLOR = '#ff2d55';
    const LASER_FADE_MS = 1200;
    const PREFS_KEY = 'syriai-ink-v2';

    const bar = document.getElementById('ink-bar');

    // Defaults match the original hand drawing: red pen, 6 px
    // hand: finger control ("Gisht"), on unless the user switched it off
    const state = { tool: 'pen', color: '#ff3b30', size: 6, mouse: false, hand: true };
    try { Object.assign(state, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch { /* storage unavailable */ }
    const savePrefs = () => {
        try { localStorage.setItem(PREFS_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
    };

    let strokes = [];
    let cleared = null;      // strokes removed by the last clear (undo brings them back)
    const lasers = [];
    let active = null;
    let activeSource = null; // 'hand' | 'mouse'
    let smooth = null;       // smoothed hand position
    let animating = false;

    // ---------- Rendering (js/shared/ink-render.js) ----------
    const drawStroke = StudioInkRender.drawStroke;
    let nextStrokeId = 1;
    const strokeIdPrefix = Math.random().toString(36).slice(2, 7);

    function redraw() {
        const w = adminDrawGlass.width;
        const h = adminDrawGlass.height;
        adminDrawCtx.clearRect(0, 0, w, h);
        if (!w || !h) return;
        strokes.forEach(s => drawStroke(adminDrawCtx, s, w, h));

        const now = performance.now();
        for (let i = lasers.length - 1; i >= 0; i--) {
            const alpha = lasers[i].endedAt ? 1 - (now - lasers[i].endedAt) / LASER_FADE_MS : 1;
            if (alpha <= 0) lasers.splice(i, 1);
            else drawStroke(adminDrawCtx, lasers[i], w, h, alpha);
        }
        if (lasers.length) animate();
    }

    // Lasers fade out, so they need redraws while any is on screen
    function animate() {
        if (animating) return;
        animating = true;
        requestAnimationFrame(() => {
            animating = false;
            redraw();
        });
    }

    // ---------- Strokes ----------
    /** Stroke data the other screens need to draw it the same way */
    const strokeShape = (s) => ({ tool: s.tool, color: s.color, size: s.size, hue: s.hue, pts: s.pts });

    function begin(nx, ny, source) {
        if (active || state.tool === 'spotlight') return;
        const stroke = {
            tool: state.tool,
            color: state.tool === 'laser' ? LASER_COLOR : state.color,
            size: state.size / Math.max(1, adminDrawGlass.width),
            hue: Math.random() * 360,
            pts: [{ x: nx, y: ny }],
        };
        stroke.id = `${strokeIdPrefix}-${nextStrokeId++}`;
        active = stroke;
        activeSource = source;
        broadcastUpdate('ink_begin', { id: stroke.id, tool: stroke.tool, color: stroke.color, size: stroke.size, hue: stroke.hue, x: nx, y: ny });
        smooth = { x: nx, y: ny };
        if (stroke.tool === 'laser') {
            lasers.push(stroke);
        } else {
            strokes.push(stroke);
            cleared = null;
        }
        updateButtons();
        redraw();
    }

    function extend(nx, ny) {
        if (!active) return;
        if (activeSource === 'hand') {
            // The finger shakes a little: follow it smoothly, faster when it moves fast
            const a = Math.min(1, 0.35 + Math.hypot(nx - smooth.x, ny - smooth.y) * 8);
            smooth.x += (nx - smooth.x) * a;
            smooth.y += (ny - smooth.y) * a;
            nx = smooth.x;
            ny = smooth.y;
        }
        const last = active.pts[active.pts.length - 1];
        if (Math.hypot((nx - last.x) * adminDrawGlass.width, (ny - last.y) * adminDrawGlass.height) < 1.5) return;
        const point = { x: nx, y: ny };
        active.pts.push(point);
        broadcastUpdate('ink_point', { id: active.id, x: nx, y: ny });
        if (active.tool === 'sparkle') emitSparkles(nx, ny, active.color);
        redraw();
    }

    // ---------- Effects layer: spotlight and sparkles (same look as the Board page) ----------
    const fxCanvas = document.createElement('canvas');
    fxCanvas.className = 'overlay-canvas overlay-canvas--fx';
    adminDrawGlass.after(fxCanvas);
    const fxCtx = fxCanvas.getContext('2d');
    const particles = [];
    const spot = { nx: 0, ny: 0, visible: false, source: null };
    let fxRunning = false;
    let lastFxFrame = 0;

    const spotRadius = () => 70 + state.size * 7;

    /** Spotlight position (normalised); source 'hand' wins over 'mouse' */
    function pointAt(nx, ny, source = 'hand') {
        if (source === 'mouse' && spot.visible && spot.source === 'hand') return;
        Object.assign(spot, { nx, ny, visible: true, source });
        startFx();
    }

    function hidePointer(source) {
        if (source && spot.source !== source) return;
        spot.visible = false;
        startFx();
    }

    function emitSparkles(nx, ny, color) {
        StudioInkRender.emitSparkles(particles, nx * fxCanvas.width, ny * fxCanvas.height, color);
        startFx();
    }

    function startFx() {
        if (fxRunning) return;
        fxRunning = true;
        lastFxFrame = performance.now();
        requestAnimationFrame(fxFrame);
    }

    function fxFrame(now) {
        if (fxCanvas.width !== fxCanvas.clientWidth || fxCanvas.height !== fxCanvas.clientHeight) {
            fxCanvas.width = fxCanvas.clientWidth;
            fxCanvas.height = fxCanvas.clientHeight;
        }
        const w = fxCanvas.width;
        const h = fxCanvas.height;
        const dt = Math.min(0.05, (now - lastFxFrame) / 1000);
        lastFxFrame = now;
        fxCtx.clearRect(0, 0, w, h);

        // Spotlight: darken everything except a circle around the finger
        const spotOn = state.tool === 'spotlight' && spot.visible;
        if (spotOn) StudioInkRender.drawSpotlight(fxCtx, spot.nx * w, spot.ny * h, spotRadius(), w, h);

        // Sparkles fly off the line and fade
        StudioInkRender.stepParticles(fxCtx, particles, dt);

        if (spotOn || particles.length) requestAnimationFrame(fxFrame);
        else fxRunning = false;
    }

    // With mouse control ("Maus") on, the spotlight follows the mouse, also on client screens
    const area = adminDrawGlass.parentElement;
    let lastMouseSync = 0;
    area.addEventListener('pointermove', (e) => {
        if (state.tool !== 'spotlight' || !state.mouse) return;
        const r = area.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width;
        const ny = (e.clientY - r.top) / r.height;
        pointAt(nx, ny, 'mouse');
        const now = performance.now();
        if (spot.source === 'mouse' && now - lastMouseSync > 30) {
            lastMouseSync = now;
            broadcastUpdate('cursor_pos', { nx, ny, visible: true, spot: spotRadius() / Math.max(1, fxCanvas.width) });
        }
    });
    area.addEventListener('pointerleave', () => {
        if (spot.source !== 'mouse') return;
        hidePointer('mouse');
        broadcastUpdate('cursor_pos', { visible: false });
    });

    /** End the current stroke; with a source, only a stroke drawn by that source */
    function end(source) {
        if (!active || (source && source !== activeSource)) return;
        if (active.tool === 'laser') {
            active.endedAt = performance.now();
            animate();
        }
        broadcastUpdate('ink_end', { id: active.id });
        active = null;
        activeSource = null;
    }

    /** Send the whole drawing again (after undo, or when a screen connects) */
    function resyncClient() {
        broadcastUpdate('ink_sync', { strokes: strokes.map(strokeShape) });
    }

    function undo() {
        end();
        if (!strokes.length && cleared) {
            strokes = cleared;
            cleared = null;
        } else if (strokes.length) {
            strokes.pop();
        } else {
            return;
        }
        redraw();
        resyncClient();
        updateButtons();
    }

    /** broadcast = false when the clear came from a client screen */
    function clear(broadcast = true) {
        end();
        lasers.length = 0;
        if (strokes.length) cleared = strokes;
        strokes = [];
        redraw();
        if (broadcast) broadcastUpdate('clear_draw', true);
        updateButtons();
    }

    /** Markings from a client screen */
    function addRemoteSegment({ x1, y1, x2, y2, color }) {
        strokes.push({ tool: 'pen', color: color || '#34c759', size: 6 / Math.max(1, adminDrawGlass.width), hue: 0, pts: [{ x: x1, y: y1 }, { x: x2, y: y2 }] });
        redraw();
        updateButtons();
    }

    // ---------- Mouse / pen ----------
    function pointerPos(e) {
        const r = adminDrawGlass.getBoundingClientRect();
        return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
    }

    adminDrawGlass.addEventListener('pointerdown', (e) => {
        if (!state.mouse) return;
        adminDrawGlass.setPointerCapture(e.pointerId);
        begin(...pointerPos(e), 'mouse');
    });
    adminDrawGlass.addEventListener('pointermove', (e) => {
        if (!state.mouse || activeSource !== 'mouse') return;
        (e.getCoalescedEvents ? e.getCoalescedEvents() : [e]).forEach(ev => extend(...pointerPos(ev)));
    });
    ['pointerup', 'pointercancel'].forEach(t => adminDrawGlass.addEventListener(t, () => end('mouse')));
    // Scrolling the document or script still works while the mouse draws
    adminDrawGlass.addEventListener('wheel', (e) => {
        const target = pdfViewMain.style.display !== 'none' ? pdfViewMain : scrollContainer;
        target.scrollBy({ top: e.deltaY, left: e.deltaX });
    }, { passive: true });

    // ---------- Toolbar ----------
    const undoBtn = bar.querySelector('[data-ink="undo"]');
    const mouseBtn = bar.querySelector('[data-ink="mouse"]');
    const handBtn = bar.querySelector('[data-ink="hand"]');
    const sizeInput = bar.querySelector('[data-ink="size"]');
    const sizeDot = bar.querySelector('.ink-size-dot');
    const colorsRow = bar.querySelector('.ink-colors');

    function updateButtons() {
        undoBtn.disabled = !strokes.length && !cleared;
    }

    let lastDrawingTool = 'pen';

    function setTool(tool) {
        state.tool = tool;
        if (tool !== 'spotlight') lastDrawingTool = tool;
        startFx(); // shows or removes the spotlight
        // Toolbar buttons use is-on, the "Dritë" effect button in the side panel uses active
        document.querySelectorAll('.ink-bar [data-tool], .studio-btn[data-tool]').forEach(b => {
            const on = b.dataset.tool === tool;
            b.classList.toggle('is-on', on);
            b.classList.toggle('active', on && b.classList.contains('studio-btn'));
            b.setAttribute('aria-pressed', String(on));
        });
        savePrefs();
    }

    /** Side-panel button: spotlight on, or back to the last pen */
    function toggleSpotlight() {
        setTool(state.tool === 'spotlight' ? lastDrawingTool : 'spotlight');
        notify(state.tool === 'spotlight'
            ? "Prozhektori u ndez — ekrani errësohet dhe ndriçohet vetëm rrethi te gishti ☝️."
            : "Prozhektori u fik — gishti tregues shkruan përsëri.", 'info', 3000);
    }

    function setColor(color) {
        state.color = color;
        colorsRow.querySelectorAll('.ink-swatch').forEach(s => s.classList.toggle('is-on', s.dataset.color === color));
        sizeDot.style.setProperty('--c', color);
        savePrefs();
    }

    function setSize(size) {
        state.size = size;
        sizeInput.value = size;
        sizeDot.style.setProperty('--d', `${Math.min(22, size)}px`);
        savePrefs();
    }

    function setMouse(on) {
        state.mouse = on;
        if (!on) hidePointer('mouse');
        mouseBtn.setAttribute('aria-pressed', String(on));
        adminDrawGlass.classList.toggle('is-mouse-draw', on);
        savePrefs();
    }

    /** Mirrors the header's hand-drawing button (isDrawMode lives in core.js) */
    function syncHandButton() {
        handBtn.setAttribute('aria-pressed', String(isDrawMode));
        if (isDrawMode) bar.hidden = false;
        state.hand = isDrawMode;
        savePrefs();
    }

    COLORS.forEach(color => {
        const sw = document.createElement('button');
        sw.className = 'ink-swatch';
        sw.dataset.color = color;
        sw.style.setProperty('--c', color);
        sw.title = color;
        sw.setAttribute('aria-label', color);
        sw.addEventListener('click', () => setColor(color));
        colorsRow.appendChild(sw);
    });
    bar.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
    document.getElementById('spotlight-fx-btn').addEventListener('click', toggleSpotlight);
    sizeInput.addEventListener('input', () => setSize(Number(sizeInput.value)));
    mouseBtn.addEventListener('click', () => setMouse(!state.mouse));
    handBtn.addEventListener('click', () => drawModeBtn.click());
    // camera.js toggles isDrawMode in its own click handler, so read it afterwards
    drawModeBtn.addEventListener('click', () => setTimeout(syncHandButton));
    undoBtn.addEventListener('click', undo);
    bar.querySelector('[data-ink="clear"]').addEventListener('click', () => clear(true));

    document.addEventListener('keydown', (e) => {
        if (e.target.matches('input, textarea, select, [contenteditable]')) return;
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            undo();
        }
    });

    /** Show the toolbar and turn hand writing on, e.g. right after a file is opened */
    function show() {
        bar.hidden = false;
        if (state.hand && !isDrawMode) drawModeBtn.click();
    }

    // The spotlight never comes back on by itself: the page always opens with a pen
    if (state.tool === 'spotlight' || state.tool === 'pointer') state.tool = 'pen';
    lastDrawingTool = state.tool;
    setTool(state.tool);
    setColor(COLORS.includes(state.color) ? state.color : COLORS[0]);
    setSize(state.size);
    setMouse(state.mouse);
    // Finger control is on from the start (quietly, without the toolbar or a notice)
    if (state.hand && !isDrawMode) {
        isDrawMode = true;
        drawModeBtn.classList.add('active');
    }
    handBtn.setAttribute('aria-pressed', String(isDrawMode));
    updateButtons();

    return {
        begin, extend, end, undo, clear, redraw, show, addRemoteSegment, pointAt, hidePointer,
        /** Send the current drawing to a screen that just connected */
        syncScreens: resyncClient,
        get color() { return state.tool === 'laser' ? LASER_COLOR : state.tool === 'eraser' ? '#ffffff' : state.color; },
        get drawing() { return !!active; },
        /** Spotlight tool: the finger lights up a circle and does not write */
        get spotlight() { return state.tool === 'spotlight'; },
        /** Spotlight radius as a fraction of the drawing width (for client screens) */
        get spotRadius() { return spotRadius() / Math.max(1, fxCanvas.width || adminDrawGlass.width); },
    };
})();
