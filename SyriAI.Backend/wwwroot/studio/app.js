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

// Slide Visual Logic
const slideOverlay = document.getElementById('slide-overlay');
const slideCanvas = document.getElementById('slide-canvas');
const slideCtx = slideCanvas.getContext('2d');
const slideImg = document.getElementById('slide-img');
const slideVideo = document.getElementById('slide-video');
const slideNumDisplay = document.getElementById('slide-num');
const prevSlideBtn = document.getElementById('prev-slide');
const nextSlideBtn = document.getElementById('next-slide');
const closeSlideBtn = document.getElementById('close-slide');

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
let localStream = null;
let isAutoScrolling = false;
let scrollSpeed = 10; 
let lastScrollTime = 0;
let currentPdf = null;
let currentSlideNum = 1;
let isBlurActive = false;
let isStudioBgActive = false;
let isRecording = false;
let isDrawMode = false;
const drawModeBtn = document.getElementById('draw-mode-btn');

// Digital Clock Logic
function updateClock() {
    if (!clockDisplay) return;
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

// Auto-Scroll Logic (moved to top)

autoScrollBtn.addEventListener('click', () => {
    isAutoScrolling = !isAutoScrolling;
    autoScrollBtn.classList.toggle('active', isAutoScrolling);
    if (isAutoScrolling) {
        requestAnimationFrame(scrollStep);
    }
    broadcastUpdate('autoscroll_sync', isAutoScrolling);
});

scrollSpeedInput.addEventListener('input', (e) => {
    scrollSpeed = parseInt(e.target.value);
    speedValDisplay.innerText = scrollSpeed;
    broadcastUpdate('scroll_speed_sync', scrollSpeed);
});

function scrollStep(timestamp) {
    if (!isAutoScrolling) return;

    if (!lastScrollTime) lastScrollTime = timestamp;
    const deltaTime = timestamp - lastScrollTime;
    lastScrollTime = timestamp;

    const scrollAmount = (scrollSpeed / 10) * (deltaTime / 16.67); // Normalized to 60fps
    
    const isDocMode = viewDocBtn.classList.contains('active');
    const container = isDocMode ? pdfViewMain : scrollContainer;

    if (container) {
        container.scrollTop += scrollAmount;
        // Sync to client
        if (isDocMode) broadcastUpdate('pdf_scroll', container.scrollTop);
        else broadcastUpdate('text_scroll', container.scrollTop);
    }

    requestAnimationFrame(scrollStep);
}

scriptInput.addEventListener('input', () => {
    const text = scriptInput.value;
    words = text.trim().split(/\s+/).filter(w => w.length > 0);
    renderScript(words);
    currentWordIndex = 0;
});

function renderScript(wordList) {
    const count = wordList.length;
    if (count > 20000) {
        alert("Dokumenti është shumë i gjatë! Për performancë më të mirë, rekomandohet ta ndani në pjesë më të vogla.");
    }

    // Performance optimization: Using Array and join is much faster than string concatenation
    const htmlArr = new Array(count);
    for (let i = 0; i < count; i++) {
        const word = wordList[i];
        let className = "word-span";
        if (/\d/.test(word)) {
            if (/\d{1,2}[\/\.-]\d{1,2}/.test(word)) className += " hl-date";
            else className += " hl-number";
        } else if (i > 0 && word.length > 3 && /^[A-ZÇË]/.test(word)) {
            className += " hl-name";
        }

        htmlArr[i] = `<span id="word-${i}" class="${className}">${word} </span>`;
    }
    
    scriptDisplay.innerHTML = htmlArr.join('');
    broadcastUpdate('script_update', { words: wordList, html: scriptDisplay.innerHTML });
}

recognition.onresult = (event) => {
    let currentInterim = "";
    for (let i = event.resultIndex; i < event.results.length; ++i) {
        currentInterim += event.results[i][0].transcript;
    }

    const spokenLower = currentInterim.toLowerCase().trim();

    // AI Voice Commands: Control with Speech
    if (spokenLower.includes('stop prompter') || spokenLower.includes('stop gazeta')) {
        isAutoScrolling = false;
        if (autoScrollBtn) autoScrollBtn.classList.remove('active');
        broadcastUpdate('autoscroll_sync', false);
        return;
    }
    if (spokenLower.includes('fillo prompter') || spokenLower.includes('start prompter') || spokenLower.includes('start gazeta')) {
        if (!isAutoScrolling) {
            isAutoScrolling = true;
            if (autoScrollBtn) autoScrollBtn.classList.add('active');
            requestAnimationFrame(scrollStep);
            broadcastUpdate('autoscroll_sync', true);
        }
        return;
    }

    if (spokenLower) {
        matchAndScroll(spokenLower);
        
        // Dynamic HUD Feedback for "Speaking" state
        const videoSegment = document.getElementById('admin-video-segment');
        if (videoSegment) {
            videoSegment.classList.add('speaking');
            clearTimeout(videoSegment.speechTimeout);
            videoSegment.speechTimeout = setTimeout(() => {
                videoSegment.classList.remove('speaking');
            }, 1000);
        }
    }
};

function matchAndScroll(spokenText) {
    // Range to search ahead in the script
    const searchRange = 25;
    const lookAhead = words.slice(currentWordIndex, currentWordIndex + searchRange);

    // Clean spoken words
    const spokenWords = spokenText.split(/\s+/)
        .map(w => w.replace(/[.,!?;]/g, "").toLowerCase())
        .filter(w => w.length > 0);

    if (spokenWords.length === 0) return;

    // Use the last 3 spoken words to find context (trigram or bigram)
    const recentSpoken = spokenWords.slice(-3);
    const lastSpoken = recentSpoken[recentSpoken.length - 1];
    const prevSpoken = recentSpoken.length > 1 ? recentSpoken[recentSpoken.length - 2] : null;

    let bestMatchIndex = -1;
    let matchStrength = 0; // 0: None, 1: Single Word, 2: Bigram/Context

    for (let i = 0; i < lookAhead.length; i++) {
        const scriptWord = lookAhead[i].toLowerCase().replace(/[.,!?;]/g, "");
        if (scriptWord.length < 2) continue;

        // Perfect Match Step 1: Bigram Match (Strength 2)
        // If this word and the previous one match our spoken sequence
        if (i > 0 && prevSpoken) {
            const prevScriptWord = lookAhead[i - 1].toLowerCase().replace(/[.,!?;]/g, "");
            if (scriptWord === lastSpoken && prevScriptWord === prevSpoken) {
                bestMatchIndex = i;
                matchStrength = 2;
                break; // Found the best possible match
            }
        }

        // Good Match Step 2: Single Word Match (Strength 1)
        // Only if we haven't found a bigram yet, and it's not a tiny common word
        if (matchStrength < 2 && scriptWord === lastSpoken && scriptWord.length > 2) {
            // Prefer the earliest match in the look-ahead
            if (bestMatchIndex === -1) {
                bestMatchIndex = i;
                matchStrength = 1;
            }
        }

        // Fuzzy Match Step 3: Prefix for long words
        if (matchStrength < 1 && scriptWord.length > 6 && lastSpoken.length > 4) {
            if (scriptWord.startsWith(lastSpoken.substring(0, 4)) || lastSpoken.startsWith(scriptWord.substring(0, 4))) {
                bestMatchIndex = i;
                matchStrength = 0.5;
            }
        }
    }

    if (bestMatchIndex !== -1) {
        const actualIndex = currentWordIndex + bestMatchIndex;
        highlightWord(actualIndex);

        // Update tracking state
        totalMatches++;
        // Use a small look-back to prevent skipping if we matched slightly ahead
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
    // 1. Teleprompter Text Highlight (Overlay or Normal)
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

    // 2. High-Precision PDF Word Highlight
    if (viewDocBtn.classList.contains('active') && allWordPositions.length > 0) {
        const pdfWord = allWordPositions[index];
        if (pdfWord) {
            // Hide all potential PDF highlights first
            document.querySelectorAll('.pdf-highlight').forEach(el => el.style.display = 'none');

            const hl = document.getElementById(`pdf-hl-${pdfWord.page}`);
            if (hl) {
                hl.style.display = 'block';
                hl.style.left = (pdfWord.nx * 100) + '%';
                hl.style.top = (pdfWord.ny * 100) + '%';
                hl.style.width = (pdfWord.nw * 100) + '%';
                hl.style.height = (pdfWord.nh * 100) + '%';
            }
            broadcastUpdate('pdf_word_highlight', pdfWord);
        }
    }
}

function scrollToWord(index) {
    const wordEl = document.getElementById(`word-${index}`);
    const isDocMode = viewDocBtn.classList.contains('active');

    // If in PDF mode, scroll the document proportionately using page boundaries
    if (isDocMode && words.length > 0 && pageWordBoundaries.length > 0) {
        // Find which page this word is on
        let pageIndex = 0;
        for (let i = 0; i < pageWordBoundaries.length; i++) {
            if (index >= pageWordBoundaries[i]) {
                pageIndex = i;
            } else {
                break;
            }
        }

        // Calculate progress within that specific page
        const startOfPage = pageWordBoundaries[pageIndex];
        const nextStartOfPage = pageWordBoundaries[pageIndex + 1] || words.length;
        const wordsInPage = nextStartOfPage - startOfPage;
        const progressInPage = (index - startOfPage) / Math.max(1, wordsInPage);

        // Get the actual page height in the container
        const pages = pdfViewMain.querySelectorAll('.pdf-page-canvas');
        if (pages[pageIndex]) {
            const pageEl = pages[pageIndex];
            const pageTop = pageEl.offsetTop;
            const pageHeight = pageEl.clientHeight;

            // Target is the top of the page plus the progress within the page, 
            // centered in the viewer
            const targetScroll = pageTop + (progressInPage * pageHeight) - (pdfViewMain.clientHeight / 2);

            pdfViewMain.scrollTo({
                top: Math.max(0, targetScroll),
                behavior: 'smooth'
            });
            broadcastUpdate('pdf_scroll', Math.max(0, targetScroll));
        }
    }

    if (wordEl) {
        // High-performance scroll: use 'instant' if we are moving too fast,
        // or a faster smooth behavior manually.
        // For now, we'll use 'smooth' but with a check.
        const rect = wordEl.getBoundingClientRect();
        const containerRect = scrollContainer.getBoundingClientRect();
        
        // Only scroll if it's not already in the center region
        if (Math.abs(rect.top - (containerRect.top + containerRect.height / 2)) > 100) {
            wordEl.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        }
    }
}
// (Elements moved to top)

async function renderMainPdf() {
    if (!currentPdf) return;
    pdfViewMain.innerHTML = ''; // Clear admin
    
    // We only need to render locally for the Admin. 
    // The client now renders its own pages via 'pdf_buffer_sync'.
    for (let i = 1; i <= currentPdf.numPages; i++) {
        const page = await currentPdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 }); // Admin can have lower scale for performance

        const container = document.createElement('div');
        container.className = 'pdf-page-container';
        container.id = `pdf-page-${i}`;

        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-page-canvas';
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const highlight = document.createElement('div');
        highlight.className = 'pdf-highlight';
        highlight.id = `pdf-hl-${i}`;

        container.appendChild(canvas);
        container.appendChild(highlight);
        pdfViewMain.appendChild(container);

        await page.render({ canvasContext: context, viewport: viewport }).promise;
    }
}

