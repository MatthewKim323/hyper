# Atrium interface

The post-onboarding workspace is one live Three.js scene. `environment.glb` contains the Blender architecture, garden, central basin, pearl, and rocks. Configurable relic GLBs use the same lights, shadows, camera, and water reflections. The arched glass covers and rims are removed. No rendered image or video is used as the room backdrop.

`/dev/atrium` renders these public scene assets in development for visual work independent of onboarding and sign-in. It returns 404 in production and does not expose workspace data or change authentication.

The rendering pipeline uses textured honed marble, a live cloud sky, directional shadows, depth-tested window light shafts, and restrained highlight bloom. Two real water meshes evaluate dispersive waves and cursor disturbances, with bounded planar reflection targets. The pearl, orbit, floating minerals, and uncovered relics have restrained idle motion. Relics pivot around their own centers, brighten along their edges, and respond to hover with a spring. Labels remain stationary. Reduced motion freezes displacement while preserving all navigation and actual geometry. Hidden tabs stop the render loop. All six relic workspaces keep the scene and water rendering while open.

Beauty, water reflections, and bloom stay in linear half-float targets. A pinned Bun patch also caps native Three r143 transmission targets at 1024 pixels on desktop and 512 on coarse pointers, preserves their aspect ratio across captures, and recognizes WebGL2 HDR color support. Run `bun install` to apply the checked patch; it does not alter the canvas resolution. ACES tone mapping runs once after bloom, followed by the display conversion. Water refreshes one shared scene color/depth refraction target each frame, while the floor and basin alternate planar reflection captures. Both reflections refresh together on first frame, resize, projection changes, explicit scene updates, or recovery after a capture failure. Targets cap at 1024 pixels on desktop and 512 on coarse pointers; animated surface normals and cursor ripples still update every frame. It combines refraction, absorption, Fresnel reflection, and the actual sun radiance into an opaque surface, so the pearl's transmission can see the water. Cached capture materials preserve transmissive-object shadows without writing those objects into the refraction image. A reusable 256-pixel cubemap captures the actual opaque room at the pearl only when station configuration changes. It excludes water and transmission surfaces to avoid recursive captures. Marble stays visible and sky-lit during capture, then receives the captured room environment along with the optical materials. Resetting its environment for each capture prevents lighting feedback; failed captures restore the preceding maps.

The source also includes an off-camera right clerestory with three actual carved apertures. Its warm spotlight and shadow-casting baffle illuminate the pearl and piers. Runtime side-light scattering samples that spotlight's shadow map, while rear sunlight and water glints use their independent directional shadow map. This keeps one light's occlusion from incorrectly extinguishing another light.

Stone uses a shared ivory and rose-gray albedo with cloudy mineral variation, fine grain, and separate roughness and bump variation. World-space triplanar projection keeps a four-meter scale on walls, the curved basin, and plinths. Mirrored tiling avoids edge seams; mipmaps and anisotropic filtering stabilize detail at oblique angles. Albedo is normalized around its measured mean to preserve the approved blush body color and lighting. The Blender source packs the same texture and maps it with corresponding material nodes. The texture is applied to lit 3D surfaces, not used as a background. Submerged stone retains its separate lavender color and simpler mineral grain. Garden backlighting follows the rear sun's shadow map, independently of the side key.

Surface shading is optimized for WebGL. It is not the same renderer as Blender Cycles: browser light shafts approximate volumetric scattering, environment lighting is prefiltered, and water uses analytical waves rather than a fluid simulation.

Water uses the authored eight-wave amplitude spectrum, with subdued long swells and finer short ripples. Its planar reflection distortion scales with viewing distance, breaking up nearby reflected highlights without making distant arches excessively wavy. The browser retains a slower animation clock than the Blender authoring preview.

The botanical garden contains 2,500 flowering crowns and 16,900 blossoms across 221,300 triangles. The complete environment uses Draco compression. `geometry-loader.ts` shares a two-worker decoder pool, serves decoder files locally, and disposes workers when pending loads settle. Station GLBs can remain uncompressed. Scene camera, sun direction, and rear apertures come from the Blender export rather than separate guessed browser coordinates.

Relics have a few slow orbiting glints at rest. Hover strengthens these glints and reveals a thin warm base arc. These are depth-tested geometry in `ethereal.ts`, sized from each relic's actual bounds, and freeze under reduced motion.

The central pearl is the world voice agent. `agent-aura.ts` adds liquid surface displacement with matching depth and shadow passes, three flowing water currents, a soft luminous edge, and suspended droplets. The pearl has a visible idle drift. Fine-pointer hover and keyboard focus increase its flow; pressing gently compresses it. Interaction and audio envelopes settle continuously and freeze geometric motion under reduced motion. `world-voice.ts` reads RMS from the existing voice client's actual playback stream, with attack/release smoothing, and supplies idle, listening, thinking, connecting, speaking, and error states. Network speech events without audible playback do not invent talking motion. Clicking the pearl or pressing V toggles the same world-agent microphone. Audio analysis never connects microphone sound to speakers and never opens its own microphone. The development route includes explicitly labeled, muted synthetic audio controls for verifying motion without microphone permission or a backend conversation.

The bottom `WorldVoiceBox` wraps a clear glass text input and microphone control in Libraries.dev `VoiceBeam`. It reuses `CommandLayer`'s existing world session and user microphone stream; agent playback continues to drive the pearl independently. Typing starts a text turn without requesting microphone access. Failed sends retain the draft. The composer stays accessible while inspecting relic data and moves to the left on desktop to leave room for the focused panel. `/dev/voice-box` previews the composer with explicitly labeled, silent synthetic audio and no backend connection.

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

`public/assets/hyper-atrium/scene.json` supplies the Blender camera and template URLs. Camera coordinates are Blender Z-up, converted to glTF Y-up. Defaults retain the five reference positions and add a sixth Benchmarks relic opposite Training Arena. The former pill bar is hidden; relic clicks send hyper:navigate-section to the section controller. All six workspaces use transparent content in the original room with a reversible camera zoom and a Back to atrium control. Portrait views support horizontal scrolling through the environment, including keyboard focus on every relic. Other counts use balanced arcs around the central pool. Interactive bounds and labels are projected from current model instances, so they follow the configuration instead of remaining pinned to the original image.

Interaction feedback uses the shared custom cursor. Fine pointers drive local
relic hover/press shaders; labels stay fixed while the arrow moves 3px over
150ms. Keyboard focus is static, and reduced motion removes displacement. Touch
uses native horizontal panning. Background mouse dragging, vertical wheel input,
and focused-room arrow keys can explore a cropped room without selecting a station.

If model loading or WebGL fails, compact links expose every configured station.
They appear only in that failure state, preserving access without restoring the
normal pill navigation.
