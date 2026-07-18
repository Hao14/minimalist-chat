using System.Diagnostics;
using MinimalistAIAnalysis;
using Xunit;

namespace MinimalistAIAnalysis.Tests;

public sealed class StartupLoadPresentationTests
{
    [Fact]
    public void LocalStartupStages_AdvanceMonotonicallyToReady()
    {
        var stages = new[]
        {
            StartupLoadStage.Preparing,
            StartupLoadStage.ProtectedServices,
            StartupLoadStage.PlatformAnalytics,
            StartupLoadStage.Ready,
        };

        var presentations = stages.Select(StartupLoadPresentations.For).ToArray();

        Assert.Equal(100, presentations[^1].ProgressPercent);
        Assert.All(presentations, presentation =>
        {
            Assert.False(string.IsNullOrWhiteSpace(presentation.Status));
            Assert.False(string.IsNullOrWhiteSpace(presentation.Detail));
            Assert.InRange(presentation.ProgressPercent, 1, 100);
        });
        Assert.True(presentations.Zip(presentations.Skip(1), (left, right) => left.ProgressPercent < right.ProgressPercent).All(result => result));
    }

    [Fact]
    public void RemoteStartupStage_UsesOwnerOnlyReadOnlyLanguage()
    {
        var presentation = StartupLoadPresentations.For(StartupLoadStage.RemoteDesktop);

        Assert.Contains("remote desktop", presentation.Status, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("owner-only", presentation.Detail, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("read-only", presentation.Detail, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData((int)StartupLoadStage.Preparing)]
    [InlineData((int)StartupLoadStage.ProtectedServices)]
    [InlineData((int)StartupLoadStage.PlatformAnalytics)]
    [InlineData((int)StartupLoadStage.RemoteDesktop)]
    [InlineData((int)StartupLoadStage.Ready)]
    public void EveryStartupStage_HasSafeConciseCopy(int stageValue)
    {
        var presentation = StartupLoadPresentations.For((StartupLoadStage)stageValue);

        Assert.DoesNotContain("token", presentation.Detail, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("credential", presentation.Detail, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("C:\\", presentation.Detail, StringComparison.OrdinalIgnoreCase);
        Assert.InRange(presentation.Status.Length, 8, 48);
        Assert.InRange(presentation.Detail.Length, 8, 96);
    }
}

public sealed class WindowlessProcessTests
{
    [Fact]
    public void CreateStartInfo_UsesNoConsoleHiddenPolicyAndPreservesTokens()
    {
        var startInfo = WindowlessProcess.CreateStartInfo(
            "node.exe",
            ["tool with spaces.js", "--flag", "value with spaces"],
            new Dictionary<string, string?> { ["MINIMALIST_PROCESS_TEST"] = "ready" });

        Assert.False(startInfo.UseShellExecute);
        Assert.True(startInfo.CreateNoWindow);
        Assert.Equal(ProcessWindowStyle.Hidden, startInfo.WindowStyle);
        Assert.False(startInfo.ErrorDialog);
        Assert.True(startInfo.RedirectStandardOutput);
        Assert.True(startInfo.RedirectStandardError);
        Assert.Equal(["tool with spaces.js", "--flag", "value with spaces"], startInfo.ArgumentList);
        Assert.Equal("ready", startInfo.Environment["MINIMALIST_PROCESS_TEST"]);
    }

    [Fact]
    public void PowerShellScriptArguments_UseHiddenNonInteractiveHost()
    {
        var arguments = WindowlessProcess.PowerShellScriptArguments("bridge control.ps1", "-Action", "start-tunnel");

        Assert.Equal(
            [
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                "bridge control.ps1",
                "-Action",
                "start-tunnel",
            ],
            arguments);
    }

    [Fact]
    public void FirebaseRuntime_UsesDirectNodeProcessWithoutScriptHost()
    {
        var root = Path.Combine(Path.GetTempPath(), $"minimalist-analysis-process-{Guid.NewGuid():N}");
        try
        {
            var olderNode = Path.Combine(root, ".deploy-tools", "node-v22.10.0-win-x64", "node.exe");
            var newestNode = Path.Combine(root, ".tools", "node-v22.20.1-win-x64", "node.exe");
            var firebase = Path.Combine(root, "node_modules", "firebase-tools", "lib", "bin", "firebase.js");
            Directory.CreateDirectory(Path.GetDirectoryName(olderNode)!);
            Directory.CreateDirectory(Path.GetDirectoryName(newestNode)!);
            Directory.CreateDirectory(Path.GetDirectoryName(firebase)!);
            File.WriteAllBytes(olderNode, []);
            File.WriteAllBytes(newestNode, []);
            File.WriteAllText(firebase, "// test fixture");

            var runtime = FirebaseCliLocator.Resolve(root);
            var arguments = runtime.CreateArguments(["database:get", "/users"], "test-project");
            var startInfo = WindowlessProcess.CreateStartInfo(runtime.NodeExecutable, arguments, runtime.CreateEnvironment());

            Assert.Equal(newestNode, startInfo.FileName, ignoreCase: true);
            Assert.Equal(firebase, startInfo.ArgumentList[0], ignoreCase: true);
            Assert.Equal([firebase, "database:get", "/users", "--project", "test-project", "--non-interactive"], startInfo.ArgumentList);
            Assert.DoesNotContain(startInfo.FileName, ["powershell.exe", "cmd.exe"], StringComparer.OrdinalIgnoreCase);
            Assert.DoesNotContain(startInfo.ArgumentList, argument => argument.EndsWith(".ps1", StringComparison.OrdinalIgnoreCase) || argument.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase));
            Assert.Equal("true", startInfo.Environment["FIREBASE_SKIP_UPDATE_CHECK"]);
            Assert.StartsWith(Path.GetDirectoryName(newestNode)!, startInfo.Environment["PATH"], StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }
}

public sealed class IdleTimeoutMappingTests
{
    [Theory]
    [InlineData(0, 30)]
    [InlineData(1, 60)]
    [InlineData(2, 120)]
    [InlineData(3, 240)]
    [InlineData(-1, 120)]
    [InlineData(4, 120)]
    [InlineData(int.MinValue, 120)]
    [InlineData(int.MaxValue, 120)]
    public void IdleMinutesFromIndex_MapsOptionsAndDefaultsToTwoHours(int index, int expectedMinutes)
        => Assert.Equal(expectedMinutes, AnalysisAppLogic.IdleMinutesFromIndex(index));

    [Theory]
    [InlineData(30, 0)]
    [InlineData(60, 1)]
    [InlineData(120, 2)]
    [InlineData(240, 3)]
    [InlineData(0, 2)]
    [InlineData(119, 2)]
    [InlineData(121, 2)]
    [InlineData(int.MinValue, 2)]
    [InlineData(int.MaxValue, 2)]
    public void IdleIndexFromMinutes_MapsOptionsAndDefaultsToTwoHours(int minutes, int expectedIndex)
        => Assert.Equal(expectedIndex, AnalysisAppLogic.IdleIndexFromMinutes(minutes));

    [Fact]
    public void IdleMappings_RoundTripEverySupportedOption()
    {
        for (var index = 0; index < 4; index++)
        {
            var minutes = AnalysisAppLogic.IdleMinutesFromIndex(index);
            Assert.Equal(index, AnalysisAppLogic.IdleIndexFromMinutes(minutes));
        }
    }
}

public sealed class ResponsiveWindowClassificationTests
{
    [Theory]
    [InlineData(int.MinValue)]
    [InlineData(-1)]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(1118)]
    [InlineData(1119)]
    public void ClassifyWindowWidth_ReturnsCompactBelow1120(int clientWidth)
        => Assert.Equal(
            AnalysisWindowWidthClass.Compact,
            AnalysisAppLogic.ClassifyWindowWidth(clientWidth));

    [Theory]
    [InlineData(1120)]
    [InlineData(1121)]
    [InlineData(1278)]
    [InlineData(1279)]
    public void ClassifyWindowWidth_ReturnsStandardFrom1120Through1279(int clientWidth)
        => Assert.Equal(
            AnalysisWindowWidthClass.Standard,
            AnalysisAppLogic.ClassifyWindowWidth(clientWidth));

    [Theory]
    [InlineData(1280)]
    [InlineData(1281)]
    [InlineData(int.MaxValue)]
    public void ClassifyWindowWidth_ReturnsWideAt1280AndAbove(int clientWidth)
        => Assert.Equal(
            AnalysisWindowWidthClass.Wide,
            AnalysisAppLogic.ClassifyWindowWidth(clientWidth));

    [Theory]
    [InlineData(AnalysisWindowWidthClass.Compact, true)]
    [InlineData(AnalysisWindowWidthClass.Standard, false)]
    [InlineData(AnalysisWindowWidthClass.Wide, false)]
    public void ShouldStackHeaderActions_UsesASecondActionRowOnlyInCompactMode(
        AnalysisWindowWidthClass widthClass,
        bool expected)
        => Assert.Equal(expected, AnalysisAppLogic.ShouldStackHeaderActions(widthClass));

    [Theory]
    [InlineData(int.MinValue)]
    [InlineData(-1)]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(758)]
    [InlineData(759)]
    public void IsShortWindowHeight_ReturnsTrueBelow760(int clientHeight)
        => Assert.True(AnalysisAppLogic.IsShortWindowHeight(clientHeight));

    [Theory]
    [InlineData(760)]
    [InlineData(761)]
    [InlineData(int.MaxValue)]
    public void IsShortWindowHeight_ReturnsFalseAt760AndAbove(int clientHeight)
        => Assert.False(AnalysisAppLogic.IsShortWindowHeight(clientHeight));

    [Theory]
    [InlineData(int.MinValue, 18)]
    [InlineData(0, 18)]
    [InlineData(1119, 18)]
    [InlineData(1120, 24)]
    [InlineData(1279, 24)]
    [InlineData(1280, 34)]
    [InlineData(1508, 34)]
    [InlineData(1510, 35)]
    [InlineData(1920, 240)]
    public void CalculatePageHorizontalPadding_PreservesBaseGuttersAndCapsWideContent(int clientWidth, int expectedPadding)
        => Assert.Equal(expectedPadding, AnalysisAppLogic.CalculatePageHorizontalPadding(clientWidth));
}

public sealed class ActivityChartLogicTests
{
    private static readonly DateTime Now = new(2026, 7, 13, 21, 30, 0, DateTimeKind.Local);

    [Fact]
    public void BuildActivityBuckets_GroupsTheRollingDayAndExcludesOutsideTimes()
    {
        var buckets = AnalysisAppLogic.BuildActivityBuckets(
        [
            Now.AddHours(-24),
            Now.AddHours(-23),
            Now.AddHours(-1),
            Now.AddMilliseconds(-1),
            Now.AddHours(-24).AddMilliseconds(-1),
            Now,
            Now.AddMinutes(1),
        ],
        Now);

        Assert.Equal(AnalysisAppLogic.ActivityBucketCount, buckets.Length);
        Assert.Equal(1, buckets[0]);
        Assert.Equal(1, buckets[1]);
        Assert.Equal(2, buckets[^1]);
        Assert.Equal(4, buckets.Sum());
    }

    [Fact]
    public void BuildActivityBuckets_ReturnsAnEmptyDayForNullInput()
        => Assert.All(AnalysisAppLogic.BuildActivityBuckets(null, Now), count => Assert.Equal(0, count));

    [Fact]
    public void BuildActivityBucketSummaries_GroupsCountsAndKnownOutcomes()
    {
        var buckets = AnalysisAppLogic.BuildActivityBucketSummaries(
        [
            (Now.AddHours(-24), "success"),
            (Now.AddHours(-2), "error"),
            (Now.AddHours(-1), "SUCCESS"),
            (Now.AddMinutes(-30), "error"),
            (Now.AddMinutes(-10), "unknown"),
            (Now, "success"),
        ],
        Now);

        Assert.Equal(AnalysisAppLogic.ActivityBucketCount, buckets.Length);
        Assert.Equal(new ActivityBucketSummary(1, 1, 0), buckets[0]);
        Assert.Equal(new ActivityBucketSummary(1, 0, 1), buckets[^2]);
        Assert.Equal(new ActivityBucketSummary(3, 1, 1), buckets[^1]);
        Assert.Equal(5, buckets.Sum(bucket => bucket.Count));
        Assert.True(buckets[^1].HasOutcomeBreakdown);
    }

    [Fact]
    public void BuildActivityBucketSummaries_ReturnsAnEmptyDayForNullInput()
        => Assert.All(
            AnalysisAppLogic.BuildActivityBucketSummaries(null, Now),
            bucket => Assert.Equal(default, bucket));

    [Theory]
    [InlineData(100, 0)]
    [InlineData(109.99, 0)]
    [InlineData(110, 1)]
    [InlineData(330, 23)]
    [InlineData(340, 23)]
    [InlineData(99.99, -1)]
    [InlineData(340.01, -1)]
    public void ActivityBucketIndexAt_MapsTheWholePlotToTwentyFourHitTargets(double x, int expected)
        => Assert.Equal(expected, AnalysisAppLogic.ActivityBucketIndexAt(x, 100, 240));

    [Fact]
    public void ActivityBucketIndexAt_RejectsInvalidGeometry()
    {
        Assert.Equal(-1, AnalysisAppLogic.ActivityBucketIndexAt(double.NaN, 0, 240));
        Assert.Equal(-1, AnalysisAppLogic.ActivityBucketIndexAt(10, 0, 0));
        Assert.Equal(-1, AnalysisAppLogic.ActivityBucketIndexAt(10, double.PositiveInfinity, 240));
    }

    [Theory]
    [InlineData(0, -24, -23)]
    [InlineData(12, -12, -11)]
    [InlineData(23, -1, 0)]
    public void ActivityBucketRange_ReturnsTheSelectedRollingHour(int bucketIndex, int startHours, int endHours)
    {
        var range = AnalysisAppLogic.ActivityBucketRange(Now, bucketIndex);

        Assert.Equal(Now.AddHours(startHours), range.Start);
        Assert.Equal(Now.AddHours(endHours), range.End);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(24)]
    [InlineData(int.MaxValue)]
    public void ActivityBucketRange_RejectsUnknownBuckets(int bucketIndex)
        => Assert.Throws<ArgumentOutOfRangeException>(() => AnalysisAppLogic.ActivityBucketRange(Now, bucketIndex));
}

public sealed class InfrastructureActionTests
{
    [Theory]
    [InlineData("start-bridge")]
    [InlineData("restart-bridge")]
    [InlineData("stop-bridge")]
    [InlineData("start-ollama")]
    [InlineData("start-tunnel")]
    [InlineData("stop-tunnel")]
    public void IsSupportedBridgeAction_AllowsOnlyKnownInfrastructureActions(string action)
        => Assert.True(AnalysisAppLogic.IsSupportedBridgeAction(action));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("START-TUNNEL")]
    [InlineData("start-tunnel ")]
    [InlineData("start-tunnel; calc")]
    [InlineData("stop-tunnel --force")]
    [InlineData("cloudflared")]
    [InlineData("reconcile-tunnel")]
    public void IsSupportedBridgeAction_RejectsAliasesAndInjectionShapedValues(string? action)
        => Assert.False(AnalysisAppLogic.IsSupportedBridgeAction(action));
}

public sealed class PublicTunnelStateTests
{
    [Theory]
    [InlineData("{\"schemaVersion\":1,\"desiredOn\":true}", true)]
    [InlineData("{\"schemaVersion\":1,\"desiredOn\":false}", false)]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("not json", false)]
    [InlineData("[]", false)]
    [InlineData("{\"desiredOn\":true}", false)]
    [InlineData("{\"schemaVersion\":2,\"desiredOn\":true}", false)]
    [InlineData("{\"schemaVersion\":1,\"desiredOn\":\"true\"}", false)]
    [InlineData("{\"SchemaVersion\":1,\"DesiredOn\":true}", false)]
    [InlineData("{\"schemaVersion\":1,\"desiredOn\":true,\"extra\":true}", false)]
    [InlineData("{\"schemaVersion\":1,\"schemaVersion\":1,\"desiredOn\":true}", false)]
    public void ParseTunnelDesiredState_FailsClosedUnlessTheExactSchemaEnablesIt(string? json, bool expected)
        => Assert.Equal(expected, AnalysisAppLogic.ParseTunnelDesiredState(json));

    [Theory]
    [InlineData(false, false, PublicTunnelDisplayState.Off)]
    [InlineData(false, true, PublicTunnelDisplayState.Off)]
    [InlineData(true, true, PublicTunnelDisplayState.Healthy)]
    [InlineData(true, false, PublicTunnelDisplayState.Recovering)]
    public void ResolvePublicTunnelDisplayState_UsesIntentBeforeReachability(
        bool desiredOn,
        bool tunnelReady,
        PublicTunnelDisplayState expected)
        => Assert.Equal(expected, AnalysisAppLogic.ResolvePublicTunnelDisplayState(desiredOn, tunnelReady));
}

public sealed class RecoveryTaskStateTests
{
    [Fact]
    public void RecoveryTaskName_RemainsTheApprovedFixedTask()
        => Assert.Equal("Minimalist Chat Public Gateway Recovery", AnalysisAppLogic.PublicGatewayRecoveryTaskName);

    [Theory]
    [InlineData(null, false, RecoveryTaskSchedulerState.Unknown, null, false, RecoveryTaskDisplayState.Unavailable)]
    [InlineData(false, false, RecoveryTaskSchedulerState.Unknown, null, false, RecoveryTaskDisplayState.NotInstalled)]
    [InlineData(true, false, RecoveryTaskSchedulerState.Ready, 0u, true, RecoveryTaskDisplayState.Disabled)]
    [InlineData(true, true, RecoveryTaskSchedulerState.Disabled, 0u, true, RecoveryTaskDisplayState.Disabled)]
    [InlineData(true, true, RecoveryTaskSchedulerState.Running, 5u, true, RecoveryTaskDisplayState.Running)]
    [InlineData(true, true, RecoveryTaskSchedulerState.Queued, null, false, RecoveryTaskDisplayState.Queued)]
    [InlineData(true, true, RecoveryTaskSchedulerState.Ready, null, false, RecoveryTaskDisplayState.Waiting)]
    [InlineData(true, true, RecoveryTaskSchedulerState.Ready, 0u, true, RecoveryTaskDisplayState.Ready)]
    [InlineData(true, true, RecoveryTaskSchedulerState.Ready, 5u, true, RecoveryTaskDisplayState.NeedsAttention)]
    [InlineData(true, true, RecoveryTaskSchedulerState.Unknown, 0u, true, RecoveryTaskDisplayState.NeedsAttention)]
    public void ResolveRecoveryTaskDisplayState_MapsSchedulerHealthWithoutElevating(
        bool? installed,
        bool enabled,
        RecoveryTaskSchedulerState schedulerState,
        uint? lastTaskResult,
        bool hasRun,
        RecoveryTaskDisplayState expected)
    {
        DateTime? lastRunTime = hasRun ? new DateTime(2026, 7, 14, 7, 10, 0) : null;

        Assert.Equal(expected, AnalysisAppLogic.ResolveRecoveryTaskDisplayState(
            installed,
            enabled,
            schedulerState,
            lastTaskResult,
            lastRunTime));
    }

    [Fact]
    public void NormalizeRecoveryTaskRunTime_TreatsTaskSchedulerSentinelAsNeverRun()
    {
        Assert.Null(AnalysisAppLogic.NormalizeRecoveryTaskRunTime(new DateTime(1899, 12, 30)));
        Assert.Equal(
            new DateTime(2026, 7, 14, 7, 10, 0),
            AnalysisAppLogic.NormalizeRecoveryTaskRunTime(new DateTime(2026, 7, 14, 7, 10, 0)));
    }

    [Theory]
    [InlineData(null, "No completed result")]
    [InlineData(0u, "Success")]
    [InlineData(0x80070005u, "Result 0x80070005")]
    public void FormatRecoveryTaskResult_PreservesUnsignedWindowsResultCodes(uint? result, string expected)
        => Assert.Equal(expected, AnalysisAppLogic.FormatRecoveryTaskResult(result));
}

public sealed class ConsoleCommandTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   \t\r\n  ")]
    public void TokenizeCommand_ReturnsNoTokensForBlankInput(string? command)
        => Assert.Empty(AnalysisAppLogic.TokenizeCommand(command));

    [Fact]
    public void TokenizeCommand_TrimsAndCollapsesAllWhitespace()
    {
        var tokens = AnalysisAppLogic.TokenizeCommand("  room-mute\troom_1\r\nUser-AbC   forever  CONFIRM ");

        Assert.Equal(["room-mute", "room_1", "User-AbC", "forever", "CONFIRM"], tokens);
    }

    [Fact]
    public void TokenizeCommand_PreservesIdentifierAndConfirmationCase()
    {
        var tokens = AnalysisAppLogic.TokenizeCommand("delete-account UserABC DELETE UserABC");

        Assert.Equal(["delete-account", "UserABC", "DELETE", "UserABC"], tokens);
    }

    [Theory]
    [InlineData("help")]
    [InlineData("moderation-help")]
    [InlineData("status")]
    [InlineData("refresh")]
    [InlineData("start")]
    [InlineData("restart")]
    [InlineData("stop")]
    [InlineData("on")]
    [InlineData("off")]
    [InlineData("auto")]
    [InlineData("logs")]
    [InlineData("open logs")]
    [InlineData("clear")]
    [InlineData("copy")]
    [InlineData("  OPEN\tLOGS  ")]
    public void ClassifyCommand_RecognizesBuiltInCommands(string command)
        => Assert.Equal(ConsoleCommandCategory.BuiltIn, Classify(command));

    [Theory]
    [InlineData("user-status")]
    [InlineData("ban")]
    [InlineData("unban")]
    [InlineData("mute")]
    [InlineData("unmute")]
    [InlineData("room-mute")]
    [InlineData("room-unmute")]
    [InlineData("kick")]
    [InlineData("moderation-summary")]
    [InlineData("list-banned")]
    [InlineData("list-muted")]
    [InlineData("user-rooms")]
    [InlineData("room-status")]
    [InlineData("room-members")]
    [InlineData("room-log")]
    [InlineData("delete-message")]
    [InlineData("delete-account")]
    [InlineData("BAN UserABC CONFIRM")]
    [InlineData("WhOiS UserABC")]
    [InlineData("bans")]
    [InlineData("mutes")]
    [InlineData("timeout Room_1 UserABC 60 CONFIRM")]
    [InlineData("untimeout Room_1 UserABC CONFIRM")]
    [InlineData("remove-message global Msg_1 DELETE Msg_1")]
    public void ClassifyCommand_RecognizesModerationVerbBeforeSyntaxValidation(string command)
        => Assert.Equal(ConsoleCommandCategory.Moderation, Classify(command));

    [Theory]
    [InlineData(null, ConsoleCommandCategory.Empty)]
    [InlineData("", ConsoleCommandCategory.Empty)]
    [InlineData("unknown", ConsoleCommandCategory.Unknown)]
    [InlineData("open", ConsoleCommandCategory.Unknown)]
    [InlineData("help extra", ConsoleCommandCategory.Unknown)]
    [InlineData("open logs extra", ConsoleCommandCategory.Unknown)]
    [InlineData("start && calc", ConsoleCommandCategory.Unknown)]
    [InlineData("restart; powershell", ConsoleCommandCategory.Unknown)]
    [InlineData("stop|calc", ConsoleCommandCategory.Unknown)]
    [InlineData("logs > exported.txt", ConsoleCommandCategory.Unknown)]
    public void ClassifyCommand_DistinguishesEmptyAndUnknownCommands(
        string? command,
        ConsoleCommandCategory expectedCategory)
        => Assert.Equal(expectedCategory, Classify(command));

    [Fact]
    public void ClassifyCommand_HandlesNullTokenCollection()
        => Assert.Equal(ConsoleCommandCategory.Empty, AnalysisAppLogic.ClassifyCommand(null));

    private static ConsoleCommandCategory Classify(string? command)
        => AnalysisAppLogic.ClassifyCommand(AnalysisAppLogic.TokenizeCommand(command));
}

public sealed class ModerationConfirmationTests
{
    [Theory]
    [InlineData("ban UserABC CONFIRM")]
    [InlineData("unban UserABC confirm")]
    [InlineData("mute UserABC Confirm")]
    [InlineData("unmute UserABC cOnFiRm")]
    [InlineData("room-mute Room_1 UserABC 1 CONFIRM")]
    [InlineData("room-mute Room_1 UserABC forever confirm")]
    [InlineData("room-unmute Room_1 UserABC CONFIRM")]
    [InlineData("kick Room_1 UserABC confirm")]
    [InlineData("delete-message global Msg_1 DELETE Msg_1")]
    [InlineData("delete-message room Room_1 Msg_1 DELETE Msg_1")]
    [InlineData("delete-message channel Room_1 Channel_1 Msg_1 DELETE Msg_1")]
    [InlineData("remove-message global Msg_1 DELETE Msg_1")]
    [InlineData("delete-account UserABC DELETE UserABC")]
    public void HasValidModerationConfirmation_AcceptsExactSupportedForms(string command)
        => Assert.True(HasValidConfirmation(command));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("user-status UserABC")]
    [InlineData("ban UserABC")]
    [InlineData("ban UserABC YES")]
    [InlineData("ban UserABC CONFIRM extra")]
    [InlineData("room-mute Room_1 UserABC 60")]
    [InlineData("room-mute Room_1 UserABC 60 CONFIRM extra")]
    [InlineData("room-unmute Room_1 UserABC")]
    [InlineData("kick Room_1 UserABC CONFIRM extra")]
    [InlineData("delete-account UserABC delete UserABC")]
    [InlineData("delete-account UserABC DELETE userabc")]
    [InlineData("delete-account UserABC DELETE OtherUser")]
    [InlineData("delete-account UserABC DELETE UserABC extra")]
    [InlineData("ban UserABC CONFIRM && calc")]
    [InlineData("room-mute Room_1 UserABC forever CONFIRM;calc")]
    [InlineData("delete-account UserABC DELETE UserABC DELETE UserABC")]
    [InlineData("delete-message global Msg_1 delete Msg_1")]
    [InlineData("delete-message global Msg_1 DELETE msg_1")]
    [InlineData("delete-message channel Room_1 general Msg_1 DELETE Msg_1")]
    [InlineData("ban bad.uid CONFIRM")]
    [InlineData("room-mute Room_1 UserABC 0 CONFIRM")]
    [InlineData("room-mute Room_1 UserABC 43201 CONFIRM")]
    [InlineData("unknown UserABC CONFIRM")]
    public void HasValidModerationConfirmation_RejectsMissingMalformedOrUnsafeForms(string? command)
        => Assert.False(HasValidConfirmation(command));

