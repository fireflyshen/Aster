#!/usr/bin/env bash
set -euo pipefail

# Compatibility wrapper pointing to modern unified deploy.sh
exec "$(dirname "${BASH_SOURCE[0]}")/deploy.sh" "$@"
