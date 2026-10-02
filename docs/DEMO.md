# Demo script (about seven minutes)

Open the live site. Everything runs in the browser on synthetic data.

1. **Story, step 1 (pack).** Run it. The lifecycle agent finds two missing documents and requests them automatically: an R1 action within its L3 dial.
2. **Step 2 (screening).** A trustee matches a PEP list. The agent records the hit as a fact and recommends acceptance with enhanced due diligence. The verdict is "A person decides" because KYC acceptance is R4. Click **Act as Compliance**, then **Accept recommendation**.
3. **Step 3 (account).** The account-opening instruction (R2) needs Operations approval. Switch back to Operations and approve. An `acmt.001` instruction is built, then the €25m subscription arrives as `setr.010` and is acknowledged automatically with `setr.016`.
4. **Step 4 (late redemption).** Received at 14:02:31 against a 14:00 cut-off. Point out the dashed card: the gate refused the "deal today" alternative under `R-NO-BACKDATING`. The proposed next dealing date is R3, so it needs approval. Approve.
5. **Step 5 (liquidity).** The T+1 rehearsal shows the fund overdrawn for two days. The plan is recommend-only.
6. **Step 6 (oversight).** Provider A's cut-off exceptions are about twice the peer median. Publishing a finding is a decision for Operations.
7. **Step 7 (audit).** The chain verifies and every recorded decision replays identically.

Then show three screens:

- **Control plane → Policy sandbox.** Pick `AMEND_DEALING_DATE`, set the date to "Earlier date (backdate)": refused. Pick `ACCEPT_INVESTOR_KYC`: never more than "A person decides", whatever the dial.
- **Trust boundary.** Open the Corvane KYC pack: the hidden instruction is highlighted, the implied approval is refused. Run the suite: 12 of 12 authorise nothing.
- **Evidence and replay.** Simulate an edit to a past decision: verification fails at that entry. Restore.

Closing line: the agents do the reading and the drafting; the manager owns the policy, the data view and the evidence.
