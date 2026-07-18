using System.Net;
using System.Text;
using System.Text.Json;
using MinimalistAIAnalysis;
using Xunit;

namespace MinimalistAIAnalysis.Tests;

public sealed class RemoteCapabilityPolicyTests
{
    [Theory]
    [InlineData("connected", "Connected · read-only", false)]
    [InlineData("running", "Running · localhost:8791", false)]
    [InlineData("stopped", "Installed · not running", true)]
    [InlineData("not_installed", "Not installed", true)]
    [InlineData("unavailable", "Status unavailable", true)]
    public void RemoteAgentState_UsesDistinctTaskStatus(string state, string expected, bool neutral)
    {
        Assert.Equal("Minimalist Chat Remote Analysis Agent", AnalysisAppLogic.RemoteAnalysisAgentTaskName);
        Assert.Equal(expected, AnalysisAppLogic.FormatRemoteAnalysisAgentState(state));
        Assert.Equal(neutral, AnalysisAppLogic.IsRemoteAnalysisAgentStateNeutral(state));
    }

    [Theory]
    [InlineData(AnalysisCapability.ViewOverview)]
    [InlineData(AnalysisCapability.ViewAiStatus)]
    [InlineData(AnalysisCapability.ViewHealth)]
    public void RemoteMode_AllowsOnlyReadOnlyStatus(AnalysisCapability capability)
        => Assert.True(AnalysisAppLogic.IsCapabilityAllowed(AnalysisConnectionMode.Remote, capability));

    [Theory]
    [InlineData(AnalysisCapability.ViewUsers)]
    [InlineData(AnalysisCapability.ChangeAiMode)]
    [InlineData(AnalysisCapability.InstallModels)]
    [InlineData(AnalysisCapability.ControlBridge)]
    [InlineData(AnalysisCapability.ControlTunnel)]
    [InlineData(AnalysisCapability.ReadLocalLogs)]
    [InlineData(AnalysisCapability.ChooseWorkspace)]
    [InlineData(AnalysisCapability.UseConsole)]
    [InlineData(AnalysisCapability.ModerateUsers)]
    public void RemoteMode_DeniesEveryPrivilegedCapability(AnalysisCapability capability)
        => Assert.False(AnalysisAppLogic.IsCapabilityAllowed(AnalysisConnectionMode.Remote, capability));

    [Theory]
    [InlineData(AnalysisCapability.ViewUsers)]
    [InlineData(AnalysisCapability.ControlTunnel)]
    [InlineData(AnalysisCapability.ModerateUsers)]
    public void LocalMode_RemainsAdministratorMode(AnalysisCapability capability)
        => Assert.True(AnalysisAppLogic.IsCapabilityAllowed(AnalysisConnectionMode.Local, capability));
}

public sealed class RemoteSessionStoreTests
{
    [Fact]
    public void EndpointDefaults_AreExactAndRejectNonCloudflareTeamHosts()
    {
        var defaults = RemoteAnalysisEndpointOptions.Default.Validate();
        Assert.Equal("https://analysis.minimalist.chat/", defaults.Resource.AbsoluteUri);
        Assert.Equal("https://hotsauce.cloudflareaccess.com/", defaults.AccessTeamDomain.AbsoluteUri);
        Assert.Throws<ArgumentException>(() => new RemoteAnalysisEndpointOptions(
            defaults.Resource,
            new Uri("https://evil.example")).Validate());
    }

    [Fact]
    public void DpapiStore_RoundTripsWithoutWritingTokensAsPlaintext()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"minimalist-analysis-test-{Guid.NewGuid():N}");
        var path = Path.Combine(directory, "remote-session.dat");
        try
        {
            var store = new DpapiRemoteOAuthSessionStore(path);
            var expected = new StoredRemoteOAuthSession("client-public-123", "refresh-super-secret-456");
            store.Save(expected);

            Assert.Equal(expected, store.Load());
            var diskText = Encoding.UTF8.GetString(File.ReadAllBytes(path));
            Assert.DoesNotContain(expected.ClientId, diskText, StringComparison.Ordinal);
            Assert.DoesNotContain(expected.RefreshToken, diskText, StringComparison.Ordinal);
            store.Clear();
            Assert.Null(store.Load());
        }
        finally
        {
            try { if (Directory.Exists(directory)) Directory.Delete(directory, true); } catch { }
        }
    }

    [Fact]
    public void SessionStore_RejectsUnprotectedOrMalformedPayload()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"minimalist-analysis-test-{Guid.NewGuid():N}");
        var path = Path.Combine(directory, "remote-session.dat");
        Directory.CreateDirectory(directory);
        try
        {
            File.WriteAllText(path, "{\"refreshToken\":\"plaintext\"}");
            var store = new DpapiRemoteOAuthSessionStore(path);
            Assert.Throws<RemoteProtocolException>(() => store.Load());
        }
        finally
        {
            try { Directory.Delete(directory, true); } catch { }
        }
    }
}

