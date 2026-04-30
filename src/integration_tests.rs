#[cfg(test)]
mod tests {
    use soroban_sdk::{Address, Env, Symbol, symbol_short, Vec, String};
    use crate::real_time_processing::{
        RealTimeProcessor, StreamData, StreamStatus, AnomalyType, AlertPriority,
        ProcessingMetrics
    };
    use crate::rate_limiting::{
        RateLimiter, RateLimitType, LimitScope, RateLimitMetrics, WhitelistEntry
    };
    use crate::healthcare_drips::HealthcareDripsError;

    #[test]
    fn test_real_time_processing_initialization() {
        let env = Env::default();
        let admin = Address::generate(&env);
        
        // Test initialization
        assert!(RealTimeProcessor::initialize(&env, admin).is_ok());
        
        // Test double initialization fails
        assert!(matches!(
            RealTimeProcessor::initialize(&env, admin),
            Err(HealthcareDripsError::AlreadyExists.into())
        ));
    }

    #[test]
    fn test_stream_data_processing() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        
        // Initialize
        RealTimeProcessor::initialize(&env, admin).unwrap();
        
        // Create test stream data
        let stream_data = StreamData {
            stream_id: 1,
            data_type: symbol_short!("CLAIM"),
            payload: soroban_sdk::Bytes::from_array(&env, &[1u8; 100]),
            timestamp: env.ledger().timestamp(),
            source: user,
            processed: false,
        };
        
