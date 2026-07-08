# Torre de Controle Linehaul · CEVA × Shopee

Dashboard estático (HTML + CSS + JS puro) para acompanhar a operação de linehaul: KPIs com as metas do BSC 3.0, mapa real das rotas (calor ou nº de viagens), filtros de período e transportadora, e gráficos com rótulos de dados.

## Estrutura

```
├── index.html      # página do dashboard
├── styles.css      # estilos
├── app.js          # filtros, KPIs, mapa e gráficos
├── data.js         # cópia estática consolidada (Base + 2025 + 2026) — fallback
└── gas/Code.gs     # Web App do Google Apps Script (dados ao vivo, multi-aba)
```

Sem build e sem dependências instaladas — Leaflet e fontes via CDN. GitHub Pages funciona direto.

## Conectando ao Google Sheets (dados ao vivo)

O `gas/Code.gs` lê **todas as abas** (`Base`, `2025`, `2026`), unifica os cabeçalhos (as abas têm esquemas diferentes, mas as colunas usadas existem em todas) e **remove duplicidades pelo LH TRIP** — a aba `Base` tem prioridade.

1. Planilha → **Extensões → Apps Script** → substitua o conteúdo do `Code.gs`.
2. **Implantar → Gerenciar implantações → ✏️ editar → Versão: "Nova versão" → Implantar.**
   Assim a URL `/exec` continua a mesma. (Nova implantação = URL nova.)
3. Configuração obrigatória:
   - Executar como: **você**
   - Quem pode acessar: **"Qualquer pessoa"** — *não* "Qualquer pessoa com conta Google", senão o navegador recebe uma tela de login em vez do JSON.
4. Teste: abra a URL `/exec` numa **guia anônima**. Deve mostrar o JSON puro sem pedir login.

A URL já está configurada em `CONFIG.SHEETS_API_URL` no `app.js`. Se a chamada falhar, o dashboard cai na cópia local (`data.js`) e o selo no topo mostra o motivo ao passar o mouse.

## Filtros

Ano · Mês · Semana · Dia (em cascata) + **Transportadora**: `TAC` (TSPs contendo "TAC": G-TAC, G-TAC MENSAL…) ou `TERCEIRO` (demais). A regra fica em `classificarTsp()` no `app.js`.

## KPIs exibidos (metas do BSC 3.0)

| KPI | Target | Mínimo | Cálculo |
|---|---|---|---|
| ETA Origem | 99% | 97% | Pacotes `ANÁLISE ETA ORIGEM = NO PRAZO` ÷ pacotes analisados |
| CPT Origem (ETD) | 99% | 97% | Pacotes `ANÁLISE CPT = NO PRAZO` ÷ pacotes analisados |
| No Show | 99% | 97% | `1 − no shows ÷ (fechadas + no shows)` |
| ETA Destino | 95% | 93% | Pacotes `ANÁLISE ETA DESTINO = NO PRAZO` ÷ pacotes analisados |

Somente os indicadores que existem na planilha do Team CEVA — sem painel de pontuação.

## Mapa

Dois modos, alternáveis no topo do painel:
- **Mapa de calor** — intensidade por viagens ou pacotes;
- **Nº de viagens** — bolha com o total por localidade (saídas, chegadas ou ambos, conforme o seletor Origem/Destino).

As colunas `ORIGEM`/`DESTINO` seguem `Tipo_UF_Cidade` e são separadas automaticamente (funciona com `LM Hub_SP_Campinas_São Martinho`, aspas perdidas, `Osasco_02` etc.). Coordenadas ficam no dicionário `COORDS` do `app.js` (chave `uf|cidade`, sem acento); localidades sem coordenada são listadas abaixo do mapa.

## Gráficos

- **Viagens por período** — granularidade automática (dia → semana → mês conforme o filtro), com rótulos de dados nas barras e na linha de % no prazo.
- **Viagens por tipo de veículo** — barras horizontais com viagens e pacotes rotulados.
