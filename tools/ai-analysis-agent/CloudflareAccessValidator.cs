using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MinimalistAIAnalysis.Agent;

internal interface IAccessAssertionValidator
{
    ValueTask<bool> IsAuthorizedAsync(string assertion, CancellationToken cancellationToken);
}

internal interface ICloudflareJwksProvider
{
    Task<IReadOnlyDictionary<string, RSAParameters>> GetKeysAsync(bool forceRefresh, CancellationToken cancellationToken);
}

internal sealed class CloudflareAccessAssertionValidator(
    AgentConfiguration configuration,
    ICloudflareJwksProvider keys,
    TimeProvider? timeProvider = null) : IAccessAssertionValidator
{
    private static readonly TimeSpan ClockSkew = TimeSpan.FromSeconds(30);
    private readonly TimeProvider _timeProvider = timeProvider ?? TimeProvider.System;

    public async ValueTask<bool> IsAuthorizedAsync(string assertion, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(assertion) || assertion.Length > 16_384 || assertion.Any(char.IsWhiteSpace))
            return false;
        var segments = assertion.Split('.');
        if (segments.Length != 3 || segments.Any(segment => segment.Length == 0)) return false;

        byte[] headerBytes;
        byte[] signature;
        try
        {
            headerBytes = DecodeBase64Url(segments[0], 2_048);
            signature = DecodeBase64Url(segments[2], 1_024);
        }
        catch { return false; }

        string? kid;
        try
        {
            using var header = JsonDocument.Parse(headerBytes, StrictOptions(4));
            var root = header.RootElement;
            if (root.ValueKind != JsonValueKind.Object || HasDuplicateProperties(root) ||
                !root.TryGetProperty("alg", out var algorithm) || algorithm.ValueKind != JsonValueKind.String ||
                !string.Equals(algorithm.GetString(), "RS256", StringComparison.Ordinal) ||
                !root.TryGetProperty("kid", out var kidNode) || kidNode.ValueKind != JsonValueKind.String)
                return false;
            kid = kidNode.GetString();
            if (string.IsNullOrEmpty(kid) || kid.Length > 128 || kid.Any(character => character < 0x21 || character > 0x7e))
                return false;
        }
        catch { return false; }

        RSAParameters key;
        try
        {
            var available = await keys.GetKeysAsync(forceRefresh: false, cancellationToken);
            if (!available.TryGetValue(kid, out key))
            {
                available = await keys.GetKeysAsync(forceRefresh: true, cancellationToken);
                if (!available.TryGetValue(kid, out key)) return false;
            }
        }
        catch { return false; }

        try
        {
            using var rsa = RSA.Create();
            rsa.ImportParameters(key);
            var signed = Encoding.ASCII.GetBytes($"{segments[0]}.{segments[1]}");
            if (!rsa.VerifyData(signed, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1))
                return false;
        }
        catch { return false; }

        byte[] payloadBytes;
        try { payloadBytes = DecodeBase64Url(segments[1], 12_288); }
        catch { return false; }

        try
        {
            using var payload = JsonDocument.Parse(payloadBytes, StrictOptions(8));
            var root = payload.RootElement;
            if (root.ValueKind != JsonValueKind.Object || HasDuplicateProperties(root)) return false;
            if (!ClaimEquals(root, "iss", configuration.ExpectedIssuer, StringComparison.Ordinal) ||
                !AudienceContains(root, configuration.ApplicationAudience) ||
                !ClaimEquals(root, "email", configuration.AllowedEmail, StringComparison.OrdinalIgnoreCase) ||
                !root.TryGetProperty("sub", out var sub) || sub.ValueKind != JsonValueKind.String ||
                string.IsNullOrWhiteSpace(sub.GetString()) || sub.GetString()!.Length > 512)
                return false;

            var now = _timeProvider.GetUtcNow();
            if (!TryNumericDate(root, "exp", out var expires) || now - ClockSkew >= expires) return false;
            if (root.TryGetProperty("nbf", out _) && (!TryNumericDate(root, "nbf", out var notBefore) || now + ClockSkew < notBefore))
                return false;
            if (root.TryGetProperty("iat", out _) && (!TryNumericDate(root, "iat", out var issuedAt) || issuedAt > now + TimeSpan.FromMinutes(5)))
                return false;
            return true;
        }
        catch { return false; }
    }

    private static bool ClaimEquals(JsonElement root, string name, string expected, StringComparison comparison)
        => root.TryGetProperty(name, out var node) && node.ValueKind == JsonValueKind.String &&
            string.Equals(node.GetString(), expected, comparison);

    private static bool AudienceContains(JsonElement root, string expected)
    {
        if (!root.TryGetProperty("aud", out var audience)) return false;
        if (audience.ValueKind == JsonValueKind.String)
            return string.Equals(audience.GetString(), expected, StringComparison.Ordinal);
        if (audience.ValueKind != JsonValueKind.Array) return false;
        var values = audience.EnumerateArray().ToArray();
        return values.Length is >= 1 and <= 16 && values.All(value => value.ValueKind == JsonValueKind.String) &&
            values.Any(value => string.Equals(value.GetString(), expected, StringComparison.Ordinal));
    }

    private static bool TryNumericDate(JsonElement root, string name, out DateTimeOffset value)
    {
        value = default;
        if (!root.TryGetProperty(name, out var node) || node.ValueKind != JsonValueKind.Number || !node.TryGetInt64(out var seconds))
            return false;
        try { value = DateTimeOffset.FromUnixTimeSeconds(seconds); return true; }
        catch { return false; }
    }

    private static bool HasDuplicateProperties(JsonElement element)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        return element.EnumerateObject().Any(property => !names.Add(property.Name));
    }

    private static byte[] DecodeBase64Url(string value, int maximumDecodedBytes)
    {
        if (value.Length > ((maximumDecodedBytes + 2) / 3 * 4))
            throw new FormatException();
        var normalized = value.Replace('-', '+').Replace('_', '/');
        normalized += (normalized.Length % 4) switch { 0 => "", 2 => "==", 3 => "=", _ => throw new FormatException() };
        var decoded = Convert.FromBase64String(normalized);
        if (decoded.Length > maximumDecodedBytes) throw new FormatException();
        return decoded;
    }

    private static JsonDocumentOptions StrictOptions(int depth) => new()
    {
        AllowTrailingCommas = false,
        CommentHandling = JsonCommentHandling.Disallow,
        MaxDepth = depth,
    };
}

