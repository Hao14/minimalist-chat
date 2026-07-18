Option Explicit

Const EXIT_FILE_NOT_FOUND = 2
Const EXIT_INVALID_ARGUMENT = 87

Dim shell
Dim fileSystem
Dim scriptDirectory
Dim bridgeControlScript
Dim powerShellExecutable
Dim command
Dim exitCode

If WScript.Arguments.Count > 1 Then
  WScript.Quit EXIT_INVALID_ARGUMENT
End If

Set fileSystem = CreateObject("Scripting.FileSystemObject")
scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
bridgeControlScript = fileSystem.BuildPath(scriptDirectory, "BridgeControl.ps1")

If Not fileSystem.FileExists(bridgeControlScript) Then
  WScript.Quit EXIT_FILE_NOT_FOUND
End If

Set shell = CreateObject("WScript.Shell")
powerShellExecutable = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
If Not fileSystem.FileExists(powerShellExecutable) Then
  WScript.Quit EXIT_FILE_NOT_FOUND
End If

If WScript.Arguments.Count = 1 Then
  If StrComp(WScript.Arguments(0), "--self-test", vbBinaryCompare) <> 0 Then
    WScript.Quit EXIT_INVALID_ARGUMENT
  End If
  WScript.Quit 0
End If

command = QuoteArgument(powerShellExecutable) & _
  " -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File " & _
  QuoteArgument(bridgeControlScript) & " -Action reconcile-tunnel"

' wscript.exe has no console window, and window style 0 keeps the child hidden.
' Waiting preserves Scheduled Task overlap control and forwards the real result.
exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode

Function QuoteArgument(ByVal value)
  QuoteArgument = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
