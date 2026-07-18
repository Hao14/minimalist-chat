using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace MinimalistAIAnalysis;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new AnalysisForm(new BridgeClient(), new RemoteAnalysisClient()));
    }
}

internal sealed record ActivityEntry(DateTime Time, string Feature, string Model, int DurationMs, string Result);

internal sealed record UserGrowthPoint(DateTime Date, int Count);

internal sealed record UserDirectoryEntry(
    string Uid,
    string UserLabel,
    bool Paid,
    bool Active,
    DateTime? CreatedAt);

internal sealed record PlatformSnapshot(
    int TotalUsers,
    int ActiveUsers,
    int PaidMemberships,
    int NewUsers30Days,
    int UnclassifiedPaidMemberships,
    UserDirectoryEntry[] Users,
    UserGrowthPoint[] Growth,
    DateTime RetrievedAt,
    string? Warning);

internal sealed record OllamaModelsResult(bool Checked, string[] Models);

internal sealed record RecoveryTaskSnapshot(
    string Name,
    bool? Installed,
    bool Enabled,
    RecoveryTaskSchedulerState SchedulerState,
    uint? LastTaskResult,
    DateTime? LastRunTime,
    string? Error);

internal sealed record AnalysisSnapshot(
    bool OllamaReady,
    bool BridgeReady,
    bool TunnelReady,
    bool TunnelDesiredOn,
    RecoveryTaskSnapshot RecoveryTask,
    string PublicUrl,
    string Mode,
    int IdleMinutes,
    string[] Models,
    bool ModelsChecked,
    DateTime? LastActivity,
    ActivityEntry[] Activity,
    PlatformSnapshot Platform,
    string? Warning,
    AnalysisConnectionMode ConnectionMode = AnalysisConnectionMode.Local,
    bool RemoteAgentReady = false,
    string RemoteAgentState = "unavailable");

internal interface IRecoveryTaskStatusReader
{
    RecoveryTaskSnapshot Read();
}

internal sealed class WindowsRecoveryTaskStatusReader : IRecoveryTaskStatusReader
{
    private const int FileNotFoundHResult = unchecked((int)0x80070002);
    private const int TaskNotFoundHResult = unchecked((int)0x8004130F);

    public RecoveryTaskSnapshot Read()
        => ReadTask(AnalysisAppLogic.PublicGatewayRecoveryTaskName);

    internal static RecoveryTaskSnapshot ReadTask(string taskName)
    {
        object? service = null;
        object? rootFolder = null;
        object? registeredTask = null;
        try
        {
            var serviceType = Type.GetTypeFromProgID("Schedule.Service")
                ?? throw new InvalidOperationException("Windows Task Scheduler is unavailable.");
            service = Activator.CreateInstance(serviceType)
                ?? throw new InvalidOperationException("Windows Task Scheduler could not be opened.");
            dynamic scheduler = service;
            scheduler.Connect();
            rootFolder = scheduler.GetFolder("\\");
            registeredTask = ((dynamic)rootFolder).GetTask(taskName);

            dynamic task = registeredTask;
            var actualName = (string)task.Name;
            if (!string.Equals(actualName, taskName, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Windows returned an unexpected scheduled task.");

            var rawState = (int)task.State;
            var schedulerState = Enum.IsDefined(typeof(RecoveryTaskSchedulerState), rawState)
                ? (RecoveryTaskSchedulerState)rawState
                : RecoveryTaskSchedulerState.Unknown;
            var lastRunTime = AnalysisAppLogic.NormalizeRecoveryTaskRunTime((DateTime)task.LastRunTime);
            var lastTaskResult = unchecked((uint)(int)task.LastTaskResult);

            return new RecoveryTaskSnapshot(
                taskName,
                Installed: true,
                Enabled: (bool)task.Enabled,
                schedulerState,
                lastTaskResult,
                lastRunTime,
                Error: null);
        }
        catch (COMException error) when (error.HResult is FileNotFoundHResult or TaskNotFoundHResult)
        {
            return new RecoveryTaskSnapshot(
                taskName,
                Installed: false,
                Enabled: false,
                RecoveryTaskSchedulerState.Unknown,
                LastTaskResult: null,
                LastRunTime: null,
                Error: null);
        }
        catch (Exception error)
        {
            return new RecoveryTaskSnapshot(
                taskName,
                Installed: null,
                Enabled: false,
                RecoveryTaskSchedulerState.Unknown,
                LastTaskResult: null,
                LastRunTime: null,
                Error: error.Message);
        }
        finally
        {
            ReleaseComObject(registeredTask);
            ReleaseComObject(rootFolder);
            ReleaseComObject(service);
        }
    }

    private static void ReleaseComObject(object? value)
    {
        if (value is not null && Marshal.IsComObject(value))
            Marshal.FinalReleaseComObject(value);
    }
}

internal sealed class BridgeClient
{
    private const int Port = 8790;
    private const string FirebaseProject = "chat-app-356c1";
    private const string ProtectedAdminUid = "WsREhwYvPxaCSAjz0aqvwAU1leg2";
    private const string DedicatedOllamaBaseUrl = AnalysisAppLogic.DedicatedOllamaBaseUrl;
    public const string ApprovedFastModel = AnalysisAppLogic.ApprovedFastModel;
    public const string ApprovedSmartModel = AnalysisAppLogic.ApprovedSmartModel;
    public const string ApprovedVisionModel = AnalysisAppLogic.ApprovedVisionModel;
    private const int ModelInstallTimeoutMs = 45 * 60 * 1000;
    private static readonly string AppDataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MinimalistAIAnalysis");
    private static readonly string SettingsPath = Path.Combine(AppDataDirectory, "settings.json");
    private static readonly string AuthExportDirectory = Path.Combine(AppDataDirectory, "Temp", "FirebaseAuth");
    private static readonly string DedicatedOllamaModelStore = AnalysisAppLogic.GetDefaultOllamaModelStore(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
    private static readonly IReadOnlyDictionary<string, string?> DedicatedOllamaEnvironment = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase)
    {
        ["OLLAMA_HOST"] = AnalysisAppLogic.DedicatedOllamaHost,
        ["OLLAMA_MODELS"] = DedicatedOllamaModelStore,
    };
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(15) };
    private readonly SemaphoreSlim _tokenLock = new(1, 1);
    private readonly IRecoveryTaskStatusReader _recoveryTaskStatusReader;
    private string _repoRoot;
    private string? _token;

    public BridgeClient(IRecoveryTaskStatusReader? recoveryTaskStatusReader = null)
    {
        _recoveryTaskStatusReader = recoveryTaskStatusReader ?? new WindowsRecoveryTaskStatusReader();
        _repoRoot = FindRepoRoot();
        try
        {
            Directory.CreateDirectory(AuthExportDirectory);
            CleanupStaleAuthExports();
        }
        catch { }
    }

    public bool IsConfigured => HasBridgeControlScript(_repoRoot);
    public string RepoRoot => IsConfigured ? _repoRoot : "Not configured";
    public string LogDirectory => IsConfigured
        ? Path.Combine(_repoRoot, ".bridge-control")
        : Path.Combine(AppDataDirectory, "Logs");

    public async Task<AnalysisSnapshot> LoadAsync(CancellationToken cancellationToken = default)
    {
        var platformTask = LoadPlatformAsync(cancellationToken);
        var localTask = LoadLocalAsync(EmptyPlatformSnapshot(), cancellationToken);
        await Task.WhenAll(platformTask, localTask);
        return (await localTask) with { Platform = await platformTask };
    }

    public Task<AnalysisSnapshot> LoadAsync(PlatformSnapshot platform, CancellationToken cancellationToken = default)
        => LoadLocalAsync(platform, cancellationToken);

    public async Task<AnalysisSnapshot> LoadLocalAsync(PlatformSnapshot platform, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(platform);
        var modelsTask = LoadOllamaModelsAsync(cancellationToken);
        var bridgeReadyTask = HasProtectedMarkerAsync($"http://127.0.0.1:{Port}/health", cancellationToken);
        var recoveryTaskStatusTask = Task.Run(() => _recoveryTaskStatusReader.Read(), cancellationToken);
        var remoteAgentTaskStatusTask = Task.Run(
            () => WindowsRecoveryTaskStatusReader.ReadTask(AnalysisAppLogic.RemoteAnalysisAgentTaskName),
            cancellationToken);
        var remoteAgentBoundaryTask = HasRemoteAgentBoundaryAsync(cancellationToken);
        var modelResult = await modelsTask;
        var models = modelResult.Models;
        var modelsChecked = modelResult.Checked;
        var bridgeReady = await bridgeReadyTask;
        var recoveryTask = await recoveryTaskStatusTask;
        var remoteAgentTask = await remoteAgentTaskStatusTask;
        var remoteAgentReady = await remoteAgentBoundaryTask;
        var remoteAgentState = remoteAgentReady
            ? "running"
            : remoteAgentTask.Installed switch
            {
                false => "not_installed",
                null => "unavailable",
                _ when !remoteAgentTask.Enabled => "disabled",
                _ when remoteAgentTask.SchedulerState == RecoveryTaskSchedulerState.Running => "starting",
                _ => "stopped",
            };
        var publicUrl = ReadPublicUrl();
        var tunnelDesiredOn = ReadTunnelDesiredState();
        var tunnelReady = !string.IsNullOrWhiteSpace(publicUrl) && await HasProtectedMarkerAsync($"{publicUrl.TrimEnd('/')}/health", cancellationToken);
        var mode = "auto";
        var idleMinutes = 120;
        var ollamaReady = modelsChecked;
        DateTime? lastActivity = null;
        var activity = Array.Empty<ActivityEntry>();
        string? warning = IsConfigured ? null : RepoConfigurationError("reading or controlling the protected bridge").Message;

        if (bridgeReady)
        {
            try
            {
                using var response = await SendAuthorizedAsync(
                    () => new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{Port}/control/status"),
                    cancellationToken);
                response.EnsureSuccessStatusCode();
                using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
                var root = document.RootElement;
                mode = root.TryGetProperty("mode", out var modeNode) ? modeNode.GetString() ?? mode : mode;
                idleMinutes = root.TryGetProperty("idleMinutes", out var idleNode) ? idleNode.GetInt32() : idleMinutes;
                if (root.TryGetProperty("ollamaReady", out var readyNode))
                {
                    ollamaReady = readyNode.GetBoolean();
                    modelsChecked = ollamaReady;
                }
                if (root.TryGetProperty("models", out var modelNode) && modelNode.ValueKind == JsonValueKind.Array)
                    models = modelNode.EnumerateArray().Select(item => item.GetString() ?? "").Where(item => item.Length > 0).ToArray();
                if (root.TryGetProperty("lastActivityAt", out var lastNode) && lastNode.ValueKind == JsonValueKind.String && DateTime.TryParse(lastNode.GetString(), out var parsed))
                    lastActivity = parsed.ToLocalTime();
                if (root.TryGetProperty("activity", out var activityNode) && activityNode.ValueKind == JsonValueKind.Array)
                    activity = activityNode.EnumerateArray().Select(ParseActivity).Where(item => item is not null).Cast<ActivityEntry>().ToArray();
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (Exception error)
            {
                warning = $"Bridge control authentication is unavailable: {error.Message}";
            }
        }

        return new AnalysisSnapshot(
            ollamaReady,
            bridgeReady,
            tunnelReady,
            tunnelDesiredOn,
            recoveryTask,
            publicUrl,
            mode,
            idleMinutes,
            models,
            modelsChecked,
            lastActivity,
            activity,
            platform,
            warning,
            AnalysisConnectionMode.Local,
            remoteAgentReady,
            remoteAgentState);
    }

    private async Task<bool> HasRemoteAgentBoundaryAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "http://127.0.0.1:8791/v1/ping");
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            return response.StatusCode == HttpStatusCode.Unauthorized &&
                response.Headers.TryGetValues("X-Minimalist-Analysis-Agent", out var values) &&
                values.Count() == 1 && string.Equals(values.Single(), "1", StringComparison.Ordinal);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch { return false; }
    }

