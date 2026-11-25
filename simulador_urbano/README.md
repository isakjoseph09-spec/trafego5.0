# Simulador de Fluxo Urbano

Aplicação Flask para gerenciar cruzamentos e comparar, em uma visualização 3D educativa, o fluxo em cruzamentos semaforizados e rotatórias.

## Requisitos

- Python 3.11 ou superior
- Navegador com suporte a WebGL para a visualização 3D

## Instalação no Windows (PowerShell)

No terminal, a partir da pasta `simulador_urbano`:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
$env:SIMULATOR_ADMIN_EMAIL = Read-Host "E-mail inicial do administrador"
.\iniciar_simulador.ps1
```

Não é necessário instalar MySQL para executar localmente: o iniciador cria as tabelas e usa SQLite em `instance/simulador.db`. A senha inicial é solicitada sem ser exibida no primeiro início. Para usar outro banco, defina `SQLALCHEMY_DATABASE_URI` antes de executar o script.

Abra `http://127.0.0.1:5000` para ver o site público, com o mapa interativo e o simulador de tráfego. A opção **Área de gestão** leva ao login do painel Flask, disponível também em `/painel` somente para Administradores e Engenheiros autenticados. O cadastro público cria uma conta de Operador para novos membros; esse perfil não acessa o painel de gestão. Na primeira inicialização local, o terminal solicita uma senha administrativa sem exibi-la; defina `SIMULATOR_ADMIN_EMAIL` se quiser outro e-mail. Em produção, configure a senha por variável privada e nunca a coloque no repositório.

O link **Já tenho conta** leva ao login e, depois da autenticação, retorna ao site público. Para abrir a gestão, use **Área de gestão** e entre com uma conta autorizada.

Os cadastros, cruzamentos e publicações locais são gravados em `instance/simulador.db`, que é ignorado pelo Git. Cada instalação local tem seus próprios dados. Para compartilhar um site e banco entre computadores, publique o serviço central no Render.

Na seção de mapa inicial, os 16 semáforos azuis correspondem aos registros `highway=traffic_signals` do [GeoJSON exportado](../html/trafego2.0.py/data/export.geojson). O arquivo armazena coordenadas como longitude/latitude; o mapa as converte para latitude/longitude. Alguns registros ficam a menos de 9 metros um do outro; selecione-os na lista para aproximar o mapa e conferir cada ponto.

O script `reset_admin_password.py` altera somente uma conta no banco SQLite local; defina `SIMULATOR_ADMIN_EMAIL` para indicar o endereço da conta. Ele não altera a conta ativa em um serviço hospedado.

## Publicação no Render

O Blueprint `render.yaml` configura um único site central com banco SQLite em disco persistente. Publique o Blueprint a partir do repositório; todos acessarão a mesma URL e os mesmos dados. No painel do serviço Render, defina `SIMULATOR_ADMIN_EMAIL` com o e-mail administrativo e `SIMULATOR_ADMIN_PASSWORD` com uma senha longa e exclusiva. Esses valores ficam nas variáveis do serviço, não no Git. A conta é criada quando o banco ainda não contém esse administrador. A raiz do serviço é esta pasta (`simulador_urbano`).

Com configuração manual, use:

- **Build Command:** `pip install -r requirements.txt`
- **Start Command:** `python seed.py && gunicorn app:app --bind 0.0.0.0:$PORT`

O Blueprint gera `SECRET_KEY`, ativa `SESSION_COOKIE_SECURE` e configura `SQLALCHEMY_DATABASE_URI` para o disco persistente montado em `/var/data`. O Render fornece `PORT`; não cadastre esse valor manualmente. Não coloque credenciais no repositório.

O disco persistente requer um plano pago do Render. Sem ele, o SQLite fica em armazenamento efêmero e contas e publicações podem ser perdidas após reinicializações ou novas implantações.

## Simulação de tráfego

No cenário semaforizado, os fluxos Leste–Oeste e Norte–Sul alternam entre verde, amarelo e um intervalo de segurança. Os veículos aceleram e freiam gradualmente, mantêm distância e param antes da linha quando não têm passagem. No amarelo, a decisão de parar considera a velocidade e a distância de frenagem; quem já entrou no cruzamento pode liberá-lo antes da próxima fase verde. O ciclo é acelerado para facilitar a observação.

Na rotatória, os veículos cedem passagem aos carros que já estão circulando, mantêm distância e seguem a faixa até a saída. Os indicadores apresentados são estimativas educativas e não substituem medições ou estudos de engenharia de tráfego.
