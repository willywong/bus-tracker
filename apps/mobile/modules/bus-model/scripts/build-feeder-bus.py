"""
Builds ios/Assets/RapidBus.usdz from scratch: the Rapid KL MRT feeder bus
(Gemilang-bodied Volvo B7RLE, the kind that runs T816) in its plain livery,
plus the map sprites and the bus pill's icon rendered from it.

Our own work, so it is committed. Measurements come from the CC0 / CC BY-SA
photos and notes in ios/Assets/mrt-feeder-reference/ (gitignored); the
livery leaves out every trademark (MRT and rapidKL logos, slogans, badges).

Usage, from modules/bus-model (macOS; usdcat, usdzip, usdrecord and sips ship
with the OS), then `pod install` and rebuild:
  blender --background --factory-startup --python scripts/build-feeder-bus.py -- ios/Assets

The asset contract, which BusModelView relies on:
  - Y-up, metres, ground at y = 0, centred on x and z, front facing +Z.
  - The front destination sign is a prim named `Headsign`: one quad, UVs 0..1
    left-to-right and bottom-to-top, 9:1 wide.

The geometry is built directly in those axes (Blender's Z is our forward), so
the export needs no axis conversion; the stage's upAxis is set afterwards.
The bus's left (nearside, both doors) is +X, the driver's side is -X.
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

# Body, in metres. d is the distance back from the front face; z = HZ - d.
L, W = 10.55, 2.50
HZ, HW = L / 2, W / 2
SHELL = 0.04  # wall thickness
BODY_Y0, ROOF_Y = 0.25, 3.00
FRONT_R, REAR_R = 0.25, 0.15  # plan radii of the corners
FRONT_AXLE, REAR_AXLE = 2.20, 7.45
WHEEL_R = 0.46
SILL_FRONT, SILL_REAR, GLASS_TOP = 1.20, 1.28, 2.58
FASCIA_TOP = 1.12  # the front leans back above this
RAKE = 0.055  # metres back per metre up


def z_of(d):
    return HZ - d


def rake(y):
    return max(0.0, y - FASCIA_TOP) * RAKE


def front_z(y):
    return HZ - rake(y)


# Openings, (from d, to d), both sides at the sill / glass top heights.
NEAR_WINDOWS = [(1.55, 2.95), (2.95, 4.45), (5.90, 6.90), (6.90, 8.50), (8.50, 10.30)]
OFF_WINDOWS = [(1.55, 3.05), (3.05, 4.50), (4.50, 6.00), (6.00, 7.60), (7.60, 9.00), (9.00, 10.25)]
DRIVER_WINDOW = (0.30, 1.55, 1.00)  # from d, to d, sill
FRONT_DOOR, MIDDLE_DOOR = (0.55, 1.50), (4.50, 5.85)
DOOR_TOP = 2.55
MIDDLE_FLOOR_STEP = 5.90  # floor rises behind the middle door
FLOOR_LOW, FLOOR_HIGH = 0.34, 0.64

# Livery, sRGB, from the reference photos.
GREEN = '#1CB08E'
BLUE = '#0E4FA4'
RED = '#D9443A'
WHITE = '#E9EAEC'
GREY = '#8E8F96'
BLACK = '#0D0D0F'
CHEVRON_RED, CHEVRON_YELLOW = '#C8312B', '#F4B41A'


def srgb(hex_):
    return tuple(int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5))


def linear(hex_):
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb(hex_))


# MARK: Livery atlas
#
# One 2048² texture for the body shell, 150 px per metre. Each region maps a
# face of the bus in metres: the sides by (d, y), the roof by (d, x + HW), the
# front and rear by (x + HW, y). Painted at 2× and halved for clean edges.

PX, SIZE, SS = 150, 2048, 2
REGIONS = {
    'near': (0, 0),
    'off': (0, 480),
    'roof': (0, 960),
    'front': (0, 1360),
    'rear': (400, 1360),
    'bottom': (800, 1360),
}


def uv_of(region, a, b):
    u0, v0 = REGIONS[region]
    return ((u0 + a * PX) / SIZE, (v0 + b * PX) / SIZE)


class Atlas:
    def __init__(self):
        n = SIZE * SS
        self.img = np.zeros((n, n, 3), np.float32)
        self.img[:] = srgb(WHITE)

    def _window(self, region, pts):
        u0, v0 = REGIONS[region]
        P = (np.asarray(pts, float) * PX + (u0, v0)) * SS
        x0, y0 = np.floor(P.min(0)).astype(int)
        x1, y1 = np.ceil(P.max(0)).astype(int)
        n = SIZE * SS
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, n), min(y1, n)
        ys, xs = np.mgrid[y0:y1, x0:x1] + 0.5
        return P, (slice(y0, y1), slice(x0, x1)), xs, ys

    def poly(self, region, pts, color, clip=None):
        """Fills a polygon, optionally only inside the box `clip` (a0, b0, a1, b1)."""
        if clip is not None:
            a0, b0, a1, b1 = clip
            pts = [(min(max(a, a0), a1), min(max(b, b0), b1)) for a, b in pts]
        P, sl, xs, ys = self._window(region, pts)
        inside = np.zeros(xs.shape, bool)
        j = len(P) - 1
        for i in range(len(P)):
            (xi, yi), (xj, yj) = P[i], P[j]
            cross = ((yi > ys) != (yj > ys)) & (xs < (xj - xi) * (ys - yi) / (yj - yi + 1e-12) + xi)
            inside ^= cross
            j = i
        self.img[sl][inside] = srgb(color)

    def rect(self, region, a0, b0, a1, b1, color):
        self.poly(region, [(a0, b0), (a1, b0), (a1, b1), (a0, b1)], color)

    def rrect(self, region, a0, b0, a1, b1, r, color):
        P, sl, xs, ys = self._window(region, [(a0, b0), (a1, b1)])
        (px0, py0), (px1, py1) = P
        rr = r * PX * SS
        cx = np.clip(xs, px0 + rr, px1 - rr)
        cy = np.clip(ys, py0 + rr, py1 - rr)
        inside = (xs - cx) ** 2 + (ys - cy) ** 2 <= rr * rr
        self.img[sl][inside] = srgb(color)

    def circle(self, region, a, b, r, color, inner=0.0):
        P, sl, xs, ys = self._window(region, [(a - r, b - r), (a + r, b + r)])
        c = (np.asarray((a, b)) * PX + REGIONS[region]) * SS
        d2 = (xs - c[0]) ** 2 + (ys - c[1]) ** 2
        inside = (d2 <= (r * PX * SS) ** 2) & (d2 >= (inner * PX * SS) ** 2)
        self.img[sl][inside] = srgb(color)

    def pixels(self):
        n = SIZE
        small = self.img.reshape(n, SS, n, SS, 3).mean((1, 3))
        rgba = np.ones((n, n, 4), np.float32)
        rgba[..., :3] = small
        return rgba  # row 0 at the bottom, as Blender stores images


def paint_side(atlas, side):
    """Both sides, d from the front, y up. `side` is 'near' or 'off'."""
    a = atlas
    a.rect(side, -0.1, 2.88, L + 0.1, 3.2, GREEN)  # roof edge
    a.rect(side, -0.1, 2.58, L + 0.1, 2.88, BLUE)  # cantrail band
    a.rect(side, -0.1, 2.69, L + 0.1, 2.72, RED)  # pinstripe
    a.rect(side, -0.1, SILL_FRONT, L + 0.1, 2.58, BLACK)  # glazing band
    if side == 'off':
        d0, d1, sill = DRIVER_WINDOW
        a.rect(side, d0, sill, d1, SILL_FRONT, BLACK)

    # The grey train along the lower body, its nose cut parallel to the red
    # wedge, white windows and door lines on it.
    red_top, red_bottom = (3.35, SILL_FRONT), ((0.45, 0.30) if side == 'off' else (1.50, 0.30))

    def red_edge_d(y):
        (d0, y0), (d1, y1) = red_top, red_bottom
        return d1 + (y - y1) / (y0 - y1) * (d0 - d1)

    gap = 0.10
    band = [(red_edge_d(0.55) + gap, 0.55), (10.25, 0.55), (10.25, 0.80), (red_edge_d(0.80) + gap, 0.80)]
    a.poly(side, band, GREY)
    start = red_edge_d(0.80) + gap + 0.15
    d = start
    k = 0
    while d + 0.18 < 10.15:
        if k % 7 == 6:
            a.rect(side, d + 0.04, 0.57, d + 0.07, 0.78, WHITE)  # door line
            a.rect(side, d + 0.11, 0.57, d + 0.14, 0.78, WHITE)
        else:
            a.rrect(side, d, 0.615, d + 0.18, 0.735, 0.03, WHITE)
        d += 0.30
        k += 1

    # The front wedge: red, a white pinstripe, blue to the front corner.
    if side == 'off':
        a.poly(side, [red_top, (1.60, SILL_FRONT), (0.40, 0.25), (0.45, 0.25), red_bottom], RED)
        a.poly(side, [(1.60, SILL_FRONT), (-0.1, SILL_FRONT), (-0.1, 0.25), (0.40, 0.25)], WHITE)
        a.poly(side, [(1.565, SILL_FRONT), (-0.1, SILL_FRONT), (-0.1, 0.25), (0.365, 0.25)], BLUE)
        a.rect(side, -0.1, 0.25, 0.30, 2.60, BLUE)  # corner pillar ahead of the driver
    else:
        a.poly(side, [red_top, (1.50, SILL_FRONT), (1.50, 0.25)], RED)
        a.rect(side, 1.45, 0.25, 1.56, SILL_FRONT, RED)
        a.rect(side, -0.1, 0.25, 0.55, 2.60, BLUE)  # corner ahead of the front door

    # The rear corner: the rear's white / red bands wrap round.
    a.rect(side, 10.27, 1.93, L + 0.1, 2.88, BLUE)
    a.rect(side, 10.27, 1.73, L + 0.1, 1.93, WHITE)
    a.rect(side, 10.27, 1.66, L + 0.1, 1.73, RED)
    a.rect(side, 10.27, 0.2, L + 0.1, 1.66, WHITE)

    # Engine air: slats at the nearside rear, a small intake high on the offside.
    if side == 'near':
        for i in range(9):
            x = 9.42 + i * 0.066
            a.rect(side, x, 0.40, x + 0.035, 0.95, BLACK)
    else:
        a.rect(side, 10.30, 2.05, 10.45, 2.50, BLACK)

    # A dark lip round each wheel arch.
    for axle in (FRONT_AXLE, REAR_AXLE):
        a.circle(side, axle, WHEEL_R, 0.60, '#1A1B1E', inner=0.55)


def paint_front(a):
    r = 'front'
    a.rect(r, -0.1, 0.2, W + 0.1, 3.2, BLUE)
    a.rect(r, -0.1, 2.88, W + 0.1, 3.2, GREEN)
    a.rect(r, -0.1, FASCIA_TOP, W + 0.1, 2.88, BLACK)  # windscreen, pillars, headsign band
    # Wheelchair pictogram at the nearside (+X) end of the sign.
    x0, y0 = HW + 0.88, 2.61
    a.rect(r, x0, y0, x0 + 0.22, y0 + 0.22, BLUE)
    a.circle(r, x0 + 0.12, y0 + 0.17, 0.018, WHITE)
    a.poly(r, [(x0 + 0.10, y0 + 0.07), (x0 + 0.13, y0 + 0.07), (x0 + 0.13, y0 + 0.15), (x0 + 0.10, y0 + 0.15)], WHITE)
    a.circle(r, x0 + 0.10, y0 + 0.07, 0.05, WHITE, inner=0.035)

    # Fascia: a white inverted trapezoid edged in red, blue outside it.
    def trapezoid(grow):
        k = grow / math.sin(math.radians(55))
        return [(-0.1, FASCIA_TOP), (W + 0.1, FASCIA_TOP), (HW + 0.6 + k, 0.2), (HW - 0.6 - k, 0.2)]

    def wedge(grow):
        k = grow / math.sin(math.radians(55))
        return [(0.0 - k, FASCIA_TOP), (W + k, FASCIA_TOP), (HW + 0.6 + k, 0.2), (HW - 0.6 - k, 0.2)]

    a.poly(r, wedge(0.09), WHITE)
    a.poly(r, wedge(0.07), RED)
    a.poly(r, wedge(0.0), WHITE)
    a.rect(r, -0.1, 0.2, W + 0.1, 0.25, '#1A1B1E')
    a.rrect(r, HW - 0.26, 0.345, HW + 0.26, 0.455, 0.01, BLACK)  # plate, left blank


def paint_rear(a):
    r = 'rear'
    a.rect(r, -0.1, 2.88, W + 0.1, 3.2, GREEN)
    a.rect(r, -0.1, 1.93, W + 0.1, 2.88, BLUE)
    a.rect(r, HW - 1.10, 2.06, HW + 1.10, 2.86, BLACK)  # round the rear window
    a.rect(r, -0.1, 1.66, W + 0.1, 1.73, RED)
    # Engine cover and bumper seams.
    for (x0, y0, x1, y1) in [(HW - 1.06, 0.42, HW + 1.06, 1.665)]:
        a.rrect(r, x0, y0, x1, y1, 0.10, '#B9BBC0')
        a.rrect(r, x0 + 0.012, y0 + 0.012, x1 - 0.012, y1 - 0.012, 0.09, WHITE)
    a.rect(r, -0.1, 0.60, W + 0.1, 0.612, '#B9BBC0')
    # Hazard chevrons on both bumper corners.
    for x0, x1, lean in ((0.0, 0.45, 1), (W - 0.45, W, -1)):
        a.rect(r, x0, 0.30, x1, 0.45, CHEVRON_YELLOW)
        for i in range(-2, 6):
            s = x0 + i * 0.14
            a.poly(r, [(s, 0.30), (s + 0.07, 0.30), (s + 0.07 + lean * 0.15, 0.45), (s + lean * 0.15, 0.45)],
                   CHEVRON_RED, clip=(x0, 0.30, x1, 0.45))
    a.rect(r, -0.1, 0.20, W + 0.1, 0.30, '#1A1B1E')
    a.rrect(r, HW + 0.15 - 0.26, 0.49, HW + 0.15 + 0.26, 0.60, 0.01, BLACK)  # plate, left blank


def paint_roof(a):
    r = 'roof'
    a.rect(r, -0.1, -0.1, L + 0.1, W + 0.1, WHITE)
    a.rect(r, -0.1, -0.1, L + 0.1, 0.06, GREEN)
    a.rect(r, -0.1, W - 0.06, L + 0.1, W + 0.1, GREEN)
    a.rect(r, -0.1, -0.1, 0.70, W + 0.1, GREEN)
    a.rect(r, L - 0.1, -0.1, L + 0.1, W + 0.1, GREEN)
    # Long red and blue diagonal stripes over the rear half.
    for color, off in ((RED, 0.0), (BLUE, 0.16)):
        a.poly(r, [(5.6, 0.55 + off), (10.35, 1.80 + off), (10.35, 1.92 + off), (5.6, 0.67 + off)], color)


def paint_atlas():
    a = Atlas()
    paint_side(a, 'near')
    paint_side(a, 'off')
    paint_front(a)
    paint_rear(a)
    paint_roof(a)
    a.rect('bottom', 0, 0, 2.6, 0.6, '#141416')
    return a.pixels()


# MARK: Materials


def material(name, color=None, rough=0.5, metal=0.0, coat=0.0, alpha=1.0, emit=None, emit_strength=1.0, image=None):
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
    if alpha < 1:
        bsdf.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else None
    if emit is not None:
        bsdf.inputs['Emission Color'].default_value = (*linear(emit), 1)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    return m


def make_materials(livery_image):
    M = {}
    M['Paint'] = material('Paint', image=livery_image, rough=0.32, coat=1.0)
    M['Green'] = material('Green', GREEN, rough=0.32, coat=1.0)
    M['Roof'] = material('Roof', WHITE, rough=0.4, coat=0.5)
    M['AC'] = material('AC', '#E4E5E2', rough=0.55)
    M['Trim'] = material('Trim', BLACK, rough=0.55)
    M['Rubber'] = material('Rubber', '#1A1B1E', rough=0.8)
    M['Glass'] = material('Glass', '#141B2A', rough=0.04, coat=1.0, alpha=0.55)
    M['Windscreen'] = material('Windscreen', '#1E2A2A', rough=0.03, coat=1.0, alpha=0.35)
    M['Chrome'] = material('Chrome', '#D8DADD', rough=0.15, metal=1.0)
    M['Tyre'] = material('Tyre', '#1C1D1F', rough=0.92)
    M['Hub'] = material('Hub', '#8C8F94', rough=0.32, metal=0.9)
    M['Lamp'] = material('Lamp', '#E8ECEF', rough=0.08, emit='#FFF6E8', emit_strength=0.04)
    M['Amber'] = material('Amber', '#E8A33A', rough=0.2, emit='#FF9A1E', emit_strength=0.3)
    M['Interior'] = material('Interior', '#D3D5D8', rough=0.7)
    M['Floor'] = material('Floor', '#3A3D42', rough=0.85)
    M['Seat'] = material('Seat', '#8A9096', rough=0.6)
    M['Cushion'] = material('Cushion', '#2A64C8', rough=0.8)
    M['Sign'] = material('Sign', '#08080A', rough=0.6, emit='#08080A')
    M['LED'] = material('LED', '#0A0A0C', rough=0.3, emit='#3A0A06', emit_strength=0.5)
    return M


# MARK: Geometry helpers


def new_object(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for m in mats if isinstance(mats, list) else [mats]:
        me.materials.append(m)
    return ob


def add_box(bm, x0, x1, y0, y1, z0, z1, bevel=0.0, segments=2, mat=0):
    res = bmesh.ops.create_cube(bm, size=1.0)
    verts = res['verts']
    for v in verts:
        v.co = Vector((
            x0 if v.co.x < 0 else x1,
            y0 if v.co.y < 0 else y1,
            z0 if v.co.z < 0 else z1,
        ))
    faces = list({f for v in verts for f in v.link_faces})
    if bevel > 0:
        edges = list({e for v in verts for e in v.link_edges})
        out = bmesh.ops.bevel(bm, geom=verts + edges, offset=bevel, segments=segments,
                              profile=0.5, affect='EDGES', clamp_overlap=True)
        faces = list(set(faces) | set(out['faces']))
    for f in faces:
        if f.is_valid:
            f.material_index = mat
    return verts


def add_cylinder(bm, center, axis, r, depth, segs=32, mat=0, cap_ends=True):
    res = bmesh.ops.create_cone(bm, cap_ends=cap_ends, segments=segs, radius1=r, radius2=r, depth=depth)
    rot = Vector((0, 0, 1)).rotation_difference(Vector(axis).normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation(center) @ rot, verts=res['verts'])
    for f in {f for v in res['verts'] for f in v.link_faces}:
        f.material_index = mat
    return res['verts']


def add_quad(bm, corners, mat=0):
    verts = [bm.verts.new(c) for c in corners]
    f = bm.faces.new(verts)
    f.material_index = mat
    return f


def prism(bm, profile_zy, x0, x1, mat=0):
    """Extrudes a (z, y) outline across x0..x1."""
    a = [bm.verts.new((x0, y, z)) for z, y in profile_zy]
    b = [bm.verts.new((x1, y, z)) for z, y in profile_zy]
    n = len(a)
    faces = [bm.faces.new(list(reversed(a))), bm.faces.new(b)]
    for i in range(n):
        j = (i + 1) % n
        faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    for f in faces:
        f.material_index = mat
    bmesh.ops.recalc_face_normals(bm, faces=faces)


def plan(inset, segs=6):
    """The body's plan outline (x, z), inset all round, counter-clockwise from above."""
    pts = []
    corners = [
        (HW - FRONT_R, HZ - FRONT_R, FRONT_R, 0),  # front left (+X)
        (-(HW - FRONT_R), HZ - FRONT_R, FRONT_R, 90),  # front right
        (-(HW - REAR_R), -(HZ - REAR_R), REAR_R, 180),
        (HW - REAR_R, -(HZ - REAR_R), REAR_R, 270),
    ]
    for cx, cz, r, start in corners:
        rr = max(r - inset, 0.01)
        for i in range(segs + 1):
            t = math.radians(start + 90 * i / segs)
            pts.append((cx + rr * math.cos(t), cz + rr * math.sin(t)))
    return pts


