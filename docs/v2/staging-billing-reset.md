# V2 staging billing reset

This operator utility is a CLI script. It has no HTTP route or Account button. It only runs when the server identifies itself as V2 staging, its public origin is `https://test.soundspa.bodhemusic.com`, and its database URL and live PostgreSQL identity match the V2 staging Compose database. It also requires the configured V2 operator credentials through the existing `V2_ADMIN_USERNAME` and `V2_ADMIN_PASSWORD` environment values.

The reset preserves orders, payments, subscriptions, trials, the Organization, Location, users, devices, channels, and settings. Subscription and trial rows receive an `invalidated_by_reset_id` reference to a billing reset audit row; their paid dates and payment records are not rewritten. The reset utility inserts audit rows and does not update or delete them, but database-level append-only enforcement is not configured. It closes only pending Fake Provider payments and eligible orders. It fails closed for non-Fake pending payments, ambiguous payment states, mixed-scope aggregate checkouts, changed previews, and database lock timeouts.

SoundSpa Basic's shared V2 trial policy is 28 days, defined in `db/v2/queries/trialPolicy.ts`. Ordinary V2 customer onboarding and reset previews use that default. `--trial-days` supports an explicit test override; the preview and reset audit record the selected duration, so an override is visible and bound to the plan hash.

The selected Product IDs are the complete reset scope. Include only Products whose test billing state should be reset. The trial Product must be the canonical SoundSpa Basic Product (`soundspa`). Partner Benefits, Gift Access, and Location Admin Grants are always outside this utility's scope. The legacy `location_service_access` row has no Product key; if its paid/trial window is active, a Product-scoped reset is refused. Only `--all-products` explicitly authorizes clearing those Location-wide billing timestamps, with prior values recorded in the reset audit row. The suspension field is preserved.

## Preview

Run from the V2 staging checkout on `Soundspa-Moscow`, using the `soundspa-v2` Compose project. Replace the two UUID values with the verified Bodhe Spa Organization ID and Hamam Location ID, and use the SoundSpa Basic Product ID from the V2 catalog. The application container already supplies the operator credentials; do not pass credentials on the command line.

```sh
ORG_ID='verified-bodhe-spa-organization-uuid'
LOCATION_ID='verified-hamam-location-uuid'
SOUNDSPA_PRODUCT_ID='verified-soundspa-basic-product-uuid'

docker compose --project-name soundspa-v2 -f docker-compose.staging.yml exec app \
  node --import tsx scripts/v2/reset-test-billing.ts \
  --organization-id "$ORG_ID" \
  --location-id "$LOCATION_ID" \
  --product-id "$SOUNDSPA_PRODUCT_ID" \
  --trial-product-id "$SOUNDSPA_PRODUCT_ID" \
  --trial-days 28 \
  --reason "Reset Hamam billing for acceptance test"
```

For a deliberate all-Product reset, replace the `--product-id` option with `--all-products`. The script resolves the current complete Product list and includes it in the reviewed plan. Use this only when every Product entitlement at that Location belongs in the reset scope.

Preview is the default. It makes no writes and returns a `planHash`. Review the Organization, Location, Product scope, affected record IDs, pending checkout closures, and successful payment IDs that will be preserved. A pending aggregate checkout containing any out-of-scope line blocks the reset.

Example output shape (IDs and hash abbreviated):

```json
{
  "mode": "dry-run",
  "organization": { "id": "<organization-uuid>", "name": "Bodhe Spa" },
  "location": { "id": "<location-uuid>", "name": "Hamam" },
  "products": [{ "id": "<product-uuid>", "code": "soundspa", "name": "SoundSpa Basic" }],
  "trial": { "productId": "<product-uuid>", "durationDays": 28, "start": "apply-time" },
  "changes": {
    "historicalSubscriptionsToInvalidate": ["<subscription-uuid>"],
    "historicalTrialsToInvalidate": ["<trial-uuid>"],
    "ordersToClose": ["<pending-order-uuid>"],
    "pendingFakePaymentsToClose": ["<pending-payment-uuid>"],
    "successfulPaymentsPreserved": ["<paid-payment-uuid>"],
    "legacyLocationAccessToClear": null,
    "partnerBenefitsGiftAccessAndAdminGrants": "unchanged"
  },
  "planHash": "<64-character-sha256>"
}
```

## Apply

Apply requires the reviewed hash, `--apply`, and the exact confirmation phrase containing both verified IDs. The operation rechecks the preview under database locks and aborts with `plan_changed` if any relevant billing state changed since preview.

```sh
PLAN_HASH='copy-the-planHash-from-the-reviewed-preview'

docker compose --project-name soundspa-v2 -f docker-compose.staging.yml exec app \
  node --import tsx scripts/v2/reset-test-billing.ts \
  --organization-id "$ORG_ID" \
  --location-id "$LOCATION_ID" \
  --product-id "$SOUNDSPA_PRODUCT_ID" \
  --trial-product-id "$SOUNDSPA_PRODUCT_ID" \
  --trial-days 28 \
  --reason "Reset Hamam billing for acceptance test" \
  --apply \
  --confirm "RESET V2 STAGING BILLING $ORG_ID $LOCATION_ID" \
  --plan-hash "$PLAN_HASH"
```

The `--trial-days` value accepts 1–365 days and defaults to the shared 28-day SoundSpa Basic policy. Pass a different value only for an explicitly reviewed test scenario; the preview, confirmation hash, and audit row record it. The reason must contain 12–500 characters. A later intentional reset requires a fresh preview and a new apply; each applied reset creates a distinct audit record and leaves at most one non-invalidated trial per Location/Product.

For the all-Product variant, use `--all-products` in both preview and apply in place of `--product-id`; the preview hash binds the complete Product list and scope choice.

## Local integration tests

`scripts/v2/test-billing-reset-db.ts` refuses non-loopback databases, requires the dedicated `soundspa_v2_test` role and the explicit `V2_BILLING_RESET_TEST_ALLOW_DATABASE=1` opt-in, verifies PostgreSQL 16 and the complete V2 migration ledger, and requires an empty disposable database. Never point it at staging or production.
