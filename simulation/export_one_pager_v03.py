"""Experiment-informed English project one-pager. Proposed v0.3 != tested v0.2."""
import json
from pathlib import Path
from pypdf import PdfReader
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.lib import colors
from export_one_pager import p, W, PALE, MUTED

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT/'output/pdf/Agent_Economy_Arena_One_Pager_EN_v0.3.pdf'


def footer(canvas, doc):
    canvas.setStrokeColor(colors.HexColor('#D8E2E7'))
    canvas.setLineWidth(.5)
    canvas.line(46,38,A4[0]-46,38)
    canvas.setFont('Helvetica',7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(46,25,'PROJECT DESIGN  |  v0.3 PROPOSAL  |  September 2026')
    canvas.drawRightString(A4[0]-46,25,'SIMULATED ASSETS / NO REAL FUNDS')


def main():
    mixed=json.loads((ROOT/'results/minute30-mixed-verified/summary.json').read_text())
    control=json.loads((ROOT/'results/minute30-rational-verified/summary.json').read_text())
    assert mixed['active_rounds']==control['active_rounds']==30
    assert all(v==24 for v in control['participant_active_rounds'].values())
    paragraphs = [
        ('eyebrow','AGENT-TO-AGENT ECONOMY  /  EXPERIMENT-INFORMED DESIGN'),
        ('title','Agent Economy Arena'),
        ('tagline','Your agent. One decision a minute. A shared economy to explore.'),
        ('body','An online competition designed to make autonomous commerce tangible. Participants build their own agents, '
         'connect through planned MCP/API interfaces, and trade one virtual resource, COMPUTE, using simulated dollars (sUSD). '
         'The platform handles matching, settlement and rankings; participants control pricing and strategy.'),
        ('band',''),
        ('head','WHAT THE EXPERIMENT CHANGED'),
        ('body',f'The static market stopped trading once resources were allocated. Refreshing tasks each minute sustained '
         f'<b>trading in all 30 rounds</b>: {mixed["total_trades"]} trades with mixed strategies and {control["total_trades"]} '
         'with identical value-based agents. Yet each agent in the latter run traded in only <b>24 of 30 rounds</b>. '
         'Version 0.3 therefore retains fresh tasks and replaces neutral assignments with explicit buyer/seller roles.'),
        ('head','THE REVISED 30-MINUTE EXPERIENCE'),
        ('body','<b>Receive a role.</b> Each minute, half the agents receive buying tasks and half receive selling tasks, '
         'with different private resource values. Balanced rotation gives everyone equal exposure to roles and value profiles.'),
        ('body','<b>Decide once.</b> Submit one role-appropriate limit order, or pass, within 60 seconds. '
         'Agents see shared historical results but not other agents\' current orders. Execution remains conditional on compatible prices.'),
        ('body','<b>Clear and renew.</b> At the minute boundary, the platform matches compatible bids and asks, permits partial fills '
         'and expires unfilled orders. Each new round refreshes the 1,000 sUSD task budget and 10 COMPUTE units; '
         'cumulative profit and trade history persist. Round 30 closes at minute 30.'),
        ('head','A LEADERBOARD THAT REWARDS ECONOMIC RESULTS'),
        ('body','Score each round by cash plus privately valued remaining resources, minus starting asset value. '
         'Sum profits across 30 rounds; do not reward trading volume. The proposed prize competition uses participant agents '
         'without organizer-supplied, deliberately loss-making bots. Standings reflect this event\'s results; '
         'equal scores share a rank. Claims about strategy superiority require repeated evaluation.'),
        ('head','BUILT FOR PARTICIPANTS AND SPECTATORS'),
        ('body','Participants choose their model, code or prompts and run their own agents. Planned views show connection status, '
         'the current task, submitted or missed decisions, fills and profit. Spectators follow market activity and standings; '
         'a post-game replay explains outcomes. Prizes are separate from sUSD, which has no real-money redemption.'),
        ('head','VALIDATE THE REVISION, THEN OPEN THE PILOT'),
        ('body','Implement the new role schedule and test repeated 30-round sessions across multiple seeds and competent opponent pools. '
         'Check both market-wide activity and each agent\'s fill coverage. Then connect external agents, run a real 30-minute pilot, '
         'validate 30-50 participant capacity and deploy on the organizer\'s domain.'),
        ('small','Evidence boundary: reported counts are accelerated local v0.2 simulations, seed 20260911, not live event results. '
         'The v0.3 role design has not been implemented or tested. MCP/API access, real LLM behavior and online concurrency remain unvalidated.')
    ]
    story=[]
    for kind,text in paragraphs:
        if kind!='band':
            story.append(p(text,kind))
        else:
            band=Table([[p('30 minutes','stat'),p('30 decisions','stat'),p('30-50 people','stat')],
                        [p('One live session','small'),p('Per agent; fills not guaranteed','small'),p('Target online capacity','small')]],
                        colWidths=[W*.28,W*.39,W*.33])
            band.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),('LEFTPADDING',(0,0),(-1,-1),11),
                ('TOPPADDING',(0,0),(-1,0),9),('BOTTOMPADDING',(0,-1),(-1,-1),7),('VALIGN',(0,0),(-1,-1),'TOP')]))
            story.extend([Spacer(1,4),band,Spacer(1,3)])
    OUT.parent.mkdir(parents=True,exist_ok=True)
    doc=SimpleDocTemplate(str(OUT),pagesize=A4,leftMargin=46,rightMargin=46,topMargin=40,bottomMargin=49,
        title='Agent Economy Arena - Experiment-Informed Design v0.3',author='A2A Simulation')
    doc.build(story,onFirstPage=footer,onLaterPages=footer)
    reader=PdfReader(OUT)
    assert len(reader.pages)==1, f'Expected one page; got {len(reader.pages)}'
    text=' '.join(reader.pages[0].extract_text().split())
    for term in ['83 trades','120 with','24 of 30 rounds','has not been implemented or tested','60 seconds','Round 30 closes at minute 30']:
        assert term in text,term
    assert not any('\u4e00'<=c<='\u9fff' for c in text)
    print(json.dumps(dict(path=str(OUT),pages=1,words=len(text.split()),bytes=OUT.stat().st_size)))


if __name__=='__main__':
    main()
