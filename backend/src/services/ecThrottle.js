// Rolling-window limiter for the Endpoint Central group and staged APIs (EC allows 30 calls a minute, then locks for 5 minutes).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createThrottle({ max, windowMs }) {
  const stamps = [];
  return {
    /** Resolves when one more call fits in the window; callers never exceed `max` calls in any `windowMs`. */
    async acquire() {
      for (;;) {
        const now = Date.now();
        while (stamps.length && now - stamps[0] >= windowMs) stamps.shift();
        if (stamps.length < max) { stamps.push(now); return; }
        await sleep(stamps[0] + windowMs - now + 5);
      }
    },
  };
}

// EC_GROUP_CALLS_PER_MIN, default 25, never above EC's own limit of 30.
const perMinute = Math.min(30, Math.max(1, parseInt(process.env.EC_GROUP_CALLS_PER_MIN, 10) || 25));
module.exports = { createThrottle, groupThrottle: createThrottle({ max: perMinute, windowMs: 60000 }) };
