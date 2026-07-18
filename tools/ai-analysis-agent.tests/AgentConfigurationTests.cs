using System.Text.Json;
using MinimalistAIAnalysis.Agent;

namespace MinimalistAIAnalysis.Agent.Tests;

public sealed class AgentConfigurationTests : IDisposable
{
    private readonly string _workspace = Path.Combine(Path.GetTempPath(), $"minimalist-agent-{Guid.NewGuid():N}");
    private string ConfigurationPath => Path.Combine(
        _workspace,
        ".bridge-control",
        AgentConfiguration.ConfigurationFileName);

    public AgentConfigurationTests()
    {
        Directory.CreateDirectory(Path.Combine(_workspace, "tools", "ollama-bridge"));
        Directory.CreateDirectory(Path.Combine(_workspace, ".bridge-control"));
        File.WriteAllText(Path.Combine(_workspace, "tools", "ollama-bridge", "ollama-bridge.cjs"), "// fixture");
    }

    [Fact]
    public void Load_AcceptsStrictCloudflareAccessConfiguration()
    {
        WriteConfiguration(new
        {
            schemaVersion = 1,
            teamDomain = "https://minimalist-team.cloudflareaccess.com",
            applicationAudience = "abcdefghijklmnop1234567890_-",
            allowedEmail = "Owner@Example.com",
        });

        var configuration = AgentConfiguration.Load(_workspace, ConfigurationPath);

        Assert.Equal("https://minimalist-team.cloudflareaccess.com", configuration.ExpectedIssuer);
        Assert.Equal("owner@example.com", configuration.AllowedEmail);
        Assert.Equal(ConfigurationPath, configuration.ConfigurationPath);
        Assert.Equal("https://minimalist-team.cloudflareaccess.com/cdn-cgi/access/certs", configuration.JwksUri.AbsoluteUri);
    }

    [Fact]
    public void Load_RejectsExtraFields()
    {
        WriteConfiguration(new
        {
            schemaVersion = 1,
            teamDomain = "https://minimalist-team.cloudflareaccess.com",
            applicationAudience = "abcdefghijklmnop1234567890_-",
            allowedEmail = "owner@example.com",
            token = "must-not-be-stored-here",
        });

        var error = Assert.Throws<AgentConfigurationException>(() => AgentConfiguration.Load(_workspace, ConfigurationPath));
        Assert.Equal("configuration_fields_invalid", error.Code);
    }

    [Theory]
    [InlineData("http://minimalist-team.cloudflareaccess.com")]
    [InlineData("https://example.com")]
    [InlineData("https://minimalist-team.cloudflareaccess.com/path")]
    [InlineData("https://minimalist-team.cloudflareaccess.com/")]
    public void Load_RejectsUnsafeTeamDomain(string teamDomain)
    {
        WriteConfiguration(new
        {
            schemaVersion = 1,
            teamDomain,
            applicationAudience = "abcdefghijklmnop1234567890_-",
            allowedEmail = "owner@example.com",
        });

        Assert.Throws<AgentConfigurationException>(() => AgentConfiguration.Load(_workspace, ConfigurationPath));
    }

    [Fact]
    public void WorkspaceArguments_RequireOneExplicitWorkspace()
    {
        var options = WorkspaceResolver.FromArguments([
            "--workspace", _workspace,
            "--config", AgentConfiguration.DefaultConfigurationPath,
        ]);
        Assert.Equal(Path.GetFullPath(_workspace), options.Workspace);
        Assert.Equal(AgentConfiguration.DefaultConfigurationPath, options.ConfigurationPath);
        Assert.Throws<AgentConfigurationException>(() => WorkspaceResolver.FromArguments([]));
        Assert.Throws<AgentConfigurationException>(() => WorkspaceResolver.FromArguments(["--urls", "http://0.0.0.0:8791"]));
        Assert.Throws<AgentConfigurationException>(() => WorkspaceResolver.FromArguments([
            "--workspace", _workspace,
            "--config", ConfigurationPath,
        ]));
    }

    public void Dispose()
    {
        try { Directory.Delete(_workspace, recursive: true); } catch { }
    }

    private void WriteConfiguration(object value)
        => File.WriteAllText(
            ConfigurationPath,
            JsonSerializer.Serialize(value));
}
