# Translation and population coverage

The extension uses the gettext domain `smart-top-bar`. `catalog.ts` contains the authoritative English msgids and complete initial translations for 43 locales. Run `bun run scripts/i18n.ts` to validate the catalog and generate `po/*.po`, `po/smart-top-bar.pot`, and `locale/*/LC_MESSAGES/smart-top-bar.mo`. The release ZIP includes the compiled MO files. Run with `--check` to verify that the checked-in PO/POT files exactly match the catalog, validate every locale using GNU `msgfmt`, and enforce the coverage target. There are no fuzzy entries or empty fallback translations. These are initial machine-assisted translations; native-speaker corrections are welcome.

For GNOME preferences, import `gettext as _` from `resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js`, set `gettext-domain` to `smart-top-bar` in metadata.json, and wrap each English msgid in `_()`. GNOME chooses the catalog from the session locale. English is the source language. Simplified and Traditional Chinese have separate `zh_CN` and `zh_TW` catalogs. Regional locale variants use gettext's normal fallback to the language catalog.

## What the 70% gate means

The measured lower bound is **71.95%** of the population in the bundled Unicode CLDR 49 territory-language dataset. This is an audience estimate conditional on CLDR's reported language knowledge, not a claim that 71.95% of all people have been individually tested, are first-language speakers, are literate, or are GNOME users.

The input is a small, unchanged-value projection of [Unicode's official territoryInfo.json](https://github.com/unicode-org/cldr-json/blob/7d2b9cb11cec08f4d333ad73209deb3df0711c3b/cldr-json/cldr-core/supplemental/territoryInfo.json), pinned to commit `7d2b9cb11cec08f4d333ad73209deb3df0711c3b`. Its CLDR version, upstream URL, commit, and original-file SHA-256 are recorded in `coverage-data.json`. Only territory populations and each language's reported population percentage are retained; economic and literacy fields are not used. The snapshot's population denominator is 8,062,273,015; estimates in this dataset are not a synchronized 2026 census. [Unicode's LDML supplemental-data documentation](https://unicode.org/reports/tr35/tr35-info.html#territory_language_information) explains the data. The Unicode license is in `UNICODE-LICENSE.txt`.

For each territory, the calculation takes **only the largest population percentage of one supported language**. It does not add the percentages of different languages in that territory, because people can know more than one language. Territories are disjoint, so their resulting covered populations can be added. For example, India's Hindi and English percentages are never added together. This deliberately undercounts many people who know other supported languages. English's native and second-language speakers are not counted a second time on top of another language within a territory.

Formula: `sum(territory population × max(supported language population percentages)) / sum(territory population)`.

Matching uses explicit CLDR language IDs rather than blindly discarding script subtags: Chinese matches `zh`, `zh_Hans`, and `zh_Hant`; a Gurmukhi Punjabi catalog does not claim coverage of `pa_Arab`. Duplicate locale variants cannot inflate the result. The computed fraction must remain at least 0.70 in CI. Updating the data requires rechecking both the Unicode license/provenance and this calculation.

## Locale list

English, Simplified Chinese, Traditional Chinese, French, German, Japanese, Spanish, Portuguese, Russian, Arabic, Hindi, Bengali, Urdu, Punjabi (Gurmukhi), Marathi, Telugu, Tamil, Vietnamese, Korean, Turkish, Italian, Persian, Swahili, Gujarati, Kannada, Malayalam, Odia, Indonesian, Malay, Thai, Burmese, Nepali, Sinhala, Polish, Ukrainian, Romanian, Dutch, Czech, Greek, Hungarian, Uzbek, Hausa, and Somali.
