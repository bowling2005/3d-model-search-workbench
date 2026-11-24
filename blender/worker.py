"""Headless Blender inspection and safe processing worker.

Invoked by the desktop application with a JSON job file after ``--``.
"""

from __future__ import annotations

import json
import os
import sys
import traceback

import bmesh
import bpy
from mathutils import Vector


def main() -> None:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(args) != 1:
        raise SystemExit("Expected one job JSON path after --")

    with open(args[0], "r", encoding="utf-8") as handle:
        job = json.load(handle)

    result_path = job["result_path"]
    try:
        result = run_job(job)
    except Exception as error:
        result = {
            "ok": False,
            "error": str(error),
            "blenderVersion": bpy.app.version_string,
            "objects": 0,
            "meshes": 0,
            "vertices": 0,
            "triangles": 0,
            "polygons": 0,
            "uvLayers": 0,
            "materials": 0,
            "textures": 0,
            "armatures": 0,
            "animations": 0,
            "shapeKeys": 0,
            "bounds": [0.0, 0.0, 0.0],
            "issues": {
                "nonManifoldEdges": 0,
                "boundaryEdges": 0,
                "looseVertices": 0,
                "degenerateFaces": 0,
                "duplicateFaces": 0,
            },
            "warnings": [traceback.format_exc()],
        }
        print(traceback.format_exc(), file=sys.stderr)

    os.makedirs(os.path.dirname(result_path), exist_ok=True)
    with open(result_path, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)
    if not result.get("ok", False):
        raise SystemExit(1)


def run_job(job: dict) -> dict:
    input_file = os.path.abspath(job["input_file"])
    mode = job.get("mode", "inspect")
    output_dir = os.path.abspath(job["output_dir"])
    os.makedirs(output_dir, exist_ok=True)

    clear_scene(include_file=not input_file.lower().endswith(".blend"))
    import_model(input_file)

    warnings = []
    if mode == "process":
        process_meshes()
        bpy.ops.wm.save_as_mainfile(
            filepath=os.path.join(output_dir, "normalized.blend")
        )
        export_fbx(os.path.join(output_dir, "processed.fbx"))
        output_model = os.path.join(output_dir, "processed.fbx")
    else:
        output_model = None

    report = inspect_scene(warnings)
    report["ok"] = True
    report["outputModel"] = output_model
    return report


def clear_scene(include_file: bool = True) -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    if include_file:
        for datablocks in (
            bpy.data.meshes,
            bpy.data.materials,
            bpy.data.images,
            bpy.data.armatures,
        ):
            for datablock in list(datablocks):
                if datablock.users == 0:
                    datablocks.remove(datablock)


def import_model(path: str) -> None:
    extension = os.path.splitext(path)[1].lower()
    if extension == ".blend":
        bpy.ops.wm.open_mainfile(filepath=path)
    elif extension == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif extension in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif extension == ".obj":
        if hasattr(bpy.ops.wm, "obj_import"):
            bpy.ops.wm.obj_import(filepath=path)
        else:
            bpy.ops.import_scene.obj(filepath=path)
    elif extension in (".usd", ".usda", ".usdc", ".usdz"):
        bpy.ops.wm.usd_import(filepath=path)
    elif extension == ".dae":
        bpy.ops.wm.collada_import(filepath=path)
    elif extension == ".stl":
        if hasattr(bpy.ops.wm, "stl_import"):
            bpy.ops.wm.stl_import(filepath=path)
        else:
            bpy.ops.import_mesh.stl(filepath=path)
    else:
        raise RuntimeError(f"Unsupported Blender import format: {extension}")


def process_meshes() -> None:
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")

    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

        mesh = obj.data
        bm = bmesh.new()
        bm.from_mesh(mesh)
        if bm.verts:
            bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
        loose = [vertex for vertex in bm.verts if not vertex.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        face_list = list(bm.faces)
        if face_list:
            bmesh.ops.recalc_face_normals(bm, faces=face_list)
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()


def export_fbx(path: str) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    exportable = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type in {"MESH", "ARMATURE", "EMPTY"}
    ]
    if not exportable:
        raise RuntimeError("No exportable model objects were imported.")
    for obj in exportable:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = exportable[0]
    bpy.ops.export_scene.fbx(
        filepath=path,
        use_selection=True,
        apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_ALL",
        axis_forward="-Z",
        axis_up="Y",
        path_mode="AUTO",
        embed_textures=True,
        bake_anim=True,
    )


