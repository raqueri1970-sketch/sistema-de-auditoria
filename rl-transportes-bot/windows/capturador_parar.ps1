# Capturador 3 - PARAR: desliga o capturador (o laço que reinicia, o node e o Chrome da sessão). A sessão do WhatsApp NÃO é apagada.
$r = Read-Host "Desligar o capturador WhatsApp? Comprovantes que chegarem ficam para a varredura quando religar. (S/N)"
if ($r -notmatch '^[sS]') { 'Nada foi feito.'; Start-Sleep 3; exit }
$laco = Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -like '*INICIAR_BOT_RL_COM_BACKUP_ENV*' }
$bot  = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*bot_v3.js*' }
$chr  = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*whatapp - rl*wwebjs_auth*' }
@($laco) + @($bot) + @($chr) | Where-Object { $_ } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
"Desligado ($(@($laco).Count) laco, $(@($bot).Count) bot, $(@($chr).Count) chrome). Para religar: Capturador 1 - LIGAR."
Start-Sleep 5
