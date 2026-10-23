"""
Renders the night versions of both buses' map sprites and pill icons from the
committed models, without rebuilding or touching them: ios/Assets/RapidBus.usdz
(the MRT feeder, build-feeder-bus.py) and ios/Assets/RapidKLBus.usdz (the
rapidKL city bus, build-lrt-bus.py).

Each frame is a small stage that references the bus as it is and overrides
only what night changes: every material's colour graded down to a dim,
cool moonlight (NIGHT_TINT; the livery texture through its UsdUVTexture
scale); the headlamps rebound to a bright warm-white glow, the destination
sign (the prim named `Headsign`) to amber and the tail lamps to red; the side
glass a faint cabin glow; and two soft headlamp beams on the road ahead, a
translucent emissive quad under the turning Xform so it turns with the bus.
The beams are shortened per frame so they always fade out inside the image.

Night is a material grade, not a light rig, because usdrecord (Apple USD
Tools 0.25) lights every render with its own fixed default and ignores the
stage's DomeLight and DistantLight; emission is the only thing that glows.

Usage, from modules/bus-model (macOS; usdrecord and sips ship with the OS):
  blender --background --factory-startup --python scripts/render-night-buses.py -- ios/Assets

Output, beside the day sprites, in exactly their framing and frame order:
  - map-bus-night-00.png … map-bus-night-23.png, map-rapid-night-00.png …
    map-rapid-night-23.png: 132 × 132 px, frame k heads k × 15° clockwise from
    north, seen from the south at 55°, the bus's centre at the image centre.
  - pill-bus-night.png, pill-rapid-night.png: 132 × 108 px, framed as the pills.
"""

import math
import os
import re
import shutil
import subprocess
import sys
import tempfile

import bpy
import numpy as np

# The day renders' framing (build-feeder-bus.py: render_map_sprites,
# render_icon), copied rather than imported so this never rebuilds a bus.
SPRITE_FRAMES = 24
SPRITE_ELEVATION = 55
SPRITE_PX = 132
SPRITE_CY = 1.5
ICON_PT = (44, 36)
ICON_YAW = 38
ICON_ELEVATION = 12
ICON_CY = 1.4

# Per bus: its model, sprite and icon names, the spans the day renders use,
# and where its headlamps sit (x either side of centre, the front face's z).
BUSES = [
    dict(model='RapidBus.usdz', sprite='map-bus-night', icon='pill-bus-night',
         span=11.5, icon_span=8.9, lamp_x=1.00, front=10.55 / 2, tail='RearLamps'),
    dict(model='RapidKLBus.usdz', sprite='map-rapid-night', icon='pill-rapid-night',
         span=13.0, icon_span=10.0, lamp_x=0.93, front=12.0 / 2, tail='RearRedLamps'),
]

# Night: linear multipliers on every material's diffuse colour, moonlit blue.
NIGHT_TINT = (0.20, 0.23, 0.34)
NIGHT_CLEARCOAT = 0.25  # of the day's, so the dim paint doesn't shine

# The beams: how far ahead they reach at most, and how wide the pair spreads.
BEAM_MAX = 3.4  # metres ahead of the front
BEAM_HALF_WIDTH = 2.2  # half the quad's width, metres
BEAM_ALPHA = 0.75  # the beams' peak opacity
BEAM_TEX = (128, 256)  # across, along


def run(*args, **kw):
    subprocess.run(args, check=True, **kw)


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


def beam_texture(path, lamp_x):
    """Two soft headlamp beams in one map: u across the quad (x from
    -BEAM_HALF_WIDTH to +), v along it (0 at the bumper, 1 at the far end).
    White, the beams in the alpha; they fade to nothing before v = 1."""
    w, h = BEAM_TEX
    x = (np.arange(w) + 0.5) / w * 2 * BEAM_HALF_WIDTH - BEAM_HALF_WIDTH
    s = (np.arange(h) + 0.5) / h  # 0 near, 1 far
    X, S = np.meshgrid(x, s)
    a = np.zeros_like(X)
    for x0 in (-lamp_x, lamp_x):
        spread = 0.16 + 0.55 * S  # each beam widens and drifts outward a little
        lateral = np.exp(-2.0 * ((X - x0 * (1 + 0.2 * S)) / spread) ** 2)
        a = 1 - (1 - a) * (1 - lateral)
    near = np.clip(S / 0.06, 0, 1)
    far = np.clip(1 - S, 0, 1) ** 1.3
    a *= near * far * BEAM_ALPHA
    rgba = np.ones((h, w, 4))
    rgba[..., 3] = a
    save_png(rgba[::-1], path)  # row 0 of the file is v = 1


