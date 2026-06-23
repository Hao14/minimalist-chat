import { createElement, lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

const ChatPage = lazy(() => import('./pages/ChatPage.jsx'));
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
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
  ['/features', FeaturesPage],
  ['/download', DownloadPage],
  ['/story', StoryPage],
  ['/faq', FaqPage],
  ['/privacy', PrivacyPage],
  ['/terms', TermsPage],
];

export default function App() {
  return (
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
  );
}
