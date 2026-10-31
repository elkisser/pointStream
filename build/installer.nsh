; build/installer.nsh — personalización del instalador de PointStream.
; electron-builder lo incluye automáticamente (buildResources/installer.nsh) antes
; de MUI2, así que estos defines reemplazan los valores por defecto.
; IMPORTANTE: guardar en UTF-8 con BOM para que NSIS muestre bien las tildes.

; Paleta de la app (ui/styles.css): fondo #0B0E0F, texto blanco.
; MUI usa estos colores en la franja superior y en las páginas de bienvenida / fin.
!define MUI_BGCOLOR "0B0E0F"
!define MUI_TEXTCOLOR "FFFFFF"
!define MUI_FINISHPAGE_NOAUTOCLOSE
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "¿Seguro que querés cancelar la instalación de PointStream?"

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Bienvenido a PointStream ${VERSION}"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !define MUI_WELCOMEPAGE_TEXT "Este asistente instala PointStream en tu PC.$\r$\n$\r$\nPointStream te avisa cuando tus streamers de Kick o Twitch salen en vivo y analiza las predicciones de CS2 de Forg1 con estadísticas de HLTV, BO3.gg y el ranking oficial de Valve.$\r$\n$\r$\nPor defecto se instala solo para tu usuario, sin permisos de administrador. Tu configuración y tu vinculación con Telegram se conservan al actualizar.$\r$\n$\r$\nTocá Siguiente para continuar."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd


  !define MUI_FINISHPAGE_TITLE "PointStream está listo"
  !define MUI_FINISHPAGE_TEXT "La instalación terminó correctamente.$\r$\n$\r$\nAbrí PointStream, agregá tus streamers y conectá Telegram para recibir los picks en el celular."
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "Abrir PointStream ahora"
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW FinishPageShow
  !insertmacro MUI_PAGE_FINISH

  ; Va después de MUI_PAGE_FINISH: recién ahí MUI declara $mui.FinishPage.Run.
  ; Con estilos visuales activos, Windows ignora el color del checkbox y queda
  ; texto negro sobre fondo oscuro. Se le quita el tema para poder pintarlo.
  Function FinishPageShow
    System::Call 'UxTheme::SetWindowTheme(p $mui.FinishPage.Run, w " ", w " ")'
    SetCtlColors $mui.FinishPage.Run 0xFFFFFF 0x0B0E0F
  FunctionEnd
!macroend
