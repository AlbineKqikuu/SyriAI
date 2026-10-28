// SyriAI Studio — Camera pipeline: MediaPipe background effects, gaze detection, expression feedback and hand drawing.

// 1. INITIALIZE STUDIO BACKGROUND IMAGE
const studioBgImg = new Image();
studioBgImg.src = 'news_bg.jpg';
let bgLoaded = false;
studioBgImg.onload = () => { bgLoaded = true; };

if (drawModeBtn) {
    drawModeBtn.addEventListener('click', () => {
        isDrawMode = !isDrawMode;
        drawModeBtn.classList.toggle('active', isDrawMode);
        notify(isDrawMode ? "Vizatimi u aktivizua — ngrini gishtin tregues për të shkruar, hapni dorën për të fshirë." : "Vizatimi u çaktivizua.", 'info', 3500);
        // Visual indicator in AI status
        if (adminMoodFeedback) {
            adminMoodFeedback.innerText = isDrawMode ? "Modi: Vizatim" : "Modi: Tregues";
        }
    });
}

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
    modelComplexity: 1, // the accurate model: steadier fingertip, fewer lost frames
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.5
});

hands.onResults(onHandResults);

// --- Detection helpers: make the hand robust to tilt, jitter and short dropouts ---

// Part of the camera picture that maps onto the whole prompter, so the presenter
// does not have to reach the edges of the frame.
const HAND_ZONE = { x0: 0.1, x1: 0.9, y0: 0.08, y1: 0.75 };
const HAND_LOST_FRAMES = 4;   // frames without a hand before a line is ended
const PALM_HOLD_MS = 300;     // open hand must be held this long to clear

const handState = {
    pose: 'none',             // stable pose: 'write' | 'point' | 'palm' | 'other'
    candidate: null,
    candidateFrames: 0,
    lostFrames: 0,
    x: 0, y: 0, tracking: false,
    palmSince: 0,
    palmCleared: false,
};

const lmDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** A finger is extended when its tip is clearly further from the wrist than its middle joint (works when the hand is tilted) */
function isFingerUp(lm, tip, pip) {
    return lmDistance(lm[tip], lm[0]) > lmDistance(lm[pip], lm[0]) * 1.12;
}

function rawPose(lm) {
    const index = isFingerUp(lm, 8, 6);
    const middle = isFingerUp(lm, 12, 10);
    const ring = isFingerUp(lm, 16, 14);
    const pinky = isFingerUp(lm, 20, 18);
    if (index && middle && ring && pinky) return 'palm';
    if (index && !middle) return 'write';
    if (index) return 'point';
    // Thumbs up: all fingers folded, thumb pointing up
    if (!middle && !ring && !pinky && lm[4].y < lm[3].y && lm[3].y < lm[2].y && lm[4].y < lm[5].y - 0.06) return 'thumbs';
    return 'other';
}

// 👍 reaction (same as the Board page): emojis float up over the prompter
const reactionsLayer = document.getElementById('admin-reactions');
let lastReaction = 0;

