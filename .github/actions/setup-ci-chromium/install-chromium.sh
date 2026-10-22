#!/usr/bin/env bash
# Installs the pinned Playwright Chromium and its apt dependencies.
#
# Runner images ship third-party apt repositories (packages.microsoft.com and
# others) that Chromium does not need. When one of them is unavailable,
# `apt-get update` aborts the whole install, so retry once with only the
# Ubuntu archive enabled. A second failure is a real failure.
#
# The .deb files apt downloads are kept beside the browser cache. When the
# Ubuntu mirror is slow (25 MB took 10 minutes on 2026-10-22), apt installs
# the same packages from disk and only refreshes its package lists.
set -euo pipefail

sources_dir=${APT_SOURCES_DIR:-/etc/apt/sources.list.d}
disabled_dir=${APT_DISABLED_SOURCES_DIR:-/etc/apt/sources.list.d.ci-disabled}
archives_dir=${APT_ARCHIVES_DIR:-/var/cache/apt/archives}
deb_cache=${CHROMIUM_DEB_CACHE:-$HOME/.cache/hhr-chromium-debs}
sudo_cmd=${CI_SUDO-sudo}

seed_cached_debs() {
  # A cache miss has no folder yet; under pipefail a failing find would abort the install.
  [ -d "$deb_cache" ] || return 0
  local count
  count=$(find "$deb_cache" -maxdepth 1 -name '*.deb' | wc -l | tr -d ' ')
  [ "$count" -gt 0 ] || return 0
  $sudo_cmd mkdir -p "$archives_dir"
  find "$deb_cache" -maxdepth 1 -name '*.deb' -exec $sudo_cmd cp {} "$archives_dir/" \;
  echo "Reusing $count cached Chromium dependency packages."
}

keep_downloaded_debs() {
  mkdir -p "$deb_cache"
  find "$archives_dir" -maxdepth 1 -name '*.deb' -exec cp {} "$deb_cache/" \; 2>/dev/null || true
}

install_chromium() {
  npx playwright install --with-deps chromium
}

seed_cached_debs
if install_chromium; then
  keep_downloaded_debs
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
keep_downloaded_debs