    [Fact]
    public void HasValidModerationConfirmation_RejectsBlankRequiredIdentifiers()
    {
        Assert.False(AnalysisAppLogic.HasValidModerationConfirmation(["ban", "", "CONFIRM"]));
        Assert.False(AnalysisAppLogic.HasValidModerationConfirmation(["kick", "Room_1", " ", "CONFIRM"]));
        Assert.False(AnalysisAppLogic.HasValidModerationConfirmation(["delete-account", "", "DELETE", ""]));
    }

    [Fact]
    public void HasValidModerationConfirmation_RejectsNullTokenCollection()
        => Assert.False(AnalysisAppLogic.HasValidModerationConfirmation(null));

    [Fact]
    public void HasValidModerationConfirmation_RejectsNullVerb()
        => Assert.False(AnalysisAppLogic.HasValidModerationConfirmation([null!, "UserABC", "CONFIRM"]));

    private static bool HasValidConfirmation(string? command)
        => AnalysisAppLogic.HasValidModerationConfirmation(AnalysisAppLogic.TokenizeCommand(command));
}

public sealed class ModerationCommandParserTests
{
    [Theory]
    [InlineData("user-status UserABC", ModerationCommandKind.UserStatus, "user-status", ModerationConfirmationPolicy.None)]
    [InlineData("moderation-summary", ModerationCommandKind.ModerationSummary, "moderation-summary", ModerationConfirmationPolicy.None)]
    [InlineData("list-banned", ModerationCommandKind.ListBanned, "list-banned", ModerationConfirmationPolicy.None)]
    [InlineData("list-muted", ModerationCommandKind.ListMuted, "list-muted", ModerationConfirmationPolicy.None)]
    [InlineData("user-rooms UserABC", ModerationCommandKind.UserRooms, "user-rooms", ModerationConfirmationPolicy.None)]
    [InlineData("room-status Room_1", ModerationCommandKind.RoomStatus, "room-status", ModerationConfirmationPolicy.None)]
    [InlineData("room-members Room_1", ModerationCommandKind.RoomMembers, "room-members", ModerationConfirmationPolicy.None)]
    [InlineData("room-log Room_1", ModerationCommandKind.RoomLog, "room-log", ModerationConfirmationPolicy.None)]
    [InlineData("room-log Room_1 50", ModerationCommandKind.RoomLog, "room-log", ModerationConfirmationPolicy.None)]
    [InlineData("ban UserABC CONFIRM", ModerationCommandKind.Ban, "ban", ModerationConfirmationPolicy.Confirm)]
    [InlineData("unban UserABC confirm", ModerationCommandKind.Unban, "unban", ModerationConfirmationPolicy.Confirm)]
    [InlineData("mute UserABC Confirm", ModerationCommandKind.Mute, "mute", ModerationConfirmationPolicy.Confirm)]
    [InlineData("unmute UserABC cOnFiRm", ModerationCommandKind.Unmute, "unmute", ModerationConfirmationPolicy.Confirm)]
    [InlineData("room-mute Room_1 UserABC 1 CONFIRM", ModerationCommandKind.RoomMute, "room-mute", ModerationConfirmationPolicy.Confirm)]
    [InlineData("room-mute Room_1 UserABC 43200 CONFIRM", ModerationCommandKind.RoomMute, "room-mute", ModerationConfirmationPolicy.Confirm)]
    [InlineData("room-mute Room_1 UserABC FoReVeR CONFIRM", ModerationCommandKind.RoomMute, "room-mute", ModerationConfirmationPolicy.Confirm)]
    [InlineData("room-unmute Room_1 UserABC CONFIRM", ModerationCommandKind.RoomUnmute, "room-unmute", ModerationConfirmationPolicy.Confirm)]
    [InlineData("kick Room_1 UserABC CONFIRM", ModerationCommandKind.Kick, "kick", ModerationConfirmationPolicy.Confirm)]
    [InlineData("delete-message global Msg_1 DELETE Msg_1", ModerationCommandKind.DeleteMessage, "delete-message", ModerationConfirmationPolicy.DestructiveDelete)]
    [InlineData("delete-message room Room_1 Msg_1 DELETE Msg_1", ModerationCommandKind.DeleteMessage, "delete-message", ModerationConfirmationPolicy.DestructiveDelete)]
    [InlineData("delete-message channel Room_1 Channel_1 Msg_1 DELETE Msg_1", ModerationCommandKind.DeleteMessage, "delete-message", ModerationConfirmationPolicy.DestructiveDelete)]
    [InlineData("delete-account UserABC DELETE UserABC", ModerationCommandKind.DeleteAccount, "delete-account", ModerationConfirmationPolicy.DestructiveDelete)]
    public void ParseModerationCommand_AcceptsEveryCanonicalShape(
        string input,
        ModerationCommandKind expectedKind,
        string expectedVerb,
        ModerationConfirmationPolicy expectedPolicy)
    {
        var result = Parse(input);

        Assert.True(result.Success, result.Error);
        Assert.NotNull(result.Command);
        Assert.Equal(expectedKind, result.Command.Kind);
        Assert.Equal(expectedVerb, result.Command.CanonicalVerb);
        Assert.Equal(expectedPolicy, result.Command.ConfirmationPolicy);
    }

