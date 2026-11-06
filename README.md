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
