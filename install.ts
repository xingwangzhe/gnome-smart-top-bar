import {cp, mkdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';

const source = import.meta.dir;
const build = Bun.spawnSync(['bun', 'run', 'scripts/i18n.ts'], {cwd: source, stdout: 'inherit', stderr: 'inherit'});
if (build.exitCode !== 0)
    throw new Error('Translation build failed');
const metadata = JSON.parse(await readFile(join(source, 'metadata.json'), 'utf8'));
const dataHome = process.env.XDG_DATA_HOME || join(process.env.HOME!, '.local/share');
const destination = join(dataHome, 'gnome-shell/extensions', metadata.uuid);
await mkdir(destination, {recursive: true});
for (const name of ['extension.js', 'logic.js', 'prefs.js', 'metadata.json', 'schemas', 'locale', 'icons', 'LICENSE'])
    await cp(join(source, name), join(destination, name), {recursive: true});
const result = Bun.spawnSync(['glib-compile-schemas', '--strict', join(destination, 'schemas')]);
if (result.exitCode !== 0)
    throw new Error(result.stderr.toString());
console.log(`Installed: ${destination}`);
const enabled = Bun.spawnSync(['gnome-extensions', 'enable', metadata.uuid]);
if (enabled.exitCode !== 0)
    console.log('GNOME 尚未发现这个新扩展；注销并重新登录后执行：gnome-extensions enable smart-top-bar@xingwangzhe');
else
    console.log('Enabled smart-top-bar@xingwangzhe; updating code already loaded in this session requires a new login.');
