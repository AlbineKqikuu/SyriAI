// SyriAI Studio — Teleprompter: script rendering, speech recognition, word tracking, scrolling and navigation.

// Mirror Mode Toggle
mirrorBtn.addEventListener('click', () => {
    document.body.classList.toggle('mirrored');
    mirrorBtn.classList.toggle('active');
});

// Web Speech API (Chrome / Edge only)
const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognitionImpl ? new SpeechRecognitionImpl() : null;
if (recognition) {
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = studioSettings.speechLang;
}

// Follows the reader through the script (see js/shared/matcher.js)
let tracker = SyriMatcher.createTracker([]);

const countdownOverlay = document.getElementById('countdown-overlay');
let countdownTimer = null;

// The broadcast output shows "starting soon" before the first LIVE and "thank you" after it
let hasBeenLive = false;

function liveStatePayload() {
    return { live: isLive, ended: !isLive && hasBeenLive };
}

function setLiveState(live) {
    isLive = live;
    if (live) hasBeenLive = true;
    broadcastUpdate('live_state', liveStatePayload());
    statusBadge.classList.toggle('active', live);
    statusBadge.classList.remove('error');
    statusBadge.innerText = live ? "LIVE" : "Në pritje";
    startBtn.classList.toggle('is-live', live);
    startBtn.disabled = false;
    setLabel(startBtn, live ? "Rinis nga fillimi" : "Fillo LIVE");
}

function showCountdown(value) {
    countdownOverlay.hidden = value <= 0;
    countdownOverlay.querySelector('span').textContent = value;
    broadcastUpdate('countdown', value);
}

function cancelCountdown() {
    if (!countdownTimer) return;
    clearInterval(countdownTimer);
    countdownTimer = null;
    showCountdown(0);
    startBtn.disabled = false;
}

/**
 * Count down (3-2-1) on the admin and client screens, then call done().
 * Uses a deadline instead of counting ticks, so a busy main thread (e.g. while the AI
 * models load) delays a tick but never stretches the whole countdown.
 */
function runCountdown(seconds, done) {
    if (seconds <= 0) return done();
    const deadline = Date.now() + seconds * 1000;
    let shown = seconds;
    startBtn.disabled = true;
    showCountdown(shown);
    countdownTimer = setInterval(() => {
        const remaining = Math.ceil((deadline - Date.now()) / 1000);
        if (remaining > 0) {
            if (remaining !== shown) showCountdown(shown = remaining);
            return;
        }
        clearInterval(countdownTimer);
        countdownTimer = null;
        showCountdown(0);
        done();
    }, 100);
}

// Update UI on start
startBtn.addEventListener('click', () => {
    if (countdownTimer) return;
    const text = scriptInput.value.trim();
    if (!text) {
        notify("Shkruani ose ngarkoni një skript para se të filloni.", 'warning');
        scriptInput.focus();
        return;
    }
    // Restarting ends (and reports) the running session first
    if (isLive) {
        LiveShow.stop();
        StudioSessionLog.end({ showReport: false });
    }

    setScriptWords(text);
    currentWordIndex = 0;
    scrollContainer.scrollTop = 0;

    runCountdown(studioSettings.countdownSeconds, goLive);
});

function goLive() {
    startTime = Date.now();
    totalMatches = 0;
    totalAttempts = 0;
    updateAnalytics();
    setLiveState(true);
    StudioSessionLog.start();
    LiveShow.start();

    if (!recognition) {
        notify("Ky shfletues nuk mbështet njohjen e zërit (përdorni Chrome ose Edge). Sesioni vazhdon me tastierë ose lëvizje automatike.", 'warning', 7000);
    } else {
        try {
            recognition.start();
        } catch (e) {
            // Already running: restarting the session is enough
        }
    }

    // Ensure Client is in the right mode (if PDF is active, show it)
    if (currentPdf) {
        broadcastUpdate('view_mode', viewDocBtn.classList.contains('active') ? 'doc' : 'text');
    }
}

// Errors after which retrying is pointless (permissions / no microphone)
const FATAL_SPEECH_ERRORS = ['not-allowed', 'service-not-allowed', 'audio-capture'];

