"""
Builds the map's landmark sprites from scratch in Blender: a Malaysian roadside
bus shelter (the stops), the same shelter with someone waiting at it (your
stop), an elevated Klang Valley MRT station with a train at the platform (the
feeder's end), and a small generic elevated rail station whose line colour the
app tints in from a separate band mask. Each comes in a day and a night look.

Our own work, so it is committed. Plain lettering only ("HENTIAN BAS",
"MRT"), no operator livery, logos or marks; the train is plain white and
silver with a neutral grey band.

Usage, from modules/bus-model (macOS; usdcat, usdzip, usdrecord and sips ship
with the OS):
  blender --background --factory-startup --python scripts/build-map-landmarks.py -- ios/Assets

Each landmark is built in bmesh, exported to a temporary USDZ (as the bus
scripts do) and rendered with usdrecord from the bus sprites' view: from the
south, 55° above the map, orthographic, transparent background, the model
turned LANDMARK_TURN° so it reads three-quarters. A soft contact shadow is
baked from the model's own triangles into a translucent ground quad. Night is
a material grade (every colour dimmed to a cool moonlight, the lamps and
windows emissive, a warm pool of light on the ground) because usdrecord lights
every render with its own fixed default and ignores the stage's lights.

Output contract, which the app's markers rely on:
  - Square PNGs with a transparent background. The landmark's ground point
    (the stop's or station's coordinate) is at x = 50 %, y = 70 % of the image
    (GROUND_ANCHOR), the shadow baked in around it.
  - map-shelter.png, map-shelter-night.png: 108 px (36 pt @3x).
  - map-your-stop.png, map-your-stop-night.png: 168 px (56 pt @3x).
  - map-mrt-station.png, map-mrt-station-night.png: 240 px (80 pt @3x).
  - map-station.png, map-station-night.png: 96 px (32 pt @3x), the line band
    (canopy fascia and edge strip, pillar stripes) in a light neutral; and
    map-station-band.png, the same size and camera: white where the band is
    seen, its coverage in the alpha, transparent everywhere else (shared by
    day and night).
"""

import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

LANDMARK_TURN = 20  # degrees, the model's front turned from facing the camera toward the right
ELEVATION = 55  # the bus sprites' view
GROUND_ANCHOR = (0.5, 0.7)  # where the ground point lands, as fractions of width and height
SUPERSAMPLE = 3  # rendered at this multiple of the final size, then downscaled with sips

# Night: linear multipliers on every material's diffuse colour (moonlit,
# blue), and the warmer multiplier for what the landmark's own lamps light.
NIGHT_TINT = (0.20, 0.23, 0.34)
LAMPLIT_TINT = (0.62, 0.52, 0.36)
WARM_LIGHT = (1.0, 0.86, 0.62)
ROOF_GLOW = (0.22, 0.20, 0.15)  # the shelter's light through its translucent roof


def srgb(hex_):
    return tuple(int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5))


def linear(hex_):
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb(hex_))


def run(*args, **kw):
    subprocess.run(args, check=True, **kw)


# MARK: Lettering and painted plates

# Plain type: Arial from macOS, Blender's own font where it's missing.
FONTS = {
    'regular': '/System/Library/Fonts/Supplemental/Arial.ttf',
    'bold': '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
}
CAP_HEIGHT = 0.716  # Arial's, in em


def lettering(text, font):
    """`text` set at 1 em on the baseline y = 0, as filled triangles [(x, y)] * 3."""
    curve = bpy.data.curves.new('Lettering', 'FONT')
    if os.path.exists(FONTS[font]):
        curve.font = bpy.data.fonts.load(FONTS[font], check_existing=True)
    curve.body = text
    ob = bpy.data.objects.new('Lettering', curve)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.update()
    evaluated = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    tris = [[tuple(mesh.vertices[v].co.xy) for v in t.vertices] for t in mesh.loop_triangles]
    evaluated.to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(curve)
    return tris


class Plate:
    """A painted sign face, w × h metres, u right and v up from its bottom
    left; painted at SS× and averaged down for clean edges."""
    SS = 4

    def __init__(self, w, h, px_per_m, color):
        self.w, self.h = int(round(w * px_per_m)), int(round(h * px_per_m))
        self.s = px_per_m * self.SS
        self.img = np.zeros((self.h * self.SS, self.w * self.SS, 3), np.float32)
        self.img[:] = srgb(color)

    def poly(self, pts, color):
        P = np.asarray(pts, float) * self.s
        x0, y0 = np.maximum(np.floor(P.min(0)).astype(int), 0)
        x1, y1 = np.ceil(P.max(0)).astype(int)
        x1, y1 = min(x1, self.img.shape[1]), min(y1, self.img.shape[0])
        if x1 <= x0 or y1 <= y0:
            return
        ys, xs = np.mgrid[y0:y1, x0:x1] + 0.5
        inside = np.zeros(xs.shape, bool)
        j = len(P) - 1
        for i in range(len(P)):
            (xi, yi), (xj, yj) = P[i], P[j]
            inside ^= ((yi > ys) != (yj > ys)) & (xs < (xj - xi) * (ys - yi) / (yj - yi + 1e-12) + xi)
            j = i
        self.img[y0:y1, x0:x1][inside] = srgb(color)

    def rect(self, u0, v0, u1, v1, color):
        self.poly([(u0, v0), (u1, v0), (u1, v1), (u0, v1)], color)

    def text(self, text, u, v, cap, color, font='bold'):
        """Centred on u, its baseline on v, cap height `cap`."""
        tris = lettering(text, font)
        xs = [p[0] for tri in tris for p in tri]
        x0, x1 = min(xs), max(xs)
        s = cap / CAP_HEIGHT
        lo = u - (x1 - x0) * s / 2
        for tri in tris:
            self.poly([(lo + (x - x0) * s, v + y * s) for x, y in tri], color)

    def image(self, name, work):
        n = self.SS
        small = self.img.reshape(self.h, n, self.w, n, 3).mean((1, 3))
        rgba = np.ones((self.h, self.w, 4), np.float32)
        rgba[..., :3] = small
        img = bpy.data.images.new(name, self.w, self.h, alpha=False)
        img.pixels.foreach_set(rgba.ravel())  # row 0 at the bottom, as Blender stores images
        img.filepath_raw = os.path.join(work, f'{name}.png')
        img.file_format = 'PNG'
        img.save()
        return img


