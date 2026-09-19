# Hyper engine

Client-side Three.js engine for the landing scene, contact view, and empty gallery environment. `components/EngineRoot.tsx` imports `boot.ts` after mount and calls `bootEngine()` once. The gallery contains arches, floor tiles, god rays, and flocking butterflies; project data can remain empty.

## Lifecycle

`bootEngine()` initializes shared state, registers modules, constructs managers in dependency order, then creates the router. Asset and text loaders gate the first scene build and page-loader exit. `registry.ts` defines construction order; `modules.ts` supplies factories.

`core/store.ts` holds browser metrics, pointer state, event names, and engine instances. The event bus coordinates resize, pointer input, asset progress, and animation frames. `RAFCollection` runs callbacks in ascending index order. The WebGL composer renders at index 99.

## Rendering

- `core/gl.ts` owns the renderer, shared textures and uniforms, pixel camera, CSS3D layer, composer, fluid simulation, and screen effects.
- `scenes/home-contact/` builds terrain, grass, reflective water, particles, and text for the landing and contact views.
- `scenes/project-menu/` builds the gallery environment. An empty project list produces no cards, media requests, or project links.
- `dom2webgl/` binds marked DOM nodes to WebGL content and synchronizes position, size, scroll, and text animation.
- `shaders/` contains GLSL modules used by materials and postprocessing passes. Preserve attribution and reference links within shaders.

## Assets and integration

Asset URLs default to `/theme/`; `window.globalData` may override `assetsUrl` and `publicUrl`. Supply home and project-menu models, images, fonts, audio sprites, Draco decoders, and Basis transcoders under `public/theme/`. `lib/data/projects.json` supplies project data.

The persistent shell provides `#gl`, `[asscroll-container][data-router-wrapper]`, header/menu controls, the page loader, audio button, project filter hooks, and home/contact templates. Each route supplies one `main[data-router-view]`. Load this engine only in client code: ASScroll depends on browser globals at import time.

Dependencies include Three.js, GSAP, ASScroll, Howler, SVG.js, and Troika text. Browser interaction and rendering should be checked with WebGL enabled after asset or route changes.
