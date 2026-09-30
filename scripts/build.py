"""Package the extension with Python's standard library."""
import argparse
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'outputs/douyin-feed-filter.zip')
    args = parser.parse_args()
    source = ROOT / 'extension'
    manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
    references = [manifest['action']['default_popup']]
    references.extend(manifest.get('icons', {}).values())
    for entry in manifest['content_scripts']:
        references.extend(entry['js'])
    for name in references:
        if not (source / name).is_file():
            raise FileNotFoundError(f'Missing extension file: {name}')
    args.output.parent.mkdir(parents=True, exist_ok=True)
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

if __name__ == '__main__':
    main()