# MARK: Materials and geometry helpers


def material(name, color=None, rough=0.5, metal=0.0, coat=0.0, image=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    if image is not None:
        tex = m.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = image
        m.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    elif color is not None:
        bsdf.inputs['Base Color'].default_value = (*linear(color), 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if 'Coat Weight' in bsdf.inputs:
        bsdf.inputs['Coat Weight'].default_value = coat
        bsdf.inputs['Coat Roughness'].default_value = 0.06
    return m


def new_object(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for m in mats if isinstance(mats, list) else [mats]:
        me.materials.append(m)
    return ob


def add_box(bm, x0, x1, y0, y1, z0, z1, bevel=0.0, segments=2):
    res = bmesh.ops.create_cube(bm, size=1.0)
    verts = res['verts']
    for v in verts:
        v.co = Vector((x0 if v.co.x < 0 else x1, y0 if v.co.y < 0 else y1, z0 if v.co.z < 0 else z1))
    if bevel > 0:
        edges = list({e for v in verts for e in v.link_edges})
        bmesh.ops.bevel(bm, geom=verts + edges, offset=bevel, segments=segments,
                        profile=0.5, affect='EDGES', clamp_overlap=True)
    return verts


def add_cylinder(bm, center, axis, r, depth, segs=16, r2=None):
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r,
                                radius2=r if r2 is None else r2, depth=depth)
    rot = Vector((0, 0, 1)).rotation_difference(Vector(axis).normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation(center) @ rot, verts=res['verts'])
    return res['verts']


def add_sphere(bm, center, r, scale=(1, 1, 1), segs=12):
    res = bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=segs // 2 + 1, radius=r)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(center) @ Matrix.Diagonal((*scale, 1)), verts=res['verts'])


def add_quad(bm, corners):
    return bm.faces.new([bm.verts.new(c) for c in corners])


def prism(bm, profile_zy, x0, x1):
    """Extrudes a (z, y) outline across x0..x1."""
    a = [bm.verts.new((x0, y, z)) for z, y in profile_zy]
    b = [bm.verts.new((x1, y, z)) for z, y in profile_zy]
    n = len(a)
    faces = [bm.faces.new(list(reversed(a))), bm.faces.new(b)]
    for i in range(n):
        j = (i + 1) % n
        faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)


def arch(z0, z1, y_edge, rise, thick, n=16):
    """A barrel roof's cross-section across z0..z1: springing at y_edge,
    `rise` higher at the crown, `thick` deep."""
    zc, hz = (z0 + z1) / 2, (z1 - z0) / 2
    top = [(z0 + (z1 - z0) * i / n, y_edge + rise * (1 - ((z0 + (z1 - z0) * i / n - zc) / hz) ** 2) + thick)
           for i in range(n + 1)]
    bottom = [(z, y - thick) for z, y in reversed(top)]
    return top + bottom


def signface(bm, x0, x1, y0, y1, z):
    """A quad facing +Z with UVs 0..1, u to +X, v up."""
    f = add_quad(bm, [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)])
    uv = bm.loops.layers.uv.new('UVMap')
    for loop, coords in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = coords


def smooth(ob, angle=35):
    me = ob.data
    if hasattr(me, 'set_sharp_from_angle'):
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(angle))


# MARK: The bus shelter

# Shelter, metres. Front (the kerb) toward +Z, the bench against the back.
SH_X = 1.65  # half the post spacing
SH_BACK, SH_FRONT = -0.60, 0.55  # post lines
SH_EAVE = 2.5  # under the roof at its edges
POLE = (-2.02, 0.66)  # the sign pole's x, z: the left, which the turn brings forward


def build_shelter(work, figure=False):
    M = {
        'Roof': material('Roof', '#E3E6E9', rough=0.45),
        'Frame': material('Frame', '#3B4047', rough=0.5, metal=0.3),
        'Panel': material('Panel', '#9DA8B2', rough=0.35),
        'Bench': material('Bench', '#8D959E', rough=0.35, metal=0.5),
        'Lamp': material('Lamp', '#D9DCDF', rough=0.3),
    }
    plate = Plate(0.56, 0.60, 400, '#1F4F99')
    plate.rect(0.025, 0.025, 0.535, 0.575, '#FFFFFF')
    plate.rect(0.04, 0.04, 0.52, 0.56, '#1F4F99')
    plate.text('HENTIAN', 0.28, 0.33, 0.085, '#FFFFFF')
    plate.text('BAS', 0.28, 0.12, 0.13, '#FFFFFF')
    M['Plate'] = material('Plate', image=plate.image('hentian-bas', work), rough=0.4)

    frame, roof, panel, bench, lamp, sign = (bmesh.new() for _ in range(6))
    # Posts: four corners and one mid back, chunky enough to survive 36 pt.
    for x, z in ((-SH_X, SH_BACK), (SH_X, SH_BACK), (-SH_X, SH_FRONT), (SH_X, SH_FRONT), (0, SH_BACK)):
        add_box(frame, x - 0.055, x + 0.055, 0, SH_EAVE, z - 0.055, z + 0.055)
    # Beams under the roof, front and back, and the roof's dark end ribs.
    for z in (SH_BACK, SH_FRONT):
        add_box(frame, -SH_X - 0.06, SH_X + 0.06, SH_EAVE - 0.14, SH_EAVE + 0.02, z - 0.06, z + 0.06)
    # The roof barely overhangs the front, so the bench shows beneath it
    # from the map's 55°.
    prism(roof, arch(-0.88, 0.76, SH_EAVE, 0.28, 0.04), -1.86, 1.86)
    for x in (-1.88, 1.84):
        prism(frame, arch(-0.90, 0.78, SH_EAVE - 0.02, 0.28, 0.06), x, x + 0.04)
    # The strip light, under the roof's front edge, where it shows from the road.
    add_box(lamp, -1.30, 1.30, SH_EAVE - 0.16, SH_EAVE - 0.01, 0.60, 0.73)
    # Back panel and bench.
    add_box(panel, -SH_X + 0.05, SH_X - 0.05, 0.22, SH_EAVE - 0.16, SH_BACK - 0.03, SH_BACK + 0.01)
    add_box(bench, -1.25, 1.25, 0.43, 0.50, SH_BACK + 0.06, SH_BACK + 0.42, bevel=0.02)
    for x in (-1.05, 1.05):
        add_box(frame, x - 0.04, x + 0.04, 0, 0.43, SH_BACK + 0.15, SH_BACK + 0.35)
    # The stop sign on its own pole at the front corner.
    px, pz = POLE
    add_cylinder(frame, Vector((px, 1.38, pz)), (0, 1, 0), 0.045, 2.76)
    add_box(frame, px - 0.29, px + 0.29, 2.08, 2.70, pz + 0.045, pz + 0.075)
    signface(sign, px - 0.28, px + 0.28, 2.09, 2.69, pz + 0.077)

    new_object('Frame', frame, [M['Frame']])
    new_object('Roof', roof, [M['Roof']])
    new_object('Panel', panel, [M['Panel']])
    new_object('Bench', bench, [M['Bench']])
    new_object('Lamp', lamp, [M['Lamp']])
    new_object('Sign', sign, [M['Plate']])
    if figure:  # at the kerb in front, looking up the road for the bus
        build_figure(Vector((0.62, 0.0, 1.22)), -12)


