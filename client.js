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

                if (data.image) {
                    const img = new Image();
                    img.onload = () => {
                        // For vertical PDF view, we append rather than replace if logic allows, 
                        // but since the admin sends the full view, we just render what is sent.
                        slideCanvas.width = img.width;
                        slideCanvas.height = img.height;
                        slideCtx.drawImage(img, 0, 0);
                    };
                    img.src = data.image;
                }
            } else {
                slideArea.style.display = 'none';
                slideArea.classList.remove('full-view');
            }
            break;
        case 'pdf_page_chunk':
            // Hide the single slide canvas when doing continuous render
            slideCanvas.style.display = 'none';
            const img = new Image();
            img.src = data;
            img.className = 'pdf-continuous-img';
            img.style.display = 'block';
            img.style.margin = '20px auto';
            img.style.boxShadow = '0 0 30px rgba(0,0,0,0.8)';
            img.style.width = '85%';
            slideArea.appendChild(img);
            break;
        case 'pdf_clear':
            slideArea.querySelectorAll('.pdf-continuous-img').forEach(el => el.remove());
            slideCanvas.style.display = 'block'; // Restore canvas visibility
            break;
        case 'pdf_pages_ready':
            // Deprecated
            break;
        case 'view_mode':
            const marker = document.getElementById('reading-marker');
            if (data === 'doc') {
                scriptDisplay.style.display = 'none';
                if (marker) marker.style.display = 'none';
                slideArea.classList.add('full-view');
                slideArea.style.display = 'block';
            } else {
                scriptDisplay.style.display = 'block';
                if (marker) marker.style.display = 'block';
                slideArea.classList.remove('full-view');
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
    // Clear previous highlights
    document.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));

    // Add new highlight
    const wordEl = document.getElementById(`word-${index}`);
    if (wordEl) {
        wordEl.classList.add('highlight');

        // Handle 'read' opacity
        for (let i = 0; i < index; i++) {
            const prevEl = document.getElementById(`word-${i}`);
            if (prevEl) prevEl.classList.add('read');
        }

        // Auto-scroll logic (center the highlighted word)
        wordEl.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest'
        });
    }
}
