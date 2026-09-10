extern crate std;

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    Address, Bytes, BytesN, Env, IntoVal, MuxedAddress, Symbol, Vec,
    auth::{Context, ContractContext},
    testutils::{
        Address as _, BytesN as _, Ledger as _,
        storage::{Instance as _, Temporary as _},
    },
    token,
};

struct Fixture {
    env: Env,
    owner: Address,
    recipient: Address,
    token: Address,
    treasury: Address,
    executor_key: SigningKey,
}

fn fixture() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let executor = Address::generate(&env);
    let executor_key = SigningKey::from_bytes(&[7u8; 32]);
    let executor_public_key = BytesN::from_array(&env, &executor_key.verifying_key().to_bytes());
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let stellar_asset = env.register_stellar_asset_contract_v2(token_admin);
    let token = stellar_asset.address();
    let treasury = env.register(TreasuryContract, ());
    let client = TreasuryContractClient::new(&env, &treasury);

    client.initialize(
        &owner,
        &executor,
        &executor_public_key,
        &token,
        &100,
        &250,
        &3_600,
        &0,
    );
    token::StellarAssetClient::new(&env, &token).mint(&treasury, &1_000);

    Fixture {
        env,
        owner,
        recipient,
        token,
        treasury,
        executor_key,
    }
}

fn client(fixture: &Fixture) -> TreasuryContractClient<'_> {
    TreasuryContractClient::new(&fixture.env, &fixture.treasury)
}

fn payment_id(env: &Env) -> BytesN<32> {
    BytesN::random(env)
}

/// Stand-in for the `Hash<32>` the host would normally compute from the real
/// preimage. `Hash<32>` can only be built via a real hash function, and
/// `check_auth` invokes `__check_auth` directly, bypassing host auth
/// dispatch, so no test depends on this matching what a real transaction
/// would derive.
fn signature_payload(env: &Env, seed: u8) -> Hash<32> {
    env.crypto().sha256(&Bytes::from_array(env, &[seed; 32]))
}

fn sign(env: &Env, key: &SigningKey, payload: &Hash<32>) -> BytesN<64> {
    let sig = key.sign(&payload.to_array());
    BytesN::from_array(env, &sig.to_bytes())
}

fn transfer_context(fixture: &Fixture, amount: i128) -> Vec<Context> {
    Vec::from_array(
        &fixture.env,
        [Context::Contract(ContractContext {
            contract: fixture.token.clone(),
            fn_name: Symbol::new(&fixture.env, "transfer"),
            args: (
                fixture.treasury.clone(),
                MuxedAddress::from(&fixture.recipient),
                amount,
            )
                .into_val(&fixture.env),
        })],
    )
}

/// Invokes `__check_auth` directly, as if the host were authenticating the
/// treasury signing `token.transfer(from, to, amount)` on its own behalf
/// (the call shape x402's exact-scheme facilitator on Stellar constructs).
/// Runs in the treasury's own contract context so storage reads/writes
/// resolve correctly.
fn check_auth(
    fixture: &Fixture,
    payload: Hash<32>,
    signature: ExecutorSignature,
    contexts: Vec<Context>,
) -> Result<(), Error> {
    let treasury = fixture.treasury.clone();
    fixture.env.as_contract(&treasury, || {
        TreasuryContract::__check_auth(fixture.env.clone(), payload, signature, contexts)
    })
}

#[test]
fn executor_can_pay_within_the_configured_limits() {
    let fixture = fixture();
    let id = payment_id(&fixture.env);

    client(&fixture).execute_payment(&id, &fixture.recipient, &75);

    let token = token::TokenClient::new(&fixture.env, &fixture.token);
    assert_eq!(token.balance(&fixture.recipient), 75);
    assert_eq!(token.balance(&fixture.treasury), 925);
    assert_eq!(client(&fixture).spent_in_period(), 75);
}

#[test]
fn duplicate_payment_identifier_is_rejected() {
    let fixture = fixture();
    let id = payment_id(&fixture.env);

    client(&fixture).execute_payment(&id, &fixture.recipient, &75);
    let result = client(&fixture).try_execute_payment(&id, &fixture.recipient, &75);

    assert_eq!(result, Err(Ok(Error::PaymentAlreadyExecuted)));
}

