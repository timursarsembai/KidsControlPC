import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import https from 'https'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(__dirname, 'dist')

// 1. Prepare dist dir
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir)
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        return download(response.headers.location, dest).then(resolve).catch(reject)
      }
      response.pipe(file)
      file.on('finish', () => {
        file.close()
        resolve()
      })
    }).on('error', (err) => {
      fs.unlink(dest, () => {})
      reject(err)
    })
  })
}

async function build() {
  try {
    console.log('📦 1/5 Bundling agent with esbuild...')
    // Fix import.meta.url issue for CommonJS by injecting a define
    execSync('npx esbuild src/agent.js --bundle --platform=node --target=node18 --outfile=dist/agent.cjs --define:import.meta.url=\\"file://\\" ', { stdio: 'inherit' })

    console.log('📦 2/5 Packaging to agent.exe with pkg...')
    execSync('npx pkg dist/agent.cjs -t node18-win-x64 -o dist/agent.exe', { stdio: 'inherit' })

    console.log('📦 2.5/5 Compiling TimerWidget.cs...')
    execSync('C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe /nologo /reference:"C:\\Program Files\\Reference Assemblies\\Microsoft\\Framework\\v3.0\\System.Speech.dll" /target:winexe /out:dist\\TimerWidget.exe src\\widget\\TimerWidget.cs', { stdio: 'inherit' })

    console.log('📦 2.6/5 Compiling ReminderWidget.cs...')
    execSync('C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe /nologo /reference:"C:\\Program Files\\Reference Assemblies\\Microsoft\\Framework\\v3.0\\System.Speech.dll" /target:winexe /out:dist\\ReminderWidget.exe src\\widget\\ReminderWidget.cs', { stdio: 'inherit' })

    console.log('📦 3/5 Downloading WinSW...')
    const winswPath = path.join(distDir, 'WinSW.exe')
    if (!fs.existsSync(winswPath)) {
      await download('https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe', winswPath)
    }

    console.log('📦 4/5 Generating WinSW config and NSIS script...')
    const xml = `<service>
  <id>KidsControlPCAgent</id>
  <name>KidsControlPCAgent</name>
  <description>KidsControlPC Child Agent</description>
  <executable>%BASE%\\agent.exe</executable>
  <arguments>--service</arguments>
  <logmode>roll</logmode>
  <onfailure action="restart" delay="10 sec"/>
</service>`
    fs.writeFileSync(path.join(distDir, 'WinSW.xml'), xml)

    const nsi = `
!include "MUI2.nsh"
Name "KidsControlPC Agent"
OutFile "KidsControlAgent_Setup.exe"
InstallDir "$PROGRAMFILES64\\KidsControlAgent"
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
  
  ; Stop service if exists
  nsExec::ExecToLog '"$INSTDIR\\WinSW.exe" stop'
  nsExec::ExecToLog '"$INSTDIR\\WinSW.exe" uninstall'
  
  ; Force stop and delete old node-windows service just in case
  nsExec::ExecToLog 'net stop kidscontrolpcagent'
  nsExec::ExecToLog 'sc delete kidscontrolpcagent'
  nsExec::ExecToLog 'taskkill /F /IM TimerWidget.exe'
  nsExec::ExecToLog 'taskkill /F /IM ReminderWidget.exe'
  nsExec::ExecToLog 'taskkill /F /IM node.exe'
  
  ; Delete old node-windows files
  RMDir /r "$INSTDIR\\daemon"
  Delete "$INSTDIR\\agent.js"
  
  File "agent.exe"
  File "TimerWidget.exe"
  File "ReminderWidget.exe"
  File "WinSW.exe"
  File "WinSW.xml"
  
  ; Install service
  nsExec::ExecToLog '"$INSTDIR\\WinSW.exe" install'
  
  ; Add TimerWidget to Run registry for all users (HKLM)
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "KidsControlTimerWidget" '"$INSTDIR\\TimerWidget.exe"'
  
  ; Run agent.exe once to trigger pairing code prompt in foreground
  ExecWait '"$INSTDIR\\agent.exe"'

  ; Start service in background after pairing
  nsExec::ExecToLog '"$INSTDIR\\WinSW.exe" start'
  
  ; Restart TimerWidget for the current user
  Exec 'explorer.exe "$INSTDIR\\TimerWidget.exe"'
  
  ; Create uninstaller
  WriteUninstaller "$INSTDIR\\uninstall.exe"
  
  ; Add to Windows Add/Remove Programs
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\KidsControlAgent" "DisplayName" "KidsControlPC Agent"
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\KidsControlAgent" "UninstallString" '"$INSTDIR\\uninstall.exe"'
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\KidsControlAgent" "QuietUninstallString" '"$INSTDIR\\uninstall.exe" /S'
SectionEnd

Section "Uninstall"
  ; Stop and uninstall service
  nsExec::ExecToLog '"$INSTDIR\\WinSW.exe" stop'
  nsExec::ExecToLog '"$INSTDIR\\WinSW.exe" uninstall'
  
  ; Delete files
  Delete "$INSTDIR\\agent.exe"
  Delete "$INSTDIR\\TimerWidget.exe"
  Delete "$INSTDIR\\ReminderWidget.exe"
  Delete "$INSTDIR\\WinSW.exe"
  Delete "$INSTDIR\\WinSW.xml"
  Delete "$INSTDIR\\pairing.json"
  Delete "$INSTDIR\\uninstall.exe"
  
  ; Remove directory
  RMDir /r "$INSTDIR"
  
  ; Remove registry keys
  DeleteRegKey HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\KidsControlAgent"
  DeleteRegValue HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "KidsControlTimerWidget"
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
    
    const nsisCache = path.join(process.env.LOCALAPPDATA || 'C:\\\\Users\\\\Timsar\\\\AppData\\\\Local', 'electron-builder', 'Cache', 'nsis')
    let makensisExe = findMakensis(nsisCache) || 'makensis'
    
    execSync(`"${makensisExe}" dist/installer.nsi`, { stdio: 'inherit' })

    console.log('✅ Done! Installer created at dist/KidsControlAgent_Setup.exe')
  } catch (err) {
    console.error('❌ Build failed:', err.message)
    process.exit(1)
  }
}

build()
