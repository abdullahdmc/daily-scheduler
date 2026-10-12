; Extra uninstall steps for the Windows installer (electron-builder NSIS include).

!macro customUnInstall
  ; Remove "open when the computer starts" so nothing is left pointing at the removed app.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Daily scheduler"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "io.github.abdullahdmc.dailyscheduler"
!macroend
