// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 xingwangzhe
/** Passive top-edge gesture recognition; coordinates and distances are logical pixels. */
export class EdgeShakeGesture {
    constructor({
        legDistance = 36,
        requiredLegs = 4,
        maxDuration = 1600,
        maxSampleGap = 350,
        edgeBand = 3,
    } = {}) {
        if (legDistance <= 0 || requiredLegs < 2 || maxDuration <= 0 ||
            maxSampleGap <= 0 || edgeBand <= 0)
            throw new Error('Invalid edge gesture thresholds');
        Object.assign(this, {legDistance, requiredLegs, maxDuration, maxSampleGap, edgeBand});
        this.reset();
    }

    reset() {
        this._anchor = null;
        this._extreme = null;
        this._direction = 0;
        this._legs = 0;
        this._startedAt = null;
        this._lastAt = null;
        this._monitorKey = null;
    }

    /**
     * Feed a pointer observation. `now` is a monotonic timestamp in milliseconds;
     * `buttons` is a boolean or button-only mask, not the complete modifier mask.
     * Returns true once after four alternating full-length strokes. A reset,
     * button press, monitor change, band exit, or interrupted sample stream
     * discards every partial stroke. The next valid sample only arms recognition.
     */
    sample(x, y, now, buttons, monitor) {
        if (!monitor || !Number.isFinite(x) || !Number.isFinite(y) ||
            !Number.isFinite(now) || buttons || x < monitor.x ||
            x >= monitor.x + monitor.width || y < monitor.y ||
            y >= monitor.y + this.edgeBand) {
            this.reset();
            return false;
        }

        const monitorKey = `${monitor.index ?? ''}:${monitor.x}:${monitor.y}:${monitor.width}:${monitor.height}`;
        if (this._anchor === null || this._monitorKey !== monitorKey ||
            now < this._lastAt || now - this._lastAt > this.maxSampleGap ||
            now - this._startedAt > this.maxDuration) {
            this.reset();
            this._anchor = x;
            this._extreme = x;
            this._startedAt = now;
            this._lastAt = now;
            this._monitorKey = monitorKey;
            return false;
        }
        this._lastAt = now;

        if (this._direction === 0) {
            const displacement = x - this._anchor;
            if (Math.abs(displacement) >= this.legDistance) {
                this._direction = Math.sign(displacement);
                this._extreme = x;
                this._legs = 1;
            }
            return false;
        }

        if ((x - this._extreme) * this._direction >= 0) {
            this._extreme = x;
            return false;
        }

        // Reversals are measured from the actual turning point. Small jitter
        // never creates a stroke, and excess forward motion is not banked.
        if (Math.abs(x - this._extreme) >= this.legDistance) {
            this._direction *= -1;
            this._extreme = x;
            this._legs++;
            if (this._legs >= this.requiredLegs) {
                this.reset();
                return true;
            }
        }
        return false;
    }
}

/**
 * Classify already-filtered, visible normal windows on a panel's monitor.
 * Each entry has {fullscreen, maximizedVertically, rect:{x,y,width,height}}.
 * Windows must overlap the monitor horizontally. Top-touching windows are
 * considered only if they span most of its height, avoiding small dialogs.
 */
export function classifyWindows(windows, monitor, panelHeight = 32, tolerance = 3) {
    if (!monitor)
        return 'normal';
    const localWindows = windows.filter(window => {
        const rect = window.rect;
        return rect && rect.width > 0 && rect.height > 0 &&
            rect.x < monitor.x + monitor.width && rect.x + rect.width > monitor.x &&
            rect.y < monitor.y + monitor.height && rect.y + rect.height > monitor.y;
    });
    if (localWindows.some(window => window.fullscreen))
        return 'fullscreen';
    if (localWindows.some(window => window.maximizedVertically ||
        (window.rect.y <= monitor.y + panelHeight + tolerance &&
            window.rect.y >= monitor.y - tolerance &&
            window.rect.height >= monitor.height - panelHeight - 2 * tolerance)))
        return 'autohide';
    return 'normal';
}
