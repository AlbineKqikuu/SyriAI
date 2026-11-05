// Forms marked data-busy="Text…": after a valid submit, the button is locked and shows that text,
// so a slow answer (e.g. while the code e-mail is sent) is visible and cannot be submitted twice.
document.addEventListener('submit', (e) => {
    const form = e.target;
    const busyText = form.dataset && form.dataset.busy;
    if (!busyText) return;
    // Let client-side validation run first: an invalid form is cancelled and stays usable
    setTimeout(() => {
        if (e.defaultPrevented) return;
        form.querySelectorAll('button[type="submit"]').forEach(btn => {
            btn.dataset.label = btn.innerHTML;
            btn.disabled = true;
            btn.textContent = busyText;
        });
    });
});

// Coming back with the browser's Back button shows the page as it was left: unlock the buttons
window.addEventListener('pageshow', () => {
    document.querySelectorAll('button[data-label]').forEach(btn => {
        btn.innerHTML = btn.dataset.label;
        btn.disabled = false;
        delete btn.dataset.label;
    });
});
