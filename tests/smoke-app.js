import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';

const UUID = 'smart-top-bar@xingwangzhe';
const PATH = '/io/github/xingwangzhe/SmartTopBar';
const IFACE = 'io.github.xingwangzhe.SmartTopBar';
const connection = Gio.bus_get_sync(Gio.BusType.SESSION, null);
const application = new Gtk.Application({application_id: 'io.github.xingwangzhe.SmartTopBarSmoke'});
let failed = false;
let input;
let baselineFocusId;
let keyboardMarkers = 0;

// Mutter's own virtual input API delivers real compositor pointer/key events.
// This runs only on the private test bus: no production eval hook or ydotool.
class VirtualInput {
    constructor() {
        this.path = connection.call_sync('org.gnome.Mutter.RemoteDesktop',
            '/org/gnome/Mutter/RemoteDesktop', 'org.gnome.Mutter.RemoteDesktop',
            'CreateSession', null, null, Gio.DBusCallFlags.NONE, 5000, null).deep_unpack()[0];
        this.send('Start');
        this.send('NotifyPointerMotionRelative', '(dd)', [-100000, -100000]);
        this.x = 0;
        this.y = 0;
    }

    send(method, type = null, args = []) {
        return connection.call_sync('org.gnome.Mutter.RemoteDesktop', this.path,
            'org.gnome.Mutter.RemoteDesktop.Session', method,
            type ? new GLib.Variant(type, args) : null, null,
            Gio.DBusCallFlags.NONE, 5000, null);
    }

    async moveTo(x, y, pause = 100) {
        this.send('NotifyPointerMotionRelative', '(dd)', [x - this.x, y - this.y]);
        this.x = x;
        this.y = y;
        await sleep(pause);
    }

    async chord(codes, pause = 150) {
        for (const code of codes)
            this.send('NotifyKeyboardKeycode', '(ub)', [code, true]);
        for (const code of [...codes].reverse())
            this.send('NotifyKeyboardKeycode', '(ub)', [code, false]);
        await sleep(pause);
    }

    async shake(legs = 4) {
        await this.moveTo(500, 20);
        await this.moveTo(500, 0);
        for (let i = 0; i < legs; i++)
            await this.moveTo(i % 2 ? 500 : 560, 0);
    }

    async click() {
        this.send('NotifyPointerButton', '(ib)', [272, true]);
        await sleep(60);
        this.send('NotifyPointerButton', '(ib)', [272, false]);
        await sleep(100);
    }

    stop() {
        this.send('Stop');
    }
}

function call(path, iface, method, params = null, reply = null) {
    return connection.call_sync('org.gnome.Shell', path, iface, method,
        params, reply, Gio.DBusCallFlags.NONE, 5000, null).deep_unpack();
}

function state() {
    return JSON.parse(call(PATH, IFACE, 'GetState', null, new GLib.VariantType('(s)'))[0]);
}

function sleep(ms) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

function assert(condition, explanation) {
    if (!condition)
        throw new Error(explanation);
}

async function waitFor(label, predicate, timeout = 7000) {
    const deadline = GLib.get_monotonic_time() / 1000 + timeout;
    let last;
    while (GLib.get_monotonic_time() / 1000 < deadline) {
        try {
            last = state();
            if (predicate(last)) {
                print(`${label}: ${JSON.stringify(last)}`);
                return last;
            }
        } catch (error) {
            last = error.message;
        }
        await sleep(100);
    }
    throw new Error(`${label} timed out: ${JSON.stringify(last)}`);
}

