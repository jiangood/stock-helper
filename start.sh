#!/bin/bash
nohup gotty -w --port 8888 python3 stock_helper.py > stock_helper.log 2>&1 &
echo $! > stock_helper.pid
echo "started, pid: $(cat stock_helper.pid)"
