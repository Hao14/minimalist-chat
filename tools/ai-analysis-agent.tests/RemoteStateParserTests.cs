using System.Text.Json;
using MinimalistAIAnalysis.Agent;

namespace MinimalistAIAnalysis.Agent.Tests;

public sealed class RemoteStateParserTests
{
    [Fact]
    public void ParseControl_AcceptsOnlyExactBoundedState()
    {
        Assert.Equal(new ParsedControlState("auto", 30, true), RemoteStateParser.ParseControl("{\"mode\":\"auto\",\"idleMinutes\":30}"));
        Assert.False(RemoteStateParser.ParseControl("{\"mode\":\"on\",\"idleMinutes\":30,\"token\":\"x\"}").Valid);
        Assert.False(RemoteStateParser.ParseControl("{\"mode\":\"on\",\"idleMinutes\":999}").Valid);
    }

    [Fact]
    public void ParseTunnel_FailsClosedOnMalformedOrExpandedState()
    {
        Assert.Equal(new ParsedTunnelState(true, true), RemoteStateParser.ParseTunnel("{\"schemaVersion\":1,\"desiredOn\":true}"));
        Assert.Equal(new ParsedTunnelState(false, false), RemoteStateParser.ParseTunnel("{\"schemaVersion\":1,\"desiredOn\":true,\"url\":\"https://evil.test\"}"));
        Assert.Equal(new ParsedTunnelState(false, false), RemoteStateParser.ParseTunnel("not-json"));
    }

    [Fact]
    public void ParseActivity_SanitizesRawValuesAndBoundsOutput()
    {
        var rows = Enumerable.Range(0, 50).Select(index => new
        {
            time = DateTimeOffset.Parse("2026-07-14T12:00:00Z").AddMinutes(index).ToUnixTimeMilliseconds(),
            feature = index == 49 ? "secret custom feature" : "Chat completion",
            model = index == 49 ? "private-model-name" : "qwen3:4b-instruct",
            durationMs = index == 49 ? 1_500_000 : 25,
            result = "success",
        });

        var parsed = RemoteStateParser.ParseActivity(JsonSerializer.Serialize(rows));
        var serialized = JsonSerializer.Serialize(parsed);

        Assert.Equal(40, parsed.Length);
        Assert.Equal("ai_request", parsed[0].Feature);
        Assert.Equal("unknown", parsed[0].ModelProfile);
        Assert.Equal(900_000, parsed[0].DurationMs);
        Assert.DoesNotContain("secret custom feature", serialized, StringComparison.Ordinal);
        Assert.DoesNotContain("private-model-name", serialized, StringComparison.Ordinal);
    }

    [Fact]
    public void ApprovedModelStatuses_ExposeOnlyFixedProfiles()
    {
        var statuses = RemoteStateParser.ApprovedModelStatuses(["qwen3:14b", "private:model"], checkedSuccessfully: true);

        Assert.Equal(["fast", "smart", "vision"], statuses.Select(status => status.Profile));
        Assert.Equal(["missing", "ready", "missing"], statuses.Select(status => status.State));
        Assert.DoesNotContain(statuses, status => status.Profile.Contains("private", StringComparison.Ordinal));
    }
}
