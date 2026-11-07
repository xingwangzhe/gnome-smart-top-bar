# Runtime compatibility and release gates

The workflow runs the **packaged ZIP**, not a rewritten compatibility manifest,
inside three Fedora containers. Every container checks the installed GNOME Shell
major before starting the test; an unexpected version fails the job.

| Required Shell major | Container | Official Fedora package series |
| --- | --- | --- |
| 49 | `registry.fedoraproject.org/fedora:43` | 49.x |
| 50 | `registry.fedoraproject.org/fedora:44` | 50.x |
| 51 | `registry.fedoraproject.org/fedora:45` | 51.x |

These mappings are published by the [Fedora package index](https://packages.fedoraproject.org/pkgs/gnome-shell/gnome-shell/).
The exact installed package versions are recorded in each run's artifact.

## Isolation and real input

`tests/nested-smoke.sh` creates a private D-Bus session, settings store, extension
directory and headless Wayland compositor. It uses software rendering and does
not need the host's display, user account configuration, hardware input devices,
or `/dev/uinput`. The container runs the compositor as an unprivileged test user.

Each major is tested at 100% and 200% monitor scale. The latter uses a real
2560×1440 virtual monitor configured through Mutter DisplayConfig to a logical
1280×720 workspace. Scale configuration and the resulting logical dimensions
are verified, rather than inferred from an environment variable.

`tests/smoke-app.js` sends actual pointer and keyboard events through Mutter's
[RemoteDesktop test-session interface](https://gitlab.gnome.org/GNOME/mutter/-/blob/main/data/dbus-interfaces/org.gnome.Mutter.RemoteDesktop.xml).
The extension only exposes its existing read-only diagnostic state. There is no
test command, input hook or arbitrary JavaScript evaluator in the shipped ZIP.

The suite verifies:

- Normal, maximized, overview and true-fullscreen transitions and actual GTK
  client surface height, including restoration of the top reserved space.
- A click at application `y=1` reaches the application while the panel is hidden.
  When revealed, its overlay owns top-edge clicks instead. Re-hiding restores
  application input, and a true-fullscreen application's top-menu button still
  receives clicks at `y=1`.
- One shake stays hidden; four alternating pointer strokes reveal the panel.
- Hover over the left, middle and right sections keeps a revealed panel visible
  beyond its minimum hold and hide delay. Leaving the bar hides it again.
- Continuing to shake after reveal keeps the panel visible: eight interpolated
  full-width strokes for more than three seconds, checked every 40 milliseconds,
  at both the first logical pixel and the middle of the panel.
- The keyboard fallback reveals the bar; an open quick-settings menu keeps it
  visible even with the pointer away.
- An empty workspace shows the panel; returning to a maximized workspace hides it.
  If the panel was explicitly revealed and the pointer remains inside it, a
  workspace round-trip instead preserves visibility until the pointer leaves.
- True fullscreen rejects both the pointer gesture and keyboard fallback.
- Gesture reveal, overlay clicks, hover, continuous shaking, hiding and closing
  Shell menus preserve the original Meta focused window and GTK toplevel
  activation. Unmodified keyboard markers must reach the client exactly once at
  each checkpoint, independently verifying real keyboard delivery.
- A client fullscreen request while quick settings is open closes the Shell
  popup and leaves no invisible keyboard/pointer grab over the fullscreen app.
- A real GTK native popover becomes visible and mapped before input-priority
  assertions: edge gestures stay hidden while it is open; keyboard fallback is
  sampled every 5 milliseconds to catch a transient reveal rather than merely
  checking the final state. This does not claim universal browser DOM-menu detection.
- Switching the focused client after two gesture strokes discards the partial
  gesture without relying on a mouse click, pointer-band exit or policy change.
- The extension's own compositing hold remains active during reveal, hover and
  every continuous-shake sample, and is released when fully hidden or truly
  fullscreen. Rapidly cancelled animated transitions and disable during reveal
  also restore a clean hidden state on re-enable. This verifies the extension's
  hold state, not Mutter's private global unredirect counter or hardware scanout.
- Disabling restores the reserved space and removes the D-Bus object. Re-enabling
  while the application remains maximized hides the panel correctly.
- Compositor shutdown emits no GJS errors or disposed-actor warnings.

The separate preferences test renders and verifies every shipped locale under
Xvfb. Pure logic tests cover jitter, interrupted gestures, held mouse buttons,
monitor changes and policy boundaries without requiring a compositor.

## Running locally

```sh
bash tests/nested-smoke.sh
SMART_TOP_BAR_TEST_SCALE=2 bash tests/nested-smoke.sh
SMART_TOP_BAR_EXPECT_SHELL=50 \
SMART_TOP_BAR_TEST_ZIP="$PWD/dist/smart-top-bar@xingwangzhe.shell-extension.zip" \
SMART_TOP_BAR_ARTIFACTS="$PWD/artifacts/local" \
bash tests/nested-smoke.sh
```

## Release policy

Only an exact `vMAJOR.MINOR.PATCH` tag publishes a stable GitHub Release. Unit,
translation, package verification, all three GNOME jobs, both monitor scales,
and preferences localization checks must pass first. The Release attaches the
same ZIP that passed the runtime matrix, the PNG icon, and `SHA256SUMS`.

The tag must also match `package.json` and `metadata.json` semantic versions.
The official GNOME Shexli analyzer must report no unresolved findings in its JSON output;
its process exit code alone does not establish a clean review. Shexli is a
Python-only external tool; repository automation and report validation use Bun.

Shexli 0.2.1 hardcodes a maximum stable major of 50. The checker records one
explicit exception for its April 2026 `EGO-M-004` report when both the source
metadata and reported target versions are exactly 49, 50 and 51. GNOME 51 was
[officially released on 2026-09-16](https://release.gnome.org/51/).
No other finding or future major is exempted. The actual GNOME 51 runtime job
must pass before a Release is published.

Every runtime job uploads its package versions, monitor configuration, extension
state transitions, preferences results and complete Shell log. Missing required
test environments fail the job; no major is allowed to fail or silently skip.

GNOME Extensions is a separate publication destination. Its submission form
requires license-compatibility and maintainer-policy agreements. A successful
upload enters human review; only an approved downloadable version establishes
publication there. The workflow does not store GNOME passwords or browser
sessions, and a GitHub Release does not imply GNOME approval.