    [Theory]
    [InlineData("WhOiS UserABC", ModerationCommandKind.UserStatus, "user-status")]
    [InlineData("BANS", ModerationCommandKind.ListBanned, "list-banned")]
    [InlineData("MuTeS", ModerationCommandKind.ListMuted, "list-muted")]
    [InlineData("TIMEOUT Room_1 UserABC 60 CONFIRM", ModerationCommandKind.RoomMute, "room-mute")]
    [InlineData("UNTIMEOUT Room_1 UserABC CONFIRM", ModerationCommandKind.RoomUnmute, "room-unmute")]
    [InlineData("REMOVE-MESSAGE global Msg_1 DELETE Msg_1", ModerationCommandKind.DeleteMessage, "delete-message")]
    public void ParseModerationCommand_CanonicalizesOnlyTheAliasVerb(
        string input,
        ModerationCommandKind expectedKind,
        string expectedVerb)
    {
        var result = Parse(input);

        Assert.True(result.Success, result.Error);
        Assert.Equal(expectedKind, result.Command!.Kind);
        Assert.Equal(expectedVerb, result.Command.CanonicalVerb);
    }

    [Fact]
    public void ParseModerationCommand_PreservesIdentifierCaseAndCanonicalizesForever()
    {
        var result = Parse("timeout Room_Mixed UserABC FoReVeR CONFIRM");

        Assert.True(result.Success, result.Error);
        Assert.Equal(["Room_Mixed", "UserABC", "forever"], result.Command!.Arguments);
    }