def screen(p, turn, elevation, cy):
    """Ground point p = (x, y, z) in the bus's own axes, turned like the bus,
    in the camera's (right, up) metres from the image centre."""
    t = math.radians(turn)
    x = p[0] * math.cos(t) + p[2] * math.sin(t)
    z = -p[0] * math.sin(t) + p[2] * math.cos(t)
    e = math.radians(elevation)
    return x, (p[1] - cy) * math.cos(e) - z * math.sin(e)


def beam_length(bus, turn, elevation, cy, half_w, half_h, margin=0.25):
    """The longest beam (≤ BEAM_MAX) whose far corners stay inside the image."""
    best = 0.0
    for i in range(1, 41):
        length = BEAM_MAX * i / 40
        z = bus['front'] + length
        ok = all(abs(h) < half_w - margin and abs(v) < half_h - margin
                 for h, v in (screen((x, 0.0, z), turn, elevation, cy)
                              for x in (-BEAM_HALF_WIDTH, BEAM_HALF_WIDTH)))
        if not ok:
            break
        best = length
    return best


def material(name, diffuse, emissive=(0, 0, 0), opacity=None, texture=None, rough=0.5):
    lines = [
        f'        def Material "{name}"',
        '        {',
        f'            token outputs:surface.connect = </World/NightLooks/{name}/S.outputs:surface>',
        '            def Shader "S"',
        '            {',
        '                uniform token info:id = "UsdPreviewSurface"',
        f'                color3f inputs:diffuseColor = ({diffuse[0]:g}, {diffuse[1]:g}, {diffuse[2]:g})',
        f'                color3f inputs:emissiveColor = ({emissive[0]:g}, {emissive[1]:g}, {emissive[2]:g})',
        f'                float inputs:roughness = {rough:g}',
        '                float inputs:metallic = 0',
    ]
    if texture:
        lines.append(f'                float inputs:opacity.connect = </World/NightLooks/{name}/Tex.outputs:a>')
    elif opacity is not None:
        lines.append(f'                float inputs:opacity = {opacity:g}')
    lines += ['                token outputs:surface', '            }']
    if texture:
        lines += [
            '            def Shader "St"',
            '            {',
            '                uniform token info:id = "UsdPrimvarReader_float2"',
            '                string inputs:varname = "st"',
            '                float2 outputs:result',
            '            }',
            '            def Shader "Tex"',
            '            {',
            '                uniform token info:id = "UsdUVTexture"',
            f'                asset inputs:file = @{texture}@',
            f'                float2 inputs:st.connect = </World/NightLooks/{name}/St.outputs:result>',
            '                token inputs:sourceColorSpace = "raw"',
            '                token inputs:wrapS = "clamp"',
            '                token inputs:wrapT = "clamp"',
            '                float outputs:a',
            '            }',
        ]
    lines.append('        }')
    return '\n'.join(lines)


def bind(prim, look):
    return f'''            over "{prim}"
            {{
                over "{prim}" (
                    prepend apiSchemas = ["MaterialBindingAPI"]
                )
                {{
                    rel material:binding = </World/NightLooks/{look}>
                }}
            }}'''


def night_grade(usdz, keep=()):
    """`over`s for the bus's own materials (under its _materials scope),
    grading each one's diffuse colour by NIGHT_TINT: the value where it's a
    constant, the texture's scale where it's an image. Emission is untouched."""
    text = subprocess.run(['usdcat', usdz, '--flatten'], capture_output=True, text=True, check=True).stdout
    out = []
    for block in re.split(r'\n\s*def Material "', text)[1:]:
        name = block[:block.index('"')]
        if name in keep:
            continue
        shader = re.search(r'def Shader "(\w+)"[^{]*\{\s*uniform token info:id = "UsdPreviewSurface"', block).group(1)
        body = []
        value = re.search(r'color3f inputs:diffuseColor = \(([^)]*)\)', block)
        texture = re.search(r'color3f inputs:diffuseColor\.connect = <[^>]*/(\w+)\.outputs:rgb>', block)
        coat = re.search(r'float inputs:clearcoat = ([\d.e-]+)', block)
        if value:
            c = [float(v) * t for v, t in zip(value.group(1).split(','), NIGHT_TINT)]
            body.append(f'color3f inputs:diffuseColor = ({c[0]:.5f}, {c[1]:.5f}, {c[2]:.5f})')
        if coat:
            body.append(f'float inputs:clearcoat = {float(coat.group(1)) * NIGHT_CLEARCOAT:g}')
        lines = [f'                over "{name}"', '                {',
                 f'                    over "{shader}"', '                    {']
        lines += [f'                        {b}' for b in body]
        lines.append('                    }')
        if texture:
            t = NIGHT_TINT
            lines += [f'                    over "{texture.group(1)}"', '                    {',
                      f'                        float4 inputs:scale = ({t[0]:g}, {t[1]:g}, {t[2]:g}, 1)',
                      '                    }']
        lines.append('                }')
        out.append('\n'.join(lines))
    return '            over "_materials"\n            {\n' + '\n'.join(out) + '\n            }'