application.connect('activate', () => {
    const window = new Gtk.ApplicationWindow({
        application, title: 'Smart Top Bar isolated verification',
        default_width: 600, default_height: 360, decorated: false,
    });
    const contents = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
    const topRow = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL});
    const clientTopMenu = new Gtk.Button({label: 'Application top menu', height_request: 32, hexpand: true});
    const nativeMenuButton = new Gtk.MenuButton({label: 'Native popup'});
    const nativePopover = new Gtk.Popover({child: new Gtk.Button({label: 'Popup item'})});
    nativeMenuButton.set_popover(nativePopover);
    let clientMenuClicks = 0;
    clientTopMenu.connect('clicked', () => clientMenuClicks++);
    topRow.append(clientTopMenu);
    topRow.append(nativeMenuButton);
    contents.append(topRow);
    contents.append(new Gtk.Label({label: 'Smart Top Bar isolated integration verification', vexpand: true}));
    window.set_child(contents);
    const keyboard = new Gtk.EventControllerKey();
    keyboard.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
    keyboard.connect('key-pressed', (_controller, keyval) => {
        if (keyval === Gdk.KEY_x)
            keyboardMarkers++;
        return false;
    });
    window.add_controller(keyboard);
    let appClicks = 0;
    const clicks = new Gtk.GestureClick();
    clicks.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
    clicks.connect('pressed', () => appClicks++);
    window.add_controller(clicks);
    window.present();

    async function assertClientFocus(label) {
        const current = state();
        const shouldCompose = current.revealed || current.mode === 'normal' || current.mode === 'overview';
        assert(current.compositingHeld === shouldCompose,
            `${label}: compositing guard did not match visible/hidden chrome state`);
        assert(current.focusedWindowId !== undefined,
            'GetState must expose read-only focusedWindowId for exact compositor focus assertions');
        assert(current.focusedWindowId === baselineFocusId,
            `${label}: Meta focus_window changed from the application`);
        // Let the asynchronous Wayland activation configure reach GTK before
        // inspecting its client-side activation property.
        await sleep(100);
        const before = keyboardMarkers;
        await input.chord([45]); // Unmodified X must reach this application's GTK event controller.
        assert(keyboardMarkers === before + 1,
            `${label}: GTK did not receive the keyboard marker exactly once`);
        const active = typeof window.is_active === 'function' ? window.is_active() : window.is_active;
        assert(active, `${label}: application toplevel lost activation`);
        print(`client-focus-preserved-${label}: same Meta window, active GTK toplevel, keyboard marker delivered`);
    }

    (async () => {
        input = new VirtualInput();
        // The first injected key creates Mutter's virtual keyboard. Announce
        // it before focusing the client, allowing Wayland seat capabilities
        // and keyboard-enter events to reach GTK before focus assertions.
        await input.chord([42]);
        await waitFor('normal', s => s.mode === 'normal' && !s.pointerPolling &&
            s.affectsStruts && s.translationY === 0 && s.workArea.y > s.monitor.y);
        // Applying a new display scale may leave Shell keyboard focus on its
        // panel. Focus the actual application before testing window policy.
        await input.moveTo(640, 360);
        await input.click();
        clientTopMenu.grab_focus();
        await sleep(200);

        window.maximize();
        const maximized = await waitFor('maximized', s => s.mode === 'smart-hidden' &&
            s.pointerPolling && !s.affectsStruts && s.translationY <= -s.panelHeight &&
            s.workArea.y === s.monitor.y && window.get_height() === s.monitor.height &&
            s.compositingHeld === false);
        baselineFocusId = maximized.focusedWindowId;
        assert(baselineFocusId !== undefined && baselineFocusId !== null,
            'Could not establish the focused client window before gesture');
        await assertClientFocus('before-reveal');

        // Hidden chrome must not own even the topmost application pixels.
        await input.moveTo(640, 1);
        await input.click();
        assert(appClicks > 0, 'Hidden top bar intercepted a click at app y=1');
        print('hidden-input-region: application received top-edge click');

        await input.shake(2);
        await sleep(200);
        assert(!state().revealed, 'One complete shake unexpectedly revealed panel');
        print('one-shake: remained hidden');

        await input.shake();
        await waitFor('two-shakes', s => s.revealed && s.translationY === 0 && !s.affectsStruts &&
            s.compositingHeld === true);
        await assertClientFocus('after-gesture-reveal');
        const revealedAppClicks = appClicks;
        const revealedMenuClicks = clientMenuClicks;
        // Blank panel space avoids intentionally opening a Shell menu. A
        // revealed overlay must still own this top-edge click, never the app.
        await input.moveTo(300, 1);
        await input.click();
        assert(appClicks === revealedAppClicks && clientMenuClicks === revealedMenuClicks,
            'Revealed panel leaked a top-edge click to the application beneath it');
        print('revealed-input-region: top-edge click did not reach application');
        await assertClientFocus('after-overlay-click');
        // Regression: a revealed bar must stay visible while hovered, including
        // its left, middle and right sections, beyond minimum hold + hide delay.
        for (const x of [80, 640, 1200]) {
            await input.moveTo(x, Math.max(1, Math.floor(maximized.panelHeight / 2)));
            await sleep(1900);
            assert(state().revealed && state().translationY === 0 && state().compositingHeld,
                `Panel hid while pointer hovered its x=${x} section`);
            print(`hover-hold-x-${x}: stayed revealed`);
            await assertClientFocus(`hover-x-${x}`);
        }
        // Regression: continuing the same shake after reveal must never be
        // interpreted as leaving the bar, including its first logical pixel.
        // Interpolate each stroke so actor hover transitions are exercised.
        for (const y of [1, Math.max(1, Math.floor(maximized.panelHeight / 2))]) {
            await input.moveTo(80, y);
            const started = GLib.get_monotonic_time();
            for (let stroke = 0; stroke < 8; stroke++) {
                const from = input.x;
                const to = stroke % 2 ? 80 : 1200;
                for (let sample = 1; sample <= 10; sample++) {
                    await input.moveTo(from + (to - from) * sample / 10, y, 40);
                    const current = state();
                    assert(current.revealed && current.translationY === 0 && current.compositingHeld,
                        `Continued shake hid panel at y=${y}, stroke=${stroke}, x=${input.x}`);
                }
            }
            assert((GLib.get_monotonic_time() - started) / 1000 > 3000,
                'Continuous-shake regression did not run beyond the hide delay');
            print(`continuous-shake-y-${y}: 8 interpolated strokes stayed revealed for >3 seconds`);
            await assertClientFocus(`continuous-shake-y-${y}`);
        }
        await input.moveTo(640, 200);
        await waitFor('leave-rehides', s => !s.revealed && s.translationY <= -s.panelHeight &&
            s.compositingHeld === false);
        await assertClientFocus('after-rehide');
        const hiddenClicks = appClicks;
        await input.moveTo(640, 1);
        await input.click();
        assert(appClicks > hiddenClicks, 'Re-hidden panel continued intercepting application top edge');
        await input.moveTo(640, 200);

        // This is a real GTK Wayland native popup, not a browser DOM menu.
        await input.moveTo(1220, 16);
        await input.click();
        const popupDeadline = GLib.get_monotonic_time() / 1000 + 3000;
        while ((!nativePopover.get_visible() || !nativePopover.get_mapped()) &&
            GLib.get_monotonic_time() / 1000 < popupDeadline)
            await sleep(50);
        assert(nativePopover.get_visible() && nativePopover.get_mapped(),
            'Native popup fixture did not actually become visible and mapped');
        print('native-popup-widget: visible=true, mapped=true after actual pointer click');
        await waitFor('native-client-popup-open', s => s.clientPopupOpen && !s.revealed);
        await input.moveTo(500, 20);
        await input.moveTo(500, 0);
        for (let stroke = 0; stroke < 4; stroke++) {
            await input.moveTo(stroke % 2 ? 500 : 560, 0);
            assert(state().clientPopupOpen && !state().revealed && !state().compositingHeld,
                `Native popup lost input priority during gesture stroke ${stroke}`);
        }
        await input.chord([125, 29, 48], 0);
        const popupShortcutDeadline = GLib.get_monotonic_time() / 1000 + 250;
        while (GLib.get_monotonic_time() / 1000 < popupShortcutDeadline) {
            const current = state();
            assert(current.clientPopupOpen && !current.revealed && !current.compositingHeld,
                'Keyboard fallback briefly revealed chrome above the native client popup');
            await sleep(5);
        }
        assert(state().clientPopupOpen && !state().revealed && !state().compositingHeld,
            'An edge gesture revealed Shell chrome over a native client popup');
        print('native-client-popup-priority: gesture and shortcut stayed hidden, shortcut sampled every 5ms');
        await input.chord([1]);
        await waitFor('native-client-popup-closed', s => !s.clientPopupOpen && !s.revealed);
        await input.moveTo(640, 200);
        await assertClientFocus('after-native-client-popup');

        // Change the focused client without clicking or leaving the edge after
        // two strokes. Only focus-change invalidation can discard this partial
        // gesture: the maximized original window keeps the same hide policy.
        await input.shake(2);
        const secondWindow = new Gtk.ApplicationWindow({application,
            title: 'Smart Top Bar focus-change fixture', decorated: false,
            default_width: 320, default_height: 160,
            child: new Gtk.Label({label: 'Second isolated client window'})});
        secondWindow.present();
        await waitFor('focus-changed-during-partial-gesture', s => s.mode === 'smart-hidden' &&
            s.focusedWindowId !== null && s.focusedWindowId !== baselineFocusId && !s.revealed);
        await input.moveTo(560, 0);
        await input.moveTo(500, 0);
        await sleep(150);
        assert(!state().revealed && !state().compositingHeld,
            'Partial gesture survived a client focus change without clicks or band exit');
        print('focus-change-resets-partial-gesture: last two strokes did not reveal panel');
        secondWindow.close();
        await waitFor('original-client-focus-restored', s => s.focusedWindowId === baselineFocusId &&
            s.mode === 'smart-hidden' && !s.revealed);
        await input.moveTo(640, 200);
        await assertClientFocus('after-client-focus-roundtrip');

        await input.chord([125, 29, 48]); // Super+Ctrl+B
        await waitFor('keyboard-reveal', s => s.revealed && s.translationY === 0);
        await input.chord([29, 56, 16]); // Ctrl+Alt+Q, isolated quick-settings binding
        await waitFor('quick-settings-open', s => s.menuOpen && s.revealed);
        await input.moveTo(640, 300);
        await sleep(1900);
        assert(state().menuOpen && state().revealed, 'Open quick settings did not hold panel');
        print('quick-settings-hold: stayed revealed with pointer away');
        await input.chord([1]); // Escape
        await waitFor('quick-settings-close-rehides', s => !s.menuOpen && !s.revealed);
        await assertClientFocus('after-menu-close');

        await input.chord([29, 56, 106]); // Ctrl+Alt+Right
        await waitFor('empty-workspace', s => s.mode === 'normal' && s.translationY === 0);
        await input.chord([29, 56, 105]); // Ctrl+Alt+Left
        await waitFor('return-maximized-workspace', s => s.mode === 'smart-hidden' && !s.revealed);

        // An explicitly revealed panel remains usable across a workspace
        // transition while the pointer still occupies its interactive area.
        await input.chord([125, 29, 48]);
        await waitFor('before-hovered-workspace-switch', s => s.revealed && s.translationY === 0);
        await input.moveTo(640, Math.max(1, Math.floor(maximized.panelHeight / 2)));
        await input.chord([29, 56, 106]);
        await waitFor('hovered-empty-workspace', s => s.mode === 'normal' && s.translationY === 0);
        await input.chord([29, 56, 105]);
        await waitFor('hovered-return-maximized-workspace', s => s.mode === 'smart-hidden' &&
            s.revealed && s.translationY === 0);
        await sleep(1900);
        assert(state().revealed, 'Workspace switch hid the panel under the pointer');
        await input.moveTo(640, 200);
        await waitFor('hovered-workspace-leave-rehides', s => !s.revealed &&
            s.translationY <= -s.panelHeight);

        call('/org/gnome/Shell', 'org.freedesktop.DBus.Properties', 'Set',
            new GLib.Variant('(ssv)', ['org.gnome.Shell', 'OverviewActive', new GLib.Variant('b', true)]));
        await waitFor('overview-from-maximized', s => s.mode === 'overview' &&
            !s.pointerPolling && s.translationY === 0 && s.panelVisible &&
            s.workArea.y === s.monitor.y);
        call('/org/gnome/Shell', 'org.freedesktop.DBus.Properties', 'Set',
            new GLib.Variant('(ssv)', ['org.gnome.Shell', 'OverviewActive', new GLib.Variant('b', false)]));
        await waitFor('return-from-overview', s => s.mode === 'smart-hidden' &&
            s.pointerPolling && s.translationY <= -s.panelHeight);

        window.fullscreen();
        await waitFor('fullscreen', s => s.mode === 'fullscreen' && !s.pointerPolling &&
            !s.affectsStruts && !s.revealed && !s.panelVisible && s.translationY <= -s.panelHeight &&
            s.compositingHeld === false);
        await assertClientFocus('fullscreen-before-top-menu');
        const fullAppClicks = appClicks;
        const fullMenuClicks = clientMenuClicks;
        await input.moveTo(640, 1);
        await input.click();
        assert(appClicks > fullAppClicks && clientMenuClicks > fullMenuClicks,
            'True-fullscreen client top menu did not receive y=1 click');
        await assertClientFocus('fullscreen-after-top-menu');
        print('fullscreen-client-top-menu: received y=1 click without Shell focus change');
        await input.shake();
        await input.chord([125, 29, 48]);
        assert(state().mode === 'fullscreen' && !state().revealed && !state().pointerPolling &&
            !state().panelVisible && !state().compositingHeld,
            'Gesture or shortcut revealed top bar over true fullscreen');
        print('fullscreen-input-protection: gesture and shortcut both ignored');
        await assertClientFocus('fullscreen-after-gesture-and-shortcut');
        await input.moveTo(640, 300);

        window.unfullscreen();
        await waitFor('exit-fullscreen-to-maximized', s => s.mode === 'smart-hidden' &&
            s.pointerPolling && s.panelVisible && s.workArea.y === s.monitor.y);

        // A client can request fullscreen while a Shell popup owns a modal
        // grab. It must not leave an invisible popup/grab over the client.
        await input.chord([125, 29, 48]);
        await waitFor('pre-fullscreen-popup-reveal', s => s.revealed && s.translationY === 0);
        await input.chord([29, 56, 16]);
        await waitFor('pre-fullscreen-popup-open', s => s.menuOpen && s.revealed);
        window.fullscreen();
        await waitFor('fullscreen-from-shell-popup', s => s.mode === 'fullscreen' &&
            !s.menuOpen && !s.revealed && !s.panelVisible && !s.panelKeyboardFocus);
        await assertClientFocus('fullscreen-from-open-shell-menu');
        const popupFullMenuClicks = clientMenuClicks;
        await input.moveTo(640, 1);
        await input.click();
        assert(clientMenuClicks > popupFullMenuClicks,
            'A hidden Shell popup grab intercepted the fullscreen client top menu');
        await assertClientFocus('fullscreen-after-popup-top-menu');
        await input.moveTo(640, 300);
        window.unfullscreen();
        await waitFor('exit-fullscreen-after-shell-popup', s => s.mode === 'smart-hidden' &&
            s.pointerPolling && !s.revealed && s.panelVisible);

        window.unmaximize();
        window.set_default_size(600, 360);
        await waitFor('unmaximized', s => s.mode === 'normal' && !s.pointerPolling &&
            s.affectsStruts && s.translationY === 0 && s.workArea.y > s.monitor.y);

        // Disable while hidden, then a maximized undecorated GTK surface must
        // shrink by exactly the restored panel strut even though GetState is gone.
        window.maximize();
        await waitFor('before-disable-hidden', s => s.mode === 'smart-hidden' &&
            window.get_height() === s.monitor.height);
        call('/org/gnome/Shell', 'org.gnome.Shell.Extensions', 'DisableExtension',
            new GLib.Variant('(s)', [UUID]), new GLib.VariantType('(b)'));
        const deadline = GLib.get_monotonic_time() / 1000 + 7000;
        while (window.get_height() === maximized.monitor.height &&
            GLib.get_monotonic_time() / 1000 < deadline)
            await sleep(100);
        assert(window.get_height() === maximized.monitor.height - maximized.panelHeight,
            `disable did not restore panel reservation: surface height=${window.get_height()}`);
        let removed = false;
        try {
            state();
        } catch {
            removed = true;
        }
        assert(removed, 'Disable left exported GetState behind');
        print(`disabled: surface height=${window.get_height()}, restored top reservation=${maximized.panelHeight}`);

        window.unmaximize();
        window.set_default_size(600, 360);
        await sleep(300);
        call('/org/gnome/Shell', 'org.gnome.Shell.Extensions', 'EnableExtension',
            new GLib.Variant('(s)', [UUID]), new GLib.VariantType('(b)'));
        await waitFor('reenabled-normal', s => s.mode === 'normal' && !s.pointerPolling &&
            s.affectsStruts && s.translationY === 0 && s.workArea.y > s.monitor.y && s.clipping);
        window.maximize();
        await waitFor('reenabled-maximized', s => s.mode === 'smart-hidden' &&
            s.pointerPolling && !s.affectsStruts && s.translationY <= -s.panelHeight &&
            s.workArea.y === s.monitor.y && window.get_height() === s.monitor.height);
        call('/org/gnome/Shell', 'org.gnome.Shell.Extensions', 'DisableExtension',
            new GLib.Variant('(s)', [UUID]), new GLib.VariantType('(b)'));
        await sleep(200);
        call('/org/gnome/Shell', 'org.gnome.Shell.Extensions', 'EnableExtension',
            new GLib.Variant('(s)', [UUID]), new GLib.VariantType('(b)'));
        await waitFor('reenabled-while-maximized', s => s.mode === 'smart-hidden' && !s.revealed &&
            s.translationY <= -s.panelHeight && s.workArea.y === s.monitor.y && !s.compositingHeld);

        // Exercise cancelled reveal/hide transitions with real Shell animation
        // enabled. The extension must retain its own hold through cancellations
        // and release it once hidden, including disable during a reveal.
        const interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        interfaceSettings.set_boolean('enable-animations', true);
        Gio.Settings.sync();
        await sleep(300);
        await input.chord([125, 29, 48], 35);
        assert(state().revealed && state().compositingHeld,
            'Animated reveal did not hold compositing before showing chrome');
        await input.chord([125, 29, 48], 35);
        await input.chord([125, 29, 48], 35);
        await waitFor('cancelled-animation-reveal', s => s.revealed && s.translationY === 0 && s.compositingHeld);
        await input.moveTo(640, 200);
        await input.chord([125, 29, 48]);
        await waitFor('cancelled-animation-hidden', s => !s.revealed &&
            s.translationY <= -s.panelHeight && !s.compositingHeld);
        await input.chord([125, 29, 48], 35);
        assert(state().revealed && state().compositingHeld,
            'Pre-disable animated reveal did not establish its compositing hold');
        call('/org/gnome/Shell', 'org.gnome.Shell.Extensions', 'DisableExtension',
            new GLib.Variant('(s)', [UUID]), new GLib.VariantType('(b)'));
        await sleep(250);
        call('/org/gnome/Shell', 'org.gnome.Shell.Extensions', 'EnableExtension',
            new GLib.Variant('(s)', [UUID]), new GLib.VariantType('(b)'));
        await waitFor('reenabled-after-animated-disable', s => s.mode === 'smart-hidden' &&
            !s.revealed && s.translationY <= -s.panelHeight && !s.compositingHeld);
        interfaceSettings.set_boolean('enable-animations', false);
        Gio.Settings.sync();
        print('PASS: real compositor gesture/hover/input/menu/fullscreen/workspace/lifecycle integration');
    })().catch(error => {
        failed = true;
        printerr(`FAIL: ${error.message ?? error}\n${error.stack ?? ''}`);
    }).finally(() => {
        try {
            input?.stop();
        } finally {
            application.quit();
        }
    });
});

application.run([]);
if (failed)
    imports.system.exit(1);
