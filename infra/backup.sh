#!/bin/sh
# pg_dump do Postgres do compose, verificado e com retenção. Roda no HOST, pela
# crontab — ver Docs/Deploy.md.
#
# Roda no Linux do homelab. No Git Bash do Windows ele falha de um jeito confuso:
# o MSYS converte o `/backups/...` dos argumentos em caminho Windows, e o pg_dump
# tenta escrever em `C:/Program Files/Git/backups/`. Para rodar daqui,
# `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'` antes do comando.
#
# Quatro decisões dentro:
#
# 1. **Formato custom** (`-Fc`), não SQL em texto: é comprimido, e `pg_restore`
#    aceita restaurar dele seletivamente — de um .sql só dá para restaurar tudo.
# 2. **Escrito pelo contêiner**, no diretório montado em /backups. Assim o host
#    não precisa de um cliente Postgres instalado, e nunca há versão de cliente
#    diferente da do servidor.
# 3. **Verificado antes de contar como backup.** O dump recém-escrito passa por
#    `pg_restore --list` e tem de listar as tabelas que importam. Um arquivo
#    truncado por disco cheio tem tamanho, data e nada dentro; sem esta
#    conferência o cron registraria sucesso por um mês e a descoberta viria na
#    restauração. É o critério que o roadmap fixou: backup não verificado não é
#    backup.
# 4. **Escreve em `.parcial` e renomeia no fim.** Um dump interrompido no meio
#    nunca fica parecido com um backup bom, e a retenção não o conta.
set -eu

RAIZ=$(cd "$(dirname "$0")/.." && pwd)
cd "$RAIZ"

# O mesmo valor que o compose monta em /backups. Mudar um sem o outro faria o
# script contar arquivos num diretório e o Postgres escrever em outro.
DESTINO="${HABITO_BACKUP_DIR:-/var/backups/controle-habito}"
RETENCAO_DIAS="${HABITO_BACKUP_RETENCAO:-30}"
# Quantos dumps ficam sempre, mesmo todos vencidos. Protege o caso em que o
# backup falhou por semanas sem ninguém ler o log: a retenção não pode ser o que
# apaga a última cópia existente.
MINIMO=4

# Lidas do .env sem dar `source` nele: o arquivo tem senha e token do túnel, e
# importá-lo inteiro para o ambiente de um script de cron é mais do que ele
# precisa. O `\r` no `tr` é porque o repositório é editado no Windows.
do_env() {
  [ -f .env ] || return 0
  grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- | tr -d "\"' \r"
}

USUARIO="${POSTGRES_USER:-$(do_env POSTGRES_USER)}"
BANCO="${POSTGRES_DB:-$(do_env POSTGRES_DB)}"
USUARIO="${USUARIO:-habito}"
BANCO="${BANCO:-controle_habito}"

NOME="habito-$(date +%Y%m%d-%H%M).dump"

echo "[backup] $(date '+%F %T') · $BANCO -> $DESTINO/$NOME"

docker compose exec -T postgres \
  pg_dump -U "$USUARIO" -d "$BANCO" --format=custom --compress=9 -f "/backups/$NOME.parcial"

# A conferência. `pg_restore --list` lê o índice do arquivo; as três tabelas são
# o que prova que o dump é deste app e trouxe dados, não só schema.
TOC=$(docker compose exec -T postgres pg_restore --list "/backups/$NOME.parcial")

for tabela in habito registro config_app; do
  if ! printf '%s\n' "$TOC" | grep -q "TABLE DATA public $tabela"; then
    echo "[backup] FALHOU: o dump não lista os dados de '$tabela'." >&2
    echo "[backup] mantido como $DESTINO/$NOME.parcial para inspeção." >&2
    exit 1
  fi
done

docker compose exec -T postgres mv "/backups/$NOME.parcial" "/backups/$NOME"

TABELAS=$(printf '%s\n' "$TOC" | grep -c 'TABLE DATA' || true)
echo "[backup] ok · $(du -h "$DESTINO/$NOME" 2>/dev/null | cut -f1) · $TABELAS tabelas com dados"

# Retenção: do mais novo para o mais velho, pula os $MINIMO primeiros e apaga do
# resto só o que passou de $RETENCAO_DIAS.
ls -1t "$DESTINO"/habito-*.dump 2>/dev/null | tail -n "+$((MINIMO + 1))" | while IFS= read -r velho; do
  if [ -n "$(find "$velho" -maxdepth 0 -mtime "+$RETENCAO_DIAS" 2>/dev/null)" ]; then
    rm -f "$velho"
    echo "[backup] removido por retenção: $velho"
  fi
done

echo "[backup] $(ls -1 "$DESTINO"/habito-*.dump 2>/dev/null | wc -l) dump(s) em $DESTINO"
