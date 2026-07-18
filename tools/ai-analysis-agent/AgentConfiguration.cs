using System.Text.Json;
using System.Text.RegularExpressions;

namespace MinimalistAIAnalysis.Agent;

internal sealed record AgentConfiguration(
    string Workspace,
    string ConfigurationPath,
    Uri TeamDomain,
    string ApplicationAudience,
    string AllowedEmail)
{
    public const int SchemaVersion = 1;
    public const int Port = 8791;
    public const string TaskName = "Minimalist Chat Remote Analysis Agent";
    public const string PublicHost = "analysis.minimalist.chat";
    public const string ConfigurationFileName = "remote-analysis-agent.json";
    public const string LocalProductDirectoryName = "Minimalist.chat";
    public const string LocalAgentDirectoryName = "AnalysisAgent";

    private static readonly Regex AudiencePattern = new(
        "^[A-Za-z0-9_-]{16,128}$",
        RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);

    public Uri JwksUri => new(TeamDomain, "/cdn-cgi/access/certs");
    public string ExpectedIssuer => TeamDomain.GetLeftPart(UriPartial.Authority);
    public static string LocalAgentDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        LocalProductDirectoryName,
        LocalAgentDirectoryName);
    public static string DefaultConfigurationPath => Path.Combine(LocalAgentDirectory, ConfigurationFileName);

    public static AgentConfiguration Load(string workspace, string configurationPath)
    {
        var normalizedWorkspace = WorkspaceResolver.Validate(workspace);
        string path;
        try { path = Path.GetFullPath(configurationPath); }
        catch { throw new AgentConfigurationException("configuration_path_invalid"); }
        if (!string.Equals(Path.GetFileName(path), ConfigurationFileName, StringComparison.Ordinal) ||
            !File.Exists(path) ||
            (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new AgentConfigurationException("configuration_missing");

        string json;
        try
        {
            var info = new FileInfo(path);
            if (info.Length is <= 0 or > 16_384)
                throw new AgentConfigurationException("configuration_size_invalid");
            json = File.ReadAllText(path);
        }
        catch (AgentConfigurationException) { throw; }
        catch { throw new AgentConfigurationException("configuration_unreadable"); }

        try
        {
            using var document = JsonDocument.Parse(json, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 4,
            });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
                throw new AgentConfigurationException("configuration_shape_invalid");

            var properties = root.EnumerateObject().ToArray();
            var expected = new HashSet<string>(StringComparer.Ordinal)
            {
                "schemaVersion", "teamDomain", "applicationAudience", "allowedEmail",
            };
            if (properties.Length != expected.Count ||
                properties.Select(property => property.Name).Distinct(StringComparer.Ordinal).Count() != properties.Length ||
                properties.Any(property => !expected.Contains(property.Name)))
                throw new AgentConfigurationException("configuration_fields_invalid");

            if (!root.TryGetProperty("schemaVersion", out var schema) ||
                schema.ValueKind != JsonValueKind.Number ||
                !schema.TryGetInt32(out var schemaVersion) ||
                schemaVersion != SchemaVersion)
                throw new AgentConfigurationException("configuration_schema_invalid");

            var teamDomainText = RequiredString(root, "teamDomain", 200);
            if (!Uri.TryCreate(teamDomainText, UriKind.Absolute, out var teamDomain) ||
                !string.Equals(teamDomain.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) ||
                !string.IsNullOrEmpty(teamDomain.UserInfo) ||
                !teamDomain.IsDefaultPort ||
                teamDomain.AbsolutePath != "/" ||
                !string.IsNullOrEmpty(teamDomain.Query) ||
                !string.IsNullOrEmpty(teamDomain.Fragment) ||
                teamDomainText.EndsWith("/", StringComparison.Ordinal) ||
                !IsCloudflareAccessHost(teamDomain.Host))
                throw new AgentConfigurationException("configuration_team_domain_invalid");

            var audience = RequiredString(root, "applicationAudience", 128);
            if (!AudiencePattern.IsMatch(audience))
                throw new AgentConfigurationException("configuration_audience_invalid");

            var allowedEmail = RequiredString(root, "allowedEmail", 254).ToLowerInvariant();
            if (!IsEmailShapeValid(allowedEmail))
                throw new AgentConfigurationException("configuration_email_invalid");

            var canonicalTeamDomain = new Uri($"https://{teamDomain.IdnHost.ToLowerInvariant()}");
            return new AgentConfiguration(normalizedWorkspace, path, canonicalTeamDomain, audience, allowedEmail);
        }
        catch (AgentConfigurationException) { throw; }
        catch (JsonException) { throw new AgentConfigurationException("configuration_json_invalid"); }
        catch { throw new AgentConfigurationException("configuration_invalid"); }
    }

    private static string RequiredString(JsonElement root, string name, int maximumLength)
    {
        if (!root.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String)
            throw new AgentConfigurationException("configuration_fields_invalid");
        var text = value.GetString() ?? string.Empty;
        if (text.Length == 0 || text.Length > maximumLength || !string.Equals(text, text.Trim(), StringComparison.Ordinal))
            throw new AgentConfigurationException("configuration_fields_invalid");
        return text;
    }

    private static bool IsCloudflareAccessHost(string host)
    {
        const string suffix = ".cloudflareaccess.com";
        if (!host.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)) return false;
        var team = host[..^suffix.Length];
        return team.Length is >= 1 and <= 63 &&
            team[0] != '-' && team[^1] != '-' &&
            team.All(character => char.IsAsciiLetterOrDigit(character) || character == '-');
    }

    private static bool IsEmailShapeValid(string value)
    {
        if (value.Any(char.IsWhiteSpace)) return false;
        var at = value.IndexOf('@');
        if (at < 1 || at != value.LastIndexOf('@') || at >= value.Length - 3) return false;
        var domain = value[(at + 1)..];
        return domain.Contains('.', StringComparison.Ordinal) &&
            !domain.StartsWith(".", StringComparison.Ordinal) &&
            !domain.EndsWith(".", StringComparison.Ordinal);
    }
}

internal sealed record AgentLaunchOptions(string Workspace, string ConfigurationPath);

internal sealed class AgentConfigurationException(string code) : Exception(code)
{
    public string Code { get; } = code;
}

internal static class WorkspaceResolver
{
    public static AgentLaunchOptions FromArguments(string[] args)
    {
        if (args.Length != 4 ||
            !string.Equals(args[0], "--workspace", StringComparison.Ordinal) ||
            !string.Equals(args[2], "--config", StringComparison.Ordinal))
            throw new AgentConfigurationException("workspace_argument_invalid");
        var workspace = Validate(args[1]);
        string configurationPath;
        try { configurationPath = Path.GetFullPath(args[3]); }
        catch { throw new AgentConfigurationException("configuration_path_invalid"); }
        if (!string.Equals(configurationPath, AgentConfiguration.DefaultConfigurationPath, StringComparison.OrdinalIgnoreCase))
            throw new AgentConfigurationException("configuration_path_invalid");
        return new AgentLaunchOptions(workspace, configurationPath);
    }

    public static string Validate(string workspace)
    {
        if (string.IsNullOrWhiteSpace(workspace))
            throw new AgentConfigurationException("workspace_invalid");
        string fullPath;
        try { fullPath = Path.GetFullPath(workspace.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)); }
        catch { throw new AgentConfigurationException("workspace_invalid"); }
        if (!Directory.Exists(fullPath) ||
            !File.Exists(Path.Combine(fullPath, "tools", "ollama-bridge", "ollama-bridge.cjs")))
            throw new AgentConfigurationException("workspace_invalid");
        return fullPath;
    }
}
