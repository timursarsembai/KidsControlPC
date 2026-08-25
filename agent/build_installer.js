import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import https from 'https'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(__dirname, 'dist')
const buildEnvironment = process.env.KIDSCONTROL_ENV === 'staging' ? 'staging' : 'production'
// Which backend this executable will talk to. 'firebase' unless asked
// otherwise: agents already on children's PCs update themselves from GitHub
// Releases, and a build that changed backends by accident would leave those
// machines pointed at a server they were never paired with — with no rules.
const buildBackend = process.env.KIDSCONTROL_BACKEND === 'selfhosted' ? 'selfhosted' : 'firebase'
const isStaging = buildEnvironment === 'staging'
const serviceId = isStaging ? 'KidsControlPCAgentDev' : 'KidsControlPCAgent'
const serviceName = isStaging ? 'KidsControlPC Agent Dev' : 'KidsControlPC Agent'
const installDirName = isStaging ? 'KidsControlAgentDev' : 'KidsControlAgent'
// Имя установщика различает не только dev и prod, но и бэкенд — и это не
// косметика.
//
// Агент сам обновляется: раз в два часа он смотрит последний релиз в этом
// репозитории и скачивает оттуда файл с известным ему именем. Пока обе сборки
// назывались одинаково, любой релиз раскатывался на всех: выложи сборку для
// своего сервера — и агенты боевых пользователей ушли бы на kidscontrol.kz,
// где их устройств нет; выложи боевую — и агент на своём сервере перестал бы
// видеть свой. Разные имена позволяют одному релизу нести обе сборки, и
// каждый агент берёт свою.
const outputFileName = isStaging
  ? 'KidsControlAgent_Dev_Setup.exe'
  : buildBackend === 'selfhosted'
    ? 'KidsControlAgent_SelfHosted_Setup.exe'
    : 'KidsControlAgent_Setup.exe'
const widgetTaskName = isStaging ? 'KidsControlTimerWidgetDev' : 'KidsControlTimerWidget'
const registryRunValue = isStaging ? 'KidsControlTimerWidgetDev' : 'KidsControlTimerWidget'
const uninstallKey = isStaging ? 'KidsControlAgentDev' : 'KidsControlAgent'
const pairingFileName = isStaging ? 'pairing.staging.json' : 'pairing.json'
const processCleanupScriptName = 'stop_install_dir_processes.ps1'
// Production used to just taskkill a few images by name. That never touched WinSW.exe -
// the service host itself - so "cannot open file for writing: WinSW.exe" aborted the
// install. Interactively you can hit Retry; under /S (how the updater runs) NSIS simply
// gives up, and by then the section has already run `sc delete`, leaving the machine
// with no service and no agent until someone reinstalls by hand.
// The staging script already handled this properly: stop everything running from the
// install dir, then rename the exes aside - NTFS allows renaming a running image even
// when it cannot be overwritten - so use it for both builds.
// Also drops `taskkill /F /IM node.exe`, which killed every unrelated Node process on
// the machine, including a developer's own build.
const processCleanupCommands = `  nsExec::ExecToLog 'schtasks /End /TN "${widgetTaskName}"'
  nsExec::ExecToLog 'schtasks /Delete /TN "${widgetTaskName}" /F'
  nsExec::ExecToLog 'taskkill /F /IM agent.exe'
  nsExec::ExecToLog 'taskkill /F /IM ChatTrayApp.exe'
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\\${processCleanupScriptName}" -InstallDir "$INSTDIR"'
`

