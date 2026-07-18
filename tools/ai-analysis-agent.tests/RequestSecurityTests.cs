using System.Net;
using MinimalistAIAnalysis.Agent;

namespace MinimalistAIAnalysis.Agent.Tests;

public sealed class RequestSecurityTests
{
    [Theory]
    [InlineData("127.0.0.1")]
    [InlineData("::1")]
    public void Evaluate_AcceptsBodylessLoopbackRequests(string address)
        => Assert.Equal(
            RequestSecurityDecision.Continue,
            RequestSecurity.Evaluate(IPAddress.Parse(address), hasQuery: false, contentLength: null, hasTransferEncoding: false));

    [Fact]
    public void Evaluate_RejectsNonLoopbackPeer()
        => Assert.Equal(
            RequestSecurityDecision.Forbidden,
            RequestSecurity.Evaluate(IPAddress.Parse("192.0.2.10"), false, null, false));

    [Theory]
    [InlineData(true, null, false)]
    [InlineData(false, 1, false)]
    [InlineData(false, null, true)]
    public void Evaluate_RejectsQueriesAndBodies(bool query, int? length, bool transferEncoding)
        => Assert.Equal(
            RequestSecurityDecision.BadRequest,
            RequestSecurity.Evaluate(IPAddress.Loopback, query, (long?)length, transferEncoding));
}
