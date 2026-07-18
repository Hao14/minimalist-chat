using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MinimalistAIAnalysis;

internal sealed record RemoteAnalysisEndpointOptions(Uri Resource, Uri AccessTeamDomain)
{
    public static RemoteAnalysisEndpointOptions Default { get; } = new(
        new Uri("https://analysis.minimalist.chat", UriKind.Absolute),
        new Uri("https://hotsauce.cloudflareaccess.com", UriKind.Absolute));

    public static RemoteAnalysisEndpointOptions FromEnvironment()
    {
        var resource = Environment.GetEnvironmentVariable("MINIMALIST_ANALYSIS_REMOTE_ORIGIN");
        var team = Environment.GetEnvironmentVariable("MINIMALIST_ANALYSIS_ACCESS_TEAM_DOMAIN");
        return new RemoteAnalysisEndpointOptions(
            string.IsNullOrWhiteSpace(resource) ? Default.Resource : RequireAbsoluteUri(resource, "MINIMALIST_ANALYSIS_REMOTE_ORIGIN"),
            string.IsNullOrWhiteSpace(team) ? Default.AccessTeamDomain : RequireAbsoluteUri(team, "MINIMALIST_ANALYSIS_ACCESS_TEAM_DOMAIN"))
            .Validate();
    }

    public RemoteAnalysisEndpointOptions Validate()
    {
        ValidateBaseUri(Resource, "Remote Analysis origin");
        ValidateBaseUri(AccessTeamDomain, "Cloudflare Access team domain");
        if (!AccessTeamDomain.Host.EndsWith(".cloudflareaccess.com", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("The Access team domain is not a Cloudflare Access hostname.", nameof(AccessTeamDomain));
        return this;
    }

    private static void ValidateBaseUri(Uri value, string label)
    {
        if (!value.IsAbsoluteUri || value.Scheme != Uri.UriSchemeHttps || !value.IsDefaultPort ||
            !string.IsNullOrEmpty(value.UserInfo) || value.AbsolutePath != "/" ||
            !string.IsNullOrEmpty(value.Query) || !string.IsNullOrEmpty(value.Fragment))
            throw new ArgumentException($"{label} must be a bare HTTPS origin.");
    }

    private static Uri RequireAbsoluteUri(string value, string variableName)
        => Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)
            ? uri
            : throw new ArgumentException($"{variableName} is not a valid absolute URI.");
}

internal sealed class RemoteAuthenticationRequiredException(string message) : InvalidOperationException(message);
internal sealed class RemoteProtocolException(string message) : InvalidOperationException(message);

internal sealed record StoredRemoteOAuthSession(string ClientId, string RefreshToken);

internal interface IRemoteOAuthSessionStore
{
    StoredRemoteOAuthSession? Load();
    void Save(StoredRemoteOAuthSession session);
    void Clear();
}

internal interface IRemoteDataProtector
{
    byte[] Protect(byte[] plaintext);
    byte[] Unprotect(byte[] ciphertext);
}

internal sealed class WindowsDpapiProtector : IRemoteDataProtector
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("MinimalistAIAnalysis.RemoteOAuth.v1");

    public byte[] Protect(byte[] plaintext)
        => ProtectedData.Protect(plaintext, Entropy, DataProtectionScope.CurrentUser);

    public byte[] Unprotect(byte[] ciphertext)
        => ProtectedData.Unprotect(ciphertext, Entropy, DataProtectionScope.CurrentUser);
}

internal sealed class DpapiRemoteOAuthSessionStore : IRemoteOAuthSessionStore
{
    private const int MaximumFileBytes = 64 * 1024;
    private readonly string _path;
    private readonly IRemoteDataProtector _protector;

