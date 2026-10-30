export const isNum = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

export const num = v => (isNum(v) ? Number(v) : null);

export const fmt = (v, digits = 2) => (isNum(v) ? Number(v).toFixed(digits) : '—');

export const fmtPlain = (v, digits = 2) => (isNum(v) ? Number(v).toFixed(digits) : '—');

export const fmtPct = (v, digits = 2) => {
    const n = num(v);
    if (n === null) return '—';
    return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
};

export const fmtCap = v => {
    const n = num(v);
    if (n === null || n <= 0) return '—';
    const yi = n / 1e8;
    if (yi >= 1e4) return `${(yi / 1e4).toFixed(2)} 万亿`;
    return `${yi >= 1e3 ? yi.toFixed(0) : yi.toFixed(1)} 亿`;
};

export const fmtAmount = v => {
    const n = num(v);
    if (n === null) return '—';
    if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)} 亿`;
    if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(2)} 万`;
    return n.toFixed(0);
};

export const tone = v => {
    const n = num(v);
    if (n === null || n === 0) return 'sh-flat';
    return n > 0 ? 'sh-up' : 'sh-down';
};

export const pctText = (v, digits = 2) => {
    const n = num(v);
    if (n === null) return null;
    return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
};

export const scoreTone = band => (band === 'good' ? 'sh-good' : band === 'high' ? 'sh-bad' : 'sh-mid');

export const flagTone = flag => {
    if (flag === 'ST') return 'red';
    if (flag === '亏') return 'orange';
    if (flag === '八折') return 'green';
    if (flag === '破净') return 'blue';
    return 'default';
};

export const shortDate = v => (v ? String(v).slice(0, 10) : '—');

export const fmtTime = v => {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('zh-CN', {hour12: false});
};

export const fmtDuration = ms => {
    if (!isNum(ms)) return '—';
    const value = Number(ms);
    if (value >= 60000) return `${(value / 60000).toFixed(1)} 分`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)} 秒`;
    return `${value} ms`;
};

export const monthlyLabel = time => String(time || '').slice(0, 7);

export const openStock = (code, name) => {
    const label = name ? `?_label=${encodeURIComponent(name)}` : '';
    window.location.hash = `/stock/${code}${label}`;
};

export const statusOptions = [    {value: '', label: '全部状态'},
    {value: 'heavy', label: '重仓区'},
    {value: 'near', label: '接近重仓'},
    {value: 'entry', label: '入场区'},
    {value: 'pb', label: '破净'},
    {value: 'pb80', label: '八折'},
    {value: 'small', label: '小市值'},
    {value: 'screen', label: '纪律全过'},
    {value: 'screenbuy', label: '全过 + 买点'},
    {value: 'score-good', label: '评分优'},
    {value: 'score-low', label: '评分低'},
    {value: 'score-report', label: '有研报评分'},
    {value: 'score-report80', label: '研报 ≥80'},
    {value: 'risk', label: '风险'},
];
