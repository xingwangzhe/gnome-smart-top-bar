import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

const UUID = 'smart-top-bar@xingwangzhe';
const PATH = '/io/github/xingwangzhe/SmartTopBar';
const IFACE = 'io.github.xingwangzhe.SmartTopBar';
const connection = Gio.bus_get_sync(Gio.BusType.SESSION, null);
const application = new Gtk.Application({application_id: 'io.github.xingwangzhe.SmartTopBarSmoke'});
let failed = false;
let input;

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

    async chord(codes) {
        for (const code of codes)
            this.send('NotifyKeyboardKeycode', '(ub)', [code, true]);
        for (const code of [...codes].reverse())
            this.send('NotifyKeyboardKeycode', '(ub)', [code, false]);
        await sleep(150);
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
    window.set_child(new Gtk.Label({label: 'Smart Top Bar isolated integration verification'}));
    let appClicks = 0;
    const clicks = new Gtk.GestureClick();
    clicks.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
    clicks.connect('pressed', () => appClicks++);
    window.add_controller(clicks);
    window.present();

    (async () => {
        input = new VirtualInput();
        await waitFor('normal', s => s.mode === 'normal' && !s.pointerPolling &&
            s.affectsStruts && s.translationY === 0 && s.workArea.y > s.monitor.y);
        // Applying a new display scale may leave Shell keyboard focus on its
        // panel. Focus the actual application before testing window policy.
        await input.moveTo(640, 360);
        await input.click();

        window.maximize();
        const maximized = await waitFor('maximized', s => s.mode === 'smart-hidden' &&
            s.pointerPolling && !s.affectsStruts && s.translationY <= -s.panelHeight &&
            s.workArea.y === s.monitor.y && window.get_height() === s.monitor.height);

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
        await waitFor('two-shakes', s => s.revealed && s.translationY === 0 && !s.affectsStruts);
        // Regression: a revealed bar must stay visible while hovered, including
        // its left, middle and right sections, beyond minimum hold + hide delay.
        for (const x of [80, 640, 1200]) {
            await input.moveTo(x, Math.max(1, Math.floor(maximized.panelHeight / 2)));
            await sleep(1900);
            assert(state().revealed && state().translationY === 0,
                `Panel hid while pointer hovered its x=${x} section`);
            print(`hover-hold-x-${x}: stayed revealed`);
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
                    assert(current.revealed && current.translationY === 0,
                        `Continued shake hid panel at y=${y}, stroke=${stroke}, x=${input.x}`);
                }
            }
            assert((GLib.get_monotonic_time() - started) / 1000 > 3000,
                'Continuous-shake regression did not run beyond the hide delay');
            print(`continuous-shake-y-${y}: 8 interpolated strokes stayed revealed for >3 seconds`);
        }
        await input.moveTo(640, 200);
        await waitFor('leave-rehides', s => !s.revealed && s.translationY <= -s.panelHeight);

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
            !s.affectsStruts && !s.revealed && !s.panelVisible && s.translationY <= -s.panelHeight);
        await input.shake();
        await input.chord([125, 29, 48]);
        assert(state().mode === 'fullscreen' && !state().revealed && !state().pointerPolling &&
            !state().panelVisible, 'Gesture or shortcut revealed top bar over true fullscreen');
        print('fullscreen-input-protection: gesture and shortcut both ignored');
        await input.moveTo(640, 300);

        window.unfullscreen();
        await waitFor('exit-fullscreen-to-maximized', s => s.mode === 'smart-hidden' &&
            s.pointerPolling && s.panelVisible && s.workArea.y === s.monitor.y);

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
            s.translationY <= -s.panelHeight && s.workArea.y === s.monitor.y);
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
