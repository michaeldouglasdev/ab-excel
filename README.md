# Alt Excel - CleverTap Profiles

Projeto Node.js + TypeScript para gerenciar perfis CleverTap via planilha Excel:

1. **populate-profiles** – consome a API de paginação da CleverTap e preenche uma planilha com os perfis
2. **delete-profiles** – lê IDs da coluna E e envia requisições para exclusão em lotes de 100

## Pré-requisitos

- Node.js 18+
- Planilha Excel com IDs na coluna E

## Instalação

```bash
npm install
```

## Configuração

O ambiente (qa ou prod) é passado via CLI. Cada ambiente usa seu próprio arquivo `.env`:

```bash
cp .env.qa.example .env.qa
cp .env.prod.example .env.prod
```

Edite cada arquivo com as credenciais CleverTap do respectivo ambiente.

**Variáveis obrigatórias:**
- **CLEVERTAP_ACCOUNT_ID** e **CLEVERTAP_PASSCODE**: CleverTap Dashboard > Settings > API Credentials
- **CLEVERTAP_REGION**: ex: `in1`, `us1`
- **ID_TYPE**: `guid` (padrão) ou `identity`

## Uso

O ambiente é passado via CLI com `--env=qa` ou `--env=prod` (ou `-e qa` / `-e prod`). Padrão: **prod**.

```bash
# QA
npm run delete-profiles -- --env=qa ./planilha.xlsx
npm run populate-profiles -- --env=qa ./saida.xlsx

# Prod (padrão)
npm run delete-profiles -- ./planilha.xlsx
npm run populate-profiles -- ./saida.xlsx
```

## Estrutura da planilha

- Os IDs devem estar na **coluna E**
- A primeira linha pode ser cabeçalho (será ignorada se não for um ID válido)
- IDs vazios são ignorados

## API CleverTap

- Endpoint: `POST https://[region].api.clevertap.com/1/delete/profiles.json`
- Máximo de 100 IDs por requisição (o script já faz o batching automaticamente)
- A exclusão é permanente e pode levar até 48h para ser processada
