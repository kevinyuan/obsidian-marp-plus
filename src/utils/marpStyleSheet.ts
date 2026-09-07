/**
 * Applies Marp's per-file theme CSS via a constructed stylesheet instead of a
 * `<style>` element. Obsidian's plugin guidelines disallow creating/attaching
 * `<style>` tags at runtime (styles.css is meant to cover static rules), but
 * Marp's theme CSS is generated per-file by `marp.render()` and has to be
 * applied dynamically. `CSSStyleSheet` + `document.adoptedStyleSheets` covers
 * that without touching the DOM.
 *
 * Constructed stylesheets reject `@import` outright — `replaceSync()` throws
 * "@import rules are not allowed here" (see
 * https://github.com/WICG/construct-stylesheets/issues/119). A theme's
 * `style: |` block commonly opens with `@import url(...)` to pull in a
 * webfont, so that throw would abort `update()` right after the caller has
 * already cleared the old DOM, leaving the preview blank. We strip `@import`
 * rules out of the CSS text before handing it to `replaceSync()` and load
 * each imported URL via a `<link rel="stylesheet">` instead, which isn't
 * subject to the same restriction.
 */
const IMPORT_RULE_RE = /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)[^;]*;/g;

export class MarpStyleSheet {
    private readonly _sheet = new CSSStyleSheet();
    private _attached = false;
    private readonly _linkedImports = new Set<string>();

    /** Replaces the sheet's rules with `css` and ensures it's adopted by the document. */
    update(css: string): void {
        const stripped = css.replace(IMPORT_RULE_RE, (_match, _q1, urlUrl, _q3, stringUrl) => {
            const url = urlUrl ?? stringUrl;
            this._ensureLinked(url);
            return '';
        });
        this._sheet.replaceSync(stripped);
        if (!this._attached) {
            document.adoptedStyleSheets = [...document.adoptedStyleSheets, this._sheet];
            this._attached = true;
        }
    }

    /** Loads an `@import`-ed stylesheet (e.g. a webfont) via `<link>`, once per URL. */
    private _ensureLinked(url: string): void {
        if (this._linkedImports.has(url)) { return; }
        this._linkedImports.add(url);
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        link.dataset.marpTikzImport = 'true';
        document.head.appendChild(link);
    }

    /** Detaches the sheet from the document. Call from the owning view's onClose(). */
    detach(): void {
        if (this._attached) {
            document.adoptedStyleSheets = document.adoptedStyleSheets.filter(s => s !== this._sheet);
            this._attached = false;
        }
        document.head.querySelectorAll('link[data-marp-tikz-import]')
            .forEach(el => { if (this._linkedImports.has((el as HTMLLinkElement).href)) { el.remove(); } });
        this._linkedImports.clear();
    }
}
