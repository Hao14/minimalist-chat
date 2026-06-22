// Declarative router that replaces the imperative auth redirects the legacy
// auth.js did with window.location.replace(). The /join/:code deep-link the
// old firebase.json rewrite handled now routes through the protected Chat
// shell so the join flow can read the code after migration.
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Chat from './pages/Chat';
import ProfileSetup from './pages/ProfileSetup';

function BootScreen() {
  return (
    <div className="app-screen" id="loading-screen" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
        <div className="mascot-blip" style={{ margin: 0, cursor: 'default', width: 44, height: 36 }}>
          <div className="blip-eye left" />
          <div className="blip-eye right" />
        </div>
        <span style={{ fontWeight: 800, fontSize: '1.4rem', letterSpacing: 2 }}>MINIMALIST</span>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { authStatus, isAuthenticated, needsProfileSetup } = useAuth();
  const location = useLocation();

  if (authStatus === 'loading') return <BootScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />;
  if (needsProfileSetup) return <ProfileSetup />;
  return children;
}

export default function App() {
  const { authStatus, isAuthenticated } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={
          authStatus === 'loading' ? (
            <BootScreen />
          ) : isAuthenticated ? (
            <Navigate to="/chat" replace />
          ) : (
            <Login />
          )
        }
      />
      <Route
        path="/chat"
        element={
          <ProtectedRoute>
            <Chat />
          </ProtectedRoute>
        }
      />
      <Route
        path="/join/:code"
        element={
          <ProtectedRoute>
            <Chat />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/chat" replace />} />
    </Routes>
  );
}
