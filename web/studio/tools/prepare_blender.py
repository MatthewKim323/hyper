"""Assemble editable Blender libraries from the existing runtime GLB files.

Run inside Blender, for example:
    blender --background --factory-startup --python tools/prepare_blender.py

The source models are imported, not modeled by this script. Original GLBs stay
unchanged. Their full glTF JSON metadata is embedded in each saved library.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

import bpy


STUDIO = Path(__file__).resolve().parents[1]
MODELS = STUDIO / "public" / "theme" / "models"
OUTPUT = STUDIO / "assets" / "blender"
GROUPS = ("home", "project-menu", "world", "awards", "phone")
DEFAULT_GROUPS = ("home", "project-menu")
PREPARATION = "Imported and organized from existing runtime GLBs."


def gltf_metadata(path: Path) -> dict:
    """Read the original JSON chunk without modifying or rewriting the GLB."""
    with path.open("rb") as source:
        magic, version, total_length = struct.unpack("<4sII", source.read(12))
        if magic != b"glTF" or version != 2 or total_length != path.stat().st_size:
            raise ValueError(f"Invalid GLB header: {path}")
        while source.tell() < total_length:
            chunk_length, chunk_type = struct.unpack("<II", source.read(8))
            chunk = source.read(chunk_length)
            if chunk_type == 0x4E4F534A:
                return json.loads(chunk.rstrip(b" \x00"))
    raise ValueError(f"No glTF JSON metadata found: {path}")


def sources_for(group: str) -> list[Path]:
    if group == "phone":
        paths = [MODELS / "phone.glb"]
    else:
        paths = sorted((MODELS / group).glob("*.glb"))
    if not paths or any(not path.is_file() for path in paths):
        raise FileNotFoundError(f"Runtime GLB files are missing for {group}")
    return paths


def counts() -> dict[str, int]:
    return {
        "objects": len(bpy.data.objects),
        "meshes": len(bpy.data.meshes),
        "mesh_objects": sum(obj.type == "MESH" for obj in bpy.data.objects),
        "collections": len(bpy.data.collections),
        "materials": len(bpy.data.materials),
        "armatures": len(bpy.data.armatures),
        "actions": len(bpy.data.actions),
        "vertices": sum(len(mesh.vertices) for mesh in bpy.data.meshes),
        "polygons": sum(len(mesh.polygons) for mesh in bpy.data.meshes),
    }


def active_collection(collection: bpy.types.Collection) -> None:
    def search(layer):
        if layer.collection == collection:
            return layer
        for child in layer.children:
            match = search(child)
            if match is not None:
                return match
        return None

    bpy.context.view_layer.active_layer_collection = search(
        bpy.context.view_layer.layer_collection
    )


def build(group: str) -> dict:
    source_paths = sources_for(group)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.context.scene.name = f"{group} library"
    bpy.context.scene["preparation"] = PREPARATION
    bpy.context.scene["source_directory"] = "public/theme/models"
    library = bpy.data.collections.new(group)
    bpy.context.scene.collection.children.link(library)
    records = []

    for path in source_paths:
        relative_path = path.relative_to(STUDIO).as_posix()
        metadata = gltf_metadata(path)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        collection = bpy.data.collections.new(path.stem)
        library.children.link(collection)
        active_collection(collection)
        existing_objects = set(bpy.data.objects)
        result = bpy.ops.import_scene.gltf(filepath=str(path))
        if result != {"FINISHED"}:
            raise RuntimeError(f"glTF import did not finish for {relative_path}: {result}")
        imported = set(bpy.data.objects) - existing_objects
        if not imported:
            raise RuntimeError(f"glTF import produced no objects: {relative_path}")
        for obj in imported:
            if collection not in obj.users_collection:
                collection.objects.link(obj)
            for previous in list(obj.users_collection):
                if previous != collection:
                    previous.objects.unlink(obj)

        collection["runtime_source"] = relative_path
        collection["runtime_sha256"] = digest
        collection["preparation"] = PREPARATION
        collection["original_gltf_asset"] = json.dumps(metadata.get("asset", {}))
        collection.asset_mark()
        collection.asset_data.description = f"{PREPARATION} Source: {relative_path}"
        copyright_notice = metadata.get("asset", {}).get("copyright")
        if copyright_notice:
            collection.asset_data.copyright = str(copyright_notice)

        text = bpy.data.texts.new(f"{path.name}.gltf.json")
        text.write(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n")
        record = {
            "source": relative_path,
            "sha256": digest,
            "collection": collection.name,
            "original_asset_metadata": metadata.get("asset", {}),
            "objects": len(imported),
            "mesh_objects": sum(obj.type == "MESH" for obj in imported),
            "embedded_metadata": text.name,
        }
        records.append(record)
        print(f"IMPORTED {relative_path}: {record['objects']} objects", flush=True)

    bpy.ops.file.pack_all()
    bpy.context.scene["library_group"] = group
    bpy.context.scene["source_count"] = len(records)
    report = {
        "library": f"{group}.blend",
        "preparation": PREPARATION,
        "blender_version": bpy.app.version_string,
        "sources": records,
        "counts": counts(),
    }
    embedded_report = bpy.data.texts.new("library-manifest.json")
    embedded_report.write(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    result = bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT / report["library"]), compress=True)
    if result != {"FINISHED"}:
        raise RuntimeError(f"Saving {report['library']} failed: {result}")
    return report


def verify(report: dict) -> dict:
    path = OUTPUT / report["library"]
    bpy.ops.wm.open_mainfile(filepath=str(path))
    actual = counts()
    if actual != report["counts"]:
        raise RuntimeError(f"Reopen count mismatch in {path.name}: {actual} != {report['counts']}")
    if bpy.context.scene.get("source_count") != len(report["sources"]):
        raise RuntimeError(f"Source count mismatch in {path.name}")
    for source in report["sources"]:
        collection = bpy.data.collections.get(source["collection"])
        if collection is None or collection.get("runtime_sha256") != source["sha256"]:
            raise RuntimeError(f"Source metadata mismatch in {path.name}: {source['source']}")
        if len(collection.objects) != source["objects"]:
            raise RuntimeError(f"Collection count mismatch in {path.name}: {collection.name}")
        if source["embedded_metadata"] not in bpy.data.texts:
            raise RuntimeError(f"Missing original metadata in {path.name}: {source['source']}")
    result = {"library": path.name, "reopened": True, "bytes": path.stat().st_size, "counts": actual}
    print(f"VERIFIED {json.dumps(result)}", flush=True)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--group", choices=GROUPS, action="append", help="Build only a selected library; repeat to select more.")
    parser.add_argument("--verify-only", action="store_true", help="Reopen existing libraries and verify their saved manifests.")
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    options = parser.parse_args(arguments)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    groups = options.group or list(DEFAULT_GROUPS)
    for group in groups:
        manifest_path = OUTPUT / f"{group}.manifest.json"
        if options.verify_only:
            report = json.loads(manifest_path.read_text())
        else:
            report = build(group)
            manifest_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
        verification = verify(report)
        (OUTPUT / f"{group}.verification.json").write_text(json.dumps(verification, indent=2) + "\n")
    print(f"COMPLETE: {len(groups)} Blender libraries verified", flush=True)


if __name__ == "__main__":
    main()
