$ErrorActionPreference = "Stop"

Set-Location -LiteralPath $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($env:SQLALCHEMY_DATABASE_URI)) {
    $env:SQLALCHEMY_DATABASE_URI = "mysql+pymysql://root@127.0.0.1:3306/trafego"
}

python seed.py
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

python app.py
exit $LASTEXITCODE
