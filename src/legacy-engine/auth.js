// js/auth.js
import { auth, db } from './firebase-core.js';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, set, get } from 'firebase/database';

// --- AUTH ROUTER & STATE LISTENER ---
onAuthStateChanged(auth, async (user) => {
    const currentPage = window.location.pathname;
    const isLoginPage = currentPage.includes('login');
    const isChatPage = currentPage.includes('chat') || currentPage.includes('join');

    // React Router owns the public URLs; Firebase Hosting serves index.html for both.
    const chatUrl = '/chat';
    const loginUrl = '/login';

    if (user) {
        document.querySelectorAll('.auth-only').forEach(el => el.classList.remove('hidden'));
        document.querySelectorAll('.guest-only').forEach(el => el.classList.add('hidden'));

        if (isLoginPage) { window.location.replace(chatUrl); return; }
        if (isChatPage) {
            window.currentUser = user;
            checkUserProfile(user.uid);
        }
    } else {
        document.querySelectorAll('.auth-only').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.guest-only').forEach(el => el.classList.remove('hidden'));

        if (isChatPage) { 
            if (currentPage.includes('join')) sessionStorage.setItem('pendingJoinUrl', currentPage);
            window.location.replace(loginUrl); 
        }
    }
});

async function checkUserProfile(uid) {
    try {
        const snapshot = await get(ref(db, 'users/' + uid));
        if (snapshot.exists()) {
            const data = snapshot.val();
            window.userProfileName = data.displayName || "Anonymous";
            window.userPhotoUrl = data.photoUrl || "";
            window.userPronouns = data.pronouns || "";
            window.userBio = data.bio || "";
            window.userThemeColor = data.themeColor || "#FFD700";
            window.userStatus = data.status || "";
            window.userLinks = Array.isArray(data.links) ? data.links : [];
            window.userBannerUrl = data.bannerUrl || "";
            window.userFlair = data.flair || "";
            window.userSkills = data.skills || {};
            window.userTier = data.tier || "free"; 
            window.userPhone = data.phoneNumber || "No phone on file"; 
            
            if (typeof window.updateBillingUI === 'function') window.updateBillingUI();
            
            if (!data.shortId) {
                window.userShortId = window.generateShortId();
                await set(ref(db, 'users/' + uid + '/shortId'), window.userShortId);
            } else { window.userShortId = data.shortId; }

            if (!data.createdAt && auth.currentUser) {
                await set(ref(db, 'users/' + uid + '/createdAt'), auth.currentUser.metadata.creationTime);
            }

            // Everyone earns the Welcome badge once (proves/seeds the badge system).
            if (!(data.badges && data.badges.welcome) && window.awardBadge) window.awardBadge(uid, 'welcome');

            if (typeof window.enterChat === 'function') window.enterChat();
        } else { 
            if (typeof window.showScreen === 'function') window.showScreen('profile-setup-container'); 
        }
    } catch (error) {
        if (window.showToast) window.showToast("Database Error loading profile: " + error.message);
    }
}
