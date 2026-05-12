#!/bin/bash

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$APP_DIR/stock_helper.log"
PID_FILE="$APP_DIR/stock_helper.pid"

start() {
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo "服务已在运行, PID: $(cat "$PID_FILE")"
        exit 1
    fi

    nohup gotty -w --port 8888 python3 "$APP_DIR/stock_helper.py" > "$LOG_FILE" 2>&1 &
    PID=$!
    echo $PID > "$PID_FILE"
    echo "服务已启动, PID: $PID"
    echo "日志文件: $LOG_FILE"
}

stop() {
    if [ ! -f "$PID_FILE" ]; then
        echo "未找到 PID 文件"
        exit 1
    fi

    PID=$(cat "$PID_FILE")
    kill "$PID" 2>/dev/null
    rm -f "$PID_FILE"
    echo "服务已停止"
}

status() {
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo "服务运行中, PID: $(cat "$PID_FILE")"
    else
        echo "服务未运行"
    fi
}

case "${1:-start}" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        stop
        sleep 1
        start
        ;;
    status)
        status
        ;;
    *)
        echo "用法: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac
