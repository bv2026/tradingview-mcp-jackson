$src = "$PSScriptRoot"
$dst = "$env:USERPROFILE\.claude\scheduled-tasks"

Copy-Item "$src\futures-morning-routine.md"  "$dst\futures-morning-routine\SKILL.md"  -Force
Copy-Item "$src\decision-email-routine.md"   "$dst\decision-email-routine\SKILL.md"   -Force

Write-Host "Synced scheduled task skills to $dst"
