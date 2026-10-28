// SyriAI Studio — document rendering shared by the admin studio and client screens.
//
// Both pages render documents themselves from the same file URL, instead of sending
// rendered pixels over the sync channel.

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

const StudioDocuments = (() => {
    const DOCX_OPTIONS = {
        className: 'docx-render',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        renderChanges: false,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderComments: false,
        useBase64URL: true,
    };

    /**
     * Lazy PDF viewer: creates one placeholder per page and renders pages as they
     * approach the viewport. Pages get ids pdf-page-N and highlight boxes pdf-hl-N.
     */
    function renderLazyPdf(pdf, root, { scale = 1.5, rootMargin = '500px 0px', placeholderHeight = '1100px', pageWidth = '100%' } = {}) {
        root.innerHTML = '';

        const renderPage = async (container) => {
            if (container.dataset.rendered === 'true') return;
            container.dataset.rendered = 'true';
            try {
                const page = await pdf.getPage(Number(container.dataset.pageNum));
                const viewport = page.getViewport({ scale });
                const canvas = container.querySelector('.pdf-page-canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                container.style.minHeight = 'auto';
                await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            } catch (err) {
                console.error(`Error rendering page ${container.dataset.pageNum}:`, err);
                container.dataset.rendered = 'false';
            }
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => { if (entry.isIntersecting) renderPage(entry.target); });
        }, { root, rootMargin, threshold: 0.1 });

        for (let i = 1; i <= pdf.numPages; i++) {
            const container = document.createElement('div');
            container.className = 'pdf-page-container';
            container.id = `pdf-page-${i}`;
            container.dataset.pageNum = i;
            container.dataset.rendered = 'false';
            // Placeholder height keeps the scrollbar stable until the page renders
            container.style.minHeight = placeholderHeight;
            container.style.width = pageWidth;

            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-page-canvas';

            const highlight = document.createElement('div');
            highlight.className = 'pdf-highlight';
            highlight.id = `pdf-hl-${i}`;

            container.append(canvas, highlight);
            root.appendChild(container);
            observer.observe(container);
        }
    }

    async function renderDocx(arrayBuffer, root) {
        root.innerHTML = '';
        await docx.renderAsync(arrayBuffer, root, null, DOCX_OPTIONS);
    }

    /** window.PptxRenderer comes from an ES module script that may still be loading */
    async function waitForPptxRenderer(timeoutMs = 8000) {
        const started = Date.now();
        while (!window.PptxRenderer) {
            if (Date.now() - started > timeoutMs) {
                throw new Error("PptxRenderer nuk u ngarkua. Kontrolloni lidhjen me internetin.");
            }
            await new Promise(r => setTimeout(r, 100));
        }
        return window.PptxRenderer;
    }

    /** Render every slide as an image. Returns the number of slides. */
    async function renderPptx(arrayBuffer, root) {
        const Renderer = await waitForPptxRenderer();
        const slides = await new Renderer().render(arrayBuffer);

        root.innerHTML = '';
        const container = document.createElement('div');
        container.className = 'pptx-render-container';
        slides.forEach((slideCanvas, index) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'pptx-slide-visual';
            const img = document.createElement('img');
            img.src = slideCanvas.toDataURL('image/png');
            img.alt = `Sllajdi ${index + 1}`;
            const tag = document.createElement('div');
            tag.className = 'slide-number-tag';
            tag.textContent = `Sllajdi ${index + 1}`;
            wrapper.append(img, tag);
            container.appendChild(wrapper);
        });
        root.appendChild(container);
        return slides.length;
    }

    function renderImage(url, root) {
        root.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'media-visual-container';
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        wrap.appendChild(img);
        root.appendChild(wrap);
    }

    function renderVideo(url, root, { muted = false } = {}) {
        root.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'media-visual-container';
        const video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.autoplay = true;
        video.playsInline = true;
        video.muted = muted;
        wrap.appendChild(video);
        root.appendChild(wrap);
    }

    /** Load and render any shared media item { kind, url } into root */
    async function renderMedia(media, root, { pdfOptions, muteVideo = false } = {}) {
        switch (media.kind) {
            case 'pdf': {
                const pdf = await pdfjsLib.getDocument({ url: media.url, withCredentials: true }).promise;
                renderLazyPdf(pdf, root, pdfOptions);
                return pdf;
            }
            case 'word':
                await renderDocx(await fetchArrayBuffer(media.url), root);
                return null;
            case 'pptx':
                await renderPptx(await fetchArrayBuffer(media.url), root);
                return null;
            case 'image':
                renderImage(media.url, root);
                return null;
            case 'video':
                renderVideo(media.url, root, { muted: muteVideo });
                return null;
            default:
                throw new Error(`Unknown media kind: ${media.kind}`);
        }
    }

    async function fetchArrayBuffer(url) {
        const response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
    }

    return { renderLazyPdf, renderDocx, renderPptx, renderImage, renderVideo, renderMedia };
})();
