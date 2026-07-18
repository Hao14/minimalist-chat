using System.Runtime.InteropServices;

namespace MinimalistAIAnalysis.Agent;

internal interface IRecoveryTaskReader
{
    RemoteRecoveryTaskStatusV1 Read();
}

internal sealed class WindowsRecoveryTaskReader : IRecoveryTaskReader
{
    private const string RecoveryTaskName = "Minimalist Chat Public Gateway Recovery";
    private const int FileNotFoundHResult = unchecked((int)0x80070002);
    private const int TaskNotFoundHResult = unchecked((int)0x8004130F);

    public RemoteRecoveryTaskStatusV1 Read()
    {
        object? service = null;
        object? folder = null;
        object? registeredTask = null;
        try
        {
            var serviceType = Type.GetTypeFromProgID("Schedule.Service")
                ?? throw new InvalidOperationException();
            service = Activator.CreateInstance(serviceType) ?? throw new InvalidOperationException();
            dynamic scheduler = service;
            scheduler.Connect();
            folder = scheduler.GetFolder("\\");
            registeredTask = ((dynamic)folder).GetTask(RecoveryTaskName);
            dynamic task = registeredTask;
            if (!string.Equals((string)task.Name, RecoveryTaskName, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException();
            var state = (int)task.State;
            var lastRun = NormalizeLastRun((DateTime)task.LastRunTime);
            var lastResult = unchecked((uint)(int)task.LastTaskResult);
            return new RemoteRecoveryTaskStatusV1(
                RecoveryTaskName,
                Installed: true,
                Enabled: (bool)task.Enabled,
                StateName(state, (bool)task.Enabled, lastRun, lastResult),
                $"0x{lastResult:X8}",
                lastRun);
        }
        catch (COMException error) when (error.HResult is FileNotFoundHResult or TaskNotFoundHResult)
        {
            return new RemoteRecoveryTaskStatusV1(
                RecoveryTaskName, Installed: false, Enabled: false, "not_installed", null, null);
        }
        catch
        {
            return new RemoteRecoveryTaskStatusV1(
                RecoveryTaskName, Installed: null, Enabled: false, "unavailable", null, null);
        }
        finally
        {
            Release(registeredTask);
            Release(folder);
            Release(service);
        }
    }

    private static string StateName(int state, bool enabled, DateTimeOffset? lastRun, uint lastResult)
    {
        if (!enabled || state == 1) return "disabled";
        return state switch
        {
            4 => "running",
            2 => "queued",
            3 when lastRun is null => "waiting",
            3 when lastResult == 0 => "ready",
            3 => "needs_attention",
            _ => "needs_attention",
        };
    }

    private static DateTimeOffset? NormalizeLastRun(DateTime value)
    {
        if (value <= new DateTime(1900, 1, 1)) return null;
        var local = value.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(value, DateTimeKind.Local) : value;
        return new DateTimeOffset(local).ToUniversalTime();
    }

    private static void Release(object? value)
    {
        if (value is not null && Marshal.IsComObject(value)) Marshal.FinalReleaseComObject(value);
    }
}