    public async Task<PlatformSnapshot> LoadPlatformAsync(CancellationToken cancellationToken = default)
    {
        var tempAuthFile = "";
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            Directory.CreateDirectory(AuthExportDirectory);
            CleanupStaleAuthExports();
            tempAuthFile = Path.Combine(AuthExportDirectory, $"auth-export-{Guid.NewGuid():N}.json");
            var repoRoot = RequireRepoRoot("loading Firebase platform analytics");
            var firebase = FirebaseCliLocator.Resolve(repoRoot);
            var authTask = RunFirebaseCliAsync(firebase, ["auth:export", tempAuthFile, "--format=json"], 90_000, cancellationToken);
            var usersTask = RunFirebaseCliAsync(firebase, ["database:get", "/users"], 90_000, cancellationToken);
            var directoryTask = RunFirebaseCliAsync(firebase, ["database:get", "/user_directory"], 90_000, cancellationToken);
            var presenceTask = RunFirebaseCliAsync(firebase, ["database:get", "/presence"], 90_000, cancellationToken);
            await Task.WhenAll(authTask, usersTask, directoryTask, presenceTask);

            var authResult = await authTask;
            var usersResult = await usersTask;
            var directoryResult = await directoryTask;
            var presenceResult = await presenceTask;
            if (authResult.ExitCode != 0 || !File.Exists(tempAuthFile)) throw new InvalidOperationException("Firebase Auth analytics could not be read. Sign in with Firebase CLI and retry.");
            if (usersResult.ExitCode != 0) throw new InvalidOperationException("Membership analytics could not be read from Firebase.");
            if (presenceResult.ExitCode != 0) throw new InvalidOperationException("Active-user analytics could not be read from Firebase.");

            using var authDocument = JsonDocument.Parse(await File.ReadAllTextAsync(tempAuthFile, cancellationToken));
            var authUsers = authDocument.RootElement.TryGetProperty("users", out var authUsersNode) && authUsersNode.ValueKind == JsonValueKind.Array
                ? authUsersNode.EnumerateArray().ToArray()
                : [];
            var authIds = authUsers
                .Select(user => user.TryGetProperty("localId", out var id) ? id.GetString() ?? "" : "")
                .Where(id => id.Length > 0)
                .ToHashSet(StringComparer.Ordinal);

            var today = DateTime.Today;
            var growthBuckets = Enumerable.Range(0, 30).ToDictionary(index => today.AddDays(index - 29), _ => 0);
            foreach (var user in authUsers)
            {
                var createdAt = ParseAuthCreatedAt(user);
                if (createdAt is null) continue;
                var date = createdAt.Value.Date;
                if (growthBuckets.ContainsKey(date)) growthBuckets[date]++;
            }

            using var usersDocument = JsonDocument.Parse(string.IsNullOrWhiteSpace(usersResult.Output) ? "null" : usersResult.Output);
            var privateProfiles = usersDocument.RootElement.ValueKind == JsonValueKind.Object
                ? usersDocument.RootElement.EnumerateObject().ToDictionary(profile => profile.Name, profile => profile.Value.Clone(), StringComparer.Ordinal)
                : new Dictionary<string, JsonElement>(StringComparer.Ordinal);
            using var directoryDocument = JsonDocument.Parse(
                directoryResult.ExitCode == 0 && !string.IsNullOrWhiteSpace(directoryResult.Output)
                    ? directoryResult.Output
                    : "null");
            var directoryProfiles = directoryDocument.RootElement.ValueKind == JsonValueKind.Object
                ? directoryDocument.RootElement.EnumerateObject().ToDictionary(profile => profile.Name, profile => profile.Value.Clone(), StringComparer.Ordinal)
                : new Dictionary<string, JsonElement>(StringComparer.Ordinal);
            var paidMemberships = 0;
            var unclassifiedPaid = 0;
            var paidUserIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var profile in privateProfiles)
            {
                if (!authIds.Contains(profile.Key) || profile.Value.ValueKind != JsonValueKind.Object) continue;
                var status = JsonText(profile.Value, "stripeSubscriptionStatus") ?? string.Empty;
                if (!string.Equals(status, "active", StringComparison.OrdinalIgnoreCase) && !string.Equals(status, "trialing", StringComparison.OrdinalIgnoreCase)) continue;
                paidMemberships++;
                paidUserIds.Add(profile.Key);
                var tier = JsonText(profile.Value, "tier") ?? "free";
                if (string.IsNullOrWhiteSpace(tier) || string.Equals(tier, "free", StringComparison.OrdinalIgnoreCase)) unclassifiedPaid++;
            }

            using var presenceDocument = JsonDocument.Parse(string.IsNullOrWhiteSpace(presenceResult.Output) ? "null" : presenceResult.Output);
            var activeUserIds = new HashSet<string>(StringComparer.Ordinal);
            if (presenceDocument.RootElement.ValueKind == JsonValueKind.Object)
            {
                foreach (var presence in presenceDocument.RootElement.EnumerateObject())
                {
                    if (!authIds.Contains(presence.Name) || presence.Value.ValueKind != JsonValueKind.Object) continue;
                    var state = JsonText(presence.Value, "state") ?? string.Empty;
                    if (string.Equals(state, "online", StringComparison.OrdinalIgnoreCase)) activeUserIds.Add(presence.Name);
                }
            }

            var userDirectory = authUsers
                .Select(authUser =>
                {
                    var uid = JsonText(authUser, "localId") ?? string.Empty;
                    privateProfiles.TryGetValue(uid, out var profile);
                    directoryProfiles.TryGetValue(uid, out var directory);
                    var userLabel = AnalysisAppLogic.ResolveUsername(
                        JsonText(directory, "username"),
                        JsonText(directory, "displayName"),
                        JsonText(profile, "displayName"),
                        JsonText(profile, "username"),
                        JsonText(profile, "name"),
                        JsonText(authUser, "displayName"),
                        JsonText(authUser, "email"),
                        JsonText(directory, "shortId"),
                        JsonText(profile, "shortId"));
                    return new UserDirectoryEntry(
                        uid,
                        userLabel,
                        paidUserIds.Contains(uid),
                        activeUserIds.Contains(uid),
                        ParseAuthCreatedAt(authUser));
                })
                .Where(user => user.Uid.Length > 0)
                .OrderByDescending(user => user.Active)
                .ThenBy(user => user.UserLabel, StringComparer.CurrentCultureIgnoreCase)
                .ThenBy(user => user.Uid, StringComparer.Ordinal)
                .ToArray();

