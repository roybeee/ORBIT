#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .build
swiftc -O -framework AppKit -framework ApplicationServices -framework CryptoKit native.swift -o .build/orbit-kakao-native
printf '%s\n' 'Mac 검토 helper 빌드 완료'
