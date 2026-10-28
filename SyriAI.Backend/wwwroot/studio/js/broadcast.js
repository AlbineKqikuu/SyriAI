// SyriAI Studio — program output for live streaming (OBS window capture → YouTube).
//
// Camera: when opened from the studio ("Dalja për YouTube"), the processed camera
// (blur / virtual studio) is drawn from the studio window's canvas every frame.
// Opened on its own, it falls back to the raw webcam.
// Graphics (LIVE bug, name strap, headline, ticker, slate, documents) follow the studio
// through StudioSync, like the presenter's screen.

const studioSync = new StudioSync();

const STAGE_W = 1920;
const STAGE_H = 1080;

const stage = document.getElementById('stage');
const programCanvas = document.getElementById('program-canvas');
const programCtx = programCanvas.getContext('2d');
const mediaBox = document.getElementById('media-box');
const mediaContent = document.getElementById('media-box-content');
const liveBadge = document.getElementById('bc-live');
const slate = document.getElementById('slate');
const slateTitle = document.getElementById('slate-title');
const slateSubtitle = document.getElementById('slate-subtitle');
const slateCountdown = document.getElementById('slate-countdown');
const sourceHint = document.getElementById('source-hint');

const PDF_OPTIONS = { scale: 1.6, rootMargin: '600px 0px', placeholderHeight: '1100px', pageWidth: '96%' };

let currentMedia = null;
let viewMode = 'text';
/** How documents appear on the stream: 'split' (camera | document) or 'box' (small window over the camera) */
let mediaLayout = 'split';
let headlineText = '';

// ---------- Stage scaling: always 16:9, letterboxed in any window size ----------
function fitStage() {
    const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    const x = (window.innerWidth - STAGE_W * scale) / 2;
    const y = (window.innerHeight - STAGE_H * scale) / 2;
    stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}
window.addEventListener('resize', fitStage);
fitStage();

// ---------- Camera ----------
/** The studio's processed camera canvas, when this window was opened by the studio */
function studioCanvas() {
    try {
        const canvas = window.opener && !window.opener.closed && window.opener.document.getElementById('output-canvas');
        return canvas && canvas.width > 0 ? canvas : null;
    } catch {
        return null; // opener from another origin, or navigated away
    }
}

let fallbackVideo = null;

async function startFallbackCamera() {
    if (fallbackVideo) return;
    fallbackVideo = document.createElement('video');
    fallbackVideo.muted = true;
    fallbackVideo.playsInline = true;
    try {
        fallbackVideo.srcObject = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
        });
        await fallbackVideo.play();
        showHint("Kamera pa efekte. Për efektet e studios (turbullim / sfond), hapeni këtë dritare nga studio: “Dalja për YouTube”.", 9000);
    } catch (err) {
        console.warn('Broadcast camera unavailable:', err);
        showHint("Nuk ka burim kamere. Hapeni këtë dritare nga studio me butonin “Dalja për YouTube”.");
    }
}

/** Camera area on the stage: full frame, or the left half in split screen */
function cameraRect() {
    return isSplit() ? { x: 0, y: 0, w: STAGE_W / 2, h: STAGE_H } : { x: 0, y: 0, w: STAGE_W, h: STAGE_H };
}

function isSplit() {
    return mediaLayout === 'split' && !mediaBox.hidden;
}

