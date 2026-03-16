import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";
import { loadEnv, getPositionalArgs } from "./env";

const env = loadEnv();

const BATCH_SIZE = 100;
const ID_COLUMN = "E"; // CleverTap (objectId)
const IDENTITY_COLUMN = "C"; // Identity — só deleta se estiver nulo/vazio

interface Config {
  accountId: string;
  passcode: string;
  region: string;
  excelPath: string;
  idType: "guid" | "identity";
}

function getConfig(): Config {
  const accountId = process.env.CLEVERTAP_ACCOUNT_ID;
  const passcode = process.env.CLEVERTAP_PASSCODE;
  const region = process.env.CLEVERTAP_REGION || "in1";
  const excelPath = getPositionalArgs()[0] || process.env.EXCEL_FILE_PATH;
  const idType = (process.env.ID_TYPE || "guid") as "guid" | "identity";

  if (!accountId || !passcode) {
    console.error(`Erro: CLEVERTAP_ACCOUNT_ID e CLEVERTAP_PASSCODE são obrigatórios no .env.${env}`);
    process.exit(1);
  }

  if (!excelPath) {
    console.error("Erro: Informe o caminho da planilha Excel como argumento ou via EXCEL_FILE_PATH");
    process.exit(1);
  }

  const resolvedPath = path.resolve(excelPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Erro: Arquivo não encontrado: ${resolvedPath}`);
    process.exit(1);
  }

  return { accountId, passcode, region, excelPath: resolvedPath, idType };
}

function extractIdsFromExcel(filePath: string): string[] {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });

  const ids: string[] = [];
  const idColIndex = XLSX.utils.decode_col(ID_COLUMN); // E = 4 (CleverTap)
  const identityColIndex = XLSX.utils.decode_col(IDENTITY_COLUMN); // C = 2

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!Array.isArray(row)) continue;

    // Só inclui se Identity for nulo ou vazio
    const identity = row[identityColIndex];
    if (identity !== undefined && identity !== null && String(identity).trim() !== "") {
      continue;
    }

    const idValue = row[idColIndex];
    if (idValue !== undefined && idValue !== null) {
      const value = String(idValue).trim();
      if (value) {
        ids.push(value);
      }
    }
  }

  return ids;
}

function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function createLogWriter(excelPath: string): {
  path: string;
  log: (ids: string[], status: "deletado" | "erro", message?: string) => void;
  separator: () => void;
} {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const baseName = path.basename(excelPath, path.extname(excelPath));
  const logPath = path.join(path.dirname(excelPath), `deletados-${baseName}-${timestamp}.log`);

  const header =
    `# Ambiente: ${env} | Planilha: ${path.basename(excelPath)} | Início: ${new Date().toISOString()}\n` +
    `# formato: timestamp\tstatus\tid\tmensagem\n` +
    `# ---\n`;
  fs.writeFileSync(logPath, header, "utf-8");

  return {
    path: logPath,
    log(ids: string[], status: "deletado" | "erro", message?: string) {
      const ts = new Date().toISOString();
      const msg = message ? `\t${String(message).replace(/\s+/g, " ")}` : "";
      for (const id of ids) {
        fs.appendFileSync(logPath, `${ts}\t${status}\t${id}${msg}\n`, "utf-8");
      }
    },
    separator() {
      fs.appendFileSync(logPath, "\n", "utf-8");
    },
  };
}

async function deleteProfilesBatch(
  ids: string[],
  config: Config
): Promise<{ success: boolean; status: number; message: string }> {
  const url = `https://${config.region}.api.clevertap.com/1/delete/profiles.json`;
  const body = JSON.stringify({ [config.idType]: ids });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-CleverTap-Account-Id": config.accountId,
      "X-CleverTap-Passcode": config.passcode,
      "Content-Type": "application/json; charset=utf-8",
    },
    body,
  });

  const text = await response.text();
  let message = text;
  try {
    const json = JSON.parse(text);
    message = json.status || json.error || text;
  } catch (parseErr) {
    console.error("Resposta da API não é JSON válido:", parseErr instanceof Error ? parseErr.message : parseErr);
  }

  return {
    success: response.ok,
    status: response.status,
    message,
  };
}

async function main(): Promise<void> {
  const config = getConfig();

  console.log(`Ambiente: ${env}`);
  console.log("Lendo planilha Excel...");
  const ids = extractIdsFromExcel(config.excelPath);

  if (ids.length === 0) {
    console.log("Nenhum ID encontrado (coluna E) com Identity vazio (coluna C).");
    return;
  }

  const logWriter = createLogWriter(config.excelPath);
  console.log(`Log: ${logWriter.path}`);

  console.log(`Encontrados ${ids.length} IDs para exclusão (Identity nulo/vazio na coluna C).`);
  console.log(`Enviando em lotes de ${BATCH_SIZE} para a API CleverTap...\n`);

  const batches = chunk(ids, BATCH_SIZE);
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNum = i + 1;

    process.stdout.write(
      `Lote ${batchNum}/${batches.length} (${batch.length} IDs)... `
    );

    try {
      const result = await deleteProfilesBatch(batch, config);

      if (result.success) {
        successCount += batch.length;
        logWriter.log(batch, "deletado");
        console.log(`OK`);
      } else {
        errorCount += batch.length;
        logWriter.log(batch, "erro", `status ${result.status}: ${result.message}`);
        console.log(`ERRO (${result.status}): ${result.message}`);
      }
    } catch (err) {
      errorCount += batch.length;
      const msg = err instanceof Error ? err.message : String(err);
      logWriter.log(batch, "erro", msg);
      console.log(`ERRO: ${msg}`);
    }
    logWriter.separator();

    // Pequena pausa entre requisições para evitar rate limit
    if (i < batches.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log("\n--- Resumo ---");
  console.log(`Sucesso: ${successCount} perfis enviados para exclusão`);
  if (errorCount > 0) {
    console.log(`Erros: ${errorCount} perfis`);
  }
  console.log(`\nLog salvo em: ${logWriter.path}`);
  console.log("\nNota: A exclusão pode levar até 48h para ser processada pela CleverTap.");
}

main().catch((err) => {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error("Erro fatal:", err);

  const errorLogPath = path.join(
    process.cwd(),
    `erro-fatal-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.log`
  );
  const content = `# ${new Date().toISOString()}\n${msg}${stack ? `\n${stack}` : ""}\n`;
  fs.writeFileSync(errorLogPath, content, "utf-8");
  console.error(`Erro registrado em: ${errorLogPath}`);

  process.exit(1);
});
