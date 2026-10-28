$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$debounceSeconds = 30

Set-Location $repo

$watcher = New-Object System.IO.FileSystemWatcher $repo
$watcher.IncludeSubdirectories = $true
$watcher.NotifyFilter = [System.IO.NotifyFilters]'FileName, LastWrite, DirectoryName'
$watcher.EnableRaisingEvents = $true

$global:lastChange = $null
$handler = {
    if ($Event.SourceEventArgs.FullPath -notmatch '[\\/]\.git([\\/]|$)') {
        $global:lastChange = Get-Date
    }
}
Register-ObjectEvent $watcher Changed -Action $handler | Out-Null
Register-ObjectEvent $watcher Created -Action $handler | Out-Null
Register-ObjectEvent $watcher Deleted -Action $handler | Out-Null
Register-ObjectEvent $watcher Renamed -Action $handler | Out-Null

function Sync-Repo {
    if (-not (git status --porcelain)) { return }
    git add -A
    git commit -m "Auto-update $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    git pull --rebase origin main
    git push origin main
}

while ($true) {
    Start-Sleep -Seconds 5
    if ($global:lastChange -and ((Get-Date) - $global:lastChange).TotalSeconds -ge $debounceSeconds) {
        $global:lastChange = $null
        try { Sync-Repo } catch { Write-Warning $_ }
    }
}