/** Draw source into the camera area like CSS object-fit: cover (centre crop) */
function drawCover(source, sw, sh) {
    const r = cameraRect();
    const scale = Math.max(r.w / sw, r.h / sh);
    const w = sw * scale;
    const h = sh * scale;
    programCtx.save();
    programCtx.beginPath();
    programCtx.rect(r.x, r.y, r.w, r.h);
    programCtx.clip();
    programCtx.drawImage(source, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
    programCtx.restore();
}

let missingSourceSince = performance.now();

function renderFrame() {
    const canvas = studioCanvas();
    if (canvas) {
        drawCover(canvas, canvas.width, canvas.height);
        missingSourceSince = null;
        if (fallbackVideo) stopFallbackCamera();
    } else if (fallbackVideo && fallbackVideo.readyState >= 2) {
        drawCover(fallbackVideo, fallbackVideo.videoWidth, fallbackVideo.videoHeight);
    } else {
        // Give the studio a moment (it may still be starting) before using our own camera
        missingSourceSince ??= performance.now();
        if (performance.now() - missingSourceSince > 2500) startFallbackCamera();
    }
    requestAnimationFrame(renderFrame);
}

function stopFallbackCamera() {
    fallbackVideo.srcObject?.getTracks().forEach(t => t.stop());
    fallbackVideo = null;
    sourceHint.hidden = true;
}

requestAnimationFrame(renderFrame);

let hintTimer = null;
function showHint(text, duration = 0) {
    sourceHint.textContent = text;
    sourceHint.hidden = false;
    clearTimeout(hintTimer);
    if (duration) hintTimer = setTimeout(() => { sourceHint.hidden = true; }, duration);
}

// ---------- Clock (HH:MM, like TV channels) ----------
function updateClock() {
    document.getElementById('bc-clock-time').textContent =
        new Date().toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit', hour12: false });
}
setInterval(updateClock, 1000);
updateClock();

// ---------- Graphics ----------
function setLive({ live, ended }) {
    liveBadge.hidden = !live;
    slate.classList.toggle('is-hidden', live);
    slateTitle.textContent = ended ? 'Faleminderit që na ndoqët' : 'Transmetimi fillon së shpejti';
    slateSubtitle.textContent = ended ? '' : headlineText;
}

function setNameStrap({ show, name, title }) {
    document.getElementById('bc-name').hidden = !show;
    document.getElementById('bc-name-text').textContent = name;
    document.getElementById('bc-name-title').textContent = title;
}

function setHeadline({ show, text }) {
    headlineText = text || '';
    document.getElementById('bc-headline').hidden = !show || !headlineText;
    document.getElementById('bc-headline-text').textContent = headlineText;
    if (slateTitle.textContent === 'Transmetimi fillon së shpejti') slateSubtitle.textContent = headlineText;
}

function setTicker(lines) {
    if (!Array.isArray(lines) || !lines.length) return;
    document.getElementById('bc-ticker-track').replaceChildren(...lines.map(line => {
        const span = document.createElement('span');
        span.textContent = line;
        return span;
    }));
}

function setCountdown(value) {
    slateCountdown.hidden = value <= 0;
    slateCountdown.textContent = value;
}

function updateMediaBox() {
    mediaBox.hidden = !(viewMode === 'doc' && currentMedia);
    stage.classList.toggle('is-split', isSplit());
    stage.classList.toggle('is-boxed', mediaLayout === 'box' && !mediaBox.hidden);
}

async function showMedia(media) {
    if (!media || (currentMedia && media.url === currentMedia.url)) return;
    currentMedia = media;
    updateMediaBox();
    try {
        await StudioDocuments.renderMedia(media, mediaContent, { pdfOptions: PDF_OPTIONS, muteVideo: true });
    } catch (err) {
        console.error('Broadcast media error:', err);
        currentMedia = null;
        updateMediaBox();
    }
}

// The studio's writing, spotlight, sparkles and reactions over the document box
const inkReceiver = new StudioInkReceiver(mediaBox);

// ---------- Messages from the studio ----------
studioSync.on((type, data) => {
    inkReceiver.handle(type, data);
    switch (type) {
        case 'live_state':
            setLive(data);
            break;
        case 'countdown':
            setCountdown(data);
            break;
        case 'lt_sync':
            setNameStrap(data);
            break;
        case 'headline_sync':
            setHeadline(data);
            break;
        case 'settings_sync':
            setTicker(data.ticker);
            if (data.broadcastLayout) {
                mediaLayout = data.broadcastLayout;
                updateMediaBox();
            }
            break;
        case 'media_sync':
            showMedia(data);
            break;
        case 'view_mode':
            viewMode = data;
            updateMediaBox();
            break;
        case 'doc_scroll_ratio':
            // Same relative position as the studio's document view (0 = top, 1 = bottom)
            mediaContent.scrollTop = data * Math.max(0, mediaContent.scrollHeight - mediaContent.clientHeight);
            break;
    }
});

studioSync.onStatus((status) => {
    if (status === 'online' || status === 'local') studioSync.send('client_ready');
});

studioSync.start();

// ---------- Window helpers for streaming ----------
// Hide the mouse pointer after 2 s so window capture stays clean
let idleTimer = null;
function wake() {
    document.body.classList.remove('is-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add('is-idle'), 2000);
}
window.addEventListener('mousemove', wake);
wake();

// Double-click toggles full screen
window.addEventListener('dblclick', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => { /* not allowed */ });
});
