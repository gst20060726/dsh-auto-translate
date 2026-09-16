' open-dashboard.vbs -- regenerate the snapshot, then open dashboard.html in the browser
' Kept pure ASCII: this file is read by wscript under the system ANSI codepage.
Option Explicit
Dim sh, fso, root, url, browser
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
root = fso.GetParentFolderName(root)
sh.CurrentDirectory = root
' regenerate the snapshot (hidden window, wait until done)
sh.Run "cmd.exe /c node ""scripts\dashboard.mjs""", 0, True
url = "file:///" & Replace(root & "\dashboard.html", "\", "/")
sh.Run """C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"" --app=""" & url & """", 1, False

