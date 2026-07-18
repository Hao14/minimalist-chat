using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Server.Kestrel.Core;

namespace MinimalistAIAnalysis.Agent;

internal static class Program
{
    public static async Task<int> Main(string[] args)
    {
        string? workspace = null;
        try
        {
            var launchOptions = WorkspaceResolver.FromArguments(args);
            workspace = launchOptions.Workspace;
            var configuration = AgentConfiguration.Load(workspace, launchOptions.ConfigurationPath);
            var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions
            {
                Args = [],
                ApplicationName = typeof(Program).Assembly.GetName().Name,
                ContentRootPath = workspace,
            });
            builder.Logging.ClearProviders();
            builder.WebHost.ConfigureKestrel(options =>
            {
                options.AddServerHeader = false;
                options.Listen(IPAddress.Loopback, AgentConfiguration.Port, listen => listen.Protocols = HttpProtocols.Http1);
                options.Limits.MaxRequestBodySize = 0;
                options.Limits.MaxRequestHeaderCount = 32;
                options.Limits.MaxRequestHeadersTotalSize = 16 * 1024;
                options.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(10);
                options.Limits.KeepAliveTimeout = TimeSpan.FromSeconds(30);
            });
            builder.Services.ConfigureHttpJsonOptions(options =>
            {
                options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
                options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
                options.SerializerOptions.WriteIndented = false;
                options.SerializerOptions.MaxDepth = 16;
            });
            builder.Services.AddSingleton(configuration);
            builder.Services.AddSingleton(_ => new HttpClient(new SocketsHttpHandler
            {
                AllowAutoRedirect = false,
                AutomaticDecompression = System.Net.DecompressionMethods.GZip | System.Net.DecompressionMethods.Deflate,
                PooledConnectionLifetime = TimeSpan.FromMinutes(10),
                ConnectTimeout = TimeSpan.FromSeconds(3),
                UseCookies = false,
            })
            {
                Timeout = TimeSpan.FromSeconds(5),
            });
            builder.Services.AddSingleton<ICloudflareJwksProvider, CloudflareJwksProvider>();
            builder.Services.AddSingleton<IAccessAssertionValidator, CloudflareAccessAssertionValidator>();
            builder.Services.AddSingleton<IRecoveryTaskReader, WindowsRecoveryTaskReader>();
            builder.Services.AddSingleton<IRemoteAnalysisCollector, RemoteAnalysisCollector>();

            var app = builder.Build();
            app.Use(async (context, next) =>
            {
                SetSecurityHeaders(context.Response);
                var security = RequestSecurity.Evaluate(
                    context.Connection.RemoteIpAddress,
                    context.Request.QueryString.HasValue,
                    context.Request.ContentLength,
                    context.Request.Headers.ContainsKey("Transfer-Encoding"));
                if (security != RequestSecurityDecision.Continue)
                {
                    await WriteErrorAsync(context, security == RequestSecurityDecision.Forbidden ? 403 : 400);
                    return;
                }

                var assertions = context.Request.Headers["Cf-Access-Jwt-Assertion"];
                if (assertions.Count != 1 ||
                    !await context.RequestServices.GetRequiredService<IAccessAssertionValidator>()
                        .IsAuthorizedAsync(assertions[0] ?? string.Empty, context.RequestAborted))
                {
                    await WriteErrorAsync(context, 401);
                    return;
                }

                if (!HttpMethods.IsGet(context.Request.Method))
                {
                    context.Response.Headers.Allow = "GET";
                    await WriteErrorAsync(context, 405);
                    return;
                }
                await next(context);
            });

            app.MapGet("/v1/ping", () => Results.Json(CreatePingPayload()));
            app.MapGet("/v1/snapshot", async (IRemoteAnalysisCollector collector, CancellationToken cancellationToken) =>
                Results.Json(await collector.CollectAsync(cancellationToken)));
            app.MapFallback((HttpContext context) => WriteErrorAsync(context, 404));

            app.Lifetime.ApplicationStarted.Register(() => AgentRuntimeStatus.Write(workspace, "running"));
            app.Lifetime.ApplicationStopping.Register(() => AgentRuntimeStatus.Write(workspace, "stopping"));
            await app.RunAsync();
            AgentRuntimeStatus.Write(workspace, "stopped");
            return 0;
        }
        catch (AgentConfigurationException error)
        {
            AgentRuntimeStatus.Write(workspace, "configuration_error", error.Code);
            return 2;
        }
        catch
        {
            AgentRuntimeStatus.Write(workspace, "faulted", "agent_start_failed");
            return 1;
        }
    }

    internal static RemoteAgentPingV1 CreatePingPayload() => new(
        SchemaVersion: 1,
        Status: "ok",
        ReadOnly: true,
        TaskName: AgentConfiguration.TaskName);

    private static void SetSecurityHeaders(HttpResponse response)
    {
        response.Headers.CacheControl = "no-store";
        response.Headers.Pragma = "no-cache";
        response.Headers["X-Content-Type-Options"] = "nosniff";
        response.Headers["X-Frame-Options"] = "DENY";
        response.Headers["Referrer-Policy"] = "no-referrer";
        response.Headers["X-Minimalist-Analysis-Agent"] = "1";
    }

    private static async Task WriteErrorAsync(HttpContext context, int statusCode)
    {
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/json";
        await context.Response.WriteAsJsonAsync(new
        {
            error = statusCode switch
            {
                400 => "invalid_request",
                401 => "access_denied",
                403 => "origin_denied",
                405 => "method_not_allowed",
                _ => "not_found",
            },
        }, context.RequestAborted);
    }
}
