/**
 * Anchor tests for the audited program, run with `npm run test:program`.
 *
 * The program has no test clock: TIME_BUFFER is five minutes, the late cap
 * window fifteen, the fee cooldown a day. So this suite covers everything
 * reachable without waiting (creation and its guards, betting and its
 * guards, the late cap, emergency cancel and refunds, the withdrawal
 * guards) and keeps the full resolve and claim path behind `LONG_TESTS=1`,
 * which creates a 17 minute market and waits for it.
 *
 * Setup the suite relies on (done by tests/setup-local-usdc.mjs and
 * Anchor.toml): the devnet USDC mint address exists on the local validator
 * with a mint authority in tests/.keys, and the provider wallet is listed in
 * programs/cue-solana/src/config.rs so it passes is_admin.
 */
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { CueSolana } from '../target/types/cue_solana';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram } from '@solana/web3.js';
import { assert } from 'chai';
import { BN } from 'bn.js';
import { readFileSync } from 'node:fs';

const USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const USDC = 1_000_000;

describe('cue-solana', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CueSolana as Program<CueSolana>;
  const admin = (provider.wallet as anchor.Wallet).payer;
  const mintAuthority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync('tests/.keys/mint-authority.json', 'utf8'))));

  const now = () => Math.floor(Date.now() / 1000);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function fundedUser(usdcAmount: number): Promise<{ kp: Keypair; ata: PublicKey }> {
    const kp = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);
    const ata = await getOrCreateAssociatedTokenAccount(provider.connection, admin, USDC_MINT, kp.publicKey);
    if (usdcAmount > 0) await mintTo(provider.connection, admin, USDC_MINT, ata.address, mintAuthority, usdcAmount);
    return { kp, ata: ata.address };
  }

  function marketKeys() {
    const marketId = Array.from(Keypair.generate().publicKey.toBytes());
    const [market] = PublicKey.findProgramAddressSync([Buffer.from('market'), Buffer.from(marketId)], program.programId);
    const vault = getAssociatedTokenAddressSync(USDC_MINT, market, true);
    return { marketId, market, vault };
  }

  const positionPda = (market: PublicKey, user: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from('position'), market.toBuffer(), user.toBuffer()], program.programId)[0];

  async function createMarket(numOptions: number, resolveAt: number, feeBps = 100, authority: Keypair = admin) {
    const k = marketKeys();
    await program.methods
      .createMarket(k.marketId, numOptions, new BN(resolveAt), feeBps)
      .accounts({
        market: k.market,
        vault: k.vault,
        usdcMint: USDC_MINT,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers(authority === admin ? [] : [authority])
      .rpc();
    return k;
  }

  async function placeBet(k: { market: PublicKey; vault: PublicKey }, user: { kp: Keypair; ata: PublicKey }, option: number, amount: number, minPayoutBps: number | null = null) {
    return program.methods
      .placeBet(option, new BN(amount), minPayoutBps)
      .accounts({
        market: k.market,
        position: positionPda(k.market, user.kp.publicKey),
        vault: k.vault,
        userUsdc: user.ata,
        usdcMint: USDC_MINT,
        user: user.kp.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user.kp])
      .rpc();
  }

  async function expectError(p: Promise<unknown>, code: string) {
    try {
      await p;
    } catch (e: any) {
      assert.include(e.toString(), code, `expected ${code}`);
      return;
    }
    assert.fail(`expected ${code}, transaction succeeded`);
  }

  describe('create_market', () => {
    it('an admin creates a market with the course fee', async () => {
      const k = await createMarket(3, now() + 3600);
      const m = await program.account.market.fetch(k.market);
      assert.equal(m.numOptions, 3);
      assert.equal(m.protocolFeeBps, 100);
      assert.deepEqual(m.status, { open: {} });
      assert.equal(m.authority.toBase58(), admin.publicKey.toBase58());
    });

    it('a wallet outside ADMIN_WALLETS cannot', async () => {
      const outsider = await fundedUser(0);
      await expectError(createMarket(2, now() + 3600, 100, outsider.kp), 'Unauthorized');
    });

    it('rejects a fee above 10%, a close inside the buffer and too many options', async () => {
      await expectError(createMarket(2, now() + 3600, 1001), 'FeeTooHigh');
      await expectError(createMarket(2, now() + 100), 'InvalidTime');
      await expectError(createMarket(8, now() + 3600), 'InvalidOptionCount');
    });
  });

  describe('place_bet', () => {
    it('mints shares at 1.00x outside the decay window and moves the USDC into the vault', async () => {
      const k = await createMarket(2, now() + 2 * 86_400);
      const a = await fundedUser(100 * USDC);
      await placeBet(k, a, 0, 50 * USDC);
      const m = await program.account.market.fetch(k.market);
      assert.equal(m.pools[0].toNumber(), 50 * USDC);
      assert.equal(m.sharesTotal[0].toString(), String(50 * USDC));
      assert.equal(Number((await getAccount(provider.connection, k.vault)).amount), 50 * USDC);
      const p = await program.account.userPosition.fetch(positionPda(k.market, a.kp.publicKey));
      assert.equal(p.stakeAmount.toNumber(), 50 * USDC);
      assert.equal(p.option, 0);
      assert.isFalse(p.claimed);
    });

    it('guards: option index, minimum bet, one option per wallet', async () => {
      const k = await createMarket(2, now() + 2 * 86_400);
      const a = await fundedUser(10 * USDC);
      await expectError(placeBet(k, a, 2, USDC), 'InvalidOption');
      await expectError(placeBet(k, a, 0, USDC - 1), 'BetTooSmall');
      await placeBet(k, a, 0, USDC);
      await expectError(placeBet(k, a, 1, USDC), 'DifferentOptionPosition');
    });

    it('slippage floor: a quote the pool cannot pay is rejected', async () => {
      const k = await createMarket(2, now() + 2 * 86_400);
      const a = await fundedUser(100 * USDC);
      // Alone on the option, a 10 USDC bet pays 10 * 0.99 = 9.9 USDC: 9900 bps.
      await expectError(placeBet(k, a, 0, 10 * USDC, 9901), 'SlippageExceeded');
      await placeBet(k, a, 0, 10 * USDC, 9900);
    });

    it('late cap: inside the final 15 minutes a wallet may stake max(10% of pool, 1 USDC)', async () => {
      const k = await createMarket(2, now() + 600);
      const a = await fundedUser(10 * USDC);
      await expectError(placeBet(k, a, 0, 2 * USDC), 'LateBetCapExceeded');
      await placeBet(k, a, 0, USDC);
      await expectError(placeBet(k, a, 0, USDC), 'LateBetCapExceeded');
    });
  });

  describe('emergency_cancel and claim_refund', () => {
    it('refunds every stake in full, once', async () => {
      const k = await createMarket(2, now() + 3600);
      const a = await fundedUser(100 * USDC);
      const b = await fundedUser(100 * USDC);
      await placeBet(k, a, 0, 30 * USDC);
      await placeBet(k, b, 1, 20 * USDC);

      await program.methods.emergencyCancel().accounts({ market: k.market, authority: admin.publicKey }).rpc();
      const m = await program.account.market.fetch(k.market);
      assert.deepEqual(m.status, { cancelled: {} });

      const refund = (u: { kp: Keypair; ata: PublicKey }) =>
        program.methods
          .claimRefund()
          .accounts({
            market: k.market,
            position: positionPda(k.market, u.kp.publicKey),
            vault: k.vault,
            userUsdc: u.ata,
            usdcMint: USDC_MINT,
            user: u.kp.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([u.kp])
          .rpc();
      await refund(a);
      await refund(b);
      assert.equal(Number((await getAccount(provider.connection, a.ata)).amount), 100 * USDC);
      assert.equal(Number((await getAccount(provider.connection, b.ata)).amount), 100 * USDC);
      assert.equal(Number((await getAccount(provider.connection, k.vault)).amount), 0);
      await expectError(refund(a), 'AlreadyClaimed');
    });

    it('a non-admin cannot cancel, and a cancelled market takes no bets', async () => {
      const k = await createMarket(2, now() + 3600);
      const outsider = await fundedUser(10 * USDC);
      await expectError(
        program.methods.emergencyCancel().accounts({ market: k.market, authority: outsider.kp.publicKey }).signers([outsider.kp]).rpc(),
        'Unauthorized'
      );
      await program.methods.emergencyCancel().accounts({ market: k.market, authority: admin.publicKey }).rpc();
      await expectError(placeBet(k, outsider, 0, USDC), 'MarketNotOpen');
    });
  });

  describe('withdraw_fees guards', () => {
    it('refuses an open market, a non-admin, and a treasury not owned by PROTOCOL_TREASURY', async () => {
      const k = await createMarket(2, now() + 3600);
      const outsider = await fundedUser(0);
      const wrongTreasury = outsider.ata;
      const withdraw = (authority: Keypair, treasury: PublicKey) =>
        program.methods
          .withdrawFees()
          .accounts({ market: k.market, vault: k.vault, treasury, usdcMint: USDC_MINT, authority: authority.publicKey, tokenProgram: TOKEN_PROGRAM_ID })
          .signers(authority === admin ? [] : [authority])
          .rpc();
      await expectError(withdraw(outsider.kp, wrongTreasury), 'Unauthorized');
      // The admin passes is_admin, then fails on the treasury owner check,
      // which the program runs before the status check.
      await expectError(withdraw(admin, wrongTreasury), 'InvalidTreasury');
    });
  });

  describe('resolve_market and claim_payout (LONG_TESTS=1, about 17 minutes)', function () {
    before(function () {
      if (!process.env.LONG_TESTS) this.skip();
    });

    it('the larger pool wins, the fee comes off the pot, winners split by shares', async function () {
      this.timeout(25 * 60 * 1000);
      // 990 seconds: bets placed now are outside the 900 second cap window
      // and inside the 300 second buffer, so no guard interferes.
      const resolveAt = now() + 990;
      const k = await createMarket(2, resolveAt);
      const a = await fundedUser(100 * USDC);
      const b = await fundedUser(100 * USDC);
      const c = await fundedUser(100 * USDC);
      await placeBet(k, a, 0, 60 * USDC);
      await placeBet(k, b, 0, 20 * USDC);
      await placeBet(k, c, 1, 20 * USDC);

      await expectError(program.methods.resolveMarket().accounts({ market: k.market }).rpc(), 'TooEarly');
      while (now() < resolveAt + 2) await sleep(5_000);

      await program.methods.resolveMarket().accounts({ market: k.market }).rpc();
      const m = await program.account.market.fetch(k.market);
      assert.deepEqual(m.status, { resolved: {} });
      assert.equal(m.winningOption, 0);
      assert.equal(m.feesAccrued.toNumber(), USDC); // 1% of 100 USDC

      const claim = (u: { kp: Keypair; ata: PublicKey }) =>
        program.methods
          .claimPayout()
          .accounts({
            market: k.market,
            position: positionPda(k.market, u.kp.publicKey),
            vault: k.vault,
            userUsdc: u.ata,
            usdcMint: USDC_MINT,
            user: u.kp.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([u.kp])
          .rpc();
      await claim(a);
      await claim(b);
      await expectError(claim(c), 'NotWinner');
      // The window starts 24 hours before the deadline, so bets on a 17
      // minute market sit inside its second half: every bet here landed at
      // the same multiplier, so shares are proportional to stake. a holds
      // 60/80 and b 20/80 of the 99 USDC distributable.
      assert.equal(Number((await getAccount(provider.connection, a.ata)).amount), 40 * USDC + Math.floor((99 * USDC * 60) / 80));
      assert.equal(Number((await getAccount(provider.connection, b.ata)).amount), 80 * USDC + Math.floor((99 * USDC * 20) / 80));
      // The fee is still in the vault: it cannot leave for 24 hours.
      assert.equal(Number((await getAccount(provider.connection, k.vault)).amount), USDC);
    });
  });
});
