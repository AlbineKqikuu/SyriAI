// SyriAI Studio — Documents & media: upload, text extraction and the document view.
//
// Flow for every file: extract the script text → render it locally → upload it to the
// server → tell client screens its URL (media_sync). Client screens render it themselves.

/** Media currently shown in document view: { kind, url, name } or null */
let currentMedia = null;

const PDF_VIEW_OPTIONS = { scale: 1.5, rootMargin: '500px 0px', placeholderHeight: '1100px' };

// PDFs over this many pages skip per-word position extraction (used for the on-page highlight)
const PDF_WORD_POSITIONS_MAX_PAGES = 10;

function renderMainPdf() {
    if (currentPdf) StudioDocuments.renderLazyPdf(currentPdf, pdfViewMain, PDF_VIEW_OPTIONS);
}

// View Mode Switching
function showTextView() {
    viewTextBtn.classList.add('active');
    viewDocBtn.classList.remove('active');
    scrollContainer.classList.remove('overlay-mode');
    scrollContainer.style.display = 'block';
    pdfViewMain.style.display = 'none';
    broadcastUpdate('view_mode', 'text');
}

function showDocumentView() {
    if (!currentMedia) {
        notify("Ngarkoni fillimisht një dokument ose media.", 'warning');
        return;
    }
    viewDocBtn.classList.add('active');
    viewTextBtn.classList.remove('active');
    scrollContainer.style.display = 'none';
    pdfViewMain.style.display = 'block';
    broadcastUpdate('view_mode', 'doc');
}

viewTextBtn.addEventListener('click', showTextView);
viewDocBtn.addEventListener('click', showDocumentView);

// Throttled scroll sync (max 20 messages per second)
let lastSyncTime = 0;
function throttledSync(type, value) {
    const now = Date.now();
    if (now - lastSyncTime > 50) {
        broadcastUpdate(type, value);
        lastSyncTime = now;
    }
}

let lastDocScrollSync = 0;
pdfViewMain.addEventListener('scroll', () => {
    if (isSyncingScroll) return;
    const now = Date.now();
    if (now - lastDocScrollSync < 50) return; // max 20 updates per second
    lastDocScrollSync = now;
    broadcastUpdate('pdf_scroll', pdfViewMain.scrollTop);
    // The broadcast output's document box has another size: send the relative position too
    const max = pdfViewMain.scrollHeight - pdfViewMain.clientHeight;
    if (max > 0) broadcastUpdate('doc_scroll_ratio', pdfViewMain.scrollTop / max);
});

scrollContainer.addEventListener('scroll', () => {
    if (isSyncingScroll) return;
    throttledSync('text_scroll', scrollContainer.scrollTop);
});

// ---------- Upload ----------
uploadTrigger.addEventListener('click', () => fileUpload.click());

fileUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
    fileUpload.value = ''; // Allow selecting the same file again
});

// Drag & drop onto the upload zone
['dragenter', 'dragover'].forEach(evt => uploadTrigger.addEventListener(evt, (e) => {
    e.preventDefault();
    uploadTrigger.classList.add('is-dragover');
}));
['dragleave', 'drop'].forEach(evt => uploadTrigger.addEventListener(evt, (e) => {
    e.preventDefault();
    uploadTrigger.classList.remove('is-dragover');
}));
uploadTrigger.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
});

