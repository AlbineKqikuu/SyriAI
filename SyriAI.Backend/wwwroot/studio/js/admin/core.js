// SyriAI Studio — Shared DOM references, studio state and UI helpers (toasts, labels).

// Admin ⇄ client messages (SignalR, or BroadcastChannel without the backend)
const studioSync = new StudioSync();

function broadcastUpdate(type, data) {
    studioSync.send(type, data);
}

// --- Settings (see settings.js for loading, saving and the dialog) ---
const DEFAULT_SETTINGS = Object.freeze({
    fontSize: 3.5,
    scrollSpeed: 10,
    countdownSeconds: 3,
    theme: 'dark',          // prompter colours: 'dark' | 'light'
    readingLine: false,
    mirror: false,
    speechLang: 'sq-AL',
    broadcastLayout: 'split', // documents on the YouTube output: 'split' | 'box'
    ticker: [
        'SOT: ZHVILLIMET E FUNDIT NGA STUDIO E SYRIAI',
        'TEKNOLOGJIA AI PO NDRYSHON BROADCASTING',
        'NDRYSHIMET KLIMATIKE: PARASHIKIMI I MOTIT',
    ],
    sponsors: ['KOMPANIA A', 'DIGITAL TECH', 'FUTURE MEDIA', 'INNOVATE AL', 'SYRI CLOUD'],
    matcher: {},            // optional overrides for SyriMatcher.DEFAULTS
});
const studioSettings = structuredClone(DEFAULT_SETTINGS);

// --- Backend API ---
class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

/** fetch() wrapper for the studio API: JSON in/out, throws ApiError on failure */
async function api(path, { method = 'GET', body, headers = {} } = {}) {
    const isForm = body instanceof FormData;
    const response = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: body && !isForm ? { 'Content-Type': 'application/json', ...headers } : headers,
        body: body && !isForm ? JSON.stringify(body) : body,
    });
    if (response.status === 401) {
        notify("Sesioni i hyrjes ka skaduar. Hyni përsëri.", 'error', 8000);
        throw new ApiError(401, 'Unauthorized');
    }
    if (!response.ok) {
        let message = response.statusText;
        try { message = (await response.json()).error || message; } catch { /* not JSON */ }
        throw new ApiError(response.status, message);
    }
    if (response.status === 204) return null;
    const type = response.headers.get('content-type') || '';
    return type.includes('json') ? response.json() : response.text();
}

// --- UI helpers ---
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function splitWords(text) {
    return text.trim().split(/\s+/).filter(w => w.length > 0);
}

// Non-blocking notification (replaces alert()). type: info | success | warning | error
function notify(message, type = 'info', duration = 4500) {
    const stack = document.getElementById('toast-stack');
    if (!stack) return;
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.textContent = message;
    stack.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('is-leaving');
        setTimeout(() => toast.remove(), 250);
    }, duration);
}

// Update a button's text without wiping out its icon
function setLabel(btn, text) {
    if (!btn) return;
    const label = btn.querySelector('.btn-label');
    if (label) label.textContent = text;
    else btn.textContent = text;
}

// Upload button feedback. state: busy | ok | error | undefined (idle)
function setUploadStatus(text, state) {
    setLabel(uploadTrigger, text);
    if (state) uploadTrigger.dataset.state = state;
    else delete uploadTrigger.dataset.state;
}

// --- Modal dialog ---
/**
 * Open a modal. `content` is an HTMLElement or HTML string (escape user data!).
 * actions: [{ label, variant: 'primary'|'secondary'|'danger', onClick(close) }]
 * Returns { root, body, close }.
 */