#[test]
fn payment_above_per_payment_limit_is_rejected() {
    let fixture = fixture();
    let result =
        client(&fixture).try_execute_payment(&payment_id(&fixture.env), &fixture.recipient, &101);

    assert_eq!(result, Err(Ok(Error::PerPaymentLimitExceeded)));
}

#[test]
fn payment_above_period_limit_is_rejected() {
    let fixture = fixture();
    client(&fixture).execute_payment(&payment_id(&fixture.env), &fixture.recipient, &100);
    client(&fixture).execute_payment(&payment_id(&fixture.env), &fixture.recipient, &100);

    let result =
        client(&fixture).try_execute_payment(&payment_id(&fixture.env), &fixture.recipient, &51);

    assert_eq!(result, Err(Ok(Error::PeriodLimitExceeded)));
}

#[test]
fn owner_pause_blocks_payments_and_owner_can_withdraw() {
    let fixture = fixture();
    client(&fixture).pause();

    let blocked =
        client(&fixture).try_execute_payment(&payment_id(&fixture.env), &fixture.recipient, &10);
    assert_eq!(blocked, Err(Ok(Error::TreasuryPaused)));

    client(&fixture).withdraw(&fixture.owner, &200);
    let token = token::TokenClient::new(&fixture.env, &fixture.token);
    assert_eq!(token.balance(&fixture.owner), 200);
}

#[test]
fn owner_can_revoke_the_executor() {
    let fixture = fixture();
    let replacement = Address::generate(&fixture.env);
    let replacement_key = BytesN::from_array(&fixture.env, &[9u8; 32]);
    client(&fixture).set_executor(&replacement, &replacement_key);

    assert_eq!(client(&fixture).executor(), replacement);
}

#[test]
fn x402_check_auth_accepts_a_correctly_signed_direct_token_transfer() {
    let fixture = fixture();
    let payload = signature_payload(&fixture.env, 1);
    let signature = ExecutorSignature {
        payment_id: payment_id(&fixture.env),
        signature: sign(&fixture.env, &fixture.executor_key, &payload),
    };

    let result = check_auth(&fixture, payload, signature, transfer_context(&fixture, 75));

    assert_eq!(result, Ok(()));
    assert_eq!(client(&fixture).spent_in_period(), 75);
}

#[test]
fn x402_check_auth_shares_the_period_budget_with_execute_payment() {
    let fixture = fixture();
    client(&fixture).execute_payment(&payment_id(&fixture.env), &fixture.recipient, &100);
    client(&fixture).execute_payment(&payment_id(&fixture.env), &fixture.recipient, &100);

    let payload = signature_payload(&fixture.env, 2);
    let signature = ExecutorSignature {
        payment_id: payment_id(&fixture.env),
        signature: sign(&fixture.env, &fixture.executor_key, &payload),
    };

    // 200 already spent via execute_payment; the period cap is 250, so this
    // 75 would push the shared total to 275 (over the limit only if both
    // entry points draw from the same counter, which is the point).
    let result = check_auth(&fixture, payload, signature, transfer_context(&fixture, 75));

    assert_eq!(result, Err(Error::PeriodLimitExceeded));
}

#[test]
fn x402_check_auth_rejects_a_signature_from_the_wrong_key() {
    let fixture = fixture();
    let payload = signature_payload(&fixture.env, 3);
    let impostor = SigningKey::from_bytes(&[42u8; 32]);
    let signature = ExecutorSignature {
        payment_id: payment_id(&fixture.env),
        signature: sign(&fixture.env, &impostor, &payload),
    };

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        check_auth(&fixture, payload, signature, transfer_context(&fixture, 75))
    }));

    assert!(result.is_err(), "an invalid signature must not be accepted");
}

#[test]
fn x402_check_auth_rejects_a_context_naming_the_wrong_function() {
    let fixture = fixture();
    let payload = signature_payload(&fixture.env, 4);
    let signature = ExecutorSignature {
        payment_id: payment_id(&fixture.env),
        signature: sign(&fixture.env, &fixture.executor_key, &payload),
    };
    let wrong_context = Vec::from_array(
        &fixture.env,
        [Context::Contract(ContractContext {
            contract: fixture.token.clone(),
            fn_name: Symbol::new(&fixture.env, "burn"),
            args: (fixture.treasury.clone(), 75_i128).into_val(&fixture.env),
        })],
    );

    let result = check_auth(&fixture, payload, signature, wrong_context);

    assert_eq!(result, Err(Error::InvalidAuthContext));
}

