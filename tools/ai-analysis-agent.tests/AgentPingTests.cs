using System.Text.Json;
using MinimalistAIAnalysis.Agent;

namespace MinimalistAIAnalysis.Agent.Tests;

public sealed class AgentPingTests
{
    [Fact]
    public void CreatePingPayload_ExposesExactHiddenTaskNameWithStableJsonShape()
    {
        var payload = Program.CreatePingPayload();

        Assert.Equal(1, payload.SchemaVersion);
        Assert.Equal("ok", payload.Status);
        Assert.True(payload.ReadOnly);
        Assert.Equal(AgentConfiguration.TaskName, payload.TaskName);
        Assert.Equal("Minimalist Chat Remote Analysis Agent", payload.TaskName);

        using var json = JsonDocument.Parse(JsonSerializer.Serialize(payload, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        }));
        var properties = json.RootElement.EnumerateObject().ToArray();
        Assert.Equal(
            ["schemaVersion", "status", "readOnly", "taskName"],
            properties.Select(property => property.Name));
        Assert.Equal("Minimalist Chat Remote Analysis Agent", json.RootElement.GetProperty("taskName").GetString());
    }
}
