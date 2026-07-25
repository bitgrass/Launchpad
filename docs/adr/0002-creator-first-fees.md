# ADR 0002: Creator-first fee split

Status: accepted.

HoodiePad sets a 1% pool fee and distributes collected canonical-pool fees as follows:

- Creator: 80% of collected fees, equivalent to 0.80% of volume before routing costs.
- HOODIE ecosystem Safe: 15%, equivalent to 0.15% of volume.
- Current Doppler Airlock owner: 5%, equivalent to 0.05% of volume.

Beneficiary shares sum to exactly `1e18`. Beneficiaries are immutable per launch. The accurate user-facing claim is that creators receive 80% of fees from the canonical pool; claims may contain both the child token and HOODIE.

