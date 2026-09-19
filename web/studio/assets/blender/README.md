# Blender libraries

Editable collections assembled from the runtime GLBs in `public/theme/models/`. Each input has its own named collection. The libraries preserve imported transforms, hierarchy, meshes, materials, animation, and glTF metadata, including existing notices.

From `web/studio/`, with Blender on your PATH:

```sh
blender --background --factory-startup --python-exit-code 1 --python tools/prepare_blender.py
```

This rebuilds `home.blend` and `project-menu.blend`, reopens them, and checks geometry, object, material, collection, animation, and metadata counts. Use `-- --group home` for one library or `-- --verify-only` to check existing files. Adjacent manifests record input hashes and verification results.

Verified with Blender 4.5.13 LTS:

| Library | GLBs | Objects | Meshes | Vertices | Polygons |
| --- | ---: | ---: | ---: | ---: | ---: |
| home | 9 | 27 | 8 | 47,961 | 80,495 |
| project-menu | 3 | 3 | 3 | 8,562 | 16,542 |

The home library includes 19 placement objects. Blender corrects a pillows accessor count during Draco decoding; both libraries reopen successfully. The browser adds its own shaders and texture maps to render the final environment.
