"""Render integrated proposal sources; verify recorded evidence without rerunning markets."""
import hashlib
import json
import re
from pathlib import Path
from xml.sax.saxutils import escape

from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'output/pdf'
INK = colors.HexColor('#012169')
TEXT = colors.HexColor('#25334A')
MUTED = colors.HexColor('#637187')
PALE = colors.HexColor('#EFF4FC')
LINE = colors.HexColor('#D5DFED')
W = A4[0] - 88


def verify_evidence():
    main = json.loads((ROOT/'results/main/analysis.json').read_text())
    assert main['rounds'] == 100 and len(main['leaderboard']) == 10
    assert main['market']['trades'] == 9540 and main['significant_pairs'] == 30
    assert main['independent_blocks'] == 20 and len(main['pairwise']) == 45
    for folder in ('main', 'control', 'minute30-mixed-verified', 'minute30-rational-verified'):
        manifest = json.loads((ROOT/'results'/folder/'manifest.json').read_text())
        for name, digest in manifest.get('output_hashes', {}).items():
            assert hashlib.sha256((ROOT/'results'/folder/name).read_bytes()).hexdigest() == digest, name
    for folder, trades in [('minute30-mixed-verified',83),('minute30-rational-verified',120)]:
        data=json.loads((ROOT/'results'/folder/'summary.json').read_text())
        assert data['accelerated'] is True and data['actual_wall_seconds'] is None
        assert data['active_rounds'] == data['rounds'] == 30 and data['total_trades'] == trades


def markup(text):
    value=escape(text)
    value=re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', value)
    return value.replace('`','')


def build(language):
    cn=language=='CN'
    normal,bold=('CN','CN-Bold') if cn else ('Helvetica','Helvetica-Bold')
    size,leading=(10,16) if cn else (9.15,12.4)
    styles={
        'title':ParagraphStyle('title',fontName=bold,fontSize=23 if cn else 25,leading=30,textColor=INK,spaceAfter=12),
        'h':ParagraphStyle('h',fontName=bold,fontSize=12 if cn else 9.3,leading=18 if cn else 12.5,
            textColor=INK,spaceBefore=13 if cn else 8,spaceAfter=6 if cn else 4,keepWithNext=True),
        'body':ParagraphStyle('body',fontName=normal,fontSize=size,leading=leading,textColor=TEXT,
            spaceAfter=8 if cn else 6,wordWrap='CJK' if cn else None),
        'small':ParagraphStyle('small',fontName=normal,fontSize=8 if cn else 7.6,leading=12 if cn else 10,
            textColor=MUTED,spaceAfter=6,wordWrap='CJK' if cn else None),
        'tag':ParagraphStyle('tag',fontName=normal,fontSize=10.5,leading=15,textColor=MUTED,spaceAfter=6),
        'cell':ParagraphStyle('cell',fontName=normal,fontSize=9,leading=14,textColor=TEXT,wordWrap='CJK'),
    }
    source=ROOT/('PROJECT_PROPOSAL_CN.md' if cn else 'PROJECT_ONE_PAGER_EN.md')
    blocks=source.read_text().strip().split('\n\n')
    story=[]
    for i,block in enumerate(blocks):
        if block.startswith('# '):
            story.append(Paragraph(markup(block[2:]),styles['title']))
        elif block.startswith('## '):
            if cn and block[3:] in ('双代币市场','排行榜与奖品','活动组织'):
                story.append(PageBreak())
            story.append(Paragraph(markup(block[3:]),styles['h']))
        elif block.startswith('|'):
            rows=[[c.strip() for c in line.strip().strip('|').split('|')] for line in block.splitlines()]
            rows=[r for r in rows if not all(re.fullmatch(r'[-: ]+',c) for c in r)]
            widths=[W*.19,W*.81] if len(rows[0])==2 else [W*.24,W*.40,W*.36]
            table=Table([[Paragraph(markup(c),styles['cell']) for c in row] for row in rows],colWidths=widths,repeatRows=1)
            table.setStyle(TableStyle([
                ('BACKGROUND',(0,0),(-1,0),PALE),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#F8FAFD')]),
                ('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),
                ('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),
                ('LINEBELOW',(0,0),(-1,0),.6,LINE)]))
            story.extend([table,Spacer(1,9)])
        else:
            key='tag' if not cn and i==1 else 'body'
            if block.startswith(('以上均为','本地记录批次','These results','Evidence:')):
                key='small'
            story.append(Paragraph(markup(block),styles[key]))
    filename='Agent_Trading_Competition_Proposal_CN.pdf' if cn else 'Agent_Trading_Competition_One_Pager_EN.pdf'
    path=OUT/filename

    def decorate(c,doc):
        c.saveState()
        c.setStrokeColor(INK); c.setLineWidth(2)
        c.line(44,A4[1]-27,78,A4[1]-27)
        c.setFillColor(MUTED); c.setFont(normal,7)
        c.drawString(87,A4[1]-29,'AGENT ECONOMY  /  EDUCATIONAL COMPETITION')
        c.setStrokeColor(LINE); c.setLineWidth(.5); c.line(44,35,A4[0]-44,35)
        c.drawString(44,23,'September 2026  |  Project proposal  |  Test assets only')
        c.drawRightString(A4[0]-44,23,str(doc.page))
        c.restoreState()

    doc=SimpleDocTemplate(str(path),pagesize=A4,leftMargin=44,rightMargin=44,topMargin=44,bottomMargin=47,
        title='Agent-to-Agent Trading Competition - '+('Integrated Proposal' if cn else 'One Pager'),author='A2A Simulation')
    doc.build(story,onFirstPage=decorate,onLaterPages=decorate)
    reader=PdfReader(path)
    text=' '.join(page.extract_text() for page in reader.pages)
    if not cn:
        assert len(reader.pages)==1, f'English one pager has {len(reader.pages)} pages'
        assert not any('\u4e00'<=c<='\u9fff' for c in text)
    for value in ['9,540','83','120','MCP/API','DUSD','DAT']:
        assert value in text, value
    for value in ['COMPUTE','非目标','取舍','P0','P1']:
        assert value not in text,value
    assert '\ufffd' not in text and '\u25a0' not in text
    return {'path':str(path),'pages':len(reader.pages),'words':len(text.split()),'bytes':path.stat().st_size}


if __name__=='__main__':
    verify_evidence()
    pdfmetrics.registerFont(TTFont('CN','/System/Library/Fonts/STHeiti Light.ttc',subfontIndex=0))
    pdfmetrics.registerFont(TTFont('CN-Bold','/System/Library/Fonts/STHeiti Medium.ttc',subfontIndex=0))
    pdfmetrics.registerFontFamily('CN',normal='CN',bold='CN-Bold',italic='CN',boldItalic='CN-Bold')
    OUT.mkdir(parents=True,exist_ok=True)
    print(json.dumps([build('CN'),build('EN')],ensure_ascii=False))
