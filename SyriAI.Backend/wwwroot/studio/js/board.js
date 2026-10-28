// SyriAI Board — camera on one side, any file on the other, and writing on the file with
// the index finger (MediaPipe Hands). Files stay in the browser (object URLs) and are
// never uploaded. Strokes are stored per file in document coordinates, so they stay on
// the right spot when a PDF or Word document is scrolled.

const $ = (id) => document.getElementById(id);

const camVideo = $('cam-video');
const camFrame = $('cam-frame');
const camCanvas = $('cam-canvas');
const camCtx = camCanvas.getContext('2d');
const camOverlay = $('cam-overlay');
const camOverlayCtx = camOverlay.getContext('2d');
const camState = $('cam-state');
const stage = $('stage');
const docsRoot = $('docs');
const inkCanvas = $('ink');
const inkCtx = inkCanvas.getContext('2d');
const fxCanvas = $('fx');
const fxCtx = fxCanvas.getContext('2d');
const workspace = $('workspace');
const fileInput = $('file-input');
const strip = $('strip');
const gestureChip = $('gesture-chip');
const handStatus = $('hand-status');

// ---------- Settings (remembered per browser) ----------
const PREFS_KEY = 'syriai-board';
const COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#ff3b5c', '#fbbf24', '#34d399', '#ffffff', '#111827'];
const LASER_COLOR = '#ff2d55';

const state = {
    tool: 'neon',
    color: '#22d3ee',
    size: 6,
    smoothing: 0.5,
    camFx: 'none',
    mirror: true,
    skeleton: true,
    vignette: false,
    handTracking: true,
    mouseDraw: true,
    layout: 'split',
    swapped: false,
};

const SAVED_PREFS = ['tool', 'color', 'size', 'smoothing', 'camFx', 'mirror', 'skeleton', 'vignette', 'layout', 'swapped'];
try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    SAVED_PREFS.forEach(k => { if (k in saved) state[k] = saved[k]; });
} catch { /* storage unavailable */ }

function savePrefs() {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(Object.fromEntries(SAVED_PREFS.map(k => [k, state[k]]))));
    } catch { /* storage unavailable */ }
}

// ---------- UI helpers ----------
function notify(message, type = 'info', duration = 3500) {
    const toast = document.createElement('div');
    toast.className = `bd-toast bd-toast--${type}`;
    toast.textContent = message;
    $('toast-stack').appendChild(toast);
    setTimeout(() => {
        toast.classList.add('is-leaving');
        setTimeout(() => toast.remove(), 250);
    }, duration);
}

