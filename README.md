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
python -I host\servidor_host.py --sem-interface
```

Ele sobe sozinho: emulador do Firestore (127.0.0.1:8081), ponte IPv6 ([::1]:8081), terminador TLS
(porta 443), cria os certificados locais e o servidor `SERVIDOR-LOCAL` na lista, abre o jogo sem janela,
faz o travel para o mapa e abre o listen na UDP 7777. Espere no log
`%TEMP%\servidor_host_headless.out` a linha `LISTEN OK` (≈ 30–70 s).

- Sem `--sem-interface` o host abre com janela; aperte **F8** depois do menu.
- O Firestore é exportado a cada 60 s para `servicos\firestore_emu\emu_data` (personagens salvos).
- Uso medido: ~1,5 núcleo de CPU e **~10 GB de RAM** (o mapa inteiro fica carregado).

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

## Limitações conhecidas

- Só testado com o host e o cliente no mesmo PC (127.0.0.1). Para rede/VPS é preciso trocar o endereço
  do servidor na lista e no `cliente\tdb_fname_join.js`.
- Dois jogadores ainda não se veem com garantia; o login do segundo jogador não foi testado.
- A replicação é recriada em JavaScript (o exe é build de cliente, sem `ServerReplicateActors`):
  ~40–55 quadros/s com um cliente.


----------------------------------------------------------------------------------------------------------------------------


Dedicated Server for The Day Before (Native Host)

The official game servers have been shut down. This project transforms a second copy of the game's own TheDayBefore.exe into a server (headless dedicated mode) using Frida scripts, and redirects the game's Firestore database to a local emulator. The client connects via the in-game Server Browser (selecting the SERVIDOR-LOCAL line).
⚠️ Note: This project does not contain any game files. You must have the game installed. The scripts rely on the memory addresses of this specific executable (UE 5.2.1, Steam emulator build); any other version of the exe will not work.

Structure


Folder	Description
host/servidor_host.py	Single runner: Boots up services, populates the server list, and launches the host with the scripts.
host/scripts/	Host-side Frida scripts (handling listen mode, dedicated mode, replication, login, and redirects).
host/ferramentas/	Optional tools: dar_dinheiro.js (grants items to players), and data reading probes.
host/carregar_script_no_host.py	Injects a tool into an already running host process.
servicos/	Firestore emulator configuration, IPv6 bridge, TLS terminator, and certificate generator.
cliente/cliente_conecta.py	Launches the client game with all necessary network redirections.


Installation

Perform these steps on the host PC and on each client PC/account:
1. Have The Day Before installed (default path: C:\Games\THE DAY BEFORE; if using a different folder, set the TDB_JOGO environment variable).
2. Install Python 3.11+ (make sure to check "Add to PATH").
3. Install Frida: Run pip install frida frida-tools (tested with Frida 17).
Host-only requirements:
4. Install Node.js LTS and the Firebase CLI: Run npm install -g firebase-tools
5. Install Java 11+ (required to run the Firestore emulator).
6. Install the certificate package: Run pip install cryptography
Make sure to close Proxifier (or similar proxy tools), as they will break the connection to the emulator.

Running the Host

Run the following command:
bash
python -I host\servidor_host.py --sem-interface
Use code with caution.
The script will automatically set up everything: the Firestore emulator (127.0.0.1:8081), the IPv6 bridge ([::1]:8081), the TLS terminator (port 443), local certificates, and the SERVIDOR-LOCAL entry in the server list. It then launches the game completely headless, travels to the map, and starts listening on UDP port 7777.
Monitor the log file at %TEMP%\servidor_host_headless.out and wait until you see the line LISTEN OK (takes approx. 30–70 seconds).
• With window: Running without --sem-interface opens the host with a game window; press F8 once you reach the menu.
• Saves: The Firestore state is exported every 60 seconds to servicos\firestore_emu\emu_data (where character data is saved).
• Resource Usage: Uses ~1.5 CPU cores and ~10 GB of RAM (since the entire map is loaded into memory).

Running the Client

You must use a different Windows user account (or a separate PC). The game cannot open two instances under the same user because the local Firestore database in %LOCALAPPDATA% gets locked by the first process.
Run the following command:
bash
python cliente\cliente_conecta.py
Use code with caution.
Inside the game: Log in → Go to Server Browser → Click Refresh → Select SERVIDOR-LOCAL.
Each player requires a unique SteamId. Set the TDB_STEAMID and TDB_NOME environment variables before running the client script (defaults are 76561197960287930 / Jogador1). Use the --diag flag to enable diagnostic scripts (note: this will significantly impact performance).

Tools

To grant 50,000 credits to connected player(s) (the exact amount can be adjusted at the top of the script file), run:
bash
python -I host\carregar_script_no_host.py <host_PID> host\ferramentas\dar_dinheiro.js
Use code with caution.

Known Limitations

• Local-only: Currently only tested with both the host and client running on the same PC (127.0.0.1). Playing over a LAN network or a VPS requires modifying the server address in the server list and inside cliente\tdb_fname_join.js.
• Multiplayer stability: Stable interaction between two separate players is not yet guaranteed; logging in a second simultaneous player is currently untested.
• Performance: Because network replication is recreated via JavaScript hooks (as the client build lacks native ServerReplicateActors logic), performance sits around ~40–55 FPS with one client connected.
If you want to customize this further, let me know if you need help with:
• Translating specific code files or internal script comments.
• Documenting how to configure the scripts for LAN / VPS networking.
• Setting up the environment variables automatically via a batch file (.bat).
