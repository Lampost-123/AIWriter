# Phase 1 A/B on DeepSeek Flash: every scenario with the overhaul's switches off, then on, then a side-by-side
# comparison with the Phase 0 baseline. Paid: about $0.50-0.80 a run, each capped at $1.50. Uses the DeepSeek key
# saved in the Windows user environment (DEEPSEEK_API_KEY). Results go to ..\AIWriter-chat-results\phase1\<name>-<time>.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$out = '..\AIWriter-chat-results\phase1'
$off = "$out\deepseek-all-off-$stamp"
$on = "$out\deepseek-all-on-$stamp"
$switches = 'CONTRACT', 'ROUTE', 'TOOLCHOICE', 'ANCHOR', 'HISTORY', 'TEMP', 'ASKUSER', 'DRAFT' | ForEach-Object { '--env'; "AIWRITE_EXP_CHAT_$_=on" }

$env:AIWRITE_CHAT_EVAL_PAID = 'yes'
Get-ChildItem Env: | Where-Object Name -like 'AIWRITE_EXP_CHAT_*' | ForEach-Object { Remove-Item "Env:$($_.Name)" }
try {
  Write-Host "`n== 1 of 3: switches OFF ==" -ForegroundColor Cyan
  node tests\chat-eval\cli.mjs --backend deepseek --scenarios all --max-usd 1.50 --label p1-off --out $off
  Write-Host "`n== 2 of 3: switches ON ==" -ForegroundColor Cyan
  node tests\chat-eval\cli.mjs --backend deepseek --scenarios all --max-usd 1.50 --label p1-on @switches --out $on
  Write-Host "`n== 3 of 3: comparison ==" -ForegroundColor Cyan
  node tests\chat-eval\cli.mjs --compare ..\AIWriter-chat-results\phase0\deepseek-flash-baseline $off $on --out "$out\deepseek-compare-$stamp"
  Write-Host "`nDone. Tell Claude: the A/B finished." -ForegroundColor Green
} finally {
  Remove-Item Env:AIWRITE_CHAT_EVAL_PAID -ErrorAction SilentlyContinue
}