function openModal({ title, content, actions = [], wide = false, onClose }) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
        <div class="modal ${wide ? 'modal--wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div class="modal-header">
                <h2 id="modal-title" class="modal-title"></h2>
                <button class="icon-btn modal-close" aria-label="Mbyll"><svg class="icon"><use href="#i-close" /></svg></button>
            </div>
            <div class="modal-body"></div>
            <div class="modal-footer"></div>
        </div>`;
    backdrop.querySelector('.modal-title').textContent = title;
    const body = backdrop.querySelector('.modal-body');
    if (typeof content === 'string') body.innerHTML = content;
    else if (content) body.appendChild(content);

    const previousFocus = document.activeElement;
    const close = () => {
        backdrop.remove();
        document.removeEventListener('keydown', onKey);
        if (previousFocus && previousFocus.focus) previousFocus.focus();
        if (onClose) onClose();
    };
    // With stacked dialogs (e.g. SUS over the report) Escape closes only the top one
    const onKey = (e) => {
        if (e.key !== 'Escape') return;
        const open = document.querySelectorAll('.modal-backdrop');
        if (open[open.length - 1] === backdrop) close();
    };
    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('.modal-close').addEventListener('click', close);

    const footer = backdrop.querySelector('.modal-footer');
    if (!actions.length) footer.remove();
    actions.forEach(action => {
        const btn = document.createElement('button');
        btn.className = `btn btn-${action.variant || 'secondary'}`;
        btn.textContent = action.label;
        btn.addEventListener('click', () => action.onClick(close, btn));
        footer.appendChild(btn);
    });

    document.body.appendChild(backdrop);
    (backdrop.querySelector('.modal-body input, .modal-body textarea, .modal-body select') || footer?.querySelector('button') || backdrop.querySelector('.modal-close')).focus();
    return { root: backdrop, body, close };
}

/** Browser download of in-memory text */
function downloadText(filename, text, mime = 'text/plain') {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function formatDuration(seconds) {
    const s = Math.max(0, Math.round(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const scriptDisplay = document.getElementById('script-display');
const scrollContainer = document.getElementById('scroll-container');
const fontSizeInput = document.getElementById('font-size');
const scriptInput = document.getElementById('script-input');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const mirrorBtn = document.getElementById('mirror-btn');
const video = document.getElementById('webcam-feed');
const statusBadge = document.getElementById('connection-status');
const clockDisplay = document.getElementById('digital-clock');

// Video and Canvas Overlay Setup
const outputCanvas = document.getElementById('output-canvas');
const outCtx = outputCanvas.getContext('2d');
const adminOutputCanvas = document.getElementById('admin-output-canvas');
const adminOutCtx = adminOutputCanvas.getContext('2d');
const gazeCanvas = document.getElementById('gaze-canvas');
const gazeCtx = gazeCanvas.getContext('2d');
const adminDrawGlass = document.getElementById('admin-drawglass');
const adminDrawCtx = adminDrawGlass.getContext('2d');
const adminCursor = document.getElementById('admin-cursor');
const adminCursorCtx = adminCursor.getContext('2d');
const aiStatus = document.getElementById('ai-status');
const adminAiStatus = document.getElementById('admin-ai-status');
const moodFeedback = document.getElementById('mood-feedback');
const adminMoodFeedback = document.getElementById('admin-mood-feedback');
const blurBtn = document.getElementById('blur-btn');
const studioBgBtn = document.getElementById('studio-bg-btn');
const recordBtn = document.getElementById('record-btn');
const fileUpload = document.getElementById('file-upload');
const uploadTrigger = document.getElementById('upload-trigger');
const connectionStatus = document.getElementById('connection-status');
const fontSizeVal = document.getElementById('font-size-val');
const wordCountDisplay = document.getElementById('word-count');

// Document view
const pdfViewMain = document.getElementById('pdf-view-main');
const viewTextBtn = document.getElementById('view-text-btn');
const viewDocBtn = document.getElementById('view-doc-btn');
const openClientBtn = document.getElementById('open-client-btn');

// Auto-Scroll Logic
const autoScrollBtn = document.getElementById('autoscroll-btn');
const scrollSpeedInput = document.getElementById('scroll-speed');
const speedValDisplay = document.getElementById('speed-val');

let words = [];
let pageWordBoundaries = [];
let allWordPositions = [];
let currentWordIndex = 0;
let startTime = null;
let totalMatches = 0;
let totalAttempts = 0;
let isSyncingScroll = false;
let isAutoScrolling = false;
let scrollSpeed = 10;
let lastScrollTime = 0;
let currentPdf = null;
let isBlurActive = false;
let isStudioBgActive = false;
let isRecording = false;
let isDrawMode = false;
let isLive = false;
let lastReadIndex = -1;
let scrollRemainder = 0;
const drawModeBtn = document.getElementById('draw-mode-btn');

// Digital Clock Logic
function updateClock() {
    if (!clockDisplay) return;
    const now = new Date();
    clockDisplay.innerText = now.toLocaleTimeString('sq-AL', { hour12: false });
}
setInterval(updateClock, 1000);
updateClock();
