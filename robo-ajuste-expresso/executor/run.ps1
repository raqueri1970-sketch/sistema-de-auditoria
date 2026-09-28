# Liga o Executor 24h (precisa rodar na sessao interativa do Windows, com o Seta aberto na loja do pedido).
# Para parar com seguranca: crie o arquivo STOP nesta pasta (o Executor termina o pedido atual e sai).
Set-Location $PSScriptRoot
if (Test-Path STOP) { Remove-Item STOP }
python executor.py --loop
