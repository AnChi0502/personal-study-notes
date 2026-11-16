"""Extract supplied Word notes without adding subject matter. Originals stay untouched."""
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT.parent
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
SOURCES = [
    ('pr-week-02', '公關策略與企劃', 'Week 2', DESKTOP / '【公關策略與企劃】Week2.docx'),
    ('japan-week-07', '日本歷史', 'Week 7：中世紀', ROOT / '.work/japan-week-7.docx'),
    ('japan-week-08', '日本歷史', 'Week 8：中世紀', ROOT / '.work/japan-week-8.docx'),
    ('digital-marketing-midterm', '數位行銷企劃實務', '期中考筆記', DESKTOP / '【數位行銷企劃實務】期中考筆記.docx'),
]

# Reviewed subsection labels from these supplied notes. Bullet symbols and text
# length alone do not distinguish a heading from an ordinary list item.
JAPAN_SUBHEADINGS = {
    'japan-week-07': {'○莊園：', '○內亂：', '○平氏政權（六波羅政權）：'},
    'japan-week-08': {'○南北朝對立（1336〜1392）'},
}

def text(node):
    # Ruby readings duplicate their base text; retain the base characters only.
    if node.tag == W + 'rt':
        return ''
    if node.tag == W + 't':
        return node.text or ''
    if node.tag == W + 'tab':
        return '　'
    if node.tag == W + 'br':
        return '\n'
    return ''.join(text(child) for child in node)

notes = []
audit = []
for slug, course, title, source in SOURCES:
    with zipfile.ZipFile(source) as archive:
        document = ET.fromstring(archive.read('word/document.xml'))
        rels = ET.fromstring(archive.read('word/_rels/document.xml.rels'))
        targets = {r.attrib['Id']: r.attrib['Target'] for r in rels}
        blocks = ['# ' + title]
        source_paragraphs = []
        image_count = 0
        for paragraph in document.find(W + 'body'):
            if paragraph.tag != W + 'p':
                continue
            value = text(paragraph).strip()
            if value:
                source_paragraphs.append(value)
                num = paragraph.find(W + 'pPr/' + W + 'numPr')
                prefix = ''
                if slug == 'pr-week-02' and num is not None:
                    level = num.find(W + 'ilvl').get(W + 'val')
                    prefix = '## ' if level == '0' else '- '
                elif slug == 'digital-marketing-midterm' and num is not None:
                    number = num.find(W + 'numId').get(W + 'val')
                    prefix = '## ' if number == '1' else '- ' if number == '4' else '### '
                elif slug.startswith('japan'):
                    if re.match(r'^【[^】]+】', value):
                        prefix = '## '
                    elif value in JAPAN_SUBHEADINGS.get(slug, set()):
                        prefix = '### '
                    elif num is not None:
                        prefix = '- '
                # Preserve original wording, including unresolved references.
                if '補圖' in value or '畫一張圖在這' in value:
                    value += ' ［待補充］'.replace('［', '[').replace('］', ']')
                blocks.append(prefix + value.replace('\n', '  \n'))
            for blip in paragraph.iter(A + 'blip'):
                target = targets.get(blip.get(R + 'embed'))
                if not target:
                    continue
                image_count += 1
                suffix = Path(target).suffix.lower()
                name = f'{slug}-{image_count:02}{suffix}'
                (ROOT / 'assets' / name).write_bytes(archive.read('word/' + target))
                blocks.append(f'![原筆記圖片 {image_count}](assets/{name})')
        markdown = '\n\n'.join(blocks) + '\n'
        path = f'notes/{slug}.md'
        (ROOT / path).write_text(markdown, encoding='utf-8')
        notes.append(dict(id=slug, title=title, course=course, path=path))
        # Every source paragraph must survive verbatim, aside from line-break formatting.
        assert all(p.replace('\n', '  \n') in markdown for p in source_paragraphs)
        audit.append(dict(id=slug, paragraphs=len(source_paragraphs), images=image_count))
(ROOT / 'notes/index.json').write_text(json.dumps(notes, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(audit, ensure_ascii=False, indent=2))
