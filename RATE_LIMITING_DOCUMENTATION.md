# Rate Limiting and Throttling Documentation

## Overview

This document describes the implementation of a sophisticated rate limiting and throttling system for the Healthcare Insurance Stellar platform. The system provides user-based limits, API endpoint restrictions, DDoS protection, dynamic limit adjustment, whitelisting support, monitoring alerts, and graceful degradation.

## Features

### 1. User-Based Limits
- **Per-user rate limiting**: Individual limits for each user
- **Tiered access levels**: Different limits based on user roles
- **Customizable limits**: Flexible configuration options
- **Fair usage policies**: Ensure equitable resource distribution

### 2. API Endpoint Restrictions
- **Endpoint-specific limits**: Different limits for different endpoints
- **Resource-based throttling**: Limits based on resource consumption
- **Method-specific controls**: Different limits for GET, POST, etc.
- **Time-based restrictions**: Hourly, daily, monthly limits

### 3. DDoS Protection
- **Automatic detection**: Identify potential DDoS attacks
- **Dynamic blocking**: Temporary blocks for suspicious activity
- **Gradual degradation**: Progressive response to threats
- **Recovery mechanisms**: Automatic unblocking and recovery

### 4. Dynamic Limit Adjustment
- **Real-time adaptation**: Adjust limits based on system load
- **Load-based scaling**: Modify limits based on traffic patterns
- **Emergency controls**: Rapid response to system stress
- **Performance optimization**: Maintain optimal performance

### 5. Whitelisting Support
- **User whitelisting**: Bypass limits for trusted users
- **Endpoint whitelisting**: Unlimited access to specific endpoints
- **Custom limits**: Special limits for whitelisted entities
- **Audit tracking**: Monitor whitelist usage

### 6. Monitoring Alerts
- **Real-time monitoring**: Track rate limiting activities
- **Alert generation**: Notifications for limit violations
- **Performance metrics**: System health indicators
- **Compliance reporting**: Detailed usage statistics

### 7. Graceful Degradation
- **Progressive throttling**: Gradual response to overload
- **Service preservation**: Maintain critical functions
- **User communication**: Clear status messages
- **Recovery procedures**: Smooth return to normal operation

## Architecture

### Core Components

#### 1. RateLimit Structure
```rust
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
```

#### 2. DDoSProtection Structure
```rust
pub struct DDoSProtection {
    pub protection_id: u64,
    pub ip_address: Address,
    pub blocked: bool,
    pub block_reason: String,
    pub block_expiry: u64,
    pub violation_count: u64,
    pub last_violation: u64,
}
```

#### 3. WhitelistEntry Structure
```rust
pub struct WhitelistEntry {
    pub entry_id: u64,
    pub address: Address,
    pub endpoint: Option<Symbol>,
    pub unlimited: bool,
    pub custom_limit: Option<u64>,
    pub reason: String,
    pub created_at: u64,
}
```

### Limit Types

#### RateLimitType Enum
- **PerSecond**: Requests per second
- **PerMinute**: Requests per minute
- **PerHour**: Requests per hour
- **PerDay**: Requests per day

#### LimitScope Enum
- **Global**: System-wide limits
- **PerUser**: Individual user limits
- **PerEndpoint**: Endpoint-specific limits
- **PerUserEndpoint**: Combined user and endpoint limits

## API Reference

### Initialization
```rust
pub fn initialize(env: &Env, admin: Address) -> Result<(), Error>
```
Initializes the rate limiting system with default configurations.

### Rate Limiting
```rust
pub fn check_rate_limit(env: &Env, user: Address, endpoint: Option<Symbol>) -> Result<bool, Error>
```
Checks if a request should be allowed based on configured limits.

### Whitelist Management
```rust
pub fn add_to_whitelist(env: &Env, admin: Address, user: Address, endpoint: Option<Symbol>, unlimited: bool, custom_limit: Option<u64>, reason: String) -> Result<(), Error>
pub fn remove_from_whitelist(env: &Env, admin: Address, user: Address, endpoint: Option<Symbol>) -> Result<(), Error>
```
Manage whitelist entries for bypassing rate limits.