    public DpapiRemoteOAuthSessionStore(string? path = null, IRemoteDataProtector? protector = null)
    {
        _path = path ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "MinimalistAIAnalysis",
            "remote-oauth-session.dat");
        _protector = protector ?? new WindowsDpapiProtector();
    }

    public StoredRemoteOAuthSession? Load()
    {
        byte[]? protectedBytes = null;
        byte[]? plaintext = null;
        try
        {
            var info = new FileInfo(_path);
            if (!info.Exists) return null;
            if (info.Length is <= 0 or > MaximumFileBytes) throw new RemoteProtocolException("The saved remote sign-in is invalid.");
            protectedBytes = File.ReadAllBytes(_path);
            plaintext = _protector.Unprotect(protectedBytes);
            if (plaintext.Length is <= 0 or > MaximumFileBytes) throw new RemoteProtocolException("The saved remote sign-in is invalid.");
            using var document = JsonDocument.Parse(plaintext, StrictJson(6));
            var root = document.RootElement;
            if (!HasExactProperties(root, "schemaVersion", "clientId", "refreshToken") ||
                root.GetProperty("schemaVersion").ValueKind != JsonValueKind.Number ||
                !root.GetProperty("schemaVersion").TryGetInt32(out var version) || version != 1)
                throw new RemoteProtocolException("The saved remote sign-in is invalid.");
            var clientId = RequiredString(root, "clientId", 1024);
            var refreshToken = RequiredString(root, "refreshToken", 32_768);
            return new StoredRemoteOAuthSession(clientId, refreshToken);
        }
        catch (FileNotFoundException) { return null; }
        catch (DirectoryNotFoundException) { return null; }
        catch (RemoteProtocolException) { throw; }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or CryptographicException or JsonException)
        {
            throw new RemoteProtocolException("The saved remote sign-in could not be read.");
        }
        finally
        {
            if (protectedBytes is not null) CryptographicOperations.ZeroMemory(protectedBytes);
            if (plaintext is not null) CryptographicOperations.ZeroMemory(plaintext);
        }
    }

    public void Save(StoredRemoteOAuthSession session)
    {
        ValidateCredential(session.ClientId, nameof(session.ClientId), 1024);
        ValidateCredential(session.RefreshToken, nameof(session.RefreshToken), 32_768);
        var directory = Path.GetDirectoryName(_path) ?? throw new InvalidOperationException("Remote credential path is invalid.");
        Directory.CreateDirectory(directory);
        var pending = $"{_path}.{Guid.NewGuid():N}.tmp";
        byte[]? plaintext = null;
        byte[]? protectedBytes = null;
        try
        {
            plaintext = JsonSerializer.SerializeToUtf8Bytes(new
            {
                schemaVersion = 1,
                clientId = session.ClientId,
                refreshToken = session.RefreshToken,
            });
            protectedBytes = _protector.Protect(plaintext);
            File.WriteAllBytes(pending, protectedBytes);
            File.Move(pending, _path, true);
        }
        finally
        {
            try { if (File.Exists(pending)) File.Delete(pending); } catch { }
            if (plaintext is not null) CryptographicOperations.ZeroMemory(plaintext);
            if (protectedBytes is not null) CryptographicOperations.ZeroMemory(protectedBytes);
        }
    }

    public void Clear()
    {
        try { if (File.Exists(_path)) File.Delete(_path); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new InvalidOperationException("The saved remote sign-in could not be removed.");
        }
    }

    private static void ValidateCredential(string value, string parameterName, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > maximumLength || value.Any(char.IsControl))
            throw new ArgumentException("OAuth credential has an invalid format.", parameterName);
    }

    internal static JsonDocumentOptions StrictJson(int maxDepth) => new()
    {
        AllowTrailingCommas = false,
        CommentHandling = JsonCommentHandling.Disallow,
        MaxDepth = maxDepth,
    };

    internal static bool HasExactProperties(JsonElement element, params string[] expected)
    {
        if (element.ValueKind != JsonValueKind.Object) return false;
        var names = element.EnumerateObject().Select(property => property.Name).ToArray();
        return names.Length == expected.Length &&
            names.Distinct(StringComparer.Ordinal).Count() == names.Length &&
            names.All(expected.Contains);
    }

    internal static string RequiredString(JsonElement parent, string propertyName, int maximumLength)
    {
        if (!parent.TryGetProperty(propertyName, out var value) || value.ValueKind != JsonValueKind.String)
            throw new RemoteProtocolException("The remote service returned an invalid response.");
        var text = value.GetString();
        if (string.IsNullOrWhiteSpace(text) || text.Length > maximumLength || text.Any(char.IsControl))
            throw new RemoteProtocolException("The remote service returned an invalid response.");
        return text;
    }
}

internal sealed record OAuthCallbackResult(string? Code, string? State, string? Error);

internal interface IOAuthCallbackReceiver : IAsyncDisposable
{
    Uri RedirectUri { get; }
    Task<OAuthCallbackResult> WaitForCallbackAsync(CancellationToken cancellationToken);
}

internal interface IOAuthCallbackReceiverFactory
{
    IOAuthCallbackReceiver Create();
}

internal interface ISystemBrowser
{
    void Open(Uri uri);
}

internal sealed class SystemBrowser : ISystemBrowser
{
    public void Open(Uri uri)
        => Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
}

internal sealed class LoopbackOAuthCallbackReceiverFactory : IOAuthCallbackReceiverFactory
{
    public IOAuthCallbackReceiver Create() => new LoopbackOAuthCallbackReceiver();
}

internal sealed class LoopbackOAuthCallbackReceiver : IOAuthCallbackReceiver
{
    private const int MaximumHeaders = 16 * 1024;
    private readonly TcpListener _listener;
    private bool _disposed;