// System.Speech.dll (used by TimerWidget/ReminderWidget/ScreenBlockerWidget for TTS)
// lives in different places depending on which targeting packs are installed, so
// probe instead of hardcoding. The old hardcoded v3.0 path under Program Files only
// exists on machines with legacy reference assemblies and is absent on a clean Win11.
function findSystemSpeech() {
  const roots = [
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    process.env.ProgramFiles || 'C:\\Program Files'
  ]
  const found = []

  for (const root of roots) {
    const netfx = path.join(root, 'Reference Assemblies', 'Microsoft', 'Framework', '.NETFramework')
    if (fs.existsSync(netfx)) {
      // Newest targeting pack first (v4.8 before v4.6.1).
      for (const v of fs.readdirSync(netfx).sort().reverse()) {
        const candidate = path.join(netfx, v, 'System.Speech.dll')
        if (fs.existsSync(candidate)) found.push(candidate)
      }
    }
    const legacy = path.join(root, 'Reference Assemblies', 'Microsoft', 'Framework', 'v3.0', 'System.Speech.dll')
    if (fs.existsSync(legacy)) found.push(legacy)
  }

  // Shipped with the .NET Framework runtime itself, so present even without a SDK.
  const gac = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'assembly', 'GAC_MSIL', 'System.Speech')
  if (fs.existsSync(gac)) {
    for (const v of fs.readdirSync(gac)) {
      const candidate = path.join(gac, v, 'System.Speech.dll')
      if (fs.existsSync(candidate)) found.push(candidate)
    }
  }

  if (!found.length) {
    throw new Error(
      'System.Speech.dll not found. Install the ".NET Framework 4.x Developer Pack" ' +
      'from https://dotnet.microsoft.com/download/dotnet-framework, or copy the DLL ' +
      'from another machine.'
    )
  }
  return found[0]
}

// 1. Prepare dist dir
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir)
}

/**
 * Downloads a file, following redirects.
 *
 * The write stream is opened only after the response turns out to be the file
 * itself. Opening it first — as this did — meant that on a redirect (and
 * GitHub Releases always redirects) two streams ended up writing to the same
 * path, and the outer one was never closed. On Windows that handle keeps the
 * file locked, so the build got as far as NSIS and died with
 * "File: failed opening file .\WinSW.exe" — on a clean machine every time,
 * and never on one where the file had been downloaded before.
 *
 * A non-200 is refused outright: saving an error page under the name of an
 * executable produces a build that fails much later and much less clearly.
 */
function download(url, dest, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      const { statusCode, headers } = response

      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        response.resume()
        if (redirectsLeft === 0) {
          reject(new Error(`Too many redirects downloading ${url}`))
          return
        }
        download(headers.location, dest, redirectsLeft - 1).then(resolve, reject)
        return
      }

      if (statusCode !== 200) {
        response.resume()
        reject(new Error(`Download failed with HTTP ${statusCode}: ${url}`))
        return
      }

      const file = fs.createWriteStream(dest)
      file.on('error', (err) => {
        fs.unlink(dest, () => {})
        reject(err)
      })
      response.pipe(file)
      // close() takes a callback: resolving before the handle is released
      // hands the next step a file Windows still considers busy.
      file.on('finish', () => file.close((err) => err ? reject(err) : resolve()))
    }).on('error', (err) => {
      fs.unlink(dest, () => {})
      reject(err)
    })
  })
}