internal sealed class CloudflareJwksProvider(HttpClient httpClient, AgentConfiguration configuration) : ICloudflareJwksProvider
{
    private readonly SemaphoreSlim _refreshLock = new(1, 1);
    private IReadOnlyDictionary<string, RSAParameters> _cached = new Dictionary<string, RSAParameters>();
    private DateTimeOffset _expiresAtUtc;

    public async Task<IReadOnlyDictionary<string, RSAParameters>> GetKeysAsync(bool forceRefresh, CancellationToken cancellationToken)
    {
        if (!forceRefresh && _cached.Count > 0 && DateTimeOffset.UtcNow < _expiresAtUtc) return _cached;
        await _refreshLock.WaitAsync(cancellationToken);
        try
        {
            if (!forceRefresh && _cached.Count > 0 && DateTimeOffset.UtcNow < _expiresAtUtc) return _cached;
            using var request = new HttpRequestMessage(HttpMethod.Get, configuration.JwksUri);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            using var response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!response.IsSuccessStatusCode) throw new InvalidOperationException("jwks_unavailable");
            var declaredLength = response.Content.Headers.ContentLength;
            if (declaredLength is > 65_536) throw new InvalidOperationException("jwks_too_large");
            var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
            if (bytes.Length is <= 0 or > 65_536) throw new InvalidOperationException("jwks_size_invalid");
            var parsed = ParseKeys(bytes);
            _cached = parsed;
            _expiresAtUtc = DateTimeOffset.UtcNow.AddHours(1);
            return _cached;
        }
        finally { _refreshLock.Release(); }
    }

    internal static IReadOnlyDictionary<string, RSAParameters> ParseKeys(ReadOnlySpan<byte> json)
    {
        using var document = JsonDocument.Parse(json.ToArray(), new JsonDocumentOptions { MaxDepth = 8 });
        if (document.RootElement.ValueKind != JsonValueKind.Object ||
            !document.RootElement.TryGetProperty("keys", out var keysNode) || keysNode.ValueKind != JsonValueKind.Array)
            throw new InvalidOperationException("jwks_shape_invalid");
        var entries = keysNode.EnumerateArray().ToArray();
        if (entries.Length is < 1 or > 32) throw new InvalidOperationException("jwks_count_invalid");
        var keys = new Dictionary<string, RSAParameters>(StringComparer.Ordinal);
        foreach (var entry in entries)
        {
            if (entry.ValueKind != JsonValueKind.Object ||
                !StringProperty(entry, "kty", out var kty) || kty != "RSA" ||
                !StringProperty(entry, "kid", out var kid) || string.IsNullOrEmpty(kid) || kid.Length > 128 ||
                !StringProperty(entry, "n", out var modulusText) ||
                !StringProperty(entry, "e", out var exponentText))
                continue;
            if (entry.TryGetProperty("alg", out var alg) && (alg.ValueKind != JsonValueKind.String || alg.GetString() != "RS256"))
                continue;
            if (entry.TryGetProperty("use", out var use) && (use.ValueKind != JsonValueKind.String || use.GetString() != "sig"))
                continue;
            byte[] modulus;
            byte[] exponent;
            try
            {
                modulus = DecodeJwkPart(modulusText, 512);
                exponent = DecodeJwkPart(exponentText, 8);
            }
            catch { continue; }
            if (modulus.Length is < 256 or > 512 || exponent.Length is < 1 or > 8 || !keys.TryAdd(kid, new RSAParameters
                {
                    Modulus = modulus,
                    Exponent = exponent,
                }))
                continue;
        }
        if (keys.Count == 0) throw new InvalidOperationException("jwks_no_supported_keys");
        return keys;
    }

    private static bool StringProperty(JsonElement element, string name, out string value)
    {
        value = string.Empty;
        if (!element.TryGetProperty(name, out var node) || node.ValueKind != JsonValueKind.String) return false;
        value = node.GetString() ?? string.Empty;
        return true;
    }

    private static byte[] DecodeJwkPart(string value, int maximum)
    {
        var normalized = value.Replace('-', '+').Replace('_', '/');
        normalized += (normalized.Length % 4) switch { 0 => "", 2 => "==", 3 => "=", _ => throw new FormatException() };
        var bytes = Convert.FromBase64String(normalized);
        if (bytes.Length > maximum) throw new FormatException();
        return bytes;
    }
}
