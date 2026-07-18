using System.Text.Json;

namespace MinimalistAIAnalysis.Agent;

internal static class AgentRuntimeStatus
{
    private const string FileName = "remote-analysis-agent-status.json";

    public static void Write(string? workspace, string state, string? code = null)
    {
        if (string.IsNullOrWhiteSpace(workspace) || !Directory.Exists(workspace)) return;
        try
        {
            var directory = Path.Combine(workspace, ".bridge-control");
            Directory.CreateDirectory(directory);
            var destination = Path.Combine(directory, FileName);
            var temporary = destination + ".tmp";
            var payload = JsonSerializer.Serialize(new
            {
                schemaVersion = 1,
                taskName = AgentConfiguration.TaskName,
                state,
                code,
                checkedAtUtc = DateTimeOffset.UtcNow,
            });
            File.WriteAllText(temporary, payload);
            File.Move(temporary, destination, overwrite: true);
        }
        catch { }
    }
}
