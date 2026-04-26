/// Dynamic Premium Adjustment Contract (Issue #77)
///
/// Provides real-time risk assessment and personalized premium pricing
/// with full transparency, user consent, and regulatory compliance.
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Env, String, Vec,
};

// ─── Error Codes ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PremiumError {
    Unauthorized       = 200,
    PolicyNotFound     = 201,
    AlreadyExists      = 202,
    InvalidInput       = 203,
    ConsentRequired    = 204,
    ComplianceViolation = 205,
    OracleStale        = 206,
}

impl From<PremiumError> for soroban_sdk::Error {
    fn from(val: PremiumError) -> Self {
        soroban_sdk::Error::from_contract_error(val as u32)
    }
}

// ─── Types ───────────────────────────────────────────────────────────────────

/// Risk tier used to bucket a policy holder's current risk profile.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RiskTier {
    Low,
    Moderate,
    High,
    Critical,
}

/// Reason code for a premium adjustment event (transparency feature).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AdjustmentReason {
    HealthMetricChange,
    ClaimHistoryUpdate,
    LifestyleFactorChange,
    AgeProgression,
    RegulatoryRebalance,
    ManualReview,
}

/// Immutable audit record written for every premium change.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AdjustmentEvent {
    pub policy_id:      u64,
    pub old_premium:    u64,
    pub new_premium:    u64,
    pub risk_score:     u64,   // 0-100
    pub risk_tier:      RiskTier,
    pub reason:         AdjustmentReason,
    pub adjusted_at:    u64,
    pub adjuster:       Address,
}

/// Core policy record.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PremiumPolicy {
    pub id:              u64,
    pub holder:          Address,
    pub base_premium:    u64,   // in stroops (1 XLM = 10_000_000)
    pub current_premium: u64,
    pub risk_score:      u64,
    pub risk_tier:       RiskTier,
    pub consent_given:   bool,
    pub active:          bool,
    pub created_at:      u64,
    pub updated_at:      u64,
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

fn key_admin()          -> soroban_sdk::Symbol { symbol_short!("DPA_ADM") }
fn key_policy_ctr()     -> soroban_sdk::Symbol { symbol_short!("DPA_CTR") }
fn key_policy(id: u64)  -> (soroban_sdk::Symbol, u64) { (symbol_short!("DPA_POL"), id) }
fn key_events(id: u64)  -> (soroban_sdk::Symbol, u64) { (symbol_short!("DPA_EVT"), id) }

// ─── Contract ────────────────────────────────────────────────────────────────

pub struct DynamicPremiumAdjustment;

#[contractimpl]
impl DynamicPremiumAdjustment {
    // ── Admin ────────────────────────────────────────────────────────────────

    /// One-time initialisation; sets the contract administrator.
    pub fn initialize(env: &Env, admin: Address) {
        if env.storage().instance().has(&key_admin()) {
            panic!("already initialized");
        }
        env.storage().instance().set(&key_admin(), &admin);
        env.storage().instance().set(&key_policy_ctr(), &0u64);
    }

    // ── Policy lifecycle ─────────────────────────────────────────────────────

    /// Create a new premium policy for `holder`.
    /// `base_premium` is the starting premium in stroops.
    /// The holder must call `give_consent` before adjustments are applied.
    pub fn create_policy(
        env: &Env,
        caller: Address,
        holder: Address,
        base_premium: u64,
    ) -> Result<u64, PremiumError> {
        caller.require_auth();
        Self::require_admin(env, &caller)?;

        if base_premium == 0 {
            return Err(PremiumError::InvalidInput);
        }

        let id = Self::next_id(env);
        let now = env.ledger().timestamp();

        let policy = PremiumPolicy {
            id,
            holder: holder.clone(),
            base_premium,
            current_premium: base_premium,
            risk_score: 50,
            risk_tier: RiskTier::Moderate,
            consent_given: false,
            active: true,
            created_at: now,
            updated_at: now,
        };

        env.storage().instance().set(&key_policy(id), &policy);
        Ok(id)
    }

    /// Policy holder grants consent for automated premium adjustments.
    pub fn give_consent(env: &Env, holder: Address, policy_id: u64) -> Result<(), PremiumError> {
        holder.require_auth();
        let mut policy = Self::load_policy(env, policy_id)?;
        if policy.holder != holder {
            return Err(PremiumError::Unauthorized);
        }
        policy.consent_given = true;
        policy.updated_at = env.ledger().timestamp();
        env.storage().instance().set(&key_policy(policy_id), &policy);
        Ok(())
    }

