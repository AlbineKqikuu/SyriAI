// Web Speech API Setup
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

    // Start Webcam
    navigator.mediaDevices.getUserMedia({ video: true })
        .then(stream => {
            video.srcObject = stream;
        }).catch(err => {
            console.error("Webcam error:", err);
            statusBadge.innerText = "Error: Webcam/Mic Blocked";
        });
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
});

function renderScript(wordList) {
    scriptDisplay.innerHTML = wordList.map((word, i) => {
        let className = "word-span";
        // Smart Highlighting Logic
        if (/\d{1,2}[\/\.-]\d{1,2}/.test(word)) className += " hl-date"; // Dates
        else if (/\d+/.test(word)) className += " hl-number"; // Numbers
        else if (/^[A-ZÇË][a-zçë]+/.test(word) && i > 0) className += " hl-name"; // Probable Names (Capitals not at start)

        return `<span id="word-${i}" class="${className}">${word} </span>`;
    }).join('');
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
    }
}

function scrollToWord(index) {
    const wordEl = document.getElementById(`word-${index}`);
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

// PDF.js Worker Setup
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let isBlurActive = false;
let isStudioBgActive = false;
let isRecording = false;
let mediaRecorder;
let recordedChunks = [];

// Load Studio Background
const studioImg = new Image();
studioImg.src = 'virtual_news_studio.png';

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
    const time = Date.now() * 0.001;

    // 1. BACKGROUND: Deep Spatial Blue
    const spaceGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w);
    spaceGrad.addColorStop(0, '#0a0a2a');
    spaceGrad.addColorStop(1, '#000005');
    ctx.fillStyle = spaceGrad;
    ctx.fillRect(0, 0, w, h);

    // 2. 3D PERSPECTIVE GRID FLOOR
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 0, 255, 0.15)'; // Magenta grid
    ctx.lineWidth = 1;
    const horizon = h * 0.6;
    for (let i = -w; i < w * 2; i += 60) {
        ctx.beginPath();
        ctx.moveTo(w / 2, horizon);
        ctx.lineTo(i, h);
        ctx.stroke();
    }
    for (let j = 0; j < 10; j++) {
        let y = horizon + Math.pow(j / 10, 2) * (h - horizon);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }
    ctx.restore();

    // 3. CONCENTRIC NEON RINGS (Circular Motion)
    ctx.save();
    ctx.translate(w / 2, h * 0.4);
    ctx.rotate(time * 0.1);
    for (let r = 0; r < 3; r++) {
        ctx.strokeStyle = r % 2 === 0 ? 'rgba(0, 255, 255, 0.2)' : 'rgba(255, 0, 255, 0.2)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, w * 0.3 + r * 20, h * 0.1, 0, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.restore();

    // 4. THE FUTURISTIC BROADCAST GLOBE (Wireframe Particle Style)
    ctx.save();
    ctx.translate(w / 2, h * 0.4);
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.3)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.ellipse(0, 0, w * 0.15, h * 0.25, (time * 0.2) + (i * Math.PI / 4), 0, Math.PI * 2);
        ctx.stroke();
    }
    // Globe Core Glow
    const coreGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.15);
    coreGlow.addColorStop(0, 'rgba(0, 122, 255, 0.2)');
    coreGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = coreGlow;
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 5. SIDE MONITOR GRAPHICS
    ctx.fillStyle = 'rgba(0, 122, 255, 0.05)';
    ctx.fillRect(w * 0.05, h * 0.1, w * 0.15, h * 0.3);
    ctx.fillRect(w * 0.8, h * 0.1, w * 0.15, h * 0.3);

    // 6. ATMOSPHERIC VIGNETTE
    const vignette = ctx.createRadialGradient(w / 2, h / 2, w * 0.4, w / 2, h / 2, w / 2);
    vignette.addColorStop(0, 'transparent');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.8)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
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
                    throw new Error("PDF nuk ka tekst (mund të jetë vetëm foto). Shkarkoni një PDF me tekst.");
                }

                scriptInput.value = fullText.trim();
                uploadTrigger.innerText = "✅ U ngarkua!";

                // CRITICAL: Force update of teleprompter data
                const newWords = scriptInput.value.trim().split(/\s+/).filter(w => w.length > 0);
                renderScript(newWords);
                words = newWords; // Update global words array
                currentWordIndex = 0; // Reset index

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
