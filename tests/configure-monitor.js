import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const scale = Number(GLib.getenv('SMART_TOP_BAR_TEST_SCALE') ?? '1');
const bus = Gio.DBus.session;
const destination = 'org.gnome.Mutter.DisplayConfig';
const path = '/org/gnome/Mutter/DisplayConfig';
const invoke = (method, params = null) => bus.call_sync(destination, path,
    destination, method, params, null, Gio.DBusCallFlags.NONE, 5000, null).deep_unpack();
const [serial, monitors] = invoke('GetCurrentState');
if (monitors.length !== 1)
    throw new Error(`Expected one isolated virtual monitor, found ${monitors.length}`);
const [spec, modes] = monitors[0];
const current = modes.find(mode => mode[6]['is-current']?.deep_unpack()) ?? modes[0];
if (!current[5].includes(scale))
    throw new Error(`Scale ${scale} unavailable: supported ${JSON.stringify(current[5])}`);
invoke('ApplyMonitorsConfig', new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})',
    [serial, 1, [[0, 0, scale, 0, true, [[spec[0], current[0], {}]]]], {}]));
const after = invoke('GetCurrentState');
if (after[2][0][2] !== scale)
    throw new Error(`Mutter did not apply scale ${scale}`);
print(`monitor-scale: ${scale}; physical mode ${current[1]}x${current[2]}`);
