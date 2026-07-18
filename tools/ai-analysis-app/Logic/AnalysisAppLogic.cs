using System.Globalization;
using System.Text;
using System.Text.Json;

namespace MinimalistAIAnalysis;

public enum AnalysisConnectionMode
{
    Local,
    Remote,
}

public enum AnalysisCapability
{
    ViewOverview,
    ViewAiStatus,
    ViewHealth,
    ViewUsers,
    ChangeAiMode,
    InstallModels,
    ControlBridge,
    ControlTunnel,
    ReadLocalLogs,
    ChooseWorkspace,
    UseConsole,
    ModerateUsers,
}

public enum ConsoleCommandCategory
{
    Empty,
    BuiltIn,
    Moderation,
    Unknown,
}

public enum ModerationCommandKind
{
    UserStatus,
    ModerationSummary,
    ListBanned,
    ListMuted,
    UserRooms,
    RoomStatus,
    RoomMembers,
    RoomLog,
    Ban,
    Unban,
    Mute,
    Unmute,
    RoomMute,
    RoomUnmute,
    Kick,
    DeleteMessage,
    DeleteAccount,
}

public enum ModerationConfirmationPolicy
{
    None,
    Confirm,
    DestructiveDelete,
}

public sealed record ParsedModerationCommand(
    ModerationCommandKind Kind,
    string CanonicalVerb,
    string[] Arguments,
    ModerationConfirmationPolicy ConfirmationPolicy);

public sealed record ModerationCommandParseResult(
    ParsedModerationCommand? Command,
    string? Error)
{
    public bool Success => Command is not null;
}

public enum AnalysisWindowWidthClass
{
    Compact,
    Standard,
    Wide,
}

public enum PublicTunnelDisplayState
{
    Off,
    Healthy,
    Recovering,
}

public enum RecoveryTaskSchedulerState
{
    Unknown = 0,
    Disabled = 1,
    Queued = 2,
    Ready = 3,
    Running = 4,
}

public enum RecoveryTaskDisplayState
{
    Unavailable,
    NotInstalled,
    Disabled,
    Waiting,
    Queued,
    Ready,
    Running,
    NeedsAttention,
}

public readonly record struct ActivityBucketSummary(
    int Count,
    int SuccessCount,
    int ErrorCount)
{
    public bool HasOutcomeBreakdown => SuccessCount + ErrorCount > 0;
}

public enum ApprovedOllamaModelProfile
{
    Fast,
    Smart,
    Vision,
}

public enum ApprovedOllamaModelState
{
    NotChecked,
    Missing,
    Ready,
}

public sealed record ApprovedOllamaModelDefinition(
    ApprovedOllamaModelProfile Profile,
    string DisplayName,
    string Model);

public sealed record ApprovedOllamaModelStatus(
    ApprovedOllamaModelDefinition Definition,
    ApprovedOllamaModelState State);

public sealed record WebsiteAiProviderRoute(
    string ProviderId,
    string DisplayName,
    int Capacity,
    bool Hosted,
    string[] Models);

public sealed record ApprovedOllamaModelsSummary(IReadOnlyList<ApprovedOllamaModelStatus> Models)
{
    public int ReadyCount => Models.Count(model => model.State == ApprovedOllamaModelState.Ready);
    public int RequiredCount => Models.Count;
    public bool WasChecked => Models.All(model => model.State != ApprovedOllamaModelState.NotChecked);
    public bool IsComplete => WasChecked && ReadyCount == RequiredCount;

    public string HealthText => !WasChecked
        ? "Not checked"
        : $"{ReadyCount} of {RequiredCount} ready";

    public string DetailText
    {
        get
        {
            if (!WasChecked) return "Approved models not checked · wake protected Ollama to verify";
            if (IsComplete) return "Fast, Smart, and Vision models ready";

            var missing = Models
                .Where(model => model.State == ApprovedOllamaModelState.Missing)
                .Select(model => model.Definition.DisplayName);
            return $"Missing: {string.Join(", ", missing)}";
        }
    }

    public ApprovedOllamaModelStatus Get(ApprovedOllamaModelProfile profile)
        => Models.First(model => model.Definition.Profile == profile);
}

