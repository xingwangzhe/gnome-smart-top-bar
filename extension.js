// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 xingwangzhe
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {EdgeShakeGesture, classifyWindows} from './logic.js';

const BUTTONS = Clutter.ModifierType.BUTTON1_MASK |
    Clutter.ModifierType.BUTTON2_MASK | Clutter.ModifierType.BUTTON3_MASK |
    Clutter.ModifierType.BUTTON4_MASK | Clutter.ModifierType.BUTTON5_MASK;
const STATE_XML = `<node><interface name="io.github.xingwangzhe.SmartTopBar">
  <method name="GetState"><arg name="json" type="s" direction="out"/></method>
</interface></node>`;

export default class SmartTopBar extends Extension {
    enable() {
        try {
            this._enable();
        } catch (error) {
            this.disable();
            throw error;
        }
    }

    _enable() {
        this._enabled = true;
        this._sources = new Map();
        this._connections = [];
        this._windows = new Map();
        this._settings = this.getSettings();
        this._panel = Main.panel;
        this._panelDestroyed = false;
        this._box = Main.layoutManager.panelBox;
        this._originalClip = this._box.clip_to_allocation;
        this._originalTranslation = this._panel.translation_y;
        const tracked = Main.layoutManager._trackedActors.find(a => a.actor === this._box);
        this._originalTracking = tracked ? {
            affectsStruts: tracked.affectsStruts,
            trackFullscreen: tracked.trackFullscreen,
        } : {affectsStruts: true, trackFullscreen: true};
        this._strut = this._originalTracking.affectsStruts;
        this._box.clip_to_allocation = true;
        this._mode = null;
        this._target = null;
        this._revealed = false;
        this._dragging = false;
        this._newGesture();

        this._connect(global, 'shutdown', () => this.disable());
        this._connect(this._panel, 'destroy', () => {
            this._panelDestroyed = true;
            this.disable();
        });
        this._connect(global.display, 'window-created', () => this._scheduleSync());
        this._connect(global.display, 'notify::focus-window', () => this._scheduleSync());
        this._connect(global.display, 'in-fullscreen-changed', () => this._sync());
        this._connect(global.display, 'restacked', () => this._scheduleSync());
        this._connect(global.display, 'grab-op-begin', () => {
            this._dragging = true;
            this._gesture.reset();
        });
        this._connect(global.display, 'grab-op-end', () => {
            this._dragging = false;
            this._gesture.reset();
            this._scheduleSync();
        });
        this._connect(global.workspace_manager, 'active-workspace-changed', () => {
            // Changing workspaces must reset a partial gesture, not dismiss a
            // panel that the user is still pointing at.
            this._gesture.reset();
            this._scheduleSync();
        });
        this._connect(Main.layoutManager, 'monitors-changed', () => {
            this._clearReveal();
            this._scheduleSync();
        });
        for (const signal of ['showing', 'hiding', 'hidden'])
            this._connect(Main.overview, signal, () => this._sync());
        this._connect(Main.sessionMode, 'updated', () => this._sync());
        this._connect(this._panel, 'notify::height', () => this._scheduleSync());
        this._connect(this._settings, 'changed', () => {
            this._newGesture();
            this._sync();
        });

        Main.wm.addKeybinding('toggle-bar', this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT, Shell.ActionMode.NORMAL,
            () => this._toggleReveal());
        this._dbus = Gio.DBusExportedObject.wrapJSObject(STATE_XML, {
            GetState: () => JSON.stringify(this._getState()),
        });
        this._dbus.export(Gio.DBus.session, '/io/github/xingwangzhe/SmartTopBar');
        this._sync();
    }

    _newGesture() {
        this._gesture = new EdgeShakeGesture({
            legDistance: this._settings.get_int('gesture-distance'),
            maxDuration: this._settings.get_int('gesture-timeout'),
        });
    }

    _connect(object, signal, callback) {
        this._connections.push([object, object.connect(signal, callback)]);
    }

    _cancel(name) {
        const id = this._sources.get(name);
        if (id)
            GLib.Source.remove(id);
        this._sources.delete(name);
    }

