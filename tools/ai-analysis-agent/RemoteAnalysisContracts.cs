namespace MinimalistAIAnalysis.Agent;

internal sealed record RemoteAgentPingV1(int SchemaVersion, string Status, bool ReadOnly, string TaskName);

internal sealed record RemoteAgentCapabilitiesV1(bool ReadOnly, bool ControlsAvailable);

internal sealed record RemoteModelStatusV1(string Profile, string State);

internal sealed record RemoteActivityEntryV1(
    DateTimeOffset TimeUtc,
    string Feature,
    string ModelProfile,
    int DurationMs,
    string Result);

internal sealed record RemoteAiStatusV1(
    string Mode,
    int IdleMinutes,
    string OllamaState,
    RemoteModelStatusV1[] ApprovedModels,
    DateTimeOffset? LastActivityAtUtc,
    RemoteActivityEntryV1[] Activity);

internal sealed record RemoteBridgeStatusV1(bool Ready, bool IdentityVerified);

internal sealed record RemoteTunnelStatusV1(bool DesiredOn, string State);

internal sealed record RemoteRecoveryTaskStatusV1(
    string Name,
    bool? Installed,
    bool Enabled,
    string State,
    string? LastResult,
    DateTimeOffset? LastRunAtUtc);

internal sealed record RemoteAnalysisSnapshotV1(
    int SchemaVersion,
    DateTimeOffset ObservedAtUtc,
    string AgentVersion,
    RemoteAgentCapabilitiesV1 Capabilities,
    RemoteAiStatusV1 Ai,
    RemoteBridgeStatusV1 Bridge,
    RemoteTunnelStatusV1 Tunnel,
    RemoteRecoveryTaskStatusV1 RecoveryTask,
    string[] Warnings);
