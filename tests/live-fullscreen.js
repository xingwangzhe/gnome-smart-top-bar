// Manual current-session check: shows a fullscreen test window for ~2 seconds.
// Requires GJS because Gtk/Gio use GObject Introspection, unavailable in Bun.
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));
const state = () => JSON.parse(Gio.DBus.session.call_sync('org.gnome.Shell',
    '/io/github/xingwangzhe/SmartTopBar', 'io.github.xingwangzhe.SmartTopBar',
    'GetState', null, null, Gio.DBusCallFlags.NONE, 2000, null).deep_unpack()[0]);
const app = new Gtk.Application({application_id: 'io.github.xingwangzhe.SmartTopBarCheck'});
let error = null;
app.connect('activate', () => {
    const window = new Gtk.ApplicationWindow({application: app,
        title: 'Smart Top Bar 全屏验证（自动关闭）',
        child: new Gtk.Label({label: '正在验证真全屏保护，窗口即将自动关闭。'})});
    window.fullscreen();
    window.present();
    (async () => {
        try {
            await wait(750);
            const before = state();
            print(`fullscreen-before-gesture: ${JSON.stringify(before)}`);
            if (before.mode !== 'fullscreen' || before.pointerPolling || before.panelVisible)
                throw new Error('Native fullscreen protection failed');
            GLib.spawn_command_line_sync('ydotool mousemove -x 0 -y -2000');
            await wait(100);
            for (const dx of [70, -70, 70, -70]) {
                GLib.spawn_command_line_sync(`ydotool mousemove -x ${dx} -y 0`);
                await wait(100);
            }
            GLib.spawn_command_line_sync('ydotool key 125:1 29:1 48:1 48:0 29:0 125:0');
            await wait(200);
            const after = state();
            print(`fullscreen-after-gesture-and-shortcut: ${JSON.stringify(after)}`);
            if (after.mode !== 'fullscreen' || after.revealed || after.pointerPolling || after.panelVisible)
                throw new Error('Fullscreen gesture or shortcut revealed panel');
            print('PASS: real-session fullscreen ignores gesture and shortcut');
        } catch (e) {
            error = e;
            printerr(e);
        } finally {
            GLib.spawn_command_line_sync('ydotool mousemove -x 0 -y 300');
            window.close();
            app.quit();
        }
    })();
});
app.run([]);
if (error)
    throw error;
