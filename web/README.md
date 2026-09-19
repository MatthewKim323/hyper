# Aircord Fidelity Study

The Hyper landing experience lives in [`studio/`](studio/README.md). Run `cd studio && bun dev` for its local preview on port 3888. It has its own dependencies and build.

A private, interactive reconstruction of [Aircord](https://aircord.co.jp/en/), preserving its real-time 3D scenes, original content and visual design. See [PROVENANCE.md](PROVENANCE.md) for attribution and reuse details.

## Run

Requires Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/en/` for English or `/` for Japanese. `npm run build` creates the 32 static routes in `dist`. `npm run preview` serves the production build after stopping the development server.

## Structure

- `src/main.js`: dependencies and application bootstrap.
- `src/desktop.js` / `src/mobile.js`: ordered scene initialization.
- `src/runtime/` / `src/mobile/`: navigation, animation, project gallery, reflective surfaces, video and interface modules.
- `src/shaders/`: editable GLSL materials and post-processing.
- `src/site.css` / `src/japanese.css`: responsive typography and layout.
- Route-level `index.html`: English and Japanese content, including 12 project details per language.
- `public/assets/v4/`: fonts, 3D font geometry, textures, icons and homepage reel.

The experience uses Three.js, GSAP and Barba. It is a real WebGL scene, not a screenshot or pre-rendered hero video. Project media still loads from the original CDN and Vimeo endpoints, so those assets require network access and remain subject to their owners' availability. Contact and social links point to the original studio.

## Verification

Full-frame reference comparisons use matched viewport, pointer, autoplay position and video time. Pixel agreement means all RGB channels differ by no more than 12/255; it is evidence for those checkpoints, not a claim that every possible browser state is identical. Functional checks cover navigation, history, languages, theme, menu, reel and scrolling. See `VERIFICATION.md` for the final results.

This is an attributed private study, not a license to republish Aircord's work or branding publicly.
