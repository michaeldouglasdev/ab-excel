import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";
import { loadEnv, getPositionalArgs } from "./env";

const env = loadEnv();

const DEFAULT_BATCH_SIZE = 115; // múltiplo de 23 conforme API CleverTap

interface CleverTapPlatformInfo {
  objectId?: string;
  platform?: string;
}

interface CleverTapRecord {
  identity?: string;
  email?: string;
  name?: string;
  profileData?: Record<string, unknown>;
  platformInfo?: CleverTapPlatformInfo[];
}

interface GetCursorResponse {
  status: string;
  cursor?: string;
}

interface GetProfilesResponse {
  status: string;
  next_cursor?: string;
  records?: CleverTapRecord[];
}

interface PopulateConfig {
  accountId: string;
  passcode: string;
  region: string;
  outputPath: string;
  eventName: string;
  fromDate: string;
  toDate: string;
  batchSize: number;
}

function getConfig(): PopulateConfig {
  const accountId = process.env.CLEVERTAP_ACCOUNT_ID;
  const passcode = process.env.CLEVERTAP_PASSCODE;
  const region = process.env.CLEVERTAP_REGION || "in1";
  const outputPath =
    getPositionalArgs()[0] ||
    process.env.EXCEL_OUTPUT_PATH ||
    "./profiles.xlsx";
  const eventName = process.env.EVENT_NAME || "App Launched";
  const fromDate = process.env.FROM_DATE || "20200101";
  const toDate = process.env.TO_DATE || "20251231";

  let batchSize = DEFAULT_BATCH_SIZE;
  const envBatch = process.env.BATCH_SIZE;
  if (envBatch) {
    const n = parseInt(envBatch, 10);
    if (!isNaN(n) && n >= 23) {
      batchSize = Math.floor(n / 23) * 23 || 23;
    }
  }

  if (!accountId || !passcode) {
    console.error(
      `Erro: CLEVERTAP_ACCOUNT_ID e CLEVERTAP_PASSCODE são obrigatórios no .env.${env}`,
    );
    process.exit(1);
  }

  return {
    accountId,
    passcode,
    region,
    outputPath: path.resolve(outputPath),
    eventName,
    fromDate,
    toDate,
    batchSize,
  };
}

/** Retorna o objectId (guid da CleverTap) para a coluna E — lido pelo delete-profiles.ts com ID_TYPE=guid */
function getObjectId(record: CleverTapRecord): string {
  const platform = record.platformInfo?.find((p) => p.objectId);
  return platform?.objectId ?? "";
}

function recordToRow(record: CleverTapRecord): (string | number)[] {
  const pd = record.profileData as Record<string, string> | undefined;
  const identity = record.identity ?? "";
  const email = record.email ?? pd?.email ?? "";
  const objectId = getObjectId(record);
  const phone = pd?.phone ?? pd?.["Phone"] ?? "";
  const firstName = pd?.["First-Name"] ?? "";
  const lastName = pd?.["Last-Name"] ?? "";
  const fullName = pd?.["Full-Name"] ?? (record.name ?? pd?.name ?? "");

  return [
    "",           // Gender
    email,
    identity,
    phone,
    objectId,     // CleverTap
    "",           // Device
    "",           // Mobile Token
    "",           // itp
    firstName,
    lastName,
    fullName,
    "",           // Creation-Date
    "",           // Onb-Limit
  ];
}

async function getCursor(config: PopulateConfig): Promise<string | null> {
  const url = `https://${config.region}.api.clevertap.com/1/profiles.json?batch_size=${config.batchSize}`;
  const body = JSON.stringify({
    event_name: config.eventName,
    from: parseInt(config.fromDate, 10),
    to: parseInt(config.toDate, 10),
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-CleverTap-Account-Id": config.accountId,
      "X-CleverTap-Passcode": config.passcode,
      "Content-Type": "application/json",
    },
    body,
  });

  const data = (await response.json()) as GetCursorResponse;
  if (!response.ok) {
    throw new Error(
      `Falha ao obter cursor: ${response.status} - ${JSON.stringify(data)}`,
    );
  }
  return data.cursor ?? null;
}

async function getProfilesPage(
  config: PopulateConfig,
  cursor: string,
): Promise<GetProfilesResponse> {
  const url = `https://${config.region}.api.clevertap.com/1/profiles.json?cursor=${encodeURIComponent(cursor)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-CleverTap-Account-Id": config.accountId,
      "X-CleverTap-Passcode": config.passcode,
      "Content-Type": "application/json",
    },
  });

  const data = (await response.json()) as GetProfilesResponse;
  if (!response.ok) {
    throw new Error(
      `Falha ao obter perfis: ${response.status} - ${JSON.stringify(data)}`,
    );
  }
  return data;
}

function writeExcel(rows: (string | number)[][], outputPath: string): void {
  const headers = [
    "Gender",
    "Email",
    "Identity",
    "Phone",
    "CleverTap",
    "Device",
    "Mobile Token",
    "itp",
    "First-Name",
    "Last-Name",
    "Full-Name",
    "Creation-Date",
    "Onb-Limit",
  ];
  const data = [headers, ...rows];

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Profiles");

  XLSX.writeFile(wb, outputPath);
}

async function main(): Promise<void> {
  const config = getConfig();

  console.log(`--- Popular planilha CleverTap [${env.toUpperCase()}] ---`);
  console.log(`Ambiente: ${env}`);
  console.log(`Evento: ${config.eventName}`);
  console.log(`Período: ${config.fromDate} a ${config.toDate}`);
  console.log(`Arquivo de saída: ${config.outputPath}`);
  console.log(`Batch size: ${config.batchSize}\n`);

  console.log("Obtendo cursor inicial...");
  let cursor = await getCursor(config);

  if (!cursor) {
    console.log("Nenhum perfil encontrado para os critérios informados.");
    return;
  }

  const allRows: (string | number)[][] = [];
  let pageNum = 1;

  while (cursor) {
    process.stdout.write(`Página ${pageNum}... `);

    const result = await getProfilesPage(config, cursor);
    const records = result.records ?? [];

    for (const rec of records) {
      const objectId = getObjectId(rec);
      if (objectId) {
        allRows.push(recordToRow(rec));
      }
    }

    console.log(`${records.length} perfis (total: ${allRows.length})`);

    cursor = result.next_cursor ?? null;
    pageNum++;

    if (cursor) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  if (allRows.length === 0) {
    console.log("\nNenhum perfil com ID válido encontrado.");
    return;
  }

  writeExcel(allRows, config.outputPath);

  console.log(`\nPlanilha salva: ${config.outputPath}`);
  console.log(`Total: ${allRows.length} perfis`);
  console.log("Coluna E (CleverTap) pronta para uso com delete-profiles.ts.");
}

main().catch((err) => {
  const msg =
    err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error("Erro fatal:", err);

  const errorLogPath = path.join(
    process.cwd(),
    `erro-fatal-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.log`,
  );
  const content = `# ${new Date().toISOString()}\n${msg}${stack ? `\n${stack}` : ""}\n`;
  fs.writeFileSync(errorLogPath, content, "utf-8");
  console.error(`Erro registrado em: ${errorLogPath}`);

  process.exit(1);
});
