import React from 'react';
import {Badge, Button, Empty, Input, Select, Space, Table, Tag, Tooltip, Typography} from 'antd';
import {ReloadOutlined, SearchOutlined} from '@ant-design/icons';
import {HttpClient, Page} from '@jiangood/open-admin';
import {fmt, fmtCap, fmtPct, isNum, num, openStock, pctText, scoreTone, statusOptions, tone} from '../lib/format';

const {Text} = Typography;

function matchStatus(row, key) {
    if (!key) return true;
    const price = num(row.price);
    const heavy = num(row.heavy);
    const entry = num(row.entry);
    const pe = num(row.pe);
    const report = row.reportScore;
    const machine = row.machineScore;
    const reportScore = report ? num(report.score) : null;
    const percent = machine ? num(machine.percent) : null;
    const heavyUsable = heavy !== null && (entry === null || heavy <= entry);
    switch (key) {
        case 'heavy':
            return row.zone === 'heavy';
        case 'near':
            return heavyUsable && price !== null && price > heavy && price <= heavy * 1.03;
        case 'entry':
            return row.zone === 'heavy' || row.zone === 'entry';
        case 'pb':
            return !!row.pbUnder1;
        case 'pb80':
            return !!row.pbGolden;
        case 'small':
            return !!row.smallCap;
        case 'risk':
            return !!row.st || !!row.loss;
        case 'above':
            return row.zone === 'above';
        case 'screen':
            return !!row.screen?.allPass;
        case 'screenbuy':
            return !!row.screen?.allPass && !row.st && !row.loss && pe !== null && pe > 0
                && (row.zone === 'heavy' || row.zone === 'entry');
        case 'score-report':
            return !!report;
        case 'score-report80':
            return reportScore !== null && reportScore >= 80;
        case 'score-good':
            return reportScore !== null ? reportScore >= 80 : percent !== null && percent >= 75;
        case 'score-low':
            return reportScore !== null ? reportScore < 70 : percent !== null && percent < 56;
        default:
            return true;
    }
}

function screenNode(row) {
    const screen = row.screen;
    if (!screen) return '—';
    const tip = `选股纪律：非ST · 非亏损 · PE≤30 · 市值≤200亿 · PB<1`
        + (screen.failed?.length ? `；未过 ${screen.failed.join('、')}` : '')
        + (screen.pending?.length ? `；未取到 ${screen.pending.join('、')}` : '');
    if (screen.allPass) return <Tooltip title={tip}><Tag color="green">全过</Tag></Tooltip>;
    const label = `${screen.passed}/${screen.total}${screen.complete ? '' : '?'}`;
    return <Tooltip title={tip}><Tag color={screen.complete && screen.passed === screen.total - 1 ? 'gold' : 'default'}>{label}</Tag></Tooltip>;
}

function machineNode(row) {
    const score = row.machineScore;
    if (!score || !isNum(score.points)) return <Text type="secondary">—</Text>;
    const items = score.items || {};
    const detail = [
        `国资 ${fmt(items.owner, 1)}/10`,
        `主营 ${fmt(items.focus, 1)}/9`,
        `扣非 ${fmt(items.profit, 1)}/14`,
        `市值 ${fmt(items.cap, 1)}/8`,
        `盘整 ${fmt(items.consolidation, 1)}/9`,
        `月线 ${fmt(items.bottom, 1)}/9`,
        `放量 ${fmt(items.volume, 1)}/6`,
    ].join(' · ');
    const tip = score.percent === null
        ? `评分数据不完整：${score.points}/${score.max}`
        : `机器复算 ${fmt(score.percent, 1)} 分（${score.points}/${score.max}） · ${score.bandLabel || ''}\n${detail}\n覆盖 65/100 权重，不构成投资建议`;
    if (!isNum(score.percent)) {
        return <Tooltip title={tip}><Text type="secondary">—</Text></Tooltip>;
    }
    return <Tooltip title={<span style={{whiteSpace: 'pre-line'}}>{tip}</span>}>
        <span className={scoreTone(score.band)}>{fmt(score.percent, 1)}<span className="sh-mini"> 分·算</span></span>
    </Tooltip>;
}

