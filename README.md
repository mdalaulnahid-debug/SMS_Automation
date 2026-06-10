# SMS_Automation
Creating SMS automation from WhatsApp

## Project Docs

- `architecture.md`: system architecture and request flow
- `vision.md`: product direction and safety principles
- `progress_tracker.md`: current implementation status
- `todo.md`: next engineering tasks

## Training Data Import

Training Excel files can live under deep folders such as:

`Training Data/Automation/IMEI-MS/1. GP/GP_IMEI_MS.xlsx`

Install dependencies, then import all spreadsheets under `Training Data/Automation`:

```bash
npm install
npm run import:training
```

This generates `data/reply-patterns.json`, which the reply analyzer uses together with the built-in fallback rules.

To create an easier normalized copy of raw training spreadsheets:

```bash
npm run organize:training
```
