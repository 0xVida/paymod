#![no_std]

use soroban_sdk::{
    Address, Bytes, BytesN, Env, MuxedAddress, Symbol, TryFromVal, Val, Vec,
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractevent, contractimpl, contracttype,
    crypto::Hash,
    token,
};

#[contract]
pub struct TreasuryContract;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Owner,
    Executor,
    ExecutorPublicKey,
    Token,
    Paused,
    MaxPerPayment,
    MaxPerPeriod,
    PeriodSeconds,
    PeriodStart,
    SpentInPeriod,
    /// 0 means no expiry (perpetual until the owner rotates the executor),
    /// same as the contract's original behavior. ADR 0007 fixes ADR 0002
    /// here - expiry was documented as enforced but never actually
    /// implemented until this field.
    AuthorityExpiresAt,
    /// lives in `temporary` storage so replay protection per `payment_id` is
    /// bounded by `EXECUTED_TTL_EXTEND_TO` instead of growing `instance`
    /// storage forever (ADR 0007). the real guarantee is off-chain
    /// (`Settlement.intentId`'s unique constraint, deterministic `paymentId`
    /// derivation) - this is just a backstop.
    Executed(BytesN<32>),
}

/// these are in ledgers, not seconds (~5s per ledger on average).
/// `INSTANCE_BUMP_AMOUNT` is roughly 30 days - an idle but funded treasury
/// needs activity or an explicit `extend_ttl()` call in that window or it
/// gets archived (ADR 0007 defect 3).
const INSTANCE_BUMP_THRESHOLD: u32 = 100_000;
const INSTANCE_BUMP_AMOUNT: u32 = 518_400;

/// ~90 days, plenty of headroom for off-chain retry/reconciliation after an
/// outage while still bounding the entry's lifetime. see `Executed`'s doc
/// comment for why a bounded window is fine.
const EXECUTED_TTL_THRESHOLD: u32 = 100_000;
const EXECUTED_TTL_EXTEND_TO: u32 = 1_555_200;

/// signature carried in a Soroban authorization entry that names this
/// contract as `sorobanCredentialsAddress` - the shape x402's exact-scheme
/// facilitator on Stellar expects when the payer signs a token `transfer`
/// directly (docs/adr/0008-x402-buyer-settlement-path.md).
#[contracttype]
#[derive(Clone)]
pub struct ExecutorSignature {
    pub payment_id: BytesN<32>,
    pub signature: BytesN<64>,
}

/// events give an off-chain reconciler or indexer something to subscribe to
/// instead of polling contract state - a Slice 6 goal, even though the
/// reconciler itself is separate work.
#[contractevent]
struct Initialized {
    #[topic]
    owner: Address,
    executor: Address,
    token: Address,
}

#[contractevent]
struct Payment {
    #[topic]
    payment_id: BytesN<32>,
    recipient: Address,
    amount: i128,
}

#[contractevent]
struct Paused {}

#[contractevent]
struct Unpaused {}

#[contractevent]
struct ExecutorChanged {
    #[topic]
    executor: Address,
}

#[contractevent]
struct LimitsChanged {
    max_per_payment: i128,
    max_per_period: i128,
    period_seconds: u64,
}

#[contractevent]
struct AuthorityExpiryChanged {
    expires_at: u64,
}

#[contractevent]
struct Withdrawal {
    #[topic]
    recipient: Address,
    amount: i128,
}

#[contractevent]
struct X402Payment {
    #[topic]
    payment_id: BytesN<32>,
    amount: i128,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    InvalidPeriod = 4,
    TreasuryPaused = 5,
    PerPaymentLimitExceeded = 6,
    PeriodLimitExceeded = 7,
    PaymentAlreadyExecuted = 8,
    ArithmeticOverflow = 9,
    InvalidAuthContext = 10,
    AuthorityExpired = 11,
    MaxPerPaymentExceedsMaxPerPeriod = 12,
}

fn read<T: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(env: &Env, key: &DataKey) -> T {
    env.storage().instance().get(key).unwrap()
}

fn bump_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_BUMP_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if env.storage().instance().has(&DataKey::Owner) {
        bump_instance_ttl(env);
        Ok(())
    } else {
        Err(Error::NotInitialized)
    }
}

fn require_owner(env: &Env) -> Result<Address, Error> {
    ensure_initialized(env)?;
    let owner: Address = read(env, &DataKey::Owner);
    owner.require_auth();
    Ok(owner)
}

