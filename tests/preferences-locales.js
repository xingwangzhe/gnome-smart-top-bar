#!@GJS@ -m
// Real GTK/gettext integration, launched only in a private display and memory settings backend.
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

assert(GLib.getenv('GSETTINGS_BACKEND') === 'memory',
    'Preferences tests require GSETTINGS_BACKEND=memory');
const extensionPath = GLib.getenv('SMART_TOP_BAR_PREFS_EXTENSION');
assert(extensionPath, 'SMART_TOP_BAR_PREFS_EXTENSION is required');
const extensionDir = Gio.File.new_for_path(extensionPath);
const [, metadataBytes] = extensionDir.get_child('metadata.json').load_contents(null);
const metadata = JSON.parse(new TextDecoder().decode(metadataBytes));
const locale = GLib.getenv('LANGUAGE');
assert(locale, 'LANGUAGE must select exactly one locale per process');

for (const name of ['gnome-shell-dbus-interfaces.gresource', 'org.gnome.Shell.Extensions.src.gresource']) {
    const resource = Gio.File.new_for_path(`/usr/share/gnome-shell/${name}`);
    assert(resource.query_exists(null), `Official GNOME resource is missing: ${resource.get_path()}`);
    Gio.resources_register(Gio.Resource.load(resource.get_path()));
}

// Reproduce the official preferences service registry. Its gettext wrapper
// resolves the extension by UUID in the installed module's /gnome-shell/extensions/ path.
const {extensionManager} = await import('resource:///org/gnome/Shell/Extensions/js/extensionsService.js');
const serialized = {};
for (const [key, value] of Object.entries({...metadata, path: extensionPath})) {
    if (typeof value === 'string')
        serialized[key] = new GLib.Variant('s', value);
    else if (typeof value === 'number')
        serialized[key] = new GLib.Variant('d', value);
    else if (Array.isArray(value))
        serialized[key] = new GLib.Variant('as', value);
}
const registered = extensionManager.createExtensionObject(serialized);
const {default: Preferences} = await import(extensionDir.get_child('prefs.js').get_uri());
registered.stateObj = new Preferences({...metadata, dir: extensionDir, path: extensionPath});

Adw.init();
const application = new Adw.Application({application_id: 'io.github.xingwangzhe.SmartTopBarPreferencesTest'});
let failure = null;

const messages = [
    'Smart Top Bar',
    'Shake twice at the top edge to reveal',
    'Hide when maximized or tiled. Never reveal in true fullscreen.',
    'Keep the pointer within 3 pixels of the primary screen’s top edge and move left and right twice.',
    'Stroke distance',
    'Logical pixels; larger values reduce accidental reveals.',
    'Gesture time limit',
    'Milliseconds to complete all four alternating strokes.',
    'Hide delay',
    'Milliseconds after leaving; open menus and keyboard navigation keep the bar visible.',
    'Shortcut: Super + Ctrl + B',
    'Reveal or hide temporarily. Disabled in true fullscreen; press Super to use the overview.',
];

function descendants(widget) {
    const widgets = [widget];
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling())
        widgets.push(...descendants(child));
    return widgets;
}

application.connect('activate', () => {
    const window = new Adw.PreferencesWindow({application, default_width: 760, default_height: 720});
    try {
        registered.stateObj.fillPreferencesWindow(window);
        window.present();
        while (GLib.MainContext.default().pending())
            GLib.MainContext.default().iteration(false);

        const expected = messages.map(message => GLib.dgettext(metadata['gettext-domain'], message));
        assert(window.get_title() === expected[0], `${locale}: window title is not translated`);
        if (!locale.startsWith('en')) {
            assert(expected[4] !== messages[4], `${locale}: gettext fell back to English`);
            assert(expected.filter((value, index) => value !== messages[index]).length >= 10,
                `${locale}: most preferences messages are untranslated`);
        }

        const widgets = descendants(window);
        const text = [];
        for (const widget of widgets) {
            for (const method of ['get_title', 'get_subtitle', 'get_description']) {
                if (typeof widget[method] === 'function') {
                    const value = widget[method]();
                    if (typeof value === 'string')
                        text.push(value);
                }
            }
            if (widget instanceof Gtk.Label)
                text.push(widget.get_text());
        }
        for (const label of expected)
            assert(text.some(value => value.includes(label)), `${locale}: rendered preferences omit ${label}`);

        const rows = widgets.filter(widget => widget instanceof Adw.SpinRow);
        assert(rows.length === 3, `${locale}: expected three actual Adw.SpinRow widgets`);
        const keys = ['gesture-distance', 'gesture-timeout', 'hide-delay'];
        const defaults = [36, 1600, 650];
        const changed = [44, 1800, 800];
        const settings = window._settings;
        assert(settings instanceof Gio.Settings, `${locale}: preferences did not retain their settings`);
        for (let i = 0; i < keys.length; i++) {
            assert(rows[i].value === defaults[i], `${locale}: ${keys[i]} default binding failed`);
            settings.set_int(keys[i], changed[i]);
            assert(rows[i].value === changed[i], `${locale}: ${keys[i]} settings-to-widget binding failed`);
            rows[i].value = changed[i] + 4;
            assert(settings.get_int(keys[i]) === changed[i] + 4,
                `${locale}: ${keys[i]} widget-to-settings binding failed`);
            settings.reset(keys[i]);
        }

        const image = widgets.find(widget => widget instanceof Gtk.Image &&
            widget.get_gicon() instanceof Gio.FileIcon);
        assert(image, `${locale}: custom symbolic icon is not present in the GTK widget tree`);
        const iconFile = image.get_gicon().get_file();
        assert(iconFile.query_exists(null) && iconFile.get_basename() === 'smart-top-bar-symbolic.svg',
            `${locale}: wrong or missing symbolic icon`);
        const [, iconBytes] = iconFile.load_contents(null);
        assert(new TextDecoder().decode(iconBytes).includes('stroke-dasharray'),
            `${locale}: symbolic icon no longer contains a dashed hidden bar`);

        print(JSON.stringify({locale, title: window.get_title(), translatedLabels: expected.length,
            spinRows: rows.length, settingsBinding: 'bidirectional', icon: iconFile.get_basename(), status: 'PASS'}));
    } catch (error) {
        failure = error;
        printerr(`FAIL: ${locale}: ${error.stack ?? error}`);
    } finally {
        window.close();
        application.quit();
    }
});

application.run([]);
if (failure)
    System.exit(1);
