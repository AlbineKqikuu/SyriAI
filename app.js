// Web Speech API Setup
const syncChannel = new BroadcastChannel('syriai_sync');

function broadcastUpdate(type, data) {
    syncChannel.postMessage({ type, data });
}

const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
recognition.continuous = true;
recognition.interimResults = true;
recognition.lang = 'sq-AL';

const scriptDisplay = document.getElementById('script-display');
const scrollContainer = document.getElementById('scroll-container');
const fontSizeInput = document.getElementById('font-size');
const scriptInput = document.getElementById('script-input');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const mirrorBtn = document.getElementById('mirror-btn');
const video = document.getElementById('webcam-feed');
const statusBadge = document.getElementById('connection-status');
const clockDisplay = document.getElementById('live-clock');

// Digital Clock Logic
function updateClock() {
    const now = new Date();
    clockDisplay.innerText = now.toLocaleTimeString('sq-AL');
}
setInterval(updateClock, 1000);
updateClock();

// Mirror Mode Toggle
mirrorBtn.addEventListener('click', () => {
    document.body.classList.toggle('mirrored');
    mirrorBtn.classList.toggle('active-btn');
});

let words = [];
let currentWordIndex = 0;
let startTime = null;
let totalMatches = 0;
let totalAttempts = 0;

// Update UI on start
startBtn.addEventListener('click', () => {
    const text = scriptInput.value || scriptDisplay.innerText;
    words = text.trim().split(/\s+/).filter(w => w.length > 0);
    renderScript(words);
    currentWordIndex = 0;
    startTime = Date.now();
    totalMatches = 0;
    totalAttempts = 0;
    updateAnalytics();

    try {
        recognition.start();
        console.log("Speech recognition started");
    } catch (e) {
        console.error("Recognition already started or error:", e);
    }

    // Start Webcam & Mic
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
            video.srcObject = stream;
        }).catch(err => {
            console.error("Webcam/Mic error:", err);
            statusBadge.innerText = "Error: Pajisjet nuk u gjetën";
        });

    // Ensure Client is in the right mode (if PDF is active, show it)
    if (currentPdf) {
        renderMainPdf();
        broadcastUpdate('view_mode', viewDocBtn.classList.contains('active') ? 'doc' : 'text');
    }
});

recognition.onstart = () => {
    statusBadge.innerText = "LIVE / RECORDING";
    statusBadge.classList.add('active');
};

recognition.onerror = (event) => {
    console.error("Speech Recognition Error:", event.error);
    statusBadge.innerText = "Signal Lost: " + event.error;
    statusBadge.classList.remove('active');
};

recognition.onend = () => {
    if (statusBadge.classList.contains('active')) {
        recognition.start();
    }
};

stopBtn.addEventListener('click', () => {
    statusBadge.classList.remove('active');
    recognition.stop();
    statusBadge.innerText = "Standby";
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
    }
});

fontSizeInput.addEventListener('input', (e) => {
    scriptDisplay.style.fontSize = `${e.target.value}rem`;
    broadcastUpdate('font_size', e.target.value);
});

scriptInput.addEventListener('input', () => {
    const text = scriptInput.value;
    words = text.trim().split(/\s+/).filter(w => w.length > 0);
    renderScript(words);
    currentWordIndex = 0;
});

function renderScript(wordList) {
    const html = wordList.map((word, i) => {
        let className = "word-span";
        // Smart Highlighting Logic
        if (/\d{1,2}[\/\.-]\d{1,2}/.test(word)) className += " hl-date"; // Dates
        else if (/\d+/.test(word)) className += " hl-number"; // Numbers
        else if (/^[A-ZÇË][a-zçë]+/.test(word) && i > 0) className += " hl-name"; // Probable Names (Capitals not at start)

        return `<span id="word-${i}" class="${className}">${word} </span>`;
    }).join('');
    scriptDisplay.innerHTML = html;
    broadcastUpdate('script_update', { words: wordList, html: html });
}

recognition.onresult = (event) => {
    let currentInterim = "";
    for (let i = event.resultIndex; i < event.results.length; ++i) {
        currentInterim += event.results[i][0].transcript;
    }

    const spokenLower = currentInterim.toLowerCase().trim();
    if (spokenLower) {
        matchAndScroll(spokenLower);
    }
};