// View Mode Switching
viewTextBtn.addEventListener('click', () => {
    viewTextBtn.classList.add('active');
    viewDocBtn.classList.remove('active');
    scrollContainer.classList.remove('overlay-mode');
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
    // Hide the teleprompter text completely, only show PDF
    scrollContainer.style.display = 'none';
    pdfViewMain.style.display = 'block';
    renderMainPdf();
    broadcastUpdate('view_mode', 'doc');
});

// Throttled Scroll Sync to reduce BroadcastChannel overhead
let lastSyncTime = 0;
function throttledSync(type, value) {
    const now = Date.now();
    if (now - lastSyncTime > 50) { // Max 20 syncs per second
        broadcastUpdate(type, value);
        lastSyncTime = now;
    }
}

pdfViewMain.addEventListener('scroll', () => {
    if (isSyncingScroll) return;
    throttledSync('pdf_scroll', pdfViewMain.scrollTop);
});

scrollContainer.addEventListener('scroll', () => {
    if (isSyncingScroll) return;
    throttledSync('text_scroll', scrollContainer.scrollTop);
});

// Removed side-to-side PDF buttons logic as we now use vertical scroll


// (Elements moved to top)

// PDF State (moved to top)

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

// Studio State (moved to top)

if (drawModeBtn) {
    drawModeBtn.addEventListener('click', () => {
        isDrawMode = !isDrawMode;
        console.log("Draw Mode Toggled:", isDrawMode);
        drawModeBtn.classList.toggle('active', isDrawMode);
        // Visual indicator in AI status
        if (adminMoodFeedback) {
            adminMoodFeedback.innerText = isDrawMode ? "MODI: VIZATIM (ON)" : "MODI: POINTER (OFF)";
        }
    });
}
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
    if (!outCtx) return;

    outCtx.save();
    outCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);

    if (!isBlurActive && !isStudioBgActive) {
        // Mode 1: Normal Camera (No Effects)
        outCtx.drawImage(results.image, 0, 0, outputCanvas.width, outputCanvas.height);
    } else {
        // Mode 2 & 3: Background Effects
        // 1. Draw the background effect (where the person IS NOT)
        outCtx.globalCompositeOperation = 'source-over';
        if (isBlurActive) {
            outCtx.filter = 'blur(15px)';
            outCtx.drawImage(results.image, 0, 0, outputCanvas.width, outputCanvas.height);
            outCtx.filter = 'none';
        } else if (isStudioBgActive) {
            drawProfessionalStudio(outCtx, outputCanvas.width, outputCanvas.height);
        }

        // 2. Clear out the area where the person IS (if we have a mask)
        if (results.segmentationMask) {
            outCtx.globalCompositeOperation = 'destination-out';
            outCtx.drawImage(results.segmentationMask, 0, 0, outputCanvas.width, outputCanvas.height);
            
            // 3. Draw the person back in
            outCtx.globalCompositeOperation = 'destination-over';
            outCtx.drawImage(results.image, 0, 0, outputCanvas.width, outputCanvas.height);
        } else {
            // If no mask, just draw the image normally over the background (or just the image)
            // But usually this branch only happens if no effects active, which is handled earlier.
            outCtx.drawImage(results.image, 0, 0, outputCanvas.width, outputCanvas.height);
        }
    }
    outCtx.restore();

    // Sync to Admin Main View
    if (adminOutCtx && adminOutputCanvas) {
        adminOutCtx.save();
        adminOutCtx.clearRect(0, 0, adminOutputCanvas.width, adminOutputCanvas.height);
        adminOutCtx.drawImage(outputCanvas, 0, 0, adminOutputCanvas.width, adminOutputCanvas.height);
        adminOutCtx.restore();
    }
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

