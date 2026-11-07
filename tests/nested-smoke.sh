#!/usr/bin/env bash
# Run against a private session bus, settings store, extension tree and compositor.
set -euo pipefail

project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/smart-top-bar-smoke.XXXXXX")
if [[ -n "${SMART_TOP_BAR_EXPECT_SHELL:-}" ]]; then
    actual_shell=$(gnome-shell --version | sed -E 's/.* ([0-9]+)\..*/\1/')
    if [[ "$actual_shell" != "$SMART_TOP_BAR_EXPECT_SHELL" ]]; then
        printf 'FAIL: requested GNOME %s but installed %s\n' "$SMART_TOP_BAR_EXPECT_SHELL" "$actual_shell" >&2
        exit 1
    fi
fi
extension_dir="$test_dir/data/gnome-shell/extensions/smart-top-bar@xingwangzhe"
mkdir -p "$extension_dir" "$test_dir/config" "$test_dir/cache" "$test_dir/runtime"
chmod 700 "$test_dir/runtime"
if [[ -n "${SMART_TOP_BAR_TEST_ZIP:-}" ]]; then
    unzip -q "$SMART_TOP_BAR_TEST_ZIP" -d "$extension_dir"
else
    cp "$project_dir/extension.js" "$project_dir/logic.js" "$project_dir/metadata.json" "$extension_dir/"
    cp -r "$project_dir/schemas" "$extension_dir/"
    for resource in locale icons stylesheet.css; do
        if [[ -e "$project_dir/$resource" ]]; then
            cp -r "$project_dir/$resource" "$extension_dir/"
        fi
    done
fi
glib-compile-schemas --strict "$extension_dir/schemas"
printf 'Isolated GNOME test artifacts: %s\n' "$test_dir"

export SMART_TOP_BAR_TEST_DIR="$test_dir"
export SMART_TOP_BAR_PROJECT_DIR="$project_dir"
gnome-shell --version > "$test_dir/version.txt"
export SMART_TOP_BAR_ARTIFACTS="${SMART_TOP_BAR_ARTIFACTS:-}"
export SMART_TOP_BAR_TEST_SCALE="${SMART_TOP_BAR_TEST_SCALE:-1}"
collect_artifacts() {
    if [[ -n "$SMART_TOP_BAR_ARTIFACTS" ]]; then
        mkdir -p "$SMART_TOP_BAR_ARTIFACTS"
        cp -r "$test_dir"/. "$SMART_TOP_BAR_ARTIFACTS/"
    fi
}
trap collect_artifacts EXIT
dbus-run-session -- bash <<'SESSION'
set -euo pipefail
export XDG_CONFIG_HOME="$SMART_TOP_BAR_TEST_DIR/config"
export XDG_DATA_HOME="$SMART_TOP_BAR_TEST_DIR/data"
export XDG_CACHE_HOME="$SMART_TOP_BAR_TEST_DIR/cache"
export XDG_RUNTIME_DIR="$SMART_TOP_BAR_TEST_DIR/runtime"
export GSETTINGS_BACKEND=keyfile
# Fedora uses /usr/lib64; Debian/Ubuntu use a multiarch directory.
for typelib_dir in /usr/lib64/mutter-* /usr/lib64/gnome-shell /usr/lib/*/mutter-* /usr/lib/gnome-shell; do
    if [[ -d "$typelib_dir" ]]; then
        export GI_TYPELIB_PATH="$typelib_dir${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}"
    fi
done
export LIBGL_ALWAYS_SOFTWARE=1
export GALLIUM_DRIVER=llvmpipe
export GSK_RENDERER=gl
export WAYLAND_DISPLAY=smart-top-bar-smoke
export XDG_SESSION_TYPE=wayland
export XDG_CURRENT_DESKTOP=GNOME
unset DISPLAY SESSION_MANAGER
gsettings set org.gnome.shell enabled-extensions "['smart-top-bar@xingwangzhe']"
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.desktop.interface enable-animations false
gsettings set org.gnome.desktop.interface enable-hot-corners false
gsettings set org.gnome.desktop.input-sources sources "[('xkb', 'us')]"
gsettings set org.gnome.mutter dynamic-workspaces false
gsettings set org.gnome.desktop.wm.preferences num-workspaces 2
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-right "['<Control><Alt>Right']"
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-left "['<Control><Alt>Left']"
gsettings set org.gnome.shell.keybindings toggle-quick-settings "['<Control><Alt>q']"
physical_width=$((1280 * SMART_TOP_BAR_TEST_SCALE))
physical_height=$((720 * SMART_TOP_BAR_TEST_SCALE))
gnome-shell --headless --wayland --no-x11 --virtual-monitor="${physical_width}x${physical_height}" \
    --wayland-display=smart-top-bar-smoke >"$SMART_TOP_BAR_TEST_DIR/shell.log" 2>&1 &
shell_pid=$!
cleanup() {
    kill "$shell_pid" 2>/dev/null || true
    wait "$shell_pid" 2>/dev/null || true
}
trap cleanup EXIT
for attempt in $(seq 1 120); do
    if ! kill -0 "$shell_pid" 2>/dev/null; then
        cat "$SMART_TOP_BAR_TEST_DIR/shell.log"
        exit 1
    fi
    if gdbus call --session --dest org.gnome.Shell \
        --object-path /io/github/xingwangzhe/SmartTopBar \
        --method io.github.xingwangzhe.SmartTopBar.GetState \
        >"$SMART_TOP_BAR_TEST_DIR/initial-state.txt" 2>/dev/null; then
        break
    fi
    sleep 0.25
done
if ! gdbus call --session --dest org.gnome.Shell \
    --object-path /io/github/xingwangzhe/SmartTopBar \
    --method io.github.xingwangzhe.SmartTopBar.GetState >/dev/null 2>&1; then
    cat "$SMART_TOP_BAR_TEST_DIR/shell.log"
    printf 'FAIL: extension never became active\n' >&2
    exit 1
fi
gjs -m "$SMART_TOP_BAR_PROJECT_DIR/tests/configure-monitor.js" \
    >"$SMART_TOP_BAR_TEST_DIR/monitor-config.log"
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.freedesktop.DBus.Properties.Set org.gnome.Shell OverviewActive '<false>' \
    >"$SMART_TOP_BAR_TEST_DIR/hide-overview.txt"
gjs -m "$SMART_TOP_BAR_PROJECT_DIR/tests/smoke-app.js" \
    2>&1 | tee "$SMART_TOP_BAR_TEST_DIR/results.log"
cleanup
trap - EXIT
if rg -n 'JS ERROR|Gjs-CRITICAL|already disposed' "$SMART_TOP_BAR_TEST_DIR/shell.log"; then
    printf 'FAIL: GNOME Shell emitted a JavaScript error or lifecycle warning\n' >&2
    exit 1
fi
SESSION
