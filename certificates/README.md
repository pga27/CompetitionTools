# Certificate Generator

`certificates.html` is a static page (works on GitHub Pages) for designing a certificate template and generating one PDF per competitor from a competition's WCIF.

## Workflow

1. **Competition data**: upload the WCIF `.json`, or fetch the public WCIF by competition ID. Only accepted, competing registrations are used.
2. **Competitors**: pick who gets a certificate. Click a name to preview their certificate in the editor.
3. **Template**: add text, images, shapes, lines, the competitor's country flag and icons for their events. Drag to move and use the handles to resize (Shift keeps proportions, Alt turns snapping off). Text fields accept placeholders such as `{name}`, `{country}`, `{events}` and `{competition}`; the full list is in the page panel. Each element can be shown to everyone, to newcomers or returning competitors only, or depending on an event.
4. **Generate**: download a ZIP with one PDF per competitor, or a single PDF with one page each.

The template is autosaved in the browser. **Save** downloads it as JSON (images and fonts included) so it can be reused or shared, and **Open…** loads it again.

## Fonts

Helvetica, Times and Courier are built into PDF readers. Text that needs other scripts (e.g. Chinese or Korean names) switches automatically to Noto Sans (`fonts/NotoSansKR-Regular.ttf`). You can also upload your own TrueType (`.ttf`) fonts.

## Code

| File | Purpose |
| --- | --- |
| `js/app.js` | Editor UI, competitor list, generation |
| `js/render.js` | Draws a template onto a jsPDF page; layout shared with the editor |
| `js/data.js` | WCIF parsing and placeholders |
| `js/template.js` | Template model, defaults and import/export |
| `js/assets.js` | Fonts, flags and event icons |

Bundled assets: flags from [flag-icons](https://github.com/lipis/flag-icons) and event icons from [@cubing/icons](https://github.com/cubing/icons), both MIT licensed (see `assets/*/LICENSE`).