    public LoopbackOAuthCallbackReceiver()
    {
        _listener = new TcpListener(IPAddress.Loopback, 0);
        _listener.Server.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ExclusiveAddressUse, true);
        _listener.Start(1);
        var endpoint = (IPEndPoint)_listener.LocalEndpoint;
        RedirectUri = new Uri($"http://127.0.0.1:{endpoint.Port}/callback", UriKind.Absolute);
    }

    public Uri RedirectUri { get; }

    public async Task<OAuthCallbackResult> WaitForCallbackAsync(CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(3));
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeout.Token);
        using var client = await _listener.AcceptTcpClientAsync(linked.Token);
        client.ReceiveTimeout = 10_000;
        client.SendTimeout = 10_000;
        await using var stream = client.GetStream();
        OAuthCallbackResult result;
        try
        {
            var request = await ReadHeadersAsync(stream, linked.Token);
            result = ParseCallbackRequest(request);
            await WriteBrowserResponseAsync(stream, result.Error is null && result.Code is not null, linked.Token);
        }
        catch
        {
            try { await WriteBrowserResponseAsync(stream, false, CancellationToken.None); } catch { }
            throw;
        }
        return result;
    }

    public ValueTask DisposeAsync()
    {
        if (_disposed) return ValueTask.CompletedTask;
        _disposed = true;
        _listener.Stop();
        return ValueTask.CompletedTask;
    }

    private static async Task<string> ReadHeadersAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        var buffer = new byte[1024];
        using var memory = new MemoryStream();
        while (memory.Length < MaximumHeaders)
        {
            var read = await stream.ReadAsync(buffer, cancellationToken);
            if (read == 0) break;
            memory.Write(buffer, 0, read);
            var bytes = memory.GetBuffer().AsSpan(0, checked((int)memory.Length));
            if (bytes.IndexOf("\r\n\r\n"u8) >= 0)
                return Encoding.ASCII.GetString(bytes);
        }
        throw new RemoteProtocolException("The browser sign-in callback was invalid.");
    }

    internal static OAuthCallbackResult ParseCallbackRequest(string request)
    {
        var firstLineEnd = request.IndexOf("\r\n", StringComparison.Ordinal);
        var firstLine = firstLineEnd >= 0 ? request[..firstLineEnd] : request;
        var parts = firstLine.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 3 || !string.Equals(parts[0], "GET", StringComparison.Ordinal) ||
            !parts[2].StartsWith("HTTP/1.", StringComparison.Ordinal))
            throw new RemoteProtocolException("The browser sign-in callback was invalid.");
        if (parts[1].Length > 8192 || !Uri.TryCreate($"http://127.0.0.1{parts[1]}", UriKind.Absolute, out var requestUri) ||
            !string.Equals(requestUri.AbsolutePath, "/callback", StringComparison.Ordinal))
            throw new RemoteProtocolException("The browser sign-in callback was invalid.");
        var query = ParseQuery(requestUri.Query);
        query.TryGetValue("code", out var code);
        query.TryGetValue("state", out var state);
        query.TryGetValue("error", out var error);
        return new OAuthCallbackResult(Empty(code), Empty(state), Empty(error));
    }

    private static Dictionary<string, string> ParseQuery(string raw)
    {
        var output = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var part in raw.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var separator = part.IndexOf('=');
            var rawName = separator < 0 ? part : part[..separator];
            var rawValue = separator < 0 ? "" : part[(separator + 1)..];
            string name;
            string value;
            try
            {
                name = Uri.UnescapeDataString(rawName.Replace('+', ' '));
                value = Uri.UnescapeDataString(rawValue.Replace('+', ' '));
            }
            catch (UriFormatException)
            {
                throw new RemoteProtocolException("The browser sign-in callback was invalid.");
            }
            if (name.Length is 0 or > 128 || value.Length > 8192 || !output.TryAdd(name, value))
                throw new RemoteProtocolException("The browser sign-in callback was invalid.");
        }
        return output;
    }

    private static async Task WriteBrowserResponseAsync(Stream stream, bool success, CancellationToken cancellationToken)
    {
        var title = success ? "Sign-in complete" : "Sign-in was not completed";
        var copy = success ? "You can close this window and return to Minimalist Analysis." : "Return to Minimalist Analysis and try again.";
        var body = $"<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><title>{title}</title><style>body{{font:16px system-ui;margin:4rem;max-width:38rem;color:#17171a}}h1{{font-size:1.6rem}}</style><h1>{title}</h1><p>{copy}</p>";
        var bodyBytes = Encoding.UTF8.GetBytes(body);
        var headers = Encoding.ASCII.GetBytes(
            "HTTP/1.1 200 OK\r\n" +
            "Content-Type: text/html; charset=utf-8\r\n" +
            $"Content-Length: {bodyBytes.Length}\r\n" +
            "Cache-Control: no-store\r\n" +
            "Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\n" +
            "X-Content-Type-Options: nosniff\r\n" +
            "Connection: close\r\n\r\n");
        await stream.WriteAsync(headers, cancellationToken);
        await stream.WriteAsync(bodyBytes, cancellationToken);
        await stream.FlushAsync(cancellationToken);
    }

    private static string? Empty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;
}

internal sealed record OAuthServerMetadata(Uri Issuer, Uri AuthorizationEndpoint, Uri TokenEndpoint, Uri RegistrationEndpoint);
internal sealed record OAuthTokenResult(string AccessToken, string RefreshToken, DateTimeOffset ExpiresAtUtc);

internal sealed class ManagedOAuthClient
{
    private const int MaximumOAuthResponseBytes = 256 * 1024;
    private readonly RemoteAnalysisEndpointOptions _options;
    private readonly HttpClient _http;
    private readonly IRemoteOAuthSessionStore _store;
    private readonly ISystemBrowser _browser;
    private readonly IOAuthCallbackReceiverFactory _callbackFactory;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private OAuthServerMetadata? _metadata;
    private string? _accessToken;
    private DateTimeOffset _accessTokenExpiresAtUtc;

    public ManagedOAuthClient(
        RemoteAnalysisEndpointOptions options,
        HttpClient http,
        IRemoteOAuthSessionStore store,
        ISystemBrowser browser,
        IOAuthCallbackReceiverFactory callbackFactory)
    {
        _options = options.Validate();
        _http = http;
        _store = store;
        _browser = browser;
        _callbackFactory = callbackFactory;
    }

    public bool HasStoredSession
    {
        get
        {
            try { return _store.Load() is not null; }
            catch { return false; }
        }
    }

    public async Task SignInAsync(CancellationToken cancellationToken = default)
    {
        await _lock.WaitAsync(cancellationToken);
        try
        {
            var metadata = await GetMetadataAsync(cancellationToken);
            await using var callback = _callbackFactory.Create();
            var clientId = await RegisterClientAsync(metadata, callback.RedirectUri, cancellationToken);
            var verifier = RandomUrlToken(64);
            var state = RandomUrlToken(32);
            var challenge = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
            var authorizationUri = BuildUri(metadata.AuthorizationEndpoint, new Dictionary<string, string>
            {
                ["response_type"] = "code",
                ["client_id"] = clientId,
                ["redirect_uri"] = callback.RedirectUri.AbsoluteUri,
                ["state"] = state,
                ["code_challenge"] = challenge,
                ["code_challenge_method"] = "S256",
                ["resource"] = _options.Resource.AbsoluteUri.TrimEnd('/'),
            });
            _browser.Open(authorizationUri);
            var result = await callback.WaitForCallbackAsync(cancellationToken);
            if (!FixedTimeEquals(state, result.State))
                throw new RemoteProtocolException("The browser sign-in callback did not match this request.");
            if (!string.IsNullOrEmpty(result.Error))
                throw new RemoteAuthenticationRequiredException("Cloudflare Access sign-in was not approved.");
            if (string.IsNullOrWhiteSpace(result.Code) || result.Code.Length > 8192)
                throw new RemoteProtocolException("The browser sign-in callback did not match this request.");

            var token = await RequestTokenAsync(metadata.TokenEndpoint, new Dictionary<string, string>
            {
                ["grant_type"] = "authorization_code",
                ["client_id"] = clientId,
                ["code"] = result.Code,
                ["redirect_uri"] = callback.RedirectUri.AbsoluteUri,
                ["code_verifier"] = verifier,
                ["resource"] = _options.Resource.AbsoluteUri.TrimEnd('/'),
            }, previousRefreshToken: null, cancellationToken);
            _store.Save(new StoredRemoteOAuthSession(clientId, token.RefreshToken));
            SetAccessToken(token);
        }
        finally { _lock.Release(); }
    }

