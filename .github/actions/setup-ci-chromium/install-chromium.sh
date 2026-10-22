#!/usr/bin/env bash
# Installs the pinned Playwright Chromium and its apt dependencies.
#
# Runner images ship third-party apt repositories (packages.microsoft.com and
# others) that Chromium does not need. When one of them is unavailable,
# `apt-get update` aborts the whole install, so retry once with only the
# Ubuntu archive enabled. A second failure is a real failure.
set -euo pipefail

sources_dir=${APT_SOURCES_DIR:-/etc/apt/sources.list.d}
disabled_dir=${APT_DISABLED_SOURCES_DIR:-/etc/apt/sources.list.d.ci-disabled}
sudo_cmd=${CI_SUDO-sudo}

install_chromium() {
  npx playwright install --with-deps chromium
}

if install_chromium; then
  exit 0
fi

echo "::warning::Chromium install failed; retrying once with only the Ubuntu apt sources."
$sudo_cmd mkdir -p "$disabled_dir"
for source in "$sources_dir"/*; do
  [ -f "$source" ] || continue
  if grep -qE '(archive|security|ports)\.ubuntu\.com|apt-mirrors\.txt' "$source"; then
    continue
  fi
  echo "Disabling third-party apt source: $(basename "$source")"
  $sudo_cmd mv "$source" "$disabled_dir/"
done

install_chromium
