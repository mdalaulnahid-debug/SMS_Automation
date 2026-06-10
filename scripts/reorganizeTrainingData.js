'use strict';

const { existsSync, mkdirSync, readdirSync, copyFileSync, writeFileSync } = require('node:fs');
const { join, extname, basename } = require('node:path');

const SOURCE_ROOT = process.env.TRAINING_ROOT || join(__dirname, '..', 'Training Data', 'Automation');
const OUTPUT_ROOT = process.env.TRAINING_ORGANIZED_ROOT || join(__dirname, '..', 'Training Data', 'Organized');
const REQUEST_TYPES = ['LRL', 'LCL', 'MS-NID', 'NID-MS', 'IMEI-MS'];
const OPERATORS = ['GP', 'ROBI', 'BANGLALINK'];

function main() {
  const files = [];
  walk(SOURCE_ROOT, (filePath) => {
    if (!['.xlsx', '.xls', '.xlsm'].includes(extname(filePath).toLowerCase())) return;
    const requestType = inferRequestType(filePath);
    const operator = inferOperator(filePath);
    if (!requestType || !operator) return;

    const targetDir = join(OUTPUT_ROOT, requestType, operator);
    mkdirSync(targetDir, { recursive: true });
    const targetPath = join(targetDir, basename(filePath));
    copyFileSync(filePath, targetPath);
    files.push({ source: filePath, target: targetPath, requestType, operator });
  });

  mkdirSync(OUTPUT_ROOT, { recursive: true });
  writeFileSync(join(OUTPUT_ROOT, 'catalog.json'), JSON.stringify({ files }, null, 2), 'utf8');
  console.log(`Organized ${files.length} training files under ${OUTPUT_ROOT}`);
}

function walk(directory, visitor) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath, visitor);
    else visitor(fullPath);
  }
}

function inferRequestType(filePath) {
  const upper = filePath.toUpperCase();
  return REQUEST_TYPES.find((type) => upper.includes(type)) || '';
}

function inferOperator(filePath) {
  const upper = filePath.toUpperCase();
  if (upper.includes('BANGLALINK')) return 'BANGLALINK';
  if (upper.includes('ROBI')) return 'ROBI';
  if (upper.includes('GRAMEENPHONE') || upper.includes('GP')) return 'GP';
  return '';
}

main();