public sealed class OAuthCallbackTests
{
    [Fact]
    public async Task LoopbackReceiver_BindsEphemeralIpv4AndCompletesOneCallback()
    {
        await using var receiver = new LoopbackOAuthCallbackReceiver();
        Assert.Equal("127.0.0.1", receiver.RedirectUri.Host);
        Assert.True(receiver.RedirectUri.Port > 0);
        var wait = receiver.WaitForCallbackAsync(CancellationToken.None);
        using var http = new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false });
        using var response = await http.GetAsync(new Uri(receiver.RedirectUri + "?code=roundtrip&state=state-1"));
        var result = await wait;

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("roundtrip", result.Code);
        Assert.Equal("state-1", result.State);
    }

    [Fact]
    public void CallbackParser_ReadsCodeAndState()
    {
        var result = LoopbackOAuthCallbackReceiver.ParseCallbackRequest(
            "GET /callback?code=abc%20123&state=s-1 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        Assert.Equal("abc 123", result.Code);
        Assert.Equal("s-1", result.State);
        Assert.Null(result.Error);
    }

    [Theory]
    [InlineData("POST /callback?code=a&state=b HTTP/1.1\r\n\r\n")]
    [InlineData("GET /other?code=a&state=b HTTP/1.1\r\n\r\n")]
    [InlineData("GET /callback?code=a&state=b&state=c HTTP/1.1\r\n\r\n")]
    public void CallbackParser_RejectsUnexpectedRequest(string request)
        => Assert.Throws<RemoteProtocolException>(() => LoopbackOAuthCallbackReceiver.ParseCallbackRequest(request));
}