    public async Task<string> GetAccessTokenAsync(CancellationToken cancellationToken = default)
    {
        await _lock.WaitAsync(cancellationToken);
        try
        {
            if (_accessToken is not null && _accessTokenExpiresAtUtc > DateTimeOffset.UtcNow.AddSeconds(45))
                return _accessToken;
            var session = _store.Load() ?? throw new RemoteAuthenticationRequiredException("Choose Remote and sign in with Cloudflare Access.");
            var metadata = await GetMetadataAsync(cancellationToken);
            try
            {
                var token = await RequestTokenAsync(metadata.TokenEndpoint, new Dictionary<string, string>
                {
                    ["grant_type"] = "refresh_token",
                    ["client_id"] = session.ClientId,
                    ["refresh_token"] = session.RefreshToken,
                    ["resource"] = _options.Resource.AbsoluteUri.TrimEnd('/'),
                }, session.RefreshToken, cancellationToken);
                _store.Save(new StoredRemoteOAuthSession(session.ClientId, token.RefreshToken));
                SetAccessToken(token);
                return token.AccessToken;
            }
            catch (RemoteAuthenticationRequiredException)
            {
                ClearSessionCore();
                throw;
            }
        }
        finally { _lock.Release(); }
    }

    public void InvalidateAccessToken()
    {
        _accessToken = null;
        _accessTokenExpiresAtUtc = default;
    }

    public void SignOut() => ClearSessionCore();

    private void ClearSessionCore()
    {
        InvalidateAccessToken();
        _store.Clear();
    }

    private void SetAccessToken(OAuthTokenResult token)
    {
        _accessToken = token.AccessToken;
        _accessTokenExpiresAtUtc = token.ExpiresAtUtc;
    }

    private async Task<OAuthServerMetadata> GetMetadataAsync(CancellationToken cancellationToken)
    {
        if (_metadata is not null) return _metadata;
        var discovery = new Uri(_options.Resource, "/.well-known/oauth-authorization-server");
        using var request = new HttpRequestMessage(HttpMethod.Get, discovery);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (IsRedirect(response.StatusCode)) throw new RemoteProtocolException("Cloudflare OAuth discovery returned an unexpected redirect.");
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Cloudflare OAuth discovery is unavailable.");
        var bytes = await ReadBoundedAsync(response, MaximumOAuthResponseBytes, cancellationToken);
        using var document = JsonDocument.Parse(bytes, DpapiRemoteOAuthSessionStore.StrictJson(12));
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
            throw new RemoteProtocolException("Cloudflare OAuth discovery returned an invalid response.");
        var issuer = RequireOAuthEndpoint(root, "issuer");
        var authorization = RequireOAuthEndpoint(root, "authorization_endpoint");
        var token = RequireOAuthEndpoint(root, "token_endpoint");
        var registration = RequireOAuthEndpoint(root, "registration_endpoint");
        _metadata = new OAuthServerMetadata(issuer, authorization, token, registration);
        return _metadata;
    }

