# RedeLhamaConnect

Plugin simples para Paper 26.2.

## Fluxo

1. O jogador entra no servidor.
2. No Minecraft, usa `/discord conectar`.
3. O plugin gera um codigo de 4 digitos e salva em `plugins/RedeLhamaConnect/pending-codes.txt`.
4. No Discord, o jogador clica no botao `Vincular conta` do painel no canal configurado.
5. O bot registra o vinculo em `plugins/RedeLhamaConnect/linked-accounts.txt`.
6. O plugin mantem `plugins/RedeLhamaConnect/server-status.json` atualizado para o bot exibir o status automatico no Discord.

## Comandos

- `/discord conectar`
- `/discord status`
- `/discord reload`

## Arquivos locais

Depois de iniciar, o plugin cria:

- `plugins/RedeLhamaConnect/pending-codes.txt`
- `plugins/RedeLhamaConnect/linked-accounts.txt`
- `plugins/RedeLhamaConnect/server-status.json`
- `plugins/RedeLhamaConnect/config.yml`

Configure o bot com:

```env
LINK_PENDING_CODES_FILE=C:/caminho/do/servidor/plugins/RedeLhamaConnect/pending-codes.txt
LINKED_ACCOUNTS_FILE=C:/caminho/do/servidor/plugins/RedeLhamaConnect/linked-accounts.txt
MINECRAFT_STATUS_FILE=C:/caminho/do/servidor/plugins/RedeLhamaConnect/server-status.json
```

## Status

O status local pode ser ajustado em `config.yml`:

```yaml
status:
  enabled: true
  file-name: "server-status.json"
  server-name: "Rede Lhama"
  display-address: "localhost:25565"
  update-interval-ticks: 100
```

## VIP

Edite `config.yml` e coloque as permissoes reais dos VIPs:

```yaml
vip-permissions:
  vip: "redelhama.vip"
  vipplus: "redelhama.vipplus"
```

No bot, relacione essas chaves aos cargos do Discord:

```env
DISCORD_VIP_ROLE_MAP=vip:ID_DO_CARGO_VIP,vipplus:ID_DO_CARGO_VIPPLUS
```
