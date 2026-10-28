// Login guard for the online version on static hosting (GitHub Pages).
//
// On the .NET server, /studio is already protected by the server's login, so this script does
// nothing there. On GitHub Pages the page stays hidden until Firebase confirms a signed-in user
// with a verified e-mail; otherwise it sends the visitor to login.html.
(function () {
    const isStaticHost = location.hostname.endsWith('.github.io') || /[?&]staticAuth=1\b/.test(location.search);
    if (!isStaticHost) return;

    window.SYRIAI_STATIC_AUTH = true;
    document.documentElement.style.visibility = 'hidden';

    const loginPage = new URL('login.html', document.currentScript.src.replace(/js\/shared\/auth-guard\.js.*$/, '')).href;
    const toLogin = () => {
        const next = location.pathname.split('/').pop() + location.search + location.hash;
        location.replace(`${loginPage}?next=${encodeURIComponent(next)}`);
    };

    if (!window.SYRIAI_FIREBASE) {
        toLogin();
        return;
    }

    const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
    Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`)])
        .then(([{ initializeApp }, { getAuth, onAuthStateChanged, signOut }]) => {
            const auth = getAuth(initializeApp(window.SYRIAI_FIREBASE));
            onAuthStateChanged(auth, (user) => {
                if (!user || !user.emailVerified) {
                    toLogin();
                    return;
                }
                window.SYRIAI_USER = { email: user.email, uid: user.uid };
                document.documentElement.style.visibility = '';

                // The header's "Dil" button signs out of Firebase instead of the server
                const wireLogout = () => document.querySelectorAll('a[href="/logout"]').forEach(a => {
                    a.style.display = '';
                    a.removeAttribute('hidden');
                    a.title = `Dil (${user.email})`;
                    a.addEventListener('click', (e) => {
                        e.preventDefault();
                        signOut(auth).then(toLogin);
                    });
                });
                if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireLogout);
                else wireLogout();
            });
        })
        .catch(toLogin);
})();
