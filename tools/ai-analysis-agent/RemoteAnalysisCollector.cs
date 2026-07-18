using System.Net.Http.Headers;
using System.Reflection;
using System.Text.Json;

namespace MinimalistAIAnalysis.Agent;

internal sealed record OllamaProbeResult(bool Checked, string[] InstalledModels);

internal interface IRemoteAnalysisCollector
{
    Task<RemoteAnalysisSnapshotV1> CollectAsync(CancellationToken cancellationToken);
}

internal sealed class RemoteAnalysisCollector(
    AgentConfiguration configuration,
    HttpClient statusHttpClient,
    IRecoveryTaskReader recoveryTaskReader) : IRemoteAnalysisCollector
{
    private const string BridgeHealthUrl = "http://127.0.0.1:8790/health";
    private const string OllamaTagsUrl = "http://127.0.0.1:11435/api/tags";
    private const string PublicBridgeHealthUrl = "https://ai.minimalist.chat/health";
    private const string ExpectedUpstream = "http://127.0.0.1:11435";
    private readonly SemaphoreSlim _collectionLock = new(1, 1);

    public async Task<RemoteAnalysisSnapshotV1> CollectAsync(CancellationToken cancellationToken)
    {
        await _collectionLock.WaitAsync(cancellationToken);
        try
        {
            var warnings = new HashSet<string>(StringComparer.Ordinal);
            var controlTextTask = ReadStateFileAsync("ai-control.json", 16_384, cancellationToken);
            var activityTextTask = ReadStateFileAsync("ai-activity.json", 262_144, cancellationToken);
            var tunnelTextTask = ReadStateFileAsync("public-tunnel.json", 16_384, cancellationToken);
            var bridgeTask = HasProtectedBridgeMarkerAsync(BridgeHealthUrl, cancellationToken);
            var ollamaTask = ProbeOllamaAsync(cancellationToken);
            var recoveryTask = Task.Run(recoveryTaskReader.Read, cancellationToken);

            await Task.WhenAll(controlTextTask, activityTextTask, tunnelTextTask, bridgeTask, ollamaTask, recoveryTask);
            var control = RemoteStateParser.ParseControl(await controlTextTask);
            var activity = RemoteStateParser.ParseActivity(await activityTextTask);
            var tunnelIntent = RemoteStateParser.ParseTunnel(await tunnelTextTask);
            var bridgeReady = await bridgeTask;
            var ollama = await ollamaTask;
            var recovery = await recoveryTask;

            if (!control.Valid) warnings.Add("control_state_unavailable");
            if (!tunnelIntent.Valid) warnings.Add("tunnel_intent_unavailable");
            if (recovery.Installed is null) warnings.Add("recovery_task_status_unavailable");

            var tunnelReady = false;
            if (tunnelIntent.DesiredOn)
                tunnelReady = await HasProtectedBridgeMarkerAsync(PublicBridgeHealthUrl, cancellationToken);

            var lastActivity = activity.Length == 0 ? null : activity.Max(row => (DateTimeOffset?)row.TimeUtc);
            var tunnelState = !tunnelIntent.DesiredOn ? "off" : tunnelReady ? "healthy" : "recovering";
            return new RemoteAnalysisSnapshotV1(
                SchemaVersion: 1,
                ObservedAtUtc: DateTimeOffset.UtcNow,
                AgentVersion: Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.1.0",
                Capabilities: new RemoteAgentCapabilitiesV1(ReadOnly: true, ControlsAvailable: false),
                Ai: new RemoteAiStatusV1(
                    control.Mode,
                    control.IdleMinutes,
                    ollama.Checked ? "ready" : bridgeReady && control.Mode == "auto" ? "sleeping_by_design" : "unavailable",
                    RemoteStateParser.ApprovedModelStatuses(ollama.InstalledModels, ollama.Checked),
                    lastActivity,
                    activity),
                Bridge: new RemoteBridgeStatusV1(bridgeReady, bridgeReady),
                Tunnel: new RemoteTunnelStatusV1(tunnelIntent.DesiredOn, tunnelState),
                RecoveryTask: recovery,
                Warnings: warnings.Order(StringComparer.Ordinal).Take(8).ToArray());
        }
        finally { _collectionLock.Release(); }
    }

    private async Task<string?> ReadStateFileAsync(string fileName, int maximumBytes, CancellationToken cancellationToken)
    {
        var path = Path.Combine(configuration.Workspace, ".bridge-control", fileName);
        try
        {
            var info = new FileInfo(path);
            if (!info.Exists || info.Length is <= 0 || info.Length > maximumBytes) return null;
            await using var stream = new FileStream(
                path,
                FileMode.Open,
                FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete,
                bufferSize: 4096,
                FileOptions.Asynchronous | FileOptions.SequentialScan);
            using var reader = new StreamReader(stream);
            var text = await reader.ReadToEndAsync(cancellationToken);
            return text.Length <= maximumBytes ? text : null;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch { return null; }
    }

    private async Task<bool> HasProtectedBridgeMarkerAsync(string url, CancellationToken cancellationToken)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            using var response = await statusHttpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!response.IsSuccessStatusCode ||
                !response.Headers.TryGetValues("X-Minimalist-Ollama-Bridge", out var values) ||
                values.Count() != 1 || !string.Equals(values.Single(), "1", StringComparison.Ordinal))
                return false;
            var bytes = await ReadBoundedResponseAsync(response, 16_384, cancellationToken);
            using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 8 });
            var root = document.RootElement;
            return root.ValueKind == JsonValueKind.Object &&
                root.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True &&
                root.TryGetProperty("upstream", out var upstream) && upstream.ValueKind == JsonValueKind.String &&
                string.Equals(upstream.GetString()?.TrimEnd('/'), ExpectedUpstream, StringComparison.OrdinalIgnoreCase);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch { return false; }
    }

    private async Task<OllamaProbeResult> ProbeOllamaAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, OllamaTagsUrl);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            using var response = await statusHttpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!response.IsSuccessStatusCode) return new(false, []);
            var bytes = await ReadBoundedResponseAsync(response, 262_144, cancellationToken);
            using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 12 });
            if (document.RootElement.ValueKind != JsonValueKind.Object ||
                !document.RootElement.TryGetProperty("models", out var modelsNode) || modelsNode.ValueKind != JsonValueKind.Array)
                return new(false, []);
            var models = modelsNode.EnumerateArray().Take(256)
                .Select(item => item.ValueKind == JsonValueKind.Object && item.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String
                    ? name.GetString()
                    : null)
                .Where(name => !string.IsNullOrEmpty(name))
                .Cast<string>()
                .ToArray();
            return new(true, models);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch { return new(false, []); }
    }

    private static async Task<byte[]> ReadBoundedResponseAsync(
        HttpResponseMessage response,
        int maximumBytes,
        CancellationToken cancellationToken)
    {
        if (response.Content.Headers.ContentLength is long declared && declared > maximumBytes)
            throw new InvalidOperationException();
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var memory = new MemoryStream(Math.Min(maximumBytes, 16_384));
        var buffer = new byte[4096];
        while (true)
        {
            var read = await stream.ReadAsync(buffer, cancellationToken);
            if (read == 0) break;
            if (memory.Length + read > maximumBytes) throw new InvalidOperationException();
            memory.Write(buffer, 0, read);
        }
        return memory.ToArray();
    }
}
