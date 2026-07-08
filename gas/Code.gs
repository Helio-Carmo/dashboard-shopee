/**
 * Web App do Google Apps Script — expõe a planilha "Team CEVA Shopee" como JSON.
 * Lê TODAS as abas listadas em ABAS (Base + consolidados 2025/2026), unifica os
 * cabeçalhos (as abas têm quantidades de colunas diferentes, mas os nomes usados
 * aqui existem em todas) e remove duplicidades pelo LH TRIP — a aba "Base" tem
 * prioridade por vir primeiro na lista.
 *
 * COMO PUBLICAR / ATUALIZAR:
 * 1. Abra a planilha → Extensões → Apps Script → cole este código no Code.gs.
 * 2. Implantar → Gerenciar implantações → ✏️ editar a implantação existente →
 *    Versão: "Nova versão" → Implantar.
 *    (Se for a primeira vez: Implantar → Nova implantação → tipo "App da Web".)
 * 3. CONFIGURAÇÃO OBRIGATÓRIA para o dashboard funcionar no navegador:
 *    - Executar como: VOCÊ (proprietário)
 *    - Quem pode acessar: "QUALQUER PESSOA" (não "Qualquer pessoa com conta Google"!)
 * 4. A URL /exec permanece a mesma quando você atualiza a implantação existente;
 *    se criar uma NOVA implantação, a URL muda e precisa ser atualizada no app.js.
 *
 * TESTE RÁPIDO: abra a URL /exec numa guia anônima do navegador. Deve aparecer o
 * JSON puro, sem pedir login. Se pedir login, o acesso não está como "Qualquer pessoa".
 */

// Abas lidas, em ordem de prioridade para o dedupe (Base = semana atual, vence)
const ABAS = ["Base", "2025", "2026"];

// Somente as colunas que o dashboard usa (reduz o payload)
const COLUNAS = [
  "SEMANA", "DATA", "DIA", "TSP", "ROTA SHOPEE", "VEÍCULO",
  "ORIGEM", "DESTINO",
  "ANÁLISE ETA ORIGEM", "ANÁLISE CPT", "ANÁLISE ETA DESTINO",
  "STATUS REAL", "KM ROTA", "PACOTES", "LH TRIP"
];

function doGet() {
  try {
    const planilha = SpreadsheetApp.getActiveSpreadsheet();
    const fuso = Session.getScriptTimeZone();
    const vistos = {};   // LH TRIP -> true (dedupe entre abas)
    const linhas = [];

    ABAS.forEach(function (nomeAba) {
      const aba = planilha.getSheetByName(nomeAba);
      if (!aba) return; // ignora aba inexistente em vez de quebrar

      const valores = aba.getDataRange().getValues();
      if (valores.length < 2) return;
      const cabecalhos = valores[0].map(String);

      // mapeia índice de cada coluna nesta aba (esquemas diferem entre abas)
      const indice = {};
      COLUNAS.forEach(function (c) {
        const i = cabecalhos.indexOf(c);
        if (i >= 0) indice[c] = i;
      });

      for (let r = 1; r < valores.length; r++) {
        const linha = valores[r];
        if (linha.every(function (v) { return v === "" || v === null; })) continue;

        const obj = { ABA: nomeAba };
        for (const col in indice) {
          let v = linha[indice[col]];
          if (v instanceof Date) {
            v = Utilities.formatDate(v, fuso, col === "DATA" ? "yyyy-MM-dd" : "yyyy-MM-dd HH:mm:ss");
          } else if (v === "") {
            v = null;
          }
          obj[col] = v;
        }

        const trip = obj["LH TRIP"] ? String(obj["LH TRIP"]) : null;
        if (trip) {
          if (vistos[trip]) continue; // já veio de uma aba anterior (Base tem prioridade)
          vistos[trip] = true;
        }
        linhas.push(obj);
      }
    });

    return ContentService
      .createTextOutput(JSON.stringify(linhas))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (e) {
    // devolve o erro em JSON em vez de página HTML, para o dashboard exibir a causa
    return ContentService
      .createTextOutput(JSON.stringify({ error: String(e && e.message ? e.message : e) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
