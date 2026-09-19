# Hyper

The immersive frontend for Hyper, an AP exception-resolution project by Matthew Kim and Stephen Hung for HackMIT 2026. The pink reflective landing leads into the workspace, with a framework version timeline.

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
- `components/timeline/`: rotating version cards, snapshot inspection, and recorded-run comparisons.
- `lib/timeline/`: validated version data, Git discovery, and comparison controls.

The gallery contains no portfolio photographs or video. Texture maps remain necessary for the 3D environment. The parent `web/` application has its own toolchain; run these commands from `web/studio/`.

## Framework timeline

Enter the workspace and select **Timeline**. Drag or scroll the curved version cards, use the arrow keys, or select a version directly. Reduced motion is supported.

`GET /api/timeline` discovers committed changes under `resolve/`, preserving actual commit hashes, package versions, and timestamps. Refresh adds newly committed snapshots. If Git history is unavailable, the app uses its bundled, verified v1 snapshot. Other website commits do not become framework versions.

The current bundled snapshot has no recorded runs. Source definitions and test code do not count as performance results. Compare versions shows framework/configuration changes; outcome and metric deltas require recordings for the same case, scenario, input, policy, harness, and environment. Missing measurements stay unavailable.

Use **Export** to download the timeline JSON. Attach real recording data using the [timeline schema](lib/timeline/README.md), then **Import** it. Imports append immutable snapshots, scenario definitions, and recordings, reject conflicts, and persist in this browser. They do not execute agent code, switch a running backend, retrain models, or alter financial records.

Run data and repository-discovery checks with `bun test lib/timeline/`.
