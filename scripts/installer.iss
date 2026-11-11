; WinWidget 安装包（Inno Setup 6）
;
; 由 scripts/package-windows.ps1 调用 ISCC 编译，四个参数用 /D 传入：
;   /DAppVersion=1.0.0
;   /DStageDir=<dist\stage\WinWidget-1.0.0-windows-x64>
;   /DOutputDir=<dist>
;   /DBaseName=WinWidget-1.0.0-setup
;   /DIconFile=<assets\logo.ico>
;
; 装完之后的样子：
;   %LOCALAPPDATA%\WinWidget\winwidget.exe + assets\（组件、SDK、主题、控制中心、文档）
;   桌面 / 开始菜单快捷方式、卸载项（不需要管理员权限）
; 用户数据仍在 %APPDATA%\WinWidget（配置、组件、存储），升级和卸载都不动它。
;
; 为什么装到 per-user 目录而不是 Program Files：应用内更新会直接拉起这个 setup.exe，
; 装到 Program Files 就需要 UAC，更新流程会被弹窗打断。

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef StageDir
  #define StageDir "..\dist\stage\WinWidget-1.0.0-windows-x64"
#endif
#ifndef OutputDir
  #define OutputDir "..\dist"
#endif
#ifndef BaseName
  #define BaseName "WinWidget-" + AppVersion + "-setup"
#endif
#ifndef IconFile
  #define IconFile "..\assets\logo.ico"
#endif

[Setup]
; AppId 固定不变：升级时按同一个 Id 覆盖安装，不会出现两份
AppId={{6E2F1A34-7B59-4C2D-9E8A-3B4C5D6E7F81}
AppName=WinWidget
AppVersion={#AppVersion}
AppVerName=WinWidget {#AppVersion}
AppPublisher=Demon1110
AppPublisherURL=https://github.com/Demon1110/WinWidget
AppSupportURL=https://github.com/Demon1110/WinWidget/issues
AppUpdatesURL=https://github.com/Demon1110/WinWidget/releases
DefaultDirName={localappdata}\WinWidget
DefaultGroupName=WinWidget
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename={#BaseName}
SetupIconFile={#IconFile}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\winwidget.exe
UninstallDisplayName=WinWidget
; 应用自己是个单实例托盘程序，Restart Manager 不一定能把它请出去，
; 所以在 PrepareToInstall 里直接结束进程（见文件末尾的 [Code]）。
CloseApplications=no

[Messages]
SetupWindowTitle=安装 WinWidget %1
WelcomeLabel1=欢迎安装 [name]
WelcomeLabel2=这会把 [name/ver] 装到您的电脑上。%n%n正在运行的 WinWidget 会被自动关闭，装完后可以重新启动它。
SelectDirDesc=要装到哪里？
SelectDirLabel3=安装程序会把 [name] 装进下面这个文件夹。
ReadyLabel1=安装程序已经准备好，可以开始安装 [name]。
ReadyLabel2a=按“安装”开始，或按“上一步”再改一遍选项。
InstallingLabel=正在安装 [name]，请稍候…
FinishedHeadingLabel=[name] 安装完成
FinishedLabel=安装完成。桌面组件和设置在 %APPDATA%\WinWidget，升级和卸载都不会动它。
ClickNext=下一步
ButtonNext=下一步 >
ButtonBack=< 上一步
ButtonInstall=安装
ButtonFinish=完成
ButtonCancel=取消
ButtonBrowse=浏览…
ConfirmUninstall=确定要移除 [name] 吗？%n%n桌面组件和设置（%APPDATA%\WinWidget）会保留。
UninstallStatusLabel=正在移除 [name]…

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "在桌面创建快捷方式"; GroupDescription: "附加任务："; Flags: unchecked

[Files]
Source: "{#StageDir}\winwidget.exe"; DestDir: "{app}"; Flags: ignoreversion
; 资源整棵跟着走：组件、SDK、主题、控制中心、开发文档都从 exe 旁边的 assets\ 读
Source: "{#StageDir}\assets\*"; DestDir: "{app}\assets"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageDir}\README.md"; DestDir: "{app}"; Flags: ignoreversion isreadme
Source: "{#StageDir}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\WinWidget"; Filename: "{app}\winwidget.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\WinWidget"; Filename: "{app}\winwidget.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\winwidget.exe"; WorkingDir: "{app}"; Description: "启动 WinWidget"; Flags: nowait postinstall skipifsilent

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  { 更新时旧版本正在跑，文件会被占用；先结束它（没有在跑也无所谓） }
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM winwidget.exe /F /T', '',
       SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(500);
  Result := '';
end;
