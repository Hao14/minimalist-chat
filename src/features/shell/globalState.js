window.activeRoomId = 'global';
window.activeRoomShortId = 'GLOBAL';
window.currentRoomListener = null;
window.oldestMessageKey = null;
window.isFetchingHistory = false;
window.activeReplyData = null;
window.currentPmRoomId = null;
window.currentPmTargetUid = null;
window.pmQueryRef = null;
window.MY_ADMIN_UID = 'WsREhwYvPxaCSAjz0aqvwAU1leg2';
window.activeMessageId = null;
window.muteTargetUid = null;
window.muteTargetName = null;
window.currentMuteTimeout = null;
window.currentMuteListenerRef = null;
window.chatInitialized = false;

window.currentUser = window.currentUser || null;
window.userProfileName = 'Anonymous';
window.userPhotoUrl = '';
window.userPronouns = '';
window.userBio = '';
window.userThemeColor = '#FFD700';
window.userStatus = '';
window.userLinks = [];
window.userBannerUrl = '';
window.userFlair = '';
window.userShortId = '';
window.userTier = 'free';
window.accountSubscriptionStatus = '';
window.userPhone = 'No phone on file';

window.getAvatarUrl = function getAvatarUrl(name, url) {
  if (url && url.trim() !== '') return url;
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=000&color=FFD700&bold=true`;
};

window.generateShortId = function generateShortId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};