        // Process stream data
        let result = RealTimeProcessor::process_stream_data(&env, stream_data);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 1);
        
        // Check metrics
        let metrics = RealTimeProcessor::get_metrics(&env).unwrap();
        assert_eq!(metrics.total_data_points, 1);
    }

    #[test]
    fn test_anomaly_detection() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        
        RealTimeProcessor::initialize(&env, admin).unwrap();
        
        // Create data that should trigger anomaly detection
        let large_payload = soroban_sdk::Bytes::from_array(&env, &[1u8; 6000]); // Large payload
        let stream_data = StreamData {
            stream_id: 2,
            data_type: symbol_short!("CLAIM"),
            payload: large_payload,
            timestamp: env.ledger().timestamp(),
            source: user,
            processed: false,
        };
        
        RealTimeProcessor::process_stream_data(&env, stream_data).unwrap();
        
        // Check for anomalies
        let anomalies = RealTimeProcessor::get_unresolved_anomalies(&env).unwrap();
        assert!(!anomalies.is_empty());
        
        // Check for alerts
        let alerts = RealTimeProcessor::get_active_alerts(&env).unwrap();
        assert!(!alerts.is_empty());
    }

    #[test]
    fn test_stream_status_management() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        
        RealTimeProcessor::initialize(&env, admin).unwrap();
        
        let stream_data = StreamData {
            stream_id: 3,
            data_type: symbol_short!("CLAIM"),
            payload: soroban_sdk::Bytes::from_array(&env, &[1u8; 100]),
            timestamp: env.ledger().timestamp(),
            source: user,
            processed: false,
        };
        
        RealTimeProcessor::process_stream_data(&env, stream_data).unwrap();
        
        // Pause stream
        assert!(RealTimeProcessor::pause_stream(&env, 3, admin).is_ok());
        
        // Resume stream
        assert!(RealTimeProcessor::resume_stream(&env, 3, admin).is_ok());
    }

    #[test]
    fn test_rate_limiting_initialization() {
        let env = Env::default();
        let admin = Address::generate(&env);
        
        // Test initialization
        assert!(RateLimiter::initialize(&env, admin).is_ok());
        
        // Test double initialization fails
        assert!(matches!(
            RateLimiter::initialize(&env, admin),
            Err(HealthcareDripsError::AlreadyExists.into())
        ));
    }

    #[test]
    fn test_basic_rate_limiting() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        
        RateLimiter::initialize(&env, admin).unwrap();
        
        // First few requests should be allowed
        for i in 0..5 {
            let allowed = RateLimiter::check_rate_limit(&env, user, None).unwrap();
            assert!(allowed, "Request {} should be allowed", i);
        }
        
        // Check metrics
        let metrics = RateLimiter::get_metrics(&env).unwrap();
        assert_eq!(metrics.total_requests, 5);
        assert_eq!(metrics.blocked_requests, 0);
    }

    #[test]
    fn test_whitelist_functionality() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        
        RateLimiter::initialize(&env, admin).unwrap();
        
        // Add user to whitelist
        let reason = String::from_str(&env, "Test user");
        assert!(RateLimiter::add_to_whitelist(
            &env,
            admin,
            user,
            None,
            true,
            None,
            reason
        ).is_ok());
        
        // Whitelisted user should always be allowed
        for i in 0..100 {
            let allowed = RateLimiter::check_rate_limit(&env, user, None).unwrap();
            assert!(allowed, "Whitelisted request {} should be allowed", i);
        }
        
        // Remove from whitelist
        assert!(RateLimiter::remove_from_whitelist(&env, admin, user, None).is_ok());
    }

    #[test]
    fn test_ddos_protection() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        
        RateLimiter::initialize(&env, admin).unwrap();
        
        // Simulate rapid requests to trigger DDoS protection
        let mut blocked = false;
        for i in 0..60 {
            let allowed = RateLimiter::check_rate_limit(&env, user, None).unwrap();
            if !allowed {
                blocked = true;
                break;
            }
        }
        
        // Should eventually be blocked due to DDoS protection
        assert!(blocked, "DDoS protection should have been triggered");
        
        // Check DDoS blocks
        let blocks = RateLimiter::get_ddos_blocks(&env).unwrap();
        assert!(!blocks.is_empty());
        
        // Remove DDoS block
        assert!(RateLimiter::remove_ddos_block(&env, admin, user).is_ok());
    }

    #[test]
    fn test_custom_rate_limits() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        
        RateLimiter::initialize(&env, admin).unwrap();
        
        // Create custom rate limit
        assert!(RateLimiter::create_rate_limit(
            &env,
            admin,
            LimitScope::PerUser,
            RateLimitType::PerSecond,
            5, // Very low limit
            1,
            None,
            Some(user)
        ).is_ok());
        
        // Should be blocked after 5 requests
        for i in 0..5 {
            let allowed = RateLimiter::check_rate_limit(&env, user, None).unwrap();
            assert!(allowed, "Request {} should be allowed", i);
        }
        
        // 6th request should be blocked
        let allowed = RateLimiter::check_rate_limit(&env, user, None).unwrap();
        assert!(!allowed, "6th request should be blocked");
    }

    #[test]
    fn test_endpoint_specific_limits() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let endpoint = symbol_short!("CLAIMS");
        
        RateLimiter::initialize(&env, admin).unwrap();
        
        // Create endpoint-specific limit
        assert!(RateLimiter::create_rate_limit(
            &env,
            admin,
            LimitScope::PerEndpoint,
            RateLimitType::PerMinute,
            3,
            60,
            Some(endpoint),
            None
        ).is_ok());
        
        // Should be allowed for other endpoints
        let other_endpoint = symbol_short!("PROFILE");
        assert!(RateLimiter::check_rate_limit(&env, user, Some(other_endpoint)).is_ok());
        
        // Should be blocked after 3 requests to CLAIMS endpoint
        for i in 0..3 {
            let allowed = RateLimiter::check_rate_limit(&env, user, Some(endpoint)).unwrap();
            assert!(allowed, "Request {} to CLAIMS should be allowed", i);
        }
        
        // 4th request to CLAIMS should be blocked
        let allowed = RateLimiter::check_rate_limit(&env, user, Some(endpoint)).unwrap();
        assert!(!allowed, "4th request to CLAIMS should be blocked");
    }

    #[test]
    fn test_integration_real_time_and_rate_limiting() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        
        // Initialize both systems
        RealTimeProcessor::initialize(&env, admin).unwrap();
        RateLimiter::initialize(&env, admin).unwrap();
        
        // Add user to whitelist for real-time processing
        let reason = String::from_str(&env, "Premium user");
        assert!(RateLimiter::add_to_whitelist(
            &env,
            admin,
            user,
            None,
            true,
            None,
            reason
        ).is_ok());
        
        // Process multiple stream data points
        for i in 0..10 {
            let stream_data = StreamData {
                stream_id: i + 10,
                data_type: symbol_short!("CLAIM"),
                payload: soroban_sdk::Bytes::from_array(&env, &[i as u8; 100]),
                timestamp: env.ledger().timestamp() + i,
                source: user,
                processed: false,
            };
            
            // Check rate limit first
            let allowed = RateLimiter::check_rate_limit(&env, user, None).unwrap();
            assert!(allowed, "Stream processing request {} should be allowed", i);
            
            // Process stream data
            let result = RealTimeProcessor::process_stream_data(&env, stream_data);
            assert!(result.is_ok());
        }
        
        // Verify both systems have processed the data
        let processing_metrics = RealTimeProcessor::get_metrics(&env).unwrap();
        assert_eq!(processing_metrics.total_data_points, 10);
        
        let rate_metrics = RateLimiter::get_metrics(&env).unwrap();
        assert_eq!(rate_metrics.total_requests, 10);
        assert_eq!(rate_metrics.blocked_requests, 0);
    }

    #[test]
    fn test_alert_acknowledgment_and_anomaly_resolution() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        
        RealTimeProcessor::initialize(&env, admin).unwrap();
        
        // Create data that triggers anomaly
        let large_payload = soroban_sdk::Bytes::from_array(&env, &[1u8; 6000]);
        let stream_data = StreamData {
            stream_id: 20,
            data_type: symbol_short!("CLAIM"),
            payload: large_payload,
            timestamp: env.ledger().timestamp(),
            source: user,
            processed: false,
        };
        
        RealTimeProcessor::process_stream_data(&env, stream_data).unwrap();
        
        // Get alerts and anomalies
        let alerts = RealTimeProcessor::get_active_alerts(&env).unwrap();
        let anomalies = RealTimeProcessor::get_unresolved_anomalies(&env).unwrap();
        
        assert!(!alerts.is_empty());
        assert!(!anomalies.is_empty());
        
        // Acknowledge alert
        let alert = alerts.first().unwrap();
        assert!(RealTimeProcessor::acknowledge_alert(&env, alert.alert_id, user).is_ok());
        
        // Resolve anomaly
        let anomaly = anomalies.first().unwrap();
        assert!(RealTimeProcessor::resolve_anomaly(&env, anomaly.detection_id, user).is_ok());
    }
}
