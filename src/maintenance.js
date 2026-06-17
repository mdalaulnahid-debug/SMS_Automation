'use strict';

function createMaintenanceCoordinator({ service, store, timeoutSweepMs = 60_000, reclaimMs = 90_000, logger = console }) {
  let timer = null;

  async function runSweep() {
    try {
      const timedOut = await service.timeoutWaitingRequests();
      if (timedOut.length) {
        logger.log(`Timeout sweep marked ${timedOut.length} request(s) as terminal`);
      }
    } catch (error) {
      logger.error(`Timeout sweep failed: ${error.message}`);
    }

    try {
      const reclaimed = store.reclaimStaleClaimedJobs(reclaimMs);
      if (reclaimed.length) {
        logger.warn(`[reclaim] Reset ${reclaimed.length} stale CLAIMED job(s) to PENDING_PICKUP`);
      }
    } catch (error) {
      logger.error(`Stale-job reclaim failed: ${error.message}`);
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(runSweep, timeoutSweepMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return { start, stop, runSweep };
}

module.exports = { createMaintenanceCoordinator };
