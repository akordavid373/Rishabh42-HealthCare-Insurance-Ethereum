const NodeCache = require('node-cache');
const redis = require('redis');

let cache;
let redisClient;

const CACHE_TTL = parseInt(process.env.CACHE_TTL) || 300;

if (process.env.REDIS_URL) {
  redisClient = redis.createClient({ url: process.env.REDIS_URL });
  
  redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err);
    redisClient = null;
  });
  
  redisClient.connect();
} else {
  cache = new NodeCache({ stdTTL: CACHE_TTL, checkperiod: 120 });
}

function cacheMiddleware(req, res, next) {
  const key = req.originalUrl;
  
  if (req.method !== 'GET') {
    return next();
  }

  if (redisClient) {
    redisClient.get(key)
      .then(data => {
        if (data) {
          return res.json(JSON.parse(data));
        }
        next();
      })
      .catch(err => {
        console.error('Cache error:', err);
        next();
      });
  } else if (cache) {
    const cachedData = cache.get(key);
    if (cachedData) {
      return res.json(cachedData);
    }
    next();
  } else {
    next();
  }
}

function setCache(key, data) {
  if (redisClient) {
    redisClient.setEx(key, CACHE_TTL, JSON.stringify(data))
      .catch(err => console.error('Redis set error:', err));
  } else if (cache) {
    cache.set(key, data);
  }
}

function deleteCache(pattern) {
  if (redisClient) {
    redisClient.del(pattern)
      .catch(err => console.error('Redis delete error:', err));
  } else if (cache) {
    const keys = cache.keys();
    keys.forEach(key => {
      if (key.includes(pattern)) {
        cache.del(key);
      }
    });
  }
}

function clearCache() {
  if (redisClient) {
    redisClient.flushDb()
      .catch(err => console.error('Redis flush error:', err));
  } else if (cache) {
    cache.flushAll();
  }
}

module.exports = {
  cacheMiddleware,
  setCache,
  deleteCache,
  clearCache
};
