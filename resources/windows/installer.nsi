; PlutoSim Windows installer (NSIS).
;
; Built by forge.config.ts after `electron-forge make --platform=win32`, with:
;   /DVERSION=0.1.0 /DFILE_VERSION=0.1.0.334 /DBUILD=78bcd62
;   /DSOURCE_DIR=<packaged app folder> /DOUTFILE=<installer .exe> /DICON=<icon.ico>
;
; Installs for the current user, without administrator rights, into
; %LOCALAPPDATA%\Programs\PlutoSim, so it works on locked-down school machines.
; Uninstalling removes the app and its shortcuts but keeps the user's data
; (settings, sign-in, progress), which live in %APPDATA% and survive reinstalls.

Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!define PRODUCT "PlutoSim"
!define PUBLISHER "Drona Aviation"
!define EXE "PlutoSim.exe"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\PlutoSim"

Name "${PRODUCT}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${PRODUCT}"
InstallDirRegKey HKCU "Software\${PRODUCT}" "InstallDir"
BrandingText "${PRODUCT} ${VERSION} (build ${BUILD})"

VIProductVersion "${FILE_VERSION}"
VIAddVersionKey "ProductName" "${PRODUCT}"
VIAddVersionKey "CompanyName" "${PUBLISHER}"
VIAddVersionKey "FileDescription" "${PRODUCT} Setup"
VIAddVersionKey "FileVersion" "${FILE_VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "© ${PUBLISHER}"

!include "MUI2.nsh"
!include "FileFunc.nsh"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Welcome to ${PRODUCT} ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "This will install ${PRODUCT}, the drone flight simulator by ${PUBLISHER}.$\r$\n$\r$\nVersion ${VERSION}, build ${BUILD}.$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${PRODUCT}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ; Installing over a running copy would fail half way through.
  FindWindow $0 "" "${PRODUCT}"
  StrCmp $0 0 notRunning
    MessageBox MB_OK|MB_ICONEXCLAMATION "${PRODUCT} is running. Close it, then run the installer again."
    Abort
  notRunning:
FunctionEnd

Section "Install"
  SetOutPath "$INSTDIR"
  ; A clean copy: files from an older version must not linger beside the new one.
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  File /r "${SOURCE_DIR}\*.*"

  WriteUninstaller "$INSTDIR\Uninstall ${PRODUCT}.exe"
  WriteRegStr HKCU "Software\${PRODUCT}" "InstallDir" "$INSTDIR"

  CreateDirectory "$SMPROGRAMS\${PRODUCT}"
  CreateShortcut "$SMPROGRAMS\${PRODUCT}\${PRODUCT}.lnk" "$INSTDIR\${EXE}"
  CreateShortcut "$SMPROGRAMS\${PRODUCT}\Uninstall ${PRODUCT}.lnk" "$INSTDIR\Uninstall ${PRODUCT}.exe"
  CreateShortcut "$DESKTOP\${PRODUCT}.lnk" "$INSTDIR\${EXE}"

  ; Settings -> Apps & features
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${PRODUCT}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall ${PRODUCT}.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${PRODUCT}.lnk"
  RMDir /r "$SMPROGRAMS\${PRODUCT}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\${PRODUCT}"
SectionEnd

