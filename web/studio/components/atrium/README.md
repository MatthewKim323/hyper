# Atrium interface

The post-onboarding workspace is one live Three.js scene. `environment.glb` contains the Blender architecture, garden, central basin, pearl, and rocks. Configurable crystal GLBs use the same lights, shadows, camera, and water reflections. No rendered image or video is used as the room backdrop.

The rendering pipeline uses physical glass, procedural limestone, a live cloud sky, directional shadows, depth-tested window light shafts, and restrained highlight bloom. Two real water meshes evaluate dispersive waves and cursor disturbances, with bounded planar reflection targets. The pearl, orbit, floating minerals, and crystal icons have restrained idle motion. Cursor position eases the camera and tilts hovered glass. Reduced motion freezes displacement while preserving all navigation and actual geometry. Hidden tabs and open full-screen workspace sections stop the render loop.

Surface shading is optimized for WebGL. It is not the same renderer as Blender Cycles: browser light shafts approximate volumetric scattering, environment lighting is prefiltered, and water uses analytical waves rather than a fluid simulation.

Onboarding owns configuration. No conversation analysis or backend-generated station decisions are simulated. Call the typed entry point before completing onboarding:

```ts
import { configureAtriumStations } from "@/components/atrium/configuration";
configureAtriumStations({ stations: [
  { id: "invoices", label: "Invoices", template: "accounts-payable", section: "cases" },
  { id: "approvals", label: "Approvals", template: "approvals", section: "review" },
] });
```

Alternatively send `hyper:workspace-stations` with the same CustomEvent detail, or call `configureAtriumStations({ count: 8 })` for a layout preview. Counts accept integers from 1 through 12. An explicit station list needs unique ids, labels, and template ids. Section is optional. Clicking always emits `hyper:station-select` with `{ station }` and selects the workspace section when a section is supplied. Counts above six add generic workspace placeholders, not fabricated backend capabilities.

Configuration is stored under `hyper.workspace.stations.v1` in this browser and synchronized between tabs. Calling the API while onboarding remains visible prepares the workspace without bypassing completion.

`public/assets/hyper-atrium/scene.json` supplies the Blender camera and template URLs. Camera coordinates are Blender Z-up, converted to glTF Y-up. Defaults retain the five reference positions and add a sixth Benchmarks crystal opposite Training Arena. The former pill bar is hidden; crystal clicks send hyper:navigate-section to the section controller. Timeline and Benchmarks provide a small Back to atrium link. Portrait views support horizontal scrolling through the environment, including keyboard focus on every crystal. Other counts use balanced arcs around the central pool. Interactive bounds and labels are projected from current model instances, so they follow the configuration instead of remaining pinned to the original image.

Interaction feedback uses the shared custom cursor. Fine pointers drive local
crystal hover/press shaders; labels stay fixed while the arrow moves 3px over
150ms. Keyboard focus is static, and reduced motion removes displacement. Touch
uses native horizontal panning. Background mouse dragging, vertical wheel input,
and focused-room arrow keys can explore a cropped room without selecting a station.

If model loading or WebGL fails, compact links expose every configured station.
They appear only in that failure state, preserving access without restoring the
normal pill navigation.