fn validate_limits(
    max_per_payment: i128,
    max_per_period: i128,
    period_seconds: u64,
) -> Result<(), Error> {
    if max_per_payment <= 0 || max_per_period <= 0 {
        return Err(Error::InvalidAmount);
    }
    if period_seconds == 0 {
        return Err(Error::InvalidPeriod);
    }
    if max_per_payment > max_per_period {
        return Err(Error::MaxPerPaymentExceedsMaxPerPeriod);
    }
    Ok(())
}

fn transfer_from_treasury(env: &Env, recipient: &Address, amount: i128) {
    let token_address: Address = read(env, &DataKey::Token);
    let destination = MuxedAddress::from(recipient);
    token::TokenClient::new(env, &token_address).transfer(
        &env.current_contract_address(),
        &destination,
        &amount,
    );
}

/// doesn't persist the new spend total - callers persist it only after the
/// transfer succeeds, so `execute_payment` and `__check_auth` share one
/// budget and replay namespace (ADR 0008)
fn authorize_spend(env: &Env, amount: i128) -> Result<i128, Error> {
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }

    let now = env.ledger().timestamp();

    let authority_expires_at: u64 = read(env, &DataKey::AuthorityExpiresAt);
    if authority_expires_at != 0 && now >= authority_expires_at {
        return Err(Error::AuthorityExpired);
    }

    let paused: bool = read(env, &DataKey::Paused);
    if paused {
        return Err(Error::TreasuryPaused);
    }

    let max_per_payment: i128 = read(env, &DataKey::MaxPerPayment);
    if amount > max_per_payment {
        return Err(Error::PerPaymentLimitExceeded);
    }

    let period_seconds: u64 = read(env, &DataKey::PeriodSeconds);
    let period_start: u64 = read(env, &DataKey::PeriodStart);
    let mut spent: i128 = read(env, &DataKey::SpentInPeriod);
    if now >= period_start.saturating_add(period_seconds) {
        spent = 0;
        env.storage().instance().set(&DataKey::PeriodStart, &now);
    }

    let max_per_period: i128 = read(env, &DataKey::MaxPerPeriod);
    let updated_spend = spent.checked_add(amount).ok_or(Error::ArithmeticOverflow)?;
    if updated_spend > max_per_period {
        return Err(Error::PeriodLimitExceeded);
    }

    Ok(updated_spend)
}

/// current, correct spend total for the active period - same lazy-reset
/// logic as `authorize_spend` but doesn't persist anything. fixes ADR 0007
/// defect 4: raw `SpentInPeriod` alone goes stale (too high) once the
/// window rolls but nothing's spent yet.
fn current_spent_in_period(env: &Env) -> i128 {
    let now = env.ledger().timestamp();
    let period_seconds: u64 = read(env, &DataKey::PeriodSeconds);
    let period_start: u64 = read(env, &DataKey::PeriodStart);
    if now >= period_start.saturating_add(period_seconds) {
        0
    } else {
        read(env, &DataKey::SpentInPeriod)
    }
}

fn is_executed(env: &Env, payment_id: &BytesN<32>) -> bool {
    env.storage()
        .temporary()
        .has(&DataKey::Executed(payment_id.clone()))
}

fn commit_spend(env: &Env, payment_id: BytesN<32>, updated_spend: i128) {
    let key = DataKey::Executed(payment_id);
    let temp = env.storage().temporary();
    temp.set(&key, &true);
    temp.extend_ttl(&key, EXECUTED_TTL_THRESHOLD, EXECUTED_TTL_EXTEND_TO);
    env.storage()
        .instance()
        .set(&DataKey::SpentInPeriod, &updated_spend);
}

fn decode<T: TryFromVal<Env, Val>>(env: &Env, val: &Val) -> Result<T, Error> {
    T::try_from_val(env, val).map_err(|_| Error::InvalidAuthContext)
}

