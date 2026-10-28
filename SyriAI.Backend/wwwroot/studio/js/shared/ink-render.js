// SyriAI Studio — drawing of strokes and effects, shared by the admin studio and the
// presenter screen so both show exactly the same thing.
//
// A stroke is { tool, color, size, hue, pts: [{ x, y }] } with points normalised to the canvas
// (0..1) and size as a fraction of the canvas width.

const StudioInkRender = (() => {
    function tracePath(ctx, pts) {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        if (pts.length === 1) {
            ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
            return;
        }
        for (let i = 1; i < pts.length - 1; i++) {
            ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last[0], last[1]);
    }

    function drawStroke(ctx, stroke, w, h, alpha = 1) {
        const pts = stroke.pts.map(p => [p.x * w, p.y * h]);
        const lw = Math.max(1.5, stroke.size * w);
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = alpha;
        switch (stroke.tool) {
            case 'eraser':
                ctx.globalCompositeOperation = 'destination-out';
                ctx.lineWidth = lw * 4;
                tracePath(ctx, pts);
                ctx.stroke();
                break;
            case 'highlighter':
                ctx.globalAlpha = alpha * 0.35;
                ctx.strokeStyle = stroke.color;
                ctx.lineWidth = lw * 4;
                tracePath(ctx, pts);
                ctx.stroke();
                break;
            case 'rainbow':
                ctx.lineWidth = lw * 1.3;
                for (let i = 1; i < pts.length; i++) {
                    ctx.strokeStyle = `hsl(${(stroke.hue + i * 4) % 360} 95% 60%)`;
                    ctx.beginPath();
                    ctx.moveTo(pts[i - 1][0], pts[i - 1][1]);
                    ctx.lineTo(pts[i][0], pts[i][1]);
                    ctx.stroke();
                }
                break;
            case 'neon':
            case 'laser':
            case 'sparkle':
                // Coloured glow with a bright core
                tracePath(ctx, pts);
                ctx.shadowColor = stroke.color;
                ctx.shadowBlur = lw * 3;
                ctx.strokeStyle = stroke.color;
                ctx.lineWidth = lw;
                ctx.stroke();
                ctx.shadowBlur = 0;
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
                ctx.lineWidth = Math.max(1, lw * 0.35);
                ctx.stroke();
                break;
            default:
                ctx.strokeStyle = stroke.color;
                ctx.lineWidth = lw;
                tracePath(ctx, pts);
                ctx.stroke();
        }
        ctx.restore();
    }

    /** Darken everything except a soft circle of light at (x, y) */
    function drawSpotlight(ctx, x, y, radius, w, h) {
        ctx.save();
        ctx.fillStyle = 'rgba(2, 4, 12, 0.78)';
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'destination-out';
        const g = ctx.createRadialGradient(x, y, radius * 0.75, x, y, radius);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.stroke();
    }

    function drawStar(ctx, x, y, r) {
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
            const rad = i % 2 ? r * 0.35 : r;
            const a = (i * Math.PI) / 4;
            ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
        }
        ctx.closePath();
        ctx.fill();
    }

    /** Add three sparkles at (x, y) in canvas pixels */
    function emitSparkles(particles, x, y, color) {
        for (let i = 0; i < 3; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 20 + Math.random() * 90;
            particles.push({
                x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                life: 0, max: 0.5 + Math.random() * 0.6, size: 2 + Math.random() * 4,
                color: Math.random() < 0.5 ? '#fff7c2' : color,
            });
        }
    }

    /** Move and draw the sparkles; removes the ones that have faded */
    function stepParticles(ctx, particles, dt) {
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.life += dt;
            if (p.life >= p.max) { particles.splice(i, 1); continue; }
            p.vy += 40 * dt;
            p.vx *= 0.985;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            ctx.globalAlpha = 1 - p.life / p.max;
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 8;
            drawStar(ctx, p.x, p.y, p.size);
        }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
    }

    /** Emoji that float up from the bottom of a layer (the 👍 reaction) */
    function floatEmojis(layer, emoji) {
        for (let i = 0; i < 7; i++) {
            const el = document.createElement('span');
            el.className = 'fx-float';
            el.textContent = emoji;
            el.style.left = `${10 + Math.random() * 80}%`;
            el.style.animationDelay = `${i * 90}ms`;
            el.style.fontSize = `${34 + Math.random() * 30}px`;
            el.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`);
            el.style.setProperty('--rise', `${layer.clientHeight * (0.6 + Math.random() * 0.4)}px`);
            el.addEventListener('animationend', () => el.remove());
            layer.appendChild(el);
        }
    }

    return { drawStroke, drawSpotlight, emitSparkles, stepParticles, floatEmojis };
})();
