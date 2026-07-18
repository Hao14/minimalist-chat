let appLoading = false;

const loadApp = () => {
  if (appLoading) return;
  appLoading = true;
  import('./main.jsx');
};

// This module is loaded after #root in index.html, so delaying the home route
// until DOMContentLoaded only extends the static-to-React handoff.
loadApp();
