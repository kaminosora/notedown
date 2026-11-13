import {build} from 'esbuild';
import {readFile, writeFile} from 'node:fs/promises';

const result = await build({
    entryPoints: ['src/rich-editor.js'],
    outfile: 'app/src/main/assets/www/js/rich-editor.js',
    bundle: true,
    format: 'iife',
    target: 'chrome80',
    minify: true,
    legalComments: 'eof',
    metafile: true
});

// Ship the licenses of the modules actually included in the offline bundle.
const packages = [...new Set(Object.keys(result.metafile.inputs)
    .filter(name => name.startsWith('node_modules/'))
    .map(name => name.split('/')[1]))].sort();
const notices = await Promise.all(packages.map(async name => {
    const pkg = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
    let license;
    for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
        try { license = await readFile(`node_modules/${name}/${file}`, 'utf8'); break; } catch (_) { /* Try next spelling. */ }
    }
    if (!license) throw new Error(`Missing license for ${name}`);
    return `${name} ${pkg.version}\n${'='.repeat(72)}\n${license.trim()}\n`;
}));
await writeFile('app/src/main/assets/www/js/vendor/LICENSE.prosemirror.txt', notices.join('\n'), 'utf8');