def build_figure(at, turn):
    """Someone waiting: faceless, plain clothes, built of capsules."""
    top, legs, skin = bmesh.new(), bmesh.new(), bmesh.new()
    for s in (-1, 1):
        add_cylinder(legs, Vector((s * 0.095, 0.45, 0)), (0, 1, 0), 0.08, 0.90, r2=0.075)
        add_sphere(legs, Vector((s * 0.095, 0.04, 0.04)), 0.08, (1, 0.5, 1.5))  # shoes
        add_cylinder(top, Vector((s * 0.255, 1.17, 0)), (s * 0.12, 1, 0), 0.065, 0.50)  # arms
        add_sphere(skin, Vector((s * 0.285, 0.90, 0)), 0.055)  # hands
    add_cylinder(top, Vector((0, 1.12, 0)), (0, 1, 0), 0.20, 0.52, segs=20)
    add_sphere(top, Vector((0, 1.38, 0)), 0.20, (1, 0.45, 0.85), segs=20)  # shoulders
    add_sphere(legs, Vector((0, 0.88, 0)), 0.19, (1, 0.35, 0.8), segs=20)  # hips
    add_cylinder(skin, Vector((0, 1.47, 0)), (0, 1, 0), 0.055, 0.12)
    add_sphere(skin, Vector((0, 1.62, 0)), 0.115, (0.92, 1.08, 0.98), segs=20)
    add_sphere(legs, Vector((0, 1.665, -0.015)), 0.118, (0.95, 0.8, 1.0), segs=20)  # hair
    rot = Matrix.Translation(at) @ Matrix.Rotation(math.radians(turn), 4, 'Y')
    for bm in (top, legs, skin):
        bmesh.ops.transform(bm, matrix=rot, verts=bm.verts[:])
    new_object('FigureTop', top, [material('Shirt', '#6F8DAE', rough=0.8)])
    new_object('FigureLegs', legs, [material('Trousers', '#3A3F48', rough=0.8)])
    new_object('FigureSkin', skin, [material('Skin', '#C7A184', rough=0.7)])


# MARK: The MRT station

# Station, metres. The line runs along X; the near (camera) side is +Z.
DECK_Y = 12.8  # rail level
TRACK_Z = 3.0  # both tracks either side of an island platform
ST_X, ST_Z = 18.0, 6.0  # half the deck's length and width
ROOF_EDGE_Y = 17.9
VIADUCT_X = 26.0  # the viaduct stubs run out to here


