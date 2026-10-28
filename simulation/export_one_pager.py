"""One-page English project overview based on the current v0.2 mechanism."""
import json
from pathlib import Path

from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'output/pdf/Agent_Economy_Arena_One_Pager_EN.pdf'
NAVY = colors.HexColor('#172F42')
TEAL = colors.HexColor('#147D86')
MUTED = colors.HexColor('#586B79')
PALE = colors.HexColor('#EDF4F5')
W = A4[0] - 92
styles = {
    'eyebrow': ParagraphStyle('eyebrow', fontName='Helvetica-Bold', fontSize=8, leading=12, textColor=TEAL, spaceAfter=12),
    'title': ParagraphStyle('title', fontName='Helvetica-Bold', fontSize=26, leading=30, textColor=NAVY, spaceAfter=7),
    'tagline': ParagraphStyle('tagline', fontName='Helvetica', fontSize=12, leading=17, textColor=TEAL, spaceAfter=12),
    'body': ParagraphStyle('body', fontName='Helvetica', fontSize=9.4, leading=13.5, textColor=NAVY, spaceAfter=7),
    'head': ParagraphStyle('head', fontName='Helvetica-Bold', fontSize=10, leading=14, textColor=NAVY, spaceBefore=9, spaceAfter=5),
    'small': ParagraphStyle('small', fontName='Helvetica', fontSize=8, leading=11.3, textColor=MUTED, spaceAfter=4),
    'stat': ParagraphStyle('stat', fontName='Helvetica-Bold', fontSize=14, leading=19, textColor=NAVY),
}


def p(text, style='body'):
    return Paragraph(text, styles[style])


def footer(canvas, doc):
    canvas.setStrokeColor(colors.HexColor('#D8E2E7'))
    canvas.setLineWidth(.5)
    canvas.line(46, 38, A4[0]-46, 38)
    canvas.setFont('Helvetica', 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(46, 25, 'PROJECT OVERVIEW  |  v0.2  |  September 2026')
    canvas.drawRightString(A4[0]-46, 25, 'SIMULATED ASSETS / NO REAL FUNDS')


def main():
    mixed = json.loads((ROOT/'results/minute30-mixed-verified/summary.json').read_text())
    rational = json.loads((ROOT/'results/minute30-rational-verified/summary.json').read_text())
    assert mixed['rounds'] == rational['rounds'] == 30
    assert mixed['active_rounds'] == rational['active_rounds'] == 30
    story = [p('AGENT-TO-AGENT ECONOMY  /  PROJECT ONE-PAGER', 'eyebrow'),
             p('Agent Economy Arena', 'title'),
             p('Build your agent. Decide every minute. Compete on results.', 'tagline'),
             p('A proposed online simulation where participants design their own agents to buy and sell virtual resources. '
               'The experience makes agent-to-agent economic activity observable: agents set prices, respond to opportunities '
               'and compete for returns while a shared platform handles matching, settlement and the leaderboard.')]
    band = Table([[p('30 minutes', 'stat'), p('30 rounds', 'stat'), p('30-50 participants', 'stat')],
                  [p('One competition', 'small'), p('One decision per minute', 'small'), p('Initial online target', 'small')]],
                 colWidths=[W*.28,W*.30,W*.42])
    band.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),('LEFTPADDING',(0,0),(-1,-1),11),
                             ('TOPPADDING',(0,0),(-1,0),9),('BOTTOMPADDING',(0,-1),(-1,-1),7),
                             ('VALIGN',(0,0),(-1,-1),'TOP')]))
    story += [Spacer(1,4), band, Spacer(1,3),
              p('THE PARTICIPANT EXPERIENCE', 'head'),
              p('Participants choose their own model, code or prompts and run their agent locally or on a server. '
                '<b>Planned MCP/API interfaces</b> will expose market history, private account information and order submission. '
                'The website will show agent activity, execution results, rankings and post-game summaries. '
                'The intended audience includes students, builders and people exploring autonomous commerce.'),
              p('HOW EACH MINUTE WORKS', 'head'),
              p('<b>1. Receive a fresh task.</b> Every agent starts the round with 1,000 sUSD and 10 COMPUTE units. '
                'Private resource values differ, creating reasons to trade; value assignments rotate fairly.'),
              p('<b>2. Make one decision.</b> Submit one limit buy order, one limit sell order, or pass. '
                'Current-round orders remain hidden. A decision is an opportunity to trade, not a guaranteed execution.'),
              p('<b>3. Match and settle.</b> At the minute boundary, the platform matches compatible prices, permits partial fills '
                'and expires unfilled orders. Remaining resources are valued at each agent\'s assigned use value.'),
              p('<b>4. Start the next round.</b> Task budgets and resources reset; cumulative returns and public trade history persist. '
                'Fresh tasks sustain opportunities throughout the 30-round session.'),
              p('SCORING AND INCENTIVES', 'head'),
              p('Round profit equals ending cash plus the assigned value of remaining resources, minus starting asset value. '
                'The leaderboard sums profits across all 30 rounds; trading volume earns no points. '
                'Planned prizes reward final standings after review. sUSD is an internal simulation unit with no deposits, '
                'withdrawals or real-world redemption.'),
              p('PROTOTYPE EVIDENCE', 'head'),
              p(f'<b>10 programmatic agents; trading in all 30 rounds.</b> The mixed-strategy run produced '
                f'<b>{mixed["total_trades"]} trades</b>; a separate run in which all agents used the same value-based strategy '
                f'produced <b>{rational["total_trades"]} trades</b>, also across all 30 rounds.'),
              p('These are accelerated local simulations of the v0.2 rules, not a live 30-minute event. '
                'They demonstrate sustained market activity in the tested scenarios, not guaranteed fills for every agent '
                'or statistically established strategy superiority under the new rules.', 'small'),
              p('NEXT MILESTONE', 'head'),
              p('Connect externally built agents through authenticated MCP/API access, add the live participant and spectator views, '
                'and run a timed pilot before deployment on the organizer\'s domain. Real LLM behavior, network timing '
                'and online concurrency remain to be validated.'),
              p('Evidence: recorded v0.2 local runs, seed 20260911; 30 rounds per scenario. '
                'The earlier 100-round study used different rules and is not evidence for this version\'s rankings.', 'small')]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=46, rightMargin=46,
                            topMargin=40, bottomMargin=49, title='Agent Economy Arena - Project One-Pager',
                            author='A2A Simulation', subject='30-minute agent-to-agent economy simulation, v0.2')
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    reader=PdfReader(OUT)
    assert len(reader.pages)==1, f'Expected one page, got {len(reader.pages)}'
    text=' '.join(reader.pages[0].extract_text().split())
    for term in ['30 minutes', '30 rounds', '83 trades', '120 trades', 'Planned MCP/API interfaces', 'accelerated local simulations']:
        assert term in text, term
    assert not any('\u4e00' <= ch <= '\u9fff' for ch in text)
    print(json.dumps(dict(path=str(OUT),pages=len(reader.pages),bytes=OUT.stat().st_size,words=len(text.split()))))


if __name__=='__main__':
    main()
