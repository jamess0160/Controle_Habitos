#!/bin/sh
# Migrations e seeds da subida. Roda dentro da imagem `worker`, como o serviço
# `migrate` do compose, uma vez por `docker compose up`.
#
# Os dois comandos são da API do Knex sob `tsx`, não do binário `knex` — ver a
# nota em db/cli.ts.
set -eu

echo "[migrar] aplicando migrations pendentes"
tsx db/cli.ts latest

# O seed aqui NÃO é o de desenvolvimento: `db/seeds/03_desenvolvimento.ts` se
# recusa a rodar com NODE_ENV=production. O que sobra é o que a primeira subida
# precisa e toda subida seguinte ignora:
#
#   01 config_app        — insere com ON CONFLICT DO NOTHING. Chave ausente do
#                          .env não entra vazia, então gerar o par VAPID depois
#                          da primeira subida ainda funciona. E `rp_id` gravado
#                          nunca é sobrescrito por um .env editado: trocá-lo
#                          invalidaria a biometria em silêncio.
#   02 credencial_senha  — semeia APP_SENHA_INICIAL só se não houver credencial.
#                          Depois do cadastro da biometria a senha fica
#                          desativada, e re-semear reabriria a porta que o app
#                          desliga de propósito.
echo "[migrar] semeando config_app e a senha do primeiro acesso (nunca sobrescreve)"
tsx db/cli.ts seed

echo "[migrar] pronto"