    /// Policy holder revokes consent; no further automated adjustments allowed.
    pub fn revoke_consent(env: &Env, holder: Address, policy_id: u64) -> Result<(), PremiumError> {
        holder.require_auth();
        let mut policy = Self::load_policy(env, policy_id)?;
        if policy.holder != holder {
            return Err(PremiumError::Unauthorized);
        }
        policy.consent_given = false;
        policy.updated_at = env.ledger().timestamp();
        env.storage().instance().set(&key_policy(policy_id), &policy);
        Ok(())
    }

    // ── Risk assessment & adjustment ─────────────────────────────────────────

    /// Adjust the premium for `policy_id` based on a new `risk_score` (0-100).
    ///
    /// Adjustment algorithm:
    ///   new_premium = base_premium × risk_multiplier(risk_score)
    ///
    /// Risk multipliers (regulatory-compliant caps):
    ///   0-25  (Low)      → 0.80× (20 % discount)
    ///   26-50 (Moderate) → 1.00× (no change)
    ///   51-75 (High)     → 1.25× (25 % surcharge)
    ///   76-100 (Critical)→ 1.50× (50 % surcharge, capped for compliance)
    pub fn adjust_premium(
        env: &Env,
        caller: Address,
        policy_id: u64,
        risk_score: u64,
        reason: AdjustmentReason,
    ) -> Result<u64, PremiumError> {
        caller.require_auth();
        Self::require_admin(env, &caller)?;

        if risk_score > 100 {
            return Err(PremiumError::InvalidInput);
        }

        let mut policy = Self::load_policy(env, policy_id)?;

        if !policy.consent_given {
            return Err(PremiumError::ConsentRequired);
        }
        if !policy.active {
            return Err(PremiumError::PolicyNotFound);
        }

        let (new_premium, risk_tier) = Self::calculate_premium(policy.base_premium, risk_score);

        // Regulatory compliance: premium cannot exceed 2× base or drop below 0.5× base
        let max_premium = policy.base_premium * 2;
        let min_premium = policy.base_premium / 2;
        let new_premium = new_premium.min(max_premium).max(min_premium);

        let event = AdjustmentEvent {
            policy_id,
            old_premium: policy.current_premium,
            new_premium,
            risk_score,
            risk_tier: risk_tier.clone(),
            reason,
            adjusted_at: env.ledger().timestamp(),
            adjuster: caller,
        };

        // Append to audit log
        let mut events: Vec<AdjustmentEvent> = env
            .storage()
            .instance()
            .get(&key_events(policy_id))
            .unwrap_or(Vec::new(env));
        events.push_back(event);
        env.storage().instance().set(&key_events(policy_id), &events);

        policy.current_premium = new_premium;
        policy.risk_score = risk_score;
        policy.risk_tier = risk_tier;
        policy.updated_at = env.ledger().timestamp();
        env.storage().instance().set(&key_policy(policy_id), &policy);

        Ok(new_premium)
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    pub fn get_policy(env: &Env, policy_id: u64) -> Result<PremiumPolicy, PremiumError> {
        Self::load_policy(env, policy_id)
    }

    pub fn get_adjustment_history(
        env: &Env,
        policy_id: u64,
    ) -> Vec<AdjustmentEvent> {
        env.storage()
            .instance()
            .get(&key_events(policy_id))
            .unwrap_or(Vec::new(env))
    }

    pub fn get_risk_tier(env: &Env, policy_id: u64) -> Result<RiskTier, PremiumError> {
        let policy = Self::load_policy(env, policy_id)?;
        Ok(policy.risk_tier)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn require_admin(env: &Env, caller: &Address) -> Result<(), PremiumError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&key_admin())
            .ok_or(PremiumError::Unauthorized)?;
        if *caller != admin {
            return Err(PremiumError::Unauthorized);
        }
        Ok(())
    }

    fn load_policy(env: &Env, id: u64) -> Result<PremiumPolicy, PremiumError> {
        env.storage()
            .instance()
            .get(&key_policy(id))
            .ok_or(PremiumError::PolicyNotFound)
    }

