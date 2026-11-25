#!/bin/sh
# Restaura um dump de infra/backup.sh por cima do banco em uso. Roda no HOST.
#
# Roda no Linux do homelab. No Git Bash do Windows ele falha de um jeito confuso:
# o MSYS converte o `/backups/...` dos argumentos em caminho Windows, e o pg_dump
# tenta escrever em `C:/Program Files/Git/backups/`. Para rodar daqui,
# `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'` antes do comando.
#
#   ./infra/restaurar.sh                      # lista os dumps disponíveis
#   ./infra/restaurar.sh habito-20261125-0415.dump
#   ./infra/restaurar.sh <arquivo> --sim      # sem a confirmação escrita
#
# É DESTRUTIVO: o banco atual é derrubado e reconstruído a partir do arquivo.
# Tudo que entrou depois daquele dump deixa de existir. Por isso a confirmação é
# a palavra escrita, e não `s/n` — o mesmo critério das CLIs de reset em cli/.
#
# O que a restauração traz de volta e o que não traz:
#
#   traz   hábitos, config versionada, registros, sessões, a passkey cadastrada,
#          o par VAPID e o `rp_id` (tudo mora no banco);
#   não traz  nada do .env, e nada muda no túnel.
#
# Com uma pegadinha: a passkey restaurada só continua valendo se o `rp_id`
# gravado for o domínio pelo qual o app é acessado agora. Restaurar um dump de
# antes de uma troca de domínio devolve a passkey do domínio antigo, que o
# navegador recusa — a saída é `cli:reset-biometria`.
set -eu

RAIZ=$(cd "$(dirname "$0")/.." && pwd)
cd "$RAIZ"

DESTINO="${HABITO_BACKUP_DIR:-/var/backups/controle-habito}"
CONFIRMACAO="RESTAURAR"

do_env() {
  [ -f .env ] || return 0
  grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- | tr -d "\"' \r"
}

USUARIO="${POSTGRES_USER:-$(do_env POSTGRES_USER)}"
BANCO="${POSTGRES_DB:-$(do_env POSTGRES_DB)}"
USUARIO="${USUARIO:-habito}"
BANCO="${BANCO:-controle_habito}"

ARQUIVO="${1:-}"
SIM="${2:-}"

if [ -z "$ARQUIVO" ]; then
  echo "Dumps em $DESTINO:"
  ls -1t "$DESTINO"/habito-*.dump 2>/dev/null | while IFS= read -r d; do
    echo "  $(basename "$d")  ·  $(du -h "$d" | cut -f1)  ·  $(date -r "$d" '+%F %T' 2>/dev/null)"
  done
  echo
  echo "Uso: $0 <arquivo.dump> [--sim]"
  exit 1
fi

# Só o nome interessa: o arquivo é lido de dentro do contêiner, em /backups.
ARQUIVO=$(basename "$ARQUIVO")

if [ ! -f "$DESTINO/$ARQUIVO" ]; then
  echo "Não encontrei $DESTINO/$ARQUIVO" >&2
  exit 1
fi

echo "── Restauração do Controle de Hábitos ──"
echo
echo "  arquivo : $ARQUIVO"
echo "  banco   : $BANCO (usuário $USUARIO)"
echo

# Confere o arquivo ANTES de derrubar o que está de pé. Descobrir que o dump não
# abre depois de apagar o banco é a única forma de transformar uma restauração em
# uma perda de dados.
echo "[restaurar] conferindo o arquivo"
TOC=$(docker compose exec -T postgres pg_restore --list "/backups/$ARQUIVO")

for tabela in habito registro config_app; do
  if ! printf '%s\n' "$TOC" | grep -q "TABLE DATA public $tabela"; then
    echo "[restaurar] RECUSADO: o dump não lista os dados de '$tabela'. Nada foi tocado." >&2
    exit 1
  fi
done
echo "[restaurar] ok, o arquivo abre e tem os dados"
echo

if [ "$SIM" != "--sim" ]; then
  if [ ! -t 0 ]; then
    echo "Sem terminal interativo não há como confirmar. Use --sim se a intenção é essa." >&2
    exit 1
  fi
  printf 'Isto APAGA o banco atual e o reconstrói do dump.\nEscreva %s para continuar: ' "$CONFIRMACAO"
  read -r resposta
  if [ "$resposta" != "$CONFIRMACAO" ]; then
    echo "Não confirmado. Nada foi tocado."
    exit 1
  fi
  echo
fi

# App e worker param primeiro: com eles de pé o DROP DATABASE disputaria com
# conexões vivas, e o worker poderia materializar sobre um banco meio restaurado.
echo "[restaurar] parando app e worker"
docker compose stop app worker

echo "[restaurar] recriando o banco"
# `WITH (FORCE)` derruba as conexões que sobraram (PG13+). O `-d postgres` é
# obrigatório: não se apaga o banco ao qual se está conectado.
docker compose exec -T postgres psql -U "$USUARIO" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"$BANCO\" WITH (FORCE)" \
  -c "CREATE DATABASE \"$BANCO\" OWNER \"$USUARIO\""

echo "[restaurar] restaurando"
# `--exit-on-error` de propósito: um aviso ignorado aqui é uma tabela que não
# voltou, e o app só contaria isso semanas depois.
docker compose exec -T postgres \
  pg_restore -U "$USUARIO" -d "$BANCO" --no-owner --no-privileges --exit-on-error "/backups/$ARQUIVO"

# `up -d` e não `start app worker`: o serviço `migrate` roda de novo e aplica as
# migrations que a imagem atual tenha a mais que o dump restaurado.
echo "[restaurar] subindo tudo de novo"
docker compose up -d

echo
echo "[restaurar] pronto · $(date '+%F %T')"
echo "Confira pelo domínio: dashboard com os hábitos, sequência e o histórico do dia."
