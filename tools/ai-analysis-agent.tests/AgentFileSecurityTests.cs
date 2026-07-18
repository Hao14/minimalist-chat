using System.Diagnostics;
using System.Security.Principal;
using System.Text.Json;

namespace MinimalistAIAnalysis.Agent.Tests;

public sealed class AgentFileSecurityTests : IDisposable
{
    private readonly string _temporaryRoot = Path.Combine(
        Path.GetTempPath(),
        $"minimalist-agent-acl-{Guid.NewGuid():N}");

    [Fact]
    public void ProtectPath_RemovesBroadAccessAndKeepsApprovedWindowsPrincipals()
    {
        Directory.CreateDirectory(_temporaryRoot);
        var protectedFile = Path.Combine(_temporaryRoot, "agent.exe");
        File.WriteAllText(protectedFile, "fixture");
        var probeScript = Path.Combine(_temporaryRoot, "probe.ps1");
        var helperPath = ScriptPath("AgentFileSecurity.ps1");

        File.WriteAllText(probeScript, $$"""
            $ErrorActionPreference = 'Stop'
            Set-StrictMode -Version Latest
            . '{{PowerShellLiteral(helperPath)}}'

            $root = '{{PowerShellLiteral(_temporaryRoot)}}'
            $acl = Get-Acl -LiteralPath $root
            foreach ($sidType in @(
              [Security.Principal.WellKnownSidType]::WorldSid,
              [Security.Principal.WellKnownSidType]::BuiltinUsersSid)) {
              $sid = [Security.Principal.SecurityIdentifier]::new($sidType, $null)
              $rule = [Security.AccessControl.FileSystemAccessRule]::new(
                $sid,
                [Security.AccessControl.FileSystemRights]::FullControl,
                [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
                  [Security.AccessControl.InheritanceFlags]::ObjectInherit,
                [Security.AccessControl.PropagationFlags]::None,
                [Security.AccessControl.AccessControlType]::Allow)
              [void]$acl.AddAccessRule($rule)
            }
            Set-Acl -LiteralPath $root -AclObject $acl

            Protect-MinimalistAgentPath -LiteralPath $root -Recurse
            # Protection must remain idempotent after the root already has a
            # protected three-principal DACL, matching publish then re-verify.
            Protect-MinimalistAgentPath -LiteralPath $root -Recurse

            function Get-AclSummary([string]$Path) {
              $saved = Get-Acl -LiteralPath $Path
              [pscustomobject]@{
                Protected = $saved.AreAccessRulesProtected
                Owner = $saved.GetOwner([Security.Principal.SecurityIdentifier]).Value
                Rules = @($saved.Access | ForEach-Object {
                  [pscustomobject]@{
                    Sid = $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
                    Type = [string]$_.AccessControlType
                    Inherited = $_.IsInherited
                  }
                })
              }
            }

            [pscustomobject]@{
              Root = Get-AclSummary $root
              File = Get-AclSummary (Join-Path $root 'agent.exe')
            } | ConvertTo-Json -Depth 8 -Compress
            """);

        var result = RunPowerShell(probeScript);
        Assert.True(result.ExitCode == 0, result.StandardError);
        using var json = JsonDocument.Parse(result.StandardOutput.Trim());
        var currentUserSid = WindowsIdentity.GetCurrent().User?.Value;
        Assert.False(string.IsNullOrWhiteSpace(currentUserSid));
        var expectedSids = new HashSet<string>(StringComparer.Ordinal)
        {
            currentUserSid!,
            "S-1-5-18",
            "S-1-5-32-544",
        };

        AssertAcl(json.RootElement.GetProperty("Root"), expectedSids, currentUserSid!);
        AssertAcl(json.RootElement.GetProperty("File"), expectedSids, currentUserSid!);
    }

    [Fact]
    public void SetupScripts_ApplyTheSharedAclContract()
    {
        var publish = File.ReadAllText(ScriptPath("publish.ps1"));
        var configure = File.ReadAllText(ScriptPath("configure-remote-analysis-agent.ps1"));
        var install = File.ReadAllText(ScriptPath("install-remote-analysis-agent.ps1"));

        Assert.Contains("Protect-MinimalistAgentPath -LiteralPath $outputDirectory -Recurse", publish);
        Assert.Contains("Protect-MinimalistAgentPath -LiteralPath $temporaryPath", configure);
        Assert.Contains("Protect-MinimalistAgentPath -LiteralPath $configPath", configure);
        Assert.Contains("Protect-MinimalistAgentPath -LiteralPath $configPath", install);
        Assert.Contains("Protect-MinimalistAgentPath -LiteralPath $releaseDirectory -Recurse", install);
        Assert.Contains("LocalApplicationData", configure);
        Assert.Contains("LocalApplicationData", install);
        Assert.Contains("-Execute $installedExecutablePath", install);
        Assert.Contains("--config", install);
        Assert.DoesNotContain("-Execute $publishedExecutablePath", install);
    }

    public void Dispose()
    {
        try { Directory.Delete(_temporaryRoot, recursive: true); } catch { }
    }

    private static void AssertAcl(JsonElement summary, HashSet<string> expectedSids, string currentUserSid)
    {
        Assert.True(summary.GetProperty("Protected").GetBoolean());
        Assert.Equal(currentUserSid, summary.GetProperty("Owner").GetString());
        var rules = summary.GetProperty("Rules").EnumerateArray().ToArray();
        Assert.Equal(expectedSids.Count, rules.Length);
        Assert.All(rules, rule =>
        {
            Assert.Equal("Allow", rule.GetProperty("Type").GetString());
            Assert.False(rule.GetProperty("Inherited").GetBoolean());
        });
        Assert.Equal(
            expectedSids.Order(StringComparer.Ordinal),
            rules.Select(rule => rule.GetProperty("Sid").GetString()!).Order(StringComparer.Ordinal));
    }

    private static string ScriptPath(string fileName)
        => Path.Combine(AppContext.BaseDirectory, "Scripts", fileName);

    private static string PowerShellLiteral(string value) => value.Replace("'", "''", StringComparison.Ordinal);

    private static PowerShellResult RunPowerShell(string scriptPath)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                "System32",
                "WindowsPowerShell",
                "v1.0",
                "powershell.exe"),
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        startInfo.ArgumentList.Add("-NoLogo");
        startInfo.ArgumentList.Add("-NoProfile");
        startInfo.ArgumentList.Add("-NonInteractive");
        startInfo.ArgumentList.Add("-ExecutionPolicy");
        startInfo.ArgumentList.Add("Bypass");
        startInfo.ArgumentList.Add("-File");
        startInfo.ArgumentList.Add(scriptPath);

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException("PowerShell did not start.");
        var standardOutput = process.StandardOutput.ReadToEndAsync();
        var standardError = process.StandardError.ReadToEndAsync();
        Assert.True(process.WaitForExit(30_000), "PowerShell ACL test timed out.");
        return new PowerShellResult(process.ExitCode, standardOutput.GetAwaiter().GetResult(), standardError.GetAwaiter().GetResult());
    }

    private sealed record PowerShellResult(int ExitCode, string StandardOutput, string StandardError);
}
