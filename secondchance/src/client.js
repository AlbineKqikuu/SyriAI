// src/client.js
import './style.css';

const channel = new BroadcastChannel('secondchance-live');
const docView = document.getElementById('doc-view');
const videoElement = document.getElementById('remote-video');

// Listen for broadcast messages
channel.onmessage = (event) => {
    const { type, payload } = event.data;

    switch (type) {
        case 'render-doc':
            docView.innerHTML = payload.html;
            resetClientCanvas();
            break;
        case 'render-pdf-file':
            renderPDFonClient(payload.file);
            break;
        case 'draw':
            drawStroke(payload.lx, payload.ly, payload.nx, payload.ny);
            break;
        case 'clear':
            const canvas = document.getElementById('client-annotation-canvas');
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
            break;
        case 'highlight':
            const el = document.getElementById(payload.id);
            if (el) {
                el.classList.add('active');
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            break;
        case 'scroll':
            docView.scrollTo({ top: payload.top, behavior: 'smooth' });
            break;
        case 'live-start':
            document.body.classList.add('live-active');
            startClientCam();
            break;
        case 'live-stop':
            document.body.classList.remove('live-active');
            if (videoElement.srcObject) {
                videoElement.srcObject.getTracks().forEach(track => track.stop());
                videoElement.srcObject = null;
            }
            break;
        case 'pointer':
            updateClientPointer(payload);
            break;
    }
};

function updateClientPointer(data) {
    const canvas = document.getElementById('client-pointer-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (data.visible) {
        ctx.beginPath();
        ctx.arc(data.x, data.y, 12, 0, Math.PI * 2); // Slightly larger for TV
        ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 3;
        ctx.stroke();
    }
}

function getCanvasContext() {
    let canvas = document.getElementById('client-annotation-canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'client-annotation-canvas';
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '100';
        const rect = docView.getBoundingClientRect();
        canvas.width = docView.scrollWidth || rect.width;
        canvas.height = docView.scrollHeight || rect.height;
        docView.style.position = 'relative';
        docView.appendChild(canvas);
    }
    return canvas.getContext('2d');
}

function drawStroke(x1, y1, x2, y2) {
    const ctx = getCanvasContext();
    ctx.strokeStyle = '#3a86ff';
    ctx.lineWidth = 10; // Thicker for TV
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}

async function startClientCam() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        videoElement.srcObject = stream;
    } catch (err) {
        console.error("Camera error:", err);
    }
}

function resetClientCanvas() {
    const oldCanvas = document.getElementById('client-annotation-canvas');
    if (oldCanvas) oldCanvas.remove();
    getCanvasContext();

    // Resize pointer canvas
    const pCanvas = document.getElementById('client-pointer-canvas');
    if (pCanvas) {
        pCanvas.width = docView.scrollWidth || docView.clientWidth;
        pCanvas.height = docView.scrollHeight || docView.clientHeight;
    }
}

async function renderPDFonClient(file) {
    const reader = new FileReader();
    reader.onload = async function () {
        const typedarray = new Uint8Array(this.result);
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
        const pdf = await pdfjsLib.getDocument(typedarray).promise;
        docView.innerHTML = '';

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement('canvas');
            canvas.style.width = "100%";
            canvas.className = "pdf-page-canvas";
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: context, viewport: viewport }).promise;
            docView.appendChild(canvas);
        }
        resetClientCanvas();
    };
    reader.readAsArrayBuffer(file);
}
