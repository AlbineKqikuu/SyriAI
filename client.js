const syncChannel = new BroadcastChannel('syriai_sync');
const scriptDisplay = document.getElementById('client-script-display');
const scrollBox = document.getElementById('client-scroll-box');
const video = document.getElementById('client-video');
const clock = document.getElementById('client-time');
const slideArea = document.getElementById('client-slide-area');
const slideCanvas = document.getElementById('client-slide-canvas');
const slideCtx = slideCanvas.getContext('2d');

// --- Hand Tracking & Drawing Setup ---
const drawGlass = document.getElementById('drawglass');
const drawCtx = drawGlass.getContext('2d');
const handStatusLabel = document.getElementById('hand-status');

const cursorGlass = document.getElementById('hand-cursor');
const cursorCtx = cursorGlass.getContext('2d');

// PDF.js Worker Setup
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

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
let fingerPoints = []; // To draw smooth lines
let isAutoScrolling = false;
let scrollSpeed = 10;
let lastScrollTime = 0;

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
        syncChannel.postMessage({ type: 'cursor_pos', data: { nx, ny } });

        // 1. CLEAR: Palm Open
        if (isPalmOpen) {
            drawCtx.clearRect(0, 0, drawGlass.width, drawGlass.height);
            syncChannel.postMessage({ type: 'clear_draw', data: true });
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
                syncChannel.postMessage({
                    type: 'draw_segment',
                    data: { x1: lastFingerX / drawGlass.width, y1: lastFingerY / drawGlass.height, x2: nx, y2: ny, color: '#ff3b30' }
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

// Start camera for hand tracking
const camera = new Camera(video, {
    onFrame: async () => {
        await hands.send({ image: video });
    },
    width: 640,
    height: 480
});
camera.start();

// --- Main App Logic ---
// 1. Clock Logic
function updateClock() {
    const now = new Date();
    clock.innerText = now.toLocaleTimeString('sq-AL');
}
setInterval(updateClock, 1000);
updateClock();

// 2. Camera Logic - Handled by MediaPipe Camera Utils above

// 2.5 Request initial state
syncChannel.postMessage({ type: 'client_ready' });

// 3. Sync Logic
syncChannel.onmessage = (event) => {
    const { type, data } = event.data;

    switch (type) {
        case 'autoscroll_sync':
            isAutoScrolling = data;
            if (isAutoScrolling) requestAnimationFrame(clientScrollStep);
            break;
        case 'scroll_speed_sync':
            scrollSpeed = data;
            break;
        case 'clear_draw':
            drawCtx.clearRect(0, 0, drawGlass.width, drawGlass.height);
            break;

        case 'draw_segment':
            const { x1, y1, x2, y2, color } = data;
            drawCtx.beginPath();
            drawCtx.moveTo(x1 * drawGlass.width, y1 * drawGlass.height);
            drawCtx.lineTo(x2 * drawGlass.width, y2 * drawGlass.height);
            drawCtx.strokeStyle = color;
            drawCtx.lineWidth = 6;
            drawCtx.lineCap = 'round';
            drawCtx.lineJoin = 'round';
            drawCtx.shadowBlur = 10;
            drawCtx.shadowColor = 'rgba(255, 59, 48, 0.6)';
            drawCtx.stroke();
            break;
        case 'script_update':
            scriptDisplay.innerHTML = data.html;
            break;

        case 'highlight_update':
            highlightWord(data);
            break;

        case 'font_size':
            scriptDisplay.style.fontSize = `${data}rem`;
            break;

        case 'slide_update':
            if (data.show) {
                slideArea.style.display = 'block';
                if (data.fullView) slideArea.classList.add('full-view');
                else slideArea.classList.remove('full-view');
            } else {
                slideArea.style.display = 'none';
                slideArea.classList.remove('full-view');
            }
            break;
        case 'pdf_buffer_sync':
            renderClientPdf(data.buffer);
            break;
        case 'pdf_page_chunk':
            // Deprecated - replaced by local rendering for speed
            break;

        case 'pdf_word_highlight':
            // High-precision scrolling on client for PDF
            const pageEl = document.getElementById(`pdf-page-${data.page}`);
            if (pageEl) {
                const targetScroll = pageEl.offsetTop + (data.ny * pageEl.clientHeight) - (slideArea.clientHeight / 2);
                slideArea.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
            }
            break;
        case 'pdf_clear':
            slideArea.querySelectorAll('.pdf-page-container').forEach(el => el.remove());
            slideCanvas.style.display = 'block'; // Restore canvas visibility
            break;
        case 'pdf_pages_ready':
            // Deprecated
            break;
        case 'view_mode':
            if (data === 'doc') {
                scrollBox.style.display = 'none';
                slideArea.style.display = 'block';
                slideArea.classList.add('full-view');
            } else {
                scrollBox.style.display = 'block';
                slideArea.style.display = 'none';
            }
            break;
        case 'pdf_scroll':
            isSyncingScroll = true;
            slideArea.scrollTop = data;
            setTimeout(() => isSyncingScroll = false, 50);
            break;
        case 'text_scroll':
            isSyncingScroll = true;
            scrollBox.scrollTop = data;
            setTimeout(() => isSyncingScroll = false, 50);
            break;
        case 'cursor_pos':
            const { nx, ny, visible } = data;
            cursorCtx.clearRect(0, 0, cursorGlass.width, cursorGlass.height);
            if (visible) {
                const screenX = nx * cursorGlass.width;
                const screenY = ny * cursorGlass.height;
                cursorCtx.beginPath();
                cursorCtx.arc(screenX, screenY, 12, 0, Math.PI * 2);
                cursorCtx.fillStyle = "rgba(255, 59, 48, 0.7)";
                cursorCtx.shadowBlur = 10;
                cursorCtx.shadowColor = "white";
                cursorCtx.fill();
            }
            break;
        case 'lt_sync':
            const lt = document.getElementById('lower-third');
            if (lt) {
                document.getElementById('lt-name-display').innerText = data.name;
                document.getElementById('lt-title-display').innerText = data.title;
                lt.style.display = data.show ? 'flex' : 'none';
            }
            break;
    }
};

// Listen for local scroll in client to sync back to Admin
slideArea.addEventListener('scroll', () => {
    if (isSyncingScroll) return;
    if (slideArea.classList.contains('full-view')) {
        syncChannel.postMessage({ type: 'pdf_scroll', data: slideArea.scrollTop });
    }
});

scrollBox.addEventListener('scroll', () => {
    if (isSyncingScroll) return;
    syncChannel.postMessage({ type: 'text_scroll', data: scrollBox.scrollTop });
});

// Client Keyboard Control (Arrows & Scrolling)
window.addEventListener('keydown', (e) => {
    // Avoid navigation when typing
    if (['TEXTAREA', 'INPUT'].includes(document.activeElement.tagName)) return;

    const nextKeys = ['ArrowRight', 'ArrowDown', 'PageDown', ' '];
    const prevKeys = ['ArrowLeft', 'ArrowUp', 'PageUp'];

    if (nextKeys.includes(e.key)) {
        e.preventDefault();
        syncChannel.postMessage({ type: 'nav_next' });
    } else if (prevKeys.includes(e.key)) {
        e.preventDefault();
        syncChannel.postMessage({ type: 'nav_prev' });
    }
});

function highlightWord(index) {
    const wordEl = document.getElementById(`word-${index}`);
    if (wordEl) {
        // No .highlight class added here for client.

        // Mark words as read (faded) for tracking
        for (let i = 0; i < index; i++) {
            const prevEl = document.getElementById(`word-${i}`);
            if (prevEl) prevEl.classList.add('read');
        }

        // Keep Auto-scroll so the screen moves with you
        wordEl.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest'
        });
    }
}

function clientScrollStep(timestamp) {
    if (!isAutoScrolling) return;
    if (!lastScrollTime) lastScrollTime = timestamp;
    const deltaTime = timestamp - lastScrollTime;
    lastScrollTime = timestamp;

    const scrollAmount = (scrollSpeed / 10) * (deltaTime / 16.67);
    const isDocMode = slideArea.classList.contains('full-view');
    const container = isDocMode ? slideArea : scrollBox;

    if (container) {
        container.scrollTop += scrollAmount;
    }

    requestAnimationFrame(clientScrollStep);
}

// Local PDF rendering for INSTANT results
async function renderClientPdf(buffer) {
    try {
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
        slideArea.innerHTML = ''; // Clear
        slideArea.style.display = 'block';
        slideArea.classList.add('full-view');

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 });

            const container = document.createElement('div');
            container.className = 'pdf-page-container';
            container.id = `pdf-page-${i}`;
            container.style.width = '85%';
            container.style.margin = '20px auto';

            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-page-canvas';
            canvas.style.display = 'block';
            canvas.style.width = '100%';
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            const highlight = document.createElement('div');
            highlight.className = 'pdf-highlight';
            highlight.id = `pdf-hl-${i}`;

            container.appendChild(canvas);
            container.appendChild(highlight);
            slideArea.appendChild(container);

            await page.render({ canvasContext: context, viewport: viewport }).promise;
        }
        // Force sync view mode
        scrollBox.style.display = 'none';
    } catch (err) {
        console.error("Client PDF Load Error:", err);
    }
}
