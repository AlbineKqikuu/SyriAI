// src/admin.js
import './style.css';

// Broadcasting logic (simple local sync)
const channel = new BroadcastChannel('secondchance-live');

// Hand Gesture & Camera
const videoElement = document.getElementById('cam-video');
const canvasElement = document.getElementById('annotation-canvas');
const ctx = canvasElement.getContext('2d');
const fileRenderArea = document.getElementById('file-render-area');
const fileInput = document.getElementById('file-input');
const btnLive = document.getElementById('btn-live');
const pointerCanvas = document.getElementById('pointer-canvas');
const pCtx = pointerCanvas.getContext('2d');
const btnDrawMode = document.getElementById('btn-draw-mode');

let isLive = false;
let isDrawMode = false;

btnDrawMode.onclick = () => {
    isDrawMode = !isDrawMode;
    btnDrawMode.innerText = isDrawMode ? '🖊️ Draw Mode: ON' : '🖊️ Draw Mode: OFF';
    btnDrawMode.classList.toggle('active');
};
let currentFile = null;
let drawing = false;
let lastX = 0;
let lastY = 0;
let points = []; // Store strokes for syncing

// Initialize Canvas Size
function resizeCanvas() {
    [canvasElement, pointerCanvas].forEach(canvas => {
        canvas.width = fileRenderArea.scrollWidth || fileRenderArea.clientWidth;
        canvas.height = fileRenderArea.scrollHeight || fileRenderArea.clientHeight;
    });
}
window.addEventListener('resize', resizeCanvas);
setTimeout(resizeCanvas, 500);

// --- Hand Gesture Recognition ---
const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});

hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7,
});

hands.onResults((results) => {
    ctx.save();
    pCtx.clearRect(0, 0, pointerCanvas.width, pointerCanvas.height);

    const gestureStatus = document.querySelector('.gesture-status');

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        const indexTip = landmarks[8];
        const isIndexUp = landmarks[8].y < landmarks[6].y;
        const isMiddleUp = landmarks[12].y < landmarks[10].y;
        const isRingUp = landmarks[16].y < landmarks[14].y;
        const isPinkyUp = landmarks[20].y < landmarks[18].y;

        const palmOpen = isIndexUp && isMiddleUp && isRingUp && isPinkyUp;
        // Draw Only when index is UP and middle is DOWN (consistent gesture)
        const indexOnly = isIndexUp && !isMiddleUp;

        const x = indexTip.x * canvasElement.width;
        const y = indexTip.y * canvasElement.height;

        // Broadcast Pointer
        syncToClient('pointer', { x, y, visible: true });

        if (palmOpen) {
            gestureStatus.innerText = "Gestures: Erasing";
            gestureStatus.style.color = "#ff4d4d";
            ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
            points = [];
            syncToClient('clear', null);
            drawing = false;
        } else if (isIndexUp) {
            // Laser pointer is always shown if pointing
            drawPointer(pCtx, x, y);

            // If Draw Mode is ON, we draw. We no longer require "index ONLY" 
            // because the user already explicitly turned on Draw Mode.
            if (isDrawMode) {
                gestureStatus.innerText = "Gestures: Drawing";
                gestureStatus.style.color = "#3a86ff";
                if (!drawing) {
                    drawing = true;
                    lastX = x;
                    lastY = y;
                }
                drawStroke(lastX, lastY, x, y);
                points.push({ lx: lastX, ly: lastY, nx: x, ny: y });
                syncToClient('draw', { lx: lastX, ly: lastY, nx: x, ny: y });
                lastX = x;
                lastY = y;
            } else {
                gestureStatus.innerText = "Gestures: Pointing";
                gestureStatus.style.color = "#ffd166";
                drawing = false;
            }
        } else {
            gestureStatus.innerText = "Gestures: Idle";
            gestureStatus.style.color = "white";
            drawing = false;
            syncToClient('pointer', { visible: false });
        }
    } else {
        gestureStatus.innerText = "Gestures: No Hand";
        gestureStatus.style.color = "white";
        drawing = false;
        syncToClient('pointer', { visible: false });
    }
    ctx.restore();
});

function drawPointer(context, x, y) {
    context.beginPath();
    context.arc(x, y, 8, 0, Math.PI * 2);
    context.fillStyle = 'rgba(255, 0, 0, 0.6)';
    context.fill();
    context.strokeStyle = 'white';
    context.lineWidth = 2;
    context.stroke();
}

