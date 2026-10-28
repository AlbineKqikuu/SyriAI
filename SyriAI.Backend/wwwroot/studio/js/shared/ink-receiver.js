// SyriAI Studio — shows the studio's writing on another screen: the presenter screen and the
// YouTube output. Every pen, glow, rainbow, laser, sparkle, the eraser, undo, the spotlight and
// the 👍 reactions look exactly as in the studio (drawn with StudioInkRender).
//
// Messages from the studio: ink_begin, ink_point, ink_end, ink_sync, clear_draw,
// cursor_pos (spotlight), reaction. draw_segment comes from a presenter screen's own hand.

class StudioInkReceiver {
    static LASER_FADE_MS = 1200;

    /** container: the element the studio's drawing area corresponds to */
    constructor(container) {
        this.container = container;
        if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

        this.ink = this.#layer('canvas', 5000);
        this.fx = this.#layer('canvas', 5050);
        this.reactions = this.#layer('div', 5150);
        this.reactions.style.overflow = 'hidden';
        this.inkCtx = this.ink.getContext('2d');
        this.fxCtx = this.fx.getContext('2d');

        this.strokes = [];
        this.live = new Map();   // strokes being drawn, by id
        this.lasers = [];
        this.particles = [];
        this.spot = null;        // { nx, ny, r } while the studio's spotlight is on
        this.fxRunning = false;
        this.redrawQueued = false;

        new ResizeObserver(() => this.#resize()).observe(container);
        this.#resize();
    }

    /** Handle a studio message; returns true when it was a drawing message */
    handle(type, data) {
        switch (type) {
            case 'ink_begin': {
                const stroke = { tool: data.tool, color: data.color, size: data.size, hue: data.hue, pts: [{ x: data.x, y: data.y }] };
                this.live.set(data.id, stroke);
                if (stroke.tool === 'laser') this.lasers.push(stroke);
                else this.strokes.push(stroke);
                this.#changed(stroke);
                return true;
            }
            case 'ink_point': {
                const stroke = this.live.get(data.id);
                if (!stroke) return true;
                stroke.pts.push({ x: data.x, y: data.y });
                if (stroke.tool === 'sparkle') {
                    StudioInkRender.emitSparkles(this.particles, data.x * this.fx.width, data.y * this.fx.height, stroke.color);
                }
                this.#changed(stroke);
                return true;
            }
            case 'ink_end': {
                const stroke = this.live.get(data.id);
                if (stroke?.tool === 'laser') stroke.endedAt = performance.now();
                this.live.delete(data.id);
                this.#startFx();
                return true;
            }
            case 'ink_sync':
                this.strokes = (data.strokes || []).map(s => ({ ...s, pts: [...s.pts] }));
                this.live.clear();
                this.#queueRedraw();
                return true;
            case 'clear_draw':
                this.strokes = [];
                this.lasers = [];
                this.live.clear();
                this.#queueRedraw();
                return true;
            case 'draw_segment':
                this.strokes.push({ tool: 'pen', color: data.color || '#ff3b30', size: 6 / Math.max(1, this.ink.width), hue: 0, pts: [{ x: data.x1, y: data.y1 }, { x: data.x2, y: data.y2 }] });
                this.#queueRedraw();
                return true;
            case 'cursor_pos':
                this.spot = data.visible && data.spot ? { nx: data.nx, ny: data.ny, r: data.spot } : null;
                this.#startFx();
                return false; // the page may still draw its own pointer dot
            case 'reaction':
                StudioInkRender.floatEmojis(this.reactions, data.emoji);
                return true;
        }
        return false;
    }

    #layer(tag, z) {
        const el = document.createElement(tag);
        Object.assign(el.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: String(z) });
        this.container.appendChild(el);
        return el;
    }

    #resize() {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (!w || !h || (this.ink.width === w && this.ink.height === h)) return;
        this.ink.width = this.fx.width = w;
        this.ink.height = this.fx.height = h;
        this.#queueRedraw();
        this.#startFx();
    }

    /** Lasers live on the effects layer; everything else on the ink layer */
    #changed(stroke) {
        if (stroke.tool === 'laser') this.#startFx();
        else this.#queueRedraw();
    }

    #queueRedraw() {
        if (this.redrawQueued) return;
        this.redrawQueued = true;
        requestAnimationFrame(() => {
            this.redrawQueued = false;
            const { width: w, height: h } = this.ink;
            this.inkCtx.clearRect(0, 0, w, h);
            this.strokes.forEach(s => StudioInkRender.drawStroke(this.inkCtx, s, w, h));
        });
    }

    #startFx() {
        if (this.fxRunning) return;
        this.fxRunning = true;
        let last = performance.now();
        const frame = (now) => {
            const { width: w, height: h } = this.fx;
            const ctx = this.fxCtx;
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            ctx.clearRect(0, 0, w, h);

            for (let i = this.lasers.length - 1; i >= 0; i--) {
                const laser = this.lasers[i];
                const alpha = laser.endedAt ? 1 - (now - laser.endedAt) / StudioInkReceiver.LASER_FADE_MS : 1;
                if (alpha <= 0) this.lasers.splice(i, 1);
                else StudioInkRender.drawStroke(ctx, laser, w, h, alpha);
            }
            if (this.spot) StudioInkRender.drawSpotlight(ctx, this.spot.nx * w, this.spot.ny * h, this.spot.r * w, w, h);
            StudioInkRender.stepParticles(ctx, this.particles, dt);

            if (this.lasers.length || this.particles.length || this.spot) requestAnimationFrame(frame);
            else this.fxRunning = false;
        };
        requestAnimationFrame(frame);
    }
}
