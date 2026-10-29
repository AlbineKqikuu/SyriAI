// SyriAI Studio — client screen (what the presenter / audience sees).
// Receives state from the admin studio through StudioSync and sends back hand drawings,
// pointer position and keyboard navigation.

const studioSync = new StudioSync();

const scriptDisplay = document.getElementById('client-script-display');
const scrollBox = document.getElementById('client-scroll-box');
const video = document.getElementById('client-video');
const slideArea = document.getElementById('client-slide-area');
const connectionIndicator = document.getElementById('connection-indicator');
const countdownOverlay = document.getElementById('countdown-overlay');
const sponsorTrack = document.getElementById('sponsor-track');
const newsTickerTrack = document.getElementById('news-ticker-track');

// --- Hand Tracking & Drawing Setup ---
const drawGlass = document.getElementById('drawglass');
const drawCtx = drawGlass.getContext('2d');
const handStatusLabel = document.getElementById('hand-status');

const cursorGlass = document.getElementById('hand-cursor');
const cursorCtx = cursorGlass.getContext('2d');

const PDF_VIEW_OPTIONS = { scale: 2.0, rootMargin: '800px 0px', placeholderHeight: '1200px', pageWidth: '85%' };

// Handle sizing for drawing canvas
function resizeDrawCanvas() {
    drawGlass.width = drawGlass.clientWidth;
    drawGlass.height = drawGlass.clientHeight;
    cursorGlass.width = drawGlass.clientWidth;
    cursorGlass.height = drawGlass.clientHeight;
}
window.addEventListener('resize', resizeDrawCanvas);
resizeDrawCanvas();

let isSyncingScroll = false;

let lastFingerY = null;
let lastFingerX = null;
let isAutoScrolling = false;
let scrollSpeed = 10;
let lastScrollTime = 0;
let scrollRemainder = 0;
let lastReadIndex = -1;
let currentMediaUrl = null;

const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.5
});

hands.onResults(onHandResults);

function onHandResults(results) {
    // Smart resize: Only resize if dimensions changed to avoid clearing canvas every frame
    if (drawGlass.width !== drawGlass.clientWidth || drawGlass.height !== drawGlass.clientHeight) {
        resizeDrawCanvas();
    }
    // ONLY clear the feedback cursor every frame, NOT the drawing canvas
    cursorCtx.clearRect(0, 0, cursorGlass.width, cursorGlass.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];

        // Landmarks for Gesture Detection
        const indexTip = landmarks[8];
        const indexPip = landmarks[6];
        const middleTip = landmarks[12];
        const middlePip = landmarks[10];
        const pinkyTip = landmarks[20];
        const pinkyPip = landmarks[18];

        // Normalized coordinates (0-1)
        const nx = 1 - indexTip.x;
        const ny = indexTip.y;
        const screenX = nx * drawGlass.width;
        const screenY = ny * drawGlass.height;

        // Detection: Is finger extended? (Buffer for stability)
        const isIndexExtended = indexTip.y < indexPip.y - 0.02;
        const isMiddleExtended = middleTip.y < middlePip.y - 0.02;

        // Palm Open Check (for clearing - 4 or more fingers up)
        const tips = [8, 12, 16, 20];
        let extendedCount = 0;
        tips.forEach(t => {
            if (landmarks[t].y < landmarks[t - 2].y) extendedCount++;
        });
        const isPalmOpen = extendedCount >= 4;

        // Visual Feedback Dot (on cursor canvas)
        cursorCtx.save();
        cursorCtx.beginPath();
        cursorCtx.arc(screenX, screenY, 8, 0, Math.PI * 2);

        // Color Feedback: Red for Draw, Green for Idle/Point, Blue for Clear
        if (isPalmOpen) cursorCtx.fillStyle = "#007aff";
        else if (isIndexExtended && !isMiddleExtended) cursorCtx.fillStyle = "#ff3b30";
        else cursorCtx.fillStyle = "rgba(255,255,255,0.6)";

        cursorCtx.shadowBlur = 10;
        cursorCtx.shadowColor = "white";
        cursorCtx.fill();
        cursorCtx.restore();

        // Broadcast pointing position to Admin
        studioSync.send('cursor_pos', { nx, ny });

        // 1. CLEAR: Palm Open
        if (isPalmOpen) {
            drawCtx.clearRect(0, 0, drawGlass.width, drawGlass.height);
            inkReceiver.handle('clear_draw', true);
            studioSync.send('clear_draw', true);
            lastFingerX = null;
            lastFingerY = null;
            return;
        }

        // 2. DRAW: ONLY Index finger (Middle must be down)
        if (isIndexExtended && !isMiddleExtended) {
            handStatusLabel.innerText = "✍️ Writing...";
            handStatusLabel.style.display = 'block';

            if (lastFingerX !== null) {
                drawCtx.beginPath();
                drawCtx.moveTo(lastFingerX, lastFingerY);
                drawCtx.lineTo(screenX, screenY);
                drawCtx.strokeStyle = '#ff3b30';
                drawCtx.lineWidth = 6;
                drawCtx.lineCap = 'round';
                drawCtx.stroke();

                // Broadcast segment
                studioSync.send('draw_segment', {
                    x1: lastFingerX / drawGlass.width, y1: lastFingerY / drawGlass.height, x2: nx, y2: ny, color: '#ff3b30'
                });
            }
            lastFingerX = screenX;
            lastFingerY = screenY;
        }
        else {
            handStatusLabel.style.display = 'none';
            lastFingerX = null;
            lastFingerY = null;
        }
    } else {
        handStatusLabel.style.display = 'none';
        lastFingerX = null;
        lastFingerY = null;
    }
}