#[contractimpl]
impl TreasuryContract {
    /// `authority_expires_at` of 0 means no expiry, see `DataKey::AuthorityExpiresAt`.
    ///
    /// flat positional args match Soroban's usual constructor convention and
    /// keep both callers (Freighter's raw `AssembledTransaction`, the CLI's
    /// named-flag `contract invoke`) simple - a wrapper struct would need a
    /// `Map` instead of scalars for one more field.
    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        env: Env,
        owner: Address,
        executor: Address,
        executor_public_key: BytesN<32>,
        token: Address,
        max_per_payment: i128,
        max_per_period: i128,
        period_seconds: u64,
        authority_expires_at: u64,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Owner) {
            return Err(Error::AlreadyInitialized);
        }
        validate_limits(max_per_payment, max_per_period, period_seconds)?;

        owner.require_auth();
        let start = env.ledger().timestamp();
        let storage = env.storage().instance();
        storage.set(&DataKey::Owner, &owner);
        storage.set(&DataKey::Executor, &executor);
        storage.set(&DataKey::ExecutorPublicKey, &executor_public_key);
        storage.set(&DataKey::Token, &token);
        storage.set(&DataKey::Paused, &false);
        storage.set(&DataKey::MaxPerPayment, &max_per_payment);
        storage.set(&DataKey::MaxPerPeriod, &max_per_period);
        storage.set(&DataKey::PeriodSeconds, &period_seconds);
        storage.set(&DataKey::PeriodStart, &start);
        storage.set(&DataKey::SpentInPeriod, &0_i128);
        storage.set(&DataKey::AuthorityExpiresAt, &authority_expires_at);
        bump_instance_ttl(&env);

        Initialized {
            owner,
            executor,
            token,
        }
        .publish(&env);
        Ok(())
    }

    /// transfers USDC held by this contract, after checking the executor,
    /// limits, pause state and a caller-supplied idempotency id.
    pub fn execute_payment(
        env: Env,
        payment_id: BytesN<32>,
        recipient: Address,
        amount: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        if is_executed(&env, &payment_id) {
            return Err(Error::PaymentAlreadyExecuted);
        }

        let executor: Address = read(&env, &DataKey::Executor);
        executor.require_auth();

        let updated_spend = authorize_spend(&env, amount)?;

        // if the token transfer fails, Soroban rolls back these state changes
        commit_spend(&env, payment_id.clone(), updated_spend);
        transfer_from_treasury(&env, &recipient, amount);

        Payment {
            payment_id,
            recipient,
            amount,
        }
        .publish(&env);
        Ok(())
    }

    pub fn pause(env: Env) -> Result<(), Error> {
        require_owner(&env)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        Paused {}.publish(&env);
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), Error> {
        require_owner(&env)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        Unpaused {}.publish(&env);
        Ok(())
    }

    pub fn set_executor(
        env: Env,
        executor: Address,
        executor_public_key: BytesN<32>,
    ) -> Result<(), Error> {
        require_owner(&env)?;
        let storage = env.storage().instance();
        storage.set(&DataKey::Executor, &executor);
        storage.set(&DataKey::ExecutorPublicKey, &executor_public_key);
        ExecutorChanged { executor }.publish(&env);
        Ok(())
    }

    /// owner-only. wasn't in v1 - raising a customer's caps used to mean
    /// deploying a whole new treasury (ADR 0007). doesn't reset
    /// `SpentInPeriod` either - spend already counted in the active window
    /// still counts toward the new cap.
    pub fn set_limits(
        env: Env,
        max_per_payment: i128,
        max_per_period: i128,
        period_seconds: u64,
    ) -> Result<(), Error> {
        require_owner(&env)?;
        validate_limits(max_per_payment, max_per_period, period_seconds)?;

        let storage = env.storage().instance();
        storage.set(&DataKey::MaxPerPayment, &max_per_payment);
        storage.set(&DataKey::MaxPerPeriod, &max_per_period);
        storage.set(&DataKey::PeriodSeconds, &period_seconds);
        LimitsChanged {
            max_per_payment,
            max_per_period,
            period_seconds,
        }
        .publish(&env);
        Ok(())
    }

    /// owner-only. `expires_at` of 0 clears the expiry (perpetual, the
    /// original behavior) - see ADR 0007's correction to ADR 0002.
    pub fn set_authority_expiry(env: Env, expires_at: u64) -> Result<(), Error> {
        require_owner(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::AuthorityExpiresAt, &expires_at);
        AuthorityExpiryChanged { expires_at }.publish(&env);
        Ok(())
    }

    pub fn withdraw(env: Env, recipient: Address, amount: i128) -> Result<(), Error> {
        require_owner(&env)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        transfer_from_treasury(&env, &recipient, amount);
        Withdrawal { recipient, amount }.publish(&env);
        Ok(())
    }

    /// permissionless - extending TTL only costs the caller's own fee and
    /// can't touch any spending-relevant state, so no auth needed. lets an
    /// external keeper keep an otherwise-idle, funded treasury alive between
    /// payments (ADR 0007 defect 3).
    pub fn extend_ttl(env: Env) -> Result<(), Error> {
        ensure_initialized(&env)
    }

    pub fn owner(env: Env) -> Result<Address, Error> {
        ensure_initialized(&env)?;
        Ok(read(&env, &DataKey::Owner))
    }

    pub fn executor(env: Env) -> Result<Address, Error> {
        ensure_initialized(&env)?;
        Ok(read(&env, &DataKey::Executor))
    }

    pub fn token(env: Env) -> Result<Address, Error> {
        ensure_initialized(&env)?;
        Ok(read(&env, &DataKey::Token))
    }

    pub fn is_paused(env: Env) -> Result<bool, Error> {
        ensure_initialized(&env)?;
        Ok(read(&env, &DataKey::Paused))
    }

    pub fn max_per_payment(env: Env) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        Ok(read(&env, &DataKey::MaxPerPayment))
    }

    pub fn max_per_period(env: Env) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        Ok(read(&env, &DataKey::MaxPerPeriod))
    }

    pub fn period_seconds(env: Env) -> Result<u64, Error> {
        ensure_initialized(&env)?;
        Ok(read(&env, &DataKey::PeriodSeconds))
    }

    pub fn period_start(env: Env) -> Result<u64, Error> {
        ensure_initialized(&env)?;
        Ok(read(&env, &DataKey::PeriodStart))
    }

    /// corrected, not the raw stored value - see `current_spent_in_period`.
    pub fn spent_in_period(env: Env) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        Ok(current_spent_in_period(&env))
    }

    /// 0 means no expiry
    pub fn authority_expires_at(env: Env) -> Result<u64, Error> {
        ensure_initialized(&env)?;
        Ok(read(&env, &DataKey::AuthorityExpiresAt))
    }

    pub fn is_payment_executed(env: Env, payment_id: BytesN<32>) -> Result<bool, Error> {
        ensure_initialized(&env)?;
        Ok(is_executed(&env, &payment_id))
    }
}

