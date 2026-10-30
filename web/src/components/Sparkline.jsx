import React from 'react';
import {num} from '../lib/format';

/**
 * 迷你走势图：输入 [{date, close}] 或 [{time, close}]，归一化后画线。
 */
export default function Sparkline({points, width = 200, height = 40, positive, className}) {
    const values = (Array.isArray(points) ? points : [])
        .map(p => {
            const value = num(p.close ?? p.value);
            return value !== null && value > 0 ? value : null;
        })
        .filter(v => v !== null);
    if (values.length < 2) {
        return <div className="sh-spark-empty" style={{height}}>历史趋势数据积累中</div>;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || Math.abs(max) * 0.01 || 1;
    const coords = values.map((value, index) => ({
        x: 2 + index * (width - 4) / (values.length - 1),
        y: height - 3 - ((value - min) / span) * (height - 6),
    }));
    const path = coords.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const rising = positive === undefined ? values[values.length - 1] >= values[0] : positive;
    return <svg viewBox={`0 0 ${width} ${height}`} className={`sh-spark ${rising ? 'sh-up' : 'sh-down'} ${className || ''}`}
                role="img" aria-label="历史走势">
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        <circle cx={coords[coords.length - 1].x.toFixed(1)} cy={coords[coords.length - 1].y.toFixed(1)}
                r="2" fill="currentColor"/>
    </svg>;
}
