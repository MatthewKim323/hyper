# Hyper atrium

An editable Blender reconstruction of the supplied concept image, with the architecture, water, pearl, landscape, and uncovered relic stations together in one scene. This is a modeled interpretation, not a pixel-identical reconstruction.

## Files

- `hyper-atrium.blend`: authored camera, carved stone architecture, floating pearl and orbit, five main relic stations, warm window lighting, rose gardens, and animated water. The hidden **Crystal library | reusable onboarding stations** collection holds ten standalone station variants. Glass covers and their polished rims remain hidden only as composition guides and are excluded from station exports.
- `hyper-atrium.png`: earlier 2560×1441 Cycles render. The current `.blend` and live GLBs are newer and include the clustered garden, narrow station light inlays, and softer pearl light. Regenerate this PNG to show those revisions.
- `hotspots.json`: normalized camera projections for the original five-station composition.
- `verification.json`: saved-scene and reusable-asset checks.
- `composition-verification.json`: measured reference aperture bounds and the evaluated Blender geometry's projected bounds. This verifies placement, not photographic fidelity.
- `../../../public/assets/hyper-atrium/`: the live room geometry in `environment.glb`, ten station GLBs, and camera/template manifests. The web experience uses no rendered background image.

The Blender water uses eight small gravity-wave components with finite-depth dispersion, `omega² = g k tanh(k depth)`, and fine capillary normals. Cycles calculates reflection and transmission with an IOR of 1.333. This is an animated analytical surface, not a fluid-solver cache.

The rose garden uses three merged meshes: unchanged rolling ridges, 2,500 irregular flowering crowns, and 84,500 petals across 16,900 blossoms. Angled leaf sprays form lilac interiors beneath pale cream and blush flower tips. The garden totals 221,300 triangles, reduced from 500,000 while retaining layered silhouettes. Linear vertex colors preserve rose, pink, and lilac variation in both Blender and glTF. Cycles petals transmit sunlight through thin surfaces; the browser shader approximates that backlighting. Draco compresses the environment's complete topology with 20-bit positions and 12-bit colors/normals. Decoder files and licenses are served locally under `public/assets/draco/`.

The camera's height and pitch match the reference basin ellipse. Rear stations sit at their measured depth, and the carved wall sits behind every station. The five hidden aperture guides preserve the original composition measurements. The browser's sixth station is Benchmarks, added opposite Training Arena.

The browser loads the room and independently configurable relic models into a single Three.js scene. Procedural sky, animated water, lighting, reflections, and material shaders run live. The relics are workspace navigation; the old pill navigation is removed. If WebGL cannot start, accessible workspace links remain available.

## Render the saved scene

From `web/studio`, using Blender 4.5:

```sh
"/Volumes/Vault/Applications/Blender.app/Contents/MacOS/Blender" -b --python tools/hyper_atrium/render.py -- --preview
"/Volumes/Vault/Applications/Blender.app/Contents/MacOS/Blender" -b --python tools/hyper_atrium/render.py
```

The preview writes an ignored `review.png` at 1280×720 and 32 samples. The final render writes `hyper-atrium.png` at 2560×1441 and 96 samples. Rendering does not save temporary resolution, sample count, or output-path changes into the source. All five main stations render together; the template library stays hidden.

On macOS, the renderer sets `CYCLES_METAL_DISABLE_BINARY_ARCHIVES=1` for its own process before GPU initialization, avoiding the Blender 4.5 Metal archive-path crash. Existing environment overrides are preserved; no user preferences or system settings change. First-use shader compilation can take a few minutes.

Add `--cpu` after `--` if the local macOS Metal shader compiler fails. This selects the same Cycles scene on the CPU, with a longer render time. Add `--threads 4` to set Blender's render thread count to four; omitting it retains the saved scene's thread setting. These render overrides are not saved. Use `--python-exit-code 1` for automated commands so Python failures return a nonzero process status.

## Rebuild and export

