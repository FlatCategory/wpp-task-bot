# Agenda — AI-Powered Notepad via WhatsApp

A WhatsApp bot that transcribes audio and automatically creates tasks in a desktop notepad, using a local LLM (Ollama).

## How it works

1. You send an **audio** or **text** message in a specific WhatsApp group
2. The audio is transcribed locally with **Whisper**
3. The text is sent to a **local LLM** (Gemma4 via Ollama) that extracts the task structure
4. Tasks are added to the **notepad** (desktop GUI with pywebview) in real time

## Prerequisites

- **Node.js** v20+
- **Python** 3.12+
- **Ollama** running locally with the `gemma4:e4b` model (or another of your choice)
- **ffmpeg** installed (for audio conversion)
- **Chromium** installed (for whatsapp-web.js puppeteer)

## Setup

```bash
# 1. Clone the repository
git clone <url> && cd pub-agenda

# 2. Install Node dependencies
npm install

# 3. Install Python dependencies
pip install -r requirements.txt

# 4. Configure .env
cp .env.example .env
# Edit .env with your keys and the group JID

# 5. Make sure Ollama is running with the model
ollama pull gemma4:e4b

# 6. Start
npm start
```

On the first run, scan the QR code in the terminal with your phone's WhatsApp.

## Finding the group JID

1. Start the bot without configuring `TASK_GROUP_JID`
2. Send `!ping` in the desired group
3. In the terminal log, the JID appears as `XXXXX@g.us`
4. Add it to `.env`: `TASK_GROUP_JID=XXXXX@g.us`

## Bot commands

| Command | Description |
|---------|-------------|
| `!ping` | Ping the bot |
| `!qask <question>` | Ask the AI a question |
| `!ocr` | Analyze an image (send with caption `!ocr`) |
| `!stt` | Transcribe audio (reply to an audio with `!stt`) |
| `!gif <search>` | Search for a GIF |
| `!img <search>` | Search for an image |
| `!sticker` | Convert image/video to sticker |
| `!help` | List available commands |

## Adding tasks via CLI

You can also add tasks directly from the terminal:

```bash
python notepad.py '{"Shopping": {"Milk": {}, "Bread": {}}}'
```

The format is nested JSON where keys are task names and values are `{}` (leaf) or another dict (subtasks).

## Project structure

```
pub-agenda/
├── index.js           # WhatsApp bot (Node.js)
├── notepad.py         # Notepad — GUI + CLI
├── src/
│   ├── api.py         # Python <-> JavaScript bridge (pywebview)
│   ├── storage.py     # JSON persistence + append_tasks()
│   └── qt_bridge.py   # Thread-safe Qt bridge
├── ui/
│   ├── index.html     # Notepad interface
│   ├── app.js         # Frontend JS
│   └── styles.css     # Styles
├── .env.example       # Configuration template
├── requirements.txt   # Python dependencies
└── package.json       # Node.js dependencies
```
