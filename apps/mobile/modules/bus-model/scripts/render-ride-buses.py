"""
Renders the map sprites ride-along draws, for both buses, day and night, from
the committed models without rebuilding or touching them:
ios/Assets/RapidBus.usdz (the MRT feeder) and ios/Assets/RapidKLBus.usdz (the
rapidKL city bus).

Ride along tilts the map's camera to 62° off straight down (RideAlong.swift),
so the flat map's sprites, seen from 55° above the ground, show a bus lying
on its roof. These are seen from RIDE_ELEVATION above the ground instead, as
the tilted camera sees the bus a little below the middle of the map, and are
larger: the bus being ridden is drawn at RIDE_PT. The night ones are graded
exactly as render-night-buses.py grades the flat map's (its stage is reused).

Usage, from modules/bus-model (macOS; usdrecord and sips ship with the OS):
  blender --background --factory-startup --python scripts/render-ride-buses.py -- ios/Assets

Output, beside the other sprites:
  - map-bus-ride-00.png … map-bus-ride-23.png, map-rapid-ride-00.png …
    map-rapid-ride-23.png, and the same with -ride-night-: RIDE_PT square
    at 3x, frame k heading k × 15° clockwise from the top of the screen
    (away from the camera), the bus's centre at the image centre.
"""

import importlib.util
import math
import os
import shutil
import subprocess
import sys
import tempfile

import bpy

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('night', os.path.join(here, 'render-night-buses.py'))
night = importlib.util.module_from_spec(spec)
spec.loader.exec_module(night)

SPRITE_FRAMES = 24
RIDE_ELEVATION = 30
RIDE_PT = 120
SPRITE_CY = night.SPRITE_CY

BUSES = [
    dict(bus, day=bus['sprite'].replace('-night', '-ride'), lit=bus['sprite'].replace('-night', '-ride-night'))
    for bus in night.BUSES
]


def day_stage(usdz, turn, elevation, cy, aperture):
    """The flat map's day stage (build-feeder-bus.py: stage_text), its
    lighting left to usdrecord's own as there."""
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
            prepend references = @{usdz}@
        )
        {{
        }}
    }}

    def Camera "Cam"
    {{
        token projection = "orthographic"
        float horizontalAperture = {aperture:g}
        float verticalAperture = {aperture:g}
        float2 clippingRange = (1, 1000)
        double3 xformOp:translate = (0, {cy + d * math.sin(e):g}, {d * math.cos(e):g})
        float xformOp:rotateX = {-elevation:g}
        uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateX"]
    }}
}}
'''


def render_bus(bus, out_dir, work):
    usdz = os.path.abspath(os.path.join(out_dir, bus['model']))
    assert os.path.exists(usdz), usdz
    beam_png = os.path.join(work, f'beams-{bus["lit"]}.png')
    night.beam_texture(beam_png, bus['lamp_x'])
    grade = night.night_grade(usdz)
    span = bus['span'] * 10
    px = RIDE_PT * 3

    for k in range(SPRITE_FRAMES):
        turn = 180 - k * 360 / SPRITE_FRAMES
        for name, stage in (
            (bus['day'], day_stage(usdz, turn, RIDE_ELEVATION, SPRITE_CY, span)),
            (bus['lit'], night.night_stage(bus, usdz, grade, beam_png, turn, RIDE_ELEVATION, SPRITE_CY, span, span)),
        ):
            frame = os.path.join(work, f'{name}-{k:02d}.png')
            night.record(stage, frame, px * 2, work)
            night.run('sips', '-Z', str(px), frame, '--out', os.path.join(out_dir, f'{name}-{k:02d}.png'),
                      stdout=subprocess.DEVNULL)
    print('rendered', bus['day'], bus['lit'])


def main(out_dir):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    work = tempfile.mkdtemp(prefix='ride-buses-')
    try:
        for bus in BUSES:
            render_bus(bus, out_dir, work)
    finally:
        shutil.rmtree(work)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    args = [a for a in argv if not a.startswith('--')]
    if len(args) != 1:
        sys.exit(__doc__)
    main(args[0])
