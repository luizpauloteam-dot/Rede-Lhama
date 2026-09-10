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

## Alteração de equipe

Use `/equipe tipo:entrar` para entrar, promover ou rebaixar, e `/equipe tipo:remover` para retirar um cargo da equipe. O modal contém seleção de um membro, seleção de um cargo principal e upload obrigatório de uma foto PNG, JPG, WEBP ou GIF.

O menu lista somente os cargos encontrados no servidor, nesta ordem do maior para o menor: **Fundadores → Coordenador → Desenvolvedor → Administrador → Moderador → Ajudante → Aprendiz → Construtor → Designer**. A ordem vem de `config.team.rankNames`; a hierarquia do Discord continua sendo validada separadamente para autorizar a alteração. O cargo **Team** é a base e não aparece no menu.

Ao entrar, quem não tem cargo principal recebe o selecionado e `Team`. Quem já tem um cargo principal tem seus cargos principais anteriores substituídos pelo selecionado: subir nessa lista gera promoção; descer gera rebaixamento. Se houver mais de um cargo principal antigo, o maior define a comparação. Selecionar um cargo que o membro já possui não faz alteração. Ao remover, o bot retira o cargo selecionado e também `Team` se não restar nenhum cargo principal. Cargos fora da equipe são preservados.

O aviso mantém faixa laranja, título “• Alteração na Equipe” e foto como miniatura à direita. Na entrada: “@membro agora exerce o cargo de @Cargo na equipe.” Na remoção: “@membro deixou de exercer o cargo de @Cargo na equipe.” Nas trocas: “@membro recebeu uma **promoção** de @CargoAnterior para @NovoCargo na equipe.” ou “@membro recebeu um **rebaixamento** de @CargoAnterior para @NovoCargo na equipe.” A mensagem permite notificações somente para o membro e os cargos mencionados; a notificação do cargo depende de ele ser mencionável ou da permissão do bot para mencionar cargos. O responsável continua identificado no motivo da alteração no log de auditoria do Discord.

Os cargos são reconhecidos pelo nome exato, ignorando maiúsculas e minúsculas. Para nomes diferentes ou duplicados, configure os IDs em `DISCORD_TEAM_ROLE_MAP`, por exemplo `ajudante:ID_DO_AJUDANTE,team:ID_DO_TEAM`. Um ID configurado que não existe, nomes duplicados sem ID ou a ausência do cargo base bloqueiam o fluxo com uma mensagem explicativa. O bot não cria cargos automaticamente.

Os avisos são publicados no canal `1546592495503282186`. Para alterar o destino, configure `DISCORD_TEAM_LOG_CHANNEL_ID`. Configure `DISCORD_TEAM_TITLE_EMOJI` com o emoji da logo (`<:nome:ID>`) para exibi-lo antes do título. `DISCORD_TEAM_COLOR` controla a faixa lateral (padrão `E8A64A`).

Quem executa precisa de **Gerenciar cargos**. Todos os cargos que serão adicionados ou removidos e o membro selecionado precisam estar abaixo do responsável e do bot na hierarquia (o dono do servidor não tem a restrição de hierarquia do responsável). Cargos de integrações, `@everyone`, bots e o dono do servidor não são alvos válidos. A validação acontece novamente ao enviar.

O bot precisa de **Gerenciar cargos**, acesso ao canal do registro, **Enviar mensagens** (ou **Enviar mensagens em tópicos**), **Anexar arquivos** e **Inserir links**. Se o cargo for alterado e a publicação falhar, a resposta informa a falha parcial para a administração registrar manualmente.

Reinicie o bot para registrar o comando. Validação local: `npm run check` e `npm test`.

## Discloud

O `discloud.config` esta configurado para hospedar o bot Node.js como `TYPE=bot`.

Na Discloud, configure as variaveis de ambiente pelo painel da aplicacao. Nao envie `.env` para o GitHub.

Para os comandos slash aparecerem no Discord, configure tambem:

```env
DISCORD_CLIENT_ID=ID_DA_APLICACAO
DISCORD_COMMAND_SCOPE=guild
DISCORD_GUILD_IDS=ID_DO_SERVIDOR
```

Use `DISCORD_COMMAND_SCOPE=guild` para os comandos aparecerem quase imediatamente no servidor configurado. O valor `global` tambem funciona, mas pode demorar para propagar no Discord. Se o bot ja estiver no servidor e os comandos nao aparecerem, gere um novo link de convite no Developer Portal com os escopos `bot` e `applications.commands`, convide novamente e reinicie a aplicacao na Discloud.

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
STATUS_IMAGE_ON=https://i.imgur.com/sCfPQoR.jpeg
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

## Painel de sugestoes

Publique o painel com:

```txt
/sugestao painel
```

Opcionalmente informe `canal` para escolher onde o painel fica e `destino` para escolher onde as sugestoes serao publicadas. O bot salva essa escolha no arquivo local do painel. Se `destino` nao for informado, envia as sugestoes no mesmo canal do painel.

Jogadores tambem podem usar `/sugerir` para abrir o mesmo formulario sem passar pelo painel.

Cada sugestao publicada cria um topico para conversa, mostra botoes de voto na mensagem principal e envia um controle `Implementar` dentro do topico. Apenas administradores podem usar esse controle; ao implementar, o topico e trancado e a sugestao aprovada e enviada para o canal `1541872816788349038`.

