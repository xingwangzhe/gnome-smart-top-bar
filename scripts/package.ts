// SPDX-License-Identifier: GPL-3.0-or-later
import {cp, mkdir, mkdtemp, readdir, rm, utimes} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Resvg} from '@resvg/resvg-js';

const root = resolve(import.meta.dir, '..');
const metadata = await Bun.file(join(root, 'metadata.json')).json();
const pkg = await Bun.file(join(root, 'package.json')).json();
const tagIndex = process.argv.indexOf('--tag');
if (tagIndex !== -1) {
    const tag = process.argv[tagIndex + 1];
    if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag) || tag !== `v${pkg.version}` ||
        metadata['version-name'] !== pkg.version)
        throw new Error('Release tag must be stable vX.Y.Z and match package.json and metadata.json');
}
function run(command: string[], cwd = root) {
    const result = Bun.spawnSync(command, {cwd, stdout: 'inherit', stderr: 'inherit'});
    if (result.exitCode !== 0)
        throw new Error(`Command failed (${result.exitCode}): ${command[0]}`);
}
run(['bun', 'run', 'scripts/i18n.ts']);
run(['glib-compile-schemas', '--strict', '--dry-run', 'schemas']);
const output = join(root, 'dist');
await mkdir(output, {recursive: true});
const icon = new Resvg(await Bun.file(join(root, 'icons/smart-top-bar.svg')).text(), {
    fitTo: {mode: 'width', value: 512},
}).render().asPng();
await Bun.write(join(output, 'smart-top-bar.png'), icon);
const stage = await mkdtemp(join(tmpdir(), 'smart-top-bar-package-'));
async function entries(dir: string, prefix = ''): Promise<string[]> {
    const result: string[] = [];
    for (const entry of await readdir(dir, {withFileTypes: true})) {
        const path = join(prefix, entry.name);
        if (entry.isDirectory())
            result.push(...await entries(join(dir, entry.name), path));
        else if (entry.isFile())
            result.push(path);
        else
            throw new Error(`Refusing non-file package entry: ${path}`);
    }
    return result.sort();
}
try {
    for (const name of ['extension.js', 'logic.js', 'prefs.js', 'LICENSE', 'locale'])
        await cp(join(root, name), join(stage, name), {recursive: true});
    await mkdir(join(stage, 'schemas'));
    await cp(join(root, 'schemas/org.gnome.shell.extensions.smart-top-bar.gschema.xml'),
        join(stage, 'schemas/org.gnome.shell.extensions.smart-top-bar.gschema.xml'));
    await mkdir(join(stage, 'icons'));
    await cp(join(root, 'icons/smart-top-bar-symbolic.svg'), join(stage, 'icons/smart-top-bar-symbolic.svg'));
    // EGO assigns its own integer submission version. The semantic version is
    // shared unchanged between GitHub releases and the submitted package.
    delete metadata.version;
    await Bun.write(join(stage, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
    const files = await entries(stage);
    for (const file of files)
        await utimes(join(stage, file), 1767225600, 1767225600);
    const archive = join(output, `${metadata.uuid}.shell-extension.zip`);
    await rm(archive, {force: true});
    run(['zip', '-q', '-X', archive, ...files], stage);
    const sums = [];
    for (const name of [`${metadata.uuid}.shell-extension.zip`, 'smart-top-bar.png']) {
        const hash = new Bun.CryptoHasher('sha256').update(await Bun.file(join(output, name)).arrayBuffer()).digest('hex');
        sums.push(`${hash}  ${name}`);
    }
    await Bun.write(join(output, 'SHA256SUMS'), sums.join('\n') + '\n');
    console.log(`Packaged ${metadata['version-name']}: ${files.length} files`);
} finally {
    await rm(stage, {recursive: true, force: true});
}
