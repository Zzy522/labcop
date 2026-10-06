# Compatible with Windows PowerShell 5.1 and PowerShell 7.
$ErrorActionPreference = 'Stop'
$taskScript = Join-Path $PSScriptRoot 'selfhost.py'
if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 $taskScript @args
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    & python $taskScript @args
} else {
    throw 'Python 3.9+ is required. Install it and restart your terminal; see docs/self-hosting-guide.md.'
}
exit $LASTEXITCODE
