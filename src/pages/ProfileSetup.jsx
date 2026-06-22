// Migrated from the #profile-setup-container screen + save-new-profile-btn
// handler in auth.js. Shown after a first-time sign-in with no DB profile.
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function ProfileSetup() {
  const { completeProfileSetup } = useAuth();
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState('');

  async function handleSave() {
    if (!name.trim()) return;
    try {
      await completeProfileSetup(name.trim(), photo.trim());
    } catch (err) {
      showToast('Error saving profile: ' + err.message);
    }
  }

  return (
    <div className="container fade-in-up app-screen" id="profile-setup-container">
      <h1>
        Who are <span>you?</span>
      </h1>
      <input
        type="text"
        placeholder="Enter your display name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        type="url"
        placeholder="Image URL (Leave blank for auto)"
        value={photo}
        onChange={(e) => setPhoto(e.target.value)}
      />
      <button onClick={handleSave}>Enter Chat</button>
    </div>
  );
}