// --- Hand Tracking & Drawing (Admin -> Client) ---
const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});
hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 0, // 0 = Fastest (Great for TVs), 1 = Optimal
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});

hands.onResults(onHandResults);

let lastHandX = null;
let lastHandY = null;

function onHandResults(results) {
    // Smart resize: Only resize if dimensions changed to avoid clearing canvas every frame
    if (adminDrawGlass.width !== adminDrawGlass.clientWidth || adminDrawGlass.height !== adminDrawGlass.clientHeight) {
        resizeAdminCanvas();
    }

    // Clear cursor feedback every frame for smoothness
    adminCursorCtx.clearRect(0, 0, adminCursor.width, adminCursor.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        const indexTip = landmarks[8];
        const indexPip = landmarks[6];
        const middleTip = landmarks[12];
        const middlePip = landmarks[10];

        // Detection: Is finger extended? (Adding buffer for stability)
        const isIndexExtended = indexTip.y < indexPip.y - 0.02;
        const isMiddleExtended = middleTip.y < middlePip.y - 0.02;

        // Palm Open Check (for clearing - 4 or more fingers up)
        const tips = [8, 12, 16, 20];
        let extendedCount = 0;
        tips.forEach(t => {
            if (landmarks[t].y < landmarks[t - 2].y - 0.02) extendedCount++;
        });
        const isPalmOpen = extendedCount >= 4;

        // Normalized mirrored coordinates
        const nx = 1 - indexTip.x;
        const ny = indexTip.y;

        // Visual Feedback Dot (on admin cursor canvas)
        adminCursorCtx.save();
        adminCursorCtx.beginPath();
        adminCursorCtx.arc(nx * adminCursor.width, ny * adminCursor.height, 8, 0, Math.PI * 2);

        // Color Feedback: Red for Draw, Green for Laser, Blue for Clear
        if (isPalmOpen) {
            adminCursorCtx.fillStyle = "#007aff";
        } else if (isIndexExtended) {
            adminCursorCtx.fillStyle = isDrawMode ? "#ff3b30" : "rgba(255, 255, 255, 0.8)";
        } else {
            adminCursorCtx.fillStyle = "rgba(255,255,255,0.4)";
        }

        adminCursorCtx.shadowBlur = 10;
        adminCursorCtx.shadowColor = "white";
        adminCursorCtx.fill();
        adminCursorCtx.restore();

        // Broadcast Pointer Position
        broadcastUpdate('cursor_pos', { nx, ny, visible: true });

        // 1. CLEAR: Palm Open
        if (isPalmOpen) {
            adminDrawCtx.clearRect(0, 0, adminDrawGlass.width, adminDrawGlass.height);
            broadcastUpdate('clear_draw', true);
            lastHandX = null;
            lastHandY = null;
            return;
        }

        // 2. DRAW / POINT: If Index is up
        if (isIndexExtended) {
            // Laser pointer logic is handled by adminCursorCtx above

            // If Draw Mode is ON, we draw. We no longer strictly require index ONLY,
            // trusting the user's toggle state.
            if (isDrawMode && lastHandX !== null) {
                adminDrawCtx.beginPath();
                adminDrawCtx.moveTo(lastHandX * adminDrawGlass.width, lastHandY * adminDrawGlass.height);
                adminDrawCtx.lineTo(nx * adminDrawGlass.width, ny * adminDrawGlass.height);
                adminDrawCtx.strokeStyle = '#ff3b30';
                adminDrawCtx.lineWidth = 6;
                adminDrawCtx.lineCap = 'round';
                adminDrawCtx.lineJoin = 'round';
                adminDrawCtx.stroke();

                broadcastUpdate('draw_segment', {
                    x1: lastHandX,
                    y1: lastHandY,
                    x2: nx,
                    y2: ny,
                    color: '#ff3b30'
                });
            }
            lastHandX = nx;
            lastHandY = ny;
        } else {
            // IDLE
            lastHandX = null;
            lastHandY = null;
        }
    } else {
        lastHandX = null;
        lastHandY = null;
        broadcastUpdate('cursor_pos', { visible: false });
    }
}

