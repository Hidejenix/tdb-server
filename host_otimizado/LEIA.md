# host_otimizado — versão otimizada do host (experimental)

Cópia da pasta `host/` com a replicação reescrita. A pasta `host/` continua igual e é a versão estável.

## O que muda

Os três scripts `replicacao.js`, `replicacao_donos.js` e `replicacao_distancia.js` viraram um só: `scripts/replicacao_otimizada.js`.

1. **Frequência por ator.** Cada ator é replicado no ritmo do seu `NetUpdateFrequency` (AActor +0x170), como faz o motor original.
   - Antes, todo ator perto ia a cada 2 quadros (~20/s). Um zumbi tem 5/s.
   - **Piso de 4/s:** mudanças de estado (portas, PlayerState com 1/s) não demoram mais que 250 ms.
   - **Ator novo** para um jogador passa na hora.
2. **Prioridade.** Quando a lista "perto" de um jogador enche (250), entra o ator mais perto e sai o mais longe.
3. **Laço em C.** O laço roda num CModule do Frida, compilado na hora pelo TinyCC; não precisa de compilador.
   - O gancho do `TickFlush` é nativo, e no quadro normal não passa pelo JavaScript.
   - O JS só prepara, registra eventos raros e escreve as estatísticas.
4. **Validação dos atores pela GObjects.** Ator destruído não é mais tocado. Em C, ponteiro ruim derrubaria o jogo.
5. **Medição embutida.** A cada 60 s sai no log uma linha `[otim]` com:
   - tick (q/s);
   - **tempo do gancho por quadro** (médio e máximo);
   - chamadas de `ReplicateActor` por segundo e quantas a frequência poupou;
   - tamanhos das listas.

6. **Baús de loot e atores sempre relevantes** (07/11). Pela análise estática, os baús (`MPMainContainerBox`, base do `LootPoint`) são `bAlwaysRelevant`, `DormantAll` e 2/s, e passavam do limite de 150 do `host/`: ficavam sem canal.
   - **Limite** de sempre relevantes: **8192**.
   - **Dormência:** ator dormente (DormantAll/Initial) recebe tudo ao abrir o canal. Depois, só quando o jogo o acorda (`FlushNetDormancy` / `ForceNetUpdate`, com ganchos nos thunks nativos) ou na releitura de segurança a cada 10 s.
   - **Freio:** no máximo 32 canais novos por jogador por quadro. Um passe por quadro abre os canais pendentes; milhares de baús chegam em alguns segundos, sem afogar a conexão.
   - Na linha `[otim]` aparecem "dormentes poupados", "acordados" e "canais adiados (freio)".

Comportamento mantido do `host/`:
- canais fechados depois de 8 s fora do alcance (1,2× NetCull);
- portas e teleportes nunca fechados;
- ator do próprio jogador nunca fechado;
- arma e equipamento pelo caminho dos filhos;
- `ReplicationFrame++` e ViewTarget.

## Como usar

- **PC:** `python -I host_otimizado\servidor_host.py`, com as mesmas opções do `host\servidor_host.py`.
- **VPS:** `TDB_HOST_PASTA=host_otimizado bash linux/subir_tudo.sh`, ou com `linux/iniciar_host.sh`. Sem a variável, sobe o `host/` de sempre.
- **Opções extras do runner:**
  - `--sem-frequencia`: mesmo laço em C, sem o ritmo por ator; serve para comparar;
  - `--freq-min N`: muda o piso de 4/s.
- **Voltar:** é só subir pela pasta `host/`.

## Teste fora do jogo

```bash
python -I host_otimizado/testes/rodar_teste.py
```

O teste compila o módulo C num processo qualquer (`ping.exe`), monta um mundo falso e roda quadros a 40 q/s. Confere:
- o ritmo de cada tipo de ator;
- a carência de 8 s antes de fechar;
- que portas nunca fecham;
- ator destruído;
- a prioridade;
- a comparação com e sem frequência.

Resultado em 07/11: **tudo ok**. No cenário de teste, foram **43% menos `ReplicateActor`**, já contando o PC e o pawn, que vão todo quadro. Numa cena com muitos zumbis e objetos a redução deve ser maior: cada zumbi cai de 200 para 50 chamadas em 10 s.

## Ainda não testado no jogo

O teste usa funções falsas do motor. Antes de trocar de vez, rode no host real com 1–2 jogadores e compare as linhas `[otim]`. Pontos a observar:
- zumbis se movendo sem "teleportar";
- portas e baús respondendo na hora;
- arma aparecendo;
- teleporte terreno → Woodberry.

Mais pontos a observar no teste:
- **Loot:** o 2º jogador deve ver aberto o baú que o 1º saqueou. Use o `host/ferramentas/monitor_loot_tiro.js` (`canais=2/2` nos baús).
- **Log:** "ganchos de acordar" já aparece (VPS, 07/11). Com o mapa carregado há **~15.700 sempre relevantes** (limite da lista: 32768; se encher, aparece `lista de sempre relevantes CHEIA`). Observe quanto tempo o 2º jogador leva para receber tudo ao entrar e o tick com 2 jogadores.

Se algo der errado, volte para `host/`.
