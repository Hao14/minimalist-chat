// App shell placeholder. The full chat UI (rooms, messages, docs, whiteboard,
// calendar, tasks, AI, etc.) will be migrated module-by-module into components
// under src/features/. For now this proves the auth-gated shell renders.
import { useAuth } from '../context/AuthContext';

export default function Chat() {
  const { profile, logout } = useAuth();

  return (
    <div className="chat-container-full app-screen" id="chat-wrapper">
      <div style={{ padding: '2rem' }}>
        <h1>
          Welcome, <span>{profile.displayName}</span>
        </h1>
        <p>
          The React shell is live. Chat features are being migrated from the
          legacy modules one at a time.
        </p>
        <button className="action-btn" onClick={logout} style={{ marginTop: '1rem' }}>
          Log Out
        </button>
      </div>
    </div>
  );
}