    fn next_id(env: &Env) -> u64 {
        let ctr: u64 = env
            .storage()
            .instance()
            .get(&key_policy_ctr())
            .unwrap_or(0);
        let next = ctr + 1;
        env.storage().instance().set(&key_policy_ctr(), &next);
        next
    }

    /// Pure calculation: returns (adjusted_premium, risk_tier).
    fn calculate_premium(base: u64, score: u64) -> (u64, RiskTier) {
        // Use integer arithmetic (×100 then ÷100) to avoid floats in Soroban.
        let (multiplier_pct, tier) = match score {
            0..=25  => (80,  RiskTier::Low),
            26..=50 => (100, RiskTier::Moderate),
            51..=75 => (125, RiskTier::High),
            _       => (150, RiskTier::Critical),
        };
        (base * multiplier_pct / 100, tier)
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::Env;

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin  = Address::generate(&env);
        let holder = Address::generate(&env);
        (env, admin, holder)
    }

    #[test]
    fn test_initialize_and_create_policy() {
        let (env, admin, holder) = setup();
        let contract_id = env.register_contract(None, DynamicPremiumAdjustment);
        let client = DynamicPremiumAdjustmentClient::new(&env, &contract_id);

        client.initialize(&admin);
        let id = client.create_policy(&admin, &holder, &1_000_000u64).unwrap();
        assert_eq!(id, 1);

        let policy = client.get_policy(&id).unwrap();
        assert_eq!(policy.base_premium, 1_000_000);
        assert_eq!(policy.current_premium, 1_000_000);
        assert!(!policy.consent_given);
    }

    #[test]
    fn test_consent_required_before_adjustment() {
        let (env, admin, holder) = setup();
        let contract_id = env.register_contract(None, DynamicPremiumAdjustment);
        let client = DynamicPremiumAdjustmentClient::new(&env, &contract_id);

        client.initialize(&admin);
        let id = client.create_policy(&admin, &holder, &1_000_000u64).unwrap();

        let result = client.adjust_premium(&admin, &id, &80u64, &AdjustmentReason::HealthMetricChange);
        assert_eq!(result, Err(PremiumError::ConsentRequired));
    }

    #[test]
    fn test_adjustment_with_consent() {
        let (env, admin, holder) = setup();
        let contract_id = env.register_contract(None, DynamicPremiumAdjustment);
        let client = DynamicPremiumAdjustmentClient::new(&env, &contract_id);

        client.initialize(&admin);
        let id = client.create_policy(&admin, &holder, &1_000_000u64).unwrap();
        client.give_consent(&holder, &id).unwrap();

        // High risk → 125 % of base
        let new_premium = client
            .adjust_premium(&admin, &id, &60u64, &AdjustmentReason::ClaimHistoryUpdate)
            .unwrap();
        assert_eq!(new_premium, 1_250_000);

        let history = client.get_adjustment_history(&id);
        assert_eq!(history.len(), 1);
    }

    #[test]
    fn test_low_risk_discount() {
        let (env, admin, holder) = setup();
        let contract_id = env.register_contract(None, DynamicPremiumAdjustment);
        let client = DynamicPremiumAdjustmentClient::new(&env, &contract_id);

        client.initialize(&admin);
        let id = client.create_policy(&admin, &holder, &1_000_000u64).unwrap();
        client.give_consent(&holder, &id).unwrap();

        let new_premium = client
            .adjust_premium(&admin, &id, &10u64, &AdjustmentReason::LifestyleFactorChange)
            .unwrap();
        assert_eq!(new_premium, 800_000); // 80 % of base
    }

    #[test]
    fn test_regulatory_cap() {
        let (env, admin, holder) = setup();
        let contract_id = env.register_contract(None, DynamicPremiumAdjustment);
        let client = DynamicPremiumAdjustmentClient::new(&env, &contract_id);

        client.initialize(&admin);
        // Very small base to test cap arithmetic
        let id = client.create_policy(&admin, &holder, &100u64).unwrap();
        client.give_consent(&holder, &id).unwrap();

        let new_premium = client
            .adjust_premium(&admin, &id, &100u64, &AdjustmentReason::ManualReview)
            .unwrap();
        // 150 % of 100 = 150, cap is 200 → 150 is within cap
        assert_eq!(new_premium, 150);
    }
}
