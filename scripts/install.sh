#!/usr/bin/env bash
# aoaoe installer -- curl -fsSL https://raw.githubusercontent.com/Talador12/agent-of-agent-of-empires/main/scripts/install.sh | bash
set -euo pipefail

REPO="Talador12/agent-of-agent-of-empires"
BINARY_NAME="aoaoe"

# colors (if tty)
if [ -t 1 ]; then
  BOLD="\033[1m"
  GREEN="\033[32m"
  CYAN="\033[36m"
  RED="\033[31m"
  DIM="\033[2m"
  RESET="\033[0m"
else
  BOLD="" GREEN="" CYAN="" RED="" DIM="" RESET=""
fi

info()  { printf "${CYAN}info${RESET}  %s\n" "$*"; }
ok()    { printf "${GREEN}ok${RESET}    %s\n" "$*"; }
err()   { printf "${RED}error${RESET} %s\n" "$*" >&2; }
die()   { err "$*"; exit 1; }

# detect platform
detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$os" in
    linux*)  OS="linux" ;;
    darwin*) OS="darwin" ;;
    *)       die "unsupported OS: $os" ;;
  esac

  case "$arch" in
    x86_64|amd64)  ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *)             die "unsupported architecture: $arch" ;;
  esac
}

# check prerequisites
check_prereqs() {
  local missing=()
  command -v node  >/dev/null 2>&1 || missing+=("node (v20+)")
  command -v npm   >/dev/null 2>&1 || missing+=("npm")
  command -v aoe   >/dev/null 2>&1 || missing+=("aoe (agent-of-empires)")
  command -v tmux  >/dev/null 2>&1 || missing+=("tmux")

  if [ ${#missing[@]} -gt 0 ]; then
    err "missing required tools:"
    for m in "${missing[@]}"; do
      printf "  - %s\n" "$m" >&2
    done
    printf "\ninstall agent-of-empires: ${DIM}curl -fsSL https://raw.githubusercontent.com/njbrake/agent-of-empires/main/scripts/install.sh | bash${RESET}\n" >&2
    die "install missing tools and retry"
  fi

  # check node version >= 20
  local node_major
  node_major="$(node -e 'console.log(process.versions.node.split(".")[0])')"
  if [ "$node_major" -lt 20 ]; then
    die "node v20+ required (found v${node_major})"
  fi
}

# try npm global install (preferred, always up to date)
install_npm() {
  info "installing via npm..."
  if npm install -g aoaoe 2>/dev/null; then
    ok "installed aoaoe via npm"
    return 0
  fi
  return 1
}

# fall back to cloning + building from source
install_from_source() {
  info "npm install failed, building from source..."

  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  info "cloning $REPO..."
  git clone --depth 1 "https://github.com/$REPO.git" "$tmp/aoaoe" 2>/dev/null

  info "installing dependencies..."
  (cd "$tmp/aoaoe" && npm install --ignore-scripts 2>/dev/null)

  info "building..."
  (cd "$tmp/aoaoe" && npm run build 2>/dev/null)

  # install globally from the built clone
  info "linking globally..."
  (cd "$tmp/aoaoe" && npm install -g . 2>/dev/null) || {
    # if global install fails (permissions), try with --prefix
    local prefix="${HOME}/.local"
    info "global install failed, trying --prefix=$prefix"
    (cd "$tmp/aoaoe" && npm install -g --prefix="$prefix" . 2>/dev/null)
    printf "\n${DIM}make sure %s/bin is in your PATH${RESET}\n" "$prefix"
  }

  ok "installed aoaoe from source"
}

# verify install worked
verify_install() {
  if command -v aoaoe >/dev/null 2>&1; then
    local ver
    ver="$(aoaoe --version 2>/dev/null || echo 'unknown')"
    ok "verified: $ver"
    return 0
  fi

  # check common locations
  for p in "$HOME/.local/bin/aoaoe" "/usr/local/bin/aoaoe"; do
    if [ -x "$p" ]; then
      ok "installed at $p (you may need to add it to PATH)"
      return 0
    fi
  done

  err "aoaoe not found on PATH after install"
  return 1
}

main() {
  printf "\n${BOLD}aoaoe installer${RESET}\n"
  printf "${DIM}autonomous supervisor for agent-of-empires${RESET}\n\n"

  detect_platform
  info "platform: $OS/$ARCH"

  check_prereqs
  ok "prerequisites satisfied"

  # try npm first, fall back to source
  install_npm || install_from_source

  echo
  verify_install

  printf "\n${GREEN}done!${RESET} run ${BOLD}aoaoe --help${RESET} to get started\n"
  printf "${DIM}docs: https://github.com/$REPO${RESET}\n\n"
}

main "$@"