public static class AnalysisAppLogic
{
    public const int ActivityBucketCount = 24;
    public const string DedicatedOllamaBaseUrl = "http://127.0.0.1:11435";
    public const string DedicatedOllamaHost = "127.0.0.1:11435";
    public const string PublicGatewayRecoveryTaskName = "Minimalist Chat Public Gateway Recovery";
    public const string RemoteAnalysisAgentTaskName = "Minimalist Chat Remote Analysis Agent";
    public const string ApprovedFastModel = "qwen3:4b-instruct";
    public const string ApprovedSmartModel = "qwen3:14b";
    public const string ApprovedVisionModel = "qwen2.5vl:7b";
    public const string WebsiteCloudflareModel = "@cf/qwen/qwen3-30b-a3b-fp8";
    public const string WebsiteGroqModel = "openai/gpt-oss-20b";
    public const int WebsiteAiTotalCapacity = 90;

    private const int DefaultIdleMinutes = 120;
    private const int DefaultIdleIndex = 2;
    private const int StandardWindowWidth = 1120;
    private const int WideWindowWidth = 1280;
    private const int ShortWindowHeight = 760;

    private static readonly int[] IdleMinutesByIndex = [30, 60, 120, 240];

    private static readonly ApprovedOllamaModelDefinition[] ApprovedOllamaModels =
    [
        new(ApprovedOllamaModelProfile.Fast, "Fast", ApprovedFastModel),
        new(ApprovedOllamaModelProfile.Smart, "Smart", ApprovedSmartModel),
        new(ApprovedOllamaModelProfile.Vision, "Vision", ApprovedVisionModel),
    ];

    private static readonly WebsiteAiProviderRoute[] WebsiteAiProviderRoutes =
    [
        new("ollama-bridge", "PC · Ollama", 10, false, [ApprovedFastModel, ApprovedSmartModel]),
        new("cloudflare-workers-ai", "Cloudflare Workers AI", 40, true, [WebsiteCloudflareModel]),
        new("groq", "Groq", 40, true, [WebsiteGroqModel]),
    ];

    private static readonly HashSet<string> BuiltInCommands = new(StringComparer.OrdinalIgnoreCase)
    {
        "help",
        "moderation-help",
        "status",
        "refresh",
        "start",
        "restart",
        "stop",
        "on",
        "off",
        "auto",
        "logs",
        "open logs",
        "clear",
        "copy",
    };

    private static readonly HashSet<string> SupportedBridgeActions = new(StringComparer.Ordinal)
    {
        "start-bridge",
        "restart-bridge",
        "stop-bridge",
        "start-ollama",
        "start-tunnel",
        "stop-tunnel",
    };

    private static readonly Dictionary<string, string> ModerationVerbs = new(StringComparer.OrdinalIgnoreCase)
    {
        ["user-status"] = "user-status",
        ["whois"] = "user-status",
        ["moderation-summary"] = "moderation-summary",
        ["list-banned"] = "list-banned",
        ["bans"] = "list-banned",
        ["list-muted"] = "list-muted",
        ["mutes"] = "list-muted",
        ["user-rooms"] = "user-rooms",
        ["room-status"] = "room-status",
        ["room-members"] = "room-members",
        ["room-log"] = "room-log",
        ["ban"] = "ban",
        ["unban"] = "unban",
        ["mute"] = "mute",
        ["unmute"] = "unmute",
        ["room-mute"] = "room-mute",
        ["timeout"] = "room-mute",
        ["room-unmute"] = "room-unmute",
        ["untimeout"] = "room-unmute",
        ["kick"] = "kick",
        ["delete-message"] = "delete-message",
        ["remove-message"] = "delete-message",
        ["delete-account"] = "delete-account",
    };

    private static readonly string[] ModerationHelpLines =
    [
        "Read: moderation-summary | list-banned | list-muted",
        "user-status <uid> | user-rooms <uid>",
        "room-status <roomId> | room-members <roomId> | room-log <roomId> [1-50]",
        "ban <uid> CONFIRM | unban <uid> CONFIRM",
        "mute <uid> CONFIRM | unmute <uid> CONFIRM",
        "room-mute <roomId> <uid> <1-43200|forever> CONFIRM",
        "room-unmute <roomId> <uid> CONFIRM | kick <roomId> <uid> CONFIRM",
        "delete-message global <messageId> DELETE <messageId>",
        "delete-message room <roomId> <messageId> DELETE <messageId>",
        "delete-message channel <roomId> <channelId> <messageId> DELETE <messageId>",
        "delete-account <uid> DELETE <uid>",
        "Aliases: whois, bans, mutes, timeout, untimeout, remove-message",
        "CONFIRM is case-insensitive. DELETE must be uppercase and the repeated ID must match exactly.",
        "Every mutation also opens a second confirmation dialog with No selected by default.",
    ];

