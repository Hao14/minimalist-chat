// js/auth.js
import { auth, db } from '../../lib/firebase.js';
import { getRedirectResult, onAuthStateChanged } from 'firebase/auth';
import { ref, set, get } from 'firebase/database';
import { ensureAuthProfile, ensureWelcomeBadge, isGoogleAuthUser, syncPublicUserDirectory } from '../../lib/authProfile.js';
import { rememberAccount } from '../../lib/accountProfiles.js';
import { withTimeout } from '../../lib/promiseTimeout.js';

const PROFILE_READ_TIMEOUT_MS = 8_000;

function getSessionValue(key) {
    try {
        return sessionStorage.getItem(key);
    } catch {
        return null;
    }
}

function setSessionValue(key, value) {
    try {
        sessionStorage.setItem(key, value);
    } catch {
        // Some mobile auth webviews can block storage during redirects.
    }
}

function removeSessionValue(key) {
    try {
        sessionStorage.removeItem(key);
    } catch {
        // Some mobile auth webviews can block storage during redirects.
    }
}

if (getSessionValue('minimalistAddUserRedirect') === '1') {
    getRedirectResult(auth)
        .then((result) => {
            if (result?.user) window.showToast?.('Account added. You are now using the selected account.', false);
        })
        .catch((error) => {
            window.showToast?.(`Could not add account: ${error.message}`);
        })
        .finally(() => {
            removeSessionValue('minimalistAddUserRedirect');
        });
}

let chatLaunchStarted = false;

// Launch the chat shell at most once, regardless of which auth/profile path got
// us here. This is also the safety valve that prevents the boot loader from
// hanging forever if profile hydration fails.
function launchChatOnce() {
    if (chatLaunchStarted) return;
    if (typeof window.enterChat !== 'function') return;
    chatLaunchStarted = true;
    window.enterChat();
}

async function getWithRetry(path, attempts = 2, delayMs = 600) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            return await withTimeout(
                get(ref(db, path)),
                PROFILE_READ_TIMEOUT_MS,
                {
                    code: 'database/timeout',
                    message: 'Timed out while loading the user profile.',
                },
            );
        } catch (error) {
            lastError = error;
            // Firebase long polling cannot be cancelled once started. Avoid
            // stacking another pending read when this one reaches its deadline.
            if (error?.code === 'database/timeout') throw error;
            if (attempt < attempts - 1) {
                await new Promise((resolve) => { setTimeout(resolve, delayMs); });
            }
        }
    }
    throw lastError;
}

function currentInternalRoute() {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function safeInternalChatUrl(value) {
    if (!value) return '';
    try {
        const targetUrl = new URL(value, window.location.origin);
        if (targetUrl.origin !== window.location.origin || targetUrl.pathname !== '/chat') return '';
        if (targetUrl.searchParams.get('billing') === 'portal-return') {
            targetUrl.searchParams.delete('billing');
        }
        return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
    } catch {
        return '';
    }
}

function pendingAuthRedirectPath() {
    const pendingChatUrl = safeInternalChatUrl(getSessionValue('pendingChatUrl'));
    if (pendingChatUrl) return pendingChatUrl;

    const pendingJoinUrl = getSessionValue('pendingJoinUrl') || '';
    return pendingJoinUrl.startsWith('/join/') ? pendingJoinUrl : '/chat';
}

function rememberPendingAuthRoute() {
    try {
        const route = currentInternalRoute();
        const params = new URLSearchParams(window.location.search);
        if (window.location.pathname === '/chat' && params.has('notification')) {
            setSessionValue('pendingChatUrl', route);
        }
        if (window.location.pathname.startsWith('/join/')) {
            setSessionValue('pendingJoinUrl', route);
        }
    } catch {
        // Some mobile auth webviews can block storage during redirects.
    }
}

// --- AUTH ROUTER & STATE LISTENER ---
onAuthStateChanged(auth, async (user) => {
    const currentPage = window.location.pathname;
    const isLoginPage = currentPage.includes('login');
    const isChatPage = currentPage.includes('chat') || currentPage.includes('join');

    // React Router owns the public URLs; Firebase Hosting serves index.html for both.
    const loginUrl = '/login';

    if (user) {
        rememberAccount(user);
        document.querySelectorAll('.auth-only').forEach(el => el.classList.remove('hidden'));
        document.querySelectorAll('.admin-only').forEach((el) => el.classList.toggle('hidden', user.uid !== window.MY_ADMIN_UID));
        document.querySelectorAll('.guest-only').forEach(el => el.classList.add('hidden'));

        if (isLoginPage) { window.location.replace(pendingAuthRedirectPath()); return; }
        if (isChatPage) {
            window.currentUser = user;
            checkUserProfile(user.uid);
        }
    } else {
        window.currentUser = null;
        window.accountSubscriptionStatus = '';
        document.querySelectorAll('.auth-only').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.guest-only').forEach(el => el.classList.remove('hidden'));

        if (isChatPage) { 
            rememberPendingAuthRoute();
            window.location.replace(loginUrl); 
        }
    }
});

async function checkUserProfile(uid) {
    try {
        const snapshot = await getWithRetry('users/' + uid);
        if (snapshot.exists()) {
            const data = snapshot.val();
            window.applyPerformanceSettingsFromProfile?.(data.performanceSettings);
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
            window.accountSubscriptionStatus = String(data.stripeSubscriptionStatus || '').trim().toLowerCase();
            window.userPhone = data.phoneNumber || "No phone on file"; 
            rememberAccount(auth.currentUser, data);
            
            if (typeof window.updateBillingUI === 'function') window.updateBillingUI();
            
            if (!data.shortId) {
                window.userShortId = window.generateShortId();
                await set(ref(db, 'users/' + uid + '/shortId'), window.userShortId);
            } else { window.userShortId = data.shortId; }

            if (!data.createdAt && auth.currentUser) {
                await set(ref(db, 'users/' + uid + '/createdAt'), auth.currentUser.metadata.creationTime);
            }

            syncPublicUserDirectory(auth.currentUser, {
                ...data,
                shortId: window.userShortId,
            });

            // Everyone earns the Welcome badge once. This writes directly so it does
            // not depend on the community/social module having registered globals yet.
            if (!(data.badges && data.badges.welcome)) {
                try {
                    const result = await ensureWelcomeBadge(uid, data);
                    if (result.awardedAt) {
                        data.badges = {
                            ...(data.badges || {}),
                            welcome: result.awardedAt,
                        };
                    }
                    if (result.newlyAwarded) {
                        if (window.createNotification) window.createNotification(uid, 'badge', '🏅 You earned the "Welcome" badge!');
                        if (window.showToast) window.showToast('🏅 Badge earned: Welcome', false);
                    }
                } catch (badgeError) {
                    console.warn('Welcome badge award skipped', badgeError);
                }
            }

            launchChatOnce();
        } else if (isGoogleAuthUser(auth.currentUser)) {
            await ensureAuthProfile(auth.currentUser, { welcome: true });
            return checkUserProfile(uid);
        } else {
            // No profile yet (e.g. fresh email/password signup): auto-create one
            // from the account details and head straight into chat — no setup panel.
            await ensureAuthProfile(auth.currentUser, { welcome: true });
            return checkUserProfile(uid);
        }
    } catch (error) {
        if (window.showToast) window.showToast("Could not fully load your profile. You can keep using chat — some details may be missing.");
        console.warn('[auth] profile hydration failed', { errorCode: error?.code || 'unknown' });
        // Don't strand the user on the boot loader. getProfileSnapshot() already
        // falls back to the Firebase auth display name / sensible defaults.
        launchChatOnce();
    }
}
