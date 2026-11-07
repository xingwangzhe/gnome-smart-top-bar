import {describe, expect, test} from 'bun:test';
import {EdgeShakeGesture, classifyWindows} from '../logic.js';

const primary = {index: 0, x: 0, y: 0, width: 1920, height: 1080};
const secondary = {index: 1, x: -1280, y: -200, width: 1280, height: 1024};

function feed(gesture, xs, {start = 0, step = 80, y = 0, monitor = primary, buttons = 0} = {}) {
    return xs.map((x, i) => gesture.sample(x, y, start + i * step, buttons, monitor));
}

describe('top-edge intent gesture', () => {
    test.each([
        [[600, 640, 600, 640, 600]],
        [[600, 560, 600, 560, 600]],
    ])('requires two complete shakes in either direction: %j', xs => {
        expect(feed(new EdgeShakeGesture(), xs)).toEqual([false, false, false, false, true]);
    });

    test('one sweep, long motion, one shake and tiny jitter do not reveal', () => {
        expect(feed(new EdgeShakeGesture(), [300, 600, 900, 1200, 1500]).some(Boolean)).toBe(false);
        expect(feed(new EdgeShakeGesture(), [600, 640, 600]).some(Boolean)).toBe(false);
        expect(feed(new EdgeShakeGesture(), [600, 639, 635, 638, 634, 639, 636]).some(Boolean)).toBe(false);
    });

    test('a reversal must travel the full threshold from the turning point', () => {
        const g = new EdgeShakeGesture();
        expect(feed(g, [600, 636, 700, 665, 666, 664, 700, 664]))
            .toEqual([false, false, false, false, false, false, false, true]);
    });

    test('leaving the 3px band discards partial intent', () => {
        const g = new EdgeShakeGesture();
        feed(g, [600, 640, 600]);
        expect(g.sample(640, 3, 240, 0, primary)).toBe(false);
        expect(feed(g, [600, 640, 600], {start: 320}).some(Boolean)).toBe(false);
    });

    test('held buttons and dragging suppress and reset recognition', () => {
        const g = new EdgeShakeGesture();
        feed(g, [600, 640, 600]);
        expect(g.sample(640, 0, 240, 256, primary)).toBe(false);
        expect(feed(g, [600, 640, 600, 640, 600], {start: 320, buttons: 256}).some(Boolean)).toBe(false);
        expect(feed(g, [600, 640, 600], {start: 800}).some(Boolean)).toBe(false);
    });

    test('cross-monitor movement never joins strokes', () => {
        const g = new EdgeShakeGesture();
        feed(g, [600, 640, 600]);
        expect(feed(g, [-600, -640, -600], {start: 240, y: -200, monitor: secondary}).some(Boolean)).toBe(false);
        expect(feed(new EdgeShakeGesture(), [-600, -640, -600, -640, -600], {y: -200, monitor: secondary}).at(-1)).toBe(true);
    });

    test('old, stalled and backwards sample streams cannot complete a gesture', () => {
        const timeout = new EdgeShakeGesture({maxSampleGap: 600});
        expect(feed(timeout, [600, 640, 600, 640, 600], {step: 500}).some(Boolean)).toBe(false);
        const stale = new EdgeShakeGesture();
        feed(stale, [600, 640, 600]);
        expect(feed(stale, [640, 600], {start: 900}).some(Boolean)).toBe(false);
        const backwards = new EdgeShakeGesture();
        feed(backwards, [600, 640, 600], {start: 1000});
        expect(feed(backwards, [640, 600], {start: 100}).some(Boolean)).toBe(false);
    });

    test('reset, invalid samples, bounds and successful completion discard history', () => {
        const g = new EdgeShakeGesture();
        feed(g, [600, 640, 600]);
        g.reset();
        expect(feed(g, [640, 600], {start: 240}).some(Boolean)).toBe(false);
        expect(g.sample(NaN, 0, 500, 0, primary)).toBe(false);
        expect(g.sample(1920, 0, 550, 0, primary)).toBe(false);
        expect(g.sample(600, -1, 600, 0, primary)).toBe(false);
        expect(g.sample(600, 0, 650, 0, null)).toBe(false);
        expect(feed(g, [600, 640, 600, 640, 600], {start: 700}).at(-1)).toBe(true);
        expect(feed(g, [640, 600, 640, 600], {start: 1200}).some(Boolean)).toBe(false);
    });
});

describe('visible window policy', () => {
    const window = overrides => ({rect: {x: 0, y: 31, width: 1920, height: 1049}, ...overrides});
    test('maximization and full-height tiling hide; smaller windows do not', () => {
        expect(classifyWindows([window({maximizedVertically: true})], primary, 31)).toBe('autohide');
        expect(classifyWindows([window({rect: {x: 960, y: 31, width: 960, height: 1049}})], primary, 31)).toBe('autohide');
        expect(classifyWindows([window({rect: {x: 400, y: 31, width: 600, height: 300}})], primary, 31)).toBe('normal');
    });
    test('true fullscreen wins, except windows on unrelated monitors', () => {
        expect(classifyWindows([window({maximizedVertically: true}), window({fullscreen: true})], primary)).toBe('fullscreen');
        expect(classifyWindows([window({fullscreen: true, rect: {x: 1920, y: 0, width: 1920, height: 1080}})], primary)).toBe('normal');
        expect(classifyWindows([], null)).toBe('normal');
    });
});