    private static readonly string[] SensitiveLogMarkers =
    [
        "authorization",
        "bearer",
        "password",
        "secret",
        "token",
    ];

    public static bool IsCapabilityAllowed(AnalysisConnectionMode mode, AnalysisCapability capability)
        => mode == AnalysisConnectionMode.Local || capability is
            AnalysisCapability.ViewOverview or
            AnalysisCapability.ViewAiStatus or
            AnalysisCapability.ViewHealth;

    public static string FormatRemoteAnalysisAgentState(string? state)
        => state switch
        {
            "connected" => "Connected · read-only",
            "running" => "Running · localhost:8791",
            "starting" => "Starting",
            "stopped" => "Installed · not running",
            "disabled" => "Disabled",
            "not_installed" => "Not installed",
            _ => "Status unavailable",
        };

    public static bool IsRemoteAnalysisAgentStateNeutral(string? state)
        => state is "stopped" or "not_installed" or "unavailable";

    public static int IdleMinutesFromIndex(int selectedIndex)
        => (uint)selectedIndex < (uint)IdleMinutesByIndex.Length
            ? IdleMinutesByIndex[selectedIndex]
            : DefaultIdleMinutes;

    public static int IdleIndexFromMinutes(int minutes)
        => minutes switch
        {
            30 => 0,
            60 => 1,
            120 => 2,
            240 => 3,
            _ => DefaultIdleIndex,
        };

    public static AnalysisWindowWidthClass ClassifyWindowWidth(int clientWidth)
        => clientWidth switch
        {
            < StandardWindowWidth => AnalysisWindowWidthClass.Compact,
            < WideWindowWidth => AnalysisWindowWidthClass.Standard,
            _ => AnalysisWindowWidthClass.Wide,
        };

    public static bool IsShortWindowHeight(int clientHeight)
        => clientHeight < ShortWindowHeight;

    public static bool ShouldStackHeaderActions(AnalysisWindowWidthClass widthClass)
        => widthClass == AnalysisWindowWidthClass.Compact;

    public static ApprovedOllamaModelDefinition[] GetApprovedOllamaModels()
        => [.. ApprovedOllamaModels];

    public static WebsiteAiProviderRoute[] GetWebsiteAiProviderRoutes()
        => WebsiteAiProviderRoutes
            .Select(route => route with { Models = [.. route.Models] })
            .ToArray();

    public static string GetDefaultOllamaModelStore(string userProfileDirectory)
    {
        if (string.IsNullOrWhiteSpace(userProfileDirectory))
            throw new ArgumentException("A user profile directory is required.", nameof(userProfileDirectory));
        return Path.GetFullPath(Path.Combine(userProfileDirectory, ".ollama", "models"));
    }

    public static ApprovedOllamaModelDefinition GetApprovedOllamaModel(ApprovedOllamaModelProfile profile)
        => ApprovedOllamaModels.FirstOrDefault(model => model.Profile == profile)
            ?? throw new ArgumentOutOfRangeException(nameof(profile), profile, "Unknown approved Ollama model profile.");

    public static bool TryGetApprovedOllamaModel(string? model, out ApprovedOllamaModelDefinition? definition)
    {
        definition = string.IsNullOrEmpty(model)
            ? null
            : ApprovedOllamaModels.FirstOrDefault(item => string.Equals(item.Model, model, StringComparison.Ordinal));
        return definition is not null;
    }

    public static bool IsApprovedOllamaModel(string? model)
        => TryGetApprovedOllamaModel(model, out _);

    public static ApprovedOllamaModelsSummary SummarizeApprovedOllamaModels(
        IEnumerable<string>? installedModels,
        bool modelsChecked)
    {
        var installed = new HashSet<string>(
            (installedModels ?? [])
                .Where(model => !string.IsNullOrWhiteSpace(model)),
            StringComparer.OrdinalIgnoreCase);

        var statuses = ApprovedOllamaModels
            .Select(definition => new ApprovedOllamaModelStatus(
                definition,
                !modelsChecked
                    ? ApprovedOllamaModelState.NotChecked
                    : installed.Contains(definition.Model)
                        ? ApprovedOllamaModelState.Ready
                        : ApprovedOllamaModelState.Missing))
            .ToArray();
        return new ApprovedOllamaModelsSummary(statuses);
    }

