const METRIC_WINDOW_MS = 5 * 60_000;

function createMetrics() {
  const state = {
    startedAt: Date.now(),
    searchesTotal: 0,
    events: [],
  };

  function trim(now = Date.now()) {
    state.events = state.events.filter((event) => event.at > now - METRIC_WINDOW_MS);
  }

  return {
    record({ client, cacheHit, durationMs, restaurants, failed }) {
      const now = Date.now();
      state.searchesTotal += 1;
      state.events.push({
        at: now,
        client,
        cacheHit,
        durationMs,
        failed,
        restaurantIds: restaurants.map((restaurant) => restaurant.restaurant_id),
      });
      trim(now);
    },

    stats() {
      const now = Date.now();
      trim(now);
      const successful = state.events.filter((event) => !event.failed);
      const durationTotal = successful.reduce((total, event) => total + event.durationMs, 0);

      return {
        generated_at: new Date(now).toISOString(),
        period_seconds: METRIC_WINDOW_MS / 1_000,
        uptime_seconds: Math.floor((now - state.startedAt) / 1_000),
        searches: {
          total: state.searchesTotal,
          recent: state.events.length,
          errors_recent: state.events.filter((event) => event.failed).length,
          cache_hit_rate_recent: successful.length
            ? Number((successful.filter((event) => event.cacheHit).length / successful.length).toFixed(2))
            : 0,
          average_latency_ms_recent: successful.length ? Math.round(durationTotal / successful.length) : 0,
        },
        active: {
          users_recent: new Set(state.events.map((event) => event.client)).size,
          restaurants_recent: new Set(successful.flatMap((event) => event.restaurantIds)).size,
        },
      };
    },
  };
}

module.exports = { createMetrics };
