"""Package the extension with Python's standard library."""
import argparse
import json
import re
import shutil
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'output/douyin-feed-filter.zip')
    args = parser.parse_args()
    source = ROOT / 'extension'
    manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
    if not re.fullmatch(r'\d+\.\d+\.\d+', manifest['version']):
        raise ValueError('Extension version must have exactly three numeric components')
    references = [manifest['action']['default_popup']]
    references.extend(manifest.get('icons', {}).values())
    for entry in manifest['content_scripts']:
        references.extend(entry['js'])
    for name in references:
        if not (source / name).is_file():
            raise FileNotFoundError(f'Missing extension file: {name}')
    args.output = args.output.resolve()
    destination = args.output.parent
    if destination == source.resolve() or destination.is_relative_to(source.resolve()):
        raise ValueError('Output directory must be outside the extension source directory')
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, destination, dirs_exist_ok=True)
    with ZipFile(args.output, 'w', ZIP_DEFLATED) as archive:
        for file in sorted(source.rglob('*')):
            if file.is_file():
                archive.write(file, file.relative_to(source))
    with ZipFile(args.output) as archive:
        corrupt = archive.testzip()
        if corrupt:
            raise RuntimeError(f'Corrupt archive member: {corrupt}')
        if json.loads(archive.read('manifest.json')) != manifest:
            raise RuntimeError('Packaged manifest differs from source')
    print(f"Built {args.output} (version {manifest['version']})")
    print(f"Unpacked extension: {destination}")

if __name__ == '__main__':
    main()
