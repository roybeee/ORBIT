#!/usr/bin/env bash
set -euo pipefail
: "${ANDROID_HOME:?Set ANDROID_HOME to an Android SDK with build-tools 35.0.0}"
: "${ORBIT_KEYSTORE_FILE:?Path to the backed-up orbit-direct.p12}"
: "${ORBIT_KEYSTORE_PASSWORD_FILE:?Path to the private password file}"
input="${1:?Usage: sign-direct.sh unsigned.apk output.apk}"
output="${2:?Usage: sign-direct.sh unsigned.apk output.apk}"
expected=e433dd8a8eb8ab6632b165522f906a32625c25b3514adc0d60baea3cd20c2252
signer="$ANDROID_HOME/build-tools/35.0.0/apksigner"
aligner="$ANDROID_HOME/build-tools/35.0.0/zipalign"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT
"$aligner" -P 16 -f 4 "$input" "$temp_dir/aligned.apk"
"$signer" sign --ks "$ORBIT_KEYSTORE_FILE" --ks-key-alias orbit-direct --ks-pass "file:$ORBIT_KEYSTORE_PASSWORD_FILE" --out "$temp_dir/signed.apk" "$temp_dir/aligned.apk"
report="$("$signer" verify --verbose --print-certs "$temp_dir/signed.apk")"
actual="$(printf '%s\n' "$report" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')"
if [[ "$actual" != "$expected" ]]; then
    echo "Signing certificate mismatch; refusing to publish an incompatible update." >&2
    exit 1
fi
"$aligner" -c -P 16 4 "$temp_dir/signed.apk"
cp "$temp_dir/signed.apk" "$output"
printf '%s\n' "$report"
