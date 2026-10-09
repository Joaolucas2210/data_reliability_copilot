#!/usr/bin/env bash
# fmt + init(-backend=false) + validate for every Terraform root, via Docker (no local terraform needed).
# Never runs plan/apply and needs no cloud credentials.
set -euo pipefail
TF_IMAGE="${TF_IMAGE:-hashicorp/terraform:1.16.5}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOTS=(azure/bootstrap azure/envs/dev aws/bootstrap aws/foundation gcp/bootstrap gcp/foundation)

tf() { # tf <dir> <args...>
  local dir="$1"; shift
  docker run --rm -u "$(id -u):$(id -g)" -e TF_IN_AUTOMATION=1 -e TF_PLUGIN_CACHE_DIR=/w/.plugin-cache \
    -e HOME=/tmp -v "$HERE":/w -w "/w/$dir" "$TF_IMAGE" "$@"
}

mkdir -p "$HERE/.plugin-cache"
echo "== fmt"
tf . fmt -check -recursive -diff
status=0
for r in "${ROOTS[@]}"; do
  echo "== $r"
  if tf "$r" init -backend=false -input=false -no-color >/dev/null && tf "$r" validate -no-color; then :; else status=1; fi
done
exit $status
