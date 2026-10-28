// SyriAI Studio — Recording the processed camera output to a video file.

let mediaRecorder;
let recordedChunks = [];

// Recording Logic
recordBtn.addEventListener('click', () => {
    if (!isRecording) startRecording();
    else stopRecording();
});

// Safari records MP4 only; Chrome/Firefox prefer WebM
function pickRecordingMimeType() {
    const candidates = ['video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'];
    return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

function startRecording() {
    if (!video.srcObject) {
        notify("Kamera nuk është aktive — regjistrimi nuk mund të fillojë.", 'error');
        return;
    }
    recordedChunks = [];
    const stream = outputCanvas.captureStream(30);
    if (video.srcObject.getAudioTracks().length > 0) {
        stream.addTrack(video.srcObject.getAudioTracks()[0]);
    }
    const mimeType = pickRecordingMimeType();
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = saveRecording;
    mediaRecorder.start();
    isRecording = true;
    setLabel(recordBtn, "Ndalo");
    recordBtn.classList.add('recording');
    notify("Regjistrimi filloi.", 'info', 2500);
}

function stopRecording() {
    mediaRecorder.stop();
    isRecording = false;
    setLabel(recordBtn, "REC");
    recordBtn.classList.remove('recording');
}

function saveRecording() {
    const type = mediaRecorder.mimeType || 'video/webm';
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(recordedChunks, { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SyriAI_Session_${new Date().getTime()}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    notify("Regjistrimi u ruajt në shkarkime.", 'success');
}
