const syncChannel = new BroadcastChannel('syriai_sync');
const scriptDisplay = document.getElementById('client-script-display');
const scrollBox = document.getElementById('client-scroll-box');
const video = document.getElementById('client-video');
const clock = document.getElementById('client-time');
const slideArea = document.getElementById('client-slide-area');
const slideCanvas = document.getElementById('client-slide-canvas');
const slideCtx = slideCanvas.getContext('2d');

// 1. Clock Logic
function updateClock() {
    const now = new Date();
    clock.innerText = now.toLocaleTimeString('sq-AL');
}
setInterval(updateClock, 1000);
updateClock();

// 2. Camera Logic
navigator.mediaDevices.getUserMedia({ video: true })
    .then(stream => {
        video.srcObject = stream;
    })
    .catch(err => {
        console.error("Camera access denied:", err);
    });

// 2.5 Request initial state
syncChannel.postMessage({ type: 'client_ready' });

// 3. Sync Logic
syncChannel.onmessage = (event) => {
    const { type, data } = event.data;

    switch (type) {
        case 'script_update':
            scriptDisplay.innerHTML = data.html;
            break;

        case 'highlight_update':
            highlightWord(data);
            break;

        case 'font_size':
            scriptDisplay.style.fontSize = `${data}rem`;
            break;

        case 'slide_update':
            if (data.show) {
                slideArea.style.display = 'block';
                if (data.fullView) slideArea.classList.add('full-view');
                else slideArea.classList.remove('full-view');

                if (data.image) {
                    const img = new Image();
                    img.onload = () => {
                        // For vertical PDF view, we append rather than replace if logic allows, 
                        // but since the admin sends the full view, we just render what is sent.
                        slideCanvas.width = img.width;
                        slideCanvas.height = img.height;
                        slideCtx.drawImage(img, 0, 0);
                    };
                    img.src = data.image;
                }
            } else {
                slideArea.style.display = 'none';
                slideArea.classList.remove('full-view');
            }
            break;
        case 'pdf_page_chunk':
            // Hide the single slide canvas when doing continuous render
            slideCanvas.style.display = 'none';
            const img = new Image();
            img.src = data;
            img.className = 'pdf-continuous-img';
            img.style.width = '100%';
            img.style.display = 'block';
            img.style.marginBottom = '20px';
            img.style.boxShadow = '0 0 30px rgba(0,0,0,0.8)';
            slideArea.appendChild(img);
            break;
        case 'pdf_clear':
            slideArea.querySelectorAll('.pdf-continuous-img').forEach(el => el.remove());
            slideCanvas.style.display = 'block'; // Restore canvas visibility
            break;
        case 'pdf_pages_ready':
            // Deprecated
            break;
        case 'view_mode':
            const marker = document.getElementById('reading-marker');
            if (data === 'doc') {
                scriptDisplay.style.display = 'none';
                if (marker) marker.style.display = 'none';
                slideArea.classList.add('full-view');
                slideArea.style.display = 'block';
            } else {
                scriptDisplay.style.display = 'block';
                if (marker) marker.style.display = 'block';
                slideArea.classList.remove('full-view');
                slideArea.style.display = 'none';
            }
            break;
        case 'pdf_scroll':
            slideArea.scrollTop = data;
            break;
    }
};

// Listen for local scroll in client PDF to sync with Admin
slideArea.addEventListener('scroll', () => {
    if (slideArea.classList.contains('full-view')) {
        syncChannel.postMessage({ type: 'pdf_scroll', data: slideArea.scrollTop });
    }
});

// Client Keyboard Control (Arrows & Scrolling)
window.addEventListener('keydown', (e) => {
    // Avoid navigation when typing
    if (['TEXTAREA', 'INPUT'].includes(document.activeElement.tagName)) return;

    const nextKeys = ['ArrowRight', 'ArrowDown', 'PageDown', ' '];
    const prevKeys = ['ArrowLeft', 'ArrowUp', 'PageUp'];

    if (nextKeys.includes(e.key)) {
        e.preventDefault();
        syncChannel.postMessage({ type: 'nav_next' });
    } else if (prevKeys.includes(e.key)) {
        e.preventDefault();
        syncChannel.postMessage({ type: 'nav_prev' });
    }
});

function highlightWord(index) {
    // Clear previous highlights
    document.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));

    // Add new highlight
    const wordEl = document.getElementById(`word-${index}`);
    if (wordEl) {
        wordEl.classList.add('highlight');

        // Handle 'read' opacity
        for (let i = 0; i < index; i++) {
            const prevEl = document.getElementById(`word-${i}`);
            if (prevEl) prevEl.classList.add('read');
        }

        // Auto-scroll logic (center the highlighted word)
        wordEl.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest'
        });
    }
}
