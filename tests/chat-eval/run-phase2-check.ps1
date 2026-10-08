# Phase 2 check on DeepSeek Flash: every scenario with today's defaults (all switches on, the new answer format
# included), compared with the Phase 1 all-on run. Paid: about $0.70, capped at $1.50. Uses the DeepSeek key saved in
# the Windows user environment (DEEPSEEK_API_KEY). Results go to ..\AIWriter-chat-results\phase2\<name>-<time>.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$out = '..\AIWriter-chat-results\phase2'
$run = "$out\deepseek-p2-$stamp"
$p1 = Get-ChildItem '..\AIWriter-chat-results\phase1' -Directory -Filter 'deepseek-all-on-*' | Sort-Object Name | Select-Object -Last 1

$env:AIWRITE_CHAT_EVAL_PAID = 'yes'
Get-ChildItem Env: | Where-Object Name -like 'AIWRITE_EXP_CHAT_*' | ForEach-Object { Remove-Item "Env:$($_.Name)" }
try {
  Write-Host "`n== 1 of 2: Phase 2 defaults ==" -ForegroundColor Cyan
  node tests\chat-eval\cli.mjs --backend deepseek --scenarios all --max-usd 1.50 --label p2 --out $run
  Write-Host "`n== 2 of 2: comparison with Phase 1 ==" -ForegroundColor Cyan
  node tests\chat-eval\cli.mjs --compare $p1.FullName $run --out "$out\deepseek-compare-p2-$stamp"
  Write-Host "`nDone. Tell Claude: the Phase 2 check finished." -ForegroundColor Green
} finally {
  Remove-Item Env:AIWRITE_CHAT_EVAL_PAID -ErrorAction SilentlyContinue
}
