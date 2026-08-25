# Rede Lhama Bot

Base limpa para um bot Discord em Node.js.

## Configuração

1. Instale as dependências:

```bash
npm install
```

2. Crie um arquivo `.env` baseado no `.env.example`.
3. Inicie o bot:

```bash
npm start
```

## Discloud

O `discloud.config` está configurado para hospedar o bot Node.js como `TYPE=bot`.

Na Discloud, configure as variáveis de ambiente pelo painel da aplicação. Não envie `.env` para o GitHub.

Para os comandos slash aparecerem no Discord, configure também:

```env
DISCORD_CLIENT_ID=ID_DA_APLICACAO
DISCORD_COMMAND_SCOPE=guild
DISCORD_GUILD_IDS=ID_DO_SERVIDOR
```

Use `DISCORD_COMMAND_SCOPE=guild` para os comandos aparecerem quase imediatamente no servidor configurado. O valor `global` também funciona, mas pode demorar para propagar no Discord. Se o bot já estiver no servidor e os comandos não aparecerem, gere um novo link de convite no Developer Portal com os escopos `bot` e `applications.commands`, convide novamente e reinicie a aplicação na Discloud.

Importante: os arquivos locais do Minecraft, como `pending-codes.txt`, `linked-accounts.txt` e `server-status.json`, ficam no PC/servidor onde o Paper roda. Se o bot rodar na Discloud, ele não consegue ler caminhos locais como `C:/Minecraft-Server/...`. Nesse caso, mantenha o bot na mesma máquina do servidor Minecraft ou use uma ponte por API/webhook.

## Painel de vinculação

O bot publica automaticamente um painel com Components v2 no canal configurado em `DISCORD_LINK_PANEL_CHANNEL_ID`.

Por padrão, o painel fica no canal `1541586289281859654`.

Fluxo para o jogador:

1. No Minecraft, use `/discord conectar`.
2. Copie o código de 4 dígitos.
3. No Discord, clique no botão `Vincular conta` do painel.
4. Digite o código no modal.

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

## Status automático

O plugin do Minecraft gera o arquivo `server-status.json` dentro da pasta `plugins/RedeLhamaConnect`. O bot lê esse arquivo local e atualiza automaticamente uma mensagem de status com Components v2 no canal configurado.

Por padrão, o bot atualiza o painel a cada 60 segundos. Se o arquivo ficar sem atualização por mais de 120 segundos, o painel passa para offline/manutenção.

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

## Painel de sugestões

Publique o painel com:

```txt
/sugestao painel
```

Opcionalmente informe `canal` para escolher onde o painel fica e `destino` para escolher onde as sugestões serão publicadas. O bot salva essa escolha no arquivo local do painel. Se `destino` não for informado, envia as sugestões no mesmo canal do painel.

Jogadores também podem usar `/sugerir` para abrir o mesmo formulário sem passar pelo painel.

Cada sugestão publicada cria um tópico para conversa, mostra botões de voto na mensagem principal e envia um controle `Implementar` dentro do tópico. Apenas administradores podem usar esse controle; ao implementar, o tópico é trancado e a sugestão aprovada é enviada para o canal `1541872816788349038`.

## Sistema de tickets

O bot possui um sistema de tickets com MongoDB/Mongoose, Components v2 e categorias automáticas abaixo da categoria âncora `1541597285115371570`. Ao fechar, o canal é movido para a categoria fixa de tickets finalizados `1541646616778514512`.

Configure ao menos:

```env
MONGODB_URI=mongodb+srv://usuario:senha@cluster/banco
DISCORD_TICKET_PANEL_CHANNEL_ID=ID_DO_CANAL_DO_PAINEL
DISCORD_TICKET_SUPPORT_ROLE_IDS=ID_CARGO_STAFF
DISCORD_TICKET_COORDINATION_ROLE_IDS=ID_CARGO_COORDENACAO
DISCORD_TICKET_ADMINISTRATOR_ROLE_IDS=ID_CARGO_ADMIN
DISCORD_TICKET_TRANSCRIPT_CHANNEL_ID=ID_CANAL_TRANSCRIPTS
DISCORD_TICKET_LOG_CHANNEL_ID=ID_CANAL_LOGS
DISCORD_TICKET_REVIEW_CHANNEL_ID=ID_CANAL_AVALIACOES
```

Depois de iniciar o bot, use:

```txt
/ticket painel
```

O painel também é atualizado automaticamente quando tickets são abertos, fechados, reabertos ou excluídos. A categoria âncora nunca é usada como `parentId` e nunca é excluída pelo sistema; ela serve apenas para posicionar visualmente as categorias automáticas. A mensagem final com avaliação vai por DM para quem abriu o ticket, e o canal arquivado fica com botão de reabertura em Components v2.

## Comandos por mensagem

### `!say #canal texto`

Envia uma mensagem pelo bot no canal informado. O usuário precisa ter a permissão `Gerenciar mensagens` no canal onde executou o comando e permissão para enviar mensagens no canal de destino.

Exemplo:

```txt
!say #avisos Servidor aberto!
```

Esse comando por mensagem depende do intent `Message Content`, então configure:

Discord Developer Portal > Bot > Privileged Gateway Intents > Message Content Intent.

## Estrutura

- `index.js`: inicialização do client, login, tratamento de interações e shutdown.
- `config.js`: configuração por variáveis de ambiente.
- `Handler/commands.js`: carrega comandos slash da pasta `Commands`.
- `Handler/events.js`: carrega eventos da pasta `Events`.
- `utils/`: utilitários compartilhados da base.
