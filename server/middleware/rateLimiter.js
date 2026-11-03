/**
 * Rate limiting middleware using in-memory store
 * Limits requests per IP address or user
 */

const { RateLimitError } = require('./errorHandler');

class RateLimiter {
  constructor() {
    this.requests = new Map();
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000); // Cleanup every minute
  }

  /**
   * Get rate limit key (IP or user ID)
   */
  getKey(req) {
    return req.user?.id || req.ip;
  }

  /**
   * Check if request is allowed
   */
  isAllowed(key, limit = 100, windowMs = 60000) {
    const now = Date.now();
    const windowStart = now - windowMs;

    if (!this.requests.has(key)) {
      this.requests.set(key, []);
    }

    const timestamps = this.requests.get(key);
    const recentRequests = timestamps.filter((t) => t > windowStart);

    if (recentRequests.length >= limit) {
      return {
        allowed: false,
        retryAfter: Math.ceil((Math.min(...recentRequests) + windowMs - now) / 1000)
      };
    }

    recentRequests.push(now);
    this.requests.set(key, recentRequests);

    return { allowed: true, retryAfter: 0 };
  }

  /**
   * Count the recent hits for a key without recording a new one
   */
  count(key, windowMs) {
    const windowStart = Date.now() - windowMs;
    const recent = (this.requests.get(key) || []).filter((t) => t > windowStart);
    this.requests.set(key, recent);
    return { count: recent.length, oldest: recent.length ? Math.min(...recent) : 0 };
  }

  /**
   * Record one hit for a key
   */
  record(key) {
    if (!this.requests.has(key)) this.requests.set(key, []);
    this.requests.get(key).push(Date.now());
  }

  /**
   * Cleanup old entries
   */
  cleanup() {
    const now = Date.now();
    const maxAge = 3600000; // 1 hour

    for (const [key, timestamps] of this.requests.entries()) {
      const recentTimestamps = timestamps.filter((t) => now - t < maxAge);
      if (recentTimestamps.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, recentTimestamps);
      }
    }
  }

  /**
   * Destroy the limiter
   */
  destroy() {
    clearInterval(this.cleanupInterval);
  }
}

const limiter = new RateLimiter();

/**
 * General rate limiting middleware
 * 100 requests per minute per IP/user
 */
function rateLimitMiddleware(limit = 100, windowMs = 60000, scope = 'api') {
  return (req, res, next) => {
    const key = `${scope}:${limiter.getKey(req)}`;
    const check = limiter.isAllowed(key, limit, windowMs);

    res.set('X-RateLimit-Limit', limit);
    res.set('X-RateLimit-Remaining', Math.max(0, limit - (limiter.requests.get(key)?.length || 0)));

    if (!check.allowed) {
      res.set('Retry-After', check.retryAfter);
      throw new RateLimitError(check.retryAfter);
    }

    next();
  };
}

/**
 * Rate limiting for auth endpoints: only FAILED attempts count (wrong password, name taken...),
 * so signing in successfully never uses up your allowance. 10 failures per 5 minutes per IP.
 */
function authRateLimit(limit = 10, windowMs = 5 * 60 * 1000) {
  return (req, res, next) => {
    const key = `auth-fail:${limiter.getKey(req)}`;
    const { count, oldest } = limiter.count(key, windowMs);
    if (count >= limit) {
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - Date.now()) / 1000));
      res.set('Retry-After', retryAfter);
      throw new RateLimitError(retryAfter);
    }
    res.on('finish', () => {
      if (res.statusCode >= 400 && res.statusCode !== 429) limiter.record(key);
    });
    next();
  };
}

/**
 * Moderate rate limiting for API endpoints
 * 100 requests per minute per user
 */
function apiRateLimit() {
  return rateLimitMiddleware(100, 60000, 'api');
}

/**
 * Prediction submission rate limiting
 * 50 predictions per hour per user
 */
function predictionRateLimit() {
  return rateLimitMiddleware(50, 3600000, 'predict');
}

module.exports = {
  rateLimitMiddleware,
  authRateLimit,
  apiRateLimit,
  predictionRateLimit,
  RateLimiter
};
