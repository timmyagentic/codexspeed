param(
  [Parameter(Mandatory = $true)]
  [string]$Launcher
)

$ErrorActionPreference = "Stop"
$LauncherPath = (Resolve-Path $Launcher).Path
$TestRoot = Join-Path $env:RUNNER_TEMP "codexspeed cmd smoke"
Remove-Item -LiteralPath $TestRoot -Recurse -Force -ErrorAction SilentlyContinue
$Bin = Join-Path $TestRoot "bin"
$CodexHome = Join-Path $TestRoot "codex-home"
New-Item -ItemType Directory -Path $Bin, $CodexHome | Out-Null
Set-Content -LiteralPath (Join-Path $CodexHome "auth.json") -Value "{}" -Encoding utf8NoBOM -NoNewline
$NodePath = (Get-Command node).Source
$FakeCli = (Resolve-Path packages/runner/test/fake-codex-cli.mjs).Path
$Shim = @(
  "@echo off"
  'if not "%TEMP%"=="%TMP%" exit /b 91'
  'if not "%TEMP%"=="%TMPDIR%" exit /b 92'
  'if not "%TEMP%"=="%HOME%" exit /b 93'
  'if not "%TEMP%"=="%USERPROFILE%" exit /b 94'
  "`"$NodePath`" `"$FakeCli`" run %*"
)
Set-Content -LiteralPath (Join-Path $Bin "codex.cmd") -Value $Shim -Encoding ascii

$OriginalPath = $env:PATH
$OriginalCodexHome = $env:CODEX_HOME
try {
  $env:PATH = "$Bin;$OriginalPath"
  $env:CODEX_HOME = $CodexHome
  & $LauncherPath doctor
  if ($LASTEXITCODE -ne 0) {
    throw "Windows codex.cmd doctor smoke failed."
  }
  $Result = Join-Path $TestRoot "result.json"
  & $LauncherPath measure --model gpt-test --effort medium --rounds 1 --accept-turns 2 --out $Result
  if ($LASTEXITCODE -ne 0) {
    throw "Windows codex.cmd turn smoke failed."
  }
  $Artifact = Get-Content -LiteralPath $Result -Raw | ConvertFrom-Json
  if ($Artifact.samples.Count -ne 2) {
    throw "Windows codex.cmd turn smoke wrote an invalid artifact."
  }
} finally {
  $env:PATH = $OriginalPath
  if ($null -eq $OriginalCodexHome) {
    Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue
  } else {
    $env:CODEX_HOME = $OriginalCodexHome
  }
  Remove-Item -LiteralPath $TestRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output "Windows codex.cmd portable doctor and turn smoke passed."
