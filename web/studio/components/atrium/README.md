# Atrium interface

The post-onboarding workspace is one live Three.js scene. `environment.glb` contains the Blender architecture, garden, central basin, pearl, and rocks. Configurable relic GLBs use the same lights, shadows, camera, and water reflections. The arched glass covers and rims are removed. No rendered image or video is used as the room backdrop.

`/dev/atrium` renders these public scene assets in development for visual work independent of onboarding and sign-in. It returns 404 in production and does not expose workspace data or change authentication.

The rendering pipeline uses procedural limestone, a live cloud sky, directional shadows, depth-tested window light shafts, and restrained highlight bloom. Two real water meshes evaluate dispersive waves and cursor disturbances, with bounded planar reflection targets. The pearl, orbit, floating minerals, and uncovered relics have restrained idle motion. Relics pivot around their own centers, brighten along their edges, and respond to hover with a spring. Labels remain stationary. Reduced motion freezes displacement while preserving all navigation and actual geometry. Hidden tabs and open full-screen workspace sections stop the render loop.

Beauty, water reflections, and bloom stay in linear half-float targets. ACES tone mapping runs once after bloom, followed by the display conversion. Water captures one shared scene color/depth refraction target and two planar reflections before each beauty frame, capped at 1024 pixels on desktop and 512 on coarse pointers. It combines refraction, absorption, Fresnel reflection, and the actual sun radiance into an opaque surface, so the pearl's transmission can see the water. Cached capture materials preserve transmissive-object shadows without writing those objects into the refraction image. A reusable 256-pixel cubemap captures the actual opaque room at the pearl only when station configuration changes. It excludes water and transmission surfaces to avoid recursive captures; architecture keeps its sky illumination.

The source also includes an off-camera right clerestory with three actual carved apertures. Its warm spotlight and shadow-casting baffle illuminate the pearl and piers. Runtime side-light scattering samples that spotlight's shadow map, while rear sunlight and water glints use their independent directional shadow map. This keeps one light's occlusion from incorrectly extinguishing another light.

Surface shading is optimized for WebGL. It is not the same renderer as Blender Cycles: browser light shafts approximate volumetric scattering, environment lighting is prefiltered, and water uses analytical waves rather than a fluid simulation.

The environment retains the full 500,000-triangle botanical garden and uses Draco compression. `geometry-loader.ts` shares a two-worker decoder pool, serves decoder files locally, and disposes workers when pending loads settle. Station GLBs can remain uncompressed. Scene camera, sun direction, and rear apertures come from the Blender export rather than separate guessed browser coordinates.

Relics have a few slow orbiting glints at rest. Hover strengthens these glints and reveals a thin warm base arc. These are depth-tested geometry in `ethereal.ts`, sized from each relic's actual bounds, and freeze under reduced motion.

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

`public/assets/hyper-atrium/scene.json` supplies the Blender camera and template URLs. Camera coordinates are Blender Z-up, converted to glTF Y-up. Defaults retain the five reference positions and add a sixth Benchmarks relic opposite Training Arena. The former pill bar is hidden; relic clicks send hyper:navigate-section to the section controller. Timeline and Benchmarks provide a small Back to atrium link. Portrait views support horizontal scrolling through the environment, including keyboard focus on every relic. Other counts use balanced arcs around the central pool. Interactive bounds and labels are projected from current model instances, so they follow the configuration instead of remaining pinned to the original image.

Interaction feedback uses the shared custom cursor. Fine pointers drive local
relic hover/press shaders; labels stay fixed while the arrow moves 3px over
150ms. Keyboard focus is static, and reduced motion removes displacement. Touch
uses native horizontal panning. Background mouse dragging, vertical wheel input,
and focused-room arrow keys can explore a cropped room without selecting a station.

If model loading or WebGL fails, compact links expose every configured station.
They appear only in that failure state, preserving access without restoring the
normal pill navigation.