    [Fact]
    public void ParseModerationCommand_DefaultsRoomLogToTwentyEntries()
    {
        var result = Parse("room-log Room_1");

        Assert.True(result.Success, result.Error);
        Assert.Equal(["Room_1", "20"], result.Command!.Arguments);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("unknown UserABC")]
    [InlineData("moderation-summary extra")]
    [InlineData("user-status")]
    [InlineData("user-status bad.uid")]
    [InlineData("user-rooms user/name")]
    [InlineData("room-status Room#1")]
    [InlineData("room-members Room_1 extra")]
    [InlineData("room-log Room_1 0")]
    [InlineData("room-log Room_1 51")]
    [InlineData("room-log Room_1 +1")]
    [InlineData("room-log Room_1 1.0")]
    [InlineData("ban UserABC")]
    [InlineData("ban UserABC YES")]
    [InlineData("ban UserABC CONFIRM extra")]
    [InlineData("ban bad;uid CONFIRM")]
    [InlineData("room-mute Room_1 UserABC 0 CONFIRM")]
    [InlineData("room-mute Room_1 UserABC 43201 CONFIRM")]
    [InlineData("room-mute Room_1 UserABC -1 CONFIRM")]
    [InlineData("room-mute Room_1 UserABC +1 CONFIRM")]
    [InlineData("room-mute Room_1 UserABC 1.0 CONFIRM")]
    [InlineData("room-mute Room_1 UserABC 1e3 CONFIRM")]
    [InlineData("room-mute Room_1 UserABC 999999999999999999 CONFIRM")]
    [InlineData("room-mute global UserABC 60 CONFIRM")]
    [InlineData("room-mute Room_1 UserABC 60 CONFIRM && calc")]
    [InlineData("room-unmute global UserABC CONFIRM")]
    [InlineData("room-unmute Room_1 UserABC CONFIRM;calc")]
    [InlineData("kick global UserABC CONFIRM")]
    [InlineData("kick Room_1 UserABC CONFIRM |powershell")]
    [InlineData("delete-message")]
    [InlineData("delete-message unknown Msg_1 DELETE Msg_1")]
    [InlineData("delete-message global bad/msg DELETE bad/msg")]
    [InlineData("delete-message global Msg_1 delete Msg_1")]
    [InlineData("delete-message global Msg_1 DELETE msg_1")]
    [InlineData("delete-message room Room_1 Msg_1 DELETE Msg_1 extra")]
    [InlineData("delete-message channel Room_1 general Msg_1 DELETE Msg_1")]
    [InlineData("delete-message channel Room_1 Chan#1 Msg_1 DELETE Msg_1")]
    [InlineData("delete-account UserABC delete UserABC")]
    [InlineData("delete-account UserABC DELETE userabc")]
    [InlineData("delete-account UserABC DELETE UserABC >file")]
    public void ParseModerationCommand_RejectsMalformedOrInjectionShapedInput(string? input)
    {
        var result = Parse(input);

        Assert.False(result.Success);
        Assert.Null(result.Command);
        Assert.False(string.IsNullOrWhiteSpace(result.Error));
    }

