; NSIS 설치 프로그램에 끼워 넣는 단계 (tauri.conf.json의 bundle.windows.nsis.installerHooks)
; 이 파일은 UTF-8 BOM으로 저장해야 한글이 깨지지 않는다.
;
; Tauri는 바로가기·프로그램 목록 이름을 productName(영문 DeskCalendar)으로 만든다.
; 예전 설치판처럼 '데스크 캘린더'로 보이게 설치가 끝난 뒤 이름을 바꾼다.
; (바로가기를 이름만 바꾸므로 알림에 필요한 AppUserModelID 정보는 그대로 남는다)

!define KO_NAME "데스크 캘린더"

!macro NSIS_HOOK_POSTINSTALL
  ${If} ${FileExists} "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    Delete "$SMPROGRAMS\${KO_NAME}.lnk"
    Rename "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$SMPROGRAMS\${KO_NAME}.lnk"
  ${EndIf}
  ${If} ${FileExists} "$DESKTOP\${PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${KO_NAME}.lnk"
    Rename "$DESKTOP\${PRODUCTNAME}.lnk" "$DESKTOP\${KO_NAME}.lnk"
  ${EndIf}
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "${KO_NAME}"
!macroend

; 업데이트 중에는 바로가기를 남긴다 (Tauri 기본 동작과 같게)
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    Delete "$SMPROGRAMS\${KO_NAME}.lnk"
    Delete "$DESKTOP\${KO_NAME}.lnk"
  ${EndIf}
!macroend
