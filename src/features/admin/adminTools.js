import { ref, remove, set } from 'firebase/database';
import { db } from '../../lib/firebase.js';

const isAdminDashboardEnabled = window.MINIMALIST_FLAGS?.adminDashboard !== false;

let blipClickCount = 0;
let blipClickTimer = null;

if (!isAdminDashboardEnabled) {
  document.getElementById('admin-dashboard-modal')?.remove();
} else {
  document.getElementById('mini-admin-blip')?.addEventListener('click', () => {
    blipClickCount += 1;

    if (blipClickCount === 5) {
      clearTimeout(blipClickTimer);
      blipClickCount = 0;

      if (window.currentUser && window.currentUser.uid === window.MY_ADMIN_UID) {
        document.getElementById('admin-dashboard-modal')?.classList.remove('hidden');
        window.showToast('Admin Dashboard Unlocked.', false);
      } else {
        window.showToast('Access Denied.');
      }
      return;
    }

    clearTimeout(blipClickTimer);
    blipClickTimer = setTimeout(() => {
      blipClickCount = 0;
    }, 400);
  });

  document.getElementById('close-admin-dashboard-btn')?.addEventListener('click', () => {
    document.getElementById('admin-dashboard-modal')?.classList.add('hidden');
  });

  document.getElementById('admin-wipe-btn')?.addEventListener('click', async () => {
    try {
      await remove(ref(db, 'presence'));
      window.showToast('Ghost connections wiped successfully!', false);
    } catch (error) {
      window.showToast(`Failed to wipe connections: ${error.message}`);
    }
  });

  document.getElementById('admin-ban-btn')?.addEventListener('click', () => {
    const target = document.getElementById('admin-target-id')?.value.trim();
    if (!target) {
      window.showToast('Enter a UID first!');
      return;
    }

    set(ref(db, `users/${target}/isBanned`), true)
      .then(() => window.showToast(`User ${target} banned!`, false))
      .catch((error) => window.showToast(`Ban failed: ${error.message}`));
  });

  document.getElementById('admin-mute-btn')?.addEventListener('click', () => {
    const target = document.getElementById('admin-target-id')?.value.trim();
    if (!target) {
      window.showToast('Enter a UID first!');
      return;
    }

    set(ref(db, `users/${target}/isMuted`), true)
      .then(() => window.showToast(`User ${target} globally muted!`, false))
      .catch((error) => window.showToast(`Mute failed: ${error.message}`));
  });
}
