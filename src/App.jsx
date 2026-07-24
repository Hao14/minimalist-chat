import { Component, createElement, lazy, Suspense, useLayoutEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { readAuthPresenceHint } from './lib/authPresenceHint.js';
import { loadMarketingPagesModule, readMarketingPagesModule } from './lib/marketingModuleLoader.js';

const ChatPage = lazy(() => import('./pages/ChatPage.jsx'));
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const VaultSharePage = lazy(() => import('./features/vault/VaultSharePage.jsx'));
const marketingPage = (name) => lazy(() => loadMarketingPagesModule().then((module) => ({ default: module[name] })));
const LazyHomePage = marketingPage('HomePage');
const FeaturesPage = marketingPage('FeaturesPage');
const PricingPage = marketingPage('PricingPage');
const DownloadPage = marketingPage('DownloadPage');
const StoryPage = marketingPage('StoryPage');
const FaqPage = marketingPage('FaqPage');
const PrivacyPage = marketingPage('PrivacyPage');
const TermsPage = marketingPage('TermsPage');
const NotFoundPage = marketingPage('NotFoundPage');

function HomeRoute() {
  const HomePage = readMarketingPagesModule()?.HomePage || LazyHomePage;
  return createElement(HomePage);
}

const pageRoutes = [
  ['/', HomeRoute],
  ['/login', LoginPage],
  ['/vault/share/:shareId', VaultSharePage],
  ['/features', FeaturesPage],
  ['/pricing', PricingPage],
  ['/download', DownloadPage],
  ['/story', StoryPage],
  ['/faq', FaqPage],
  ['/privacy', PrivacyPage],
  ['/terms', TermsPage],
];

function rememberProtectedRoute(pathname, search, hash) {
  try {
    const route = `${pathname}${search}${hash}`;
    if (pathname.startsWith('/join/')) sessionStorage.setItem('pendingJoinUrl', route);
    if (pathname === '/chat' && new URLSearchParams(search).has('notification')) {
      sessionStorage.setItem('pendingChatUrl', route);
    }
  } catch {
    // Storage can be unavailable in embedded or private browser contexts.
  }
}

function AuthenticatedChatRoute() {
  const location = useLocation();
  if (readAuthPresenceHint() === false) {
    rememberProtectedRoute(location.pathname, location.search, location.hash);
    return <Navigate to="/login" replace />;
  }
  return <ChatPage />;
}

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
  } else if (path.startsWith('/pricing')) {
    label = 'Preparing the plan comparison…';
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
    if (location.pathname.startsWith('/vault/share')) {
      document.body.className = 'vault-share-screen';
      document.body.removeAttribute('style');
      return;
    }

    if (!isMarketingPath(location.pathname)) return;
    document.body.className = 'marketing marketing-scroll';
    document.body.removeAttribute('style');
    document.documentElement.classList.remove('home-react-pending');
    if (!location.hash) window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname, location.hash]);

  return (
    <AppErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          {pageRoutes.map(([path, Page]) => (
            <Route key={path} path={path} element={createElement(Page)} />
          ))}
          <Route path="/chat" element={<AuthenticatedChatRoute />} />
          <Route path="/join/:roomId" element={<AuthenticatedChatRoute />} />
          <Route path="/404" element={<NotFoundPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </AppErrorBoundary>
  );
}
