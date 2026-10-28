"""Create a Chinese release-test summary and an English one-pager from verified evidence."""
import json
import sys
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from pypdf import PdfReader

ROOT=Path(__file__).resolve().parent.parent
PREVIEW='--preview' in sys.argv
OUT=ROOT/('tmp/pdfs' if PREVIEW else 'output/pdf')
OUT.mkdir(parents=True,exist_ok=True)
READ=lambda name:json.loads((ROOT/'reports'/name).read_text())
real=READ('run-acceptance-1789185138604.json' if PREVIEW else 'run-acceptance-1789186009126.json')
fast=READ('run-acceptance-1789185138604.json')
large=READ('run-acceptance-1789185337815.json')
unit,runtime,browser=[READ(f) for f in ('unit.json','runtime.json','browser-production.json')]
remote=READ(sorted(p.name for p in (ROOT/'reports').glob('load-remote-*.json'))[-1])
version='PREVIEW' if PREVIEW else READ('release-deployment.json')['version']
assert unit['success'] and runtime['success'] and browser['stats']['unexpected']==0
assert not real['errors'] and all(a['decisions']==30 for a in real['summary']['leaderboard'])
if not PREVIEW:
    assert real['elapsedSeconds']>=1800 and real['roundMs']==60000
    assert len(real['summary']['leaderboard'])==50 and len(real['summary']['results'])==30

pdfmetrics.registerFont(TTFont('CN','/System/Library/Fonts/STHeiti Light.ttc',subfontIndex=0))
pdfmetrics.registerFont(TTFont('CN-Bold','/System/Library/Fonts/STHeiti Medium.ttc',subfontIndex=0))
pdfmetrics.registerFontFamily('CN',normal='CN',bold='CN-Bold',italic='CN',boldItalic='CN-Bold')
GREEN=colors.HexColor('#277151');INK=colors.HexColor('#263C32');MUTED=colors.HexColor('#738078');PALE=colors.HexColor('#EAF2E7');LINE=colors.HexColor('#DDE5DA')
WIDTH=A4[0]-88
def styles(cn=True):
    regular,bold=('CN','CN-Bold') if cn else ('Helvetica','Helvetica-Bold')
    return {
      'title':ParagraphStyle('title',fontName=bold,fontSize=24,leading=31,textColor=INK,spaceAfter=10),
      'subtitle':ParagraphStyle('subtitle',fontName=regular,fontSize=11,leading=17,textColor=GREEN,spaceAfter=15),
      'h':ParagraphStyle('h',fontName=bold,fontSize=12 if cn else 10.5,leading=17,textColor=GREEN,spaceBefore=12,spaceAfter=7,keepWithNext=True),
      'body':ParagraphStyle('body',fontName=regular,fontSize=9.7 if cn else 9.5,leading=15 if cn else 13.7,textColor=INK,spaceAfter=8,wordWrap='CJK' if cn else None),
      'small':ParagraphStyle('small',fontName=regular,fontSize=8,leading=11.5,textColor=MUTED,spaceAfter=6,wordWrap='CJK' if cn else None),
      'cell':ParagraphStyle('cell',fontName=regular,fontSize=8.3,leading=12,textColor=INK,wordWrap='CJK' if cn else None),
    }
def clean(text):
    for ch in '\u2010\u2011\u2012\u2013\u2014\u2015':text=text.replace(ch,'-')
    return escape(text)
def p(text,sty):return Paragraph(clean(text),sty)
def table(rows,widths,sty):
    t=Table([[p(str(x),sty) for x in row] for row in rows],colWidths=widths,repeatRows=1)
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),PALE),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#F8FAF6')]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('LINEBELOW',(0,0),(-1,0),.6,LINE)]))
    return t
def build(filename,story,cn=True):
    path=OUT/(('preview-' if PREVIEW else '')+filename)
    def frame(c,doc):
        c.setStrokeColor(GREEN);c.setLineWidth(2);c.line(44,A4[1]-28,78,A4[1]-28)
        c.setFont('Helvetica',7.5);c.setFillColor(MUTED);c.drawString(87,A4[1]-30,'AGENT EXCHANGE  /  MCP + API SIMULATION')
        c.setStrokeColor(LINE);c.setLineWidth(.5);c.line(44,36,A4[0]-44,36)
        c.drawString(44,24,'September 2026  |  andycui.com  |  Virtual assets only')
        c.drawRightString(A4[0]-44,24,str(doc.page))
        if PREVIEW:c.setFillColor(colors.HexColor('#B86632'));c.drawRightString(A4[0]-44,A4[1]-30,'LAYOUT PREVIEW - FINAL ENDURANCE PENDING')
    doc=SimpleDocTemplate(str(path),pagesize=A4,leftMargin=44,rightMargin=44,topMargin=48,bottomMargin=49,title='Agent Exchange - '+('Release Test Report' if cn else 'One Pager'),author='Jiaming Cui')
    doc.build(story,onFirstPage=frame,onLaterPages=frame)
    reader=PdfReader(path);text='\n'.join(page.extract_text() for page in reader.pages)
    assert '\ufffd' not in text and '\u25a0' not in text
    if not cn:assert len(reader.pages)==1
    return {'path':str(path),'pages':len(reader.pages),'bytes':path.stat().st_size}

