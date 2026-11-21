#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Единственный разрешённый путь коммита, тега и пуша в этом воркспейсе.

.DESCRIPTION
  Гейт структуры (processPolicy=fail) отклоняет прямой git commit/push/merge/rebase
  в оболочке. Эта обёртка делает проверку покрытия путей ДО git через сторож
  воркспейса docs/subagent-workflow/scripts/task-guard.mjs и только потом
  коммитит, ставит тег и пушит.

.EXAMPLE
  pwsh -File tools/commit.ps1 "feat: ..." -Tag v0.1.0 -Push
#>
param(
  [Parameter(Mandatory = $false, Position = 0)][string]$Message = '',
  [switch]$DryRun,
  [switch]$Push,
  [string]$Tag = '',
  [string]$DeleteTag = ''
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

if ($DeleteTag -ne '') {
  $existing = @(git tag --list $DeleteTag)
  if ($existing.Count -eq 0) { Write-Host ('ТЕГ ' + $DeleteTag + ' НЕ НАЙДЕН') -ForegroundColor Red; exit 8 }
  git tag -d $DeleteTag
  if ($LASTEXITCODE -ne 0) { Write-Host 'УДАЛЕНИЕ ТЕГА ЗАВЕРШИЛОСЬ ОШИБКОЙ.' -ForegroundColor Red; exit 5 }
  if ($Push) {
    git -c core.hooksPath=.git/empty-hooks push origin (':' + 'refs/tags/' + $DeleteTag)
    if ($LASTEXITCODE -ne 0) { Write-Host 'git push (тег) завершился ошибкой.' -ForegroundColor Red; exit 7 }
    Write-Host 'ЗАПУШЕНО.' -ForegroundColor Green
  }
  Write-Host ('ТЕГ ' + $DeleteTag + ' УДАЛЁН.') -ForegroundColor Green
  exit 0
}

$staged = @(git diff --cached --name-only --diff-filter=ACMRTD)
if ($staged.Count -eq 0 -and -not $Push -and $Tag -eq '') {
  Write-Host 'КОММИТ НЕ НУЖЕН: индекс пуст. Сначала: git add <пути>' -ForegroundColor Yellow
  exit 2
}

if ($staged.Count -gt 0) {
  if ($Message -eq '') { Write-Host 'НУЖНО СООБЩЕНИЕ КОММИТА (позиционный аргумент).' -ForegroundColor Red; exit 2 }
  $guard = Join-Path $repo 'docs/subagent-workflow/scripts/task-guard.mjs'
  if (-not (Test-Path $guard)) { Write-Host "ГЕЙТ НЕ НАЙДЕН: $guard — коммит запрещён." -ForegroundColor Red; exit 3 }
  Write-Host ('task-guard: проверяю ' + $staged.Count + ' путей в индексе...')
  node $guard --staged --message $Message
  if ($LASTEXITCODE -ne 0) { Write-Host 'КОММИТ ОТКЛОНЁН: пути не покрыты активным заданием.' -ForegroundColor Red; exit 1 }
  if ($DryRun) { Write-Host 'ПРОВЕРКА ПРОЙДЕНА (dry run): коммит не сделан.' -ForegroundColor Green; exit 0 }
  git -c core.hooksPath=.git/empty-hooks commit -m $Message
  if ($LASTEXITCODE -ne 0) { Write-Host 'git commit завершился ошибкой.' -ForegroundColor Red; exit 4 }
  Write-Host 'КОММИТ СОЗДАН.' -ForegroundColor Green
}

if ($Tag -ne '') {
  git tag $Tag
  if ($LASTEXITCODE -ne 0) { Write-Host 'git tag завершился ошибкой.' -ForegroundColor Red; exit 5 }
  Write-Host ('ТЕГ ' + $Tag + ' ПОСТАВЛЕН.') -ForegroundColor Green
}

if ($Push) {
  git -c core.hooksPath=.git/empty-hooks push origin HEAD
  if ($LASTEXITCODE -ne 0) { Write-Host 'git push (ветка) завершился ошибкой.' -ForegroundColor Red; exit 6 }
  if ($Tag -ne '') {
    git -c core.hooksPath=.git/empty-hooks push origin $Tag
    if ($LASTEXITCODE -ne 0) { Write-Host 'git push (тег) завершился ошибкой.' -ForegroundColor Red; exit 7 }
  }
  Write-Host 'ЗАПУШЕНО.' -ForegroundColor Green
}
exit 0