#[test]
fn x402_check_auth_rejects_an_amount_above_the_per_payment_limit() {
    let fixture = fixture();
    let payload = signature_payload(&fixture.env, 5);
    let signature = ExecutorSignature {
        payment_id: payment_id(&fixture.env),
        signature: sign(&fixture.env, &fixture.executor_key, &payload),
    };

    let result = check_auth(
        &fixture,
        payload,
        signature,
        transfer_context(&fixture, 101),
    );

    assert_eq!(result, Err(Error::PerPaymentLimitExceeded));
}

#[test]
fn x402_check_auth_rejects_a_replayed_payment_id() {
    let fixture = fixture();
    let id = payment_id(&fixture.env);

    let first_payload = signature_payload(&fixture.env, 6);
    let first_signature = ExecutorSignature {
        payment_id: id.clone(),
        signature: sign(&fixture.env, &fixture.executor_key, &first_payload),
    };
    assert_eq!(
        check_auth(
            &fixture,
            first_payload,
            first_signature,
            transfer_context(&fixture, 10)
        ),
        Ok(())
    );

    let second_payload = signature_payload(&fixture.env, 7);
    let second_signature = ExecutorSignature {
        payment_id: id,
        signature: sign(&fixture.env, &fixture.executor_key, &second_payload),
    };

    let result = check_auth(
        &fixture,
        second_payload,
        second_signature,
        transfer_context(&fixture, 10),
    );

    assert_eq!(result, Err(Error::PaymentAlreadyExecuted));
}

#[test]
fn set_limits_raises_caps_without_resetting_spent_in_period() {
    let fixture = fixture();
    client(&fixture).execute_payment(&payment_id(&fixture.env), &fixture.recipient, &100);
    assert_eq!(client(&fixture).spent_in_period(), 100);

    client(&fixture).set_limits(&500, &1_000, &7_200);

    assert_eq!(client(&fixture).max_per_payment(), 500);
    assert_eq!(client(&fixture).max_per_period(), 1_000);
    assert_eq!(client(&fixture).period_seconds(), 7_200);
    assert_eq!(
        client(&fixture).spent_in_period(),
        100,
        "existing spend in the active window must not be wiped by a limit change"
    );

    // The new, higher cap takes effect immediately, in the same window.
    client(&fixture).execute_payment(&payment_id(&fixture.env), &fixture.recipient, &400);
    assert_eq!(client(&fixture).spent_in_period(), 500);
}

#[test]
fn set_limits_rejects_max_per_payment_above_max_per_period() {
    let fixture = fixture();
    let result = client(&fixture).try_set_limits(&500, &100, &3_600);
    assert_eq!(result, Err(Ok(Error::MaxPerPaymentExceedsMaxPerPeriod)));
}

#[test]
fn set_limits_rejects_zero_period_seconds() {
    let fixture = fixture();
    let result = client(&fixture).try_set_limits(&100, &200, &0);
    assert_eq!(result, Err(Ok(Error::InvalidPeriod)));
}

#[test]
fn initialize_rejects_max_per_payment_above_max_per_period() {
    let env = Env::default();
    env.mock_all_auths();
    let owner = Address::generate(&env);
    let executor = Address::generate(&env);
    let executor_public_key = BytesN::from_array(&env, &[1u8; 32]);
    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let treasury = env.register(TreasuryContract, ());
    let treasury_client = TreasuryContractClient::new(&env, &treasury);

    let result = treasury_client.try_initialize(
        &owner,
        &executor,
        &executor_public_key,
        &token,
        &500,
        &100,
        &3_600,
        &0,
    );

    assert_eq!(result, Err(Ok(Error::MaxPerPaymentExceedsMaxPerPeriod)));
}

