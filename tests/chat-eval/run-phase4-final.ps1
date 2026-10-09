# Phase 4 final check on DeepSeek Flash: every scenario (all sets) with today's defaults, compared with the Phase 3
# final run. Paid: about $0.70, capped at $1.20. Uses the DeepSeek key saved in the Windows user environment
# (DEEPSEEK_API_KEY). Results go to ..\AIWriter-chat-results\phase4\<name>-<time>.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$out = '..\AIWriter-chat-results\phase4'
$run = "$out\deepseek-p4final-$stamp"
$p3 = Get-ChildItem '..\AIWriter-chat-results\phase3' -Directory -Filter 'deepseek-p3final-*' | Sort-Object Name | Select-Object -Last 1

$env:AIWRITE_CHAT_EVAL_PAID = 'yes'
Get-ChildItem Env: | Where-Object Name -like 'AIWRITE_EXP_CHAT_*' | ForEach-Object { Remove-Item "Env:$($_.Name)" }
try {
  Write-Host "`n== 1 of 2: Phase 4 defaults ==" -ForegroundColor Cyan
  node tests\chat-eval\cli.mjs --backend deepseek --scenarios all --max-usd 1.20 --label p4final --out $run
  Write-Host "`n== 2 of 2: comparison with Phase 3 ==" -ForegroundColor Cyan
  node tests\chat-eval\cli.mjs --compare $p3.FullName $run --out "$out\deepseek-compare-p4final-$stamp"
  Write-Host "`nDone. Tell Claude: the Phase 4 check finished." -ForegroundColor Green
} finally {
  Remove-Item Env:AIWRITE_CHAT_EVAL_PAID -ErrorAction SilentlyContinue
}
