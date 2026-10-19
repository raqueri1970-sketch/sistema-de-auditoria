# Capturador 2 - STATUS: monta uma página com o estado do capturador e abre no Chrome (atualiza sozinha a cada 30 s).
$dir  = 'C:\Users\controladoria\Documents\claude\whatapp - rl'
$html = Join-Path $dir 'atalhos\status_capturador.html'
function Enc([string]$s) { [System.Net.WebUtility]::HtmlEncode($s) }
function Gerar {
  $bot  = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*bot_v3.js*' } | Select-Object -First 1
  $laco = Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -like '*INICIAR_BOT_RL_COM_BACKUP_ENV*' } | Select-Object -First 1
  $porta = [bool](Get-NetTCPConnection -LocalPort 3456 -State Listen -ErrorAction SilentlyContinue)
  $log = Get-Content -Tail 400 (Join-Path $dir 'bot_restart26.log') -Encoding UTF8 -ErrorAction SilentlyContinue
  $conectado = ($log | Select-String 'Bot conectado|conectado!' | Select-Object -Last 1)
  $desconect = ($log | Select-String 'nao conectado|Reiniciando cliente|encerrando para reinicio' | Select-Object -Last 1)
  $okWa = $conectado -and (-not $desconect -or $conectado.LineNumber -gt $desconect.LineNumber)
  $ultObras = ($log | Select-String '\[OBRAS\].*(lancad|Lancad|comprovante)' | Select-Object -Last 1)
  $ultRL = ($log | Select-String 'DESPESA #|DEPOSITO #' | Select-Object -Last 1)
  $erros = @($log | Select-String '\[ERR\]').Count
  # 15/10/2026: com a sessao deslogada (LOGOUT/UNPAIRED) o bot grava o QR Code no log com caracteres de bloco.
  # Na lista do log ele aparecia embaralhado (entrelinha da fonte) e nao dava para escanear. Agora o ultimo QR
  # vai para um quadro proprio, com entrelinha 1, e as linhas dele saem da lista do log.
  $blocos = '[\u2580-\u259F]'
  $qrTexto = ''
  if (-not $okWa -and $log) {
    $iQr = ($log | Select-String 'Escaneie o QR Code' | Select-Object -Last 1)
    if ($iQr) {
      $qrLinhas = @(); $i = $iQr.LineNumber
      while ($i -lt $log.Count -and ($log[$i] -match $blocos -or ($qrLinhas.Count -eq 0 -and -not $log[$i].Trim()))) {
        if ($log[$i] -match $blocos) { $qrLinhas += $log[$i].TrimEnd() }
        $i++
      }
      if ($qrLinhas.Count -gt 10) {
        $recuo = ($qrLinhas | ForEach-Object { $_.Length - $_.TrimStart().Length } | Measure-Object -Minimum).Minimum
        $qrTexto = ($qrLinhas | ForEach-Object { Enc $_.Substring($recuo) }) -join "`n"
      }
    }
  }
  $qrHtml = if ($qrTexto) { "<div class='qrbox'><h3>WhatsApp desconectado: escaneie o QR Code</h3><div class='s'>No celular do numero do capturador: WhatsApp &gt; Aparelhos conectados &gt; Conectar um aparelho. O codigo muda a cada ~20 s; esta pagina se atualiza sozinha.</div><pre class='qr'>$qrTexto</pre></div>" } else { '' }
  $log = @($log | Where-Object { $_ -notmatch $blocos })
  $desde = if ($bot) { $bot.CreationDate.ToString('dd/MM HH:mm') } else { '-' }
  $card = { param($t, $v, $ok) "<div class='c $(if($ok){'ok'}else{'bad'})'><div class='l'>$t</div><div class='v'>$v</div></div>" }
  $cards = (& $card 'Capturador' $(if ($bot) { "LIGADO desde $desde" } else { 'DESLIGADO' }) ([bool]$bot)) +
           (& $card 'Reinicio automatico' $(if ($laco) { 'ATIVO' } else { 'INATIVO' }) ([bool]$laco)) +
           (& $card 'WhatsApp' $(if ($okWa) { 'CONECTADO' } else { 'VERIFICAR' }) ([bool]$okWa)) +
           (& $card 'Painel RL (porta 3456)' $(if ($porta) { 'NO AR' } else { 'FORA' }) $porta) +
           (& $card 'Erros nas ultimas 400 linhas' $erros ($erros -lt 5))
  $linhas = ($log | Select-Object -Last 60 | ForEach-Object { $c = if ($_ -match '\[ERR\]') { 'e' } elseif ($_ -match '\[AVS\]') { 'w' } else { '' }; "<div class='$c'>$(Enc $_)</div>" }) -join "`n"
  @"
<!doctype html><html lang='pt-BR'><head><meta charset='utf-8'><meta http-equiv='refresh' content='$(if ($qrTexto) { 10 } else { 30 })'><title>Capturador WhatsApp - Status</title>
<style>body{margin:0;background:#0b1020;color:#e8ecf7;font:15px Segoe UI,Arial;padding:20px}h1{font-size:22px;margin:0 0 4px}.s{color:#9aa5c4;font-size:13px}
.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin:16px 0}.c{background:#141a2e;border:1px solid #27304f;border-radius:14px;padding:14px}
.ok{border-color:#16a34a}.ok .v{color:#86efac}.bad{border-color:#dc2626}.bad .v{color:#fca5a5}.l{color:#9aa5c4;font-size:13px}.v{font-size:20px;font-weight:800;margin-top:4px}
.b{display:inline-block;margin:4px 8px 4px 0;padding:10px 14px;border-radius:10px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600}
.log{background:#05080f;border:1px solid #27304f;border-radius:12px;padding:12px;font:12px Consolas,monospace;white-space:pre-wrap;max-height:60vh;overflow:auto}.e{color:#fca5a5}.w{color:#fcd34d}
.qrbox{background:#141a2e;border:2px solid #dc2626;border-radius:14px;padding:16px;margin:16px 0;display:inline-block}.qrbox h3{margin:0 0 6px}
.qr{background:#000;color:#fff;font:14px/1 Consolas,'Courier New',monospace;letter-spacing:0;padding:24px;margin:12px 0 0;display:inline-block}</style></head>
<body><h1>Capturador WhatsApp · RL Transportes + Obras</h1><div class='s'>Atualizado $(Get-Date -Format 'dd/MM/yyyy HH:mm:ss') · esta pagina se atualiza sozinha enquanto o STATUS estiver aberto</div>
<div class='g'>$cards</div>
$qrHtml
<div class='s'>Ultimo lancamento RL: $(Enc ([string]$ultRL.Line))<br>Ultimo comprovante Obras: $(Enc ([string]$ultObras.Line))</div>
<p><a class='b' href='http://localhost:3456/'>Abrir painel RL Transportes</a></p>
<div class='s'>Para ligar ou desligar use os atalhos da area de trabalho: <b>Capturador 1 - LIGAR</b> e <b>Capturador 3 - PARAR</b>.</div>
<h3>Ultimas linhas do log</h3><div class='log'>$linhas</div></body></html>
"@ | Set-Content -Path $html -Encoding UTF8
}
New-Item -ItemType Directory -Force -Path (Split-Path $html) | Out-Null
Gerar
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (Test-Path $chrome) { Start-Process $chrome "`"$html`"" } else { Start-Process $html }
# Continua atualizando a página por 30 minutos (a página recarrega sozinha)
# (a cada 10 s: o QR Code do WhatsApp muda a cada ~20 s)
for ($n = 0; $n -lt 180; $n++) { Start-Sleep 10; Gerar }