function matchAndScroll(spokenText) {
    // Increased range to 6 words to allow skipping over mispronounced or missed words.
    const searchRange = 6;
    const lookAhead = words.slice(currentWordIndex, currentWordIndex + searchRange);

    const spokenWords = spokenText.split(/\s+/).map(w => w.replace(/[.,!?;]/g, "").toLowerCase());

    // We check the last 2 spoken words to find a match in the upcoming script
    const recentSpoken = spokenWords.slice(-2);

    if (recentSpoken.length === 0) return;

    let matchFoundIndex = -1;

    for (let i = 0; i < lookAhead.length; i++) {
        const scriptWord = lookAhead[i].toLowerCase().replace(/[.,!?;]/g, "");
        if (scriptWord.length < 2) continue;

        // Check if any of our recent spoken words match this script word
        const isMatch = recentSpoken.some(sw =>
            sw === scriptWord ||
            (scriptWord.length > 5 && sw.startsWith(scriptWord.substring(0, 4))) ||
            (sw.length > 5 && scriptWord.startsWith(sw.substring(0, 4)))
        );

        if (isMatch) {
            matchFoundIndex = i;
            break;
        }
    }

    if (matchFoundIndex !== -1) {
        const actualIndex = currentWordIndex + matchFoundIndex;
        highlightWord(actualIndex);

        // Update tracking state
        totalMatches++;
        currentWordIndex = actualIndex + 1;
        scrollToWord(actualIndex);
        updateAnalytics();
    }
    totalAttempts++;
}

function updateAnalytics() {
    if (!startTime) return;

    // WPM Calculation
    const elapsedMins = (Date.now() - startTime) / 60000;
    const wpm = elapsedMins > 0 ? Math.round(currentWordIndex / elapsedMins) : 0;
    document.getElementById('stat-wpm').innerText = wpm;

    // Remaining Time
    const wordsLeft = words.length - currentWordIndex;
    const secondsLeft = wpm > 0 ? Math.round((wordsLeft / wpm) * 60) : 0;
    const mins = Math.floor(secondsLeft / 60);
    const secs = secondsLeft % 60;
    document.getElementById('stat-time').innerText = `${mins}:${secs.toString().padStart(2, '0')}`;

    // Accuracy (Matches / Recognition results)
    const acc = totalAttempts > 0 ? Math.round((totalMatches / totalAttempts) * 100) : 100;
    document.getElementById('stat-acc').innerText = acc + "%";
}

function highlightWord(index) {
    for (let i = 0; i <= index; i++) {
        const el = document.getElementById(`word-${i}`);
        if (el) el.classList.add('read');
    }

    document.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));
    const wordEl = document.getElementById(`word-${index}`);
    if (wordEl) {
        wordEl.classList.add('highlight');
        broadcastUpdate('highlight_update', index);
    }
}

function scrollToWord(index) {
    const wordEl = document.getElementById(`word-${index}`);
    const isDocMode = viewDocBtn.classList.contains('active');

    // If in PDF mode, scroll the document proportionately
    if (isDocMode && words.length > 0) {
        const scrollPercent = index / words.length;
        const targetScroll = Math.max(0, (scrollPercent * pdfViewMain.scrollHeight) - (pdfViewMain.clientHeight / 2));
        pdfViewMain.scrollTo({
            top: targetScroll,
            behavior: 'smooth'
        });
        broadcastUpdate('pdf_scroll', targetScroll);
    }

    if (wordEl) {
        wordEl.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest'
        });
    }
}
// Video and Canvas Overlay Setup
const outputCanvas = document.getElementById('output-canvas');
const outCtx = outputCanvas.getContext('2d');
const gazeCanvas = document.getElementById('gaze-canvas');
const gazeCtx = gazeCanvas.getContext('2d');
const aiStatus = document.getElementById('ai-status');
const moodFeedback = document.getElementById('mood-feedback');
const blurBtn = document.getElementById('blur-btn');
const studioBgBtn = document.getElementById('studio-bg-btn');
const recordBtn = document.getElementById('record-btn');
const fileUpload = document.getElementById('file-upload');
const uploadTrigger = document.getElementById('upload-trigger');
const connectionStatus = document.getElementById('connection-status');

// New UI Elements for Main PDF View
const pdfViewMain = document.getElementById('pdf-view-main');
const pdfMainCanvas = document.getElementById('pdf-main-canvas');
const pdfMainCtx = pdfMainCanvas.getContext('2d');
const mainPdfNum = document.getElementById('main-pdf-num');
const mainPrevBtn = document.getElementById('main-prev-pdf');
const mainNextBtn = document.getElementById('main-next-pdf');
const viewTextBtn = document.getElementById('view-text-btn');
const viewDocBtn = document.getElementById('view-doc-btn');
const openClientBtn = document.getElementById('open-client-btn');