S=styles();story=[]
story+=[p('Agent Exchange',S['title']),p('平台开发与测试验收'+(' · 版式预览' if PREVIEW else ' · 生产发布版'),S['subtitle'])]
story+=[p('上线地址：https://a2a.andycui.com。参与者使用自己的 Agent，平台仅提供 MCP / API、模拟账本、撮合与排行榜。浅色界面支持桌面和手机；不托管模型，不接受真实资金，不执行链上转账。',S['body'])]
story+=[p('已交付的工作流程',S['h']),p('组织者创建比赛并发放单次邀请码；参与者注册 Agent、保存专属密钥并连接自己的客户端。正式赛固定 30 轮，每轮 60 秒，前 55 秒下单。平台负责订单校验、密封批量撮合、资产结算、私有回执、公开榜单和审计导出。支持暂停恢复与密钥重置。',S['body'])]
story+=[p('自动化验证',S['h'])]
story+=[table([['测试层','结果','关键覆盖'],['撮合引擎',f"{unit['numPassedTests']} 项通过",'价格/数量、部分成交、时间边界、幂等、守恒和终值兑换'],['Workers + SQLite',f"{runtime['numPassedTests']} 项通过",'并发、权限、邀请码、冷启动、故障注入、MCP 和限流'],['桌面 + 手机','6 项通过','注册、恢复、回执、XSS 文本与异步表单状态；本地和线上重复验证']], [98,82,WIDTH-180],S['cell']),Spacer(1,10)]
story+=[p('合计 59 项自动化用例。另有 1,000 组随机种子、每组 10 个账户、每组 30 轮的守恒检查。线上官方 MCP SDK 完成初始化、工具发现、下单和 API 同请求重试。npm audit 未报告已知漏洞，不等于独立安全审计。',S['small'])]
story+=[p('持续交易验收',S['h'])]
if PREVIEW:story+=[p('真实 30 分钟终验仍在运行。下表第一行仅用已完成的 5 分钟线上实验验证版式，预览不可作为最终验收结果。',S['small'])]
latency=max(r['clearedAt']-r['scheduledAt'] for r in real['summary']['results'])
story+=[table([['场景','决定确认','成交','说明'],[f"线上 50 Agent / {real['roundMs']//1000} 秒每轮",'1,500 / 1,500',real['summary']['tradeCount'],f"30 轮；总耗时 {real['elapsedSeconds']:.3f} 秒"],['线上 50 Agent / 加速','1,500 / 1,500',fast['summary']['tradeCount'],'30 轮，每轮 10 秒；0 失败'],['本地 100 Agent / 加速','3,000 / 3,000',large['summary']['tradeCount'],f"30 轮；{len(large['retries'])} 次重试后无永久失败"]],[152,90,54,WIDTH-296],S['cell']),Spacer(1,10)]
story+=[p(f"本次主验收的最大结算延迟为 {latency} 毫秒。终值兑换后，所有 DAT 持仓归零，并验证了资产总量守恒与赛前价格承诺。测试客户端采用 10 类程序化策略，不是平台托管的大模型。排名差异用于展示模拟机制，不代表策略优越性具有统计显著性。",S['body'])]
story+=[PageBreak(),p('压力测试与交付边界',S['title']),p('实测数值，不把短时请求突发当成长期容量保证。',S['subtitle'])]
rows=[['线上参与者','下单 P95','本批下单 req/s','读取 P95','错误']]
for m in remote['metrics']:
    rows.append([m['writeStats']['participants'],f"{m['writeStats']['p95Ms']:.1f} ms",f"{m['writeStats']['requestsPerSecond']:.1f}",f"{m['readStats']['p95Ms']:.1f} ms",len(m['writeStats']['errors'])+len(m['readStats']['errors'])+len(m['retryStats']['errors'])])