    [Fact]
    public void ParseModerationCommand_RejectsOverlongIdentifiersBeforeDispatch()
    {
        var result = Parse($"ban {new string('a', 129)} CONFIRM");

        Assert.False(result.Success);
    }

    [Fact]
    public void ParseModerationCommand_FailsClosedForUnexpectedNullTokens()
    {
        IReadOnlyList<string>[] commands =
        [
            ["room-log", null!],
            ["room-mute", "Room_1", "UserABC", null!, "CONFIRM"],
            ["delete-message", null!, "Msg_1", "DELETE", "Msg_1"],
            ["delete-message", "global", null!, "DELETE", null!],
        ];

        foreach (var command in commands)
        {
            var exception = Record.Exception(() => AnalysisAppLogic.ParseModerationCommand(command));
            Assert.Null(exception);
            Assert.False(AnalysisAppLogic.ParseModerationCommand(command).Success);
        }
    }

    [Fact]
    public void GetModerationHelpLines_ReturnsDefensiveCopyAndDocumentsSafetyRules()
    {
        var first = AnalysisAppLogic.GetModerationHelpLines();
        first[0] = "changed";
        var second = AnalysisAppLogic.GetModerationHelpLines();
        var help = string.Join('\n', second);

        Assert.NotEqual("changed", second[0]);
        Assert.Contains("moderation-summary", help);
        Assert.Contains("room-log", help);
        Assert.Contains("delete-message global", help);
        Assert.Contains("delete-message room", help);
        Assert.Contains("delete-message channel", help);
        Assert.Contains("DELETE must be uppercase", help);
        Assert.Contains("No selected by default", help);
        Assert.Contains("remove-message", help);
    }

