#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env, Symbol, Vec, Map,
    token, BytesN, String
};

use soroban_sdk::auth::ContractAuth;
use soroban_sdk::crypto::sha256;
use soroban_sdk::xdr::ScVal;

// ========== CONSTANTS ==========
const HEALTHCARE_DRIPS: Symbol = Symbol::short("HD");
const ISSUE_CREATOR: Symbol = Symbol::short("IC");
const CONTRIBUTOR: Symbol = Symbol::short("CT");
const REVIEWER: Symbol = Symbol::short("RV");
const APPROVER: Symbol = Symbol::short("AP");

// ========== TYPES ==========
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum IssueType {
    EmergencyTreatment = 0,
    Surgery = 1,
    PreventiveCare = 2,
    ChronicCondition = 3,
    MentalHealth = 4,
    Rehabilitation = 5,
    MedicalEquipment = 6,
    ResearchFunding = 7,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum IssueStatus {
    Draft = 0,
    Submitted = 1,
    UnderReview = 2,
    PendingApproval = 3,
    Approved = 4,
    Rejected = 5,
    Completed = 6,
    Cancelled = 7,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum ContributorLevel {
    Junior = 0,
    Intermediate = 1,
    Senior = 2,
    Expert = 3,
    Master = 4,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum KycStatus {
    NotSubmitted = 0,
    Pending = 1,
    InReview = 2,
    Approved = 3,
    Rejected = 4,
    Expired = 5,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum LicenseType {
    MedicalDoctor = 0,
    Nurse = 1,
    Pharmacist = 2,
    Therapist = 3,
    MedicalTechnician = 4,
    HealthcareAdministrator = 5,
    MentalHealthCounselor = 6,
    Nutritionist = 7,
    Other = 8,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum LicenseStatus {
    NotSubmitted = 0,
    Pending = 1,
    Verified = 2,
    Rejected = 3,
    Expired = 4,
    Suspended = 5,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenAllocation {
    pub token: Address,
    pub percentage: u32, // Basis points (10000 = 100%)
    pub min_balance: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PremiumDrip {
    pub id: u64,
    pub patient: Address,
    pub insurer: Address,
    pub primary_token: Address,
    pub premium_amount: i128,
    pub token_allocations: Vec<TokenAllocation>,
    pub interval: u64,
    pub last_payment: u64,
    pub next_payment: u64,
    pub active: bool,
    pub total_paid: i128,
    pub created: u64,
    pub auto_rebalance: bool,
    pub slippage_tolerance: u32, // Basis points
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Issue {
    pub id: u64,
    pub creator: Address,
    pub patient: Address,
    pub issue_type: IssueType,
    pub title: String,
    pub description: String,
    pub funding_amount: i128,
    pub medical_record: String, // IPFS hash
    pub deadline: u64,
    pub status: IssueStatus,
    pub required_approvals: u32,
    pub current_approvals: u32,
    pub created: u64,
    pub last_updated: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Application {
    pub contributor: Address,
    pub statement: String,
    pub reputation: u32,
    pub contribution_amount: i128,
    pub applied: u64,
    pub approved: bool,
    pub reviewed: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContributorStats {
    pub contributor: Address,
    pub total_issues_reviewed: u32,
    pub total_issues_approved: u32,
    pub total_contributed: i128,
    pub level: ContributorLevel,
    pub reputation: u32,
    pub joined: u64,
    pub kyc_status: KycStatus,
    pub kyc_submitted: u64,
    pub kyc_approved: u64,
    pub last_activity: u64,
    pub reputation_decay_month: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct KycVerification {
    pub contributor: Address,
    pub full_name: String,
    pub date_of_birth: u64,
    pub nationality: String,
    pub document_type: String,
    pub document_number: String,
    pub ipfs_hash: String,
    pub status: KycStatus,
    pub submitted: u64,
    pub reviewed: u64,
    pub reviewer: Address,
    pub rejection_reason: String,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProfessionalLicense {
    pub contributor: Address,
    pub license_type: LicenseType,
    pub license_number: String,
    pub issuing_authority: String,
    pub issue_date: u64,
    pub expiry_date: u64,
    pub verification_status: LicenseStatus,
    pub ipfs_hash: String,
    pub submitted: u64,
    pub verified: u64,
    pub verifier: Address,
    pub notes: String,
}

// ========== FRAUD DETECTION TYPES ==========

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum FraudRiskLevel {
    Low = 0,
    Medium = 1,
    High = 2,
    Critical = 3,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum FraudFlag {
    None = 0,
    SuspiciousPattern = 1,
    HighFrequency = 2,
    UnusualAmount = 3,
    DuplicateClaim = 4,
    AnomalousTiming = 5,
    ReputationRisk = 6,
}

// ========== MULTI-TOKEN SUPPORT TYPES ==========

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum SwapStatus {
    Pending = 0,
    Executed = 1,
    Failed = 2,
    Cancelled = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SwapRequest {
    pub id: u64,
    pub from_token: Address,
    pub to_token: Address,
    pub amount_in: i128,
    pub min_amount_out: i128,
    pub slippage_tolerance: u32,
    pub deadline: u64,
    pub status: SwapStatus,
    pub executed_amount: i128,
    pub created: u64,
    pub executed: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenBalance {
    pub token: Address,
    pub balance: i128,
    pub last_updated: u64,
    pub value_usd: i128, // Estimated USD value
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RebalanceConfig {
    pub enabled: bool,
    pub threshold: u32, // Percentage deviation before rebalancing
    pub max_slippage: u32,
    pub check_interval: u64,
    pub last_check: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimPattern {
    pub patient: Address,
    pub claim_frequency: u32, // claims per month
    pub average_amount: i128,
    pub total_claimed: i128,
    pub unique_providers: u32,
    pub claim_types: Vec<IssueType>,
    pub last_activity: u64,
    pub risk_score: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FraudAnalysis {
    pub issue_id: u64,
    pub patient: Address,
    pub risk_level: FraudRiskLevel,
    pub risk_score: u32,
    pub flags: Vec<FraudFlag>,
    pub pattern_analysis: ClaimPattern,
    pub anomaly_detected: bool,
    pub analysis_timestamp: u64,
    pub requires_review: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FraudThresholds {
    pub max_monthly_claims: u32,
    pub max_single_claim_amount: i128,
    pub risk_score_threshold: u32,
    pub frequency_penalty: u32,
    pub amount_penalty: u32,
    pub pattern_penalty: u32,
}

// ========== ERRORS ==========
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum HealthcareDripsError {
    Unauthorized = 1,
    InvalidAmount = 2,
    InvalidDeadline = 3,
    InvalidIssueId = 4,
    IssueNotDraft = 5,
    IssueNotSubmitted = 6,
    IssueNotActive = 7,
    DeadlineExpired = 8,
    AlreadyApplied = 9,
    NotVerifiedContributor = 10,
    InsufficientApprovals = 11,
    ContributorNotFound = 12,
    InvalidToken = 13,
    InsufficientBalance = 14,
    TransferFailed = 15,
    FraudDetectionFailed = 16,
    HighRiskDetected = 17,
    ClaimFlagged = 18,
    PatternAnalysisFailed = 19,
    KycAlreadySubmitted = 20,
    KycNotApproved = 21,
    LicenseAlreadySubmitted = 22,
    LicenseNotVerified = 23,
    InvalidLicenseType = 24,
    KycExpired = 25,
    LicenseExpired = 26,
    ReputationTooLow = 27,
    InvalidTokenAllocation = 28,
    SlippageExceeded = 29,
    InsufficientLiquidity = 30,
    ConversionFailed = 31,
    RebalanceFailed = 32,
}

// ========== CONTRACT ==========
#[contract]
pub struct HealthcareDrips;

#[contractimpl]
impl HealthcareDrips {
    // ========== INITIALIZATION ==========

    pub fn initialize(env: &Env, admin: Address) {
        // Set up roles
        env.storage().instance().set(&ISSUE_CREATOR, &admin);
        env.storage().instance().set(&REVIEWER, &admin);
        env.storage().instance().set(&APPROVER, &admin);

        // Initialize counters
        env.storage().instance().set(&Symbol::short("next_drip_id"), &1u64);
        env.storage().instance().set(&Symbol::short("next_issue_id"), &1u64);
        env.storage().instance().set(&Symbol::short("next_kyc_id"), &1u64);
        env.storage().instance().set(&Symbol::short("next_license_id"), &1u64);
        env.storage().instance().set(&Symbol::short("next_swap_id"), &1u64);

        // Initialize verified contributors list
        env.storage().instance().set(&Symbol::short("verified_contributors"), &Vec::new(env));

        // Initialize active issues list
        env.storage().instance().set(&Symbol::short("active_issues"), &Vec::new(env));

        // Initialize fraud detection
        Self::initialize_fraud_detection(env);
        
        // Initialize multi-token support
        Self::initialize_multi_token_support(env);
    }

    // Initialize fraud detection
    fn initialize_fraud_detection(env: &Env) {
        // Initialize fraud thresholds
        let thresholds = FraudThresholds {
            max_monthly_claims: 5,
            max_single_claim_amount: 10000,
            risk_score_threshold: 50,
            frequency_penalty: 10,
            amount_penalty: 20,
            pattern_penalty: 30,
        };
        env.storage().instance().set(&Symbol::short("fraud_thresholds"), &thresholds);
    }
    
    // Initialize multi-token support
    fn initialize_multi_token_support(env: &Env) {
        // Initialize default rebalance config
        let rebalance_config = RebalanceConfig {
            enabled: true,
            threshold: 1000, // 10% deviation
            max_slippage: 500, // 5% max slippage
            check_interval: 86400, // Daily checks
            last_check: env.ledger().timestamp(),
        };
        env.storage().instance().set(&Symbol::short("rebalance_config"), &rebalance_config);
        
        // Initialize pending swaps list
        env.storage().instance().set(&Symbol::short("pending_swaps"), &Vec::new(env));
        
        // Initialize token balances tracking
        env.storage().instance().set(&Symbol::short("token_balances"), &Vec::new(env));
    }

    // ========== PREMIUM DRIPS ==========

    pub fn create_premium_drip(
        env: &Env,
        patient: Address,
        insurer: Address,
        primary_token: Address,
        premium_amount: i128,
        token_allocations: Vec<TokenAllocation>,
        interval: u64,
        auto_rebalance: bool,
        slippage_tolerance: u32,
    ) -> Result<u64, HealthcareDripsError> {
        if premium_amount <= 0 {
            return Err(HealthcareDripsError::InvalidAmount);
        }
        
        if interval < 86400 { // Minimum 1 day
            return Err(HealthcareDripsError::InvalidAmount);
        }
        
        // Validate token allocations
        let total_percentage = token_allocations.iter().map(|alloc| alloc.percentage).sum::<u32>();
        if total_percentage != 10000 { // Must equal 100%
            return Err(HealthcareDripsError::InvalidTokenAllocation);
        }
        
        let next_id = Self::get_next_drip_id(env);
        let current_time = env.ledger().timestamp();
        
        let drip = PremiumDrip {
            id: next_id,
            patient: patient.clone(),
            insurer: insurer.clone(),
            primary_token: primary_token.clone(),
            premium_amount,
            token_allocations: token_allocations.clone(),
            interval,
            last_payment: current_time,
            next_payment: current_time + interval,
            active: true,
            total_paid: 0,
            created: current_time,
            auto_rebalance,
            slippage_tolerance,
        };
        
        // Store drip
        env.storage().instance().set(&Symbol::new(&env, &format!("drip_{}", next_id)), &drip);
        
        // Add to patient's drips
        let mut patient_drips: Vec<u64> = env.storage().instance()
            .get(&Symbol::new(&env, &format!("patient_drips_{}", patient)))
            .unwrap_or(Vec::new(env));
        patient_drips.push_back(next_id);
        env.storage().instance().set(&Symbol::new(&env, &format!("patient_drips_{}", patient)), &patient_drips);
        
        // Initialize token balance tracking for this drip
        for allocation in token_allocations.iter() {
            Self::update_token_balance(env, allocation.token.clone(), 0);
        }
        
        Ok(next_id)
    }
    
    pub fn process_premium_payment(
        env: &Env,
        drip_id: u64,
    ) -> Result<(), HealthcareDripsError> {
        let drip_key = Symbol::new(&env, &format!("drip_{}", drip_id));
        let mut drip: PremiumDrip = env.storage().instance()
            .get(&drip_key)
            .ok_or(HealthcareDripsError::InvalidIssueId)?;
        
        if !drip.active {
            return Err(HealthcareDripsError::IssueNotActive);
        }
        
        let current_time = env.ledger().timestamp();
        if current_time < drip.next_payment {
            return Err(HealthcareDripsError::InvalidAmount); // Payment not due yet
        }
        
        // In a real implementation, this would transfer tokens
        // For now, we'll just update the state
        drip.last_payment = current_time;
        drip.next_payment = current_time + drip.interval;
        drip.total_paid += drip.premium_amount;
        
        env.storage().instance().set(&drip_key, &drip);
        
        Ok(())
    }
    
    pub fn cancel_premium_drip(
        env: &Env,
        drip_id: u64,
        caller: Address,
    ) -> Result<(), HealthcareDripsError> {
        let drip_key = Symbol::new(&env, &format!("drip_{}", drip_id));
        let mut drip: PremiumDrip = env.storage().instance()
            .get(&drip_key)
            .ok_or(HealthcareDripsError::InvalidIssueId)?;
        
        if drip.patient != caller {
            return Err(HealthcareDripsError::Unauthorized);
        }
        
        drip.active = false;
        env.storage().instance().set(&drip_key, &drip);
        
        Ok(())
    }
    
    // ========== STELLAR DEX INTEGRATION ==========
    
    /// Create a swap request for token conversion
    pub fn create_swap_request(
        env: &Env,
        from_token: Address,
        to_token: Address,
        amount_in: i128,
        min_amount_out: i128,
        slippage_tolerance: u32,
        deadline: u64,
        caller: Address,
    ) -> Result<u64, HealthcareDripsError> {
        if amount_in <= 0 || min_amount_out <= 0 {
            return Err(HealthcareDripsError::InvalidAmount);
        }
        
        if deadline <= env.ledger().timestamp() {
            return Err(HealthcareDripsError::InvalidDeadline);
        }
        
        let next_id = Self::get_next_swap_id(env);
        let current_time = env.ledger().timestamp();
        
        let swap_request = SwapRequest {
            id: next_id,
            from_token: from_token.clone(),
            to_token: to_token.clone(),
            amount_in,
            min_amount_out,
            slippage_tolerance,
            deadline,
            status: SwapStatus::Pending,
            executed_amount: 0,
            created: current_time,
            executed: 0,
        };
        
        // Store swap request
        env.storage().instance().set(&Symbol::new(&env, &format!("swap_{}", next_id)), &swap_request);
        
        // Add to pending swaps
        let mut pending_swaps: Vec<u64> = env.storage().instance()
            .get(&Symbol::short("pending_swaps"))
            .unwrap_or(Vec::new(env));
        pending_swaps.push_back(next_id);
        env.storage().instance().set(&Symbol::short("pending_swaps"), &pending_swaps);
        
        // Execute the swap
        Self::execute_swap(env, next_id, caller)?;
        
        Ok(next_id)
    }
    
    /// Execute a swap request with slippage protection
    fn execute_swap(
        env: &Env,
        swap_id: u64,
        caller: Address,
    ) -> Result<(), HealthcareDripsError> {
        let swap_key = Symbol::new(&env, &format!("swap_{}", swap_id));
        let mut swap: SwapRequest = env.storage().instance()
            .get(&swap_key)
            .ok_or(HealthcareDripsError::InvalidIssueId)?;
        
        if swap.status != SwapStatus::Pending {
            return Err(HealthcareDripsError::ConversionFailed);
        }
        
        if env.ledger().timestamp() > swap.deadline {
            swap.status = SwapStatus::Cancelled;
            env.storage().instance().set(&swap_key, &swap);
            return Err(HealthcareDripsError::InvalidDeadline);
        }
        
        // Get expected output amount (simplified - in real implementation would query DEX)
        let expected_output = Self::get_swap_amount_out(
            env, 
            swap.from_token.clone(), 
            swap.to_token.clone(), 
            swap.amount_in
        )?;
        
        // Check slippage
        let slippage_amount = ((expected_output - swap.min_amount_out) * 10000) / expected_output;
        if slippage_amount > swap.slippage_tolerance {
            swap.status = SwapStatus::Failed;
            env.storage().instance().set(&swap_key, &swap);
            return Err(HealthcareDripsError::SlippageExceeded);
        }
        
        // Execute the swap (simplified - would interact with Stellar DEX)
        // For now, we'll simulate the swap
        swap.executed_amount = expected_output;
        swap.status = SwapStatus::Executed;
        swap.executed = env.ledger().timestamp();
        
        env.storage().instance().set(&swap_key, &swap);
        
        // Remove from pending swaps
        let mut pending_swaps: Vec<u64> = env.storage().instance()
            .get(&Symbol::short("pending_swaps"))
            .unwrap_or(Vec::new(env));
        pending_swaps.retain(|&id| id != swap_id);
        env.storage().instance().set(&Symbol::short("pending_swaps"), &pending_swaps);
        
        // Update token balances
        Self::update_token_balance(env, swap.to_token.clone(), swap.executed_amount);
        
        Ok(())
    }
    
    /// Get expected swap amount out (mock implementation)
    fn get_swap_amount_out(
        env: &Env,
        from_token: Address,
        to_token: Address,
        amount_in: i128,
    ) -> Result<i128, HealthcareDripsError> {
        // Mock implementation - in real would query Stellar DEX for actual rates
        // For demo purposes, assume 1:1 swap with 0.3% fee
        let fee = (amount_in * 30) / 10000;
        Ok(amount_in - fee)
    }
    
    // ========== TOKEN BALANCE MONITORING & AUTO-REBALANCING ==========
    
    /// Update token balance tracking
    fn update_token_balance(env: &Env, token: Address, amount: i128) {
        let balance_key = Symbol::new(&env, &format!("balance_{}", token));
        let current_time = env.ledger().timestamp();
        
        let mut balance: TokenBalance = env.storage().instance()
            .get(&balance_key)
            .unwrap_or(TokenBalance {
                token: token.clone(),
                balance: 0,
                last_updated: current_time,
                value_usd: 0,
            });
        
        balance.balance += amount;
        balance.last_updated = current_time;
        // In real implementation, would calculate USD value based on oracle
        balance.value_usd = balance.balance; // Simplified 1:1 for demo
        
        env.storage().instance().set(&balance_key, &balance);
        
        // Update global token balances list
        let mut token_balances: Vec<Address> = env.storage().instance()
            .get(&Symbol::short("token_balances"))
            .unwrap_or(Vec::new(env));
        
        if !token_balances.iter().any(|&t| t == token) {
            token_balances.push_back(token.clone());
            env.storage().instance().set(&Symbol::short("token_balances"), &token_balances);
        }
    }
    
    /// Check and perform auto-rebalancing for all active drips
    pub fn check_and_rebalance(env: &Env) -> Result<(), HealthcareDripsError> {
        let config: RebalanceConfig = env.storage().instance()
            .get(&Symbol::short("rebalance_config"))
            .unwrap_or(RebalanceConfig {
                enabled: false,
                threshold: 1000,
                max_slippage: 500,
                check_interval: 86400,
                last_check: 0,
            });
        
        if !config.enabled {
            return Ok(());
        }
        
        let current_time = env.ledger().timestamp();
        if current_time < config.last_check + config.check_interval {
            return Ok(()); // Not time to check yet
        }
        
        // Get all active drips that have auto-rebalance enabled
        let active_issues = Self::get_active_issues(env);
        for issue_id in active_issues.iter() {
            if let Ok(issue) = Self::get_issue(env, *issue_id) {
                // Check if this issue has associated premium drips
                let patient_drips = Self::get_patient_premium_drips(env, issue.patient.clone());
                for drip_id in patient_drips.iter() {
                    if let Ok(drip) = Self::get_premium_drip(env, *drip_id) {
                        if drip.active && drip.auto_rebalance {
                            Self::rebalance_drip_tokens(env, *drip_id, config.max_slippage)?;
                        }
                    }
                }
            }
        }
        
        // Update last check time
        let mut updated_config = config;
        updated_config.last_check = current_time;
        env.storage().instance().set(&Symbol::short("rebalance_config"), &updated_config);
        
        Ok(())
    }
    
    /// Rebalance tokens for a specific premium drip
    fn rebalance_drip_tokens(
        env: &Env,
        drip_id: u64,
        max_slippage: u32,
    ) -> Result<(), HealthcareDripsError> {
        let drip_key = Symbol::new(&env, &format!("drip_{}", drip_id));
        let drip: PremiumDrip = env.storage().instance()
            .get(&drip_key)
            .ok_or(HealthcareDripsError::InvalidIssueId)?;
        
        let mut needs_rebalancing = false;
        
        // Check each token allocation
        for allocation in drip.token_allocations.iter() {
            let balance_key = Symbol::new(&env, &format!("balance_{}", allocation.token));
            if let Some(current_balance) = env.storage().instance().get::<_, TokenBalance>(&balance_key) {
                let target_balance = (drip.premium_amount * allocation.percentage as i128) / 10000;
                let deviation = if target_balance > 0 {
                    ((current_balance.balance - target_balance).abs() * 10000) / target_balance
                } else {
                    0
                };
                
                if deviation > 1000 { // 10% deviation threshold
                    needs_rebalancing = true;
                    break;
                }
            }
        }
        
        if needs_rebalancing {
            // Perform rebalancing by swapping excess tokens to deficit tokens
            Self::perform_rebalancing_swaps(env, &drip, max_slippage)?;
        }
        
        Ok(())
    }
    
    /// Perform the actual rebalancing swaps
    fn perform_rebalancing_swaps(
        env: &Env,
        drip: &PremiumDrip,
        max_slippage: u32,
    ) -> Result<(), HealthcareDripsError> {
        let mut excess_tokens: Vec<(Address, i128)> = Vec::new(env);
        let mut deficit_tokens: Vec<(Address, i128)> = Vec::new(env);
        
        // Calculate excess and deficit for each token
        for allocation in drip.token_allocations.iter() {
            let balance_key = Symbol::new(&env, &format!("balance_{}", allocation.token));
            if let Some(current_balance) = env.storage().instance().get::<_, TokenBalance>(&balance_key) {
                let target_balance = (drip.premium_amount * allocation.percentage as i128) / 10000;
                let difference = current_balance.balance - target_balance;
                
                if difference > 0 {
                    excess_tokens.push_back((allocation.token.clone(), difference));
                } else if difference < 0 {
                    deficit_tokens.push_back((allocation.token.clone(), -difference));
                }
            }
        }
        
        // Perform swaps from excess to deficit tokens
        for (excess_token, excess_amount) in excess_tokens.iter() {
            for (deficit_token, deficit_amount) in deficit_tokens.iter() {
                if excess_amount > deficit_amount {
                    // Swap the deficit amount
                    let swap_amount = *deficit_amount;
                    let min_amount_out = Self::get_swap_amount_out(
                        env, 
                        excess_token.clone(), 
                        deficit_token.clone(), 
                        swap_amount
                    )?;
                    
                    Self::create_swap_request(
                        env,
                        excess_token.clone(),
                        deficit_token.clone(),
                        swap_amount,
                        min_amount_out,
                        max_slippage,
                        env.ledger().timestamp() + 3600, // 1 hour deadline
                        drip.insurer.clone(), // Use insurer as caller
                    )?;
                    
                    break; // Move to next excess token
                }
            }
        }
        
        Ok(())
    }
    
    // ========== ISSUE MANAGEMENT ==========
    
    pub fn create_issue(
        env: &Env,
        patient: Address,
        issue_type: IssueType,
        title: String,
        description: String,
        funding_amount: i128,
        medical_record: String,
        deadline: u64,
        required_approvals: u32,
        caller: Address,
    ) -> Result<u64, HealthcareDripsError> {
        // Check authorization
        if !Self::has_role(env, caller, ISSUE_CREATOR) {
            return Err(HealthcareDripsError::Unauthorized);
        }
        
        if funding_amount <= 0 {
            return Err(HealthcareDripsError::InvalidAmount);
        }
        
        if deadline <= env.ledger().timestamp() {
            return Err(HealthcareDripsError::InvalidDeadline);
        }
        
        if required_approvals < 2 {
            return Err(HealthcareDripsError::InsufficientApprovals);
        }
        
        let next_id = Self::get_next_issue_id(env);
        let current_time = env.ledger().timestamp();
        
        let issue = Issue {
            id: next_id,
            creator: caller.clone(),
            patient: patient.clone(),
            issue_type,
            title: title.clone(),
            description,
            funding_amount,
            medical_record,
            deadline,
            status: IssueStatus::Draft,
            required_approvals,
            current_approvals: 0,
            created: current_time,
            last_updated: current_time,
        };
        
        // Store issue
        env.storage().instance().set(&Symbol::new(&env, &format!("issue_{}", next_id)), &issue);
        
        // Add to patient's issues
        let mut patient_issues: Vec<u64> = env.storage().instance()
            .get(&Symbol::new(&env, &format!("patient_issues_{}", patient)))
            .unwrap_or(Vec::new(env));
        patient_issues.push_back(next_id);
        env.storage().instance().set(&Symbol::new(&env, &format!("patient_issues_{}", patient)), &patient_issues);
        
        Ok(next_id)
    }
    
    pub fn submit_issue(
        env: &Env,
        issue_id: u64,
        caller: Address,
    ) -> Result<(), HealthcareDripsError> {
        let issue_key = Symbol::new(&env, &format!("issue_{}", issue_id));
        let mut issue: Issue = env.storage().instance()
            .get(&issue_key)
            .ok_or(HealthcareDripsError::InvalidIssueId)?;
        
        if issue.status != IssueStatus::Draft {
            return Err(HealthcareDripsError::IssueNotDraft);
        }
        
        if issue.creator != caller && issue.patient != caller {
            return Err(HealthcareDripsError::Unauthorized);
        }
        
        // Perform fraud detection analysis
        let fraud_analysis = Self::analyze_claim_fraud(env, issue_id)?;
        
        // Check if claim should be flagged for review
        if fraud_analysis.requires_review {
            issue.status = IssueStatus::UnderReview;
            
            // Add to flagged claims
            let mut flagged_claims: Vec<u64> = env.storage().instance()
                .get(&Symbol::short("flagged_claims"))
                .unwrap_or(Vec::new(env));
            
            if !flagged_claims.iter().any(|&id| id == issue_id) {
                flagged_claims.push_back(issue_id);
                env.storage().instance().set(&Symbol::short("flagged_claims"), &flagged_claims);
            }
        } else {
            issue.status = IssueStatus::Submitted;
        }
        
        issue.last_updated = env.ledger().timestamp();
        
        env.storage().instance().set(&issue_key, &issue);
        
        // Add to active issues
        let mut active_issues: Vec<u64> = env.storage().instance()
            .get(&Symbol::short("active_issues"))
            .unwrap_or(Vec::new(env));
        active_issues.push_back(issue_id);
        env.storage().instance().set(&Symbol::short("active_issues"), &active_issues);
        
        Ok(())
    }
    
    pub fn apply_to_issue(
        env: &Env,
        issue_id: u64,
        statement: String,
        caller: Address,
    ) -> Result<(), HealthcareDripsError> {
        let issue_key = Symbol::new(&env, &format!("issue_{}", issue_id));
        let issue: Issue = env.storage().instance()
            .get(&issue_key)
            .ok_or(HealthcareDripsError::InvalidIssueId)?;
        
        if issue.status != IssueStatus::Submitted {
            return Err(HealthcareDripsError::IssueNotSubmitted);
        }
        
        if env.ledger().timestamp() > issue.deadline {
            return Err(HealthcareDripsError::DeadlineExpired);
        }
        
        if !Self::is_verified_contributor(env, caller.clone()) {
            return Err(HealthcareDripsError::NotVerifiedContributor);
        }
        
        let application_key = Symbol::new(&env, &format!("app_{}_{}", issue_id, caller));
        if env.storage().instance().has(&application_key) {
            return Err(HealthcareDripsError::AlreadyApplied);
        }
        
        let application = Application {
            contributor: caller.clone(),
            statement: statement.clone(),
            reputation: Self::get_contributor_reputation(env, caller.clone()),
            contribution_amount: 0,
            applied: env.ledger().timestamp(),
            approved: false,
            reviewed: 0,
        };
        
        env.storage().instance().set(&application_key, &application);
        
        // Add to issue applications
        let mut applications: Vec<Address> = env.storage().instance()
            .get(&Symbol::new(&env, &format!("applications_{}", issue_id)))
            .unwrap_or(Vec::new(env));
        applications.push_back(caller.clone());
        env.storage().instance().set(&Symbol::new(&env, &format!("applications_{}", issue_id)), &applications);
        
        // Update contributor stats
        Self::update_contributor_stats(env, caller.clone());
        
        Ok(())
    }
    
    pub fn review_application(
        env: &Env,
        issue_id: u64,
        contributor: Address,
        approved: bool,
        reason: String,
        caller: Address,
    ) -> Result<(), HealthcareDripsError> {
        if !Self::has_role(env, caller, REVIEWER) {
            return Err(HealthcareDripsError::Unauthorized);
        }
        
        let issue_key = Symbol::new(&env, &format!("issue_{}", issue_id));
        let mut issue: Issue = env.storage().instance()
            .get(&issue_key)
            .ok_or(HealthcareDripsError::InvalidIssueId)?;
        
        if issue.status != IssueStatus::Submitted {
            return Err(HealthcareDripsError::IssueNotSubmitted);
        }
        
        let application_key = Symbol::new(&env, &format!("app_{}_{}", issue_id, contributor));
        let mut application: Application = env.storage().instance()
            .get(&application_key)
            .ok_or(HealthcareDripsError::NotVerifiedContributor)?;
        
        // Update application
        application.approved = approved;
        application.reviewed = env.ledger().timestamp();
        env.storage().instance().set(&application_key, &application);
        
        // Update contributor stats
        let stats_key = Symbol::new(&env, &format!("stats_{}", contributor));
        let mut stats: ContributorStats = env.storage().instance()
            .get(&stats_key)
            .ok_or(HealthcareDripsError::ContributorNotFound)?;
        
        stats.total_issues_reviewed += 1;
        if approved {
            stats.total_issues_approved += 1;
            stats.reputation += 5;
            issue.current_approvals += 1;
        } else {
            stats.reputation += 2;
        }
        
        env.storage().instance().set(&stats_key, &stats);
        
        // Check if issue should be approved
        if issue.current_approvals >= issue.required_approvals {
            issue.status = IssueStatus::Approved;
            issue.last_updated = env.ledger().timestamp();
            env.storage().instance().set(&issue_key, &issue);
        }
        
        Ok(())
    }
    
    pub fn approve_issue(
        env: &Env,
        issue_id: u64,
        caller: Address,
    ) -> Result<(), HealthcareDripsError> {
        if !Self::has_role(env, caller, APPROVER) {
            return Err(HealthcareDripsError::Unauthorized);
        }
        
        let issue_key = Symbol::new(&env, &format!("issue_{}", issue_id));
        let mut issue: Issue = env.storage().instance()
            .get(&issue_key)
            .ok_or(HealthcareDripsError::InvalidIssueId)?;
        
        if issue.status != IssueStatus::Submitted {
            return Err(HealthcareDripsError::IssueNotSubmitted);
        }
        
        issue.status = IssueStatus::Approved;
        issue.last_updated = env.ledger().timestamp();
        
        env.storage().instance().set(&issue_key, &issue);
        
        Ok(())
    }
    
    pub fn verify_contributor(
        env: &Env,
        contributor: Address,
        level: ContributorLevel,
        caller: Address,
    ) -> Result<(), HealthcareDripsError> {
        if !Self::has_role(env, caller, ISSUE_CREATOR) {
            return Err(HealthcareDripsError::Unauthorized);
        }
        
        let stats_key = Symbol::new(&env, &format!("stats_{}", contributor));
        let mut stats: ContributorStats = env.storage().instance()
            .get(&stats_key)
            .ok_or(HealthcareDripsError::ContributorNotFound)?;
        
        stats.level = level;
        stats.reputation += match level {
            ContributorLevel::Expert => 100,
            ContributorLevel::Senior => 50,
            ContributorLevel::Intermediate => 25,
            ContributorLevel::Junior => 10,
            ContributorLevel::Master => 200,
        };
        
        env.storage().instance().set(&stats_key, &stats);
        
        // Add to verified contributors
        let mut verified: Vec<Address> = env.storage().instance()
            .get(&Symbol::short("verified_contributors"))
            .unwrap_or(Vec::new(env));
        verified.push_back(contributor.clone());
        env.storage().instance().set(&Symbol::short("verified_contributors"), &verified);
        
        Ok(())
    }
    
    // ========== VIEW FUNCTIONS ==========
    
    pub fn get_premium_drip(env: &Env, drip_id: u64) -> Result<PremiumDrip, HealthcareDripsError> {
        env.storage().instance()
            .get(&Symbol::new(&env, &format!("drip_{}", drip_id)))
            .ok_or(HealthcareDripsError::InvalidIssueId)
    }
    
    pub fn get_issue(env: &Env, issue_id: u64) -> Result<Issue, HealthcareDripsError> {
        env.storage().instance()
            .get(&Symbol::new(&env, &format!("issue_{}", issue_id)))
            .ok_or(HealthcareDripsError::InvalidIssueId)
    }
    
    pub fn get_application(
        env: &Env,
        issue_id: u64,
        contributor: Address,
    ) -> Result<Application, HealthcareDripsError> {
        env.storage().instance()
            .get(&Symbol::new(&env, &format!("app_{}_{}", issue_id, contributor)))
            .ok_or(HealthcareDripsError::NotVerifiedContributor)
    }
    
    pub fn get_contributor_stats(
        env: &Env,
        contributor: Address,
    ) -> Result<ContributorStats, HealthcareDripsError> {
        env.storage().instance()
            .get(&Symbol::new(&env, &format!("stats_{}", contributor)))
            .ok_or(HealthcareDripsError::ContributorNotFound)
    }
    
    pub fn get_patient_premium_drips(env: &Env, patient: Address) -> Vec<u64> {
        env.storage().instance()
            .get(&Symbol::new(&env, &format!("patient_drips_{}", patient)))
            .unwrap_or(Vec::new(env))
    }
    
    pub fn get_patient_issues(env: &Env, patient: Address) -> Vec<u64> {
        env.storage().instance()
            .get(&Symbol::new(&env, &format!("patient_issues_{}", patient)))
            .unwrap_or(Vec::new(env))
    }
    
    pub fn get_active_issues(env: &Env) -> Vec<u64> {
        env.storage().instance()
            .get(&Symbol::short("active_issues"))
            .unwrap_or(Vec::new(env))
    }
    
    pub fn get_verified_contributors(env: &Env) -> Vec<Address> {
        env.storage().instance()
            .get(&Symbol::short("verified_contributors"))
            .unwrap_or(Vec::new(env))
    }
    
    pub fn get_issue_applications(env: &Env, issue_id: u64) -> Vec<Address> {
        env.storage().instance()
            .get(&Symbol::new(&env, &format!("applications_{}", issue_id)))
            .unwrap_or(Vec::new(env))
    }
    
    // ========== HELPER FUNCTIONS ==========
    
    fn get_next_drip_id(env: &Env) -> u64 {
        let key = Symbol::short("next_drip_id");
        let next_id = env.storage().instance().get(&key).unwrap_or(1u64);
        env.storage().instance().set(&key, &(next_id + 1));
        next_id
    }
    
    fn get_next_issue_id(env: &Env) -> u64 {
        let key = Symbol::short("next_issue_id");
        let next_id = env.storage().instance().get(&key).unwrap_or(1u64);
        env.storage().instance().set(&key, &(next_id + 1));
        next_id
    }
    
    fn has_role(env: &Env, address: Address, role: Symbol) -> bool {
        env.storage().instance().get(&role) == Some(address)
    }
    
    fn is_verified_contributor(env: &Env, contributor: Address) -> bool {
        env.storage().instance().has(&Symbol::new(&env, &format!("stats_{}", contributor)))
    }
    
    fn get_contributor_reputation(env: &Env, contributor: Address) -> u32 {
        let stats_key = Symbol::new(&env, &format!("stats_{}", contributor));
        if let Some(stats) = env.storage().instance().get::<_, ContributorStats>(&stats_key) {
            stats.reputation
        } else {
            0
        }
    }
    
    fn update_contributor_stats(env: &Env, contributor: Address) {
        let stats_key = Symbol::new(&env, &format!("stats_{}", contributor));
        let stats = env.storage().instance()
            .get(&stats_key)
            .unwrap_or(ContributorStats {
                contributor: contributor.clone(),
                total_issues_reviewed: 0,
                total_issues_approved: 0,
                total_contributed: 0,
                level: ContributorLevel::Junior,
                reputation: 0,
                joined: env.ledger().timestamp(),
            });
        
        env.storage().instance().set(&stats_key, &stats);
    }

    // ========== FRAUD DETECTION FUNCTIONS ==========

    /// Analyze claim for fraud patterns and return risk assessment
    pub fn analyze_claim_fraud(
        env: &Env,
        issue_id: u64,
    ) -> Result<FraudAnalysis, HealthcareDripsError> {
        let issue: Issue = Self::get_issue(env, issue_id)?;
        
        // Get patient's claim pattern
        let pattern = Self::analyze_claim_pattern(env, issue.patient.clone())?;
        
        // Calculate risk score
        let mut risk_score = 0u32;
        let mut flags = Vec::new(env);
        
        // Check claim frequency
        if pattern.claim_frequency > 3 {
            risk_score += 15;
            flags.push_back(FraudFlag::HighFrequency);
        }
        
        // Check claim amount
        let thresholds = Self::get_fraud_thresholds(env);
        if issue.funding_amount > thresholds.max_single_claim_amount {
            risk_score += 25;
            flags.push_back(FraudFlag::UnusualAmount);
        }
        
        // Check for pattern anomalies
        if Self::detect_pattern_anomaly(env, &pattern, &issue) {
            risk_score += 20;
            flags.push_back(FraudFlag::SuspiciousPattern);
        }
        
        // Check timing anomalies
        if Self::detect_timing_anomaly(env, issue.patient.clone(), issue.created) {
            risk_score += 15;
            flags.push_back(FraudFlag::AnomalousTiming);
        }
        
        // Determine risk level
        let risk_level = match risk_score {
            0..=20 => FraudRiskLevel::Low,
            21..=40 => FraudRiskLevel::Medium,
            41..=60 => FraudRiskLevel::High,
            _ => FraudRiskLevel::Critical,
        };
        
        let requires_review = risk_score >= thresholds.risk_score_threshold;
        
        let analysis = FraudAnalysis {
            issue_id,
            patient: issue.patient,
            risk_level,
            risk_score,
            flags,
            pattern_analysis: pattern,
            anomaly_detected: risk_score > 30,
            analysis_timestamp: env.ledger().timestamp(),
            requires_review,
        };
        
        // Store analysis
        env.storage().instance().set(
            &Symbol::new(&env, &format!("fraud_analysis_{}", issue_id)),
            &analysis
        );
        
        Ok(analysis)
    }

    /// Analyze patient's claim patterns over time
    pub fn analyze_claim_pattern(
        env: &Env,
        patient: Address,
    ) -> Result<ClaimPattern, HealthcareDripsError> {
        let patient_issues = Self::get_patient_issues(env, patient.clone());
        
        if patient_issues.is_empty() {
            return Ok(ClaimPattern {
                patient,
                claim_frequency: 0,
                average_amount: 0,
                total_claimed: 0,
                unique_providers: 0,
                claim_types: Vec::new(env),
                last_activity: 0,
                risk_score: 0,
            });
        }
        
        let mut total_amount = 0i128;
        let mut claim_types = Vec::new(env);
        let mut creators = Vec::new(env);
        let mut last_activity = 0u64;
        
        for issue_id in patient_issues.iter() {
            if let Ok(issue) = Self::get_issue(env, *issue_id) {
                total_amount += issue.funding_amount;
                
                // Track unique claim types
                if !claim_types.iter().any(|&t| t == issue.issue_type) {
                    claim_types.push_back(issue.issue_type);
                }
                
                // Track unique providers (creators)
                if !creators.iter().any(|&c| c == issue.creator) {
                    creators.push_back(issue.creator);
                }
                
                if issue.created > last_activity {
                    last_activity = issue.created;
                }
            }
        }
        
        let count = patient_issues.len() as u32;
        let average_amount = if count > 0 { total_amount / count as i128 } else { 0 };
        
        // Calculate claim frequency (claims per month over last 30 days)
        let current_time = env.ledger().timestamp();
        let thirty_days_ago = current_time - (30 * 24 * 60 * 60);
        let recent_claims = patient_issues.iter()
            .filter(|&&issue_id| {
                if let Ok(issue) = Self::get_issue(env, issue_id) {
                    issue.created >= thirty_days_ago
                } else {
                    false
                }
            })
            .count() as u32;
        
        let claim_frequency = recent_claims;
        
        // Calculate pattern risk score
        let mut pattern_risk = 0u32;
        if claim_frequency > 3 { pattern_risk += 10; }
        if creators.len() > 5 { pattern_risk += 15; }
        if claim_types.len() > 6 { pattern_risk += 10; }
        
        Ok(ClaimPattern {
            patient,
            claim_frequency,
            average_amount,
            total_claimed: total_amount,
            unique_providers: creators.len() as u32,
            claim_types,
            last_activity,
            risk_score: pattern_risk,
        })
    }

    /// Detect anomalies in claim patterns
    pub fn detect_pattern_anomaly(
        env: &Env,
        pattern: &ClaimPattern,
        current_issue: &Issue,
    ) -> bool {
        // Check if current claim deviates significantly from pattern
        let amount_deviation = if pattern.average_amount > 0 {
            ((current_issue.funding_amount - pattern.average_amount).abs() * 100) / pattern.average_amount
        } else {
            0
        };
        
        // Flag if amount is more than 200% different from average
        if amount_deviation > 200 {
            return true;
        }
        
        // Check for unusual claim type combinations
        if pattern.claim_types.len() > 4 && 
           !pattern.claim_types.iter().any(|&t| t == current_issue.issue_type) {
            return true;
        }
        
        false
    }

    /// Detect timing anomalies in claim submissions
    pub fn detect_timing_anomaly(
        env: &Env,
        patient: Address,
        current_time: u64,
    ) -> bool {
        let patient_issues = Self::get_patient_issues(env, patient);
        
        if patient_issues.len() < 2 {
            return false;
        }
        
        // Check for multiple claims in short time period
        let one_day_ago = current_time - (24 * 60 * 60);
        let recent_claims = patient_issues.iter()
            .filter(|&&issue_id| {
                if let Ok(issue) = Self::get_issue(env, issue_id) {
                    issue.created >= one_day_ago && issue.created <= current_time
                } else {
                    false
                }
            })
            .count();
        
        recent_claims > 2
    }

    /// Automatically flag high-risk claims for manual review
    pub fn flag_high_risk_claims(
        env: &Env,
        issue_id: u64,
    ) -> Result<(), HealthcareDripsError> {
        let analysis = Self::analyze_claim_fraud(env, issue_id)?;
        
        if analysis.requires_review {
            // Add to flagged claims list
            let mut flagged_claims: Vec<u64> = env.storage().instance()
                .get(&Symbol::short("flagged_claims"))
                .unwrap_or(Vec::new(env));
            
            if !flagged_claims.iter().any(|&id| id == issue_id) {
                flagged_claims.push_back(issue_id);
                env.storage().instance().set(&Symbol::short("flagged_claims"), &flagged_claims);
            }
            
            // Update issue status to require additional review
            let issue_key = Symbol::new(&env, &format!("issue_{}", issue_id));
            let mut issue: Issue = env.storage().instance()
                .get(&issue_key)
                .ok_or(HealthcareDripsError::InvalidIssueId)?;
            
            if issue.status == IssueStatus::Submitted {
                issue.status = IssueStatus::UnderReview;
                env.storage().instance().set(&issue_key, &issue);
            }
            
            return Err(HealthcareDripsError::ClaimFlagged);
        }
        
        Ok(())
    }

    /// Get fraud detection thresholds
    fn get_fraud_thresholds(env: &Env) -> FraudThresholds {
        env.storage().instance()
            .get(&Symbol::short("fraud_thresholds"))
            .unwrap_or(FraudThresholds {
                max_monthly_claims: 5,
                max_single_claim_amount: 10000,
                risk_score_threshold: 50,
                frequency_penalty: 10,
                amount_penalty: 20,
                pattern_penalty: 30,
            })
    }

    /// Update fraud detection thresholds (admin only)
    pub fn update_fraud_thresholds(
        env: &Env,
        thresholds: FraudThresholds,
        caller: Address,
    ) -> Result<(), HealthcareDripsError> {
        if !Self::has_role(env, caller, ISSUE_CREATOR) {
            return Err(HealthcareDripsError::Unauthorized);
        }
        
        env.storage().instance().set(&Symbol::short("fraud_thresholds"), &thresholds);
        Ok(())
    }

    /// Get fraud analysis for a specific claim
    pub fn get_fraud_analysis(
        env: &Env,
        issue_id: u64,
    ) -> Result<FraudAnalysis, HealthcareDripsError> {
        env.storage().instance()
            .get(&Symbol::new(&env, &format!("fraud_analysis_{}", issue_id)))
            .ok_or(HealthcareDripsError::FraudDetectionFailed)
    }

    /// Get all flagged claims requiring review
    pub fn get_flagged_claims(env: &Env) -> Vec<u64> {
        env.storage().instance()
            .get(&Symbol::short("flagged_claims"))
            .unwrap_or(Vec::new(env))
    }

    /// Remove claim from flagged list after review
    pub fn remove_flagged_claim(
        env: &Env,
        issue_id: u64,
        caller: Address,
    ) -> Result<(), HealthcareDripsError> {
        if !Self::has_role(env, caller, REVIEWER) {
            return Err(HealthcareDripsError::Unauthorized);
        }
        
        let mut flagged_claims: Vec<u64> = env.storage().instance()
            .get(&Symbol::short("flagged_claims"))
            .unwrap_or(Vec::new(env));
        
        flagged_claims.retain(|&id| id != issue_id);
        env.storage().instance().set(&Symbol::short("flagged_claims"), &flagged_claims);
        
        Ok(())
    }
    
    // ========== MULTI-TOKEN SUPPORT FUNCTIONS ==========
    
    /// Get next swap ID
    fn get_next_swap_id(env: &Env) -> u64 {
        let key = Symbol::short("next_swap_id");
        let next_id = env.storage().instance().get(&key).unwrap_or(1u64);
        env.storage().instance().set(&key, &(next_id + 1));
        next_id
    }
    
    /// Get token balance
    pub fn get_token_balance(env: &Env, token: Address) -> Result<TokenBalance, HealthcareDripsError> {
        env.storage().instance()
            .get(&Symbol::new(&env, &format!("balance_{}", token)))
            .ok_or(HealthcareDripsError::InvalidToken)
    }
    
    /// Get swap request
    pub fn get_swap_request(env: &Env, swap_id: u64) -> Result<SwapRequest, HealthcareDripsError> {
        env.storage().instance()
            .get(&Symbol::new(&env, &format!("swap_{}", swap_id)))
            .ok_or(HealthcareDripsError::InvalidIssueId)
    }
    
    /// Get pending swaps
    pub fn get_pending_swaps(env: &Env) -> Vec<u64> {
        env.storage().instance()
            .get(&Symbol::short("pending_swaps"))
            .unwrap_or(Vec::new(env))
    }
    
    /// Get rebalance configuration
    pub fn get_rebalance_config(env: &Env) -> RebalanceConfig {
        env.storage().instance()
            .get(&Symbol::short("rebalance_config"))
            .unwrap_or(RebalanceConfig {
                enabled: false,
                threshold: 1000,
                max_slippage: 500,
                check_interval: 86400,
                last_check: 0,
            })
    }
    
    /// Update rebalance configuration (admin only)
    pub fn update_rebalance_config(
        env: &Env,
        config: RebalanceConfig,
        caller: Address,
    ) -> Result<(), HealthcareDripsError> {
        if !Self::has_role(env, caller, ISSUE_CREATOR) {
            return Err(HealthcareDripsError::Unauthorized);
        }
        
        env.storage().instance().set(&Symbol::short("rebalance_config"), &config);
        Ok(())
    }
    
    /// Get all tracked token balances
    pub fn get_all_token_balances(env: &Env) -> Vec<TokenBalance> {
        let token_addresses: Vec<Address> = env.storage().instance()
            .get(&Symbol::short("token_balances"))
            .unwrap_or(Vec::new(env));
        
        let mut balances = Vec::new(env);
        for token in token_addresses.iter() {
            if let Ok(balance) = Self::get_token_balance(env, token.clone()) {
                balances.push_back(balance);
            }
        }
        
        balances
    }
    
    /// Process multi-token premium payment
    pub fn process_multi_token_premium_payment(
        env: &Env,
        drip_id: u64,
        caller: Address,
    ) -> Result<(), HealthcareDripsError> {
        let drip_key = Symbol::new(&env, &format!("drip_{}", drip_id));
        let mut drip: PremiumDrip = env.storage().instance()
            .get(&drip_key)
            .ok_or(HealthcareDripsError::InvalidIssueId)?;
        
        if !drip.active {
            return Err(HealthcareDripsError::IssueNotActive);
        }
        
        if drip.insurer != caller {
            return Err(HealthcareDripsError::Unauthorized);
        }
        
        let current_time = env.ledger().timestamp();
        if current_time < drip.next_payment {
            return Err(HealthcareDripsError::InvalidAmount); // Payment not due yet
        }
        
        // Process payment for each token allocation
        for allocation in drip.token_allocations.iter() {
            let token_amount = (drip.premium_amount * allocation.percentage as i128) / 10000;
            
            // Check if we have sufficient balance or need to swap
            let balance_key = Symbol::new(&env, &format!("balance_{}", allocation.token));
            if let Some(current_balance) = env.storage().instance().get::<_, TokenBalance>(&balance_key) {
                if current_balance.balance < token_amount {
                    // Need to swap from primary token
                    let swap_amount = token_amount - current_balance.balance;
                    let min_amount_out = Self::get_swap_amount_out(
                        env,
                        drip.primary_token.clone(),
                        allocation.token.clone(),
                        swap_amount
                    )?;
                    
                    Self::create_swap_request(
                        env,
                        drip.primary_token.clone(),
                        allocation.token.clone(),
                        swap_amount,
                        min_amount_out,
                        drip.slippage_tolerance,
                        current_time + 1800, // 30 min deadline
                        caller.clone(),
                    )?;
                }
                
                // Update the balance (deduct for premium payment)
                Self::update_token_balance(env, allocation.token.clone(), -token_amount);
            }
        }
        
        // Update drip payment schedule
        drip.last_payment = current_time;
        drip.next_payment = current_time + drip.interval;
        drip.total_paid += drip.premium_amount;
        
        env.storage().instance().set(&drip_key, &drip);
        
        Ok(())
    }
}
