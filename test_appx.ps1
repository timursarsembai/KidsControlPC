Get-AppxPackage -User $env:USERNAME | Where-Object { $_.IsFramework -eq $false -and $_.NonRemovable -eq $false } | Select-Object Name, InstallLocation | Select -First 10
