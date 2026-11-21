<#
  dsh-kanban-board: генерация и подпись проектных семантических якорей.
  Владелец запускает сам; агент не подписывает (манифест якорей, И1).

  Запуск из УЖЕ ЗАПУЩЕННОГО PowerShell (без нового процесса):
    & "C:\Users\Goryachev\Documents\deepseek-harness\dsh-kanban-board\tools\sign-anchors.ps1"

  Или через обёртку (двойной клик / cmd):
    "C:\Users\Goryachev\Documents\deepseek-harness\dsh-kanban-board\tools\run-sign-anchors.cmd"

  Что делает:
   1) keygen human-ключа в C:\Users\Goryachev\.wf-keys\anchors (если ключа нет);
   2) добавляет public key в docs\subagent-workflow\acceptors.json (kind=human);
   3) считает sha256(docs\anchors.json);
   4) пишет docs\anchors.approval.json (version, anchors, algo, hash, bytes, layer, enforcedBy, by, at, note);
   5) подписывает approval ключом через docs\subagent-workflow\scripts\sign.mjs;
   6) проверяет подпись и прогоняет anchor-freshness --project.
#>

$ErrorActionPreference = 'Stop'

$Root      = 'C:\Users\Goryachev\Documents\deepseek-harness\dsh-kanban-board'
$Anchors   = Join-Path $Root 'docs\anchors.json'
$Approval  = Join-Path $Root 'docs\anchors.approval.json'
$Acceptors = Join-Path $Root 'docs\subagent-workflow\acceptors.json'
$SignMjs   = Join-Path $Root 'docs\subagent-workflow\scripts\sign.mjs'
$CheckMjs  = Join-Path $Root 'docs\subagent-workflow\checks\anchor-freshness.mjs'
$KeysDir   = 'C:\Users\Goryachev\.wf-keys\anchors'
$KeyId     = 'human-owner'
$Priv      = Join-Path $KeysDir ($KeyId + '.key.pem')
$Pub       = Join-Path $KeysDir ($KeyId + '.pub.pem')

foreach ($f in @($Anchors, $Acceptors, $SignMjs, $CheckMjs)) {
  if (-not (Test-Path $f)) { throw ('нет файла: ' + $f) }
}

# node: сначала PATH, затем известные установки. .node-path сюда НЕ подходит:
# там путь к DeepSeek Harness.exe, а не к node.
$Node = $null
foreach ($candidate in @('node', 'C:\Users\Goryachev\NodeJs 25.4\node.exe')) {
  $g = Get-Command $candidate -ErrorAction SilentlyContinue
  if ($g) { $Node = $g.Source; break }
}
if (-not $Node) { throw 'node не найден: добавьте node в PATH или укажите полный путь в переменной $Node' }
Write-Host ('node: ' + $Node)

# 1) ключ
if (-not (Test-Path $Priv)) {
  New-Item -ItemType Directory -Force -Path $KeysDir | Out-Null
  & $Node $SignMjs keygen --id $KeyId --out-dir $KeysDir
  if ($LASTEXITCODE -ne 0) { throw 'keygen: ключ не создан' }
  if (-not (Test-Path $Priv)) { throw ('keygen не создал ' + $Priv) }
  Write-Host ('ключ создан: ' + $KeysDir)
} else {
  Write-Host ('ключ уже есть: ' + $Priv)
}
$pubPem = (Get-Content $Pub -Raw).Trim()

# 2) acceptors
$acc = Get-Content $Acceptors -Raw | ConvertFrom-Json
$has = @($acc.acceptors | Where-Object { $_.keyId -eq $KeyId }).Count -gt 0
if (-not $has) {
  $fpOut = & $Node $SignMjs fingerprint --public $Pub
  if ($LASTEXITCODE -ne 0) { throw 'fingerprint: не удалось' }
  $fp = ($fpOut | Select-Object -Last 1).Trim()
  $entry = [pscustomobject]@{
    keyId = $KeyId
    kind = 'human'
    owner = 'owner'
    publicKeyPem = $pubPem
    createdAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
    fingerprint = $fp
  }
  $acc.acceptors = @($acc.acceptors) + $entry
  ($acc | ConvertTo-Json -Depth 10) | Set-Content -Path $Acceptors -Encoding utf8
  Write-Host ('acceptors: добавлен human-ключ ' + $KeyId)
} else {
  Write-Host ('acceptors: human-ключ ' + $KeyId + ' уже есть')
}

# 3) hash (SHA256 через .NET: Get-FileHash может быть недоступен в урезанной сессии)
$sha = [System.Security.Cryptography.SHA256]::Create()
$fs = [System.IO.File]::OpenRead($Anchors)
try { $hashBytes = $sha.ComputeHash($fs) } finally { $fs.Dispose(); $sha.Dispose() }
$hash = -join ($hashBytes | ForEach-Object { $_.ToString('x2') })
$bytes = (Get-Item $Anchors).Length

# 4) approval draft
$record = [ordered]@{
  version = 1
  anchors = 'docs/anchors.json'
  algo = 'sha256'
  hash = $hash
  bytes = $bytes
  layer = 'project'
  enforcedBy = 'nodes'
  by = @('owner')
  at = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
  note = 'Проектные якоря dsh-kanban-board: утверждение владельца.'
}
($record | ConvertTo-Json -Depth 10) | Set-Content -Path $Approval -Encoding utf8

# 5) sign
& $Node $SignMjs sign --file $Approval --key $Priv --id $KeyId
if ($LASTEXITCODE -ne 0) { throw 'sign: подпись не создана' }

# 6) verify + check
& $Node $SignMjs verify --file $Approval --public $Pub
if ($LASTEXITCODE -ne 0) { throw 'verify: подпись не сходится' }
& $Node $CheckMjs --project $Root
if ($LASTEXITCODE -ne 0) { throw 'anchor-freshness: проектные якоря не прошли проверку' }
Write-Host ('готово: ' + $Approval)