```sh
"/Volumes/Vault/Applications/Blender.app/Contents/MacOS/Blender" -b --python tools/hyper_atrium/build.py -- --save-only
"/Volumes/Vault/Applications/Blender.app/Contents/MacOS/Blender" -b assets/blender/hyper-atrium/hyper-atrium.blend --python tools/hyper_atrium/export_assets.py
"/Volumes/Vault/Applications/Blender.app/Contents/MacOS/Blender" -b --python tools/hyper_atrium/export_environment.py
"/Volumes/Vault/Applications/Blender.app/Contents/MacOS/Blender" -b assets/blender/hyper-atrium/hyper-atrium.blend --python tools/hyper_atrium/verify.py
```

Rebuilding replaces the authored source, so export the station library afterward to repopulate all ten templates. `props.hide_station_covers(scene)` persistently hides the two aperture guides per station; both rendering and station export enforce this. Relic icons, plinths, and labels remain intact. `update_landscape.py` replaces only the garden and updates directional lighting in the existing saved scene, preserving all stations and templates. Run the environment exporter after changes to room geometry. No command generates backplates or water masks.

Every reusable template includes a floating relic. The generic `crystal-tall`, `crystal-wide`, and `crystal-clear` variants use a faceted quartz shard, a three-shard cluster, and an opal octahedron. Their names and navigation destinations still come from onboarding. Verification rejects templates or exported GLBs that contain only a plinth.

Station illumination comes from narrow 20 mm annular inlays seated into the stone crowns, with only 5 mm exposed. The earlier full emissive plates are replaced in all five scene stations and ten reusable templates. The old emissive disk at the pearl's lower pole remains hidden as a lighting guide and is excluded from the environment export. `props.refine_station_light_seams(scene)` applies this geometry update without saving or changing other lights and materials.

`refine_reference.py` reapplies measured composition, botanical geometry, and physical materials to an existing source. It writes fresh aperture measurements. `refine_fidelity_materials.apply(scene)` is also callable in memory; it never saves or renders on its own. Source volumetric haze, actual relic uplights, honed marble, and cloudy pearl transmission are editable node graphs.

The shared stone material preserves its original `Hyper | blush ivory honed limestone` identifier for runtime compatibility. It now shades ivory and rose-gray marble with sparse folded veins, faint branching mineral seams, 72-per-meter grain, varying roughness, and submillimeter relief. Its world-space coordinates keep the pattern scale consistent across architecture, fountain, and plinths. Procedural Cycles graphs remain editable in the source; GLB exports contain their physical fallback constants and the browser supplies a matching procedural shader.

`side_light.apply(scene)` adds the right clerestory baffle and a warm 720 kW key through three real openings. It is entirely off camera. Wall targets are projected from visible camera positions so both warm bands remain inside the composition. The approved lighting balance halves broad/window fill, reduces the glossy sky branch to 1.6, and uses haze anisotropy 0.15. Cycles watts and the browser's legacy Three.js intensity require separate calibration. `verify.py` checks the side-light aperture paths, on-camera targets, and rear sun visibility at the pearl and basin. The side-light geometry and lamp metadata are exported together for the browser renderer.

`update_marble_lighting.py --preview` produces a temporary 640×360, 32-sample CPU material check outside the tracked assets. `--save` verifies and saves only the marble and approved lighting update, preserving the camera, water, garden, hero material, and station geometry. Export the environment and station library afterward to synchronize the baffle, physical material constants, and manifests.

Use the full macOS executable path. A Homebrew symlink can prevent Blender from locating its bundled Python and color-management resources. Fonts are packed into the blend file; materials and landscape details are procedural.

## Onboarding handoff

The atrium mounts only after onboarding is complete or skipped. Onboarding can provide the actual station list using `configureAtriumStations` from `components/atrium/configuration.ts`, or dispatch `hyper:workspace-stations` with the same payload. Configuration is retained if it arrives before the atrium mounts.

```ts
configureAtriumStations({ stations: [
  { id: "invoices", label: "Invoices", template: "accounts-payable", section: "cases" },
  { id: "audit", label: "Audit", template: "audit-evidence", section: "evidence" },
  { id: "approvals", label: "Approvals", template: "approvals", section: "review" },
] });
```

A `{ count: 8 }` payload also works for layout previews. Explicit labels and destinations should come from the actual onboarding result. Supported counts are 1 to 12; additional stations use the spare crystal templates. Reduced-motion preferences pause continuous animation.
