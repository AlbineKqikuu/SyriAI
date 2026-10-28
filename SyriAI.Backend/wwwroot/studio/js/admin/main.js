// SyriAI Studio — wiring: client window, messages from client screens, sync start-up.

const syncStatusDot = document.getElementById('sync-status');

// Presenter screen (prompter) in a new tab
openClientBtn.addEventListener('click', () => {
    window.open('client.html', '_blank');
});

// Program output for OBS → YouTube, as a separate 16:9 window. It is opened from here so it
// can draw this window's processed camera (see js/broadcast.js).
document.getElementById('open-broadcast-btn').addEventListener('click', () => {
    const win = window.open('broadcast.html', 'syriai-program', 'popup,width=1280,height=720');
    if (!win) notify("Shfletuesi bllokoi dritaren. Lejoni dritaret pop-up për këtë faqe.", 'warning', 6000);
});

function drawRemoteCursor({ nx, ny }) {
    // The admin's own hand results clear this canvas every frame
    adminCursorCtx.beginPath();
    adminCursorCtx.arc(nx * adminCursor.width, ny * adminCursor.height, 8, 0, Math.PI * 2);
    adminCursorCtx.fillStyle = "rgba(52, 199, 89, 0.6)"; // Green for client
    adminCursorCtx.fill();
}

function applyRemoteScroll(container, top) {
    isSyncingScroll = true;
    container.scrollTop = top;
    setTimeout(() => isSyncingScroll = false, 50);
}

/** Send the complete current studio state to a client screen that just connected */
function sendFullState() {
    broadcastUpdate('live_state', liveStatePayload());
    AdminInk.syncScreens(); // the drawing so far
    broadcastUpdate('headline_sync', headlineState());
    broadcastUpdate('settings_sync', StudioSettings.clientSettings());
    broadcastMedia();
    broadcastUpdate('view_mode', viewDocBtn.classList.contains('active') ? 'doc' : 'text');
    broadcastUpdate('font_size', fontSizeInput.value);
    broadcastUpdate('script_update', { html: scriptDisplay.innerHTML });
    if (lastReadIndex >= 0) broadcastUpdate('highlight_update', lastReadIndex);
    broadcastUpdate('pdf_scroll', pdfViewMain.scrollTop);
    const docMax = pdfViewMain.scrollHeight - pdfViewMain.clientHeight;
    if (docMax > 0) broadcastUpdate('doc_scroll_ratio', pdfViewMain.scrollTop / docMax);
    broadcastUpdate('text_scroll', scrollContainer.scrollTop);
    broadcastUpdate('scroll_speed_sync', scrollSpeed);
    broadcastUpdate('autoscroll_sync', isAutoScrolling);
    broadcastUpdate('lt_sync', {
        show: ltBanner.style.display === 'flex',
        name: ltNameInput.value || "EMRI JUAJ",
        title: ltTitleInput.value || "Gazetar / Prezantues"
    });
}

studioSync.on((type, data) => {
    switch (type) {
        case 'draw_segment':
            AdminInk.addRemoteSegment(data);
            break;
        case 'cursor_pos':
            drawRemoteCursor(data);
            break;
        case 'clear_draw':
            AdminInk.clear(false);
            break;
        case 'nav_next':
            navigate(1);
            break;
        case 'nav_prev':
            navigate(-1);
            break;
        case 'pdf_scroll':
            applyRemoteScroll(pdfViewMain, data);
            break;
        case 'text_scroll':
            applyRemoteScroll(scrollContainer, data);
            break;
        case 'client_ready':
            sendFullState();
            break;
        case 'lt_sync':
            document.getElementById('lt-name-display').innerText = data.name;
            document.getElementById('lt-title-display').innerText = data.title;
            ltBanner.style.display = data.show ? 'flex' : 'none';
            break;
    }
});

studioSync.onStatus((status, previous) => {
    syncStatusDot.dataset.status = status;
    syncStatusDot.title = StudioSync.statusLabel(status);
    // Static hosting (e.g. GitHub Pages) has no login, so there is nothing to log out of
    const logout = document.querySelector('a[href="/logout"]');
    // (the online version has its own login, see js/shared/auth-guard.js)
    if (logout && !window.SYRIAI_STATIC_AUTH) logout.style.display = status === 'local' ? 'none' : '';
    if (status === 'offline') notify("Lidhja me serverin u ndërpre. Ekrani i klientit nuk po sinkronizohet.", 'error', 7000);
    // After a reconnect the client may have missed messages
    if (status === 'online' && previous === 'reconnecting') sendFullState();
});

studioSync.start();