def inspect_scene(warnings: list[str]) -> dict:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    vertices = 0
    triangles = 0
    polygons = 0
    uv_layers = 0
    materials = set()
    textures = set()
    armatures = 0
    shape_keys = 0
    bounds_min = Vector((float("inf"), float("inf"), float("inf")))
    bounds_max = Vector((float("-inf"), float("-inf"), float("-inf")))
    issues = {
        "nonManifoldEdges": 0,
        "boundaryEdges": 0,
        "looseVertices": 0,
        "degenerateFaces": 0,
        "duplicateFaces": 0,
    }

    for obj in bpy.context.scene.objects:
        if obj.type == "ARMATURE":
            armatures += 1
        if obj.type != "MESH":
            continue

        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            vertices += len(mesh.vertices)
            polygons += len(mesh.polygons)
            mesh.calc_loop_triangles()
            triangles += len(mesh.loop_triangles)
            uv_layers += len(mesh.uv_layers)
            materials.update(
                slot.material.name
                for slot in obj.material_slots
                if slot.material is not None
            )
            if obj.data.shape_keys:
                shape_keys += len(obj.data.shape_keys.key_blocks)
            for material in obj.data.materials:
                if material and material.use_nodes and material.node_tree:
                    for node in material.node_tree.nodes:
                        if node.type == "TEX_IMAGE" and node.image:
                            textures.add(node.image.name)

            for corner in obj.bound_box:
                world = obj.matrix_world @ Vector(corner)
                bounds_min.x = min(bounds_min.x, world.x)
                bounds_min.y = min(bounds_min.y, world.y)
                bounds_min.z = min(bounds_min.z, world.z)
                bounds_max.x = max(bounds_max.x, world.x)
                bounds_max.y = max(bounds_max.y, world.y)
                bounds_max.z = max(bounds_max.z, world.z)

            bm = bmesh.new()
            bm.from_mesh(mesh)
            bm.verts.index_update()
            face_keys = set()
            for edge in bm.edges:
                if edge.is_boundary:
                    issues["boundaryEdges"] += 1
                elif not edge.is_manifold:
                    issues["nonManifoldEdges"] += 1
            issues["looseVertices"] += sum(
                1 for vertex in bm.verts if not vertex.link_edges
            )
            for face in bm.faces:
                if face.calc_area() <= 1e-12:
                    issues["degenerateFaces"] += 1
                key = tuple(sorted(vertex.index for vertex in face.verts))
                if key in face_keys:
                    issues["duplicateFaces"] += 1
                else:
                    face_keys.add(key)
            bm.free()
        finally:
            evaluated.to_mesh_clear()

    if not meshes:
        warnings.append("No mesh objects were found.")
    if issues["degenerateFaces"]:
        warnings.append(f'{issues["degenerateFaces"]} degenerate faces detected.')
    if issues["nonManifoldEdges"]:
        warnings.append(
            f'{issues["nonManifoldEdges"]} non-manifold edges detected.'
        )

    if triangles == 0:
        bounds = [0.0, 0.0, 0.0]
    else:
        size = bounds_max - bounds_min
        bounds = [round(size.x, 6), round(size.y, 6), round(size.z, 6)]

    return {
        "blenderVersion": bpy.app.version_string,
        "objects": len(bpy.context.scene.objects),
        "meshes": len(meshes),
        "vertices": vertices,
        "triangles": triangles,
        "polygons": polygons,
        "uvLayers": uv_layers,
        "materials": len(materials),
        "textures": len(textures),
        "armatures": armatures,
        "animations": len(bpy.data.actions),
        "shapeKeys": shape_keys,
        "bounds": bounds,
        "issues": issues,
        "warnings": warnings,
    }


if __name__ == "__main__":
    main()
