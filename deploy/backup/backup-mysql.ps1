<#
  Daily MySQL backup — run on the database server (เครื่อง 3) via Task Scheduler.

  Credentials are read from an option file so the password never appears on the
  command line or in Task Scheduler. Create it once (see DEPLOYMENT.md):
    C:\LeaveBackup\mysql-backup.cnf
      [client]
      user=backup
      password=<BACKUP_PASSWORD>

  Output: <BackupDir>\leave_management_yyyyMMdd_HHmmss.zip, kept for $RetentionDays days,
  optionally copied to $OffsiteDir (e.g. a network share on another machine).
#>
param(
  [string]$BackupDir = 'C:\LeaveBackup\mysql',
  [string]$OffsiteDir = '',
  [int]$RetentionDays = 30,
  [string]$Database = 'leave_management',
  [string]$OptionFile = 'C:\LeaveBackup\mysql-backup.cnf',
  [string]$MysqlDump = 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe'
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$logFile = Join-Path $BackupDir 'backup.log'
function Write-Log($msg) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Add-Content -Path $logFile -Encoding utf8 }

try {
  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $sqlFile = Join-Path $BackupDir "${Database}_$stamp.sql"
  $zipFile = "$sqlFile" -replace '\.sql$', '.zip'

  # --result-file (not '>') so the dump stays UTF-8; PowerShell 5.1 redirection writes UTF-16.
  & $MysqlDump "--defaults-extra-file=$OptionFile" --single-transaction --routines --triggers --events `
    --no-tablespaces --default-character-set=utf8mb4 "--result-file=$sqlFile" $Database
  if ($LASTEXITCODE -ne 0) { throw "mysqldump exited with code $LASTEXITCODE" }

  Compress-Archive -Path $sqlFile -DestinationPath $zipFile -Force
  Remove-Item $sqlFile
  $sizeMb = [math]::Round((Get-Item $zipFile).Length / 1MB, 2)
  Write-Log "OK $zipFile ($sizeMb MB)"

  if ($OffsiteDir) {
    New-Item -ItemType Directory -Force -Path $OffsiteDir | Out-Null
    Copy-Item $zipFile $OffsiteDir
    Write-Log "Copied to $OffsiteDir"
  }

  Get-ChildItem $BackupDir -Filter "${Database}_*.zip" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } |
    Remove-Item
}
catch {
  Write-Log "FAILED $_"
  exit 1
}