const MEDIA_KINDS = [
    { kind: 'pdf', ext: ['.pdf'], mime: /^application\/pdf$/ },
    { kind: 'word', ext: ['.docx'], mime: /wordprocessingml/ },
    { kind: 'pptx', ext: ['.pptx'], mime: /presentationml/ },
    { kind: 'image', ext: ['.png', '.jpg', '.jpeg', '.gif'], mime: /^image\// },
    { kind: 'video', ext: ['.mp4', '.webm', '.mov'], mime: /^video\// },
    { kind: 'audio', ext: ['.mp3', '.wav', '.ogg'], mime: /^audio\// },
];

function detectKind(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.doc')) return 'legacy-doc';
    if (name.endsWith('.ppt')) return 'legacy-ppt';
    const match = MEDIA_KINDS.find(k => k.ext.some(e => name.endsWith(e)) || k.mime.test(file.type));
    return match ? match.kind : null;
}

async function handleFile(file) {
    const kind = detectKind(file);

    if (kind === 'legacy-doc' || kind === 'legacy-ppt') {
        const modern = kind === 'legacy-doc' ? '.docx' : '.pptx';
        notify(`Formati i vjetër ${kind === 'legacy-doc' ? '.doc' : '.ppt'} nuk mbështetet. Ruajeni si ${modern} ose .pdf.`, 'warning', 6000);
        setUploadStatus("Format i pambështetur", "error");
        return;
    }
    if (!kind) {
        notify("Format i pambështetur. Përdorni PDF, Word (.docx), PPTX, foto (PNG/JPG) ose video.", 'warning', 6000);
        setUploadStatus("Ngarko skedar");
        return;
    }
    if (kind === 'audio') {
        notify("Luajtja e audios nuk mbështetet ende.", 'info');
        return;
    }

    // Reset state for the new upload
    currentPdf = null;
    currentMedia = null;
    pdfViewMain.innerHTML = "";
    allWordPositions = [];
    pageWordBoundaries = [0];
    setUploadStatus("Duke procesuar...", "busy");

    try {
        const localUrl = URL.createObjectURL(file);
        let summary = "";

        if (kind === 'pdf') {
            summary = await loadPdf(await file.arrayBuffer());
        } else if (kind === 'word') {
            summary = await loadWord(await file.arrayBuffer());
        } else if (kind === 'pptx') {
            summary = await loadPptx(await file.arrayBuffer());
        } else if (kind === 'image') {
            StudioDocuments.renderImage(localUrl, pdfViewMain);
            summary = "Foto u ngarkua.";
        } else if (kind === 'video') {
            StudioDocuments.renderVideo(localUrl, pdfViewMain);
            summary = "Video u ngarkua.";
        }

        currentMedia = { kind, url: localUrl, name: file.name };
        showDocumentView();
        AdminInk.show(); // toolbar over the file, hand writing on
        if (typeof ScriptLibrary !== 'undefined') ScriptLibrary.markUnsaved(file.name.replace(/\.[^.]+$/, ''));

        // Share with client screens (uploads to the server when available)
        setUploadStatus("Duke e ndarë me klientin...", "busy");
        currentMedia.url = await shareMedia(file, localUrl);
        broadcastMedia();
        // The Board page (board.html) opens the same file without uploading it again
        if (currentMedia.url.startsWith('/api/media/')) {
            try { localStorage.setItem('syriai-studio-media', JSON.stringify({ url: currentMedia.url, name: file.name })); } catch { /* storage unavailable */ }
        }

        setUploadStatus(file.name, "ok");
        notify(summary, 'success');
    } catch (err) {
        console.error(`${kind} error:`, err);
        notify(`Skedari nuk u lexua: ${err.message}`, 'error', 7000);
        setUploadStatus("Gabim — provoni përsëri", "error");
    }
}

/** Put extracted text into the editor and the prompter */
function setScriptFromDocument(text) {
    scriptInput.value = text.trim();
    applyScriptText();
}

async function loadPdf(arrayBuffer) {
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
    loadingTask.onProgress = (progress) => {
        if (!progress.total) return;
        setUploadStatus(`Duke ngarkuar ${Math.round(progress.loaded / progress.total * 100)}%...`, "busy");
    };
    const pdf = await loadingTask.promise;

    const totalPages = pdf.numPages;
    const collectPositions = totalPages <= PDF_WORD_POSITIONS_MAX_PAGES;
    const pageTexts = new Array(totalPages);

    for (let i = 1; i <= totalPages; i++) {
        setUploadStatus(`Faqja ${i}/${totalPages}...`, "busy");
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        if (collectPositions) collectWordPositions(page, textContent, i);

        const pageText = textContent.items.map(item => item.str).join(" ");
        pageTexts[i - 1] = pageText;
        const wordCount = splitWords(pageText).length;
        pageWordBoundaries.push(pageWordBoundaries[pageWordBoundaries.length - 1] + wordCount);
    }

    const fullText = pageTexts.join("\n\n");
    if (fullText.trim().length < 5) {
        throw new Error("Ky PDF nuk ka tekst të lexueshëm (mund të jetë i skanuar).");
    }

    currentPdf = pdf;
    setScriptFromDocument(fullText);
    renderMainPdf();
    return `PDF u ngarkua: ${totalPages} faqe.`;
}

/** Approximate the box of every word on the page, for the highlight drawn over the PDF */
function collectWordPositions(page, textContent, pageNum) {
    const scale = 2.0;
    const viewport = page.getViewport({ scale });

    textContent.items.forEach(item => {
        const str = item.str;
        const trimmedStr = str.trim();
        if (!trimmedStr) return;

        const [vx, vy] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        const itemWidth = item.width * scale;
        const itemHeight = item.height * scale;

        let searchPos = 0;
        splitWords(trimmedStr).forEach(w => {
            const wordIdx = str.indexOf(w, searchPos);
            if (wordIdx === -1) return;

            const wordX = vx + (wordIdx / str.length) * itemWidth;
            const wordW = (w.length / str.length) * itemWidth;
            allWordPositions.push({
                text: w, page: pageNum,
                nx: (wordX - 2) / viewport.width,
                ny: (vy - (itemHeight * 1.15)) / viewport.height,
                nw: (wordW + 4) / viewport.width,
                nh: (itemHeight * 1.3) / viewport.height
            });
            searchPos = wordIdx + w.length;
        });
    });
}

async function loadWord(arrayBuffer) {
    // Mammoth extracts clean text for the prompter; docx-preview renders the page faithfully
    const textResult = await mammoth.extractRawText({ arrayBuffer });
    setScriptFromDocument(textResult.value);
    await StudioDocuments.renderDocx(arrayBuffer, pdfViewMain);
    return "Dokumenti Word u ngarkua.";
}

async function loadPptx(arrayBuffer) {
    const text = await extractPptxText(arrayBuffer);
    if (text.trim().length < 5) throw new Error("Nuk u gjet tekst në PowerPoint.");
    setScriptFromDocument(text);
    const slideCount = await StudioDocuments.renderPptx(arrayBuffer, pdfViewMain);
    return `PowerPoint u ngarkua: ${slideCount} sllajde.`;
}

/** Slide text in order, one block per slide */
async function extractPptxText(arrayBuffer) {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slideFiles = Object.keys(zip.files)
        .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10));

    const parser = new DOMParser();
    const blocks = [];
    for (let i = 0; i < slideFiles.length; i++) {
        setUploadStatus(`Sllajdi ${i + 1}/${slideFiles.length}...`, "busy");
        const xmlDoc = parser.parseFromString(await zip.file(slideFiles[i]).async("text"), "text/xml");
        const paragraphs = Array.from(xmlDoc.getElementsByTagName("a:p"))
            .map(p => Array.from(p.getElementsByTagName("a:t")).map(t => t.textContent).join(""))
            .filter(t => t.trim());
        if (paragraphs.length) blocks.push(`--- SLLAJDI ${i + 1} ---\n${paragraphs.join(" ")}`);
    }
    return blocks.join("\n\n");
}

/**
 * Upload the file so other devices can load it. Without the backend (static hosting)
 * fall back to the local blob URL, which works for client tabs in this browser.
 */
function shareMedia(file, localUrl) {
    return new Promise((resolve) => {
        const form = new FormData();
        form.append('file', file);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/media');
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setUploadStatus(`Duke e ndarë ${Math.round(e.loaded / e.total * 100)}%...`, "busy");
        };
        xhr.onload = () => {
            if (xhr.status === 200) {
                resolve(JSON.parse(xhr.responseText).url);
                return;
            }
            if (xhr.status === 400) {
                let message = "";
                try { message = JSON.parse(xhr.responseText).error; } catch { /* not JSON */ }
                notify(`Skedari nuk u ngarkua në server (${message}). Ekrani i klientit funksionon vetëm në këtë shfletues.`, 'warning', 7000);
            }
            resolve(localUrl);
        };
        xhr.onerror = () => resolve(localUrl);
        xhr.send(form);
    });
}

/** Tell client screens which media to show */
function broadcastMedia() {
    if (currentMedia) broadcastUpdate('media_sync', currentMedia);
}