### Custom Limits
```rust
pub fn create_rate_limit(env: &Env, admin: Address, scope: LimitScope, limit_type: RateLimitType, max_requests: u64, window_size: u64, endpoint: Option<Symbol>, user: Option<Address>) -> Result<(), Error>
```
Create custom rate limits for specific scenarios.

### DDoS Protection
```rust
pub fn get_ddos_blocks(env: &Env) -> Result<Vec<DDoSProtection>, Error>
pub fn remove_ddos_block(env: &Env, admin: Address, user: Address) -> Result<(), Error>
```
Manage DDoS protection blocks.

### Monitoring
```rust
pub fn get_metrics(env: &Env) -> Result<RateLimitMetrics, Error>
pub fn get_whitelist(env: &Env) -> Result<Vec<WhitelistEntry>, Error>
```
Retrieve system metrics and configuration.

## Default Configuration

### Global Limits
- **Per Second**: 1,000 requests
- **Per Minute**: 10,000 requests
- **Per Hour**: 100,000 requests
- **Per Day**: 1,000,000 requests

### Per-User Limits
- **Per Second**: 10 requests
- **Per Minute**: 100 requests
- **Per Hour**: 1,000 requests
- **Per Day**: 10,000 requests

### DDoS Protection
- **Threshold**: 50 requests in 10 seconds
- **Block Duration**: 5 minutes
- **Violation Tracking**: Cumulative violation count
- **Auto-recovery**: Automatic block expiration

## Rate Limiting Algorithm

### 1. Request Validation
```rust
fn check_rate_limit(env: &Env, user: Address, endpoint: Option<Symbol>) -> Result<bool, Error> {
    // Check whitelist
    if is_whitelisted(env, user.clone(), endpoint.clone())? {
        return Ok(true);
    }
    
    // Check DDoS blocks
    if is_ddos_blocked(env, user.clone(), current_time)? {
        return Ok(false);
    }
    
    // Check applicable limits
    for limit in limits.iter() {
        if is_limit_applicable(limit, user.clone(), endpoint.clone()) {
            if !check_single_limit(env, limit, user.clone(), endpoint.clone(), current_time)? {
                // Handle violation
                return Ok(false);
            }
        }
    }
    
    // Record request
    record_request(env, user, endpoint, current_time)?;
    Ok(true)
}
```

### 2. Limit Application
```rust
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
```

### 3. Request Counting
```rust
fn get_request_count(env: &Env, limit: &RateLimit, user: Address, endpoint: Option<Symbol>, window_start: u64, current_time: u64) -> Result<u64, Error> {
    match limit.scope {
        LimitScope::Global => {
            // Count all requests in the window
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
            // Count requests for specific user
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
        // ... other scope implementations
    }
}
```

## DDoS Protection

### Detection Algorithm
```rust
fn check_ddos_violation(env: &Env, user: Address, current_time: u64) -> Result<(), Error> {
    if let Some(type_map) = user_requests.get(user.clone()) {
        if let Some(requests) = type_map.get(RateLimitType::PerSecond) {
            let recent_requests = requests.iter()
                .filter(|&timestamp| current_time - timestamp < 10) // Last 10 seconds
                .count() as u64;
            
            // If more than 50 requests in 10 seconds, consider it DDoS
            if recent_requests > 50 {
                apply_ddos_block(env, user, current_time, "Excessive request rate detected")?;
            }
        }
    }
    Ok(())
}
```

### Block Management
```rust
fn apply_ddos_block(env: &Env, user: Address, current_time: u64, reason: &str) -> Result<(), Error> {
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
```

## Whitelist Management

### Adding to Whitelist
```rust
pub fn add_to_whitelist(env: &Env, admin: Address, user: Address, endpoint: Option<Symbol>, unlimited: bool, custom_limit: Option<u64>, reason: String) -> Result<(), Error> {
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
```

### Whitelist Validation
```rust
fn is_whitelisted(env: &Env, user: Address, endpoint: Option<Symbol>) -> Result<bool, Error> {
    for entry in whitelist.iter() {
        if entry.address == user {
            if entry.unlimited {
                return Ok(true);
            }
            
            if entry.endpoint.is_none() || 
                (endpoint.is_some() && entry.endpoint.as_ref().unwrap() == endpoint.as_ref().unwrap()) {
                return Ok(true);
            }
        }
    }
    Ok(false)
}
```

## Performance Monitoring

### Metrics Collection
```rust
pub struct RateLimitMetrics {
    pub total_requests: u64,
    pub blocked_requests: u64,
    pub active_limits: u64,
    pub ddos_blocks: u64,
    pub whitelist_entries: u64,
    pub average_response_time: u64,
    pub last_updated: u64,
}
```

### Performance Optimization
- **Efficient data structures**: Optimized storage and retrieval
- **Sliding window algorithm**: Efficient time-based counting
- **Memory management**: Automatic cleanup of old data
- **Parallel processing**: Concurrent limit checking

## Security Considerations

### Attack Prevention
- **Rate limiting**: Prevent brute force attacks
- **DDoS protection**: Mitigate denial of service attacks
- **Access control**: Role-based limit assignments
- **Audit logging**: Comprehensive activity tracking

### Data Protection
- **Encrypted storage**: Secure limit configuration
- **Access controls**: Administrative privilege separation
- **Privacy compliance**: Data handling regulations
- **Audit trails**: Complete action logging

## Integration Points

### Healthcare Drips Core
- Seamless integration with existing authentication
- Shared user management system
- Common error handling patterns

### Real-Time Processing
- Coordinated rate limiting for stream processing
- Shared metrics and monitoring
- Unified alerting system

### External Systems
- RESTful API endpoints
- Webhook notifications
- Third-party integrations

## Usage Examples

### Basic Rate Limiting
```rust
let allowed = RateLimiter::check_rate_limit(&env, user_address, Some(symbol_short!("CLAIMS")))?;
if !allowed {
    // Handle rate limit exceeded
    return Err(HealthcareDripsError::RateLimitExceeded.into());
}
```

### Whitelist Management
```rust
// Add user to whitelist
RateLimiter::add_to_whitelist(
    &env,
    admin_address,
    user_address,
    Some(symbol_short!("PREMIUM")),
    true,
    None,
    String::from_str(&env, "Premium user access")
)?;

// Check if user is whitelisted
let whitelist = RateLimiter::get_whitelist(&env)?;
```

### Custom Limits
```rust
RateLimiter::create_rate_limit(
    &env,
    admin_address,
    LimitScope::PerUser,
    RateLimitType::PerMinute,
    50, // 50 requests per minute
    60, // 1 minute window
    Some(symbol_short!("UPLOAD")),
    Some(user_address)
)?;
```

### DDoS Protection
```rust
// Check for active blocks
let blocks = RateLimiter::get_ddos_blocks(&env)?;
for block in blocks.iter() {
    if block.blocked && block.block_expiry > current_time {
        // Handle blocked user
    }
}

// Remove block manually
RateLimiter::remove_ddos_block(&env, admin_address, user_address)?;
```

## Best Practices

### Configuration
- Start with conservative limits
- Monitor system performance
- Adjust limits based on usage patterns
- Regular security reviews

### Monitoring
- Set up alerting for limit violations
- Monitor DDoS protection triggers
- Track whitelist usage
- Performance metric analysis

### Security
- Regular whitelist audits
- Monitor for abuse patterns
- Implement proper access controls
- Maintain comprehensive logs

## Troubleshooting

### Common Issues
- **Users being blocked unexpectedly**: Check whitelist configuration
- **Performance degradation**: Review limit configurations
- **DDoS false positives**: Adjust detection thresholds
- **Memory usage**: Implement data cleanup policies

### Debugging Tools
- Metrics analysis
- Log inspection
- Configuration validation
- Performance profiling

## Future Enhancements

### Advanced Features
- Machine learning-based anomaly detection
- Adaptive rate limiting
- Geographic-based restrictions
- Advanced analytics dashboard

### Scalability
- Distributed rate limiting
- Horizontal scaling support
- Load balancing integration
- Cloud-native deployment

### Integration
- Additional protocol support
- Third-party service integration
- API gateway integration
- Microservices architecture

## Conclusion

The rate limiting and throttling system provides comprehensive protection for the Healthcare Insurance Stellar platform while maintaining optimal performance and user experience. The system is designed for scalability, security, and ease of management with extensive monitoring and configuration capabilities.
