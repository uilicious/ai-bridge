# ai-cached-connector

Thin wrapper over openAI api, and potentially other AI provider alternatives.
It helps handle out of the box caching of request.

It also provide some very minor QOL enhancments to the API

## Cache Options
- Local jsonl cache dir
- MongoDB connection

## Provider support
- openAI
- (@TODO) forefront (embedding not supported)

## Why should you be caching your AI response?

In general running LLM, is an expensive process. Caching however helps offset the cost involved for frequent and common query.
The downside is, this is not appropriate for all use cases.

## Deploy Token URL (readonly)

https://ai-bridge-deploy-token:e_3F5vSycyK6_xQbHhHV@gitlab.uilicious-dev.com/ai-labs/ai-bridge.git