def night_stage(bus, usdz, grade, beam_png, turn, elevation, cy, h_aperture, v_aperture):
    """The day renders' stage_text, at night."""
    d = 50.0
    e = math.radians(elevation)
    length = beam_length(bus, turn, elevation, cy, h_aperture / 20, v_aperture / 20)
    beam = ''
    if length > 0.3:
        z0, z1, y = bus['front'] + 0.05, bus['front'] + length, 0.02
        hw = BEAM_HALF_WIDTH
        beam = f'''
        def Mesh "Beams" (
            prepend apiSchemas = ["MaterialBindingAPI"]
        )
        {{
            int[] faceVertexCounts = [4]
            int[] faceVertexIndices = [0, 1, 2, 3]
            point3f[] points = [({-hw:g}, {y:g}, {z1:g}), ({hw:g}, {y:g}, {z1:g}), ({hw:g}, {y:g}, {z0:g}), ({-hw:g}, {y:g}, {z0:g})]
            normal3f[] normals = [(0, 1, 0), (0, 1, 0), (0, 1, 0), (0, 1, 0)] (
                interpolation = "vertex"
            )
            texCoord2f[] primvars:st = [(0, 1), (1, 1), (1, 0), (0, 0)] (
                interpolation = "vertex"
            )
            uniform bool doubleSided = 1
            rel material:binding = </World/NightLooks/Beam>
        }}'''
    looks = '\n'.join([
        material('Headlamp', (1, 0.95, 0.85), (1.0, 0.93, 0.78), rough=0.1),
        material('Headsign', (0.02, 0.01, 0.0), (1.0, 0.42, 0.04), rough=0.3),
        material('Tail', (0.45, 0.02, 0.01), (0.95, 0.06, 0.03), rough=0.2),
        material('Cabin', (0.004, 0.005, 0.008), (0.30, 0.28, 0.21), opacity=0.86, rough=0.05),
        material('Beam', (0, 0, 0), (1.0, 0.88, 0.66), texture=beam_png, rough=1),
    ])
    overrides = '\n'.join([bind('Headlamps', 'Headlamp'), bind('Headsign', 'Headsign'),
                           bind(bus['tail'], 'Tail'), bind('Glass', 'Cabin'), grade])
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
{overrides}
        }}
{beam}
    }}

    def Scope "NightLooks"
    {{
{looks}
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
}}
'''


def record(stage, png, width, work):
    path = os.path.join(work, 'stage.usda')
    open(path, 'w').write(stage)
    run('usdrecord', '--camera', '/World/Cam', '--disableCameraLight', '--complexity', 'high',
        '--imageWidth', str(width), path, png, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def render_bus(bus, out_dir, work):
    usdz = os.path.abspath(os.path.join(out_dir, bus['model']))
    assert os.path.exists(usdz), usdz
    beam_png = os.path.join(work, f'beams-{bus["sprite"]}.png')
    beam_texture(beam_png, bus['lamp_x'])
    grade = night_grade(usdz)

    span = bus['span'] * 10
    for k in range(SPRITE_FRAMES):
        turn = 180 - k * 360 / SPRITE_FRAMES
        frame = os.path.join(work, f'{bus["sprite"]}-{k:02d}.png')
        record(night_stage(bus, usdz, grade, beam_png, turn, SPRITE_ELEVATION, SPRITE_CY, span, span),
               frame, SPRITE_PX * 3, work)
        run('sips', '-Z', str(SPRITE_PX), frame, '--out', os.path.join(out_dir, f'{bus["sprite"]}-{k:02d}.png'),
            stdout=subprocess.DEVNULL)

    w, h = ICON_PT
    span = bus['icon_span'] * 10
    frame = os.path.join(work, f'{bus["icon"]}.png')
    record(night_stage(bus, usdz, grade, beam_png, ICON_YAW, ICON_ELEVATION, ICON_CY, span, span * h / w),
           frame, w * 9, work)
    run('sips', '-z', str(h * 3), str(w * 3), frame, '--out', os.path.join(out_dir, f'{bus["icon"]}.png'),
        stdout=subprocess.DEVNULL)
    print('rendered', bus['sprite'], bus['icon'])


def main(out_dir):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    work = tempfile.mkdtemp(prefix='night-buses-')
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