function setPressed(btn, on) {
    btn.setAttribute('aria-pressed', String(on));
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

setInterval(() => {
    $('clock').textContent = new Date().toLocaleTimeString('sq-AL', { hour12: false });
}, 1000);

// =====================================================================
// Files
// =====================================================================

const KIND_LABELS = { board: 'TABELË', pdf: 'PDF', word: 'WORD', pptx: 'PPT', image: 'FOTO', video: 'VIDEO', audio: 'AUDIO', text: 'TEKST' };

const KINDS = [
    { kind: 'pdf', ext: ['.pdf'], mime: /^application\/pdf$/ },
    { kind: 'word', ext: ['.docx'], mime: /wordprocessingml/ },
    { kind: 'pptx', ext: ['.pptx'], mime: /presentationml/ },
    { kind: 'image', ext: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp'], mime: /^image\// },
    { kind: 'video', ext: ['.mp4', '.webm', '.mov', '.m4v'], mime: /^video\// },
    { kind: 'audio', ext: ['.mp3', '.wav', '.ogg', '.m4a', '.aac'], mime: /^audio\// },
    { kind: 'text', ext: ['.txt', '.md', '.csv', '.json'], mime: /^text\// },
];

function detectKind(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.doc') || name.endsWith('.ppt')) return 'legacy';
    const match = KINDS.find(k => k.ext.some(e => name.endsWith(e))) || KINDS.find(k => k.mime.test(file.type));
    return match ? match.kind : null;
}

/** Open files and whiteboards: { id, name, kind, url, root, strokes, redo } */
const items = [];
let activeItem = null;
let nextItemId = 1;
let boardCount = 0;

function createItem(name, kind, url = null) {
    const item = { id: nextItemId++, name, kind, url, strokes: [], redo: [] };
    item.root = document.createElement('div');
    item.root.className = `bd-doc bd-doc--${kind}`;
    item.root.hidden = true;
    item.root.addEventListener('scroll', () => { if (item === activeItem) inkDirty = true; }, { passive: true });
    docsRoot.appendChild(item.root);
    items.push(item);
    return item;
}

function addWhiteboard() {
    boardCount++;
    const item = createItem(boardCount === 1 ? 'Tabela e bardhë' : `Tabela ${boardCount}`, 'board');
    item.root.innerHTML = `
        <div class="bd-board-hint">
            <svg class="ic ic-xl"><use href="#b-hand" /></svg>
            <strong>Shkruaj me gishtin tregues</strong>
            <span>Ngrini vetëm gishtin tregues para kamerës. Për të shkruar mbi një foto ose dokument, ngarkojeni me butonin “Ngarko”.</span>
        </div>`;
    activate(item);
    renderStrip();
    return item;
}

/** serverUrl: the file is already stored on the server (/api/media/…) */
async function addFile(file, serverUrl = null) {
    const kind = detectKind(file);
    if (kind === 'legacy') {
        notify(`"${file.name}" është format i vjetër. Ruajeni si .docx, .pptx ose .pdf.`, 'warning', 6000);
        return;
    }
    if (!kind) {
        notify(`"${file.name}" nuk mbështetet.`, 'warning');
        return;
    }

    const item = createItem(file.name, kind, URL.createObjectURL(file));
    item.serverUrl = serverUrl;
    item.root.innerHTML = '<div class="bd-loading"><span class="bd-spinner"></span>Duke hapur…</div>';
    activate(item);
    renderStrip();

    try {
        await renderItem(item, file);
    } catch (err) {
        console.error(err);
        item.root.innerHTML = '';
        const error = document.createElement('div');
        error.className = 'bd-error';
        error.textContent = `Skedari nuk u hap: ${err.message || err}`;
        item.root.appendChild(error);
        notify(`"${file.name}" nuk u hap.`, 'error');
    }
    inkDirty = true;
    if (!serverUrl) uploadToServer(item, file);
}

// ---------- Keeping files between pages ----------
// Board files are also stored on the studio server (/api/media), so they open again after a
// reload, and the file last uploaded in the Studio opens here without uploading it twice.
const OPEN_FILES_KEY = 'syriai-board-files';     // [{ url, name }]
const STUDIO_MEDIA_KEY = 'syriai-studio-media';  // { url, name }, written by the Studio

function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

function rememberOpenFiles() {
    writeJson(OPEN_FILES_KEY, items.filter(it => it.serverUrl).map(it => ({ url: it.serverUrl, name: it.name })));
}

async function uploadToServer(item, file) {
    const form = new FormData();
    form.append('file', file);
    try {
        const response = await fetch('/api/media', { method: 'POST', body: form, credentials: 'same-origin' });
        if (!response.ok) return; // e.g. a type the server does not store: works until a reload
        item.serverUrl = (await response.json()).url;
        if (items.includes(item)) rememberOpenFiles();
    } catch { /* no backend: the file still works on this page */ }
}

async function openFromServer({ url, name }) {
    const open = items.find(it => it.serverUrl === url);
    if (open) {
        activate(open);
        return;
    }
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) return;
    const blob = await response.blob();
    await addFile(new File([blob], name, { type: blob.type }), url);
}

async function restoreFiles() {
    const saved = readJson(OPEN_FILES_KEY, []);
    const studio = readJson(STUDIO_MEDIA_KEY, null);
    const fromStudio = studio?.url?.startsWith('/api/media/') ? studio : null;
    if (fromStudio && !saved.some(f => f.url === fromStudio.url)) notify(`Po hapet "${fromStudio.name}" nga Studio…`, 'info', 2500);

    for (const entry of saved) await openFromServer(entry).catch(console.error);
    // The Studio's file opens last, so it is the one on screen
    if (fromStudio) await openFromServer(fromStudio).catch(console.error);
    rememberOpenFiles(); // forget files that no longer exist on the server
}

async function renderItem(item, file) {
    switch (item.kind) {
        case 'pdf': {
            const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
            StudioDocuments.renderLazyPdf(pdf, item.root, { scale: 2, rootMargin: '800px 0px', placeholderHeight: '900px', pageWidth: '' });
            break;
        }
        case 'word':
            await StudioDocuments.renderDocx(await file.arrayBuffer(), item.root);
            break;
        case 'pptx':
            await StudioDocuments.renderPptx(await file.arrayBuffer(), item.root);
            break;
        case 'image':
            StudioDocuments.renderImage(item.url, item.root);
            break;
        case 'video':
            StudioDocuments.renderVideo(item.url, item.root);
            break;
        case 'audio':
            renderAudio(item);
            break;
        case 'text': {
            item.root.innerHTML = '';
            const pre = document.createElement('pre');
            pre.className = 'bd-text';
            pre.textContent = await file.text();
            item.root.appendChild(pre);
            break;
        }
    }
}

function renderAudio(item) {
    item.root.innerHTML = `
        <div class="bd-audio">
            <div class="bd-audio-bars">${'<i></i>'.repeat(14)}</div>
            <div class="bd-audio-name"></div>
            <audio controls src=""></audio>
        </div>`;
    const wrap = item.root.querySelector('.bd-audio');
    const audio = wrap.querySelector('audio');
    wrap.querySelector('.bd-audio-name').textContent = item.name;
    audio.src = item.url;
    audio.addEventListener('play', () => wrap.classList.add('is-playing'));
    audio.addEventListener('pause', () => wrap.classList.remove('is-playing'));
}

function activate(item) {
    if (activeItem && activeItem !== item) {
        activeItem.root.querySelectorAll('video, audio').forEach(m => m.pause());
        endStroke();
    }
    activeItem = item;
    items.forEach(it => { it.root.hidden = it !== item; });
    // Without an open file the stage shows the upload screen (whiteboard is an option there)
    $('empty').hidden = !!item;
    $('quickbar').hidden = !item;
    $('doc-title').textContent = item ? item.name : 'Ngarko një skedar';
    const kindTag = $('doc-kind');
    kindTag.hidden = !item;
    if (item) {
        kindTag.textContent = KIND_LABELS[item.kind];
        kindTag.dataset.kind = item.kind;
    }
    lasers.length = 0;
    inkDirty = true;
    renderStrip();
    updateHistoryButtons();
}

function closeItem(item) {
    const index = items.indexOf(item);
    if (index < 0) return;
    item.root.querySelectorAll('video, audio').forEach(m => m.pause());
    item.root.remove();
    if (item.url) URL.revokeObjectURL(item.url);
    items.splice(index, 1);
    rememberOpenFiles();
    // A closed Studio file should not come back on the next visit
    if (item.serverUrl && readJson(STUDIO_MEDIA_KEY, null)?.url === item.serverUrl) {
        try { localStorage.removeItem(STUDIO_MEDIA_KEY); } catch { /* storage unavailable */ }
    }
    if (!items.length) activate(null);
    else if (item === activeItem) activate(items[Math.min(index, items.length - 1)]);
    else renderStrip();
}

function renderStrip() {
    strip.innerHTML = '';
    items.forEach(item => {
        const chip = document.createElement('div');
        chip.className = `bd-file${item === activeItem ? ' is-active' : ''}`;
        chip.setAttribute('role', 'tab');
        chip.setAttribute('aria-selected', String(item === activeItem));
        chip.tabIndex = 0;
        chip.title = item.name;
        chip.innerHTML = `
            <span class="bd-kind" data-kind="${item.kind}">${KIND_LABELS[item.kind]}</span>
            <span class="bd-file-name"></span>
            ${item.strokes.length ? '<span class="bd-file-ink" title="Ka shkrime"></span>' : ''}
            <button class="bd-file-close" aria-label="Mbyll"><svg class="ic"><use href="#b-close" /></svg></button>`;
        chip.querySelector('.bd-file-name').textContent = item.name;
        chip.addEventListener('click', () => activate(item));
        chip.addEventListener('keydown', (e) => { if (e.key === 'Enter') activate(item); });
        chip.querySelector('.bd-file-close').addEventListener('click', (e) => {
            e.stopPropagation();
            closeItem(item);
        });
        strip.appendChild(chip);
    });
    strip.querySelector('.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

async function addFiles(fileList) {
    for (const file of fileList) await addFile(file);
}

$('upload-btn').addEventListener('click', () => fileInput.click());
$('new-board-btn').addEventListener('click', addWhiteboard);
$('empty-upload-btn').addEventListener('click', () => fileInput.click());
$('empty-board-btn').addEventListener('click', addWhiteboard);
fileInput.addEventListener('change', () => {
    addFiles([...fileInput.files]);
    fileInput.value = '';
});

// Drag & drop anywhere on the page. Without this a file dropped outside the file panel
// would be opened by the browser in place of the board.
let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    $('drop-hint').hidden = false;
    stage.classList.add('is-dragover');
});
window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth > 0) return;
    $('drop-hint').hidden = true;
    stage.classList.remove('is-dragover');
});
window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $('drop-hint').hidden = true;
    stage.classList.remove('is-dragover');
    if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]);
});

