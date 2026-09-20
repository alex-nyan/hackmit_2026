"""Export the supplied Blender Studio realistic male body without changing the source.

Run with the official Blender 4.2.23 executable:
  blender --background --factory-startup --disable-autoexec SOURCE.blend --python export_officer_body.py
"""
import bpy, json, hashlib, sys
from pathlib import Path
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = Path(args[0]) if args else Path.cwd() / 'anatomy-export'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE = Path(bpy.data.filepath)
BODY_NAME = 'GEO-body_male_realistic'
names = [BODY_NAME, BODY_NAME + '.eye.L', BODY_NAME + '.eye.R']
sources = [bpy.data.objects.get(n) for n in names]
assert all(sources), f'Missing source objects: {names}'
assert all(o.type == 'MESH' for o in sources), 'Expected actual mesh objects'

# The source is modified only in this transient process; it is never saved.
settings = []
for obj in sources:
    for mod in obj.modifiers:
        if mod.type in {'MULTIRES', 'SUBSURF'}:
            original = mod.levels
            mod.levels = min(1, original)
            if hasattr(mod, 'render_levels'):
                mod.render_levels = mod.levels
            settings.append({'object': obj.name, 'modifier': mod.name, 'source_level': original, 'export_level': mod.levels})
    obj.hide_set(False)
    obj.hide_viewport = False
    obj.hide_render = False

bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()
export_objects = []
counts = []
for obj in sources:
    evaluated = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=depsgraph)
    mesh.name = obj.data.name + '_web_evaluated'
    mesh.transform(obj.matrix_world)
    mesh.calc_loop_triangles()
    count = {'source_object':obj.name, 'vertices':len(mesh.vertices), 'polygons':len(mesh.polygons), 'triangles':len(mesh.loop_triangles), 'uv_layers':[u.name for u in mesh.uv_layers], 'materials':[m.name if m else None for m in mesh.materials]}
    attr = mesh.attributes.get('.sculpt_face_set')
    if attr:
        groups = {}
        for polygon, datum in zip(mesh.polygons, attr.data):
            record = groups.setdefault(str(datum.value), {'faces':0,'min':[float('inf')]*3,'max':[float('-inf')]*3})
            record['faces'] += 1
            for index in polygon.vertices:
                p = mesh.vertices[index].co
                for axis in range(3):
                    record['min'][axis] = min(record['min'][axis],p[axis])
                    record['max'][axis] = max(record['max'][axis],p[axis])
        count['face_sets_source_world_bounds'] = groups
    out = bpy.data.objects.new(obj.name, mesh)
    out['source'] = 'Blender Studio Human Base Meshes v1.4.1'
    out['license'] = 'CC0-1.0'
    out['source_object'] = obj.name
    export_objects.append(out)
    counts.append(count)

assert sum(c['triangles'] for c in counts) <= 200000, 'Triangle budget exceeded; lower subdivision level'
body = export_objects[0].data
low = Vector(tuple(min(v.co[i] for v in body.vertices) for i in range(3)))
high = Vector(tuple(max(v.co[i] for v in body.vertices) for i in range(3)))
origin = Vector(((low.x+high.x)/2, (low.y+high.y)/2, low.z))
for obj in export_objects:
    obj.data.transform(Matrix.Translation(-origin))
    for polygon in obj.data.polygons:
        polygon.use_smooth = True

scene = bpy.data.scenes.new('Paw Anatomy Export')
bpy.context.window.scene = scene
for obj in export_objects:
    scene.collection.objects.link(obj)
    obj.select_set(True)
bpy.context.view_layer.objects.active = export_objects[0]
bpy.context.view_layer.update()

bpy.ops.export_scene.gltf(filepath=str(OUT/'officer-body.glb'), export_format='GLB', use_selection=True,
    export_yup=True, export_apply=False, export_animations=False, export_skins=False,
    export_morph=False, export_extras=True, export_materials='EXPORT', export_cameras=False,
    export_lights=False)

shifted_low = low-origin
shifted_high = high-origin
report = {'source_path':str(SOURCE),'source_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    'blender':bpy.app.version_string,'output_path':str(OUT/'officer-body.glb'),
    'output_bytes':(OUT/'officer-body.glb').stat().st_size,
    'license':'CC0-1.0','asset_author':'Dan Ulrich','asset_collection':'Body Male - Realistic',
    'license_evidence':'Collection asset metadata license CC0; source README: All provided assets are public domain under the CC0 license.',
    'official_source':'https://www.blender.org/download/demo-files/',
    'modifier_settings':settings,'objects':counts,'triangles':sum(c['triangles'] for c in counts),
    'normalization':'Translation only: feet on Y=0, body bounds centered on X and Z in exported glTF. Original proportions and size preserved.',
    'source_translation_removed':list(origin),'gltf_y_up':True,
    'gltf_bounds':{'min':[shifted_low.x,shifted_low.z,-shifted_high.y],'max':[shifted_high.x,shifted_high.z,-shifted_low.y]},
    'source_unchanged':True}
report['output_sha256']=hashlib.sha256((OUT/'officer-body.glb').read_bytes()).hexdigest()
(OUT/'export-audit.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
