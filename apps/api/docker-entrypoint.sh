#!/bin/sh
# Aplica as migrations pendentes e so depois entrega o processo ao CMD.
#
# `migrate deploy` e o comando de producao: aplica o que esta em
# prisma/migrations e nunca gera nem apaga nada: ao contrario de `migrate dev`,
# ele jamais reseta o banco.
set -e

if [ -z "${DATABASE_URL}" ]; then
  echo "[entrypoint] DATABASE_URL nao definida" >&2
  exit 1
fi

echo "[entrypoint] aplicando migrations..."
./node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma

echo "[entrypoint] migrations aplicadas; subindo a API"
exec "$@"