// Paste an image or file (Cmd/Ctrl+V)
document.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
        e.preventDefault();
        addFiles(files);
    }
});

// =====================================================================
// Ink: strokes, rendering, undo/redo
// =====================================================================

// Points are stored as fractions of the stage width; y also includes the scroll offset.
// Screen position: x = p.x · w, y = p.y · w − scrollTop.
let inkDirty = true;
let activeStroke = null;
let strokeSource = null;    // 'hand' | 'mouse'
const lasers = [];      // fading laser strokes (not saved)
const particles = [];   // sparkles, confetti, dissolve
let dpr = window.devicePixelRatio || 1;

function stageView() {
    return { w: stage.clientWidth, h: stage.clientHeight, top: activeItem ? activeItem.root.scrollTop : 0 };
}

function toDoc(x, y) {
    const { w, top } = stageView();
    return { x: x / w, y: (y + top) / w };
}

function resizeStageCanvases() {
    dpr = window.devicePixelRatio || 1;
    [inkCanvas, fxCanvas].forEach(c => {
        c.width = Math.round(stage.clientWidth * dpr);
        c.height = Math.round(stage.clientHeight * dpr);
    });
    inkDirty = true;
}
new ResizeObserver(resizeStageCanvases).observe(stage);

function beginStroke(x, y, source) {
    if (!activeItem || state.tool === 'spotlight' || activeStroke) return;
    const { w } = stageView();
    const stroke = {
        tool: state.tool,
        color: state.tool === 'laser' ? LASER_COLOR : state.color,
        size: state.size / w,
        hue: Math.random() * 360,
        pts: [toDoc(x, y)],
    };
    activeStroke = stroke;
    strokeSource = source;
    if (stroke.tool === 'laser') {
        lasers.push(stroke);
    } else {
        activeItem.strokes.push(stroke);
        activeItem.redo.length = 0;
        if (activeItem.strokes.length === 1) renderStrip();
        fadeBoardHint();
        updateHistoryButtons();
    }
    inkDirty = true;
}

function extendStroke(x, y) {
    if (!activeStroke) return;
    const p = toDoc(x, y);
    const last = activeStroke.pts[activeStroke.pts.length - 1];
    const { w } = stageView();
    if (Math.hypot((p.x - last.x) * w, (p.y - last.y) * w) < 1.5) return;
    activeStroke.pts.push(p);
    if (activeStroke.tool === 'sparkle') emitSparkles(x, y, activeStroke.color);
    inkDirty = true;
}

/** Ends the current stroke; with a source, only a stroke drawn by that source */
function endStroke(source) {
    if (!activeStroke || (source && source !== strokeSource)) return;
    if (activeStroke.tool === 'laser') activeStroke.endedAt = performance.now();
    activeStroke = null;
}

function fadeBoardHint() {
    activeItem?.root.querySelector('.bd-board-hint')?.classList.add('is-faded');
}

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

function drawStroke(ctx, stroke, w, top, alpha = 1) {
    const pts = stroke.pts.map(p => [p.x * w, p.y * w - top]);
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
                ctx.strokeStyle = `hsl(${(stroke.hue + i * 4) % 360} 95% 62%)`;
                ctx.beginPath();
                ctx.moveTo(pts[i - 1][0], pts[i - 1][1]);
                ctx.lineTo(pts[i][0], pts[i][1]);
                ctx.stroke();
            }
            if (pts.length === 1) {
                ctx.fillStyle = `hsl(${stroke.hue} 95% 62%)`;
                ctx.beginPath();
                ctx.arc(pts[0][0], pts[0][1], lw * 0.65, 0, Math.PI * 2);
                ctx.fill();
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
            ctx.shadowBlur = lw;
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

function renderInk() {
    const { w, h, top } = stageView();
    inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    inkCtx.clearRect(0, 0, w, h);
    if (!activeItem) return;
    for (const stroke of activeItem.strokes) drawStroke(inkCtx, stroke, w, top);
}

function undo() {
    if (!activeItem?.strokes.length) return;
    endStroke();
    activeItem.redo.push(activeItem.strokes.pop());
    inkDirty = true;
    updateHistoryButtons();
    if (!activeItem.strokes.length) renderStrip();
}

function redo() {
    if (!activeItem?.redo.length) return;
    activeItem.strokes.push(activeItem.redo.pop());
    inkDirty = true;
    updateHistoryButtons();
    if (activeItem.strokes.length === 1) renderStrip();
}

/** Clear with a "dissolve" effect: the ink breaks into particles */
function clearInk() {
    if (!activeItem) return;
    endStroke();
    lasers.length = 0;
    if (!activeItem.strokes.length) return;
    const { w, top } = stageView();
    const visible = activeItem.strokes.filter(s => s.tool !== 'eraser');
    const allPoints = visible.flatMap(s => s.pts.map(p => ({ p, color: s.tool === 'rainbow' ? `hsl(${Math.random() * 360} 95% 62%)` : s.color })));
    const step = Math.max(1, Math.floor(allPoints.length / 260));
    for (let i = 0; i < allPoints.length; i += step) {
        const { p, color } = allPoints[i];
        const angle = Math.random() * Math.PI * 2;
        const speed = 40 + Math.random() * 160;
        particles.push({
            x: p.x * w, y: p.y * w - top, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 60,
            life: 0, max: 0.7 + Math.random() * 0.6, size: 2 + Math.random() * 3, color, gravity: 260, shape: 'dot',
        });
    }
    // Saved as one undo step, so a clear can be taken back
    activeItem.redo = [];
    activeItem.cleared = activeItem.strokes;
    activeItem.strokes = [];
    inkDirty = true;
    updateHistoryButtons();
    renderStrip();
}

function updateHistoryButtons() {
    $('undo-btn').disabled = $('q-undo').disabled = !activeItem?.strokes.length && !activeItem?.cleared;
    $('redo-btn').disabled = !activeItem?.redo.length;
}

$('undo-btn').addEventListener('click', () => {
    // Undo right after a clear brings the whole drawing back
    if (activeItem && !activeItem.strokes.length && activeItem.cleared) {
        activeItem.strokes = activeItem.cleared;
        activeItem.cleared = null;
        inkDirty = true;
        updateHistoryButtons();
        renderStrip();
        return;
    }
    undo();
});
$('redo-btn').addEventListener('click', redo);
$('clear-btn').addEventListener('click', clearInk);

// Export the visible drawing (and the image/PDF page under it when possible) as PNG
$('export-btn').addEventListener('click', () => {
    if (!activeItem) return;
    const out = document.createElement('canvas');
    out.width = inkCanvas.width;
    out.height = inkCanvas.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#0d1020';
    ctx.fillRect(0, 0, out.width, out.height);
    // Canvases and images that are visible on the stage are copied underneath the ink
    const stageRect = stage.getBoundingClientRect();
    activeItem.root.querySelectorAll('canvas, img').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.bottom < stageRect.top || r.top > stageRect.bottom) return;
        try {
            ctx.drawImage(el, (r.left - stageRect.left) * dpr, (r.top - stageRect.top) * dpr, r.width * dpr, r.height * dpr);
        } catch { /* not drawable */ }
    });
    ctx.drawImage(inkCanvas, 0, 0);
    out.toBlob(blob => downloadBlob(blob, `syriai-shenime-${timestamp()}.png`));
    notify('Shkrimet u ruajtën si PNG.', 'success', 2200);
});