    private static ModerationCommandParseResult Parse(string? command)
        => AnalysisAppLogic.ParseModerationCommand(AnalysisAppLogic.TokenizeCommand(command));
}

public sealed class ModerationMessagePathTests
{
    [Theory]
    [InlineData("global", null, null, "Msg_1", "/messages/Msg_1")]
    [InlineData("GLOBAL", null, null, "MixedCase", "/messages/MixedCase")]
    [InlineData("room", "Room_1", null, "Msg_1", "/rooms_data/Room_1/messages/Msg_1")]
    [InlineData("channel", "Room_1", "Channel_1", "Msg_1", "/rooms_data/Room_1/channels/Channel_1/messages/Msg_1")]
    public void BuildModerationMessagePath_MapsOnlyCanonicalMessageScopes(
        string scope,
        string? roomId,
        string? channelId,
        string messageId,
        string expected)
        => Assert.Equal(expected, AnalysisAppLogic.BuildModerationMessagePath(scope, roomId, channelId, messageId));

    [Theory]
    [InlineData("unknown", null, null, "Msg_1")]
    [InlineData("global", "Room_1", null, "Msg_1")]
    [InlineData("global", null, "Channel_1", "Msg_1")]
    [InlineData("room", null, null, "Msg_1")]
    [InlineData("room", "Room_1", "Channel_1", "Msg_1")]
    [InlineData("channel", "Room_1", null, "Msg_1")]
    [InlineData("channel", "Room_1", "general", "Msg_1")]
    [InlineData("channel", "bad/room", "Channel_1", "Msg_1")]
    [InlineData("channel", "Room_1", "bad#channel", "Msg_1")]
    [InlineData("channel", "Room_1", "Channel_1", "bad.message")]
    public void BuildModerationMessagePath_RejectsAmbiguousOrUnsafePaths(
        string scope,
        string? roomId,
        string? channelId,
        string messageId)
        => Assert.Throws<ArgumentException>(() => AnalysisAppLogic.BuildModerationMessagePath(scope, roomId, channelId, messageId));
}

public sealed class FirebaseIdentifierTests
{
    [Theory]
    [InlineData("a")]
    [InlineData("UserABC123")]
    [InlineData("user-id_123")]
    [InlineData("Ångström42")]
    public void IsValidFirebaseIdentifier_AcceptsSupportedCharacters(string identifier)
        => Assert.True(AnalysisAppLogic.IsValidFirebaseIdentifier(identifier));

    [Fact]
    public void IsValidFirebaseIdentifier_AcceptsMaximumLength()
        => Assert.True(AnalysisAppLogic.IsValidFirebaseIdentifier(new string('a', 128)));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("user name")]
    [InlineData("user.name")]
    [InlineData("user/name")]
    [InlineData("user#name")]
    [InlineData("user$name")]
    [InlineData("user[name]")]
    [InlineData("user:name")]
    [InlineData("user\nname")]
    [InlineData("user🙂")]
    public void IsValidFirebaseIdentifier_RejectsMissingOrUnsafeCharacters(string? identifier)
        => Assert.False(AnalysisAppLogic.IsValidFirebaseIdentifier(identifier));

    [Fact]
    public void IsValidFirebaseIdentifier_RejectsMoreThanMaximumLength()
        => Assert.False(AnalysisAppLogic.IsValidFirebaseIdentifier(new string('a', 129)));
}

public sealed class ApprovedOllamaModelTests
{
    [Fact]
    public void GetApprovedOllamaModels_ReturnsCanonicalProfilesInStableOrder()
    {
        var models = AnalysisAppLogic.GetApprovedOllamaModels();

        Assert.Collection(
            models,
            model =>
            {
                Assert.Equal(ApprovedOllamaModelProfile.Fast, model.Profile);
                Assert.Equal("Fast", model.DisplayName);
                Assert.Equal("qwen3:4b-instruct", model.Model);
            },
            model =>
            {
                Assert.Equal(ApprovedOllamaModelProfile.Smart, model.Profile);
                Assert.Equal("Smart", model.DisplayName);
                Assert.Equal("qwen3:14b", model.Model);
            },
            model =>
            {
                Assert.Equal(ApprovedOllamaModelProfile.Vision, model.Profile);
                Assert.Equal("Vision", model.DisplayName);
                Assert.Equal("qwen2.5vl:7b", model.Model);
            });
    }

