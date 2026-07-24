import { UiButton } from '../../components/ui/UiButton.jsx';

function profileIcon(profileId) {
  if (profileId === 'smart') return 'ph-brain';
  if (profileId === 'auto') return 'ph-sparkle';
  return 'ph-lightning';
}

export function AiModelSegmentedControl({
  disabled = false,
  label = 'Response model',
  onChange,
  profiles,
  value,
}) {
  return (
    <div className="ai-model-segmented" role="group" aria-label={label}>
      {profiles.map((profile) => (
        <UiButton
          aria-pressed={profile.id === value}
          className="ai-model-segment"
          disabled={disabled}
          key={profile.id}
          onClick={() => onChange(profile.id)}
          title={profile.description}
          variant="inherit"
        >
          <i className={`ph-bold ${profileIcon(profile.id)}`} aria-hidden="true" />
          <span>{profile.label}</span>
        </UiButton>
      ))}
    </div>
  );
}
