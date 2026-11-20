#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
if command -v node >/dev/null 2>&1; then
  exec npm "$@"
fi
if [[ -x "$PWD/.tools/node/bin/node" ]]; then
  export PATH="$PWD/.tools/node/bin:$PATH"
  exec npm "$@"
fi
print -u2 'Для сборки установите Node.js LTS (https://nodejs.org/), затем выполните npm ci.'
exit 1