    public static int CalculatePageHorizontalPadding(int clientWidth)
    {
        var basePadding = ClassifyWindowWidth(clientWidth) switch
        {
            AnalysisWindowWidthClass.Compact => 18,
            AnalysisWindowWidthClass.Standard => 24,
            _ => 34,
        };
        var centeredWidePadding = ((long)clientWidth - 1440) / 2;
        return (int)Math.Max(basePadding, centeredWidePadding);
    }

    public static int[] BuildActivityBuckets(IEnumerable<DateTime>? timestamps, DateTime now)
    {
        var buckets = new int[ActivityBucketCount];
        if (timestamps is null) return buckets;

        var windowStart = now.AddHours(-ActivityBucketCount);
        foreach (var timestamp in timestamps)
        {
            if (timestamp < windowStart || timestamp >= now) continue;

            var bucketIndex = (int)((timestamp - windowStart).Ticks / TimeSpan.TicksPerHour);
            buckets[Math.Clamp(bucketIndex, 0, ActivityBucketCount - 1)]++;
        }

        return buckets;
    }

    public static ActivityBucketSummary[] BuildActivityBucketSummaries(
        IEnumerable<(DateTime Timestamp, string? Result)>? activity,
        DateTime now)
    {
        var buckets = new ActivityBucketSummary[ActivityBucketCount];
        if (activity is null) return buckets;

        var windowStart = now.AddHours(-ActivityBucketCount);
        foreach (var item in activity)
        {
            if (item.Timestamp < windowStart || item.Timestamp >= now) continue;

            var bucketIndex = Math.Clamp(
                (int)((item.Timestamp - windowStart).Ticks / TimeSpan.TicksPerHour),
                0,
                ActivityBucketCount - 1);
            var bucket = buckets[bucketIndex];
            var successCount = bucket.SuccessCount;
            var errorCount = bucket.ErrorCount;
            if (string.Equals(item.Result, "success", StringComparison.OrdinalIgnoreCase)) successCount++;
            else if (string.Equals(item.Result, "error", StringComparison.OrdinalIgnoreCase)) errorCount++;
            buckets[bucketIndex] = new ActivityBucketSummary(bucket.Count + 1, successCount, errorCount);
        }

        return buckets;
    }

    public static int ActivityBucketIndexAt(double x, double graphLeft, double graphWidth)
    {
        if (!double.IsFinite(x) || !double.IsFinite(graphLeft) || !double.IsFinite(graphWidth) || graphWidth <= 0)
            return -1;
        if (x < graphLeft || x > graphLeft + graphWidth) return -1;

        var relativePosition = (x - graphLeft) / graphWidth;
        return Math.Min(ActivityBucketCount - 1, (int)(relativePosition * ActivityBucketCount));
    }

    public static (DateTime Start, DateTime End) ActivityBucketRange(DateTime now, int bucketIndex)
    {
        if ((uint)bucketIndex >= ActivityBucketCount)
            throw new ArgumentOutOfRangeException(nameof(bucketIndex));

        return (
            now.AddHours(-(ActivityBucketCount - bucketIndex)),
            now.AddHours(-(ActivityBucketCount - 1 - bucketIndex)));
    }