/// lets this contract's own address be `sorobanCredentialsAddress` in a
/// Soroban auth entry - the shape x402's exact-scheme facilitator on Stellar
/// needs for a direct token `transfer`. authorizes exactly one call, this
/// contract paying out of its own balance, gated by the same caps, expiry
/// and pause state as `execute_payment` (same storage, ADR 0008).
#[contractimpl]
impl CustomAccountInterface for TreasuryContract {
    type Signature = ExecutorSignature;
    type Error = Error;

    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signature: ExecutorSignature,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;

        let executor_public_key: BytesN<32> = read(&env, &DataKey::ExecutorPublicKey);
        let payload: Bytes = signature_payload.to_bytes().into();
        env.crypto()
            .ed25519_verify(&executor_public_key, &payload, &signature.signature);

        if auth_contexts.len() != 1 {
            return Err(Error::InvalidAuthContext);
        }
        let Context::Contract(call) = auth_contexts.get(0).unwrap() else {
            return Err(Error::InvalidAuthContext);
        };

        let token_address: Address = read(&env, &DataKey::Token);
        if call.contract != token_address || call.fn_name != Symbol::new(&env, "transfer") {
            return Err(Error::InvalidAuthContext);
        }
        if call.args.len() != 3 {
            return Err(Error::InvalidAuthContext);
        }
        let from: Address = decode(&env, &call.args.get(0).unwrap())?;
        if from != env.current_contract_address() {
            return Err(Error::InvalidAuthContext);
        }
        let amount: i128 = decode(&env, &call.args.get(2).unwrap())?;

        if is_executed(&env, &signature.payment_id) {
            return Err(Error::PaymentAlreadyExecuted);
        }
        let updated_spend = authorize_spend(&env, amount)?;
        // if the authorized transfer later fails, Soroban rolls this back
        commit_spend(&env, signature.payment_id.clone(), updated_spend);

        X402Payment {
            payment_id: signature.payment_id,
            amount,
        }
        .publish(&env);
        Ok(())
    }
}

#[cfg(test)]
mod test;
