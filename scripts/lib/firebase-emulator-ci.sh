#!/usr/bin/env bash

ensure_java_available() {
  if command -v java >/dev/null 2>&1 && java -version >/dev/null 2>&1; then
    return 0
  fi

  local candidates=(
    "/opt/homebrew/opt/openjdk@21"
    "/usr/local/opt/openjdk@21"
    "/opt/homebrew/opt/openjdk"
    "/usr/local/opt/openjdk"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate/bin/java" ]]; then
      export JAVA_HOME="$candidate"
      export PATH="$JAVA_HOME/bin:$PATH"
      if java -version >/dev/null 2>&1; then
        return 0
      fi
    fi
  done

  echo "Java runtime not found. Install OpenJDK 21 or set JAVA_HOME." >&2
  return 1
}

resolve_local_firebasetools() {
  local firebase_bin="./node_modules/.bin/firebase"
  if [[ ! -x "$firebase_bin" ]]; then
    echo "firebase-tools is not installed locally. Run npm install first." >&2
    return 1
  fi

  printf '%s\n' "$firebase_bin"
}

is_tcp_port_available() {
  local port="$1"

  if command -v lsof >/dev/null 2>&1; then
    ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi

  if command -v nc >/dev/null 2>&1; then
    ! nc -z 127.0.0.1 "$port" >/dev/null 2>&1
    return $?
  fi

  return 0
}

resolve_firestore_emulator_host() {
  local configured_host="${FIRESTORE_EMULATOR_HOST:-}"
  if [[ -n "$configured_host" ]]; then
    printf '%s\n' "$configured_host"
    return 0
  fi

  local candidate
  for candidate in 18080 18081 18082 18083 18084 8080; do
    if is_tcp_port_available "$candidate"; then
      printf '127.0.0.1:%s\n' "$candidate"
      return 0
    fi
  done

  echo "No available Firestore emulator port found." >&2
  return 1
}

resolve_storage_emulator_host() {
  local configured_host="${FIREBASE_STORAGE_EMULATOR_HOST:-}"
  if [[ -n "$configured_host" ]]; then
    printf '%s\n' "$configured_host"
    return 0
  fi

  local candidate
  for candidate in 19199 19198 19197 9199; do
    if is_tcp_port_available "$candidate"; then
      printf '127.0.0.1:%s\n' "$candidate"
      return 0
    fi
  done

  echo "No available Storage emulator port found." >&2
  return 1
}

write_firestore_emulator_config() {
  local target_path="$1"
  local emulator_host="$2"

  node --input-type=module - "$target_path" "$emulator_host" "${3:-}" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [targetPath, emulatorHost, mode] = process.argv.slice(2);
const [host, portValue] = emulatorHost.split(':');
const port = Number.parseInt(portValue, 10);

if (!host || !Number.isFinite(port)) {
  throw new Error(`Invalid FIRESTORE_EMULATOR_HOST: ${emulatorHost}`);
}

const source = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));
const absolutize = value =>
  typeof value === 'string' && !path.isAbsolute(value) ? path.resolve(value) : value;

if (source.firestore) {
  source.firestore = {
    ...source.firestore,
    rules: absolutize(source.firestore.rules),
    indexes: absolutize(source.firestore.indexes),
  };
}
if (source.storage) {
  source.storage = {
    ...source.storage,
    rules: absolutize(source.storage.rules),
  };
}
source.emulators = {
  ...(source.emulators || {}),
  firestore: {
    ...((source.emulators && source.emulators.firestore) || {}),
    host,
    port,
  },
};
if (mode === 'isolated') {
  const { pickEmulatorPorts } = await import(pathToFileURL(path.resolve('scripts/lib/emulatorPorts.mjs')).href);
  const ports = await pickEmulatorPorts(['firestore', 'hub', 'logging']);
  source.emulators = { ui: { enabled: false } };
  for (const [name, freePort] of Object.entries(ports)) {
    source.emulators[name] = { host: '127.0.0.1', port: freePort };
  }
}
fs.writeFileSync(targetPath, `${JSON.stringify(source, null, 2)}\n`);
NODE
}

