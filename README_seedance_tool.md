# Seedance2.0 Video Prompt Tool

Local web tool for generating and submitting Seedance2.0 pet apparel video prompts.

## Files

- `seedance_prompt_tool.html` - local web UI.
- `seedance_server.js` - local Node.js backend that submits tasks and downloads generated videos.
- `start_seedance_tool.cmd` - Windows command prompt launcher.
- `start_seedance_tool.ps1` - PowerShell launcher.

## Start

```bat
cd /d E:\自动视频
start_seedance_tool.cmd
```

Keep the command window open while using the site.

Open:

```text
http://127.0.0.1:8787/seedance_prompt_tool.html
```

## Secrets

Do not commit or share API keys. Set `SEEDANCE_API_KEY` in the launcher prompt or your environment.

The backup package intentionally excludes API key files, generated videos, task status JSON, error logs, and local image/video assets.
