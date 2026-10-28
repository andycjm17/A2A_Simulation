"""Export the recorded experiment, without rerunning or changing its results."""
import hashlib
import json
import statistics
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Flowable
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'output/pdf/Agent_Economy_100_Round_Results.pdf'
INK = colors.HexColor('#172F42')
TEAL = colors.HexColor('#147D86')
RUST = colors.HexColor('#B24E37')
GREY = colors.HexColor('#607281')
PALE = colors.HexColor('#EEF4F6')
LINE = colors.HexColor('#D8E2E7')
WIDTH = A4[0] - 96

pdfmetrics.registerFont(TTFont('CN', '/System/Library/Fonts/STHeiti Light.ttc', subfontIndex=0))
pdfmetrics.registerFont(TTFont('CN-Bold', '/System/Library/Fonts/STHeiti Medium.ttc', subfontIndex=0))
pdfmetrics.registerFontFamily('CN', normal='CN', bold='CN-Bold', italic='CN', boldItalic='CN-Bold')
STYLES = {
    'title': ParagraphStyle('title', fontName='CN-Bold', fontSize=25, leading=34, textColor=INK, spaceAfter=12),
    'h1': ParagraphStyle('h1', fontName='CN-Bold', fontSize=18, leading=26, textColor=INK, spaceAfter=12),
    'h2': ParagraphStyle('h2', fontName='CN-Bold', fontSize=12, leading=19, textColor=INK, spaceBefore=13, spaceAfter=6),
    'body': ParagraphStyle('body', fontName='CN', fontSize=10, leading=16, textColor=INK, spaceAfter=8, wordWrap='CJK'),
    'small': ParagraphStyle('small', fontName='CN', fontSize=8.3, leading=13, textColor=GREY, spaceAfter=6, wordWrap='CJK'),
    'cell': ParagraphStyle('cell', fontName='CN', fontSize=8.3, leading=12, textColor=INK, wordWrap='CJK'),
    'head': ParagraphStyle('head', fontName='CN-Bold', fontSize=8.3, leading=12, textColor=colors.white, wordWrap='CJK'),
}


def p(text, style='body'):
    return Paragraph(text, STYLES[style])


def table(headers, rows, widths, font=8.3):
    body_style = ParagraphStyle('custom-cell', parent=STYLES['cell'], fontSize=font, leading=font+3.7)
    data = [[p(escape(str(x)), 'head') for x in headers]]
    data += [[Paragraph(escape(str(x)), body_style) for x in row] for row in rows]
    result = Table(data, colWidths=widths, repeatRows=1, hAlign='LEFT')
    result.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), INK),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, PALE]),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 7),
        ('RIGHTPADDING', (0, 0), (-1, -1), 7),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LINEBELOW', (0, 0), (-1, 0), .5, INK),
    ]))
    return result


def interval(values):
    return f'[{values[0]:.2f}, {values[1]:.2f}]'


def fmt_p(value):
    return f'{value:.6f}'


class LeaderboardChart(Flowable):
    def __init__(self, rows):
        super().__init__()
        self.rows = rows
        self.width, self.height = WIDTH, 287

    def draw(self):
        c = self.canv
        left, right, top, step = 90, self.width - 46, 260, 22
        lower, upper = -11000, 6500
        sx = lambda value: left + (value - lower) / (upper - lower) * (right - left)
        c.setFont('CN', 8)
        for tick in [-10000, -5000, 0, 5000]:
            x = sx(tick)
            c.setStrokeColor(LINE if tick else GREY)
            c.setLineWidth(.5 if tick else .8)
            c.line(x, 36, x, 271)
            c.setFillColor(GREY)
            c.drawCentredString(x, 22, f'{tick:,}')
        for index, row in enumerate(self.rows):
            y = top - index * step
            c.setFillColor(INK)
            c.setFont('CN', 9)
            c.drawRightString(left - 9, y - 2, f"{row['rank']}. {row['name']}")
            value = row['total']
            x0, x1 = sx(0), sx(value)
            c.setFillColor(TEAL if value >= 0 else RUST)
            c.rect(min(x0, x1), y - 4, max(1, abs(x1 - x0)), 12, fill=1, stroke=0)
            c.setFillColor(INK)
            c.setFont('CN', 8.5)
            if value >= 0:
                c.drawString(x1 + 5, y - 2, f'{value:,}')
            else:
                c.drawRightString(x1 - 5, y - 2, f'{value:,}')
        c.setFillColor(GREY)
        c.setFont('CN', 8)
        c.drawCentredString((left + right) / 2, 5, '100轮累计收益（sUSD，模拟积分）')