    private async Task<string> RegisterClientAsync(OAuthServerMetadata metadata, Uri redirectUri, CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.Serialize(new
        {
            client_name = "Minimalist Analysis for Windows",
            application_type = "native",
            redirect_uris = new[] { redirectUri.AbsoluteUri },
            grant_types = new[] { "authorization_code", "refresh_token" },
            response_types = new[] { "code" },
            token_endpoint_auth_method = "none",
        });
        using var request = new HttpRequestMessage(HttpMethod.Post, metadata.RegistrationEndpoint)
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json"),
        };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (IsRedirect(response.StatusCode)) throw new RemoteProtocolException("Cloudflare client registration returned an unexpected redirect.");
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Cloudflare could not register this Analysis client.");
        var bytes = await ReadBoundedAsync(response, MaximumOAuthResponseBytes, cancellationToken);
        using var document = JsonDocument.Parse(bytes, DpapiRemoteOAuthSessionStore.StrictJson(8));
        var root = document.RootElement;
        var clientId = DpapiRemoteOAuthSessionStore.RequiredString(root, "client_id", 1024);
        if (root.TryGetProperty("client_secret", out var secret) && secret.ValueKind == JsonValueKind.String && !string.IsNullOrEmpty(secret.GetString()))
            throw new RemoteProtocolException("Cloudflare registered an unexpected confidential client.");
        return clientId;
    }

    private async Task<OAuthTokenResult> RequestTokenAsync(
        Uri tokenEndpoint,
        IReadOnlyDictionary<string, string> fields,
        string? previousRefreshToken,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, tokenEndpoint)
        {
            Content = new FormUrlEncodedContent(fields),
        };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (IsRedirect(response.StatusCode)) throw new RemoteProtocolException("Cloudflare token exchange returned an unexpected redirect.");
        if (!response.IsSuccessStatusCode)
        {
            if (response.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                throw new RemoteAuthenticationRequiredException("The remote sign-in expired. Sign in with Cloudflare Access again.");
            throw new InvalidOperationException("Cloudflare token exchange is unavailable.");
        }
        var bytes = await ReadBoundedAsync(response, MaximumOAuthResponseBytes, cancellationToken);
        using var document = JsonDocument.Parse(bytes, DpapiRemoteOAuthSessionStore.StrictJson(8));
        var root = document.RootElement;
        var access = DpapiRemoteOAuthSessionStore.RequiredString(root, "access_token", 32_768);
        var tokenType = DpapiRemoteOAuthSessionStore.RequiredString(root, "token_type", 64);
        if (!string.Equals(tokenType, "Bearer", StringComparison.OrdinalIgnoreCase))
            throw new RemoteProtocolException("Cloudflare returned an unsupported OAuth token type.");
        if (!root.TryGetProperty("expires_in", out var expiresNode) || !TryReadPositiveSeconds(expiresNode, out var expiresIn) || expiresIn > 86_400)
            throw new RemoteProtocolException("Cloudflare returned an invalid OAuth token lifetime.");
        var refresh = root.TryGetProperty("refresh_token", out var refreshNode) && refreshNode.ValueKind == JsonValueKind.String
            ? refreshNode.GetString()
            : previousRefreshToken;
        if (string.IsNullOrWhiteSpace(refresh) || refresh.Length > 32_768 || refresh.Any(char.IsControl))
            throw new RemoteProtocolException("Cloudflare did not return a valid refresh token.");
        return new OAuthTokenResult(access, refresh, DateTimeOffset.UtcNow.AddSeconds(expiresIn));
    }

    private Uri RequireOAuthEndpoint(JsonElement root, string propertyName)
    {
        var raw = DpapiRemoteOAuthSessionStore.RequiredString(root, propertyName, 4096);
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps || !uri.IsDefaultPort ||
            !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Fragment) ||
            (!string.Equals(uri.Host, _options.Resource.Host, StringComparison.OrdinalIgnoreCase) &&
             !string.Equals(uri.Host, _options.AccessTeamDomain.Host, StringComparison.OrdinalIgnoreCase)))
            throw new RemoteProtocolException("Cloudflare OAuth discovery returned an untrusted endpoint.");
        return uri;
    }

    internal static Uri BuildUri(Uri endpoint, IReadOnlyDictionary<string, string> fields)
    {
        var query = string.Join("&", fields.Select(pair =>
            $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value)}"));
        var builder = new UriBuilder(endpoint)
        {
            Query = string.IsNullOrEmpty(endpoint.Query) ? query : $"{endpoint.Query.TrimStart('?')}&{query}",
        };
        return builder.Uri;
    }

    private static bool FixedTimeEquals(string expected, string? actual)
    {
        if (actual is null) return false;
        var expectedBytes = Encoding.UTF8.GetBytes(expected);
        var actualBytes = Encoding.UTF8.GetBytes(actual);
        try { return expectedBytes.Length == actualBytes.Length && CryptographicOperations.FixedTimeEquals(expectedBytes, actualBytes); }
        finally
        {
            CryptographicOperations.ZeroMemory(expectedBytes);
            CryptographicOperations.ZeroMemory(actualBytes);
        }
    }

    private static string RandomUrlToken(int byteCount)
    {
        var bytes = RandomNumberGenerator.GetBytes(byteCount);
        try { return Base64Url(bytes); }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }

    private static string Base64Url(byte[] bytes)
        => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static bool TryReadPositiveSeconds(JsonElement value, out int seconds)
    {
        seconds = 0;
        if (value.ValueKind == JsonValueKind.Number) return value.TryGetInt32(out seconds) && seconds > 0;
        return value.ValueKind == JsonValueKind.String &&
            int.TryParse(value.GetString(), NumberStyles.None, CultureInfo.InvariantCulture, out seconds) && seconds > 0;
    }

    internal static bool IsRedirect(HttpStatusCode statusCode) => (int)statusCode is >= 300 and <= 399;

    internal static async Task<byte[]> ReadBoundedAsync(HttpResponseMessage response, int maximumBytes, CancellationToken cancellationToken)
    {
        if (response.Content.Headers.ContentLength is long declared && declared > maximumBytes)
            throw new RemoteProtocolException("The remote service response was too large.");
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var memory = new MemoryStream(Math.Min(maximumBytes, 16_384));
        var buffer = new byte[4096];
        while (true)
        {
            var read = await stream.ReadAsync(buffer, cancellationToken);
            if (read == 0) break;
            if (memory.Length + read > maximumBytes) throw new RemoteProtocolException("The remote service response was too large.");
            memory.Write(buffer, 0, read);
        }
        return memory.ToArray();
    }
}

internal sealed class RemoteAnalysisClient
{
    private const int MaximumAgentResponseBytes = 512 * 1024;
    private readonly RemoteAnalysisEndpointOptions _options;
    private readonly ManagedOAuthClient _oauth;
    private readonly HttpClient _http;

    public RemoteAnalysisClient()
    {
        _options = RemoteAnalysisEndpointOptions.FromEnvironment();
        _http = CreateHttpClient();
        _oauth = new ManagedOAuthClient(
            _options,
            _http,
            new DpapiRemoteOAuthSessionStore(),
            new SystemBrowser(),
            new LoopbackOAuthCallbackReceiverFactory());
    }

    internal RemoteAnalysisClient(RemoteAnalysisEndpointOptions options, ManagedOAuthClient oauth, HttpClient http)
    {
        _options = options.Validate();
        _oauth = oauth;
        _http = http;
    }

