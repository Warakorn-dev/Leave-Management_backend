<#
  Daily backup of uploaded files — run on the backend server (เครื่อง 2) via Task Scheduler.

  Leave attachments and profile pictures live on disk in <backend>\uploads, not in
  MySQL, so the database dump alone does not cover them.

  robocopy /E copies new and changed files and never deletes from the destination,
  so a file removed by mistake on the server is still in the backup.
  Point $DestDir at another machine (e.g. \\<IP-เครื่อง3>\LeaveBackup\uploads).
#>
param(
  [string]$SourceDir = 'C:\apps\Leave-Management_backend\uploads',
  [string]$DestDir = 'D:\LeaveBackup\uploads',
  [string]$LogFile = 'C:\apps\Leave-Management_backend\logs\backup-uploads.log'
)

New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null
robocopy $SourceDir $DestDir /E /Z /R:3 /W:10 /NP /NDL "/LOG+:$LogFile" | Out-Null

# robocopy: 0-7 = success (with or without files copied), 8+ = failure
if ($LASTEXITCODE -ge 8) { exit 1 }
exit 0