if (recognition) {
    recognition.onerror = (event) => {
        // 'no-speech' and 'aborted' happen during normal pauses; onend restarts us
        if (!FATAL_SPEECH_ERRORS.includes(event.error)) return;
        console.error("Speech Recognition Error:", event.error);
        stopSession();
        statusBadge.classList.add('error');
        statusBadge.innerText = "Pa mikrofon";
        notify("Mikrofoni nuk është i disponueshëm. Lejoni qasjen te mikrofoni në shfletues dhe provoni përsëri.", 'error', 7000);
    };

    recognition.onend = () => {
        // Chrome ends recognition after silence; keep listening while live
        if (!isLive) return;
        try {
            recognition.start();
        } catch (e) {
            // Ignore: it is already restarting
        }
    };
}

function stopSession() {
    cancelCountdown();
    const wasLive = isLive;
    setLiveState(false);
    setAutoScroll(false);
    if (recognition) recognition.stop();
    LiveShow.stop();
    // The camera keeps running so the preview and effects stay available
    if (wasLive) StudioSessionLog.end({ showReport: true });
}

stopBtn.addEventListener('click', stopSession);

fontSizeInput.addEventListener('input', (e) => {
    scriptDisplay.style.fontSize = `${e.target.value}rem`;
    fontSizeVal.textContent = e.target.value;
    broadcastUpdate('font_size', e.target.value);
});

function setAutoScroll(on) {
    if (isAutoScrolling === on) return;
    isAutoScrolling = on;
    autoScrollBtn.classList.toggle('active', on);
    autoScrollBtn.setAttribute('aria-pressed', String(on));
    if (on) {
        // Reset the frame clock so resuming does not jump by the paused duration
        lastScrollTime = 0;
        scrollRemainder = 0;
        requestAnimationFrame(scrollStep);
    }
    broadcastUpdate('autoscroll_sync', on);
}

autoScrollBtn.addEventListener('click', () => setAutoScroll(!isAutoScrolling));

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
        // Accumulate sub-pixel amounts so low speeds still move.
        // The container's scroll listener syncs the position to the client.
        scrollRemainder += scrollAmount;
        const whole = Math.trunc(scrollRemainder);
        if (whole !== 0) {
            container.scrollTop += whole;
            scrollRemainder -= whole;
        }
    }

    requestAnimationFrame(scrollStep);
}

/** Split the script into prompter words and stories ("## Title | 1:30" lines), then render it */
function setScriptWords(text) {
    const parsed = SyriRundown.parse(text);
    words = parsed.words;
    rundownSegments = parsed.segments;
    rundownMarked = parsed.marked;
    renderScript(words);
}

function applyScriptText() {
    setScriptWords(scriptInput.value);
    currentWordIndex = 0;
}

// Debounced so typing in a long script does not re-render on every keystroke
let scriptInputTimer = null;
scriptInput.addEventListener('input', () => {
    wordCountDisplay.textContent = `${SyriRundown.parse(scriptInput.value).words.length} fjalë`;
    clearTimeout(scriptInputTimer);
    scriptInputTimer = setTimeout(applyScriptText, 250);
});

const LONG_SCRIPT_WORDS = 20000;
let hasWarnedLongScript = false;

function renderScript(wordList) {
    const count = wordList.length;
    if (count > LONG_SCRIPT_WORDS && !hasWarnedLongScript) {
        hasWarnedLongScript = true;
        notify("Dokumenti është shumë i gjatë. Për performancë më të mirë, ndajeni në pjesë më të vogla.", 'warning', 7000);
    }
    lastReadIndex = -1;
    tracker = SyriMatcher.createTracker(wordList, studioSettings.matcher);
    if (wordCountDisplay) wordCountDisplay.textContent = `${count} fjalë`;

    // Story headings go before the first word of each story (only when the script has "##" lines)
    const headingsAt = new Map();
    if (rundownMarked) {
        rundownSegments.forEach((seg, k) => {
            const html = `<div class="segment-heading" id="segment-${k}"><span class="segment-num">${k + 1}</span>${escapeHtml(seg.title)}</div>`;
            headingsAt.set(seg.start, (headingsAt.get(seg.start) || '') + html);
        });
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

        // The space stays outside the span so underlines and the highlight fit the word
        htmlArr[i] = (headingsAt.get(i) || '') + `<span id="word-${i}" class="${className}">${escapeHtml(word)}</span> `;
    }

    scriptDisplay.innerHTML = htmlArr.join('') + (headingsAt.get(count) || '');
    LiveShow.setSegments(rundownSegments, rundownMarked);
    broadcastUpdate('script_update', { words: wordList, html: scriptDisplay.innerHTML });
}

