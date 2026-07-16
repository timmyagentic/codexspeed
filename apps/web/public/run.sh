#!/bin/sh
set -eu

version="0.2.0"
repository="https://github.com/timmyagentic/codexspeed"

case "$(uname -s)" in
  Darwin) platform="macos" ;;
  Linux) platform="linux" ;;
  *)
    echo "CodexSpeed supports macOS and Linux through this launcher." >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  arm64|aarch64) architecture="arm64" ;;
  x86_64|amd64) architecture="x64" ;;
  *)
    echo "CodexSpeed does not have a runner for this CPU architecture." >&2
    exit 1
    ;;
esac

asset="codexspeed-v${version}-${platform}-${architecture}.tar.gz"
release="${repository}/releases/download/v${version}"
umask 077
temporary=$(mktemp -d "${TMPDIR:-/tmp}/codexspeed-run.XXXXXX")
cleanup() {
  rm -rf "$temporary"
}
trap cleanup EXIT HUP INT TERM

curl --proto '=https' --tlsv1.2 -fsSL "$release/$asset" -o "$temporary/$asset"
curl --proto '=https' --tlsv1.2 -fsSL "$release/SHA256SUMS" -o "$temporary/SHA256SUMS"
expected=$(awk -v asset="$asset" '$2 == asset { print $1 }' "$temporary/SHA256SUMS")
if [ -z "$expected" ]; then
  echo "CodexSpeed checksum entry is missing." >&2
  exit 1
fi
if command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$temporary/$asset" | awk '{ print $1 }')
elif command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$temporary/$asset" | awk '{ print $1 }')
else
  echo "A SHA-256 checksum tool is required." >&2
  exit 1
fi
if [ "$actual" != "$expected" ]; then
  echo "CodexSpeed download checksum did not match." >&2
  exit 1
fi

tar -xzf "$temporary/$asset" -C "$temporary"
launcher="$temporary/codexspeed/bin/codexspeed"
if [ ! -x "$launcher" ]; then
  echo "CodexSpeed launcher is missing from the archive." >&2
  exit 1
fi

if [ -r /dev/tty ]; then
  "$launcher" "$@" </dev/tty
else
  "$launcher" "$@"
fi
