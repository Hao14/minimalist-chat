using System.Net;

namespace MinimalistAIAnalysis.Agent;

internal enum RequestSecurityDecision
{
    Continue,
    BadRequest,
    Forbidden,
}

internal static class RequestSecurity
{
    public static RequestSecurityDecision Evaluate(
        IPAddress? remoteAddress,
        bool hasQuery,
        long? contentLength,
        bool hasTransferEncoding)
    {
        if (remoteAddress is null || !IPAddress.IsLoopback(remoteAddress)) return RequestSecurityDecision.Forbidden;
        if (hasQuery || contentLength is > 0 || hasTransferEncoding) return RequestSecurityDecision.BadRequest;
        return RequestSecurityDecision.Continue;
    }
}
