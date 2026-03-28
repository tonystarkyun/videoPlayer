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

function Get-PythonLaunchSpec {
  $candidates = New-Object System.Collections.Generic.List[object]
  $seen = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)

  $pyCommand = Get-Command py -ErrorAction SilentlyContinue
  if ($pyCommand) {
    try {
      $resolvedFromPy = (& $pyCommand.Source -3 -c "import sys; print(sys.executable)" 2>$null | Select-Object -Last 1).Trim()
      if ($resolvedFromPy -and (Test-Path -LiteralPath $resolvedFromPy) -and $seen.Add($resolvedFromPy)) {
        $candidates.Add(
          [pscustomobject]@{
            FilePath = $resolvedFromPy
            PrefixArgs = @()
            Label = "py -3 -> $resolvedFromPy"
          }
        )
      }
    } catch {
    }
  }

  foreach ($path in (& where.exe python 2>$null)) {
    if (-not $path) {
      continue
    }

    if ($path -like "*\Microsoft\WindowsApps\python.exe") {
      continue
    }

    if ($seen.Add($path)) {
      $candidates.Add(
        [pscustomobject]@{
          FilePath = $path
          PrefixArgs = @()
          Label = $path
        }
      )
    }
  }

  foreach ($candidate in $candidates) {
    $probeArgs = @()
    if ($candidate.PrefixArgs) {
      $probeArgs += $candidate.PrefixArgs
    }
    $probeArgs += @("-c", "import sys; print(sys.executable)")

    try {
      $null = & $candidate.FilePath @probeArgs 2>$null
      if ($LASTEXITCODE -eq 0) {
        return $candidate
      }
    } catch {
      continue
    }
  }

  throw "No usable Python interpreter was found. Install Python 3 or make 'py -3' available."
}

$projectDir = $PSScriptRoot
$root = Split-Path -Parent $projectDir
$configPath = Join-Path $projectDir "project.config.json"
$projectName = Split-Path -Leaf $projectDir
$projectWebName = [System.Uri]::EscapeDataString($projectName)
$url = "http://127.0.0.1:$Port/$projectWebName/index.html"
$node = (Get-Command node -ErrorAction Stop).Source
$python = Get-PythonLaunchSpec
$exporter = Join-Path $projectDir "export-default-vtt.mjs"
$serverScript = Join-Path $projectDir "serve.py"
$stdoutLog = Join-Path $projectDir "server.stdout.log"
$stderrLog = Join-Path $projectDir "server.stderr.log"

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

Remove-Item -LiteralPath $stdoutLog, $stderrLog -ErrorAction SilentlyContinue

$serverArgs = @()
if ($python.PrefixArgs) {
  $serverArgs += $python.PrefixArgs
}
$serverArgs += @($serverScript, "--port", $Port, "--root", $root)

$server = Start-Process `
  -FilePath $python.FilePath `
  -ArgumentList $serverArgs `
  -WorkingDirectory $root `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru

Start-Sleep -Milliseconds 900
$server.Refresh()
$listening = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue

if ($server.HasExited -or -not $listening) {
  Write-Host "Server failed to start."
  Write-Host "Python launcher: $($python.Label)"
  Write-Host "Stdout log: $stdoutLog"
  Write-Host "Stderr log: $stderrLog"

  if (Test-Path -LiteralPath $stderrLog) {
    $stderrText = (Get-Content -LiteralPath $stderrLog -Raw -ErrorAction SilentlyContinue).Trim()
    if ($stderrText) {
      Write-Host "stderr:"
      Write-Host $stderrText
    }
  }

  if (Test-Path -LiteralPath $stdoutLog) {
    $stdoutText = (Get-Content -LiteralPath $stdoutLog -Raw -ErrorAction SilentlyContinue).Trim()
    if ($stdoutText) {
      Write-Host "stdout:"
      Write-Host $stdoutText
    }
  }

  return
}

Start-Process $url

Write-Host "Player URL: $url"
Write-Host "Server PID: $($server.Id)"
Write-Host "Stop command: Stop-Process -Id $($server.Id)"
