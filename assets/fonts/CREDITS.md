# Fonts: credits and licences

Both faces are under the SIL Open Font License 1.1 (OFL). The full licence text, with each font's copyright line, is in `OFL-Anton.txt` and `OFL-JetBrainsMono.txt` next to the font files. The OFL allows bundling the fonts in the game and redistributing them; the fonts may not be sold on their own, and the licence files must travel with them.

| File | Family, weight | Copyright | Upstream |
| --- | --- | --- | --- |
| `anton-latin-400-normal.woff2` | Anton 400 | Copyright 2020 The Anton Project Authors | https://github.com/googlefonts/AntonFont |
| `jetbrains-mono-latin-400-normal.woff2` | JetBrains Mono 400 | Copyright 2020 The JetBrains Mono Project Authors | https://github.com/JetBrains/JetBrainsMono |
| `jetbrains-mono-latin-700-normal.woff2` | JetBrains Mono 700 | Copyright 2020 The JetBrains Mono Project Authors | https://github.com/JetBrains/JetBrainsMono |

**Where the files came from.** The npm packages `@fontsource/anton@5.3.0` and `@fontsource/jetbrains-mono@5.3.0` (Fontsource builds of the Google Fonts releases: Anton v27), installed in a scratch folder outside the repo. Only the Latin-subset WOFF2 files were copied, unmodified. They are not dependencies in `package.json`.

**Use.** Link `assets/fonts/fonts.css` (relative URLs, `font-display: swap`), then:

```css
font-family: 'Anton', 'Impact', sans-serif;          /* titles, buttons, uppercase */
font-family: 'JetBrains Mono', ui-monospace, monospace; /* labels, codes, numbers (400 or 700) */
```

The Latin subset covers U+0000-00FF plus common punctuation (the range is in `fonts.css`). Player names with characters outside it fall back to the next font in the stack.