// =====================================================================
// Effects layer: lasers, particles, spotlight, finger cursor
// =====================================================================

const cursor = { x: 0, y: 0, visible: false, source: 'hand' };
let palmProgress = 0;
let lastFrame = performance.now();

function emitSparkles(x, y, color) {
    for (let i = 0; i < 3; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 20 + Math.random() * 90;
        particles.push({
            x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            life: 0, max: 0.5 + Math.random() * 0.6, size: 2 + Math.random() * 4,
            color: Math.random() < 0.5 ? '#fff7c2' : color, gravity: 40, shape: 'star',
        });
    }
}

function confetti() {
    const { w } = stageView();
    const colors = ['#22d3ee', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#ff3b5c'];
    for (let i = 0; i < 180; i++) {
        particles.push({
            x: w / 2 + (Math.random() - 0.5) * w * 0.3, y: -10,
            vx: (Math.random() - 0.5) * 700, vy: Math.random() * 300 + 50,
            life: 0, max: 2.2 + Math.random(), size: 5 + Math.random() * 6,
            color: colors[i % colors.length], gravity: 420, shape: 'rect',
            rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 12,
        });
    }
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

function renderFx(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const { w, h, top } = stageView();
    fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fxCtx.clearRect(0, 0, w, h);

    // Lasers fade out 1.2 s after the finger stops
    for (let i = lasers.length - 1; i >= 0; i--) {
        const laser = lasers[i];
        const alpha = laser.endedAt ? 1 - (now - laser.endedAt) / 1200 : 1;
        if (alpha <= 0) { lasers.splice(i, 1); continue; }
        drawStroke(fxCtx, laser, w, top, alpha);
    }

    // Spotlight: darken everything except a circle around the finger
    if (state.tool === 'spotlight' && cursor.visible) {
        const radius = 70 + state.size * 7;
        fxCtx.save();
        fxCtx.fillStyle = 'rgba(2, 4, 12, 0.78)';
        fxCtx.fillRect(0, 0, w, h);
        fxCtx.globalCompositeOperation = 'destination-out';
        const g = fxCtx.createRadialGradient(cursor.x, cursor.y, radius * 0.75, cursor.x, cursor.y, radius);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        fxCtx.fillStyle = g;
        fxCtx.beginPath();
        fxCtx.arc(cursor.x, cursor.y, radius, 0, Math.PI * 2);
        fxCtx.fill();
        fxCtx.restore();
        fxCtx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        fxCtx.lineWidth = 1.5;
        fxCtx.beginPath();
        fxCtx.arc(cursor.x, cursor.y, radius, 0, Math.PI * 2);
        fxCtx.stroke();
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;
        if (p.life >= p.max) { particles.splice(i, 1); continue; }
        p.vy += p.gravity * dt;
        p.vx *= 0.985;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const alpha = 1 - p.life / p.max;
        fxCtx.globalAlpha = alpha;
        fxCtx.fillStyle = p.color;
        if (p.shape === 'star') {
            fxCtx.shadowColor = p.color;
            fxCtx.shadowBlur = 8;
            drawStar(fxCtx, p.x, p.y, p.size);
            fxCtx.shadowBlur = 0;
        } else if (p.shape === 'rect') {
            p.rot += p.spin * dt;
            fxCtx.save();
            fxCtx.translate(p.x, p.y);
            fxCtx.rotate(p.rot);
            fxCtx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
            fxCtx.restore();
        } else {
            fxCtx.beginPath();
            fxCtx.arc(p.x, p.y, p.size * alpha + 0.5, 0, Math.PI * 2);
            fxCtx.fill();
        }
    }
    fxCtx.globalAlpha = 1;

    if (cursor.visible && cursor.source === 'hand') drawFingerCursor();
}

function drawFingerCursor() {
    const { x, y } = cursor;
    const color = state.tool === 'laser' ? LASER_COLOR : state.tool === 'eraser' ? '#ffffff' : state.color;
    fxCtx.save();
    if (gesture === 'palm') {
        // Hold-to-clear progress ring
        fxCtx.strokeStyle = 'rgba(255,255,255,0.2)';
        fxCtx.lineWidth = 5;
        fxCtx.beginPath();
        fxCtx.arc(x, y, 28, 0, Math.PI * 2);
        fxCtx.stroke();
        fxCtx.strokeStyle = '#ff3b5c';
        fxCtx.shadowColor = '#ff3b5c';
        fxCtx.shadowBlur = 14;
        fxCtx.beginPath();
        fxCtx.arc(x, y, 28, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, palmProgress));
        fxCtx.stroke();
    } else if (gesture === 'draw') {
        const r = state.tool === 'eraser' ? state.size * 2 : Math.max(4, state.size / 2 + 3);
        fxCtx.fillStyle = color;
        fxCtx.shadowColor = color;
        fxCtx.shadowBlur = 16;
        fxCtx.beginPath();
        fxCtx.arc(x, y, r, 0, Math.PI * 2);
        if (state.tool === 'eraser') {
            fxCtx.strokeStyle = '#fff';
            fxCtx.lineWidth = 2;
            fxCtx.stroke();
        } else {
            fxCtx.fill();
        }
    } else if (gesture === 'scroll') {
        fxCtx.strokeStyle = '#a78bfa';
        fxCtx.fillStyle = '#a78bfa';
        fxCtx.lineWidth = 3;
        fxCtx.shadowColor = '#a78bfa';
        fxCtx.shadowBlur = 12;
        fxCtx.beginPath();
        fxCtx.arc(x, y, 18, 0, Math.PI * 2);
        fxCtx.stroke();
        [[-1], [1]].forEach(([dir]) => {
            fxCtx.beginPath();
            fxCtx.moveTo(x - 7, y + dir * 26);
            fxCtx.lineTo(x + 7, y + dir * 26);
            fxCtx.lineTo(x, y + dir * 34);
            fxCtx.fill();
        });
    } else {
        // Pointer: hollow ring, ink is not written
        fxCtx.strokeStyle = gesture === 'point' ? color : 'rgba(255,255,255,0.55)';
        fxCtx.lineWidth = 2.5;
        fxCtx.shadowColor = color;
        fxCtx.shadowBlur = gesture === 'point' ? 14 : 0;
        fxCtx.beginPath();
        fxCtx.arc(x, y, 14, 0, Math.PI * 2);
        fxCtx.stroke();
        fxCtx.beginPath();
        fxCtx.arc(x, y, 3, 0, Math.PI * 2);
        fxCtx.fillStyle = fxCtx.strokeStyle;
        fxCtx.fill();
    }
    fxCtx.restore();
}

// Floating emoji reactions
function react(emoji) {
    if (emoji === 'confetti') {
        confetti();
        return;
    }
    const layer = $('reactions');
    for (let i = 0; i < 7; i++) {
        const el = document.createElement('span');
        el.className = 'bd-float';
        el.textContent = emoji;
        el.style.left = `${10 + Math.random() * 80}%`;
        el.style.animationDelay = `${i * 90}ms`;
        el.style.fontSize = `${34 + Math.random() * 30}px`;
        el.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`);
        el.style.setProperty('--rise', `${stage.clientHeight * (0.6 + Math.random() * 0.4)}px`);
        el.addEventListener('animationend', () => el.remove());
        layer.appendChild(el);
    }
}
document.querySelectorAll('.bd-react').forEach(btn => btn.addEventListener('click', () => react(btn.dataset.emoji)));

// =====================================================================
// Mouse / pen / touch drawing (optional)
// =====================================================================

function stagePoint(e) {
    const r = stage.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
}

fxCanvas.addEventListener('pointerdown', (e) => {
    if (!state.mouseDraw) return;
    fxCanvas.setPointerCapture(e.pointerId);
    const [x, y] = stagePoint(e);
    beginStroke(x, y, 'mouse');
});
fxCanvas.addEventListener('pointermove', (e) => {
    if (!state.mouseDraw || strokeSource !== 'mouse' || !activeStroke) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    events.forEach(ev => extendStroke(...stagePoint(ev)));
});
['pointerup', 'pointercancel'].forEach(t => fxCanvas.addEventListener(t, () => endStroke('mouse')));
// Scrolling still works while the mouse is in drawing mode
fxCanvas.addEventListener('wheel', (e) => {
    if (activeItem) activeItem.root.scrollBy({ top: e.deltaY, left: e.deltaX });
}, { passive: true });

// The spotlight follows the mouse when no hand is in view
stage.addEventListener('pointermove', (e) => {
    if (state.tool !== 'spotlight' || (cursor.visible && cursor.source === 'hand')) return;
    [cursor.x, cursor.y] = stagePoint(e);
    cursor.visible = true;
    cursor.source = 'mouse';
});
stage.addEventListener('pointerleave', () => {
    if (cursor.source === 'mouse') cursor.visible = false;
});

// =====================================================================
// Hand tracking and gestures
// =====================================================================

// Part of the camera picture that maps onto the whole file panel, so the presenter
// does not have to reach the edges of the frame.
const HAND_ZONE = { x0: 0.12, x1: 0.88, y0: 0.08, y1: 0.72 };

const GESTURES = {
    none: 'Pa dorë',
    draw: '☝️ Shkruan',
    point: '✌️ Tregues',
    scroll: '🤟 Lëviz',
    palm: '✋ Pastro…',
    thumbs: '👍 Reagim',
    fist: '✊ Pushim',
    idle: '🖐 Gati',
};

let gesture = 'none';
let candidate = null;
let candidateFrames = 0;
let lostFrames = 0;
let palmStart = 0;
let palmFired = false;
let lastScrollY = null;
let lastThumbs = 0;
let handsReady = false;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** A finger is extended when its tip is clearly further from the wrist than its middle joint */
function fingerUp(lm, tip, pip) {
    return dist(lm[tip], lm[0]) > dist(lm[pip], lm[0]) * 1.12;
}

function classify(lm) {
    const index = fingerUp(lm, 8, 6);
    const middle = fingerUp(lm, 12, 10);
    const ring = fingerUp(lm, 16, 14);
    const pinky = fingerUp(lm, 20, 18);
    const up = index + middle + ring + pinky;

    if (up === 4) return 'palm';
    if (index && !middle && !ring && !pinky) return 'draw';
    if (index && middle && !ring && !pinky) return 'point';
    if (index && middle && ring && !pinky) return 'scroll';
    if (up === 0) {
        const thumbUp = lm[4].y < lm[3].y && lm[3].y < lm[2].y && lm[4].y < lm[5].y - 0.06;
        return thumbUp ? 'thumbs' : 'fist';
    }
    return 'idle';
}

/** Switch gesture only after it is seen on consecutive frames (leaving "draw" needs 3) */
function stabilize(g) {
    if (g === gesture) {
        candidate = null;
        return gesture;
    }
    if (g === candidate) candidateFrames++;
    else { candidate = g; candidateFrames = 1; }
    if (candidateFrames >= (gesture === 'draw' ? 3 : 2)) {
        gesture = g;
        candidate = null;
    }
    return gesture;
}

/** Adaptive smoothing: steady when the finger moves slowly, responsive when it moves fast */
function moveCursor(x, y) {
    if (!cursor.visible || cursor.source !== 'hand') {
        cursor.x = x;
        cursor.y = y;
        cursor.visible = true;
        cursor.source = 'hand';
        return;
    }
    const base = 1 - state.smoothing * 0.82;
    const a = Math.min(1, base + Math.hypot(x - cursor.x, y - cursor.y) / 140);
    cursor.x += (x - cursor.x) * a;
    cursor.y += (y - cursor.y) * a;
}

function setGestureUi(g) {
    gestureChip.textContent = GESTURES[g] || GESTURES.idle;
    gestureChip.dataset.g = g;
    document.querySelectorAll('.bd-gesture-strip span').forEach(s => s.classList.toggle('is-on', s.dataset.g === g));
}

function onHandResults(results) {
    if (!handsReady) {
        handsReady = true;
        setHandStatus('ready', 'Dora: gati');
    }
    const lm = results.multiHandLandmarks?.[0];
    drawSkeleton(lm);

    if (!lm) {
        // Short dropouts do not break the line
        if (++lostFrames > 4) handLost();
        return;
    }
    lostFrames = 0;

    const g = stabilize(classify(lm));
    const { w, h } = stageView();
    const tip = lm[8];
    const nx = clamp(((1 - tip.x) - HAND_ZONE.x0) / (HAND_ZONE.x1 - HAND_ZONE.x0), 0, 1);
    const ny = clamp((tip.y - HAND_ZONE.y0) / (HAND_ZONE.y1 - HAND_ZONE.y0), 0, 1);
    moveCursor(nx * w, ny * h);
    setGestureUi(g);
    setHandStatus(g === 'draw' ? 'active' : 'ready', g === 'draw' ? 'Dora: duke shkruar' : 'Dora: gati');

    const now = performance.now();
    if (g !== 'draw') endStroke('hand');
    if (g !== 'palm') { palmStart = 0; palmFired = false; palmProgress = 0; }
    if (g !== 'scroll') lastScrollY = null;

    switch (g) {
        case 'draw':
            if (!activeStroke) beginStroke(cursor.x, cursor.y, 'hand');
            else if (strokeSource === 'hand') extendStroke(cursor.x, cursor.y);
            break;
        case 'scroll':
            // Like dragging on a touch screen: moving the hand up scrolls the page up
            if (lastScrollY !== null && activeItem) activeItem.root.scrollTop += (lastScrollY - cursor.y) * 2.5;
            lastScrollY = cursor.y;
            break;
        case 'palm':
            if (!palmStart) palmStart = now;
            palmProgress = (now - palmStart) / 900;
            if (palmProgress >= 1 && !palmFired) {
                palmFired = true;
                clearInk();
            }
            break;
        case 'thumbs':
            if (now - lastThumbs > 1800) {
                lastThumbs = now;
                react('👍');
            }
            break;
    }
}

function handLost() {
    endStroke('hand');
    if (gesture === 'none' && cursor.source !== 'hand') return;
    gesture = 'none';
    candidate = null;
    palmStart = 0;
    lastScrollY = null;
    if (cursor.source === 'hand') cursor.visible = false;
    setGestureUi('none');
    if (handsReady && state.handTracking) setHandStatus('ready', 'Dora: gati');
}

function setHandStatus(s, text) {
    if (handStatus.dataset.state === s && $('hand-status-text').textContent === text) return;
    handStatus.dataset.state = s;
    $('hand-status-text').textContent = text;
}

function drawSkeleton(lm) {
    const W = camOverlay.width;
    const H = camOverlay.height;
    camOverlayCtx.clearRect(0, 0, W, H);
    if (!lm || !state.skeleton) return;

    const ctx = camOverlayCtx;
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#8b5cf6');
    grad.addColorStop(1, '#22d3ee');
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = grad;
    ctx.lineWidth = Math.max(2, W / 400);
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 12;
    for (const [a, b] of HAND_CONNECTIONS) {
        ctx.beginPath();
        ctx.moveTo(lm[a].x * W, lm[a].y * H);
        ctx.lineTo(lm[b].x * W, lm[b].y * H);
        ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    lm.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, i === 8 ? W / 110 : W / 280, 0, Math.PI * 2);
        ctx.fill();
    });
    // Index fingertip ring in the tool colour
    const tip = lm[8];
    ctx.strokeStyle = gesture === 'draw' ? state.color : 'rgba(255,255,255,0.7)';
    ctx.shadowColor = ctx.strokeStyle;
    ctx.lineWidth = Math.max(2, W / 320);
    ctx.beginPath();
    ctx.arc(tip.x * W, tip.y * H, W / 45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

// =====================================================================
// Camera and camera effects
// =====================================================================

const CAM_FX = {
    none: { label: 'Normale' },
    blur: { label: 'Turbullo', seg: true },
    studio: { label: 'Studio', seg: true },
    synth: { label: 'Synthwave', seg: true },
    aura: { label: 'Aura', seg: true },
    noir: { label: 'Noir', filter: 'grayscale(1) contrast(1.35) brightness(1.05)' },
    cinema: { label: 'Kinema', filter: 'contrast(1.12) saturate(1.3) sepia(0.12)', bars: true },
    cyber: { label: 'Cyber', filter: 'hue-rotate(-25deg) saturate(1.9) contrast(1.15)', scanlines: true },
    vintage: { label: 'Vintage', filter: 'sepia(0.6) contrast(0.95) brightness(1.05) saturate(0.85)', vignette: true },
};

const canvasFilterSupported = typeof camCtx.filter === 'string';
const personCanvas = document.createElement('canvas');
const personCtx = personCanvas.getContext('2d');
const smallCanvas = document.createElement('canvas');
const smallCtx = smallCanvas.getContext('2d');
let synthBackground = null;

const studioBg = new Image();
studioBg.src = 'news_bg.jpg';

let segmenter = null;
let segBusy = false;
let segReady = false;
let handsBusy = false;
let hands = null;

function initModels() {
    hands = new Hands({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${f}` });
    hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.5 });
    hands.onResults(onHandResults);

    segmenter = new SelfieSegmentation({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/${f}` });
    segmenter.setOptions({ modelSelection: 1 });
    segmenter.onResults((r) => {
        segReady = true;
        drawCamera(r.image, r.segmentationMask);
    });
}

async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
            audio: false,
        });
        camVideo.srcObject = stream;
        await camVideo.play();
    } catch (err) {
        console.error('Camera error:', err);
        camState.dataset.state = 'error';
        $('cam-state-text').textContent = 'Kamera nuk u hap. Lejoni kamerën në shfletues dhe rifreskoni faqen.';
        setHandStatus('error', 'Pa kamerë');
        return;
    }

    const W = camVideo.videoWidth || 1280;
    const H = camVideo.videoHeight || 720;
    [camCanvas, camOverlay, personCanvas].forEach(c => { c.width = W; c.height = H; });
    smallCanvas.width = Math.round(W / 14);
    smallCanvas.height = Math.round(H / 14);
    camState.hidden = true;

    try {
        initModels();
    } catch (err) {
        console.error('MediaPipe error:', err);
        setHandStatus('error', 'Dora: modeli mungon');
        notify('Modeli i dorës nuk u ngarkua. Kontrolloni internetin.', 'error', 6000);
    }
    requestAnimationFrame(frame);
}

function needsSegmentation() {
    return !!CAM_FX[state.camFx].seg;
}

/** Main loop: camera picture, AI models (each at its own pace), ink and effects */
function frame(now) {
    requestAnimationFrame(frame);

    if (camVideo.readyState >= 2) {
        if (needsSegmentation() && segmenter) {
            if (!segReady) drawCamera(camVideo, null);   // model still downloading
            if (!segBusy) {
                segBusy = true;
                segmenter.send({ image: camVideo }).catch(console.error).finally(() => { segBusy = false; });
            }
        } else {
            drawCamera(camVideo, null);
        }

        if (state.handTracking && hands && !handsBusy) {
            handsBusy = true;
            hands.send({ image: camVideo }).catch(console.error).finally(() => { handsBusy = false; });
        }
    }

    if (inkDirty) {
        inkDirty = false;
        renderInk();
    }
    renderFx(now);
}

function drawCover(ctx, img, W, H) {
    const scale = Math.max(W / img.width, H / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

function drawCamera(image, mask) {
    const W = camCanvas.width;
    const H = camCanvas.height;
    const fx = CAM_FX[state.camFx];
    const ctx = camCtx;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    if (fx.filter && canvasFilterSupported) ctx.filter = fx.filter;

    if (!fx.seg || !mask) {
        ctx.drawImage(image, 0, 0, W, H);
    } else {
        // Cut the presenter out with the segmentation mask
        personCtx.globalCompositeOperation = 'copy';
        personCtx.drawImage(mask, 0, 0, W, H);
        personCtx.globalCompositeOperation = 'source-in';
        personCtx.drawImage(image, 0, 0, W, H);
        personCtx.globalCompositeOperation = 'source-over';

        drawBackground(ctx, image, W, H);

        if (state.camFx === 'aura') {
            const hue = (performance.now() / 25) % 360;
            ctx.shadowColor = `hsl(${hue} 100% 62%)`;
            ctx.shadowBlur = W / 22;
            ctx.drawImage(personCanvas, 0, 0);
            ctx.shadowBlur = W / 60;
            ctx.shadowColor = `hsl(${(hue + 60) % 360} 100% 70%)`;
        }
        ctx.drawImage(personCanvas, 0, 0);
    }
    ctx.restore();

    if (fx.bars) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H * 0.1);
        ctx.fillRect(0, H * 0.9, W, H * 0.1);
    }
    if (fx.scanlines) drawScanlines(ctx, W, H);
    if (state.vignette || fx.vignette) drawVignette(ctx, W, H);
}

function drawBackground(ctx, image, W, H) {
    switch (state.camFx) {
        case 'blur':
            if (canvasFilterSupported) {
                ctx.filter = 'blur(18px)';
                ctx.drawImage(image, 0, 0, W, H);
                ctx.filter = 'none';
            } else {
                // Cheap blur: draw tiny, then scale back up with smoothing
                smallCtx.drawImage(image, 0, 0, smallCanvas.width, smallCanvas.height);
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(smallCanvas, 0, 0, W, H);
            }
            break;
        case 'studio':
            if (studioBg.complete && studioBg.naturalWidth) drawCover(ctx, studioBg, W, H);
            else { ctx.fillStyle = '#0b1b3a'; ctx.fillRect(0, 0, W, H); }
            break;
        case 'synth':
            ctx.drawImage(getSynthBackground(W, H), 0, 0);
            break;
        case 'aura':
            ctx.drawImage(image, 0, 0, W, H);
            ctx.fillStyle = 'rgba(4, 5, 18, 0.82)';
            ctx.fillRect(0, 0, W, H);
            break;
    }
}

/** Retro sunset with a neon grid, drawn once and reused */
function getSynthBackground(W, H) {
    if (synthBackground && synthBackground.width === W) return synthBackground;
    synthBackground = document.createElement('canvas');
    synthBackground.width = W;
    synthBackground.height = H;
    const ctx = synthBackground.getContext('2d');
    const horizon = H * 0.62;

    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#0f0529');
    sky.addColorStop(0.6, '#4c1d95');
    sky.addColorStop(1, '#db2777');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizon);

    const sun = ctx.createLinearGradient(0, horizon - H * 0.38, 0, horizon);
    sun.addColorStop(0, '#fde047');
    sun.addColorStop(1, '#f43f5e');
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(W / 2, horizon, H * 0.3, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#4c1d95';
    for (let i = 0; i < 6; i++) ctx.fillRect(0, horizon - H * 0.04 - i * H * 0.045, W, H * 0.008 + i * 0.6);

    ctx.fillStyle = '#12052e';
    ctx.fillRect(0, horizon, W, H - horizon);
    ctx.strokeStyle = 'rgba(244, 114, 182, 0.85)';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#f472b6';
    ctx.shadowBlur = 10;
    for (let i = -14; i <= 14; i++) {
        ctx.beginPath();
        ctx.moveTo(W / 2 + i * W * 0.02, horizon);
        ctx.lineTo(W / 2 + i * W * 0.14, H);
        ctx.stroke();
    }
    for (let i = 1; i < 10; i++) {
        const y = horizon + (H - horizon) * Math.pow(i / 10, 1.8);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
    }
    return synthBackground;
}

function drawScanlines(ctx, W, H) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1.5);
    // A slow bright band rolling down the picture
    const bandY = ((performance.now() / 8) % (H + 200)) - 100;
    const band = ctx.createLinearGradient(0, bandY - 60, 0, bandY + 60);
    band.addColorStop(0, 'rgba(34, 211, 238, 0)');
    band.addColorStop(0.5, 'rgba(34, 211, 238, 0.12)');
    band.addColorStop(1, 'rgba(34, 211, 238, 0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, bandY - 60, W, 120);
    ctx.restore();
}

function drawVignette(ctx, W, H) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.65);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
}

// --- Snapshot and recording of the processed camera ---
function timestamp() {
    return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

$('snapshot-btn').addEventListener('click', () => {
    if (!camCanvas.width) return;
    const flash = $('cam-flash');
    flash.classList.remove('is-on');
    void flash.offsetWidth;
    flash.classList.add('is-on');
    camCanvas.toBlob(blob => downloadBlob(blob, `syriai-foto-${timestamp()}.png`));
});

let recorder = null;
let recordTimer = null;

$('record-btn').addEventListener('click', async () => {
    const btn = $('record-btn');
    if (recorder) {
        recorder.stop();
        return;
    }
    if (!camCanvas.width || !window.MediaRecorder) {
        notify('Regjistrimi nuk mbështetet në këtë shfletues.', 'error');
        return;
    }
    const stream = camCanvas.captureStream(30);
    try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        mic.getAudioTracks().forEach(t => stream.addTrack(t));
    } catch {
        notify('Pa mikrofon — regjistrohet vetëm figura.', 'warning');
    }
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || '';
    const chunks = [];
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
        stream.getAudioTracks().forEach(t => t.stop());
        const type = recorder.mimeType || 'video/webm';
        downloadBlob(new Blob(chunks, { type }), `syriai-regjistrim-${timestamp()}.${type.includes('mp4') ? 'mp4' : 'webm'}`);
        recorder = null;
        clearInterval(recordTimer);
        btn.classList.remove('is-on');
        btn.querySelector('span').textContent = 'Regjistro';
        $('rec-pill').hidden = true;
        notify('Regjistrimi u ruajt.', 'success');
    };
    recorder.start(1000);
    const started = Date.now();
    btn.classList.add('is-on');
    btn.querySelector('span').textContent = 'Ndalo';
    $('rec-pill').hidden = false;
    $('rec-time').textContent = '0:00';
    recordTimer = setInterval(() => {
        const s = Math.floor((Date.now() - started) / 1000);
        $('rec-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 500);
});

// =====================================================================
// Controls
// =====================================================================

function applyTool(tool) {
    state.tool = tool;
    document.querySelectorAll('[data-tool]').forEach(b => {
        b.classList.toggle('is-on', b.dataset.tool === tool);
        b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    });
    if (tool !== 'spotlight' && cursor.source === 'mouse') cursor.visible = false;
    savePrefs();
}

function applyColor(color) {
    state.color = color;
    document.querySelectorAll('.bd-swatch[data-color]').forEach(s => s.classList.toggle('is-on', s.dataset.color === color));
    $('q-size-dot').style.setProperty('--c', color);
    savePrefs();
}

function applyCamFx(fx) {
    if (!CAM_FX[fx]) fx = 'none';
    state.camFx = fx;
    segReady = false;
    document.querySelectorAll('.bd-fx').forEach(b => b.classList.toggle('is-on', b.dataset.fx === fx));
    $('fx-chip').textContent = CAM_FX[fx].label;
    // Without canvas filters (older Safari) the colour look is applied to the element instead
    camCanvas.style.filter = !canvasFilterSupported && CAM_FX[fx].filter ? CAM_FX[fx].filter : '';
    savePrefs();
}

function applyLayout() {
    workspace.dataset.layout = state.layout;
    workspace.dataset.swapped = String(state.swapped);
    document.querySelectorAll('.bd-segmented [data-layout]').forEach(b => b.classList.toggle('is-on', b.dataset.layout === state.layout));
    savePrefs();
}

function bindToggle(id, key, onChange) {
    const btn = $(id);
    setPressed(btn, state[key]);
    btn.addEventListener('click', () => {
        state[key] = !state[key];
        setPressed(btn, state[key]);
        onChange?.(state[key]);
        savePrefs();
    });
}

// Colour swatches
// Same swatches in the side panel and in the quick toolbar over the file
const colorsRow = document.querySelector('.bd-colors');
function makeSwatch(color) {
    const sw = document.createElement('button');
    sw.className = 'bd-swatch';
    sw.dataset.color = color;
    sw.style.setProperty('--c', color);
    sw.setAttribute('aria-label', color);
    sw.addEventListener('click', () => applyColor(color));
    return sw;
}
COLORS.forEach(color => {
    colorsRow.insertBefore(makeSwatch(color), colorsRow.lastElementChild);
    $('q-colors').appendChild(makeSwatch(color));
});
$('custom-color').addEventListener('input', (e) => {
    const sw = e.target.closest('.bd-swatch');
    sw.style.setProperty('--c', e.target.value);
    sw.dataset.color = e.target.value;
    applyColor(e.target.value);
});

document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => applyTool(b.dataset.tool)));
$('q-undo').addEventListener('click', () => $('undo-btn').click());
$('q-clear').addEventListener('click', clearInk);
document.querySelectorAll('.bd-fx').forEach(b => b.addEventListener('click', () => applyCamFx(b.dataset.fx)));
document.querySelectorAll('.bd-segmented [data-layout]').forEach(b => b.addEventListener('click', () => {
    state.layout = b.dataset.layout;
    applyLayout();
}));
$('swap-btn').addEventListener('click', () => {
    state.swapped = !state.swapped;
    applyLayout();
});

// Line width: side panel slider and quick toolbar slider stay in sync
function applySize(size) {
    state.size = size;
    $('size-input').value = size;
    $('q-size').value = size;
    $('size-val').textContent = size;
    $('q-size-dot').style.setProperty('--d', `${Math.min(22, size)}px`);
    savePrefs();
}
['size-input', 'q-size'].forEach(id => $(id).addEventListener('input', (e) => applySize(Number(e.target.value))));
applySize(state.size);

const smoothInput = $('smooth-input');
smoothInput.value = Math.round(state.smoothing * 100);
$('smooth-val').textContent = `${smoothInput.value}%`;
smoothInput.addEventListener('input', () => {
    state.smoothing = Number(smoothInput.value) / 100;
    $('smooth-val').textContent = `${smoothInput.value}%`;
    savePrefs();
});

bindToggle('hand-toggle', 'handTracking', (on) => {
    if (!on) {
        handLost();
        drawSkeleton(null);
        setHandStatus('off', 'Dora: fikur');
    } else {
        setHandStatus(handsReady ? 'ready' : 'loading', handsReady ? 'Dora: gati' : 'Dora: duke u ngarkuar…');
    }
});
// Mouse drawing can be switched from the side panel and from the quick toolbar
function applyMouseDraw(on) {
    state.mouseDraw = on;
    setPressed($('mouse-toggle'), on);
    setPressed($('q-mouse'), on);
    stage.classList.toggle('is-mouse-draw', on);
}
$('mouse-toggle').addEventListener('click', () => applyMouseDraw(!state.mouseDraw));
$('q-mouse').addEventListener('click', () => applyMouseDraw(!state.mouseDraw));
bindToggle('skeleton-toggle', 'skeleton', (on) => { if (!on) drawSkeleton(null); });
bindToggle('vignette-toggle', 'vignette');
bindToggle('mirror-toggle', 'mirror', (on) => { camFrame.dataset.mirror = String(on); });
camFrame.dataset.mirror = String(state.mirror);

$('fullscreen-btn').addEventListener('click', toggleFullscreen);
function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else workspace.requestFullscreen?.().catch(() => notify('Ekrani i plotë nuk lejohet këtu.', 'warning'));
}

// Keyboard shortcuts (ignored while typing)
const TOOL_KEYS = { p: 'pen', n: 'neon', h: 'highlighter', r: 'rainbow', k: 'sparkle', l: 'laser', e: 'eraser', s: 'spotlight' };
document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else $('undo-btn').click();
        return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (TOOL_KEYS[key]) applyTool(TOOL_KEYS[key]);
    else if (key === 'c') clearInk();
    else if (key === 'f') toggleFullscreen();
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const i = items.indexOf(activeItem) + (e.key === 'ArrowRight' ? 1 : -1);
        if (items[i]) activate(items[i]);
    }
});

// ---------- Start ----------
applyTool(state.tool);
applyColor(state.color);
applyCamFx(state.camFx);
applyLayout();
applyMouseDraw(state.mouseDraw);
activate(null);
restoreFiles();
startCamera();