def build_mrt(work):
    M = {
        'Concrete': material('Concrete', '#BDBDB8', rough=0.8),
        'Cladding': material('Cladding', '#E4E6E8', rough=0.5),
        'RoofMetal': material('RoofMetal', '#D4D9DE', rough=0.55, metal=0.1),
        'Structure': material('Structure', '#5F666E', rough=0.5, metal=0.3),
        'Glazing': material('Glazing', '#3A4856', rough=0.1, coat=0.5),
        'Platform': material('Platform', '#B9BCBE', rough=0.7),
        'Rail': material('Rail', '#4B4E52', rough=0.6),
        'Lamp': material('Lamp', '#D9DCDF', rough=0.3),
        'TrainBody': material('TrainBody', '#E9EBED', rough=0.3, coat=0.6),
        'TrainBand': material('TrainBand', '#737980', rough=0.4),
        'TrainGlass': material('TrainGlass', '#1C232B', rough=0.08, coat=0.8),
        'TrainRoof': material('TrainRoof', '#A3A8AE', rough=0.5),
    }
    plate = Plate(9.0, 3.2, 50, '#2A3037')
    plate.text('MRT', 4.5, 0.55, 2.1, '#FFFFFF')
    M['Sign'] = material('Sign', image=plate.image('mrt-sign', work), rough=0.4)

    B = {k: bmesh.new() for k in M}
    sign = bmesh.new()
    # Columns and the concourse box over the road.
    for x in (-13.0, -4.5, 4.5, 13.0):
        for z in (-4.2, 4.2):
            add_box(B['Concrete'], x - 0.65, x + 0.65, 0, 8.0, z - 0.65, z + 0.65)
    add_box(B['Cladding'], -16.5, 16.5, 8.0, 11.9, -5.6, 5.6, bevel=0.15)
    for z0, z1 in ((5.6, 5.64), (-5.64, -5.6)):
        for i in range(10):
            x = -15.5 + i * 3.1
            add_box(B['Glazing'], x, x + 2.8, 8.7, 10.9, z0, z1)
    # The sign, standing proud of the glazing in the middle.
    add_box(B['Structure'], -4.6, 4.6, 8.35, 11.65, 5.6, 5.85)
    signface(sign, -4.5, 4.5, 8.4, 11.6, 5.86)
    # A glazed entrance block at the front right, up to the concourse.
    add_box(B['Cladding'], 9.0, 15.0, 0, 8.0, 5.6, 10.0, bevel=0.1)
    for x0, x1, z0, z1 in ((9.4, 14.6, 9.99, 10.03), (14.99, 15.03, 6.0, 9.6)):
        add_box(B['Glazing'], x0, x1, 0.4, 7.4, z0, z1)
    add_box(B['RoofMetal'], 8.7, 15.3, 8.0, 8.35, 5.6, 10.3)

    # Platform level: the deck, an island platform, parapets, rails.
    add_box(B['Concrete'], -ST_X, ST_X, 11.9, DECK_Y, -ST_Z, ST_Z)
    add_box(B['Platform'], -ST_X + 1, ST_X - 1, DECK_Y, DECK_Y + 1.0, -TRACK_Z + 1.55, TRACK_Z - 1.55)
    for s in (-1, 1):
        zz = sorted((s * (ST_Z - 0.25), s * ST_Z))
        add_box(B['Cladding'], -ST_X, ST_X, DECK_Y, DECK_Y + 1.0, *zz)
    # Roof: a long barrel on slim posts over the island platform and the far
    # track. The near track is left open to the sky, a liberty taken so the
    # train at its platform shows whole from the map's 55°.
    rz0, rz1 = -ST_Z - 0.6, TRACK_Z - 1.1
    prism(B['RoofMetal'], arch(rz0, rz1, ROOF_EDGE_Y, 2.4, 0.18, n=24), -ST_X - 1.5, ST_X + 1.5)
    for x in (-15.0, -7.5, 0.0, 7.5, 15.0):
        for z in (rz0 + 0.75, rz1 - 0.45):
            add_box(B['Structure'], x - 0.18, x + 0.18, DECK_Y, ROOF_EDGE_Y + 0.2, z - 0.15, z + 0.15)
    # Platform lights hung under the roof's near edge.
    add_box(B['Lamp'], -ST_X + 0.5, ST_X - 0.5, ROOF_EDGE_Y - 0.45, ROOF_EDGE_Y - 0.15, rz1 - 0.35, rz1 - 0.05)

    # Viaduct stubs: a box girder on one pier each side.
    for s in (-1, 1):
        xx = sorted((s * ST_X, s * VIADUCT_X))
        add_box(B['Concrete'], *xx, 10.6, DECK_Y, -4.6, 4.6, bevel=0.3)
        for z in (-4.6, 4.4):
            add_box(B['Cladding'], *xx, DECK_Y, DECK_Y + 0.9, z, z + 0.2)
        x = s * 22.5
        add_box(B['Concrete'], x - 1.0, x + 1.0, 0, 9.8, -1.0, 1.0, bevel=0.2)
        add_box(B['Concrete'], x - 1.2, x + 1.2, 9.6, 10.6, -3.6, 3.6, bevel=0.15)
    for z in (-TRACK_Z, TRACK_Z):
        for r in (-0.72, 0.72):
            add_box(B['Rail'], -VIADUCT_X, VIADUCT_X, DECK_Y, DECK_Y + 0.18, z + r - 0.08, z + r + 0.08)

    # The train: three short cars at the near platform.
    build_train(B, TRACK_Z)

    for name, bm in B.items():
        if len(bm.verts):
            ob = new_object(name, bm, [M[name]])
            smooth(ob, 30)
        else:
            bm.free()
    new_object('SignFace', sign, [M['Sign']])


def build_train(B, zc):
    car, gap = 10.6, 0.5
    y0, y1 = DECK_Y + 0.75, DECK_Y + 4.3
    hw = 1.5
    xs = [-(car + gap), 0.0, car + gap]
    for i, xc in enumerate(xs):
        x0, x1 = xc - car / 2, xc + car / 2
        add_box(B['TrainBody'], x0, x1, y0, y1, zc - hw, zc + hw, bevel=0.35, segments=3)
        add_box(B['TrainRoof'], x0 + 0.3, x1 - 0.3, y1 - 0.05, y1 + 0.25, zc - hw + 0.4, zc + hw - 0.4, bevel=0.08)
        add_box(B['Rail'], x0 + 0.8, x1 - 0.8, DECK_Y + 0.15, y0 + 0.1, zc - 1.2, zc + 1.2)  # bogies, skirts
        for s in (-1, 1):
            z = zc + s * (hw + 0.005)
            zz = sorted((z, z - s * 0.04))
            add_box(B['TrainBand'], x0 + 0.2, x1 - 0.2, y0 + 0.95, y0 + 1.55, *zz)
            # Windows between the doors.
            for k in range(4):
                wx = x0 + 0.7 + k * 2.4
                add_box(B['TrainGlass'], wx, wx + 2.0, y0 + 1.75, y0 + 2.95, *zz)
        # The cab ends of the outer cars: a dark raked windscreen.
        if i != 1:
            s = -1 if i == 0 else 1
            xe = xc + s * car / 2
            xx = sorted((xe, xe + s * 0.06))
            add_box(B['TrainGlass'], *xx, y0 + 1.6, y1 - 0.45, zc - hw + 0.3, zc + hw - 0.3)
            add_box(B['TrainBand'], *xx, y0 + 1.05, y0 + 1.45, zc - hw + 0.25, zc + hw - 0.25)


# MARK: The small rail station

SS_X, SS_Z = 7.5, 2.8  # half the platform's length, half the deck's width
SS_DECK = 5.0  # rail level
SS_EAVE = 8.6  # under the canopy


