#!/usr/bin/env bash
# Launch real preferences for every packaged locale without touching the desktop.
set -euo pipefail
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
work_dir=$(mktemp -d "${TMPDIR:-/tmp}/smart-top-bar-preferences.XXXXXX")
extension_dir="$work_dir/data/gnome-shell/extensions/smart-top-bar@xingwangzhe"
mkdir -p "$extension_dir" "$work_dir/config" "$work_dir/cache" "$work_dir/runtime"
chmod 700 "$work_dir/runtime"
cleanup() {
    local status=$?
    if [[ -n "${xvfb_pid:-}" ]]; then
        kill "$xvfb_pid" 2>/dev/null || true
        wait "$xvfb_pid" 2>/dev/null || true
    fi
    if [[ -n "${SMART_TOP_BAR_PREFS_ARTIFACTS:-}" ]]; then
        mkdir -p "$SMART_TOP_BAR_PREFS_ARTIFACTS"
        for name in results.log xvfb.log; do
            [[ ! -f "$work_dir/$name" ]] || cp "$work_dir/$name" "$SMART_TOP_BAR_PREFS_ARTIFACTS/"
        done
        printf 'exit_status=%s\n' "$status" > "$SMART_TOP_BAR_PREFS_ARTIFACTS/status.txt"
    fi
    return "$status"
}
trap cleanup EXIT

if [[ -n "${SMART_TOP_BAR_TEST_ZIP:-}" ]]; then
    unzip -q "$SMART_TOP_BAR_TEST_ZIP" -d "$extension_dir"
else
    cp "$project_dir/prefs.js" "$project_dir/metadata.json" "$extension_dir/"
    cp -r "$project_dir/schemas" "$project_dir/locale" "$project_dir/icons" "$extension_dir/"
fi
glib-compile-schemas --strict "$extension_dir/schemas"

# LANGUAGE is ignored by GNU gettext under the C locale. Select an installed
# UTF-8 human-language locale; LANGUAGE selects the tested language independently.
base_locale=''
while IFS= read -r candidate; do
    case "${candidate,,}" in
        c|c.*|posix) continue ;;
        *utf8|*utf-8)
            base_locale="$candidate"
            [[ "${candidate,,}" == en_us* ]] && break
            ;;
    esac
done < <(locale -a)
if [[ -z "$base_locale" ]]; then
    if command -v localedef >/dev/null && [[ -f /usr/share/i18n/locales/en_US ]]; then
        mkdir -p "$work_dir/locale-def"
        localedef --no-archive -i en_US -f UTF-8 "$work_dir/locale-def/en_US.UTF-8"
        export LOCPATH="$work_dir/locale-def"
        base_locale=en_US.UTF-8
    else
        echo 'FAIL: gettext runtime test needs a UTF-8 locale (Fedora: glibc-langpack-en; Ubuntu: locales + locale-gen en_US.UTF-8).' >&2
        exit 1
    fi
fi

export XDG_DATA_HOME="$work_dir/data" XDG_CONFIG_HOME="$work_dir/config"
export XDG_CACHE_HOME="$work_dir/cache" XDG_RUNTIME_DIR="$work_dir/runtime"
export GSETTINGS_BACKEND=memory GSK_RENDERER=cairo LIBGL_ALWAYS_SOFTWARE=1 GTK_A11Y=none
export GIO_USE_VFS=local GTK_USE_PORTAL=0
export SMART_TOP_BAR_PREFS_EXTENSION="$extension_dir" LC_ALL="$base_locale"
unset WAYLAND_DISPLAY

# Fedora and Debian use different GNOME Shell library prefixes for Shew.
for shell_libdir in /usr/lib/gnome-shell /usr/lib64/gnome-shell /usr/lib/*/gnome-shell; do
    if [[ -d "$shell_libdir/girepository-1.0" ]]; then
        export GI_TYPELIB_PATH="$shell_libdir/girepository-1.0${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}"
    fi
done

if [[ -n "${SMART_TOP_BAR_PREFS_LOCALES:-}" ]]; then
    read -r -a locales <<< "$SMART_TOP_BAR_PREFS_LOCALES"
else
    locales=(en)
    for catalog in "$extension_dir"/locale/*/LC_MESSAGES/smart-top-bar.mo; do
        [[ -f "$catalog" ]] || continue
        relative=${catalog#"$extension_dir/locale/"}
        language=${relative%%/*}
        [[ "$language" == en ]] || locales+=("$language")
    done
fi
for required in en zh_CN fr de ja; do
    found=false
    for language in "${locales[@]}"; do
        [[ "$language" == "$required" ]] && found=true
    done
    if [[ "$found" != true ]]; then
        echo "FAIL: mandatory locale absent from test matrix: $required" >&2
        exit 1
    fi
done

printf 'Preferences test artifacts: %s\n' "$work_dir"
printf 'Base locale: %s; language processes: %s\n' "$base_locale" "${#locales[@]}"

# Every language has a fresh GJS process so GTK/gettext locale caching cannot
# make a later test reuse an earlier language. The private display and session
# bus are shared to avoid repeatedly launching portal services for each locale.
matrix_command='script=$1; shift; for language in "$@"; do LANGUAGE="$language" gjs -m "$script" || exit; done'
if command -v xvfb-run >/dev/null; then
    xvfb-run -a -s '-screen 0 1280x900x24' dbus-run-session -- \
        bash -c "$matrix_command" _ "$project_dir/tests/preferences-locales.js" "${locales[@]}" \
        2>&1 | tee "$work_dir/results.log"
else
    display_file="$work_dir/display"
    Xvfb -displayfd 3 -screen 0 1280x900x24 -nolisten tcp 3>"$display_file" >"$work_dir/xvfb.log" 2>&1 &
    xvfb_pid=$!
    for attempt in $(seq 1 50); do
        [[ -s "$display_file" ]] && break
        kill -0 "$xvfb_pid" 2>/dev/null || { cat "$work_dir/xvfb.log"; exit 1; }
        sleep 0.1
    done
    export DISPLAY=":$(cat "$display_file")"
    dbus-run-session -- bash -c "$matrix_command" _ "$project_dir/tests/preferences-locales.js" "${locales[@]}" \
        2>&1 | tee "$work_dir/results.log"
fi
echo "PASS: ${#locales[@]} real GTK preferences language processes"
