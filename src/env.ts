import * as fs from "fs";
import * as path from "path";
import { config } from "dotenv";

export type EnvName = "qa" | "prod";

/**
 * Carrega variáveis de ambiente baseado no parâmetro CLI.
 * Uso: --env=qa | --env=prod ou -e qa | -e prod
 * Padrão: prod
 *
 * Arquivos esperados: .env.qa e .env.prod
 */
export function loadEnv(): EnvName {
  const envArg = process.argv.find((a) => a.startsWith("--env="));
  const envFromFlag = envArg?.split("=")[1];

  const eIdx = process.argv.indexOf("-e");
  const envFromShort = eIdx >= 0 && eIdx + 1 < process.argv.length ? process.argv[eIdx + 1] : null;

  const env = (envFromFlag || envFromShort || "prod").toLowerCase() as EnvName;

  if (env !== "qa" && env !== "prod") {
    console.error(`Ambiente inválido: "${env}". Use qa ou prod.`);
    process.exit(1);
  }

  const envPath = path.resolve(process.cwd(), `.env.${env}`);

  if (!fs.existsSync(envPath)) {
    console.error(`Arquivo não encontrado: ${envPath}`);
    console.error(`Crie o arquivo .env.${env} com as credenciais CleverTap.`);
    process.exit(1);
  }

  config({ path: envPath });
  return env;
}

/**
 * Retorna os argumentos posicionais da CLI, excluindo --env e -e.
 */
export function getPositionalArgs(): string[] {
  const args = process.argv.slice(2);
  const result: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--env=")) continue;
    if (args[i] === "-e") {
      i++;
      continue;
    }
    result.push(args[i]);
  }

  return result;
}
