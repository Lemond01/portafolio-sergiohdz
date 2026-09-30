# Portfolio | LemondG

Personal portfolio for Sergio Hernández — a PS5-dashboard-styled site built with
plain HTML, CSS and JavaScript (no build step, no framework, no dependencies).

## Running locally

This is a static site — any local web server works. The project is set up for
the VS Code **Live Server** extension (`.vscode/settings.json`, port 5501):
right-click [index.html](index.html) → "Open with Live Server".

Without the extension, any static server works the same way, e.g.:

```bash
python -m http.server 5501
```

Then open `http://localhost:5501`.

## Project structure

```
index.html          Page shell only — every view is rendered by script.js
script.js            All app logic + the project data (sectionsContent)
style.css            All styling, incl. responsive breakpoints

assets/
  projects/<id>/      One folder per real (non-"coming soon") project
    hero.webp           Card thumbnail + full-page background art
    teaser.mp4          Click-to-play teaser video (if the project has one)
    turntable.mp4        Autoplaying looping clip (Blender turntables, etc.
                          — used instead of teaser.mp4 for projects with no
                          gameplay video)
    gallery/            The 4 images shown in the project's detail gallery
  shared/
    logo.jpg            Site logo / avatar (header, loading screen, profile)
    coming-soon.webp     Placeholder art for projects not published yet
    favicon-32.png, apple-touch-icon.png, social-preview.jpg
                         Browser tab icon and the image used when the site
                         link is shared (LinkedIn, Discord, etc.)
  audio/
    ambient-music.mp3    Background music (fades in on first interaction)

LICENSE                Code license (MIT) — does NOT cover assets/, see LICENSE
robots.txt / sitemap.xml   Minimal SEO files; sitemap.xml still has a
                            placeholder domain — update it once this is deployed
```

Each project's `id` in `sectionsContent` (inside [script.js](script.js))
matches its folder name under `assets/projects/` — e.g. the project with
`id: 'last-path'` owns `assets/projects/last-path/`. Renaming a project's
folder means also updating its `id`/paths in `sectionsContent`, and vice
versa.

## Adding a new project

1. Create `assets/projects/<new-id>/` with `hero.webp`, a `gallery/` folder
   (4 images), and either `teaser.mp4` or a `media: { type: 'video-loop' }`
   clip.
2. Add an entry to the relevant section in `sectionsContent` in
   [script.js](script.js), pointing at those paths.
3. Set `comingSoon: false`.

## Notes

- Videos and heavy images are already compressed for the web (H.264 teasers/
  turntables, cwebp-optimized images). Keep new assets in a similar size
  range: teaser videos land around 5-30MB (H.264, CRF ~26-29), photos/
  renders around 20-450KB (cwebp, quality ~82-85).
- [LICENSE](LICENSE) covers the code (MIT) only — project screenshots,
  videos, 3D renders and the logo under `assets/` are not open-licensed.
- Before deploying, update the placeholder domain in [sitemap.xml](sitemap.xml)
  and [robots.txt](robots.txt) to the real one.