// Start camera for hand tracking. Needs HTTPS on other devices (browsers only allow
// the camera on localhost or secure origins); the screen still works without it.
const camera = new Camera(video, {
    onFrame: async () => {
        await hands.send({ image: video });
    },
    width: 640,
    height: 480
});
camera.start().catch(err => {
    console.warn('Client camera unavailable:', err);
    handStatusLabel.innerText = "Kamera e klientit nuk është e disponueshme — vizatimi me dorë është joaktiv";
    handStatusLabel.style.display = 'block';
    setTimeout(() => { handStatusLabel.style.display = 'none'; }, 8000);
});

// --- Clock ---
function updateClock() {
    const timeStr = new Date().toLocaleTimeString('sq-AL', { hour12: false });
    document.getElementById('client-time').innerText = timeStr;
    document.getElementById('client-time-top').innerText = timeStr;
}
setInterval(updateClock, 1000);
updateClock();

// --- Views ---
function showDocumentArea() {
    slideArea.style.display = 'block';
    slideArea.classList.add('full-view');
    scrollBox.style.display = 'none';
}

function showTextArea() {
    scrollBox.style.display = 'block';
    slideArea.style.display = 'none';
}

async function showMedia(media) {
    if (!media || media.url === currentMediaUrl) return;
    currentMediaUrl = media.url;
    try {
        await StudioDocuments.renderMedia(media, slideArea, { pdfOptions: PDF_VIEW_OPTIONS, muteVideo: true });
    } catch (err) {
        console.error('Client media error:', err);
        currentMediaUrl = null;
        slideArea.innerHTML = `<p class="client-media-error">Dokumenti nuk u hap në këtë ekran.</p>`;
    }
}

function applySettings(settings) {
    document.body.classList.toggle('prompter-light', settings.theme === 'light');
    document.body.classList.toggle('show-reading-line', !!settings.readingLine);
    if (settings.fontSize) scriptDisplay.style.fontSize = `${settings.fontSize}rem`;
    if (Array.isArray(settings.ticker) && settings.ticker.length) {
        newsTickerTrack.replaceChildren(...settings.ticker.map(line => {
            const span = document.createElement('span');
            span.textContent = line;
            return span;
        }));
    }
    if (Array.isArray(settings.sponsors) && settings.sponsors.length) {
        // Two copies of the list make the scrolling loop seamless
        const items = settings.sponsors.map(name => {
            const item = document.createElement('div');
            item.className = 'sponsor-item';
            const span = document.createElement('span');
            span.textContent = name;
            item.appendChild(span);
            return item;
        });
        sponsorTrack.replaceChildren(...items, ...items.map(i => i.cloneNode(true)));
    }
}

function drawAdminCursor({ nx, ny, visible, spot }) {
    cursorCtx.clearRect(0, 0, cursorGlass.width, cursorGlass.height);
    // The studio's spotlight is drawn by inkReceiver
    if (!visible || spot) return;
    cursorCtx.beginPath();
    cursorCtx.arc(nx * cursorGlass.width, ny * cursorGlass.height, 12, 0, Math.PI * 2);
    cursorCtx.fillStyle = "rgba(255, 59, 48, 0.7)";
    cursorCtx.shadowBlur = 10;
    cursorCtx.shadowColor = "white";
    cursorCtx.fill();
}