async function renderMainPdf() {
    if (!currentPdf) return;
    pdfViewMain.innerHTML = ''; // Clear admin
    broadcastUpdate('pdf_clear', true); // Clear client

    for (let i = 1; i <= currentPdf.numPages; i++) {
        const page = await currentPdf.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-page-canvas';
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport: viewport }).promise;
        pdfViewMain.appendChild(canvas);

        // Broadcast page to client
        const pageData = canvas.toDataURL('image/webp', 0.6);
        broadcastUpdate('pdf_page_chunk', pageData);

        if (i === 1) {
            broadcastUpdate('view_mode', 'doc');
        }
    }
}

// View Mode Switching
viewTextBtn.addEventListener('click', () => {
    viewTextBtn.classList.add('active');
    viewDocBtn.classList.remove('active');
    scrollContainer.style.display = 'block';
    pdfViewMain.style.display = 'none';
    broadcastUpdate('view_mode', 'text');
});

viewDocBtn.addEventListener('click', () => {
    if (!currentPdf) {
        alert("Ju lutem ngarkoni një PDF fillimisht.");
        return;
    }
    viewDocBtn.classList.add('active');
    viewTextBtn.classList.remove('active');
    scrollContainer.style.display = 'none';
    pdfViewMain.style.display = 'block';
    renderMainPdf(); // Initial continuous render
    broadcastUpdate('view_mode', 'doc');
});

// Removed side-to-side PDF buttons logic as we now use vertical scroll


// Slide Visual Logic
const slideOverlay = document.getElementById('slide-overlay');
const slideCanvas = document.getElementById('slide-canvas');
const slideCtx = slideCanvas.getContext('2d');
const slideNumDisplay = document.getElementById('slide-num');
const prevSlideBtn = document.getElementById('prev-slide');
const nextSlideBtn = document.getElementById('next-slide');
const closeSlideBtn = document.getElementById('close-slide');

let currentPdf = null;
let currentSlideNum = 1;

async function renderSlide(num) {
    if (!currentPdf) return;
    const page = await currentPdf.getPage(num);
    // Increase scale for high-definition rendering (Retina-ready)
    const viewport = page.getViewport({ scale: 2.5 });
    slideCanvas.height = viewport.height;
    slideCanvas.width = viewport.width;

    const renderCtx = {
        canvasContext: slideCtx,
        viewport: viewport,
        enableWebGL: true
    };
    await page.render(renderCtx).promise;
    slideNumDisplay.innerText = `Sllajdi ${num} / ${currentPdf.numPages}`;

    // Broadcast the slide image to client with higher quality
    const slideData = slideCanvas.toDataURL('image/webp', 0.85);
    broadcastUpdate('slide_update', {
        image: slideData,
        show: true,
        fullView: slideOverlay.classList.contains('maximized')
    });
}

prevSlideBtn.addEventListener('click', () => {
    if (currentSlideNum <= 1) return;
    currentSlideNum--;
    renderSlide(currentSlideNum);
});

nextSlideBtn.addEventListener('click', () => {
    if (currentPdf && currentSlideNum >= currentPdf.numPages) return;
    currentSlideNum++;
    renderSlide(currentSlideNum);
});

const maxSlideBtn = document.getElementById('max-slide');
maxSlideBtn.addEventListener('click', () => {
    slideOverlay.classList.toggle('maximized');
    // Re-render to adapt to new size if needed, though canvas scales via CSS mostly
    // We send a broadcast update to sync the "Full View" state on client
    broadcastUpdate('slide_update', {
        show: true,
        fullView: slideOverlay.classList.contains('maximized')
    });
});

closeSlideBtn.addEventListener('click', () => {
    slideOverlay.style.display = 'none';
    slideOverlay.classList.remove('maximized');
    broadcastUpdate('slide_update', { show: false });
});

// 1. INITIALIZE STUDIO BACKGROUND IMAGE
const studioBgImg = new Image();
studioBgImg.src = 'news_bg.jpg';
let bgLoaded = false;
studioBgImg.onload = () => { bgLoaded = true; };

let stream;
let recorder;