const camera = new Camera(videoElement, {
    onFrame: async () => {
        await hands.send({ image: videoElement });
    },
    width: 1280,
    height: 720,
});
camera.start();

// checkPalmOpen is now handled inline for better precision

function drawStroke(x1, y1, x2, y2) {
    ctx.strokeStyle = '#3a86ff';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}

// --- File Handling ---
fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'pdf') {
        renderPDF(file);
    } else if (ext === 'docx') {
        renderWord(file);
    } else if (ext === 'xlsx') {
        renderExcel(file);
    } else if (ext === 'mp4' || ext === 'mov') {
        renderVideo(file);
    }

    document.getElementById('now-reading').innerText = `Reading: ${file.name}`;
};

async function renderPDF(file) {
    if (isLive) syncToClient('render-pdf-file', { file });

    const reader = new FileReader();
    reader.onload = async function () {
        const typedarray = new Uint8Array(this.result);
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
        const pdf = await pdfjsLib.getDocument(typedarray).promise;
        fileRenderArea.innerHTML = '';

        let fullText = "";
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            fullText += textContent.items.map(item => item.str).join(' ');

            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement('canvas');
            canvas.style.width = "100%";
            canvas.className = "pdf-page-canvas";
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: context, viewport: viewport }).promise;
            fileRenderArea.appendChild(canvas);
        }
        setupSpeech(fullText);
        resizeCanvas();
    };
    reader.readAsArrayBuffer(file);
}

async function renderWord(file) {
    const reader = new FileReader();
    reader.onload = async function (e) {
        const result = await mammoth.convertToHtml({ arrayBuffer: e.target.result });
        fileRenderArea.innerHTML = `<div class="doc-text">${result.value}</div>`;
        setupSpeech(fileRenderArea.innerText);
        syncToClient('render-doc', { html: fileRenderArea.innerHTML });
    };
    reader.readAsArrayBuffer(file);
}

function renderExcel(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const html = XLSX.utils.sheet_to_html(sheet);
        fileRenderArea.innerHTML = `<div class="excel-table">${html}</div>`;
        syncToClient('render-doc', { html: fileRenderArea.innerHTML });
    };
    reader.readAsArrayBuffer(file);
}

function renderVideo(file) {
    const url = URL.createObjectURL(file);
    fileRenderArea.innerHTML = `<video controls autoplay style="width:100%"><source src="${url}"></video>`;
    syncToClient('render-doc', { html: fileRenderArea.innerHTML });
}

// --- Speech Recognition (Albanian) ---
let recognition;
function setupSpeech(text) {
    if (!('webkitSpeechRecognition' in window)) return;

    // Split text into words for highlighting
    const words = text.split(/\s+/).filter(w => w.length > 0);
    fileRenderArea.innerHTML = words.map((w, i) => `<span id="word-${i}" class="transcript-word">${w}</span>`).join(' ');

    recognition = new webkitSpeechRecognition();
    recognition.lang = 'sq-AL'; // Albanian
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
        const result = event.results[event.results.length - 1][0].transcript.toLowerCase();
        // find best match word
        words.forEach((w, i) => {
            if (result.includes(w.toLowerCase())) {
                const el = document.getElementById(`word-${i}`);
                if (el) {
                    el.classList.add('active');
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    syncToClient('highlight', { id: `word-${i}` });
                }
            }
        });
    };
    recognition.start();
}

// --- Keyboard Controls ---
window.onkeydown = (e) => {
    const container = document.getElementById('viewer-container');
    if (e.key === 'ArrowDown') {
        container.scrollBy(0, 50);
        syncToClient('scroll', { top: container.scrollTop + 50 });
    } else if (e.key === 'ArrowUp') {
        container.scrollBy(0, -50);
        syncToClient('scroll', { top: container.scrollTop - 50 });
    }
};

// --- Broadcasting ---
btnLive.onclick = () => {
    isLive = !isLive;
    btnLive.innerText = isLive ? '⬛ STOP LIVE' : '🔴 GO LIVE';
    btnLive.classList.toggle('live');
    if (isLive) {
        // Start streaming camera (simplified version: we just tell client to open its camera or simulated stream)
        // In a real app we'd use WebRTC. For this demo, we'll sync the intent.
        syncToClient('live-start', true);
    } else {
        syncToClient('live-stop', false);
    }
};

function syncToClient(type, payload) {
    if (!isLive) return;
    channel.postMessage({ type, payload });
}