            var growth = growthBuckets.Select(pair => new UserGrowthPoint(pair.Key, pair.Value)).ToArray();
            var warnings = new List<string>();
            if (unclassifiedPaid > 0)
                warnings.Add($"{unclassifiedPaid} active Stripe membership{(unclassifiedPaid == 1 ? " is" : "s are")} missing a paid tier mapping. Check the Stripe price configuration.");
            if (directoryResult.ExitCode != 0)
                warnings.Add("The public user directory could not be read; usernames are using private profile and Auth fallbacks.");
            var warning = warnings.Count > 0 ? string.Join("  •  ", warnings) : null;
            return new PlatformSnapshot(authIds.Count, activeUserIds.Count, paidMemberships, growth.Sum(point => point.Count), unclassifiedPaid, userDirectory, growth, DateTime.Now, warning);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception error)
        {
            return new PlatformSnapshot(0, 0, 0, 0, 0, [], [], DateTime.Now, error.Message);
        }
        finally
        {
            try { if (!string.IsNullOrWhiteSpace(tempAuthFile) && File.Exists(tempAuthFile)) File.Delete(tempAuthFile); } catch { }
        }
    }

    public async Task SetModeAsync(string mode, int idleMinutes, CancellationToken cancellationToken = default)
    {
        mode = mode?.Trim().ToLowerInvariant() ?? "";
        if (mode is not ("off" or "on" or "auto")) throw new ArgumentException("AI mode must be off, on, or auto.", nameof(mode));
        if (idleMinutes is < 1 or > 1_440) throw new ArgumentOutOfRangeException(nameof(idleMinutes), "Idle timeout must be between 1 minute and 24 hours.");
        RequireRepoRoot("changing the protected bridge mode");
        using var response = await SendAuthorizedAsync(() =>
        {
            var request = new HttpRequestMessage(HttpMethod.Post, $"http://127.0.0.1:{Port}/control/mode");
            request.Content = JsonContent.Create(new { mode, idleMinutes });
            return request;
        }, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            try
            {
                using var document = JsonDocument.Parse(body);
                throw new InvalidOperationException(document.RootElement.GetProperty("error").GetString() ?? "AI mode change failed.");
            }
            catch (JsonException) { throw new InvalidOperationException("AI mode change failed."); }
        }
    }

    public async Task RunBridgeActionAsync(string action, CancellationToken cancellationToken = default)
    {
        if (!AnalysisAppLogic.IsSupportedBridgeAction(action)) throw new ArgumentException("Unsupported bridge action.", nameof(action));
        var repoRoot = RequireRepoRoot("running a bridge action");
        var script = Path.Combine(repoRoot, "tools", "ollama-bridge", "BridgeControl.ps1");
        var timeoutMs = string.Equals(action, "start-ollama", StringComparison.Ordinal)
            ? 150_000
            : action is "start-tunnel" or "stop-tunnel"
                ? 30_000
                : 20_000;
        var arguments = WindowlessProcess.PowerShellScriptArguments(script, "-Action", action);
        var result = await RunProcessAsync("powershell.exe", arguments, timeoutMs, cancellationToken);
        if (result.ExitCode != 0) throw new InvalidOperationException($"Bridge action {action} failed: {CleanProcessError(result.Error)}");
    }

    public void OpenLogs()
    {
        Directory.CreateDirectory(LogDirectory);
        Process.Start(new ProcessStartInfo("explorer.exe", LogDirectory) { UseShellExecute = true });
    }

    public string ReadSanitizedLogs()
    {
        var logDirectory = LogDirectory;
        Directory.CreateDirectory(logDirectory);
        var files = Directory.GetFiles(logDirectory, "*.log")
            .Select(path => new FileInfo(path))
            .OrderByDescending(file => file.LastWriteTimeUtc)
            .Take(4)
            .ToArray();
        if (files.Length == 0) return "No bridge log files are available yet.";
        var output = new List<string>();
        foreach (var file in files)
        {
            output.Add($"--- {file.Name} ---");
            try
            {
                foreach (var line in File.ReadLines(file.FullName).TakeLast(50))
                {
                    if (AnalysisAppLogic.IsSensitiveLogLine(line)) continue;
                    output.Add(line.Length > 500 ? line[..500] + "…" : line);
                }
            }
            catch (Exception error) { output.Add($"[log read failed: {error.Message}]"); }
        }
        return string.Join(Environment.NewLine, output);
    }

    public async Task<string> GetModerationStatusAsync(string uid)
    {
        ValidateFirebaseKey(uid, "UID");
        var user = await RunFirebaseAsync(["database:get", $"/users/{uid}"]);
        if (user.ExitCode != 0) throw new InvalidOperationException("Could not read that user profile. Check Firebase CLI access and the UID.");
        using var document = JsonDocument.Parse(string.IsNullOrWhiteSpace(user.Output) ? "null" : user.Output);
        if (document.RootElement.ValueKind != JsonValueKind.Object) return $"User {uid}: no RTDB profile found.";
        var root = document.RootElement;
        var banned = root.TryGetProperty("isBanned", out var bannedNode) && bannedNode.ValueKind == JsonValueKind.True;
        var muted = root.TryGetProperty("isMuted", out var mutedNode) && mutedNode.ValueKind == JsonValueKind.True;
        var rooms = await RunFirebaseAsync(["database:get", $"/user_rooms/{uid}"]);
        var roomCount = 0;
        if (rooms.ExitCode == 0)
        {
            using var roomsDocument = JsonDocument.Parse(string.IsNullOrWhiteSpace(rooms.Output) ? "null" : rooms.Output);
            if (roomsDocument.RootElement.ValueKind == JsonValueKind.Object) roomCount = roomsDocument.RootElement.EnumerateObject().Count();
        }
        return $"User {uid} | Banned {(banned ? "yes" : "no")} | Globally muted {(muted ? "yes" : "no")} | Rooms {roomCount}";
    }

    public async Task<string> GetModerationSummaryAsync()
    {
        using var usersDocument = await ReadFirebaseDocumentAsync("/users", "Could not load the moderation summary.");
        var profiles = 0;
        var banned = 0;
        var muted = 0;
        if (usersDocument.RootElement.ValueKind == JsonValueKind.Object)
        {
            foreach (var user in usersDocument.RootElement.EnumerateObject())
            {
                if (user.Value.ValueKind != JsonValueKind.Object) continue;
                profiles++;
                if (JsonTrue(user.Value, "isBanned")) banned++;
                if (JsonTrue(user.Value, "isMuted")) muted++;
            }
        }

        using var roomsDocument = await ReadFirebaseDocumentAsync("/rooms_meta", "Could not load room moderation state.");
        var roomMutes = CountActiveRoomMutes(roomsDocument.RootElement, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        return $"Moderation summary | Profiles {profiles:N0} | Banned {banned:N0} | Globally muted {muted:N0} | Active room mutes {roomMutes:N0}";
    }

    public async Task<string> ListModeratedUsersAsync(string flag)
    {
        if (flag is not ("isBanned" or "isMuted")) throw new ArgumentException("Unsupported moderation flag.", nameof(flag));
        using var document = await ReadFirebaseDocumentAsync("/users", "Could not load moderated users.");
        var matches = document.RootElement.ValueKind == JsonValueKind.Object
            ? document.RootElement.EnumerateObject()
                .Where(user => user.Value.ValueKind == JsonValueKind.Object && JsonTrue(user.Value, flag))
                .Select(user => (Uid: user.Name, Label: FirebaseUserLabel(user.Value)))
                .OrderBy(user => user.Uid, StringComparer.Ordinal)
                .ToArray()
            : [];
        var title = flag == "isBanned" ? "Banned users" : "Globally muted users";
        if (matches.Length == 0) return $"{title} (0)";
        var lines = new List<string> { $"{title} ({matches.Length:N0})" };
        lines.AddRange(matches.Take(100).Select(user => $"- {user.Label} | {user.Uid}"));
        if (matches.Length > 100) lines.Add($"… {matches.Length - 100:N0} more not shown");
        return string.Join(Environment.NewLine, lines);
    }

    public async Task<string> GetUserRoomsAsync(string uid)
    {
        ValidateFirebaseKey(uid, "UID");
        using var document = await ReadFirebaseDocumentAsync($"/user_rooms/{uid}", "Could not load that user's rooms.");
        var rooms = document.RootElement.ValueKind == JsonValueKind.Object
            ? document.RootElement.EnumerateObject().Select(room => room.Name).OrderBy(room => room, StringComparer.Ordinal).ToArray()
            : [];
        if (rooms.Length == 0) return $"Rooms for {uid} (0)";
        var lines = new List<string> { $"Rooms for {uid} ({rooms.Length:N0})" };
        lines.AddRange(rooms.Take(100).Select(room => $"- {room}"));
        if (rooms.Length > 100) lines.Add($"… {rooms.Length - 100:N0} more not shown");
        return string.Join(Environment.NewLine, lines);
    }

    public async Task<string> GetRoomStatusAsync(string roomId)
    {
        ValidateFirebaseKey(roomId, "room ID");
        using var document = await ReadFirebaseDocumentAsync($"/rooms_meta/{roomId}", "Could not load that room.");
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object) return $"Room {roomId}: not found.";
        var name = SanitizeConsoleText(JsonText(root, "name") ?? JsonText(root, "title") ?? roomId, 80);
        var rawOwner = JsonText(root, "creatorId");
        var owner = AnalysisAppLogic.IsValidFirebaseIdentifier(rawOwner) ? rawOwner! : "unknown";
        var members = root.TryGetProperty("members", out var memberNode) && memberNode.ValueKind == JsonValueKind.Object
            ? memberNode.EnumerateObject().Count()
            : 0;
        var activeMutes = root.TryGetProperty("muted", out var mutedNode) && mutedNode.ValueKind == JsonValueKind.Object
            ? mutedNode.EnumerateObject().Count(item => IsActiveRoomMute(item.Value, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()))
            : 0;
        var autoModeration = root.TryGetProperty("bots", out var bots)
            && bots.ValueKind == JsonValueKind.Object
            && bots.TryGetProperty("autoModeration", out var automod)
            && automod.ValueKind == JsonValueKind.Object
            && JsonTrue(automod, "enabled");
        return $"Room {name} ({roomId}) | Creator {owner} | Members {members:N0} | Active mutes {activeMutes:N0} | AutoMod {(autoModeration ? "on" : "off")}";
    }

    public async Task<string> GetRoomMembersAsync(string roomId)
    {
        ValidateFirebaseKey(roomId, "room ID");
        using var document = await ReadFirebaseDocumentAsync($"/rooms_meta/{roomId}", "Could not load room members.");
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object) return $"Room {roomId}: not found.";
        var rawOwner = JsonText(root, "creatorId");
        var owner = AnalysisAppLogic.IsValidFirebaseIdentifier(rawOwner) ? rawOwner : null;
        var members = new Dictionary<string, string>(StringComparer.Ordinal);
        if (root.TryGetProperty("members", out var memberNode) && memberNode.ValueKind == JsonValueKind.Object)
        {
            foreach (var member in memberNode.EnumerateObject())
            {
                var label = member.Value.ValueKind switch
                {
                    JsonValueKind.String => member.Value.GetString(),
                    JsonValueKind.Object => FirebaseUserLabel(member.Value),
                    _ => null,
                };
                members[member.Name] = string.IsNullOrWhiteSpace(label) ? "Unknown user" : SanitizeConsoleText(label, 80);
            }
        }
        if (!string.IsNullOrWhiteSpace(owner) && !members.ContainsKey(owner)) members[owner] = "Room creator";
        if (members.Count == 0) return $"Members in {roomId} (0)";
        var ordered = members.OrderBy(member => member.Key, StringComparer.Ordinal).ToArray();
        var lines = new List<string> { $"Members in {roomId} ({ordered.Length:N0})" };
        lines.AddRange(ordered.Take(100).Select(member => $"- {member.Value} | {member.Key}{(string.Equals(member.Key, owner, StringComparison.Ordinal) ? " | creator" : string.Empty)}"));
        if (ordered.Length > 100) lines.Add($"… {ordered.Length - 100:N0} more not shown");
        return string.Join(Environment.NewLine, lines);
    }

    public async Task<string> GetRoomLogAsync(string roomId, int count)
    {
        ValidateFirebaseKey(roomId, "room ID");
        if (count is < 1 or > 50) throw new ArgumentOutOfRangeException(nameof(count), "Room log count must be from 1 to 50.");
        using var document = await ReadFirebaseDocumentAsync($"/rooms_meta/{roomId}/logs", "Could not load the room activity log.");
        if (document.RootElement.ValueKind != JsonValueKind.Object) return $"Room log for {roomId}: no entries.";
        var entries = document.RootElement.EnumerateObject()
            .Where(entry => entry.Value.ValueKind == JsonValueKind.Object)
            .Select(entry => new
            {
                Key = entry.Name,
                Timestamp = JsonLong(entry.Value, "timestamp") ?? 0,
                Text = JsonText(entry.Value, "text") ?? "Activity recorded",
            })
            .OrderByDescending(entry => entry.Timestamp)
            .ThenByDescending(entry => entry.Key, StringComparer.Ordinal)
            .Take(count)
            .ToArray();
        if (entries.Length == 0) return $"Room log for {roomId}: no entries.";
        var lines = new List<string> { $"Latest room activity for {roomId} ({entries.Length:N0})" };
        foreach (var entry in entries)
        {
            var time = FormatUnixTimestamp(entry.Timestamp);
            var message = AnalysisAppLogic.IsSensitiveLogLine(entry.Text) ? "[sensitive entry redacted]" : SanitizeConsoleText(entry.Text, 220);
            lines.Add($"- {time} | {message}");
        }
        return string.Join(Environment.NewLine, lines);
    }

    public async Task<string> GetMessageDeletionPreviewAsync(string scope, string? roomId, string? channelId, string messageId)
    {
        var path = AnalysisAppLogic.BuildModerationMessagePath(scope, roomId, channelId, messageId);
        using var document = await ReadFirebaseDocumentAsync(path, "Could not verify that message.");
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object) throw new InvalidOperationException("That exact message was not found. Nothing was changed.");
        var author = JsonText(root, "uid");
        if (!AnalysisAppLogic.IsValidFirebaseIdentifier(author))
            throw new InvalidOperationException("That message has no valid author UID, so the console refused to delete it. Review the record directly in Firebase.");
        if (string.Equals(author, ProtectedAdminUid, StringComparison.Ordinal))
            throw new InvalidOperationException("Messages authored by the protected administrator cannot be deleted from this console.");
        var location = scope.ToLowerInvariant() switch
        {
            "global" => "Global Chat",
            "room" => $"room {roomId} / general",
            "channel" => $"room {roomId} / channel {channelId}",
            _ => "the selected location",
        };
        return $"message {messageId} in {location} by {author}";
    }

    public async Task DeleteMessageAsync(string scope, string? roomId, string? channelId, string messageId)
    {
        _ = await GetMessageDeletionPreviewAsync(scope, roomId, channelId, messageId);
        var path = AnalysisAppLogic.BuildModerationMessagePath(scope, roomId, channelId, messageId);
        await RemoveFirebasePathAsync(path);
    }

    public async Task SetUserModerationFlagAsync(string uid, string flag, bool enabled)
    {
        ValidateModerationTarget(uid);
        if (flag is not ("isBanned" or "isMuted")) throw new ArgumentException("Unsupported moderation flag.");
        using var user = await ReadFirebaseDocumentAsync($"/users/{uid}", "Could not verify that user profile.");
        if (user.RootElement.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException("That exact user profile was not found. Nothing was changed.");
        var result = await RunFirebaseAsync(["database:set", $"/users/{uid}/{flag}", "--data", enabled ? "true" : "false", "--force"]);
        if (result.ExitCode != 0) throw new InvalidOperationException($"Firebase rejected the moderation update: {CleanProcessError(result.Error)}");
        if (enabled) await RemoveFirebasePathAsync($"/presence/{uid}", required: false);
    }

    public async Task SetRoomMuteAsync(string roomId, string uid, string duration)
    {
        ValidateFirebaseKey(roomId, "room ID");
        ValidateModerationTarget(uid);
        using var room = await RequireRoomForModerationAsync(roomId);
        RequireRoomParticipant(room.RootElement, uid);
        string value;
        if (string.Equals(duration, "forever", StringComparison.OrdinalIgnoreCase)) value = "true";
        else if (int.TryParse(duration, out var minutes) && minutes is >= 1 and <= 43_200)
            value = DateTimeOffset.UtcNow.AddMinutes(minutes).ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture);
        else throw new ArgumentException("Mute duration must be 1–43200 minutes or 'forever'.");
        var result = await RunFirebaseAsync(["database:set", $"/rooms_meta/{roomId}/muted/{uid}", "--data", value, "--force"]);
        if (result.ExitCode != 0) throw new InvalidOperationException($"Room mute failed: {CleanProcessError(result.Error)}");
    }

    public async Task RemoveRoomMuteAsync(string roomId, string uid)
    {
        ValidateFirebaseKey(roomId, "room ID");
        ValidateModerationTarget(uid);
        using var room = await RequireRoomForModerationAsync(roomId);
        if (!room.RootElement.TryGetProperty("muted", out var muted)
            || muted.ValueKind != JsonValueKind.Object
            || !muted.TryGetProperty(uid, out _))
            throw new InvalidOperationException("That user does not have a room mute in the exact room. Nothing was changed.");
        await RemoveFirebasePathAsync($"/rooms_meta/{roomId}/muted/{uid}");
    }

    public async Task KickFromRoomAsync(string roomId, string uid)
    {
        ValidateFirebaseKey(roomId, "room ID");
        ValidateModerationTarget(uid);
        using var room = await RequireRoomForModerationAsync(roomId);
        var ownerUid = JsonText(room.RootElement, "creatorId");
        if (!AnalysisAppLogic.IsValidFirebaseIdentifier(ownerUid)) throw new InvalidOperationException("The room has no valid creator record, so the kick was refused.");
        if (string.Equals(ownerUid, uid, StringComparison.Ordinal)) throw new InvalidOperationException("The room creator cannot be kicked. Transfer or delete the room instead.");
        if (!room.RootElement.TryGetProperty("members", out var members)
            || members.ValueKind != JsonValueKind.Object
            || !members.TryGetProperty(uid, out _))
            throw new InvalidOperationException("That user is not a member of the exact room. Nothing was changed.");
        await RemoveFirebasePathAsync($"/rooms_meta/{roomId}/members/{uid}");
        var cleanupFailures = new List<string>();
        foreach (var path in new[]
        {
            $"/rooms_meta/{roomId}/memberPermissions/{uid}",
            $"/rooms_meta/{roomId}/muted/{uid}",
            $"/user_rooms/{uid}/{roomId}",
        })
            if (!await RemoveFirebasePathAsync(path, required: false)) cleanupFailures.Add(path);
        if (cleanupFailures.Count > 0)
            throw new InvalidOperationException($"The member was removed, but related cleanup was incomplete at: {string.Join(", ", cleanupFailures)}. Review Firebase before retrying.");
    }

    public async Task DeleteUserAccountAsync(string uid)
    {
        ValidateModerationTarget(uid);
        using (var rooms = await ReadFirebaseDocumentAsync("/rooms_meta", "Could not verify room ownership before account deletion."))
        {
            var ownedRooms = rooms.RootElement.ValueKind == JsonValueKind.Object
                ? rooms.RootElement.EnumerateObject()
                    .Where(room => room.Value.ValueKind == JsonValueKind.Object
                        && string.Equals(JsonText(room.Value, "creatorId"), uid, StringComparison.Ordinal))
                    .Select(room => SanitizeConsoleText(room.Name, 80))
                    .OrderBy(room => room, StringComparer.Ordinal)
                    .ToArray()
                : [];
            if (ownedRooms.Length > 0)
            {
                var shown = string.Join(", ", ownedRooms.Take(10));
                throw new InvalidOperationException(
                    $"Account deletion was refused because {uid} owns {ownedRooms.Length:N0} room{(ownedRooms.Length == 1 ? string.Empty : "s")}: {shown}" +
                    (ownedRooms.Length > 10 ? $" (and {ownedRooms.Length - 10:N0} more)" : string.Empty) +
                    ". Transfer or delete those rooms first so they are not orphaned.");
            }
        }
        var repoRoot = RequireRepoRoot("deleting a Firebase account");
        var runtime = FirebaseCliLocator.Resolve(repoRoot);
        var script = Path.Combine(repoRoot, "tools", "delete-firebase-user.cjs");
        if (!File.Exists(script)) throw new FileNotFoundException("The Firebase account deletion helper is missing.", script);
        var result = await RunProcessAsync(
            runtime.NodeExecutable,
            [script, "--uid", uid, "--project", FirebaseProject, "--confirm-uid", uid],
            90_000,
            environment: runtime.CreateEnvironment());
        if (result.ExitCode != 0) throw new InvalidOperationException($"Firebase Auth deletion failed: {CleanProcessError(result.Error)}");

        var cleanupFailures = new List<string>();
        try
        {
            foreach (var path in new[] { $"/users/{uid}", $"/user_directory/{uid}", $"/presence/{uid}", $"/user_rooms/{uid}", $"/push_tokens/{uid}", $"/inbox/{uid}", $"/user_private/{uid}", $"/ai_usage/{uid}", $"/ai_audit/{uid}", $"/friends/{uid}" })
                if (!await RemoveFirebasePathAsync(path, required: false)) cleanupFailures.Add(path);
            cleanupFailures.AddRange(await RemoveUserReferencesAsync(uid));
        }
        catch (Exception error)
        {
            throw new InvalidOperationException(
                $"Firebase Auth account {uid} was deleted, but application cleanup stopped unexpectedly: {error.Message} Review Firebase manually; do not retry as if the Auth deletion rolled back.",
                error);
        }
        if (cleanupFailures.Count > 0)
        {
            var distinctFailures = cleanupFailures.Distinct(StringComparer.Ordinal).ToArray();
            var shown = string.Join(", ", distinctFailures.Take(20));
            var remainder = Math.Max(0, distinctFailures.Length - 20);
            throw new InvalidOperationException(
                $"Firebase Auth account {uid} was deleted, but application cleanup was incomplete at: {shown}" +
                (remainder > 0 ? $" (and {remainder} more paths)" : string.Empty) +
                ". Review Firebase manually; do not assume the account deletion rolled back.");
        }
    }

    private async Task<List<string>> RemoveUserReferencesAsync(string uid)
    {
        var failures = new List<string>();
        foreach (var (rootPath, childNames) in new[]
        {
            ("/rooms_meta", new[] { "members", "memberPermissions", "muted" }),
            ("/friends", Array.Empty<string>()),
            ("/inbox", Array.Empty<string>()),
        })
        {
            var result = await RunFirebaseAsync(["database:get", rootPath]);
            if (result.ExitCode != 0)
            {
                failures.Add($"{rootPath} reference scan");
                continue;
            }
            if (string.IsNullOrWhiteSpace(result.Output)) continue;
            try
            {
                using var document = JsonDocument.Parse(result.Output);
                if (document.RootElement.ValueKind != JsonValueKind.Object) continue;
                foreach (var parent in document.RootElement.EnumerateObject())
                {
                    if (rootPath == "/rooms_meta")
                    {
                        if (parent.Value.ValueKind != JsonValueKind.Object) continue;
                        foreach (var childName in childNames)
                            if (parent.Value.TryGetProperty(childName, out var child) && child.ValueKind == JsonValueKind.Object && child.TryGetProperty(uid, out _))
                            {
                                var path = $"{rootPath}/{parent.Name}/{childName}/{uid}";
                                if (!await RemoveFirebasePathAsync(path, required: false)) failures.Add(path);
                            }
                    }
                    else if (parent.Value.ValueKind == JsonValueKind.Object && parent.Value.TryGetProperty(uid, out _))
                    {
                        var path = $"{rootPath}/{parent.Name}/{uid}";
                        if (!await RemoveFirebasePathAsync(path, required: false)) failures.Add(path);
                    }
                }
            }
            catch (JsonException) { failures.Add($"{rootPath} reference scan (invalid response)"); }
        }
        return failures;
    }

    private Task<(int ExitCode, string Output, string Error)> RunFirebaseAsync(IEnumerable<string> arguments)
    {
        var runtime = FirebaseCliLocator.Resolve(RequireRepoRoot("running a Firebase administrator command"));
        return RunFirebaseCliAsync(runtime, arguments, 90_000);
    }

    private static Task<(int ExitCode, string Output, string Error)> RunFirebaseCliAsync(
        FirebaseCliRuntime runtime,
        IEnumerable<string> arguments,
        int timeoutMs,
        CancellationToken cancellationToken = default)
    {
        return RunProcessAsync(
            runtime.NodeExecutable,
            runtime.CreateArguments(arguments, FirebaseProject),
            timeoutMs,
            cancellationToken,
            environment: runtime.CreateEnvironment());
    }

    private async Task<bool> RemoveFirebasePathAsync(string path, bool required = true)
    {
        var result = await RunFirebaseAsync(["database:remove", path, "--force"]);
        if (required && result.ExitCode != 0) throw new InvalidOperationException($"Could not remove {path}: {CleanProcessError(result.Error)}");
        return result.ExitCode == 0;
    }

    private static void ValidateModerationTarget(string uid)
    {
        ValidateFirebaseKey(uid, "UID");
        if (string.Equals(uid, ProtectedAdminUid, StringComparison.Ordinal)) throw new InvalidOperationException("The protected administrator account cannot be moderated from this console.");
    }

    private static void ValidateFirebaseKey(string value, string label)
    {
        if (!AnalysisAppLogic.IsValidFirebaseIdentifier(value))
            throw new ArgumentException($"Invalid {label}. Use the exact Firebase identifier.");
    }

    private static string CleanProcessError(string error)
    {
        var line = error.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries).FirstOrDefault(item => !item.Contains("update check", StringComparison.OrdinalIgnoreCase));
        return string.IsNullOrWhiteSpace(line) ? "operation failed" : line.Trim();
    }

    public void ConfigureRepoRoot(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("Choose the Minimalist Chat repository folder.", nameof(path));
        string normalized;
        try { normalized = Path.GetFullPath(Environment.ExpandEnvironmentVariables(path.Trim().Trim('"'))); }
        catch (Exception error) when (error is ArgumentException or NotSupportedException or PathTooLongException)
        {
            throw new ArgumentException("The selected repository path is not valid.", nameof(path), error);
        }

        if (!HasBridgeControlScript(normalized))
            throw new ArgumentException("That folder is not the Minimalist Chat repository. Expected tools\\ollama-bridge\\BridgeControl.ps1 inside it.", nameof(path));

        Directory.CreateDirectory(AppDataDirectory);
        var pendingPath = $"{SettingsPath}.{Guid.NewGuid():N}.tmp";
        try
        {
            File.WriteAllText(pendingPath, JsonSerializer.Serialize(new { repoRoot = normalized }, new JsonSerializerOptions { WriteIndented = true }));
            File.Move(pendingPath, SettingsPath, true);
        }
        finally
        {
            try { if (File.Exists(pendingPath)) File.Delete(pendingPath); } catch { }
        }

        _repoRoot = normalized;
        _token = null;
    }

    public Task InstallOrRepairVisionModelAsync(IProgress<string>? progress = null, CancellationToken cancellationToken = default)
        => InstallOrRepairApprovedModelAsync(ApprovedVisionModel, progress, cancellationToken);

    public async Task InstallOrRepairApprovedModelAsync(
        string model,
        IProgress<string>? progress = null,
        CancellationToken cancellationToken = default)
    {
        if (!AnalysisAppLogic.TryGetApprovedOllamaModel(model, out var approved) || approved is null)
            throw new ArgumentException("Only the Fast, Smart, and Vision approved Ollama models can be installed by this app.", nameof(model));

        progress?.Report($"Preparing approved {approved.DisplayName.ToLowerInvariant()} model {approved.Model}…");
        (int ExitCode, string Output, string Error) result;
        try
        {
            progress?.Report("Waking the isolated protected Ollama runtime on 127.0.0.1:11435…");
            await RunBridgeActionAsync("start-ollama", cancellationToken);
            result = await RunProcessAsync(
                FindOllamaExecutable(),
                ["pull", approved.Model],
                ModelInstallTimeoutMs,
                cancellationToken,
                progress,
                DedicatedOllamaEnvironment);
        }
        catch (OperationCanceledException) { throw; }
        catch (TimeoutException) { throw; }
        catch (InvalidOperationException error) when (error.InnerException is System.ComponentModel.Win32Exception)
        {
            throw new InvalidOperationException("Ollama could not be started. Install Ollama or add ollama.exe to PATH, then retry the approved-model repair.", error);
        }

        if (result.ExitCode != 0)
            throw new InvalidOperationException($"{approved.DisplayName} model repair failed: {CleanProcessError(result.Error)}");

        var modelResult = await LoadOllamaModelsAsync(cancellationToken);
        if (!modelResult.Checked)
            throw new InvalidOperationException($"Ollama completed the download, but the local model list could not be verified for {approved.Model}.");
        if (!modelResult.Models.Any(modelName => string.Equals(modelName, approved.Model, StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException($"Ollama completed the download, but {approved.Model} was not found in the local model list.");
        progress?.Report($"{approved.Model} is installed and ready.");
    }

    private async Task<HttpResponseMessage> SendAuthorizedAsync(Func<HttpRequestMessage> requestFactory, CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var token = await GetTokenAsync(forceRefresh: attempt > 0, cancellationToken);
            using var request = requestFactory();
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            var response = await _http.SendAsync(request, cancellationToken);
            if (response.StatusCode != HttpStatusCode.Unauthorized) return response;
            _token = null;
            if (attempt > 0) return response;
            response.Dispose();
        }
        throw new InvalidOperationException("The protected bridge rejected the administrator credential after it was refreshed.");
    }

    private async Task<string> GetTokenAsync(bool forceRefresh = false, CancellationToken cancellationToken = default)
    {
        if (forceRefresh) _token = null;
        if (!string.IsNullOrWhiteSpace(_token)) return _token;
        await _tokenLock.WaitAsync(cancellationToken);
        try
        {
            if (forceRefresh) _token = null;
            if (!string.IsNullOrWhiteSpace(_token)) return _token;
            var runtime = FirebaseCliLocator.Resolve(RequireRepoRoot("retrieving the protected bridge credential"));
            var result = await RunFirebaseCliAsync(runtime, ["functions:secrets:access", "OLLAMA_SERVER_TOKEN"], 45_000, cancellationToken);
            if (result.ExitCode != 0) throw new InvalidOperationException("Could not retrieve the protected bridge credential from Firebase.");
            _token = result.Output.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries).LastOrDefault()?.Trim();
            if (string.IsNullOrWhiteSpace(_token)) throw new InvalidOperationException("Firebase returned an empty bridge credential.");
            return _token;
        }
        finally { _tokenLock.Release(); }
    }

    private async Task<OllamaModelsResult> LoadOllamaModelsAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            using var response = await _http.GetAsync($"{DedicatedOllamaBaseUrl}/api/tags", cancellationToken);
            if (!response.IsSuccessStatusCode) return new OllamaModelsResult(false, []);
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            var models = document.RootElement.GetProperty("models").EnumerateArray().Select(item => item.TryGetProperty("name", out var name) ? name.GetString() ?? "" : "").Where(item => item.Length > 0).ToArray();
            return new OllamaModelsResult(true, models);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch { return new OllamaModelsResult(false, []); }
    }

    private async Task<bool> HasProtectedMarkerAsync(string url, CancellationToken cancellationToken = default)
    {
        try
        {
            using var response = await _http.GetAsync(url, cancellationToken);
            if (!response.IsSuccessStatusCode ||
                !response.Headers.TryGetValues("X-Minimalist-Ollama-Bridge", out var values) ||
                !values.Contains("1"))
                return false;

            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            var root = document.RootElement;
            return root.ValueKind == JsonValueKind.Object &&
                root.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True &&
                root.TryGetProperty("upstream", out var upstream) && upstream.ValueKind == JsonValueKind.String &&
                string.Equals(upstream.GetString()?.TrimEnd('/'), DedicatedOllamaBaseUrl, StringComparison.OrdinalIgnoreCase);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch { return false; }
    }

    private string ReadPublicUrl()
    {
        if (!IsConfigured) return "";
        var path = Path.Combine(_repoRoot, "functions", $".env.{FirebaseProject}");
        if (!File.Exists(path)) return "";
        var line = File.ReadLines(path).FirstOrDefault(value => value.TrimStart().StartsWith("OLLAMA_SERVER_URL=", StringComparison.OrdinalIgnoreCase));
        return line?.Split('=', 2)[1].Trim() ?? "";
    }

    private bool ReadTunnelDesiredState()
    {
        if (!IsConfigured) return false;
        try
        {
            var path = Path.Combine(_repoRoot, ".bridge-control", "public-tunnel.json");
            return File.Exists(path) && AnalysisAppLogic.ParseTunnelDesiredState(File.ReadAllText(path));
        }
        catch (IOException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
    }

    private static ActivityEntry? ParseActivity(JsonElement node)
    {
        if (!node.TryGetProperty("time", out var timeNode) || !timeNode.TryGetInt64(out var unixMs)) return null;
        return new ActivityEntry(
            DateTimeOffset.FromUnixTimeMilliseconds(unixMs).LocalDateTime,
            node.TryGetProperty("feature", out var feature) ? feature.GetString() ?? "AI request" : "AI request",
            node.TryGetProperty("model", out var model) ? model.GetString() ?? "Unknown" : "Unknown",
            node.TryGetProperty("durationMs", out var duration) ? duration.GetInt32() : 0,
            node.TryGetProperty("result", out var result) ? result.GetString() ?? "error" : "error");
    }

    private static async Task<(int ExitCode, string Output, string Error)> RunProcessAsync(
        string fileName,
        IEnumerable<string> arguments,
        int timeoutMs,
        CancellationToken cancellationToken = default,
        IProgress<string>? progress = null,
        IReadOnlyDictionary<string, string?>? environment = null)
    {
        if (timeoutMs <= 0) throw new ArgumentOutOfRangeException(nameof(timeoutMs));
        cancellationToken.ThrowIfCancellationRequested();
        var startInfo = WindowlessProcess.CreateStartInfo(fileName, arguments, environment);
        Process process;
        try { process = Process.Start(startInfo) ?? throw new InvalidOperationException($"Could not start {fileName}."); }
        catch (System.ComponentModel.Win32Exception error) { throw new InvalidOperationException($"Could not start {fileName}.", error); }
        using (process)
        {
            var outputTask = ReadProcessStreamAsync(process.StandardOutput, progress);
            var errorTask = ReadProcessStreamAsync(process.StandardError, progress);
            using var timeout = new CancellationTokenSource(timeoutMs);
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeout.Token);
            try
            {
                await process.WaitForExitAsync(linked.Token);
                var streams = await Task.WhenAll(outputTask, errorTask);
                return (process.ExitCode, streams[0], streams[1]);
            }
            catch (OperationCanceledException)
            {
                var canceledByCaller = cancellationToken.IsCancellationRequested;
                await TerminateProcessTreeAsync(process);
                await DrainProcessStreamsAsync(outputTask, errorTask);
                if (canceledByCaller) throw new OperationCanceledException("The operation was canceled and its child processes were stopped.", cancellationToken);
                throw new TimeoutException($"{Path.GetFileName(fileName)} did not finish within {TimeSpan.FromMilliseconds(timeoutMs):g} and was stopped.");
            }
            catch
            {
                await TerminateProcessTreeAsync(process);
                await DrainProcessStreamsAsync(outputTask, errorTask);
                throw;
            }
        }
    }

    private static async Task<string> ReadProcessStreamAsync(StreamReader reader, IProgress<string>? progress)
    {
        var output = new StringBuilder();
        while (await reader.ReadLineAsync() is { } line)
        {
            output.AppendLine(line);
            var update = line.Trim();
            if (update.Length > 0) progress?.Report(update);
        }
        return output.ToString();
    }

    private static async Task TerminateProcessTreeAsync(Process process)
    {
        Exception? killError = null;
        try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
        catch (Exception error) { killError = error; }
        try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5)); }
        catch { }
        if (!process.HasExited)
        {
            try { process.Kill(entireProcessTree: true); }
            catch (Exception error) { killError ??= error; }
            try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5)); }
            catch { }
        }
        if (!process.HasExited)
            throw new InvalidOperationException("A canceled or timed-out child process could not be stopped safely.", killError);
    }

    private static async Task DrainProcessStreamsAsync(params Task<string>[] streams)
    {
        try { await Task.WhenAll(streams).WaitAsync(TimeSpan.FromSeconds(5)); }
        catch { }
    }

    private static string FindRepoRoot()
    {
        var documentsRoot = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        var candidates = new[]
        {
            Environment.GetEnvironmentVariable("MINIMALIST_CHAT_ROOT"),
            ReadSavedRepoRoot(),
            AppContext.BaseDirectory,
            Environment.CurrentDirectory,
            string.IsNullOrWhiteSpace(documentsRoot) ? null : Path.Combine(documentsRoot, "minimalist-chat"),
        };
        foreach (var candidate in candidates)
        {
            var root = FindRepoFromCandidate(candidate);
            if (root is not null) return root;
        }
        return "";
    }

    private static string FindOllamaExecutable()
    {
        var installed = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Ollama", "ollama.exe");
        return File.Exists(installed) ? installed : "ollama.exe";
    }

    private static string? FindRepoFromCandidate(string? candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate)) return null;
        try
        {
            var expanded = Environment.ExpandEnvironmentVariables(candidate.Trim().Trim('"'));
            var fullPath = Path.GetFullPath(expanded);
            var directory = File.Exists(fullPath) ? new FileInfo(fullPath).Directory : new DirectoryInfo(fullPath);
            while (directory is not null)
            {
                if (HasBridgeControlScript(directory.FullName)) return directory.FullName;
                directory = directory.Parent;
            }
        }
        catch { }
        return null;
    }

    private static string? ReadSavedRepoRoot()
    {
        try
        {
            if (!File.Exists(SettingsPath)) return null;
            using var document = JsonDocument.Parse(File.ReadAllText(SettingsPath));
            if (document.RootElement.TryGetProperty("repoRoot", out var repoRoot)) return repoRoot.GetString();
            if (document.RootElement.TryGetProperty("RepoRoot", out repoRoot)) return repoRoot.GetString();
        }
        catch { }
        return null;
    }

    private static bool HasBridgeControlScript(string? root)
        => !string.IsNullOrWhiteSpace(root) && File.Exists(Path.Combine(root, "tools", "ollama-bridge", "BridgeControl.ps1"));

    private string RequireRepoRoot(string operation)
    {
        if (IsConfigured) return _repoRoot;
        throw RepoConfigurationError(operation);
    }

    private static InvalidOperationException RepoConfigurationError(string operation)
        => new($"Minimalist Chat repository is not configured. Select its folder in Settings or set MINIMALIST_CHAT_ROOT before {operation}. The isolated protected Ollama runtime and approved-model repair require that workspace configuration.");

    private static PlatformSnapshot EmptyPlatformSnapshot(string? warning = null)
        => new(0, 0, 0, 0, 0, [], [], DateTime.Now, warning);

    private async Task<JsonDocument> RequireRoomForModerationAsync(string roomId)
    {
        if (string.Equals(roomId, "global", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Global Chat does not use room membership or room mutes. Use the global mute command instead.");
        var document = await ReadFirebaseDocumentAsync($"/rooms_meta/{roomId}", "Could not verify that room.");
        if (document.RootElement.ValueKind == JsonValueKind.Object) return document;
        document.Dispose();
        throw new InvalidOperationException("That exact room was not found. Nothing was changed.");
    }

    private static void RequireRoomParticipant(JsonElement room, string uid)
    {
        var owner = JsonText(room, "creatorId");
        if (string.Equals(owner, uid, StringComparison.Ordinal)) return;
        if (room.TryGetProperty("members", out var members)
            && members.ValueKind == JsonValueKind.Object
            && members.TryGetProperty(uid, out _)) return;
        throw new InvalidOperationException("That user is not a member or creator of the exact room. Nothing was changed.");
    }

    private async Task<JsonDocument> ReadFirebaseDocumentAsync(string path, string failureMessage)
    {
        var result = await RunFirebaseAsync(["database:get", path]);
        if (result.ExitCode != 0)
            throw new InvalidOperationException($"{failureMessage} {CleanProcessError(result.Error)}");
        try
        {
            return JsonDocument.Parse(string.IsNullOrWhiteSpace(result.Output) ? "null" : result.Output);
        }
        catch (JsonException error)
        {
            throw new InvalidOperationException($"{failureMessage} Firebase returned an invalid response.", error);
        }
    }

    private static bool JsonTrue(JsonElement element, string propertyName)
        => element.ValueKind == JsonValueKind.Object
            && element.TryGetProperty(propertyName, out var node)
            && node.ValueKind == JsonValueKind.True;

    private static long? JsonLong(JsonElement element, string propertyName)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(propertyName, out var node)) return null;
        if (node.ValueKind == JsonValueKind.Number && node.TryGetInt64(out var number)) return number;
        if (node.ValueKind == JsonValueKind.String
            && long.TryParse(node.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out number)) return number;
        return null;
    }

    private static int CountActiveRoomMutes(JsonElement roomsRoot, long nowUnixMs)
    {
        if (roomsRoot.ValueKind != JsonValueKind.Object) return 0;
        var count = 0;
        foreach (var room in roomsRoot.EnumerateObject())
        {
            if (room.Value.ValueKind != JsonValueKind.Object
                || !room.Value.TryGetProperty("muted", out var muted)
                || muted.ValueKind != JsonValueKind.Object) continue;
            count += muted.EnumerateObject().Count(entry => IsActiveRoomMute(entry.Value, nowUnixMs));
        }
        return count;
    }

    private static bool IsActiveRoomMute(JsonElement value, long nowUnixMs)
    {
        if (value.ValueKind == JsonValueKind.True) return true;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var expiry)) return expiry > nowUnixMs;
        if (value.ValueKind != JsonValueKind.String) return false;
        var raw = value.GetString();
        if (string.Equals(raw, "forever", StringComparison.OrdinalIgnoreCase)) return true;
        return long.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out expiry) && expiry > nowUnixMs;
    }

    private static string FirebaseUserLabel(JsonElement user)
        => AnalysisAppLogic.ResolveUsername(
            JsonText(user, "username"),
            JsonText(user, "displayName"),
            null,
            null,
            JsonText(user, "name"),
            null,
            JsonText(user, "email"),
            JsonText(user, "shortId"));

    private static string SanitizeConsoleText(string? value, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(value)) return "Activity recorded";
        var output = new StringBuilder(Math.Min(maximumLength, value.Length));
        var pendingSpace = false;
        foreach (var rune in value.EnumerateRunes())
        {
            var category = Rune.GetUnicodeCategory(rune);
            if (Rune.IsWhiteSpace(rune) || category is UnicodeCategory.Control or UnicodeCategory.Format or UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator)
            {
                pendingSpace = output.Length > 0;
                continue;
            }
            var text = rune.ToString();
            var extra = text.Length + (pendingSpace ? 1 : 0);
            if (output.Length + extra > maximumLength) break;
            if (pendingSpace) output.Append(' ');
            output.Append(text);
            pendingSpace = false;
        }
        return output.Length == 0 ? "Activity recorded" : output.ToString();
    }

    private static string FormatUnixTimestamp(long unixMs)
    {
        if (unixMs <= 0) return "unknown time";
        try { return DateTimeOffset.FromUnixTimeMilliseconds(unixMs).LocalDateTime.ToString("yyyy-MM-dd HH:mm", CultureInfo.CurrentCulture); }
        catch (ArgumentOutOfRangeException) { return "unknown time"; }
    }

    private static string? JsonText(JsonElement element, string propertyName)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(propertyName, out var node)) return null;
        return node.ValueKind == JsonValueKind.String ? node.GetString() : null;
    }

    private static DateTime? ParseAuthCreatedAt(JsonElement authUser)
    {
        if (authUser.ValueKind != JsonValueKind.Object || !authUser.TryGetProperty("createdAt", out var createdNode)) return null;
        var raw = createdNode.ValueKind == JsonValueKind.String ? createdNode.GetString() : createdNode.GetRawText();
        if (!long.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var unixMs)) return null;
        try { return DateTimeOffset.FromUnixTimeMilliseconds(unixMs).LocalDateTime; }
        catch (ArgumentOutOfRangeException) { return null; }
    }

    private static void CleanupStaleAuthExports()
    {
        try
        {
            var staleBefore = DateTime.UtcNow.AddHours(-1);
            foreach (var path in Directory.EnumerateFiles(AuthExportDirectory, "auth-export-*.json", SearchOption.TopDirectoryOnly))
            {
                try { if (File.GetLastWriteTimeUtc(path) < staleBefore) File.Delete(path); }
                catch { }
            }
        }
        catch { }
    }
}