// PDF.js Worker Setup
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let isBlurActive = false;
let isStudioBgActive = false;
let isRecording = false;
let mediaRecorder;
let recordedChunks = [];

// Load Studio Background
// The previous studioImg variable is replaced by studioBgImg and bgLoaded logic.

// Selfie Segmentation Setup
const selfieSegmentation = new SelfieSegmentation({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
});
selfieSegmentation.setOptions({ modelSelection: 1 });
selfieSegmentation.onResults(onSegmentationResults);

function onSegmentationResults(results) {
    outCtx.save();
    outCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
    outCtx.drawImage(results.segmentationMask, 0, 0, outputCanvas.width, outputCanvas.height);

    outCtx.globalCompositeOperation = 'source-out';
    if (isBlurActive) {
        outCtx.filter = 'blur(15px)';
        outCtx.drawImage(results.image, 0, 0, outputCanvas.width, outputCanvas.height);
        outCtx.filter = 'none';
    } else if (isStudioBgActive) {
        drawProfessionalStudio(outCtx, outputCanvas.width, outputCanvas.height);
    } else {
        outCtx.fillStyle = 'black';
        outCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
    }

    outCtx.globalCompositeOperation = 'destination-atop';
    outCtx.drawImage(results.image, 0, 0, outputCanvas.width, outputCanvas.height);
    outCtx.restore();
}

function drawProfessionalStudio(ctx, w, h) {
    if (bgLoaded) {
        // Draw the user provided high-quality news background
        ctx.drawImage(studioBgImg, 0, 0, w, h);
    } else {
        // Fallback to high-end procedural background if image fails
        const wallGrad = ctx.createLinearGradient(0, 0, 0, h);
        wallGrad.addColorStop(0, '#000814');
        wallGrad.addColorStop(0.5, '#001d3d');
        wallGrad.addColorStop(1, '#000814');
        ctx.fillStyle = wallGrad;
        ctx.fillRect(0, 0, w, h);
    }

    // Overlay the Official Desk for depth and realism
    const deskPath = new Path2D();
    deskPath.moveTo(0, h * 0.75);
    deskPath.bezierCurveTo(w * 0.2, h * 0.62, w * 0.8, h * 0.62, w, h * 0.75);
    deskPath.lineTo(w, h);
    deskPath.lineTo(0, h);
    deskPath.closePath();

    // Desk Base - Glass/Metallic Gradient
    const deskGrad = ctx.createLinearGradient(0, h * 0.65, 0, h);
    deskGrad.addColorStop(0, '#ffffff'); // Glossy Highlight
    deskGrad.addColorStop(0.05, '#c0c0c0');
    deskGrad.addColorStop(0.3, '#1a1a1a');
    deskGrad.addColorStop(1, '#000000');

    ctx.fillStyle = deskGrad;
    ctx.fill(deskPath);

    // Subtle LED Accent underneath the desk
    ctx.strokeStyle = '#007aff';
    ctx.lineWidth = 3;
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#007aff';
    ctx.beginPath();
    ctx.moveTo(0, h * 0.75);
    ctx.bezierCurveTo(w * 0.2, h * 0.62, w * 0.8, h * 0.62, w, h * 0.75);
    ctx.stroke();
    ctx.shadowBlur = 0;
}

// MediaPipe Face Mesh Setup
const faceMesh = new FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
});
faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});
faceMesh.onResults(onFaceResults);

function onFaceResults(results) {
    gazeCtx.clearRect(0, 0, gazeCanvas.width, gazeCanvas.height);
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const landmarks = results.multiFaceLandmarks[0];
        aiStatus.innerText = "Gaze Tracking: Active";
        aiStatus.style.color = "var(--success-color)";

        drawGazeHUD(landmarks[468], landmarks[473]);
        updateMood(landmarks);
    } else {
        aiStatus.innerText = "Gaze Tracking: Searching...";
        aiStatus.style.color = "var(--danger-color)";
        moodFeedback.innerText = "Mood: Calibrating...";
    }
}

