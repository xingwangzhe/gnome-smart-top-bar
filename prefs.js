// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 xingwangzhe
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SmartTopBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        window.set_title(_('Smart Top Bar'));
        const page = new Adw.PreferencesPage({title: _('Smart Top Bar'), icon_name: 'view-reveal-symbolic'});
        const group = new Adw.PreferencesGroup({
            title: _('Shake twice at the top edge to reveal'),
            description: _('Hide when maximized or tiled. Never reveal in true fullscreen.') + '\n' +
                _('Keep the pointer within 3 pixels of the primary screen’s top edge and move left and right twice.'),
        });
        group.set_header_suffix(new Gtk.Image({pixel_size: 40,
            gicon: Gio.FileIcon.new(this.dir.get_child('icons').get_child('smart-top-bar-symbolic.svg'))}));
        for (const [key, title, subtitle, min, max, step] of [
            ['gesture-distance', _('Stroke distance'), _('Logical pixels; larger values reduce accidental reveals.'), 20, 120, 4],
            ['gesture-timeout', _('Gesture time limit'), _('Milliseconds to complete all four alternating strokes.'), 800, 4000, 100],
            ['hide-delay', _('Hide delay'), _('Milliseconds after leaving; open menus and keyboard navigation keep the bar visible.'), 200, 2500, 50],
        ]) {
            const row = new Adw.SpinRow({title, subtitle,
                adjustment: new Gtk.Adjustment({lower: min, upper: max, step_increment: step})});
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
        }
        const hint = new Adw.ActionRow({title: _('Shortcut: Super + Ctrl + B'),
            subtitle: _('Reveal or hide temporarily. Disabled in true fullscreen; press Super to use the overview.')});
        group.add(hint);
        page.add(group);
        window.add(page);
    }
}
