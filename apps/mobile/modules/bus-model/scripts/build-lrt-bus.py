"""
Builds ios/Assets/RapidKLBus.usdz from scratch: the Rapid KL city bus that
also works the LRT feeders (T786 and the other T7xx routes), a 12 m
Gemilang-bodied Scania K250UB in the older red / cream / blue rapidKL
livery, plus its map sprites and the bus pill's icon.

Our own work, so it is committed. Measurements come from the CC0 / CC BY-SA
photos in ios/Assets/lrt-feeder-reference/ (gitignored); the livery leaves
out every trademark (the rapidKL wordmark, slogans, badges, plates).

The same body also runs the LRT feeders in the pink "Bas Perantara LRT"
livery, bus by bus rather than route by route, so this one stands for them.

It reuses build-feeder-bus.py for everything the two buses share (the shell,
glass, doors, wheels, export and renders), giving it this bus's dimensions
and its own livery, roof, front, rear and interior. Same asset contract.

Usage, from modules/bus-model, then rebuild in Xcode:
  blender --background --factory-startup --python scripts/build-lrt-bus.py -- ios/Assets
"""

import importlib.util
import math
import os
import sys

import bmesh
from mathutils import Vector

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
spec = importlib.util.spec_from_file_location(
    'feeder_bus', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build-feeder-bus.py'))
kit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kit)

# Body, in metres; d is the distance back from the front face (z = HZ - d).
# Measured from the straight side photo of WUW 4137 (perspective corrected,
# 12.0 m overall): wheelbase 5.9 m, overhangs 2.93 / 3.16 m.
L, W = 12.0, 2.55
HZ, HW = L / 2, W / 2
SILL, GLASS_TOP = 1.35, 2.63
GEOMETRY = dict(
    L=L, W=W, HZ=HZ, HW=HW,
    ROOF_Y=3.05, FRONT_R=0.22, REAR_R=0.15,
    FRONT_AXLE=2.93, REAR_AXLE=8.84, WHEEL_R=0.478,
    SILL_FRONT=SILL, SILL_REAR=SILL, GLASS_TOP=GLASS_TOP,
    FASCIA_TOP=1.13, RAKE=0.06,
    NEAR_WINDOWS=[(1.85, 3.59), (3.59, 4.62), (4.62, 5.62), (7.10, 7.99), (7.99, 9.51), (9.51, 10.47), (10.47, 11.76)],
    OFF_WINDOWS=[(1.85, 3.45), (3.45, 5.05), (5.05, 6.65), (6.65, 8.25), (8.25, 9.85), (9.85, 11.76)],
    DRIVER_WINDOW=(0.25, 1.85, 1.05),
    FRONT_DOOR=(0.30, 1.79), MIDDLE_DOOR=(5.67, 7.06), DOOR_TOP=2.60,
    MIDDLE_FLOOR_STEP=7.10,
    WINDSCREEN=(1.16, 2.56), REAR_WINDOW=(1.02, 2.14, 2.84),
    MODEL_NAME='RapidKLBus', SPRITE_NAME='map-rapid', ICON_NAME='pill-rapid',
    SPRITE_SPAN_M=13.0, ICON_SPAN_M=10.0,
)
z_of = kit.z_of
front_z = kit.front_z

# The older rapidKL livery, sRGB, from the reference photos.
RED = '#D63F2E'
CREAM = '#EEE2C3'
BLUE = '#262C93'
BLACK = kit.BLACK
LIP = '#1A1B1E'