function drawGazeHUD(left, right) {
    const w = gazeCanvas.width;
    const h = gazeCanvas.height;
    gazeCtx.strokeStyle = "rgba(0, 122, 255, 0.5)";
    gazeCtx.lineWidth = 1;
    gazeCtx.fillStyle = "var(--accent-color)";
    gazeCtx.beginPath();
    gazeCtx.arc(left.x * w, left.y * h, 3, 0, Math.PI * 2);
    gazeCtx.arc(right.x * w, right.y * h, 3, 0, Math.PI * 2);
    gazeCtx.fill();

    const isLookingCentrally = Math.abs(left.x - 0.5) < 0.05 && Math.abs(left.y - 0.5) < 0.15;
    gazeCtx.fillStyle = isLookingCentrally ? "rgba(52, 199, 89, 0.6)" : "rgba(255, 59, 48, 0.6)";
    gazeCtx.font = "bold 12px Inter";
    gazeCtx.fillText(isLookingCentrally ? "EYE CONTACT ALIGNED" : "CORRECTING GAZE...", 10, 25);
}

function updateMood(landmarks) {
    const mouthWidth = Math.sqrt(Math.pow(landmarks[291].x - landmarks[61].x, 2) + Math.pow(landmarks[291].y - landmarks[61].y, 2));
    const mouthHeight = Math.abs(landmarks[14].y - landmarks[13].y);
    const smileRatio = mouthWidth / (mouthHeight || 0.1);

    let feedback = "Mood: Neutral";
    if (smileRatio > 4.5) feedback = "Mood: Profesionist & Buzëqeshur 😊";
    else if (mouthHeight > 0.04) feedback = "Mood: Duke folur rrjedhshëm 🎙️";

    const isLookingCentrally = Math.abs(landmarks[468].x - 0.5) < 0.06;
    if (!isLookingCentrally) feedback += " | SHIKO KAMERËN! 👁️";

    moodFeedback.innerText = feedback;
}

// File Upload Handling
uploadTrigger.addEventListener('click', () => fileUpload.click());

fileUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    uploadTrigger.innerText = "⏳ Duke procesuar...";
    const reader = new FileReader();

    if (file.type === "application/pdf") {
        reader.onload = async function () {
            try {
                const typedArray = new Uint8Array(this.result);
                // Enhanced robust way to initialize PDF.js for text extraction
                const loadingTask = pdfjsLib.getDocument({
                    data: typedArray,
                    disableFontFace: true,
                    nativeImageDecoderSupport: 'none'
                });
                const pdf = await loadingTask.promise;
                let fullText = "";
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => item.str).join(" ");
                    fullText += pageText + "\n\n";
                }

                if (fullText.trim().length < 5) {
                    throw new Error("Ky PDF nuk ka tekst të lexueshëm (mund të jetë vetëm foto). Shkarkoni një PDF me tekst.");
                }

                scriptInput.value = fullText.trim();
                uploadTrigger.innerText = "✅ U ngarkua!";

                // Visual Slide Setup
                currentPdf = pdf;
                currentSlideNum = 1;

                // Automatically switch to DOCUMENT View
                viewDocBtn.click();

                // Hide the small overlay as we are now in Main View
                slideOverlay.style.display = 'none';

                scriptInput.dispatchEvent(new Event('input'));
            } catch (err) {
                console.error("Detailed PDF Error:", err);
                alert("GABIM: " + err.message);
                uploadTrigger.innerText = "❌ Provoni përsëri";
            }
        };
        reader.readAsArrayBuffer(file);
    } else if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        reader.onload = async function () {
            try {
                const result = await mammoth.extractRawText({ arrayBuffer: this.result });
                scriptInput.value = result.value;
                uploadTrigger.innerText = "✅ Word u ngarkua";
                scriptInput.dispatchEvent(new Event('input'));
            } catch (err) {
                uploadTrigger.innerText = "❌ Gabim Word";
            }
        };
        reader.readAsArrayBuffer(file);
    } else if (file.type.startsWith("image/")) {
        // Very basic "mock" image extract - images normally need OCR like Tesseract.js
        // For now, prompt the user.
        alert("Për foto rekomandojmë formatin PDF ose Word. OCR do të vijë së shpejti.");
        uploadTrigger.innerText = "📤 Ngarko File";
    } else {
        alert("Format i pambështetur. Te lutem përdor PDF ose Word.");
        uploadTrigger.innerText = "📤 Ngarko File";
    }
});

// Recording Logic
recordBtn.addEventListener('click', () => {
    if (!isRecording) startRecording();
    else stopRecording();
});

function startRecording() {
    recordedChunks = [];
    const stream = outputCanvas.captureStream(30);
    if (video.srcObject && video.srcObject.getAudioTracks().length > 0) {
        stream.addTrack(video.srcObject.getAudioTracks()[0]);
    }
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    mediaRecorder.ondataavailable = (e) => recordedChunks.push(e.data);
    mediaRecorder.onstop = saveRecording;
    mediaRecorder.start();
    isRecording = true;
    recordBtn.innerText = "🛑 STOP REC";
    recordBtn.classList.add('recording');
}

