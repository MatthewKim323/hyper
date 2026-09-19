# Hyper atrium

An editable Blender reconstruction of the supplied concept image, with the architecture, water, pearl, landscape, and glass stations together in one scene. This is a modeled interpretation, not a pixel-identical reconstruction.

## Files

- `hyper-atrium.blend`: authored camera, carved stone architecture, floating pearl and orbit, five main glass stations, warm window lighting, rose gardens, and animated water. The hidden **Crystal library | reusable onboarding stations** collection holds ten standalone station variants.
- `hyper-atrium.png`: 2560×1441 Cycles render of the unified scene.
- `hotspots.json`: normalized camera projections for the original five-station composition.
- `verification.json`: saved-scene and reusable-asset checks.
- `composition-verification.json`: measured reference aperture bounds and the evaluated Blender geometry's projected bounds. This verifies placement, not photographic fidelity.
- `../../../public/assets/hyper-atrium/`: the live room geometry in `environment.glb`, ten station GLBs, and camera/template manifests. The web experience uses no rendered background image.

The Blender water uses eight small gravity-wave components with finite-depth dispersion, `omega² = g k tanh(k depth)`, and fine capillary normals. Cycles calculates reflection and transmission with an IOR of 1.333. This is an animated analytical surface, not a fluid-solver cache.

The rose garden uses three merged meshes: rolling ridges, stems and leaves, and 215,000 cupped petals across 43,000 floral sprigs. The garden totals 500,000 triangles. Linear vertex colors preserve rose, pink, and lilac variation in both Blender and glTF. Cycles petals transmit sunlight through thin surfaces; the browser shader approximates that backlighting. Draco compresses the environment's complete topology with 20-bit positions and 12-bit colors/normals. Decoder files and licenses are served locally under `public/assets/draco/`.

The camera's height and pitch match the reference basin ellipse. Rear stations sit at their measured depth, and the carved wall sits behind every station. The five glass aperture bounds project within five pixels of their manually measured targets at 1672 by 941. The browser's sixth station is Benchmarks, added opposite Training Arena.

The browser loads the room and independently configurable crystal models into a single Three.js scene. Procedural sky, animated water, lighting, reflections, and material shaders run live. The crystals are workspace navigation; the old pill navigation is removed. If WebGL cannot start, accessible workspace links remain available.

## Render the saved scene

From `web/studio`, using Blender 4.5:

```sh
"/Volumes/Vault/Applications/Blender.app/Contents/MacOS/Blender" -b --python tools/hyper_atrium/render.py -- --preview
"/Volumes/Vault/Applications/Blender.app/Contents/MacOS/Blender" -b --python tools/hyper_atrium/render.py
```

The preview writes an ignored `review.png` at 1280×720 and 32 samples. The final render writes `hyper-atrium.png` at 2560×1441 and 96 samples. Rendering does not save temporary resolution, sample count, or output-path changes into the source. All five main stations render together; the template library stays hidden.

## Rebuild and export

```sh
"/Volumes/Vault/Applications/Blender.app/Contents/MacOS/Blender" -b --python tools/hyper_atrium/build.py -- --save-only
"/Volumes/Vault/Applications/Blender.app/Contents/MacOS/Blender" -b assets/blender/hyper-atrium/hyper-atrium.blend --python tools/hyper_atrium/export_assets.py
"/Volumes/Vault/Applications/Blender.app/Contents/MacOS/Blender" -b --python tools/hyper_atrium/export_environment.py
"/Volumes/Vault/Applications/Blender.app/Contents/MacOS/Blender" -b assets/blender/hyper-atrium/hyper-atrium.blend --python tools/hyper_atrium/verify.py
```

Rebuilding replaces the authored source, so export the station library afterward to repopulate all ten templates. `update_landscape.py` replaces only the garden and updates directional lighting in the existing saved scene, preserving all stations and templates. Run the environment exporter after changes to the source geometry. No command generates backplates or water masks.

`refine_reference.py` reapplies measured composition, botanical geometry, and physical materials to an existing source. It writes fresh aperture measurements. `refine_fidelity_materials.apply(scene)` is also callable in memory; it never saves or renders on its own. Source volumetric haze, actual portal uplights, limestone pores, and cloudy pearl transmission are editable node graphs.

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
