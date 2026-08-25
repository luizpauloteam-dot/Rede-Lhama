# Rede Lhama Bot

Base limpa para um bot Discord em Node.js.

## Configuracao

1. Instale as dependencias:

```bash
npm install
```

2. Crie um arquivo `.env` baseado no `.env.example`.
3. Inicie o bot:

```bash
npm start
```

## Discloud

O `discloud.config` esta configurado para hospedar o bot Node.js como `TYPE=bot`.

Na Discloud, configure as variaveis de ambiente pelo painel da aplicacao. Nao envie `.env` para o GitHub.

Importante: os arquivos locais do Minecraft, como `pending-codes.txt`, `linked-accounts.txt` e `server-status.json`, ficam no PC/servidor onde o Paper roda. Se o bot rodar na Discloud, ele nao consegue ler caminhos locais como `C:/Minecraft-Server/...`. Nesse caso, mantenha o bot na mesma maquina do servidor Minecraft ou use uma ponte por API/webhook.

## Painel de vinculacao

O bot publica automaticamente um painel com Components v2 no canal configurado em `DISCORD_LINK_PANEL_CHANNEL_ID`.

Por padrao, o painel fica no canal `1541586289281859654`.

Fluxo para o jogador:

1. No Minecraft, use `/discord conectar`.
2. Copie o codigo de 4 digitos.
3. No Discord, clique no botao `Vincular conta` do painel.
4. Digite o codigo no modal.

Ao vincular, o bot registra a conta em `linked-accounts.txt` e tenta entregar o cargo `@Membro` configurado em `DISCORD_MEMBER_ROLE_ID`. Se o plugin enviar chaves VIP, o bot usa `DISCORD_VIP_ROLE_MAP` para entregar os cargos VIP correspondentes.

Configure os arquivos locais para apontar para a pasta do plugin:

```env
LINK_PENDING_CODES_FILE=C:/caminho/do/servidor/plugins/RedeLhamaConnect/pending-codes.txt
LINKED_ACCOUNTS_FILE=C:/caminho/do/servidor/plugins/RedeLhamaConnect/linked-accounts.txt
```

Variaveis de cargos:

```env
DISCORD_MEMBER_ROLE_ID=ID_DO_CARGO_MEMBRO
DISCORD_VIP_ROLE_MAP=vip:ID_DO_CARGO_VIP,vipplus:ID_DO_CARGO_VIPPLUS
```

Canal do painel:

```env
DISCORD_LINK_PANEL_CHANNEL_ID=1541586289281859654
```

## Status automatico

O plugin do Minecraft gera o arquivo `server-status.json` dentro da pasta `plugins/RedeLhamaConnect`. O bot le esse arquivo local e atualiza automaticamente uma mensagem de status com Components v2 no canal configurado.

Por padrao, o bot atualiza o painel a cada 60 segundos. Se o arquivo ficar sem atualizacao por mais de 120 segundos, o painel passa para offline/manutencao.

Variaveis:

```env
DISCORD_STATUS_CHANNEL_ID=1495458159848980520
MINECRAFT_STATUS_FILE=C:/Minecraft-Server/plugins/RedeLhamaConnect/server-status.json
STATUS_DISPLAY_ADDRESS=localhost:25565
STATUS_REFRESH_INTERVAL_MS=60000
STATUS_STALE_AFTER_MS=120000
STATUS_PANEL_TITLE=Em breve
STATUS_PLAYERS=0/0
STATUS_ACCENT_COLOR=FF6600
STATUS_IMAGE_ON=https://i.imgur.com/sCfPQoR.jpeg
STATUS_IMAGE_MANUTENCAO=https://i.imgur.com/IsFEUw1.png
STATUS_PANEL_MESSAGE_FILE=./data/link/status-panel.json
```

Config do plugin:

```yml
status:
  enabled: true
  file-name: "server-status.json"
  server-name: "Rede Lhama"
  display-address: "localhost:25565"
  update-interval-ticks: 100
```

## Comandos por mensagem

### `!say #canal texto`

Envia uma mensagem pelo bot no canal informado. O usuario precisa ter a permissao `Gerenciar mensagens` no canal onde executou o comando e permissao para enviar mensagens no canal de destino.

Exemplo:

```txt
!say #avisos Servidor aberto!
```

Esse comando por mensagem depende do intent `Message Content`, entao configure:

Discord Developer Portal > Bot > Privileged Gateway Intents > Message Content Intent.

## Estrutura

- `index.js`: inicializacao do client, login, tratamento de interacoes e shutdown.
- `config.js`: configuracao por variaveis de ambiente.
- `Handler/commands.js`: carrega comandos slash da pasta `Commands`.
- `Handler/events.js`: carrega eventos da pasta `Events`.
- `utils/`: utilitarios compartilhados da base.