def decorate(c, doc):
    c.saveState()
    w, h = A4
    c.setStrokeColor(TEAL)
    c.setLineWidth(2)
    c.line(48, h - 35, 79, h - 35)
    c.setFont('CN', 8)
    c.setFillColor(GREY)
    c.drawString(88, h - 38, 'A2A SIMULATION  /  EXPERIMENT RESULTS')
    c.setStrokeColor(LINE)
    c.setLineWidth(.5)
    c.line(48, 40, w - 48, 40)
    c.drawString(48, 26, '合成市场实验 · 程序化Agent · 非真实资金')
    c.drawRightString(w - 48, 26, f'{doc.page} / 6')
    c.restoreState()


def main():
    data = json.loads((ROOT / 'results/main/analysis.json').read_text())
    control = json.loads((ROOT / 'results/control/analysis.json').read_text())
    main_manifest = json.loads((ROOT / 'results/main/manifest.json').read_text())
    for folder in ('main', 'control'):
        manifest = json.loads((ROOT / f'results/{folder}/manifest.json').read_text())
        for name, digest in manifest['output_hashes'].items():
            assert hashlib.sha256((ROOT / f'results/{folder}' / name).read_bytes()).hexdigest() == digest
    rows = data['leaderboard']
    names = {row['agent']: row['name'] for row in rows}
    diagnostics = [json.loads(line) for line in (ROOT / 'results/control/market_diagnostics.jsonl').read_text().splitlines()]
    median_tick = statistics.median(row['last_trade_tick'] for row in diagnostics)
    max_tick = max(row['last_trade_tick'] for row in diagnostics)
    assert len(rows) == 10 and len(data['pairwise']) == 45

    story = [p('Agent Economy<br/>100轮交易实验结果', 'title'),
             p('实验批次：20260911  |  10种策略  |  100轮主实验 + 100轮独立对照', 'small'),
             p('<b>策略表现存在显著差异，但当前前三名尚未拉开统计上可靠的差距。</b> 本地市场已完成撮合、结算和计分验证；结果支持继续开发原型，尚不足以认定某一种策略普遍最优。'),
             table(['主实验成交', '独立统计单位', '显著两两比较'],
                   [[f"{data['market']['trades']:,} 笔", '20个均衡区组', f"{data['significant_pairs']} / 45 组"]],
                   [WIDTH/3]*3), Spacer(1, 14), LeaderboardChart(rows),
             p('主要发现', 'h2'),
             p('1. 全局检验 p约为0.00005；全部45对比较经过Holm校正后，30对仍达到0.05显著性水平。'),
             p('2. “大单快成交”在前50轮和后50轮均排名第一，但对第二、第三名的优势没有达到校正后的显著性。'),
             p('3. 同策略对照未检出显著差异（p约为0.398）。固定估值的市场会快速完成资源配置，持续比赛需要新的交易需求。'),
             p('范围：程序化策略、本地串行市场；不调用LLM，未实现线上MCP/API接入。收益是每轮相对初始资产的改善，不是真实美元或复利收益。', 'small'),
             PageBreak()]

    story += [p('01  排行榜与统计差异', 'h1'),
              p('所有Agent每轮初始资金与库存相同，100轮内的估值分配次数完全一致。下表区间衡量平均每轮收益的不确定性。')]
    story += [table(['排名 / 策略', '累计收益', '均值/轮', '均值95%区间', '盈利轮数'],
                    [[f"{r['rank']}  {r['name']}", f"{r['total']:,}", f"{r['mean']:.2f}", interval(r['ci95']), f"{r['positive_rounds']}/100"] for r in rows],
                    [112, 75, 65, 165, WIDTH-417]),
              p('单位：sUSD。95%区间为20,000次区组bootstrap的逐项区间，未经多重比较校正；不应根据区间是否重叠直接判断策略差异。', 'small'),
              p('第一名与主要竞争者', 'h2')]
    comparisons = []
    for other in ['book_improver', 'value_taker', 'market_maker', 'mean_reverter', 'concession', 'patient']:
        pair = next(x for x in data['pairwise'] if {x['a'], x['b']} == {'urgent', other})
        sign = 1 if pair['a'] == 'urgent' else -1
        ci = pair['ci95'] if sign == 1 else [-pair['ci95'][1], -pair['ci95'][0]]
        comparisons.append([names[other], f"{sign * pair['mean_difference']:.2f}", interval(ci), fmt_p(pair['p_holm']), '是' if pair['significant'] else '否'])
    story += [table(['对手', '第一名领先/轮', '差值95%区间', 'Holm p', '显著'], comparisons,
                    [95, 95, 155, 95, WIDTH-440]),
              p('两两比较统一覆盖45对策略，避免只挑选有利结果。第一名与第二、第三名的校正p值均为1.000；未显著不代表两种策略等效。', 'small'),
              p(f"第一名在区组重采样中位列第一的占比为{rows[0]['bootstrap_top_share']:.1%}。这反映本次样本的排名稳定性，不是未来比赛夺冠概率。"),
              PageBreak()]

    story += [p('02  实验规则与10种策略', 'h1'),
              p('每轮1000 sUSD和10单位COMPUTE；80个离散决策时刻。每个Agent每时刻可取消旧单并提交最多两个限价单。后台按价格优先、同价时间优先撮合，以先挂订单的价格成交，允许部分成交。'),
              p('每轮4个Agent的资源估值为8，2个为10，4个为12。每5轮轮换角色，确保每个Agent在100轮中各经历40次低估值、20次中估值和40次高估值。轮末按自身估值计算剩余资源价值。'),
              table(['计分规则'], [['本轮得分 = 结束现金 + 结束库存 × 自身估值 - (1000 + 10 × 自身估值)'],
                                  ['比赛总分 = 100轮得分之和；每轮资产重置，不做跨轮学习或财富滚存。']], [WIDTH]),
              p('固定策略实现', 'h2'),
              table(['策略', '交易行为'], [[r['name'], r['strategy']] for r in rows], [100, WIDTH-100]),
              p('公平性与信息边界', 'h2'),
              p('每个决策时刻随机排列行动顺序；策略随机数和平台调度随机数独立。Agent只能看到自身估值与资产、公开订单和过去成交。所有账户遵守相同余额、库存和订单上限。'),
              p('策略的单笔数量和是否贴近自身估值是策略设计的一部分，未单独控制。因此，结果比较的是完整策略实现，不能把收益差异全部归因于某一个决策因素。', 'small'),
              PageBreak()]

    story += [p('03  对照、方法与产品启示', 'h1'),
              table(['指标', '10种不同策略', '10个同策略账户'],
                    [['运行轮数', '100', '100'],
                     ['成交笔数', f"{data['market']['trades']:,}", f"{control['market']['trades']:,}"],
                     ['全局置换p值', fmt_p(data['omnibus']['p']), fmt_p(control['omnibus']['p'])],
                     ['校正后显著比较', '30 / 45', '0 / 45'],
                     ['理论净盈余上限实现率', f"{data['market']['efficiency']:.1%}", f"{control['market']['efficiency']:.1%}"]],
                    [195, 150, WIDTH-345]),
              p('同策略对照中所有账户均执行“价值捕捉”。此次未发现可检测的账户身份或调度差异，但不能据此证明平台绝对无偏。', 'small'),
              p('统计方法', 'h2'),
              p('将5轮视为一个均衡区组，20个区组作为独立重复单位。全局使用Friedman秩统计量，通过20,000次区组内标签置换校准p值；本次Q=136.730，Kendall W=0.760。'),
              p('45对策略分别对区组收益差进行精确符号翻转检验（2的20次方种组合），再做Holm校正。均值与差值区间使用20,000次配对区组bootstrap。全局p约0.00005处于本次Monte Carlo分辨率下限。'),
              p('推断要求零假设下策略标签可交换、配对差可符号翻转。市场中的Agent相互影响，结论仅针对这个固定对手组合。', 'small'),
              p('机制问题：市场会快速停止交易', 'h2'),
              p(f'同策略对照最后成交的中位时刻为第{int(median_tick)}步，最晚第{max_tick}步（均从0计数），即最晚第8个决策时刻；随后至少72个时刻没有成交。各轮均完成理论上可获得的净经济盈余。'),
              p('主实验后25%时段仍有17.3%的成交，但随机与趋势策略合计亏损13,343 sUSD。其他盈利策略合计获利27,181，净经济盈余为13,838。获利不能全部解释为价值创造，活跃成交也不一定代表有效交易。'),
              p('后续方向：测试分批发放资源或定时引入新需求，以延长有效交易。这是尚未执行的机制建议，本PDF不包含该改版的结果。'),
              p('验证范围：13项自动测试通过；全部200轮均独立重放成交并核对资产和收益；原始日志hash校验通过。未覆盖线上并发、持久化数据库、鉴权或真实LLM行为。', 'small'),
              PageBreak()]

    pair_rows = [[names[x['a']], names[x['b']], f"{x['mean_difference']:.2f}", interval(x['ci95']), fmt_p(x['p_holm']), '是' if x['significant'] else '否'] for x in data['pairwise']]
    for part, (start, end) in enumerate([(0, 23), (23, 45)], 1):
        story += [p(f'附录  全部45组比较（{part}/2）', 'h1'),
                  p(f'比较 {start+1}-{end}。差值表示A相对B的平均每轮收益；显著性以Holm校正p &lt; 0.05判断。区间为未校正的95%配对区组bootstrap区间。', 'small'),
                  table(['策略A', '策略B', 'A-B/轮', '差值95%区间', 'Holm p', '显著'], pair_rows[start:end],
                        [77, 77, 57, 156, 83, WIDTH-450], font=7.8)]
        if part == 1:
            story += [Spacer(1, 10), p('完整原始p值、效应量及区组胜率保存在 results/main/analysis.json。本表包括所有两两比较，不按显著性筛选。', 'small'), PageBreak()]
        else:
            story += [p('数据与方法来源', 'h2'),
                      p('项目记录：results/main/analysis.json；results/control/analysis.json；各自的rounds.jsonl、trades.jsonl和manifest.json。实验设计：simulation/EXPERIMENT.md；统计实现：simulation/analyze.py。', 'small'),
                      p('方法参考：<link href="https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.permutation_test.html" color="#147D86">SciPy 配对置换检验说明</link>；<link href="https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.friedmanchisquare.html" color="#147D86">Friedman 检验及小样本提示</link>。本实验统计运行使用NumPy实现。', 'small'),
                      p(f"复现参数：seed={main_manifest['seed']}，rounds=100，ticks=80，block_size=5。PDF根据已保存结果生成，未重新运行比赛。", 'small')]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=48, rightMargin=48,
                            topMargin=62, bottomMargin=54, title='Agent Economy - 100轮交易实验结果',
                            author='A2A Simulation', subject='10种Agent策略的模拟交易、排行榜与统计显著性')
    doc.build(story, onFirstPage=decorate, onLaterPages=decorate)
    reader = PdfReader(OUT)
    assert len(reader.pages) == 6, f'Unexpected pagination: {len(reader.pages)}'
    texts = [page.extract_text() for page in reader.pages]
    assert all(len(text) > 200 for text in texts)
    combined = '\n'.join(texts)
    for r in rows:
        assert r['name'] in combined
        assert f"{r['total']:,}" in combined
    assert '0.398130' in combined and '0.000050' in combined
    print(json.dumps(dict(path=str(OUT), pages=len(reader.pages), bytes=OUT.stat().st_size,
                          checked='Recorded input hashes, all 10 leaderboard totals, key p-values, page count and extractable text'), ensure_ascii=False))


if __name__ == '__main__':
    main()
