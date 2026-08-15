# One-directional sync: this repo -> live scheduled-task location. This repo is the source of
# truth. Edit the .md files here, then run this script, then verify the live SKILL.md matches
# before the task's next scheduled fire. The scheduler only ever reads the live copy, so an edit
# made only here has no effect until this script runs.
$src = "$PSScriptRoot"
$dst = "$env:USERPROFILE\.claude\scheduled-tasks"

$tasks = @(
  "futures-morning-routine",
  "decision-email-routine",
  "weekly-scan-routine",
  "weekly-decision-routine",
  "tv-top-setups-report",
  "tv-mcp-archive-old-reports",
  "income-etf-weekly-routine",
  "income-etf-monthly-review-routine"
)

foreach ($task in $tasks) {
  $target = "$dst\$task"
  if (-not (Test-Path $target)) {
    New-Item -ItemType Directory -Path $target -Force | Out-Null
  }
  Copy-Item "$src\$task.md" "$target\SKILL.md" -Force
}

Write-Host "Synced $($tasks.Count) scheduled task skills to $dst"
