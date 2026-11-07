# Servidor próprio para The Day Before (host nativo)

Os servidores oficiais do jogo foram desligados. Este projeto transforma uma segunda cópia do próprio
`TheDayBefore.exe` em servidor (modo dedicado, sem janela), usando scripts **Frida**, e redireciona o
Firestore do jogo para um **emulador local**. O cliente conecta pelo Server Browser do jogo
(linha **SERVIDOR-LOCAL**).

> Não contém arquivos do jogo. Você precisa ter o jogo instalado. Os scripts dependem dos endereços
> deste executável específico (UE 5.2.1, build com emulador Steam); outra versão do exe não funciona.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `host/servidor_host.py` | Runner único: sobe serviços, cria a lista de servidores e abre o host com os scripts |
| `host/scripts/` | Scripts Frida do host (listen, modo dedicado, replicação, login, redirecionamentos) |
| `host/ferramentas/` | Opcionais: `dar_dinheiro.js` (entrega itens ao jogador), sondas de leitura |
| `host/carregar_script_no_host.py` | Carrega uma ferramenta num host já aberto |
| `servicos/` | Emulador do Firestore (config), ponte IPv6, terminador TLS e gerador de certificados |
| `cliente/cliente_conecta.py` | Abre o jogo do jogador com os redirecionamentos necessários |

## O que instalar

No PC do host **e** em cada conta/PC de cliente:

1. **The Day Before** instalado (padrão `C:\Games\THE DAY BEFORE`; outra pasta: variável `TDB_JOGO`).
2. **Python 3.11+** (marque "Add to PATH").
3. **Frida**: `pip install frida frida-tools` (testado com Frida 17).

Só no host:

4. **Node.js LTS** e **Firebase CLI**: `npm install -g firebase-tools`
5. **Java 11+** (o emulador do Firestore precisa).
6. Pacote de certificados: `pip install cryptography`

Feche o **Proxifier** (ou proxies parecidos): ele quebra a conexão com o emulador.

## Rodar o host

```bash
python -I host\servidor_host.py
```

Ele sobe sozinho: emulador do Firestore (127.0.0.1:8081), ponte IPv6 ([::1]:8081), terminador TLS
(porta 443), cria os certificados locais e o servidor `SERVIDOR-LOCAL` na lista, abre o jogo sem janela,
faz o travel para o mapa e abre o listen na UDP 7777. Espere no log
`%TEMP%\servidor_host_headless.out` a linha `LISTEN OK` (≈ 30–70 s).

- Padrão: sem janela e em **modo leve** (monitores de diagnóstico desligados; ~40–55 quadros/s com um cliente).
- `--com-janela`: abre com janela; aperte **F8** depois do menu (continua leve).
- `--diag`: desliga o modo leve (mais lento; só para investigar).
- Monitor de bugs ligado por padrão (`host\scripts\monitor_bugs.js`, filtro nativo, barato): no log aparecem `ITEM SUMIU?` (item que saiu de inventário+baú e não voltou em 20 s; venda/uso também aparecem) e `TIRO EM ZUMBI LONGE` (o cliente acertou uma cópia velha de zumbi). `--sem-monitores` desliga.
  Também sobem `monitor_ping.js` (`[ping]` de cada jogador a cada 15 s) e `monitor_posicao.js` (`[pos]`: posição no servidor; marca `TELEPORTE`, `CAINDO`, `TROCOU PAWN`).
- **Resgate de queda** ligado por padrão (`host\scripts\resgate_queda.js`): quem cai por 6 s seguidos (ou passa de 1.500 m abaixo do zero)
  é teleportado para o último lugar onde estava pisando, com a velocidade zerada (sem dano de queda); sem lugar seguro, vai para um ponto
  de spawn de Woodberry. No log: `RESGATE`. `--sem-resgate` desliga. Unstuck manual: veja **Ferramentas**.
- O Firestore é exportado a cada 60 s para `servicos\firestore_emu\emu_data` (personagens salvos).
- Uso medido: ~1,5 núcleo de CPU e **~10 GB de RAM** (o mapa inteiro fica carregado).

## Host numa VPS Linux (Wine)

Testado em Ubuntu 24.04 (Azure, 4 vCPUs, 16 GB). O jogo e o Frida de Windows rodam dentro do Wine; o Firestore e o terminador TLS
rodam nativos no Linux.

1. Copie esta pasta para a VPS (ex.: `~/tdb/servidor`) e a pasta do jogo para `~/tdb/jogo` (o mesmo build do PC).
2. Instale tudo (Wine, Xvfb, Java, Node + firebase-tools, swap de 8 GB, Python 3.11 + Frida de Windows dentro do Wine):
   ```bash
   bash linux/instalar_vps.sh
   ```
