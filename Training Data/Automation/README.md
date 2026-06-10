# Training Data Organization

Use this folder for raw operator request/reply examples.

Canonical structure:

```text
Training Data/
  Automation/
    IMEI-MS/
      1. GP/
      2. Robi/
      3. Banglalink/
    LCL/
      1. GP/
      2. Robi/
      3. Banglalink/
    LRL/
      1. GP/
      2. Robi/
      3. Banglalink/
    MS-NID/
      1. GP/
      2. Robi/
      3. Banglalink/
    NID-MS/
      1. GP/
      2. Robi/
      3. Banglalink/
```

Expected Excel columns:

- `Request`: exact outbound request text, for example `IMEI-MS 863351069471228`
- `Reply`: exact operator reply text copied from the push-pull service

Run from project root:

```bash
npm run import:training
```

This generates `data/reply-patterns.json`.

Optional normalized copy:

```bash
npm run organize:training
```

This creates `Training Data/Organized/<REQUEST_TYPE>/<OPERATOR>/...` and a `catalog.json` file without deleting the raw files.
