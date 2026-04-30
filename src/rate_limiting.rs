use soroban_sdk::{Address, Env, Symbol, Vec, String, Map, contracttype, contractimpl, symbol_short, Error};
use crate::healthcare_drips::{HealthcareDripsError};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RateLimitType {
    PerSecond,
    PerMinute,
    PerHour,
    PerDay,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LimitScope {
    Global,
    PerUser,
    PerEndpoint,
    PerUserEndpoint,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RateLimit {
    pub limit_id: u64,
    pub scope: LimitScope,
    pub limit_type: RateLimitType,
    pub max_requests: u64,
    pub window_size: u64,
    pub current_count: u64,
    pub window_start: u64,
    pub endpoint: Option<Symbol>,
    pub user: Option<Address>,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DDoSProtection {
    pub protection_id: u64,
    pub ip_address: Address,
    pub blocked: bool,
    pub block_reason: String,
    pub block_expiry: u64,
    pub violation_count: u64,
    pub last_violation: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct WhitelistEntry {
    pub entry_id: u64,
    pub address: Address,
    pub endpoint: Option<Symbol>,
    pub unlimited: bool,
    pub custom_limit: Option<u64>,
    pub reason: String,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RateLimitMetrics {
    pub total_requests: u64,
    pub blocked_requests: u64,
    pub active_limits: u64,
    pub ddos_blocks: u64,
    pub whitelist_entries: u64,
    pub average_response_time: u64,
    pub last_updated: u64,
}

const RATE_LIMITS_KEY: Symbol = symbol_short!("RATE_LIM");
const DDOS_PROTECTION_KEY: Symbol = symbol_short!("DDOS_PROT");
const WHITELIST_KEY: Symbol = symbol_short!("WHITELIST");
const RATE_METRICS_KEY: Symbol = symbol_short!("RATE_MET");
const USER_REQUESTS_KEY: Symbol = symbol_short!("USER_REQ");
const ENDPOINT_REQUESTS_KEY: Symbol = symbol_short!("END_REQ");

pub struct RateLimiter;

#[contractimpl]
impl RateLimiter {
    /// Initialize the rate limiting system
    pub fn initialize(env: &Env, _admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&RATE_LIMITS_KEY) {
            return Err(HealthcareDripsError::AlreadyExists.into());
        }

        // Initialize storage
        env.storage().instance().set(&RATE_LIMITS_KEY, &Vec::<RateLimit>::new(env));
        env.storage().instance().set(&DDOS_PROTECTION_KEY, &Vec::<DDoSProtection>::new(env));
        env.storage().instance().set(&WHITELIST_KEY, &Vec::<WhitelistEntry>::new(env));
        env.storage().instance().set(&USER_REQUESTS_KEY, &Map::<Address, Map<RateLimitType, Vec<u64>>>::new(env));
        env.storage().instance().set(&ENDPOINT_REQUESTS_KEY, &Map::<Symbol, Map<Address, Vec<u64>>>::new(env));
        
        // Initialize metrics
        let initial_metrics = RateLimitMetrics {
            total_requests: 0,
            blocked_requests: 0,
            active_limits: 0,
            ddos_blocks: 0,
            whitelist_entries: 0,
            average_response_time: 0,
            last_updated: env.ledger().timestamp(),
        };
        env.storage().instance().set(&RATE_METRICS_KEY, &initial_metrics);

        // Set up default rate limits
        Self::setup_default_limits(env)?;

        Ok(())
    }

    /// Set up default rate limits
    fn setup_default_limits(env: &Env) -> Result<(), Error> {
        let mut limits: Vec<RateLimit> = env.storage().instance()
            .get(&RATE_LIMITS_KEY)
            .unwrap_or_else(|| Vec::new(env));

        // Global limits
        limits.push_back(RateLimit {
            limit_id: 1,
            scope: LimitScope::Global,
            limit_type: RateLimitType::PerSecond,
            max_requests: 1000,
            window_size: 1,
            current_count: 0,
            window_start: env.ledger().timestamp(),
            endpoint: None,
            user: None,
        });

        limits.push_back(RateLimit {
            limit_id: 2,
            scope: LimitScope::Global,
            limit_type: RateLimitType::PerMinute,
            max_requests: 10000,
            window_size: 60,
            current_count: 0,
            window_start: env.ledger().timestamp(),
            endpoint: None,
            user: None,
        });

        // Per-user limits
        limits.push_back(RateLimit {
            limit_id: 3,
            scope: LimitScope::PerUser,
            limit_type: RateLimitType::PerSecond,
            max_requests: 10,
            window_size: 1,
            current_count: 0,
            window_start: env.ledger().timestamp(),
            endpoint: None,
            user: None,
        });

        limits.push_back(RateLimit {
            limit_id: 4,
            scope: LimitScope::PerUser,
            limit_type: RateLimitType::PerMinute,
            max_requests: 100,
            window_size: 60,
            current_count: 0,
            window_start: env.ledger().timestamp(),
            endpoint: None,
            user: None,
        });

        env.storage().instance().set(&RATE_LIMITS_KEY, &limits);
        Ok(())
    }

    /// Check if a request should be allowed
    pub fn check_rate_limit(
        env: &Env,
        user: Address,
        endpoint: Option<Symbol>,
    ) -> Result<bool, Error> {
        let current_time = env.ledger().timestamp();
        
        // Check if user is whitelisted
        if Self::is_whitelisted(env, user.clone(), endpoint.clone())? {
            return Ok(true);
        }

        // Check if user is blocked by DDoS protection
        if Self::is_ddos_blocked(env, user.clone(), current_time)? {
            Self::update_metrics(env, 1, 0, 1, 0)?;
            return Ok(false);
        }

        // Check all applicable rate limits
        let limits: Vec<RateLimit> = env.storage().instance()
            .get(&RATE_LIMITS_KEY)
            .unwrap_or_else(|| Vec::new(env));

        for limit in limits.iter() {
            if Self::is_limit_applicable(&limit, user.clone(), endpoint.clone()) {
                if !Self::check_single_limit(env, &limit, user.clone(), endpoint.clone(), current_time)? {
                    Self::update_metrics(env, 1, 1, 0, 0)?;
                    
                    // Check for potential DDoS
                    Self::check_ddos_violation(env, user.clone(), current_time)?;
                    
                    return Ok(false);
                }
            }
        }

        // Record the request
        Self::record_request(env, user, endpoint, current_time)?;
        Self::update_metrics(env, 1, 0, 0, 0)?;
        
        Ok(true)
    }

    /// Check if a limit applies to the given request
    fn is_limit_applicable(limit: &RateLimit, user: Address, endpoint: Option<Symbol>) -> bool {
        match limit.scope {
            LimitScope::Global => true,
            LimitScope::PerUser => limit.user.is_none() || limit.user.as_ref().unwrap() == &user,
            LimitScope::PerEndpoint => limit.endpoint.is_none() || 
                endpoint.is_some() && limit.endpoint.as_ref().unwrap() == endpoint.as_ref().unwrap(),
            LimitScope::PerUserEndpoint => {
                let user_match = limit.user.is_none() || limit.user.as_ref().unwrap() == &user;
                let endpoint_match = limit.endpoint.is_none() || 
                    endpoint.is_some() && limit.endpoint.as_ref().unwrap() == endpoint.as_ref().unwrap();
                user_match && endpoint_match
            }
        }
    }

    /// Check a single rate limit
    fn check_single_limit(
        env: &Env,
        limit: &RateLimit,
        user: Address,
        endpoint: Option<Symbol>,
        current_time: u64,
    ) -> Result<bool, Error> {
        let window_start = current_time - (current_time % limit.window_size);
        
        // Get request count for this window
        let count = Self::get_request_count(env, limit, user, endpoint, window_start, current_time)?;
        
        Ok(count < limit.max_requests)
    }

    /// Get request count for a specific window
    fn get_request_count(
        env: &Env,
        limit: &RateLimit,
        user: Address,
        endpoint: Option<Symbol>,
        window_start: u64,
        current_time: u64,
    ) -> Result<u64, Error> {
        match limit.scope {
            LimitScope::Global => {
                // For global limits, we need to count all requests
                let user_requests: Map<Address, Map<RateLimitType, Vec<u64>>> = env.storage().instance()
                    .get(&USER_REQUESTS_KEY)
                    .unwrap_or_else(|| Map::new(env));
                
                let mut total_count = 0;
                for (_, type_map) in user_requests.iter() {
                    if let Some(requests) = type_map.get(limit.limit_type.clone()) {
                        total_count += requests.iter()
                            .filter(|&timestamp| timestamp >= window_start && timestamp <= current_time)
                            .count() as u64;
                    }
                }
                Ok(total_count)
            }
            LimitScope::PerUser => {
                let user_requests: Map<Address, Map<RateLimitType, Vec<u64>>> = env.storage().instance()
                    .get(&USER_REQUESTS_KEY)
                    .unwrap_or_else(|| Map::new(env));
                
                if let Some(type_map) = user_requests.get(user) {
                    if let Some(requests) = type_map.get(limit.limit_type.clone()) {
                        Ok(requests.iter()
                            .filter(|&timestamp| timestamp >= window_start && timestamp <= current_time)
                            .count() as u64)
                    } else {
                        Ok(0)
                    }
                } else {
                    Ok(0)
                }
            }
            LimitScope::PerEndpoint | LimitScope::PerUserEndpoint => {
                let endpoint_requests: Map<Symbol, Map<Address, Vec<u64>>> = env.storage().instance()
                    .get(&ENDPOINT_REQUESTS_KEY)
                    .unwrap_or_else(|| Map::new(env));
                
                if let Some(endpoint_sym) = endpoint {
                    if let Some(user_map) = endpoint_requests.get(endpoint_sym) {
                        if let Some(requests) = user_map.get(user) {
                            Ok(requests.iter()
                                .filter(|&timestamp| timestamp >= window_start && timestamp <= current_time)
                                .count() as u64)
                        } else {
                            Ok(0)
                        }
                    } else {
                        Ok(0)
                    }
                } else {
                    Ok(0)
                }
            }
        }
    }

    /// Record a request
    fn record_request(
        env: &Env,
        user: Address,
        endpoint: Option<Symbol>,
        current_time: u64,
    ) -> Result<(), Error> {
        // Record in user requests
        let mut user_requests: Map<Address, Map<RateLimitType, Vec<u64>>> = env.storage().instance()
            .get(&USER_REQUESTS_KEY)
            .unwrap_or_else(|| Map::new(env));
        
        let user_type_map = user_requests.get(user.clone())
            .unwrap_or_else(|| Map::new(env));
        
        // Record for all rate limit types
        for limit_type in [RateLimitType::PerSecond, RateLimitType::PerMinute, RateLimitType::PerHour, RateLimitType::PerDay] {
            let mut requests = user_type_map.get(limit_type.clone())
                .unwrap_or_else(|| Vec::new(env));
            requests.push_back(current_time);
            
            // Keep only recent requests (last 24 hours)
            let cutoff = current_time - 86400; // 24 hours ago
            let mut filtered_requests = Vec::new(env);
            for timestamp in requests.iter() {
                if timestamp > cutoff {
                    filtered_requests.push_back(timestamp);
                }
            }
            
            let mut updated_type_map = user_type_map.clone();
            updated_type_map.set(limit_type, filtered_requests);
            user_requests.set(user.clone(), updated_type_map);
        }
        
        env.storage().instance().set(&USER_REQUESTS_KEY, &user_requests);

        // Record in endpoint requests if endpoint is specified
        if let Some(endpoint_sym) = endpoint {
            let mut endpoint_requests: Map<Symbol, Map<Address, Vec<u64>>> = env.storage().instance()
                .get(&ENDPOINT_REQUESTS_KEY)
                .unwrap_or_else(|| Map::new(env));
            
            let user_map = endpoint_requests.get(endpoint_sym.clone())
                .unwrap_or_else(|| Map::new(env));
            
            let mut requests = user_map.get(user.clone())
                .unwrap_or_else(|| Vec::new(env));
            requests.push_back(current_time);
            
            // Keep only recent requests
            let cutoff = current_time - 86400;
            let mut filtered_requests = Vec::new(env);
            for timestamp in requests.iter() {
                if timestamp > cutoff {
                    filtered_requests.push_back(timestamp);
                }
            }
            
            let mut updated_user_map = user_map.clone();
            updated_user_map.set(user, filtered_requests);
            endpoint_requests.set(endpoint_sym, updated_user_map);
            
            env.storage().instance().set(&ENDPOINT_REQUESTS_KEY, &endpoint_requests);
        }

        Ok(())
    }

    /// Check if user is whitelisted
    fn is_whitelisted(env: &Env, user: Address, endpoint: Option<Symbol>) -> Result<bool, Error> {
        let whitelist: Vec<WhitelistEntry> = env.storage().instance()
            .get(&WHITELIST_KEY)
            .unwrap_or_else(|| Vec::new(env));
        
        for entry in whitelist.iter() {
            if entry.address == user {
                if entry.unlimited {
                    return Ok(true);
                }
                
                // Check if whitelist entry applies to this endpoint
                if entry.endpoint.is_none() || 
                    (endpoint.is_some() && entry.endpoint.as_ref().unwrap() == endpoint.as_ref().unwrap()) {
                    return Ok(true);
                }
            }
        }
        
        Ok(false)
    }

    /// Check if user is blocked by DDoS protection
    fn is_ddos_blocked(env: &Env, user: Address, current_time: u64) -> Result<bool, Error> {
        let ddos_protection: Vec<DDoSProtection> = env.storage().instance()
            .get(&DDOS_PROTECTION_KEY)
            .unwrap_or_else(|| Vec::new(env));
        
        for protection in ddos_protection.iter() {
            if protection.ip_address == user && protection.blocked {
                if current_time < protection.block_expiry {
                    return Ok(true);
                }
            }
        }
        
        Ok(false)
    }

    /// Check for DDoS violations
    fn check_ddos_violation(env: &Env, user: Address, current_time: u64) -> Result<(), Error> {
        let user_requests: Map<Address, Map<RateLimitType, Vec<u64>>> = env.storage().instance()
            .get(&USER_REQUESTS_KEY)
            .unwrap_or_else(|| Map::new(env));
        
        if let Some(type_map) = user_requests.get(user.clone()) {
            if let Some(requests) = type_map.get(RateLimitType::PerSecond) {
                let recent_requests = requests.iter()
                    .filter(|&timestamp| current_time - timestamp < 10) // Last 10 seconds
                    .count() as u64;
                
                // If more than 50 requests in 10 seconds, consider it DDoS
                if recent_requests > 50 {
                    Self::apply_ddos_block(env, user, current_time, "Excessive request rate detected")?;
                }
            }
        }
        
        Ok(())
    }

    /// Apply DDoS block
    fn apply_ddos_block(env: &Env, user: Address, current_time: u64, reason: &str) -> Result<(), Error> {
        let mut ddos_protection: Vec<DDoSProtection> = env.storage().instance()
            .get(&DDOS_PROTECTION_KEY)
            .unwrap_or_else(|| Vec::new(env));
        
        // Check if user already has a protection entry
        let mut found = false;
        for i in 0..ddos_protection.len() {
            let protection = ddos_protection.get(i).unwrap();
            if protection.ip_address == user {
                found = true;
                break;
            }
        }
        
        if found {
            // Update existing protection
            let mut updated_protection = Vec::new(env);
            for protection in ddos_protection.iter() {
                if protection.ip_address == user {
                    let mut new_protection = protection.clone();
                    new_protection.blocked = true;
                    new_protection.block_expiry = current_time + 300; // 5 minutes
                    new_protection.violation_count += 1;
                    new_protection.last_violation = current_time;
                    new_protection.block_reason = String::from_str(env, reason);
                    updated_protection.push_back(new_protection);
                } else {
                    updated_protection.push_back(protection.clone());
                }
            }
            env.storage().instance().set(&DDOS_PROTECTION_KEY, &updated_protection);
            return Ok(());
        }
        
        // Create new protection entry
        let protection = DDoSProtection {
            protection_id: ddos_protection.len() as u64 + 1,
            ip_address: user,
            blocked: true,
            block_reason: String::from_str(env, reason),
            block_expiry: current_time + 300, // 5 minutes
            violation_count: 1,
            last_violation: current_time,
        };
        
        ddos_protection.push_back(protection);
        env.storage().instance().set(&DDOS_PROTECTION_KEY, &ddos_protection);
        
        Ok(())
    }

    /// Add user to whitelist
    pub fn add_to_whitelist(
        env: &Env,
        _admin: Address,
        user: Address,
        endpoint: Option<Symbol>,
        unlimited: bool,
        custom_limit: Option<u64>,
        reason: String,
    ) -> Result<(), Error> {
        let mut whitelist: Vec<WhitelistEntry> = env.storage().instance()
            .get(&WHITELIST_KEY)
            .unwrap_or_else(|| Vec::new(env));
        
        let entry = WhitelistEntry {
            entry_id: whitelist.len() as u64 + 1,
            address: user,
            endpoint,
            unlimited,
            custom_limit,
            reason,
            created_at: env.ledger().timestamp(),
        };
        
        whitelist.push_back(entry);
        env.storage().instance().set(&WHITELIST_KEY, &whitelist);
        
        Ok(())
    }

    /// Remove user from whitelist
    pub fn remove_from_whitelist(env: &Env, _admin: Address, user: Address, endpoint: Option<Symbol>) -> Result<(), Error> {
        let whitelist: Vec<WhitelistEntry> = env.storage().instance()
            .get(&WHITELIST_KEY)
            .unwrap_or_else(|| Vec::new(env));
        
        let mut updated_whitelist = Vec::new(env);
        for entry in whitelist.iter() {
            let should_keep = if entry.address == user {
                if let Some(entry_endpoint) = entry.endpoint.as_ref() {
                    if let Some(param_endpoint) = endpoint.as_ref() {
                        entry_endpoint != param_endpoint
                    } else {
                        false // If no endpoint specified, remove all entries for this user
                    }
                } else {
                    false // Entry has no endpoint restriction, remove it
                }
            } else {
                true // Keep entries for other users
            };
            
            if should_keep {
                updated_whitelist.push_back(entry.clone());
            }
        }
        
        env.storage().instance().set(&WHITELIST_KEY, &updated_whitelist);
        Ok(())
    }

    /// Create custom rate limit
    pub fn create_rate_limit(
        env: &Env,
        _admin: Address,
        scope: LimitScope,
        limit_type: RateLimitType,
        max_requests: u64,
        window_size: u64,
        endpoint: Option<Symbol>,
        user: Option<Address>,
    ) -> Result<(), Error> {
        let mut limits: Vec<RateLimit> = env.storage().instance()
            .get(&RATE_LIMITS_KEY)
            .unwrap_or_else(|| Vec::new(env));
        
        let limit = RateLimit {
            limit_id: limits.len() as u64 + 1,
            scope,
            limit_type,
            max_requests,
            window_size,
            current_count: 0,
            window_start: env.ledger().timestamp(),
            endpoint,
            user,
        };
        
        limits.push_back(limit);
        env.storage().instance().set(&RATE_LIMITS_KEY, &limits);
        
        Ok(())
    }

    /// Update rate limit metrics
    fn update_metrics(
        env: &Env,
        total_requests: u64,
        blocked_requests: u64,
        ddos_blocks: u64,
        _whitelist_hits: u64,
    ) -> Result<(), Error> {
        let mut metrics: RateLimitMetrics = env.storage().instance()
            .get(&RATE_METRICS_KEY)
            .unwrap_or_else(|| RateLimitMetrics {
                total_requests: 0,
                blocked_requests: 0,
                active_limits: 0,
                ddos_blocks: 0,
                whitelist_entries: 0,
                average_response_time: 0,
                last_updated: env.ledger().timestamp(),
            });
        
        metrics.total_requests += total_requests;
        metrics.blocked_requests += blocked_requests;
        metrics.ddos_blocks += ddos_blocks;
        metrics.last_updated = env.ledger().timestamp();
        
        env.storage().instance().set(&RATE_METRICS_KEY, &metrics);
        Ok(())
    }

    /// Get rate limiting metrics
    pub fn get_metrics(env: &Env) -> Result<RateLimitMetrics, Error> {
        env.storage().instance()
            .get(&RATE_METRICS_KEY)
            .ok_or_else(|| HealthcareDripsError::NotFound.into())
    }

    /// Get active DDoS blocks
    pub fn get_ddos_blocks(env: &Env) -> Result<Vec<DDoSProtection>, Error> {
        let ddos_protection: Vec<DDoSProtection> = env.storage().instance()
            .get(&DDOS_PROTECTION_KEY)
            .unwrap_or_else(|| Vec::new(env));
        
        let current_time = env.ledger().timestamp();
        let mut result = Vec::new(env);
        for protection in ddos_protection.iter() {
            if protection.blocked && current_time < protection.block_expiry {
                result.push_back(protection.clone());
            }
        }
        Ok(result)
    }

    /// Get whitelist entries
    pub fn get_whitelist(env: &Env) -> Result<Vec<WhitelistEntry>, Error> {
        env.storage().instance()
            .get(&WHITELIST_KEY)
            .ok_or_else(|| HealthcareDripsError::NotFound.into())
    }

    /// Remove DDoS block
    pub fn remove_ddos_block(env: &Env, _admin: Address, user: Address) -> Result<(), Error> {
        let ddos_protection: Vec<DDoSProtection> = env.storage().instance()
            .get(&DDOS_PROTECTION_KEY)
            .unwrap_or_else(|| Vec::new(env));
        
        // Update protection entries
        let mut updated_protection = Vec::new(env);
        for protection in ddos_protection.iter() {
            if protection.ip_address == user {
                let mut new_protection = protection.clone();
                new_protection.blocked = false;
                new_protection.block_expiry = 0;
                updated_protection.push_back(new_protection);
            } else {
                updated_protection.push_back(protection.clone());
            }
        }
        env.storage().instance().set(&DDOS_PROTECTION_KEY, &updated_protection);
        Ok(())
    }
}
