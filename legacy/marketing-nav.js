(function setupLegacyMarketingNav() {
    const nav = document.querySelector('body.marketing nav');
    const button = nav?.querySelector('#mobile-menu-btn');
    const menu = nav?.querySelector('#marketing-mobile-nav-links');
    if (!nav || !button || !menu) return;

    const setMenuOpen = (open, restoreFocus) => {
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
        menu.setAttribute('aria-hidden', open ? 'false' : 'true');
        menu.classList.toggle('hidden', !open);
        if (open) {
            menu.querySelector('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')?.focus();
        } else if (restoreFocus) {
            button.focus();
        }
    };

    button.addEventListener('click', () => {
        const open = button.getAttribute('aria-expanded') !== 'true';
        setMenuOpen(open, false);
    });

    document.addEventListener('pointerdown', (event) => {
        if (menu.classList.contains('hidden')) return;
        if (nav.contains(event.target)) return;
        setMenuOpen(false, false);
    });

    document.addEventListener('focusin', (event) => {
        if (menu.classList.contains('hidden')) return;
        if (nav.contains(event.target)) return;
        setMenuOpen(false, false);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || menu.classList.contains('hidden')) return;
        setMenuOpen(false, true);
    });

    menu.querySelectorAll('a[href], button:not([disabled])').forEach((item) => {
        item.addEventListener('click', () => setMenuOpen(false, false));
    });

    const toastClose = document.getElementById('toast-close');
    toastClose?.addEventListener('click', () => {
        document.getElementById('brutalist-toast')?.classList.add('toast-hidden');
    });

    const clock = document.getElementById('live-clock');
    if (clock) {
        const tick = () => {
            clock.textContent = `SYSTEM TIME: ${new Date().toLocaleTimeString('en-US', {
                hour12: true,
                timeZoneName: 'short',
            })}`;
        };
        tick();
        window.setInterval(tick, 1000);
    }

    setMenuOpen(false, false);
})();
