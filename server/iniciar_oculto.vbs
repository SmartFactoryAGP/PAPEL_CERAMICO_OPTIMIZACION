' =========================================================
'   Lanza iniciar_oculto.bat TOTALMENTE OCULTO (sin ninguna
'   ventana, ni siquiera un parpadeo) — esto es lo que hay que
'   apuntar en el Programador de tareas de Windows, NO el .bat
'   directo (un .bat directo igual muestra la consola un instante).
' =========================================================
Set WshShell = CreateObject("WScript.Shell")
carpeta = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = carpeta
WshShell.Run """" & carpeta & "\iniciar_oculto.bat""", 0, False
