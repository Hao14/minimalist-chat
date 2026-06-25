import { Component, createElement, lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

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
  return (
    <AppErrorBoundary>
      <Suspense fallback={<div className="route-loading" role="status">Loading Minimalist…</div>}>
        <Routes>
          {pageRoutes.map(([path, Page]) => (
            <Route key={path} path={path} element={createElement(Page)} />
          ))}
          <Route path="/join/:roomId" element={<ChatPage />} />
          <Route path="/404" element={<NotFoundPage />} />
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Routes>
      </Suspense>
    </AppErrorBoundary>
  );
}
