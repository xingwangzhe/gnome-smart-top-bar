import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {domain, messages, translations, languageIds} from '../i18n/catalog.ts';
import coverageData from '../i18n/coverage-data.json';

export const projectRoot = resolve(import.meta.dir, '..');
export const mandatoryLocales = ['zh_CN', 'zh_TW', 'en', 'fr', 'de', 'ja'];

/**
 * A union lower bound, conditional on CLDR's reported language-knowledge estimates.
 * Within each disjoint territory we count only its largest supported language.
 * We do not sum overlapping first-/second-language speaker populations.
 */
export function populationCoverage(supportedLanguages = languageIds) {
    const supported = new Set(supportedLanguages);
    let population = 0;
    let covered = 0;
    const territories = [];
    for (const [code, territory] of Object.entries(coverageData.territories)) {
        let bestPercent = 0;
        let language = null;
        for (const [id, percent] of Object.entries(territory.languages)) {
            if (supported.has(id) && percent > bestPercent) {
                bestPercent = percent;
                language = id;
            }
        }
        population += territory.population;
        const speakers = territory.population * bestPercent / 100;
        covered += speakers;
        territories.push({code, population: territory.population, language, percent: bestPercent, covered: speakers});
    }
    return {source: coverageData.source, cldrVersion: coverageData.cldrVersion,
        population, covered, fraction: covered / population, territories};
}

export function validateCatalog() {
    if (new Set(messages).size !== messages.length)
        throw new Error('Duplicate gettext msgids');
    for (const locale of mandatoryLocales) {
        if (!translations[locale])
            throw new Error(`Missing mandatory locale: ${locale}`);
    }
    for (const [locale, strings] of Object.entries(translations)) {
        if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(locale))
            throw new Error(`Invalid locale identifier: ${locale}`);
        if (strings.length !== messages.length)
            throw new Error(`${locale}: expected ${messages.length} translations, got ${strings.length}`);
        strings.forEach((text, index) => {
            if (!text.trim() || text.includes('\u0000') || text.includes('\ufffd'))
                throw new Error(`${locale}: invalid translation for ${messages[index]}`);
            if (locale !== 'en' && text === messages[index])
                throw new Error(`${locale}: untranslated English placeholder for ${messages[index]}`);
        });
    }
    const coverage = populationCoverage();
    if (coverage.fraction < 0.7)
        throw new Error(`Population coverage below 70%: ${(coverage.fraction * 100).toFixed(2)}%`);
}

const quote = (text: string) => JSON.stringify(text);
function header(locale: string, template = false) {
    const fields = [
        'Project-Id-Version: Smart Top Bar\n',
        'Report-Msgid-Bugs-To: https://github.com/xingwangzhe/gnome-smart-top-bar/issues\n',
        'POT-Creation-Date: 2026-11-07 00:00+0000\n',
        'PO-Revision-Date: 2026-11-07 00:00+0000\n',
        'Last-Translator: Smart Top Bar contributors\n',
        `Language-Team: ${locale || 'LANGUAGE'}\n`,
        `Language: ${locale}\n`,
        'MIME-Version: 1.0\n',
        'Content-Type: text/plain; charset=UTF-8\n',
        'Content-Transfer-Encoding: 8bit\n',
    ];
    return `# Smart Top Bar ${template ? 'translation template' : locale + ' translation'}.\n` +
        '# Copyright (C) 2026 xingwangzhe and contributors\n' +
        '# Distributed under the same license as Smart Top Bar.\n' +
        'msgid ""\nmsgstr ""\n' + fields.map(quote).join('\n') + '\n\n';
}

export function poContents(locale: string, strings: readonly string[], template = false) {
    return header(locale, template) + messages.map((message, index) =>
        `#: prefs.js\nmsgid ${quote(message)}\nmsgstr ${quote(strings[index] ?? '')}\n`).join('\n');
}

export async function buildTranslations({check = false} = {}) {
    validateCatalog();
    const scratch = await mkdtemp(join(tmpdir(), 'smart-top-bar-i18n-'));
    try {
        await mkdir(join(projectRoot, 'po'), {recursive: true});
        const pot = poContents('', [], true);
        const potPath = join(projectRoot, 'po', `${domain}.pot`);
        if (check) {
            if (await readFile(potPath, 'utf8') !== pot)
                throw new Error('Translation template is stale; run bun run scripts/i18n.ts');
        } else {
            await Bun.write(potPath, pot);
        }
        for (const [locale, strings] of Object.entries(translations)) {
            const po = poContents(locale, strings);
            const poPath = join(projectRoot, 'po', `${locale}.po`);
            if (check) {
                if (await readFile(poPath, 'utf8') !== po)
                    throw new Error(`${locale}.po is stale; run bun run scripts/i18n.ts`);
            } else {
                await Bun.write(poPath, po);
            }
            const compiledPath = join(scratch, `${locale}.mo`);
            const compile = Bun.spawnSync(['msgfmt', '--check', '--check-format', '-o', compiledPath, poPath]);
            if (compile.exitCode !== 0)
                throw new Error(`${locale}: msgfmt failed\n${compile.stderr}`);
            const target = join(projectRoot, 'locale', locale, 'LC_MESSAGES', `${domain}.mo`);
            if (!check) {
                await mkdir(join(projectRoot, 'locale', locale, 'LC_MESSAGES'), {recursive: true});
                await Bun.write(target, Bun.file(compiledPath));
            }
        }
    } finally {
        // Only this invocation's freshly-created scratch directory is removed.
        await rm(scratch, {recursive: true});
    }
    const coverage = populationCoverage();
    return {locales: Object.keys(translations).length, messages: messages.length,
        coveragePercent: coverage.fraction * 100, cldrVersion: coverage.cldrVersion};
}

if (import.meta.main) {
    const result = await buildTranslations({check: process.argv.includes('--check')});
    console.log(`${result.locales} locales × ${result.messages} messages; ` +
        `CLDR ${result.cldrVersion} territory-max coverage: ${result.coveragePercent.toFixed(2)}%`);
}
