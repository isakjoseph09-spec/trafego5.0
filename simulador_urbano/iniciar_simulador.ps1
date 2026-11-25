$ErrorActionPreference = "Stop"

Set-Location -LiteralPath $PSScriptRoot

python seed.py
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

python app.py
exit $LASTEXITCODE