## Sistema de tickets

Atendimento por canais privados `tipo-usuario`, com MongoDB/Mongoose e Components V2. O servidor é fixo: `1541296952514187397`. O painel abre um formulário com nick e descrição; usuário e equipe conversam no próprio canal.

O bot cria as categorias DÚVIDAS, REPORTAR-ERROS, DENÚNCIAS, APELAÇÕES, RECUPERAÇÃO, DOAÇÕES, COORDENAÇÃO e OUTROS conforme a demanda, abaixo da âncora `1541597285115371570`. A âncora nunca recebe operações de edição ou exclusão. Somente categorias criadas pelo bot e registradas no MongoDB podem ser removidas; categorias normais, mesmo com nomes iguais, não são adotadas ou excluídas. Categorias cheias recebem instâncias `-2`, `-3`, reutilizando primeiro as que têm espaço. A remoção do último canal dispara uma verificação de canais e tickets ativos antes de excluir a categoria. A inicialização reconcilia exclusões ocorridas com o bot offline.

Configure:

```env
MONGODB_URI=mongodb+srv://usuario:senha@cluster/banco
DISCORD_TICKET_PANEL_CHANNEL_ID=ID_DO_CANAL_DO_PAINEL
DISCORD_TICKET_SUPPORT_ROLE_IDS=ID_CARGO_STAFF
DISCORD_TICKET_COORDINATION_ROLE_IDS=ID_CARGO_COORDENACAO
DISCORD_TICKET_ADMINISTRATOR_ROLE_IDS=ID_CARGO_ADMIN
DISCORD_TICKET_PROTECTED_CATEGORY_IDS=
DISCORD_TICKET_TRANSCRIPT_CHANNEL_ID=ID_CANAL_TRANSCRIPTS
DISCORD_TICKET_LOG_CHANNEL_ID=ID_CANAL_LOGS
DISCORD_TICKET_REVIEW_CHANNEL_ID=ID_CANAL_AVALIACOES
```

O bot precisa de Gerenciar canais, Gerenciar cargos (para sobrescritas), Ver canais, Enviar mensagens, Anexar arquivos e Ler histórico. Configure os cargos de atendimento explicitamente. A Coordenação não concede acesso aos cargos de suporte comum. Administrador do Discord sempre ignora restrições de canal. Logs e transcripts de Coordenação ficam no MongoDB/disco, sem publicação nos canais gerais; a equipe autorizada pode baixar o HTML pela ação Transcript.

Publique com `/ticket painel`. O painel mantém o banner existente. As ações incluem assumir, transferir, adicionar/remover usuário, chamar por DM com botão para abrir o ticket, renomear, fechar e excluir definitivamente após confirmação. Não é permitido adicionar terceiros em tickets de Coordenação. O fechamento bloqueia mensagens dos participantes, gera HTML e move o canal para a categoria protegida `1541646616778514512`, com nome `closed-usuario`, preservando as permissões. A mensagem de finalização com avaliação de 1 a 5 é enviada por DM ao titular e pode ser respondida mesmo após excluir o canal, enquanto o registro existir. Se a DM estiver bloqueada, o fechamento continua e a equipe recebe um aviso. A reabertura retorna o canal à categoria automática e ao nome `tipo-usuario` correspondente.

O transcript consulta todo o histórico disponível no Discord, incluindo anexos, imagens, avatares e datas. É salvo em `data/tickets/transcripts` (ou `TICKET_DATA_DIR/transcripts`) antes de qualquer exclusão pelo bot. Mensagens apagadas diretamente no Discord antes da geração não podem ser recuperadas. Mantenha backup desse diretório. `/ticket transcript` também entrega o arquivo ao atendente. O contador usa incremento atômico no MongoDB e não é apagado pela limpeza de registros.

Um ticket ativo por usuário. Execute uma instância do bot por servidor: a fila de operações de categorias evita concorrência entre criação e limpeza dentro do processo. O contador e a restrição de ticket ativo também têm proteção no MongoDB.

Comandos adicionais: `/ticket info`, `/ticket fechar`, `/ticket pausar`, `/ticket retomar`, `/ticket reabrir`, `/ticket transcript` e comandos de blacklist. `/ticket limpar-banco` exige administrador e `confirmar:CONFIRMAR`; só permite limpar registros após a exclusão dos canais, preservando contador e registro das categorias.

Registros antigos permanecem no MongoDB sem serem apagados ou convertidos automaticamente. Apenas tickets da versão `private-channels-v1` são atendidos pelo novo fluxo. O bot não retransmite mensagens privadas nem abre canais de fórum ou threads de atendimento.

Validação local: `npm run check` e `npm test`. Confira no servidor a abertura nas oito categorias, visibilidade com contas de usuário/staff/coordenação, fechamento, avaliação, transcript e exclusão do último canal. As referências visuais de conversas anteriores não estão no repositório; o layout conserva o painel e os recursos visuais atuais.

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

A ação **Chamar usuário** envia ao titular uma DM com um painel e o botão **Ir para o ticket**. A equipe recebe a confirmação em resposta privada. Se a DM estiver indisponível ou o envio falhar, a equipe é informada e o cooldown dessa tentativa é liberado.
