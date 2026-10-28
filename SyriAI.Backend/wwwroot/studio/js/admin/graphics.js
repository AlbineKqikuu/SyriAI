// SyriAI Studio — On-air graphics: lower-third name banner and headline strap.

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

        setLabel(toggleLTBtn, isShowing ? "Shfaq banerin" : "Fshih banerin");
        toggleLTBtn.classList.toggle('active', !isShowing);

        updateLTDisplay(); // Update & sync
    });
}

// --- HEADLINE STRAP (broadcast output) ---
const headlineInput = document.getElementById('headline-input');
const toggleHeadlineBtn = document.getElementById('toggle-headline-btn');
let isHeadlineShown = false;

function headlineState() {
    return { show: isHeadlineShown, text: headlineInput.value.trim() };
}

function syncHeadline() {
    broadcastUpdate('headline_sync', headlineState());
}

headlineInput.addEventListener('input', syncHeadline);

toggleHeadlineBtn.addEventListener('click', () => {
    if (!isHeadlineShown && !headlineInput.value.trim()) {
        notify("Shkruani titullin e lajmit fillimisht.", 'warning', 3000);
        headlineInput.focus();
        return;
    }
    isHeadlineShown = !isHeadlineShown;
    setLabel(toggleHeadlineBtn, isHeadlineShown ? "Fshih titullin" : "Shfaq titullin");
    toggleHeadlineBtn.classList.toggle('active', isHeadlineShown);
    syncHeadline();
});