async function build() {
  try {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    const version = pkg.version

    console.log('📦 1/5 Bundling agent with esbuild...')
    // Fix import.meta.url issue for CommonJS by injecting a define
    // Do NOT wrap version in single quotes inside the define, just double quotes so it becomes a string literal
    execSync(`npx esbuild src/agent.js --bundle --platform=node --target=node18 --alias:undici=./src/network/undiciShim.js --outfile=dist/agent.cjs --define:import.meta.url=\\"file://\\" --define:__APP_VERSION__="'${version}'" --define:__KIDSCONTROL_ENV__="'${buildEnvironment}'" --define:__KIDSCONTROL_BACKEND__="'${buildBackend}'"`, { stdio: 'inherit' })

    console.log('📦 2/5 Packaging to agent.exe with pkg...')
    // max-old-space-size: на компьютере, где памяти мало, V8 по умолчанию
    // считает, что ему можно занять её заметную долю, и тянет со сборкой
    // мусора до последнего. Потолок заставляет прибираться раньше, а при
    // настоящей утечке агент падает сам и его поднимает служба — это лучше,
    // чем тащить в своп всю систему.
    execSync(
      'npx pkg dist/agent.cjs -t node18-win-x64 -o dist/agent.exe --options max-old-space-size=256',
      { stdio: 'inherit' }
    )

    const speechDll = findSystemSpeech()
    console.log(`🔎 Using System.Speech from: ${speechDll}`)
    const speechRef = `/reference:"${speechDll}"`

    console.log('📦 2.5/5 Compiling TimerWidget.cs...')
    execSync(`C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe /nologo /reference:System.Web.Extensions.dll ${speechRef} /target:winexe /out:dist\\TimerWidget.exe src\\widget\\TimerWidget.cs`, { stdio: 'inherit' })

    console.log('📦 2.6/5 Compiling ReminderWidget.cs...')
    execSync(`C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe /nologo ${speechRef} /target:winexe /out:dist\\ReminderWidget.exe src\\widget\\ReminderWidget.cs`, { stdio: 'inherit' })

    console.log('📦 2.7/5 Compiling ScreenBlockerWidget.cs...')
    execSync(`C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe /nologo ${speechRef} /target:winexe /out:dist\\ScreenBlockerWidget.exe src\\widget\\ScreenBlockerWidget.cs`, { stdio: 'inherit' })

    console.log('📦 2.8/5 Compiling CustomDialogWidget.cs...')
    execSync('C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe /nologo /target:winexe /out:dist\\CustomDialogWidget.exe src\\widget\\CustomDialogWidget.cs', { stdio: 'inherit' })

    console.log('📦 2.9/5 Compiling ScreenshotHelper.cs...')
    execSync('C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe /nologo /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /target:winexe /out:dist\\ScreenshotHelper.exe src\\widget\\ScreenshotHelper.cs', { stdio: 'inherit' })

    console.log('📦 2.93/5 Getting WebView2 SDK...')
    const wv2Version = '1.0.3351.48'
    const wv2NupkgPath = path.join(distDir, 'webview2.nupkg')
    const wv2ExtractPath = path.join(distDir, 'webview2_sdk')
    const wv2CoreDll = path.join(distDir, 'Microsoft.Web.WebView2.Core.dll')
    const wv2WinFormsDll = path.join(distDir, 'Microsoft.Web.WebView2.WinForms.dll')
    const wv2LoaderDll = path.join(distDir, 'WebView2Loader.dll')
    if (!fs.existsSync(wv2CoreDll) || !fs.existsSync(wv2WinFormsDll)) {
      if (!fs.existsSync(wv2NupkgPath)) {
        console.log('  Downloading WebView2 NuGet package...')
        await download(`https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/${wv2Version}`, wv2NupkgPath)
      }
      console.log('  Extracting WebView2 DLLs...')
      if (fs.existsSync(wv2ExtractPath)) execSync(`rmdir /s /q "${wv2ExtractPath}"`, { stdio: 'pipe', shell: true })
      const wv2ZipPath = wv2NupkgPath.replace('.nupkg', '.zip')
      fs.copyFileSync(wv2NupkgPath, wv2ZipPath)
      execSync(`powershell -Command "Expand-Archive -Path '${wv2ZipPath}' -DestinationPath '${wv2ExtractPath}' -Force"`, { stdio: 'inherit' })
      fs.copyFileSync(path.join(wv2ExtractPath, 'lib', 'net462', 'Microsoft.Web.WebView2.Core.dll'), wv2CoreDll)
      fs.copyFileSync(path.join(wv2ExtractPath, 'lib', 'net462', 'Microsoft.Web.WebView2.WinForms.dll'), wv2WinFormsDll)
      fs.copyFileSync(path.join(wv2ExtractPath, 'runtimes', 'win-x64', 'native', 'WebView2Loader.dll'), wv2LoaderDll)
    }

    console.log('📦 2.95/5 Compiling ChatTrayApp.cs...')
    execSync(`C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe /nologo /win32icon:assets\\chat.ico /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:dist\\Microsoft.Web.WebView2.Core.dll /reference:dist\\Microsoft.Web.WebView2.WinForms.dll /target:winexe /out:dist\\ChatTrayApp.exe src\\widget\\ChatTrayApp.cs`, { stdio: 'inherit' })

    // app.config: preserve %2F in Firebase Storage URLs (otherwise .NET Uri unescapes
    // them to '/' and the server returns HTTP 400). Requires .NET 4.5+ at runtime.
    fs.writeFileSync(path.join(distDir, 'ChatTrayApp.exe.config'), `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <uri>
    <schemeSettings>
      <add name="https" genericUriParserOptions="DontUnescapePathDotsAndSlashes" />
      <add name="http" genericUriParserOptions="DontUnescapePathDotsAndSlashes" />
    </schemeSettings>
  </uri>
</configuration>
`)

    console.log('📦 3/5 Downloading WinSW...')
    const winswPath = path.join(distDir, 'WinSW.exe')
    if (!fs.existsSync(winswPath)) {
      await download('https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe', winswPath)
    }

    console.log('📦 4/5 Generating WinSW config and NSIS script...')
    const xml = `<service>
  <id>${serviceId}</id>
  <name>${serviceName}</name>
  <description>${serviceName}</description>
  <executable>%BASE%\\agent.exe</executable>
  <arguments>--service</arguments>
  <logmode>roll</logmode>
  <onfailure action="restart" delay="10 sec"/>
  <!-- The agent cannot handle a Windows service stop gracefully (Node gets no
       SIGTERM on Windows), so WinSW always falls through to killing it. Keep that
       wait short: a long stop makes Restart-Service hang and, worse, leaves
       agent.exe locked during a silent update, which aborts the installer after
       the service has already been deleted. -->
  <stoptimeout>5 sec</stoptimeout>
</service>`
    fs.writeFileSync(path.join(distDir, 'WinSW.xml'), xml)

    const widgetTaskScript = `
param(
  [Parameter(Mandatory=$true)]
  [string]$WidgetPath
)

$ErrorActionPreference = 'Stop'
$TaskName = '${widgetTaskName}'
$Action = New-ScheduledTaskAction -Execute $WidgetPath
$Trigger = New-ScheduledTaskTrigger -AtLogOn
# Repeat every 2 minutes indefinitely so the task acts as a watchdog.
# If TimerWidget is killed (e.g. by a silent update), it restarts within 2 min.
# MultipleInstances=IgnoreNew prevents duplicates when it is already running.
$Trigger.Repetition = (New-ScheduledTaskTrigger -Once -At '00:00' -RepetitionInterval (New-TimeSpan -Minutes 2)).Repetition
$Principal = New-ScheduledTaskPrincipal -GroupId 'S-1-5-32-545' -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
`
    fs.writeFileSync(path.join(distDir, 'register_widget_task.ps1'), widgetTaskScript)

    const stopInstallDirProcessesScript = `
param(
  [Parameter(Mandatory=$true)]
  [string]$InstallDir
)

$ErrorActionPreference = 'SilentlyContinue'
$root = [System.IO.Path]::GetFullPath($InstallDir).TrimEnd('\\\\') + '\\\\'

function Stop-ProcessInInstallDir {
  $script:stopped = 0

  Get-CimInstance Win32_Process |
    Where-Object {
      $_.ExecutablePath -and
      [System.IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)
    } |
    ForEach-Object {
      try {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        $script:stopped++
      } catch {}
    }

  Get-Process |
    Where-Object {
      try {
        $_.Path -and
        [System.IO.Path]::GetFullPath($_.Path).StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)
      } catch {
        $false
      }
    } |
    ForEach-Object {
      try {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        $script:stopped++
      } catch {}
    }

  return $script:stopped
}

for ($i = 0; $i -lt 10; $i++) {
  $count = Stop-ProcessInInstallDir
  if ($count -eq 0) { break }
  Start-Sleep -Milliseconds 500
}

# Sweep away renamed binaries left by earlier updates before creating more. agent.exe
# alone is ~43 MB, so without this every silent update permanently adds that much to
# Program Files.
Get-ChildItem -LiteralPath $root -Filter '*.old.*' -File -ErrorAction SilentlyContinue |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }

foreach ($fileName in @('agent.exe', 'WinSW.exe', 'ChatTrayApp.exe', 'TimerWidget.exe', 'ReminderWidget.exe', 'ScreenBlockerWidget.exe', 'CustomDialogWidget.exe', 'ScreenshotHelper.exe')) {
  $filePath = Join-Path $root $fileName
  if (Test-Path $filePath) {
    try {
      Rename-Item -LiteralPath $filePath -NewName "$fileName.old.$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())" -Force -ErrorAction SilentlyContinue
    } catch {}
  }
}

Start-Sleep -Milliseconds 1000
`
    fs.writeFileSync(path.join(distDir, processCleanupScriptName), stopInstallDirProcessesScript)

    const nsi = `
!include "MUI2.nsh"
Name "${serviceName}"
OutFile "${outputFileName}"
InstallDir "$PROGRAMFILES64\\${installDirName}"
RequestExecutionLevel admin

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!define MUI_LANGDLL_REGISTRY_ROOT "HKCU"
!define MUI_LANGDLL_REGISTRY_KEY "Software\\KidsControlPCAgent"
!define MUI_LANGDLL_REGISTRY_VALUENAME "Installer Language"
!define MUI_LANGDLL_ALWAYSSHOW

!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Russian"

!insertmacro MUI_RESERVEFILE_LANGDLL

Function .onInit
  !insertmacro MUI_LANGDLL_DISPLAY
FunctionEnd

Section "Install"
  SetOutPath "$INSTDIR"
  File "${processCleanupScriptName}"
  
  ; Stop service if exists
  nsExec::ExecToLog '"$INSTDIR\\WinSW.exe" stop'
  nsExec::ExecToLog '"$INSTDIR\\WinSW.exe" uninstall'
  
  ; Force stop and delete old node-windows service just in case
  nsExec::ExecToLog 'net stop ${serviceId}'
  nsExec::ExecToLog 'sc delete ${serviceId}'
${processCleanupCommands}
  
  ; Delete old node-windows files
  RMDir /r "$INSTDIR\\daemon"
  Delete "$INSTDIR\\agent.js"
  
  File "agent.exe"
  File "TimerWidget.exe"
  File "ReminderWidget.exe"
  File "ScreenBlockerWidget.exe"
  File "CustomDialogWidget.exe"
  File "ScreenshotHelper.exe"
  File "ChatTrayApp.exe"
  File "ChatTrayApp.exe.config"
  File "Microsoft.Web.WebView2.Core.dll"
  File "Microsoft.Web.WebView2.WinForms.dll"
  File "WebView2Loader.dll"
  File "WinSW.exe"
  File "WinSW.xml"
  File "register_widget_task.ps1"
  
  ; Install service
  nsExec::ExecToLog '"$INSTDIR\\WinSW.exe" install'
  ; Start immediately at boot. Parental controls must not wait for delayed auto-start.
  nsExec::ExecToLog 'sc config ${serviceId} start= auto'
  nsExec::ExecToLog 'sc failure ${serviceId} reset= 60 actions= restart/10000/restart/30000/restart/60000'
  nsExec::ExecToLog 'sc failureflag ${serviceId} 1'
  
  ; Add ChatTrayApp to Run registry for all users (HKLM) — starts to tray at logon
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "KidsControlChatTray" '"$INSTDIR\\ChatTrayApp.exe" --tray'

  ; Add TimerWidget to Run registry for all users (HKLM)
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "${registryRunValue}" '"$INSTDIR\\TimerWidget.exe"'
  ; Also add an interactive logon scheduled task for the visible widget.
  ; Group principal keeps it visible in the active user session even after silent service updates.
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\\register_widget_task.ps1" -WidgetPath "$INSTDIR\\TimerWidget.exe"'
  
  ; Run agent.exe once to trigger pairing code prompt in foreground
  ExecWait '"$INSTDIR\\agent.exe"'

  ; Start service in background after pairing
  nsExec::ExecToLog '"$INSTDIR\\WinSW.exe" start'
  
  ; Restart TimerWidget for the current interactive user
  nsExec::ExecToLog 'schtasks /Run /TN "${widgetTaskName}"'

  ; Start ChatTrayApp immediately for the current user (also autostarts at logon via Run key)
  Exec '"$INSTDIR\\ChatTrayApp.exe"'

  ; Shortcuts for the messenger, visible to all users (parental-control context)
  SetShellVarContext all
  CreateShortcut "$DESKTOP\\KidsControlPC Chat.lnk" "$INSTDIR\\ChatTrayApp.exe" "" "$INSTDIR\\ChatTrayApp.exe" 0
  CreateDirectory "$SMPROGRAMS\\KidsControlPC"
  CreateShortcut "$SMPROGRAMS\\KidsControlPC\\KidsControlPC Chat.lnk" "$INSTDIR\\ChatTrayApp.exe" "" "$INSTDIR\\ChatTrayApp.exe" 0
  
  ; Create uninstaller
  WriteUninstaller "$INSTDIR\\uninstall.exe"
  
  ; Add to Windows Add/Remove Programs
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${uninstallKey}" "DisplayName" "${serviceName}"
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${uninstallKey}" "UninstallString" '"$INSTDIR\\uninstall.exe"'
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${uninstallKey}" "QuietUninstallString" '"$INSTDIR\\uninstall.exe" /S'
SectionEnd

Section "Uninstall"
  ; Stop and uninstall service
  nsExec::ExecToLog '"$INSTDIR\\WinSW.exe" stop'
  nsExec::ExecToLog '"$INSTDIR\\WinSW.exe" uninstall'

  ; Remove messenger shortcuts (all users)
  SetShellVarContext all
  Delete "$DESKTOP\\KidsControlPC Chat.lnk"
  Delete "$SMPROGRAMS\\KidsControlPC\\KidsControlPC Chat.lnk"
  RMDir "$SMPROGRAMS\\KidsControlPC"
  
  ; Delete files
  Delete "$INSTDIR\\agent.exe"
  Delete "$INSTDIR\\TimerWidget.exe"
  Delete "$INSTDIR\\ReminderWidget.exe"
  Delete "$INSTDIR\\ScreenBlockerWidget.exe"
  Delete "$INSTDIR\\CustomDialogWidget.exe"
  Delete "$INSTDIR\\ScreenshotHelper.exe"
  Delete "$INSTDIR\\ChatTrayApp.exe"
  Delete "$INSTDIR\\ChatTrayApp.exe.config"
  Delete "$INSTDIR\\Microsoft.Web.WebView2.Core.dll"
  Delete "$INSTDIR\\Microsoft.Web.WebView2.WinForms.dll"
  Delete "$INSTDIR\\WebView2Loader.dll"
  Delete "$INSTDIR\\WinSW.exe"
  Delete "$INSTDIR\\WinSW.xml"
  Delete "$INSTDIR\\register_widget_task.ps1"
  Delete "$INSTDIR\\${processCleanupScriptName}"
  Delete "$INSTDIR\\${pairingFileName}"
  Delete "$INSTDIR\\uninstall.exe"
  
  ; Remove directory
  RMDir /r "$INSTDIR"
  
  ; Remove registry keys
  DeleteRegKey HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${uninstallKey}"
  DeleteRegValue HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "${registryRunValue}"
  DeleteRegValue HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "KidsControlChatTray"
  nsExec::ExecToLog 'schtasks /Delete /TN "${widgetTaskName}" /F'
SectionEnd
`
    fs.writeFileSync(path.join(distDir, 'installer.nsi'), nsi)

    console.log('📦 5/5 Compiling NSIS Installer...')
    
    function findMakensis(dir) {
      if (!fs.existsSync(dir)) return null;
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
          const res = findMakensis(fullPath);
          if (res) return res;
        } else if (file.toLowerCase() === 'makensis.exe') {
          return fullPath;
        }
      }
      return null;
    }
    
    // Standard installer locations first (winget/choco/manual install all land here),
    // then the electron-builder cache and the repo-local copy, then PATH. The old
    // default embedded one machine's user profile, which is useless anywhere else.
    const searchDirs = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NSIS'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'NSIS'),
      process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', 'nsis')
        : null,
      path.join(__dirname, '..', '.local-tools', 'NSIS')
    ].filter(Boolean)

    let makensisExe = null
    for (const dir of searchDirs) {
      makensisExe = findMakensis(dir)
      if (makensisExe) break
    }
    if (makensisExe) console.log(`🔎 Using makensis from: ${makensisExe}`)
    else {
      console.log('⚠️ makensis.exe not found in the usual places — falling back to PATH')
      makensisExe = 'makensis'
    }
    
    execSync(`"${makensisExe}" dist/installer.nsi`, { stdio: 'inherit' })

    console.log(`✅ Done! Installer created at dist/${outputFileName}`)
  } catch (err) {
    console.error('❌ Build failed:', err.message)
    process.exit(1)
  }
}

build()