public sealed class ManagedOAuthClientTests
{
    [Fact]
    public async Task InteractiveSignIn_UsesDynamicRegistrationPkceAndNoClientSecret()
    {
        var options = RemoteAnalysisEndpointOptions.Default;
        var store = new MemorySessionStore();
        var browser = new CapturingBrowser();
        var callbackFactory = new BrowserStateCallbackFactory(browser, matchingState: true);
        var requests = new List<RequestCapture>();
        var handler = new StubHandler(async request =>
        {
            requests.Add(await RequestCapture.FromAsync(request));
            return request.RequestUri!.AbsolutePath switch
            {
                "/.well-known/oauth-authorization-server" => JsonResponse(OAuthMetadataJson()),
                "/cdn-cgi/access/oauth/registration" => JsonResponse("""{"client_id":"public-client-1","token_endpoint_auth_method":"none"}"""),
                "/cdn-cgi/access/oauth/token" => JsonResponse("""{"access_token":"oauth:access-1","token_type":"Bearer","expires_in":300,"refresh_token":"refresh-1"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            };
        });
        var http = new HttpClient(handler);
        var oauth = new ManagedOAuthClient(options, http, store, browser, callbackFactory);

        await oauth.SignInAsync();

        var authorization = Assert.IsType<Uri>(browser.OpenedUri);
        var authQuery = ParseQuery(authorization.Query);
        Assert.Equal("code", authQuery["response_type"]);
        Assert.Equal("S256", authQuery["code_challenge_method"]);
        Assert.Equal("https://analysis.minimalist.chat", authQuery["resource"]);
        Assert.StartsWith("http://127.0.0.1:", authQuery["redirect_uri"], StringComparison.Ordinal);
        Assert.True(authQuery["code_challenge"].Length >= 43);

        var registration = Assert.Single(requests, item => item.Path == "/cdn-cgi/access/oauth/registration");
        Assert.Contains("\"token_endpoint_auth_method\":\"none\"", registration.Body, StringComparison.Ordinal);
        Assert.DoesNotContain("client_secret", registration.Body, StringComparison.OrdinalIgnoreCase);
        Assert.Null(registration.AuthorizationScheme);
        var token = Assert.Single(requests, item => item.Path == "/cdn-cgi/access/oauth/token");
        var tokenForm = ParseQuery(token.Body);
        Assert.Equal("authorization_code", tokenForm["grant_type"]);
        Assert.True(tokenForm["code_verifier"].Length >= 43);
        Assert.DoesNotContain("client_secret", tokenForm.Keys);
        Assert.Null(token.AuthorizationScheme);
        Assert.Equal(new StoredRemoteOAuthSession("public-client-1", "refresh-1"), store.Load());
        Assert.Equal("oauth:access-1", await oauth.GetAccessTokenAsync());
    }

    [Fact]
    public async Task InteractiveSignIn_RejectsStateMismatchAndStoresNothing()
    {
        var options = RemoteAnalysisEndpointOptions.Default;
        var store = new MemorySessionStore();
        var browser = new CapturingBrowser();
        var callbackFactory = new BrowserStateCallbackFactory(browser, matchingState: false);
        var http = new HttpClient(new StubHandler(request => Task.FromResult(
            request.RequestUri!.AbsolutePath switch
            {
                "/.well-known/oauth-authorization-server" => JsonResponse(OAuthMetadataJson()),
                "/cdn-cgi/access/oauth/registration" => JsonResponse("""{"client_id":"public-client-1"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            })));
        var oauth = new ManagedOAuthClient(options, http, store, browser, callbackFactory);

        await Assert.ThrowsAsync<RemoteProtocolException>(() => oauth.SignInAsync());
        Assert.Null(store.Load());
    }

    [Fact]
    public async Task Discovery_RejectsEndpointOutsideConfiguredOriginAndTeamDomain()
    {
        var maliciousMetadata = """{"issuer":"https://evil.example","authorization_endpoint":"https://evil.example/auth","token_endpoint":"https://evil.example/token","registration_endpoint":"https://evil.example/register"}""";
        var http = new HttpClient(new StubHandler(_ => Task.FromResult(JsonResponse(maliciousMetadata))));
        var oauth = new ManagedOAuthClient(
            RemoteAnalysisEndpointOptions.Default,
            http,
            new MemorySessionStore(),
            new CapturingBrowser(),
            new BrowserStateCallbackFactory(new CapturingBrowser(), true));

        await Assert.ThrowsAsync<RemoteProtocolException>(() => oauth.SignInAsync());
    }

    [Fact]
    public async Task Refresh_UsesDpapiSessionShapeWithoutInteractiveBrowser()
    {
        var store = new MemorySessionStore(new StoredRemoteOAuthSession("saved-client", "saved-refresh"));
        var browser = new CapturingBrowser();
        var requests = new List<RequestCapture>();
        var http = new HttpClient(new StubHandler(async request =>
        {
            requests.Add(await RequestCapture.FromAsync(request));
            return request.RequestUri!.AbsolutePath switch
            {
                "/.well-known/oauth-authorization-server" => JsonResponse(OAuthMetadataJson()),
                "/cdn-cgi/access/oauth/token" => JsonResponse("""{"access_token":"oauth:refreshed","token_type":"Bearer","expires_in":"600","refresh_token":"rotated-refresh"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            };
        }));
        var oauth = new ManagedOAuthClient(
            RemoteAnalysisEndpointOptions.Default,
            http,
            store,
            browser,
            new BrowserStateCallbackFactory(browser, true));

        Assert.Equal("oauth:refreshed", await oauth.GetAccessTokenAsync());
        Assert.Null(browser.OpenedUri);
        var tokenRequest = Assert.Single(requests, item => item.Path == "/cdn-cgi/access/oauth/token");
        var form = ParseQuery(tokenRequest.Body);
        Assert.Equal("refresh_token", form["grant_type"]);
        Assert.Equal("saved-client", form["client_id"]);
        Assert.Equal("saved-refresh", form["refresh_token"]);
        Assert.DoesNotContain("client_secret", form.Keys);
        Assert.Equal("rotated-refresh", store.Load()!.RefreshToken);
    }

    private static string OAuthMetadataJson() => """
        {
          "issuer":"https://hotsauce.cloudflareaccess.com",
          "authorization_endpoint":"https://hotsauce.cloudflareaccess.com/cdn-cgi/access/oauth/authorization",
          "token_endpoint":"https://hotsauce.cloudflareaccess.com/cdn-cgi/access/oauth/token",
          "registration_endpoint":"https://hotsauce.cloudflareaccess.com/cdn-cgi/access/oauth/registration"
        }
        """;

    internal static Dictionary<string, string> ParseQuery(string raw)
        => raw.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => part.Split('=', 2))
            .ToDictionary(
                part => Uri.UnescapeDataString(part[0].Replace('+', ' ')),
                part => Uri.UnescapeDataString((part.Length > 1 ? part[1] : "").Replace('+', ' ')),
                StringComparer.Ordinal);

    internal static HttpResponseMessage JsonResponse(string json, HttpStatusCode status = HttpStatusCode.OK, bool agentMarker = false)
    {
        var response = new HttpResponseMessage(status)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
        if (agentMarker) response.Headers.TryAddWithoutValidation("X-Minimalist-Analysis-Agent", "1");
        return response;
    }
}

public sealed class RemoteAgentContractTests
{
    [Fact]
    public void Ping_RequiresReadOnlyV1Contract()
    {
        Assert.Equal(
            AnalysisAppLogic.RemoteAnalysisAgentTaskName,
            RemoteAnalysisClient.ValidatePing("""{"schemaVersion":1,"status":"ok","readOnly":true,"taskName":"Minimalist Chat Remote Analysis Agent"}"""u8.ToArray()));
        Assert.Throws<RemoteProtocolException>(() =>
            RemoteAnalysisClient.ValidatePing("""{"schemaVersion":1,"status":"ok","readOnly":false,"taskName":"Minimalist Chat Remote Analysis Agent"}"""u8.ToArray()));
        Assert.Throws<RemoteProtocolException>(() =>
            RemoteAnalysisClient.ValidatePing("""{"schemaVersion":1,"status":"ok","readOnly":true,"taskName":"Some Other Task"}"""u8.ToArray()));
    }

    [Fact]
    public void Snapshot_MapsMetadataOnlyRemoteContract()
    {
        var snapshot = RemoteAnalysisClient.ParseSnapshot(ValidSnapshotJson(), RemoteAnalysisEndpointOptions.Default.Resource);

        Assert.Equal(AnalysisConnectionMode.Remote, snapshot.ConnectionMode);
        Assert.True(snapshot.BridgeReady);
        Assert.True(snapshot.TunnelReady);
        Assert.True(snapshot.TunnelDesiredOn);
        Assert.Equal("auto", snapshot.Mode);
        Assert.Equal(120, snapshot.IdleMinutes);
        Assert.Equal([AnalysisAppLogic.ApprovedFastModel, AnalysisAppLogic.ApprovedVisionModel], snapshot.Models);
        Assert.True(snapshot.ModelsChecked);
        Assert.Single(snapshot.Activity);
        Assert.Empty(snapshot.Platform.Users);
        Assert.Equal(0, snapshot.Platform.TotalUsers);
        Assert.Equal("https://analysis.minimalist.chat", snapshot.PublicUrl);
    }

    [Fact]
    public void Snapshot_RejectsServerThatAdvertisesControls()
    {
        var json = Encoding.UTF8.GetString(ValidSnapshotJson()).Replace(
            "\"controlsAvailable\":false",
            "\"controlsAvailable\":true",
            StringComparison.Ordinal);
        Assert.Throws<RemoteProtocolException>(() =>
            RemoteAnalysisClient.ParseSnapshot(Encoding.UTF8.GetBytes(json), RemoteAnalysisEndpointOptions.Default.Resource));
    }

    [Fact]
    public async Task LoadSnapshot_UsesOnlyConfiguredHttpsRemoteEndpointsAndBearerToken()
    {
        var store = new MemorySessionStore(new StoredRemoteOAuthSession("saved-client", "saved-refresh"));
        var browser = new CapturingBrowser();
        var captures = new List<RequestCapture>();
        var handler = new StubHandler(async request =>
        {
            captures.Add(await RequestCapture.FromAsync(request));
            return request.RequestUri!.AbsolutePath switch
            {
                "/.well-known/oauth-authorization-server" => ManagedOAuthClientTests.JsonResponse(OAuthMetadata()),
                "/cdn-cgi/access/oauth/token" => ManagedOAuthClientTests.JsonResponse("""{"access_token":"oauth:remote","token_type":"Bearer","expires_in":600,"refresh_token":"refresh-2"}"""),
                "/v1/ping" => ManagedOAuthClientTests.JsonResponse("""{"schemaVersion":1,"status":"ok","readOnly":true,"taskName":"Minimalist Chat Remote Analysis Agent"}""", agentMarker: true),
                "/v1/snapshot" => ManagedOAuthClientTests.JsonResponse(Encoding.UTF8.GetString(ValidSnapshotJson()), agentMarker: true),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            };
        });
        var http = new HttpClient(handler);
        var oauth = new ManagedOAuthClient(
            RemoteAnalysisEndpointOptions.Default,
            http,
            store,
            browser,
            new BrowserStateCallbackFactory(browser, true));
        var client = new RemoteAnalysisClient(RemoteAnalysisEndpointOptions.Default, oauth, http);

        var snapshot = await client.LoadSnapshotAsync();

        Assert.Equal(AnalysisConnectionMode.Remote, snapshot.ConnectionMode);
        Assert.True(snapshot.RemoteAgentReady);
        Assert.Equal("connected", snapshot.RemoteAgentState);
        Assert.DoesNotContain(captures, item => item.Uri.IsLoopback || item.Uri.Scheme != Uri.UriSchemeHttps);
        Assert.All(captures, item => Assert.Contains(item.Uri.Host, new[] { "analysis.minimalist.chat", "hotsauce.cloudflareaccess.com" }));
        var apiRequests = captures.Where(item => item.Path is "/v1/ping" or "/v1/snapshot").ToArray();
        Assert.Equal(2, apiRequests.Length);
        Assert.All(apiRequests, item =>
        {
            Assert.Equal("GET", item.Method);
            Assert.Equal("Bearer", item.AuthorizationScheme);
            Assert.Equal("oauth:remote", item.AuthorizationParameter);
            Assert.Equal("", item.Body);
        });
        Assert.Null(browser.OpenedUri);
    }

    private static string OAuthMetadata() => """
        {"issuer":"https://hotsauce.cloudflareaccess.com","authorization_endpoint":"https://hotsauce.cloudflareaccess.com/cdn-cgi/access/oauth/authorization","token_endpoint":"https://hotsauce.cloudflareaccess.com/cdn-cgi/access/oauth/token","registration_endpoint":"https://hotsauce.cloudflareaccess.com/cdn-cgi/access/oauth/registration"}
        """;

    private static byte[] ValidSnapshotJson() => """
        {
          "schemaVersion":1,
          "observedAtUtc":"2026-07-14T18:00:00Z",
          "agentVersion":"1.0.0",
          "capabilities":{"readOnly":true,"controlsAvailable":false},
          "ai":{
            "mode":"auto",
            "idleMinutes":120,
            "ollamaState":"ready",
            "approvedModels":[
              {"profile":"fast","state":"ready"},
              {"profile":"smart","state":"missing"},
              {"profile":"vision","state":"ready"}
            ],
            "lastActivityAtUtc":"2026-07-14T17:59:00Z",
            "activity":[{"timeUtc":"2026-07-14T17:59:00Z","feature":"chat_completion","modelProfile":"fast","durationMs":230,"result":"success"}]
          },
          "bridge":{"ready":true,"identityVerified":true},
          "tunnel":{"desiredOn":true,"state":"healthy"},
          "recoveryTask":{"name":"Minimalist Chat Public Gateway Recovery","installed":true,"enabled":true,"state":"ready","lastResult":"0x00000000","lastRunAtUtc":"2026-07-14T17:00:00Z"},
          "warnings":[]
        }
        """u8.ToArray();
}

internal sealed class MemorySessionStore(StoredRemoteOAuthSession? initial = null) : IRemoteOAuthSessionStore
{
    private StoredRemoteOAuthSession? _session = initial;
    public StoredRemoteOAuthSession? Load() => _session;
    public void Save(StoredRemoteOAuthSession session) => _session = session;
    public void Clear() => _session = null;
}

internal sealed class CapturingBrowser : ISystemBrowser
{
    public Uri? OpenedUri { get; private set; }
    public void Open(Uri uri) => OpenedUri = uri;
}

internal sealed class BrowserStateCallbackFactory(CapturingBrowser browser, bool matchingState) : IOAuthCallbackReceiverFactory
{
    public IOAuthCallbackReceiver Create() => new BrowserStateCallback(browser, matchingState);
}

internal sealed class BrowserStateCallback(CapturingBrowser browser, bool matchingState) : IOAuthCallbackReceiver
{
    public Uri RedirectUri { get; } = new("http://127.0.0.1:45678/callback");

    public Task<OAuthCallbackResult> WaitForCallbackAsync(CancellationToken cancellationToken)
    {
        var opened = browser.OpenedUri ?? throw new InvalidOperationException("Browser was not opened.");
        var state = ManagedOAuthClientTests.ParseQuery(opened.Query)["state"];
        return Task.FromResult(new OAuthCallbackResult("authorization-code", matchingState ? state : "wrong-state", null));
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}

internal sealed class StubHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> handler) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        => handler(request);
}

internal sealed record RequestCapture(
    Uri Uri,
    string Path,
    string Method,
    string Body,
    string? AuthorizationScheme,
    string? AuthorizationParameter)
{
    public static async Task<RequestCapture> FromAsync(HttpRequestMessage request)
        => new(
            request.RequestUri!,
            request.RequestUri!.AbsolutePath,
            request.Method.Method,
            request.Content is null ? "" : await request.Content.ReadAsStringAsync(),
            request.Headers.Authorization?.Scheme,
            request.Headers.Authorization?.Parameter);
}
