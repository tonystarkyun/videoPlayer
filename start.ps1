param(
  [int]$Port = 8765,
  [string]$Title,
  [string]$VideoPath,
  [string]$MarkdownPath,
  [string]$VttPath
)

function Get-RelativeWebPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BaseDirectory,
    [Parameter(Mandatory = $true)]
    [string]$TargetPath
  )

  $resolvedBase = [System.IO.Path]::GetFullPath($BaseDirectory)
  if (-not $resolvedBase.EndsWith('\')) {
    $resolvedBase += '\'
  }

  $resolvedTarget = [System.IO.Path]::GetFullPath($TargetPath)
  $baseUri = [System.Uri]::new($resolvedBase)
  $targetUri = [System.Uri]::new($resolvedTarget)
  return [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($targetUri).ToString())
}

function Update-ProjectConfig {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,
    [Parameter(Mandatory = $true)]
    [string]$ProjectDirectory,
    [string]$ProjectTitle,
    [string]$ProjectVideoPath,
    [string]$ProjectMarkdownPath,
    [string]$ProjectVttPath
  )

  if (Test-Path -LiteralPath $ConfigPath) {
    $config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } else {
    $config = [pscustomobject]@{}
  }

  if ($ProjectVideoPath) {
    $config | Add-Member -NotePropertyName videoPath -NotePropertyValue (Get-RelativeWebPath -BaseDirectory $ProjectDirectory -TargetPath $ProjectVideoPath) -Force
  }

  if ($ProjectMarkdownPath) {
    $config | Add-Member -NotePropertyName markdownPath -NotePropertyValue (Get-RelativeWebPath -BaseDirectory $ProjectDirectory -TargetPath $ProjectMarkdownPath) -Force
  }

  if ($ProjectVttPath) {
    $config | Add-Member -NotePropertyName vttPath -NotePropertyValue (Get-RelativeWebPath -BaseDirectory $ProjectDirectory -TargetPath $ProjectVttPath) -Force
  } elseif ($ProjectMarkdownPath) {
    $derivedVttPath = [System.IO.Path]::ChangeExtension((Resolve-Path -LiteralPath $ProjectMarkdownPath).Path, ".vtt")
    $config | Add-Member -NotePropertyName vttPath -NotePropertyValue (Get-RelativeWebPath -BaseDirectory $ProjectDirectory -TargetPath $derivedVttPath) -Force
  }

  if (-not $ProjectTitle) {
    if ($ProjectMarkdownPath) {
      $ProjectTitle = [System.IO.Path]::GetFileNameWithoutExtension((Resolve-Path -LiteralPath $ProjectMarkdownPath).Path)
    } elseif ($ProjectVideoPath) {
      $ProjectTitle = [System.IO.Path]::GetFileNameWithoutExtension((Resolve-Path -LiteralPath $ProjectVideoPath).Path)
    }
  }

  if ($ProjectTitle) {
    $config | Add-Member -NotePropertyName title -NotePropertyValue $ProjectTitle -Force
  }

  $json = $config | ConvertTo-Json -Depth 5
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($ConfigPath, $json + [System.Environment]::NewLine, $utf8NoBom)
}

$projectDir = $PSScriptRoot
$root = Split-Path -Parent $projectDir
$configPath = Join-Path $projectDir "project.config.json"
$url = "http://127.0.0.1:$Port/subtitle-player/index.html"
$node = (Get-Command node -ErrorAction Stop).Source
$python = (Get-Command python -ErrorAction Stop).Source
$exporter = Join-Path $projectDir "export-default-vtt.mjs"
$serverScript = Join-Path $projectDir "serve.py"

if ($Title -or $VideoPath -or $MarkdownPath -or $VttPath) {
  Update-ProjectConfig `
    -ConfigPath $configPath `
    -ProjectDirectory $projectDir `
    -ProjectTitle $Title `
    -ProjectVideoPath $VideoPath `
    -ProjectMarkdownPath $MarkdownPath `
    -ProjectVttPath $VttPath
}

& $node $exporter

$listening = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($listening) {
  $owner = $listening | Select-Object -First 1 -ExpandProperty OwningProcess
  Write-Host "Port $Port is already in use by process $owner."
  Write-Host "Stop the existing process first, then rerun this script."
  return
}

$server = Start-Process `
  -FilePath $python `
  -ArgumentList $serverScript, "--port", $Port `
  -WorkingDirectory $root `
  -PassThru

Start-Sleep -Milliseconds 900
Start-Process $url

Write-Host "Player URL: $url"
Write-Host "Server PID: $($server.Id)"
Write-Host "Stop command: Stop-Process -Id $($server.Id)"