function reportNode(row) {
    const report = row.reportScore;
    if (!report || !isNum(report.score)) return <Text type="secondary">—</Text>;
    const tip = `研报评分 ${fmt(report.score, 1)} 分 · ${report.bandLabel || ''}\n来源：${report.source || '—'}`
        + `\n报告日期：${report.date || '—'}`
        + (isNum(report.months) ? `（${report.months} 个月前${report.stale ? '，可能已过时' : ''}）` : '');
    return <Tooltip title={<span style={{whiteSpace: 'pre-line'}}>{tip}</span>}>
        <span className={report.score >= 80 ? 'sh-good' : report.score >= 70 ? 'sh-mid' : 'sh-bad'}>
            {fmt(report.score, 1)}<span className="sh-mini"> 分·研{report.stale ? '·旧' : ''}</span>
        </span>
    </Tooltip>;
}

function reportDateNode(row) {
    const report = row.reportScore;
    if (!report || !report.date) return <Text type="secondary">—</Text>;
    return <Tooltip title={report.stale ? '报告日期超过 12 个月，可能已过时' : `来源：${report.source || '—'}`}>
        <span className={report.stale ? 'sh-mid' : ''}>{String(report.date).slice(0, 10)}</span>
    </Tooltip>;
}

function diffSub(value, base) {
    const v = num(value);
    const b = num(base);
    if (v === null || b === null || b <= 0) return null;
    return <span className={`sh-sub ${tone(v - b)}`}>{(v - b) > 0 ? '+' : ''}{((v / b - 1) * 100).toFixed(2)}%</span>;
}

export default class WatchlistPage extends React.Component {
    state = {
        loading: false,
        rows: [],
        total: 0,
        summary: {},
        groups: [],
        search: '',
        group: '',
        status: '',
        error: '',
    };

    onShow() {
        this.load();
    }

    load = async () => {
        this.setState({loading: true, error: ''});
        try {
            const rs = await HttpClient.get('admin/dashboard/list');
            const data = rs.data || {};
            this.setState({
                rows: Array.isArray(data.rows) ? data.rows : [],
                total: data.total || 0,
                summary: data.summary || {},
                groups: Array.isArray(data.groups) ? data.groups : [],
                loading: false,
            });
        } catch (e) {
            this.setState({loading: false, error: e.message || '读取失败'});
        }
    };

    filteredRows() {
        const {rows, search, group, status} = this.state;
        const query = String(search || '').trim().toLowerCase();
        const key = query.replace(/\s+/g, '');
        const lettersOnly = /^[a-z]+$/.test(key);
        return rows.filter(row => {
            if (group && row.group !== group) return false;
            if (status && !matchStatus(row, status)) return false;
            if (!query) return true;
            return String(row.name || '').toLowerCase().includes(query)
                || String(row.code || '').toLowerCase().includes(query)
                || String(row.alias || '').toLowerCase().includes(query)
                || String(row.group || '').toLowerCase().includes(query)
                || (lettersOnly && (
                    String(row.pinyinInitials || '').includes(key)
                    || String(row.pinyinFull || '').includes(key)
                    || String(row.pinyinFull || '').replace(/v/g, 'u').includes(key)));
        });
    }

