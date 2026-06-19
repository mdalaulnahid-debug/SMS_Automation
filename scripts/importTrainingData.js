'use strict';

const { join } = require('node:path');
const { rebuildTrainingCache } = require('../src/trainingData');

const TRAINING_ROOT = process.env.TRAINING_ROOT || join(__dirname, '..', 'Training Data', 'Automation');
const OUTPUT_FILE = process.env.TRAINING_OUTPUT || join(__dirname, '..', 'data', 'training-cache.json');

function main() {
  const catalog = rebuildTrainingCache({
    rootDir: TRAINING_ROOT,
    cacheFile: OUTPUT_FILE
  });
  console.log(`Imported ${catalog.examples.length} training rows into ${OUTPUT_FILE}`);
}

main();
