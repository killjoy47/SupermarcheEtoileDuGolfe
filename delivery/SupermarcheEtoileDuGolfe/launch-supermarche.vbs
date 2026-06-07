Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "cmd /c """ & baseDir & "\start-shopdesk.cmd"""

' Run hidden and do not wait for process exit.
shell.Run cmd, 0, False