function showReaction(emoji) {
    for (let i = 0; i < 7; i++) {
        const el = document.createElement('span');
        el.className = 'fx-float';
        el.textContent = emoji;
        el.style.left = `${10 + Math.random() * 80}%`;
        el.style.animationDelay = `${i * 90}ms`;
        el.style.fontSize = `${34 + Math.random() * 30}px`;
        el.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`);
        el.style.setProperty('--rise', `${reactionsLayer.clientHeight * (0.6 + Math.random() * 0.4)}px`);
        el.addEventListener('animationend', () => el.remove());
        reactionsLayer.appendChild(el);
    }
}

/** Change pose only after it is seen on consecutive frames (leaving 'write' needs 3) */
function stablePose(pose) {
    if (pose === handState.pose) {
        handState.candidate = null;
        return pose;
    }
    if (pose === handState.candidate) handState.candidateFrames++;
    else { handState.candidate = pose; handState.candidateFrames = 1; }
    if (handState.candidateFrames >= (handState.pose === 'write' ? 3 : 2)) {
        handState.pose = pose;
        handState.candidate = null;
    }
    return handState.pose;
}

/** Fingertip → normalised prompter position, smoothed: steady when slow, responsive when fast */
function smoothFingertip(tip) {
    const zx = Math.min(1, Math.max(0, ((1 - tip.x) - HAND_ZONE.x0) / (HAND_ZONE.x1 - HAND_ZONE.x0)));
    const zy = Math.min(1, Math.max(0, (tip.y - HAND_ZONE.y0) / (HAND_ZONE.y1 - HAND_ZONE.y0)));
    if (!handState.tracking) {
        Object.assign(handState, { x: zx, y: zy, tracking: true });
    } else {
        const a = Math.min(1, 0.3 + Math.hypot(zx - handState.x, zy - handState.y) * 6);
        handState.x += (zx - handState.x) * a;
        handState.y += (zy - handState.y) * a;
    }
    return [handState.x, handState.y];
}


function onHandResults(results) {
    // Smart resize: Only resize if dimensions changed to avoid clearing canvas every frame
    if (adminDrawGlass.width !== adminDrawGlass.clientWidth || adminDrawGlass.height !== adminDrawGlass.clientHeight) {
        resizeAdminCanvas();
    }

    // Clear cursor feedback every frame for smoothness
    adminCursorCtx.clearRect(0, 0, adminCursor.width, adminCursor.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        handState.lostFrames = 0;

        // Stable pose (no flicker between frames) and a smoothed fingertip
        const pose = stablePose(rawPose(landmarks));
        const isPalmOpen = pose === 'palm';
        const isIndexExtended = pose === 'write' || pose === 'point';
        const isMiddleExtended = pose === 'point';
        const [nx, ny] = smoothFingertip(landmarks[8]);

        if (pose === 'thumbs' && performance.now() - lastReaction > 1800) {
            lastReaction = performance.now();
            showReaction('👍');
        }

        // Writing: index finger only, hand writing on and not the spotlight tool
        const isWriting = isDrawMode && !AdminInk.spotlight && isIndexExtended && !isMiddleExtended;
        // The finger moves the spotlight only when finger control ("Gisht") is on
        const isSpotlight = isDrawMode && AdminInk.spotlight && !isPalmOpen;
        if (isSpotlight) AdminInk.pointAt(nx, ny, 'hand');
        else AdminInk.hidePointer('hand');

        // Visual Feedback Dot (on admin cursor canvas)
        adminCursorCtx.save();
        adminCursorCtx.beginPath();
        adminCursorCtx.arc(nx * adminCursor.width, ny * adminCursor.height, 8, 0, Math.PI * 2);

        // Color Feedback: Red for Draw, White for pointer, Blue for Clear
        if (isPalmOpen) {
            adminCursorCtx.fillStyle = "#007aff";
        } else if (isIndexExtended && !isMiddleExtended) {
            adminCursorCtx.fillStyle = isWriting ? AdminInk.color : "rgba(255, 255, 255, 0.8)";
        } else {
            adminCursorCtx.fillStyle = "rgba(255,255,255,0.4)";
        }

        adminCursorCtx.shadowBlur = 10;
        adminCursorCtx.shadowColor = "white";
        adminCursorCtx.fill();
        adminCursorCtx.restore();

        // Broadcast Pointer Position
        broadcastUpdate('cursor_pos', { nx, ny, visible: true, spot: isSpotlight ? AdminInk.spotRadius : 0 });

        // 1. CLEAR: Palm Open (held briefly, so a single wrong frame cannot erase the drawing)
        if (isPalmOpen) {
            AdminInk.end('hand');
            const now = performance.now();
            if (!handState.palmSince) handState.palmSince = now;
            if (!handState.palmCleared && now - handState.palmSince >= PALM_HOLD_MS) {
                handState.palmCleared = true;
                AdminInk.clear(true);
            }
            return;
        }
        handState.palmSince = 0;
        handState.palmCleared = false;

        // 2. WRITE: ONLY Index finger (Middle must be down)
        if (isWriting) {
            if (AdminInk.drawing) AdminInk.extend(nx, ny);
            else AdminInk.begin(nx, ny, 'hand');
        } else {
            AdminInk.end('hand');
        }
    } else {
        // Short dropouts (motion blur, a finger crossing the face) do not break the line
        if (++handState.lostFrames <= HAND_LOST_FRAMES) return;
        Object.assign(handState, { pose: 'none', candidate: null, tracking: false, palmSince: 0, palmCleared: false });
        AdminInk.end('hand');
        AdminInk.hidePointer('hand');
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

// --- Gaze detection ---
// Estimates gaze direction from where each iris sits between the eye corners, combined
// with head yaw (nose position between the face edges). This detects whether the
// presenter looks towards the camera; it does not modify or "correct" the video.
const GAZE_CENTER_TOLERANCE = 0.12; // |ratio − 0.5| accepted as "looking at camera"

// MediaPipe Face Mesh landmark indices (refineLandmarks: true adds the irises 468–477)
const LM = {
    eyeA: { outer: 33, inner: 133, iris: 468 },
    eyeB: { inner: 362, outer: 263, iris: 473 },
    faceLeft: 234, faceRight: 454, noseTip: 1,
};

/** Position of p between a and b along x: 0 at a, 1 at b */
function horizontalRatio(p, a, b) {
    const span = b.x - a.x;
    return Math.abs(span) < 1e-6 ? 0.5 : (p.x - a.x) / span;
}

function estimateGaze(landmarks) {
    const eyeA = horizontalRatio(landmarks[LM.eyeA.iris], landmarks[LM.eyeA.outer], landmarks[LM.eyeA.inner]);
    const eyeB = horizontalRatio(landmarks[LM.eyeB.iris], landmarks[LM.eyeB.inner], landmarks[LM.eyeB.outer]);
    const eyes = (eyeA + eyeB) / 2;
    const yaw = horizontalRatio(landmarks[LM.noseTip], landmarks[LM.faceLeft], landmarks[LM.faceRight]);
    const lookingAtCamera = Math.abs(eyes - 0.5) < GAZE_CENTER_TOLERANCE && Math.abs(yaw - 0.5) < GAZE_CENTER_TOLERANCE;
    return { eyes, yaw, lookingAtCamera };
}

function setGazeStatus(text, color) {
    aiStatus.innerText = text;
    aiStatus.style.color = color;
    if (adminAiStatus) {
        adminAiStatus.innerText = text;
        adminAiStatus.style.color = color;
    }
}

function onFaceResults(results) {
    gazeCtx.clearRect(0, 0, gazeCanvas.width, gazeCanvas.height);
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const landmarks = results.multiFaceLandmarks[0];
        const gaze = estimateGaze(landmarks);
        setGazeStatus(gaze.lookingAtCamera ? "Shikimi: drejt kamerës" : "Shikimi: jashtë kamerës",
            gaze.lookingAtCamera ? "var(--success-color)" : "var(--warning-color)");

        drawGazeHUD(landmarks[LM.eyeA.iris], landmarks[LM.eyeB.iris], gaze);
        updateExpression(landmarks, gaze);
        StudioSessionLog.recordFace(true, gaze.lookingAtCamera);
    } else {
        setGazeStatus("Shikimi: fytyra nuk shihet", "var(--danger-color)");
        moodFeedback.innerText = "Shprehja: duke kalibruar…";
        if (adminMoodFeedback) adminMoodFeedback.innerText = "Shprehja: duke kalibruar…";
        StudioSessionLog.recordFace(false, false);
    }
}

function drawGazeHUD(irisA, irisB, gaze) {
    const w = gazeCanvas.width;
    const h = gazeCanvas.height;
    gazeCtx.fillStyle = "#007aff";
    gazeCtx.beginPath();
    gazeCtx.arc(irisA.x * w, irisA.y * h, 3, 0, Math.PI * 2);
    gazeCtx.arc(irisB.x * w, irisB.y * h, 3, 0, Math.PI * 2);
    gazeCtx.fill();

    gazeCtx.fillStyle = gaze.lookingAtCamera ? "rgba(52, 199, 89, 0.6)" : "rgba(255, 59, 48, 0.6)";
    gazeCtx.font = "bold 12px Inter";
    gazeCtx.fillText(gaze.lookingAtCamera ? "SHIKIM DREJT KAMERËS" : "SHIKIM JASHTË KAMERËS", 10, 25);
}

// --- Expression feedback ---
// A simple geometric heuristic on mouth landmarks (width / corner height relative to the
// face width). It is presenter feedback, not an emotion-recognition model.
function updateExpression(landmarks, gaze) {
    const headWidth = Math.hypot(landmarks[454].x - landmarks[234].x, landmarks[454].y - landmarks[234].y);
    const mouthWidth = Math.hypot(landmarks[291].x - landmarks[61].x, landmarks[291].y - landmarks[61].y);
    const mouthHeight = Math.abs(landmarks[14].y - landmarks[13].y);

    // Frown metric: are the mouth corners pulled down compared to the centre?
    const mouthCenterY = (landmarks[13].y + landmarks[14].y) / 2;
    const mouthCornersY = (landmarks[61].y + landmarks[291].y) / 2;
    const frownIndex = (mouthCornersY - mouthCenterY) / (headWidth || 0.1);

    const smileRatio = mouthWidth / (headWidth || 0.1);

    let feedback = "Shprehja: neutrale";
    let color = "rgba(0, 122, 255, 0.55)"; // Blue for neutral

    if (smileRatio > 0.43) {
        feedback = "Shprehja: buzëqeshje 😊";
        color = "rgba(52, 199, 89, 0.8)"; // Green for smiling
    }
    else if (frownIndex > 0.025 || smileRatio < 0.32) {
        feedback = "Shprehja: e tensionuar — buzëqeshni pak";
        color = "rgba(255, 149, 0, 0.8)"; // Orange for frowning
    }
    else if (mouthHeight > 0.04) {
        feedback = "Shprehja: duke folur 🎙️";
    }

    if (!gaze.lookingAtCamera) feedback += " · Shikoni kamerën";

    moodFeedback.innerText = feedback;
    moodFeedback.style.backgroundColor = color;
    if (adminMoodFeedback) {
        adminMoodFeedback.innerText = feedback;
        adminMoodFeedback.style.backgroundColor = color;
    }
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

const clearDrawBtn = document.getElementById('clear-client-draw-btn');
clearDrawBtn.addEventListener('click', () => {
    AdminInk.clear(true);
    notify("Vizatimet u fshinë.", 'info', 2000);
});

// --- Admin Drawing Sync (to see client markings) ---
function resizeAdminCanvas() {
    if (!adminDrawGlass || !adminCursor) return;
    adminDrawGlass.width = adminDrawGlass.clientWidth;
    adminDrawGlass.height = adminDrawGlass.clientHeight;
    adminCursor.width = adminDrawGlass.clientWidth;
    adminCursor.height = adminDrawGlass.clientHeight;
    // Resizing a canvas wipes it: draw the kept strokes again
    if (typeof AdminInk !== 'undefined') AdminInk.redraw();
}
window.addEventListener('resize', resizeAdminCanvas);
resizeAdminCanvas();
setTimeout(resizeAdminCanvas, 1000); // Robust resize after layout

// Start MediaPipe & Camera Automatically
// 1280×720: 16:9 like the stream, sharp enough for YouTube 720p/1080p
const CAMERA_WIDTH = 1280;
const CAMERA_HEIGHT = 720;

function initCamera() {
    outputCanvas.width = CAMERA_WIDTH;
    outputCanvas.height = CAMERA_HEIGHT;
    gazeCanvas.width = CAMERA_WIDTH;
    gazeCanvas.height = CAMERA_HEIGHT;
    adminOutputCanvas.width = 1280;
    adminOutputCanvas.height = 720;

    // Visual feedback for fast start
    if (connectionStatus) connectionStatus.innerText = "Kamera po ndizet...";

    // Request exact resolution for faster hardware initialization
    navigator.mediaDevices.getUserMedia({
        video: {
            width: { ideal: CAMERA_WIDTH },
            height: { ideal: CAMERA_HEIGHT },
            frameRate: { ideal: 30 }
        },
        audio: true
    })
        .then(stream => {
            video.srcObject = stream;
            if (connectionStatus && !isLive) connectionStatus.innerText = "Në pritje";

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

            let frameCount = 0;
            const camera = new Camera(video, {
                onFrame: async () => {
                    isModelReady = true; // MediaPipe is now processing
                    frameCount++;

                    // The hand goes first so writing and pointing get the freshest frame
                    await hands.send({ image: video });

                    // PERFORMANCE TWEAK: Only run segmentation if background effects are active
                    if (isBlurActive || isStudioBgActive) {
                        await selfieSegmentation.send({ image: video });
                    } else {
                        // Fallback: manually draw normal camera if no segmentation
                        onSegmentationResults({ image: video, segmentationMask: null });
                    }

                    // Gaze tracking on every second frame (15 per second is plenty for eye contact),
                    // which leaves more time for the hand
                    if (frameCount % 2 === 0) await faceMesh.send({ image: video });
                },
                width: CAMERA_WIDTH,
                height: CAMERA_HEIGHT
            });
            camera.start();
        }).catch(err => {
            console.error("Webcam/Mic error:", err);
            if (connectionStatus) {
                connectionStatus.innerText = "Pa kamerë";
                connectionStatus.classList.add('error');
            }
            notify("Kamera ose mikrofoni nuk u gjet. Kontrolloni lejet e shfletuesit dhe rifreskoni faqen.", 'error', 8000);
        });
}

window.addEventListener('load', initCamera);
