$ErrorActionPreference = "Stop"

# Builds RPGAtlas.exe into the repo root. Double-clicking it serves the engine
# folder on http://localhost:8080/ and opens the editor — no Python/Node needed.

$root = Split-Path -Parent $PSScriptRoot
$compiler = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$iconPath = Join-Path $root "img\system\rpgatlas.ico"

if (-not (Test-Path -LiteralPath $compiler)) {
    throw "The .NET Framework C# compiler was not found at $compiler."
}

# Generate the launcher icon from the logo if it isn't built yet.
if (-not (Test-Path -LiteralPath $iconPath)) {
    $iconBuilder = Join-Path $env:TEMP "RPGAtlasIcon.exe"
    & $compiler /nologo /target:exe /optimize+ `
        /reference:System.Drawing.dll `
        /out:"$iconBuilder" `
        "$PSScriptRoot\RPGAtlasIcon.cs"
    if ($LASTEXITCODE -ne 0) { throw "The icon generator failed to compile." }
    & $iconBuilder "$iconPath"
    if ($LASTEXITCODE -ne 0) { throw "The icon could not be generated." }
    Remove-Item -LiteralPath $iconBuilder -Force -ErrorAction SilentlyContinue
}

& $compiler /nologo /target:exe /optimize+ `
    /win32icon:"$iconPath" `
    /out:"$root\RPGAtlas.exe" `
    "$PSScriptRoot\RPGAtlasEngine.cs"

if ($LASTEXITCODE -ne 0) {
    throw "RPGAtlas.exe failed to compile."
}

Write-Host "Built $root\RPGAtlas.exe"