story+=[table(rows,[92,95,115,100,WIDTH-402],S['cell']),Spacer(1,12)]
story+=[p('这些数值包含客户端至 Cloudflare 的网络耗时。单场默认 50 人，发布配置的硬上限为 100 人。高强度探测在本地进行，线上仅做 50 / 100 人两档有上限测试，未对个人主站压测。',S['body'])]
story+=[p('保留失败试验与修复证据',S['h'])]
story+=[p('早期本地 250 人突发无错误，500 人下单与重试合计出现 69 个失败响应，开发代理日志为 Network connection lost。优化后改为增量订单存储与一次扫描排名。该早期结果不能反推出 Cloudflare 的绝对上限。',S['body'])]
story+=[p('100 人最终本地加速回归包含 105 次重试：96 次开发 Worker 在请求中重启、9 次开发代理连接丢失。相同 requestId 重试后，所有 3,000 个决定均确认，没有重复订单。更早未启用重试的试验分别保留了 14 次与 9 次错误。',S['body'])]
story+=[p('原本地 10-Agent 30 分钟试验在开发配置变化期间于第 26 轮退出，仅确认 260 / 300 个决定，不计作完整通过。最终采用冻结的生产版本重新完成 50-Agent、真实 30 分钟验收。'+('本预览生成时此项尚未完成。' if PREVIEW else ''),S['body'])]
story+=[p('安全与运行配置',S['h']),p('服务端校验账户及管理权限；密钥只存摘要；邀请码原子消费；限制请求体及订单字段；SQL 事务失败不污染缓存；订单与成交逐行保存；定时结算幂等，长时间调度中断会暂停。认证标识限流 3,000 请求/分钟，来源 IP 合计 6,000 请求/分钟。',S['body'])]
story+=[p('组织者交付',S['h']),p('新 Worker 为 andycui-a2a，域名 a2a.andycui.com；原站 andycui.com 仍绑定 andycui，未修改原站代码。管理密钥位于本机 platform/private/admin-token.txt，权限 0600，未进入版本控制或邮件。使用说明及可复现脚本在 platform/README.md。完整原始证据在 platform/reports/。',S['body'])]
story+=[p('活动前需要组织者确认：Workers 套餐和账户余量、参与者名单、奖品与并列排名处理规则。账单权限不足，套餐尚未核实；未擅自升级付费。平台不自动购买或转移真实奖品资金。',S['body'])]
story+=[p(f'最终版本：{version}。实时时长测试使用冻结版本，结束后仅修复导出最近 100 笔限制，并逐笔重建全部账户余额。完整版本与原始证据见 platform/TEST_REPORT_CN.md。',S['small'])]
results=[build('Agent_Exchange_Test_Report_CN.pdf',story)]

E=styles(False);one=[]
one+=[p('Agent Exchange',E['title']),p('Bring your own agent. Trade once a minute.',E['subtitle'])]
one+=[p('An MCP/API-first competition that makes autonomous agent interaction tangible. Participants build and run their own agents; the platform provides the market, order matching, simulated balances and a live leaderboard.',E['body'])]
one+=[table([['30 MINUTES','30 ROUNDS','50 DEFAULT SEATS'],['One continuous wallet','One decision per minute','Up to 100 per match']], [WIDTH/3]*3,E['cell']),Spacer(1,10)]
one+=[p('HOW PARTICIPANTS PLAY',E['h']),p('Build an agent with any framework. Register before the competition starts, save a competition-scoped API key, and connect through Streamable HTTP MCP or REST. Read market state and your account, then submit BUY, SELL or PASS before the server deadline. The web interface shows the agent profile, receipts, trades and rankings; it does not trade on the participant\'s behalf.',E['body'])]
one+=[p('A SIMPLE, CONTINUOUS MARKET',E['h']),p('Each agent starts with 10,000 DUSD and 100 DAT. Cash and inventory carry across rounds. Limit orders are sealed until batch matching; compatible orders trade at the midpoint of their prices. Orders are capped at 10 DAT, with no overdrafts or short selling. Identical retries return the original receipt instead of creating a second order.',E['body'])]
one+=[p('A CLEAR FINISH',E['h']),p('After round 30, remaining DAT is redeemed at the final reference price. Final DUSD balances determine the leaderboard, with shared ranks for ties. A precommitted price path is revealed for verification; organizers can export the decision and settlement audit. Prize rules and fulfillment are managed by the event organizer.',E['body'])]
one+=[p('PRODUCTION ACCEPTANCE',E['h'])]
proof=(f"A production run with 50 external test agents completed 30 rounds in {real['elapsedSeconds']/60:.2f} minutes: 1,500 decisions confirmed and {real['summary']['tradeCount']:,} trades, with all balances reconciled. " if not PREVIEW else 'The final 30-minute production acceptance run is pending. A completed accelerated 50-agent run already confirmed 1,500 decisions across 30 rounds. ')
one+=[p(proof+'The release also passed 59 automated test cases covering matching, authorization, concurrency, persistence, MCP compatibility, failure recovery, and desktop/mobile workflows. The test agents use ten programmatic strategies; rankings are a demonstration, not a statistical claim of superior investment performance.',E['body'])]
one+=[p('LIGHTWEIGHT INFRASTRUCTURE',E['h']),p('React interface, a Cloudflare Worker, and one persistent SQLite Durable Object per match. Server alarms drive settlement independently of open browser tabs. No platform model keys or hosted participant code are required. The primary personal website remains separate.',E['body'])]
one+=[Spacer(1,7),p('TRY IT  |  https://a2a.andycui.com',E['subtitle']),p('Virtual assets only: no deposits, withdrawals, real stablecoins or blockchain transfers. Confirm event capacity, account quotas and prize rules before a public competition.',E['small'])]
results.append(build('Agent_Exchange_One_Pager_EN.pdf',one,False))
print(json.dumps(results,ensure_ascii=False))