    [Fact]
    public void GetApprovedOllamaModels_ReturnsDefensiveArrayCopy()
    {
        var first = AnalysisAppLogic.GetApprovedOllamaModels();
        first[0] = new ApprovedOllamaModelDefinition(ApprovedOllamaModelProfile.Fast, "Changed", "unsafe:latest");

        var second = AnalysisAppLogic.GetApprovedOllamaModels();

        Assert.Equal("Fast", second[0].DisplayName);
        Assert.Equal(AnalysisAppLogic.ApprovedFastModel, second[0].Model);
    }

    [Theory]
    [InlineData("qwen3:4b-instruct", ApprovedOllamaModelProfile.Fast)]
    [InlineData("qwen3:14b", ApprovedOllamaModelProfile.Smart)]
    [InlineData("qwen2.5vl:7b", ApprovedOllamaModelProfile.Vision)]
    public void TryGetApprovedOllamaModel_AcceptsOnlyCanonicalAllowlistEntries(
        string model,
        ApprovedOllamaModelProfile expectedProfile)
    {
        Assert.True(AnalysisAppLogic.TryGetApprovedOllamaModel(model, out var approved));
        Assert.NotNull(approved);
        Assert.Equal(expectedProfile, approved.Profile);
        Assert.True(AnalysisAppLogic.IsApprovedOllamaModel(model));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("llama3.1:latest")]
    [InlineData("QWEN3:14B")]
    [InlineData("qwen3:14b ")]
    [InlineData("qwen3:14b;calc")]
    [InlineData("qwen3:14b\nqwen3:4b-instruct")]
    [InlineData("qwen2.5vl:latest")]
    public void TryGetApprovedOllamaModel_RejectsAliasesAndInjectionShapedValues(string? model)
    {
        Assert.False(AnalysisAppLogic.TryGetApprovedOllamaModel(model, out var approved));
        Assert.Null(approved);
        Assert.False(AnalysisAppLogic.IsApprovedOllamaModel(model));
    }

    [Fact]
    public void SummarizeApprovedOllamaModels_ReportsNotCheckedWhileOllamaSleeps()
    {
        var summary = AnalysisAppLogic.SummarizeApprovedOllamaModels(
            [AnalysisAppLogic.ApprovedFastModel, AnalysisAppLogic.ApprovedSmartModel],
            modelsChecked: false);

        Assert.False(summary.WasChecked);
        Assert.False(summary.IsComplete);
        Assert.Equal(0, summary.ReadyCount);
        Assert.Equal("Not checked", summary.HealthText);
        Assert.Contains("wake protected Ollama", summary.DetailText);
        Assert.All(summary.Models, model => Assert.Equal(ApprovedOllamaModelState.NotChecked, model.State));
    }

    [Fact]
    public void SummarizeApprovedOllamaModels_ReportsOnlyExactApprovedModelsAsReady()
    {
        var summary = AnalysisAppLogic.SummarizeApprovedOllamaModels(
            [AnalysisAppLogic.ApprovedFastModel.ToUpperInvariant(), AnalysisAppLogic.ApprovedVisionModel, "llama3.1:latest"],
            modelsChecked: true);

        Assert.True(summary.WasChecked);
        Assert.False(summary.IsComplete);
        Assert.Equal(2, summary.ReadyCount);
        Assert.Equal(ApprovedOllamaModelState.Ready, summary.Get(ApprovedOllamaModelProfile.Fast).State);
        Assert.Equal(ApprovedOllamaModelState.Missing, summary.Get(ApprovedOllamaModelProfile.Smart).State);
        Assert.Equal(ApprovedOllamaModelState.Ready, summary.Get(ApprovedOllamaModelProfile.Vision).State);
        Assert.Equal("2 of 3 ready", summary.HealthText);
        Assert.Equal("Missing: Smart", summary.DetailText);
    }

    [Fact]
    public void SummarizeApprovedOllamaModels_ReportsMissingWhenAnAwakeOllamaHasNoModels()
    {
        var summary = AnalysisAppLogic.SummarizeApprovedOllamaModels([], modelsChecked: true);

        Assert.True(summary.WasChecked);
        Assert.Equal(0, summary.ReadyCount);
        Assert.Equal("0 of 3 ready", summary.HealthText);
        Assert.Equal("Missing: Fast, Smart, Vision", summary.DetailText);
        Assert.All(summary.Models, model => Assert.Equal(ApprovedOllamaModelState.Missing, model.State));
    }

    [Fact]
    public void SummarizeApprovedOllamaModels_ReportsCompleteOnlyWhenEveryProfileIsInstalled()
    {
        var summary = AnalysisAppLogic.SummarizeApprovedOllamaModels(
            AnalysisAppLogic.GetApprovedOllamaModels().Select(model => model.Model),
            modelsChecked: true);

        Assert.True(summary.WasChecked);
        Assert.True(summary.IsComplete);
        Assert.Equal(3, summary.ReadyCount);
        Assert.Equal("3 of 3 ready", summary.HealthText);
        Assert.Equal("Fast, Smart, and Vision models ready", summary.DetailText);
    }
}

public sealed class WebsiteAiRoutingMetadataTests
{
    [Fact]
    public void GetWebsiteAiProviderRoutes_ReturnsCanonicalWebsiteTiersInStableOrder()
    {
        var routes = AnalysisAppLogic.GetWebsiteAiProviderRoutes();

        Assert.Equal(90, AnalysisAppLogic.WebsiteAiTotalCapacity);
        Assert.Equal(AnalysisAppLogic.WebsiteAiTotalCapacity, routes.Sum(route => route.Capacity));
        Assert.Collection(
            routes,
            route =>
            {
                Assert.Equal("ollama-bridge", route.ProviderId);
                Assert.Equal("PC · Ollama", route.DisplayName);
                Assert.Equal(10, route.Capacity);
                Assert.False(route.Hosted);
                Assert.Equal(
                    [AnalysisAppLogic.ApprovedFastModel, AnalysisAppLogic.ApprovedSmartModel],
                    route.Models);
            },
            route =>
            {
                Assert.Equal("cloudflare-workers-ai", route.ProviderId);
                Assert.Equal("Cloudflare Workers AI", route.DisplayName);
                Assert.Equal(40, route.Capacity);
                Assert.True(route.Hosted);
                Assert.Equal([AnalysisAppLogic.WebsiteCloudflareModel], route.Models);
            },
            route =>
            {
                Assert.Equal("groq", route.ProviderId);
                Assert.Equal("Groq", route.DisplayName);
                Assert.Equal(40, route.Capacity);
                Assert.True(route.Hosted);
                Assert.Equal([AnalysisAppLogic.WebsiteGroqModel], route.Models);
            });
    }

    [Fact]
    public void HostedWebsiteModels_AreNeverApprovedForTheLocalOllamaRuntime()
    {
        var hostedModels = AnalysisAppLogic.GetWebsiteAiProviderRoutes()
            .Where(route => route.Hosted)
            .SelectMany(route => route.Models);

        Assert.All(hostedModels, model => Assert.False(AnalysisAppLogic.IsApprovedOllamaModel(model)));
    }