3. Libere no firewall da VPS (ex.: NSG da Azure) a entrada **UDP 7777** e **TCP 443**, de preferência só para o IP dos jogadores
   (o emulador do Firestore aceita leitura e escrita de qualquer um).
4. Suba tudo com **um comando** (serviços + host; espera o `LISTEN OK`; pode rodar de novo, o que já estiver no ar é mantido):
   ```bash
   bash linux/subir_tudo.sh
   ```
   - O IP público é conferido a cada subida e guardado em `linux/vps.conf` (junto com `TDB_NOME_SERVIDOR`). Se a Azure trocar o IP
     depois de desalocar a VM, aparece um AVISO: ponha o IP novo no `host.txt` dos clientes.
   - Para **parar e salvar** (host, export final do Firestore, emulador e TLS) antes de desligar a VM:
     ```bash
     bash linux/derrubar_tudo.sh
     ```
     Depois use **Parar** no portal da Azure (desaloca e para a cobrança de CPU; o `shutdown` de dentro da VM não desaloca).
   - Opcional: **subir sozinho ao ligar a VM** e salvar ao desligar (serviço do systemd `tdb-servidor`):
     ```bash
     bash linux/instalar_inicio_automatico.sh          # --remover desfaz
     ```
   - Peças avulsas, se precisar: `bash linux/iniciar_servicos.sh &` e `TDB_IP_PUBLICO=<ip> bash linux/iniciar_host.sh`.
5. No PC do jogador: `python cliente\cliente_conecta.py --host <ip-da-vps>` (ou ponha o IP num arquivo `cliente\host.txt` e rode sem opção) (o IP precisa ter até 14 caracteres; o cliente abre
   uma ponte local na 443 que leva o Firestore até a VPS — feche qualquer terminador TLS local antes).
6. **Obrigatório nos dois lados (host e cada cliente):** crie o arquivo vazio
   `Engine\Binaries\ThirdParty\Steamworks\Steamv153\Win64\steam_settings\disable_lan_only.txt` na pasta do jogo. Sem ele o emulador de
   Steam (steam_api64.dll) bloqueia em silêncio todo tráfego do jogo para IPs fora da rede local (o join dá "erro de conexão").
7. O Server Browser usa o **nome do documento** da lista (`servers/<ip>:<porta>`) como endereço; o runner cria o documento com
   `TDB_IP_PUBLICO` (nome exibido em `TDB_NOME_SERVIDOR`).

## Rodar o cliente

Use **outra conta do Windows** (ou outro PC): o jogo só abre uma instância por usuário, porque o banco
local do Firestore em `%LOCALAPPDATA%` fica travado pelo primeiro processo.

```bash
python cliente\cliente_conecta.py
```

No jogo: login → Server Browser → **Atualizar** → **SERVIDOR-LOCAL**.
Cada jogador precisa de um SteamId próprio: defina `TDB_STEAMID` e `TDB_NOME` antes de rodar
(padrão `76561197960287930` / `Jogador1`). `--diag` liga os scripts de diagnóstico (mais lento).

## Ferramentas

Dar 50.000 de dinheiro ao(s) jogador(es) conectado(s) (o valor fica no topo do script):

```bash
python -I host\carregar_script_no_host.py <PID_do_host> host\ferramentas\dar_dinheiro.js
```

Na VPS: `bash linux/carregar_ferramenta.sh host/ferramentas/dar_dinheiro.js`.

**Unstuck manual** (jogador preso ou caindo): teleporta para o último lugar seguro, ou para Woodberry.

```bash
bash linux/unstuck.sh          # todos
bash linux/unstuck.sh 8617     # só quem tem "8617" no nome (nomes nas linhas [ping] do log)
```

No host Windows, o mesmo pedido é uma linha no arquivo `%TEMP%\tdb_host_cmd\unstuck.txt` com um número novo e o nome:
`Set-Content "$env:TEMP\tdb_host_cmd\unstuck.txt" "$(Get-Date -UFormat %s) todos"`.

## Limitações conhecidas

- A replicação é recriada em JavaScript (o exe é build de cliente, sem `ServerReplicateActors`):
  ~40–55 quadros/s com um cliente no PC; ~37–40 com dois jogadores na VPS (4 vCPUs).
- Memória: o host passa de 13 GB com dois jogadores; numa VM de 16 GB ele usa swap (recomendado 32 GB).
- Os nomes dos jogadores aparecem como `DESKTOP-...-xxxx`.
