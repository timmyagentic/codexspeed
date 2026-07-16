$ErrorActionPreference = "Stop"

$Version = "0.2.0"
$Repository = "https://github.com/timmyagentic/codexspeed"
$Architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
if ($Architecture -eq "x64") {
  $RunnerArchitecture = "x64"
} elseif ($Architecture -eq "arm64") {
  $RunnerArchitecture = "arm64"
} else {
  throw "CodexSpeed does not have a runner for this CPU architecture."
}

$Asset = "codexspeed-v$Version-windows-$RunnerArchitecture.zip"
$Release = "$Repository/releases/download/v$Version"
$Temporary = Join-Path ([System.IO.Path]::GetTempPath()) ("codexspeed-run-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $Temporary | Out-Null

try {
  $Archive = Join-Path $Temporary $Asset
  $Checksums = Join-Path $Temporary "SHA256SUMS"
  Invoke-WebRequest -UseBasicParsing -Uri "$Release/$Asset" -OutFile $Archive
  Invoke-WebRequest -UseBasicParsing -Uri "$Release/SHA256SUMS" -OutFile $Checksums
  $ChecksumLine = Get-Content $Checksums | Where-Object { $_ -match ("\s" + [regex]::Escape($Asset) + "$") } | Select-Object -First 1
  if (-not $ChecksumLine) {
    throw "CodexSpeed checksum entry is missing."
  }
  $Expected = ($ChecksumLine -split "\s+")[0].ToLowerInvariant()
  $Actual = (Get-FileHash -Algorithm SHA256 -Path $Archive).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected) {
    throw "CodexSpeed download checksum did not match."
  }

  Expand-Archive -Path $Archive -DestinationPath $Temporary
  $Launcher = Join-Path $Temporary "codexspeed\bin\codexspeed.cmd"
  if (-not (Test-Path $Launcher)) {
    throw "CodexSpeed launcher is missing from the archive."
  }
  & $Launcher @args
  if ($LASTEXITCODE -ne 0) {
    throw "CodexSpeed exited with code $LASTEXITCODE."
  }
} finally {
  Remove-Item -LiteralPath $Temporary -Recurse -Force -ErrorAction SilentlyContinue
}