internal sealed class ActivityChart : Control
{
    private ActivityEntry[] _activity = [];
    private readonly ToolTip _bucketToolTip = new()
    {
        AutoPopDelay = 10_000,
        InitialDelay = 240,
        ReshowDelay = 80,
        ShowAlways = true,
        ToolTipIcon = ToolTipIcon.Info,
        ToolTipTitle = "AI request activity",
        UseAnimation = true,
        UseFading = true,
    };
    private int _hoveredBucketIndex = -1;
    private int _focusedBucketIndex = AnalysisAppLogic.ActivityBucketCount - 1;
    private DateTime _bucketAnchor = DateTime.Now;

    public ActivityChart()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
            ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
        DoubleBuffered = true;
        BackColor = ApplePalette.Surface;
        TabStop = true;
        AccessibleRole = AccessibleRole.Chart;
        AccessibleName = "AI request activity chart";
        AccessibleDescription = "No AI request activity has been loaded. Hover a time period, or focus the chart and use the arrow keys, to inspect exact request counts.";
    }

    public void SetActivity(ActivityEntry[] activity)
    {
        _activity = activity ?? [];
        _bucketAnchor = DateTime.Now;
        _hoveredBucketIndex = -1;
        if (IsHandleCreated) _bucketToolTip.Hide(this);
        UpdateAccessibleDescription(_bucketAnchor);
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.Clear(SystemInformation.HighContrast ? SystemColors.Window : ApplePalette.Surface);
        var scale = DpiScale;
        if (ClientSize.Width < Dip(72, scale) || ClientSize.Height < Dip(62, scale)) return;

        var graph = PlotBounds(scale);
        ConfigureGraphics(e.Graphics);
        DrawGrid(e.Graphics, graph, scale);

        var now = _bucketAnchor;
        var summaries = BuildBucketSummaries(now);
        var buckets = summaries.Select(bucket => bucket.Count).ToArray();
        if (buckets.Sum() == 0)
            DrawEmptyState(e.Graphics, "No AI requests in the last 24 hours", graph, scale);

        var max = Math.Max(1, buckets.Max());
        var slot = graph.Width / 24f;
        var accent = SystemInformation.HighContrast ? SystemColors.Highlight : ApplePalette.BlueFill;
        var labelColor = SystemInformation.HighContrast ? SystemColors.WindowText : ApplePalette.Secondary;
        using var labelBrush = new SolidBrush(labelColor);
        using var labelFont = ChartFont(9f);
        using var labelFormat = new StringFormat
        {
            Alignment = StringAlignment.Center,
            LineAlignment = StringAlignment.Near,
            FormatFlags = StringFormatFlags.NoWrap,
            Trimming = StringTrimming.None,
        };

        for (var i = 0; i < 24; i++)
        {
            if (buckets[i] > 0)
            {
                var height = Math.Max(Dip(3, scale), (graph.Height - Dip(2, scale)) * buckets[i] / max);
                var width = Math.Max(1f, Math.Min(slot * .72f, Dip(14, scale)));
                var bounds = new RectangleF(
                    graph.Left + (i * slot) + ((slot - width) / 2f),
                    graph.Bottom - height,
                    width,
                    height);
                using var bar = TopRoundedBar(bounds, Math.Min(Dip(4, scale), width / 2f));
                using var fill = new SolidBrush(accent);
                e.Graphics.FillPath(fill, bar);
            }
        }

        foreach (var index in ActivityLabelIndices(graph.Width, scale))
        {
            var center = graph.Left + (index * slot) + (slot / 2f);
            var labelBounds = CenteredLabelBounds(
                center,
                graph.Bottom + Dip(5, scale),
                Dip(64, scale),
                Dip(18, scale),
                ClientSize.Width);
            e.Graphics.DrawString(
                now.AddHours(-(23 - index)).ToString("h tt", CultureInfo.CurrentCulture),
                labelFont,
                labelBrush,
                labelBounds,
                labelFormat);
        }

        var activeBucketIndex = _hoveredBucketIndex >= 0
            ? _hoveredBucketIndex
            : Focused ? _focusedBucketIndex : -1;
        if (activeBucketIndex >= 0)
            DrawBucketMarker(e.Graphics, graph, scale, activeBucketIndex);
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        var graph = PlotBounds(DpiScale);
        var bucketIndex = graph.Contains(e.X, e.Y)
            ? AnalysisAppLogic.ActivityBucketIndexAt(e.X, graph.Left, graph.Width)
            : -1;
        if (_hoveredBucketIndex == bucketIndex) return;
        _hoveredBucketIndex = bucketIndex;
        UpdateAccessibleDescription(_bucketAnchor);
        if (bucketIndex >= 0) ShowBucketToolTip(bucketIndex, e.Location);
        else _bucketToolTip.Hide(this);
        Invalidate();
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e);
        if (_hoveredBucketIndex < 0) return;
        _hoveredBucketIndex = -1;
        _bucketToolTip.Hide(this);
        UpdateAccessibleDescription(_bucketAnchor);
        Invalidate();
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;

        var graph = PlotBounds(DpiScale);
        if (graph.Contains(e.X, e.Y))
            _focusedBucketIndex = AnalysisAppLogic.ActivityBucketIndexAt(e.X, graph.Left, graph.Width);

        Focus();
        UpdateAccessibleDescription(_bucketAnchor);
        ShowBucketToolTip(_focusedBucketIndex, e.Location);
        Invalidate();
    }

    protected override void OnGotFocus(EventArgs e)
    {
        base.OnGotFocus(e);
        UpdateAccessibleDescription(_bucketAnchor);
        if (_hoveredBucketIndex < 0) ShowBucketToolTip(_focusedBucketIndex);
        Invalidate();
    }

    protected override void OnLostFocus(EventArgs e)
    {
        base.OnLostFocus(e);
        if (_hoveredBucketIndex < 0) _bucketToolTip.Hide(this);
        UpdateAccessibleDescription(_bucketAnchor);
        Invalidate();
    }

    protected override bool IsInputKey(Keys keyData)
        => (keyData & Keys.KeyCode) is Keys.Left or Keys.Right or Keys.Home or Keys.End
            || base.IsInputKey(keyData);

    protected override void OnKeyDown(KeyEventArgs e)
    {
        var nextBucketIndex = (e.KeyCode) switch
        {
            Keys.Left => Math.Max(0, _focusedBucketIndex - 1),
            Keys.Right => Math.Min(AnalysisAppLogic.ActivityBucketCount - 1, _focusedBucketIndex + 1),
            Keys.Home => 0,
            Keys.End => AnalysisAppLogic.ActivityBucketCount - 1,
            _ => -1,
        };
        if (nextBucketIndex < 0)
        {
            base.OnKeyDown(e);
            return;
        }

        _focusedBucketIndex = nextBucketIndex;
        UpdateAccessibleDescription(_bucketAnchor);
        ShowBucketToolTip(_focusedBucketIndex);
        Invalidate();
        e.Handled = true;
        e.SuppressKeyPress = true;
    }

    private float DpiScale => Math.Max(1f, DeviceDpi / 96f);

    private ActivityBucketSummary[] BuildBucketSummaries(DateTime now)
        => AnalysisAppLogic.BuildActivityBucketSummaries(
            _activity.Select(item => (item.Time, (string?)item.Result)),
            now);

    private void UpdateAccessibleDescription(DateTime now)
    {
        var summaries = BuildBucketSummaries(now);
        var total = summaries.Sum(bucket => bucket.Count);
        var description = total == 0
            ? "No AI requests in the last 24 hours."
            : BuildActivitySummary(now, summaries, total);

        var activeBucketIndex = _hoveredBucketIndex >= 0
            ? _hoveredBucketIndex
            : Focused ? _focusedBucketIndex : -1;
        if ((uint)activeBucketIndex < AnalysisAppLogic.ActivityBucketCount)
        {
            var range = AnalysisAppLogic.ActivityBucketRange(now, activeBucketIndex);
            description += $" Selected period {FormatBucketRange(range.Start, range.End)}: " +
                FormatBucketAccessibleDetails(summaries[activeBucketIndex]);
        }

        AccessibleDescription = description + " Hover a time period, or use the left and right arrow keys while focused, to inspect exact request counts.";
        if (IsHandleCreated) AccessibilityNotifyClients(AccessibleEvents.DescriptionChange, -1);
    }

    private static string BuildActivitySummary(DateTime now, ActivityBucketSummary[] summaries, int total)
    {
        var peak = summaries.Max(bucket => bucket.Count);
        var peakIndex = Array.FindIndex(summaries, bucket => bucket.Count == peak);
        return $"{total:N0} AI request{(total == 1 ? string.Empty : "s")} in the last 24 hours. " +
            $"Peak hourly activity was {peak:N0} around {now.AddHours(-(23 - peakIndex)):h tt}.";
    }

    private void ShowBucketToolTip(int bucketIndex, Point? pointerLocation = null)
    {
        if ((uint)bucketIndex >= AnalysisAppLogic.ActivityBucketCount || !IsHandleCreated || IsDisposed) return;

        var summary = BuildBucketSummaries(_bucketAnchor)[bucketIndex];
        var range = AnalysisAppLogic.ActivityBucketRange(_bucketAnchor, bucketIndex);
        var text = $"{FormatBucketRange(range.Start, range.End)}{Environment.NewLine}" +
            $"{summary.Count:N0} request{(summary.Count == 1 ? string.Empty : "s")}";
        if (summary.HasOutcomeBreakdown)
            text += $"{Environment.NewLine}Success {summary.SuccessCount:N0}  ·  Errors {summary.ErrorCount:N0}";

        var graph = PlotBounds(DpiScale);
        var slot = graph.Width / AnalysisAppLogic.ActivityBucketCount;
        var center = graph.Left + (bucketIndex * slot) + (slot / 2f);
        var location = pointerLocation ?? new Point((int)Math.Round(center), (int)Math.Round(graph.Top));
        var estimatedWidth = Dip(summary.HasOutcomeBreakdown ? 220 : 170, DpiScale);
        var x = location.X + (int)Math.Ceiling(Dip(12, DpiScale));
        if (x + estimatedWidth > ClientSize.Width)
            x = Math.Max((int)Dip(4, DpiScale), location.X - (int)Math.Ceiling(estimatedWidth));
        var y = Math.Clamp(
            location.Y + (int)Math.Ceiling(Dip(16, DpiScale)),
            (int)Dip(4, DpiScale),
            Math.Max((int)Dip(4, DpiScale), ClientSize.Height - (int)Dip(8, DpiScale)));
        _bucketToolTip.Show(text, this, x, y, 10_000);
    }

    private static string FormatBucketAccessibleDetails(ActivityBucketSummary summary)
    {
        var details = $"{summary.Count:N0} request{(summary.Count == 1 ? string.Empty : "s")}.";
        if (summary.HasOutcomeBreakdown)
            details += $" Success {summary.SuccessCount:N0}; errors {summary.ErrorCount:N0}.";
        return details;
    }

    private static void DrawBucketMarker(Graphics graphics, RectangleF graph, float scale, int bucketIndex)
    {
        if ((uint)bucketIndex >= AnalysisAppLogic.ActivityBucketCount) return;

        var slot = graph.Width / AnalysisAppLogic.ActivityBucketCount;
        var left = graph.Left + (bucketIndex * slot);
        var center = left + (slot / 2f);
        var markerColor = SystemInformation.HighContrast ? SystemColors.Highlight : ApplePalette.BlueFill;
        using (var slotBrush = new SolidBrush(Color.FromArgb(SystemInformation.HighContrast ? 34 : 18, markerColor)))
            graphics.FillRectangle(slotBrush, left, graph.Top, slot, graph.Height);
        using var markerPen = new Pen(Color.FromArgb(SystemInformation.HighContrast ? 255 : 155, markerColor), Math.Max(1f, Dip(1f, scale)))
        {
            DashStyle = DashStyle.Dot,
        };
        graphics.DrawLine(markerPen, center, graph.Top, center, graph.Bottom);
    }

    private static string FormatBucketRange(DateTime start, DateTime end)
        => $"{start.ToString("h:mm tt", CultureInfo.CurrentCulture)}–{end.ToString("h:mm tt", CultureInfo.CurrentCulture)}";

    private RectangleF PlotBounds(float scale)
    {
        var left = Dip(18, scale);
        var top = Dip(10, scale);
        var right = Dip(12, scale);
        var labels = Dip(27, scale);
        return new RectangleF(
            left,
            top,
            Math.Max(Dip(36, scale), ClientSize.Width - left - right),
            Math.Max(Dip(24, scale), ClientSize.Height - top - labels));
    }

    private static void DrawGrid(Graphics graphics, RectangleF graph, float scale)
    {
        var highContrast = SystemInformation.HighContrast;
        using var plotBrush = new SolidBrush(highContrast ? SystemColors.Window : ApplePalette.Surface);
        graphics.FillRectangle(plotBrush, graph);

        using var gridPen = new Pen(highContrast ? SystemColors.GrayText : Color.FromArgb(118, ApplePalette.Line), Math.Max(1f, Dip(.7f, scale)));
        for (var row = 0; row < 3; row++)
        {
            var y = graph.Top + (graph.Height * row / 3f);
            graphics.DrawLine(gridPen, graph.Left, y, graph.Right, y);
        }

        using var baselinePen = new Pen(highContrast ? SystemColors.WindowText : Color.FromArgb(205, ApplePalette.StrongLine), Math.Max(1f, Dip(1f, scale)));
        graphics.DrawLine(baselinePen, graph.Left, graph.Bottom, graph.Right, graph.Bottom);
    }

    private static void DrawEmptyState(Graphics graphics, string message, RectangleF graph, float scale)
    {
        using var emptyBrush = new SolidBrush(SystemInformation.HighContrast ? SystemColors.WindowText : ApplePalette.Secondary);
        using var emptyFont = ChartFont(9.5f);
        using var emptyFormat = new StringFormat
        {
            Alignment = StringAlignment.Center,
            LineAlignment = StringAlignment.Center,
            Trimming = StringTrimming.EllipsisCharacter,
        };
        var inset = Dip(8, scale);
        graphics.DrawString(message, emptyFont, emptyBrush, RectangleF.Inflate(graph, -inset, -inset), emptyFormat);
    }

    private static int[] ActivityLabelIndices(float width, float scale)
        => width >= Dip(470, scale) ? [0, 6, 12, 18, 23]
            : width >= Dip(270, scale) ? [0, 8, 16, 23]
            : width >= Dip(160, scale) ? [0, 12, 23]
            : width >= Dip(105, scale) ? [0, 23]
            : [23];

    private static RectangleF CenteredLabelBounds(float centerX, float top, float width, float height, float availableWidth)
    {
        var left = Math.Clamp(centerX - (width / 2f), 0f, Math.Max(0f, availableWidth - width));
        return new RectangleF(left, top, Math.Min(width, availableWidth), height);
    }

    private static GraphicsPath TopRoundedBar(RectangleF bounds, float radius)
    {
        var path = new GraphicsPath();
        radius = Math.Max(0, Math.Min(radius, Math.Min(bounds.Width / 2f, bounds.Height)));
        if (radius < .5f)
        {
            path.AddRectangle(bounds);
            return path;
        }

        var diameter = radius * 2f;
        path.StartFigure();
        path.AddLine(bounds.Left, bounds.Bottom, bounds.Left, bounds.Top + radius);
        path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
        path.AddLine(bounds.Left + radius, bounds.Top, bounds.Right - radius, bounds.Top);
        path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
        path.AddLine(bounds.Right, bounds.Top + radius, bounds.Right, bounds.Bottom);
        path.CloseFigure();
        return path;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _bucketToolTip.Dispose();
        base.Dispose(disposing);
    }

    private static void ConfigureGraphics(Graphics graphics)
    {
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
        graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
    }

    private static Font ChartFont(float points)
        => new(AppleTypography.TextFamily, Math.Max(9f, points), FontStyle.Regular, GraphicsUnit.Point);

    private static float Dip(float value, float scale) => value * scale;
}