function applyRemoteScroll(container, top) {
    isSyncingScroll = true;
    container.scrollTop = top;
    setTimeout(() => isSyncingScroll = false, 50);
}

// The studio's writing, spotlight, sparkles and reactions, drawn exactly as in the studio
const inkReceiver = new StudioInkReceiver(drawGlass.parentElement);

// --- Live show: ON AIR, story timing, producer messages ---
const timingStrip = document.getElementById('client-timing');
const lostBadge = document.getElementById('tracking-lost');
const cueBox = document.getElementById('producer-cue');
const CUE_VISIBLE_MS = 12000;
let cueId = null;
let cueTimer = null;
let foundTimer = null;

function showLiveState({ live, ended }) {
    document.body.classList.toggle('on-air', !!live);
    document.getElementById('live-pill-text').textContent = live ? 'LIVE' : ended ? 'PËRFUNDOI' : 'NË PRITJE';
}

function showTiming(t) {
    timingStrip.hidden = !t;
    if (!t) return;
    const fmt = (s) => SyriRundown.formatDelta(s).replace(/^[+-]/, '');
    const segment = document.getElementById('ct-segment');
    segment.textContent = (t.segmentLeft < 0 ? '+' : '') + fmt(t.segmentLeft);
    segment.dataset.state = t.segmentLeft < 0 ? 'over' : 'ok';
    const plan = document.getElementById('ct-plan');
    plan.textContent = SyriRundown.formatDelta(t.delta);
    plan.dataset.state = t.delta > 0 ? 'over' : 'ok';
    document.getElementById('ct-story').textContent = t.title ? `${t.index + 1}/${t.count} · ${t.title}` : '';
    document.getElementById('ct-next').textContent = t.next ? `Tjetër: ${t.next}` : '';
}

function showTrackingState({ lost, found }) {
    clearTimeout(foundTimer);
    if (found) {
        lostBadge.hidden = false;
        lostBadge.dataset.state = 'found';
        lostBadge.textContent = '✓ Vendi u gjet';
        foundTimer = setTimeout(() => { lostBadge.hidden = true; }, 1500);
        return;
    }
    lostBadge.hidden = !lost;
    lostBadge.dataset.state = 'lost';
    lostBadge.textContent = 'Duke kërkuar vendin në skript…';
}

function showCue(cue) {
    clearTimeout(cueTimer);
    if (!cue || !cue.text) {
        cueBox.hidden = true;
        cueId = null;
        return;
    }
    cueId = cue.id;
    document.getElementById('cue-text').textContent = cue.text;
    cueBox.hidden = false;
    studioSync.send('cue_shown', { id: cue.id });
    cueTimer = setTimeout(() => { cueBox.hidden = true; }, CUE_VISIBLE_MS);
}

function acknowledgeCue() {
    if (cueBox.hidden || cueId === null) return false;
    studioSync.send('cue_ack', { id: cueId });
    clearTimeout(cueTimer);
    cueBox.hidden = true;
    return true;
}

cueBox.addEventListener('click', acknowledgeCue);