if (recognition) recognition.onresult = (event) => {
    if (!isLive) return;
    const receivedAt = performance.now();

    let currentInterim = "";
    for (let i = event.resultIndex; i < event.results.length; ++i) {
        currentInterim += event.results[i][0].transcript;
    }

    const spokenLower = currentInterim.toLowerCase().trim();

    // AI Voice Commands: Control with Speech
    if (spokenLower.includes('stop prompter') || spokenLower.includes('stop gazeta')) {
        setAutoScroll(false);
        return;
    }
    if (spokenLower.includes('fillo prompter') || spokenLower.includes('start prompter') || spokenLower.includes('start gazeta')) {
        setAutoScroll(true);
        return;
    }
    if (LiveShow.voiceCommand(spokenLower)) return;

    if (spokenLower) {
        matchAndScroll(spokenLower, receivedAt);

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

function matchAndScroll(spokenText, receivedAt = performance.now()) {
    const index = tracker.update(spokenText);
    if (index === null) return; // No new word in this interim update

    totalAttempts++;
    StudioSessionLog.recordRecognition();
    if (index !== -1) {
        highlightWord(index);
        totalMatches++;
        currentWordIndex = index + 1;
        scrollToWord(index);
        // Time spent from receiving the transcript until the highlight is updated
        StudioSessionLog.recordMatch(index, performance.now() - receivedAt);
        if (tracker.recovered) StudioSessionLog.recordRecovery();
        LiveShow.onPosition(index);
    }
    LiveShow.setLost(tracker.lost, tracker.recovered);
    updateAnalytics();
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
    // Only touch the words between the previous and the new position
    if (index > lastReadIndex) {
        for (let i = lastReadIndex + 1; i <= index; i++) {
            const el = document.getElementById(`word-${i}`);
            if (el) el.classList.add('read');
        }
    } else {
        for (let i = index + 1; i <= lastReadIndex; i++) {
            const el = document.getElementById(`word-${i}`);
            if (el) el.classList.remove('read');
        }
    }
    lastReadIndex = index;

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

// Step forward (+1) or back (-1): scrolls the document, or moves one word in text mode
function navigate(direction) {
    const isDocMode = viewDocBtn.classList.contains('active');
    if (isDocMode) {
        pdfViewMain.scrollTop += 150 * direction;
        broadcastUpdate('pdf_scroll', pdfViewMain.scrollTop);
        return;
    }
    if (words.length === 0) return;
    currentWordIndex = Math.min(words.length - 1, Math.max(0, currentWordIndex + direction));
    highlightWord(currentWordIndex);
    scrollToWord(currentWordIndex);
    tracker.setPosition(currentWordIndex + 1);
    StudioSessionLog.recordNavigation(currentWordIndex);
    LiveShow.onPosition(currentWordIndex);
    LiveShow.setLost(false);
    updateAnalytics();
}

/** Jump to the first word of a story (rundown); the tracker expects that word next */
function jumpToWord(index) {
    if (words.length === 0) return;
    currentWordIndex = Math.min(words.length - 1, Math.max(0, index));
    highlightWord(currentWordIndex);
    scrollToWord(currentWordIndex);
    tracker.setPosition(currentWordIndex);
    StudioSessionLog.recordNavigation(currentWordIndex);
    LiveShow.setLost(false);
    updateAnalytics();
}

// Keyboard & Remote Navigation
const NEXT_KEYS = ['ArrowRight', 'ArrowDown', 'PageDown', ' '];
const PREV_KEYS = ['ArrowLeft', 'ArrowUp', 'PageUp'];

window.addEventListener('keydown', (e) => {
    // Avoid navigation when typing
    if (['TEXTAREA', 'INPUT'].includes(document.activeElement.tagName)) return;

    // Shift + arrow: whole story (rundown) instead of one word
    if (e.shiftKey && (NEXT_KEYS.includes(e.key) || PREV_KEYS.includes(e.key))) {
        e.preventDefault();
        LiveShow.step(NEXT_KEYS.includes(e.key) ? 1 : -1);
    } else if (NEXT_KEYS.includes(e.key)) {
        e.preventDefault();
        navigate(1);
    } else if (PREV_KEYS.includes(e.key)) {
        e.preventDefault();
        navigate(-1);
    }
});
