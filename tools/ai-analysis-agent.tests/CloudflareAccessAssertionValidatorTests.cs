using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MinimalistAIAnalysis.Agent;

namespace MinimalistAIAnalysis.Agent.Tests;

public sealed class CloudflareAccessAssertionValidatorTests : IDisposable
{
    private readonly RSA _rsa = RSA.Create(2048);
    private readonly DateTimeOffset _now = DateTimeOffset.Parse("2026-07-14T20:00:00Z");
    private readonly AgentConfiguration _configuration = new(
        "C:\\fixture",
        "C:\\fixture\\remote-analysis-agent.json",
        new Uri("https://minimalist-team.cloudflareaccess.com"),
        "abcdefghijklmnop1234567890_-",
        "owner@example.com");

    [Fact]
    public async Task IsAuthorizedAsync_AcceptsValidSignedUserAssertion()
    {
        var validator = CreateValidator();
        var token = Sign(new
        {
            iss = _configuration.ExpectedIssuer,
            aud = new[] { _configuration.ApplicationAudience },
            email = "Owner@Example.com",
            sub = "cloudflare-user-subject",
            iat = _now.ToUnixTimeSeconds(),
            nbf = _now.AddMinutes(-1).ToUnixTimeSeconds(),
            exp = _now.AddMinutes(10).ToUnixTimeSeconds(),
        });

        Assert.True(await validator.IsAuthorizedAsync(token, CancellationToken.None));
    }

    [Theory]
    [InlineData("intruder@example.com", "abcdefghijklmnop1234567890_-")]
    [InlineData("owner@example.com", "wrong-audience-value")]
    public async Task IsAuthorizedAsync_RejectsWrongIdentityOrAudience(string email, string audience)
    {
        var validator = CreateValidator();
        var token = Sign(new
        {
            iss = _configuration.ExpectedIssuer,
            aud = audience,
            email,
            sub = "cloudflare-user-subject",
            exp = _now.AddMinutes(10).ToUnixTimeSeconds(),
        });

        Assert.False(await validator.IsAuthorizedAsync(token, CancellationToken.None));
    }

    [Fact]
    public async Task IsAuthorizedAsync_RejectsExpiredAssertion()
    {
        var validator = CreateValidator();
        var token = Sign(new
        {
            iss = _configuration.ExpectedIssuer,
            aud = _configuration.ApplicationAudience,
            email = _configuration.AllowedEmail,
            sub = "cloudflare-user-subject",
            exp = _now.AddMinutes(-1).ToUnixTimeSeconds(),
        });

        Assert.False(await validator.IsAuthorizedAsync(token, CancellationToken.None));
    }

    [Fact]
    public async Task IsAuthorizedAsync_RejectsTamperingAndMalformedTokens()
    {
        var validator = CreateValidator();
        var valid = Sign(new
        {
            iss = _configuration.ExpectedIssuer,
            aud = _configuration.ApplicationAudience,
            email = _configuration.AllowedEmail,
            sub = "cloudflare-user-subject",
            exp = _now.AddMinutes(10).ToUnixTimeSeconds(),
        });
        var segments = valid.Split('.');
        var tamperedPayload = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new
        {
            iss = _configuration.ExpectedIssuer,
            aud = _configuration.ApplicationAudience,
            email = "intruder@example.com",
            sub = "cloudflare-user-subject",
            exp = _now.AddMinutes(10).ToUnixTimeSeconds(),
        }));

        Assert.False(await validator.IsAuthorizedAsync($"{segments[0]}.{tamperedPayload}.{segments[2]}", CancellationToken.None));
        Assert.False(await validator.IsAuthorizedAsync("not-a-jwt", CancellationToken.None));
        Assert.False(await validator.IsAuthorizedAsync(string.Empty, CancellationToken.None));
    }

    [Fact]
    public void JwksParser_AcceptsRsaSigningKeyAndRejectsNoSupportedKeys()
    {
        var parameters = _rsa.ExportParameters(false);
        var json = JsonSerializer.SerializeToUtf8Bytes(new
        {
            keys = new[]
            {
                new
                {
                    kty = "RSA",
                    kid = "fixture-key",
                    alg = "RS256",
                    use = "sig",
                    n = Base64Url(parameters.Modulus!),
                    e = Base64Url(parameters.Exponent!),
                },
            },
        });

        var keys = CloudflareJwksProvider.ParseKeys(json);
        Assert.True(keys.ContainsKey("fixture-key"));
        Assert.Throws<InvalidOperationException>(() =>
            CloudflareJwksProvider.ParseKeys("{\"keys\":[{\"kty\":\"EC\"}]}"u8));
    }

    public void Dispose() => _rsa.Dispose();

    private CloudflareAccessAssertionValidator CreateValidator()
        => new(
            _configuration,
            new FixtureKeys(new Dictionary<string, RSAParameters>(StringComparer.Ordinal)
            {
                ["fixture-key"] = _rsa.ExportParameters(false),
            }),
            new FixedTimeProvider(_now));

    private string Sign(object payload)
    {
        var header = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new { alg = "RS256", kid = "fixture-key", typ = "JWT" }));
        var body = Base64Url(JsonSerializer.SerializeToUtf8Bytes(payload));
        var signed = Encoding.ASCII.GetBytes($"{header}.{body}");
        var signature = _rsa.SignData(signed, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        return $"{header}.{body}.{Base64Url(signature)}";
    }

    private static string Base64Url(byte[] value)
        => Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private sealed class FixtureKeys(IReadOnlyDictionary<string, RSAParameters> keys) : ICloudflareJwksProvider
    {
        public Task<IReadOnlyDictionary<string, RSAParameters>> GetKeysAsync(bool forceRefresh, CancellationToken cancellationToken)
            => Task.FromResult(keys);
    }

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
