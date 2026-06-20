// js/auth.js
import { auth, db, storage } from './firebase-core.js?v=19';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, deleteUser, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { ref, set, get, remove, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { ref as sRef, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// --- GLOBAL USER STATE ---
window.currentUser = null;
window.userProfileName = "Anonymous";
window.userPhotoUrl = "";
window.userPronouns = "";
window.userBio = "";
window.userThemeColor = "#FFD700";
window.userStatus = "";
window.userLinks = [];
window.userShortId = "";
window.userTier = "free";
window.userPhone = "No phone on file";

// --- GLOBAL HELPERS ---
window.getAvatarUrl = function(name, url) {
    if (url && url.trim() !== '') return url;
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=000&color=FFD700&bold=true`;
};
window.generateShortId = function() { 
    return Math.random().toString(36).substring(2, 8).toUpperCase(); 
};

// --- AUTH ROUTER & STATE LISTENER ---
onAuthStateChanged(auth, async (user) => {
    const currentPage = window.location.pathname;
    const isLoginPage = currentPage.includes('login');
    const isChatPage = currentPage.includes('chat') || currentPage.includes('join');

    // FIX: Explicitly enforce .html extensions to prevent local testing crashes!
    const chatUrl = 'chat.html';
    const loginUrl = 'login.html';

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

// --- PROFILE SAVING & UPDATING ---
const saveProfileBtn = document.getElementById('save-new-profile-btn');
if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', async () => {
        try {
            const name = document.getElementById('new-display-name').value.trim();
            const rawPhoto = document.getElementById('new-photo-url').value.trim();
            if (name) {
                const finalPhotoUrl = window.getAvatarUrl(name, rawPhoto);
                window.userShortId = window.generateShortId();
                
                await set(ref(db, 'users/' + window.currentUser.uid), { 
                    displayName: name, photoUrl: finalPhotoUrl,
                    shortId: window.userShortId, themeColor: "#FFD700",
                    bio: "I'm new here!", pronouns: ""
                });
                
                window.userProfileName = name; window.userPhotoUrl = finalPhotoUrl;
                window.userThemeColor = "#FFD700"; window.userBio = "I'm new here!"; window.userPronouns = "";
                if (typeof window.enterChat === 'function') window.enterChat();
            }
        } catch (error) { if(window.showToast) window.showToast("Error saving profile: " + error.message); }
    });
}

const updateProfileBtn = document.getElementById('update-profile-btn');
if (updateProfileBtn) {
    updateProfileBtn.addEventListener('click', async () => {
        try {
            const fileInput = document.getElementById('edit-photo-file');
            let finalPhotoUrl = window.userPhotoUrl;

            if (fileInput.files.length > 0) {
                const file = fileInput.files[0];
                const fileRef = sRef(storage, `avatars/${window.currentUser.uid}`);
                await uploadBytesResumable(fileRef, file);
                finalPhotoUrl = await getDownloadURL(fileRef);
            }

            const newName = document.getElementById('edit-display-name').value.trim();
            const newStatus = (document.getElementById('edit-status')?.value || '').trim();
            const newLinks = window.parseProfileLinks(document.getElementById('edit-links')?.value || '');
            // update() (not set()) so we don't wipe tier, phoneNumber, bookmarks, etc. on the user node.
            await update(ref(db, 'users/' + window.currentUser.uid), {
                displayName: newName,
                photoUrl: finalPhotoUrl,
                pronouns: document.getElementById('edit-pronouns').value.trim(),
                bio: document.getElementById('edit-bio').value.trim(),
                themeColor: document.getElementById('edit-theme-color').value,
                status: newStatus,
                links: newLinks,
                shortId: window.userShortId
            });

            window.userProfileName = newName;
            window.userPhotoUrl = finalPhotoUrl;
            window.userPronouns = document.getElementById('edit-pronouns').value.trim();
            window.userBio = document.getElementById('edit-bio').value.trim();
            window.userThemeColor = document.getElementById('edit-theme-color').value;
            window.userStatus = newStatus;
            window.userLinks = newLinks;

            document.getElementById('toggle-edit-btn').click(); 
            if(window.showToast) window.showToast("Profile Updated!");
        } catch (error) { if(window.showToast) window.showToast("Error updating profile: " + error.message); }
    });
}

const deleteAccountBtn = document.getElementById('delete-account-btn');
if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener('click', async () => {
        const confirmationText = prompt("WARNING: Account deletion is permanent.\nPlease type exactly:\nI WANT DELETION\n\nto confirm.");
        if (confirmationText === "I WANT DELETION") {
            try {
                await remove(ref(db, 'users/' + window.currentUser.uid));
                await deleteUser(window.currentUser);
                if(window.showToast) window.showToast("Account deleted successfully.");
                window.location.reload();
            } catch (error) {
                if (error.code === 'auth/requires-recent-login') {
                    if(window.showToast) window.showToast("For your security, Firebase requires you to log out and log back in right before deleting your account.");
                } else { if(window.showToast) window.showToast("Failed to delete account: " + error.message); }
            }
        } else if (confirmationText !== null) { if(window.showToast) window.showToast("Account deletion cancelled: You did not type 'I WANT DELETION' correctly."); }
    });
}

const logoutBtn = document.getElementById('logout-btn');
if(logoutBtn) {
    logoutBtn.addEventListener('click', () => { 
        document.getElementById('settings-modal').classList.add('hidden'); 
        document.getElementById('modal-overlay').classList.add('hidden'); 
        sessionStorage.removeItem('blipLoaded');
        signOut(auth); 
    });
}

// --- FORMS & LOGIN BUTTONS ---
const loginBtn = document.getElementById('show-login-btn');
const signupBtn = document.getElementById('show-signup-btn');
const loginForm = document.getElementById('email-login-form');
const signupForm = document.getElementById('email-signup-form');

if (loginBtn && signupBtn) {
    loginBtn.addEventListener('click', () => {
        loginBtn.classList.add('active'); signupBtn.classList.remove('active');
        if(loginForm) loginForm.classList.remove('hidden'); 
        if(signupForm) signupForm.classList.add('hidden');
    });
    signupBtn.addEventListener('click', () => {
        signupBtn.classList.add('active'); loginBtn.classList.remove('active');
        if(signupForm) signupForm.classList.remove('hidden'); 
        if(loginForm) loginForm.classList.add('hidden');
    });
}

const loginNext = document.getElementById('login-next-btn');
if (loginNext) {
    loginNext.addEventListener('click', () => {
        if (document.getElementById('login-email').checkValidity()) {
            document.getElementById('login-step-1').classList.add('hidden');
            document.getElementById('login-step-2').classList.remove('hidden');
        } else { document.getElementById('login-email').reportValidity(); }
    });
    document.getElementById('login-back-btn').addEventListener('click', () => {
        document.getElementById('login-step-2').classList.add('hidden');
        document.getElementById('login-step-1').classList.remove('hidden');
    });
}

const signupNext1 = document.getElementById('signup-next-1-btn');
if (signupNext1) {
    signupNext1.addEventListener('click', () => {
        if (document.getElementById('signup-email').checkValidity()) {
            document.getElementById('signup-step-1').classList.add('hidden');
            document.getElementById('signup-step-2').classList.remove('hidden');
        } else { document.getElementById('signup-email').reportValidity(); }
    });
    document.getElementById('signup-back-1-btn').addEventListener('click', () => {
        document.getElementById('signup-step-2').classList.add('hidden');
        document.getElementById('signup-step-1').classList.remove('hidden');
    });
    
    document.getElementById('signup-next-2-btn').addEventListener('click', () => {
        if (document.getElementById('signup-username').checkValidity()) {
            document.getElementById('signup-step-2').classList.add('hidden');
            document.getElementById('signup-step-3').classList.remove('hidden');
        } else { document.getElementById('signup-username').reportValidity(); }
    });
    document.getElementById('signup-back-2-btn').addEventListener('click', () => {
        document.getElementById('signup-step-3').classList.add('hidden');
        document.getElementById('signup-step-2').classList.remove('hidden');
    });
}

if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        const username = document.getElementById('signup-username').value;
        const phone = document.getElementById('signup-phone').value;
        
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(userCredential.user, { displayName: username });
            const userShortId = window.generateShortId();
            await set(ref(db, 'users/' + userCredential.user.uid), { 
                displayName: username, phoneNumber: phone,
                photoUrl: window.getAvatarUrl(username, ""), shortId: userShortId, 
                themeColor: "#FFD700", bio: "I'm new here!", pronouns: "",
                createdAt: userCredential.user.metadata.creationTime
            });
        } catch (error) { if(window.showToast) window.showToast("Sign Up Error: " + error.message); }
    });
}

if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        try { await signInWithEmailAndPassword(auth, email, password); } 
        catch (error) { if(window.showToast) window.showToast("Login Error: " + error.message); }
    });
}

const googleLoginBtn = document.getElementById('google-login-btn');
if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', async () => { 
        try { await signInWithPopup(auth, new GoogleAuthProvider()); } 
        catch (error) {
            if (error.code !== 'auth/popup-closed-by-user') {
                if(window.showToast) window.showToast("Google Sign-In failed: " + error.message);
            }
        }
    });
}

const googleSignupBtn = document.getElementById('google-signup-btn');
if (googleSignupBtn) {
    googleSignupBtn.addEventListener('click', async () => { 
        try { await signInWithPopup(auth, new GoogleAuthProvider()); } 
        catch (error) {
            if (error.code !== 'auth/popup-closed-by-user') {
                if(window.showToast) window.showToast("Google Sign-Up failed: " + error.message);
            }
        }
    });
}

if (window.Capacitor && window.Capacitor.isNativePlatform()) {
    const googleLoginBtnObj = document.getElementById('google-login-btn');
    const googleSignupBtnObj = document.getElementById('google-signup-btn');
    if (googleLoginBtnObj) googleLoginBtnObj.style.display = 'none';
    if (googleSignupBtnObj) googleSignupBtnObj.style.display = 'none';

    const webLinks = document.querySelectorAll('.mobile-link[href="/"], .mobile-link[href="/story"]');
    webLinks.forEach(link => link.style.display = 'none');

    const logoLink = document.getElementById('nav-logo');
    if (logoLink) logoLink.href = 'chat.html';

    const chatLinks = document.querySelectorAll('a[href="/chat"]');
    chatLinks.forEach(link => link.href = 'chat.html');
}