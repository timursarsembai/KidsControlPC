$startApps = Get-StartApps
$appx = Get-AppxPackage -User $env:USERNAME
$uwpApps = @()

foreach ($sa in $startApps) {
    if ($sa.AppID -match "!") {
        $pfn = ($sa.AppID -split "!")[0]
        $pkg = $appx | Where-Object { $_.PackageFamilyName -eq $pfn } | Select-Object -First 1
        if ($pkg) {
            $uwpApps += [PSCustomObject]@{
                DisplayName = $sa.Name
                InstallLocation = $pkg.InstallLocation
                Publisher = $pkg.Publisher
                DisplayVersion = $pkg.Version
            }
        }
    }
}
$uwpApps | Select-Object -First 5
