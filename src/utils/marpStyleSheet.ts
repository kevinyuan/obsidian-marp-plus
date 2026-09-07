import { requestUrl } from 'obsidian';

/**
 * Applies Marp's per-file theme CSS via a constructed stylesheet instead of a
 * `<style>` element. Obsidian's plugin guidelines disallow creating/attaching
 * `<style>` or `<link>` tags at runtime (styles.css is meant to cover static
 * rules), but Marp's theme CSS is generated per-file by `marp.render()` and
 * has to be applied dynamically. `CSSStyleSheet` + `document.adoptedStyleSheets`
 * covers that without touching the DOM.
 *
 * Constructed stylesheets reject `@import` outright — `replaceSync()` throws
 * "@import rules are not allowed here" (see
 * https://github.com/WICG/construct-stylesheets/issues/119). A theme's
 * `style: |` block commonly opens with `@import url(...)` to pull in a
 * webfont, so that throw would abort `update()` right after the caller has
 * already cleared the old DOM, leaving the preview blank. We strip `@import`
 * rules out of the CSS text before handing it to `replaceSync()`, fetch each
 * imported URL's CSS via Obsidian's `requestUrl` (no DOM element involved),
 * and inline the fetched rules into the same constructed stylesheet.
 */
const IMPORT_RULE_RE = /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)[^;]*;/g;

export class MarpStyleSheet {
    private readonly _sheet = new CSSStyleSheet();
    private _attached = false;
    private readonly _importCache = new Map<string, string>();
    private readonly _pendingFetches = new Set<string>();
    private _lastCss = '';

    /** Replaces the sheet's rules with `css` and ensures it's adopted by the document. */
    update(css: string): void {
        this._lastCss = css;
        this._apply();
    }

    private _apply(): void {
        const imported: string[] = [];
        const stripped = this._lastCss.replace(IMPORT_RULE_RE, (_match, _q1, urlUrl, _q3, stringUrl) => {
            const url = urlUrl ?? stringUrl;
            const cached = this._importCache.get(url);
            if (cached !== undefined) {
                imported.push(cached);
            } else {
                this._fetchImport(url);
            }
            return '';
        });
        this._sheet.replaceSync(imported.join('\n') + stripped);
        if (!this._attached) {
            document.adoptedStyleSheets = [...document.adoptedStyleSheets, this._sheet];
            this._attached = true;
        }
    }

    /** Fetches an `@import`-ed stylesheet (e.g. a webfont) and re-applies once loaded, once per URL. */
    private _fetchImport(url: string): void {
        if (this._importCache.has(url) || this._pendingFetches.has(url)) { return; }
        this._pendingFetches.add(url);
        requestUrl({ url }).then(res => {
            // Nested @import is dropped rather than resolved recursively — webfont
            // CSS (the only realistic case here) doesn't chain imports.
            this._importCache.set(url, res.text.replace(IMPORT_RULE_RE, ''));
        }).catch(() => {
            this._importCache.set(url, '');
        }).finally(() => {
            this._pendingFetches.delete(url);
            this._apply();
        });
    }

    /** Detaches the sheet from the document. Call from the owning view's onClose(). */
    detach(): void {
        if (this._attached) {
            document.adoptedStyleSheets = document.adoptedStyleSheets.filter(s => s !== this._sheet);
            this._attached = false;
        }
    }
}
