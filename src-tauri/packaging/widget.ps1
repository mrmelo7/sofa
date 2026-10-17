# Installs or repairs Sofa's Xbox Game Bar widget (run elevated: the loopback exemption needs
# admin). Called by home-app.ps1 on every install and update; an unchanged widget is kept.
# Every step goes to Sofa's diagnostics log so a failed install is visible in the app.
param([string]$LogPath = "$env:APPDATA\com.sofa.app\sofa.log")
$ErrorActionPreference = 'Continue'

function Log([string]$Message) {
  $seconds = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  New-Item (Split-Path $LogPath) -ItemType Directory -Force -ErrorAction SilentlyContinue | Out-Null
  Add-Content -Path $LogPath -Value "$seconds widget: $Message" -ErrorAction SilentlyContinue
}
function FirstLine($ErrorRecord) { "$($ErrorRecord.Exception.Message)".Split("`n")[0].Trim() }

# The version inside an .msix (a zip with AppxManifest.xml at its root).
function PackageVersion([string]$Path) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
  try {
    $reader = New-Object System.IO.StreamReader($zip.GetEntry('AppxManifest.xml').Open())
    try { ([xml]$reader.ReadToEnd()).Package.Identity.Version } finally { $reader.Dispose() }
  } finally { $zip.Dispose() }
}

# Game Bar and the widget's own process (with its WebView2) keep the package files open.
function StopWidget($Installed) {
  Get-Process -Name GameBar, GameBarFTServer, GameBarPresenceWriter, Sofa.Widget -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
  if ($Installed) {
    Get-Process -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -and $_.Path.StartsWith($Installed.InstallLocation, [StringComparison]::OrdinalIgnoreCase) } |
      Stop-Process -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
}

$dir = Join-Path $PSScriptRoot 'widget'
if (-not (Test-Path "$dir\Sofa.Widget.msix")) {
  $siblings = (Get-ChildItem $PSScriptRoot -Name -ErrorAction SilentlyContinue) -join ', '
  Log "package not found at $dir\Sofa.Widget.msix (script folder has: $siblings)"
  exit 1
}

# Most Sofa updates don't change the widget (its version only moves when widget/ does). The same
# version, already registered and healthy, stays: reinstalling it meant closing Game Bar and
# replacing files in use, which failed and could drop the widget from Game Bar's bar.
$installed = Get-AppxPackage -Name Sofa.Widget -ErrorAction SilentlyContinue
$bundled = $null
try { $bundled = PackageVersion "$dir\Sofa.Widget.msix" } catch { Log "bundled version unreadable: $(FirstLine $_)" }
if ($installed -and $bundled -and "$($installed.Version)" -eq "$bundled" -and "$($installed.Status)" -eq 'Ok') {
  Log "already installed $bundled; Game Bar left running"
  CheckNetIsolation.exe LoopbackExempt -a -n="$($installed.PackageFamilyName)" | Out-Null
  Log "loopback exemption: exit $LASTEXITCODE"
  if ($LASTEXITCODE -ne 0) { exit 1 }
  exit 0
}
Log "installing $bundled over $(if ($installed) { "$($installed.Version) ($($installed.Status))" } else { 'nothing' })"

# Dependencies one at a time: one that Windows already has in a newer version must not fail the
# whole install (passing them all with -DependencyPath did).
foreach ($dependency in Get-ChildItem "$dir\Dependencies\*.appx" -ErrorAction SilentlyContinue) {
  try {
    Add-AppxPackage -Path $dependency.FullName -ErrorAction Stop
    Log "dependency installed: $($dependency.Name)"
  } catch {
    Log "dependency skipped: $($dependency.Name): $(FirstLine $_)"
  }
}

try {
  # Repair also works when home-app registration stopped before trusting the certificate.
  $certificate = Join-Path $PSScriptRoot 'sofa-identity.cer'
  $thumb = (Get-PfxCertificate $certificate -ErrorAction Stop).Thumbprint
  if (-not (Get-ChildItem Cert:\LocalMachine\TrustedPeople | Where-Object Thumbprint -eq $thumb)) {
    Import-Certificate -FilePath $certificate -CertStoreLocation Cert:\LocalMachine\TrustedPeople -ErrorAction Stop | Out-Null
  }
} catch {
  Log "certificate failed: $(FirstLine $_)"
  exit 1
}
# Game Bar keeps the previous widget loaded; the package can't be replaced while it runs
# (HRESULT 0x80073D02). Windows starts it again on the next Win+G. One retry after closing
# everything again covers a process that was still shutting down. A first install replaces
# nothing, so Game Bar stays open: a running Game Bar sees the new widget arrive and applies
# FavoriteAfterInstall (pinned to its bar) and ActivateAfterInstall from the manifest.
$done = $false
foreach ($attempt in 1, 2) {
  if ($installed -or $attempt -gt 1) { StopWidget $installed }
  try {
    Add-AppxPackage -Path "$dir\Sofa.Widget.msix" -ForceUpdateFromAnyVersion -ForceApplicationShutdown -ErrorAction Stop
    $done = $true
    break
  } catch {
    Log "install attempt $attempt failed: $(FirstLine $_)"
    # The same version with different contents (a rebuilt package) is blocked as already
    # installed (0x80073CFB); removing the registered copy lets the next attempt install.
    if ("$_" -match '0x80073CFB' -and $installed) {
      Remove-AppxPackage -Package $installed.PackageFullName -ErrorAction SilentlyContinue
      Log "removed $($installed.Version) blocking the reinstall"
      $installed = $null
    }
  }
}
if (-not $done) {
  $left = Get-AppxPackage -Name Sofa.Widget -ErrorAction SilentlyContinue
  Log "install failed; registered now: $(if ($left) { "$($left.Version) ($($left.Status))" } else { 'nothing' })"
  exit 1
}
$package = Get-AppxPackage -Name Sofa.Widget
if (-not $package) {
  Log 'package registration not found after installation'
  exit 1
}
Log "installed $($package.Version) ($($package.Status))"

# UWP apps can't reach 127.0.0.1 (Sofa's HUD server) without this exemption.
CheckNetIsolation.exe LoopbackExempt -a -n="$($package.PackageFamilyName)" | Out-Null
Log "loopback exemption: exit $LASTEXITCODE"
if ($LASTEXITCODE -ne 0) { exit 1 }
exit 0