    public static bool ParseTunnelDesiredState(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return false;

        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return false;

            var properties = root.EnumerateObject().ToArray();
            return properties.Length == 2
                && properties.Count(property => property.NameEquals("schemaVersion")) == 1
                && properties.Count(property => property.NameEquals("desiredOn")) == 1
                && root.TryGetProperty("schemaVersion", out var schemaVersion)
                && schemaVersion.ValueKind == JsonValueKind.Number
                && schemaVersion.TryGetInt32(out var version)
                && version == 1
                && root.TryGetProperty("desiredOn", out var desiredOn)
                && desiredOn.ValueKind is JsonValueKind.True or JsonValueKind.False
                && desiredOn.GetBoolean();
        }
        catch (JsonException)
        {
            return false;
        }
    }

    public static PublicTunnelDisplayState ResolvePublicTunnelDisplayState(bool desiredOn, bool tunnelReady)
        => !desiredOn
            ? PublicTunnelDisplayState.Off
            : tunnelReady
                ? PublicTunnelDisplayState.Healthy
                : PublicTunnelDisplayState.Recovering;

    public static DateTime? NormalizeRecoveryTaskRunTime(DateTime value)
        => value <= new DateTime(1900, 1, 1) ? null : value;

    public static RecoveryTaskDisplayState ResolveRecoveryTaskDisplayState(
        bool? installed,
        bool enabled,
        RecoveryTaskSchedulerState schedulerState,
        uint? lastTaskResult,
        DateTime? lastRunTime)
    {
        if (!installed.HasValue) return RecoveryTaskDisplayState.Unavailable;
        if (!installed.Value) return RecoveryTaskDisplayState.NotInstalled;
        if (!enabled || schedulerState == RecoveryTaskSchedulerState.Disabled)
            return RecoveryTaskDisplayState.Disabled;

        return schedulerState switch
        {
            RecoveryTaskSchedulerState.Running => RecoveryTaskDisplayState.Running,
            RecoveryTaskSchedulerState.Queued => RecoveryTaskDisplayState.Queued,
            RecoveryTaskSchedulerState.Ready when !lastRunTime.HasValue => RecoveryTaskDisplayState.Waiting,
            RecoveryTaskSchedulerState.Ready when lastTaskResult == 0 => RecoveryTaskDisplayState.Ready,
            RecoveryTaskSchedulerState.Ready => RecoveryTaskDisplayState.NeedsAttention,
            _ => RecoveryTaskDisplayState.NeedsAttention,
        };
    }

    public static string FormatRecoveryTaskResult(uint? lastTaskResult)
        => lastTaskResult switch
        {
            null => "No completed result",
            0 => "Success",
            uint result => $"Result 0x{result:X8}",
        };

    public static bool IsSupportedBridgeAction(string? action)
        => action is not null && SupportedBridgeActions.Contains(action);

    public static string[] TokenizeCommand(string? command)
    {
        if (string.IsNullOrWhiteSpace(command)) return [];

        return command.Split(
            (char[]?)null,
            StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }

    public static ConsoleCommandCategory ClassifyCommand(IReadOnlyList<string>? tokens)
    {
        if (tokens is null || tokens.Count == 0) return ConsoleCommandCategory.Empty;

        if (!string.IsNullOrWhiteSpace(tokens[0]) && ModerationVerbs.ContainsKey(tokens[0]))
            return ConsoleCommandCategory.Moderation;

        var normalizedCommand = string.Join(' ', tokens);
        return BuiltInCommands.Contains(normalizedCommand)
            ? ConsoleCommandCategory.BuiltIn
            : ConsoleCommandCategory.Unknown;
    }

    public static bool HasValidModerationConfirmation(IReadOnlyList<string>? tokens)
    {
        var parsed = ParseModerationCommand(tokens);
        return parsed.Command is { ConfirmationPolicy: not ModerationConfirmationPolicy.None };
    }

    public static string[] GetModerationHelpLines() => [.. ModerationHelpLines];

    public static ModerationCommandParseResult ParseModerationCommand(IReadOnlyList<string>? tokens)
    {
        if (tokens is null || tokens.Count == 0 || string.IsNullOrWhiteSpace(tokens[0]))
            return Invalid("Type 'moderation-help' for the approved command syntax.");
        if (!ModerationVerbs.TryGetValue(tokens[0], out var verb))
            return Invalid("Unknown moderation command. Type 'moderation-help'.");

        return verb switch
        {
            "user-status" => ParseSingleIdentifier(tokens, verb, ModerationCommandKind.UserStatus, "UID"),
            "moderation-summary" => ParseNoArguments(tokens, verb, ModerationCommandKind.ModerationSummary),
            "list-banned" => ParseNoArguments(tokens, verb, ModerationCommandKind.ListBanned),
            "list-muted" => ParseNoArguments(tokens, verb, ModerationCommandKind.ListMuted),
            "user-rooms" => ParseSingleIdentifier(tokens, verb, ModerationCommandKind.UserRooms, "UID"),
            "room-status" => ParseSingleIdentifier(tokens, verb, ModerationCommandKind.RoomStatus, "room ID"),
            "room-members" => ParseSingleIdentifier(tokens, verb, ModerationCommandKind.RoomMembers, "room ID"),
            "room-log" => ParseRoomLog(tokens),
            "ban" => ParseUserConfirmation(tokens, verb, ModerationCommandKind.Ban),
            "unban" => ParseUserConfirmation(tokens, verb, ModerationCommandKind.Unban),
            "mute" => ParseUserConfirmation(tokens, verb, ModerationCommandKind.Mute),
            "unmute" => ParseUserConfirmation(tokens, verb, ModerationCommandKind.Unmute),
            "room-mute" => ParseRoomMute(tokens),
            "room-unmute" => ParseRoomUserConfirmation(tokens, verb, ModerationCommandKind.RoomUnmute),
            "kick" => ParseRoomUserConfirmation(tokens, verb, ModerationCommandKind.Kick),
            "delete-message" => ParseDeleteMessage(tokens),
            "delete-account" => ParseDeleteAccount(tokens),
            _ => Invalid("Unknown moderation command. Type 'moderation-help'."),
        };
    }

    public static string BuildModerationMessagePath(
        string scope,
        string? roomId,
        string? channelId,
        string messageId)
    {
        if (!IsValidFirebaseIdentifier(messageId))
            throw new ArgumentException("Invalid message ID. Use the exact Firebase identifier.", nameof(messageId));

        if (string.Equals(scope, "global", StringComparison.OrdinalIgnoreCase))
        {
            if (!string.IsNullOrEmpty(roomId) || !string.IsNullOrEmpty(channelId))
                throw new ArgumentException("Global messages do not accept room or channel IDs.", nameof(scope));
            return $"/messages/{messageId}";
        }

        if (!IsValidFirebaseIdentifier(roomId))
            throw new ArgumentException("Invalid room ID. Use the exact Firebase identifier.", nameof(roomId));
        if (string.Equals(scope, "room", StringComparison.OrdinalIgnoreCase))
        {
            if (!string.IsNullOrEmpty(channelId))
                throw new ArgumentException("Room messages do not accept a channel ID.", nameof(channelId));
            return $"/rooms_data/{roomId}/messages/{messageId}";
        }

        if (string.Equals(scope, "channel", StringComparison.OrdinalIgnoreCase))
        {
            if (!IsValidFirebaseIdentifier(channelId) || string.Equals(channelId, "general", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("Invalid channel ID. Use 'room' for the general channel.", nameof(channelId));
            return $"/rooms_data/{roomId}/channels/{channelId}/messages/{messageId}";
        }

        throw new ArgumentException("Message scope must be global, room, or channel.", nameof(scope));
    }

    public static bool IsValidFirebaseIdentifier(string? value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > 128) return false;

        return value.All(character =>
            char.IsLetterOrDigit(character)
            || character is '-' or '_');
    }

    public static bool IsSensitiveLogLine(string? line)
    {
        if (string.IsNullOrEmpty(line)) return false;

        return SensitiveLogMarkers.Any(marker =>
            line.Contains(marker, StringComparison.OrdinalIgnoreCase));
    }

    public static string ResolveUsername(
        string? directoryUsername,
        string? directoryDisplayName,
        string? profileDisplayName,
        string? profileUsername,
        string? profileName,
        string? authDisplayName,
        string? authEmail,
        string? directoryShortId = null,
        string? profileShortId = null)
    {
        foreach (var candidate in new[]
        {
            directoryUsername,
            directoryDisplayName,
            profileDisplayName,
            profileUsername,
            profileName,
            authDisplayName,
        })
        {
            var normalized = NormalizeDirectoryText(candidate);
            if (normalized.Length > 0) return normalized;
        }

        foreach (var candidate in new[] { directoryShortId, profileShortId })
        {
            var normalized = NormalizeDirectoryText(candidate);
            if (normalized.Length > 0) return normalized;
        }

        var email = authEmail?.Trim() ?? string.Empty;
        if (email.Length > 0)
        {
            var at = email.IndexOf('@');
            var localPart = at > 0 ? email[..at] : email;
            var normalized = NormalizeDirectoryText(localPart);
            if (normalized.Length > 0) return normalized;
        }

        return "Unknown user";
    }

    public static bool MatchesUserDirectoryQuery(string? userLabel, string? uid, string? query)
    {
        var normalized = query?.Trim() ?? string.Empty;
        if (normalized.Length == 0) return true;

        return (userLabel?.Contains(normalized, StringComparison.OrdinalIgnoreCase) ?? false)
            || (uid?.Contains(normalized, StringComparison.OrdinalIgnoreCase) ?? false);
    }

    private static ModerationCommandParseResult ParseNoArguments(
        IReadOnlyList<string> tokens,
        string verb,
        ModerationCommandKind kind)
        => tokens.Count == 1
            ? Valid(kind, verb)
            : Invalid($"Usage: {verb}");

    private static ModerationCommandParseResult ParseSingleIdentifier(
        IReadOnlyList<string> tokens,
        string verb,
        ModerationCommandKind kind,
        string identifierLabel)
    {
        if (tokens.Count != 2) return Invalid($"Usage: {verb} <{identifierLabel.Replace(" ", string.Empty)}>");
        return IsValidFirebaseIdentifier(tokens[1])
            ? Valid(kind, verb, [tokens[1]])
            : Invalid($"Invalid {identifierLabel}. Use the exact Firebase identifier.");
    }

    private static ModerationCommandParseResult ParseRoomLog(IReadOnlyList<string> tokens)
    {
        if (tokens.Count is < 2 or > 3) return Invalid("Usage: room-log <roomId> [1-50]");
        if (!IsValidFirebaseIdentifier(tokens[1])) return Invalid("Invalid room ID. Use the exact Firebase identifier.");
        var count = "20";
        if (tokens.Count == 3)
        {
            if (!IsAsciiIntegerInRange(tokens[2], 1, 50)) return Invalid("Room log count must be an integer from 1 to 50.");
            count = tokens[2];
        }
        return Valid(ModerationCommandKind.RoomLog, "room-log", [tokens[1], count]);
    }

    private static ModerationCommandParseResult ParseUserConfirmation(
        IReadOnlyList<string> tokens,
        string verb,
        ModerationCommandKind kind)
    {
        if (tokens.Count != 3) return Invalid($"Usage: {verb} <uid> CONFIRM");
        if (!IsValidFirebaseIdentifier(tokens[1])) return Invalid("Invalid UID. Use the exact Firebase identifier.");
        if (!IsConfirm(tokens[2])) return Invalid("The final token must be CONFIRM.");
        return Valid(kind, verb, [tokens[1]], ModerationConfirmationPolicy.Confirm);
    }

    private static ModerationCommandParseResult ParseRoomUserConfirmation(
        IReadOnlyList<string> tokens,
        string verb,
        ModerationCommandKind kind)
    {
        if (tokens.Count != 4) return Invalid($"Usage: {verb} <roomId> <uid> CONFIRM");
        if (!IsValidFirebaseIdentifier(tokens[1])) return Invalid("Invalid room ID. Use the exact Firebase identifier.");
        if (string.Equals(tokens[1], "global", StringComparison.OrdinalIgnoreCase))
            return Invalid("Global Chat does not use room membership or room mutes. Use the global mute command instead.");
        if (!IsValidFirebaseIdentifier(tokens[2])) return Invalid("Invalid UID. Use the exact Firebase identifier.");
        if (!IsConfirm(tokens[3])) return Invalid("The final token must be CONFIRM.");
        return Valid(kind, verb, [tokens[1], tokens[2]], ModerationConfirmationPolicy.Confirm);
    }

    private static ModerationCommandParseResult ParseRoomMute(IReadOnlyList<string> tokens)
    {
        if (tokens.Count != 5) return Invalid("Usage: room-mute <roomId> <uid> <1-43200|forever> CONFIRM");
        if (!IsValidFirebaseIdentifier(tokens[1])) return Invalid("Invalid room ID. Use the exact Firebase identifier.");
        if (string.Equals(tokens[1], "global", StringComparison.OrdinalIgnoreCase))
            return Invalid("Global Chat does not use room mutes. Use the global mute command instead.");
        if (!IsValidFirebaseIdentifier(tokens[2])) return Invalid("Invalid UID. Use the exact Firebase identifier.");
        var duration = string.Equals(tokens[3], "forever", StringComparison.OrdinalIgnoreCase)
            ? "forever"
            : IsAsciiIntegerInRange(tokens[3], 1, 43_200) ? tokens[3] : null;
        if (duration is null) return Invalid("Mute duration must be an integer from 1 to 43200, or 'forever'.");
        if (!IsConfirm(tokens[4])) return Invalid("The final token must be CONFIRM.");
        return Valid(ModerationCommandKind.RoomMute, "room-mute", [tokens[1], tokens[2], duration], ModerationConfirmationPolicy.Confirm);
    }

    private static ModerationCommandParseResult ParseDeleteAccount(IReadOnlyList<string> tokens)
    {
        if (tokens.Count != 4) return Invalid("Usage: delete-account <uid> DELETE <uid>");
        if (!IsValidFirebaseIdentifier(tokens[1])) return Invalid("Invalid UID. Use the exact Firebase identifier.");
        if (!string.Equals(tokens[2], "DELETE", StringComparison.Ordinal)) return Invalid("Account deletion requires the uppercase token DELETE.");
        if (!string.Equals(tokens[3], tokens[1], StringComparison.Ordinal)) return Invalid("The repeated UID must match exactly, including case.");
        return Valid(ModerationCommandKind.DeleteAccount, "delete-account", [tokens[1]], ModerationConfirmationPolicy.DestructiveDelete);
    }

    private static ModerationCommandParseResult ParseDeleteMessage(IReadOnlyList<string> tokens)
    {
        if (tokens.Count < 2) return Invalid("Usage: delete-message <global|room|channel> … DELETE <messageId>");
        var scope = tokens[1]?.ToLowerInvariant();
        string? roomId = null;
        string? channelId = null;
        string messageId;
        string deleteMarker;
        string repeatedId;

        switch (scope)
        {
            case "global" when tokens.Count == 5:
                messageId = tokens[2]; deleteMarker = tokens[3]; repeatedId = tokens[4];
                break;
            case "room" when tokens.Count == 6:
                roomId = tokens[2]; messageId = tokens[3]; deleteMarker = tokens[4]; repeatedId = tokens[5];
                break;
            case "channel" when tokens.Count == 7:
                roomId = tokens[2]; channelId = tokens[3]; messageId = tokens[4]; deleteMarker = tokens[5]; repeatedId = tokens[6];
                break;
            default:
                return Invalid("Usage: delete-message global <messageId> DELETE <messageId> | room <roomId> <messageId> DELETE <messageId> | channel <roomId> <channelId> <messageId> DELETE <messageId>");
        }

        try { _ = BuildModerationMessagePath(scope, roomId, channelId, messageId); }
        catch (ArgumentException error) { return Invalid(error.Message); }
        if (!string.Equals(deleteMarker, "DELETE", StringComparison.Ordinal)) return Invalid("Message deletion requires the uppercase token DELETE.");
        if (!string.Equals(repeatedId, messageId, StringComparison.Ordinal)) return Invalid("The repeated message ID must match exactly, including case.");

        return Valid(
            ModerationCommandKind.DeleteMessage,
            "delete-message",
            [scope, roomId ?? string.Empty, channelId ?? string.Empty, messageId],
            ModerationConfirmationPolicy.DestructiveDelete);
    }

    private static bool IsAsciiIntegerInRange(string? value, int minimum, int maximum)
        => !string.IsNullOrEmpty(value)
            && value.All(character => character is >= '0' and <= '9')
            && int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed)
            && parsed >= minimum
            && parsed <= maximum;

    private static ModerationCommandParseResult Valid(
        ModerationCommandKind kind,
        string verb,
        string[]? arguments = null,
        ModerationConfirmationPolicy confirmationPolicy = ModerationConfirmationPolicy.None)
        => new(new ParsedModerationCommand(kind, verb, arguments ?? [], confirmationPolicy), null);

    private static ModerationCommandParseResult Invalid(string error) => new(null, error);

    private static bool IsConfirm(string? value)
        => string.Equals(value, "CONFIRM", StringComparison.OrdinalIgnoreCase);

    private static string NormalizeDirectoryText(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var normalized = new StringBuilder(80);
        var pendingSpace = false;
        foreach (var rune in value.EnumerateRunes())
        {
            var category = Rune.GetUnicodeCategory(rune);
            if (Rune.IsWhiteSpace(rune) || category is UnicodeCategory.Control or UnicodeCategory.Format or UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator)
            {
                pendingSpace = normalized.Length > 0;
                continue;
            }

            var text = rune.ToString();
            var extra = text.Length + (pendingSpace ? 1 : 0);
            if (normalized.Length + extra > 80) break;
            if (pendingSpace) normalized.Append(' ');
            normalized.Append(text);
            pendingSpace = false;
        }
        return normalized.ToString();
    }
}
