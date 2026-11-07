import {describe, expect, test} from 'bun:test';
import {join} from 'node:path';
import {domain, messages, translations, languageIds} from '../i18n/catalog.ts';
import {buildTranslations, mandatoryLocales, populationCoverage,
    projectRoot, validateCatalog} from '../scripts/i18n.ts';

describe('complete gettext translations', () => {
    test('mandatory languages and every message have real translations', () => {
        expect(() => validateCatalog()).not.toThrow();
        expect(Object.keys(translations).length).toBeGreaterThanOrEqual(40);
        for (const locale of mandatoryLocales)
            expect(translations[locale]).toHaveLength(messages.length);
        for (const [locale, strings] of Object.entries(translations)) {
            expect(strings).toHaveLength(messages.length);
            for (let i = 0; i < messages.length; i++) {
                expect(strings[i].trim().length).toBeGreaterThan(0);
                if (locale !== 'en')
                    expect(strings[i]).not.toBe(messages[i]);
            }
        }
    });

    test('deterministic PO/POT files pass GNU msgfmt checks in every locale', async () => {
        const result = await buildTranslations({check: true});
        expect(result.locales).toBe(Object.keys(translations).length);
        expect(result.coveragePercent).toBeGreaterThan(70);
    });

    test('compiled catalogs resolve the translated title through GNU gettext', async () => {
        await buildTranslations();
        for (const locale of ['zh_CN', 'zh_TW', 'fr', 'de', 'ja', 'ar', 'hi']) {
            const file = join(projectRoot, 'locale', locale, 'LC_MESSAGES', `${domain}.mo`);
            const readback = Bun.spawnSync(['msgunfmt', '--no-wrap', file]);
            expect(readback.exitCode).toBe(0);
            expect(readback.stdout.toString()).toContain(`msgstr ${JSON.stringify(translations[locale][0])}`);
        }
    });
});

describe('population coverage without double-counting multilingual speakers', () => {
    test('at least 70% using only one language share per territory', () => {
        const coverage = populationCoverage();
        expect(coverage.cldrVersion).toBe('49');
        expect(coverage.population).toBeGreaterThan(8_000_000_000);
        expect(coverage.fraction).toBeGreaterThan(0.7);
        expect(coverage.fraction).toBeLessThan(1);
        for (const territory of coverage.territories) {
            expect(territory.percent).toBeGreaterThanOrEqual(0);
            expect(territory.percent).toBeLessThanOrEqual(100);
            expect(territory.covered).toBeLessThanOrEqual(territory.population);
        }
    });

    test('unrelated or duplicate locales cannot inflate coverage', () => {
        expect(populationCoverage([]).covered).toBe(0);
        expect(populationCoverage(['not-a-language']).covered).toBe(0);
        expect(populationCoverage([...languageIds, ...languageIds]).covered)
            .toBe(populationCoverage(languageIds).covered);
    });
});
