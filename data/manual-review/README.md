# Manual Review Store

This folder is system-generated review storage only.

- It is **not** used as live training data.
- The system keeps the latest `100` confirmed examples per request type.
- These files are meant for human review before any examples are promoted into curated training workbooks.

Current intended promotion flow:

1. System captures confirmed reply examples here.
2. Human reviews the collected examples.
3. Approved examples are copied into the curated Excel training files in `Training Data/Automation/`.
