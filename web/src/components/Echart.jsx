import React, {useEffect, useRef} from 'react';
import * as echarts from 'echarts';

/**
 * 轻量 ECharts 容器：option 变化时 setOption，容器尺寸变化时 resize。
 */
export default function Echart({option, style, className, notMerge = true}) {
    const ref = useRef(null);
    const chartRef = useRef(null);

    useEffect(() => {
        if (!ref.current) return undefined;
        const chart = echarts.init(ref.current);
        chartRef.current = chart;
        const resize = () => chart.resize();
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
        observer?.observe(ref.current);
        window.addEventListener('resize', resize);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', resize);
            chart.dispose();
            chartRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (chartRef.current && option) {
            chartRef.current.setOption(option, notMerge);
        }
    }, [option, notMerge]);

    return <div ref={ref} className={className} style={{width: '100%', height: 320, ...style}}/>;
}