    public bool HasStoredSession => _oauth.HasStoredSession;
    public Uri Resource => _options.Resource;

    public Task SignInAsync(CancellationToken cancellationToken = default) => _oauth.SignInAsync(cancellationToken);

    public void SignOut() => _oauth.SignOut();

    public async Task<AnalysisSnapshot> LoadSnapshotAsync(CancellationToken cancellationToken = default)
    {
        using var pingResponse = await SendAuthenticatedAsync("/v1/ping", cancellationToken);
        var pingBytes = await RequireAgentResponseAsync(pingResponse, cancellationToken);
        _ = ValidatePing(pingBytes);

        using var snapshotResponse = await SendAuthenticatedAsync("/v1/snapshot", cancellationToken);
        var snapshotBytes = await RequireAgentResponseAsync(snapshotResponse, cancellationToken);
        return ParseSnapshot(snapshotBytes, _options.Resource) with
        {
            RemoteAgentReady = true,
            RemoteAgentState = "connected",
        };
    }

    private async Task<HttpResponseMessage> SendAuthenticatedAsync(string path, CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var accessToken = await _oauth.GetAccessTokenAsync(cancellationToken);
            using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(_options.Resource, path));
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (response.StatusCode != HttpStatusCode.Unauthorized || attempt == 1)
            {
                if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                {
                    try { _oauth.SignOut(); } catch { }
                }
                return response;
            }
            response.Dispose();
            _oauth.InvalidateAccessToken();
        }
        throw new RemoteAuthenticationRequiredException("The remote sign-in expired. Sign in again.");
    }

    private static async Task<byte[]> RequireAgentResponseAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (ManagedOAuthClient.IsRedirect(response.StatusCode))
            throw new RemoteProtocolException("The remote agent returned an unexpected redirect.");
        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            throw new RemoteAuthenticationRequiredException("Cloudflare Access did not authorize this remote Analysis session.");
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"The remote Analysis agent is unavailable ({(int)response.StatusCode}).");
        if (!response.Headers.TryGetValues("X-Minimalist-Analysis-Agent", out var markerValues) ||
            markerValues.Count() != 1 || !string.Equals(markerValues.Single(), "1", StringComparison.Ordinal))
            throw new RemoteProtocolException("The remote endpoint did not identify itself as the Minimalist Analysis agent.");
        if (response.Content.Headers.ContentType?.MediaType is not string mediaType ||
            !string.Equals(mediaType, "application/json", StringComparison.OrdinalIgnoreCase))
            throw new RemoteProtocolException("The remote agent returned an unsupported response type.");
        return await ManagedOAuthClient.ReadBoundedAsync(response, MaximumAgentResponseBytes, cancellationToken);
    }

    internal static string ValidatePing(byte[] json)
    {
        using var document = JsonDocument.Parse(json, DpapiRemoteOAuthSessionStore.StrictJson(6));
        var root = document.RootElement;
        if (!DpapiRemoteOAuthSessionStore.HasExactProperties(root, "schemaVersion", "status", "readOnly", "taskName") ||
            !TryInt(root, "schemaVersion", out var schema) || schema != 1 ||
            !TryString(root, "status", out var status) || status != "ok" ||
            !TryBool(root, "readOnly", out var readOnly) || !readOnly)
            throw new RemoteProtocolException("The remote agent ping contract is invalid.");
        var taskName = DpapiRemoteOAuthSessionStore.RequiredString(root, "taskName", 128);
        if (!string.Equals(taskName, AnalysisAppLogic.RemoteAnalysisAgentTaskName, StringComparison.Ordinal))
            throw new RemoteProtocolException("The remote agent task identity is invalid.");
        return taskName;
    }

    internal static AnalysisSnapshot ParseSnapshot(byte[] json, Uri resource)
    {
        using var document = JsonDocument.Parse(json, DpapiRemoteOAuthSessionStore.StrictJson(16));
        var root = document.RootElement;
        if (!DpapiRemoteOAuthSessionStore.HasExactProperties(
                root, "schemaVersion", "observedAtUtc", "agentVersion", "capabilities", "ai", "bridge", "tunnel", "recoveryTask", "warnings") ||
            !TryInt(root, "schemaVersion", out var schema) || schema != 1)
            throw new RemoteProtocolException("The remote snapshot contract is invalid.");

        _ = RequiredTimestamp(root, "observedAtUtc");
        _ = DpapiRemoteOAuthSessionStore.RequiredString(root, "agentVersion", 64);
        var capabilities = RequiredObject(root, "capabilities", "readOnly", "controlsAvailable");
        if (!TryBool(capabilities, "readOnly", out var readOnly) || !readOnly ||
            !TryBool(capabilities, "controlsAvailable", out var controlsAvailable) || controlsAvailable)
            throw new RemoteProtocolException("The remote agent did not enforce read-only capabilities.");

        var ai = RequiredObject(root, "ai", "mode", "idleMinutes", "ollamaState", "approvedModels", "lastActivityAtUtc", "activity");
        var mode = DpapiRemoteOAuthSessionStore.RequiredString(ai, "mode", 16);
        if (mode is not ("off" or "on" or "auto")) throw new RemoteProtocolException("The remote AI mode is invalid.");
        if (!TryInt(ai, "idleMinutes", out var idleMinutes) || idleMinutes is < 1 or > 1440)
            throw new RemoteProtocolException("The remote idle timeout is invalid.");
        var ollamaState = DpapiRemoteOAuthSessionStore.RequiredString(ai, "ollamaState", 32);
        if (ollamaState is not ("ready" or "sleeping_by_design" or "unavailable"))
            throw new RemoteProtocolException("The remote Ollama state is invalid.");
        var models = ParseModels(ai);
        var activity = ParseActivity(ai);
        var lastActivity = OptionalTimestamp(ai, "lastActivityAtUtc")?.LocalDateTime;

        var bridge = RequiredObject(root, "bridge", "ready", "identityVerified");
        if (!TryBool(bridge, "ready", out var bridgeReady) || !TryBool(bridge, "identityVerified", out var identityVerified))
            throw new RemoteProtocolException("The remote bridge state is invalid.");

        var tunnel = RequiredObject(root, "tunnel", "desiredOn", "state");
        if (!TryBool(tunnel, "desiredOn", out var tunnelDesiredOn))
            throw new RemoteProtocolException("The remote tunnel intent is invalid.");
        var tunnelState = DpapiRemoteOAuthSessionStore.RequiredString(tunnel, "state", 32);
        if (tunnelState is not ("off" or "healthy" or "recovering") ||
            (!tunnelDesiredOn && tunnelState != "off") || (tunnelDesiredOn && tunnelState == "off"))
            throw new RemoteProtocolException("The remote tunnel state is invalid.");

        var recovery = ParseRecoveryTask(root);
        var warnings = ParseWarnings(root);
        var warningText = warnings.Length == 0 ? null : string.Join("  •  ", warnings.Select(FriendlyWarning));
        var modelNames = models.Where(model => model.State == "ready").Select(model => model.Profile switch
        {
            "fast" => AnalysisAppLogic.ApprovedFastModel,
            "smart" => AnalysisAppLogic.ApprovedSmartModel,
            _ => AnalysisAppLogic.ApprovedVisionModel,
        }).ToArray();
        var modelsChecked = models.All(model => model.State != "not_checked");
        var platform = new PlatformSnapshot(0, 0, 0, 0, 0, [], [], DateTime.Now, null);
        return new AnalysisSnapshot(
            OllamaReady: ollamaState == "ready",
            BridgeReady: bridgeReady && identityVerified,
            TunnelReady: tunnelState == "healthy",
            TunnelDesiredOn: tunnelDesiredOn,
            RecoveryTask: recovery,
            PublicUrl: resource.AbsoluteUri.TrimEnd('/'),
            Mode: mode,
            IdleMinutes: idleMinutes,
            Models: modelNames,
            ModelsChecked: modelsChecked,
            LastActivity: lastActivity,
            Activity: activity,
            Platform: platform,
            Warning: warningText,
            ConnectionMode: AnalysisConnectionMode.Remote);
    }

    private sealed record ParsedModel(string Profile, string State);

    private static ParsedModel[] ParseModels(JsonElement ai)
    {
        if (!ai.TryGetProperty("approvedModels", out var modelsNode) || modelsNode.ValueKind != JsonValueKind.Array)
            throw new RemoteProtocolException("The remote approved-model state is invalid.");
        var models = modelsNode.EnumerateArray().Select(item =>
        {
            if (!DpapiRemoteOAuthSessionStore.HasExactProperties(item, "profile", "state"))
                throw new RemoteProtocolException("The remote approved-model state is invalid.");
            var profile = DpapiRemoteOAuthSessionStore.RequiredString(item, "profile", 16);
            var state = DpapiRemoteOAuthSessionStore.RequiredString(item, "state", 16);
            if (profile is not ("fast" or "smart" or "vision") || state is not ("ready" or "missing" or "not_checked"))
                throw new RemoteProtocolException("The remote approved-model state is invalid.");
            return new ParsedModel(profile, state);
        }).ToArray();
        if (models.Length != 3 || models.Select(model => model.Profile).Distinct(StringComparer.Ordinal).Count() != 3)
            throw new RemoteProtocolException("The remote approved-model state is incomplete.");
        return models;
    }

    private static ActivityEntry[] ParseActivity(JsonElement ai)
    {
        if (!ai.TryGetProperty("activity", out var activityNode) || activityNode.ValueKind != JsonValueKind.Array)
            throw new RemoteProtocolException("The remote activity state is invalid.");
        if (activityNode.GetArrayLength() > 40)
            throw new RemoteProtocolException("The remote activity state exceeded its read-only limit.");
        var output = new List<ActivityEntry>();
        foreach (var item in activityNode.EnumerateArray().Take(40))
        {
            if (!DpapiRemoteOAuthSessionStore.HasExactProperties(item, "timeUtc", "feature", "modelProfile", "durationMs", "result"))
                throw new RemoteProtocolException("The remote activity state is invalid.");
            var time = RequiredTimestamp(item, "timeUtc").LocalDateTime;
            var feature = DpapiRemoteOAuthSessionStore.RequiredString(item, "feature", 32) switch
            {
                "chat_completion" => "Chat completion",
                "generation" => "Generation",
                "ai_request" => "AI request",
                _ => throw new RemoteProtocolException("The remote activity feature is invalid."),
            };
            var profile = DpapiRemoteOAuthSessionStore.RequiredString(item, "modelProfile", 16) switch
            {
                "fast" => "Fast profile",
                "smart" => "Smart profile",
                "vision" => "Vision profile",
                "unknown" => "Approved profile",
                _ => throw new RemoteProtocolException("The remote activity model profile is invalid."),
            };
            if (!TryInt(item, "durationMs", out var duration) || duration is < 0 or > 900_000)
                throw new RemoteProtocolException("The remote activity duration is invalid.");
            var result = DpapiRemoteOAuthSessionStore.RequiredString(item, "result", 16);
            if (result is not ("success" or "error")) throw new RemoteProtocolException("The remote activity result is invalid.");
            output.Add(new ActivityEntry(time, feature, profile, duration, result));
        }
        return output.OrderByDescending(item => item.Time).ToArray();
    }

    private static RecoveryTaskSnapshot ParseRecoveryTask(JsonElement root)
    {
        var task = RequiredObject(root, "recoveryTask", "name", "installed", "enabled", "state", "lastResult", "lastRunAtUtc");
        var name = DpapiRemoteOAuthSessionStore.RequiredString(task, "name", 128);
        if (!string.Equals(name, AnalysisAppLogic.PublicGatewayRecoveryTaskName, StringComparison.Ordinal))
            throw new RemoteProtocolException("The remote recovery task name is invalid.");
        bool? installed = task.GetProperty("installed").ValueKind switch
        {
            JsonValueKind.Null => null,
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => throw new RemoteProtocolException("The remote recovery task state is invalid."),
        };
        if (!TryBool(task, "enabled", out var enabled)) throw new RemoteProtocolException("The remote recovery task state is invalid.");
        var state = DpapiRemoteOAuthSessionStore.RequiredString(task, "state", 32);
        var schedulerState = state switch
        {
            "disabled" => RecoveryTaskSchedulerState.Disabled,
            "queued" => RecoveryTaskSchedulerState.Queued,
            "ready" or "waiting" or "needs_attention" => RecoveryTaskSchedulerState.Ready,
            "running" => RecoveryTaskSchedulerState.Running,
            "not_installed" or "unavailable" => RecoveryTaskSchedulerState.Unknown,
            _ => throw new RemoteProtocolException("The remote recovery task state is invalid."),
        };
        uint? lastResult = null;
        var resultNode = task.GetProperty("lastResult");
        if (resultNode.ValueKind == JsonValueKind.String)
        {
            var raw = resultNode.GetString();
            if (raw is null || !raw.StartsWith("0x", StringComparison.Ordinal) ||
                !uint.TryParse(raw.AsSpan(2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var parsed))
                throw new RemoteProtocolException("The remote recovery task result is invalid.");
            lastResult = parsed;
        }
        else if (resultNode.ValueKind != JsonValueKind.Null)
            throw new RemoteProtocolException("The remote recovery task result is invalid.");
        return new RecoveryTaskSnapshot(
            name,
            installed,
            enabled,
            schedulerState,
            lastResult,
            OptionalTimestamp(task, "lastRunAtUtc")?.LocalDateTime,
            state == "unavailable" ? "Status unavailable" : null);
    }

    private static string[] ParseWarnings(JsonElement root)
    {
        if (!root.TryGetProperty("warnings", out var warningsNode) || warningsNode.ValueKind != JsonValueKind.Array)
            throw new RemoteProtocolException("The remote warning state is invalid.");
        if (warningsNode.GetArrayLength() > 8)
            throw new RemoteProtocolException("The remote warning state exceeded its read-only limit.");
        var allowed = new HashSet<string>(StringComparer.Ordinal)
        {
            "control_state_unavailable",
            "tunnel_intent_unavailable",
            "recovery_task_status_unavailable",
        };
        var warnings = warningsNode.EnumerateArray().Select(item =>
        {
            if (item.ValueKind != JsonValueKind.String || item.GetString() is not string value || !allowed.Contains(value))
                throw new RemoteProtocolException("The remote warning state is invalid.");
            return value;
        }).Take(8).Distinct(StringComparer.Ordinal).ToArray();
        return warnings;
    }

    private static string FriendlyWarning(string warning) => warning switch
    {
        "control_state_unavailable" => "Remote AI control metadata is unavailable",
        "tunnel_intent_unavailable" => "Remote tunnel intent is unavailable",
        _ => "Remote recovery task status is unavailable",
    };

    private static JsonElement RequiredObject(JsonElement parent, string name, params string[] properties)
    {
        if (!parent.TryGetProperty(name, out var value) || !DpapiRemoteOAuthSessionStore.HasExactProperties(value, properties))
            throw new RemoteProtocolException("The remote snapshot contract is invalid.");
        return value;
    }

    private static DateTimeOffset RequiredTimestamp(JsonElement parent, string name)
        => OptionalTimestamp(parent, name) ?? throw new RemoteProtocolException("The remote timestamp is invalid.");

    private static DateTimeOffset? OptionalTimestamp(JsonElement parent, string name)
    {
        if (!parent.TryGetProperty(name, out var value)) throw new RemoteProtocolException("The remote timestamp is missing.");
        if (value.ValueKind == JsonValueKind.Null) return null;
        if (value.ValueKind != JsonValueKind.String ||
            !DateTimeOffset.TryParse(value.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var timestamp) ||
            timestamp.Year is < 2020 or > 2100)
            throw new RemoteProtocolException("The remote timestamp is invalid.");
        return timestamp;
    }

    private static bool TryString(JsonElement parent, string name, out string? value)
    {
        value = null;
        if (!parent.TryGetProperty(name, out var node) || node.ValueKind != JsonValueKind.String) return false;
        value = node.GetString();
        return value is not null;
    }

    private static bool TryInt(JsonElement parent, string name, out int value)
    {
        value = 0;
        return parent.TryGetProperty(name, out var node) && node.ValueKind == JsonValueKind.Number && node.TryGetInt32(out value);
    }

    private static bool TryBool(JsonElement parent, string name, out bool value)
    {
        value = false;
        if (!parent.TryGetProperty(name, out var node) || node.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return false;
        value = node.GetBoolean();
        return true;
    }

    private static HttpClient CreateHttpClient()
        => new(new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
            ConnectTimeout = TimeSpan.FromSeconds(8),
            PooledConnectionLifetime = TimeSpan.FromMinutes(10),
            UseCookies = false,
        })
        {
            Timeout = TimeSpan.FromSeconds(20),
        };
}
