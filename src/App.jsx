import { Component, createElement, lazy, Suspense, useLayoutEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';

const ChatPage = lazy(() => import('./pages/ChatPage.jsx'));
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const VaultSharePage = lazy(() => import('./features/vault/VaultSharePage.jsx'));
const marketingPage = (name) => lazy(() => import('./pages/MarketingPages.jsx').then((module) => ({ default: module[name] })));
const NativeHomePage = marketingPage('HomePage');
const FeaturesPage = marketingPage('FeaturesPage');
const DownloadPage = marketingPage('DownloadPage');
const StoryPage = marketingPage('StoryPage');
const FaqPage = marketingPage('FaqPage');
const PrivacyPage = marketingPage('PrivacyPage');
const TermsPage = marketingPage('TermsPage');
const NotFoundPage = marketingPage('NotFoundPage');

const pageRoutes = [
  ['/', NativeHomePage],
  ['/chat', ChatPage],
  ['/login', LoginPage],
  ['/vault/share/:shareId', VaultSharePage],
  ['/features', FeaturesPage],
  ['/download', DownloadPage],
  ['/story', StoryPage],
  ['/faq', FaqPage],
  ['/privacy', PrivacyPage],
  ['/terms', TermsPage],
];

function isMarketingPath(pathname) {
  return !(
    pathname.startsWith('/chat')
    || pathname.startsWith('/join')
    || pathname.startsWith('/login')
    || pathname.startsWith('/vault/share')
  );
}

function RouteFallback() {
  const path = typeof window === 'undefined' ? '/' : window.location.pathname;
  let label = 'Opening Minimalist…';

  if (path === '/' || path === '') {
    label = 'Preparing the homepage…';
  } else if (path.startsWith('/features')) {
    label = 'Preparing the feature tour…';
  } else if (path.startsWith('/login')) {
    label = 'Preparing secure sign in…';
  } else if (path.startsWith('/chat') || path.startsWith('/join')) {
    label = 'Opening your room shell…';
  } else if (path.startsWith('/vault/share')) {
    label = 'Opening secure vault share…';
  }

  return (
    <div className="route-loading" role="status" aria-live="polite">
      {label}
    </div>
  );
}

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Minimalist app render failed', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-error-boundary" role="alert">
          <div className="app-error-card">
            <span className="app-error-kicker">Minimalist recovered safely</span>
            <h1>Something in this screen crashed.</h1>
            <p>
              The app caught the error instead of leaving you on a blank page. Try reloading, or go back home.
            </p>
            <div className="app-error-actions">
              <button type="button" onClick={() => window.location.reload()}>Reload app</button>
              <a href="/">Go home</a>
            </div>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  const location = useLocation();

  useLayoutEffect(() => {
    if (!isMarketingPath(location.pathname)) return;
    document.body.className = 'marketing marketing-scroll';
    document.body.removeAttribute('style');
  }, [location.pathname]);

  return (
    <AppErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          {pageRoutes.map(([path, Page]) => (
            <Route key={path} path={path} element={createElement(Page)} />
          ))}
          <Route path="/join/:roomId" element={<ChatPage />} />
          <Route path="/404" element={<NotFoundPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </AppErrorBoundary>
  );
}