def build_station(work):
    M = {
        'Concrete': material('Concrete', '#CFCFCB', rough=0.8),
        'Cladding': material('Cladding', '#E6E8EA', rough=0.5),
        'RoofMetal': material('RoofMetal', '#F1F2F3', rough=0.4),
        'Structure': material('Structure', '#7E858C', rough=0.5, metal=0.3),
        'Platform': material('Platform', '#C4C7C9', rough=0.7),
        'Trackbed': material('Trackbed', '#8C9096', rough=0.9),
        'Rail': material('Rail', '#4B4E52', rough=0.6),
        'Lamp': material('Lamp', '#D9DCDF', rough=0.3),
        # The line's colour goes here (map-station-band.png); a light neutral
        # under it so the app's tint reads true.
        'Band': material('Band', '#E2E4E6', rough=0.45),
    }
    B = {k: bmesh.new() for k in M}
    # The deck on a row of columns along its front, where the map's view
    # sees them, each with a stripe in the band.
    for x in (-5.5, 0.0, 5.5):
        add_box(B['Concrete'], x - 0.55, x + 0.55, 0, SS_DECK - 0.6, 0.9, 2.0)
        add_box(B['Band'], x - 0.58, x + 0.58, 1.5, 2.5, 0.87, 2.03)
    add_box(B['Concrete'], -SS_X - 1.0, SS_X + 1.0, SS_DECK - 0.6, SS_DECK, -SS_Z, SS_Z, bevel=0.1)
    # The platform along the back, the track along the front.
    add_box(B['Platform'], -SS_X, SS_X, SS_DECK, SS_DECK + 0.95, -SS_Z, 0.0)
    add_box(B['Cladding'], -SS_X, SS_X, SS_DECK + 0.95, SS_DECK + 1.9, -SS_Z, -SS_Z + 0.15)
    add_box(B['Trackbed'], -SS_X - 1.0, SS_X + 1.0, SS_DECK, SS_DECK + 0.25, 0.0, SS_Z - 0.15)
    add_box(B['Cladding'], -SS_X - 1.0, SS_X + 1.0, SS_DECK, SS_DECK + 0.7, SS_Z - 0.15, SS_Z)
    for r in (0.75, 1.95):
        add_box(B['Rail'], -SS_X - 1.0, SS_X + 1.0, SS_DECK + 0.25, SS_DECK + 0.4, r - 0.08, r + 0.08)
    # The canopy over the platform on a row of posts: a shallow roof, its
    # fascia all round and an edge strip on top, both in the band.
    z0, z1 = -SS_Z - 0.2, 0.2
    for x in (-4.0, 0.0, 4.0):
        add_box(B['Structure'], x - 0.15, x + 0.15, SS_DECK + 0.95, SS_EAVE, -1.65, -1.35)
    add_box(B['RoofMetal'], -5.6, 5.6, SS_EAVE + 0.1, SS_EAVE + 0.45, z0 + 0.5, z1 - 0.5)
    t, edge = 0.16, 0.55
    for xa, xb, za, zb in ((-6.0, 6.0, z1 - t, z1), (-6.0, 6.0, z0, z0 + t),
                           (-6.0, -6.0 + t, z0, z1), (6.0 - t, 6.0, z0, z1)):
        add_box(B['Band'], xa, xb, SS_EAVE - 0.35, SS_EAVE + 0.45, za, zb)
    for xa, xb, za, zb in ((-6.0, 6.0, z1 - edge, z1), (-6.0, 6.0, z0, z0 + edge),
                           (-6.0, -6.0 + edge, z0, z1), (6.0 - edge, 6.0, z0, z1)):
        add_box(B['Band'], xa, xb, SS_EAVE + 0.45, SS_EAVE + 0.5, za, zb)
    add_box(B['RoofMetal'], -5.9, 5.9, SS_EAVE, SS_EAVE + 0.1, z0 + 0.1, z1 - 0.1)
    # A light under the front fascia, low enough to show beneath it.
    add_box(B['Lamp'], -5.0, 5.0, SS_EAVE - 0.95, SS_EAVE - 0.7, z1 - 0.3, z1 - 0.08)
    for name, bm in B.items():
        ob = new_object(name, bm, [M[name]])
        smooth(ob, 30)


# MARK: Export

def export(name, work):
    raw = os.path.join(work, 'raw.usdz')
    opts = dict(filepath=raw, export_materials=True, export_uvmaps=True, export_normals=True,
                generate_preview_surface=True, selected_objects_only=False, export_textures_mode='NEW',
                overwrite_textures=True, relative_paths=True)
    props = bpy.ops.wm.usd_export.get_rna_type().properties.keys()
    for key in ('export_animation', 'export_hair', 'export_lights', 'export_cameras'):
        if key in props:
            opts[key] = False
    if 'root_prim_path' in props:
        opts['root_prim_path'] = '/Model'
    if 'convert_orientation' in props:
        opts['convert_orientation'] = False
    if 'convert_scene_units' in props:
        opts['convert_scene_units'] = 'METERS'
    if 'triangulate_meshes' in props:
        opts['triangulate_meshes'] = True
    opts = {k: v for k, v in opts.items() if k in props}
    bpy.ops.wm.usd_export(**opts)

    unpacked = os.path.join(work, 'unpacked')
    with zipfile.ZipFile(raw) as z:
        z.extractall(unpacked)
        names = z.namelist()
    layer = next(n for n in names if n.endswith(('.usdc', '.usda')))
    usda = os.path.join(work, 'model.usda')
    run('usdcat', os.path.join(unpacked, layer), '--out', usda)
    text = open(usda).read()
    text = re.sub(r'upAxis = "\w+"', 'upAxis = "Y"', text)
    if 'metersPerUnit' not in text:
        text = text.replace('upAxis = "Y"', 'metersPerUnit = 1\n    upAxis = "Y"', 1)
    text = re.sub(r'metersPerUnit = [\d.e-]+', 'metersPerUnit = 1', text)
    text = re.sub(r'\n\s*(color3f inputs:specularColor)[^\n]*', '', text)
    text = text.replace('token inputs:varname = "st"', 'string inputs:varname = "st"')
    open(usda, 'w').write(text)
    usdc = os.path.join(unpacked, f'{name}.usdc')
    run('usdcat', usda, '--out', usdc)
    textures = [n for n in names if not n.endswith(('.usdc', '.usda'))]
    out = os.path.join(work, f'{name}.usdz')
    run('usdzip', out, f'{name}.usdc', *textures, cwd=unpacked)
    return out


# MARK: Shadow and light textures