#[test]
fn authority_expiry_blocks_payment_once_it_lapses() {
    let fixture = fixture();
    let now = fixture.env.ledger().timestamp();
    client(&fixture).set_authority_expiry(&(now + 100));

    // Still valid before the expiry.
    client(&fixture).execute_payment(&payment_id(&fixture.env), &fixture.recipient, &10);

    fixture.env.ledger().set_timestamp(now + 200);
    let result =
        client(&fixture).try_execute_payment(&payment_id(&fixture.env), &fixture.recipient, &10);

    assert_eq!(result, Err(Ok(Error::AuthorityExpired)));
}

#[test]
fn set_authority_expiry_of_zero_clears_it() {
    let fixture = fixture();
    let now = fixture.env.ledger().timestamp();
    client(&fixture).set_authority_expiry(&(now + 100));
    client(&fixture).set_authority_expiry(&0);

    fixture.env.ledger().set_timestamp(now + 1_000);
    // Must succeed: the expiry set above was cleared.
    client(&fixture).execute_payment(&payment_id(&fixture.env), &fixture.recipient, &10);
}

#[test]
fn getters_expose_every_configured_field() {
    let fixture = fixture();
    let c = client(&fixture);
    assert_eq!(c.owner(), fixture.owner);
    assert_eq!(c.token(), fixture.token);
    assert_eq!(c.max_per_payment(), 100);
    assert_eq!(c.max_per_period(), 250);
    assert_eq!(c.period_seconds(), 3_600);
    assert_eq!(c.authority_expires_at(), 0);
    assert_eq!(c.period_start(), fixture.env.ledger().timestamp());
}

#[test]
fn spent_in_period_self_corrects_after_the_window_rolls_without_a_new_payment() {
    let fixture = fixture();
    client(&fixture).execute_payment(&payment_id(&fixture.env), &fixture.recipient, &100);
    assert_eq!(client(&fixture).spent_in_period(), 100);

    let now = fixture.env.ledger().timestamp();
    fixture.env.ledger().set_timestamp(now + 3_601); // past the fixture's 3_600s period

    // No payment has happened yet in the new window, but the getter must not
    // report the stale, too-high pre-roll value (ADR 0007 defect 4).
    assert_eq!(client(&fixture).spent_in_period(), 0);
}

#[test]
fn is_payment_executed_reports_correctly() {
    let fixture = fixture();
    let id = payment_id(&fixture.env);
    assert!(!client(&fixture).is_payment_executed(&id));

    client(&fixture).execute_payment(&id, &fixture.recipient, &10);

    assert!(client(&fixture).is_payment_executed(&id));
}

#[test]
fn executed_replay_protection_uses_temporary_storage_with_a_bounded_ttl() {
    let fixture = fixture();
    let id = payment_id(&fixture.env);
    client(&fixture).execute_payment(&id, &fixture.recipient, &10);

    let treasury = fixture.treasury.clone();
    let ttl = fixture.env.as_contract(&treasury, || {
        fixture
            .env
            .storage()
            .temporary()
            .get_ttl(&DataKey::Executed(id))
    });

    assert!(
        ttl > 0,
        "the Executed entry must have a live TTL, not sit in unbounded instance storage"
    );
    assert!(
        ttl <= EXECUTED_TTL_EXTEND_TO,
        "the TTL must be bounded to EXECUTED_TTL_EXTEND_TO, replay protection is not permanent by design"
    );
}

#[test]
fn extend_ttl_bumps_the_instance_entry_once_it_is_close_to_expiring() {
    let fixture = fixture();
    let treasury = fixture.treasury.clone();

    // Advance past INSTANCE_BUMP_THRESHOLD so the entry is due for a real bump.
    fixture
        .env
        .ledger()
        .with_mut(|info| info.sequence_number += 450_000);
    let ttl_before = fixture
        .env
        .as_contract(&treasury, || fixture.env.storage().instance().get_ttl());
    assert!(
        ttl_before <= INSTANCE_BUMP_THRESHOLD,
        "test setup must actually bring the ttl within the bump threshold"
    );

    client(&fixture).extend_ttl();

    let ttl_after = fixture
        .env
        .as_contract(&treasury, || fixture.env.storage().instance().get_ttl());
    assert!(
        ttl_after > ttl_before,
        "extend_ttl must actually extend the instance entry's TTL"
    );
}
