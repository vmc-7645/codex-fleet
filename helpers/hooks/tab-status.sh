#!/usr/bin/env bash
# Compatibility entry point: registration and tty title now share one adapter.
set -euo pipefail
exec python3 "$(dirname "$0")/fleet-event.py"