def solid(inset, y0, y1, fillet_top, fillet_bottom, steps=4):
    """A rounded-rectangle prism with filleted top and bottom edges."""
    bm = bmesh.new()
    rings = []
    for i in range(steps + 1):  # bottom fillet, upward
        t = math.pi / 2 * i / steps
        rings.append((y0 + fillet_bottom * (1 - math.sin(math.pi / 2 - t)), fillet_bottom * (1 - math.sin(t)) if fillet_bottom else 0))
    for i in range(steps + 1):  # top fillet, upward
        t = math.pi / 2 * i / steps
        rings.append((y1 - fillet_top + fillet_top * math.sin(t), fillet_top * (1 - math.cos(t))))
    loops = []
    last = None
    for y, extra in rings:
        if last is not None and abs(y - last) < 1e-6:
            continue
        last = y
        loop = [bm.verts.new((x, y, z)) for x, z in plan(inset + extra)]
        loops.append(loop)
    for v in (v for loop in loops for v in loop):
        if v.co.z > HZ - FRONT_R - 0.01:
            v.co.z -= rake(v.co.y)
    n = len(loops[0])
    bm.faces.new(list(reversed(loops[0])))
    bm.faces.new(loops[-1])
    for a, b in zip(loops, loops[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def map_body_uvs(bm):
    """Projects each face of the outer shell into its atlas region."""
    uv = bm.loops.layers.uv.new('UVMap')
    bm.normal_update()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        if ax == 0:
            region = 'near' if n.x > 0 else 'off'
            fn = lambda co: uv_of(region, HZ - co.z, co.y)
        elif ax == 1:
            if n.y > 0:
                fn = lambda co: uv_of('roof', HZ - co.z, co.x + HW)
            else:
                fn = lambda co: uv_of('bottom', 0.1, 0.1)
        else:
            region = 'front' if n.z > 0 else 'rear'
            fn = lambda co: uv_of(region, co.x + HW, co.y)
        for loop in f.loops:
            loop[uv].uv = fn(loop.vert.co)


def apply_boolean(target, cutter, operation='DIFFERENCE'):
    mod = target.modifiers.new('bool', 'BOOLEAN')
    mod.operation = operation
    mod.solver = 'EXACT'
    mod.object = cutter
    if hasattr(mod, 'material_mode'):
        mod.material_mode = 'TRANSFER'
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def cutter(name, build, mat):
    bm = bmesh.new()
    build(bm)
    ob = new_object(name, bm, mat)
    ob.hide_render = True
    return ob


# MARK: The bus


def build_body(M):
    bm = solid(0.0, BODY_Y0, ROOF_Y, 0.12, 0.03)
    map_body_uvs(bm)
    body = new_object('Body', bm, [M['Paint']])

    inner = cutter('inner', lambda bm: bm.from_mesh(_mesh_of(solid(SHELL, BODY_Y0 + 0.05, ROOF_Y - SHELL, 0.08, 0.0))), M['Interior'])
    apply_boolean(body, inner)

    def side_box(bm, side, d0, d1, y0, y1):
        x0, x1 = (HW - 0.2, HW + 0.2) if side > 0 else (-HW - 0.2, -HW + 0.2)
        add_box(bm, x0, x1, y0, y1, z_of(d1), z_of(d0))

    def openings(bm):
        for d0, d1 in NEAR_WINDOWS:
            sill = SILL_FRONT if d1 < MIDDLE_FLOOR_STEP else SILL_REAR
            side_box(bm, 1, d0 + 0.035, d1 - 0.035, sill + 0.03, GLASS_TOP - 0.03)
        for d0, d1 in OFF_WINDOWS:
            sill = SILL_FRONT if d1 < MIDDLE_FLOOR_STEP + 0.2 else SILL_REAR
            side_box(bm, -1, d0 + 0.035, d1 - 0.035, sill + 0.03, GLASS_TOP - 0.03)
        d0, d1, sill = DRIVER_WINDOW
        side_box(bm, -1, d0 + 0.05, d1 - 0.035, sill + 0.03, GLASS_TOP - 0.03)
        for d0, d1 in (FRONT_DOOR, MIDDLE_DOOR):
            side_box(bm, 1, d0, d1, BODY_Y0 - 0.1, DOOR_TOP)
        # Windscreen and rear window.
        add_box(bm, -HW + 0.09, HW - 0.09, 1.16, 2.47, HZ - 0.35, HZ + 0.3)
        add_box(bm, -1.06, 1.06, 2.10, 2.82, -HZ - 0.3, -HZ + 0.3)

    apply_boolean(body, cutter('openings', openings, M['Trim']))

    def arches(bm):
        for axle, inner_x in ((FRONT_AXLE, 0.84), (REAR_AXLE, 0.60)):
            zc = z_of(axle)
            r = 0.56
            arc = [(zc + r * math.cos(math.pi * i / 16), WHEEL_R + r * math.sin(math.pi * i / 16)) for i in range(17)]
            outline = arc + [(zc - r, -0.3), (zc + r, -0.3)]
            for side in (1, -1):
                prism(bm, outline, side * inner_x, side * (HW + 0.3))

    apply_boolean(body, cutter('arches', arches, M['Rubber']))
    return body


def _mesh_of(bm):
    me = bpy.data.meshes.new('tmp')
    bm.to_mesh(me)
    bm.free()
    return me


def build_wheel_wells(M):
    bm = bmesh.new()
    for axle, inner_x in ((FRONT_AXLE, 0.80), (REAR_AXLE, 0.56)):
        zc = z_of(axle)
        for s in (1, -1):
            xa, xb = sorted((s * inner_x, s * (inner_x + 0.04)))
            add_box(bm, xa, xb, BODY_Y0, 1.08, zc - 0.64, zc + 0.64)
            xa, xb = sorted((s * inner_x, s * (HW - SHELL)))
            add_box(bm, xa, xb, 1.04, 1.08, zc - 0.64, zc + 0.64)
            for zz in (zc - 0.64, zc + 0.60):
                add_box(bm, xa, xb, BODY_Y0, 1.08, zz, zz + 0.04)
    return new_object('WheelWells', bm, [M['Rubber']])


def build_glass(M):
    bm = bmesh.new()
    x = HW - 0.012

    def pane(side, d0, d1, y0, y1):
        xx = side * x
        corners = [(xx, y0, z_of(d0)), (xx, y0, z_of(d1)), (xx, y1, z_of(d1)), (xx, y1, z_of(d0))]
        f = add_quad(bm, corners if side < 0 else list(reversed(corners)))
        return f

    for d0, d1 in NEAR_WINDOWS:
        sill = SILL_FRONT if d1 < MIDDLE_FLOOR_STEP else SILL_REAR
        pane(1, d0 + 0.03, d1 - 0.03, sill + 0.02, GLASS_TOP - 0.02)
    for d0, d1 in OFF_WINDOWS:
        sill = SILL_FRONT if d1 < MIDDLE_FLOOR_STEP + 0.2 else SILL_REAR
        pane(-1, d0 + 0.03, d1 - 0.03, sill + 0.02, GLASS_TOP - 0.02)
    d0, d1, sill = DRIVER_WINDOW
    pane(-1, d0 + 0.04, d1 - 0.03, sill + 0.02, GLASS_TOP - 0.02)
    # Rear window.
    zr = -HZ + 0.012
    add_quad(bm, [(1.07, 2.09, zr), (-1.07, 2.09, zr), (-1.07, 2.83, zr), (1.07, 2.83, zr)])
    side_glass = new_object('Glass', bm, [M['Glass']])

    bm = bmesh.new()
    for x0, x1 in ((-HW + 0.08, -0.025), (0.025, HW - 0.08)):
        y0, y1 = 1.15, 2.48
        z0, z1 = front_z(y0) - 0.015, front_z(y1) - 0.015
        add_quad(bm, [(x0, y0, z0), (x1, y0, z0), (x1, y1, z1), (x0, y1, z1)])
    windscreen = new_object('Windscreen', bm, [M['Windscreen']])
    return side_glass, windscreen


def build_doors(M):
    """Glazed leaves with black frames, closed, just inside the skin."""
    frames, panes = bmesh.new(), bmesh.new()
    x = HW - 0.03
    for (d0, d1), leaves in ((FRONT_DOOR, 2), (MIDDLE_DOOR, 2)):
        w = (d1 - d0) / leaves
        for k in range(leaves):
            a, b = d0 + k * w, d0 + (k + 1) * w
            za, zb = z_of(b), z_of(a)
            y0, y1 = BODY_Y0 + 0.08, DOOR_TOP - 0.02
            t = 0.05
            for (p, q, r_, s) in [(za, zb, y0, y0 + 0.30), (za, zb, y1 - t, y1), (za, za + t, y0, y1), (zb - t, zb, y0, y1)]:
                add_box(frames, x - 0.03, x, r_, s, p, q)
            add_quad(panes, [(x - 0.01, y0 + 0.30, za + t), (x - 0.01, y0 + 0.30, zb - t),
                             (x - 0.01, y1 - t, zb - t), (x - 0.01, y1 - t, za + t)])
    new_object('DoorFrames', frames, [M['Trim']])
    ob = new_object('DoorGlass', panes, [M['Glass']])
    for p in ob.data.polygons:
        if p.normal.x < 0:
            p.flip()
    # Mullion down the middle of the windscreen.
    bm = bmesh.new()
    add_box(bm, -0.025, 0.025, 1.15, 2.48, front_z(1.8) - 0.03, front_z(1.8) + 0.002)
    new_object('Mullion', bm, [M['Trim']])


def build_roof(M):
    bm = bmesh.new()
    zf = front_z(3.0)
    add_box(bm, -HW, HW, 2.88, 3.10, z_of(0.65), zf + 0.03, bevel=0.09, segments=3)
    for s in (1, -1):
        xa, xb = sorted((s * (HW - 0.13), s * (HW - 0.01)))
        add_box(bm, xa, xb, 2.96, 3.15, z_of(6.6), z_of(0.5), bevel=0.05, segments=2)
    new_object('FrontCapRails', bm, [M['Green']])

    bm = bmesh.new()
    add_box(bm, -0.9, 0.9, 3.0, 3.10, z_of(0.80), zf - 0.12)  # slot below the cap's crown
    add_box(bm, -0.9, 0.9, 3.095, 3.105, z_of(0.40), z_of(0.30))
    new_object('CapSlot', bm, [M['Trim']])

    bm = bmesh.new()
    add_box(bm, -0.9, 0.9, 2.98, 3.22, z_of(4.7), z_of(1.3), bevel=0.07, segments=3)
    new_object('ACPod', bm, [M['AC']])

    bm = bmesh.new()
    for x, d in ((0.35, 1.75), (-0.35, 1.75), (0.0, 1.50)):
        add_cylinder(bm, Vector((x, 3.222, z_of(d))), (0, 1, 0), 0.16, 0.012, segs=24)
    for s in (1, -1):
        for i in range(6):
            zz = z_of(1.55) - i * 0.07
            xa, xb = sorted((s * 0.62, s * 0.84))
            add_box(bm, xa, xb, 3.20, 3.225, zz - 0.025, zz)
    new_object('ACGrilles', bm, [M['Trim']])


def build_front_details(M):
    lamps, trim, chrome, sign, amber = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()
    zf = HZ
    for s in (1, -1):
        # Two round headlamps and a column of LED dots on each blue corner.
        for y, r in ((0.85, 0.055), (0.65, 0.042)):
            add_cylinder(lamps, Vector((s * 1.00, y, zf - 0.005)), (0, 0, 1), r, 0.03)
            add_cylinder(chrome, Vector((s * 1.00, y, zf - 0.012)), (0, 0, 1), r + 0.012, 0.03)
        for i in range(9):
            t = i / 8
            y = 0.76 - 0.36 * t
            x = s * (1.16 - 0.05 * math.sin(t * math.pi))
            add_cylinder(amber, Vector((x, y, zf - 0.03 + 0.03 * (1 - abs(x) / HW) * 0)), (0, 0, 1), 0.0125, 0.03, segs=10)
        # Hanging mirrors on arms from the roof corners.
        reach = 1.40
        fwd = 0.22
        arm_a = Vector((s * 1.12, 2.86, front_z(2.86) - 0.06))
        arm_b = Vector((s * reach, 2.80, zf + fwd))
        mid = (arm_a + arm_b) / 2
        add_cylinder(trim, mid, arm_b - arm_a, 0.018, (arm_b - arm_a).length, segs=10)
        add_cylinder(trim, Vector((s * reach, 2.60, zf + fwd)), (0, 1, 0), 0.018, 0.42, segs=10)
        add_box(trim, s * reach - 0.11, s * reach + 0.11, 2.00, 2.40, zf + fwd - 0.03, zf + fwd + 0.03, bevel=0.015)
        # Wipers, parked near vertical.
        base = Vector((s * 0.38, 1.18, front_z(1.18) + 0.01))
        tip = Vector((s * 0.30, 1.95, front_z(1.95) + 0.01))
        add_cylinder(trim, (base + tip) / 2, tip - base, 0.012, (tip - base).length, segs=8)
    new_object('Headlamps', lamps, [M['Lamp']])
    new_object('LampRings', chrome, [M['Chrome']])
    new_object('MirrorsWipers', trim, [M['Trim']])
    new_object('LEDDots', amber, [M['Amber']])

    # The destination sign: one quad, 9:1, u left to right as seen from the
    # front (toward +X), v bottom to top, facing +Z along the raked face.
    x0, x1 = -1.02, 0.78
    y0, y1 = 2.62, 2.82
    z0, z1 = front_z(y0) + 0.012, front_z(y1) + 0.012
    f = add_quad(sign, [(x0, y0, z0), (x1, y0, z0), (x1, y1, z1), (x0, y1, z1)])
    uv = sign.loops.layers.uv.new('UVMap')
    for loop, coords in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = coords
    new_object('Headsign', sign, [M['Sign']])


def build_rear_details(M):
    lamps, chrome, led = bmesh.new(), bmesh.new(), bmesh.new()
    zr = -HZ
    for s in (1, -1):
        for y in (1.23, 0.98, 0.70):
            add_cylinder(lamps, Vector((s * 1.08, y, zr - 0.01)), (0, 0, -1), 0.062, 0.03)
            add_cylinder(chrome, Vector((s * 1.08, y, zr - 0.004)), (0, 0, -1), 0.075, 0.02)
        add_cylinder(lamps, Vector((s * 0.95, 2.75, zr + 0.02)), (0, 0, -1), 0.04, 0.02)  # high-level lamps
    add_cylinder(lamps, Vector((-0.95, 0.38, zr - 0.006)), (0, 0, -1), 0.035, 0.02)  # fog lamp
    add_quad(led, [(0.225, 2.58, zr + 0.03), (-0.225, 2.58, zr + 0.03), (-0.225, 2.80, zr + 0.03), (0.225, 2.80, zr + 0.03)])
    # The small route LED behind the nearside window by the front door.
    xs = HW - 0.03
    add_quad(led, [(xs, 2.42, z_of(1.62)), (xs, 2.42, z_of(2.17)), (xs, 2.54, z_of(2.17)), (xs, 2.54, z_of(1.62))])
    new_object('RearLamps', lamps, [M['Lamp']])
    new_object('RearLampRings', chrome, [M['Chrome']])
    new_object('RouteLEDs', led, [M['LED']])
    # Amber side markers along both skirts.
    bm = bmesh.new()
    for s in (1, -1):
        for d in (1.0, 3.0, 4.2, 6.2, 8.6, 9.9):
            if s > 0 and (FRONT_DOOR[0] < d < FRONT_DOOR[1] or MIDDLE_DOOR[0] < d < MIDDLE_DOOR[1]):
                continue
            xa, xb = sorted((s * HW, s * (HW + 0.012)))
            add_box(bm, xa, xb, 0.34, 0.37, z_of(d) - 0.035, z_of(d) + 0.035)
    new_object('SideMarkers', bm, [M['Amber']])


def build_wheels(M):
    tyres, hubs = bmesh.new(), bmesh.new()
    for axle, xc, width, dual in ((FRONT_AXLE, 1.025, 0.28, False), (REAR_AXLE, 0.925, 0.60, True)):
        zc = z_of(axle)
        for s in (1, -1):
            if dual:
                for off in (-0.155, 0.155):
                    add_box_tyre(tyres, s * (xc + off), zc, 0.28)
                face = s * (xc + 0.30 - 0.04)
                add_cylinder(hubs, Vector((face, WHEEL_R, zc)), (s, 0, 0), 0.30, 0.02, segs=32)
                add_cylinder(hubs, Vector((face + s * 0.02, WHEEL_R, zc)), (s, 0, 0), 0.11, 0.05, segs=20)
            else:
                add_box_tyre(tyres, s * xc, zc, width)
                face = s * (xc + width / 2)
                add_cylinder(hubs, Vector((face, WHEEL_R, zc)), (s, 0, 0), 0.30, 0.02, segs=32)
                add_cylinder(hubs, Vector((face + s * 0.03, WHEEL_R, zc)), (s, 0, 0), 0.17, 0.05, segs=24)
                add_cylinder(hubs, Vector((face + s * 0.06, WHEEL_R, zc)), (s, 0, 0), 0.08, 0.04, segs=16)
    new_object('Tyres', tyres, [M['Tyre']])
    new_object('Hubs', hubs, [M['Hub']])


def add_box_tyre(bm, x, zc, width):
    verts = add_cylinder(bm, Vector((x, WHEEL_R, zc)), (1, 0, 0), WHEEL_R, width, segs=40)
    rim = [e for e in {e for v in verts for e in v.link_edges}
           if abs(e.verts[0].co.x - e.verts[1].co.x) < 1e-6 and
           (e.verts[0].co - Vector((e.verts[0].co.x, WHEEL_R, zc))).length > WHEEL_R - 1e-3]
    bmesh.ops.bevel(bm, geom=rim, offset=0.07, segments=3, profile=0.5, affect='EDGES')


def build_interior(M):
    floor, seats, cushions, poles, dash = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()
    inner = HW - SHELL
    wells = [(FRONT_AXLE, 0.80), (REAR_AXLE, 0.56)]

    def floor_slab(d0, d1, y):
        add_box(floor, -0.56, 0.56, BODY_Y0, y, z_of(d1), z_of(d0))
        for s in (1, -1):
            cuts = [d0]
            for axle, ix in wells:
                if d0 < axle < d1:
                    cuts += [axle - 0.64, axle + 0.64]
            cuts.append(d1)
            for a, b in zip(cuts[0::2], cuts[1::2]):
                xa, xb = sorted((s * 0.56, s * inner))
                add_box(floor, xa, xb, BODY_Y0, y, z_of(b), z_of(a))
            for axle, ix in wells:
                if d0 < axle < d1 and ix > 0.6:
                    xa, xb = sorted((s * 0.56, s * ix))
                    add_box(floor, xa, xb, BODY_Y0, y, z_of(axle + 0.64), z_of(axle - 0.64))

    floor_slab(0.10, MIDDLE_FLOOR_STEP, FLOOR_LOW)
    floor_slab(MIDDLE_FLOOR_STEP, L - 0.1, FLOOR_HIGH)

    def seat(x, d, floor_y, rows=1):
        z = z_of(d)
        add_box(cushions, x - 0.21, x + 0.21, floor_y + 0.40, floor_y + 0.47, z - 0.20, z + 0.22, bevel=0.02)
        add_box(seats, x - 0.22, x + 0.22, floor_y + 0.44, floor_y + 1.05, z - 0.26, z - 0.20, bevel=0.02)
        add_box(seats, x - 0.03, x + 0.03, floor_y, floor_y + 0.40, z - 0.05, z + 0.05)

    for d in (2.95, 3.70):
        for x in (-0.95, -0.50):
            seat(x, d, FLOOR_LOW)
    seat(0.95, 3.70, FLOOR_LOW)
    for d in (6.45, 7.20, 7.95, 8.70, 9.45):
        for x in (-0.95, -0.50, 0.50, 0.95):
            if abs(d - REAR_AXLE) < 0.75 and abs(x) > 0.7:
                continue
            seat(x, d, FLOOR_HIGH)
    for x in (-0.92, -0.46, 0.0, 0.46, 0.92):
        seat(x, 10.15, FLOOR_HIGH)
    seat(-0.70, 1.15, FLOOR_LOW)  # driver

    add_box(dash, -1.15, 1.15, 0.80, 1.14, z_of(0.62), z_of(0.10), bevel=0.04)
    for d in (1.7, 4.4, 6.0, 7.6, 9.1):
        for x in (-0.28, 0.28):
            y0 = FLOOR_LOW if d < MIDDLE_FLOOR_STEP else FLOOR_HIGH
            add_cylinder(poles, Vector((x, (y0 + 2.55) / 2, z_of(d))), (0, 1, 0), 0.02, 2.55 - y0, segs=10)
    for x in (-0.36, 0.36):
        add_cylinder(poles, Vector((x, 2.52, z_of(5.7))), (0, 0, 1), 0.018, 8.2, segs=10)

    new_object('Floor', floor, [M['Floor']])
    new_object('Seats', seats, [M['Seat']])
    new_object('Cushions', cushions, [M['Cushion']])
    new_object('Poles', poles, [M['Chrome']])
    new_object('Dashboard', dash, [M['Trim']])


def smooth(ob, angle=35):
    me = ob.data
    if hasattr(me, 'set_sharp_from_angle'):
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(angle))


# MARK: Export


def run(*args, **kw):
    subprocess.run(args, check=True, **kw)


def export(out_dir):
    work = tempfile.mkdtemp(prefix='feeder-bus-')
    raw = os.path.join(work, 'raw.usdz')
    opts = dict(filepath=raw, export_materials=True, export_uvmaps=True, export_normals=True,
                generate_preview_surface=True, selected_objects_only=False, export_textures_mode='NEW',
                overwrite_textures=True, relative_paths=True)
    props = bpy.ops.wm.usd_export.get_rna_type().properties.keys()
    for key in ('export_animation', 'export_hair', 'export_lights', 'export_cameras'):
        if key in props:
            opts[key] = False
    if 'root_prim_path' in props:
        opts['root_prim_path'] = '/Bus'
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
    usda = os.path.join(work, 'bus.usda')
    run('usdcat', os.path.join(unpacked, layer), '--out', usda)
    text = open(usda).read()

    # Our geometry is already Y-up and in metres.
    text = re.sub(r'upAxis = "\w+"', 'upAxis = "Y"', text)
    if 'metersPerUnit' not in text:
        text = text.replace('upAxis = "Y"', 'metersPerUnit = 1\n    upAxis = "Y"', 1)
    text = re.sub(r'metersPerUnit = [\d.e-]+', 'metersPerUnit = 1', text)
    # Blender writes the coat as clearcoat; the specular tint is not RealityKit's.
    text = re.sub(r'\n\s*(color3f inputs:specularColor)[^\n]*', '', text)
    text = text.replace('token inputs:varname = "st"', 'string inputs:varname = "st"')
    open(usda, 'w').write(text)

    usdc = os.path.join(unpacked, 'RapidBus.usdc')
    run('usdcat', usda, '--out', usdc)
    textures = [n for n in names if not n.endswith(('.usdc', '.usda'))]
    out = os.path.join(out_dir, 'RapidBus.usdz')
    if os.path.exists(out):
        os.remove(out)
    run('usdzip', os.path.abspath(out), 'RapidBus.usdc', *textures, cwd=unpacked)
    shutil.rmtree(work)
    return os.path.abspath(out)


# The map's tiny buses: one frame per 15° of heading, seen from the south at
# 55° above the map, so a turn shows the bus's sides as well as its roof.
# Frame k heads k × 15° clockwise from north (screen up). Square, with the
# bus's centre at the image centre so the marker sits on its coordinate.
SPRITE_FRAMES = 24
SPRITE_ELEVATION = 55
SPRITE_PX = 132  # 44 pt @3x
SPRITE_SPAN_M = 11.5  # metres across the frame: the bus's turn plus a margin


def stage_text(turn, elevation, cy, h_aperture, v_aperture, sun_yaw, sun_pitch, sky):
    d = 50.0
    e = math.radians(elevation)
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
        float xformOp:rotateY = {turn:g}
        uniform token[] xformOpOrder = ["xformOp:rotateY"]

        def "Bus" (
            prepend references = @BUS@
        )
        {{
        }}
    }}

    def Camera "Cam"
    {{
        token projection = "orthographic"
        float horizontalAperture = {h_aperture:g}
        float verticalAperture = {v_aperture:g}
        float2 clippingRange = (1, 1000)
        double3 xformOp:translate = (0, {cy + d * math.sin(e):g}, {d * math.cos(e):g})
        float xformOp:rotateX = {-elevation:g}
        uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateX"]
    }}

    def DistantLight "Sun"
    {{
        float inputs:intensity = 2.2
        float xformOp:rotateY = {sun_yaw:g}
        float xformOp:rotateX = {sun_pitch:g}
        uniform token[] xformOpOrder = ["xformOp:rotateY", "xformOp:rotateX"]
    }}

    def DomeLight "Sky"
    {{
        float inputs:intensity = {sky:g}
    }}
}}
'''


def record(stage, usdz, png, width):
    work = tempfile.mkdtemp(prefix='feeder-bus-render-')
    path = os.path.join(work, 'stage.usda')
    open(path, 'w').write(stage.replace('BUS', usdz))
    run('usdrecord', '--camera', '/World/Cam', '--disableCameraLight', '--complexity', 'high',
        '--imageWidth', str(width), path, png, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    shutil.rmtree(work)


def render_map_sprites(usdz, out_dir):
    work = tempfile.mkdtemp(prefix='feeder-bus-sprites-')
    span = SPRITE_SPAN_M * 10
    for k in range(SPRITE_FRAMES):
        frame = os.path.join(work, f'heading{k:02d}.png')
        record(stage_text(180 - k * 360 / SPRITE_FRAMES, SPRITE_ELEVATION, 1.5, span, span, -35, -55, 0.9),
               usdz, frame, SPRITE_PX * 3)
        run('sips', '-Z', str(SPRITE_PX), frame, '--out', os.path.join(out_dir, f'map-bus-{k:02d}.png'),
            stdout=subprocess.DEVNULL)
    shutil.rmtree(work)


# The bus pill's icon: the bus three-quarters on, its front to the right
# (toward the route and stop), seen from just above, as the trip sheet's 3D
# bus rests. 44 × 36 pt, the bus centred with a little room either side.
ICON_PT = (44, 36)
ICON_YAW = 38  # degrees from facing the camera; 90 is side-on
ICON_ELEVATION = 12
ICON_SPAN_M = 8.9  # metres across the image


def render_icon(usdz, out_dir):
    w, h = ICON_PT
    work = tempfile.mkdtemp(prefix='feeder-bus-icon-')
    frame = os.path.join(work, 'icon.png')
    record(stage_text(ICON_YAW, ICON_ELEVATION, 1.4, ICON_SPAN_M * 10, ICON_SPAN_M * 10 * h / w, 35, -40, 1),
           usdz, frame, w * 9)
    run('sips', '-z', str(h * 3), str(w * 3), frame, '--out', os.path.join(out_dir, 'pill-bus.png'),
        stdout=subprocess.DEVNULL)
    shutil.rmtree(work)


def main(out_dir):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    pixels = paint_atlas()
    image = bpy.data.images.new('livery', SIZE, SIZE, alpha=False)
    image.pixels.foreach_set(pixels.ravel())
    work = tempfile.mkdtemp(prefix='feeder-bus-tex-')
    image.filepath_raw = os.path.join(work, 'livery.png')
    image.file_format = 'PNG'
    image.save()

    M = make_materials(image)
    build_body(M)
    build_wheel_wells(M)
    build_glass(M)
    build_doors(M)
    build_roof(M)
    build_front_details(M)
    build_rear_details(M)
    build_wheels(M)
    build_interior(M)
    for ob in bpy.context.scene.objects:
        if ob.type == 'MESH':
            smooth(ob, 60 if ob.name in ('Tyres', 'Hubs', 'Headlamps', 'RearLamps', 'LampRings', 'RearLampRings', 'Poles') else 30)

    tris = sum(sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in bpy.context.scene.objects if ob.type == 'MESH')
    print(f'triangles: {tris}')
    corners = [ob.matrix_world @ Vector(c) for ob in bpy.context.scene.objects if ob.type == 'MESH' for c in ob.bound_box]
    lo = [min(c[i] for c in corners) for i in range(3)]
    hi = [max(c[i] for c in corners) for i in range(3)]
    print('bounds x {:.3f}..{:.3f}  y {:.3f}..{:.3f}  z {:.3f}..{:.3f}'.format(lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]))
    os.makedirs(out_dir, exist_ok=True)
    usdz = export(out_dir)
    if '--no-sprites' not in sys.argv:
        render_map_sprites(usdz, out_dir)
        render_icon(usdz, out_dir)
    print('wrote', usdz)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    args = [a for a in argv if not a.startswith('--')]
    if len(args) != 1:
        sys.exit(__doc__)
    main(args[0])
