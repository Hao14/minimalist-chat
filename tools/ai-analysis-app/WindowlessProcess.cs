using System.Diagnostics;

namespace MinimalistAIAnalysis;

internal sealed record FirebaseCliRuntime(
    string NodeExecutable,
    string FirebaseCliScript,
    string RuntimeDirectory)
{
    public IReadOnlyList<string> CreateArguments(IEnumerable<string> arguments, string project)
    {
        ArgumentNullException.ThrowIfNull(arguments);
        ArgumentException.ThrowIfNullOrWhiteSpace(project);
        var result = new List<string> { FirebaseCliScript };
        result.AddRange(arguments);
        result.AddRange(["--project", project, "--non-interactive"]);
        return result;
    }

    public IReadOnlyDictionary<string, string?> CreateEnvironment()
    {
        var currentPath = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        var path = string.IsNullOrWhiteSpace(currentPath)
            ? RuntimeDirectory
            : $"{RuntimeDirectory}{Path.PathSeparator}{currentPath}";
        return new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase)
        {
            ["FIREBASE_SKIP_UPDATE_CHECK"] = "true",
            ["PATH"] = path,
        };
    }
}

internal static class FirebaseCliLocator
{
    public static FirebaseCliRuntime Resolve(string repoRoot)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(repoRoot);
        var normalizedRoot = Path.GetFullPath(repoRoot);
        var nodeCandidates = new List<(Version Version, string Executable, string Directory)>();
        foreach (var toolsRoot in new[]
        {
            Path.Combine(normalizedRoot, ".deploy-tools"),
            Path.Combine(normalizedRoot, ".tools"),
        })
        {
            if (!Directory.Exists(toolsRoot)) continue;
            foreach (var directory in Directory.EnumerateDirectories(toolsRoot, "node-v22.*-win-x64", SearchOption.TopDirectoryOnly))
            {
                var executable = Path.Combine(directory, "node.exe");
                if (!File.Exists(executable)) continue;
                var directoryName = Path.GetFileName(directory);
                var versionText = directoryName["node-v".Length..^"-win-x64".Length];
                var version = Version.TryParse(versionText, out var parsed) ? parsed : new Version(22, 0);
                nodeCandidates.Add((version, executable, directory));
            }
        }

        var node = nodeCandidates
            .OrderByDescending(candidate => candidate.Version)
            .ThenBy(candidate => candidate.Executable, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault();
        if (string.IsNullOrWhiteSpace(node.Executable))
            throw new FileNotFoundException("Node 22 helper is missing. Expected a node-v22.*-win-x64 folder under .deploy-tools or .tools.");

        var firebaseCandidates = new List<string>
        {
            Path.Combine(normalizedRoot, "node_modules", "firebase-tools", "lib", "bin", "firebase.js"),
        };
        var roamingAppData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        if (!string.IsNullOrWhiteSpace(roamingAppData))
            firebaseCandidates.Add(Path.Combine(roamingAppData, "npm", "node_modules", "firebase-tools", "lib", "bin", "firebase.js"));
        var firebaseCli = firebaseCandidates.FirstOrDefault(File.Exists);
        if (firebaseCli is null)
            throw new FileNotFoundException($"Firebase CLI is missing. Run 'npm install' from {normalizedRoot} or install firebase-tools globally.");

        return new FirebaseCliRuntime(node.Executable, firebaseCli, node.Directory);
    }
}

internal static class WindowlessProcess
{
    public static ProcessStartInfo CreateStartInfo(
        string fileName,
        IEnumerable<string> arguments,
        IReadOnlyDictionary<string, string?>? environment = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(fileName);
        ArgumentNullException.ThrowIfNull(arguments);
        var startInfo = new ProcessStartInfo(fileName)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            ErrorDialog = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var argument in arguments) startInfo.ArgumentList.Add(argument);
        if (environment is not null)
        {
            foreach (var entry in environment)
            {
                if (entry.Value is null) startInfo.Environment.Remove(entry.Key);
                else startInfo.Environment[entry.Key] = entry.Value;
            }
        }
        return startInfo;
    }

    public static string[] PowerShellScriptArguments(string script, params string[] arguments)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(script);
        return
        [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            script,
            .. arguments,
        ];
    }
}
