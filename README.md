# Fluxo ST — simulador de mobilidade

Aplicação Flask para consultar o mapa, acompanhar propostas de mobilidade e administrar cadastros, cruzamentos e publicações.

## Executar localmente no Windows

Requisito: Python 3.11+.

```powershell
Set-Location .\simulador_urbano
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
$env:SIMULATOR_ADMIN_EMAIL = Read-Host "E-mail inicial do administrador"
.\iniciar_simulador.ps1
```

Não precisa instalar MySQL: o iniciador cria as tabelas em um banco SQLite local e pede uma senha administrativa sem exibi-la na primeira execução. Abra `http://127.0.0.1:5000`. Para outra configuração de banco, defina `SQLALCHEMY_DATABASE_URI` antes de iniciar.

O cadastro público cria contas Operador; somente Administradores e Engenheiros acessam a Área de Gestão. O esquema e os cruzamentos demonstrativos são criados pelo `seed.py`.

## Um único site para vários computadores

O Blueprint [`render.yaml`](./render.yaml) publica um serviço central com armazenamento persistente. No Render, crie o serviço pelo Blueprint e configure `SIMULATOR_ADMIN_EMAIL` e `SIMULATOR_ADMIN_PASSWORD` nas variáveis do serviço. Use uma senha longa e exclusiva; não a grave no código nem no Git. Depois do deploy, todos acessam a mesma URL e compartilham o mesmo banco.

O banco local e os dados de usuários não são incluídos no repositório. O aplicativo cria as tabelas e dados demonstrativos ao iniciar; para migrar registros locais, faça uma exportação privada e importe-a no serviço hospedado.

## Testes

```powershell
Set-Location .\simulador_urbano
python -m unittest test_site_integration -v
```
