using System.Text.Json;

namespace MinimalistAIAnalysis.Agent;

internal sealed record ParsedControlState(string Mode, int IdleMinutes, bool Valid);
internal sealed record ParsedTunnelState(bool DesiredOn, bool Valid);

internal static class RemoteStateParser
{
    private static readonly IReadOnlyDictionary<string, string> ApprovedModelProfiles =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["qwen3:4b-instruct"] = "fast",
            ["qwen3:14b"] = "smart",
            ["qwen2.5vl:7b"] = "vision",
        };

    public static ParsedControlState ParseControl(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new("auto", 120, false);
        try
        {
            using var document = JsonDocument.Parse(json, StrictOptions(4));
            var root = document.RootElement;
            if (!HasExactProperties(root, "mode", "idleMinutes")) return new("auto", 120, false);
            var mode = root.GetProperty("mode").GetString();
            var idle = root.GetProperty("idleMinutes");
            if (mode is not ("off" or "on" or "auto") ||
                idle.ValueKind != JsonValueKind.Number ||
                !idle.TryGetInt32(out var minutes) ||
                minutes is < 15 or > 720)
                return new("auto", 120, false);
            return new(mode, minutes, true);
        }
        catch { return new("auto", 120, false); }
    }

    public static ParsedTunnelState ParseTunnel(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new(false, false);
        try
        {
            using var document = JsonDocument.Parse(json, StrictOptions(4));
            var root = document.RootElement;
            if (!HasExactProperties(root, "schemaVersion", "desiredOn")) return new(false, false);
            var schema = root.GetProperty("schemaVersion");
            var desired = root.GetProperty("desiredOn");
            if (schema.ValueKind != JsonValueKind.Number || !schema.TryGetInt32(out var version) || version != 1 ||
                desired.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                return new(false, false);
            return new(desired.GetBoolean(), true);
        }
        catch { return new(false, false); }
    }

    public static RemoteActivityEntryV1[] ParseActivity(string? json, int maximumEntries = 40)
    {
        if (string.IsNullOrWhiteSpace(json) || maximumEntries is < 1 or > 40) return [];
        try
        {
            using var document = JsonDocument.Parse(json, StrictOptions(8));
            if (document.RootElement.ValueKind != JsonValueKind.Array) return [];
            var rows = document.RootElement.EnumerateArray().ToArray();
            if (rows.Length > 240) return [];
            return rows
                .Select(ParseActivityRow)
                .Where(row => row is not null)
                .Cast<RemoteActivityEntryV1>()
                .OrderByDescending(row => row.TimeUtc)
                .Take(maximumEntries)
                .ToArray();
        }
        catch { return []; }
    }

    public static RemoteModelStatusV1[] ApprovedModelStatuses(IEnumerable<string>? installedModels, bool checkedSuccessfully)
    {
        var installed = new HashSet<string>(installedModels ?? [], StringComparer.OrdinalIgnoreCase);
        return ApprovedModelProfiles
            .Select(pair => new RemoteModelStatusV1(
                pair.Value,
                !checkedSuccessfully ? "not_checked" : installed.Contains(pair.Key) ? "ready" : "missing"))
            .OrderBy(status => status.Profile switch { "fast" => 0, "smart" => 1, _ => 2 })
            .ToArray();
    }

    internal static string ModelProfile(string? model)
        => model is not null && ApprovedModelProfiles.TryGetValue(model, out var profile) ? profile : "unknown";

    private static RemoteActivityEntryV1? ParseActivityRow(JsonElement row)
    {
        if (row.ValueKind != JsonValueKind.Object ||
            !row.TryGetProperty("time", out var time) || !time.TryGetInt64(out var unixMs) ||
            !row.TryGetProperty("result", out var resultNode) || resultNode.ValueKind != JsonValueKind.String)
            return null;
        DateTimeOffset timestamp;
        try { timestamp = DateTimeOffset.FromUnixTimeMilliseconds(unixMs); }
        catch { return null; }
        if (timestamp.Year is < 2020 or > 2100) return null;

        var result = resultNode.GetString();
        if (result is not ("success" or "error")) return null;
        var rawFeature = row.TryGetProperty("feature", out var featureNode) && featureNode.ValueKind == JsonValueKind.String
            ? featureNode.GetString()
            : null;
        var feature = rawFeature switch
        {
            "Chat completion" => "chat_completion",
            "Text or vision generation" => "generation",
            _ => "ai_request",
        };
        var model = row.TryGetProperty("model", out var modelNode) && modelNode.ValueKind == JsonValueKind.String
            ? modelNode.GetString()
            : null;
        var duration = row.TryGetProperty("durationMs", out var durationNode) && durationNode.TryGetInt32(out var value)
            ? Math.Clamp(value, 0, 900_000)
            : 0;
        return new RemoteActivityEntryV1(timestamp, feature, ModelProfile(model), duration, result);
    }

    private static bool HasExactProperties(JsonElement root, params string[] expected)
    {
        if (root.ValueKind != JsonValueKind.Object) return false;
        var properties = root.EnumerateObject().ToArray();
        var set = expected.ToHashSet(StringComparer.Ordinal);
        return properties.Length == set.Count &&
            properties.Select(property => property.Name).Distinct(StringComparer.Ordinal).Count() == properties.Length &&
            properties.All(property => set.Contains(property.Name));
    }

    private static JsonDocumentOptions StrictOptions(int depth) => new()
    {
        AllowTrailingCommas = false,
        CommentHandling = JsonCommentHandling.Disallow,
        MaxDepth = depth,
    };
}