// --- Messages from the admin studio ---
studioSync.on((type, data) => {
    inkReceiver.handle(type, data);
    switch (type) {
        case 'autoscroll_sync':
            if (data && !isAutoScrolling) {
                // Reset the frame clock so resuming does not jump by the paused duration
                lastScrollTime = 0;
                scrollRemainder = 0;
                isAutoScrolling = true;
                requestAnimationFrame(clientScrollStep);
            } else {
                isAutoScrolling = !!data;
            }
            break;
        case 'scroll_speed_sync':
            scrollSpeed = data;
            break;
        case 'clear_draw':
            drawCtx.clearRect(0, 0, drawGlass.width, drawGlass.height);
            break;
        case 'script_update':
            scriptDisplay.innerHTML = data.html;
            lastReadIndex = -1;
            break;
        case 'highlight_update':
            highlightWord(data);
            break;
        case 'font_size':
            scriptDisplay.style.fontSize = `${data}rem`;
            break;
        case 'settings_sync':
            applySettings(data);
            break;
        case 'media_sync':
            showMedia(data);
            break;
        case 'pdf_word_highlight': {
            // Keep the spoken word's position centred in the PDF
            const pageEl = document.getElementById(`pdf-page-${data.page}`);
            if (pageEl) {
                const targetScroll = pageEl.offsetTop + (data.ny * pageEl.clientHeight) - (slideArea.clientHeight / 2);
                slideArea.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
            }
            break;
        }
        case 'view_mode':
            if (data === 'doc') showDocumentArea();
            else showTextArea();
            break;
        case 'pdf_scroll':
            applyRemoteScroll(slideArea, data);
            break;
        case 'text_scroll':
            applyRemoteScroll(scrollBox, data);
            break;
        case 'cursor_pos':
            drawAdminCursor(data);
            break;
        case 'live_state':
            showLiveState(data);
            break;
        case 'show_timing':
            showTiming(data);
            break;
        case 'tracking_state':
            showTrackingState(data);
            break;
        case 'producer_cue':
            showCue(data);
            break;
        case 'segment_jump':
            document.getElementById(`segment-${data}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            break;
        case 'countdown':
            countdownOverlay.hidden = data <= 0;
            countdownOverlay.querySelector('span').textContent = data;
            break;
        case 'lt_sync': {
            const lt = document.getElementById('lower-third');
            document.getElementById('lt-name-display').innerText = data.name;
            document.getElementById('lt-title-display').innerText = data.title;
            lt.style.display = data.show ? 'flex' : 'none';
            break;
        }
    }
});

studioSync.onStatus((status) => {
    connectionIndicator.dataset.status = status;
    connectionIndicator.title = StudioSync.statusLabel(status);
    // Ask the admin for the full state whenever we (re)connect
    if (status === 'online' || status === 'local') studioSync.send('client_ready');
});

// Listen for local scroll in client to sync back to Admin
slideArea.addEventListener('scroll', () => {
    if (isSyncingScroll) return;
    if (slideArea.classList.contains('full-view')) {
        studioSync.send('pdf_scroll', slideArea.scrollTop);
    }
});

scrollBox.addEventListener('scroll', () => {
    if (isSyncingScroll) return;
    studioSync.send('text_scroll', scrollBox.scrollTop);
});

// Client Keyboard Control (Arrows & Scrolling)
window.addEventListener('keydown', (e) => {
    // Avoid navigation when typing
    if (['TEXTAREA', 'INPUT'].includes(document.activeElement.tagName)) return;

    const nextKeys = ['ArrowRight', 'ArrowDown', 'PageDown', ' '];
    const prevKeys = ['ArrowLeft', 'ArrowUp', 'PageUp'];

    if ((e.key === 'Enter' || e.key === 'Escape') && acknowledgeCue()) {
        e.preventDefault();
    } else if (e.shiftKey && (nextKeys.includes(e.key) || prevKeys.includes(e.key))) {
        // Shift + arrow: next / previous story of the rundown
        e.preventDefault();
        studioSync.send(nextKeys.includes(e.key) ? 'nav_next_segment' : 'nav_prev_segment');
    } else if (nextKeys.includes(e.key)) {
        e.preventDefault();
        studioSync.send('nav_next');
    } else if (prevKeys.includes(e.key)) {
        e.preventDefault();
        studioSync.send('nav_prev');
    }
});

function highlightWord(index) {
    const wordEl = document.getElementById(`word-${index}`);
    if (!wordEl) return;

    // Mark words as read (faded); only touch the range that changed
    const lastRead = index - 1;
    if (lastRead > lastReadIndex) {
        for (let i = lastReadIndex + 1; i <= lastRead; i++) {
            document.getElementById(`word-${i}`)?.classList.add('read');
        }
    } else {
        for (let i = lastRead + 1; i <= lastReadIndex; i++) {
            document.getElementById(`word-${i}`)?.classList.remove('read');
        }
    }
    lastReadIndex = lastRead;

    // Keep the current word centred
    wordEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
}

function clientScrollStep(timestamp) {
    if (!isAutoScrolling) return;
    if (!lastScrollTime) lastScrollTime = timestamp;
    const deltaTime = timestamp - lastScrollTime;
    lastScrollTime = timestamp;

    const scrollAmount = (scrollSpeed / 10) * (deltaTime / 16.67);
    const isDocMode = slideArea.classList.contains('full-view') && slideArea.style.display !== 'none';
    const container = isDocMode ? slideArea : scrollBox;

    // Accumulate sub-pixel amounts so low speeds still move
    scrollRemainder += scrollAmount;
    const whole = Math.trunc(scrollRemainder);
    if (whole !== 0) {
        container.scrollTop += whole;
        scrollRemainder -= whole;
    }

    requestAnimationFrame(clientScrollStep);
}

studioSync.start();
