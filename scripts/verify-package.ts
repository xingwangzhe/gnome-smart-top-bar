// SPDX-License-Identifier: GPL-3.0-or-later
import {resolve} from 'node:path';
const root = resolve(import.meta.dir, '..');
const archive = resolve(root, 'dist/smart-top-bar@xingwangzhe.shell-extension.zip');
const list = Bun.spawnSync(['unzip', '-Z1', archive]);
if (list.exitCode !== 0)
    throw new Error('Unable to inspect extension package');
const entries = list.stdout.toString().trim().split('\n');
const required = ['extension.js', 'logic.js', 'prefs.js', 'metadata.json', 'LICENSE',
    'icons/smart-top-bar-symbolic.svg', 'schemas/org.gnome.shell.extensions.smart-top-bar.gschema.xml'];
for (const entry of required) {
    if (!entries.includes(entry))
        throw new Error(`Missing package file: ${entry}`);
}
for (const entry of entries) {
    if (!required.includes(entry) && !/^locale\/[a-zA-Z_@]+\/LC_MESSAGES\/smart-top-bar\.mo$/.test(entry))
        throw new Error(`Unexpected package file: ${entry}`);
}
const metadata = JSON.parse(Bun.spawnSync(['unzip', '-p', archive, 'metadata.json']).stdout.toString());
if (metadata.version !== undefined || metadata['gettext-domain'] !== 'smart-top-bar' ||
    JSON.stringify(metadata['shell-version']) !== '["49","50","51"]')
    throw new Error('Invalid publishing metadata');
if (entries.filter(e => e.endsWith('.mo')).length < 40)
    throw new Error('Translations are missing from package');
console.log(`Package verified: ${entries.length} files, no compiled schema or development files`);
