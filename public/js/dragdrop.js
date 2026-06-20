// js/dragdrop.js
// Drag-and-drop image attachments. Drops feed the existing #image-input,
// so the normal chat-form submit/upload path handles the rest — no changes
// to the send handler required.

function setImageFile(file) {
    const input = document.getElementById('image-input');
    if (!input) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

function initDragDrop() {
    const zone = document.getElementById('main-chat-area');
    if (!zone || zone.dataset.ddBound) return;
    zone.dataset.ddBound = '1';

    let depth = 0; // track nested dragenter/leave so the overlay doesn't flicker

    zone.addEventListener('dragenter', (e) => {
        if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
        e.preventDefault();
        depth++;
        zone.classList.add('drag-over');
    });
    zone.addEventListener('dragover', (e) => {
        if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });
    zone.addEventListener('dragleave', () => {
        depth = Math.max(0, depth - 1);
        if (depth === 0) zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', (e) => {
        depth = 0;
        zone.classList.remove('drag-over');
        const file = e.dataTransfer?.files?.[0];
        if (!file) return;
        e.preventDefault();
        if (!file.type.startsWith('image/')) {
            if (window.showToast) window.showToast('Only image attachments are supported.');
            return;
        }
        setImageFile(file);
        if (window.showToast) window.showToast('Image attached — press send.', false);
    });
}

// #main-chat-area exists only after the chat UI mounts, so retry briefly.
function waitForChat(tries = 0) {
    if (document.getElementById('main-chat-area')) { initDragDrop(); return; }
    if (tries < 40) setTimeout(() => waitForChat(tries + 1), 250);
}
waitForChat();