    _later(name, delay, callback) {
        this._cancel(name);
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._sources.delete(name);
            if (this._enabled)
                callback();
            return GLib.SOURCE_REMOVE;
        });
        this._sources.set(name, id);
    }

    _scheduleSync() {
        if (!this._sources.has('sync'))
            this._later('sync', 35, () => this._sync());
    }

    _watchWindows() {
        const all = global.get_window_actors().map(actor => actor.meta_window);
        for (const window of all) {
            if (this._windows.has(window))
                continue;
            const ids = [];
            for (const signal of ['notify::fullscreen', 'notify::maximized-vertically',
                'notify::minimized', 'notify::main-monitor', 'workspace-changed',
                'position-changed', 'size-changed', 'shown'])
                ids.push(window.connect(signal, () => this._scheduleSync()));
            ids.push(window.connect('unmanaged', () => {
                this._unwatchWindow(window);
                this._scheduleSync();
            }));
            this._windows.set(window, ids);
        }
        for (const window of this._windows.keys()) {
            if (!all.includes(window))
                this._unwatchWindow(window);
        }
        return all;
    }

    _unwatchWindow(window) {
        for (const id of this._windows.get(window) ?? [])
            window.disconnect(id);
        this._windows.delete(window);
    }

    _sync() {
        if (!this._enabled)
            return;
        const all = this._watchWindows();
        const monitor = Main.layoutManager.primaryMonitor;
        const overview = Main.overview.visible || Main.overview.visibleTarget;
        const locked = Main.sessionMode.isLocked || Main.sessionMode.isGreeter;
        let next = 'normal';
        if (locked || !monitor)
            next = 'session';
        else if (overview)
            next = 'overview';
        else if (global.display.get_monitor_in_fullscreen(monitor.index))
            next = 'fullscreen';
        else {
            const workspace = global.workspace_manager.get_active_workspace();
            const eligible = all.filter(window => {
                if (window.minimized || !window.showing_on_its_workspace() ||
                    !window.located_on_workspace(workspace) ||
                    window.get_monitor() !== monitor.index || window.is_override_redirect())
                    return false;
                const type = window.get_window_type();
                if (type !== Meta.WindowType.NORMAL && type !== Meta.WindowType.DIALOG &&
                    type !== Meta.WindowType.MODAL_DIALOG)
                    return false;
                return true;
            });
            const policy = classifyWindows(eligible.map(window => ({
                fullscreen: window.is_fullscreen(),
                maximizedVertically: window.maximized_vertically,
                rect: window.get_frame_rect(),
            })), monitor, this._panel.height);
            if (policy === 'fullscreen')
                next = 'fullscreen';
            else if (policy === 'autohide')
                next = 'smart-hidden';
        }

        if (next !== this._mode) {
            const [x, y] = global.get_pointer();
            const keepVisible = next === 'smart-hidden' && this._mode !== null &&
                (this._revealed || this._mode === 'normal' || this._mode === 'overview') &&
                this._pointerOverPanel(x, y);
            this._clearReveal();
            this._mode = next;
            if (keepVisible) {
                this._revealed = true;
                this._revealedAt = GLib.get_monotonic_time() / 1000;
            }
        }
        if (next === 'smart-hidden' || next === 'fullscreen')
            this._setStrut(false);
        else if (next === 'normal' || next === 'session')
            this._setStrut(this._originalTracking.affectsStruts);

        // Keep panelBox at its native monitor position for native fullscreen tracking.
        // Only translate its clipped child, so no invisible input strip remains.
        this._show(next === 'normal' || next === 'overview' || next === 'session' ||
            (next === 'smart-hidden' && this._revealed), next !== 'fullscreen');
        if (next === 'smart-hidden')
            this._startPointer();
        else
            this._cancel('pointer');
    }

    _setStrut(affectsStruts) {
        if (this._strut === affectsStruts)
            return;
        const layout = Main.layoutManager;
        layout.untrackChrome(this._box);
        layout.trackChrome(this._box, {
            ...this._originalTracking, affectsStruts,
        });
        this._strut = affectsStruts;
    }

    _show(show, animate = true) {
        const target = show ? this._originalTranslation : -Math.ceil(this._panel.height) - 2;
        if (this._target === target)
            return;
        this._target = target;
        this._panel.remove_transition('translation-y');
        const animations = St.Settings.get().enable_animations;
        if (animate && animations) {
            this._panel.ease({translation_y: target, duration: 140,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        } else {
            this._panel.translation_y = target;
        }
    }

    _clearReveal() {
        this._revealed = false;
        this._leaveSince = 0;
        this._gesture.reset();
    }

    _toggleReveal() {
        this._sync();
        if (this._mode !== 'smart-hidden')
            return;
        if (this._revealed && !this._heldOpen()) {
            this._clearReveal();
            this._show(false);
        } else {
            this._reveal();
        }
    }

    _reveal() {
        this._revealed = true;
        this._revealedAt = GLib.get_monotonic_time() / 1000;
        this._leaveSince = 0;
        this._gesture.reset();
        this._show(true);
    }

    _heldOpen() {
        const focus = global.stage.get_key_focus();
        return this._panel.menuManager.activeMenu?.isOpen ||
            (focus && this._panel.contains(focus)) || this._dragging;
    }

    _pointerOverPanel(x, y) {
        // Use the allocated, transformed panelBox and the actual picked actor.
        // Extensions can change panel height, padding and child allocation;
        // Main.panel.height alone is not the interactive panel's full bounds.
        const actor = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
        if (actor && (this._panel.contains(actor) || this._box.contains(actor)))
            return true;
        const [left, top] = this._box.get_transformed_position();
        const [width, height] = this._box.get_transformed_size();
        return this._box.visible && x >= left && x < left + width &&
            y >= top && y < top + height + 3;
    }

    _startPointer() {
        if (this._sources.has('pointer'))
            return;
        this._later('pointer', 40, () => {
            this._pollPointer();
            if (this._mode === 'smart-hidden')
                this._startPointer();
        });
    }

    _pollPointer() {
        // Recheck native fullscreen before every sample, even before its signal arrives.
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || global.display.get_monitor_in_fullscreen(monitor.index)) {
            this._sync();
            return;
        }
        const [x, y, modifiers] = global.get_pointer();
        const buttons = modifiers & BUTTONS;
        const now = GLib.get_monotonic_time() / 1000;
        if (!this._revealed) {
            if (this._dragging) {
                this._gesture.reset();
                return;
            }
            const focus = global.stage.get_key_focus();
            if (this._panel.menuManager.activeMenu?.isOpen ||
                (focus && this._panel.contains(focus))) {
                this._reveal();
                return;
            }
            if (this._gesture.sample(x, y, now, buttons, monitor))
                this._reveal();
            return;
        }
        const overPanel = this._pointerOverPanel(x, y);
        if (overPanel || buttons || this._heldOpen()) {
            this._leaveSince = 0;
        } else if (now - this._revealedAt >= 1000) {
            this._leaveSince ||= now;
            if (now - this._leaveSince >= this._settings.get_int('hide-delay')) {
                this._clearReveal();
                this._show(false);
            }
        }
    }

    _getState() {
        const monitor = Main.layoutManager.primaryMonitor;
        const [pointerX, pointerY] = global.get_pointer();
        const workArea = monitor ? Main.layoutManager.getWorkAreaForMonitor(monitor.index) : null;
        return {
            version: this.metadata['version-name'] ?? 'legacy',
            mode: this._mode, revealed: this._revealed, affectsStruts: this._strut,
            translationY: this._panel.translation_y, panelHeight: this._panel.height,
            panelVisible: this._box.visible, clipping: this._box.clip_to_allocation,
            pointerPolling: this._sources.has('pointer'),
            menuOpen: !!this._panel.menuManager.activeMenu?.isOpen,
            pointerOverPanel: this._revealed && this._pointerOverPanel(pointerX, pointerY),
            pointer: {x: pointerX, y: pointerY},
            focusedWindowId: global.display.focus_window?.get_id() ?? null,
            panelKeyboardFocus: !!(global.stage.get_key_focus() &&
                this._panel.contains(global.stage.get_key_focus())),
            monitor: monitor ? {x: monitor.x, y: monitor.y, width: monitor.width,
                height: monitor.height, index: monitor.index} : null,
            workArea: workArea ? {x: workArea.x, y: workArea.y,
                width: workArea.width, height: workArea.height} : null,
        };
    }

    disable() {
        if (!this._enabled)
            return;
        this._enabled = false;
        for (const name of this._sources?.keys() ?? [])
            this._cancel(name);
        Main.wm.removeKeybinding('toggle-bar');
        this._dbus?.unexport();
        this._dbus = null;
        for (const [object, id] of this._connections ?? [])
            object.disconnect(id);
        this._connections = [];
        for (const window of this._windows?.keys() ?? [])
            this._unwatchWindow(window);
        if (this._panel && !this._panelDestroyed) {
            this._panel.remove_transition('translation-y');
            this._panel.translation_y = this._originalTranslation;
            this._box.clip_to_allocation = this._originalClip;
            this._setStrut(this._originalTracking.affectsStruts);
        }
        this._settings = null;
        this._gesture = null;
        this._panel = null;
        this._box = null;
    }
}