function stopRecording() {
    mediaRecorder.stop();
    isRecording = false;
    recordBtn.innerText = "🔴 RECORD";
    recordBtn.classList.remove('recording');
}

function saveRecording() {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SyriAI_Session_${new Date().getTime()}.webm`;
    a.click();
}

// Open Client View in a new tab
openClientBtn.addEventListener('click', () => {
    window.open('client.html', '_blank');
});

// Button Listeners
blurBtn.addEventListener('click', () => {
    isBlurActive = !isBlurActive;
    isStudioBgActive = false;
    blurBtn.classList.toggle('active', isBlurActive);
    studioBgBtn.classList.remove('active');
});

studioBgBtn.addEventListener('click', () => {
    isStudioBgActive = !isStudioBgActive;
    isBlurActive = false;
    studioBgBtn.classList.toggle('active', isStudioBgActive);
    blurBtn.classList.remove('active');
});

// Keyboard & Remote Navigation
window.addEventListener('keydown', (e) => {
    // Avoid navigation when typing
    if (['TEXTAREA', 'INPUT'].includes(document.activeElement.tagName)) return;

    const isDocMode = viewDocBtn.classList.contains('active');

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        if (isDocMode) {
            // Smooth vertical scroll like a PDF app
            pdfViewMain.scrollTop += 150;
            broadcastUpdate('pdf_scroll', pdfViewMain.scrollTop);
        } else {
            // Navigate by word in text mode
            currentWordIndex = Math.min(words.length - 1, currentWordIndex + 1);
            highlightWord(currentWordIndex);
            scrollToWord(currentWordIndex);
            updateAnalytics();
        }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        if (isDocMode) {
            pdfViewMain.scrollTop -= 150;
            broadcastUpdate('pdf_scroll', pdfViewMain.scrollTop);
        } else {
            // Navigate by word in text mode
            currentWordIndex = Math.max(0, currentWordIndex - 1);
            highlightWord(currentWordIndex);
            scrollToWord(currentWordIndex);
            updateAnalytics();
        }
    }
});

syncChannel.onmessage = (event) => {
    const { type, data } = event.data;
    const isDocMode = viewDocBtn.classList.contains('active');

    if (type === 'nav_next') {
        if (isDocMode) {
            pdfViewMain.scrollTop += 150;
            broadcastUpdate('pdf_scroll', pdfViewMain.scrollTop);
        } else {
            currentWordIndex = Math.min(words.length - 1, currentWordIndex + 1);
            highlightWord(currentWordIndex);
            scrollToWord(currentWordIndex);
            updateAnalytics();
        }
    }
    else if (type === 'nav_prev') {
        if (isDocMode) {
            pdfViewMain.scrollTop -= 150;
            broadcastUpdate('pdf_scroll', pdfViewMain.scrollTop);
        } else {
            currentWordIndex = Math.max(0, currentWordIndex - 1);
            highlightWord(currentWordIndex);
            scrollToWord(currentWordIndex);
            updateAnalytics();
        }
    }
    else if (type === 'pdf_scroll') {
        pdfViewMain.scrollTop = data;
    }
    else if (type === 'client_ready') {
        // When client connects, wait a tiny bit then send state
        setTimeout(() => {
            const isDoc = viewDocBtn.classList.contains('active');
            if (currentPdf && isDoc) renderMainPdf();
            broadcastUpdate('view_mode', isDoc ? 'doc' : 'text');
            broadcastUpdate('font_size', fontSizeInput.value);
            // Repost script content just in case
            const text = scriptInput.value;
            const wordsList = text.trim().split(/\s+/).filter(w => w.length > 0);
            renderScript(wordsList);
        }, 300);
    }
};

// Start MediaPipe
startBtn.addEventListener('click', () => {
    // ... (Previous logic remains)
    outputCanvas.width = 640;
    outputCanvas.height = 480;
    gazeCanvas.width = 640;
    gazeCanvas.height = 480;

    const camera = new Camera(video, {
        onFrame: async () => {
            await selfieSegmentation.send({ image: video });
            await faceMesh.send({ image: video });
        },
        width: 640,
        height: 480
    });
    camera.start();
});