    columns() {
        const columns = [
            {
                title: '名称', dataIndex: 'name', fixed: 'left', width: 150,
                sorter: (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh'),
                render: (_, row) => <Space size={4}>
                    <a className="sh-link" onClick={() => openStock(row.code, row.name)}>{row.name}</a>
                    {(row.flags || []).map(flag => <Tag key={flag} color={flag === 'ST' ? 'red' : flag === '亏' ? 'orange' : flag === '八折' ? 'green' : 'blue'}>{flag}</Tag>)}
                </Space>,
            },
            {
                title: '价格', dataIndex: 'price', width: 100, align: 'right',
                sorter: (a, b) => (num(a.price) ?? -Infinity) - (num(b.price) ?? -Infinity),
                render: (v, row) => v === null ? '—' : <span className={`sh-price ${tone(row.todayChange)}`}>{fmt(v)}
                    {row.todayChange !== null && <span className="sh-sub">{fmtPct(row.todayChange)}</span>}</span>,
            },
            {
                title: '重仓', dataIndex: 'heavy', width: 90, align: 'right',
                sorter: (a, b) => (num(a.heavy) ?? -Infinity) - (num(b.heavy) ?? -Infinity),
                render: (v, row) => v === null ? '—' : <>{fmt(v)}{diffSub(row.price, v)}</>,
            },
            {
                title: '入场', dataIndex: 'entry', width: 90, align: 'right',
                sorter: (a, b) => (num(a.entry) ?? -Infinity) - (num(b.entry) ?? -Infinity),
                render: (v, row) => v === null ? '—' : <>{fmt(v)}{diffSub(row.price, v)}</>,
            },
            {
                title: '昨日', dataIndex: 'prevChg', width: 80, align: 'right',
                sorter: (a, b) => (num(a.prevChg) ?? -Infinity) - (num(b.prevChg) ?? -Infinity),
                render: v => v === null ? '—' : <span className={tone(v)}>{fmtPct(v)}</span>,
            },
            {
                title: '止盈1', dataIndex: 'tp1', width: 90, align: 'right',
                sorter: (a, b) => (num(a.tp1) ?? -Infinity) - (num(b.tp1) ?? -Infinity),
                render: (v, row) => v === null ? '—' : row.tp1Reached
                    ? <Tag color="gold">{v} ✓</Tag>
                    : <>{v}{isNum(row.price) && row.price < v ? <span className="sh-sub sh-down">+{((v - row.price) / row.price * 100).toFixed(1)}%</span> : null}</>,
            },
            {
                title: '止盈2', dataIndex: 'tp2', width: 80, align: 'right',
                sorter: (a, b) => (num(a.tp2) ?? -Infinity) - (num(b.tp2) ?? -Infinity),
                render: (v, row) => v === null ? '—' : row.tp2Reached ? <Tag color="blue">{v} ✓</Tag> : v,
            },
            {
                title: '年初价', dataIndex: 'yearInit', width: 85, align: 'right',
                sorter: (a, b) => (num(a.yearInit) ?? -Infinity) - (num(b.yearInit) ?? -Infinity),
                render: v => fmt(v),
            },
            {
                title: '市值', dataIndex: 'totalCap', width: 100, align: 'right',
                sorter: (a, b) => (num(a.totalCap) ?? -Infinity) - (num(b.totalCap) ?? -Infinity),
                render: v => fmtCap(v),
            },
            {
                title: '市盈率', dataIndex: 'pe', width: 80, align: 'right',
                sorter: (a, b) => (num(a.pe) ?? -Infinity) - (num(b.pe) ?? -Infinity),
                render: v => <span className={num(v) !== null && num(v) <= 0 ? 'sh-flat' : ''}>{fmt(v)}</span>,
            },
            {
                title: '市净率', dataIndex: 'pb', width: 80, align: 'right',
                sorter: (a, b) => (num(a.pb) ?? -Infinity) - (num(b.pb) ?? -Infinity),
                render: v => fmt(v),
            },
            {
                title: '股息率', dataIndex: 'divYield', width: 80, align: 'right',
                sorter: (a, b) => (num(a.divYield) ?? -Infinity) - (num(b.divYield) ?? -Infinity),
                render: v => isNum(v) && v > 0 ? <span className={v >= 5 ? 'sh-good' : ''}>{fmt(v)}%</span> : '—',
            },
            {
                title: '纪律', dataIndex: 'screen', width: 70, align: 'center',
                sorter: (a, b) => (a.screen?.passed || 0) - (b.screen?.passed || 0),
                render: (_, row) => screenNode(row),
            },
            {
                title: '机器评分', dataIndex: 'machineScore', width: 100, align: 'right',
                sorter: (a, b) => (num(a.machineScore?.percent) ?? -Infinity) - (num(b.machineScore?.percent) ?? -Infinity),
                render: (_, row) => machineNode(row),
            },
            {
                title: '研报评分', dataIndex: 'reportScore', width: 100, align: 'right',
                sorter: (a, b) => (num(a.reportScore?.score) ?? -Infinity) - (num(b.reportScore?.score) ?? -Infinity),
                render: (_, row) => reportNode(row),
            },
            {
                title: '研报日期', dataIndex: 'reportDate', width: 105, align: 'center',
                sorter: (a, b) => String(a.reportScore?.date || '').localeCompare(String(b.reportScore?.date || '')),
                render: (_, row) => reportDateNode(row),
            },
            {
                title: '分组', dataIndex: 'group', width: 90,
                sorter: (a, b) => String(a.group || '').localeCompare(String(b.group || ''), 'zh'),
                render: v => v ? <Tag>{v}</Tag> : '—',
            },
            {
                title: '别名', dataIndex: 'alias', width: 150,
                sorter: (a, b) => String(a.alias || '').localeCompare(String(b.alias || ''), 'zh'),
                render: v => v ? <Tooltip title={v}><span className="sh-minor">{v}</span></Tooltip> : '—',
            },
        ];
        return columns;
    }

    summaryNode() {
        const s = this.state.summary || {};
        return <Space size={16} wrap>
            <span>重仓 <b>{s.heavy || 0}</b></span>
            <span>破净 <b>{s.pb || 0}</b></span>
            <span>八折 <b>{s.pb80 || 0}</b></span>
            <span>纪律全过 <b>{s.pass || 0}</b></span>
            <span>评分优 <b>{s.score || 0}</b></span>
            <span className={s.risk ? 'sh-up' : ''}>风险 <b>{s.risk || 0}</b></span>
            <span className="sh-mini">共 {this.state.total} 只 · 当前 {this.filteredRows().length} 只</span>
        </Space>;
    }

    render() {
        const rows = this.filteredRows();
        return <Page title="自选看板"
                     description={this.summaryNode()}
                     actions={[{label: '刷新', icon: <ReloadOutlined/>, onClick: this.load}]}>
            <div className="sh-toolbar">
                <Input allowClear prefix={<SearchOutlined/>} placeholder="名称 / 代码 / 别名 / 分组 / 拼音"
                       style={{width: 260}} value={this.state.search}
                       onChange={e => this.setState({search: e.target.value})}/>
                <Select style={{width: 140}} value={this.state.group}
                        options={[{value: '', label: '全部分组'}, ...this.state.groups]}
                        onChange={group => this.setState({group})}/>
                <Select style={{width: 160}} value={this.state.status}
                        options={statusOptions}
                        onChange={status => this.setState({status})}/>
                {(this.state.search || this.state.group || this.state.status)
                    ? <Button onClick={() => this.setState({search: '', group: '', status: ''})}>清空筛选</Button> : null}
                <span className="sh-mini">红色上涨 · 绿色下跌；纪律列 5 项自动筛选</span>
            </div>
            <Table
                rowKey="code"
                size="small"
                loading={this.state.loading}
                columns={this.columns()}
                dataSource={rows}
                pagination={false}
                scroll={{x: 1720, y: 'calc(100vh - 330px)'}}
                rowClassName={row => {
                    const eligible = !row.st && !row.loss && num(row.pe) !== null && num(row.pe) > 0;
                    if (eligible && (row.zone === 'heavy' || row.zone === 'entry')) return 'sh-row-buy';
                    if (row.zone === 'above') return 'sh-row-above';
                    return '';
                }}
                locale={{emptyText: <div className="sh-empty"><Empty description={this.state.error || '没有匹配的标的'}/>{this.state.error ? null : <Button onClick={() => this.setState({search: '', group: '', status: ''})}>清空筛选</Button>}</div>}}
            />
        </Page>;
    }
}
