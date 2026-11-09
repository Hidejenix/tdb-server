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
- **Aparência de quem chega depois** (`host\scripts
eaplicar_aparencia.js`, sempre ligado): reenvia rosto/cabelo/barba de um jogador quando o pawn dele chega a outro cliente (sem isso, quem entrou depois podia aparecer sem cabeça para os outros). No log: `reenviada a aparencia`.
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
Cada jogador precisa de um SteamId próprio (o personagem fica em `players/<SteamId>`). O cliente cuida disso sozinho: na 1ª vez
gera um ID e guarda em `%LOCALAPPDATA%	db_cliente\steamid.txt` (por conta do Windows; continua o mesmo ao trocar a pasta do cliente;
apagar o arquivo = personagem novo). Para escolher o ID: `TDB_STEAMID`/`TDB_NOME` ou um arquivo `cliente\steamid.txt` (1ª linha o ID,
2ª o nome). Editar `force_steamid.txt` à mão não adianta (o cliente o regrava a cada abertura). O `disable_lan_only.txt` também é
criado sozinho. `--diag` liga os scripts de diagnóstico (mais lento).
Vida, fome e sede ficam **sempre na tela** (`clientearras_sempre_visiveis.js`; o HUD original só mostra quando um valor sobe ou fica crítico). `--sem-barras-fixas` volta ao comportamento do jogo.

## Launcher (Online / Offline / atualização automática): `Abrir TDB Launcher.bat`

Janela simples (Python + tkinter, nada extra para instalar além do Python com `frida`):
- **Jogar Online:** abre o jogo no servidor cujo IP está em `cliente\host.txt`, com o SteamId próprio da pessoa (gerado na 1ª vez).
- **Jogar Offline:** sobe o servidor do próprio PC (`host\servidor_host.py --appdata-separado`, na mesma conta do Windows), espera o
  `LISTEN OK` e abre o jogo nele com o ID antigo (`76561197960287930`), onde estão os saves locais. Ao fechar o jogo, fecha o host
  (com o export final do Firestore) e desliga o emulador e o terminador TLS (porta 443), para o modo Online funcionar depois.
- Mostra se o servidor online está no ar, a versão instalada e a saída do cliente/host; opção "vida, fome e sede sempre visíveis".
- **Pasta do jogo:** linha "Pasta do jogo" com o botão **Escolher...** (aceita a pasta do jogo ou qualquer subpasta; confere
  `Survival\Binaries\Win64\TheDayBefore.exe`). Fica em `launcher\config.json` e vale para o cliente e para o host local. Padrão:
  `C:\Games\THE DAY BEFORE`. Se não achar o jogo, o launcher pede a pasta antes de jogar.
- **Atualização:** ao abrir e antes de jogar, compara os arquivos com a release mais recente do GitHub
  (`/releases/latest/download/manifesto.json`) e troca só os diferentes, conferindo o SHA-256 de cada arquivo e do zip. Nunca mexe em
  `cliente\host.txt`, `cliente\steamid.txt`, `launcher\config.json` nem nos saves (`servicos\`). Se o próprio launcher mudar, ele reabre.
- **Erros:** tudo que aparece na janela (e qualquer erro, com o traceback) fica em `launcher\launcher.log` — botão **Log do launcher**.
  Ao abrir, o launcher confere se o Frida está instalado e avisa (`pip install frida frida-tools`). **Parar** fecha o jogo na hora.
- Cliente sem launcher: `python cliente\cliente_conecta.py` (online) ou `python cliente\cliente_conecta.py --local` (servidor do PC).

**Publicar uma versão nova (dono do servidor):**
```
python -I launcher\publicar_versao.py 2026.11.08-2 --notas "o que mudou"
```
Gera `dist\<versao>\manifesto.json` e `atualizacao.zip` (cliente, launcher e scripts do host; sem IP, SteamId nem saves). Suba os 2 arquivos
numa release nova em https://github.com/yan1451/tdb-server/releases/new marcada como *latest* (ou use `--publicar` com o GitHub CLI `gh`).

## Painel de gerenciamento (Azure + VPS): `painel/`

Painel no navegador, que roda **no seu PC**. Ele usa o Azure CLI já logado (`az login`) e a chave SSH da VM.

```bash
python -I painel\painel.py
```

Ou dê dois cliques em `painel\abrir_painel.bat`. O painel abre `http://127.0.0.1:8765`.

- **Controle:**
  - ligar e desalocar a VM (antes de desalocar, derruba o servidor e salva os personagens);
  - subir o servidor (versão normal ou otimizada; opcional: enviar antes os scripts do PC) e derrubar;
  - saída das tarefas ao vivo.
- **Jogadores:** quem está conectado, com ping, posição e último evento (do monitor de ping e do de posição).
- **Monitores:** liga e desliga ao vivo cada monitor (ping, posição, resgate de queda, bugs, loot e tiro). O painel sobe o host com `--sem-monitores --sem-resgate` e carrega cada monitor como processo separado na VPS; a escolha fica salva.
- **Logs:** runner, console, serviços, Firestore, exports e o log de cada monitor, com filtro, "sem ruído" e atualização automática.
- **Configuração:** copie `painel\config.exemplo.json` para `painel\config.json` e preencha grupo, VM, IP, usuário e chave. Esse arquivo não vai para o GitHub.
- **Segurança:** o painel escuta só em `127.0.0.1`, e as ações exigem um token gerado a cada execução, embutido na página.

## Versão otimizada (experimental): `host_otimizado/`

Cópia do `host/` com a replicação num só script, `replicacao_otimizada.js`, em duas frentes:
- **laço em C** (CModule do Frida);
- **ritmo de cada ator** pelo `NetUpdateFrequency`.

O log mostra a cada 60 s o tick e o tempo gasto por quadro (`[otim]`). Detalhes, teste fora do jogo e como voltar estão em
[host_otimizado/LEIA.md](host_otimizado/LEIA.md). Para usar: `python -I host_otimizado\servidor_host.py`, ou na VPS
`TDB_HOST_PASTA=host_otimizado bash linux/subir_tudo.sh`.

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
