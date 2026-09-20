#!/bin/sh
set -eu
capture_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
capture_build=$(mktemp -d "${TMPDIR:-/tmp}/capture-core.XXXXXX")
trap 'rm -rf "$capture_build"' EXIT
swiftc -module-cache-path "$capture_build/module-cache" \
  "$capture_root"/Sources/CaptureCore/*.swift "$capture_root/scripts/VerifyCore.swift" \
  -o "$capture_build/verify-core"
"$capture_build/verify-core" "$@"