write_storage_emulator_config() {
  local target_path="$1"
  local emulator_host="$2"

  node - "$target_path" "$emulator_host" "$FIRESTORE_EMULATOR_HOST" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [targetPath, emulatorHost, firestoreHost] = process.argv.slice(2);
const [host, portValue] = emulatorHost.split(':');
const port = Number.parseInt(portValue, 10);

if (!host || !Number.isFinite(port)) {
  throw new Error(`Invalid FIREBASE_STORAGE_EMULATOR_HOST: ${emulatorHost}`);
}

const source = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));
const absolutize = value =>
  typeof value === 'string' && !path.isAbsolute(value) ? path.resolve(value) : value;

if (source.storage) {
  source.storage = {
    ...source.storage,
    rules: absolutize(source.storage.rules),
  };
}
if (source.firestore) {
  source.firestore.rules = absolutize(source.firestore.rules);
  source.firestore.indexes = absolutize(source.firestore.indexes);
}
const [firestoreHostname, firestorePort] = firestoreHost.split(':');
source.emulators = {
  ...(source.emulators || {}),
  firestore: { host: firestoreHostname, port: Number(firestorePort) },
  storage: {
    ...((source.emulators && source.emulators.storage) || {}),
    host,
    port,
  },
};
fs.writeFileSync(targetPath, `${JSON.stringify(source, null, 2)}\n`);
NODE
}

run_firestore_emulator_exec() (
  local command="$1"
  local firebase_bin
  firebase_bin="$(resolve_local_firebasetools)" || return 1

  export NO_UPDATE_NOTIFIER="${NO_UPDATE_NOTIFIER:-1}"
  export CI="${CI:-1}"
  export FIRESTORE_EMULATOR_HOST
  if [[ "${2:-}" == "isolated" ]]; then
    FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
  else
    FIRESTORE_EMULATOR_HOST="$(resolve_firestore_emulator_host)" || return 1
  fi

  # The EXIT trap runs after function locals expire; this variable stays in the subshell.
  local temp_root="${TMPDIR:-/tmp}"
  temp_root="${temp_root%/}"
  firebase_config="$(mktemp "$temp_root/hhr-firebase-emulator.XXXXXX")"
  trap 'rm -f "$firebase_config"' EXIT
  write_firestore_emulator_config "$firebase_config" "$FIRESTORE_EMULATOR_HOST" "${2:-}"
  if [[ "${2:-}" == "isolated" ]]; then
    FIRESTORE_EMULATOR_HOST="$(node -e 'const c=JSON.parse(require("node:fs").readFileSync(process.argv[1])); console.log(`${c.emulators.firestore.host}:${c.emulators.firestore.port}`)' "$firebase_config")"
  fi

  if [[ "${2:-}" == "isolated" ]]; then
    "$firebase_bin" emulators:exec --config "$firebase_config" --project demo-hhr-emulator-file --only firestore "$command"
  else
    "$firebase_bin" emulators:exec --config "$firebase_config" --only firestore "$command"
  fi
)

run_storage_emulator_exec() {
  local command="$1"
  local firebase_bin
  firebase_bin="$(resolve_local_firebasetools)" || return 1

  export NO_UPDATE_NOTIFIER="${NO_UPDATE_NOTIFIER:-1}"
  export CI="${CI:-1}"
  export FIREBASE_STORAGE_EMULATOR_HOST
  FIREBASE_STORAGE_EMULATOR_HOST="$(resolve_storage_emulator_host)" || return 1

  local firebase_config
  local temp_root="${TMPDIR:-/tmp}"
  temp_root="${temp_root%/}"
  firebase_config="$(mktemp "$temp_root/hhr-firebase-storage-emulator.XXXXXX")"
  export FIRESTORE_EMULATOR_HOST
  FIRESTORE_EMULATOR_HOST="$(resolve_firestore_emulator_host)" || return 1
  write_storage_emulator_config "$firebase_config" "$FIREBASE_STORAGE_EMULATOR_HOST"

  trap 'rm -f "$firebase_config"' RETURN

  "$firebase_bin" emulators:exec --config "$firebase_config" --project demo-hhr-storage-rules-test --only firestore,storage "$command"
}
