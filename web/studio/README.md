# Hyper Studio

An immersive WebGL landing page with a reflective 3D environment, animated controls, and a camera transition into an empty gallery.

## Run

```sh
bun install --frozen-lockfile
bun dev
```

Open http://localhost:3888. Production build: `bun run build`.

## Structure

- `app/` and `components/`: page shell, navigation, loader, and contact content.
- `lib/engine/`: scene rendering, asset loading, fluid effects, cursor, and route transitions.
- `public/theme/`: runtime GLB geometry, texture maps, audio, and decoders.
- `assets/blender/`: editable Blender libraries assembled from runtime GLBs.
- `tools/prepare_blender.py`: rebuild the Blender libraries.

The gallery intentionally contains no project cards, portfolio photographs, or video. Texture maps remain necessary for the 3D environment. The parent `web/` application has its own toolchain; run these commands from `web/studio/`.