internal sealed class UserGrowthChart : Control
{
    private UserGrowthPoint[] _points = [];

    public UserGrowthChart()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
            ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
        DoubleBuffered = true;
        BackColor = ApplePalette.Surface;
        TabStop = false;
        AccessibleRole = AccessibleRole.Graphic;
        AccessibleName = "Thirty-day user growth chart";
        AccessibleDescription = "User growth analytics have not been loaded.";
    }

    public void SetGrowth(UserGrowthPoint[] points)
    {
        _points = points ?? [];
        UpdateAccessibleDescription();
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.Clear(SystemInformation.HighContrast ? SystemColors.Window : ApplePalette.Surface);
        var scale = DpiScale;
        if (ClientSize.Width < Dip(72, scale) || ClientSize.Height < Dip(62, scale)) return;

        var graph = PlotBounds(scale);
        ConfigureGraphics(e.Graphics);
        DrawGrid(e.Graphics, graph, scale);

        if (_points.Length == 0)
        {
            DrawEmptyState(e.Graphics, "User analytics unavailable", graph, scale);
            return;
        }

        var max = Math.Max(1, _points.Max(point => point.Count));
        var axisMax = NiceAxisMax(max);
        DrawYAxis(e.Graphics, graph, axisMax, scale);
        var coordinates = new PointF[_points.Length];
        var pointInset = Dip(3, scale);
        var valueHeight = Math.Max(1f, graph.Height - (pointInset * 2f));
        for (var i = 0; i < _points.Length; i++)
        {
            var x = _points.Length == 1
                ? graph.Left + (graph.Width / 2f)
                : graph.Left + (graph.Width * i / (_points.Length - 1f));
            var count = Math.Max(0, _points[i].Count);
            var y = graph.Bottom - pointInset - (valueHeight * count / axisMax);
            coordinates[i] = new PointF(x, Math.Max(graph.Top + pointInset, Math.Min(graph.Bottom - pointInset, y)));
        }

        if (coordinates.Length > 1 && !SystemInformation.HighContrast)
        {
            using var area = new GraphicsPath();
            area.AddLines(coordinates);
            area.AddLine(coordinates[^1].X, coordinates[^1].Y, coordinates[^1].X, graph.Bottom);
            area.AddLine(coordinates[^1].X, graph.Bottom, coordinates[0].X, graph.Bottom);
            area.CloseFigure();
            using var areaBrush = new SolidBrush(Color.FromArgb(24, ApplePalette.BlueFill));
            e.Graphics.FillPath(areaBrush, area);
        }

        var accent = SystemInformation.HighContrast ? SystemColors.Highlight : ApplePalette.BlueFill;
        using var linePen = new Pen(accent, Dip(2.15f, scale))
        {
            LineJoin = LineJoin.Round,
            StartCap = LineCap.Round,
            EndCap = LineCap.Round,
        };
        if (coordinates.Length > 1)
            e.Graphics.DrawLines(linePen, coordinates);

        var peakCount = _points.Max(point => point.Count);
        var peakIndex = Array.FindIndex(_points, point => point.Count == peakCount);
        for (var i = 0; i < coordinates.Length; i++)
        {
            var diameter = Dip(i == peakIndex ? 5.5f : 3.5f, scale);
            DrawPoint(e.Graphics, linePen, coordinates[i], diameter);
        }

        using var labelBrush = new SolidBrush(SystemInformation.HighContrast ? SystemColors.WindowText : ApplePalette.Secondary);
        using var labelFont = ChartFont(9f);
        using var labelFormat = new StringFormat
        {
            Alignment = StringAlignment.Center,
            LineAlignment = StringAlignment.Near,
            FormatFlags = StringFormatFlags.NoWrap,
            Trimming = StringTrimming.None,
        };
        foreach (var index in GrowthLabelIndices(_points.Length, graph.Width, scale))
        {
            var labelBounds = CenteredLabelBounds(
                coordinates[index].X,
                graph.Bottom + Dip(5, scale),
                Dip(72, scale),
                Dip(18, scale),
                ClientSize.Width);
            e.Graphics.DrawString(
                _points[index].Date.ToString("MMM d", CultureInfo.CurrentCulture),
                labelFont,
                labelBrush,
                labelBounds,
                labelFormat);
        }
    }

    private float DpiScale => Math.Max(1f, DeviceDpi / 96f);

    private void UpdateAccessibleDescription()
    {
        if (_points.Length == 0)
        {
            AccessibleDescription = "User growth analytics are unavailable.";
        }
        else
        {
            var total = _points.Sum(point => Math.Max(0, point.Count));
            var peak = _points.MaxBy(point => point.Count)!;
            AccessibleDescription = $"Daily Firebase Auth registrations from {_points[0].Date:MMM d} through {_points[^1].Date:MMM d}. " +
                $"{total:N0} new account{(total == 1 ? string.Empty : "s")} total; peak {Math.Max(0, peak.Count):N0} on {peak.Date:MMM d}.";
        }

        if (IsHandleCreated) AccessibilityNotifyClients(AccessibleEvents.DescriptionChange, -1);
    }

    private RectangleF PlotBounds(float scale)
    {
        var left = Dip(38, scale);
        var top = Dip(10, scale);
        var right = Dip(16, scale);
        var labels = Dip(27, scale);
        return new RectangleF(
            left,
            top,
            Math.Max(Dip(36, scale), ClientSize.Width - left - right),
            Math.Max(Dip(24, scale), ClientSize.Height - top - labels));
    }

    private static void DrawGrid(Graphics graphics, RectangleF graph, float scale)
    {
        var highContrast = SystemInformation.HighContrast;
        using var plotBrush = new SolidBrush(highContrast ? SystemColors.Window : ApplePalette.Surface);
        graphics.FillRectangle(plotBrush, graph);

        using var gridPen = new Pen(highContrast ? SystemColors.GrayText : Color.FromArgb(118, ApplePalette.Line), Math.Max(1f, Dip(.7f, scale)));
        for (var row = 0; row < 3; row++)
        {
            var y = graph.Top + (graph.Height * row / 3f);
            graphics.DrawLine(gridPen, graph.Left, y, graph.Right, y);
        }

        using var baselinePen = new Pen(highContrast ? SystemColors.WindowText : Color.FromArgb(205, ApplePalette.StrongLine), Math.Max(1f, Dip(1f, scale)));
        graphics.DrawLine(baselinePen, graph.Left, graph.Bottom, graph.Right, graph.Bottom);
    }

    private static void DrawEmptyState(Graphics graphics, string message, RectangleF graph, float scale)
    {
        using var emptyBrush = new SolidBrush(SystemInformation.HighContrast ? SystemColors.WindowText : ApplePalette.Secondary);
        using var emptyFont = ChartFont(9.5f);
        using var emptyFormat = new StringFormat
        {
            Alignment = StringAlignment.Center,
            LineAlignment = StringAlignment.Center,
            Trimming = StringTrimming.EllipsisCharacter,
        };
        var inset = Dip(8, scale);
        graphics.DrawString(message, emptyFont, emptyBrush, RectangleF.Inflate(graph, -inset, -inset), emptyFormat);
    }

    private static void DrawPoint(Graphics graphics, Pen outline, PointF center, float diameter)
    {
        var bounds = new RectangleF(center.X - (diameter / 2f), center.Y - (diameter / 2f), diameter, diameter);
        using var fill = new SolidBrush(SystemInformation.HighContrast ? SystemColors.Window : ApplePalette.Surface);
        graphics.FillEllipse(fill, bounds);
        graphics.DrawEllipse(outline, bounds);
    }

    private static void DrawYAxis(Graphics graphics, RectangleF graph, int axisMax, float scale)
    {
        using var font = ChartFont(9f);
        using var brush = new SolidBrush(SystemInformation.HighContrast ? SystemColors.WindowText : ApplePalette.Secondary);
        using var format = new StringFormat
        {
            Alignment = StringAlignment.Far,
            LineAlignment = StringAlignment.Center,
            FormatFlags = StringFormatFlags.NoWrap,
        };
        var values = new[] { axisMax, (int)Math.Ceiling(axisMax / 2d), 0 }.Distinct();
        foreach (var value in values)
        {
            var y = graph.Bottom - (graph.Height * value / Math.Max(1f, axisMax));
            var bounds = new RectangleF(0, y - Dip(9, scale), Math.Max(1, graph.Left - Dip(7, scale)), Dip(18, scale));
            graphics.DrawString(value.ToString("N0", CultureInfo.CurrentCulture), font, brush, bounds, format);
        }
    }

    private static int NiceAxisMax(int maximum)
    {
        if (maximum <= 1) return 1;
        var magnitude = Math.Pow(10, Math.Floor(Math.Log10(maximum)));
        var normalized = maximum / magnitude;
        var nice = normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
        return Math.Max(maximum, (int)Math.Ceiling(nice * magnitude));
    }

    private static IEnumerable<int> GrowthLabelIndices(int count, float width, float scale)
    {
        if (count <= 1)
        {
            yield return 0;
            yield break;
        }

        if (width < Dip(125, scale))
        {
            yield return count - 1;
            yield break;
        }

        var requested = width >= Dip(430, scale) ? 4 : width >= Dip(230, scale) ? 3 : 2;
        var previous = -1;
        for (var label = 0; label < requested; label++)
        {
            var index = (int)Math.Round(label * (count - 1d) / (requested - 1d));
            if (index == previous) continue;
            previous = index;
            yield return index;
        }
    }

    private static RectangleF CenteredLabelBounds(float centerX, float top, float width, float height, float availableWidth)
    {
        var left = Math.Clamp(centerX - (width / 2f), 0f, Math.Max(0f, availableWidth - width));
        return new RectangleF(left, top, Math.Min(width, availableWidth), height);
    }

    private static void ConfigureGraphics(Graphics graphics)
    {
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
        graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
    }

    private static Font ChartFont(float points)
        => new(AppleTypography.TextFamily, Math.Max(9f, points), FontStyle.Regular, GraphicsUnit.Point);

    private static float Dip(float value, float scale) => value * scale;
}
