# Third-party notices

Notedown bundles the following browser libraries. They are served locally and
do not make network requests.

## marked 12.0.2

- Project: https://github.com/markedjs/marked
- License: MIT
- File: `app/src/main/assets/www/js/vendor/marked.umd.js`
- License text: `app/src/main/assets/www/js/vendor/LICENSE.marked.md`

## DOMPurify 3.4.17

- Project: https://github.com/cure53/DOMPurify
- License: Apache License 2.0 OR Mozilla Public License 2.0
- File: `app/src/main/assets/www/js/vendor/purify.min.js`
- License text: `app/src/main/assets/www/js/vendor/LICENSE.dompurify.txt`

## Turndown 7.2.0

- Project: https://github.com/mixmark-io/turndown
- License: MIT
- File: `app/src/main/assets/www/js/vendor/turndown.js`
- License text: `app/src/main/assets/www/js/vendor/LICENSE.turndown.txt`

## turndown-plugin-gfm 1.0.2

- Project: https://github.com/mixmark-io/turndown-plugin-gfm
- License: MIT
- File: `app/src/main/assets/www/js/vendor/turndown-plugin-gfm.js`
- License text: `app/src/main/assets/www/js/vendor/LICENSE.turndown-plugin-gfm.txt`

## ProseMirror and supporting modules

- Project: https://prosemirror.net/ (MIT)
- Bundle: `app/src/main/assets/www/js/rich-editor.js`
- Editable source: `src/rich-editor.js`
- Exact dependency versions: `package-lock.json`
- Full licenses, including bundled supporting modules: `app/src/main/assets/www/js/vendor/LICENSE.prosemirror.txt`
- Rebuild with `npm ci && npm run build:editor`. The bundle and licenses are
  checked in so Android builds and installed applications work without npm or a CDN.

All other code, artwork and copy in this repository are original work and are
released under the MIT license in `LICENSE`.