def save_png(rgba, path):
    """rgba: (h, w, 4) floats 0..1, row 0 at the top."""
    h, w, _ = rgba.shape
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(np.ascontiguousarray(rgba[::-1], np.float32).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def load_png(path):
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'Non-Color'
    w, h = img.size
    rgba = np.array(img.pixels[:], np.float32).reshape(h, w, 4)[::-1].copy()
    bpy.data.images.remove(img)
    return rgba


def triangles():
    """Every mesh triangle in the scene, (n, 3, 3), in model coordinates."""
    out = []
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH':
            continue
        me = ob.data
        me.calc_loop_triangles()
        co = np.array([ob.matrix_world @ v.co for v in me.vertices])
        idx = np.array([t.vertices[:] for t in me.loop_triangles])
        out.append(co[idx])
    return np.concatenate(out)


def raster(tris, x0, z0, res, w, h):
    """Fills the triangles' (x, z) footprints into an h × w grid."""
    grid = np.zeros((h, w), bool)
    P = (tris - (x0, z0)) / res
    for t in P:
        lo = np.maximum(np.floor(t.min(0)).astype(int), 0)
        hi = np.minimum(np.ceil(t.max(0)).astype(int), (w, h))
        if hi[0] <= lo[0] or hi[1] <= lo[1]:
            continue
        ys, xs = np.mgrid[lo[1]:hi[1], lo[0]:hi[0]] + 0.5
        (ax, ay), (bx, by), (cx, cy) = t
        e0 = (bx - ax) * (ys - ay) - (by - ay) * (xs - ax)
        e1 = (cx - bx) * (ys - by) - (cy - by) * (xs - bx)
        e2 = (ax - cx) * (ys - cy) - (ay - cy) * (xs - cx)
        grid[lo[1]:hi[1], lo[0]:hi[0]] |= ((e0 >= 0) & (e1 >= 0) & (e2 >= 0)) | ((e0 <= 0) & (e1 <= 0) & (e2 <= 0))
    return grid.astype(np.float32)


def blur(a, sigma):
    h, w = a.shape
    ky = np.fft.fftfreq(h)[:, None]
    kx = np.fft.rfftfreq(w)[None, :]
    g = np.exp(-2 * (math.pi * sigma) ** 2 * (kx ** 2 + ky ** 2))
    return np.fft.irfft2(np.fft.rfft2(a) * g, s=a.shape)


class Ground:
    """A rectangle of the ground in model coordinates, x0..x1 by z0..z1,
    sampled every `res` metres; row 0 at z0 (the back)."""

    def __init__(self, x0, x1, z0, z1, res):
        self.x0, self.x1, self.z0, self.z1, self.res = x0, x1, z0, z1, res
        self.w, self.h = int(round((x1 - x0) / res)), int(round((z1 - z0) / res))

    def grid(self):
        x = self.x0 + (np.arange(self.w) + 0.5) * self.res
        z = self.z0 + (np.arange(self.h) + 0.5) * self.res
        return np.meshgrid(x, z)

    def quad(self, name, look, y=0.01):
        x0, x1, z0, z1 = self.x0, self.x1, self.z0, self.z1
        return f'''
        def Mesh "{name}" (
            prepend apiSchemas = ["MaterialBindingAPI"]
        )
        {{
            int[] faceVertexCounts = [4]
            int[] faceVertexIndices = [0, 1, 2, 3]
            point3f[] points = [({x0:g}, {y:g}, {z1:g}), ({x1:g}, {y:g}, {z1:g}), ({x1:g}, {y:g}, {z0:g}), ({x0:g}, {y:g}, {z0:g})]
            normal3f[] normals = [(0, 1, 0), (0, 1, 0), (0, 1, 0), (0, 1, 0)] (
                interpolation = "vertex"
            )
            texCoord2f[] primvars:st = [(0, 0), (1, 0), (1, 1), (0, 1)] (
                interpolation = "vertex"
            )
            uniform bool doubleSided = 1
            rel material:binding = </World/Looks/{look}>
        }}'''


def shadow_png(path, tris, ground, sun, soft, contact_h, strength, contact):
    """A baked shadow: the model cast along `sun` (a unit vector pointing
    down from the sun), blurred by `soft` metres, plus a tighter contact
    darkening under whatever stands within `contact_h` of the ground."""
    d = np.asarray(sun, float)
    cast = tris[..., [0, 2]] - tris[..., 1:2] / d[1] * d[[0, 2]]
    hard = raster(cast, ground.x0, ground.z0, ground.res, ground.w, ground.h)
    low = tris[(tris[..., 1] < contact_h).all(1)]
    foot = raster(low[..., [0, 2]], ground.x0, ground.z0, ground.res, ground.w, ground.h)
    a = strength * blur(hard, soft / ground.res)
    b = contact * blur(foot, 0.35 * soft / ground.res)
    alpha = np.clip(1 - (1 - a) * (1 - b), 0, 1)
    rgba = np.zeros((ground.h, ground.w, 4), np.float32)
    rgba[..., 3] = alpha
    save_png(rgba, path)


def pool_png(path, ground, spots):
    """Warm light on the ground: `spots` are (x, z, rx, rz, peak) ellipses."""
    X, Z = ground.grid()
    a = np.zeros_like(X)
    for x, z, rx, rz, peak in spots:
        r2 = ((X - x) / rx) ** 2 + ((Z - z) / rz) ** 2
        a = 1 - (1 - a) * (1 - peak * np.exp(-2.5 * r2))
    rgba = np.ones((ground.h, ground.w, 4), np.float32)
    rgba[..., 3] = a
    save_png(rgba, path)


# MARK: Stages and passes


def look(name, diffuse=(0, 0, 0), emissive=(0, 0, 0), texture=None):
    """A translucent ground look: its opacity from the texture's alpha."""
    p = f'/World/Looks/{name}'
    return f'''
        def Material "{name}"
        {{
            token outputs:surface.connect = <{p}/S.outputs:surface>
            def Shader "S"
            {{
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor = ({diffuse[0]:g}, {diffuse[1]:g}, {diffuse[2]:g})
                color3f inputs:emissiveColor = ({emissive[0]:g}, {emissive[1]:g}, {emissive[2]:g})
                int inputs:useSpecularWorkflow = 1
                color3f inputs:specularColor = (0, 0, 0)
                float inputs:roughness = 1
                float inputs:opacity.connect = <{p}/Tex.outputs:a>
                token outputs:surface
            }}
            def Shader "St"
            {{
                uniform token info:id = "UsdPrimvarReader_float2"
                string inputs:varname = "st"
                float2 outputs:result
            }}
            def Shader "Tex"
            {{
                uniform token info:id = "UsdUVTexture"
                asset inputs:file = @{texture}@
                float2 inputs:st.connect = <{p}/St.outputs:result>
                token inputs:sourceColorSpace = "raw"
                token inputs:wrapS = "clamp"
                token inputs:wrapT = "clamp"
                float outputs:a
            }}
        }}'''


def restyle(usdz, style):
    """`over`s for every material in the model. `style(name)` returns the
    shader inputs to author (['color3f inputs:… = …', …]) and, for a
    material whose colour is an image, a float4 scale for it (or None);
    a constant diffuse colour is handed to it scaled by the tint it asks for."""
    text = subprocess.run(['usdcat', usdz, '--flatten'], capture_output=True, text=True, check=True).stdout
    out = []
    for block in re.split(r'\n\s*def Material "', text)[1:]:
        name = block[:block.index('"')]
        shader = re.search(r'def Shader "(\w+)"[^{]*\{\s*uniform token info:id = "UsdPreviewSurface"', block).group(1)
        value = re.search(r'color3f inputs:diffuseColor = \(([^)]*)\)', block)
        texture = re.search(r'color3f inputs:diffuseColor\.connect = <[^>]*/(\w+)\.outputs:rgb>', block)
        diffuse = [float(v) for v in value.group(1).split(',')] if value else None
        inputs, scale = style(name, diffuse)
        lines = [f'            over "{name}"', '            {', f'                over "{shader}"', '                {']
        lines += [f'                    {i}' for i in inputs]
        lines.append('                }')
        if texture and scale is not None:
            lines += [f'                over "{texture.group(1)}"', '                {',
                      '                    float4 inputs:scale = ({:g}, {:g}, {:g}, 1)'.format(*scale),
                      '                }']
        lines.append('            }')
        out.append('\n'.join(lines))
    return '        over "_materials"\n        {\n' + '\n'.join(out) + '\n        }'


def color(name, c):
    return f'color3f inputs:{name} = ({c[0]:.5f}, {c[1]:.5f}, {c[2]:.5f})'


def night_style(glow, lamplit=()):
    """Moonlit everywhere; `glow` maps material names to their emissive
    colour; `lamplit` materials take the warm tint of the landmark's lamps."""
    def style(name, diffuse):
        tint = LAMPLIT_TINT if name in lamplit else NIGHT_TINT
        inputs = ['float inputs:clearcoat = 0.1']
        if name in glow:
            e = glow[name]
            inputs.append(color('emissiveColor', e))
            if diffuse is not None:
                inputs.append(color('diffuseColor', [c * 0.2 for c in e]))
            return inputs, (0.5, 0.5, 0.5)
        if diffuse is not None:
            inputs.append(color('diffuseColor', [c * t for c, t in zip(diffuse, tint)]))
        return inputs, tint
    return style


def mask_style(band):
    """Everything black and unlit except the band, flat white."""
    def style(name, diffuse):
        inputs = [color('diffuseColor', (0, 0, 0)), 'int inputs:useSpecularWorkflow = 1',
                  color('specularColor', (0, 0, 0)), 'float inputs:clearcoat = 0',
                  color('emissiveColor', (1, 1, 1) if name == band else (0, 0, 0))]
        return inputs, (0, 0, 0)
    return style


def stage(usdz, span, materials='', ground='', looks=''):
    d = 400.0
    e = math.radians(ELEVATION)
    # The camera aims at the point straight above the ground point that puts
    # it GROUND_ANCHOR down the image.
    cy = (GROUND_ANCHOR[1] - 0.5) * span / math.cos(e)
    return f'''#usda 1.0
(
    defaultPrim = "World"
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "World"
{{
    def Xform "Turn"
    {{
        float xformOp:rotateY = {LANDMARK_TURN:g}
        uniform token[] xformOpOrder = ["xformOp:rotateY"]

        def "Model" (
            prepend references = @{usdz}@
        )
        {{
{materials}
        }}
{ground}
    }}

    def Scope "Looks"
    {{
{looks}
    }}

    def Camera "Cam"
    {{
        token projection = "orthographic"
        float horizontalAperture = {span * 10:g}
        float verticalAperture = {span * 10:g}
        float2 clippingRange = (1, 2000)
        double3 xformOp:translate = (0, {cy + d * math.sin(e):g}, {d * math.cos(e):g})
        float xformOp:rotateX = {-ELEVATION:g}
        uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateX"]
    }}
}}
'''


def render(stage_text, out, px, work):
    path = os.path.join(work, 'stage.usda')
    big = os.path.join(work, 'big.png')
    open(path, 'w').write(stage_text)
    run('usdrecord', '--camera', '/World/Cam', '--disableCameraLight', '--complexity', 'high',
        '--imageWidth', str(px * SUPERSAMPLE), path, big, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    run('sips', '-Z', str(px), big, '--out', out, stdout=subprocess.DEVNULL)
    edge = load_png(out)[..., 3]
    border = max(edge[0].max(), edge[-1].max(), edge[:, 0].max(), edge[:, -1].max())
    print(f'  {os.path.basename(out)}: {px}x{px}, max alpha on the border {border:.3f}')
    assert border < 0.1, f'{out} is cropped'


def to_mask(path):
    """The band pass's render, white with its brightness as the alpha."""
    rgba = load_png(path)
    lum = rgba[..., :3].max(-1)
    out = np.ones_like(rgba)
    out[..., 3] = np.clip(lum * rgba[..., 3], 0, 1)
    out[..., 3][out[..., 3] < 2 / 255] = 0
    save_png(out, path)


def screen_extent(span):
    """The model's bounds in the image, as fractions (left, top, right, bottom)."""
    t = math.radians(LANDMARK_TURN)
    e = math.radians(ELEVATION)
    cy = (GROUND_ANCHOR[1] - 0.5) * span / math.cos(e)
    p = triangles().reshape(-1, 3)
    x = p[:, 0] * math.cos(t) + p[:, 2] * math.sin(t)
    z = -p[:, 0] * math.sin(t) + p[:, 2] * math.cos(t)
    v = (p[:, 1] - cy) * math.cos(e) - z * math.sin(e)
    return x.min() / span + 0.5, 0.5 - v.max() / span, x.max() / span + 0.5, 0.5 - v.min() / span


def sun_in_model(yaw, elevation):
    """The sunlight's direction (from the sun down to the ground) in the
    model's axes, for a sun `elevation` degrees up behind the camera, its
    light heading `yaw` degrees clockwise from straight away (north)."""
    a, p = math.radians(yaw), math.radians(elevation)
    x, y, z = math.cos(p) * math.sin(a), -math.sin(p), -math.cos(p) * math.cos(a)
    t = math.radians(-LANDMARK_TURN)
    return (x * math.cos(t) + z * math.sin(t), y, -x * math.sin(t) + z * math.cos(t))


# What each landmark is: how to build it, its sprite names and size, the
# frame's span in metres, its shadow, and what glows at night.
LANDMARKS = [
    dict(name='map-shelter', build=lambda work: build_shelter(work), px=108, span=5.6,
         ground=(-2.8, 3.2, -2.4, 2.0), res=0.02, soft=0.16, contact_h=0.6,
         glow={'Lamp': WARM_LIGHT, 'Roof': ROOF_GLOW}, lamplit=('Bench', 'Panel'),
         pool=[(0.0, 0.25, 1.9, 0.95, 0.42), (0.0, 0.55, 1.1, 0.45, 0.3)]),
    dict(name='map-your-stop', build=lambda work: build_shelter(work, figure=True), px=168, span=5.2,
         ground=(-2.8, 3.2, -2.4, 2.0), res=0.02, soft=0.16, contact_h=0.6,
         glow={'Lamp': WARM_LIGHT, 'Roof': ROOF_GLOW}, lamplit=('Bench', 'Panel', 'Shirt', 'Trousers', 'Skin'),
         pool=[(0.0, 0.25, 1.9, 0.95, 0.42), (0.0, 0.55, 1.1, 0.45, 0.3)]),
    dict(name='map-mrt-station', build=build_mrt, px=240, span=57.0,
         ground=(-34, 36, -24, 18), res=0.12, soft=1.4, contact_h=2.0,
         glow={'Lamp': WARM_LIGHT, 'TrainGlass': (1.0, 0.95, 0.8), 'Glazing': (0.72, 0.62, 0.45),
               'Sign': None},
         lamplit=('Platform',),
         pool=[(0.0, 0.0, 15.0, 6.5, 0.32), (12.0, 10.5, 3.6, 2.4, 0.35)]),
    dict(name='map-station', build=build_station, px=96, span=20.0,
         ground=(-13, 14, -9, 6), res=0.05, soft=0.5, contact_h=1.0,
         glow={'Lamp': WARM_LIGHT}, lamplit=('Platform',), band='Band',
         pool=[(0.0, 0.0, 6.5, 2.4, 0.25)]),
]


def build_landmark(spec, out_dir):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    work = tempfile.mkdtemp(prefix='landmark-')
    try:
        spec['build'](work)
        tris = triangles()
        print(f'{spec["name"]}: triangles: {len(tris)}')
        l, t, r, b = screen_extent(spec['span'])
        print(f'  model in the frame: x {l:.3f}..{r:.3f}  y {t:.3f}..{b:.3f}  (ground point at {GROUND_ANCHOR})')
        assert 0.02 < l and r < 0.98 and 0.02 < t and b < 0.98, 'the model does not fit its frame'
        usdz = export(spec['name'], work)

        ground = Ground(*spec['ground'], spec['res'])
        day_shadow = os.path.join(work, 'shadow-day.png')
        night_shadow = os.path.join(work, 'shadow-night.png')
        pool = os.path.join(work, 'pool.png')
        sun = sun_in_model(15, 68)  # shadows fall behind, a little to the right
        shadow_png(day_shadow, tris, ground, sun, spec['soft'], spec['contact_h'], 0.30, 0.30)
        shadow_png(night_shadow, tris, ground, (0, -1, 0), spec['soft'] * 1.6, spec['contact_h'], 0.22, 0.25)
        pool_png(pool, ground, spec['pool'])

        out = os.path.join(out_dir, f'{spec["name"]}.png')
        render(stage(usdz, spec['span'], ground=ground.quad('Shadow', 'Shadow'),
                     looks=look('Shadow', texture=day_shadow)), out, spec['px'], work)

        glow = {k: v for k, v in spec['glow'].items() if v is not None}
        keep = [k for k, v in spec['glow'].items() if v is None]  # lit signs: their day colour

        def night(name, diffuse):
            if name in keep:
                return ['float inputs:clearcoat = 0'], None
            return night_style(glow, spec['lamplit'])(name, diffuse)

        out = os.path.join(out_dir, f'{spec["name"]}-night.png')
        grounds = ground.quad('Shadow', 'Shadow') + ground.quad('Pool', 'Pool', y=0.02)
        looks = look('Shadow', texture=night_shadow) + look('Pool', emissive=WARM_LIGHT, texture=pool)
        render(stage(usdz, spec['span'], materials=restyle(usdz, night), ground=grounds, looks=looks),
               out, spec['px'], work)

        if spec.get('band'):
            out = os.path.join(out_dir, f'{spec["name"]}-band.png')
            render(stage(usdz, spec['span'], materials=restyle(usdz, mask_style(spec['band']))),
                   out, spec['px'], work)
            to_mask(out)
    finally:
        shutil.rmtree(work)


def main(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    only = [a[len('--only='):] for a in sys.argv if a.startswith('--only=')]
    for spec in LANDMARKS:
        if not only or spec['name'] in only:
            build_landmark(spec, out_dir)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    args = [a for a in argv if not a.startswith('--')]
    if len(args) != 1:
        sys.exit(__doc__)
    main(args[0])