    [Fact]
    public void GetWebsiteAiProviderRoutes_ReturnsDefensiveRouteAndModelCopies()
    {
        var first = AnalysisAppLogic.GetWebsiteAiProviderRoutes();
        first[0] = new WebsiteAiProviderRoute("changed", "Changed", 999, true, ["unsafe:latest"]);
        first[1].Models[0] = "unsafe:latest";

        var second = AnalysisAppLogic.GetWebsiteAiProviderRoutes();

        Assert.Equal("ollama-bridge", second[0].ProviderId);
        Assert.Equal(10, second[0].Capacity);
        Assert.Equal(AnalysisAppLogic.WebsiteCloudflareModel, second[1].Models[0]);
    }
}

public sealed class DedicatedOllamaRuntimeTests
{
    [Fact]
    public void DedicatedRuntime_UsesIsolatedLoopbackPort()
    {
        Assert.Equal("http://127.0.0.1:11435", AnalysisAppLogic.DedicatedOllamaBaseUrl);
        Assert.Equal("127.0.0.1:11435", AnalysisAppLogic.DedicatedOllamaHost);
        Assert.DoesNotContain("11434", AnalysisAppLogic.DedicatedOllamaBaseUrl, StringComparison.Ordinal);
    }

    [Fact]
    public void GetDefaultOllamaModelStore_UsesTheUserProfileInsteadOfTrayConfiguration()
    {
        var userProfile = Path.Combine(Path.GetTempPath(), "minimalist-runtime-user");

        var modelStore = AnalysisAppLogic.GetDefaultOllamaModelStore(userProfile);

        Assert.Equal(Path.GetFullPath(Path.Combine(userProfile, ".ollama", "models")), modelStore);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    public void GetDefaultOllamaModelStore_RejectsMissingUserProfile(string? userProfile)
        => Assert.Throws<ArgumentException>(() => AnalysisAppLogic.GetDefaultOllamaModelStore(userProfile!));
}

public sealed class SanitizedLogTests
{
    [Theory]
    [InlineData("Authorization: Basic abc")]
    [InlineData("AUTHORIZATION header omitted")]
    [InlineData("Bearer abc.def.ghi")]
    [InlineData("password=hunter2")]
    [InlineData("client_SECRET loaded")]
    [InlineData("idToken refreshed")]
    [InlineData("token_count=123")]
    public void IsSensitiveLogLine_DetectsEveryMarkerCaseInsensitively(string line)
        => Assert.True(AnalysisAppLogic.IsSensitiveLogLine(line));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("Bridge started successfully")]
    [InlineData("GET /health 200")]
    [InlineData("Model qwen2.5vl:7b is ready")]
    [InlineData("Authenticated request accepted")]
    public void IsSensitiveLogLine_AllowsOrdinaryOperationalLines(string? line)
        => Assert.False(AnalysisAppLogic.IsSensitiveLogLine(line));
}

public sealed class UserDirectoryLogicTests
{
    [Fact]
    public void ResolveUsername_UsesCanonicalFallbackOrder()
    {
        Assert.Equal("directory-handle", AnalysisAppLogic.ResolveUsername(
            " directory-handle ", "Directory name", "Private name", "private-handle", "Legacy name", "Auth name", "email-name@example.com"));
        Assert.Equal("Directory name", AnalysisAppLogic.ResolveUsername(
            null, " Directory name ", "Private name", "private-handle", "Legacy name", "Auth name", "email-name@example.com"));
        Assert.Equal("Private name", AnalysisAppLogic.ResolveUsername(
            " ", null, " Private name ", "private-handle", "Legacy name", "Auth name", "email-name@example.com"));
        Assert.Equal("private-handle", AnalysisAppLogic.ResolveUsername(
            null, null, null, " private-handle ", "Legacy name", "Auth name", "email-name@example.com"));
        Assert.Equal("Legacy name", AnalysisAppLogic.ResolveUsername(
            null, null, null, null, " Legacy name ", "Auth name", "email-name@example.com"));
        Assert.Equal("Auth name", AnalysisAppLogic.ResolveUsername(
            null, null, null, null, null, " Auth name ", "email-name@example.com"));
        Assert.Equal("email-name", AnalysisAppLogic.ResolveUsername(
            null, null, null, null, null, null, " email-name@example.com "));
    }

    [Theory]
    [InlineData("single-value", "single-value")]
    [InlineData("  single-value  ", "single-value")]
    [InlineData("@example.com", "@example.com")]
    public void ResolveUsername_HandlesNonstandardEmailFallbacks(string email, string expected)
        => Assert.Equal(expected, AnalysisAppLogic.ResolveUsername(null, null, null, null, null, null, email));

    [Fact]
    public void ResolveUsername_ReturnsSafeFallbackWhenEverySourceIsBlank()
        => Assert.Equal("Unknown user", AnalysisAppLogic.ResolveUsername(null, " ", null, "\t", null, "", "  "));

    [Fact]
    public void ResolveUsername_BoundsUnexpectedlyLongProfileText()
        => Assert.Equal(new string('u', 80), AnalysisAppLogic.ResolveUsername(new string('u', 120), null, null, null, null, null, null));

    [Fact]
    public void ResolveUsername_UsesShortIdBeforeEmailFallback()
        => Assert.Equal("short-handle", AnalysisAppLogic.ResolveUsername(null, null, null, null, null, null, "email-name@example.com", " short-handle "));

    [Theory]
    [InlineData(" First\r\n\tLast ", "First Last")]
    [InlineData("Name\u202Ehidden", "Name hidden")]
    [InlineData("Name\0hidden", "Name hidden")]
    public void ResolveUsername_NormalizesWhitespaceAndUnsafeFormatting(string value, string expected)
        => Assert.Equal(expected, AnalysisAppLogic.ResolveUsername(value, null, null, null, null, null, null));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void MatchesUserDirectoryQuery_BlankQueryShowsEveryUser(string? query)
        => Assert.True(AnalysisAppLogic.MatchesUserDirectoryQuery("Taylor", "UidAbC123", query));

    [Theory]
    [InlineData("tay")]
    [InlineData("TAYLOR")]
    [InlineData("  ayl  ")]
    public void MatchesUserDirectoryQuery_MatchesUsernameCaseInsensitively(string query)
        => Assert.True(AnalysisAppLogic.MatchesUserDirectoryQuery("Taylor", "UidAbC123", query));

    [Theory]
    [InlineData("uidabc")]
    [InlineData("ABC123")]
    [InlineData("  idAbC1  ")]
    public void MatchesUserDirectoryQuery_MatchesUidCaseInsensitively(string query)
        => Assert.True(AnalysisAppLogic.MatchesUserDirectoryQuery("Taylor", "UidAbC123", query));

    [Fact]
    public void MatchesUserDirectoryQuery_RejectsUnrelatedOrMissingValues()
    {
        Assert.False(AnalysisAppLogic.MatchesUserDirectoryQuery("Taylor", "UidAbC123", "Morgan"));
        Assert.False(AnalysisAppLogic.MatchesUserDirectoryQuery(null, null, "something"));
    }
}
