"""
Turns the 3D Warehouse "Bas Rapid KL" USDZ (HALIM3D, placeholder until a
licensed model replaces it) into ios/Assets/RapidBus.usdz.

The output is gitignored (the model isn't ours to publish), so each checkout
rebuilds it. The source is the model's own USDZ on 3D Warehouse
(https://3dwarehouse.sketchup.com/model/3175766f-f0fd-4e1b-abee-a0bd7ecd8d63),
from its public AR download:
  curl -L -o /tmp/bas.usdz https://download-warehouse.sketchup.com/warehouse/v1.0/content/public/8acab2a9-ec73-4fde-955f-922073f97007

Usage, from modules/bus-model (macOS; usdcat, usdzip and sips ship with the OS),
then `pod install` and rebuild:
  python3 -I scripts/prepare-rapid-bus.py /tmp/bas.usdz ios/Assets/RapidBus.usdz

Any replacement model must meet the same contract, which BusModelView relies on:
  - Y-up, metres, ground at y = 0, centred on x and z, front facing +Z.
  - The front destination sign is a prim named `Headsign`: one quad, UVs 0..1
    left-to-right and bottom-to-top, about 9:1 wide.

The SketchUp export makes every material half-metal (metallic 0.5), which
reads as grey and dirty under image-based lighting. This script repaints the
livery in linear-space brand colours, makes the paint glossy with a clear coat,
tints the glass, and shrinks the 4526 px headsign (the app draws its own).
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

# Linear-space colours. RapidKL red, cream and blue, from the sRGB livery
# #E01E26, #F2E2C2 and #1B2E8F.
RED = (0.745, 0.013, 0.019)
CREAM = (0.888, 0.760, 0.539)
BLUE = (0.011, 0.027, 0.275)

PAINT = dict(metallic=0, roughness=0.32, clearcoat=1, clearcoatRoughness=0.06)
TRIM = dict(metallic=0, roughness=0.55)

# Material name prefix → overrides. `diffuseColor` is a 3-tuple.
LOOKS = {
    'black1': dict(TRIM, diffuseColor=(0.012, 0.012, 0.014)),
    '_0012_Bisque': dict(PAINT, diffuseColor=CREAM),
    '_0106_DarkBlue': dict(PAINT, diffuseColor=BLUE),
    '_0020_Red': dict(PAINT, diffuseColor=RED),
    'glassblk1': dict(metallic=0, roughness=0.18, diffuseColor=(0.01, 0.011, 0.013)),
    '_0039_DarkOrange': dict(metallic=0, roughness=0.2, emissiveColor=(0.6, 0.25, 0)),
    '_0052_FloralWhite': dict(metallic=0, roughness=0.15, emissiveColor=(0.35, 0.35, 0.33)),
    'glass1_0': dict(
        metallic=0, roughness=0.04, clearcoat=1, clearcoatRoughness=0.02,
        opacity=0.42, diffuseColor=(0.008, 0.012, 0.016),
    ),
    'plastic1': dict(TRIM, diffuseColor=(0.02, 0.02, 0.022)),
    'body1': dict(TRIM),
    'rapidjpg': dict(PAINT),
    '_0137_Black': dict(TRIM, diffuseColor=(0.01, 0.01, 0.012)),
    '_0023_FireBrick': dict(metallic=0, roughness=0.2, emissiveColor=(0.35, 0.02, 0.02)),
    '_0024_OrangeRed': dict(metallic=0, roughness=0.2, emissiveColor=(0.45, 0, 0)),
    'Color_000': dict(TRIM),
    'tyre1': dict(metallic=0, roughness=0.92, diffuseColor=(0.018, 0.018, 0.02)),
    'wheel1': dict(metallic=0.9, roughness=0.32, diffuseColor=(0.55, 0.56, 0.58)),
    'Bussignage': dict(metallic=0, roughness=0.6),
}

# Inches (in the source's own units, before its 0.0254 scale) → the source
# bounds, measured from the meshes' extents.
X_MID, Y_MID = 62.0, -207.0
INCH = 0.0254


def run(*args):
    subprocess.run(args, check=True)


def fmt(v):
    return f'({", ".join(f"{c:g}" for c in v)})' if isinstance(v, tuple) else f'{v:g}'


def repaint(block, looks):
    # The source sets every UsdPreviewSurface input explicitly; drop the ones
    # that only confuse RealityKit, then set ours.
    block = re.sub(r'\n\s*(float inputs:displacement|color3f inputs:specularColor)[^\n]*', '', block)
    for key, value in looks.items():
        kind = 'color3f' if isinstance(value, tuple) else 'float'
        line = f'{kind} inputs:{key} = {fmt(value)}'
        pattern = rf'{kind} inputs:{key} = [^\n]*'
        if key == 'diffuseColor' and 'inputs:diffuseColor.connect' in block:
            continue  # textured: keep the texture's colour
        if re.search(pattern, block):
            block = re.sub(pattern, line, block, count=1)
        else:
            block = block.replace(
                'uniform token info:id = "UsdPreviewSurface"',
                f'uniform token info:id = "UsdPreviewSurface"\n                        {line}',
                1,
            )
    return block


def main(src, out):
    work = tempfile.mkdtemp(prefix='rapid-bus-')
    with zipfile.ZipFile(src) as z:
        z.extractall(work)
    usda = os.path.join(work, 'model.usda')
    run('usdcat', os.path.join(work, 'model.usdc'), '--out', usda)
    text = open(usda).read()

    # Y-up, front to +Z, centred, ground at 0: (x, y, z) → (x, z, -y), in
    # metres (USD matrices are row-vector, translation in the last row).
    text = text.replace('upAxis = "Z"', 'upAxis = "Y"')
    tx, tz = -X_MID * INCH, Y_MID * INCH
    root = (
        f'matrix4d xformOp:transform = ( (1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), '
        f'({tx:g}, 0, {tz:g}, 1) )'
    )
    text = text.replace(
        'matrix4d xformOp:transform = ( (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1) )',
        root,
        1,
    )

    # Schema fixes `usdchecker --arkit` asks for: meshes declare the binding
    # API, primvar readers take a string, and a constant occlusion of 1 is noise.
    text = re.sub(
        r'(def Mesh "[^"]+")\n(\s*)\{',
        r'\1 (\n\2    prepend apiSchemas = ["MaterialBindingAPI"]\n\2)\n\2{',
        text,
    )
    text = text.replace('token inputs:varname = "st"', 'string inputs:varname = "st"')
    text = re.sub(r'\n\s*float inputs:occlusion = 1\n', '\n', text)
    # A shader can't contain another: lift each UV reader out of its texture.
    text = re.sub(
        r'\n(\s*)    def Shader "(TexCoordReader\d+)"\n\s*\{\n(.*?)\n\s*\}\n(\s*)\}',
        lambda m: (
            f'\n{m.group(4)}}}\n\n{m.group(4)}def Shader "{m.group(2)}"\n{m.group(4)}{{\n'
            + '\n'.join(f'{m.group(4)}    {line.strip()}' for line in m.group(3).split('\n'))
            + f'\n{m.group(4)}}}'
        ),
        text,
        flags=re.S,
    )
    text = re.sub(r'/(Texture\d+)/(TexCoordReader\d+)\.', r'/\2.', text)

    # The headsign keeps a stable name; the invisible pane over it goes.
    text = text.replace('Geom3D18', 'Headsign')
    text = text.replace('def Xform "Geom3D8"\n', 'def Xform "Geom3D8" (\n                active = false\n            )\n', 1)

    # Textures: no spaces in names, headsign shrunk to a fallback.
    os.makedirs(os.path.join(work, 'textures'), exist_ok=True)
    run('sips', '-z', '113', '1024', os.path.join(work, '0', 'Bus signage.jpg'),
        '--out', os.path.join(work, 'textures', 'headsign.jpg'))
    shutil.copy(os.path.join(work, '0', 'rapidipoh copy.jpg'), os.path.join(work, 'textures', 'logo.jpg'))
    text = text.replace('@0/Bus signage.jpg@', '@textures/headsign.jpg@')
    text = text.replace('@0/rapidipoh copy.jpg@', '@textures/logo.jpg@')

    parts = re.split(r'(?=\n\s*def Material ")', text)
    for i, part in enumerate(parts):
        m = re.match(r'\n\s*def Material "([^"]+)"', part)
        if not m:
            continue
        for prefix, looks in LOOKS.items():
            if m.group(1).startswith(prefix):
                end = part.find('\n                def Mesh')
                end = len(part) if end < 0 else end
                parts[i] = repaint(part[:end], looks) + part[end:]
                break
    open(usda, 'w').write(''.join(parts))

    usdc = os.path.join(work, 'RapidBus.usdc')
    run('usdcat', usda, '--out', usdc)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    if os.path.exists(out):
        os.remove(out)
    cwd = os.getcwd()
    os.chdir(work)
    try:
        run('usdzip', os.path.join(cwd, out), 'RapidBus.usdc', 'textures/headsign.jpg', 'textures/logo.jpg')
    finally:
        os.chdir(cwd)
    shutil.rmtree(work)
    render_map_sprites(os.path.abspath(out), os.path.dirname(os.path.abspath(out)))
    render_icon(os.path.abspath(out), os.path.dirname(os.path.abspath(out)))


# The map's tiny buses: one frame per 15° of heading, seen from the south at
# 55° above the map, so a turn shows the bus's sides as well as its roof.
# Frame k heads k × 15° clockwise from north (screen up). Square, with the
# bus's centre at the image centre so the marker sits on its coordinate.
SPRITE_FRAMES = 24
SPRITE_ELEVATION = 55
SPRITE_PX = 132  # 44 pt @3x
SPRITE_SPAN_M = 12  # metres across the frame: the bus's turn plus a margin


def render_map_sprites(usdz, out_dir):
    work = tempfile.mkdtemp(prefix='rapid-bus-sprites-')
    e = SPRITE_ELEVATION
    import math
    cy, d = 1.5, 50.0
    stage = f'''#usda 1.0
(
    defaultPrim = "World"
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "World"
{{
    def Xform "Turn"
    {{
        float xformOp:rotateY = TURN
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
        float horizontalAperture = {SPRITE_SPAN_M * 10}
        float verticalAperture = {SPRITE_SPAN_M * 10}
        float2 clippingRange = (1, 1000)
        double3 xformOp:translate = (0, {cy + d * math.sin(math.radians(e)):g}, {d * math.cos(math.radians(e)):g})
        float xformOp:rotateX = {-e}
        uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateX"]
    }}

    def DistantLight "Sun"
    {{
        float inputs:intensity = 2.2
        float xformOp:rotateY = -35
        float xformOp:rotateX = -55
        uniform token[] xformOpOrder = ["xformOp:rotateY", "xformOp:rotateX"]
    }}

    def DomeLight "Sky"
    {{
        float inputs:intensity = 0.9
    }}
}}
'''
    # One stage per heading: usdrecord's frame-range naming breaks past 9.
    # Rendered at 3x and shrunk, for clean edges at marker size.
    for k in range(SPRITE_FRAMES):
        path = os.path.join(work, f'heading{k:02d}.usda')
        open(path, 'w').write(stage.replace('TURN', f'{180 - k * 360 / SPRITE_FRAMES:g}'))
        frame = os.path.join(work, f'heading{k:02d}.png')
        subprocess.run(
            ['usdrecord', '--camera', '/World/Cam', '--disableCameraLight', '--complexity', 'high',
             '--imageWidth', str(SPRITE_PX * 3), path, frame],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        run('sips', '-Z', str(SPRITE_PX), frame, '--out', os.path.join(out_dir, f'map-bus-{k:02d}.png'))
    shutil.rmtree(work)


# The bus pill's icon: the bus three-quarters on, its front to the right
# (toward the route and stop), seen from just above, as the trip sheet's 3D
# bus rests. 44 × 36 pt, the bus centred with a little room either side.
ICON_PT = (44, 36)
ICON_YAW = 38  # degrees from facing the camera; 90 is side-on
ICON_ELEVATION = 12
ICON_SPAN_M = 9.2  # metres across the image


def render_icon(usdz, out_dir):
    import math
    work = tempfile.mkdtemp(prefix='rapid-bus-icon-')
    e = ICON_ELEVATION
    cy, d = 1.4, 50.0
    w, h = ICON_PT
    stage = f'''#usda 1.0
(
    defaultPrim = "World"
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "World"
{{
    def Xform "Turn"
    {{
        float xformOp:rotateY = {ICON_YAW}
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
        float horizontalAperture = {ICON_SPAN_M * 10:g}
        float verticalAperture = {ICON_SPAN_M * 10 * h / w:g}
        float2 clippingRange = (1, 1000)
        double3 xformOp:translate = (0, {cy + d * math.sin(math.radians(e)):g}, {d * math.cos(math.radians(e)):g})
        float xformOp:rotateX = {-e}
        uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateX"]
    }}

    def DistantLight "Sun"
    {{
        float inputs:intensity = 2.2
        float xformOp:rotateY = 35
        float xformOp:rotateX = -40
        uniform token[] xformOpOrder = ["xformOp:rotateY", "xformOp:rotateX"]
    }}

    def DomeLight "Sky"
    {{
        float inputs:intensity = 1
    }}
}}
'''
    path = os.path.join(work, 'icon.usda')
    open(path, 'w').write(stage)
    frame = os.path.join(work, 'icon.png')
    subprocess.run(
        ['usdrecord', '--camera', '/World/Cam', '--disableCameraLight', '--complexity', 'high',
         '--imageWidth', str(w * 9), path, frame],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    run('sips', '-z', str(h * 3), str(w * 3), frame, '--out', os.path.join(out_dir, 'pill-bus.png'))
    shutil.rmtree(work)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