// MediaPipe Face Mesh Setup
const faceMesh = new FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
});
faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true, // Keep for gaze but complexity 0 is implied by faceMesh defaults
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
        if (adminAiStatus) {
            adminAiStatus.innerText = "Gaze Tracking: Active";
            adminAiStatus.style.color = "var(--success-color)";
        }

        drawGazeHUD(landmarks[468], landmarks[473]);
        updateMood(landmarks);
    } else {
        aiStatus.innerText = "Gaze Tracking: Searching...";
        aiStatus.style.color = "var(--danger-color)";
        if (adminAiStatus) {
            adminAiStatus.innerText = "Gaze Tracking: Searching...";
            adminAiStatus.style.color = "var(--danger-color)";
        }
        moodFeedback.innerText = "Mood: Calibrating...";
        if (adminMoodFeedback) adminMoodFeedback.innerText = "Mood: Calibrating...";
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
    if (adminMoodFeedback) adminMoodFeedback.innerText = feedback;
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
                
                // BROADCAST FIRST! Before PDF.js detaches/consumes the buffer
                broadcastUpdate('pdf_buffer_sync', { buffer: typedArray });

                // Enhanced robust way to initialize PDF.js for text extraction
                const loadingTask = pdfjsLib.getDocument({
                    data: typedArray.slice(0), // Use a slice/copy here to be 100% safe from detachment
                    disableFontFace: true,
                    nativeImageDecoderSupport: 'none'
                });
                const pdf = await loadingTask.promise;
                let fullText = "";
                allWordPositions = [];
                pageWordBoundaries = [0];

                const totalPages = pdf.numPages;
                for (let i = 1; i <= totalPages; i++) {
                    uploadTrigger.innerText = `⏳ Faqja ${i}/${totalPages}...`;
                    const page = await pdf.getPage(i);
                    const viewport = page.getViewport({ scale: 2.0 });
                    const textContent = await page.getTextContent();

                    // High-precision word extraction
                    textContent.items.forEach(item => {
                        const str = item.str;
                        const trimmedStr = str.trim();
                        if (!trimmedStr) return;

                        const wordsInItem = trimmedStr.split(/\s+/).filter(w => w.length > 0);
                        const transform = item.transform;
                        // Coordinates: vx/vy are the baseline position
                        const [vx, vy] = viewport.convertToViewportPoint(transform[4], transform[5]);

                        let currentSearchPos = 0;
                        wordsInItem.forEach(w => {
                            const wordIdx = str.indexOf(w, currentSearchPos);
                            if (wordIdx === -1) return;

                            // Calculate relative position of word within the string
                            const offsetPercent = wordIdx / str.length;
                            const widthPercent = w.length / str.length;

                            const itemWidth = item.width * 2.0;
                            const itemHeight = item.height * 2.0;

                            const wordX = vx + (offsetPercent * itemWidth);
                            const wordW = widthPercent * itemWidth;

                            allWordPositions.push({
                                text: w,
                                page: i,
                                nx: (wordX - 2) / viewport.width, // Slight left offset for padding
                                ny: (vy - (itemHeight * 1.15)) / viewport.height, // Better vertical centering
                                nw: (wordW + 4) / viewport.width, // Extra width for glow padding
                                nh: (itemHeight * 1.3) / viewport.height // Taller box to cover ascenders/descenders
                            });
                            currentSearchPos = wordIdx + w.length;
                        });
                    });

                    const pageText = textContent.items.map(item => item.str).join(" ");
                    fullText += pageText + "\n\n";

                    const wordCount = pageText.trim().split(/\s+/).filter(w => w.length > 0).length;
                    pageWordBoundaries.push(pageWordBoundaries[pageWordBoundaries.length - 1] + wordCount);
                }

                if (fullText.trim().length < 5) {
                    throw new Error("Ky PDF nuk ka tekst të lexueshëm (mund të jetë vetëm foto). Shkarkoni një PDF me tekst.");
                }

                scriptInput.value = fullText.trim();
                uploadTrigger.innerText = "✅ U ngarkua!";

                // Visual Slide Setup
                currentPdf = pdf;
                currentSlideNum = 1;

                // (Broadcast moved to top for performance)

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
        reader.onload = function () {
            const dataUrl = this.result;
            slideOverlay.style.display = 'block';
            slideCanvas.style.display = 'none';
            slideVideo.style.display = 'none';
            slideImg.style.display = 'block';
            slideImg.src = dataUrl;
            uploadTrigger.innerText = "✅ Foto u ngarkua";
            
            broadcastUpdate('slide_update', { 
                image: dataUrl, 
                show: true, 
                type: 'image' 
            });
        };
        reader.readAsDataURL(file);
    } else if (file.type.startsWith("video/")) {
        reader.onload = function () {
            const dataUrl = this.result;
            slideOverlay.style.display = 'block';
            slideCanvas.style.display = 'none';
            slideImg.style.display = 'none';
            slideVideo.style.display = 'block';
            slideVideo.src = dataUrl;
            uploadTrigger.innerText = "✅ Video u ngarkua";
            
            broadcastUpdate('slide_update', { 
                video: dataUrl, 
                show: true, 
                type: 'video' 
            });
        };
        reader.readAsDataURL(file);
    } else if (file.name.endsWith(".pptx")) {
        // Basic PPTX Handing - Inform user and prepare for next iteration
        alert("Për PPTX rekomandojmë momentalisht konvertimin në PDF për performancë maksimale. Suporti direkt po vjen.");
        uploadTrigger.innerText = "📤 Provoni PDF";
    } else {
        alert("Format i pambështetur. Te lutem përdor PDF, Word, Foto ose Video.");
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

const clearDrawBtn = document.getElementById('clear-client-draw-btn');
clearDrawBtn.addEventListener('click', () => {
    adminDrawCtx.clearRect(0, 0, adminDrawGlass.width, adminDrawGlass.height);
    broadcastUpdate('clear_draw', true);
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

// --- Admin Drawing Sync (to see client markings) ---
function resizeAdminCanvas() {
    if (!adminDrawGlass || !adminCursor) return;
    adminDrawGlass.width = adminDrawGlass.clientWidth;
    adminDrawGlass.height = adminDrawGlass.clientHeight;
    adminCursor.width = adminDrawGlass.clientWidth;
    adminCursor.height = adminDrawGlass.clientHeight;
}
window.addEventListener('resize', resizeAdminCanvas);
resizeAdminCanvas();
setTimeout(resizeAdminCanvas, 1000); // Robust resize after layout

syncChannel.onmessage = (event) => {
    const { type, data } = event.data;
    const isDocMode = viewDocBtn.classList.contains('active');

    if (type === 'draw_segment') {
        const { x1, y1, x2, y2, color } = data;
        adminDrawCtx.beginPath();
        adminDrawCtx.moveTo(x1 * adminDrawGlass.width, y1 * adminDrawGlass.height);
        adminDrawCtx.lineTo(x2 * adminDrawGlass.width, y2 * adminDrawGlass.height);
        adminDrawCtx.strokeStyle = color;
        adminDrawCtx.lineWidth = 6;
        adminDrawCtx.lineCap = 'round';
        adminDrawCtx.lineJoin = 'round';
        adminDrawCtx.shadowBlur = 10;
        adminDrawCtx.shadowColor = 'rgba(255, 59, 48, 0.6)';
        adminDrawCtx.stroke();
    }
    else if (type === 'cursor_pos') {
        const { nx, ny } = data;
        // The adminCursor is cleared by the admin's own hand results every frame,
        // but since they might not be using their hand, we should clear it here if needed
        // or just draw the client dot. 
        adminCursorCtx.beginPath();
        adminCursorCtx.arc(nx * adminCursor.width, ny * adminCursor.height, 8, 0, Math.PI * 2);
        adminCursorCtx.fillStyle = "rgba(52, 199, 89, 0.6)"; // Green for client
        adminCursorCtx.fill();
    }
    else if (type === 'clear_draw') {
        adminDrawCtx.clearRect(0, 0, adminDrawGlass.width, adminDrawGlass.height);
    }
    else if (type === 'nav_next') {
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
        isSyncingScroll = true;
        pdfViewMain.scrollTop = data;
        setTimeout(() => isSyncingScroll = false, 50);
    }
    else if (type === 'text_scroll') {
        isSyncingScroll = true;
        scrollContainer.scrollTop = data;
        setTimeout(() => isSyncingScroll = false, 50);
    }
    else if (type === 'client_ready') {
        // When client connects, wait a tiny bit then send state
        setTimeout(async () => {
            const isDoc = viewDocBtn.classList.contains('active');
            
            // IF A PDF IS LOADED, SEND THE RAW DATA AGAIN FOR THE NEW TAB
            if (currentPdf) {
                const data = await currentPdf.getData();
                broadcastUpdate('pdf_buffer_sync', { buffer: data });
            }

            broadcastUpdate('view_mode', isDoc ? 'doc' : 'text');
            broadcastUpdate('font_size', fontSizeInput.value);
            
            // Send current script
            const text = scriptInput.value;
            const wordsList = text.trim().split(/\s+/).filter(w => w.length > 0);
            renderScript(wordsList);
            
            // Sync current scroll position
            broadcastUpdate('pdf_scroll', pdfViewMain.scrollTop);
            broadcastUpdate('text_scroll', scrollContainer.scrollTop);

            // SYNC LOWER THIRD (BANNER) STATE
            broadcastUpdate('lt_sync', {
                show: ltBanner.style.display === 'flex',
                name: ltNameInput.value || "EMRI JUAJ",
                title: ltTitleInput.value || "Gazetar / Prezantues"
            });
        }, 300);
    }
};

// Start MediaPipe & Camera Automatically
function initCamera() {
    outputCanvas.width = 640;
    outputCanvas.height = 480;
    gazeCanvas.width = 640;
    gazeCanvas.height = 480;
    adminOutputCanvas.width = 1280;
    adminOutputCanvas.height = 720;

    // Visual feedback for fast start
    if (connectionStatus) connectionStatus.innerText = "⏳ Kamera po ndizet...";

    // Request exact resolution for faster hardware initialization
    navigator.mediaDevices.getUserMedia({ 
        video: { 
            width: { ideal: 640 }, 
            height: { ideal: 480 },
            frameRate: { ideal: 30 }
        }, 
        audio: true 
    })
        .then(stream => {
            localStream = stream; // Store globally
            video.srcObject = stream;
            
            // --- INSTANT PREVIEW LOOP ---
            // Draw raw video to canvas immediately while models load
            let isModelReady = false;
            function instantPreview() {
                if (isModelReady) return; // Stop this loop once MediaPipe takes over
                
                // Draw to Admin Canvas
                adminOutCtx.save();
                adminOutCtx.scale(-1, 1);
                adminOutCtx.drawImage(video, -adminOutputCanvas.width, 0, adminOutputCanvas.width, adminOutputCanvas.height);
                adminOutCtx.restore();

                // Draw to Recording/Public Canvas
                outCtx.drawImage(video, 0, 0, outputCanvas.width, outputCanvas.height);
                
                requestAnimationFrame(instantPreview);
            }
            instantPreview();

            const camera = new Camera(video, {
                onFrame: async () => {
                    isModelReady = true; // MediaPipe is now processing
                    
                    // PERFORMANCE TWEAK: Only run segmentation if background effects are active
                    if (isBlurActive || isStudioBgActive) {
                        await selfieSegmentation.send({ image: video });
                    } else {
                        // Fallback: manually draw normal camera if no segmentation
                        onSegmentationResults({ image: video, segmentationMask: null });
                    }

                    // Always run face mesh (gaze tracking) as it's the core feature
                    await faceMesh.send({ image: video });

                    // Run hands only if we need them (Always needed for pointer/feedback, but we can throttle)
                    await hands.send({ image: video });
                },
                width: 640,
                height: 480
            });
            camera.start();
        }).catch(err => {
            console.error("Webcam/Mic error:", err);
            if (connectionStatus) connectionStatus.innerText = "Error: Kamera ose Mikrofoni nuk u gjet";
        });
}

window.addEventListener('load', initCamera);

// --- LOWER THIRDS UI LOGIC ---
const toggleLTBtn = document.getElementById('toggle-lt-btn');
const ltNameInput = document.getElementById('lt-name-input');
const ltTitleInput = document.getElementById('lt-title-input');
const ltBanner = document.getElementById('lower-third');

// Live Update as you type
function updateLTDisplay() {
    const name = ltNameInput.value || "EMRI JUAJ";
    const title = ltTitleInput.value || "Gazetar / Prezantues";
    const isShowing = ltBanner.style.display === 'flex';

    document.getElementById('lt-name-display').innerText = name;
    document.getElementById('lt-title-display').innerText = title;
    
    // Broadcast live update to client
    broadcastUpdate('lt_sync', { show: isShowing, name, title });
}

if (ltNameInput) ltNameInput.addEventListener('input', updateLTDisplay);
if (ltTitleInput) ltTitleInput.addEventListener('input', updateLTDisplay);

if (toggleLTBtn) {
    toggleLTBtn.addEventListener('click', () => {
        const isShowing = ltBanner.style.display === 'flex';
        ltBanner.style.display = isShowing ? 'none' : 'flex';
        
        toggleLTBtn.innerText = isShowing ? "📛 Shfaq Banner-in" : "❌ Hiqe Banner-in";
        toggleLTBtn.classList.toggle('active', !isShowing);

        updateLTDisplay(); // Update & sync
    });
}

// Update the sync handler to include lt_sync
const originalOnMessage = syncChannel.onmessage;
syncChannel.onmessage = (event) => {
    if (originalOnMessage) originalOnMessage(event);
    const { type, data } = event.data;
    if (type === 'lt_sync') {
        const lt = document.getElementById('lower-third');
        if (lt) {
            document.getElementById('lt-name-display').innerText = data.name;
            document.getElementById('lt-title-display').innerText = data.title;
            lt.style.display = data.show ? 'flex' : 'none';
        }
    }
};
