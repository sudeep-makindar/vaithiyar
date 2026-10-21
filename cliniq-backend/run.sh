#!/bin/bash
# Lambda entrypoint: the AWS Lambda Web Adapter layer proxies invocations to this uvicorn server.
PATH=$PATH:$LAMBDA_TASK_ROOT/bin PYTHONPATH=$PYTHONPATH:/opt/python:$LAMBDA_RUNTIME_DIR exec python -m uvicorn --port="$PORT" main:app