def smoothstep(a, b, t):
    t = min(max((t - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


# MARK: Livery


def skirt_top(d):
    """The blue skirt's top edge along the side: low, rising at both corners."""
    front = 0.86 - 0.18 * smoothstep(0.15, 0.65, d)
    return front + 0.72 * smoothstep(11.25, 11.85, d)


def paint_side(a, side):
    a.rect(side, -0.1, 0.2, L + 0.1, 3.2, CREAM)
    a.rect(side, -0.1, 2.72, L + 0.1, 3.2, RED)
    a.rect(side, -0.1, SILL, 11.80, GLASS_TOP, BLACK)  # glazing band
    if side == 'off':
        d0, d1, sill = GEOMETRY['DRIVER_WINDOW']
        a.rect(side, d0, sill, d1, SILL, BLACK)
    ds = [i / 40 * (L + 0.2) - 0.1 for i in range(41)]
    a.poly(side, [(d, skirt_top(d)) for d in ds] + [(L + 0.1, 0.2), (-0.1, 0.2)], BLUE)
    if side == 'near':  # engine air at the nearside rear
        for i in range(9):
            x = 10.92 + i * 0.068
            a.rect(side, x, 0.62, x + 0.036, 1.16, BLACK)
    for axle in (GEOMETRY['FRONT_AXLE'], GEOMETRY['REAR_AXLE']):
        a.circle(side, axle, GEOMETRY['WHEEL_R'], 0.60, LIP, inner=0.55)


def paint_front(a):
    r = 'front'
    a.rect(r, -0.1, 0.2, W + 0.1, 3.2, CREAM)
    a.rect(r, -0.1, 2.96, W + 0.1, 3.2, RED)
    # Windscreen, pillars and the headsign band, the lower frame dipping in
    # the middle.
    xs = [i / 30 * W for i in range(31)]
    a.poly(r, [(x, 1.25 - 0.12 * (1 - ((x - HW) / HW) ** 2)) for x in xs] + [(W + 0.1, 2.96), (-0.1, 2.96)], BLACK)
    # Wheelchair pictogram at the nearside (+X) end of the sign.
    x0, y0 = HW + 0.86, 2.65
    a.rect(r, x0, y0, x0 + 0.22, y0 + 0.22, '#1F5FBF')
    a.circle(r, x0 + 0.12, y0 + 0.17, 0.018, CREAM)
    a.rect(r, x0 + 0.10, y0 + 0.07, x0 + 0.13, y0 + 0.15, CREAM)
    a.circle(r, x0 + 0.10, y0 + 0.07, 0.05, CREAM, inner=0.035)

    # Blue below the cream fascia: high at the lamp corners, low under the
    # fascia's rounded middle.
    def top(x):
        t = smoothstep(0.82, 1.02, abs(x - HW))
        return 0.59 + 0.29 * t

    xs = [i / 60 * (W + 0.2) - 0.1 for i in range(61)]
    a.poly(r, [(x, top(x)) for x in xs] + [(W + 0.1, 0.2), (-0.1, 0.2)], BLUE)
    a.rrect(r, HW - 0.26, 0.37, HW + 0.26, 0.48, 0.01, BLACK)  # plate, left blank


def paint_rear(a):
    r = 'rear'
    a.rect(r, -0.1, 0.2, W + 0.1, 3.2, CREAM)
    a.rect(r, -0.1, 2.90, W + 0.1, 3.2, RED)
    a.rect(r, -0.1, 2.05, W + 0.1, 2.90, BLACK)
    a.rrect(r, 0.33, 0.62, W - 0.33, 1.98, 0.08, '#C9BFA3')  # engine door seam
    a.rrect(r, 0.345, 0.635, W - 0.345, 1.965, 0.07, CREAM)
    a.rect(r, -0.1, 0.2, W + 0.1, 0.55, BLUE)  # bumper
    for x0, x1 in ((-0.1, 0.22), (W - 0.22, W + 0.1)):  # lamp columns
        a.rrect(r, x0, 0.2, x1, 1.45, 0.06, BLUE)
    for x0, x1, lean in ((0.42, 0.95, 1), (W - 0.95, W - 0.42, -1)):
        a.rect(r, x0, 0.66, x1, 0.84, kit.CHEVRON_YELLOW)
        for i in range(-2, 6):
            s = x0 + i * 0.14
            a.poly(r, [(s, 0.66), (s + 0.07, 0.66), (s + 0.07 + lean * 0.18, 0.84), (s + lean * 0.18, 0.84)],
                   kit.CHEVRON_RED, clip=(x0, 0.66, x1, 0.84))
    a.rrect(r, HW - 0.26, 0.31, HW + 0.26, 0.42, 0.01, BLACK)  # plate, left blank


def paint_atlas():
    a = kit.Atlas()
    paint_side(a, 'near')
    paint_side(a, 'off')
    paint_front(a)
    paint_rear(a)
    a.rect('roof', -0.1, -0.1, L + 0.1, W + 0.1, RED)
    a.rect('bottom', 0, 0, 2.6, 0.6, '#141416')
    return a.pixels()


# MARK: Parts that differ from the feeder bus


def make_materials(image):
    M = feeder_materials(image)
    M['AC'] = kit.material('AC', RED, rough=0.45, coat=0.5)
    M['RedLamp'] = kit.material('RedLamp', '#B3261E', rough=0.15, emit='#FF2A1A', emit_strength=0.15)
    M['Grab'] = kit.material('Grab', '#E6B323', rough=0.35)
    M['Cushion'] = kit.material('Cushion', '#2F5D7A', rough=0.8)
    return M


def build_roof(M):
    bm = bmesh.new()
    kit.add_box(bm, -0.95, 0.95, 3.0, 3.23, z_of(5.89), z_of(3.07), bevel=0.08, segments=3)
    kit.new_object('ACPod', bm, [M['AC']])

    bm = bmesh.new()
    for d in (4.95, 5.25, 5.55):  # two rows of three condenser fans at its back
        for x in (-0.33, 0.33):
            kit.add_cylinder(bm, Vector((x, 3.232, z_of(d))), (0, 1, 0), 0.13, 0.012, segs=24)
    for s in (1, -1):
        for i in range(7):
            zz = z_of(3.45) - i * 0.07
            xa, xb = sorted((s * 0.20, s * 0.70))
            kit.add_box(bm, xa, xb, 3.21, 3.235, zz - 0.025, zz)
    kit.new_object('ACGrilles', bm, [M['Trim']])


def build_front_details(M):
    lamps, trim, chrome, sign, amber = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()
    zf = HZ
    for s in (1, -1):
        # Twin round headlamps and an indicator in each blue corner.
        for x, r in ((0.86, 0.05), (1.00, 0.05)):
            kit.add_cylinder(lamps, Vector((s * x, 0.74, zf - 0.005)), (0, 0, 1), r, 0.03)
            kit.add_cylinder(chrome, Vector((s * x, 0.74, zf - 0.012)), (0, 0, 1), r + 0.012, 0.03)
        kit.add_cylinder(amber, Vector((s * 0.74, 0.76, zf - 0.005)), (0, 0, 1), 0.025, 0.03, segs=12)
        # Hanging mirrors on arms from the roof corners.
        reach, fwd = 1.42, 0.22
        arm_a = Vector((s * 1.14, 2.92, front_z(2.92) - 0.06))
        arm_b = Vector((s * reach, 2.86, zf + fwd))
        kit.add_cylinder(trim, (arm_a + arm_b) / 2, arm_b - arm_a, 0.018, (arm_b - arm_a).length, segs=10)
        kit.add_cylinder(trim, Vector((s * reach, 2.64, zf + fwd)), (0, 1, 0), 0.018, 0.44, segs=10)
        kit.add_box(trim, s * reach - 0.11, s * reach + 0.11, 2.02, 2.44, zf + fwd - 0.03, zf + fwd + 0.03, bevel=0.015)
        # Wipers, parked near vertical.
        base = Vector((s * 0.40, 1.20, front_z(1.20) + 0.01))
        tip = Vector((s * 0.30, 2.02, front_z(2.02) + 0.01))
        kit.add_cylinder(trim, (base + tip) / 2, tip - base, 0.012, (tip - base).length, segs=8)
    kit.new_object('Headlamps', lamps, [M['Lamp']])
    kit.new_object('LampRings', chrome, [M['Chrome']])
    kit.new_object('MirrorsWipers', trim, [M['Trim']])
    kit.new_object('LEDDots', amber, [M['Amber']])

    # The destination sign: one quad, 9:1, u left to right as seen from the
    # front (toward +X), v bottom to top, facing +Z along the raked face.
    x0, x1 = -1.05, 0.75
    y0, y1 = 2.67, 2.87
    z0, z1 = front_z(y0) + 0.012, front_z(y1) + 0.012
    f = kit.add_quad(sign, [(x0, y0, z0), (x1, y0, z0), (x1, y1, z1), (x0, y1, z1)])
    uv = sign.loops.layers.uv.new('UVMap')
    for loop, coords in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = coords
    kit.new_object('Headsign', sign, [M['Sign']])


def build_rear_details(M):
    clear, red, amber, chrome, led = (bmesh.new() for _ in range(5))
    zr = -HZ
    for s in (1, -1):
        # A column of four round lamps on each blue corner.
        for y, bm in ((1.32, amber), (1.17, red), (1.02, red), (0.87, clear)):
            kit.add_cylinder(bm, Vector((s * 1.14, y, zr - 0.01)), (0, 0, -1), 0.055, 0.03)
            kit.add_cylinder(chrome, Vector((s * 1.14, y, zr - 0.004)), (0, 0, -1), 0.066, 0.02)
    kit.add_cylinder(red, Vector((-0.30, 0.47, zr - 0.006)), (0, 0, -1), 0.035, 0.02)  # fog lamp
    kit.add_quad(red, [(0.30, 2.76, zr + 0.025), (-0.30, 2.76, zr + 0.025), (-0.30, 2.80, zr + 0.025), (0.30, 2.80, zr + 0.025)])
    kit.new_object('RearLamps', clear, [M['Lamp']])
    kit.new_object('RearRedLamps', red, [M['RedLamp']])
    kit.new_object('RearAmberLamps', amber, [M['Amber']])
    kit.new_object('RearLampRings', chrome, [M['Chrome']])
    # The small route LED behind the nearside window by the front door.
    xs = HW - 0.03
    kit.add_quad(led, [(xs, 2.46, z_of(1.95)), (xs, 2.46, z_of(2.55)), (xs, 2.58, z_of(2.55)), (xs, 2.58, z_of(1.95))])
    kit.new_object('RouteLEDs', led, [M['LED']])
    bm = bmesh.new()
    front_door, middle_door = GEOMETRY['FRONT_DOOR'], GEOMETRY['MIDDLE_DOOR']
    for s in (1, -1):
        for d in (2.0, 4.6, 6.4, 7.6, 10.2, 11.4):
            if s > 0 and (front_door[0] < d < front_door[1] or middle_door[0] < d < middle_door[1]):
                continue
            xa, xb = sorted((s * HW, s * (HW + 0.012)))
            kit.add_box(bm, xa, xb, 0.40, 0.43, z_of(d) - 0.035, z_of(d) + 0.035)
    kit.new_object('SideMarkers', bm, [M['Amber']])


def build_interior(M):
    floor, seats, cushions, poles, dash = (bmesh.new() for _ in range(5))
    inner = HW - kit.SHELL
    front_axle, rear_axle = GEOMETRY['FRONT_AXLE'], GEOMETRY['REAR_AXLE']
    step = GEOMETRY['MIDDLE_FLOOR_STEP']
    low, high = kit.FLOOR_LOW, kit.FLOOR_HIGH

    def floor_slab(d0, d1, y):
        kit.add_box(floor, -0.56, 0.56, kit.BODY_Y0, y, z_of(d1), z_of(d0))
        for s in (1, -1):
            cuts = [d0]
            for axle in (front_axle, rear_axle):
                if d0 < axle < d1:
                    cuts += [axle - 0.64, axle + 0.64]
            cuts.append(d1)
            for a, b in zip(cuts[0::2], cuts[1::2]):
                xa, xb = sorted((s * 0.56, s * inner))
                kit.add_box(floor, xa, xb, kit.BODY_Y0, y, z_of(b), z_of(a))

    floor_slab(0.10, step, low)
    floor_slab(step, L - 0.1, high)

    def seat(x, d, floor_y):
        z = z_of(d)
        kit.add_box(cushions, x - 0.21, x + 0.21, floor_y + 0.40, floor_y + 0.47, z - 0.20, z + 0.22, bevel=0.02)
        kit.add_box(seats, x - 0.22, x + 0.22, floor_y + 0.44, floor_y + 1.05, z - 0.26, z - 0.20, bevel=0.02)
        kit.add_box(seats, x - 0.03, x + 0.03, floor_y, floor_y + 0.40, z - 0.05, z + 0.05)

    for d in (3.85, 4.60, 5.35):
        for x in (-0.95, -0.50, 0.50, 0.95):
            if x > 0 and d > 5.2:
                continue  # standing room by the middle door
            seat(x, d, low)
    for d in (7.70, 8.45, 9.20, 9.95, 10.70):
        for x in (-0.95, -0.50, 0.50, 0.95):
            if abs(d - rear_axle) < 0.75 and abs(x) > 0.7:
                continue
            seat(x, d, high)
    for x in (-0.92, -0.46, 0.0, 0.46, 0.92):
        seat(x, 11.40, high)
    seat(-0.70, 1.20, low)  # driver

    kit.add_box(dash, -1.17, 1.17, 0.80, 1.12, z_of(0.62), z_of(0.10), bevel=0.04)
    for d in (1.95, 3.2, 5.55, 7.25, 9.2, 10.4):
        for x in (-0.28, 0.28):
            y0 = low if d < step else high
            kit.add_cylinder(poles, Vector((x, (y0 + 2.6) / 2, z_of(d))), (0, 1, 0), 0.02, 2.6 - y0, segs=10)
    for x in (-0.36, 0.36):
        kit.add_cylinder(poles, Vector((x, 2.56, z_of(6.3))), (0, 0, 1), 0.018, 9.4, segs=10)

    kit.new_object('Floor', floor, [M['Floor']])
    kit.new_object('Seats', seats, [M['Seat']])
    kit.new_object('Cushions', cushions, [M['Cushion']])
    kit.new_object('Poles', poles, [M['Grab']])
    kit.new_object('Dashboard', dash, [M['Trim']])


# The feeder bus's build, with this bus's numbers and parts swapped in: its
# builders read these module globals when they run.
feeder_materials = kit.make_materials
for name, value in GEOMETRY.items():
    setattr(kit, name, value)
kit.paint_atlas = paint_atlas
kit.make_materials = make_materials
kit.build_roof = build_roof
kit.build_front_details = build_front_details
kit.build_rear_details = build_rear_details
kit.build_interior = build_interior

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    args = [a for a in argv if not a.startswith('--')]
    if len(args) != 1:
        sys.exit(__doc__)
    kit.main(args[0])
