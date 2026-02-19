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
// MediaPipe Face Mesh Setup
const gazeCanvas = document.getElementById('gaze-canvas');
const gazeCtx = gazeCanvas.getContext('2d');
const aiStatus = document.getElementById('ai-status');

const faceMesh = new FaceMesh({
    locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
    }
});

faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});

faceMesh.onResults(onGazeResults);

function onGazeResults(results) {
    gazeCtx.clearRect(0, 0, gazeCanvas.width, gazeCanvas.height);

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const landmarks = results.multiFaceLandmarks[0];
        aiStatus.innerText = "Gaze Tracking: Active";
        aiStatus.style.color = "var(--success-color)";

        // Extract Iris Landmarks (simplified for feedback)
        // Left Eye Iris: landmarks[468]
        // Right Eye Iris: landmarks[473]
        const leftIris = landmarks[468];
        const rightIris = landmarks[473];

        // Draw HUD overlay for thesis demonstration
        drawGazeHUD(leftIris, rightIris);
    } else {
        aiStatus.innerText = "Gaze Tracking: Searching...";
        aiStatus.style.color = "var(--danger-color)";
    }
}

function drawGazeHUD(left, right) {
    const w = gazeCanvas.width;
    const h = gazeCanvas.height;

    gazeCtx.strokeStyle = "rgba(0, 122, 255, 0.5)";
    gazeCtx.lineWidth = 1;

    // Draw iris points
    gazeCtx.fillStyle = "var(--accent-color)";
    gazeCtx.beginPath();
    gazeCtx.arc(left.x * w, left.y * h, 3, 0, Math.PI * 2);
    gazeCtx.arc(right.x * w, right.y * h, 3, 0, Math.PI * 2);
    gazeCtx.fill();

    // Check if looking at camera (near 0.5 center)
    const isLookingCentrally = Math.abs(left.x - 0.5) < 0.05 && Math.abs(left.y - 0.5) < 0.15;

    if (!isLookingCentrally) {
        gazeCtx.fillStyle = "rgba(255, 59, 48, 0.2)";
        gazeCtx.font = "bold 12px Inter";
        gazeCtx.fillText("CORRECTING GAZE...", 10, 25);
    } else {
        gazeCtx.fillStyle = "rgba(52, 199, 89, 0.4)";
        gazeCtx.fillText("EYE CONTACT ALIGNED", 10, 25);
    }
}

// Start MediaPipe when Start button is clicked
startBtn.addEventListener('click', () => {
    // ... existing start logic ...
    const camera = new Camera(video, {
        onFrame: async () => {
            await faceMesh.send({ image: video });
        },
        width: 640,
        height: 480
    });
    camera.start();

    gazeCanvas.width = video.clientWidth;
    gazeCanvas.height = video.clientHeight;
});
